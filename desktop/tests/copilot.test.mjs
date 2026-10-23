// Permisos, voz, biometría, paseo, resumen y profesiones de Hocki.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PermissionEngine, CONFIRM_WINDOW_MS } from "../src/hocki/permissions.ts";
import { parseVoice, normalize } from "../src/hocki/voice-commands.ts";
import { BiometricStore, cosine, sensitiveApprovalOk, voiceprint } from "../src/hocki/biometrics.ts";
import {
  ActivityTracker, DEFAULT_ROAM, collides, nextWanderTarget, retreatSpot, stepRoam,
} from "../src/hocki/roaming.ts";
import { buildSummary } from "../src/hocki/daily-summary.ts";
import { PROFESSIONS, addBusinessDays, professionById } from "../src/hocki/professions.ts";

const req = (kind, over = {}) => ({ kind, summary: `x ${kind}`, fingerprint: "f1", origin: "user", ...over });
const allKinds = { read_screen: true, open_app: true, send_message: true, change_settings: true, delete: true, payment: true };
const engine = (level, clock = { t: 1_000_000 }) => ({
  e: new PermissionEngine({ level, kinds: { ...allKinds } }, () => clock.t),
  clock,
});

// ── Permisos ──────────────────────────────────────────────────────────────────

test("por defecto Hocki no puede hacer nada", () => {
  const e = new PermissionEngine();
  assert.equal(e.decide(req("send_message"), { resting: false }).type, "deny");
});

test("sin permiso para esa clase de acción, se niega aunque el nivel sea alto", () => {
  const e = new PermissionEngine({ level: "confirm", kinds: { open_app: true } });
  assert.equal(e.decide(req("payment"), { resting: false }).type, "deny");
});

test("observar solo permite leer; sugerir solo sugiere", () => {
  const o = engine("observe").e;
  assert.equal(o.decide(req("read_screen"), { resting: false }).type, "run_preapproved");
  assert.equal(o.decide(req("send_message"), { resting: false }).type, "deny");
  const s = engine("suggest").e;
  assert.equal(s.decide(req("send_message"), { resting: false }).type, "suggest_only");
});

test("con confirmación: siempre pregunta; pagos y borrados piden biometría", () => {
  const { e } = engine("confirm");
  const m = e.decide(req("send_message"), { resting: false });
  assert.equal(m.type, "ask"); assert.equal(m.needsBiometric, false);
  const p = e.decide(req("payment"), { resting: false });
  assert.equal(p.type, "ask"); assert.equal(p.needsBiometric, true);
});

test("un pago no se aprueba sin biometría y caduca a los 60 s", () => {
  const { e, clock } = engine("confirm");
  const id = e.openConfirmation(req("payment"), true);
  assert.equal(e.approve(id), null);                       // falta biometría
  assert.ok(e.approve(id, { biometricOk: true }));         // con biometría sí
  const id2 = e.openConfirmation(req("payment"), true);
  clock.t += CONFIRM_WINDOW_MS + 1;
  assert.equal(e.approve(id2, { biometricOk: true }), null);
});

test("lo que dice la pantalla nunca da órdenes", () => {
  const { e } = engine("confirm");
  const d = e.decide(req("send_message", { origin: "observed" }), { resting: false });
  assert.equal(d.type, "suggest_only");
  assert.equal(e.preapprove(req("send_message", { origin: "observed" })), null);
});

test("en reposo solo corre lo autorizado de antemano, una sola vez", () => {
  const { e } = engine("rest");
  assert.equal(e.decide(req("send_message"), { resting: true }).type, "deny");
  const t = e.preapprove(req("send_message"));
  const d = e.decide(req("send_message"), { resting: true });
  assert.equal(d.type, "run_preapproved");
  assert.ok(e.consume(d.ticketId));
  assert.equal(e.consume(d.ticketId), false);
  assert.equal(e.decide(req("send_message"), { resting: true }).type, "deny");
  assert.ok(t);
});

test("el permiso previo está atado a esa acción exacta", () => {
  const { e } = engine("rest");
  e.preapprove(req("send_message", { fingerprint: "para-mama" }));
  assert.equal(e.decide(req("send_message", { fingerprint: "para-otra-persona" }), { resting: true }).type, "deny");
});

test("pagos y borrados nunca se hacen en reposo ni se autorizan por adelantado", () => {
  const { e } = engine("rest");
  assert.equal(e.preapprove(req("payment")), null);
  assert.equal(e.preapprove(req("delete")), null);
  assert.equal(e.decide(req("payment"), { resting: true }).type, "deny");
});

test("con la persona presente, el nivel de reposo vuelve a preguntar", () => {
  const { e } = engine("rest");
  assert.equal(e.decide(req("change_settings"), { resting: false }).type, "ask");
});

test("la parada de emergencia anula todo y solo la persona reactiva", () => {
  const { e } = engine("confirm");
  const id = e.openConfirmation(req("send_message"), false);
  e.kill();
  assert.equal(e.approve(id), null);
  assert.equal(e.decide(req("open_app"), { resting: false }).type, "deny");
  e.resume();
  assert.equal(e.decide(req("open_app"), { resting: false }).type, "ask");
});

test("el registro guarda lo ocurrido y se limita", () => {
  const { e } = engine("confirm");
  for (let i = 0; i < 600; i++) e.decide(req("open_app"), { resting: false });
  assert.equal(e.audit().length, 500);
});

// ── Voz ───────────────────────────────────────────────────────────────────────

test("'Hocki fuera' y 'Detener Hocki' paran, con tildes, signos y errores del dictado", () => {
  for (const f of ["Hocki fuera", "¡Detener Hocki!", "detente, Hocki", "Hoki fuera", "Hockey fuera", "para Hocki", "HOCKI STOP"]) {
    assert.equal(parseVoice(f).intent, "stop", f);
  }
  assert.equal(parseVoice("fuera de aquí").intent, "stop");
});

test("otras órdenes", () => {
  assert.equal(parseVoice("Hola Hocki").intent, "wake");
  assert.equal(parseVoice("Hocki").intent, "wake");
  assert.equal(parseVoice("Hocki, resumen del día").intent, "summary");
  assert.equal(parseVoice("Hocki a dormir").intent, "sleep");
  assert.equal(parseVoice("Hocki escóndete").intent, "hide");
  assert.equal(parseVoice("Hocki ven").intent, "show");
});

test("sin nombrar a Hocki no se activa nada, salvo parar", () => {
  assert.equal(parseVoice("la reunión de ayer fue larga").intent, "unknown");
  assert.equal(parseVoice("buenas tardes a todos").intent, "unknown");
  assert.equal(parseVoice("").intent, "unknown");
  assert.equal(normalize("¡Escóndete, Hocki!"), "escondete hocki");
});

// ── Biometría ─────────────────────────────────────────────────────────────────

test("sin consentimiento no se guarda nada; al retirarlo se borra todo", () => {
  const s = new BiometricStore();
  const v = [[1, 0, 0], [0.9, 0.1, 0], [1, 0.1, 0]];
  assert.equal(s.enroll("face", v), false);
  s.grantConsent();
  assert.equal(s.enroll("face", v), true);
  assert.equal(s.enroll("face", v.slice(0, 2)), false); // pocas muestras
  assert.equal(s.verify("face", [1, 0.05, 0]).match, true);
  assert.equal(s.verify("face", [0, 1, 0]).match, false);
  s.revokeConsent();
  assert.equal(s.enrolled("face"), false);
  assert.equal(s.verify("face", [1, 0, 0]).match, false);
});

test("exportar y recuperar la plantilla", () => {
  const s = new BiometricStore(); s.grantConsent();
  s.enroll("voice", [[1, 2], [1, 2.1], [1.1, 2]]);
  const r = BiometricStore.from(s.export());
  assert.equal(r.enrolled("voice"), true);
});

test("para aprobar algo sensible: biometría del sistema, o cara Y voz", () => {
  assert.equal(sensitiveApprovalOk({ platform: true }), true);
  assert.equal(sensitiveApprovalOk({ face: true, voice: true }), true);
  assert.equal(sensitiveApprovalOk({ face: true }), false);
  assert.equal(sensitiveApprovalOk({ voice: true }), false);
  assert.equal(sensitiveApprovalOk({}), false);
});

/** Voz sintética: armónicos de una frecuencia base con un reparto de energías (timbre). */
function tone(f0, weights, sr = 16000, secs = 1.2, noise = 0.0, seed = 1) {
  let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296) - 0.5;
  const out = new Float32Array(Math.floor(sr * secs));
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    weights.forEach((w, h) => { v += w * Math.sin((2 * Math.PI * f0 * (h + 1) * i) / sr); });
    out[i] = 0.2 * v + noise * rnd();
  }
  return out;
}

test("la huella de voz distingue timbres distintos y reconoce el mismo con ruido y otro volumen", () => {
  const a = [1, 0.7, 0.5, 0.3, 0.2, 0.1], b = [0.2, 0.3, 0.9, 1, 0.8, 0.6, 0.5, 0.4];
  const enrolled = [0, 1, 2].map((i) => voiceprint(tone(120 + i * 3, a, 16000, 1.2, 0.01, i + 1), 16000));
  const same = voiceprint(tone(121, a, 16000, 1.0, 0.02, 9).map((x) => x * 0.5), 16000);
  const other = voiceprint(tone(210, b, 16000, 1.0, 0.02, 7), 16000);
  const store = new BiometricStore(); store.grantConsent(); store.enroll("voice", enrolled);
  const yes = store.verify("voice", same), no = store.verify("voice", other);
  assert.ok(yes.score > no.score, `${yes.score} vs ${no.score}`);
  assert.equal(yes.match, true, `misma voz ${yes.score}`);
  assert.equal(no.match, false, `otra voz ${no.score}`);
  assert.ok(cosine([1, 2], [1, 2]) > 0.999);
});

// ── Paseo ─────────────────────────────────────────────────────────────────────

const screen = { w: 1920, h: 1080 };
function tracker() { const c = { t: 0 }; const tr = new ActivityTracker(() => c.t); return { tr, c }; }

test("al escribir o hacer clic Hocki se aparta, se vuelve transparente y deja pasar los clics", () => {
  const { tr, c } = tracker();
  c.t = 5000; tr.note("key", { x: 900, y: 500 });
  const f = stepRoam({ x: 880, y: 480 }, { x: 880, y: 480 }, tr, screen, 0.5);
  assert.equal(f.mode, "busy");
  assert.equal(f.clickThrough, true);
  assert.ok(f.opacity < 0.5);
  assert.ok(f.pos.x !== 880 || f.pos.y !== 480);
});

test("con calma pasea y es visible; sin actividad larga pasa a reposo", () => {
  const { tr, c } = tracker();
  c.t = 10_000; tr.note("move", { x: 100, y: 100 });
  const f = stepRoam({ x: 1500, y: 800 }, { x: 1400, y: 700 }, tr, screen, 0.5);
  assert.equal(f.mode, "calm"); assert.equal(f.clickThrough, false); assert.equal(f.opacity, 1);
  c.t = 200_000;
  assert.equal(tr.mode(), "idle");
});

test("nunca elige destinos cerca del cursor ni sobre zonas a respetar", () => {
  const cursor = { x: 960, y: 540 };
  const avoid = [{ x: 600, y: 300, w: 700, h: 500 }];
  let n = 0; const rand = () => ((n = (n * 7 + 3) % 97) / 97);
  for (let i = 0; i < 50; i++) {
    const p = nextWanderTarget(cursor, screen, avoid, () => rand());
    assert.equal(collides(p, cursor, avoid), false);
    assert.ok(p.x >= 0 && p.y >= 0 && p.x <= screen.w - DEFAULT_ROAM.size && p.y <= screen.h - DEFAULT_ROAM.size);
  }
  const r = retreatSpot({ x: 1800, y: 1000 }, screen);
  assert.ok(r.x < 600 && r.y < 600);
});

// ── Resumen y profesiones ─────────────────────────────────────────────────────

test("resumen del día con tareas, agentes y acciones", () => {
  const day = new Date(2026, 9, 14, 12);
  const at = (h) => new Date(2026, 9, 14, h).getTime();
  const events = [
    { at: at(9), type: "tarea", title: "Enviar informe", done: true },
    { at: at(11), type: "tarea", title: "Revisar contrato", done: false },
    { at: at(15), type: "agente", title: "Claude terminó el módulo de permisos" },
    { at: new Date(2026, 9, 13, 10).getTime(), type: "tarea", title: "de ayer", done: true },
  ];
  const audit = [{ at: at(10), kind: "send_message", summary: "x", decision: "approved" },
    { at: at(12), kind: "payment", summary: "y", decision: "deny" }];
  const s = buildSummary(events, audit, day);
  assert.deepEqual(s.done, ["Enviar informe"]);
  assert.deepEqual(s.pending, ["Revisar contrato"]);
  assert.equal(s.actions.approved, 1); assert.equal(s.actions.blocked, 1);
  assert.match(s.text, /Pendiente para mañana/);
  assert.match(buildSummary([], [], day).headline, /tranquilo/);
});

test("perfiles: hay profesiones jurídicas completas y un perfil general de respaldo", () => {
  for (const p of PROFESSIONS) { assert.ok(p.quickActions.length > 0, p.id); assert.ok(p.pitch, p.id); }
  assert.equal(new Set(PROFESSIONS.map((p) => p.id)).size, PROFESSIONS.length);
  for (const id of ["abogado-litigante", "juez", "fiscal", "notario", "penalista", "contencioso"]) {
    assert.equal(professionById(id).id, id);
  }
  assert.equal(professionById("inexistente").id, "general");
});

test("días hábiles: sin fines de semana ni festivos", () => {
  // Miércoles 14 oct 2026 + 3 hábiles = lunes 19 (jue 15, vie 16, lun 19).
  const d = addBusinessDays(new Date(2026, 9, 14), 3);
  assert.equal(d.getDate(), 19);
  // Con el lunes 19 festivo, pasa al martes 20.
  const h = addBusinessDays(new Date(2026, 9, 14), 3, [new Date(2026, 9, 19)]);
  assert.equal(h.getDate(), 20);
});
