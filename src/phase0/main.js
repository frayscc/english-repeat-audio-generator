import { env as transformersEnv } from "@huggingface/transformers";
import { env as kokoroEnv, KokoroTTS } from "kokoro-js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const MODEL_VARIANT = __PHASE0_VARIANT__;
const MODEL_DTYPE = "q8";
const ASSET_IDS = {
  "config.json": "asset-config",
  "tokenizer.json": "asset-tokenizer",
  "tokenizer_config.json": "asset-tokenizer-config",
  "onnx/model_quantized.onnx": "asset-model",
  "voices/af_heart.bin": "asset-voice-af-heart",
};

const elements = {
  text: document.querySelector("#text"),
  initialize: document.querySelector("#initialize"),
  generate: document.querySelector("#generate"),
  status: document.querySelector("#status"),
  audio: document.querySelector("#audio"),
  diagnostics: document.querySelector("#diagnostics"),
};

let tts = null;
let audioUrl = null;
const timings = {};

function setStatus(message, kind = "working") {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
}

function base64ElementToBlob(id, mimeType) {
  const source = document.getElementById(id);
  if (!source) throw new Error(`缺少内嵌资源：${id}`);

  const encoded = source.textContent.replace(/\s/g, "");
  const chunkSize = 4 * 1024 * 1024;
  const chunks = [];
  for (let offset = 0; offset < encoded.length; offset += chunkSize) {
    const chunk = encoded.slice(offset, offset + chunkSize);
    const binary = atob(chunk);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    chunks.push(bytes);
  }
  source.remove();
  return new Blob(chunks, { type: mimeType });
}

function createEmbeddedCache() {
  const blobs = new Map();
  return {
    async match(request) {
      const key = String(typeof request === "string" ? request : request.url);
      const filename = Object.keys(ASSET_IDS).find((name) => key.endsWith(name));
      if (!filename || filename.startsWith("voices/")) return undefined;
      if (!blobs.has(filename)) {
        blobs.set(
          filename,
          base64ElementToBlob(
            ASSET_IDS[filename],
            filename.endsWith(".json") ? "application/json" : "application/octet-stream",
          ),
        );
      }
      return new Response(blobs.get(filename), { status: 200 });
    },
    async put() {},
  };
}

function installOfflineResources() {
  const wasmModuleUrl = URL.createObjectURL(
    base64ElementToBlob("asset-ort-module", "text/javascript"),
  );
  const wasmBinaryUrl = URL.createObjectURL(
    base64ElementToBlob("asset-ort-wasm", "application/wasm"),
  );

  kokoroEnv.wasmPaths = {
    mjs: wasmModuleUrl,
    wasm: wasmBinaryUrl,
  };
  transformersEnv.backends.onnx.wasm.numThreads = 1;
  transformersEnv.backends.onnx.wasm.proxy = false;
  transformersEnv.allowLocalModels = true;
  transformersEnv.allowRemoteModels = false;
  transformersEnv.useBrowserCache = false;
  transformersEnv.useCustomCache = true;
  transformersEnv.customCache = createEmbeddedCache();

  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = String(typeof input === "string" ? input : input.url);
    if (url.endsWith("/voices/af_heart.bin")) {
      return new Response(
        base64ElementToBlob(ASSET_IDS["voices/af_heart.bin"], "application/octet-stream"),
        { status: 200 },
      );
    }
    if (/^https?:/i.test(url)) {
      throw new Error(`离线保护已阻止网络请求：${url}`);
    }
    return nativeFetch(input, init);
  };

  return { wasmModuleUrl, wasmBinaryUrl };
}

const runtimeUrls = installOfflineResources();

async function initialize() {
  elements.initialize.disabled = true;
  setStatus("正在从本页内嵌资源准备语音模型…");
  const startedAt = performance.now();
  try {
    tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: MODEL_DTYPE,
      device: "wasm",
      progress_callback: (progress) => {
        if (progress?.status === "progress" && progress.file) {
          const percent = Number.isFinite(progress.progress)
            ? ` ${Math.round(progress.progress)}%`
            : "";
          setStatus(`正在读取 ${progress.file}${percent}`);
        }
      },
    });
    timings.initializeMs = Math.round(performance.now() - startedAt);
    elements.generate.disabled = false;
    setStatus("语音模型已就绪 · 兼容模式", "ready");
    renderDiagnostics();
  } catch (error) {
    elements.initialize.disabled = false;
    setStatus(`初始化失败：${error.message}`, "error");
    console.error(error);
    throw error;
  }
}

async function generate() {
  if (!tts) return;
  const text = elements.text.value.trim();
  if (!text) {
    setStatus("请先输入英文内容。", "error");
    return;
  }

  elements.generate.disabled = true;
  setStatus("正在生成 environment 的本地语音…");
  const startedAt = performance.now();
  try {
    const audio = await tts.generate(text, { voice: "af_heart", speed: 0.9 });
    timings.generateMs = Math.round(performance.now() - startedAt);
    timings.generationRunsMs ??= [];
    timings.generationRunsMs.push(timings.generateMs);
    timings.samples = audio.audio.length;
    timings.sampleRate = audio.sampling_rate;
    timings.durationSeconds = Number((audio.audio.length / audio.sampling_rate).toFixed(3));
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(audio.toBlob());
    elements.audio.src = audioUrl;
    elements.audio.hidden = false;
    setStatus("生成成功，可以播放。", "ready");
    renderDiagnostics();
  } catch (error) {
    setStatus(`生成失败：${error.message}`, "error");
    console.error(error);
    throw error;
  } finally {
    elements.generate.disabled = false;
  }
}

function renderDiagnostics() {
  const diagnostics = {
    protocol: location.protocol,
    model: MODEL_ID,
    dtype: MODEL_DTYPE,
    modelVariant: MODEL_VARIANT,
    device: "wasm",
    remoteModelsAllowed: transformersEnv.allowRemoteModels,
    webgpuVisible: Boolean(navigator.gpu),
    ...timings,
  };
  elements.diagnostics.textContent = JSON.stringify(diagnostics, null, 2);
  globalThis.__PHASE0_RESULT__ = diagnostics;
}

elements.initialize.addEventListener("click", initialize);
elements.generate.addEventListener("click", generate);
window.addEventListener("beforeunload", () => {
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  URL.revokeObjectURL(runtimeUrls.wasmModuleUrl);
  URL.revokeObjectURL(runtimeUrls.wasmBinaryUrl);
});
renderDiagnostics();
