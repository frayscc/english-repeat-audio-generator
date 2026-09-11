import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import path from "node:path";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await context.setOffline(true);
const networkRequests = [];
await context.route(/^https?:\/\//, async (route) => {
  networkRequests.push(route.request().url());
  await route.abort("blockedbyclient");
});
const page = await context.newPage();
page.on("pageerror", (error) => console.error(`[browser:error] ${error.stack ?? error.message}`));
await page.goto(pathToFileURL(path.join(process.cwd(), "EnglishReader.html")).href, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.locator("#generate:not([disabled])").waitFor({ timeout: 300_000 });

const initial = await page.evaluate(() => ({
  itemCount: document.querySelector("#item-count")?.textContent,
  voiceCount: document.querySelectorAll(".voice-card").length,
  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  title: document.title,
}));
if (initial.itemCount !== "5" || initial.voiceCount !== 4 || initial.horizontalOverflow) throw new Error("默认 UI 状态不正确");
await page.locator('[data-locale="en-GB"]').click();
if (await page.locator(".voice-card").count() !== 2) throw new Error("英式音色筛选不正确");
await page.locator("#input").fill("1. environment\n2、protect the environment");
await page.locator("#generate").click();
await page.waitForFunction(() => Boolean(globalThis.__PHASE3_RESULT__), undefined, { timeout: 240_000 });
await page.waitForFunction(() => Number.isFinite(document.querySelector("#audio")?.duration), undefined, { timeout: 30_000 });
const result = await page.evaluate(() => ({
  app: globalThis.__PHASE3_RESULT__,
  duration: document.querySelector("#audio").duration,
  downloadProtocol: new URL(document.querySelector("#download").href).protocol,
  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}));
await mkdir(path.join(process.cwd(), "artifacts"), { recursive: true });
await page.screenshot({ path: path.join(process.cwd(), "artifacts", "phase2-1280x720.png"), fullPage: true });
console.log(JSON.stringify({ browser: await browser.version(), initial, result, networkRequests }, null, 2));
if (networkRequests.length || result.app?.protocol !== "file:") throw new Error("离线 file:// 验证失败");
if (result.app?.locale !== "en-GB" || result.app?.voice !== "bf_emma") throw new Error("口音与音色选择未接入引擎");
if (result.app?.itemCount !== 2 || result.app?.wavBytes !== result.app?.sampleCount * 2 + 44) throw new Error("WAV 输出不正确");
if (!Number.isFinite(result.duration) || result.downloadProtocol !== "blob:" || result.horizontalOverflow) throw new Error("播放器、下载或响应式验证失败");
await browser.close();
