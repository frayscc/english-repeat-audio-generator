# 英语跟读音频生成器 V1 最终报告

更新日期：2026-09-11

## 1. 最终架构

- TTS：Kokoro-82M-v1.0-ONNX。
- 量化：`model_quantized.onnx` q8，92,361,116 bytes；q8f16 已对比通过，但等待 Windows 兼容验证。
- 运行库：kokoro-js 1.2.1、Transformers.js 3.8.1、ONNX Runtime Web 1.22 开发构建。
- 推理：WASM 单线程兼容模式。WebGPU q8 初始化实验超过 90 秒，因此 V1 未启用。
- 内嵌：构建时 Base64；运行时 4 MiB 分块解码为 Blob；模型通过 custom cache 交给 Transformers.js。
- 音频：Float32 PCM 内部拼接，按 sample 生成停顿，导出 PCM16、Mono、24 kHz WAV。
- 分层：Parser → TTSEngine → task cache → silence/mixer → WAV encoder → UI。

## 2. 发行文件

```text
release/
├── EnglishReader.html          158,426,781 bytes
├── README.txt                  614 bytes
└── THIRD_PARTY_LICENSES.txt    13,977 bytes
```

`EnglishReader.html` 是唯一运行文件。SHA-256：`ef40eb5801be49f832632545cd4096ad244c0e255ecce1db5dd4fa312a140784`。

## 3. 浏览器兼容性

| 环境 | 结果 |
| --- | --- |
| macOS Chrome 153 | Phase 0～5 自动化通过 |
| macOS Edge | 未安装，未测试 |
| Windows Chrome | 无环境，待实机测试 |
| Windows Edge | 无环境，待实机测试 |

## 4. 离线验证

- `file://`：通过。
- Playwright browser offline context：通过。
- HTTP/HTTPS 请求记录：0。
- 正式 bundle 网络依赖标记扫描：通过。
- 中文路径和带空格路径：macOS `file://` 通过。
- 物理关闭 Wi-Fi/Ethernet：未执行。

## 5. 性能

- Phase 0 模型初始化：约 0.95～1.0 秒。
- 单词首次生成：约 2.5～2.6 秒。
- 已缓存完整双词条任务：约 4 ms。
- 100 条唯一混合任务：423.853 秒。
- 100 条输出：883.35 秒 WAV，42,400,844 bytes。
- Chrome 全进程观测峰值：约 1,959.2 MiB。
- 最终 HTML：151.1 MiB（二进制 158,426,781 bytes）。

## 6. 已知限制

- V1 为 WASM 单线程，推理期间页面交互可能短暂变慢。
- 取消在当前单条推理完成后生效，不能中断正在执行的 ONNX 调用。
- WebGPU 未纳入发行。
- 100 条在当前机器耗时约 7 分钟，教师日常建议按单元分批生成。
- 完整 HTML 解码和模型初始化的浏览器多进程峰值约 2 GB，8 GB 电脑可合理运行但不宜同时打开多个副本。
- Windows、Edge、播放器、物理断网和 U 盘仍需目标机人工验收。
- 六个音色需教师完成人工听感评分。
- npm 生产依赖审计报告的 high 来自 Node-only `sharp/libvips/libheif` 传递链；浏览器 TTS bundle 不包含或调用其原生路径，但仍保留升级复核项。

## 7. 自动测试

- strict TypeScript：通过。
- 单元/结构测试：13，通过 13，失败 0。
- 浏览器专项测试：6 套（Phase 0、Phase 1、Phase 2、Phase 3、release、acceptance）。
- 100 条压力测试：通过。
- 连续生成 5 次：通过。
- 重复次数、停顿数学、WAV Header、缓存、取消和错误恢复：通过。
