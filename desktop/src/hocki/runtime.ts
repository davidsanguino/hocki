// Lo que comparten el chat y la isla: un solo cerebro y un solo motor de permisos.
import { Bridge } from "../core/bridge";
import { AppAutomation, procKeys, type OS } from "./apps";
import { HockiBrain } from "./brain";
import { PermissionEngine } from "./permissions";
import { browserKV } from "./storage";
import { AgentController } from "./screen-agent";
import { State } from "../core/state";
import { providerDef } from "../core/providers";

function detectOS(): OS {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac")) return "macos";
  return "linux";
}

export const permissions = new PermissionEngine();
export const apps = new AppAutomation(permissions, detectOS());
// Cualquier programa instalado, siempre con tu permiso por programa.
apps.mode = "any";
const say = (text: string) => { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("hocki-say", { detail: text })); };

/** El ayudante de pantalla: usa la IA elegida en Ajustes (Rust lee el proveedor y el modelo). */
export const agent = new AgentController((app) => ({
  snapshot: () => Bridge.agentSnapshot(),
  think: async (prompt) => {
    const r = await Bridge.agentThink(prompt);
    if (r == null) throw new Error("sin respuesta");
    return r;
  },
  input: async (kind, x, y, text) => (await Bridge.agentInput(kind, x, y, text)) === true,
  focus: async () => {
    const def = apps.app(app.id);
    if (!def) return false;
    const r = await Bridge.appAct(procKeys(def), "keys", "");
    return !!r && !r.some((l) => l === "ERR:not-running");
  },
  say,
  confirm: async () => false, // lo reemplaza el controlador
  wait: (ms) => new Promise((res) => setTimeout(res, ms)),
  forget: () => void Bridge.agentForget(),
}));

export const brain = HockiBrain.load({
  engine: permissions,
  kv: browserKV(),
  apps,
  // La app se busca por el nombre de su acceso directo en el menú Inicio (solo Windows por ahora).
  launch: async (app) => {
    // Si Hocki vio el programa al estudiar el equipo, lo abre por su AppID (sirve también para las apps de la Tienda).
    const id = brain.appIdOf(app.id);
    if (id && (await Bridge.launchAppId(id)) === true) return true;
    return (await Bridge.launchApp(app.find ?? [app.name])) === true;
  },
  scan: async () => (await Bridge.scanInstalled()) ?? [],
  close: (app) => Bridge.closeApp(procKeys(app)).then((n) => n ?? 0),
  act: (app, action, arg) => Bridge.appAct(procKeys(app), action, arg).then((r) => r ?? ["ERR:unsupported"]),
  notify: say,
  agent,
  aiName: () => providerDef(State.settings.chatProvider).name,
});
