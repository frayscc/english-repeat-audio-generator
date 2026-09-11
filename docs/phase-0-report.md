# Phase 0 技术可行性报告

更新日期：2026-09-11

## 当前结论

核心可行性已在 macOS Chrome 153 中实测通过：单个本地 HTML 可在 `file://` 协议下，从页面内嵌资源初始化 Kokoro，并生成、播放 `environment` 的 WAV。测试浏览器被设为离线模式，同时对 HTTP/HTTPS 请求进行拦截和记录，结果为 0 个请求。

Phase 0 Gate 尚未完整关闭。当前机器没有 Microsoft Edge，也没有 Windows 环境，因此 Windows Chrome、Windows Edge、中文 Windows 路径以及物理断网测试仍待目标机验收。按任务约束，在这些 Gate 项完成前不进入 Phase 1。

## 技术选择

| 项目 | 当前决定 |
| --- | --- |
| TTS | Kokoro-82M-v1.0-ONNX，仓库版本 `1939ad2a8e416c0acfeecc08a694d14ef25f2231` |
| JavaScript 库 | `kokoro-js` 1.2.1、Transformers.js 3.8.1、ONNX Runtime Web 1.22 开发构建（随 Transformers.js 锁定） |
| 默认模型 | `model_quantized.onnx`（q8），92,361,116 bytes |
| 对比模型 | `model_q8f16.onnx`，86,033,585 bytes |
| 音色 | `af_heart`，522,240 bytes |
| 音频 | 24 kHz、单声道 WAV；`environment` 输出 40,200 samples / 1.675 s |
| 运行模式 | WASM 单线程兼容模式；Phase 0 未启用 Worker |
| 单文件方式 | 构建时 Base64 内嵌，运行时分块解码为 Blob；模型通过内存 Cache 交给 Transformers.js |
| 网络保护 | 关闭远程模型和浏览器缓存；拦截硬编码音色 URL；CSP 禁止 HTTP/HTTPS connect |

## q8 与 q8f16 实测

同一台机器、同一 Chrome 153 headless 环境，各运行两次 `environment`：

| 模型 | 单 HTML 大小 | 初始化 | 第一次生成 | 第二次生成 | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| q8 | 147.7 MiB | 958 ms | 2,588 ms | 2,454 ms | 通过 |
| q8f16 | 139.7 MiB | 1,406 ms | 2,561 ms | 2,488 ms | 通过 |

两者输出样本数、采样率和时长一致。q8f16 可减少约 8 MiB 的最终 HTML，但它需要在更多 Windows CPU/浏览器组合上验证后才能替换兼容性更稳妥的 q8，所以 Phase 0 默认产物暂用 q8。

说明：Transformers.js 3.8.1 的公开 dtype 参数不接受 `q8f16` 名称。对比测试使用 `q8` 模型加载路径，将该路径对应的内嵌 ONNX 数据替换为官方 `model_q8f16.onnx`；ONNX Runtime 能正常建立会话并推理。

## file:// 能力验证

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| JS bundle | 通过 | esbuild 输出单个 classic IIFE，避免外部 ES Module 入口 |
| WASM | 通过 | Emscripten 模块与 21.6 MB WASM 均内嵌并转换为 Blob URL |
| ONNX 模型 | 通过 | 内嵌模型由自定义内存 Cache 返回，不 fetch 本地文件 |
| Voice | 通过 | 拦截 `kokoro-js` 的硬编码 URL并返回内嵌 `af_heart` |
| Worker | 不使用 | WASM `numThreads = 1`，避免 file origin 和跨源隔离问题 |
| WebGPU | 未作为 Gate 验证 | `navigator.gpu` 可见；Phase 0 以兼容性优先验证 WASM fallback |
| WASM fallback | 通过 | `device: wasm` 完成真实推理 |
| 音频播放 | 通过 | 浏览器解析 Blob WAV，播放器时长为 1.675 s |

## Chrome 测试记录

- 浏览器：Google Chrome 153.0.8010.36（macOS）。
- 协议：`file:`。
- 浏览器网络：Playwright context offline。
- HTTP/HTTPS 请求记录：0。
- 远程模型开关：关闭。
- 初始化：成功。
- 第一次单词生成：成功。
- 后续生成：成功。
- JS Heap（不包含 WASM 线性内存和浏览器原生内存）：页面加载后 3.5 MiB，初始化后 6.4 MiB，生成后 9.2 MiB。
- 自动音频校验：40,200 samples、24,000 Hz、HTMLAudioElement duration 1.675 s。

## Edge 测试记录

未执行：当前 macOS 开发机未安装 Microsoft Edge。Chromium 代码同源不能替代 Edge 产品验收，因此不标记通过。

## 已发现并解决的问题

1. `kokoro-js` 的浏览器 Voice loader 硬编码 Hugging Face URL。解决：在网络层只允许命中内嵌 voice，任何 HTTP/HTTPS fetch 直接抛错。
2. Transformers.js 默认把 ONNX Runtime WASM 指向 jsDelivr。解决：显式提供内嵌 WASM module 和 binary 的 Blob URL。
3. `file://` 不能可靠 fetch 相邻 ONNX、JSON、WASM 文件。解决：所有二进制资源内嵌，模型走自定义 Cache，不读取相邻文件。
4. ONNX Runtime 1.22 的 `wasmPaths` 对象键名是 `mjs` / `wasm`，不是文件名。已按运行库源码修正。
5. CSP 最初阻止 Blob fetch 和 WebAssembly 编译。解决：仅放开 `blob:`、`data:` 和 `wasm-unsafe-eval`，没有放开 HTTP/HTTPS connect。
6. 浏览器 CacheStorage 在 `file://` 下不可靠。解决：关闭 browser cache，改用页面生命周期内的内存 Cache。

## 尚待 Gate 项

- Windows 最新稳定版 Chrome 实机双击验证。
- Windows 最新稳定版 Edge 实机双击验证。
- 物理断网测试及 DevTools Network 人工复核。
- Windows 中文路径、带空格路径测试。
- WebGPU 路径验证；WASM 已通过。
- 使用任务给定词表进行音色人工听感评分。
- 使用浏览器任务管理器或操作系统工具记录包含 WASM/原生内存的完整峰值。

## 依赖审计说明

`npm audit --omit=dev` 报告 3 个 high，传递链为 `kokoro-js -> @huggingface/transformers -> sharp/libvips/libheif`。`sharp` 是 Node 图像处理依赖，本 Phase 0 的浏览器 TTS bundle 不调用或打包其原生运行库；仍需在正式发布前复核 Transformers.js 的升级版本及锁文件，不能仅因当前功能路径不触发就忽略审计记录。

## 复现

```text
npm run build:phase0
npm test
npm run test:phase0
```

q8f16 对比构建：

```text
PHASE0_DTYPE=q8f16 PHASE0_OUTPUT=test-q8f16.html node scripts/build-phase0.mjs
PHASE0_INPUT=test-q8f16.html node scripts/test-phase0.mjs
```

## 最终技术决定（Phase 0 当前）

“单 HTML + file:// + 完全本地 Kokoro WASM 推理”在 Chrome 上技术可行。正式架构应保留内嵌资源、内存 Cache、单线程 WASM fallback 和强制禁网保护；q8 为当前兼容性基线，q8f16 为待 Windows 验证的体积优化候选。Phase 1 暂不启动，等待补齐 Windows Edge/Chrome Gate。
