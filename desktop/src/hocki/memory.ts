// La memoria de Hocki: lo que recuerda de las conversaciones y de la persona.
//
// Reglas de privacidad (no negociables):
//  • Solo funciona si la persona la activa, y puede apagarse cuando quiera.
//  • Todo queda en este dispositivo.
//  • Nunca guarda claves ni números de tarjeta: se tapan antes de guardar, y si alguien
//    pide recordar uno, Hocki se niega.
//  • "Olvida X" y "olvida todo" borran de verdad; el historial vence solo (90 días).
//  • Los datos de otras personas se guardan solo si la persona los dice expresamente.

import { normalize } from "./voice-commands";

export interface Fact { id: string; text: string; createdAt: number }
export interface Turn { at: number; role: "user" | "assistant"; text: string }
export interface Conversation { id: string; startedAt: number; turns: Turn[]; summary?: string }

export interface MemoryData {
  enabled: boolean;
  facts: Fact[];
  conversations: Conversation[];
}

export const MEMORY_LIMITS = { turns: 400, conversations: 50, facts: 300, days: 90, turnChars: 4000 } as const;
const DAY = 24 * 60 * 60 * 1000;

// ── Datos que nunca se guardan ────────────────────────────────────────────────

const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const SECRET_WORD = /\b(contrase(?:ñ|n)a|clave|password|pin|cvv|token|api[ _-]?key)\b\s*(?:es|:|=|de)?\s*\S+/gi;
const API_KEY = /\b(?:sk|pk|ghp|gho|xox[bap])[-_][A-Za-z0-9_-]{16,}\b/g;

/** Tapa tarjetas, claves y llaves antes de guardar cualquier texto. */
export function redact(text: string): string {
  return text.replace(CARD, "[número oculto]").replace(API_KEY, "[llave oculta]").replace(SECRET_WORD, (m) => m.split(/\s+/)[0] + " [oculto]");
}

export function isSensitive(text: string): boolean {
  return redact(text) !== text;
}

// ── Búsqueda sin conexión ─────────────────────────────────────────────────────

const STOP = new Set(("a al algo con como cual de del el ella en es esta este eso la las le lo los me mi mis muy no o para pero por que se si sin sobre su sus te tu tus un una unos unas y yo ya soy son fue hay he ha").split(" "));

function words(s: string): string[] {
  return normalize(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w));
}

/** Puntaje de coincidencia simple (palabras compartidas, con raíz común de 4 letras). */
export function score(query: string, text: string): number {
  const q = words(query);
  const t = words(text);
  if (!q.length || !t.length) return 0;
  let hit = 0;
  for (const w of q) {
    if (t.some((x) => x === w || (w.length >= 4 && x.length >= 4 && x.slice(0, 4) === w.slice(0, 4)))) hit++;
  }
  return hit / q.length;
}

let counter = 0;
const newId = (p: string, at: number) => `${p}${at.toString(36)}${(counter++).toString(36)}`;

export class MemoryStore {
  data: MemoryData;
  private now: () => number;

  constructor(now: () => number = () => Date.now(), data?: Partial<MemoryData>) {
    this.now = now;
    this.data = { enabled: false, facts: [], conversations: [], ...data };
    this.purge();
  }

  get enabled() { return this.data.enabled; }
  setEnabled(on: boolean) { this.data.enabled = on; }

  // ── Hechos: lo que la persona pide recordar ────────────────────────────────

  /** Guarda un dato. Devuelve el hecho, o un motivo si no se puede. */
  remember(text: string): { ok: true; fact: Fact } | { ok: false; reason: "off" | "sensitive" | "empty" | "full" } {
    if (!this.data.enabled) return { ok: false, reason: "off" };
    const t = text.trim().replace(/\s+/g, " ");
    if (!t) return { ok: false, reason: "empty" };
    if (isSensitive(t)) return { ok: false, reason: "sensitive" };
    if (this.data.facts.length >= MEMORY_LIMITS.facts) return { ok: false, reason: "full" };
    const dup = this.data.facts.find((f) => normalize(f.text) === normalize(t));
    if (dup) return { ok: true, fact: dup };
    const fact = { id: newId("f", this.now()), text: t, createdAt: this.now() };
    this.data.facts.push(fact);
    return { ok: true, fact };
  }

  facts(): Fact[] { return [...this.data.facts]; }

  /** Olvida los hechos que coinciden con la consulta. Devuelve cuántos. */
  forget(query: string): number {
    const before = this.data.facts.length;
    this.data.facts = this.data.facts.filter((f) => score(query, f.text) < 0.6 && !normalize(f.text).includes(normalize(query)));
    return before - this.data.facts.length;
  }

  forgetAll() { this.data.facts = []; this.data.conversations = []; }

  // ── Conversaciones ─────────────────────────────────────────────────────────

  startConversation(): string {
    this.closeCurrent();
    const c: Conversation = { id: newId("c", this.now()), startedAt: this.now(), turns: [] };
    this.data.conversations.push(c);
    if (this.data.conversations.length > MEMORY_LIMITS.conversations) this.data.conversations.shift();
    return c.id;
  }

  private current(): Conversation | undefined { return this.data.conversations.at(-1); }

  record(role: Turn["role"], text: string) {
    if (!this.data.enabled) return;
    let c = this.current();
    if (!c) { this.startConversation(); c = this.current()!; }
    c.turns.push({ at: this.now(), role, text: redact(text).slice(0, MEMORY_LIMITS.turnChars) });
    if (c.turns.length > MEMORY_LIMITS.turns) c.turns.splice(0, c.turns.length - MEMORY_LIMITS.turns);
  }

  /** Resumen corto (extractivo, sin IA) de la conversación actual, al cerrarla. */
  private closeCurrent() {
    const c = this.current();
    if (!c || c.summary || c.turns.length === 0) return;
    const asks = c.turns.filter((t) => t.role === "user").map((t) => t.text);
    c.summary = asks.slice(0, 3).map((a) => a.slice(0, 80)).join(" · ");
  }

  /** Busca en hechos y en conversaciones; lo más relacionado y reciente primero. */
  search(query: string, limit = 5): Array<{ kind: "fact" | "turn"; text: string; at: number; score: number }> {
    const out: Array<{ kind: "fact" | "turn"; text: string; at: number; score: number }> = [];
    for (const f of this.data.facts) {
      const s = score(query, f.text);
      if (s > 0) out.push({ kind: "fact", text: f.text, at: f.createdAt, score: s + 0.25 });
    }
    for (const c of this.data.conversations) {
      for (const t of c.turns) {
        const s = score(query, t.text);
        if (s >= 0.34) out.push({ kind: "turn", text: t.text, at: t.at, score: s });
      }
    }
    return out.sort((a, b) => b.score - a.score || b.at - a.at).slice(0, limit);
  }

  /** Los hechos más útiles para una pregunta (para dárselos al asistente de IA). */
  relevantFacts(query: string, limit = 4): string[] {
    return this.data.facts
      .map((f) => ({ f, s: score(query, f.text) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((x) => x.f.text);
  }

  conversations(): Conversation[] { return this.data.conversations; }

  /** Todo lo guardado, en texto legible (para que la persona lo descargue). */
  exportText(): string {
    const lines = ["# Memoria de Hocki", "", "## Datos que me pediste recordar", ...this.data.facts.map((f) => `- ${f.text}`), "", "## Conversaciones"];
    for (const c of this.data.conversations) {
      lines.push("", `### ${new Date(c.startedAt).toISOString().slice(0, 16).replace("T", " ")}${c.summary ? ` — ${c.summary}` : ""}`);
      for (const t of c.turns) lines.push(`${t.role === "user" ? "Tú" : "Hocki"}: ${t.text}`);
    }
    return lines.join("\n");
  }

  /** Borra lo que ya venció. */
  purge() {
    const cutoff = this.now() - MEMORY_LIMITS.days * DAY;
    this.data.conversations = this.data.conversations.filter((c) => (c.turns.at(-1)?.at ?? c.startedAt) >= cutoff);
  }
}
