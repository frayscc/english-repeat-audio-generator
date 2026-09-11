import type { VoiceProfile } from "./types";

export const PHASE_1_VOICES: readonly VoiceProfile[] = [
  {
    id: "ava-us",
    internalId: "af_heart",
    name: "Ava",
    locale: "en-US",
    gender: "female",
    description: "自然清晰",
  },
  { id: "bella-us", internalId: "af_bella", name: "Bella", locale: "en-US", gender: "female", description: "温暖生动" },
  { id: "ethan-us", internalId: "am_fenrir", name: "Ethan", locale: "en-US", gender: "male", description: "清晰有力" },
  { id: "michael-us", internalId: "am_michael", name: "Michael", locale: "en-US", gender: "male", description: "沉稳自然" },
  { id: "emma-gb", internalId: "bf_emma", name: "Emma", locale: "en-GB", gender: "female", description: "标准英音" },
  { id: "george-gb", internalId: "bm_george", name: "George", locale: "en-GB", gender: "male", description: "清楚稳重" },
];
