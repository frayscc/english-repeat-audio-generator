import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputDirectory = path.join(root, "dist", "phase0");
const bundlePath = path.join(outputDirectory, "app.js");
const dtype = process.env.PHASE0_DTYPE ?? "q8";
const modelFilename = dtype === "q8f16" ? "onnx/model_q8f16.onnx" : "onnx/model_quantized.onnx";
const outputFilename = process.env.PHASE0_OUTPUT ?? "test.html";

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [path.join(root, "src", "phase0", "main.js")],
  outfile: bundlePath,
  bundle: true,
  minify: true,
  platform: "browser",
  format: "iife",
  target: ["chrome120", "edge120"],
  sourcemap: false,
  legalComments: "none",
  define: {
    __PHASE0_VARIANT__: JSON.stringify(dtype),
  },
});

const assets = [
  ["asset-config", "assets/kokoro-v1.0/config.json"],
  ["asset-tokenizer", "assets/kokoro-v1.0/tokenizer.json"],
  ["asset-tokenizer-config", "assets/kokoro-v1.0/tokenizer_config.json"],
  ["asset-model", `assets/kokoro-v1.0/${modelFilename}`],
  ["asset-voice-af-heart", "assets/kokoro-v1.0/voices/af_heart.bin"],
  ["asset-ort-module", "node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs"],
  ["asset-ort-wasm", "node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm"],
];

const embeddedAssets = [];
for (const [id, relativePath] of assets) {
  const data = await readFile(path.join(root, relativePath));
  embeddedAssets.push(`<script type="application/octet-stream" id="${id}">${data.toString("base64")}</script>`);
}

const [template, bundle] = await Promise.all([
  readFile(path.join(root, "src", "phase0", "test.template.html"), "utf8"),
  readFile(bundlePath, "utf8"),
]);
const html = template
  .replace("{{EMBEDDED_ASSETS}}", () => embeddedAssets.join("\n"))
  .replace("{{APP_BUNDLE}}", () => bundle);
await writeFile(path.join(root, outputFilename), html);
console.log(`Built ${outputFilename} (${dtype}, ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MiB)`);
