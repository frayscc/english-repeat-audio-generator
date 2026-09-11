import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const resourceRoot = path.join(root, "resources-release");
const files = [
  ["model-config", "assets/kokoro-v1.0/config.json", "kokoro-v1.0/config.json", "configuration"],
  ["tokenizer", "assets/kokoro-v1.0/tokenizer.json", "kokoro-v1.0/tokenizer.json", "tokenizer"],
  ["tokenizer-config", "assets/kokoro-v1.0/tokenizer_config.json", "kokoro-v1.0/tokenizer_config.json", "configuration"],
  ["model-q8", "assets/kokoro-v1.0/onnx/model_quantized.onnx", "kokoro-v1.0/onnx/model_quantized.onnx", "model"],
  ["voice-af-heart", "assets/kokoro-v1.0/voices/af_heart.bin", "kokoro-v1.0/voices/af_heart.bin", "voice"],
  ["voice-af-bella", "assets/kokoro-v1.0/voices/af_bella.bin", "kokoro-v1.0/voices/af_bella.bin", "voice"],
  ["voice-am-fenrir", "assets/kokoro-v1.0/voices/am_fenrir.bin", "kokoro-v1.0/voices/am_fenrir.bin", "voice"],
  ["voice-am-michael", "assets/kokoro-v1.0/voices/am_michael.bin", "kokoro-v1.0/voices/am_michael.bin", "voice"],
  ["voice-bf-emma", "assets/kokoro-v1.0/voices/bf_emma.bin", "kokoro-v1.0/voices/bf_emma.bin", "voice"],
  ["voice-bm-george", "assets/kokoro-v1.0/voices/bm_george.bin", "kokoro-v1.0/voices/bm_george.bin", "voice"],
];

await mkdir(resourceRoot, { recursive: true });
await rm(path.join(resourceRoot, ".DS_Store"), { force: true });
const resources = [];
for (const [id, sourceRelativePath, targetRelativePath, type] of files) {
  const source = path.join(root, sourceRelativePath);
  const target = path.join(resourceRoot, targetRelativePath);
  await mkdir(path.dirname(target), { recursive: true });
  const sourceStat = await stat(source);
  let shouldCopy = true;
  try {
    const targetStat = await stat(target);
    shouldCopy = targetStat.size !== sourceStat.size || targetStat.mtimeMs < sourceStat.mtimeMs;
  } catch {
    // The destination is created below.
  }
  if (shouldCopy) await copyFile(source, target);
  const content = await readFile(source);
  resources.push({
    id,
    path: targetRelativePath,
    bytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
    type,
  });
}

const manifest = {
  schemaVersion: 1,
  model: {
    id: "onnx-community/Kokoro-82M-v1.0-ONNX",
    version: "1.0",
    defaultDtype: "q8",
    backend: "native-onnx-cpu",
    sampleRate: 24_000,
  },
  networkPolicy: "offline-only",
  resources,
};

await writeFile(
  path.join(resourceRoot, "resource-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`Prepared ${resources.length} external V2 resources`);
