# 英语跟读音频生成器

面向英语教师和学习者的完全离线英语 TTS 与 WAV 生成工具。当前主线是 V2 桌面版：Tauri 2 界面、Kokoro 82M q8、本地 eSpeak NG 美式/英式音素转换和原生 ONNX Runtime CPU 推理。

## V2 当前状态

- macOS Apple Silicon 便携版已构建并实测。
- Windows x64 便携版由 GitHub Actions 在 Windows runner 上构建。
- 六个本地音色、试听、批量生成、真实进度、取消、缓存和 WAV 导出。
- 模型、词典和音色全部随包提供；运行时无需网络、账号、Node.js 或 Python。
- 正式后端为 CPU；GPU 暂不作为 V2 支持范围。

## 本地开发

```text
npm ci
npm run typecheck
npm test
npm run build:v2
npm run test:v2
npm run tauri dev
```

macOS 应用构建：

```text
npm run tauri build -- --bundles app
```

Windows x64 便携目录必须在 Windows 主机运行：

```text
npm run build:windows-portable
```

## GitHub 构建 Windows 版

在仓库的 **Actions → Build Windows portable → Run workflow** 手动启动。工作流会执行类型检查、JavaScript/Rust 测试、V2 离线资源检查和 Release 构建，最终提供：

```text
EnglishReader-Windows-x64.zip
SHA256SUMS.txt
```

下载并解压后运行 `EnglishReader.exe`。目标电脑需要可用的 Microsoft Edge WebView2 Runtime；Windows 11 通常已包含，但仍应在目标机实际确认。

## V1 如何保留

V1 不删除，但降级为历史基线：

- `src/phase0`、`src/phase1`、V1 构建脚本、测试和 `docs/phase-*` 报告继续纳入版本控制。
- 151 MB 单文件 HTML、阶段生成物、重复模型和发布压缩包只保留在本地或 GitHub Releases，不提交到 Git 历史。
- V1 的实验 q8f16 模型不入库；V2 构建只使用 `assets/kokoro-v1.0/onnx/model_quantized.onnx`。

这种方式保留了可追溯性和回归依据，同时避免仓库因重复二进制膨胀到近 1 GB。

## 文档与许可

- V2 架构与测试记录位于 `docs/v2-*.md`。
- 第三方组件许可见 `THIRD_PARTY_LICENSES.md` 和 `licenses/`。
- 项目源码按 GPL-3.0 许可证发布，完整条款见 `LICENSE`。
