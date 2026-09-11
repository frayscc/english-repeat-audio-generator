import { chromium } from "playwright";
import path from "node:path";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext();
await context.setOffline(true);
const networkRequests = [];
await context.route(/^https?:\/\//, async (route) => {
  networkRequests.push(route.request().url());
  await route.abort("blockedbyclient");
});
const page = await context.newPage();
page.on("console", (message) => console.log(`[browser:${message.type()}] ${message.text()}`));
page.on("pageerror", (error) => console.error(`[browser:error] ${error.stack ?? error.message}`));

await page.goto(pathToFileURL(path.join(process.cwd(), "phase1.html")).href, {
  waitUntil: "domcontentloaded",
  timeout: 120_000,
});
await page.locator("#initialize").click();
await page.locator("#generate:not([disabled])").waitFor({ timeout: 300_000 });
await page.locator("#generate").click();
await page.waitForFunction(() => globalThis.__PHASE1_HISTORY__?.length === 1, undefined, { timeout: 240_000 });
await page.locator("#generate").click();
await page.waitForFunction(() => globalThis.__PHASE1_HISTORY__?.length === 2, undefined, { timeout: 30_000 });
await page.waitForFunction(() => Number.isFinite(document.querySelector("#audio")?.duration), undefined, { timeout: 30_000 });

const result = await page.evaluate(() => ({
  initialize: globalThis.__PHASE1_INITIALIZE__,
  history: globalThis.__PHASE1_HISTORY__,
  audioDuration: document.querySelector("#audio").duration,
  status: document.querySelector("#status").textContent,
}));
console.log(JSON.stringify({ browser: await browser.version(), ...result, networkRequests }, null, 2));
if (networkRequests.length) throw new Error("检测到 HTTP/HTTPS 请求");
const first = result.history?.[0];
const second = result.history?.[1];
if (first?.protocol !== "file:") throw new Error("测试未在 file:// 下运行");
if (first?.itemCount !== 2 || first?.synthesizedItemCount !== 2) throw new Error("首次 TTS 条目数不正确");
if (second?.cacheHitCount !== 2 || second?.synthesizedItemCount !== 0) throw new Error("任务缓存未复用");
if (!Number.isFinite(result.audioDuration) || Math.abs(result.audioDuration - first.durationSeconds) > 0.001) throw new Error("播放器时长与 PCM 时长不一致");
if (first.wavBytes !== first.sampleCount * 2 + 44) throw new Error("WAV 字节数不正确");
await browser.close();
