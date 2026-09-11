export interface AudioData {
  samples: Float32Array;
  sampleRate: number;
}

export interface SynthesisOptions {
  voice: string;
  speed: number;
}

export interface TTSEngine {
  initialize(): Promise<void>;
  synthesize(text: string, options: SynthesisOptions): Promise<AudioData>;
  dispose(): Promise<void>;
}

export interface VoiceProfile {
  id: string;
  internalId: string;
  name: string;
  locale: "en-US" | "en-GB";
  gender: "female" | "male";
  description: string;
}
