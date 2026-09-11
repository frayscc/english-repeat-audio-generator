import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { AudioData, SynthesisOptions, TTSEngine } from "./types";
import type { HostToWorkerMessage, TtsWorkerState, WorkerResourceUrls, WorkerToHostMessage } from "./workerProtocol";

declare const __V2_DEV_SMOKE__: boolean;
declare const __V2_GPU_SMOKE__: boolean;

const RESOURCE_PATHS = {
  config: "kokoro-v1.0/config.json",
  tokenizer: "kokoro-v1.0/tokenizer.json",
  tokenizerConfig: "kokoro-v1.0/tokenizer_config.json",
  modelQ8: "kokoro-v1.0/onnx/model_quantized.onnx",
  modelQ8f16: "kokoro-v1.0/onnx/model_q8f16.onnx",
  ortCpuModule: "onnxruntime/ort-wasm-simd-threaded.mjs",
  ortCpuWasm: "onnxruntime/ort-wasm-simd-threaded.wasm",
  ortJsepModule: "onnxruntime/ort-wasm-simd-threaded.jsep.mjs",
  ortJsepWasm: "onnxruntime/ort-wasm-simd-threaded.jsep.wasm",
} as const;
const VOICE_IDS = ["af_heart", "af_bella", "am_fenrir", "am_michael", "bf_emma", "bm_george"] as const;

export interface WorkerEngineStateEvent {
  state: TtsWorkerState;
  stage: string;
  elapsedMs: number;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

async function localResourceUrl(relativePath: string): Promise<string> {
  const absolutePath = await invoke<string>("resolve_v2_resource", {
    relativePath: `resources/${relativePath}`,
  });
  return convertFileSrc(absolutePath);
}

async function resolveResources(): Promise<WorkerResourceUrls> {
  const entries = await Promise.all(
    Object.entries(RESOURCE_PATHS).map(async ([key, value]) => [key, await localResourceUrl(value)] as const),
  );
  const voices = Object.fromEntries(await Promise.all(
    VOICE_IDS.map(async (voice) => [voice, await localResourceUrl(`kokoro-v1.0/voices/${voice}.bin`)] as const),
  ));
  return { ...Object.fromEntries(entries), voices } as unknown as WorkerResourceUrls;
}

export class WorkerTtsEngine implements TTSEngine {
  private worker: Worker | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private runtimeMode: "gpu" | "compatibility" = "compatibility";

  constructor(private readonly onStateChange?: (event: WorkerEngineStateEvent) => void) {}

  get mode(): "gpu" | "compatibility" {
    return this.runtimeMode;
  }

  private nextRequestId(): number {
    this.requestId += 1;
    return this.requestId;
  }

  private request<T>(message: HostToWorkerMessage): Promise<T> {
    if (!this.worker) return Promise.reject(new Error("后台语音线程未启动"));
    return new Promise<T>((resolve, reject) => {
      this.pending.set(message.requestId, { resolve, reject });
      this.worker?.postMessage(message);
    });
  }

  private handleMessage = (event: MessageEvent<WorkerToHostMessage>): void => {
    const message = event.data;
    if (message.type === "state") {
      this.onStateChange?.(message);
      void invoke("report_tts_worker_state", {
        state: message.state,
        elapsedMs: Math.round(message.elapsedMs),
      });
      return;
    }
    if (message.type === "diagnostic") {
      void invoke("report_tts_diagnostic", {
        tokenCount: message.tokenCount,
        voiceSamples: message.voiceSamples,
      });
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    if (message.type === "error") {
      this.pending.delete(message.requestId);
      pending.reject(new Error(message.message));
    } else if (message.type === "initialized") {
      this.pending.delete(message.requestId);
      this.runtimeMode = message.backend === "webgpu" ? "gpu" : "compatibility";
      pending.resolve(message);
    } else if (message.type === "audio") {
      this.pending.delete(message.requestId);
      pending.resolve({ samples: new Float32Array(message.samples), sampleRate: message.sampleRate });
    } else if (message.type === "completed") {
      this.pending.delete(message.requestId);
      pending.resolve(undefined);
    }
  };

  async initialize(): Promise<void> {
    if (this.worker) return;
    const startedAt = performance.now();
    const resources = await resolveResources();
    await invoke("report_frontend_checkpoint", { checkpoint: "resources-resolved" });
    this.worker = new Worker(new URL("./tts-worker.js", window.location.href), { type: "module", name: "english-reader-tts" });
    await invoke("report_frontend_checkpoint", { checkpoint: "worker-created" });
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "后台语音线程启动失败");
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    });
    const requestId = this.nextRequestId();
    const backend = __V2_GPU_SMOKE__ ? "webgpu" : "wasm";
    const modelVariant = __V2_GPU_SMOKE__ ? "q8f16" : "q8";
    const initializationTimeoutMs = backend === "webgpu" ? 15_000 : 150_000;
    try {
      await invoke("report_frontend_checkpoint", { checkpoint: "initialize-sent" });
      await Promise.race([
        this.request({
          type: "initialize",
          requestId,
          backend,
          modelVariant,
          resources,
          cacheLimit: 128,
        }),
        new Promise((_, reject) => window.setTimeout(
          () => reject(new Error(`${backend === "webgpu" ? "GPU" : "CPU"} 语音模型初始化超时，已停止后台线程`)),
          initializationTimeoutMs,
        )),
      ]);
      let samples = 0;
      if (__V2_DEV_SMOKE__) {
        const audio = await this.synthesize("hello", { voice: "af_heart", speed: 0.9 });
        samples = audio.samples.length;
      }
      await invoke("report_tts_worker_probe", {
        success: true,
        elapsedMs: Math.round(performance.now() - startedAt),
        samples,
      });
    } catch (error) {
      this.worker?.terminate();
      this.worker = null;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      await invoke("report_tts_worker_probe", {
        success: false,
        elapsedMs: Math.round(performance.now() - startedAt),
        samples: 0,
      }).catch(() => undefined);
      throw error;
    }
  }

  async synthesize(_text: string, _options: SynthesisOptions): Promise<AudioData> {
    throw new Error("WKWebView Worker 实验路径已停用，请使用原生后台语音引擎");
  }

  async dispose(): Promise<void> {
    if (!this.worker) return;
    const worker = this.worker;
    const requestId = this.nextRequestId();
    try {
      await Promise.race([
        this.request({ type: "dispose", requestId }),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
    } finally {
      worker.terminate();
      this.worker = null;
      this.pending.clear();
      this.runtimeMode = "compatibility";
    }
  }
}
