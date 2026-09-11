# 发布说明

## 构建

```text
npm install
npm run typecheck
npm test
npm run build:release
npm run test:release
```

正式构建关闭 source map，把 JavaScript、CSS、Kokoro q8 ONNX、Tokenizer、6 个 Voice 和 ONNX Runtime WASM 内嵌到 `release/EnglishReader.html`。

构建会扫描运行 bundle，禁止 HTTP/HTTPS URL、jsDelivr、unpkg、Hugging Face 在线域名、GitHub Raw 和 Google Fonts。上游运行库中不可达的文档/默认 URL 会被改写为 `offline://`，应用同时在运行时关闭远程模型并阻止网络 fetch。

## 发行目录

```text
release/
├── EnglishReader.html
├── README.txt
└── THIRD_PARTY_LICENSES.txt
```

只有 `EnglishReader.html` 是运行所需文件；其余两个文件仅提供使用说明和许可证。

当前 V1 正式文件：158,426,781 bytes，SHA-256 `ef40eb5801be49f832632545cd4096ad244c0e255ecce1db5dd4fa312a140784`。

## 发布前人工验收

请按 `docs/testing.md` 在 Windows Chrome 和 Edge、物理断网、中文路径、空格路径及移动存储环境完成最终验收。
