import { invoke } from "@tauri-apps/api/core";
import { normalizeEnglishForKokoro } from "./englishPhonemizer";
import type { AudioData, SynthesisOptions, TTSEngine } from "./types";
import type { WorkerEngineStateEvent } from "./workerEngine";

declare const __V2_DEV_SMOKE__: boolean;
declare const __V2_BENCHMARK__: boolean;

interface NativeInitResult {
  backend: "native-cpu";
  threads: number;
  elapsedMs: number;
}

export class NativeTtsEngine implements TTSEngine {
  private initialized = false;

  constructor(private readonly onStateChange?: (event: WorkerEngineStateEvent) => void) {}

  get mode(): "compatibility" {
    return "compatibility";
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const startedAt = performance.now();
    this.onStateChange?.({ state: "loading-model", stage: "正在加载本地原生语音模型", elapsedMs: 0 });
    try {
      const result = await invoke<NativeInitResult>("initialize_native_tts");
      this.initialized = true;
      this.onStateChange?.({
        state: "ready",
        stage: `原生 CPU 语音引擎已就绪 · ${result.threads || "自动"} 线程`,
        elapsedMs: performance.now() - startedAt,
      });
      let samples = 0;
      if (__V2_DEV_SMOKE__) {
        for (const voice of ["af_heart", "af_bella", "am_fenrir", "am_michael", "bf_emma", "bm_george"]) {
          samples += (await this.synthesize("hello", { voice, speed: 0.9 })).samples.length;
        }
      }
      if (__V2_BENCHMARK__) {
        try {
          await this.runBenchmark();
        } catch (error) {
          await invoke("report_tts_benchmark_failure", { message: String(error).slice(0, 500) });
          throw error;
        }
      }
      await invoke("report_tts_worker_probe", {
        success: true,
        elapsedMs: Math.round(performance.now() - startedAt),
        samples,
      });
    } catch (error) {
      await invoke("report_tts_worker_probe", {
        success: false,
        elapsedMs: Math.round(performance.now() - startedAt),
        samples: 0,
      }).catch(() => undefined);
      throw error;
    }
  }

  private async runBenchmark(): Promise<void> {
    const measure = async (metric: string, texts: readonly string[]): Promise<number> => {
      const startedAt = performance.now();
      for (const text of texts) await this.synthesize(text, { voice: "af_heart", speed: 0.9 });
      const elapsedMs = Math.round(performance.now() - startedAt);
      await invoke("report_tts_benchmark", { metric, elapsedMs });
      return elapsedMs;
    };
    await measure("word", ["environment"]);
    await measure("phrase", ["protect the environment"]);
    const words = (
      "apple book chair desk school teacher student lesson language practice listen speak read write learn " +
      "repeat sound voice music morning afternoon evening family friend people city country travel train plane " +
      "water coffee breakfast lunch dinner garden flower animal rabbit tiger window door kitchen bedroom happy " +
      "quiet bright simple careful useful important beautiful difficult possible answer question number picture " +
      "computer telephone pencil paper summer winter spring autumn Monday Tuesday Wednesday Thursday Friday " +
      "Saturday Sunday January February March April May June July August September October November December " +
      "north south east west today tomorrow yesterday early late fast slow open close begin finish"
    ).split(" ");
    const batchStartedAt = performance.now();
    for (let index = 0; index < words.length; index += 1) {
      await this.synthesize(words[index]!, { voice: "af_heart", speed: 0.9 });
      if (index === 49) {
        await invoke("report_tts_benchmark", {
          metric: "batch50",
          elapsedMs: Math.round(performance.now() - batchStartedAt),
        });
      }
    }
    await invoke("report_tts_benchmark", {
      metric: "batch100",
      elapsedMs: Math.round(performance.now() - batchStartedAt),
    });
  }

  async synthesize(text: string, options: SynthesisOptions): Promise<AudioData> {
    if (!this.initialized) throw new Error("本地语音引擎尚未初始化");
    const startedAt = performance.now();
    this.onStateChange?.({ state: "generating", stage: "正在分析英文发音", elapsedMs: 0 });
    const normalizedText = normalizeEnglishForKokoro(text);
    this.onStateChange?.({ state: "generating", stage: "正在后台生成语音", elapsedMs: performance.now() - startedAt });
    const response = await invoke<ArrayBuffer | Uint8Array>("synthesize_native_tts", {
      text: normalizedText,
      voice: options.voice,
      speed: options.speed,
    });
    const bytes = response instanceof Uint8Array ? response : new Uint8Array(response);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.byteLength < 8) throw new Error("原生语音输出不完整");
    const sampleRate = view.getUint32(0, true);
    const sampleCount = view.getUint32(4, true);
    if (view.byteLength !== 8 + sampleCount * 4) throw new Error("原生语音输出长度无效");
    const samples = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) samples[index] = view.getFloat32(8 + index * 4, true);
    this.onStateChange?.({ state: "ready", stage: "原生 CPU 语音引擎已就绪", elapsedMs: performance.now() - startedAt });
    return { samples, sampleRate };
  }

  async dispose(): Promise<void> {
    if (!this.initialized) return;
    await invoke("dispose_native_tts");
    this.initialized = false;
  }
}
