// Motor de permisos de Hocki.
//
// Regla de oro: Hocki NUNCA actúa solo sobre nada sensible. Todo lo que cambia
// el mundo (mensajes, pagos, borrados, ajustes) necesita la autorización
// explícita de la persona, y lo que Hocki "lee" en pantalla es información,
// jamás una orden. Este módulo no depende de ninguna plataforma: lo usan igual
// Windows, macOS, Linux, Android e iPhone.

/** Niveles que la persona le concede a Hocki, de menos a más. */
export const LEVELS = ["off", "observe", "suggest", "confirm", "rest"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<Level, string> = {
  off: "Apagado",
  observe: "Observar",
  suggest: "Sugerir",
  confirm: "Actuar con confirmación",
  rest: "Actuar solo en reposo o con la pantalla bloqueada",
};

/** Qué quiere hacer Hocki. */
export const ACTION_KINDS = [
  "read_screen",
  "open_app",
  "send_message",
  "change_settings",
  "delete",
  "payment",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type Risk = "low" | "medium" | "high";

export const ACTION_RISK: Record<ActionKind, Risk> = {
  read_screen: "low",
  open_app: "low",
  send_message: "medium",
  change_settings: "medium",
  delete: "high",
  payment: "high",
};

export const ACTION_LABELS: Record<ActionKind, string> = {
  read_screen: "Leer la pantalla",
  open_app: "Abrir aplicaciones",
  send_message: "Enviar mensajes",
  change_settings: "Cambiar ajustes",
  delete: "Borrar",
  payment: "Hacer pagos",
};

/** De dónde nace la petición. Lo observado en pantalla nunca puede ordenar. */
export type Origin = "user" | "observed";

export interface ActionRequest {
  kind: ActionKind;
  /** Resumen legible, sin datos sensibles (se muestra y se guarda en el registro). */
  summary: string;
  /** Huella del contenido exacto (destinatario, importe…) para atar el permiso a ESA acción. */
  fingerprint: string;
  origin: Origin;
}

export type Decision =
  | { type: "deny"; reason: string }
  | { type: "suggest_only"; reason: string }
  | { type: "ask"; needsBiometric: boolean; reason: string }
  | { type: "run_preapproved"; ticketId: string; reason: string };

/** Contexto del momento: lo aporta cada plataforma. */
export interface Context {
  /** Equipo en reposo o pantalla bloqueada. */
  resting: boolean;
}

export interface AuditEntry {
  at: number;
  kind: ActionKind;
  summary: string;
  decision: Decision["type"] | "approved" | "rejected" | "expired" | "killed";
  note?: string;
}

interface Pending {
  id: string;
  request: ActionRequest;
  needsBiometric: boolean;
  expiresAt: number;
}

interface Ticket {
  id: string;
  kind: ActionKind;
  fingerprint: string;
  expiresAt: number;
  used: boolean;
}

export interface Grants {
  level: Level;
  /** Qué clases de acción permite la persona (todo apagado por defecto). */
  kinds: Partial<Record<ActionKind, boolean>>;
}

export const DEFAULT_GRANTS: Grants = { level: "off", kinds: {} };

/** Vida de una confirmación pendiente: pasada esta ventana hay que volver a pedirla. */
export const CONFIRM_WINDOW_MS = 60_000;
/** Un permiso previo para actuar en reposo caduca (máximo 24 h). */
export const MAX_TICKET_MS = 24 * 60 * 60 * 1000;
const AUDIT_LIMIT = 500;

let counter = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;

export class PermissionEngine {
  private pending = new Map<string, Pending>();
  private tickets = new Map<string, Ticket>();
  private log: AuditEntry[] = [];
  private killed = false;

  grants: Grants;
  private now: () => number;

  constructor(grants: Grants = { ...DEFAULT_GRANTS, kinds: {} }, now: () => number = () => Date.now()) {
    this.grants = grants;
    this.now = now;
  }

  // ── Interruptor de emergencia ("Hocki fuera" / "Detener Hocki") ────────────

  get isKilled() { return this.killed; }

  /** Corta todo al instante: anula pendientes y permisos previos. */
  kill(note = "Detenido por la persona") {
    this.killed = true;
    this.pending.clear();
    this.tickets.clear();
    this.record({ kind: "read_screen", summary: "Parada de emergencia", decision: "killed", note });
  }

  /** Solo la persona (no Hocki) reactiva. */
  resume() { this.killed = false; }

  // ── Decisión ───────────────────────────────────────────────────────────────

  decide(req: ActionRequest, ctx: Context): Decision {
    const d = this.evaluate(req, ctx);
    this.record({ kind: req.kind, summary: req.summary, decision: d.type, note: d.reason });
    return d;
  }

  private evaluate(req: ActionRequest, ctx: Context): Decision {
    if (this.killed) return { type: "deny", reason: "Hocki está detenido" };
    const { level, kinds } = this.grants;
    if (level === "off") return { type: "deny", reason: "Hocki está apagado" };
    if (!kinds[req.kind]) return { type: "deny", reason: `No me diste permiso para: ${ACTION_LABELS[req.kind]}` };

    if (req.kind === "read_screen") {
      return { type: "run_preapproved", ticketId: "", reason: "Observar está permitido" };
    }
    // Lo que aparece en pantalla es dato, no una orden.
    if (req.origin === "observed") {
      return { type: "suggest_only", reason: "La orden venía de contenido en pantalla, no de ti" };
    }
    if (level === "observe") return { type: "deny", reason: "Solo puedo observar" };
    if (level === "suggest") return { type: "suggest_only", reason: "Solo puedo sugerir" };

    const high = ACTION_RISK[req.kind] === "high";

    if (level === "rest" && ctx.resting) {
      // Los pagos y borrados exigen biometría en vivo: con la pantalla bloqueada no hay.
      if (high) return { type: "deny", reason: "Pagos y borrados esperan a que vuelvas y te verifiques" };
      const t = this.findTicket(req);
      if (t) return { type: "run_preapproved", ticketId: t.id, reason: "Tenías autorizada esta acción" };
      return { type: "deny", reason: "No tenías autorizada esta acción para el reposo" };
    }

    // Nivel "confirm", o "rest" con la persona presente: siempre se pregunta.
    return { type: "ask", needsBiometric: high, reason: high ? "Acción sensible: confirma con cara o voz" : "Confirma para continuar" };
  }

  // ── Confirmaciones ─────────────────────────────────────────────────────────

  /** Crea la tarjeta "¿Lo hago?" que verá la persona. */
  openConfirmation(req: ActionRequest, needsBiometric: boolean): string {
    const id = newId("c");
    this.pending.set(id, { id, request: req, needsBiometric, expiresAt: this.now() + CONFIRM_WINDOW_MS });
    return id;
  }

  /**
   * La persona pulsa "Sí". Devuelve la petición a ejecutar o null si no procede
   * (caducó, requiere biometría y no pasó, o se detuvo a Hocki).
   */
  approve(id: string, opts: { biometricOk?: boolean } = {}): ActionRequest | null {
    const p = this.pending.get(id);
    if (!p || this.killed) return null;
    if (this.now() > p.expiresAt) {
      this.pending.delete(id);
      this.record({ kind: p.request.kind, summary: p.request.summary, decision: "expired" });
      return null;
    }
    if (p.needsBiometric && !opts.biometricOk) return null; // sigue pendiente
    this.pending.delete(id);
    this.record({ kind: p.request.kind, summary: p.request.summary, decision: "approved" });
    return p.request;
  }

  reject(id: string) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    this.record({ kind: p.request.kind, summary: p.request.summary, decision: "rejected" });
  }

  // ── Permisos previos para el reposo ────────────────────────────────────────

  /** La persona autoriza de antemano UNA acción concreta para ejecutarse en reposo. */
  preapprove(req: ActionRequest, ttlMs = MAX_TICKET_MS): string | null {
    if (this.killed || req.origin !== "user") return null;
    if (ACTION_RISK[req.kind] === "high") return null; // nunca por adelantado
    const id = newId("t");
    this.tickets.set(id, {
      id, kind: req.kind, fingerprint: req.fingerprint,
      expiresAt: this.now() + Math.min(ttlMs, MAX_TICKET_MS), used: false,
    });
    return id;
  }

  /** Marca el permiso como gastado (sirve una sola vez). */
  consume(ticketId: string): boolean {
    const t = this.tickets.get(ticketId);
    if (!t || t.used || this.now() > t.expiresAt) return false;
    t.used = true;
    return true;
  }

  private findTicket(req: ActionRequest): Ticket | undefined {
    for (const t of this.tickets.values()) {
      if (!t.used && this.now() <= t.expiresAt && t.kind === req.kind && t.fingerprint === req.fingerprint) return t;
    }
    return undefined;
  }

  // ── Registro de auditoría ──────────────────────────────────────────────────

  private record(e: Omit<AuditEntry, "at">) {
    this.log.push({ at: this.now(), ...e });
    if (this.log.length > AUDIT_LIMIT) this.log.splice(0, this.log.length - AUDIT_LIMIT);
  }

  audit(): readonly AuditEntry[] { return this.log; }
  clearAudit() { this.log = []; }
  pendingCount() { return this.pending.size; }
}
