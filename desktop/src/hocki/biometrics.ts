// Reconocimiento de voz y de cara de Hocki: comparación y consentimiento.
//
// Todo ocurre en el dispositivo: las plantillas (listas de números, nunca la
// foto ni el audio) se guardan localmente, con consentimiento expreso, y se
// pueden borrar con un botón. Esta capa no sabe de cámaras ni micrófonos: cada
// plataforma le entrega un "embedding" y aquí se compara.
//
// Importante: la voz y la cara de Hocki sirven para ACTIVAR y personalizar. Para
// aprobar acciones sensibles se exige la biometría del propio sistema (Windows
// Hello, Face ID/Touch ID, huella de Android) o, si no existe, cara Y voz juntas.

export interface Template { vectors: number[][]; createdAt: number }
export interface MatchResult { match: boolean; score: number }

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Umbrales: conservadores; la voz es menos fiable que la cara. */
export const THRESHOLDS = { face: 0.8, voice: 0.93 } as const;
export const MIN_SAMPLES = 3;

export class BiometricStore {
  private data: { consent: boolean; face?: Template; voice?: Template } = { consent: false };
  private now: () => number;
  constructor(now: () => number = () => Date.now()) { this.now = now; }

  get hasConsent() { return this.data.consent; }
  grantConsent() { this.data.consent = true; }

  /** Retirar el consentimiento borra todo. */
  revokeConsent() { this.deleteAll(); }
  deleteAll() { this.data = { consent: false }; }
  deleteOne(kind: "face" | "voice") { delete this.data[kind]; }

  enrolled(kind: "face" | "voice") { return !!this.data[kind]; }

  enroll(kind: "face" | "voice", vectors: number[][]): boolean {
    if (!this.data.consent || vectors.length < MIN_SAMPLES) return false;
    this.data[kind] = { vectors: vectors.map((v) => [...v]), createdAt: this.now() };
    return true;
  }

  verify(kind: "face" | "voice", sample: number[]): MatchResult {
    const t = this.data[kind];
    if (!this.data.consent || !t) return { match: false, score: 0 };
    // Promedio de las mejores similitudes con las muestras guardadas.
    const scores = t.vectors.map((v) => cosine(v, sample)).sort((x, y) => y - x);
    const top = scores.slice(0, Math.max(1, Math.ceil(scores.length / 2)));
    const score = top.reduce((s, x) => s + x, 0) / top.length;
    return { match: score >= THRESHOLDS[kind], score };
  }

  export(): string { return JSON.stringify(this.data); }
  static from(json: string, now?: () => number): BiometricStore {
    const s = new BiometricStore(now);
    try { const d = JSON.parse(json); if (d && typeof d.consent === "boolean") s.data = d; } catch { /* vacío */ }
    return s;
  }
}

/** ¿Basta esto para aprobar una acción sensible? */
export function sensitiveApprovalOk(p: { platform?: boolean; face?: boolean; voice?: boolean }): boolean {
  return !!p.platform || (!!p.face && !!p.voice);
}

// ── Huella de voz (sin modelos, funciona en cualquier plataforma) ────────────

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      }
    }
  }
}

const BANDS = 24;
const FRAME = 512;

/** Vector de 48 números (media y variación de 24 bandas de energía) de una grabación mono. */
export function voiceprint(samples: Float32Array | number[], sampleRate: number): number[] {
  const hop = FRAME / 2;
  const hz = (bin: number) => (bin * sampleRate) / FRAME;
  const mel = (f: number) => 2595 * Math.log10(1 + f / 700);
  const maxMel = mel(Math.min(8000, sampleRate / 2));
  const bandOf = (bin: number) => Math.min(BANDS - 1, Math.floor((mel(hz(bin)) / maxMel) * BANDS));

  const sums = new Float64Array(BANDS), sq = new Float64Array(BANDS);
  let frames = 0;
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME);
  for (let s = 0; s + FRAME <= samples.length; s += hop) {
    let energy = 0;
    for (let i = 0; i < FRAME; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
      re[i] = samples[s + i] * w; im[i] = 0; energy += samples[s + i] ** 2;
    }
    if (energy / FRAME < 1e-6) continue; // silencio
    fft(re, im);
    const band = new Float64Array(BANDS);
    for (let b = 1; b < FRAME / 2; b++) {
      if (hz(b) > 8000) break;
      band[bandOf(b)] += re[b] * re[b] + im[b] * im[b];
    }
    for (let k = 0; k < BANDS; k++) {
      const v = Math.log(band[k] + 1e-9);
      sums[k] += v; sq[k] += v * v;
    }
    frames++;
  }
  if (!frames) return new Array(BANDS * 2).fill(0);
  const out: number[] = [];
  for (let k = 0; k < BANDS; k++) out.push(sums[k] / frames);
  for (let k = 0; k < BANDS; k++) out.push(Math.sqrt(Math.max(0, sq[k] / frames - (sums[k] / frames) ** 2)));
  // Centrado: quita el nivel global (volumen del micrófono) antes de comparar.
  const mean = out.slice(0, BANDS).reduce((a, b) => a + b, 0) / BANDS;
  return out.map((v, i) => (i < BANDS ? v - mean : v));
}
