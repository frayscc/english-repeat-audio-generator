import assert from "node:assert/strict";
import { access, stat, readFile } from "node:fs/promises";
import test from "node:test";

test("Phase 0 local resources have plausible sizes", async () => {
  const expected = [
    ["assets/kokoro-v1.0/onnx/model_quantized.onnx", 90_000_000],
    ["assets/kokoro-v1.0/voices/af_heart.bin", 500_000],
    ["node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm", 20_000_000],
  ];
  for (const [filename, minimumBytes] of expected) {
    const info = await stat(filename);
    assert.ok(info.size > minimumBytes, `${filename} appears truncated`);
  }
});

test("optional Phase 0 q8f16 experiment is not truncated", async (context) => {
  const filename = "assets/kokoro-v1.0/onnx/model_q8f16.onnx";
  try {
    await access(filename);
  } catch {
    context.skip("q8f16 is a local V1 experiment and is intentionally not stored in Git");
    return;
  }
  assert.ok((await stat(filename)).size > 80_000_000, `${filename} appears truncated`);
});

test("generated V1 single HTML contains every embedded runtime resource", async (context) => {
  try {
    await access("test.html");
  } catch {
    context.skip("run npm run build:phase0 to create the optional V1 test artifact");
    return;
  }
  const html = await readFile("test.html", "utf8");
  for (const id of [
    "asset-config",
    "asset-tokenizer",
    "asset-tokenizer-config",
    "asset-model",
    "asset-voice-af-heart",
    "asset-ort-module",
    "asset-ort-wasm",
  ]) {
    assert.match(html, new RegExp(`id=\\"${id}\\"`));
  }
  assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)=["']https?:/i);
});
