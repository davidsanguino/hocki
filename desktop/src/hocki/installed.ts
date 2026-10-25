// Lo que tienes en el equipo: la lista del menú Inicio (programas, apps de la Tienda y las que
// trae Windows de fábrica). Con tu permiso Hocki la lee una vez (y la refresca cada semana), la
// ordena por tipo y así puede abrir, cerrar y ayudarte con cualquiera, siempre con el permiso
// de cada programa la primera vez que actúe en él.

import { matchApp, type AppAutomation, type AppDef } from "./apps";

export interface InstalledApp { name: string; appId: string }

/** Tipos para ordenar lo que tienes (el primero que encaje gana). */
const KINDS: [string, RegExp][] = [
  ["Adobe y diseño", /adobe|photoshop|illustrator|indesign|lightroom|premiere|after effects|figma|canva|corel|affinity|gimp|inkscape|krita|xd\b/],
  ["3D, CAD y arquitectura", /blender|maya|3ds|sketchup|autocad|revit|rhino|cinema 4d|zbrush|fusion|solidworks|archicad|lumion|unreal|unity/],
  ["Audio y video", /davinci|resolve|audacity|obs|fl studio|ableton|capcut|vlc|filmora|vegas|reaper|media player|reproductor|camtasia|spotify|musica|clipchamp/],
  ["Oficina y documentos", /word|excel|powerpoint|outlook|onenote|access|publisher|visio|teams|libreoffice|pdf|acrobat|notepad|bloc de notas|wordpad|writer|calc\b/],
  ["Navegadores e internet", /chrome|edge|firefox|opera|brave|vivaldi|navegador|browser/],
  ["Comunicación", /whatsapp|telegram|zoom|discord|skype|slack|meet|signal|messenger|correo|mail/],
  ["Programación", /visual studio|vs code|code\b|github|git\b|python|node|android studio|intellij|pycharm|postman|docker|terminal/],
  ["Juegos", /steam|epic games|xbox|minecraft|roblox|battle\.net|ea app|riot|game/],
  ["Utilidades de Windows", /calculadora|calculator|camara|camera|fotos|photos|recortes|snipping|paint|reloj|clock|mapas|maps|notas|sticky|grabadora|recorder|tiempo|weather|alarma|explorador|explorer|configuracion|settings|tienda|store|ayuda|help|consejos|tips/],
];

/** Lo que no conviene registrar: desinstaladores, manuales y herramientas que pueden ejecutar cualquier cosa. */
const SKIP = /uninstall|desinstal|readme|leeme|license|licencia|manual|documentation|release notes|website|sitio web|\bhelp\b|powershell|cmd\b|simbolo del sistema|command prompt|terminal de windows|regedit|editor del registro|administrador de tareas|task manager|diskpart|recovery|recuperacion|depurador|debugger/;

const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function kindOf(name: string): string {
  const n = plain(name);
  for (const [k, re] of KINDS) if (re.test(n)) return k;
  return "Otros";
}

export function keep(app: InstalledApp): boolean {
  const n = plain(app.name);
  return n.length >= 2 && !SKIP.test(n);
}

/** Palabras para buscar el programa sin la marca de versión ("Adobe Illustrator 2025" → adobe, illustrator). */
export function findWords(name: string): string[] {
  const words = plain(name).replace(/[^a-z0-9 .+-]/g, " ").split(/\s+/)
    .filter((w) => w.length >= 2 && !/^(v?\d+(\.\d+)*|x64|x86|64-bit|32-bit|\(.*\))$/.test(w));
  return words.slice(0, 4);
}

export function slug(name: string): string {
  return "i-" + plain(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export interface Inventory { at: number; apps: InstalledApp[] }

/**
 * Registra lo instalado en el catálogo de Hocki: lo que ya conoce (Photoshop, Word…) queda
 * enlazado a su AppID para abrirlo seguro; lo nuevo entra como programa propio.
 * Devuelve cuántos nuevos aprendió.
 */
export function ingest(inv: Inventory, apps: AppAutomation, appIds: Map<string, string>): number {
  let added = 0;
  for (const it of inv.apps) {
    if (!keep(it)) continue;
    const known = matchApp(it.name, apps.list().filter((a) => !a.custom));
    if (known) { if (!appIds.has(known.id)) appIds.set(known.id, it.appId); continue; }
    const id = slug(it.name);
    const find = findWords(it.name);
    if (!find.length) continue;
    if (apps.addCustom({ id, name: it.name, launch: {}, find })) added++;
    appIds.set(id, it.appId);
  }
  return added;
}

/** Resumen para el chat: cuántos hay de cada tipo y algunos ejemplos. */
export function summarize(inv: Inventory): string {
  const groups = new Map<string, string[]>();
  for (const a of inv.apps) {
    if (!keep(a)) continue;
    const k = kindOf(a.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(a.name);
  }
  const total = [...groups.values()].reduce((n, g) => n + g.length, 0);
  const order = [...KINDS.map(([k]) => k), "Otros"];
  const lines = order.filter((k) => groups.has(k)).map((k) => {
    const g = groups.get(k)!;
    return `• ${k} (${g.length}): ${g.slice(0, 6).join(", ")}${g.length > 6 ? "…" : ""}`;
  });
  return `Encontré ${total} programas y apps en tu equipo:\n${lines.join("\n")}`;
}

/** Busca un programa instalado por como lo nombras ("el illustrator", "davinci"). */
export function findInstalled(inv: Inventory | null, text: string): InstalledApp | null {
  if (!inv) return null;
  const words = findWords(text);
  if (!words.length) return null;
  let best: { a: InstalledApp; score: number } | null = null;
  for (const a of inv.apps) {
    if (!keep(a)) continue;
    const n = plain(a.name);
    if (!words.every((w) => n.includes(w))) continue;
    const score = words.join(" ").length / n.length; // cuanto más completo el nombre, mejor
    if (!best || score > best.score) best = { a, score };
  }
  return best?.a ?? null;
}

export type { AppDef };
