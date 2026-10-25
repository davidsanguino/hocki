// Huella de voz: se reconoce a la misma persona y no a otra (con voces sintéticas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { VoiceIdentity, voicedOnly, printOf } from "../src/hocki/voice-id.ts";

const SR = 16000;

/** Una "voz" de mentira: armónicos de f0 con unos formantes fijos; cada frase varía el tono y el ritmo. */
function voice(f0, formants, seconds, seed) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  const wobble = 0.9 + rnd() * 0.25;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const syll = Math.max(0, Math.sin(2 * Math.PI * (2 + rnd() * 0.0) * t * wobble)) ** 0.5; // sílabas
    let v = 0;
    for (let h = 1; h * f0 * wobble < 7000; h++) {
      const fr = h * f0 * wobble;
      let gain = 1 / h;
      for (const [fc, bw] of formants) gain += 2.5 * Math.exp(-(((fr - fc) / bw) ** 2));
      v += gain * Math.sin(2 * Math.PI * fr * t);
    }
    out[i] = 0.05 * v * syll + (rnd() - 0.5) * 0.004;
  }
  return out;
}

const ANA = [[700, 120], [1200, 150], [2600, 200]];
const BETO = [[400, 100], [2000, 250], [3300, 300]];

test("recorta el silencio y deja solo la voz", () => {
  const v = voice(120, ANA, 2, 1);
  const quiet = new Float32Array(SR);
  const joined = new Float32Array(v.length + quiet.length);
  joined.set(v); joined.set(quiet, v.length);
  const r = voicedOnly(joined, SR);
  assert.ok(r.seconds > 0.5 && r.seconds < 2.2, `voz ${r.seconds}`);
  assert.equal(printOf(new Float32Array(SR * 2), SR), null, "el silencio no vale");
});

test("registra tu voz, te reconoce a ti y no a otra persona", () => {
  const id = new VoiceIdentity();
  const prints = [1, 2, 3, 4].map((k) => printOf(voice(120, ANA, 3, k), SR));
  assert.ok(prints.every(Boolean));
  assert.equal(id.enroll(prints.slice(0, 2)), false, "con 2 muestras no basta");
  assert.equal(id.enroll(prints), true);
  assert.equal(id.enrolled, true);
  assert.equal(id.gate, true);
  assert.equal(id.check(voice(120, ANA, 3, 77), SR).ok, true, "la misma voz");
  assert.equal(id.check(voice(210, BETO, 3, 78), SR).ok, false, "otra voz");
  assert.equal(id.check(new Float32Array(SR), SR).enough, false, "sin voz no decide");
});

test("se guarda y se borra: olvidar quita todo", () => {
  const id = new VoiceIdentity();
  id.enroll([1, 2, 3].map((k) => printOf(voice(120, ANA, 3, k), SR)));
  const again = VoiceIdentity.from(id.export());
  assert.equal(again.enrolled, true);
  assert.equal(again.gate, true);
  assert.equal(again.check(voice(120, ANA, 3, 9), SR).ok, true);
  again.forget();
  assert.equal(again.enrolled, false);
  assert.equal(again.gate, false);
  assert.equal(VoiceIdentity.from("{no es json").enrolled, false);
});
