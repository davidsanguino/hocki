// Reconocimiento de voz propio de Hocki en Windows, sin internet.
//
// El reconocimiento del navegador interno (WebView2) depende de un servicio en línea que
// suele fallar ("network"). Aquí se usa el reconocedor de voz que Windows ya trae
// (System.Speech, el mismo de "Reconocimiento de voz de Windows"): corre en el equipo, el audio
// no sale de él y no hace falta conexión. Hace falta un reconocedor en español instalado
// (Configuración → Hora e idioma → Idioma y región → Español → Opciones de idioma → Voz).
//
// Un proceso de PowerShell escucha el micrófono y escribe una línea por frase:
//   HEARD:<texto>   una frase reconocida
//   READY           listo para escuchar
//   ERR:<motivo>    no pudo arrancar (no-spanish, audio-capture, other)
// Esas líneas llegan a la página como el evento "voice-native". Si Hocki se cierra, el
// proceso termina solo (se queda esperando su entrada y la ve cerrarse).

use std::sync::Mutex;

use tauri::AppHandle;

static CHILD: Mutex<Option<std::process::Child>> = Mutex::new(None);

#[cfg(windows)]
const SCRIPT: &str = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; \
try { \
Add-Type -AssemblyName System.Speech; \
$all=[System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers(); \
$pick=$all | Where-Object { $_.Culture.Name -like 'es*' } | Select-Object -First 1; \
if(-not $pick){ [Console]::WriteLine('ERR:no-spanish'); exit }; \
$e=New-Object System.Speech.Recognition.SpeechRecognitionEngine($pick); \
try { $e.SetInputToDefaultAudioDevice() } catch { [Console]::WriteLine('ERR:audio-capture'); exit }; \
$e.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar)); \
$null=Register-ObjectEvent -InputObject $e -EventName SpeechRecognized -Action { \
$r=$Event.SourceEventArgs.Result; \
if($r.Confidence -ge 0.45 -and $r.Text){ [Console]::WriteLine('HEARD:'+$r.Text) } }; \
$e.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple); \
[Console]::WriteLine('READY'); \
while([Console]::In.ReadLine() -ne $null){ }; \
$e.RecognizeAsyncStop(); \
} catch { [Console]::WriteLine('ERR:other') }";

#[cfg(windows)]
fn start_impl(app: AppHandle) -> bool {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};

    use tauri::Emitter;

    stop_impl();
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = match crate::platform::no_console(&mut cmd).spawn() {
        Ok(c) => c,
        Err(_) => return false,
    };
    let Some(out) = child.stdout.take() else { return false };
    *CHILD.lock().unwrap() = Some(child);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(out);
        let mut buf: Vec<u8> = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&buf).trim().to_string();
                    if !line.is_empty() {
                        let _ = app.emit("voice-native", line);
                    }
                }
            }
        }
        let _ = app.emit("voice-native", "END".to_string());
    });
    true
}

#[cfg(not(windows))]
fn start_impl(_app: AppHandle) -> bool {
    false
}

fn stop_impl() {
    if let Some(mut child) = CHILD.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Starts listening. False where this engine does not exist (not Windows) or PowerShell cannot start.
#[tauri::command]
pub fn voice_native_start(app: AppHandle) -> bool {
    start_impl(app)
}

#[tauri::command]
pub fn voice_native_stop() {
    stop_impl();
}
