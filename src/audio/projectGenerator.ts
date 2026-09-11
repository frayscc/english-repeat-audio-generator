import { concatenateAudio } from "./mixer";
import { createSilence } from "./silence";
import { LIMITS } from "../config/defaults";
import type { AudioData, SynthesisOptions, TTSEngine } from "../tts/types";

export interface ProjectOptions extends SynthesisOptions {
  repeatCount: number;
  repeatGapSeconds: number;
  itemGapSeconds: number;
  signal?: AbortSignal;
  onProgress?: (progress: GenerationProgress) => void;
}

export interface GenerationProgress {
  completed: number;
  total: number;
  index: number;
  text: string;
  cacheHit: boolean;
}

export interface ProjectResult {
  audio: AudioData;
  synthesizedItemCount: number;
  cacheHitCount: number;
}

export class ItemSynthesisError extends Error {
  constructor(
    readonly index: number,
    readonly text: string,
    options: ErrorOptions,
  ) {
    super(`Failed to synthesize item ${index + 1}: ${text}`, options);
    this.name = "ItemSynthesisError";
  }
}

export class AudioProjectGenerator {
  private readonly cache = new Map<string, Promise<AudioData>>();

  constructor(
    private readonly engine: TTSEngine,
    private readonly maxCacheItems = 128,
  ) {}

  private getCacheKey(text: string, options: SynthesisOptions): string {
    return JSON.stringify([text, options.voice, options.speed]);
  }

  private async synthesizeCached(
    text: string,
    options: SynthesisOptions,
  ): Promise<{ audio: AudioData; cacheHit: boolean }> {
    const key = this.getCacheKey(text, options);
    const existing = this.cache.get(key);
    if (existing) {
      this.cache.delete(key);
      this.cache.set(key, existing);
      return { audio: await existing, cacheHit: true };
    }
    const pending = this.engine.synthesize(text, options);
    this.cache.set(key, pending);
    while (this.cache.size > this.maxCacheItems) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    try {
      return { audio: await pending, cacheHit: false };
    } catch (error) {
      this.cache.delete(key);
      throw error;
    }
  }

  async preview(text: string, options: SynthesisOptions): Promise<AudioData> {
    return (await this.synthesizeCached(text, options)).audio;
  }

  async generate(items: readonly string[], options: ProjectOptions): Promise<ProjectResult> {
    if (items.length === 0) throw new Error("At least one text item is required.");
    if (!Number.isInteger(options.repeatCount) || options.repeatCount < LIMITS.repeatCount.min || options.repeatCount > LIMITS.repeatCount.max) {
      throw new RangeError("Repeat count must be an integer from 1 to 3.");
    }
    for (const [name, value, bounds] of [
      ["Speed", options.speed, LIMITS.speed],
      ["Repeat gap", options.repeatGapSeconds, LIMITS.repeatGapSeconds],
      ["Item gap", options.itemGapSeconds, LIMITS.itemGapSeconds],
    ] as const) {
      if (!Number.isFinite(value) || value < bounds.min || value > bounds.max) {
        throw new RangeError(`${name} must be from ${bounds.min} to ${bounds.max}.`);
      }
    }

    const uniqueAudio: AudioData[] = [];
    let cacheHitCount = 0;
    let synthesizedItemCount = 0;
    for (let index = 0; index < items.length; index += 1) {
      if (options.signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");
      const text = items[index];
      if (!text) continue;
      try {
        const result = await this.synthesizeCached(text, options);
        if (options.signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");
        uniqueAudio.push(result.audio);
        if (result.cacheHit) cacheHitCount += 1;
        else synthesizedItemCount += 1;
        options.onProgress?.({ completed: index + 1, total: items.length, index, text, cacheHit: result.cacheHit });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new ItemSynthesisError(index, text, { cause: error });
      }
    }

    const sampleRate = uniqueAudio[0]?.sampleRate;
    if (!sampleRate) throw new Error("TTS returned invalid audio.");
    const repeatGap = createSilence(options.repeatGapSeconds, sampleRate);
    const itemGap = createSilence(options.itemGapSeconds, sampleRate);
    const parts: AudioData[] = [];
    for (let itemIndex = 0; itemIndex < uniqueAudio.length; itemIndex += 1) {
      const itemAudio = uniqueAudio[itemIndex];
      if (!itemAudio) continue;
      for (let repeatIndex = 0; repeatIndex < options.repeatCount; repeatIndex += 1) {
        parts.push(itemAudio);
        if (repeatIndex < options.repeatCount - 1) parts.push(repeatGap);
      }
      if (itemIndex < uniqueAudio.length - 1) parts.push(itemGap);
    }

    return { audio: concatenateAudio(parts), synthesizedItemCount, cacheHitCount };
  }

  clearCache(): void {
    this.cache.clear();
  }
}
