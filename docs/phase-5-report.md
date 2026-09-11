# Phase 5 验收报告

更新日期：2026-09-11

## 结论

V1 已在当前可用的 macOS Chrome 环境完成自动化验收并产出正式发行文件。Windows Edge/Chrome、物理断网、Windows 盘符路径和 U 盘仍缺少对应硬件环境，因此最终跨平台 Gate 状态为“macOS Chrome 通过，Windows 待实机复核”。

## 环境

- Google Chrome 153.0.8010.36
- macOS
- `file://`
- Playwright browser offline context
- HTTP/HTTPS 路由全量记录并阻断

## 离线与路径

| 项目 | 结果 |
| --- | --- |
| 正式 release 单文件启动 | 通过 |
| HTTP/HTTPS 请求 | 0 |
| 远程模型 | 强制关闭 |
| CSP 网络 connect | 仅 Blob/Data |
| 中文路径 | 通过：`.cache/教学资料/英语跟读工具/` |
| 带空格路径 | 通过：`.cache/My Teaching Tools/English Reader/` |
| 物理断开 Wi-Fi/Ethernet | 未执行；使用浏览器离线模式替代 |
| U 盘 | 无可用环境，未执行 |

## 文本与音频

- 任务给定的 5 种序号格式：通过。
- `don't`、`I'm`、`I'd like to`、`mother-in-law`、`U.S.`、`Mr. Smith`、`How are you?`：7/7 正确预览。
- 重复 1 次：1.675 秒。
- 重复 2 次：4.55 秒，严格等于 `1.675 × 2 + 1.2`。
- 重复 3 次：7.425 秒，严格等于 `1.675 × 3 + 1.2 × 2`。
- 同词间隔由 1.2 调到 2.2 秒后，总时长由 4.55 增加到 5.55 秒。
- 连续修改文本并生成 5 次：通过，无需刷新。

## 100 条压力测试

- 内容：混合单词式条目、短语和短句，100 条唯一文本。
- 重复：2 次。
- 实际 TTS：100 条，cache hit 0。
- 完成进度：100 / 100。
- 耗时：423,853 ms（约 7 分 4 秒）。
- 输出：21,200,400 samples、24 kHz、883.35 秒。
- WAV：42,400,844 bytes，等于 `sampleCount × 2 + 44`。
- HTMLAudioElement：可解析，时长 883.35 秒。
- Chrome 全进程 RSS：初始化采样 1,959.2 MiB；压力阶段最高采样 1,583.5 MiB；完成后 1,583.8 MiB。初始化采样是本轮观测到的总峰值，包含浏览器多进程、HTML Base64 文本、WASM 和模型内存。
- HTTP/HTTPS 请求：0。

## GPU 与兼容模式

- WASM 单线程兼容模式：通过全部验收。
- `navigator.gpu` 在当前 Chrome 可见。
- WebGPU q8 实验进入初始化后超过 90 秒仍未完成，因此中止，没有纳入正式发行。
- 按“稳定 > 生成速度”的产品原则，V1 固定使用兼容模式。UI 不虚假显示 GPU 加速。
- WebGPU 自动回退如果在同一 JS realm 内发生 ONNX Session 初始化失败，可能被上游 session promise 污染；在没有 Worker 隔离实现前不贸然启用。

## 测试数量

- strict TypeScript：通过。
- 单元/结构测试：13 项，通过 13，失败 0。
- 浏览器专项脚本：Phase 0、Phase 1、Phase 2、Phase 3、release、acceptance 共 6 套。
- 最终 acceptance 详细机器数据：`artifacts/phase5-acceptance.json`。

## 尚未完成的外部环境验收

- Windows 最新稳定版 Chrome。
- Windows 最新稳定版 Edge。
- Windows Media Player / Media Player。
- macOS QuickTime 人工播放（浏览器播放器已通过）。
- 物理断网和人工 DevTools Network 复核。
- U 盘直接运行。
- 六个音色的教师人工听感评分。

这些限制不影响当前 macOS Chrome 发行物的已验证功能，但在对学校 Windows 电脑正式分发前应补齐。
