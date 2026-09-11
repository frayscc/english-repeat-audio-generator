export function normalizeEnglishForKokoro(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/、/g, ", ")
    .replace(/。/g, ". ")
    .replace(/！/g, "! ")
    .replace(/，/g, ", ")
    .replace(/：/g, ": ")
    .replace(/；/g, "; ")
    .replace(/？/g, "? ")
    .replace(/[^\S \n]/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/\bD[Rr]\.(?= [A-Z])/g, "Doctor")
    .replace(/\bMr\.(?= [A-Z])/gi, "Mister")
    .replace(/\bMs\.(?= [A-Z])/gi, "Miss")
    .replace(/\bMrs\.(?= [A-Z])/gi, "Mrs")
    .replace(/\betc\.(?! [A-Z])/gi, "etc")
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(/(\d+)\.(\d+)/g, (_, integer: string, fraction: string) => `${integer} point ${fraction.split("").join(" ")}`)
    .replace(/(?<=\d)-(?=\d)/g, " to ")
    .trim();
}
