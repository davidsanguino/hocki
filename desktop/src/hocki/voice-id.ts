// Quién habla: la huella de voz de la persona y la prueba inicial.
//
// Es una huella sencilla (cómo suena la voz, en 48 números), calculada en el equipo con el
// micrófono. No guarda el audio. Sirve para que Hocki obedezca a TU voz y no a la tele o a otra
// persona; NO es una seguridad fuerte (una grabación tuya podría engañarla), por eso las cosas
// delicadas siguen pidiendo la verificación del sistema (ver biometrics.ts).

import { BiometricStore, MIN_SAMPLES, cosine, voiceprint } from "./biometrics";

export const FRAME = 512;
/** Lo mínimo de voz (en segundos, ya sin silencios) para que una muestra valga. */
export const MIN_VOICED_SECONDS = 0.5;

/** Se queda solo con los tramos donde hay voz (los más fuertes) y los junta. */
export function voicedOnly(samples: Float32Array, sampleRate: number): { audio: Float32Array; seconds: number } {
  const n = Math.floor(samples.length / FRAME);
  if (n < 2) return { audio: new Float32Array(0), seconds: 0 };
  const energy: number[] = [];
  for (let f = 0; f < n; f++) {
    let e = 0;
    for (let i = 0; i < FRAME; i++) { const v = samples[f * FRAME + i]; e += v * v; }
    energy.push(e / FRAME);
  }
  const sorted = [...energy].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.45)] * 3 + 1e-7; // por encima del ruido de fondo
  const keep: number[] = [];
  energy.forEach((e, f) => { if (e > floor) keep.push(f); });
  const audio = new Float32Array(keep.length * FRAME);
  keep.forEach((f, k) => audio.set(samples.subarray(f * FRAME, (f + 1) * FRAME), k * FRAME));
  return { audio, seconds: audio.length / sampleRate };
}

/** Huella de una grabación, o null si casi no hay voz. */
export function printOf(samples: Float32Array, sampleRate: number): number[] | null {
  const v = voicedOnly(samples, sampleRate);
  if (v.seconds < MIN_VOICED_SECONDS) return null;
  return voiceprint(v.audio, sampleRate);
}

export interface VoiceCheck { ok: boolean; score: number; enough: boolean }

interface Saved { store: string; threshold: number; gate: boolean }

export class VoiceIdentity {
  private store = new BiometricStore();
  private threshold = 0.9;
  /** Si está encendido, Hocki solo obedece si reconoce tu voz. */
  gate = false;

  get enrolled() { return this.store.enrolled("voice"); }
  get limit() { return this.threshold; }

  /** Guarda la huella con tu consentimiento; falla con menos de 3 muestras. */
  enroll(prints: number[][]): boolean {
    this.store.grantConsent();
    if (prints.length < MIN_SAMPLES || !this.store.enroll("voice", prints)) return false;
    // El umbral sale de cuánto se parecen entre sí tus propias muestras, con un margen.
    let min = 1;
    for (let i = 0; i < prints.length; i++) for (let j = i + 1; j < prints.length; j++) min = Math.min(min, cosine(prints[i], prints[j]));
    this.threshold = Math.min(0.98, Math.max(0.75, min - 0.03));
    this.gate = true;
    return true;
  }

  /** ¿Esta grabación (lo último que se oyó) suena a ti? */
  check(samples: Float32Array, sampleRate: number): VoiceCheck {
    const p = printOf(samples, sampleRate);
    if (!p) return { ok: false, score: 0, enough: false };
    return this.checkPrint(p);
  }

  checkPrint(p: number[]): VoiceCheck {
    const r = this.store.verify("voice", p);
    // `verify` usa su propio umbral; aquí manda el calibrado con tus muestras.
    return { ok: r.score >= this.threshold, score: r.score, enough: true };
  }

  forget() { this.store.deleteAll(); this.gate = false; this.threshold = 0.9; }

  export(): string {
    const s: Saved = { store: this.store.export(), threshold: this.threshold, gate: this.gate };
    return JSON.stringify(s);
  }

  static from(json: string | null): VoiceIdentity {
    const id = new VoiceIdentity();
    if (!json) return id;
    try {
      const d = JSON.parse(json) as Partial<Saved>;
      if (typeof d.store === "string") id.store = BiometricStore.from(d.store);
      if (typeof d.threshold === "number") id.threshold = d.threshold;
      id.gate = !!d.gate && id.enrolled;
    } catch { /* vacío */ }
    return id;
  }
}
