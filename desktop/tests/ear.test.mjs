// «¡Hey Hocki!» y el oído: la palabra para despertarlo y el corte de frases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectWake, WakeWindow, wakeAck } from "../src/hocki/wake.ts";
import { VadSegmenter, resample, toPcm16Base64, earRecognizerFactory } from "../src/hocki/voice-ear.ts";

test("¡Hey Hocki! en sus formas habituales, con o sin orden detrás", () => {
  for (const f of ["¡Hey Hocki!", "Hey, Hocki.", "hey hockey", "Ey Joki", "Oye Hocki", "Hey Jockey", "heyhocki", "Hola Hocki"]) {
    assert.equal(detectWake(f).woke, true, f);
  }
  assert.deepEqual(detectWake("Hey Hocki, abre Illustrator"), { woke: true, rest: "abre illustrator" });
  assert.equal(detectWake("Hocki guarda").rest, "guarda");
  for (const f of ["hey, ¿cómo estás?", "el partido de hockey estuvo bueno", "abre illustrator", "rocky es una película"]) {
    assert.equal(detectWake(f).woke, false, f);
  }
  assert.ok(wakeAck(3).length > 0);
});

test("la ventana de conversación se abre y se cierra", () => {
  let t = 0;
  const w = new WakeWindow(() => t);
  assert.equal(w.isOpen, false);
  w.open(8000);
  t = 7000; assert.equal(w.isOpen, true);
  t = 9000; assert.equal(w.isOpen, false);
});

const RATE = 16000;
function tone(ms, amp, f = 220) {
  const n = Math.round((RATE * ms) / 1000);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * f * i) / RATE);
  return a;
}
function noise(ms, amp, seed = 1) {
  const n = Math.round((RATE * ms) / 1000);
  const a = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; a[i] = amp * ((s / 2147483647) * 2 - 1); }
  return a;
}

test("corta una frase cuando hablas y se calla; ignora el ruido y los golpes", () => {
  const vad = new VadSegmenter(RATE);
  const segs = [];
  segs.push(...vad.feed(noise(1500, 0.002)));
  assert.equal(segs.length, 0, "el ruido de fondo no es una frase");
  segs.push(...vad.feed(tone(1200, 0.2)));
  segs.push(...vad.feed(noise(900, 0.002, 7)));
  assert.equal(segs.length, 1);
  const secs = segs[0].length / RATE;
  assert.ok(secs > 1.2 && secs < 2.4, `duración ${secs}`);
  segs.push(...vad.feed(tone(100, 0.3)), ...vad.feed(noise(900, 0.002, 9)));
  assert.equal(segs.length, 1, "un golpe corto no cuenta");
});

test("audio a 16 kHz en PCM de 16 bits", () => {
  const r = resample(new Float32Array(48000), 48000);
  assert.equal(r.length, 16000);
  const b64 = toPcm16Base64(Float32Array.from([0, 1, -1]));
  assert.deepEqual([...Buffer.from(b64, "base64")], [0, 0, 0xff, 0x7f, 0x00, 0x80]);
});

test("el oído: pide el micrófono, transcribe cada frase y calla mientras Hocki habla", async () => {
  let listener = null;
  let muted = false;
  const sent = [];
  const make = (err = null) => earRecognizerFactory({
    startMic: async () => err,
    listen: (fn) => { listener = fn; return () => { listener = null; }; },
    sampleRate: () => RATE,
    transcribe: async (b64) => { sent.push(b64.length); return "hey hocki abre word"; },
    muted: () => muted,
  });
  const rec = make()();
  const heard = [];
  rec.onresult = (e) => heard.push(e.results[0][0].transcript);
  rec.start();
  await new Promise((r) => setTimeout(r, 5));
  listener(noise(600, 0.002)); listener(tone(1000, 0.2)); listener(noise(900, 0.002, 3));
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(heard, ["hey hocki abre word"]);
  muted = true;
  listener(tone(1000, 0.2)); listener(noise(900, 0.002, 5));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sent.length, 1, "su propia voz no se transcribe");
  rec.stop();
  assert.equal(listener, null);
  const denied = make("denied")();
  const errs = [];
  denied.onerror = (e) => errs.push(e.error);
  denied.start();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(errs, ["not-allowed"]);
});
