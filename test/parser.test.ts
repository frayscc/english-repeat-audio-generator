import assert from "node:assert/strict";
import test from "node:test";
import { cleanInputLine, parseInput } from "../src/parser/textParser";

test("parser removes supported Chinese and numeric list markers", () => {
  const input = `1. environment

2、protect the environment
③ take part in
四、instead of
（5）look forward to`;
  assert.deepEqual(parseInput(input), [
    "environment",
    "protect the environment",
    "take part in",
    "instead of",
    "look forward to",
  ]);
});

test("parser preserves English punctuation, casing, apostrophes and hyphens", () => {
  assert.deepEqual(parseInput("1) don't\n(2) I'm\n（3）I'd like to\n4、mother-in-law\n5. U.S.\n6. Mr. Smith\n7. How are you?"), [
    "don't",
    "I'm",
    "I'd like to",
    "mother-in-law",
    "U.S.",
    "Mr. Smith",
    "How are you?",
  ]);
  assert.equal(cleanInputLine("2026 plan"), "2026 plan");
});

