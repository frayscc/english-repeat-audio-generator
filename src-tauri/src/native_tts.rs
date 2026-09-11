use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Instant,
};

use ort::{session::Session, value::Tensor};
use serde::{Deserialize, Serialize};
use tauri::{ipc::Response, path::BaseDirectory, AppHandle, Manager, State};

const SAMPLE_RATE: u32 = 24_000;
const MAX_AUDIO_CACHE_ITEMS: usize = 128;
const MAX_AUDIO_CACHE_BYTES: usize = 256 * 1024 * 1024;
const VOICES: [&str; 6] = [
    "af_heart",
    "af_bella",
    "am_fenrir",
    "am_michael",
    "bf_emma",
    "bm_george",
];

pub struct NativeTts {
    session: Session,
    tokenizer: KokoroTokenizer,
    american_phonemizer: espeak_ng::EspeakNg,
    british_phonemizer: espeak_ng::EspeakNg,
    voices_directory: PathBuf,
    voice_cache: HashMap<String, Vec<f32>>,
    audio_cache: AudioCache,
}

#[derive(Clone, Hash, PartialEq, Eq)]
struct AudioCacheKey {
    phonemes: String,
    voice: String,
    speed_bits: u32,
}

#[derive(Default)]
struct AudioCache {
    entries: HashMap<AudioCacheKey, Vec<f32>>,
    order: VecDeque<AudioCacheKey>,
    bytes: usize,
}

impl AudioCache {
    fn get(&mut self, key: &AudioCacheKey) -> Option<Vec<f32>> {
        let samples = self.entries.get(key)?.clone();
        self.order.retain(|candidate| candidate != key);
        self.order.push_back(key.clone());
        Some(samples)
    }

    fn insert(&mut self, key: AudioCacheKey, samples: Vec<f32>) {
        let sample_bytes = samples.len() * size_of::<f32>();
        if sample_bytes > MAX_AUDIO_CACHE_BYTES {
            return;
        }
        if let Some(previous) = self.entries.remove(&key) {
            self.bytes = self.bytes.saturating_sub(previous.len() * size_of::<f32>());
            self.order.retain(|candidate| candidate != &key);
        }
        self.bytes += sample_bytes;
        self.entries.insert(key.clone(), samples);
        self.order.push_back(key);
        while self.entries.len() > MAX_AUDIO_CACHE_ITEMS || self.bytes > MAX_AUDIO_CACHE_BYTES {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(removed) = self.entries.remove(&oldest) {
                self.bytes = self.bytes.saturating_sub(removed.len() * size_of::<f32>());
            }
        }
    }
}

#[derive(Deserialize)]
struct TokenizerFile {
    model: TokenizerModel,
}

#[derive(Deserialize)]
struct TokenizerModel {
    vocab: HashMap<String, u32>,
}

struct KokoroTokenizer {
    vocab: HashMap<char, i64>,
}

impl KokoroTokenizer {
    fn from_file(path: &Path) -> Result<Self, String> {
        let bytes = fs::read(path).map_err(|error| format!("无法读取本地 Tokenizer：{error}"))?;
        let source: TokenizerFile = serde_json::from_slice(&bytes)
            .map_err(|error| format!("无法解析本地 Tokenizer：{error}"))?;
        let vocab = source
            .model
            .vocab
            .into_iter()
            .filter_map(|(token, id)| {
                let mut chars = token.chars();
                let character = chars.next()?;
                chars.next().is_none().then_some((character, i64::from(id)))
            })
            .collect();
        Ok(Self { vocab })
    }

    fn encode(&self, phonemes: &str) -> Vec<i64> {
        let mut ids = Vec::with_capacity(phonemes.chars().count() + 2);
        ids.push(0);
        ids.extend(
            phonemes
                .chars()
                .filter_map(|character| self.vocab.get(&character).copied()),
        );
        ids.push(0);
        ids
    }
}

#[derive(Clone, Default)]
pub struct NativeTtsState(pub Arc<Mutex<Option<NativeTts>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeInitResult {
    backend: &'static str,
    threads: usize,
    elapsed_ms: u128,
}

fn resource_path(app: &AppHandle, relative: &str) -> Result<PathBuf, String> {
    app.path()
        .resolve(format!("resources/{relative}"), BaseDirectory::Resource)
        .map_err(|error| error.to_string())
}

fn load_voice(path: &Path) -> Result<Vec<f32>, String> {
    let bytes = fs::read(path).map_err(|error| format!("无法读取本地音色：{error}"))?;
    if bytes.len() % 4 != 0 {
        return Err("本地音色数据长度无效".into());
    }
    Ok(bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|chunk| f32::from_le_bytes(*chunk))
        .collect())
}

fn prepare_phonemizer_data(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| format!("无法创建本地发音词典目录：{error}"))?;
    espeak_ng::install_bundled_languages(path, &["en"])
        .map_err(|error| format!("无法准备本地英语发音词典：{error}"))
}

fn create_phonemizer(language: &str, data_path: &Path) -> Result<espeak_ng::EspeakNg, String> {
    espeak_ng::EspeakNg::with_data_dir(language, data_path)
        .map_err(|error| format!("本地英语发音引擎初始化失败：{error}"))
}

fn post_process_phonemes(value: String, american: bool) -> String {
    let mut result = value
        .replace("kəkˈoːɹoʊ", "kˈoʊkəɹoʊ")
        .replace("kəkˈɔːɹəʊ", "kˈəʊkəɹəʊ")
        .replace('ʲ', "j")
        .replace('r', "ɹ")
        .replace('x', "k")
        .replace('ɬ', "l");
    if american {
        result = result.replace("nˈaɪnti", "nˈaɪndi");
    }
    result.trim().to_owned()
}

fn phonemize(engine: &NativeTts, text: &str, voice: &str) -> Result<String, String> {
    let american = voice.starts_with('a');
    let phonemizer = if american {
        &engine.american_phonemizer
    } else {
        &engine.british_phonemizer
    };
    let value = phonemizer
        .text_to_phonemes_phonemizer(text)
        .map_err(|error| format!("英语发音分析失败：{error}"))?;
    Ok(post_process_phonemes(value, american))
}

#[tauri::command]
pub async fn initialize_native_tts(
    app: AppHandle,
    state: State<'_, NativeTtsState>,
) -> Result<NativeInitResult, String> {
    let shared = Arc::clone(&state.0);
    let model_path = resource_path(&app, "kokoro-v1.0/onnx/model_quantized.onnx")?;
    let tokenizer_path = resource_path(&app, "kokoro-v1.0/tokenizer.json")?;
    let voices_directory = resource_path(&app, "kokoro-v1.0/voices")?;
    let phonemizer_data_path = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("espeak-ng-data-0.2.0");
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let mut guard = shared.lock().map_err(|_| "语音引擎状态锁异常")?;
        if guard.is_some() {
            return Ok(NativeInitResult {
                backend: "native-cpu",
                threads: 0,
                elapsed_ms: 0,
            });
        }
        let threads = std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1)
            .min(4);
        log::info!("[v2-native-tts] checkpoint=session-build threads={threads}");
        let session = Session::builder()
            .map_err(|error| {
                log::error!("[v2-native-tts] session-builder-error={error}");
                error.to_string()
            })?
            .with_intra_threads(threads)
            .map_err(|error| {
                log::error!("[v2-native-tts] thread-config-error={error}");
                error.to_string()
            })?
            .commit_from_file(model_path)
            .map_err(|error| {
                log::error!("[v2-native-tts] model-load-error={error}");
                format!("本地 ONNX 模型初始化失败：{error}")
            })?;
        log::info!("[v2-native-tts] checkpoint=session-ready");
        let tokenizer = KokoroTokenizer::from_file(&tokenizer_path).map_err(|error| {
            log::error!("[v2-native-tts] tokenizer-error={error}");
            format!("本地 Tokenizer 初始化失败：{error}")
        })?;
        log::info!("[v2-native-tts] checkpoint=tokenizer-ready");
        prepare_phonemizer_data(&phonemizer_data_path).map_err(|error| {
            log::error!("[v2-native-tts] phonemizer-data-error={error}");
            error
        })?;
        let american_phonemizer = create_phonemizer("en-us", &phonemizer_data_path)?;
        let british_phonemizer = create_phonemizer("en", &phonemizer_data_path)?;
        log::info!("[v2-native-tts] checkpoint=phonemizer-ready version=espeak-ng-0.2.0");
        *guard = Some(NativeTts {
            session,
            tokenizer,
            american_phonemizer,
            british_phonemizer,
            voices_directory,
            voice_cache: HashMap::new(),
            audio_cache: AudioCache::default(),
        });
        Ok(NativeInitResult {
            backend: "native-cpu",
            threads,
            elapsed_ms: started.elapsed().as_millis(),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

fn synthesize(
    engine: &mut NativeTts,
    text: &str,
    voice: &str,
    speed: f32,
) -> Result<Vec<u8>, String> {
    if !VOICES.contains(&voice) {
        return Err("不支持的本地音色".into());
    }
    if !(0.7..=1.2).contains(&speed) || !speed.is_finite() {
        return Err("朗读速度超出范围".into());
    }
    let phonemes = phonemize(engine, text, voice)?;
    let cache_key = AudioCacheKey {
        phonemes: phonemes.clone(),
        voice: voice.into(),
        speed_bits: speed.to_bits(),
    };
    if let Some(waveform) = engine.audio_cache.get(&cache_key) {
        return Ok(encode_audio_response(&waveform));
    }

    let input_ids = engine.tokenizer.encode(&phonemes);
    if input_ids.len() < 2 || input_ids.len() > 510 {
        return Err("音素 Token 数量超出模型范围".into());
    }

    if !engine.voice_cache.contains_key(voice) {
        let voice_path = engine.voices_directory.join(format!("{voice}.bin"));
        engine
            .voice_cache
            .insert(voice.into(), load_voice(&voice_path)?);
    }
    let voice_data = engine.voice_cache.get(voice).ok_or("本地音色缓存异常")?;
    let style_offset = 256 * input_ids.len().saturating_sub(2).min(509);
    let style_end = style_offset + 256;
    let style = voice_data
        .get(style_offset..style_end)
        .ok_or("本地音色数据与 Token 长度不匹配")?
        .to_vec();

    let input_ids_tensor =
        Tensor::from_array(([1usize, input_ids.len()], input_ids.into_boxed_slice()))
            .map_err(|error| error.to_string())?;
    let style_tensor = Tensor::from_array(([1usize, 256], style.into_boxed_slice()))
        .map_err(|error| error.to_string())?;
    let speed_tensor = Tensor::from_array(([1usize], vec![speed].into_boxed_slice()))
        .map_err(|error| error.to_string())?;
    let outputs = engine
        .session
        .run(ort::inputs! {
            "input_ids" => input_ids_tensor,
            "style" => style_tensor,
            "speed" => speed_tensor,
        })
        .map_err(|error| format!("本地 ONNX 推理失败：{error}"))?;
    let (_, waveform) = outputs["waveform"]
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("语音输出格式无效：{error}"))?;
    let waveform = waveform.to_vec();
    let bytes = encode_audio_response(&waveform);
    engine.audio_cache.insert(cache_key, waveform);
    Ok(bytes)
}

fn encode_audio_response(waveform: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(8 + waveform.len() * 4);
    bytes.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    bytes.extend_from_slice(&(waveform.len() as u32).to_le_bytes());
    for sample in waveform {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

#[tauri::command]
pub async fn synthesize_native_tts(
    text: String,
    voice: String,
    speed: f32,
    state: State<'_, NativeTtsState>,
) -> Result<Response, String> {
    let shared = Arc::clone(&state.0);
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let mut guard = shared.lock().map_err(|_| "语音引擎状态锁异常")?;
        let engine = guard.as_mut().ok_or("本地语音引擎尚未初始化")?;
        synthesize(engine, &text, &voice, speed).map_err(|error| {
            log::error!("[v2-native-tts] synthesis-error={error}");
            error
        })
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn dispose_native_tts(state: State<'_, NativeTtsState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "语音引擎状态锁异常")?;
    *guard = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lightweight_tokenizer_adds_boundary_tokens_and_ignores_unknowns() {
        let tokenizer = KokoroTokenizer {
            vocab: [('a', 1), ('b', 2)].into_iter().collect(),
        };
        assert_eq!(tokenizer.encode("a中b"), vec![0, 1, 2, 0]);
    }

    #[test]
    fn audio_cache_evicts_the_least_recently_used_entry() {
        let mut cache = AudioCache::default();
        for index in 0..MAX_AUDIO_CACHE_ITEMS {
            cache.insert(
                AudioCacheKey {
                    phonemes: index.to_string(),
                    voice: "af_heart".into(),
                    speed_bits: 0.9_f32.to_bits(),
                },
                vec![index as f32],
            );
        }
        let retained_key = AudioCacheKey {
            phonemes: "0".into(),
            voice: "af_heart".into(),
            speed_bits: 0.9_f32.to_bits(),
        };
        assert!(cache.get(&retained_key).is_some());
        cache.insert(
            AudioCacheKey {
                phonemes: "new".into(),
                voice: "af_heart".into(),
                speed_bits: 0.9_f32.to_bits(),
            },
            vec![1.0],
        );
        assert!(cache.entries.contains_key(&retained_key));
        assert!(!cache.entries.keys().any(|key| key.phonemes == "1"));
    }

    #[test]
    fn bundled_espeak_matches_kokoro_american_and_british_phonemes() {
        let data_path =
            std::env::temp_dir().join(format!("english-reader-espeak-test-{}", std::process::id()));
        prepare_phonemizer_data(&data_path).unwrap();
        let american = create_phonemizer("en-us", &data_path).unwrap();
        let british = create_phonemizer("en", &data_path).unwrap();
        assert_eq!(
            american
                .text_to_phonemes_phonemizer("hello teacher water")
                .unwrap(),
            "həlˈoʊ tˈiːtʃɚ wˈɔːɾɚ"
        );
        assert_eq!(
            british
                .text_to_phonemes_phonemizer("hello teacher water")
                .unwrap(),
            "həlˈəʊ tˈiːtʃə wˈɔːtə"
        );
        fs::remove_dir_all(data_path).unwrap();
    }
}
