export const DEFAULT_SETTINGS = {
  locale: "en-US" as const,
  voice: "af_heart",
  repeatCount: 2,
  speed: 0.9,
  repeatGapSeconds: 1.2,
  itemGapSeconds: 2.0,
};

export const LIMITS = {
  repeatCount: { min: 1, max: 3 },
  speed: { min: 0.7, max: 1.2 },
  repeatGapSeconds: { min: 0.3, max: 5 },
  itemGapSeconds: { min: 0.5, max: 10 },
};
