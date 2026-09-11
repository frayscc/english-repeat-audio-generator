# V2 测试记录

日期：2026-09-11

## 自动测试

| 检查 | 结果 |
| --- | --- |
| TypeScript 类型检查 | Pass |
| V1 文本解析、音频拼接、WAV、缓存回归（13 tests） | Pass |
| V2 HTML 无 Base64 资源 | Pass |
| V2 清单 10 个文件的大小与 SHA-256 | Pass |
| V2 前端不包含 Hugging Face/CDN/onnxruntime-web 标记 | Pass |
| Rust `cargo check` | Pass |
| Tauri Debug 启动 | Pass |
| 原生 q8 Session 初始化 | Pass |
| eSpeak NG 美式/英式音素回归 | Pass |
| 真实 `hello` 合成（33,000 samples） | Pass |
| macOS `.app` Release 构建 | Pass |
| 从 `.app` 内部 Resources 初始化 | Pass |

## 平台矩阵

| 测试 | macOS Apple M4 | Windows x64 |
| --- | --- | --- |
| 应用启动 | Pass | Not Tested |
| 完全本地资源 | Pass（静态策略、包内容及启动期 socket 审计） | Not Tested |
| 模型初始化 | Pass | Not Tested |
| 原生 CPU TTS | Pass | Not Tested |
| WebGPU 检测/Session | Pass | Not Tested |
| WebGPU 真实推理 | Fail，已从发行路径移除 | Not Tested |
| 无 GPU CPU 路径 | Pass | Not Tested |
| 单条试听底层链路 | Pass | Not Tested |
| LRU 与取消队列单元测试 | Pass | Not Tested |
| 6 个 Voice 后端合成 | Pass（修复后真实烟测） | Not Tested |
| Voice 切换 UI | 待人工完成 | Not Tested |
| 100 条生成 | 100 个唯一常用单词 Release 基准 Pass | Not Tested |
| WAV 导出 | 编码回归 Pass；V2 UI 待人工完成 | Not Tested |
| 物理断网 | 待人工完成 | Not Tested |

## 已发现并修复

1. WKWebView Web Worker 的 ONNX 推理会连宿主 timer 一起阻塞：正式路径迁到 Rust 后台线程。
2. Emscripten phonemizer 在 WKWebView 挂起：G2P 迁移到 Rust 内置 eSpeak NG，不依赖 WebView 或网络。
3. Rust 通用 tokenizers 库不能解析现有 JSON 的 PostProcessor：按 Kokoro 实际字符词表实现 115 项轻量 tokenizer。
4. Tauri Debug 和 Release 的 raw IPC 返回类型不同：前端同时接受 `ArrayBuffer` 与 `Uint8Array`。
5. 旧 V2 构建目录残留 Worker sourcemap：构建前清理精确输出目录。
6. 临时纯 JavaScript G2P 会产生 Kokoro 词表不支持的 `ɫ`、`ɝ` 等音素，并改变重音，导致英语出现明显异域口音：已移除该路径，恢复与 V1 phonemizer 一致的美式/英式音素输出；单元测试固定验证 `hello teacher water`。

补充发行验证：修复后六个 Voice 对 `hello` 的真实合成全部通过，合计 199,800 samples / 3.819 s（Debug）；Release 启动日志确认 eSpeak NG 0.2.0 ready。Release 初始化期间 `lsof` 未发现 TCP/UDP socket；macOS 分享 ZIP 已通过完整性测试。

## 尚未满足的最终验收

- Windows 便携目录构建与 WebView2 实机测试。
- macOS 六个 Voice 的逐个 UI 试听、完整 100 条 UI 生成和导出点击流程（后端六音色已经通过）。
- macOS 物理断网抓包确认 0 请求。
- 未签名包在另一台干净 Apple Silicon Mac 上的复制/首次打开验证。

以上项目保持 `Not Tested`，不以当前开发机结果代替。
