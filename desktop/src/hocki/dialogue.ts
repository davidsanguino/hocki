// La voz de Hocki: qué dice, cómo lo dice según la profesión, y cuándo se calla.
// Todo funciona sin conexión. Las plataformas aportan solo el altavoz
// (síntesis de voz del sistema) y el micrófono; las frases y reglas son comunes.

import { parseVoice, normalize } from "./voice-commands";
import { professionById, type Profession } from "./professions";

type Tone = NonNullable<Profession["tone"]>;
export type DialogueEvent =
  | "taskDone" | "agentDone" | "approvalNeeded" | "error" | "breakReminder"
  | "idleLong" | "stopped" | "goodbye" | "unlocked" | "denied";

const PHRASES: Record<DialogueEvent, Record<Tone, string[]>> = {
  taskDone: {
    formal: ["Tarea completada.", "Listo, queda registrado."],
    cercano: ["¡Listo, parce! Una menos.", "Hecho. ¡Qué bien!"],
    motivador: ["¡Tarea cumplida! ¡Vamos por la siguiente!", "¡Eso! Otra más al bolsillo."],
  },
  agentDone: {
    formal: ["Tu agente terminó. Cuando puedas, revisa el resultado."],
    cercano: ["Tu agente ya terminó. ¿Le echamos un vistazo?"],
    motivador: ["¡Tu agente acabó! A revisar lo que hizo."],
  },
  approvalNeeded: {
    formal: ["Necesito tu autorización para continuar."],
    cercano: ["Oye, necesito que me des el visto bueno."],
    motivador: ["¡Casi listo! Solo falta tu aprobación."],
  },
  error: {
    formal: ["Hubo un problema. Revisa los detalles cuando puedas."],
    cercano: ["Uy, algo falló. Tranquilo, lo miramos."],
    motivador: ["Se atravesó un error, pero lo resolvemos. ¡Ánimo!"],
  },
  breakReminder: {
    formal: ["Llevas un buen rato trabajando. Una pausa te vendría bien."],
    cercano: ["Llevas rato sin parar. ¿Un traguito de agua y estiramos?"],
    motivador: ["¡Gran trabajo! Pausa de dos minutos y volvemos con más energía."],
  },
  idleLong: {
    formal: ["Sigo aquí si me necesitas."],
    cercano: ["Estoy por aquí, tranquilo."],
    motivador: ["Cuando quieras retomamos, ¡aquí estoy!"],
  },
  stopped: {
    formal: ["Detenido. No haré nada más hasta que me lo indiques."],
    cercano: ["Listo, me quedo quietecito."],
    motivador: ["¡Entendido! Me detengo."],
  },
  goodbye: {
    formal: ["Hasta luego. Que tengas buen día."],
    cercano: ["¡Chao! Nos vemos pronto."],
    motivador: ["¡Hasta pronto! Gran día."],
  },
  unlocked: {
    formal: ["Identidad verificada."],
    cercano: ["Eres tú, ¡qué bien!"],
    motivador: ["¡Listo! Verificado, adelante."],
  },
  denied: {
    formal: ["No tengo permiso para hacer eso."],
    cercano: ["Eso no me lo has permitido, así que no lo hago."],
    motivador: ["Para eso necesito tu permiso primero."],
  },
};

const pick = <T>(xs: T[], rand: () => number): T => xs[Math.min(xs.length - 1, Math.floor(rand() * xs.length))];

export function partOfDay(d: Date): "mañana" | "tarde" | "noche" {
  const h = d.getHours();
  return h < 12 ? "mañana" : h < 19 ? "tarde" : "noche";
}

export function greeting(p: Profession, now: Date = new Date(), name?: string): string {
  const base = { mañana: "Buenos días", tarde: "Buenas tardes", noche: "Buenas noches" }[partOfDay(now)];
  const who = name ? `, ${name}` : "";
  return p.hello ? `${base}${who}. ${p.hello}` : `${base}${who}.`;
}

export function phraseFor(event: DialogueEvent, p: Profession, rand: () => number = Math.random): string {
  return pick(PHRASES[event][p.tone ?? "cercano"], rand);
}

export function tipFor(p: Profession, rand: () => number = Math.random): string | null {
  return p.tips && p.tips.length ? pick(p.tips, rand) : null;
}

// ── Conversación sin conexión ─────────────────────────────────────────────────

export type ReplyAction = "stop" | "summary" | "sleep" | "hide" | "show" | "open" | "close" | "walk" | "still" | "home" | "ask_ai" | null;
/** Lo que Hocki responde a "¿Dónde estás, Hocki?". */
export const WHERE_REPLY = "Acá estoy, jefe";

export interface Reply { text: string; action: ReplyAction }

const has = (t: string, ...ps: string[]) => ps.some((p) => t.includes(p));

/**
 * Respuesta de Hocki a lo que la persona dice o escribe. Lo básico lo resuelve él
 * mismo; lo que no entiende lo marca como `ask_ai` para que, si la persona lo
 * permitió, se lo pase a su proveedor de IA elegido.
 */
export function reply(input: string, professionId: string, now: Date = new Date(), rand: () => number = Math.random): Reply {
  const p = professionById(professionId);
  const cmd = parseVoice(input);
  switch (cmd.intent) {
    case "stop": return { text: phraseFor("stopped", p, rand), action: "stop" };
    case "summary": return { text: "Preparo tu resumen del día.", action: "summary" };
    case "sleep": return { text: "Me voy a reposo. Llámame cuando quieras.", action: "sleep" };
    case "hide": return { text: "Me aparto para no estorbar.", action: "hide" };
    case "show": return { text: "¡Aquí estoy!", action: "show" };
    case "where": return { text: WHERE_REPLY, action: "show" };
    case "open": return { text: "¡Abriendo! Acá estoy.", action: "open" };
    case "close": return { text: "Cerrando. Dime «abre Hocki» cuando me necesites.", action: "close" };
    case "walk": return { text: "¡Voy a pasear! Prometo no estorbar.", action: "walk" };
    case "still": return { text: "Me quedo quietecito aquí.", action: "still" };
    case "home": return { text: "Vuelvo a la isla.", action: "home" };
    default: break;
  }
  const t = normalize(input);
  if (has(t, "hola", "buenos dias", "buenas tardes", "buenas noches", "que mas", "quiubo")) {
    return { text: greeting(p, now), action: null };
  }
  if (has(t, "quien eres", "que eres", "como te llamas")) {
    return { text: "Soy Hocki, tu compañero. Me quedo a tu lado, te ayudo con lo que me permitas y nunca hago nada sensible sin tu autorización.", action: null };
  }
  if (has(t, "que puedes hacer", "que haces", "ayuda", "como me ayudas")) {
    const acts = p.quickActions.slice(0, 3).join(", ");
    return { text: `Como ${p.name.toLowerCase()}, puedo ayudarte con: ${acts}. Dime "Hocki, resumen del día" o "Hocki fuera" cuando quieras.`, action: null };
  }
  if (has(t, "consejo", "dame un tip", "recomienda")) {
    const tip = tipFor(p, rand);
    return { text: tip ?? "Hoy el mejor consejo: haz primero lo más importante.", action: null };
  }
  if (has(t, "gracias")) return { text: "¡Con mucho gusto!", action: null };
  if (has(t, "que hora es", "la hora")) {
    const hh = now.getHours() % 12 || 12, mm = String(now.getMinutes()).padStart(2, "0");
    return { text: `Son las ${hh}:${mm}.`, action: null };
  }
  if (has(t, "adios", "chao", "hasta luego")) return { text: phraseFor("goodbye", p, rand), action: null };
  return { text: "Eso lo puedo consultar con tu asistente de IA si me lo permites.", action: "ask_ai" };
}

/** Lo que Hocki dice en voz alta de una respuesta larga: sin formato y solo lo esencial. */
export function speakable(text: string, max = 280): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " (te dejé el código en el chat) ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_#>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (end > 60 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…") + " El resto está en el chat.";
}

// ── Altavoz ───────────────────────────────────────────────────────────────────

/** Lo que la plataforma ofrece para hablar (en el navegador: speechSynthesis). */
export interface SpeechBackend {
  speak(text: string, opts: { lang: string; rate: number; volume: number }): void;
  cancel(): void;
}

export interface SpeakerSettings {
  enabled: boolean;
  volume: number; // 0..1
  rate: number;   // 0.5..1.5
  /** No habla mientras la persona escribe o hace clic. */
  quietWhenBusy: boolean;
}

export const DEFAULT_SPEAKER: SpeakerSettings = { enabled: true, volume: 0.9, rate: 1.04, quietWhenBusy: true };

export class Speaker {
  settings: SpeakerSettings;
  private backend: SpeechBackend;
  private stopped = false;

  constructor(backend: SpeechBackend, settings: SpeakerSettings = { ...DEFAULT_SPEAKER }) {
    this.backend = backend;
    this.settings = settings;
  }

  /** "Hocki fuera": se calla ya y no vuelve a hablar hasta que la persona lo reactive. */
  halt() { this.stopped = true; this.backend.cancel(); }
  resume() { this.stopped = false; }

  say(text: string, ctx: { busy: boolean }): boolean {
    const s = this.settings;
    if (!s.enabled || this.stopped || !text) return false;
    if (s.quietWhenBusy && ctx.busy) return false;
    this.backend.speak(text, { lang: "es-CO", rate: s.rate, volume: s.volume });
    return true;
  }
}

/** Voz elegida a mano (índice en la lista ordenada); -1 = automática. */
export const voicePrefs = { index: -1 };

type VoiceLike = { lang: string; name: string };
const isEs = (v: VoiceLike) => v.lang.toLowerCase().replace("_", "-").startsWith("es");
const MALE = /gonzalo|jorge|alvaro|pablo|diego|carlos|andres|tomas|alex|raul|male|hombre/i;

/** Voces en español, de más a menos natural: latinas, "Natural/Online" y de chico joven primero. */
export function rankVoices<T extends VoiceLike>(voices: T[]): T[] {
  const score = (v: T) => {
    const l = v.lang.toLowerCase().replace("_", "-");
    let n = 0;
    if (/es-(co|mx|us|419|ar|cl|pe|ve)/.test(l)) n += 4; else if (l.startsWith("es-es")) n += 1;
    if (/natural|online/i.test(v.name)) n += 5;
    if (MALE.test(v.name)) n += 2;
    return n;
  };
  return voices.filter(isEs).sort((a, b) => score(b) - score(a));
}

export function pickVoice<T extends VoiceLike>(voices: T[]): T | null {
  const r = rankVoices(voices);
  if (!r.length) return null;
  return voicePrefs.index >= 0 ? r[voicePrefs.index % r.length] : r[0];
}

/** Tono juvenil: más agudo en voz de chico, un poco menos en la de chica. */
export function pitchFor(v: VoiceLike | null): number {
  return v && MALE.test(v.name) ? 1.14 : 1.08;
}

/** Nombres de las voces en español instaladas (para "cambia de voz"). */
export function spanishVoiceNames(): string[] {
  const w = globalThis as unknown as { speechSynthesis?: SpeechSynthesis };
  return w.speechSynthesis ? rankVoices(w.speechSynthesis.getVoices()).map((v) => v.name) : [];
}

/** Altavoz real del navegador/webview; devuelve null si no hay síntesis de voz. */
export function browserBackend(): SpeechBackend | null {
  const w = globalThis as unknown as { speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance };
  if (!w.speechSynthesis || !w.SpeechSynthesisUtterance) return null;
  const synth = w.speechSynthesis, Utter = w.SpeechSynthesisUtterance;
  return {
    speak(text, o) {
      const u = new Utter(text);
      u.lang = o.lang; u.rate = o.rate; u.volume = o.volume;
      const voice = pickVoice(synth.getVoices());
      u.pitch = pitchFor(voice); // tono juvenil, sin llegar a caricatura
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      synth.cancel();
      synth.speak(u);
    },
    cancel() { synth.cancel(); },
  };
}

/**
 * Voz propia de Windows primero (sin internet, con voces latinas); si no responde, la del navegador.
 * `io` lo pone la plataforma para no atar este archivo a Tauri.
 */
export function nativeBackend(
  io: { speak(text: string, voice: number): Promise<boolean | null>; stop(): void },
  fallback: SpeechBackend | null,
): SpeechBackend {
  return {
    speak(text, o) {
      void io.speak(text, voicePrefs.index).then((ok) => {
        if (ok !== true) fallback?.speak(text, o);
      });
    },
    cancel() { io.stop(); fallback?.cancel(); },
  };
}

/** Cómo suena Hocki con su voz natural: tono (velocidad de reproducción) y ritmo al sintetizar. */
export const hockiVoice = { pitch: 1.08, speed: 1.05, natural: true };

/**
 * La voz natural de Hocki (Piper, en el equipo) con su "toque": se reproduce un poco más aguda
 * y viva que la voz original, así suena única. Si aún no está descargada, habla la de reserva.
 */
export function naturalBackend(
  io: { speak(text: string, speed: number): Promise<string | null> },
  fallback: SpeechBackend,
  onPlay?: (ms: number) => void,
): SpeechBackend {
  let ctx: AudioContext | null = null;
  let current: AudioBufferSourceNode | null = null;
  let token = 0;
  const stop = () => { try { current?.stop(); } catch { /* ya terminó */ } current = null; };
  return {
    speak(text, o) {
      const my = ++token;
      stop();
      if (!hockiVoice.natural) { fallback.speak(text, o); return; }
      void io.speak(text, hockiVoice.speed).then(async (b64) => {
        if (my !== token) return;
        if (!b64) { fallback.speak(text, o); return; }
        try {
          const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
          if (!AC) { fallback.speak(text, o); return; }
          ctx ??= new AC();
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const buf = await ctx.decodeAudioData(bytes.buffer);
          if (my !== token) return;
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.playbackRate.value = hockiVoice.pitch;
          const gain = ctx.createGain();
          gain.gain.value = Math.max(0, Math.min(1, o.volume));
          src.connect(gain); gain.connect(ctx.destination);
          current = src;
          src.start();
          onPlay?.((buf.duration / hockiVoice.pitch) * 1000);
        } catch {
          fallback.speak(text, o);
        }
      }, () => { if (my === token) fallback.speak(text, o); });
    },
    cancel() { token++; stop(); fallback.cancel(); },
  };
}
