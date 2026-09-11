# Phase 4 完全离线打包报告

更新日期：2026-09-11

## Gate 结论

Phase 4 Gate 已通过。正式发行目录包含单个运行文件及两份非运行依赖说明文件。

```text
release/
├── EnglishReader.html          151.1 MiB
├── README.txt                  614 bytes
└── THIRD_PARTY_LICENSES.txt    约 14 KiB
```

## 离线措施

- UI、CSS、JavaScript、q8 ONNX、Tokenizer、6 个 Voice、WASM 全部内嵌。
- 使用系统字体和 inline SVG。
- 正式构建无 source map。
- Base64 每 4 MiB 分块解码，资源转换后立即移除对应 DOM 文本节点。
- 关闭 Transformers.js 远程模型与 browser cache。
- Voice fetch 只允许返回内嵌 Voice；HTTP/HTTPS fetch 主动报错。
- CSP 的 connect-src 仅允许 Blob/Data。
- 正式运行 bundle 扫描 HTTP/HTTPS、jsDelivr、unpkg、Hugging Face、GitHub Raw 和 Google Fonts 标记。
- 上游不可达默认 URL 在构建中改写为 `offline://`。

## 发行测试

Chrome 153、`file://`、浏览器离线模式下，正式 `release/EnglishReader.html` 成功生成 `environment`：4.55 秒、218,444 bytes WAV，HTTP/HTTPS 请求为 0。
