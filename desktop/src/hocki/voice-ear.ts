// El oído de Hocki: escucha el micrófono (con tu permiso), detecta cuándo hablas, corta cada
// frase y la manda a transcribir en el equipo (Whisper, ver src-tauri/src/stt.rs). Nada se
// graba ni se envía a internet.

import type { RecognizerFactory, RecognizerLike } from "./voice-service";

export const TARGET_RATE = 16000;

export interface VadConfig {
  frameMs: number;
  /** Energía mínima (RMS) para contar como voz, aunque el ambiente esté muy callado. */
  minLevel: number;
  /** Cuántas veces sobre el ruido de fondo debe estar la voz. */
  overNoise: number;
  /** ms de voz seguida para empezar una frase. */
  startMs: number;
  /** ms de silencio para cerrarla. */
  endMs: number;
  /** ms que se guardan antes de que empiece (para no comerse la primera sílaba). */
  preMs: number;
  /** Lo más larga que puede ser una frase. */
  maxMs: number;
  /** Más corta que esto no es una frase (un golpe, un clic). */
  minMs: number;
}

export const DEFAULT_VAD: VadConfig = { frameMs: 20, minLevel: 0.006, overNoise: 3, startMs: 60, endMs: 650, preMs: 260, maxMs: 12000, minMs: 300 };

/** Corta el audio en frases según la energía, adaptándose al ruido de fondo. */
export class VadSegmenter {
  private cfg: VadConfig;
  private frameLen: number;
  private pending: number[] = [];
  private noise = 0.002;
  private pre: Float32Array[] = [];
  private speech: Float32Array[] = [];
  private inSpeech = false;
  private loudRun = 0;
  private quietRun = 0;
  private speechFrames = 0;

  constructor(sampleRate: number, cfg: VadConfig = DEFAULT_VAD) {
    this.cfg = cfg;
    this.frameLen = Math.max(1, Math.round((sampleRate * cfg.frameMs) / 1000));
  }

  get level() { return this.noise; }

  /** Añade audio; devuelve las frases que terminaron con él. */
  feed(chunk: Float32Array): Float32Array[] {
    const out: Float32Array[] = [];
    for (let i = 0; i < chunk.length; i++) this.pending.push(chunk[i]);
    while (this.pending.length >= this.frameLen) {
      const frame = Float32Array.from(this.pending.splice(0, this.frameLen));
      const seg = this.frame(frame);
      if (seg) out.push(seg);
    }
    return out;
  }

  private frame(f: Float32Array): Float32Array | null {
    let e = 0;
    for (let i = 0; i < f.length; i++) e += f[i] * f[i];
    const rms = Math.sqrt(e / f.length);
    const threshold = Math.max(this.cfg.minLevel, this.noise * this.cfg.overNoise);
    const loud = rms > threshold;
    const frames = (ms: number) => Math.ceil(ms / this.cfg.frameMs);

    if (!this.inSpeech) {
      // El ruido de fondo se aprende solo cuando no hay voz.
      if (!loud) this.noise = this.noise * 0.97 + rms * 0.03;
      this.pre.push(f);
      if (this.pre.length > frames(this.cfg.preMs)) this.pre.shift();
      this.loudRun = loud ? this.loudRun + 1 : 0;
      if (this.loudRun >= frames(this.cfg.startMs)) {
        this.inSpeech = true;
        this.speech = [...this.pre];
        this.pre = [];
        this.quietRun = 0;
        this.speechFrames = this.loudRun;
      }
      return null;
    }
    this.speech.push(f);
    if (loud) { this.quietRun = 0; this.speechFrames++; } else this.quietRun++;
    const tooLong = this.speech.length >= frames(this.cfg.maxMs);
    if (this.quietRun >= frames(this.cfg.endMs) || tooLong) {
      const voiced = this.speechFrames * this.cfg.frameMs;
      const parts = this.speech;
      this.inSpeech = false;
      this.speech = [];
      this.loudRun = 0;
      this.speechFrames = 0;
      if (voiced < this.cfg.minMs) return null;
      const total = parts.reduce((n, p) => n + p.length, 0);
      const audio = new Float32Array(total);
      let o = 0;
      for (const p of parts) { audio.set(p, o); o += p.length; }
      return audio;
    }
    return null;
  }
}

/** Cambia la frecuencia de muestreo (interpolación lineal; suficiente para voz). */
export function resample(input: Float32Array, from: number, to = TARGET_RATE): Float32Array {
  if (from === to) return input;
  const n = Math.floor((input.length * to) / from);
  const out = new Float32Array(n);
  const ratio = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const a = Math.floor(x);
    const b = Math.min(input.length - 1, a + 1);
    const t = x - a;
    out[i] = input[a] * (1 - t) + input[b] * t;
  }
  return out;
}

/** Float32 [-1, 1] → PCM 16 bits little-endian en base64 (lo que espera Rust). */
export function toPcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    const s = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
    bytes[2 * i] = s & 0xff;
    bytes[2 * i + 1] = (s >> 8) & 0xff;
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export interface EarIO {
  /** Pide el micrófono (la primera vez el sistema pregunta); null si salió bien, o el motivo. */
  startMic(): Promise<"denied" | "no-mic" | "unsupported" | "other" | null>;
  /** Escucha el audio que llega; devuelve cómo dejar de escuchar. */
  listen(onChunk: (chunk: Float32Array) => void): () => void;
  sampleRate(): number;
  transcribe(pcm16b64: string): Promise<string>;
  /** Mientras Hocki habla, lo que se oye es su propia voz. */
  muted(): boolean;
}

/** Pista para el motor: así escribe bien el nombre. */
export const EAR_PROMPT = "Hey Hocki. Hocki, abre Illustrator. Hocki, guarda el archivo.";

export function earRecognizerFactory(io: EarIO): RecognizerFactory {
  return () => {
    let unlisten: (() => void) | null = null;
    let active = false;
    let busy = false;
    const queue: Float32Array[] = [];
    const rec: RecognizerLike = {
      lang: "es-CO", continuous: true, interimResults: false,
      onresult: null, onend: null, onerror: null,
      start() {
        active = true;
        void (async () => {
          const err = await io.startMic();
          if (!active) return;
          if (err) {
            active = false;
            rec.onerror?.({ error: err === "denied" ? "not-allowed" : err === "no-mic" ? "audio-capture" : "unsupported" });
            return;
          }
          const vad = new VadSegmenter(io.sampleRate());
          const pump = async () => {
            if (busy) return;
            busy = true;
            try {
              while (active && queue.length) {
                const seg = queue.shift()!;
                const text = (await io.transcribe(toPcm16Base64(resample(seg, io.sampleRate())))).trim();
                if (text && active) rec.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
              }
            } catch (e) {
              if (String(e).includes("no-model")) { active = false; rec.onerror?.({ error: "no-model" }); }
            } finally { busy = false; }
          };
          unlisten = io.listen((chunk) => {
            if (!active) return;
            for (const seg of vad.feed(chunk)) {
              if (io.muted()) continue; // su propia voz
              if (queue.length < 3) queue.push(seg);
            }
            void pump();
          });
        })();
      },
      stop() {
        active = false;
        queue.length = 0;
        unlisten?.();
        unlisten = null;
      },
    };
    return rec;
  };
}
