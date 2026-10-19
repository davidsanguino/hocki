// Lo que comparten el chat y la isla: un solo cerebro y un solo motor de permisos.
import { HockiBrain } from "./brain";
import { PermissionEngine } from "./permissions";
import { browserKV } from "./storage";

export const permissions = new PermissionEngine();
export const brain = HockiBrain.load({ engine: permissions, kv: browserKV() });
