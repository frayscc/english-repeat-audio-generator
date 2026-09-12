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

ZIP SHA-256：`96b258c2237801517c826dc048417fc40e2e6d6f91c481888eb392aa9a2ae6ae`。压缩包已经通过完整性测试。本包包含美式/英式发音修复及 GPL/第三方许可文件。

最低目标是 Apple Silicon。Intel macOS 尚未构建或测试。

## Windows

Windows x64 便携包已由 GitHub Actions 构建，包含 `EnglishReader.exe + DirectML.dll + resources/ + 许可文件`。ZIP 约 81 MiB，SHA-256：`61ba05d39d73c809c43081c7fed0b20888eeed4e4df9a9e8828218c5fd71f09b`。云端自动启动测试确认 ONNX Session、Tokenizer 与 eSpeak NG phonemizer 全部 ready。

2026-09-12 后的构建使用原生“另存为”对话框和原生文件写入导出 WAV，修复 Windows WebView2 中 `blob:` 下载无响应的问题。音频控件内建的浏览器下载菜单已隐藏，请使用界面右侧“导出 WAV”按钮。

仍需在实体 Windows 机器验证完全断网、六个 Voice 的真实播放、100 条生成、WAV 导出和 SmartScreen 行为。

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
