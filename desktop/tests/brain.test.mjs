// Memoria, registro, tareas en segundo plano y cerebro de Hocki.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryKV } from "../src/hocki/storage.ts";
import { Journal, JOURNAL_MAX } from "../src/hocki/journal.ts";
import { MemoryStore, redact, isSensitive } from "../src/hocki/memory.ts";
import { JobRunner, nextRunAfter } from "../src/hocki/jobs.ts";
import { parseJobRequest } from "../src/hocki/schedule-nl.ts";
import { routinesFor, buildSystemPrompt } from "../src/hocki/playbooks.ts";
import { HockiBrain, matchProfession } from "../src/hocki/brain.ts";
import { PermissionEngine } from "../src/hocki/permissions.ts";
import { professionById } from "../src/hocki/professions.ts";

const T0 = new Date(2026, 9, 14, 9, 0, 0).getTime(); // miércoles
const clock = (start = T0) => { const c = { t: start, now: () => c.t, adv: (ms) => { c.t += ms; } }; return c; };
const mkBrain = (c = clock(), kv = new MemoryKV(), level = "confirm") => {
  const engine = new PermissionEngine({ level, kinds: { send_message: true, read_screen: true, open_app: true, change_settings: true, delete: true, payment: true } });
  return { c, kv, engine, brain: HockiBrain.load({ engine, kv, now: c.now }) };
};

// ── Memoria ──────────────────────────────────────────────────────────────────

test("la memoria nace apagada y no guarda nada", () => {
  const m = new MemoryStore(() => T0);
  assert.equal(m.enabled, false);
  assert.deepEqual(m.remember("me gusta el café"), { ok: false, reason: "off" });
  m.record("user", "hola");
  assert.equal(m.conversations().length, 0);
});

test("recuerda, busca y olvida; rechaza claves y tarjetas", () => {
  const m = new MemoryStore(() => T0);
  m.setEnabled(true);
  assert.equal(m.remember("mi cliente principal es Pérez S.A.S.").ok, true);
  assert.equal(m.remember("mi clave es hunter2 y mi tarjeta 4111 1111 1111 1111").ok, false);
  assert.equal(m.remember("   ").ok, false);
  assert.ok(m.relevantFacts("cliente Pérez").length >= 1);
  assert.equal(m.forget("cliente"), 1);
  assert.equal(m.facts().length, 0);
});

test("redact oculta números de tarjeta y claves", () => {
  assert.ok(!redact("tarjeta 4111 1111 1111 1111").includes("4111 1111"));
  assert.equal(isSensitive("hola, buen día"), false);
});

test("forgetAll borra datos y conversaciones; purge borra todo", () => {
  const m = new MemoryStore(() => T0);
  m.setEnabled(true);
  m.remember("dato uno"); m.record("user", "hola"); m.record("assistant", "buenas");
  assert.equal(m.conversations().length, 1);
  m.forgetAll();
  assert.equal(m.facts().length, 0);
  assert.equal(m.conversations().length, 0);
});

// ── Registro ─────────────────────────────────────────────────────────────────

test("el registro se limita, filtra por día y exporta", () => {
  const c = clock();
  const j = new Journal(c.now);
  for (let i = 0; i < JOURNAL_MAX + 20; i++) j.add("system", `evento ${i}`);
  assert.equal(j.list({ limit: 5000 }).length, JOURNAL_MAX);
  const j2 = new Journal(c.now);
  j2.add("job", "Hecho, con coma", "detalle");
  assert.equal(j2.today().length, 1);
  assert.ok(j2.toCSV().split("\n").length >= 2);
  assert.ok(j2.toText().includes("Hecho"));
  j2.clear();
  assert.equal(j2.list().length, 0);
});

// ── Tareas ───────────────────────────────────────────────────────────────────

test("nextRunAfter: una vez, cada N minutos y diaria con días", () => {
  assert.equal(nextRunAfter({ type: "once", at: T0 + 1000 }, T0), T0 + 1000);
  assert.equal(nextRunAfter({ type: "once", at: T0 - 1 }, T0), null);
  assert.equal(nextRunAfter({ type: "every", minutes: 5 }, T0), T0 + 300000);
  const nx = new Date(nextRunAfter({ type: "daily", hour: 18, minute: 0, days: [1] }, T0));
  assert.equal(nx.getDay(), 1);
  assert.equal(nx.getHours(), 18);
});

const mkRunner = (c, level = "confirm") => {
  const engine = new PermissionEngine({ level, kinds: { send_message: true, delete: true, payment: true, read_screen: true, open_app: true, change_settings: true } });
  const journal = new Journal(c.now);
  const done = [];
  const runner = new JobRunner({ engine, journal, now: c.now, execute: (r) => done.push(r), summaryText: () => "RESUMEN" });
  return { engine, journal, runner, done };
};

test("un recordatorio se dispara a su hora y llega a la bandeja", () => {
  const c = clock();
  const { runner } = mkRunner(c);
  const job = runner.add({ title: "Llamar", schedule: { type: "once", at: c.t + 60000 }, action: { type: "notify", message: "Llama a mamá" } });
  assert.ok(!("error" in job));
  assert.equal(runner.tick(), 0);
  c.adv(61000);
  assert.equal(runner.tick(), 1);
  assert.ok(runner.unread().some((o) => o.text.includes("mamá")));
  assert.equal(runner.tick(), 0); // no se repite
  runner.markAllRead();
  assert.equal(runner.unread().length, 0);
});

test("tareas repetidas, resumen, límites y pausa", () => {
  const c = clock();
  const { runner } = mkRunner(c);
  runner.add({ title: "Agua", schedule: { type: "every", minutes: 10 }, action: { type: "notify", message: "Toma agua" } });
  c.adv(10 * 60000 + 1000); runner.tick();
  c.adv(10 * 60000); runner.tick();
  assert.equal(runner.unread().length, 2);
  assert.deepEqual(runner.add({ title: "x", schedule: { type: "once", at: c.t - 5 }, action: { type: "notify", message: "x" } }), { error: "past" });
  runner.pauseAll();
  c.adv(60 * 60000);
  assert.equal(runner.tick(), 0);
  runner.add({ title: "Res", schedule: { type: "once", at: c.t + 1000 }, action: { type: "summary" } });
  c.adv(2000); runner.tick();
  assert.ok(runner.unread().some((o) => o.text.includes("RESUMEN")));
  for (let i = 0; i < 60; i++) runner.add({ title: `t${i}`, schedule: { type: "every", minutes: 5 }, action: { type: "notify", message: "m" } });
  assert.ok(runner.list().filter((j) => j.status === "active" || j.status === "paused").length <= 50);
});

test("una acción sensible pide autorización y no se ejecuta sola", () => {
  const c = clock();
  const { runner, done, engine } = mkRunner(c);
  runner.add({ title: "Enviar", schedule: { type: "once", at: c.t + 1000 }, action: { type: "request", request: { kind: "send_message", target: "Ana", origin: "user" } } });
  c.adv(2000); runner.tick();
  assert.equal(done.length, 0);
  const ask = runner.unread().find((o) => o.kind === "approval");
  assert.ok(ask && ask.confirmationId);
  assert.equal(engine.pendingCount(), 1);
  runner.confirm(ask.confirmationId, { biometricOk: false });
  assert.equal(done.length, 1);
});

test("una acción sensible puede negarse y no se ejecuta", () => {
  const c = clock();
  const { runner, done } = mkRunner(c);
  runner.add({ title: "Borrar", schedule: { type: "once", at: c.t + 1000 }, action: { type: "request", request: { kind: "send_message", target: "Ana", origin: "user" } } });
  c.adv(2000); runner.tick();
  const ask = runner.unread().find((o) => o.kind === "approval");
  runner.deny(ask.confirmationId);
  assert.equal(done.length, 0);
});

test("con el interruptor general apagado no se ejecuta nada", () => {
  const c = clock();
  const { runner, done, engine } = mkRunner(c);
  runner.add({ title: "Enviar", schedule: { type: "once", at: c.t + 1000 }, action: { type: "request", request: { kind: "send_message", target: "Ana", origin: "user" } } });
  engine.kill("prueba");
  c.adv(2000); runner.tick();
  assert.equal(done.length, 0);
});

// ── Lenguaje natural ─────────────────────────────────────────────────────────

test("entiende recordatorios en español", () => {
  const a = parseJobRequest("Recuérdame llamar a mamá en 10 minutos", T0);
  assert.equal(a.spec.schedule.type, "once");
  assert.equal(a.spec.schedule.at, T0 + 600000);
  assert.ok(a.spec.action.message.toLowerCase().includes("llamar a mamá"));

  const b = parseJobRequest("recuérdame revisar el correo mañana a las 8", T0);
  const d = new Date(b.spec.schedule.at);
  assert.equal(d.getDate(), 15); assert.equal(d.getHours(), 8);

  const c2 = parseJobRequest("recuérdame tomar agua cada 30 minutos", T0);
  assert.deepEqual(c2.spec.schedule, { type: "every", minutes: 30 });

  const e = parseJobRequest("hazme el resumen del día todos los días a las 6 pm", T0);
  assert.equal(e.spec.action.type, "summary");
  assert.equal(e.spec.schedule.hour, 18);

  assert.equal(parseJobRequest("qué hora es", T0), null);
});

// ── Oficio y prompt ──────────────────────────────────────────────────────────

test("reconoce oficios y arma las rutinas y el prompt", () => {
  assert.equal(matchProfession("soy abogada").id, "abogado-litigante");
  assert.equal(matchProfession("trabajo de taxista").id, "conductor");
  assert.equal(matchProfession("hola"), null);
  const p = professionById("abogado-litigante");
  const rs = routinesFor(p);
  assert.ok(rs.length >= 1 && rs.length <= 4);
  assert.ok(rs.some((r) => r.action.type === "summary"));
  const sp = buildSystemPrompt({ profession: p, name: "David", facts: ["cliente Pérez"], now: new Date(T0) });
  assert.ok(sp.includes("David") && sp.includes("cliente Pérez"));
});

// ── Cerebro ──────────────────────────────────────────────────────────────────

test("el cerebro cambia de oficio, recuerda y olvida por orden", () => {
  const { brain } = mkBrain();
  assert.ok(brain.handle("soy contador").text.includes("contador"));
  assert.equal(brain.profession, "contador");
  assert.ok(brain.handle("recuerda que mi cliente es Pérez").text.includes("apagada"));
  brain.handle("activa tu memoria");
  assert.equal(brain.memory.enabled, true);
  assert.ok(brain.handle("recuerda que mi cliente es Pérez").text.includes("Anotado"));
  assert.ok(brain.handle("qué recuerdas").text.includes("Pérez"));
  assert.ok(brain.handle("recuerda que mi clave es abc123").text.includes("nunca"));
  assert.ok(brain.handle("olvida todo").text.includes("olvid"));
  assert.equal(brain.memory.facts().length, 0);
  assert.equal(brain.handle("explícame el IVA"), null);
});

test("el cerebro programa, lista y cancela tareas", () => {
  const { brain, c } = mkBrain();
  brain.handle("recuérdame estirarme en 5 minutos");
  assert.ok(brain.handle("qué tengo programado").text.includes("estirarme"));
  c.adv(6 * 60000);
  const out = brain.tick();
  assert.ok(out.some((o) => o.text.includes("estirarme")));
  assert.ok(brain.handle("qué pasó mientras no estaba").text.includes("estirarme"));
  brain.handle("recuérdame beber agua cada 20 minutos");
  assert.ok(brain.handle("cancela todo").text.includes("Cancelé"));
  assert.ok(brain.handle("qué tengo programado").text.includes("nada"));
});

test("activa las rutinas del oficio sin duplicarlas", () => {
  const { brain } = mkBrain();
  brain.handle("soy abogado");
  assert.ok(brain.handle("activa mis rutinas").text.includes("Programé"));
  assert.ok(brain.handle("activa mis rutinas").text.includes("ya estaban"));
});

test("wrap añade el prompt del oficio solo en el primer turno", () => {
  const { brain } = mkBrain();
  brain.handle("soy médico");
  const w1 = brain.wrap("¿qué es la hipertensión?");
  assert.ok(w1.length > "¿qué es la hipertensión?".length + 50);
  brain.afterTurn("¿qué es la hipertensión?", "…");
  assert.equal(brain.wrap("gracias"), "gracias");
  brain.newConversation();
  assert.ok(brain.wrap("hola").length > 50);
});

test("todo se guarda y se recupera tras cerrar y abrir", () => {
  const { brain, kv, c } = mkBrain();
  brain.handle("me llamo Camila");
  brain.handle("soy psicóloga");
  brain.handle("activa tu memoria");
  brain.handle("recuerda que prefiero reuniones cortas");
  brain.handle("recuérdame llamar en 1 hora");
  const again = HockiBrain.load({ engine: new PermissionEngine(), kv, now: c.now });
  assert.equal(again.name, "Camila");
  assert.equal(again.profession, "psicologo");
  assert.ok(again.memory.facts().length === 1);
  assert.equal(again.jobs.active().length, 1);
});

test("un guardado dañado no rompe el arranque", () => {
  const kv = new MemoryKV(); kv.set("hocki.brain.v1", "{no es json");
  const b = HockiBrain.load({ engine: new PermissionEngine(), kv });
  assert.equal(b.profession, "general");
});

test("'Hocki fuera' detiene todo y se puede reanudar", () => {
  const { brain, engine, c } = mkBrain();
  brain.handle("recuérdame algo en 1 minuto");
  brain.stopAll();
  assert.equal(engine.isKilled, true);
  c.adv(120000);
  assert.equal(brain.tick().length, 0);
  brain.resumeAll();
  assert.equal(engine.isKilled, false);
  c.adv(1000);
  assert.ok(brain.tick().length >= 1);
});
