import { env as transformersEnv } from "@huggingface/transformers";
import { env as kokoroEnv } from "kokoro-js";

const MODEL_FILES: Readonly<Record<string, string>> = {
  "config.json": "asset-config",
  "tokenizer.json": "asset-tokenizer",
  "tokenizer_config.json": "asset-tokenizer-config",
  "onnx/model_quantized.onnx": "asset-model",
};
const VOICE_IDS = ["af_heart", "af_bella", "am_fenrir", "am_michael", "bf_emma", "bm_george"] as const;

interface MutableRuntimeEnvironment {
  allowLocalModels: boolean;
  allowRemoteModels: boolean;
  useBrowserCache: boolean;
  useCustomCache: boolean;
  customCache: { match(request: RequestInfo): Promise<Response | undefined>; put(): Promise<void> } | null;
  backends: { onnx: { wasm: { numThreads: number; proxy: boolean } } };
}

function embeddedBlob(id: string, mimeType: string): Blob {
  const source = document.getElementById(id);
  if (!source) throw new Error(`缺少内嵌资源：${id}`);
  const encoded = source.textContent?.replace(/\s/g, "") ?? "";
  const chunks: ArrayBuffer[] = [];
  const chunkSize = 4 * 1024 * 1024;
  for (let offset = 0; offset < encoded.length; offset += chunkSize) {
    const binary = atob(encoded.slice(offset, offset + chunkSize));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    chunks.push(bytes.buffer as ArrayBuffer);
  }
  source.remove();
  return new Blob(chunks, { type: mimeType });
}

export function installOfflineResources(): () => void {
  const moduleUrl = URL.createObjectURL(embeddedBlob("asset-ort-module", "text/javascript"));
  const wasmUrl = URL.createObjectURL(embeddedBlob("asset-ort-wasm", "application/wasm"));
  kokoroEnv.wasmPaths = { mjs: moduleUrl, wasm: wasmUrl } as unknown as string;

  const runtime = transformersEnv as unknown as MutableRuntimeEnvironment;
  runtime.backends.onnx.wasm.numThreads = 1;
  runtime.backends.onnx.wasm.proxy = false;
  runtime.allowLocalModels = true;
  runtime.allowRemoteModels = false;
  runtime.useBrowserCache = false;
  runtime.useCustomCache = true;

  const blobs = new Map<string, Blob>();
  runtime.customCache = {
    async match(request) {
      const key = String(typeof request === "string" ? request : request.url);
      const filename = Object.keys(MODEL_FILES).find((candidate) => key.endsWith(candidate));
      if (!filename) return undefined;
      if (!blobs.has(filename)) {
        const id = MODEL_FILES[filename];
        if (!id) return undefined;
        blobs.set(filename, embeddedBlob(id, filename.endsWith(".json") ? "application/json" : "application/octet-stream"));
      }
      return new Response(blobs.get(filename), { status: 200 });
    },
    async put() {},
  };

  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const voice = VOICE_IDS.find((id) => url.endsWith(`/voices/${id}.bin`));
    if (voice) {
      return new Response(embeddedBlob(`asset-voice-${voice.replace("_", "-")}`, "application/octet-stream"));
    }
    if (/^https?:/i.test(url)) throw new Error(`离线保护已阻止网络请求：${url}`);
    return nativeFetch(input, init);
  };

  return () => {
    globalThis.fetch = nativeFetch;
    URL.revokeObjectURL(moduleUrl);
    URL.revokeObjectURL(wasmUrl);
  };
}
