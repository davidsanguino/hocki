// El oído propio de Hocki: reconocimiento de voz en el equipo con Whisper (whisper.cpp), sin
// internet una vez descargado el modelo y sin depender del idioma de voz de Windows.
//
// La página graba con permiso del micrófono, corta cada frase (cuando hay voz) y la manda aquí
// como audio de 16 kHz. Aquí se transcribe y se devuelve el texto. El audio no se guarda.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::AppHandle;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// (clave, archivo, MB aproximados). "base" basta para órdenes; "small" entiende mejor frases largas.
const MODELS: &[(&str, &str, u64)] = &[("base", "ggml-base-q5_1.bin", 57), ("small", "ggml-small-q5_1.bin", 181)];
const BASE_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";

static CTX: Mutex<Option<(String, Arc<WhisperContext>)>> = Mutex::new(None);

fn models_dir() -> PathBuf {
    crate::settings::local_dir().join("models")
}

fn model_file(key: &str) -> Option<(&'static str, u64)> {
    MODELS.iter().find(|m| m.0 == key).map(|m| (m.1, m.2))
}

/// El mejor modelo ya descargado (small antes que base).
fn installed() -> Option<(String, PathBuf)> {
    for key in ["small", "base"] {
        let (file, _) = model_file(key)?;
        let path = models_dir().join(file);
        if std::fs::metadata(&path).map(|m| m.len() > 10_000_000).unwrap_or(false) {
            return Some((key.to_string(), path));
        }
    }
    None
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SttStatus {
    pub ready: bool,
    pub model: Option<String>,
}

#[tauri::command]
pub fn stt_status() -> SttStatus {
    let m = installed();
    SttStatus { ready: m.is_some(), model: m.map(|(k, _)| k) }
}

/// Descarga el modelo elegido ("base" o "small"). Solo se llama con el permiso de la persona.
#[tauri::command]
pub async fn stt_download(app: AppHandle, model: String) -> Result<(), String> {
    let (file, mb) = model_file(&model).ok_or("Modelo desconocido.")?;
    let dest = models_dir().join(file);
    crate::downloads::fetch(&app, &format!("{BASE_URL}{file}"), &dest, "oido", mb * 1_000_000 / 2).await?;
    *CTX.lock().unwrap() = None; // que el siguiente uso cargue el nuevo
    Ok(())
}

fn context() -> Result<Arc<WhisperContext>, String> {
    let (key, path) = installed().ok_or("no-model")?;
    let mut guard = CTX.lock().unwrap();
    if let Some((k, ctx)) = guard.as_ref() {
        if *k == key {
            return Ok(ctx.clone());
        }
    }
    let ctx = WhisperContext::new_with_params(&path, WhisperContextParameters::default())
        .map_err(|e| format!("No pude cargar el oído de Hocki: {e}"))?;
    let ctx = Arc::new(ctx);
    *guard = Some((key, ctx.clone()));
    Ok(ctx)
}

/// Audio PCM de 16 bits, 16 kHz, mono → muestras f32.
fn pcm16_to_f32(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect()
}

/// Frases que Whisper "oye" en el silencio o el ruido: se descartan.
fn is_hallucination(text: &str) -> bool {
    let lower = text.to_lowercase();
    let t = lower.trim_matches(|c: char| !c.is_alphanumeric());
    if t.is_empty() || ["gracias", "ok", "música", "musica", "aplausos", "risas", "silencio"].contains(&t) {
        return true;
    }
    t.chars().count() < 80
        && ["gracias por ver", "suscríbete", "suscribete", "subtítulos realizados", "subtitulos realizados", "amara.org", "nos vemos en el próximo"]
            .iter()
            .any(|h| t.contains(h))
}

fn transcribe_blocking(samples: Vec<f32>, prompt: String) -> Result<String, String> {
    let ctx = context()?;
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("es"));
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(1, 6) as i32;
    params.set_n_threads(threads);
    params.set_no_context(true);
    params.set_single_segment(true);
    params.set_suppress_blank(true);
    params.set_no_timestamps(true);
    params.set_no_speech_thold(0.6);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    if !prompt.is_empty() {
        params.set_initial_prompt(&prompt);
    }
    state.full(params, &samples).map_err(|e| e.to_string())?;
    let mut text = String::new();
    for seg in state.as_iter() {
        if let Ok(s) = seg.to_str_lossy() {
            text.push_str(&s);
        }
    }
    let text = text.trim().to_string();
    Ok(if is_hallucination(&text) { String::new() } else { text })
}

/// Transcribe una frase (PCM 16 bits, 16 kHz, mono, en base64). "" si no se entendió nada.
/// Error "no-model" si aún no se descargó el oído.
#[tauri::command]
pub async fn stt_transcribe(audio: String, prompt: String) -> Result<String, String> {
    let bytes = crate::downloads::base64_decode(&audio).ok_or("Audio no válido.")?;
    // Entre 0,3 y 30 segundos de audio.
    if bytes.len() < 16_000 * 2 * 3 / 10 || bytes.len() > 16_000 * 2 * 30 {
        return Ok(String::new());
    }
    let samples = pcm16_to_f32(&bytes);
    let prompt: String = prompt.chars().take(200).collect();
    tauri::async_runtime::spawn_blocking(move || transcribe_blocking(samples, prompt))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_phrases_are_dropped() {
        assert!(is_hallucination("¡Gracias por ver el video!"));
        assert!(is_hallucination("  "));
        assert!(is_hallucination("Subtítulos realizados por la comunidad de Amara.org"));
        assert!(!is_hallucination("Hey Hocki, abre Illustrator"));
        assert!(!is_hallucination("Hocki, muchas gracias por tu ayuda con el informe"));
    }

    #[test]
    fn pcm_is_read_little_endian() {
        let s = pcm16_to_f32(&[0x00, 0x40, 0x00, 0xC0]);
        assert_eq!(s, vec![0.5, -0.5]);
    }
}
