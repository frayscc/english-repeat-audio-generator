import type { AudioData } from "../tts/types";

export function concatenateAudio(parts: readonly AudioData[]): AudioData {
  if (parts.length === 0) throw new Error("Cannot concatenate an empty audio list.");
  const sampleRate = parts[0]?.sampleRate;
  if (!sampleRate) throw new Error("Invalid sample rate.");
  let totalSamples = 0;
  for (const part of parts) {
    if (part.sampleRate !== sampleRate) {
      throw new Error(`Sample rate mismatch: expected ${sampleRate}, received ${part.sampleRate}.`);
    }
    totalSamples += part.samples.length;
  }
  const samples = new Float32Array(totalSamples);
  let offset = 0;
  for (const part of parts) {
    samples.set(part.samples, offset);
    offset += part.samples.length;
  }
  return { samples, sampleRate };
}
