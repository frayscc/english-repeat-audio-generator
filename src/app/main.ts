import { invoke, isTauri } from "@tauri-apps/api/core";
import { AudioProjectGenerator, ItemSynthesisError } from "../audio/projectGenerator";
import { encodePcm16Wav } from "../audio/wav";
import { DEFAULT_SETTINGS } from "../config/defaults";
import { parseInput } from "../parser/textParser";
import { KokoroEngine } from "../tts/kokoroEngine";
import { NativeTtsEngine } from "../tts/nativeEngine";
import { installOfflineResources } from "../tts/offlineResources";
import { PHASE_1_VOICES } from "../tts/voices";
import type { AudioData, TTSEngine, VoiceProfile } from "../tts/types";

declare const __TAURI_V2__: boolean;

type Locale = VoiceProfile["locale"];
interface SavedSettings {
  locale: Locale;
  voice: string;
  repeatCount: number;
  speed: number;
  repeatGapSeconds: number;
  itemGapSeconds: number;
}

const STORAGE_KEY = "english-reader-v1-settings";
const MAX_ITEMS = 100;
const MAX_CHARACTERS = 5_000;
const VOICE_SAMPLE = "Hello! This is a sample of this English voice.";

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
  defaults: element<HTMLButtonElement>("#restore-defaults"),
  generate: element<HTMLButtonElement>("#generate"),
  statusText: element<HTMLSpanElement>("#model-status-text"),
  statusDot: element<HTMLSpanElement>("#status-dot"),
  mode: element<HTMLSpanElement>("#runtime-mode"),
  message: element<HTMLDivElement>("#message"),
  progress: element<HTMLDivElement>("#generation-progress"),
  progressCount: element<HTMLSpanElement>("#progress-count"),
  progressText: element<HTMLSpanElement>("#progress-text"),
  progressBar: element<HTMLDivElement>("#progress-bar"),
  cancel: element<HTMLButtonElement>("#cancel"),
  retry: element<HTMLButtonElement>("#retry"),
  result: element<HTMLElement>("#result"),
  audio: element<HTMLAudioElement>("#audio"),
  replay: element<HTMLButtonElement>("#replay"),
  download: element<HTMLAnchorElement>("#download"),
};

const state = {
  locale: DEFAULT_SETTINGS.locale as Locale,
  voice: DEFAULT_SETTINGS.voice,
  repeatCount: DEFAULT_SETTINGS.repeatCount,
  ready: false,
  generating: false,
  previewing: false,
  controller: null as AbortController | null,
};
let modelStage = "正在准备语音模型";
const runningInTauri = (typeof __TAURI_V2__ !== "undefined" && __TAURI_V2__) || isTauri();
if (runningInTauri) void invoke("report_frontend_checkpoint", { checkpoint: "main-start" });
const cleanupOfflineResources = runningInTauri ? () => {} : installOfflineResources();
const engine: TTSEngine & { readonly mode: "gpu" | "compatibility" } = runningInTauri
  ? new NativeTtsEngine((event) => {
      modelStage = event.stage;
      ui.mode.textContent = event.state === "generating" ? "后台生成" : "CPU 兼容模式";
    })
  : new KokoroEngine();
const projectGenerator = new AudioProjectGenerator(engine, runningInTauri ? 16 : 128);
let audioUrl: string | null = null;
let previewUrl: string | null = null;
let previewAudio: HTMLAudioElement | null = null;

function currentSettings(): SavedSettings {
  return {
    locale: state.locale,
    voice: state.voice,
    repeatCount: state.repeatCount,
    speed: Number(ui.speed.value),
    repeatGapSeconds: Number(ui.repeatGap.value),
    itemGapSeconds: Number(ui.itemGap.value),
  };
}

function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings()));
  } catch (error) {
    console.warn("无法保存设置", error);
  }
}

function loadSettings(): Partial<SavedSettings> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) as Partial<SavedSettings> : {};
  } catch (error) {
    console.warn("无法读取设置", error);
    return {};
  }
}

function setMessage(message: string, kind: "normal" | "error" = "normal"): void {
  ui.message.textContent = message;
  ui.message.dataset.kind = kind;
}

function parsedItems(): string[] {
  return parseInput(ui.input.value);
}

function validateInput(items: readonly string[]): string | null {
  if (items.length === 0) return "请先输入要朗读的英文，每行一个词条。";
  if (items.length > MAX_ITEMS) return `当前有 ${items.length} 条，最多支持 ${MAX_ITEMS} 条。建议分批生成。`;
  const characterCount = items.reduce((total, item) => total + item.length, 0);
  if (characterCount > MAX_CHARACTERS) return `当前内容约 ${characterCount} 个字符，建议精简或分批生成。`;
  return null;
}

function updateInput(): void {
  const items = parsedItems();
  ui.count.textContent = String(items.length);
  ui.count.closest(".item-stat")?.classList.toggle("warning", items.length > 60);
  renderItemPreview(items);
}

function renderItemPreview(items: readonly string[]): void {
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
    play.setAttribute("aria-label", `试听 ${text}`);
    play.textContent = "▶";
    play.addEventListener("click", () => void playPreview(text, play));
    row.append(number, copy, play);
    ui.previewList.append(row);
  });
}

function renderAccent(): void {
  for (const button of ui.accentButtons) {
    const selected = button.dataset.locale === state.locale;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

function renderVoices(): void {
  ui.voiceList.replaceChildren();
  const voices = PHASE_1_VOICES.filter((voice) => voice.locale === state.locale);
  if (!voices.some((voice) => voice.internalId === state.voice)) state.voice = voices[0]?.internalId ?? "af_heart";
  for (const voice of voices) {
    const card = document.createElement("div");
    card.className = "voice-card";
    card.classList.toggle("selected", voice.internalId === state.voice);
    const select = document.createElement("button");
    select.type = "button";
    select.className = "voice-select";
    select.setAttribute("aria-pressed", String(voice.internalId === state.voice));
    const avatar = document.createElement("span");
    avatar.className = `voice-avatar ${voice.gender}`;
    avatar.textContent = voice.name.slice(0, 1);
    const copy = document.createElement("span");
    copy.className = "voice-copy";
    const name = document.createElement("strong");
    name.textContent = voice.name;
    const description = document.createElement("small");
    description.textContent = `${voice.gender === "female" ? "女声" : "男声"} · ${voice.description}`;
    copy.append(name, description);
    select.append(avatar, copy);
    select.addEventListener("click", () => {
      state.voice = voice.internalId;
      renderVoices();
      saveSettings();
    });
    const sample = document.createElement("button");
    sample.type = "button";
    sample.className = "voice-sample";
    sample.textContent = "试听";
    sample.addEventListener("click", () => void playPreview(VOICE_SAMPLE, sample, voice.internalId));
    card.append(select, sample);
    ui.voiceList.append(card);
  }
}

function renderRepeat(): void {
  for (const button of ui.repeatButtons) {
    const selected = Number(button.dataset.repeat) === state.repeatCount;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

function updateRangeOutputs(): void {
  ui.speedValue.value = `${Number(ui.speed.value).toFixed(2)}×`;
  ui.repeatGapValue.value = `${Number(ui.repeatGap.value).toFixed(1)} 秒`;
  ui.itemGapValue.value = `${Number(ui.itemGap.value).toFixed(1)} 秒`;
}

function applySettings(settings: Partial<SavedSettings>): void {
  state.locale = settings.locale === "en-GB" ? "en-GB" : "en-US";
  const voices = PHASE_1_VOICES.filter((voice) => voice.locale === state.locale);
  state.voice = voices.some((voice) => voice.internalId === settings.voice)
    ? String(settings.voice)
    : voices[0]?.internalId ?? DEFAULT_SETTINGS.voice;
  state.repeatCount = [1, 2, 3].includes(settings.repeatCount ?? 0) ? Number(settings.repeatCount) : DEFAULT_SETTINGS.repeatCount;
  ui.speed.value = String(settings.speed ?? DEFAULT_SETTINGS.speed);
  ui.repeatGap.value = String(settings.repeatGapSeconds ?? DEFAULT_SETTINGS.repeatGapSeconds);
  ui.itemGap.value = String(settings.itemGapSeconds ?? DEFAULT_SETTINGS.itemGapSeconds);
  renderAccent();
  renderVoices();
  renderRepeat();
  updateRangeOutputs();
}

function restoreDefaults(): void {
  applySettings(DEFAULT_SETTINGS);
  saveSettings();
}

function audioDataToUrl(audio: AudioData): string {
  const wav = encodePcm16Wav(audio);
  return URL.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }));
}

async function playPreview(text: string, button: HTMLButtonElement, voice = state.voice): Promise<void> {
  if (!state.ready || state.previewing || state.generating) return;
  state.previewing = true;
  button.classList.add("playing");
  const original = button.textContent;
  const startedAt = performance.now();
  button.textContent = "生成中 0s";
  const elapsedTimer = window.setInterval(() => {
    button.textContent = `生成中 ${Math.floor((performance.now() - startedAt) / 1_000)}s`;
  }, 1_000);
  try {
    const audio = await projectGenerator.preview(text, { voice, speed: Number(ui.speed.value) });
    window.clearInterval(elapsedTimer);
    button.textContent = "播放中";
    previewAudio?.pause();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = audioDataToUrl(audio);
    previewAudio = new Audio(previewUrl);
    await previewAudio.play();
    await new Promise<void>((resolve) => {
      if (!previewAudio) return resolve();
      previewAudio.addEventListener("ended", () => resolve(), { once: true });
      previewAudio.addEventListener("error", () => resolve(), { once: true });
    });
  } catch (error) {
    setMessage(`试听失败：${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    window.clearInterval(elapsedTimer);
    state.previewing = false;
    button.classList.remove("playing");
    button.textContent = original;
  }
}

async function initialize(): Promise<void> {
  const startedAt = performance.now();
  ui.retry.hidden = true;
  ui.generate.disabled = true;
  const elapsedTimer = runningInTauri ? window.setInterval(() => {
    ui.statusText.textContent = `${modelStage} · ${Math.floor((performance.now() - startedAt) / 1_000)} 秒`;
  }, 1_000) : null;
  ui.statusText.textContent = "正在准备语音模型…";
  ui.mode.textContent = "正在检测加速模式";
  try {
    await engine.initialize();
    state.ready = true;
    ui.statusText.textContent = "语音模型已就绪";
    ui.mode.textContent = engine.mode === "gpu" ? "GPU 加速" : runningInTauri ? "原生 CPU · 后台线程" : "兼容模式";
    ui.statusDot.classList.add("ready");
    ui.generate.disabled = false;
  } catch (error) {
    ui.statusText.textContent = "语音模型准备失败";
    ui.statusDot.classList.add("error");
    setMessage(error instanceof Error ? error.message : String(error), "error");
    ui.retry.hidden = false;
  } finally {
    if (elapsedTimer !== null) window.clearInterval(elapsedTimer);
  }
}

function setProgress(completed: number, total: number, text: string): void {
  ui.progressCount.textContent = `${completed} / ${total}`;
  ui.progressText.textContent = text;
  ui.progressBar.style.width = `${total ? (completed / total) * 100 : 0}%`;
}

function exportFilename(date = new Date()): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return `英语跟读_${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}_${two(date.getHours())}${two(date.getMinutes())}.wav`;
}

async function generate(): Promise<void> {
  const items = parsedItems();
  if (!state.ready || state.generating) return;
  const validationMessage = validateInput(items);
  if (validationMessage) {
    setMessage(validationMessage, "error");
    ui.input.focus();
    return;
  }
  state.generating = true;
  state.controller = new AbortController();
  ui.generate.disabled = true;
  ui.generate.classList.add("loading");
  ui.retry.hidden = true;
  ui.progress.hidden = false;
  setProgress(0, items.length, "准备生成…");
  setMessage(`正在生成 ${items.length} 个词条…`);
  const generationStartedAt = performance.now();
  try {
    const settings = currentSettings();
    const project = await projectGenerator.generate(items, {
      voice: settings.voice,
      repeatCount: settings.repeatCount,
      speed: settings.speed,
      repeatGapSeconds: settings.repeatGapSeconds,
      itemGapSeconds: settings.itemGapSeconds,
      signal: state.controller.signal,
      onProgress(progress) {
        const elapsedSeconds = (performance.now() - generationStartedAt) / 1_000;
        const remainingSeconds = progress.completed >= 3
          ? Math.max(0, (elapsedSeconds / progress.completed) * (progress.total - progress.completed))
          : null;
        const eta = remainingSeconds === null ? "正在估算剩余时间" : `预计还需 ${Math.ceil(remainingSeconds)} 秒`;
        setProgress(progress.completed, progress.total, `${progress.text} · ${eta}`);
      },
    });
    const wav = encodePcm16Wav(project.audio);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }));
    ui.audio.src = audioUrl;
    ui.download.href = audioUrl;
    ui.download.download = exportFilename();
    ui.result.hidden = false;
    ui.progress.hidden = true;
    setMessage(`音频已生成 · ${items.length} 条 · ${(project.audio.samples.length / project.audio.sampleRate).toFixed(1)} 秒`);
    Object.assign(globalThis, {
      __PHASE3_RESULT__: {
        protocol: location.protocol,
        runtimeMode: engine.mode,
        itemCount: items.length,
        ...settings,
        synthesizedItemCount: project.synthesizedItemCount,
        cacheHitCount: project.cacheHitCount,
        sampleRate: project.audio.sampleRate,
        sampleCount: project.audio.samples.length,
        wavBytes: wav.byteLength,
        filename: ui.download.download,
      },
    });
  } catch (error) {
    ui.progress.hidden = true;
    if (error instanceof DOMException && error.name === "AbortError") {
      setMessage("已取消生成，已完成的语音缓存会保留。", "normal");
    } else if (error instanceof ItemSynthesisError) {
      setMessage(`第 ${error.index + 1} 条生成失败：${error.text}`, "error");
      ui.retry.hidden = false;
    } else {
      setMessage(`生成失败：${error instanceof Error ? error.message : String(error)}`, "error");
      ui.retry.hidden = false;
    }
  } finally {
    state.generating = false;
    state.controller = null;
    ui.generate.classList.remove("loading");
    ui.generate.disabled = !state.ready;
  }
}

ui.input.addEventListener("input", updateInput);
for (const button of ui.accentButtons) button.addEventListener("click", () => {
  state.locale = button.dataset.locale as Locale;
  renderAccent();
  renderVoices();
  saveSettings();
});
for (const button of ui.repeatButtons) button.addEventListener("click", () => {
  state.repeatCount = Number(button.dataset.repeat);
  renderRepeat();
  saveSettings();
});
for (const input of [ui.speed, ui.repeatGap, ui.itemGap]) input.addEventListener("input", () => {
  updateRangeOutputs();
  saveSettings();
});
ui.defaults.addEventListener("click", restoreDefaults);
ui.generate.addEventListener("click", () => void generate());
ui.cancel.addEventListener("click", () => {
  state.controller?.abort();
  setMessage("正在停止生成…");
});
ui.retry.addEventListener("click", () => void (state.ready ? generate() : initialize()));
ui.replay.addEventListener("click", () => {
  ui.audio.currentTime = 0;
  void ui.audio.play();
});
window.addEventListener("beforeunload", () => {
  state.controller?.abort();
  previewAudio?.pause();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  cleanupOfflineResources();
  void engine.dispose();
});

updateInput();
applySettings(loadSettings());
void initialize();
