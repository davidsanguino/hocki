// Escucha por voz (opcional, apagada por defecto): convierte lo que se oye en
// texto y se lo pasa a Hocki. Usa el reconocimiento de voz del navegador/webview
// cuando existe.
//
// Privacidad: en Chrome/Edge/WebView2 ese reconocimiento envía el audio a un
// servicio en línea del fabricante. Por eso solo se activa cuando la persona lo
// pide con el botón del micrófono, y se apaga con "Hocki fuera". Más adelante se
// puede cambiar por un motor 100 % local sin tocar nada más.

export interface RecognitionResultLike { isFinal: boolean; 0: { transcript: string } }
export interface RecognitionEventLike { resultIndex: number; results: ArrayLike<RecognitionResultLike> }

export interface RecognizerLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
}

export type RecognizerFactory = () => RecognizerLike | null;

export function browserRecognizerFactory(): RecognizerFactory {
  return () => {
    const w = globalThis as unknown as Record<string, unknown>;
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => RecognizerLike) | undefined;
    return Ctor ? new Ctor() : null;
  };
}

export interface VoiceServiceOptions {
  factory: RecognizerFactory;
  /** Cada frase final reconocida. */
  onHeard: (text: string) => void;
  /** Cambios de estado: encendida/apagada y, si falló, el motivo. */
  onState?: (on: boolean, error?: string) => void;
  lang?: string;
  /** Pausa antes de reintentar cuando el motor se corta solo (ms). */
  restartDelayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

const FATAL = new Set(["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported"]);

/** Qué le decimos a la persona cuando la voz no arranca. */
export function voiceErrorText(reason: string): string {
  switch (reason) {
    case "unsupported":
      return "En este equipo el reconocimiento de voz no está disponible dentro de la app. Puedes escribirme en el chat: entiendo exactamente lo mismo.";
    case "not-allowed":
    case "service-not-allowed":
      return "No tengo permiso para usar el micrófono. Actívalo en Windows: Configuración → Privacidad → Micrófono, y permite las aplicaciones de escritorio.";
    case "audio-capture":
      return "No encuentro un micrófono. Revisa que esté conectado y elegido en Windows.";
    case "network":
      return "El servicio de reconocimiento de voz no responde (necesita internet). Mientras tanto escríbeme en el chat.";
    case "language-not-supported":
      return "Mi reconocimiento de voz no tiene español en este equipo. Escríbeme en el chat.";
    default:
      return "No pude activar la voz. Escríbeme en el chat mientras lo reviso.";
  }
}

export class VoiceService {
  private o: VoiceServiceOptions;
  private rec: RecognizerLike | null = null;
  private wanted = false;

  constructor(o: VoiceServiceOptions) { this.o = o; }

  get supported(): boolean { return this.o.factory() !== null; }
  get on(): boolean { return this.wanted; }

  start(): boolean {
    if (this.wanted) return true;
    const rec = this.o.factory();
    if (!rec) { this.o.onState?.(false, "unsupported"); return false; }
    rec.lang = this.o.lang ?? "es-CO";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const text = r[0].transcript.trim();
          if (text) this.o.onHeard(text);
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error && FATAL.has(e.error)) this.fail(e.error);
    };
    rec.onend = () => {
      // El motor se corta solo cada cierto tiempo: se vuelve a encender mientras la persona quiera.
      if (!this.wanted) return;
      const again = () => { if (this.wanted && this.rec === rec) { try { rec.start(); } catch { /* ya está activo */ } } };
      (this.o.setTimer ?? ((fn, ms) => setTimeout(fn, ms)))(again, this.o.restartDelayMs ?? 300);
    };
    this.rec = rec;
    this.wanted = true;
    try { rec.start(); } catch { this.fail("start-failed"); return false; }
    this.o.onState?.(true);
    return true;
  }

  stop() {
    const rec = this.rec;
    this.wanted = false;
    this.rec = null;
    try { rec?.stop(); } catch { /* ya parado */ }
    this.o.onState?.(false);
  }

  private fail(reason: string) {
    this.wanted = false;
    this.rec = null;
    this.o.onState?.(false, reason);
  }
}
