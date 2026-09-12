mod native_tts;

use std::path::{Component, Path};
use tauri::{path::BaseDirectory, Manager};

#[tauri::command]
fn resolve_v2_resource(app: tauri::AppHandle, relative_path: String) -> Result<String, String> {
    let relative = Path::new(&relative_path);
    if !relative_path.starts_with("resources/")
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("invalid V2 resource path".into());
    }

    app.path()
        .resolve(relative, BaseDirectory::Resource)
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn report_resource_probe(success: bool, resource_count: u32) {
    log::info!("[v2-resource-probe] success={success} resource_count={resource_count}");
}

#[tauri::command]
fn report_tts_worker_probe(success: bool, elapsed_ms: u32, samples: u32) {
    log::info!("[v2-tts-worker-probe] success={success} elapsed_ms={elapsed_ms} samples={samples}");
}

#[tauri::command]
fn report_tts_worker_state(state: String, elapsed_ms: u32) {
    const ALLOWED: [&str; 7] = [
        "idle",
        "loading-runtime",
        "loading-model",
        "initializing",
        "ready",
        "generating",
        "error",
    ];
    if ALLOWED.contains(&state.as_str()) {
        log::info!("[v2-tts-worker-state] state={state} elapsed_ms={elapsed_ms}");
    }
}

#[tauri::command]
fn report_frontend_checkpoint(checkpoint: String) {
    const ALLOWED: [&str; 4] = [
        "main-start",
        "resources-resolved",
        "worker-created",
        "initialize-sent",
    ];
    if ALLOWED.contains(&checkpoint.as_str()) {
        log::info!("[v2-frontend] checkpoint={checkpoint}");
    }
}

#[tauri::command]
fn report_tts_diagnostic(token_count: u32, voice_samples: u32) {
    log::info!("[v2-tts-diagnostic] token_count={token_count} voice_samples={voice_samples}");
}

#[tauri::command]
fn report_tts_benchmark(metric: String, elapsed_ms: u32) {
    if ["word", "phrase", "batch50", "batch100"].contains(&metric.as_str()) {
        log::info!("[v2-tts-benchmark] metric={metric} elapsed_ms={elapsed_ms}");
    }
}

#[tauri::command]
fn report_tts_benchmark_failure(message: String) {
    log::error!(
        "[v2-tts-benchmark] failure={}",
        message.chars().take(500).collect::<String>()
    );
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(2_000_000)
                .build(),
        )
        .manage(native_tts::NativeTtsState::default())
        .invoke_handler(tauri::generate_handler![
            resolve_v2_resource,
            report_resource_probe,
            report_tts_worker_probe,
            report_tts_worker_state,
            report_frontend_checkpoint,
            report_tts_diagnostic,
            report_tts_benchmark,
            report_tts_benchmark_failure,
            native_tts::initialize_native_tts,
            native_tts::synthesize_native_tts,
            native_tts::dispose_native_tts
        ])
        .run(tauri::generate_context!())
        .expect("error while running English Reader");
}
