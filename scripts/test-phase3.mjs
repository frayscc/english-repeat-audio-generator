import { chromium } from "playwright";
import path from "node:path";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
await context.setOffline(true);
const networkRequests = [];
await context.route(/^https?:\/\//, async (route) => {
  networkRequests.push(route.request().url());
  await route.abort("blockedbyclient");
});
let page = await context.newPage();
page.on("pageerror", (error) => console.error(`[browser:error] ${error.stack ?? error.message}`));
const url = pathToFileURL(path.join(process.cwd(), "EnglishReader.html")).href;
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });

// Settings persist, while input text does not.
await page.locator('[data-repeat="3"]').click();
await page.locator("#speed").evaluate((input) => {
  input.value = "1";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.locator("#input").fill("this input must not persist");
const saved = await page.evaluate(() => localStorage.getItem("english-reader-v1-settings"));
if (!saved?.includes('"repeatCount":3') || saved.includes("this input")) throw new Error("设置保存范围不正确");
await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
if (!await page.locator('[data-repeat="3"]').evaluate((button) => button.classList.contains("selected"))) throw new Error("重复次数未恢复");
if (await page.locator("#input").inputValue() === "this input must not persist") throw new Error("输入内容不应保存");

await page.locator("#generate:not([disabled])").waitFor({ timeout: 300_000 });
await page.locator("#input").fill("1. environment\n2、protect the environment");
if (await page.locator(".preview-item").count() !== 2) throw new Error("词条预览未更新");

// Single-item preview primes the task cache.
const firstPreview = page.locator(".preview-play").first();
await firstPreview.click();
await page.waitForFunction(() => document.querySelector(".preview-play")?.textContent === "…", undefined, { timeout: 10_000 });
await page.waitForFunction(() => document.querySelector(".preview-play")?.textContent === "▶", undefined, { timeout: 120_000 });

await page.locator("#generate").click();
await page.waitForFunction(() => document.querySelector("#progress-count")?.textContent !== "0 / 0", undefined, { timeout: 30_000 });
await page.waitForFunction(() => Boolean(globalThis.__PHASE3_RESULT__), undefined, { timeout: 240_000 });
await page.waitForFunction(() => Number.isFinite(document.querySelector("#audio")?.duration), undefined, { timeout: 30_000 });
const result = await page.evaluate(() => ({
  app: globalThis.__PHASE3_RESULT__,
  audioDuration: document.querySelector("#audio").duration,
  downloadProtocol: new URL(document.querySelector("#download").href).protocol,
  previewCount: document.querySelectorAll(".preview-item").length,
  sampleButtonCount: document.querySelectorAll(".voice-sample").length,
  hasReplay: Boolean(document.querySelector("#replay")),
  finalProgress: document.querySelector("#progress-count")?.textContent,
  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}));
console.log(JSON.stringify({ browser: await browser.version(), result, networkRequests }, null, 2));
if (networkRequests.length || result.app?.protocol !== "file:") throw new Error("离线 file:// 验证失败");
if (result.app?.itemCount !== 2 || result.app?.repeatCount !== 3 || result.app?.speed !== 1) throw new Error("保存的设置未用于生成");
if (result.app?.synthesizedItemCount !== 1 || result.app?.cacheHitCount !== 1) throw new Error("单条试听缓存未复用");
if (!/^英语跟读_\d{4}-\d{2}-\d{2}_\d{4}\.wav$/u.test(result.app?.filename ?? "")) throw new Error("导出文件名不正确");
if (!Number.isFinite(result.audioDuration) || result.downloadProtocol !== "blob:" || result.previewCount !== 2 || !result.sampleButtonCount || !result.hasReplay || result.finalProgress !== "2 / 2" || result.horizontalOverflow) throw new Error("完整产品闭环验证失败");

// Friendly limit guard.
await page.locator("#input").fill(Array.from({ length: 101 }, (_, index) => `${index + 1}. word`).join("\n"));
await page.locator("#generate").click();
if (!/最多支持 100 条/u.test(await page.locator("#message").textContent())) throw new Error("100 条上限提示缺失");
await browser.close();
