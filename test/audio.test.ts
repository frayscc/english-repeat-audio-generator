import assert from "node:assert/strict";
import test from "node:test";
import { concatenateAudio } from "../src/audio/mixer";
import { createSilence, secondsToSamples } from "../src/audio/silence";
import { encodePcm16Wav } from "../src/audio/wav";

test("silence duration is converted to the nearest sample", () => {
  assert.equal(secondsToSamples(1.2, 24_000), 28_800);
  assert.equal(createSilence(0.3, 10).samples.length, 3);
});

test("audio concatenation preserves order and rejects sample-rate mismatch", () => {
  const output = concatenateAudio([
    { samples: new Float32Array([1, 2]), sampleRate: 24_000 },
    { samples: new Float32Array([3]), sampleRate: 24_000 },
  ]);
  assert.deepEqual(Array.from(output.samples), [1, 2, 3]);
  assert.throws(() => concatenateAudio([
    { samples: new Float32Array(1), sampleRate: 24_000 },
    { samples: new Float32Array(1), sampleRate: 44_100 },
  ]), /Sample rate mismatch/);
});

test("WAV encoder writes a valid mono PCM16 header and clamps samples", () => {
  const wav = encodePcm16Wav({ samples: new Float32Array([-2, -1, 0, 1, 2]), sampleRate: 24_000 });
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const text = (offset: number, length: number) => new TextDecoder().decode(wav.subarray(offset, offset + length));
  assert.equal(text(0, 4), "RIFF");
  assert.equal(text(8, 4), "WAVE");
  assert.equal(text(12, 4), "fmt ");
  assert.equal(text(36, 4), "data");
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 24_000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 10);
  assert.equal(wav.byteLength, 54);
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(52, true), 32767);
});

