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
  sensitive?: boolean;
  custom?: boolean;
}

export const APP_CATALOG: AppDef[] = [
  { id: "whatsapp", name: "WhatsApp", category: "mensajería",
    launch: { windows: "whatsapp:", macos: "whatsapp://", android: "com.whatsapp", ios: "whatsapp://" } },
  { id: "telegram", name: "Telegram", category: "mensajería",
    launch: { windows: "tg:", macos: "tg://", linux: "telegram-desktop", android: "org.telegram.messenger", ios: "tg://" } },
  { id: "chrome", name: "Google Chrome", category: "navegador",
    launch: { windows: "chrome", macos: "Google Chrome", linux: "google-chrome", android: "com.android.chrome", ios: "googlechromes://" } },
  { id: "word", name: "Word", category: "ofimática",
    launch: { windows: "winword", macos: "Microsoft Word", android: "com.microsoft.office.word", ios: "ms-word:" } },
  { id: "excel", name: "Excel", category: "ofimática",
    launch: { windows: "excel", macos: "Microsoft Excel", android: "com.microsoft.office.excel", ios: "ms-excel:" } },
  { id: "correo", name: "Correo", category: "correo",
    launch: { windows: "mailto:", macos: "Mail", android: "com.google.android.gm", ios: "googlegmail://" } },
  { id: "calendario", name: "Calendario", category: "productividad",
    launch: { windows: "outlookcal:", macos: "Calendar", android: "com.google.android.calendar", ios: "calshow://" } },
  { id: "mapas", name: "Mapas", category: "navegación",
    launch: { windows: "bingmaps:", macos: "Maps", android: "com.google.android.apps.maps", ios: "maps://" } },
  { id: "spotify", name: "Spotify", category: "música",
    launch: { windows: "spotify:", macos: "spotify:", linux: "spotify", android: "com.spotify.music", ios: "spotify:" } },
  { id: "calculadora", name: "Calculadora", category: "utilidades",
    launch: { windows: "calc", macos: "Calculator", linux: "gnome-calculator", android: "com.google.android.calculator" } },
  { id: "notas", name: "Bloc de notas", category: "utilidades",
    launch: { windows: "notepad", macos: "TextEdit", linux: "gedit", ios: "mobilenotes://" } },
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
  addCustom(def: { id: string; name: string; launch: Partial<Record<OS, string>>; sensitive?: boolean }): boolean {
    if (this.mode !== "any" || this.apps.has(def.id)) return false;
    this.apps.set(def.id, {
      id: def.id, name: def.name, category: "personalizada", launch: def.launch,
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
    if (!this.launchTarget(appId)) return deny("Esa app no tiene forma de abrirse en este sistema");
    const request: ActionRequest = { kind: "open_app", summary: `Abrir ${app!.name}`, fingerprint: `open:${appId}`, origin };
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
