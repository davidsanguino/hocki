// La voz natural de Hocki: Piper (síntesis neuronal que corre en el equipo, sin internet una
// vez descargada). La página reproduce el audio con el "toque Hocki" (un poco más agudo y vivo),
// así suena distinto a cualquier voz del sistema.
//
// Piper (MIT) es de Rhasspy; la voz es es_MX "ald" (licencia en su MODEL_CARD, pensada para
// investigación: antes de vender Hocki hay que revisarla o entrenar una voz propia).

use std::path::PathBuf;

use serde::Serialize;
use tauri::AppHandle;

const PIPER_ZIP: &str = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";
const VOICE: &str = "es_MX-ald-medium";
const VOICE_URL: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_MX/ald/medium/";

fn dir() -> PathBuf {
    crate::settings::local_dir().join("voice")
}
fn exe() -> PathBuf {
    dir().join("piper").join("piper.exe")
}
fn model() -> PathBuf {
    dir().join(format!("{VOICE}.onnx"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub ready: bool,
    pub supported: bool,
}

#[tauri::command]
pub fn natural_voice_status() -> VoiceStatus {
    let ready = exe().exists()
        && std::fs::metadata(model()).map(|m| m.len() > 10_000_000).unwrap_or(false)
        && dir().join(format!("{VOICE}.onnx.json")).exists();
    VoiceStatus { ready, supported: cfg!(windows) }
}

/// Descarga Piper (~21 MB) y la voz (~63 MB). Solo con el permiso de la persona.
#[tauri::command]
pub async fn natural_voice_download(app: AppHandle) -> Result<(), String> {
    if !cfg!(windows) {
        return Err("La voz natural por ahora solo está en Windows.".to_string());
    }
    let d = dir();
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    if !exe().exists() {
        let zip = d.join("piper.zip");
        crate::downloads::fetch(&app, PIPER_ZIP, &zip, "voz", 5_000_000).await?;
        unzip(&zip, &d)?;
        let _ = std::fs::remove_file(&zip);
        if !exe().exists() {
            return Err("No pude preparar el motor de voz.".to_string());
        }
    }
    let json = d.join(format!("{VOICE}.onnx.json"));
    if !json.exists() {
        crate::downloads::fetch(&app, &format!("{VOICE_URL}{VOICE}.onnx.json"), &json, "voz", 1_000).await?;
    }
    if !natural_voice_status().ready {
        crate::downloads::fetch(&app, &format!("{VOICE_URL}{VOICE}.onnx"), &model(), "voz", 30_000_000).await?;
    }
    Ok(())
}

#[cfg(windows)]
fn unzip(zip: &std::path::Path, into: &std::path::Path) -> Result<(), String> {
    use std::process::{Command, Stdio};
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
        "Expand-Archive -LiteralPath $env:HOCKI_ZIP -DestinationPath $env:HOCKI_DIR -Force"])
        .env("HOCKI_ZIP", zip)
        .env("HOCKI_DIR", into)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let ok = crate::platform::no_console(&mut cmd).status().map(|s| s.success()).unwrap_or(false);
    if ok { Ok(()) } else { Err("No pude descomprimir el motor de voz.".to_string()) }
}

#[cfg(not(windows))]
fn unzip(_zip: &std::path::Path, _into: &std::path::Path) -> Result<(), String> {
    Err("Solo en Windows.".to_string())
}

/// Texto → WAV (en base64) con la voz natural. `speed`: 1 normal, >1 más rápido.
#[tauri::command]
pub async fn natural_voice_speak(text: String, speed: f32) -> Result<String, String> {
    let text: String = text
        .chars()
        .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
        .filter(|c| !c.is_control())
        .take(700)
        .collect();
    if text.trim().is_empty() {
        return Err("Sin texto.".to_string());
    }
    if !natural_voice_status().ready {
        return Err("no-voice".to_string());
    }
    let length_scale = (1.0 / speed.clamp(0.6, 1.6)).to_string();
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let out = std::env::temp_dir().join(format!("hocki-voz-{}.wav", std::process::id()));
        let mut cmd = Command::new(exe());
        cmd.arg("--model").arg(model())
            .arg("--output_file").arg(&out)
            .args(["--length_scale", &length_scale, "--sentence_silence", "0.12"])
            .current_dir(dir().join("piper"))
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = crate::platform::no_console(&mut cmd).spawn().map_err(|e| e.to_string())?;
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(text.as_bytes());
            let _ = stdin.write_all(b"\n");
        }
        let status = child.wait().map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("La voz natural falló.".to_string());
        }
        let bytes = std::fs::read(&out).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&out);
        Ok(crate::claude::base64_for(&bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}
