import { KokoroTTS } from "kokoro-js";
import type { AudioData, SynthesisOptions, TTSEngine } from "./types";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const SUPPORTED_VOICES = ["af_heart", "af_bella", "am_fenrir", "am_michael", "bf_emma", "bm_george"] as const;
type SupportedVoice = (typeof SUPPORTED_VOICES)[number];

function isSupportedVoice(voice: string): voice is SupportedVoice {
  return (SUPPORTED_VOICES as readonly string[]).includes(voice);
}

export class KokoroEngine implements TTSEngine {
  private tts: KokoroTTS | null = null;
  private runtimeMode: "gpu" | "compatibility" = "compatibility";

  get mode(): "gpu" | "compatibility" {
    return this.runtimeMode;
  }

  async initialize(): Promise<void> {
    if (this.tts) return;
    this.tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8", device: "wasm" });
    this.runtimeMode = "compatibility";
  }

  async synthesize(text: string, options: SynthesisOptions): Promise<AudioData> {
    if (!this.tts) throw new Error("语音模型尚未初始化。");
    if (!isSupportedVoice(options.voice)) throw new Error(`尚未内嵌音色：${options.voice}`);
    const audio = await this.tts.generate(text, { voice: options.voice, speed: options.speed });
    return { samples: audio.audio, sampleRate: audio.sampling_rate };
  }

  async dispose(): Promise<void> {
    await this.tts?.model.dispose();
    this.tts = null;
    this.runtimeMode = "compatibility";
  }
}
