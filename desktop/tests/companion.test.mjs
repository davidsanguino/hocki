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
  // Las de escritorio (diseño, 3D, Office…) se encuentran por el nombre de su acceso directo (find).
  for (const a of APP_CATALOG) assert.ok(Object.keys(a.launch).length >= 3 || (a.find && a.find.length), a.id);
});

// ── "¿Dónde estás, Hocki?", escucha por voz y mirada ──────────────────────────

import { parseVoice } from "../src/hocki/voice-commands.ts";
import { WHERE_REPLY } from "../src/hocki/dialogue.ts";
import { VoiceService } from "../src/hocki/voice-service.ts";
import { gazeToward } from "../src/hocki/minibots.ts";

test("'¿Dónde estás, Hocki?' en sus formas habituales", () => {
  for (const f of ["¿Dónde estás, Hocki?", "Hocki, ¿dónde estás?", "dónde andas Hocki", "Hoki donde estas"]) {
    assert.equal(parseVoice(f).intent, "where", f);
  }
  assert.equal(parseVoice("¿dónde estás?").intent, "unknown"); // sin nombrarlo no responde
});

test("responde 'Acá estoy, jefe' y pide mostrar la isla", () => {
  const r = reply("¿Dónde estás Hocki?", "general", now, first);
  assert.equal(r.text, "Acá estoy, jefe");
  assert.equal(r.text, WHERE_REPLY);
  assert.equal(r.action, "show");
});

function fakeRecognizer() {
  const rec = { lang: "", continuous: false, interimResults: true, onresult: null, onend: null, onerror: null, starts: 0, stops: 0,
    start() { this.starts++; }, stop() { this.stops++; } };
  return rec;
}
const result = (text, isFinal = true) => ({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });

test("la escucha entrega solo frases finales, en español, y se reenciende sola", () => {
  const rec = fakeRecognizer(); const heard = []; const timers = []; const states = [];
  const svc = new VoiceService({ factory: () => rec, onHeard: (t) => heard.push(t), onState: (on, e) => states.push([on, e]),
    setTimer: (fn) => timers.push(fn) });
  assert.equal(svc.start(), true);
  assert.equal(rec.lang, "es-CO"); assert.equal(rec.continuous, true); assert.equal(rec.interimResults, false);
  rec.onresult(result("hocki fuera", false)); // parcial: se ignora
  rec.onresult(result("  ¿Dónde estás Hocki?  "));
  assert.deepEqual(heard, ["¿Dónde estás Hocki?"]);
  rec.onend(); timers.pop()();                  // el motor se cortó: vuelve a encenderse
  assert.equal(rec.starts, 2);
  svc.stop();
  rec.onend(); assert.equal(timers.length, 0);  // apagado: no reintenta
  assert.equal(svc.on, false);
  assert.deepEqual(states.at(-1), [false, undefined]);
});

test("si no hay reconocimiento de voz o niegan el micrófono, no se enciende", () => {
  const none = new VoiceService({ factory: () => null, onHeard: () => {} });
  assert.equal(none.supported, false); assert.equal(none.start(), false);
  const rec = fakeRecognizer(); const states = [];
  const svc = new VoiceService({ factory: () => rec, onHeard: () => {}, onState: (on, e) => states.push([on, e]) });
  svc.start(); rec.onerror({ error: "not-allowed" });
  assert.equal(svc.on, false);
  assert.deepEqual(states.at(-1), [false, "not-allowed"]);
});

test("los cerditos miran hacia el cursor y sin cursor miran al frente", () => {
  assert.deepEqual(gazeToward(100, 100, null), { lookX: 0, lookY: 0 });
  const right = gazeToward(100, 100, { x: 600, y: 100 });
  assert.ok(right.lookX > 0.9 && Math.abs(right.lookY) < 0.01);
  const up = gazeToward(100, 100, { x: 100, y: -200 });
  assert.ok(up.lookY > 0.9, "arriba = positivo");
  const left = gazeToward(100, 100, { x: -400, y: 100 });
  assert.ok(left.lookX < -0.9);
});

// ── Sonidos propios ───────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import { SOUND_NAMES } from "../src/core/sound.ts";

test("cada sonido que Hocki pide existe como WAV propio de 16 bits y mono", () => {
  for (const name of SOUND_NAMES) {
    const file = new URL(`../sounds/${name}.wav`, import.meta.url);
    assert.ok(existsSync(file), `falta sounds/${name}.wav`);
    const b = readFileSync(file);
    assert.equal(b.toString("ascii", 0, 4), "RIFF", name);
    assert.equal(b.toString("ascii", 8, 12), "WAVE", name);
    assert.equal(b.readUInt16LE(22), 1, `${name} no es mono`);
    assert.equal(b.readUInt16LE(34), 16, `${name} no es de 16 bits`);
    const seconds = (b.length - 44) / (b.readUInt32LE(24) * 2);
    assert.ok(seconds > 0.01 && seconds < 6, `${name} dura ${seconds}s`);
  }
});

test("la bienvenida suena lo mismo que dura la animación (≈4,6 s)", () => {
  const b = readFileSync(new URL("../sounds/greeting.wav", import.meta.url));
  const seconds = (b.length - 44) / (b.readUInt32LE(24) * 2);
  assert.ok(Math.abs(seconds - 4.8) < 0.3, `${seconds}`);
});

test("no queda el nombre del personaje original en el código ni en los textos", async () => {
  // Solo el aviso de licencia (NOTICE.md y LICENSE-COUCOU-MIT) puede nombrarlo, por obligación de la MIT.
  const { readdirSync, readFileSync: read, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const dirs = ["src", "src-tauri/src", "dev", "scripts"];
  const files = ["README.md", "index.html", "settings.html", "hocki.html", "package.json", "src-tauri/tauri.conf.json"];
  const bad = [];
  const scan = (p) => {
    for (const name of readdirSync(p)) {
      const full = join(p, name);
      if (statSync(full).isDirectory()) scan(full);
      else if (/\.(ts|rs|json|html|css|md|mjs|py)$/.test(name)) check(full);
    }
  };
  const check = (f) => { if (/coucou|mochi/i.test(read(f, "utf8"))) bad.push(f); };
  for (const d of dirs) scan(join(root, d));
  for (const f of files) check(join(root, f));
  assert.deepEqual(bad, []);
});
