// El ayudante de pantalla: Hocki mira la pantalla, la IA que TÚ elegiste en Ajustes (Claude,
// OpenAI, Gemini, OpenRouter o un modelo local con Ollama / LM Studio) decide el siguiente paso,
// y Hocki lo hace con el mouse o el teclado. El ciclo y los frenos (permiso por programa, pasos
// máximos, preguntar antes de lo delicado, «Hocki fuera») viven en src/hocki/screen-agent.ts.
//
// La captura se guarda un momento en la bandeja de entrada de Hocki (solo esa carpeta puede
// viajar a un proveedor), se envía con la pregunta y se borra enseguida.

use serde::Serialize;
use tauri::State;

use crate::chat::{self, ChatContext};
use crate::Shared;

const SHOT_NAME: &str = "hocki-pantalla.png";

#[derive(Serialize, Clone, Copy, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Tamaño de la imagen que ve la IA.
    pub width: u32,
    pub height: u32,
    /// Imagen = pantalla × scale.
    pub scale: f64,
    /// Esquina de la pantalla principal (coordenadas físicas).
    pub left: i32,
    pub top: i32,
}

fn shot_path() -> std::path::PathBuf {
    crate::files::inbox_dir().join(SHOT_NAME)
}

#[cfg(windows)]
const HELPER: &str = r#"
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class HockiInput{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint dx,uint dy,int d,UIntPtr e);}'
[void][HockiInput]::SetProcessDPIAware()
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
"#;

#[cfg(windows)]
const SNAP: &str = r#"
try {
  $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height
  $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size); $g.Dispose()
  $scale=[Math]::Min(1.0, 1280.0/$b.Width)
  $w=[int]($b.Width*$scale); $h=[int]($b.Height*$scale)
  $out=New-Object System.Drawing.Bitmap $w,$h
  $g2=[System.Drawing.Graphics]::FromImage($out)
  $g2.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($bmp,0,0,$w,$h); $g2.Dispose(); $bmp.Dispose()
  $out.Save($env:HOCKI_OUT,[System.Drawing.Imaging.ImageFormat]::Png); $out.Dispose()
  $inv=[Globalization.CultureInfo]::InvariantCulture
  [Console]::WriteLine('OK|'+$w+'|'+$h+'|'+$scale.ToString($inv)+'|'+$b.Left+'|'+$b.Top)
} catch { [Console]::WriteLine('ERR') }
"#;

#[cfg(windows)]
const INPUT: &str = r#"
try {
  $x=[int]$env:HOCKI_X; $y=[int]$env:HOCKI_Y
  function Click([uint32]$down,[uint32]$up){ [HockiInput]::mouse_event($down,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [HockiInput]::mouse_event($up,0,0,0,[UIntPtr]::Zero) }
  switch($env:HOCKI_A){
    'move'   { [void][HockiInput]::SetCursorPos($x,$y) }
    'click'  { [void][HockiInput]::SetCursorPos($x,$y); Start-Sleep -Milliseconds 80; Click 2 4 }
    'double' { [void][HockiInput]::SetCursorPos($x,$y); Start-Sleep -Milliseconds 80; Click 2 4; Start-Sleep -Milliseconds 90; Click 2 4 }
    'right'  { [void][HockiInput]::SetCursorPos($x,$y); Start-Sleep -Milliseconds 80; Click 8 16 }
    'scroll' { [void][HockiInput]::SetCursorPos($x,$y); [HockiInput]::mouse_event(2048,0,0,[int]$env:HOCKI_T*120,[UIntPtr]::Zero) }
    'keys'   { [System.Windows.Forms.SendKeys]::SendWait($env:HOCKI_T) }
  }
  [Console]::WriteLine('OK')
} catch { [Console]::WriteLine('ERR') }
"#;

#[cfg(windows)]
fn powershell(script: &str, envs: &[(&str, String)]) -> String {
    use std::process::{Command, Stdio};
    let full = format!("{HELPER}{script}");
    let utf16: Vec<u8> = full.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &crate::claude::base64_for(&utf16)])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    for (k, v) in envs {
        cmd.env(k, v);
    }
    match crate::platform::no_console(&mut cmd).output() {
        Ok(out) => String::from_utf8_lossy(&out.stdout).trim().to_string(),
        Err(_) => String::new(),
    }
}

/// "OK|w|h|scale|left|top" → Snapshot.
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_snap(line: &str) -> Option<Snapshot> {
    let rest = line.lines().find(|l| l.starts_with("OK|"))?.strip_prefix("OK|")?;
    let p: Vec<&str> = rest.split('|').collect();
    if p.len() != 5 {
        return None;
    }
    Some(Snapshot {
        width: p[0].trim().parse().ok()?,
        height: p[1].trim().parse().ok()?,
        scale: p[2].trim().replace(',', ".").parse().ok()?,
        left: p[3].trim().parse().ok()?,
        top: p[4].trim().parse().ok()?,
    })
}

/// Toma una captura de la pantalla principal (máx. 1280 px de ancho) para el siguiente paso.
#[tauri::command]
pub async fn agent_snapshot() -> Result<Snapshot, String> {
    #[cfg(windows)]
    {
        let path = shot_path();
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let out = tauri::async_runtime::spawn_blocking(move || {
            powershell(SNAP, &[("HOCKI_OUT", path.to_string_lossy().to_string())])
        })
        .await
        .unwrap_or_default();
        return parse_snap(&out).ok_or_else(|| "No pude ver la pantalla.".to_string());
    }
    #[cfg(not(windows))]
    {
        Err("Ver la pantalla solo está disponible en Windows por ahora.".to_string())
    }
}

/// Le pregunta a la IA elegida en Ajustes qué hacer, con la última captura. La captura se borra después.
#[tauri::command]
pub async fn agent_think(shared: State<'_, Shared>, prompt: String) -> Result<String, String> {
    let settings = shared.settings.lock().unwrap().clone();
    let path = shot_path();
    if !path.exists() {
        return Err("No hay captura de pantalla.".to_string());
    }
    let context = ChatContext::File { name: SHOT_NAME.to_string(), path: path.to_string_lossy().to_string() };
    let reply = chat::send_agent(&settings, prompt, context).await;
    let _ = std::fs::remove_file(&path);
    reply.map(|r| r.text)
}

/// Borra la captura si quedó alguna (al detener el ayudante).
#[tauri::command]
pub fn agent_forget() {
    let _ = std::fs::remove_file(shot_path());
}

/// Mouse y teclado: kind = move | click | double | right | scroll (text = cuántas muescas) | keys (formato SendKeys).
#[tauri::command]
pub async fn agent_input(kind: String, x: i32, y: i32, text: String) -> bool {
    if !["move", "click", "double", "right", "scroll", "keys"].contains(&kind.as_str()) || text.chars().count() > 2000 {
        return false;
    }
    #[cfg(windows)]
    {
        let out = tauri::async_runtime::spawn_blocking(move || {
            powershell(INPUT, &[("HOCKI_A", kind), ("HOCKI_X", x.to_string()), ("HOCKI_Y", y.to_string()), ("HOCKI_T", text)])
        })
        .await
        .unwrap_or_default();
        return out.contains("OK");
    }
    #[cfg(not(windows))]
    {
        let _ = (x, y);
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_snapshot_line_is_read_whatever_the_decimal_mark() {
        let s = parse_snap("OK|1280|720|0.6666|0|0").unwrap();
        assert_eq!((s.width, s.height, s.left, s.top), (1280, 720, 0, 0));
        assert!((s.scale - 0.6666).abs() < 1e-9);
        assert!((parse_snap("OK|1280|720|0,5|-1920|0").unwrap().scale - 0.5).abs() < 1e-9);
        assert!(parse_snap("ERR").is_none());
        assert!(parse_snap("OK|1|2").is_none());
    }
}
