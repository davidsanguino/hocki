// Descargas grandes y de una sola vez (el "oído" y la "voz" de Hocki): siempre con permiso
// de la persona, desde direcciones fijas en el código, con progreso visible y a un archivo
// temporal que solo se da por bueno si llegó completo.

use std::io::Write;
use std::path::Path;
use std::time::Duration;

use reqwest::Url;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub label: String,
    pub done: u64,
    pub total: u64,
}

/// Solo estos servidores: los modelos vienen de Hugging Face y los programas de GitHub.
fn allowed(url: &Url) -> bool {
    url.scheme() == "https"
        && matches!(url.host_str(), Some("huggingface.co") | Some("github.com"))
}

/// Descarga `url` a `dest`. `min_bytes` descarta respuestas que no son el archivo (páginas de error).
pub async fn fetch(app: &AppHandle, url: &str, dest: &Path, label: &str, min_bytes: u64) -> Result<(), String> {
    let url = Url::parse(url).map_err(|e| e.to_string())?;
    if !allowed(&url) {
        return Err("Dirección de descarga no permitida.".to_string());
    }
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let client = crate::net::client(&url, Duration::from_secs(60 * 30))?;
    let mut response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|e| format!("No pude conectarme para descargar: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("La descarga falló ({}).", response.status()));
    }
    let total = response.content_length().unwrap_or(0);
    let part = dest.with_extension("part");
    let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut done: u64 = 0;
    let mut last_emit: u64 = 0;
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("La descarga se cortó: {e}"))? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        done += chunk.len() as u64;
        if done - last_emit > 1_000_000 || (total > 0 && done == total) {
            last_emit = done;
            let _ = app.emit("download-progress", Progress { label: label.to_string(), done, total });
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    if done < min_bytes || (total > 0 && done != total) {
        let _ = std::fs::remove_file(&part);
        return Err("La descarga llegó incompleta. Inténtalo otra vez.".to_string());
    }
    std::fs::rename(&part, dest).map_err(|e| e.to_string())?;
    Ok(())
}

/// Base64 → bytes (el audio llega así desde la página).
pub fn base64_decode(s: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a' + 26) as u32,
            b'0'..=b'9' => (c - b'0' + 52) as u32,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        })
    }
    let bytes: Vec<u8> = s.bytes().filter(|c| !c.is_ascii_whitespace()).collect();
    let trimmed: Vec<u8> = bytes.iter().copied().take_while(|&c| c != b'=').collect();
    let mut out = Vec::with_capacity(trimmed.len() * 3 / 4);
    let mut acc: u32 = 0;
    let mut bits = 0;
    for c in trimmed {
        acc = (acc << 6) | val(c)?;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trip() {
        for sample in [&b""[..], b"a", b"ab", b"abc", b"hola hocki \x00\xff"] {
            let enc = crate::claude::base64_for(sample);
            assert_eq!(base64_decode(&enc).unwrap(), sample);
        }
        assert!(base64_decode("@@@").is_none());
    }

    #[test]
    fn only_the_two_known_hosts() {
        assert!(allowed(&Url::parse("https://huggingface.co/x").unwrap()));
        assert!(allowed(&Url::parse("https://github.com/x").unwrap()));
        assert!(!allowed(&Url::parse("http://huggingface.co/x").unwrap()));
        assert!(!allowed(&Url::parse("https://evil.example/x").unwrap()));
    }
}
