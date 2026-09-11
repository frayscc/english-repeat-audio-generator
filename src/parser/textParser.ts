const LEADING_NUMBER = /^(?:\(\s*\d+\s*\)|（\s*\d+\s*）|\d+\s*[.．、)）])\s*/u;
const LEADING_CIRCLED = /^[\u2460-\u2473\u3251-\u325f\u32b1-\u32bf]\s*/u;
const LEADING_CHINESE = /^[零〇一二三四五六七八九十百千]+\s*[、.．)）]\s*/u;

export function cleanInputLine(line: string): string {
  return line
    .trim()
    .replace(LEADING_NUMBER, "")
    .replace(LEADING_CIRCLED, "")
    .replace(LEADING_CHINESE, "")
    .trim();
}

export function parseInput(rawText: string): string[] {
  return rawText
    .split(/\r?\n/u)
    .map(cleanInputLine)
    .filter((line) => line.length > 0);
}
