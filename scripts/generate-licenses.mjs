import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const apache = await readFile(path.join(root, "node_modules", "kokoro-js", "LICENSE"), "utf8");
const onnxMit = await readFile(path.join(root, "licenses", "onnxruntime-LICENSE.txt"), "utf8");
const esbuildMit = await readFile(path.join(root, "node_modules", "esbuild", "LICENSE.md"), "utf8");
const text = `# Third-party licenses

This distribution contains the following third-party components.

## Apache License 2.0 components

- Kokoro-82M-v1.0-ONNX model and voice data (Apache-2.0)
- kokoro-js 1.2.1 (Apache-2.0)
- @huggingface/transformers 3.8.1 (Apache-2.0)
- phonemizer 1.2.1 (Apache-2.0)

${apache.trim()}

## ONNX Runtime Web / ONNX Runtime Common

- onnxruntime-web 1.22.0-dev.20250409-89f8206ba4 (MIT)
- onnxruntime-common 1.21.0 (MIT)

${onnxMit.trim()}

## Build-only dependency

- esbuild 0.25.9 (MIT; not required when using the release HTML)

${esbuildMit.trim()}
`;
await mkdir(path.join(root, "release"), { recursive: true });
await writeFile(path.join(root, "THIRD_PARTY_LICENSES.md"), text);
await writeFile(path.join(root, "release", "THIRD_PARTY_LICENSES.txt"), text.replace(/^# /gm, "").replace(/^## /gm, "\n"));

