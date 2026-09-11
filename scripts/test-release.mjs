import { readFile, stat } from "node:fs/promises";
import { chromium } from "playwright";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const bundle = await readFile(path.join(root, "dist", "release", "app.js"), "utf8");
const forbidden = /https?:\/\/|cdn\.jsdelivr|unpkg|huggingface\.co|githubusercontent|fonts\.googleapis/iu;
if (forbidden.test(bundle)) throw new Error("正式 bundle 中发现网络依赖标记");
for (const filename of ["EnglishReader.html", "README.txt", "THIRD_PARTY_LICENSES.txt"]) {
  if ((await stat(path.join(root, "release", filename))).size === 0) throw new Error(`空发行文件：${filename}`);
}

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const context = await browser.newContext();
await context.setOffline(true);
const networkRequests = [];
await context.route(/^https?:\/\//, async (route) => {
  networkRequests.push(route.request().url());
  await route.abort("blockedbyclient");
});
const page = await context.newPage();
page.on("pageerror", (error) => console.error(`[browser:error] ${error.stack ?? error.message}`));
await page.goto(pathToFileURL(path.join(root, "release", "EnglishReader.html")).href, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.locator("#generate:not([disabled])").waitFor({ timeout: 300_000 });
await page.locator("#input").fill("environment");
await page.locator("#generate").click();
await page.waitForFunction(() => Boolean(globalThis.__PHASE3_RESULT__), undefined, { timeout: 180_000 });
await page.waitForFunction(() => Number.isFinite(document.querySelector("#audio")?.duration), undefined, { timeout: 30_000 });
const result = await page.evaluate(() => ({ app: globalThis.__PHASE3_RESULT__, duration: document.querySelector("#audio").duration }));
console.log(JSON.stringify({ browser: await browser.version(), result, networkRequests }, null, 2));
if (networkRequests.length || result.app?.protocol !== "file:" || !Number.isFinite(result.duration)) throw new Error("发行版离线 Gate 失败");
await browser.close();

