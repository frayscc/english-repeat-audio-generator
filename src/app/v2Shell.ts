import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { DEFAULT_SETTINGS } from "../config/defaults";
import { parseInput } from "../parser/textParser";
import { PHASE_1_VOICES } from "../tts/voices";
import type { VoiceProfile } from "../tts/types";

type Locale = VoiceProfile["locale"];

function element<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing element: ${selector}`);
  return result;
}

const ui = {
  input: element<HTMLTextAreaElement>("#input"),
  count: element<HTMLSpanElement>("#item-count"),
  previewList: element<HTMLDivElement>("#item-preview"),
  accentButtons: Array.from(document.querySelectorAll<HTMLButtonElement>("[data-locale]")),
  voiceList: element<HTMLDivElement>("#voice-list"),
  repeatButtons: Array.from(document.querySelectorAll<HTMLButtonElement>("[data-repeat]")),
  speed: element<HTMLInputElement>("#speed"),
  speedValue: element<HTMLOutputElement>("#speed-value"),
  repeatGap: element<HTMLInputElement>("#repeat-gap"),
  repeatGapValue: element<HTMLOutputElement>("#repeat-gap-value"),
  itemGap: element<HTMLInputElement>("#item-gap"),
  itemGapValue: element<HTMLOutputElement>("#item-gap-value"),
  generate: element<HTMLButtonElement>("#generate"),
  statusText: element<HTMLSpanElement>("#model-status-text"),
  statusDot: element<HTMLSpanElement>("#status-dot"),
  mode: element<HTMLSpanElement>("#runtime-mode"),
  message: element<HTMLDivElement>("#message"),
};

let locale: Locale = DEFAULT_SETTINGS.locale;
let voice = DEFAULT_SETTINGS.voice;
let repeatCount = DEFAULT_SETTINGS.repeatCount;

function renderItems(): void {
  const items = parseInput(ui.input.value);
  ui.count.textContent = String(items.length);
  ui.previewList.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "preview-empty";
    empty.textContent = "清理后的词条会显示在这里";
    ui.previewList.append(empty);
    return;
  }
  items.forEach((text, index) => {
    const row = document.createElement("div");
    row.className = "preview-item";
    const number = document.createElement("span");
    number.className = "preview-number";
    number.textContent = String(index + 1);
    const copy = document.createElement("span");
    copy.className = "preview-text";
    copy.textContent = text;
    const play = document.createElement("button");
    play.type = "button";
    play.className = "preview-play";
    play.disabled = true;
    play.textContent = "▶";
    row.append(number, copy, play);
    ui.previewList.append(row);
  });
}

function renderAccent(): void {
  for (const button of ui.accentButtons) {
    const selected = button.dataset.locale === locale;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

function renderVoices(): void {
  ui.voiceList.replaceChildren();
  const voices = PHASE_1_VOICES.filter((candidate) => candidate.locale === locale);
  if (!voices.some((candidate) => candidate.internalId === voice)) voice = voices[0]?.internalId ?? DEFAULT_SETTINGS.voice;
  for (const profile of voices) {
    const card = document.createElement("div");
    card.className = "voice-card";
    card.classList.toggle("selected", profile.internalId === voice);
    const select = document.createElement("button");
    select.type = "button";
    select.className = "voice-select";
    const avatar = document.createElement("span");
    avatar.className = `voice-avatar ${profile.gender}`;
    avatar.textContent = profile.name.slice(0, 1);
    const copy = document.createElement("span");
    copy.className = "voice-copy";
    const name = document.createElement("strong");
    name.textContent = profile.name;
    const description = document.createElement("small");
    description.textContent = `${profile.gender === "female" ? "女声" : "男声"} · ${profile.description}`;
    copy.append(name, description);
    select.append(avatar, copy);
    select.addEventListener("click", () => {
      voice = profile.internalId;
      renderVoices();
    });
    const sample = document.createElement("button");
    sample.type = "button";
    sample.className = "voice-sample";
    sample.disabled = true;
    sample.textContent = "试听";
    card.append(select, sample);
    ui.voiceList.append(card);
  }
}

function updateRanges(): void {
  ui.speedValue.value = `${Number(ui.speed.value).toFixed(2)}×`;
  ui.repeatGapValue.value = `${Number(ui.repeatGap.value).toFixed(1)} 秒`;
  ui.itemGapValue.value = `${Number(ui.itemGap.value).toFixed(1)} 秒`;
}

ui.input.addEventListener("input", renderItems);
ui.accentButtons.forEach((button) => button.addEventListener("click", () => {
  locale = button.dataset.locale as Locale;
  renderAccent();
  renderVoices();
}));
ui.repeatButtons.forEach((button) => button.addEventListener("click", () => {
  repeatCount = Number(button.dataset.repeat);
  ui.repeatButtons.forEach((candidate) => candidate.classList.toggle("selected", Number(candidate.dataset.repeat) === repeatCount));
}));
[ui.speed, ui.repeatGap, ui.itemGap].forEach((input) => input.addEventListener("input", updateRanges));

interface ResourceManifest {
  schemaVersion: number;
  model: { id: string; version: string; defaultDtype: string; sampleRate: number };
  networkPolicy: string;
  resources: Array<{ id: string; path: string; bytes: number; sha256: string; type: string }>;
}

async function resourceUrl(relativePath: string): Promise<string> {
  const absolutePath = await invoke<string>("resolve_v2_resource", {
    relativePath: `resources/${relativePath}`,
  });
  return convertFileSrc(absolutePath);
}

async function verifyExternalResources(): Promise<void> {
  ui.statusText.textContent = "正在检查本地资源清单…";
  ui.mode.textContent = "V2 · 外部资源";
  ui.generate.disabled = true;
  if (!isTauri()) {
    ui.statusText.textContent = "桌面应用壳预览";
    ui.message.textContent = "请通过 npm run tauri dev 验证本地模型资源";
    return;
  }
  try {
    const manifestResponse = await fetch(await resourceUrl("resource-manifest.json"));
    if (!manifestResponse.ok) throw new Error(`资源清单读取失败 (${manifestResponse.status})`);
    const manifest = await manifestResponse.json() as ResourceManifest;
    const configResponse = await fetch(await resourceUrl("kokoro-v1.0/config.json"));
    if (!configResponse.ok) throw new Error(`模型配置读取失败 (${configResponse.status})`);
    const modelConfig = await configResponse.json() as { model_type?: string };
    if (manifest.schemaVersion !== 1 || manifest.resources.length < 13) throw new Error("资源清单不完整");

    ui.statusText.textContent = "桌面壳与本地资源已就绪";
    ui.statusDot.classList.add("ready");
    ui.message.textContent = `已验证 ${manifest.resources.length} 个外部资源；下一阶段接入后台 TTS Worker`;
    Object.assign(globalThis, {
      __ENGLISH_READER_V2_SHELL__: {
        ready: true,
        protocol: location.protocol,
        userAgent: navigator.userAgent,
        resourceCount: manifest.resources.length,
        networkPolicy: manifest.networkPolicy,
        model: manifest.model,
        modelType: modelConfig.model_type ?? "unknown",
      },
    });
    await invoke("report_resource_probe", { success: true, resourceCount: manifest.resources.length });
  } catch (error) {
    ui.statusText.textContent = "本地资源检查失败";
    ui.statusDot.classList.add("error");
    ui.message.textContent = error instanceof Error ? error.message : String(error);
    ui.message.dataset.kind = "error";
    await invoke("report_resource_probe", { success: false, resourceCount: 0 }).catch(() => undefined);
  }
}

renderItems();
renderAccent();
renderVoices();
updateRanges();
void verifyExternalResources();
