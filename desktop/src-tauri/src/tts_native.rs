// La voz de Hocki en Windows: sintetizador del propio sistema (System.Speech), sin internet.
//
// El `speechSynthesis` del navegador interno (WebView2) a veces no trae voces en español o
// no suena. Aquí un proceso de PowerShell habla con las voces que Windows ya tiene
// (Configuración → Hora e idioma → Voz). Elige primero las voces latinas y de hombre
// (más cercanas a un chico joven) y sube un poco el tono para que suene juvenil y amable.
//
// (El guion no lleva comillas dobles: PowerShell las recibiría mal desde la línea de comandos.)
//
// El texto viaja por la entrada estándar (nunca dentro de la línea de comandos), así que
// ninguna comilla ni símbolo de lo que Hocki diga puede convertirse en una orden.

use std::sync::Mutex;

static CHILD: Mutex<Option<std::process::Child>> = Mutex::new(None);

/// Las voces en español instaladas, de la más adecuada a la menos.
#[cfg(windows)]
const RANK: &str = "$vs=@(); try { Add-Type -AssemblyName System.Speech; \
$s0=New-Object System.Speech.Synthesis.SpeechSynthesizer; \
$vs=@($s0.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo } | Where-Object { $_.Culture.Name -like 'es*' } | \
Sort-Object @{e={ if($_.Culture.Name -match 'es-(MX|US|CO|419|AR|CL|PE|VE)'){0}else{1} }}, @{e={ if($_.Gender -eq 'Male'){0}else{1} }}, Name) } catch { }; ";

#[cfg(windows)]
fn speak_script() -> String {
    format!(
        "[Console]::InputEncoding=[Text.Encoding]::UTF8; [Console]::OutputEncoding=[Text.Encoding]::UTF8; \
$i=0; [void][int]::TryParse([Console]::In.ReadLine(),[ref]$i); $t=[Console]::In.ReadToEnd(); \
{RANK}\
try {{ $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Volume=95; \
if($vs.Count -gt 0){{ if($i -lt 0 -or $i -ge $vs.Count){{ $i=0 }}; $v=$vs[$i]; $s.SelectVoice($v.Name); \
$x=('<speak version=^1.0^ xmlns=^http://www.w3.org/2001/10/synthesis^ xml:lang=^'+$v.Culture.Name+'^><prosody pitch=^+16%^ rate=^+4%^>'+[Security.SecurityElement]::Escape($t)+'</prosody></speak>').Replace('^',[string][char]34); \
$s.SpeakSsml($x) }} else {{ $s.Speak($t) }} }} catch {{ [Console]::WriteLine('ERR') }}"
    )
}

#[cfg(windows)]
fn run_script(script: &str, stdin_text: Option<String>, wait: bool) -> Option<String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = crate::platform::no_console(&mut cmd).spawn().ok()?;
    if let Some(mut stdin) = child.stdin.take() {
        if let Some(t) = stdin_text {
            let _ = stdin.write_all(t.as_bytes());
        }
        // Al cerrar la entrada, el script sabe que ya tiene todo el texto.
    }
    if wait {
        let out = child.wait_with_output().ok()?;
        return Some(String::from_utf8_lossy(&out.stdout).to_string());
    }
    *CHILD.lock().unwrap() = Some(child);
    Some(String::new())
}

fn stop_impl() {
    if let Some(mut child) = CHILD.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Habla en voz alta. `voice` es la posición en la lista de voces (-1 = la mejor). False si no hay síntesis.
#[tauri::command]
pub fn voice_speak(text: String, voice: i32) -> bool {
    #[cfg(windows)]
    {
        let text: String = text.chars().filter(|c| !c.is_control() || *c == '\n').take(700).collect();
        if text.trim().is_empty() {
            return false;
        }
        stop_impl();
        return run_script(&speak_script(), Some(format!("{voice}\n{text}")), false).is_some();
    }
    #[cfg(not(windows))]
    {
        let _ = (text, voice);
        false
    }
}

/// Calla a Hocki ya.
#[tauri::command]
pub fn voice_speak_stop() {
    stop_impl();
}

/// Nombres de las voces en español instaladas (para elegir otra).
#[tauri::command]
pub fn voice_list() -> Vec<String> {
    #[cfg(windows)]
    {
        let script = format!(
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; {RANK} $vs | ForEach-Object {{ [Console]::WriteLine($_.Name) }}"
        );
        return run_script(&script, None, true)
            .map(|o| o.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
            .unwrap_or_default();
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}
