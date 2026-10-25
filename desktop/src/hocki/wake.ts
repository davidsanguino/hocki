// «¡Hey Hocki!»: la palabra para despertar a Hocki. Después de oírla, Hocki escucha la orden
// (en la misma frase o en la siguiente, durante unos segundos) y responde.

import { isName, normalize } from "./voice-commands";

/** Cómo suena el saludo según el motor de voz: "hey", "ey", "oye", "hola", "ok"… */
const GREETINGS = new Set(["hey", "ey", "hei", "ei", "eh", "oye", "oiga", "hola", "ok", "okay", "okey", "jey", "hi", "ay", "a", "e"]);
/** Variantes del nombre que solo valen detrás del saludo (sueltas serían palabras normales). */
const AFTER_GREETING = new Set(["rocky", "roki", "hoque", "joke", "jockey", "hockey", "okey", "oqui", "hokey", "jaki", "hacky", "hockie"]);

export interface WakeResult {
  /** Se dijo «Hey Hocki» (o una variante). */
  woke: boolean;
  /** Lo que se dijo después, ya sin el saludo ("abre Illustrator"). */
  rest: string;
}

/** ¿Empieza la frase con «Hey Hocki»? Busca en las primeras palabras (el motor a veces añade algo antes). */
export function detectWake(text: string): WakeResult {
  const words = normalize(text).split(" ").filter(Boolean);
  for (let i = 0; i < Math.min(words.length, 4); i++) {
    const w = words[i];
    const greeted = i > 0 && GREETINGS.has(words[i - 1]);
    // "heyhocki" / "eyhocki" pegados
    const glued = /^(hey|ey|oye)(.+)$/.exec(w);
    if (glued && (isName(glued[2]) || AFTER_GREETING.has(glued[2]))) return { woke: true, rest: words.slice(i + 1).join(" ") };
    if (greeted && (isName(w) || AFTER_GREETING.has(w))) return { woke: true, rest: words.slice(i + 1).join(" ") };
  }
  // «Hocki, …» al principio también despierta (sin el "hey").
  if (words.length && isName(words[0])) return { woke: true, rest: words.slice(1).join(" ") };
  return { woke: false, rest: words.join(" ") };
}

/** Lo que Hocki dice al despertar sin orden: corto, variado y amable. */
const ACKS = ["¿Sí, jefe?", "Dime.", "Te escucho.", "¿Qué hacemos?", "Aquí estoy."];
export function wakeAck(n: number): string {
  return ACKS[Math.abs(n) % ACKS.length];
}

/** Ventana de conversación: después de «Hey Hocki» o de una respuesta, se puede hablar sin repetir el nombre. */
export class WakeWindow {
  private until = 0;
  private now: () => number;
  constructor(now: () => number = () => Date.now()) { this.now = now; }
  open(ms = 8000) { this.until = this.now() + ms; }
  close() { this.until = 0; }
  get isOpen() { return this.now() < this.until; }
}
