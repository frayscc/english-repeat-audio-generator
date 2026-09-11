# 架构说明

## 分层

```text
UI
  ↓
AudioProjectGenerator
  ├─ Text Parser
  ├─ TTSEngine / KokoroEngine
  ├─ Task Cache
  ├─ Silence + Mixer
  └─ PCM16 WAV Encoder
```

UI 不直接调用 Kokoro API。`TTSEngine` 屏蔽模型实现，`AudioProjectGenerator` 负责缓存、重复和停顿编排，音频模块只处理 Float32 PCM。

## 离线资源

构建脚本把 ONNX、Tokenizer、Voice、ONNX Runtime WASM 和 JavaScript 写入单个 HTML。运行时将 Base64 分块解码为 Blob；模型文件通过 Transformers.js custom cache 返回，Voice loader 由本地 fetch adapter 接管。远程模型、浏览器模型缓存和 HTTP/HTTPS fetch 均被禁用。

WASM 使用单线程兼容模式，避免 `file://` 缺少跨源隔离时的 Worker 限制。采样率保持 Kokoro 原始 24 kHz，不做无意义重采样。
