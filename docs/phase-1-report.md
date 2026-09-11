# Phase 1 核心音频引擎报告

更新日期：2026-09-11

## Gate 结论

Phase 1 Gate 已在 macOS Chrome 153 的 `file://`、浏览器离线模式下通过。两个独立词条均由真实 Kokoro 推理生成，重复两次后插入 1.2 秒同词间隔和 2 秒词条间隔，合并为可由 HTMLAudioElement 读取的 PCM16 单声道 WAV。

## 已完成

- strict TypeScript 工程配置。
- `TTSEngine`、`AudioData`、`VoiceProfile` 统一接口。
- Kokoro v1.0 q8 WASM engine adapter。
- 数字、括号数字、带圈数字和中文数字序号清洗。
- 保留英文大小写、标点、撇号和连字符。
- 以 `text + voice + speed` 为 key 的任务级 Promise Cache。
- 精确到 sample 的静音生成和音频拼接。
- 最后条目后不添加词条间隔。
- PCM 16-bit / mono / 24 kHz WAV 编码。
- 参数范围校验。
- `phase1.html` 最小真实闭环验证页。

## 自动测试

单元/结构测试 11 项全部通过，覆盖 parser、silence、拼接顺序、采样率不一致、repeat、总时长、尾部停顿、cache、cache key、参数范围和 WAV header。

## 浏览器 Gate 记录

| 项目 | 结果 |
| --- | --- |
| 协议 | `file:` |
| 浏览器 | Chrome 153.0.8010.36 |
| HTTP/HTTPS 请求 | 0 |
| 模型初始化 | 849 ms |
| 输入 | `environment`、`protect the environment` |
| 首次生成 | 5,830 ms；2 次真实 TTS |
| 第二次生成 | 4 ms；2/2 cache hit，0 次新 TTS |
| 输出 | 289,200 samples / 24 kHz / 12.05 s |
| WAV | 578,444 bytes，等于 `sampleCount * 2 + 44` |
| 播放器读取时长 | 12.05 s |

## 数学时长测试

Mock TTS 返回两个各 1 秒的音频，重复 2 次、同词间隔 1 秒、词条间隔 2 秒：

```text
1 + 1 + 1 + 2 + 1 + 1 + 1 = 8 秒
```

测试输出严格为 8 秒，没有尾部词条间隔。

## 产物

- `phase1.html`：147.7 MiB 单文件验证页。
- `src/parser/textParser.ts`
- `src/audio/silence.ts`
- `src/audio/mixer.ts`
- `src/audio/projectGenerator.ts`
- `src/audio/wav.ts`
- `src/tts/kokoroEngine.ts`
- `src/tts/offlineResources.ts`

## 已知限制

- Phase 1 只内嵌 `af_heart`，正式多音色在后续 Phase 接入。
- 当前串行推理且没有进度、取消和单条失败恢复；属于 Phase 3 范围。
- Windows Edge/Chrome 实机验收仍需目标机完成。
