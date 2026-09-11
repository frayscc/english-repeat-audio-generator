import { AudioProjectGenerator } from "../audio/projectGenerator";
import { encodePcm16Wav } from "../audio/wav";
import { DEFAULT_SETTINGS } from "../config/defaults";
import { parseInput } from "../parser/textParser";
import { KokoroEngine } from "../tts/kokoroEngine";
import { installOfflineResources } from "../tts/offlineResources";

function element<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing element: ${selector}`);
  return result;
}

const ui = {
  input: element<HTMLTextAreaElement>("#input"),
  repeatCount: element<HTMLSelectElement>("#repeat-count"),
  repeatGap: element<HTMLInputElement>("#repeat-gap"),
  itemGap: element<HTMLInputElement>("#item-gap"),
  speed: element<HTMLInputElement>("#speed"),
  initialize: element<HTMLButtonElement>("#initialize"),
  generate: element<HTMLButtonElement>("#generate"),
  status: element<HTMLDivElement>("#status"),
  audio: element<HTMLAudioElement>("#audio"),
  download: element<HTMLAnchorElement>("#download"),
  diagnostics: element<HTMLPreElement>("#diagnostics"),
};

const cleanupOfflineResources = installOfflineResources();
const engine = new KokoroEngine();
const projectGenerator = new AudioProjectGenerator(engine);
let audioUrl: string | null = null;
const generationHistory: unknown[] = [];

function setStatus(message: string, kind = "working"): void {
  ui.status.textContent = message;
  ui.status.dataset.kind = kind;
}

async function initialize(): Promise<void> {
  ui.initialize.disabled = true;
  setStatus("正在准备本地语音模型…");
  const startedAt = performance.now();
  try {
    await engine.initialize();
    const result = { initializeMs: Math.round(performance.now() - startedAt) };
    Object.assign(globalThis, { __PHASE1_INITIALIZE__: result });
    ui.generate.disabled = false;
    setStatus("语音模型已就绪 · 兼容模式", "ready");
  } catch (error) {
    ui.initialize.disabled = false;
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`初始化失败：${message}`, "error");
    throw error;
  }
}

async function generate(): Promise<void> {
  const items = parseInput(ui.input.value);
  if (items.length === 0) {
    setStatus("请至少输入一个有效词条。", "error");
    return;
  }
  const options = {
    voice: DEFAULT_SETTINGS.voice,
    repeatCount: Number(ui.repeatCount.value),
    speed: Number(ui.speed.value),
    repeatGapSeconds: Number(ui.repeatGap.value),
    itemGapSeconds: Number(ui.itemGap.value),
  };
  ui.generate.disabled = true;
  setStatus(`正在生成 ${items.length} 个词条…`);
  const startedAt = performance.now();
  try {
    const project = await projectGenerator.generate(items, options);
    const wav = encodePcm16Wav(project.audio);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }));
    ui.audio.src = audioUrl;
    ui.audio.hidden = false;
    ui.download.href = audioUrl;
    ui.download.hidden = false;
    const result = {
      protocol: location.protocol,
      itemCount: items.length,
      items,
      ...options,
      ...project,
      audio: undefined,
      sampleRate: project.audio.sampleRate,
      sampleCount: project.audio.samples.length,
      durationSeconds: Number((project.audio.samples.length / project.audio.sampleRate).toFixed(3)),
      wavBytes: wav.byteLength,
      generateMs: Math.round(performance.now() - startedAt),
    };
    generationHistory.push(result);
    Object.assign(globalThis, { __PHASE1_RESULT__: result, __PHASE1_HISTORY__: generationHistory });
    ui.diagnostics.textContent = JSON.stringify(result, null, 2);
    setStatus(`生成成功：${items.length} 条，${result.durationSeconds} 秒。`, "ready");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`生成失败：${message}`, "error");
    throw error;
  } finally {
    ui.generate.disabled = false;
  }
}

ui.initialize.addEventListener("click", () => void initialize());
ui.generate.addEventListener("click", () => void generate());
window.addEventListener("beforeunload", () => {
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  cleanupOfflineResources();
  void engine.dispose();
});
