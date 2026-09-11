import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import "./generate-licenses.mjs";

const root = process.cwd();
const distDirectory = path.join(root, "dist", "release");
const releaseDirectory = path.join(root, "release");
const bundlePath = path.join(distDirectory, "app.js");
await mkdir(distDirectory, { recursive: true });
await mkdir(releaseDirectory, { recursive: true });
await build({
  entryPoints: [path.join(root, "src", "app", "main.ts")],
  outfile: bundlePath,
  bundle: true,
  minify: true,
  platform: "browser",
  format: "iife",
  target: ["chrome120", "edge120"],
  sourcemap: false,
  legalComments: "none",
});

let bundle = await readFile(bundlePath, "utf8");
bundle = bundle
  .replaceAll("https://cdn.jsdelivr.net", "offline://wasm.local")
  .replaceAll("https://huggingface.co", "offline://model.local")
  .replaceAll("https://github.com", "offline://docs.local")
  .replaceAll("https://gist.github.com", "offline://docs.local")
  .replaceAll("https://developer.mozilla.org", "offline://docs.local")
  .replaceAll("https://web.dev", "offline://docs.local")
  .replaceAll("http://www.w3.org", "offline://standards.local")
  .replace(/https?:\/\//giu, "offline://")
  .replaceAll("huggingface.co", "model.local")
  .replaceAll("hf.co", "model.local")
  .replaceAll("cdn.jsdelivr.net", "wasm.local")
  .replaceAll("githubusercontent", "local-source")
  .replaceAll("fonts.googleapis", "local-fonts");
const forbidden = /https?:\/\/|cdn\.jsdelivr|unpkg|huggingface\.co|githubusercontent|fonts\.googleapis/iu;
const match = bundle.match(forbidden);
if (match) throw new Error(`Release bundle contains forbidden network dependency marker: ${match[0]}`);
await writeFile(bundlePath, bundle);

const voices = ["af_heart", "af_bella", "am_fenrir", "am_michael", "bf_emma", "bm_george"];
const assets = [
  ["asset-config", "assets/kokoro-v1.0/config.json"],
  ["asset-tokenizer", "assets/kokoro-v1.0/tokenizer.json"],
  ["asset-tokenizer-config", "assets/kokoro-v1.0/tokenizer_config.json"],
  ["asset-model", "assets/kokoro-v1.0/onnx/model_quantized.onnx"],
  ...voices.map((voice) => [`asset-voice-${voice.replace("_", "-")}`, `assets/kokoro-v1.0/voices/${voice}.bin`]),
  ["asset-ort-module", "node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs"],
  ["asset-ort-wasm", "node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm"],
];
const embeddedAssets = [];
for (const [id, filename] of assets) {
  const content = await readFile(path.join(root, filename));
  embeddedAssets.push(`<script type="application/octet-stream" id="${id}">${content.toString("base64")}</script>`);
}
const [template, styles] = await Promise.all([
  readFile(path.join(root, "src", "app", "app.template.html"), "utf8"),
  readFile(path.join(root, "src", "ui", "styles.css"), "utf8"),
]);
const html = template
  .replace("{{APP_STYLES}}", () => styles)
  .replace("{{EMBEDDED_ASSETS}}", () => embeddedAssets.join("\n"))
  .replace("{{APP_BUNDLE}}", () => bundle);
await writeFile(path.join(releaseDirectory, "EnglishReader.html"), html);

const readme = `英语跟读音频生成器 V1
======================

使用方法

1. 双击 EnglishReader.html
2. 输入单词、短语或句子，每行一个
3. 选择美式或英式英语及声音
4. 选择重复次数
5. 点击“生成音频”
6. 试听生成结果
7. 点击“导出 WAV”保存

本工具无需安装、无需联网、无需账号。
模型和所有程序资源均包含在 EnglishReader.html 中，所有数据只在浏览器本地处理。

推荐使用最新版 Google Chrome 或 Microsoft Edge。
首次打开大文件可能需要短暂等待，请勿使用微信或其他内置浏览器打开。
`;
await writeFile(path.join(releaseDirectory, "README.txt"), readme);
console.log(`Built release/EnglishReader.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MiB)`);
