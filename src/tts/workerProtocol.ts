export type TtsWorkerState =
  | "idle"
  | "loading-runtime"
  | "loading-model"
  | "initializing"
  | "ready"
  | "generating"
  | "error";

export interface WorkerResourceUrls {
  config: string;
  tokenizer: string;
  tokenizerConfig: string;
  modelQ8: string;
  modelQ8f16: string;
  ortCpuModule: string;
  ortCpuWasm: string;
  ortJsepModule: string;
  ortJsepWasm: string;
  voices: Record<string, string>;
}

export type HostToWorkerMessage =
  | {
      type: "initialize";
      requestId: number;
      backend: "wasm" | "webgpu";
      modelVariant: "q8" | "q8f16";
      resources: WorkerResourceUrls;
      cacheLimit: number;
    }
  | {
      type: "synthesize";
      requestId: number;
      phonemes: string;
      voice: string;
      speed: number;
    }
  | { type: "clear-cache"; requestId: number }
  | { type: "dispose"; requestId: number };

export type WorkerToHostMessage =
  | {
      type: "state";
      state: TtsWorkerState;
      stage: string;
      elapsedMs: number;
    }
  | {
      type: "diagnostic";
      tokenCount: number;
      voiceSamples: number;
    }
  | {
      type: "initialized";
      requestId: number;
      backend: "wasm" | "webgpu";
      modelVariant: "q8" | "q8f16";
      threads: number;
      crossOriginIsolated: boolean;
    }
  | {
      type: "audio";
      requestId: number;
      samples: ArrayBuffer;
      sampleRate: number;
      cacheHit: boolean;
    }
  | { type: "completed"; requestId: number }
  | {
      type: "error";
      requestId: number;
      code: string;
      message: string;
    };
