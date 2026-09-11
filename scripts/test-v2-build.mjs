import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const frontendRoot = path.join(root, "dist", "v2");
const resourceRoot = path.join(root, "resources-release");
const [html, script, manifestSource] = await Promise.all([
  readFile(path.join(frontendRoot, "index.html"), "utf8"),
  readFile(path.join(frontendRoot, "app.js"), "utf8"),
  readFile(path.join(resourceRoot, "resource-manifest.json"), "utf8"),
]);
const manifest = JSON.parse(manifestSource);

assert.equal(manifest.networkPolicy, "offline-only");
assert.equal(manifest.model.defaultDtype, "q8");
assert.equal(manifest.model.backend, "native-onnx-cpu");
assert.equal(manifest.resources.length, 10);
assert.ok(!html.includes("application/octet-stream"), "V2 HTML must not embed binary resources");
assert.ok(!html.includes("data:application"), "V2 HTML must not contain Base64 applications");
assert.ok(!script.includes("huggingface.co"), "V2 frontend must not refer to Hugging Face");
assert.ok(!script.includes("cdn.jsdelivr"), "V2 frontend must not refer to a CDN");
assert.ok(!script.includes("onnxruntime-web"), "V2 frontend must not bundle the retired WASM runtime");

for (const resource of manifest.resources) {
  assert.match(resource.sha256, /^[a-f0-9]{64}$/);
  const resourceStat = await stat(path.join(resourceRoot, resource.path));
  assert.equal(resourceStat.size, resource.bytes, `${resource.id} size differs from its manifest`);
}

const htmlStat = await stat(path.join(frontendRoot, "index.html"));
assert.ok(htmlStat.size < 100_000, "V2 HTML shell should stay small");
console.log(`V2 build verified: ${manifest.resources.length} external resources, ${(htmlStat.size / 1024).toFixed(1)} KiB HTML shell`);
