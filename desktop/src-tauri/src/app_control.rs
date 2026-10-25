// Hocki maneja un programa que tú autorizaste: lo trae al frente y le manda atajos de teclado,
// texto, o pulsa un botón o menú por su nombre (la accesibilidad de Windows, UI Automation).
// También lee los nombres de botones y menús para "aprender" un programa nuevo.
//
// Todo corre en el equipo, sin internet y sin IA de pago. El permiso (una vez por programa) y
// la pausa antes de lo delicado los decide la parte web (brain.ts / app-control.ts); aquí solo
// se aceptan nombres de proceso limpios y se ejecuta lo pedido sobre ESE programa.
//
// El guion viaja codificado (-EncodedCommand) y los datos por variables de entorno: ninguna
// comilla ni símbolo de lo que digas puede convertirse en una orden de PowerShell.

#[cfg(windows)]
const SCRIPT: &str = r#"
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$a=$env:HOCKI_A; $keys=@($env:HOCKI_K.Split(',') | Where-Object { $_ }); $arg=$env:HOCKI_ARG
try {
  $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Where-Object {
    $n=$_.ProcessName.ToLower(); @($keys | Where-Object { $n.Contains($_) }).Count -gt 0 } | Select-Object -First 1
  if(-not $p){ [Console]::WriteLine('ERR:not-running'); exit }
  Add-Type -AssemblyName Microsoft.VisualBasic
  try { [Microsoft.VisualBasic.Interaction]::AppActivate($p.Id) } catch { }
  Start-Sleep -Milliseconds 300
  if($a -eq 'keys' -or $a -eq 'type'){
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait($arg)
    [Console]::WriteLine('OK'); exit
  }
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $AE=[System.Windows.Automation.AutomationElement]
  $root=$AE::FromHandle($p.MainWindowHandle)
  $all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  if($a -eq 'list'){
    $seen=@{}; $count=0
    foreach($e in $all){
      $nm=$e.Current.Name; $ct=$e.Current.ControlType.ProgrammaticName
      if(-not $nm -or $nm.Length -gt 40 -or $seen.ContainsKey($nm)){ continue }
      if($ct -notmatch 'Button|MenuItem|TabItem|Hyperlink|ListItem|CheckBox|ComboBox|SplitButton'){ continue }
      $seen[$nm]=1; [Console]::WriteLine('N:'+$nm); $count++
      if($count -ge 200){ break }
    }
    exit
  }
  if($a -eq 'click'){
    $t=$arg.ToLower(); $hit=$null
    foreach($e in $all){ $nm=$e.Current.Name; if($nm -and $nm.ToLower() -eq $t){ $hit=$e; break } }
    if(-not $hit){ foreach($e in $all){ $nm=$e.Current.Name; if($nm -and $nm.Length -le 40 -and $nm.ToLower().Contains($t)){ $hit=$e; break } } }
    if(-not $hit){ [Console]::WriteLine('ERR:not-found'); exit }
    $name=$hit.Current.Name
    foreach($pat in @([System.Windows.Automation.InvokePattern]::Pattern,[System.Windows.Automation.ExpandCollapsePattern]::Pattern,[System.Windows.Automation.SelectionItemPattern]::Pattern,[System.Windows.Automation.TogglePattern]::Pattern)){
      $o=$null
      if($hit.TryGetCurrentPattern($pat,[ref]$o)){
        if($o -is [System.Windows.Automation.InvokePattern]){ $o.Invoke() }
        elseif($o -is [System.Windows.Automation.ExpandCollapsePattern]){ $o.Expand() }
        elseif($o -is [System.Windows.Automation.SelectionItemPattern]){ $o.Select() }
        else { $o.Toggle() }
        [Console]::WriteLine('OK:'+$name); exit
      }
    }
    [Console]::WriteLine('ERR:no-action')
  }
} catch { [Console]::WriteLine('ERR:other') }
"#;

#[cfg(windows)]
fn run(action: &str, procs: &[String], arg: &str) -> Vec<String> {
    use std::process::{Command, Stdio};

    // -EncodedCommand espera el guion en UTF-16LE y base64.
    let utf16: Vec<u8> = SCRIPT.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let encoded = crate::claude::base64_for(&utf16);
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded])
        .env("HOCKI_A", action)
        .env("HOCKI_K", procs.join(","))
        .env("HOCKI_ARG", arg)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    match crate::platform::no_console(&mut cmd).output() {
        Ok(out) => String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect(),
        Err(_) => vec!["ERR:other".to_string()],
    }
}

fn clean_procs(procs: &[String]) -> bool {
    !procs.is_empty()
        && procs.len() <= 4
        && procs.iter().all(|k| {
            (2..=40).contains(&k.chars().count())
                && k.chars().all(|c| c.is_alphanumeric() || c == ' ' || c == '.' || c == '-' || c == '+')
        })
}

/// action: "keys" (atajo, formato SendKeys), "type" (texto ya escapado), "click" (nombre de un
/// botón o menú) o "list" (nombres de botones y menús). Devuelve las líneas de respuesta:
/// OK, OK:<nombre>, N:<nombre>… o ERR:<motivo> (not-running, not-found, no-action, other, unsupported).
#[tauri::command]
pub async fn app_act(procs: Vec<String>, action: String, arg: String) -> Vec<String> {
    let procs: Vec<String> = procs.into_iter().map(|p| p.to_lowercase()).collect();
    if !clean_procs(&procs) || !["keys", "type", "click", "list"].contains(&action.as_str()) || arg.chars().count() > 2000 {
        return vec!["ERR:bad-request".to_string()];
    }
    #[cfg(windows)]
    {
        return tauri::async_runtime::spawn_blocking(move || run(&action, &procs, &arg))
            .await
            .unwrap_or_else(|_| vec!["ERR:other".to_string()]);
    }
    #[cfg(not(windows))]
    {
        let _ = (action, arg);
        vec!["ERR:unsupported".to_string()]
    }
}

// ── Lo que tienes instalado ──────────────────────────────────────────────────

#[cfg(windows)]
const SCAN: &str = r#"
[Console]::OutputEncoding=[Text.Encoding]::UTF8
try {
  Get-StartApps | ForEach-Object { if($_.Name -and $_.AppID){ [Console]::WriteLine($_.Name + "`t" + $_.AppID) } }
} catch { [Console]::WriteLine('ERR:other') }
"#;

#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub name: String,
    /// Lo que usa Windows para abrirla (shell:AppsFolder\<appId>): sirve igual para programas y apps de la Tienda.
    pub app_id: String,
}

/// "Nombre\tAppID" por línea → lista limpia, sin duplicados ni nombres raros.
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_scan(out: &str) -> Vec<InstalledApp> {
    let mut seen = std::collections::HashSet::new();
    let mut list = Vec::new();
    for line in out.lines() {
        let Some((name, id)) = line.trim().split_once('\t') else { continue };
        let (name, id) = (name.trim(), id.trim());
        if name.is_empty() || id.is_empty() || name.chars().count() > 80 || id.len() > 300 || !app_id_ok(id) {
            continue;
        }
        if seen.insert(name.to_lowercase()) {
            list.push(InstalledApp { name: name.to_string(), app_id: id.to_string() });
        }
        if list.len() >= 800 {
            break;
        }
    }
    list
}

/// Un AppID de Windows: letras, números y . _ - ! \ { } : espacio. Nada que un shell pueda leer como orden.
fn app_id_ok(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 300
        && id.chars().all(|c| c.is_alphanumeric() || " ._-!\\{}:".contains(c))
        && !id.contains("..")
}

/// Lee la lista de programas y apps del menú Inicio (de fábrica, de la Tienda e instalados).
/// Solo nombres: no abre nada ni mira dentro de ningún programa.
#[tauri::command]
pub async fn scan_installed() -> Vec<InstalledApp> {
    #[cfg(windows)]
    {
        use std::process::{Command, Stdio};
        let out = tauri::async_runtime::spawn_blocking(|| {
            let utf16: Vec<u8> = SCAN.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
            let mut cmd = Command::new("powershell.exe");
            cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &crate::claude::base64_for(&utf16)])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            crate::platform::no_console(&mut cmd)
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                .unwrap_or_default()
        })
        .await
        .unwrap_or_default();
        return parse_scan(&out);
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Abre una app por su AppID (sirve para las de la Tienda, que no tienen acceso directo).
#[tauri::command]
pub fn launch_app_id(app_id: String) -> bool {
    if !app_id_ok(&app_id) {
        return false;
    }
    #[cfg(windows)]
    {
        let target = format!("shell:AppsFolder\\{app_id}");
        return std::process::Command::new("explorer.exe").arg(target).spawn().is_ok();
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_start_menu_list_is_cleaned() {
        let out = "Calculadora\tMicrosoft.WindowsCalculator_8wekyb3d8bbwe!App\nAdobe Illustrator 2025\tC:\\Program Files\\Adobe\\Illustrator.exe\nmala\tcmd & del\n\nCalculadora\tdup\n";
        let l = parse_scan(out);
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].name, "Calculadora");
        assert!(app_id_ok("{6D809377-6AF0-444B-8957-A3773F02200E}\\Adobe\\Illustrator.exe"));
        assert!(!app_id_ok("x & calc"));
        assert!(!app_id_ok("..\\..\\x"));
    }
}
