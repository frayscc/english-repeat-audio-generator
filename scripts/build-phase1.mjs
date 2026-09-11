import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputDirectory = path.join(root, "dist", "phase1");
const bundlePath = path.join(outputDirectory, "app.js");
await mkdir(outputDirectory, { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "phase1", "main.ts")],
  outfile: bundlePath,
  bundle: true,
  minify: true,
  platform: "browser",
  format: "iife",
  target: ["chrome120", "edge120"],
  sourcemap: false,
  legalComments: "none",
});

const assets = [
  ["asset-config", "assets/kokoro-v1.0/config.json"],
  ["asset-tokenizer", "assets/kokoro-v1.0/tokenizer.json"],
  ["asset-tokenizer-config", "assets/kokoro-v1.0/tokenizer_config.json"],
  ["asset-model", "assets/kokoro-v1.0/onnx/model_quantized.onnx"],
  ["asset-voice-af-heart", "assets/kokoro-v1.0/voices/af_heart.bin"],
  ["asset-ort-module", "node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs"],
  ["asset-ort-wasm", "node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm"],
];
const embeddedAssets = [];
for (const [id, filename] of assets) {
  const content = await readFile(path.join(root, filename));
  embeddedAssets.push(`<script type="application/octet-stream" id="${id}">${content.toString("base64")}</script>`);
}
const [template, bundle] = await Promise.all([
  readFile(path.join(root, "src", "phase1", "phase1.template.html"), "utf8"),
  readFile(bundlePath, "utf8"),
]);
const html = template
  .replace("{{EMBEDDED_ASSETS}}", () => embeddedAssets.join("\n"))
  .replace("{{APP_BUNDLE}}", () => bundle);
await writeFile(path.join(root, "phase1.html"), html);
console.log(`Built phase1.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MiB)`);

