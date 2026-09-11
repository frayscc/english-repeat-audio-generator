# EnglishReader V2 架构

日期：2026-09-11

## 最终运行链路

```text
Tauri 2 WebView（现有 UI）
  ├─ 文本解析、设置、真实任务进度、WAV 导出
  └─ 将标准化英文通过 Tauri binary IPC 发送给 Rust
       └─ Rust 后台阻塞线程
            ├─ 内置 eSpeak NG 0.2.0 英语 G2P（美式/英式）
            ├─ 常驻 ONNX Runtime Session（4 线程上限）
            ├─ Kokoro q8 模型
            ├─ 6 个按需加载并常驻的 Voice
            └─ 128 项 / 256 MiB 双上限 LRU PCM 缓存
```

模型推理不在 UI 主线程，也不在 WKWebView 的 Web Worker 中。实测表明，WKWebView 里的 ONNX WebAssembly/WebGPU Worker 在执行 Kokoro 推理时会阻塞整个 Web Content 进程，连 UI 定时器都无法运行；因此正式路径改为 Tauri 原生后台线程。它保留了“后台推理、UI 可响应”的产品要求，同时消除了 WebView Worker 共享进程导致的假隔离。

## 生命周期

1. 窗口先显示，UI 立即可输入和调整设置。
2. 启动时自动调用 `initialize_native_tts`，不等第一次试听。
3. Rust 后台线程从应用 Resources 读取 q8 模型并创建一次 ONNX Session。
4. Session 在整个应用生命周期常驻；切换文本、Voice 或速度不会重建。
5. Voice 第一次使用时加载，此后驻留内存。
6. 退出应用时释放 Session、Voice 和缓存。

## 资源边界

正式资源源目录是 `resources-release/`，构建后位于：

```text
English Reader.app/Contents/Resources/resources/
  resource-manifest.json
  kokoro-v1.0/
    config.json
    tokenizer.json
    tokenizer_config.json
    onnx/model_quantized.onnx
    voices/*.bin
```

正式包不含 q8f16、ONNX Runtime Web 的 JavaScript/WASM 或实验 Worker。实验资产仍留在源码 `assets/` 与开发记录中，不进入用户包。HTML 只负责 UI，不包含 Base64 二进制。

## 离线与隐私

- Tauri CSP 不允许外部 HTTP/HTTPS 连接。
- 模型、eSpeak NG 英语 G2P 数据、音色、图标、CSS、JavaScript 均随包发布。
- 没有 CDN、遥测、更新服务、账号或云 TTS。
- 日志和基准只记录阶段、耗时、后端及错误，不记录用户输入文本。

## 状态与进度

初始化使用阶段状态和真实已用时，不伪造百分比。批量生成使用真实完成数 `completed / total`；完成至少 3 条后按已完成项目的平均耗时估算 ETA。取消在当前单条推理完成后停止剩余队列。

## 缓存

前端项目缓存按 `text + voice + speed` 保存最近 16 项，减少 IPC 与转换；原生缓存保存最近 128 项 PCM，同时限制为 256 MiB。两层都采用 LRU，失败结果不会进入缓存。

## 构建

- 开发：`npm run tauri dev`
- 前端与资源校验：`npm run build:v2 && npm run test:v2`
- macOS 应用：`npm run tauri build -- --bundles app`
- Windows 便携版必须在 Windows x64 主机或 CI 上构建和实测；macOS 不能诚实替代 WebView2/Windows 验收。
