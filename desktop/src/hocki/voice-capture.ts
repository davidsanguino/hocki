// El micrófono para reconocer tu voz: pide el permiso al sistema y guarda los últimos segundos
// en memoria (nunca a disco ni a internet). Solo se usa para calcular la huella de voz.

export type MicError = "denied" | "no-mic" | "unsupported" | "other";

export function micErrorText(e: MicError): string {
  switch (e) {
    case "denied":
      return "No tengo permiso para usar el micrófono. En Windows: Configuración → Privacidad y seguridad → Micrófono, y activa «Permitir que las aplicaciones de escritorio accedan». Luego dime «registra mi voz».";
    case "no-mic":
      return "No encuentro ningún micrófono. Conecta uno y vuelve a intentarlo.";
    case "unsupported":
      return "Este equipo no deja capturar el micrófono desde aquí.";
    default:
      return "No pude abrir el micrófono.";
  }
}

const KEEP_SECONDS = 8;

export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private ring = new Float32Array(0);
  private filled = 0;
  sampleRate = 16000;

  get running() { return this.ctx !== null; }

  /** Pide el micrófono al sistema; null si salió bien, o el motivo. */
  async start(): Promise<MicError | null> {
    if (this.ctx) return null;
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!md?.getUserMedia || !AC) return "unsupported";
    try {
      this.stream = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch (e) {
      const name = (e as { name?: string })?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") return "denied";
      if (name === "NotFoundError" || name === "OverconstrainedError") return "no-mic";
      return "other";
    }
    try {
      this.ctx = new AC();
      this.sampleRate = this.ctx.sampleRate;
      this.ring = new Float32Array(Math.floor(this.sampleRate * KEEP_SECONDS));
      this.filled = 0;
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.node = this.ctx.createScriptProcessor(2048, 1, 1);
      this.node.onaudioprocess = (ev) => this.push(ev.inputBuffer.getChannelData(0));
      const mute = this.ctx.createGain(); // el micrófono nunca suena por los altavoces
      mute.gain.value = 0;
      src.connect(this.node); this.node.connect(mute); mute.connect(this.ctx.destination);
      return null;
    } catch {
      this.stop();
      return "other";
    }
  }

  private push(chunk: Float32Array) {
    const n = chunk.length;
    if (n >= this.ring.length) { this.ring.set(chunk.subarray(n - this.ring.length)); this.filled = this.ring.length; return; }
    this.ring.copyWithin(0, n);
    this.ring.set(chunk, this.ring.length - n);
    this.filled = Math.min(this.ring.length, this.filled + n);
  }

  /** Lo último que se oyó, hasta `seconds` segundos. */
  recent(seconds: number): Float32Array {
    const n = Math.min(this.filled, Math.floor(seconds * this.sampleRate));
    return this.ring.slice(this.ring.length - n);
  }

  /** Graba `ms` milisegundos desde ahora. */
  record(ms: number): Promise<Float32Array> {
    return new Promise((resolve) => setTimeout(() => resolve(this.recent(ms / 1000)), ms));
  }

  stop() {
    try { this.node?.disconnect(); } catch { /* ya está */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.ctx = null; this.stream = null; this.node = null; this.filled = 0;
  }
}
