// Estudiar el equipo: con permiso lee la lista del menú Inicio, la ordena y la usa para abrir cualquier programa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kindOf, keep, findWords, ingest, summarize, findInstalled } from "../src/hocki/installed.ts";
import { AppAutomation } from "../src/hocki/apps.ts";
import { PermissionEngine } from "../src/hocki/permissions.ts";
import { HockiBrain } from "../src/hocki/brain.ts";
import { MemoryKV } from "../src/hocki/storage.ts";

const LIST = [
  { name: "Adobe Illustrator 2025", appId: "{6D809377}\\Adobe\\Illustrator.exe" },
  { name: "Blender 4.2", appId: "blender.exe" },
  { name: "Calculadora", appId: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App" },
  { name: "Clipchamp", appId: "Clipchamp.Clipchamp_yxz!App" },
  { name: "Mi Contabilidad Pro", appId: "C:\\Programs\\conta.exe" },
  { name: "Desinstalar Blender", appId: "unins.exe" },
  { name: "Windows PowerShell", appId: "ps" },
];

test("ordena por tipo y descarta desinstaladores y consolas", () => {
  assert.equal(kindOf("Adobe Illustrator 2025"), "Adobe y diseño");
  assert.equal(kindOf("Blender 4.2"), "3D, CAD y arquitectura");
  assert.equal(kindOf("Calculadora"), "Utilidades de Windows");
  assert.equal(keep({ name: "Desinstalar Blender", appId: "x" }), false);
  assert.equal(keep({ name: "Windows PowerShell", appId: "x" }), false);
  assert.deepEqual(findWords("Adobe Illustrator 2025"), ["adobe", "illustrator"]);
  const s = summarize({ at: 0, apps: LIST });
  assert.ok(s.startsWith("Encontré 5 programas"));
  assert.ok(!s.includes("PowerShell"));
});

test("lo conocido queda enlazado a su AppID y lo nuevo se registra como programa propio", () => {
  const apps = new AppAutomation(new PermissionEngine(), "windows");
  apps.mode = "any";
  const ids = new Map();
  const added = ingest({ at: 0, apps: LIST }, apps, ids);
  assert.equal(ids.get("illustrator"), "{6D809377}\\Adobe\\Illustrator.exe");
  assert.equal(ids.get("blender"), "blender.exe");
  assert.equal(ids.get("calculadora"), "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App");
  assert.ok(apps.app("i-mi-contabilidad-pro"));
  assert.ok(apps.app("i-clipchamp"));
  assert.equal(added, 2);
  assert.equal(findInstalled({ at: 0, apps: LIST }, "contabilidad").name, "Mi Contabilidad Pro");
});

test("con permiso estudia el equipo; luego abre lo que tienes y responde «¿tengo …?»", async () => {
  const engine = new PermissionEngine();
  const apps = new AppAutomation(engine, "windows");
  apps.mode = "any";
  const notes = [];
  const launched = [];
  const kv = new MemoryKV();
  const brain = HockiBrain.load({ engine, kv, apps, scan: async () => LIST, notify: (t) => notes.push(t), launch: (a) => { launched.push(a.id); } });
  brain.onboard = "done";
  assert.ok(brain.handle("estudia mi equipo").text.includes("menú Inicio"));
  assert.ok(brain.handle("sí").text.includes("revisando"));
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(notes[0].includes("Encontré 5"));
  assert.ok(brain.handle("¿tengo blender?").text.startsWith("Sí"));
  assert.ok(brain.handle("tengo photoshop?").text.startsWith("No veo"));
  assert.equal(brain.handle("tengo una reunión mañana"), null, "una frase normal no es una búsqueda");
  assert.ok(brain.handle("qué programas tengo").text.includes("Adobe y diseño"));
  brain.handle("abre mi contabilidad pro"); brain.handle("sí");
  assert.deepEqual(launched, ["i-mi-contabilidad-pro"]);
  assert.equal(brain.appIdOf("i-mi-contabilidad-pro"), "C:\\Programs\\conta.exe");
  // Se acuerda al reiniciar, sin volver a pedir permiso.
  const again = HockiBrain.load({ engine: new PermissionEngine(), kv, apps: Object.assign(new AppAutomation(new PermissionEngine(), "windows"), { mode: "any" }), scan: async () => LIST });
  assert.equal(again.appIdOf("illustrator"), "{6D809377}\\Adobe\\Illustrator.exe");
});

test("al terminar la bienvenida ofrece estudiar el equipo, una sola vez", () => {
  const engine = new PermissionEngine();
  const brain = HockiBrain.load({ engine, kv: new MemoryKV(), apps: new AppAutomation(engine, "windows"), scan: async () => [] });
  brain.handle("David");
  const r = brain.handle("diseñador gráfico");
  assert.ok(r.text.includes("estudiar tu equipo"));
  assert.ok(brain.handle("no").text.includes("Cuando quieras"));
});
