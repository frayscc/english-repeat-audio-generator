import assert from "node:assert/strict";
import test from "node:test";
import { AudioProjectGenerator, ItemSynthesisError } from "../src/audio/projectGenerator";
import type { AudioData, SynthesisOptions, TTSEngine } from "../src/tts/types";

class FakeEngine implements TTSEngine {
  calls: string[] = [];
  async initialize(): Promise<void> {}
  async synthesize(text: string, _options: SynthesisOptions): Promise<AudioData> {
    this.calls.push(text);
    return { samples: new Float32Array(10), sampleRate: 10 };
  }
  async dispose(): Promise<void> {}
}

const options = {
  voice: "af_heart",
  speed: 0.9,
  repeatCount: 2,
  repeatGapSeconds: 1,
  itemGapSeconds: 2,
};

test("two one-second items repeated twice produce exactly eight seconds without tail silence", async () => {
  const engine = new FakeEngine();
  const generator = new AudioProjectGenerator(engine);
  const result = await generator.generate(["one", "two"], options);
  assert.equal(result.audio.samples.length, 80);
  assert.equal(result.audio.samples.length / result.audio.sampleRate, 8);
  assert.equal(result.synthesizedItemCount, 2);
  assert.deepEqual(engine.calls, ["one", "two"]);
});

test("repetitions and later projects reuse text/voice/speed cache", async () => {
  const engine = new FakeEngine();
  const generator = new AudioProjectGenerator(engine);
  await generator.generate(["environment"], { ...options, repeatCount: 3 });
  const second = await generator.generate(["environment"], options);
  assert.equal(engine.calls.length, 1);
  assert.equal(second.cacheHitCount, 1);
  assert.equal(second.synthesizedItemCount, 0);
});

test("cache key changes with voice or speed", async () => {
  const engine = new FakeEngine();
  const generator = new AudioProjectGenerator(engine);
  await generator.generate(["environment"], options);
  await generator.generate(["environment"], { ...options, speed: 1 });
  await generator.generate(["environment"], { ...options, voice: "am_michael" });
  assert.equal(engine.calls.length, 3);
});

test("project settings enforce the V1 ranges", async () => {
  const generator = new AudioProjectGenerator(new FakeEngine());
  await assert.rejects(generator.generate(["one"], { ...options, repeatCount: 4 }), /Repeat count/);
  await assert.rejects(generator.generate(["one"], { ...options, speed: 0.5 }), /Speed/);
  await assert.rejects(generator.generate(["one"], { ...options, repeatGapSeconds: 6 }), /Repeat gap/);
  await assert.rejects(generator.generate(["one"], { ...options, itemGapSeconds: 0.1 }), /Item gap/);
});

test("progress follows completed items and cancellation stops subsequent synthesis", async () => {
  const engine = new FakeEngine();
  const generator = new AudioProjectGenerator(engine);
  const controller = new AbortController();
  const completed: string[] = [];
  await assert.rejects(generator.generate(["one", "two", "three"], {
    ...options,
    signal: controller.signal,
    onProgress(progress) {
      completed.push(progress.text);
      if (progress.completed === 1) controller.abort();
    },
  }), (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  assert.deepEqual(engine.calls, ["one"]);
  assert.deepEqual(completed, ["one"]);
});

test("item failures identify the failed index and keep earlier cache entries", async () => {
  class FailingEngine extends FakeEngine {
    override async synthesize(text: string, options: SynthesisOptions): Promise<AudioData> {
      if (text === "bad") throw new Error("boom");
      return super.synthesize(text, options);
    }
  }
  const engine = new FailingEngine();
  const generator = new AudioProjectGenerator(engine);
  await assert.rejects(generator.generate(["good", "bad"], options), (error: unknown) => {
    return error instanceof ItemSynthesisError && error.index === 1 && error.text === "bad";
  });
  const retried = await generator.generate(["good"], options);
  assert.equal(retried.cacheHitCount, 1);
});
