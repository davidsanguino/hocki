// Lo que comparten el chat y la isla: un solo cerebro y un solo motor de permisos.
import { Bridge } from "../core/bridge";
import { AppAutomation, type OS } from "./apps";
import { HockiBrain } from "./brain";
import { PermissionEngine } from "./permissions";
import { browserKV } from "./storage";

function detectOS(): OS {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac")) return "macos";
  return "linux";
}

export const permissions = new PermissionEngine();
export const apps = new AppAutomation(permissions, detectOS());
export const brain = HockiBrain.load({
  engine: permissions,
  kv: browserKV(),
  apps,
  // La app se busca por el nombre de su acceso directo en el menú Inicio (solo Windows por ahora).
  launch: (app) => { void Bridge.launchApp(app.find ?? [app.name]); },
});
