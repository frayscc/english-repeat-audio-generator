# V2 发布说明

日期：2026-09-11

## macOS

构建产物：`src-tauri/target/release/bundle/macos/English Reader.app`  
可分享压缩包：`release-v2/macos-arm64/EnglishReader-macOS-arm64.zip`

- 架构：arm64（Apple Silicon）
- 应用包大小：约 128 MiB；ZIP 文件约 74 MiB（逻辑大小）
- 应用内正式资源：约 91 MiB
- 主程序：约 37 MiB，包含原生 ONNX Runtime
- 使用：复制完整 `.app`，双击打开；不需要 Node.js、Python、Docker、模型目录或网络。

当前是 ad-hoc/linker-signed 测试包，没有 Developer ID 和 notarization。其他 Mac 第一次打开时可能被 Gatekeeper 阻止，可在系统设置的“隐私与安全性”中确认打开；这不是 TTS 初始化故障。对外正式分发前建议完成 Developer ID 签名和 notarization。

ZIP SHA-256：`b8398f501249c4705f108ebd88f86c1a5e96554a4a5259ece70f24a477ceb6b7`。压缩包已经通过完整性测试。本包已经包含 2026-09-11 的美式/英式发音修复。

最低目标是 Apple Silicon。Intel macOS 尚未构建或测试。

## Windows

Windows x64 便携包尚未构建，因为当前只有 macOS 构建环境。在 Windows x64 主机运行 `npm run build:windows-portable`，脚本会执行无安装器构建并产生 `release-v2/EnglishReader-Windows-x64/EnglishReader.exe + resources/`。必须随后在 Windows 主机上验证 WebView2 Runtime、完全断网、Voice、100 条生成与 WAV 导出。

Windows 11 通常带有 WebView2 Runtime，但不能据此承诺所有旧 Windows 10 机器都有。首版应在发布说明中列出 WebView2 前置条件；未签名 `.exe` 也可能触发 SmartScreen。

## 发布前命令

```text
npm ci
npm run typecheck
npm test
npm run build:v2
npm run test:v2
npm run tauri build -- --bundles app
```

正式构建后检查 Resources 内只有清单列出的 10 个资源，并在物理断网条件下完成一次启动、试听、批量生成和 WAV 导出。
