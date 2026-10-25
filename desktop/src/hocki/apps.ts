// Hocki y tus aplicaciones: qué apps puede abrir y qué tareas hace en cada una.
//
// Tú decides tres cosas, siempre por separado:
//   1. En qué aplicaciones puede entrar Hocki.
//   2. Qué tareas concretas le asignas en cada una (nada fuera de esa lista).
//   3. Qué nivel de permiso global tiene (ver permissions.ts).
// Las apps de dinero y claves (bancos, billeteras, gestores de contraseñas) son
// "sensibles": siempre piden tu verificación y jamás se tocan en reposo.

import type { ActionKind, ActionRequest, Context, Decision, Origin, PermissionEngine } from "./permissions";

export type OS = "windows" | "macos" | "linux" | "android" | "ios";

export interface AppDef {
  id: string;
  name: string;
  category: string;
  /** Cómo se abre en cada sistema (comando, esquema URL o paquete). */
  launch: Partial<Record<OS, string>>;
  /** Palabras del nombre del acceso directo del menú Inicio (escritorio): así se encuentra la app instalada. */
  find?: string[];
  /** Nombre(s) del proceso en el sistema, para pedirle que cierre. Si falta se deduce de `find`. */
  proc?: string[];
  /** Otras formas de nombrarla al hablar ("ps", "ppt"…). */
  aliases?: string[];
  sensitive?: boolean;
  custom?: boolean;
}

export const APP_CATALOG: AppDef[] = [
  { id: "whatsapp", find: ["whatsapp"], name: "WhatsApp", category: "mensajería",
    launch: { windows: "whatsapp:", macos: "whatsapp://", android: "com.whatsapp", ios: "whatsapp://" } },
  { id: "telegram", find: ["telegram"], name: "Telegram", category: "mensajería",
    launch: { windows: "tg:", macos: "tg://", linux: "telegram-desktop", android: "org.telegram.messenger", ios: "tg://" } },
  { id: "chrome", find: ["chrome"], name: "Google Chrome", category: "navegador",
    launch: { windows: "chrome", macos: "Google Chrome", linux: "google-chrome", android: "com.android.chrome", ios: "googlechromes://" } },
  { id: "word", find: ["word"], aliases: ["microsoft word"], name: "Word", category: "ofimática",
    launch: { windows: "winword", macos: "Microsoft Word", android: "com.microsoft.office.word", ios: "ms-word:" } },
  { id: "excel", find: ["excel"], name: "Excel", category: "ofimática",
    launch: { windows: "excel", macos: "Microsoft Excel", android: "com.microsoft.office.excel", ios: "ms-excel:" } },
  { id: "correo", find: ["outlook"], name: "Correo", category: "correo",
    launch: { windows: "mailto:", macos: "Mail", android: "com.google.android.gm", ios: "googlegmail://" } },
  { id: "calendario", find: ["outlook"], name: "Calendario", category: "productividad",
    launch: { windows: "outlookcal:", macos: "Calendar", android: "com.google.android.calendar", ios: "calshow://" } },
  { id: "mapas", find: ["maps"], name: "Mapas", category: "navegación",
    launch: { windows: "bingmaps:", macos: "Maps", android: "com.google.android.apps.maps", ios: "maps://" } },
  { id: "spotify", find: ["spotify"], name: "Spotify", category: "música",
    launch: { windows: "spotify:", macos: "spotify:", linux: "spotify", android: "com.spotify.music", ios: "spotify:" } },
  { id: "calculadora", find: ["calculadora"], name: "Calculadora", category: "utilidades",
    launch: { windows: "calc", macos: "Calculator", linux: "gnome-calculator", android: "com.google.android.calculator" } },
  { id: "notas", find: ["bloc de notas"], name: "Bloc de notas", category: "utilidades",
    launch: { windows: "notepad", macos: "TextEdit", linux: "gedit", ios: "mobilenotes://" } },
  { id: "photoshop", name: "Photoshop", category: "Adobe", find: ["photoshop"], aliases: ["ps"], launch: {} },
  { id: "illustrator", name: "Illustrator", category: "Adobe", find: ["illustrator"], aliases: ["ai"], launch: {} },
  { id: "premiere", name: "Premiere Pro", category: "Adobe", find: ["premiere"], aliases: ["premiere pro"], launch: {} },
  { id: "aftereffects", name: "After Effects", category: "Adobe", find: ["after effects"], aliases: ["ae"], launch: {} },
  { id: "audition", name: "Audition", category: "Adobe", find: ["audition"], launch: {} },
  { id: "indesign", name: "InDesign", category: "Adobe", find: ["indesign"], launch: {} },
  { id: "lightroom", name: "Lightroom", category: "Adobe", find: ["lightroom"], launch: {} },
  { id: "acrobat", name: "Acrobat", category: "Adobe", find: ["acrobat"], aliases: ["adobe acrobat","pdf"], launch: {} },
  { id: "mediaencoder", name: "Media Encoder", category: "Adobe", find: ["media encoder"], launch: {} },
  { id: "animate", name: "Animate", category: "Adobe", find: ["animate"], launch: {} },
  { id: "creativecloud", name: "Creative Cloud", category: "Adobe", find: ["creative cloud"], aliases: ["adobe"], launch: {} },
  { id: "blender", name: "Blender", category: "3D", find: ["blender"], launch: {} },
  { id: "maya", name: "Maya", category: "3D", find: ["maya"], aliases: ["autodesk maya","3d maya"], launch: {} },
  { id: "3dsmax", name: "3ds Max", category: "3D", find: ["3ds max"], aliases: ["3dsmax"], launch: {} },
  { id: "sketchup", name: "SketchUp", category: "3D", find: ["sketchup"], launch: {} },
  { id: "zbrush", name: "ZBrush", category: "3D", find: ["zbrush"], launch: {} },
  { id: "cinema4d", name: "Cinema 4D", category: "3D", find: ["cinema 4d"], launch: {} },
  { id: "rhino", name: "Rhino", category: "3D", find: ["rhino"], launch: {} },
  { id: "unreal", name: "Unreal Engine", category: "3D", find: ["unreal"], launch: {} },
  { id: "autocad", name: "AutoCAD", category: "CAD", find: ["autocad"], aliases: ["acad"], launch: {} },
  { id: "revit", name: "Revit", category: "CAD", find: ["revit"], launch: {} },
  { id: "fusion360", name: "Fusion 360", category: "CAD", find: ["fusion"], aliases: ["fusion"], launch: {} },
  { id: "davinci", name: "DaVinci Resolve", category: "audio y video", find: ["davinci resolve"], aliases: ["resolve","davinci"], launch: {} },
  { id: "audacity", name: "Audacity", category: "audio y video", find: ["audacity"], launch: {} },
  { id: "obs", name: "OBS Studio", category: "audio y video", find: ["obs studio"], aliases: ["obs"], launch: {} },
  { id: "flstudio", name: "FL Studio", category: "audio y video", find: ["fl studio"], launch: {} },
  { id: "ableton", name: "Ableton Live", category: "audio y video", find: ["ableton"], launch: {} },
  { id: "capcut", name: "CapCut", category: "audio y video", find: ["capcut"], launch: {} },
  { id: "vlc", name: "VLC", category: "audio y video", find: ["vlc"], launch: {} },
  { id: "figma", name: "Figma", category: "diseño", find: ["figma"], launch: {} },
  { id: "gimp", name: "GIMP", category: "diseño", find: ["gimp"], launch: {} },
  { id: "inkscape", name: "Inkscape", category: "diseño", find: ["inkscape"], launch: {} },
  { id: "krita", name: "Krita", category: "diseño", find: ["krita"], launch: {} },
  { id: "coreldraw", name: "CorelDRAW", category: "diseño", find: ["coreldraw"], aliases: ["corel"], launch: {} },
  { id: "affinity", name: "Affinity", category: "diseño", find: ["affinity"], launch: {} },
  { id: "powerpoint", name: "PowerPoint", category: "ofimática", find: ["powerpoint"], aliases: ["power point","ppt","presentaciones"], launch: {} },
  { id: "outlook", name: "Outlook", category: "ofimática", find: ["outlook"], launch: {} },
  { id: "onenote", name: "OneNote", category: "ofimática", find: ["onenote"], launch: {} },
  { id: "access", name: "Access", category: "ofimática", find: ["access"], launch: {} },
  { id: "publisher", name: "Publisher", category: "ofimática", find: ["publisher"], launch: {} },
  { id: "visio", name: "Visio", category: "ofimática", find: ["visio"], launch: {} },
  { id: "teams", name: "Teams", category: "ofimática", find: ["teams"], launch: {} },
  { id: "vscode", name: "Visual Studio Code", category: "desarrollo", find: ["visual studio code"], aliases: ["vs code","vscode","code"], launch: {} },
];

const SENSITIVE_HINTS = [
  "banc", "nequi", "daviplata", "davivienda", "bancolombia", "pse", "billetera", "wallet", "cripto", "binance",
  "clave", "contrasena", "password", "1password", "bitwarden", "lastpass", "authenticator", "token", "tarjeta",
];

const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** ¿Parece una app de dinero o claves? Mejor pecar de prudente. */
export function looksSensitive(name: string): boolean {
  const n = plain(name);
  return SENSITIVE_HINTS.some((h) => n.includes(h));
}

export interface AppTask {
  id: string;
  appId: string;
  title: string;
  /** Lo más serio que esta tarea hace: define cuánta confirmación pide. */
  kind: ActionKind;
}

export const MAX_TASKS_PER_APP = 20;

export type AppMode = "catalog" | "any";

export interface AppResult { decision: Decision; request: ActionRequest | null }

/** Nombres de proceso que no se deducen del nombre del acceso directo. */
const PROC: Record<string, string[]> = {
  word: ["winword"], powerpoint: ["powerpnt"], correo: ["outlook"], calendario: ["outlook"],
  access: ["msaccess"], publisher: ["mspub"], teams: ["ms-teams", "teams"], "3dsmax": ["3dsmax"],
  autocad: ["acad"], aftereffects: ["afterfx"], davinci: ["resolve"], obs: ["obs64", "obs32"],
  vscode: ["code"], notas: ["notepad"], calculadora: ["calculatorapp", "calculator"], premiere: ["premiere"],
  mediaencoder: ["adobe media encoder"], fusion360: ["fusion360"], cinema4d: ["cinema 4d"],
};

/** Con qué palabras buscar el proceso de una app para cerrarla (solo el nombre del proceso). */
export function procKeys(app: AppDef): string[] {
  if (app.proc?.length) return app.proc;
  if (PROC[app.id]) return PROC[app.id];
  // Programa propio: su palabra más larga (otra suelta podría coincidir con otro programa).
  if (app.custom && app.find?.length) return [[...app.find].map(plain).sort((a, b) => b.length - a.length)[0]];
  return (app.find ?? [app.name]).map((f) => plain(f)).filter((f) => f.length >= 2);
}

/** Programas que Hocki nunca abre ni cierra, aunque se los pidas: pueden ejecutar cualquier cosa. */
const NEVER = /\b(powershell|cmd|terminal|consola|regedit|registro|bash|wsl|shell|simbolo del sistema|administrador de tareas|task manager|diskpart|gpedit|msconfig)\b/;

/** Un nombre que se puede usar para buscar un programa instalado (2–40 letras, hasta 4 palabras). */
export function cleanProgramName(raw: string): string | null {
  const n = plain(raw).replace(/[^a-z0-9 .+-]/g, " ").replace(/\s+/g, " ").trim();
  if (n.length < 2 || n.length > 40 || n.split(" ").length > 4 || NEVER.test(n)) return null;
  return n;
}

export class AppAutomation {
  mode: AppMode = "catalog";
  private engine: PermissionEngine;
  private os: OS;
  private apps = new Map<string, AppDef>();
  private granted = new Set<string>();
  private tasks = new Map<string, AppTask>();

  constructor(engine: PermissionEngine, os: OS) {
    this.engine = engine;
    this.os = os;
    for (const a of APP_CATALOG) this.apps.set(a.id, { ...a, sensitive: a.sensitive ?? looksSensitive(a.name) });
  }

  // ── Catálogo ───────────────────────────────────────────────────────────────

  /** Registra una app propia (cualquier app del equipo, en modo "any"). */
  addCustom(def: { id: string; name: string; launch: Partial<Record<OS, string>>; find?: string[]; sensitive?: boolean }): boolean {
    if (this.mode !== "any" || this.apps.has(def.id)) return false;
    this.apps.set(def.id, {
      id: def.id, name: def.name, category: "personalizada", launch: def.launch, ...(def.find ? { find: def.find } : {}),
      sensitive: def.sensitive || looksSensitive(def.name), custom: true,
    });
    return true;
  }

  app(id: string): AppDef | undefined { return this.apps.get(id); }
  list(): AppDef[] { return [...this.apps.values()]; }
  launchTarget(id: string): string | null { return this.apps.get(id)?.launch[this.os] ?? null; }

  // ── Permisos por app y tareas asignadas ────────────────────────────────────

  grantApp(id: string): boolean { if (!this.apps.has(id)) return false; this.granted.add(id); return true; }
  revokeApp(id: string) {
    this.granted.delete(id);
    for (const [tid, t] of this.tasks) if (t.appId === id) this.tasks.delete(tid);
  }
  isGranted(id: string) { return this.granted.has(id); }
  grantedIds(): string[] { return [...this.granted]; }

  assignTask(task: AppTask): boolean {
    if (!this.granted.has(task.appId)) return false;
    const count = [...this.tasks.values()].filter((t) => t.appId === task.appId).length;
    if (count >= MAX_TASKS_PER_APP || this.tasks.has(task.id)) return false;
    this.tasks.set(task.id, { ...task });
    return true;
  }
  unassignTask(id: string) { this.tasks.delete(id); }
  tasksOf(appId: string): AppTask[] { return [...this.tasks.values()].filter((t) => t.appId === appId); }

  // ── Pedir permiso para actuar ──────────────────────────────────────────────

  /** Abrir una app. */
  open(appId: string, origin: Origin, ctx: Context): AppResult {
    const app = this.apps.get(appId);
    const gate = this.gate(app);
    if (gate) return gate;
    const desktop = this.os === "windows" || this.os === "macos" || this.os === "linux";
    if (!this.launchTarget(appId) && !(desktop && app!.find)) return deny("Esa app no tiene forma de abrirse en este sistema");
    const request: ActionRequest = { kind: "open_app", summary: `Abrir ${app!.name}`, fingerprint: `open:${appId}`, origin };
    return this.finish(request, app!, ctx);
  }

  /** Cerrar una app (con cortesía: ella misma pregunta si hay algo sin guardar). */
  close(appId: string, origin: Origin, ctx: Context): AppResult {
    const app = this.apps.get(appId);
    const gate = this.gate(app);
    if (gate) return gate;
    const request: ActionRequest = { kind: "open_app", summary: `Cerrar ${app!.name}`, fingerprint: `close:${appId}`, origin };
    return this.finish(request, app!, ctx);
  }

  /** Manejar una app por dentro (atajos, texto, botones), con el mismo permiso por app. */
  use(appId: string, what: string, origin: Origin, ctx: Context): AppResult {
    const app = this.apps.get(appId);
    const gate = this.gate(app);
    if (gate) return gate;
    const request: ActionRequest = { kind: "open_app", summary: `${app!.name}: ${what}`, fingerprint: `use:${appId}:${what}`, origin };
    return this.finish(request, app!, ctx);
  }

  /** Hacer una tarea que TÚ asignaste en esa app. */
  runTask(appId: string, taskId: string, origin: Origin, ctx: Context): AppResult {
    const app = this.apps.get(appId);
    const gate = this.gate(app);
    if (gate) return gate;
    const task = this.tasks.get(taskId);
    if (!task || task.appId !== appId) return deny("Esa tarea no está asignada a esta app");
    const request: ActionRequest = {
      kind: task.kind, summary: `${app!.name}: ${task.title}`, fingerprint: `${appId}:${taskId}`, origin,
    };
    return this.finish(request, app!, ctx);
  }

  private gate(app: AppDef | undefined): AppResult | null {
    if (!app) return deny("No conozco esa app");
    if (app.custom && this.mode !== "any") return deny("Las apps propias requieren activar \"cualquier aplicación\"");
    if (!this.granted.has(app.id)) return deny(`No me diste permiso en ${app.name}`);
    return null;
  }

  private finish(request: ActionRequest, app: AppDef, ctx: Context): AppResult {
    let decision = this.engine.decide(request, ctx);
    if (app.sensitive) {
      // Apps de dinero y claves: siempre con verificación, nunca por adelantado ni en reposo.
      if (decision.type === "run_preapproved") {
        decision = { type: "ask", needsBiometric: true, reason: "App sensible: confirma con tu verificación" };
      } else if (decision.type === "ask") {
        decision = { type: "ask", needsBiometric: true, reason: "App sensible: confirma con tu verificación" };
      }
    }
    return { decision, request };
  }
}

function deny(reason: string): AppResult {
  return { decision: { type: "deny", reason }, request: null };
}

/** Cómo se dice una app en una frase: nombre, id y alias, sin tildes. */
export function appNames(a: AppDef): string[] {
  return [a.name, a.id, ...(a.aliases ?? [])].map(plain);
}

/** La app nombrada en una frase ("abre photoshop", "ábreme el power point"); gana el nombre más largo. */
export function matchApp(text: string, apps: readonly AppDef[]): AppDef | null {
  const t = plain(text);
  let best: { app: AppDef; len: number } | null = null;
  for (const a of apps) {
    for (const n of appNames(a)) {
      if (n.length < 2) continue;
      const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(t) && (!best || n.length > best.len)) best = { app: a, len: n.length };
    }
  }
  return best?.app ?? null;
}
