# V2 GPU 技术验证

日期：2026-09-11  
测试机：Mac mini，Apple M4（10 核 CPU），16 GB，macOS 26.6.2，Tauri 2 / WKWebView

## 结论

当前正式版不宣称 GPU 支持。Apple M4 上 `navigator.gpu` 可用，WebGPU Session 也能创建，但 Kokoro 的真实推理会阻塞 WKWebView Web Content 进程，不能满足 UI 流畅与超时回退要求。因此 V2 正式后端是稳定的原生 CPU ONNX Runtime；没有独立显卡也能正常工作。

## 实测结果

| 路径 | 模型 | Session 初始化 | 真实推理 | 结果 |
| --- | --- | ---: | --- | --- |
| Web Worker + WASM CPU | q8 | 约 398 ms | `hello` 后无返回，宿主 UI timer 同时停止 | 失败，不进入发行版 |
| Web Worker + WebGPU | q8f16 | 约 4,986 ms | `hello` 后无返回，15 秒宿主超时也无法触发 | 失败，不进入发行版 |
| Rust 后台线程 + 原生 ONNX CPU | q8 | Debug 初始化后首条成功；Release 模型 Ready 约 0.26 s | `hello` 33,000 samples；可连续运行 | 正式支持 |

GPU 失败不是“显卡算力不够”，而是当前 WKWebView 进程隔离与 ONNX Web 运行行为无法提供可恢复的后台执行。Worker 源码保留作为技术记录，但其脚本和 q8f16/WASM 资产不打进正式包。

## 平台声明

| 平台/GPU | 状态 |
| --- | --- |
| Apple Silicon M4 / WKWebView WebGPU | Session 可建，真实 Kokoro 推理不可用 |
| Apple M1/M2/M3 | Not Tested |
| Intel Mac | Not Tested |
| Windows Intel 核显 | Not Tested |
| Windows NVIDIA | Not Tested |
| Windows AMD | Not Tested |

不能由 M4 的结果推断 A 卡、N 卡或其它 M 系列已兼容。未来若 ONNX Runtime Web/WKWebView 的可中断性发生变化，应重新运行真实文本和超时恢复测试，而不是只检查 `navigator.gpu` 或 Session 初始化。

## 回退策略

GPU 技术验证没有达到发布门，因此正式版启动时直接使用原生 CPU，不让普通用户经历一次已知会挂起的 GPU 尝试。UI 显示“原生 CPU · 后台线程”；这相当于稳定兼容模式，不依赖独立显卡。

