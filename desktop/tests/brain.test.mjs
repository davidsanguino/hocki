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
const mkBrain = (c = clock(), kv = new MemoryKV(), level = "confirm", opts = {}) => {
  const engine = new PermissionEngine({ level, kinds: { send_message: true, read_screen: true, open_app: true, change_settings: true, delete: true, payment: true } });
  const brain = HockiBrain.load({ engine, kv, now: c.now });
  if (!opts.onboarding) brain.onboard = "done";
  return { c, kv, engine, brain };
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

test("'comandos' muestra la ayuda de lo que Hocki puede hacer", () => {
  const { brain } = mkBrain();
  const r = brain.handle("comandos");
  assert.ok(r.text.includes("memoria") && r.text.includes("Recuérdame") && r.text.includes("Hocki fuera"));
});

// ── Voz: abrir, cerrar, pasear y charla con IA ───────────────────────────────

import { parseVoice, stripName } from "../src/hocki/voice-commands.ts";
import { reply, speakable } from "../src/hocki/dialogue.ts";

test("comandos de voz para abrir, cerrar, pasear y quedarse quieto", () => {
  const cases = {
    "Abre Hocki": "open", "Hocki, inicia": "open", "Inicia Hocki": "open", "oye hocki abre": "open",
    "Cierra Hocki": "close", "Hocki, ciérrate": "close", "apaga hocki": "close",
    "Hocki fuera": "stop", "Detener Hocki": "stop",
    "Hocki, sal a pasear": "walk", "hocki quédate quieto": "still", "Hocki vuelve a la isla": "home",
    "¿Dónde estás, Hocki?": "where",
  };
  for (const [phrase, intent] of Object.entries(cases)) assert.equal(parseVoice(phrase).intent, intent, phrase);
  assert.equal(parseVoice("abre el navegador").intent, "unknown"); // frases largas sin nombre no hacen nada
  assert.equal(parseVoice("ábrete").intent, "open");                // órdenes cortas valen aunque se pierda el nombre
  assert.equal(parseVoice("a pasear").intent, "walk");
});

test("las órdenes de voz se convierten en acciones", () => {
  assert.equal(reply("Abre Hocki", "general").action, "open");
  assert.equal(reply("Cierra Hocki", "general").action, "close");
  assert.equal(reply("Hocki fuera", "general").action, "stop");
  assert.equal(reply("Hocki, sal a pasear", "general").action, "walk");
  assert.equal(reply("Hocki, explícame la ley 1564", "general").action, "ask_ai");
});

test("stripName quita el nombre y deja la orden", () => {
  assert.equal(stripName("Hocki, recuérdame beber agua en 5 minutos"), "recuérdame beber agua en 5 minutos");
  assert.equal(stripName("oye hocki qué tengo programado"), "oye qué tengo programado");
});

test("speakable resume respuestas largas y quita el formato", () => {
  const long = "**Hola.** " + "Esta es una frase larga de ejemplo. ".repeat(30) + "\n```js\nconsole.log(1)\n```";
  const s = speakable(long);
  assert.ok(s.length < 340 && !s.includes("**") && !s.includes("```"));
  assert.ok(s.endsWith("El resto está en el chat."));
  assert.equal(speakable("Listo."), "Listo.");
});

test("por escrito también: pasear, quieto, isla y escucha", () => {
  const { brain } = mkBrain();
  assert.equal(brain.handle("sal a pasear").action, "walk");
  assert.equal(brain.handle("quédate quieto").action, "still");
  assert.equal(brain.handle("vuelve a la isla").action, "home");
  assert.equal(brain.handle("escúchame siempre").action, "listen_on");
  assert.equal(brain.handle("deja de escuchar").action, "listen_off");
});

// ── Primera vez: nombre y oficio ─────────────────────────────────────────────

test("la primera vez Hocki pregunta nombre y oficio y se adapta", () => {
  const { brain } = mkBrain(clock(), new MemoryKV(), "confirm", { onboarding: true });
  assert.ok(brain.onboardingPrompt().includes("cómo te llamas"));
  assert.ok(brain.handle("Camila").text.includes("Mucho gusto, Camila"));
  assert.ok(brain.onboardingPrompt().includes("A qué te dedicas"));
  const r = brain.handle("soy docente");
  assert.equal(brain.profession, "docente");
  assert.ok(r.text.includes("activa mis rutinas"));
  assert.equal(brain.onboard, "done");
  assert.equal(brain.onboardingPrompt(), null);
  assert.equal(brain.name, "Camila");
});

test("la bienvenida acepta oficio sin 'soy', se puede omitir y no estorba preguntas", () => {
  const a = mkBrain(clock(), new MemoryKV(), "confirm", { onboarding: true }).brain;
  a.handle("David");
  a.handle("abogado");
  assert.equal(a.profession, "abogado-litigante");

  const b = mkBrain(clock(), new MemoryKV(), "confirm", { onboarding: true }).brain;
  assert.ok(b.handle("omitir").text.includes("Sin problema"));
  assert.equal(b.onboardingPrompt(), null);

  const c2 = mkBrain(clock(), new MemoryKV(), "confirm", { onboarding: true }).brain;
  assert.equal(c2.handle("¿Qué es una tutela?"), null); // pasa al asistente de IA
  assert.equal(c2.onboard, "done");

  const d = mkBrain(clock(), new MemoryKV(), "confirm", { onboarding: true }).brain;
  d.handle("Ana");
  assert.ok(d.handle("astronauta").text.includes("No reconocí"));
  assert.ok(d.handle("astronauta").text.includes("en general"));
  assert.equal(d.onboard, "done");
});

test("quien ya tenía datos guardados no repite la bienvenida", () => {
  const kv = new MemoryKV();
  const first = mkBrain(clock(), kv, "confirm", { onboarding: true }).brain;
  first.handle("Luis"); first.handle("soy contador");
  const again = HockiBrain.load({ engine: new PermissionEngine(), kv });
  assert.equal(again.onboardingPrompt(), null);
  assert.equal(again.profession, "contador");
});

// ── Apps, herramientas de diseño/Office y permisos por chat ──────────────────

import { AppAutomation, APP_CATALOG, matchApp } from "../src/hocki/apps.ts";
import { TOOLS, toolById, toolPrompt } from "../src/hocki/tools.ts";
import { voiceErrorText } from "../src/hocki/voice-service.ts";

const mkApps = (c = clock(), kv = new MemoryKV()) => {
  const engine = new PermissionEngine();
  const apps = new AppAutomation(engine, "windows");
  const launched = [];
  const closed = [];
  const acts = [];
  const brain = HockiBrain.load({ engine, kv, now: c.now, apps, launch: (a) => { launched.push(a.id); }, close: (a) => { closed.push(a.id); }, act: (a, action, arg) => { acts.push([a.id, action, arg]); } });
  brain.onboard = "done";
  return { c, kv, engine, apps, launched, closed, acts, brain };
};

test("el catálogo trae Adobe, 3D, CAD, audio/video y Office, con nombre para buscar el programa", () => {
  const need = ["photoshop", "illustrator", "premiere", "aftereffects", "audition", "blender", "maya", "3dsmax", "sketchup",
    "autocad", "revit", "davinci", "audacity", "word", "excel", "powerpoint", "outlook", "figma"];
  for (const id of need) {
    const a = APP_CATALOG.find((x) => x.id === id);
    assert.ok(a, id);
    assert.ok(a.find && a.find.length, `${id} necesita find`);
  }
  assert.equal(matchApp("abre el power point", APP_CATALOG).id, "powerpoint");
  assert.equal(matchApp("ábreme After Effects", APP_CATALOG).id, "aftereffects");
  assert.equal(matchApp("abre la calculadora", APP_CATALOG).id, "calculadora");
  assert.equal(matchApp("hola qué tal", APP_CATALOG), null);
});

test("cada herramienta del asistente tiene su ayuda y la mayoría están en el catálogo", () => {
  for (const t of TOOLS) {
    assert.ok(t.scripting && t.where && t.ideas.length, t.id);
    assert.ok(toolPrompt(t).includes(t.name));
  }
  for (const id of ["blender", "maya", "sketchup", "autocad", "photoshop", "excel", "word", "powerpoint"]) assert.ok(toolById(id), id);
});

test("abrir una app: pide permiso la primera vez, luego la abre sin repetir", () => {
  const { brain, launched, engine } = mkApps();
  assert.ok(brain.handle("abre photoshop").text.includes("necesito tu permiso"));
  assert.equal(launched.length, 0);
  assert.ok(brain.handle("sí").text.includes("Abriendo Photoshop"));
  assert.deepEqual(launched, ["photoshop"]);
  assert.equal(engine.grants.level, "confirm");
  assert.ok(brain.handle("abre photoshop").text.includes("Abriendo"));
  assert.equal(launched.length, 2);
});

test("decir que no, o quitar el permiso, impide abrirla", () => {
  const { brain, launched } = mkApps();
  brain.handle("abre blender"); brain.handle("no");
  assert.equal(launched.length, 0);
  brain.handle("abre blender"); brain.handle("sí");
  assert.equal(launched.length, 1);
  assert.ok(brain.handle("quita el permiso de blender").text.includes("ya no puedo"));
  assert.ok(brain.handle("abre blender").text.includes("necesito tu permiso"));
  assert.equal(launched.length, 1);
});

test("'Hocki fuera' bloquea abrir apps hasta reactivarlo; el modo sugerir tampoco abre", () => {
  const { brain, launched } = mkApps();
  brain.handle("abre excel"); brain.handle("sí");
  brain.stopAll();
  assert.ok(brain.handle("abre excel").text.includes("detenido"));
  brain.handle("reactívate");
  brain.handle("modo sugerir");
  assert.ok(brain.handle("abre excel").text.includes("sugerir"));
  assert.equal(launched.length, 1);
  brain.handle("modo confirmar");
  assert.ok(brain.handle("abre excel").text.includes("Abriendo"));
});

test("no abre apps que no conoce ni confunde 'abre Hocki'", () => {
  const { brain, launched } = mkApps();
  assert.equal(brain.handle("abre la puerta"), null);
  assert.equal(brain.handle("abre hocki"), null);
  assert.equal(launched.length, 0);
});

test("modo herramienta: ayuda, contexto para la IA y salir", () => {
  const { brain } = mkApps();
  const r = brain.handle("ayúdame con Blender");
  assert.ok(r.text.includes("Python (bpy)") && r.text.includes("salir de Blender"));
  assert.equal(brain.tool, "blender");
  assert.ok(brain.wrap("hazme un cubo").includes("Blender"));
  brain.afterTurn("a", "b");
  assert.ok(brain.wrap("ahora un cilindro").includes("Herramienta activa: Blender"));
  assert.ok(brain.handle("salir de blender").text.includes("Salí del modo"));
  assert.equal(brain.tool, undefined);
  assert.equal(brain.handle("modo excel").text.includes("Excel"), true);
  assert.equal(brain.tool, "excel");
});

test("permisos, apps autorizadas y herramienta se recuerdan al reiniciar", () => {
  const a = mkApps();
  a.brain.handle("abre autocad"); a.brain.handle("sí");
  a.brain.handle("ayúdame con AutoCAD");
  a.brain.save();
  const b = mkApps(a.c, a.kv);
  assert.equal(b.engine.grants.level, "confirm");
  assert.equal(b.apps.isGranted("autocad"), true);
  assert.equal(b.brain.tool, "autocad");
  assert.ok(b.brain.handle("abre autocad").text.includes("Abriendo"));
});

test("los errores de voz se explican en español", () => {
  for (const r of ["unsupported", "not-allowed", "audio-capture", "network", "language-not-supported", "otro"]) {
    assert.ok(voiceErrorText(r).length > 20, r);
  }
  assert.ok(voiceErrorText("unsupported").includes("chat"));
});

// ── Reconocedor de voz de Windows ────────────────────────────────────────────

import { parseNativeLine, nativeRecognizerFactory } from "../src/hocki/voice-native.ts";
import { VoiceService } from "../src/hocki/voice-service.ts";

test("las líneas del reconocedor de Windows se entienden", () => {
  assert.deepEqual(parseNativeLine("HEARD:hocki fuera"), { kind: "heard", text: "hocki fuera" });
  assert.deepEqual(parseNativeLine("ERR:no-spanish"), { kind: "error", reason: "no-spanish" });
  assert.deepEqual(parseNativeLine("READY"), { kind: "ready" });
  assert.equal(parseNativeLine("HEARD:  "), null);
  assert.equal(parseNativeLine("ruido"), null);
});

test("la voz nativa entrega frases y avisa de errores en español", async () => {
  let handler = null; const calls = [];
  const io = {
    start: async () => { calls.push("start"); return true; },
    stop: async () => { calls.push("stop"); },
    listen: async (h) => { handler = h; return () => { handler = null; }; },
  };
  const heard = []; const states = [];
  const v = new VoiceService({ factory: nativeRecognizerFactory(io), onHeard: (t) => heard.push(t), onState: (on, e) => states.push([on, e]) });
  assert.equal(v.start(), true);
  await new Promise((r) => setTimeout(r, 5));
  handler("READY"); handler("HEARD:abre hocki");
  assert.deepEqual(heard, ["abre hocki"]);
  handler("ERR:no-spanish");
  assert.deepEqual(states.at(-1), [false, "no-spanish"]);
  assert.equal(v.on, false);
  assert.ok(voiceErrorText("no-spanish").includes("español"));
});

test("el nombre de Hocki se reconoce aunque el motor lo escriba distinto", () => {
  for (const n of ["Yoqui", "Joqui", "Jocki", "Hoqui"]) assert.equal(parseVoice(`${n} fuera`).intent, "stop", n);
});

import { procKeys, cleanProgramName } from "../src/hocki/apps.ts";

test("cerrar una app: pide permiso la primera vez y luego la cierra, sin forzar", () => {
  const { brain, closed } = mkApps();
  assert.ok(brain.handle("cierra illustrator").text.includes("necesito tu permiso"));
  assert.equal(closed.length, 0);
  assert.ok(brain.handle("sí").text.includes("Cerrando Illustrator"));
  assert.deepEqual(closed, ["illustrator"]);
  assert.ok(brain.handle("cierra illustrator").text.includes("Cerrando"));
  assert.equal(closed.length, 2);
  assert.equal(brain.handle("cierra hocki"), null, "cerrar a Hocki no es cerrar una app");
});

test("el permiso por programa vale para abrir y para cerrar, y quitarlo impide ambas", () => {
  const { brain, launched, closed } = mkApps();
  brain.handle("abre blender"); brain.handle("sí");
  brain.handle("cierra blender");
  assert.deepEqual([launched.length, closed.length], [1, 1]);
  brain.handle("quita el permiso de blender");
  assert.ok(brain.handle("cierra blender").text.includes("necesito tu permiso"));
  assert.equal(closed.length, 1);
});

test("los procesos que se cierran salen del nombre del proceso, no del título de ninguna ventana", () => {
  const word = APP_CATALOG.find((a) => a.id === "word");
  assert.deepEqual(procKeys(word), ["winword"]);
  assert.deepEqual(procKeys(APP_CATALOG.find((a) => a.id === "illustrator")), ["illustrator"]);
  assert.deepEqual(procKeys(APP_CATALOG.find((a) => a.id === "aftereffects")), ["afterfx"]);
});

test("cualquier programa instalado: se pide por su nombre, con permiso, y la consola nunca", () => {
  const c = clock();
  const engine = new PermissionEngine();
  const apps = new AppAutomation(engine, "windows");
  apps.mode = "any";
  const launched = [];
  const brain = HockiBrain.load({ engine, kv: new MemoryKV(), now: c.now, apps, launch: (a) => { launched.push(a.find); } });
  brain.onboard = "done";
  assert.ok(brain.handle("abre el programa de Nuestro Editor Raro").text.includes("necesito tu permiso"));
  assert.ok(brain.handle("sí").text.includes("Abriendo"));
  assert.deepEqual(launched, [["nuestro", "editor", "raro"]]);
  for (const bad of ["powershell", "la consola", "cmd", "regedit", "el terminal"]) assert.equal(brain.handle(`abre ${bad}`), null, bad);
  assert.equal(cleanProgramName("a".repeat(50)), null);
  assert.equal(cleanProgramName("uno dos tres cuatro cinco"), null);
  // Se acuerda del programa propio y de su permiso al reiniciar.
  const again = HockiBrain.load({ engine: new PermissionEngine(), kv: brainKvOf(brain), now: c.now, apps: Object.assign(new AppAutomation(new PermissionEngine(), "windows"), { mode: "any" }) });
  assert.ok(again);
});

function brainKvOf(brain) { brain.save(); return brain["d"].kv; }

test("registrar la voz pide permiso antes, y se puede borrar o cambiar a obedecer a cualquiera", () => {
  const { brain } = mkApps();
  const ask = brain.handle("registra mi voz");
  assert.ok(ask.text.includes("huella") && !ask.action);
  assert.equal(brain.handle("no").action, undefined);
  brain.handle("registra mi voz");
  assert.equal(brain.handle("sí").action, "voice_enroll");
  assert.equal(brain.handle("borra mi voz").action, "voice_forget");
  assert.equal(brain.handle("obedece a cualquiera").action, "voice_gate_off");
  assert.equal(brain.handle("solo mi voz").action, "voice_gate_on");
});

import { matchSkill, skillsFor, sendKeysText } from "../src/hocki/app-skills.ts";

test("atajos por programa: la frase más larga gana y una charla larga no dispara nada", () => {
  const il = skillsFor("illustrator");
  assert.equal(matchSkill("guarda", il).keys, "^s");
  assert.equal(matchSkill("guardar como", il).keys, "^+s");
  assert.equal(matchSkill("rehaz", il).keys, "^+z", "Adobe rehace con Ctrl+Shift+Z");
  assert.equal(matchSkill("rehaz", skillsFor("word")).keys, "^y", "Office con Ctrl+Y");
  assert.equal(matchSkill("guardar como", skillsFor("word")).keys, "{F12}");
  assert.equal(matchSkill("crea contornos", il).keys, "^+o");
  assert.equal(matchSkill("linea", skillsFor("autocad")).keys, "l{ENTER}");
  assert.equal(matchSkill("guarda el archivo que te mande ayer por correo electronico", il), null);
  assert.equal(sendKeysText("1+1 = {2} (sí)"), "1{+}1 = {{}2{}} {(}sí{)}");
});

test("manejar un programa: permiso una sola vez, luego obedece, y lo delicado se pregunta", () => {
  const { brain, acts } = mkApps();
  const ask = brain.handle("en illustrator crea contornos");
  assert.ok(ask.text.includes("una sola vez"));
  assert.equal(acts.length, 0);
  const ok = brain.handle("sí");
  assert.ok(ok.text.includes("Crear contornos") && ok.text.includes("Aviso de privacidad") && ok.text.includes("Aviso legal"));
  assert.deepEqual(acts[0], ["illustrator", "keys", "^+o"]);
  // Ya no pregunta, y recuerda el programa con el que trabajas.
  brain.handle("guarda");
  assert.deepEqual(acts[1], ["illustrator", "keys", "^s"]);
  assert.ok(!brain.handle("agrupa").text.includes("Aviso"), "los avisos salen solo la primera vez");
  // Borrar: pregunta antes
  assert.ok(brain.handle("borra").text.includes("¿Lo hago?"));
  assert.equal(acts.length, 3);
  assert.ok(brain.handle("no").text.includes("no lo hice"));
  brain.handle("borra"); brain.handle("sí");
  assert.deepEqual(acts[3], ["illustrator", "keys", "{DELETE}"]);
});

test("escribir y pulsar botones por su nombre; aprender un programa", () => {
  const { brain, acts } = mkApps();
  brain.handle("abre word"); brain.handle("sí");
  brain.handle("escribe: Informe (versión 2)");
  assert.deepEqual(acts[0], ["word", "type", "Informe {(}versión 2{)}"]);
  brain.handle("haz clic en Insertar");
  assert.deepEqual(acts[1], ["word", "click", "Insertar"]);
  assert.ok(brain.handle("pulsa el botón Enviar").text.includes("¿Lo hago?"), "enviar es delicado");
  brain.handle("aprende word");
  assert.deepEqual(acts.at(-1), ["word", "list", ""]);
  assert.ok(brain.handle("qué sabes hacer en word").text.includes("Negrita"));
});

test("sin programa activo, una orden suelta no se convierte en atajo", () => {
  const { brain, acts } = mkApps();
  assert.equal(brain.handle("guarda"), null);
  assert.equal(acts.length, 0);
  assert.ok(brain.handle("escribe: hola").text.includes("¿En qué programa"));
  assert.ok(brain.handle("borra mi memoria").text.length > 0);
  assert.equal(acts.length, 0);
});

test("tareas completas: permiso para mirar la pantalla una vez, permiso del programa una vez, y arranca", () => {
  const c = clock();
  const engine = new PermissionEngine();
  const apps = new AppAutomation(engine, "windows");
  const started = [];
  const agent = { start: (a, goal) => { started.push([a.id, goal]); return true; }, answer: () => false, waiting: () => false, busy: () => false, halt: () => {} };
  const kv = new MemoryKV();
  const brain = HockiBrain.load({ engine, kv, now: c.now, apps, agent, act: () => {}, aiName: () => "Ollama" });
  brain.onboard = "done";
  const ask = brain.handle("en Illustrator, hazlo tú: exporta el logo en PNG");
  assert.ok(ask.text.includes("Ollama") && ask.text.includes("captura"));
  const perm = brain.handle("sí");
  assert.ok(perm.text.includes("una sola vez"));
  assert.equal(started.length, 0);
  assert.ok(brain.handle("sí").text.includes("paso a paso"));
  assert.deepEqual(started[0], ["illustrator", "exporta el logo en PNG"]);
  // Ya no vuelve a pedir nada; una orden larga con el programa nombrado también es una tarea.
  brain.handle("en Illustrator cambia el color del fondo a azul");
  assert.deepEqual(started[1], ["illustrator", "cambia el color del fondo a azul"]);
  // Una pregunta no es una tarea.
  assert.equal(brain.handle("en Illustrator cómo hago un degradado?")?.text?.includes("paso a paso") ?? false, false);
  // Se acuerda del permiso de mirar al reiniciar.
  const again = HockiBrain.load({ engine, kv, now: c.now, apps, agent, act: () => {} });
  again.onboard = "done";
  assert.ok(again.handle("en Illustrator, hazlo tú: guarda una copia").text.includes("paso a paso"));
});
