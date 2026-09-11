import type { AudioData } from "../tts/types";

export function secondsToSamples(seconds: number, sampleRate: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("Silence duration must be non-negative.");
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new RangeError("Sample rate must be a positive integer.");
  return Math.round(seconds * sampleRate);
}

export function createSilence(seconds: number, sampleRate: number): AudioData {
  return { samples: new Float32Array(secondsToSamples(seconds, sampleRate)), sampleRate };
}
