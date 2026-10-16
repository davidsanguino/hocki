// Profesiones nacionales, diálogo, voz y permisos por aplicación.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PROFESSIONS, professionById } from "../src/hocki/professions.ts";
import { NATIONAL_PROFESSIONS, NATIONAL_TOP30_IDS } from "../src/hocki/professions-national.ts";
import { Speaker, greeting, partOfDay, phraseFor, reply, tipFor } from "../src/hocki/dialogue.ts";
import { AppAutomation, APP_CATALOG, looksSensitive } from "../src/hocki/apps.ts";
import { PermissionEngine } from "../src/hocki/permissions.ts";

const allKinds = { read_screen: true, open_app: true, send_message: true, change_settings: true, delete: true, payment: true };
const setup = (level = "confirm", os = "windows") => {
  const engine = new PermissionEngine({ level, kinds: { ...allKinds } });
  return { engine, apps: new AppAutomation(engine, os) };
};
const now = new Date(2026, 9, 14, 9, 30);
const first = () => 0;

// ── Profesiones ───────────────────────────────────────────────────────────────

test("las 30 profesiones nacionales existen, son únicas y están completas", () => {
  assert.equal(NATIONAL_TOP30_IDS.length, 30);
  assert.equal(new Set(NATIONAL_TOP30_IDS).size, 30);
  for (const id of NATIONAL_TOP30_IDS) {
    const p = professionById(id);
    assert.equal(p.id, id, id);
    assert.ok(p.hello || id === "abogado-litigante", `${id} sin saludo`);
    assert.ok(p.quickActions.length >= 3, id);
    assert.ok(p.tone, id);
  }
  assert.equal(NATIONAL_PROFESSIONS.length, 29);
});

test("ningún id se repite en todo el catálogo y el perfil general queda al final", () => {
  const ids = PROFESSIONS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.at(-1), "general");
  assert.ok(PROFESSIONS.filter((p) => p.group === "legal").length >= 10);
});

// ── Diálogo ───────────────────────────────────────────────────────────────────

test("saludo según la hora y el oficio", () => {
  assert.equal(partOfDay(new Date(2026, 0, 1, 8)), "mañana");
  assert.equal(partOfDay(new Date(2026, 0, 1, 15)), "tarde");
  assert.equal(partOfDay(new Date(2026, 0, 1, 21)), "noche");
  const g = greeting(professionById("docente"), now, "David");
  assert.match(g, /Buenos días, David/);
  assert.match(g, /profe/);
});

test("el tono cambia las frases: formal, cercano y motivador", () => {
  const f = phraseFor("taskDone", professionById("contador"), first);
  const c = phraseFor("taskDone", professionById("conductor"), first);
  const m = phraseFor("taskDone", professionById("ventas"), first);
  assert.equal(new Set([f, c, m]).size, 3);
});

test("consejos del oficio", () => {
  assert.match(tipFor(professionById("conductor"), first), /SOAT|Descansa/);
  assert.equal(tipFor(professionById("general")), null);
});

test("Hocki responde solo lo básico y pasa lo demás a la IA si se permite", () => {
  const id = "ingeniero-sistemas";
  assert.equal(reply("Hocki fuera", id, now, first).action, "stop");
  assert.equal(reply("Hocki, resumen del día", id, now, first).action, "summary");
  assert.match(reply("hola", id, now, first).text, /Buenos días/);
  assert.match(reply("¿qué puedes hacer?", id, now, first).text, /agentes/);
  assert.match(reply("qué hora es", id, now, first).text, /9:30/);
  assert.equal(reply("explícame la relatividad", id, now, first).action, "ask_ai");
});

test("el altavoz respeta apagado, ocupado y la parada", () => {
  const said = [];
  const backend = { speak: (t) => said.push(t), cancel: () => said.push("<cancel>") };
  const sp = new Speaker(backend);
  assert.equal(sp.say("hola", { busy: false }), false);        // apagado por defecto
  sp.settings.enabled = true;
  assert.equal(sp.say("hola", { busy: true }), false);          // la persona está escribiendo
  assert.equal(sp.say("hola", { busy: false }), true);
  sp.halt();                                                    // "Hocki fuera"
  assert.equal(sp.say("otra", { busy: false }), false);
  sp.resume();
  assert.equal(sp.say("otra", { busy: false }), true);
  assert.deepEqual(said, ["hola", "<cancel>", "otra"]);
});

// ── Aplicaciones ──────────────────────────────────────────────────────────────

test("sin darle permiso en la app, Hocki no la abre", () => {
  const { apps } = setup();
  const r = apps.open("whatsapp", "user", { resting: false });
  assert.equal(r.decision.type, "deny");
});

test("con permiso, abrir pide confirmación y conoce el destino de cada sistema", () => {
  const { apps } = setup("confirm", "android");
  apps.grantApp("whatsapp");
  assert.equal(apps.open("whatsapp", "user", { resting: false }).decision.type, "ask");
  assert.equal(apps.launchTarget("whatsapp"), "com.whatsapp");
  const win = setup("confirm", "windows").apps;
  assert.equal(win.launchTarget("calculadora"), "calc");
  assert.equal(win.launchTarget("telegram"), "tg:");
});

test("solo hace las tareas que tú le asignaste en esa app", () => {
  const { apps } = setup();
  assert.equal(apps.assignTask({ id: "t1", appId: "excel", title: "Abrir el informe", kind: "open_app" }), false); // sin permiso en la app
  apps.grantApp("excel");
  assert.ok(apps.assignTask({ id: "t1", appId: "excel", title: "Abrir el informe", kind: "open_app" }));
  assert.equal(apps.runTask("excel", "t1", "user", { resting: false }).decision.type, "ask");
  assert.equal(apps.runTask("excel", "t2", "user", { resting: false }).decision.type, "deny"); // no asignada
  assert.equal(apps.runTask("word", "t1", "user", { resting: false }).decision.type, "deny");
});

test("quitar el permiso de una app borra sus tareas", () => {
  const { apps } = setup();
  apps.grantApp("excel");
  apps.assignTask({ id: "t1", appId: "excel", title: "x", kind: "open_app" });
  apps.revokeApp("excel");
  assert.equal(apps.tasksOf("excel").length, 0);
  assert.equal(apps.runTask("excel", "t1", "user", { resting: false }).decision.type, "deny");
});

test("cualquier aplicación: las propias solo se registran en modo 'any'", () => {
  const { apps } = setup();
  const def = { id: "mi-erp", name: "Mi ERP", launch: { windows: "miérp.exe" } };
  assert.equal(apps.addCustom(def), false);
  apps.mode = "any";
  assert.ok(apps.addCustom(def));
  apps.grantApp("mi-erp");
  assert.equal(apps.open("mi-erp", "user", { resting: false }).decision.type, "ask");
  apps.mode = "catalog";
  assert.equal(apps.open("mi-erp", "user", { resting: false }).decision.type, "deny");
});

test("apps de dinero y claves: siempre con verificación y nunca en reposo", () => {
  assert.ok(looksSensitive("Nequi")); assert.ok(looksSensitive("Bancolombia")); assert.ok(looksSensitive("Gestor de contraseñas"));
  assert.equal(looksSensitive("Spotify"), false);
  const { apps } = setup("confirm", "android");
  apps.mode = "any";
  apps.addCustom({ id: "nequi", name: "Nequi", launch: { android: "com.nequi.MobileApp" } });
  apps.grantApp("nequi");
  const open = apps.open("nequi", "user", { resting: false }).decision;
  assert.equal(open.type, "ask"); assert.equal(open.needsBiometric, true);

  const r = setup("rest", "android");
  r.apps.mode = "any";
  r.apps.addCustom({ id: "nequi", name: "Nequi", launch: { android: "x" } });
  r.apps.grantApp("nequi");
  r.engine.preapprove({ kind: "open_app", summary: "x", fingerprint: "open:nequi", origin: "user" });
  const d = r.apps.open("nequi", "user", { resting: true }).decision;
  assert.notEqual(d.type, "run_preapproved");
});

test("una orden que viene de la pantalla no abre apps", () => {
  const { apps } = setup();
  apps.grantApp("chrome");
  assert.equal(apps.open("chrome", "observed", { resting: false }).decision.type, "suggest_only");
});

test("el catálogo tiene destinos de apertura para los sistemas principales", () => {
  for (const a of APP_CATALOG) assert.ok(Object.keys(a.launch).length >= 3, a.id);
});
