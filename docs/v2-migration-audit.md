# V2 迁移审计

日期：2026-09-11  
目标：将 V1 的 151 MiB 单 HTML 工具迁移为 Windows / macOS 绿色便携版桌面应用，资源分离、完全离线、双击即用。

## 1. 审计结论

V1 的业务逻辑、音频拼接、解析、设置界面和大部分测试可以直接复用；需要重构的是运行时边界，而不是产品功能本身。

V2 的主链路定为：

```text
Tauri 2 WebView UI
  -> Tauri binary IPC
  -> Rust 后台线程（模型常驻、任务队列、LRU 缓存）
  -> 原生 ONNX Runtime
  -> Tauri resources 中的本地模型、音色和 Tokenizer
  -> Float32 PCM
  -> 主线程拼接与 PCM16 WAV 导出
```

原方案的 Web Worker/WASM/WebGPU 均已在真实 WKWebView 中验证。Session 可以创建，但真实推理会阻塞整个 Web Content 进程，使宿主 timer 也无法触发，无法实现可靠超时。因此正式实现改为原生 CPU 后台线程；WebGPU 保留为失败的 Technical Spike，不向用户宣称支持。

## 2. V1 基线

| 项目 | 当前状态 |
| --- | --- |
| 发布物 | `release/EnglishReader.html`，约 151 MiB（磁盘占用约 161 MiB） |
| TTS | Kokoro 82M v1.0，`q8`，ONNX Runtime WASM，单线程 |
| 模型 | `model_quantized.onnx` 92,361,116 字节；另有 `model_q8f16.onnx` |
| 音色 | 美式 4 个、英式 2 个，共 6 个本地 `.bin` |
| 资源加载 | 构建时 Base64 内嵌；启动时解码为 Blob；custom cache / fetch adapter 提供给运行时 |
| 执行线程 | 模型初始化和推理均在 UI 主线程 |
| 缓存 | 按文本、音色、速度缓存 Promise，无容量上限 |
| 输出 | 24 kHz、单声道、PCM16 WAV |
| 离线性 | 发布测试确认 `file://` 下 0 个网络请求 |
| 已知压力基线 | 100 个唯一词条约 423.9 秒；Chrome RSS 峰值约 1.96 GiB |
| 已验证平台 | 当前 macOS；V1 Chrome/Edge 风格浏览器自动化 |
| 未验证平台 | Windows 实机、Edge WebView2、U 盘运行、物理断网 |

单 HTML 的主要成本不是只有文件尺寸：Base64 会增加约三分之一的传输体积，启动时还会同时出现 HTML 字符串、解码缓冲、Blob 和模型运行时内存。把资源放回二进制文件不会改变模型本身的推理量，但会显著改善启动解析、内存峰值、可维护性和增量发布体验。

## 3. 直接复用

| 模块 | 文件 | 决策 |
| --- | --- | --- |
| 文本清理 | `src/parser/textParser.ts` | 原样复用；已有序号清理测试 |
| 停顿生成 | `src/audio/silence.ts` | 原样复用 |
| PCM 拼接 | `src/audio/mixer.ts` | 原样复用 |
| WAV 编码 | `src/audio/wav.ts` | 原样复用 |
| 参数与限制 | `src/config/defaults.ts` | 复用，后续只增补 V2 缓存/超时常量 |
| 音色元数据 | `src/tts/voices.ts` | 复用 |
| TTS 抽象 | `src/tts/types.ts` | 复用接口思想，增加 Worker 消息协议 |
| 业务编排 | `src/audio/projectGenerator.ts` | 复用重复、停顿、取消、错误定位逻辑 |
| 现有 UI | `src/app/app.template.html`、`src/ui/styles.css` | V2-1 原样迁入，不做视觉重设计 |
| 设置持久化 | `src/app/main.ts` 中的 localStorage 逻辑 | 复用，存储键升级为 V2 时兼容读取 V1 |
| 单元测试 | `test/parser.test.ts`、`test/audio.test.ts`、`test/projectGenerator.test.ts` | 继续作为回归基线 |
| 本地资源 | `assets/kokoro-v1.0/**` | 作为外部 Tauri resources 的源文件 |

## 4. 需要重构

| 模块 | 当前问题 | V2 处理 |
| --- | --- | --- |
| `src/tts/offlineResources.ts` | 依赖 DOM 中的 Base64 `<script>`，在主线程分块解码，并全局替换 `fetch` | 改为资源清单驱动的本地 URL 映射；只在 TTS Worker 内配置运行时和离线保护 |
| `src/tts/kokoroEngine.ts` | 固定 `q8 + wasm`，模型在 UI 线程初始化 | 拆为 Worker 内部引擎；支持明确的 CPU/GPU 配置、超时、诊断结果和销毁 |
| `src/app/main.ts` | UI、模型生命周期、预览、批量任务揉在一起 | UI 只使用 `TtsWorkerClient`；以状态机驱动按钮、提示和进度 |
| `AudioProjectGenerator` 缓存 | 永不淘汰，长时间使用会持续占用 PCM 内存 | 改成 LRU，先以 128 项为默认值，并在性能报告记录实际占用后决定是否改为字节上限 |
| 构建 | `build-release.mjs` 将模型/WASM/JS 写进 HTML | 新增 V2 Web 资源构建；模型等由 `tauri.conf.json > bundle.resources` 打包 |
| 进度反馈 | 初始化只有一段模糊文案；单条试听只有省略号 | 增加真实阶段、已耗时、任务计数；有足够样本后才显示 ETA，不伪造模型加载百分比 |
| 取消 | 只能在词条边界检查，无法中断正在执行的推理 | 普通取消保留边界语义；卡死/超时通过终止 Worker 保证恢复能力 |
| 日志 | 主要依赖浏览器 console | 增加标准应用日志目录和脱敏诊断；不记录用户输入文本 |

## 5. 退出 V2 发布链路

以下 V1 机制保留用于回归和历史发布，但不进入 V2 桌面发布物：

- `scripts/build-release.mjs` 的 Base64 内嵌流程。
- `release/EnglishReader.html` 单文件发布方式。
- DOM `<script type="application/octet-stream">` 资源容器。
- 主线程中的 Kokoro 模型初始化与推理。
- 依赖 Chrome/Edge 直接打开 `file://` 的最终用户说明。

不会在迁移初期删除这些文件，以便对照功能与回归测试；V2 验收完成后再决定是否归档。

## 6. 资源边界

V2 资源目录约定：

```text
resources/
  resource-manifest.json
  kokoro-v1.0/
    config.json
    tokenizer.json
    tokenizer_config.json
    onnx/
      model_quantized.onnx
    voices/
      *.bin
```

清单至少记录逻辑名、相对路径、字节数、SHA-256、模型 dtype/后端用途。应用启动时只读取清单和必要配置，不预读整个模型。发布构建不得包含 `http://`、`https://` 运行依赖、遥测或自动更新器。

## 7. Tauri 壳与平台约束

- 使用 Tauri 2；开发命令为 `npm run tauri dev`，发布命令为 `npm run tauri build`。
- macOS 使用系统 WKWebView，Windows 使用 Edge WebView2；前端继续使用原生 HTML/CSS/TypeScript。
- 当前开发机是 Apple Silicon (`arm64`) macOS 26.6.2，Xcode 与 macOS SDK 已安装。
- Rust stable 工具链已经安装，Tauri Debug 与 macOS Release 均已成功构建。
- macOS 发布物目标为可直接打开的 `.app`；Windows 目标为便携目录或 Tauri 原生 bundle。跨平台发布必须在对应目标系统或 CI runner 上完成实机验证。
- 未签名 macOS 应用会受到 Gatekeeper 提示，未签名 Windows 程序会受到 SmartScreen 提示；V2 文档必须说明，不将签名问题伪装成运行故障。

## 8. GPU / CPU 决策门

GPU 探索必须在真实 Tauri WKWebView 中执行，而不是只根据浏览器测试推断。依次记录：

1. `navigator.gpu` 是否存在，能否请求 adapter/device。
2. `q8`、`q8f16`，以及仅在资源准备后再测的 `fp16/fp32` 是否能初始化。
3. 首次初始化、首条生成、连续 10 条、峰值内存、失败类型。
4. GPU Worker 10–15 秒无进展时强制终止，CPU Worker 是否能自动接管。

发布门槛是 CPU/WASM 稳定可用，而不是 WebGPU 成功。AMD、NVIDIA、Apple GPU 的实际兼容性由操作系统 WebView、WebGPU 实现、驱动和 ONNX Runtime Web 支持共同决定，不能仅凭“有显卡”承诺兼容。

## 9. 风险清单

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| WKWebView 对 Worker/WebGPU/WASM 行为与 Chrome 不同 | GPU 不可用或模型初始化挂起 | 真实 Tauri 技术验证；Worker 超时销毁；CPU 默认兜底 |
| 资源协议或 CSP 阻止 Worker 获取本地二进制 | 模型无法加载 | V2-2 做最小资源探针；严格限定资源 scope；发布前离线测试 |
| WASM threads 依赖 `crossOriginIsolated` / SharedArrayBuffer | CPU 线程数无法提升 | 启动时能力检测；不满足时回退 SIMD 单线程 |
| 100 项 PCM 缓存与最终 WAV 同时驻留 | 内存峰值高 | LRU、及时释放临时引用、记录字节级性能指标 |
| Tauri `frontendDist` 会把前端静态文件嵌入可执行文件 | 若误放模型会再次膨胀主程序 | 前端 dist 只放 UI/Worker JS；大资源只进入 bundle resources |
| Windows 无法在当前 macOS 上完成最终验证 | Windows 便携包风险未闭环 | 在 Windows runner/实机执行 V2-7 和 V2-10，不以 macOS 结果替代 |

## 10. 分阶段验收

- V2-0：本审计完成；V1 单元测试与发布测试仍通过。
- V2-1：Tauri 2 壳能在当前 macOS 启动并显示现有界面。
- V2-2：外部资源清单可读取；模型、音色、Tokenizer 不再 Base64 内嵌；正式包不再需要 WASM。
- V2-3：Worker 技术路径完成验证但不满足 WKWebView 响应性；初始化和推理最终迁入 Rust 后台线程。
- V2-4：真实阶段、耗时、进度、ETA、取消、重试、LRU 完成。
- V2-5：WKWebView GPU 技术验证和报告完成，不把失败视为发布阻塞。
- V2-6：已知不稳定的 GPU 路径不进入正式启动流程；无 GPU 机器直接使用受支持的原生 CPU 后台路径。
- V2-7：Windows 构建与 WebView2 实机验证。
- V2-8：macOS `.app` 构建、资源路径、中文/空格路径、物理断网验证。
- V2-9：启动、首条、10 条、100 条、内存、包体积形成可复现基准。
- V2-10：双平台完全离线最终验收和发布说明完成。

## 11. V2-0 结论

可以在不重写产品的前提下迁移。优先级是先把 Tauri 壳和资源边界跑通，再移动 TTS 到 Worker；在这两条主链路稳定前，不投入 UI 重做或 q4 模型探索。
