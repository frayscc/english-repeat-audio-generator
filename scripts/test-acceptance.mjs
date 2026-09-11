import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = process.cwd();
const profileDirectory = await mkdtemp(path.join(os.tmpdir(), "english-reader-acceptance-"));
const context = await chromium.launchPersistentContext(profileDirectory, {
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  viewport: { width: 1366, height: 768 },
});
await context.setOffline(true);
const networkRequests = [];
await context.route(/^https?:\/\//, async (route) => {
  networkRequests.push(route.request().url());
  await route.abort("blockedbyclient");
});

function browserRssMiB() {
  const output = execFileSync("ps", ["-axo", "rss=,command="], { encoding: "utf8" });
  const kib = output.split("\n")
    .filter((line) => line.includes(profileDirectory))
    .reduce((total, line) => total + Number.parseInt(line.trim(), 10), 0);
  return Number((kib / 1024).toFixed(1));
}

async function readyPage(filename) {
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(`[browser:error] ${error.stack ?? error.message}`));
  await page.goto(pathToFileURL(filename).href, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator("#generate:not([disabled])").waitFor({ timeout: 300_000 });
  return page;
}

async function generate(page, input) {
  await page.locator("#input").fill(input);
  await page.evaluate(() => { globalThis.__PHASE3_RESULT__ = undefined; });
  const startedAt = Date.now();
  await page.locator("#generate").click();
  await page.waitForFunction(() => Boolean(globalThis.__PHASE3_RESULT__), undefined, { timeout: 900_000 });
  const result = await page.evaluate(() => globalThis.__PHASE3_RESULT__);
  return { ...result, elapsedMs: Date.now() - startedAt };
}

const releaseFile = path.join(root, "release", "EnglishReader.html");
const page = await readyPage(releaseFile);
await page.locator(".advanced").evaluate((details) => { details.open = true; });
await page.locator("#restore-defaults").click();
const memory = { initializedMiB: browserRssMiB(), peakStressMiB: 0, afterStressMiB: 0 };

// Parser special characters.
await page.locator("#input").fill("don't\nI'm\nI'd like to\nmother-in-law\nU.S.\nMr. Smith\nHow are you?");
const specialPreviewCount = await page.locator(".preview-item").count();

// Repeat 1/2/3 and gap timing use the same cached TTS.
const repeatDurations = {};
for (const repeat of [1, 2, 3]) {
  await page.locator(`[data-repeat="${repeat}"]`).click();
  const result = await generate(page, "environment");
  repeatDurations[repeat] = result.sampleCount / result.sampleRate;
}
await page.locator('[data-repeat="2"]').click();
await page.locator("#repeat-gap").evaluate((input) => {
  input.value = "2.2";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const widerGap = await generate(page, "environment");
const widerGapDuration = widerGap.sampleCount / widerGap.sampleRate;

// Five consecutive edited tasks.
await page.locator('[data-repeat="1"]').click();
const cycleTexts = ["environment", "comfortable", "vegetable", "interesting", "schedule"];
const cycles = [];
for (const text of cycleTexts) cycles.push(await generate(page, text));

// 100 mixed unique entries, repeated twice.
await page.locator('[data-repeat="2"]').click();
await page.locator("#repeat-gap").evaluate((input) => {
  input.value = "1.2";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const stressItems = Array.from({ length: 100 }, (_, index) => {
  const number = index + 1;
  if (index % 3 === 0) return `${number}. practice word ${number}`;
  if (index % 3 === 1) return `${number}. protect the environment number ${number}`;
  return `${number}. This is practice sentence number ${number}.`;
});
await page.locator("#input").fill(stressItems.join("\n"));
await page.evaluate(() => { globalThis.__PHASE3_RESULT__ = undefined; });
const stressStartedAt = Date.now();
await page.evaluate(() => { document.querySelector("#generate")?.click(); });
const sampler = setInterval(() => {
  memory.peakStressMiB = Math.max(memory.peakStressMiB, browserRssMiB());
}, 500);
await page.waitForFunction(() => Boolean(globalThis.__PHASE3_RESULT__), undefined, { timeout: 900_000 });
clearInterval(sampler);
memory.peakStressMiB = Math.max(memory.peakStressMiB, browserRssMiB());
memory.afterStressMiB = browserRssMiB();
const stress = await page.evaluate(() => ({
  ...globalThis.__PHASE3_RESULT__,
  finalProgress: document.querySelector("#progress-count")?.textContent,
  audioDuration: document.querySelector("#audio")?.duration,
}));
stress.elapsedMs = Date.now() - stressStartedAt;

// Path portability checks.
const chineseDirectory = path.join(root, ".cache", "教学资料", "英语跟读工具");
const spacedDirectory = path.join(root, ".cache", "My Teaching Tools", "English Reader");
await mkdir(chineseDirectory, { recursive: true });
await mkdir(spacedDirectory, { recursive: true });
const pathResults = [];
for (const directory of [chineseDirectory, spacedDirectory]) {
  const target = path.join(directory, "EnglishReader.html");
  await copyFile(releaseFile, target);
  const pathPage = await readyPage(target);
  const result = await generate(pathPage, "environment");
  pathResults.push({ directory, protocol: result.protocol, duration: result.sampleCount / result.sampleRate });
  await pathPage.close();
}

const tolerance = 1 / 24_000;
if (specialPreviewCount !== 7) throw new Error("特殊字符解析失败");
if (Math.abs(repeatDurations[2] - (repeatDurations[1] * 2 + 1.2)) > tolerance) throw new Error("重复 2 次时长错误");
if (Math.abs(repeatDurations[3] - (repeatDurations[1] * 3 + 2.4)) > tolerance) throw new Error("重复 3 次时长错误");
if (Math.abs(widerGapDuration - repeatDurations[2] - 1) > tolerance) throw new Error("停顿调整时长错误");
if (cycles.length !== 5 || cycles.some((result) => result.itemCount !== 1)) throw new Error("连续使用失败");
if (stress.itemCount !== 100 || stress.repeatCount !== 2 || stress.finalProgress !== "100 / 100") throw new Error("100 条压力测试不完整");
if (stress.wavBytes !== stress.sampleCount * 2 + 44 || !Number.isFinite(stress.audioDuration)) throw new Error("压力测试 WAV 无效");
if (pathResults.some((result) => result.protocol !== "file:" || !(result.duration > 0))) throw new Error("路径兼容测试失败");
if (networkRequests.length) throw new Error("验收期间检测到 HTTP/HTTPS 请求");

const report = {
  browser: context.browser()?.version(),
  networkRequests,
  specialPreviewCount,
  repeatDurations,
  widerGapDuration,
  cycles: cycles.map(({ elapsedMs, cacheHitCount, synthesizedItemCount }) => ({ elapsedMs, cacheHitCount, synthesizedItemCount })),
  stress,
  memory,
  pathResults,
};
await mkdir(path.join(root, "artifacts"), { recursive: true });
await writeFile(path.join(root, "artifacts", "phase5-acceptance.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await context.close();
await rm(profileDirectory, { recursive: true, force: true });
