/// <reference lib="webworker" />

import { env as transformersEnv, Tensor } from "@huggingface/transformers";
import { env as kokoroEnv, KokoroTTS } from "kokoro-js";
import type { HostToWorkerMessage, TtsWorkerState, WorkerResourceUrls, WorkerToHostMessage } from "./workerProtocol";

const worker = self as unknown as DedicatedWorkerGlobalScope;
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const SUPPORTED_VOICES = ["af_heart", "af_bella", "am_fenrir", "am_michael", "bf_emma", "bm_george"] as const;

interface MutableRuntimeEnvironment {
  allowLocalModels: boolean;
  allowRemoteModels: boolean;
  useBrowserCache: boolean;
  useCustomCache: boolean;
  customCache: { match(request: RequestInfo): Promise<Response | undefined>; put(): Promise<void> } | null;
  backends: { onnx: { wasm: { numThreads: number; proxy: boolean } } };
}

interface CachedAudio {
  samples: Float32Array;
  sampleRate: number;
}

let tts: KokoroTTS | null = null;
let initializedBackend: "wasm" | "webgpu" = "wasm";
let initializedVariant: "q8" | "q8f16" = "q8";
let initializationStartedAt = performance.now();
let cacheLimit = 128;
let activeResources: WorkerResourceUrls | null = null;
const cache = new Map<string, CachedAudio>();
const voiceCache = new Map<string, Float32Array>();

function send(message: WorkerToHostMessage, transfer: Transferable[] = []): void {
  worker.postMessage(message, transfer);
}

function setState(state: TtsWorkerState, stage: string): void {
  send({ type: "state", state, stage, elapsedMs: performance.now() - initializationStartedAt });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function configureOfflineRuntime(
  resources: WorkerResourceUrls,
  modelVariant: "q8" | "q8f16",
  backend: "wasm" | "webgpu",
): number {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  kokoroEnv.wasmPaths = backend === "webgpu"
    ? { mjs: resources.ortJsepModule, wasm: resources.ortJsepWasm } as unknown as string
    : { mjs: resources.ortCpuModule, wasm: resources.ortCpuWasm } as unknown as string;

  const runtime = transformersEnv as unknown as MutableRuntimeEnvironment;
  const canUseThreads = globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined";
  const threads = canUseThreads ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1;
  runtime.backends.onnx.wasm.numThreads = threads;
  runtime.backends.onnx.wasm.proxy = false;
  runtime.allowLocalModels = true;
  runtime.allowRemoteModels = false;
  runtime.useBrowserCache = false;
  runtime.useCustomCache = true;

  const modelFiles: Array<[string, string]> = [
    ["tokenizer_config.json", resources.tokenizerConfig],
    ["tokenizer.json", resources.tokenizer],
    ["config.json", resources.config],
    ["onnx/model_quantized.onnx", modelVariant === "q8f16" ? resources.modelQ8f16 : resources.modelQ8],
  ];
  runtime.customCache = {
    async match(request) {
      const key = String(typeof request === "string" ? request : request.url);
      const match = modelFiles.find(([suffix]) => key.endsWith(suffix));
      if (!match) return undefined;
      return nativeFetch(match[1]);
    },
    async put() {},
  };

  globalThis.fetch = async (input, init) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const voice = SUPPORTED_VOICES.find((id) => url.endsWith(`/voices/${id}.bin`));
    if (voice) {
      const localUrl = resources.voices[voice];
      if (!localUrl) throw new Error(`缺少本地音色资源：${voice}`);
      return nativeFetch(localUrl, init);
    }
    if (/^https?:/i.test(url)) throw new Error("离线保护已阻止网络请求");
    return nativeFetch(input, init);
  };
  return threads;
}

function cacheKey(phonemes: string, voice: string, speed: number): string {
  return JSON.stringify([phonemes, voice, speed]);
}

function getCached(key: string): CachedAudio | undefined {
  const value = cache.get(key);
  if (!value) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function putCached(key: string, value: CachedAudio): void {
  if (cacheLimit <= 0) return;
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > cacheLimit) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function initialize(message: Extract<HostToWorkerMessage, { type: "initialize" }>): Promise<void> {
  if (tts) {
    send({
      type: "initialized",
      requestId: message.requestId,
      backend: initializedBackend,
      modelVariant: initializedVariant,
      threads: 1,
      crossOriginIsolated: globalThis.crossOriginIsolated,
    });
    return;
  }
  initializationStartedAt = performance.now();
  if (message.backend === "webgpu" && !("gpu" in navigator)) {
    throw new Error("当前 WebView 不提供 WebGPU");
  }
  cacheLimit = message.cacheLimit;
  activeResources = message.resources;
  setState("loading-runtime", "正在加载本地语音运行库");
  const threads = configureOfflineRuntime(message.resources, message.modelVariant, message.backend);
  setState("loading-model", "正在读取本地语音模型");
  // Kokoro.js 1.2.1 exposes q8, while q8f16 is selected by mapping the same
  // logical q8 request to the alternate local ONNX graph.
  tts = await KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: "q8",
    device: message.backend,
  });
  initializedBackend = message.backend;
  initializedVariant = message.modelVariant;
  setState("initializing", "正在初始化语音推理会话");
  send({
    type: "initialized",
    requestId: message.requestId,
    backend: initializedBackend,
    modelVariant: initializedVariant,
    threads,
    crossOriginIsolated: globalThis.crossOriginIsolated,
  });
  setState("ready", "语音模型已就绪");
}

async function synthesize(message: Extract<HostToWorkerMessage, { type: "synthesize" }>): Promise<void> {
  if (!tts) throw new Error("语音模型尚未初始化");
  if (!activeResources) throw new Error("本地资源尚未配置");
  if (!(SUPPORTED_VOICES as readonly string[]).includes(message.voice)) throw new Error(`不支持的音色：${message.voice}`);
  setState("generating", "正在生成语音");
  const key = cacheKey(message.phonemes, message.voice, message.speed);
  let audio = getCached(key);
  const cacheHit = Boolean(audio);
  if (!audio) {
    setState("generating", "正在读取本地音色");
    let voiceData = voiceCache.get(message.voice);
    if (!voiceData) {
      const voiceUrl = activeResources.voices[message.voice];
      if (!voiceUrl) throw new Error(`缺少本地音色资源：${message.voice}`);
      const voiceResponse = await fetch(voiceUrl);
      if (!voiceResponse.ok) throw new Error(`本地音色读取失败 (${voiceResponse.status})`);
      voiceData = new Float32Array(await voiceResponse.arrayBuffer());
      voiceCache.set(message.voice, voiceData);
    }
    setState("generating", "正在执行语音推理");
    const { input_ids } = tts.tokenizer(message.phonemes, { truncation: true });
    send({
      type: "diagnostic",
      tokenCount: input_ids.dims.at(-1) ?? 0,
      voiceSamples: voiceData.length,
    });
    const styleOffset = 256 * Math.min(Math.max((input_ids.dims.at(-1) ?? 2) - 2, 0), 509);
    const style = voiceData.slice(styleOffset, styleOffset + 256);
    const { waveform } = await tts.model({
      input_ids,
      style: new Tensor("float32", style, [1, 256]),
      speed: new Tensor("float32", [message.speed], [1]),
    });
    audio = { samples: new Float32Array(waveform.data as Float32Array), sampleRate: 24_000 };
    putCached(key, audio);
  }
  const transferable = audio.samples.slice().buffer as ArrayBuffer;
  send({ type: "audio", requestId: message.requestId, samples: transferable, sampleRate: audio.sampleRate, cacheHit }, [transferable]);
  setState("ready", "语音模型已就绪");
}

async function handle(message: HostToWorkerMessage): Promise<void> {
  try {
    if (message.type === "initialize") await initialize(message);
    else if (message.type === "synthesize") await synthesize(message);
    else if (message.type === "clear-cache") {
      cache.clear();
      voiceCache.clear();
      send({ type: "completed", requestId: message.requestId });
    } else if (message.type === "dispose") {
      cache.clear();
      await tts?.model.dispose();
      tts = null;
      send({ type: "completed", requestId: message.requestId });
      worker.close();
    }
  } catch (error) {
    setState("error", "语音引擎发生错误");
    send({ type: "error", requestId: message.requestId, code: message.type, message: errorMessage(error) });
  }
}

let queue = Promise.resolve();
worker.onmessage = (event: MessageEvent<HostToWorkerMessage>) => {
  queue = queue.then(() => handle(event.data));
};
setState("idle", "后台语音线程已启动");
