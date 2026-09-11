import { chromium } from "playwright";
import path from "node:path";
import { pathToFileURL } from "node:url";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const inputFilename = process.env.PHASE0_INPUT ?? "test.html";
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const context = await browser.newContext();
await context.setOffline(true);
const networkRequests = [];
await context.route(/^https?:\/\//, async (route) => {
  networkRequests.push(route.request().url());
  await route.abort("blockedbyclient");
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");
page.on("console", (message) => console.log(`[browser:${message.type()}] ${message.text()}`));
page.on("pageerror", (error) => console.error(`[browser:error] ${error.stack ?? error.message}`));

const heapUsedMiB = async () => {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const value = metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0;
  return Number((value / 1024 / 1024).toFixed(1));
};

const memory = { afterLoadMiB: 0, afterInitializeMiB: 0, afterGenerateMiB: 0 };
const fileUrl = pathToFileURL(path.join(process.cwd(), inputFilename)).href;
await page.goto(fileUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
memory.afterLoadMiB = await heapUsedMiB();
await page.locator("#initialize").click();
await page.locator("#generate:not([disabled])").waitFor({ timeout: 300_000 });
memory.afterInitializeMiB = await heapUsedMiB();
await page.locator("#generate").click();
await page.locator("#audio:not([hidden])").waitFor({ timeout: 180_000 });
await page.locator("#generate:not([disabled])").waitFor({ timeout: 180_000 });
await page.locator("#generate").click();
await page.waitForFunction(
  () => globalThis.__PHASE0_RESULT__?.generationRunsMs?.length === 2,
  undefined,
  { timeout: 180_000 },
);
memory.afterGenerateMiB = await heapUsedMiB();

const result = await page.evaluate(() => ({
  diagnostics: globalThis.__PHASE0_RESULT__,
  audioSource: document.querySelector("#audio").src,
  status: document.querySelector("#status").textContent,
  audioDuration: document.querySelector("#audio").duration,
}));
console.log(JSON.stringify({ browser: await browser.version(), inputFilename, ...result, memory, networkRequests }, null, 2));
if (networkRequests.length) throw new Error("检测到 HTTP/HTTPS 请求");
if (result.diagnostics?.protocol !== "file:") throw new Error("测试未在 file:// 下运行");
if (!(result.diagnostics?.durationSeconds > 0)) throw new Error("未生成有效音频");
await browser.close();
