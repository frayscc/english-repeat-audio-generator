# EnglishReader V2 阶段汇报

日期：2026-09-11

## V1 → V2

```text
151 MiB 单 HTML + Base64 模型/WASM + UI 线程推理
  ↓
Tauri 2 桌面应用 + 结构化原始资源 + Rust 后台 ONNX 推理
```

复用了 V1 的界面、解析、参数、6 个音色、音频拼接、WAV 编码、生成队列和回归测试。没有重做视觉设计，也没有更换 Kokoro 82M 模型。

## 已完成

- Tauri 2 应用壳，`npm run tauri dev` 可启动现有 UI。
- 10 个正式本地资源及 SHA-256 清单；HTML 不含 Base64。
- 应用启动后自动初始化，模型与 Session 每个生命周期只创建一次。
- 原生 CPU 推理放入 Rust 后台线程，UI 不承担 ONNX 计算。
- Rust 内置 eSpeak NG 英语 G2P，美式/英式发音与 V1 phonemizer 对齐，完全离线。
- 初始化阶段/已用时、试听生成/播放状态、批量真实进度、3 条后 ETA、取消和重试。
- 前端 LRU + 原生 128 项/256 MiB LRU。
- 标准 Tauri 日志目录、2 MB 上限；不记录用户文本。
- macOS arm64 `.app` 构建完成。
- Windows x64 portable 构建脚本完成，等待 Windows 主机执行与实测。

## macOS 实测

测试机：Mac mini，Apple M4，16 GB，macOS 26.6.2。

| 项目 | 结果 |
| --- | --- |
| Build | Pass |
| 产物 | `release-v2/macos-arm64/EnglishReader-macOS-arm64.zip` |
| 大小 | 约 128 MiB |
| TTS Ready | Release 约 0.26 s |
| `environment` | 0.82 s |
| `protect the environment` | 0.96 s |
| 50 个唯一常用单词 | 58.45 s |
| 100 个唯一常用单词 | 209.67 s |
| 内存 | 完成后约 401 MiB；观测峰值约 458 MiB |
| 6 个 Voice | 发音修复后后端真实合成 Pass，合计 199,800 samples / 3.819 s（Debug） |
| CPU fallback | 正式 CPU 路径 Pass |
| 启动期网络 socket | 0 |

分享 ZIP 约 74 MiB（逻辑大小），SHA-256 为 `b8398f501249c4705f108ebd88f86c1a5e96554a4a5259ece70f24a477ceb6b7`，完整性测试通过。应用为 arm64 ad-hoc/linker-signed，未使用 Developer ID 签名。

V1 的已知基线为 100 项约 423.9 秒、Chrome RSS 约 1.96 GiB。词表不完全相同，因此速度只可表述为同类压力测试约快一倍；内存改善更明确。

## GPU 结论

Apple M4 的 WKWebView 能发现 WebGPU，也能为 q8f16 创建 Session（约 4.99 s），但真实推理会阻塞整个 Web Content 进程；WASM Worker q8 也有同样问题。为保证软件可用，正式版不尝试这条已知会挂起的路径，直接使用原生 CPU。AMD、NVIDIA、其它 Apple 芯片均保持 `Not Tested`。

## Windows

当前 macOS 主机不能生成并诚实验证 Windows 便携包。已提供 `npm run build:windows-portable`，目标产物为：

```text
release-v2/EnglishReader-Windows-x64/
  EnglishReader.exe
  resources/
```

仍需 Windows x64 实机验证 WebView2、启动、六音色、100 条、WAV 导出、物理断网和 SmartScreen 行为。

## 测试结果

- Rust：3/3 Pass（含美式/英式精确音素回归）。
- TypeScript/JavaScript：13/13 Pass。
- V2 资源/离线静态验收：Pass。
- Release `.app` 从包内资源启动与初始化：Pass。
- 发行版二进制 IPC 首条合成差异已修复（同时支持 `ArrayBuffer` / `Uint8Array`）。

## 已知限制

- Windows 与 Intel Mac 尚未实测。
- 当前 macOS 包未签名、未 notarize，异机首次打开可能出现 Gatekeeper 提示。
- 物理断网抓包、V2 GUI 六音色逐个点击与 GUI WAV 导出仍需最终人工验收。
- GPU 不在 V2 正式支持范围；这是基于真实失败结果的明确选择，不是自动降级成功的宣称。
