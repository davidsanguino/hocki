// El registro (bitácora) de Hocki: qué hizo, cuándo y por qué, en orden.
// Es solo de lectura para las demás partes: se agrega y se consulta, no se edita.
// Se guarda en el dispositivo, con límite de tamaño y de días, y se puede exportar o borrar.

export type JournalKind = "chat" | "job" | "approval" | "memory" | "voice" | "system";

export interface JournalEntry {
  at: number;
  kind: JournalKind;
  title: string;
  detail?: string;
}

export const JOURNAL_MAX = 1000;
export const JOURNAL_DAYS = 180;

const DAY = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export class Journal {
  private items: JournalEntry[] = [];
  private now: () => number;

  constructor(now: () => number = () => Date.now(), items: JournalEntry[] = []) {
    this.now = now;
    this.items = items;
    this.trim();
  }

  add(kind: JournalKind, title: string, detail?: string) {
    this.items.push({ at: this.now(), kind, title, ...(detail ? { detail } : {}) });
    this.trim();
  }

  private trim() {
    const cutoff = this.now() - JOURNAL_DAYS * DAY;
    this.items = this.items.filter((e) => e.at >= cutoff);
    if (this.items.length > JOURNAL_MAX) this.items.splice(0, this.items.length - JOURNAL_MAX);
  }

  list(opts: { since?: number; until?: number; kind?: JournalKind; limit?: number } = {}): JournalEntry[] {
    let r = this.items.filter((e) =>
      (opts.since == null || e.at >= opts.since) && (opts.until == null || e.at < opts.until) &&
      (opts.kind == null || e.kind === opts.kind));
    if (opts.limit != null) r = r.slice(-opts.limit);
    return r;
  }

  /** Lo de hoy (desde la medianoche local). */
  today(): JournalEntry[] {
    const d = new Date(this.now());
    return this.list({ since: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() });
  }

  toText(entries: readonly JournalEntry[] = this.items): string {
    return entries.map((e) => `${stamp(e.at)}  [${e.kind}] ${e.title}${e.detail ? ` — ${e.detail}` : ""}`).join("\n");
  }

  toCSV(entries: readonly JournalEntry[] = this.items): string {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    return ["fecha,tipo,titulo,detalle", ...entries.map((e) => [stamp(e.at), e.kind, q(e.title), q(e.detail ?? "")].join(","))].join("\n");
  }

  clear() { this.items = []; }
  get size() { return this.items.length; }
  snapshot(): JournalEntry[] { return this.items.map((e) => ({ ...e })); }
}
