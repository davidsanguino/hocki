// Procesos en segundo plano de Hocki: lo que sigue funcionando entre mensajes.
//
// Hocki puede dejar tareas programadas (recordatorios, resúmenes, revisiones de
// plazos, rutinas por profesión) y ejecutarlas solo mientras la app está abierta.
// "Solo" no significa "sin permiso":
//   • Avisar, resumir y recordar son seguras: se ejecutan solas y quedan en el registro.
//   • Cualquier cosa que cambie algo (mensajes, ajustes, borrar, pagar) pasa por el motor
//     de permisos: pide tu confirmación, y los pagos y borrados nunca corren solos.
//   • "Hocki fuera" las pausa todas al instante.
// Todo lo que pasa mientras no estás se guarda en la bandeja ("mientras no estabas").

import type { ActionRequest, Context, PermissionEngine } from "./permissions";
import type { Journal } from "./journal";

export type Schedule =
  | { type: "once"; at: number }
  | { type: "every"; minutes: number }
  /** days: 0 = domingo … 6 = sábado; vacío = todos los días. */
  | { type: "daily"; hour: number; minute: number; days?: number[] };

export type JobAction =
  | { type: "notify"; message: string }
  | { type: "summary" }
  | { type: "request"; request: ActionRequest };

export type JobStatus = "active" | "paused" | "done" | "failed";

export interface JobSpec {
  title: string;
  schedule: Schedule;
  action: JobAction;
  maxRuns?: number;
}

export interface Job extends JobSpec {
  id: string;
  status: JobStatus;
  createdAt: number;
  nextRun: number | null;
  lastRun?: number;
  runs: number;
  failures: number;
  /** Confirmación pendiente de una acción que pidió permiso. */
  awaiting?: string;
}

export interface OutboxItem {
  id: string;
  at: number;
  text: string;
  kind: "reminder" | "summary" | "approval" | "info";
  /** Pendiente de leer. */
  unread: boolean;
  confirmationId?: string;
}

export const JOB_LIMITS = { jobs: 50, minEveryMinutes: 1, maxOutbox: 100, maxFailures: 3 } as const;
const MIN = 60_000;

/** Siguiente momento en que toca ejecutar, después de `after`. */
export function nextRunAfter(s: Schedule, after: number): number | null {
  switch (s.type) {
    case "once": return s.at > after ? s.at : null;
    case "every": return after + Math.max(JOB_LIMITS.minEveryMinutes, s.minutes) * MIN;
    case "daily": {
      const days = s.days && s.days.length ? s.days : [0, 1, 2, 3, 4, 5, 6];
      const d = new Date(after);
      for (let i = 0; i < 8; i++) {
        const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, s.hour, s.minute, 0, 0);
        if (c.getTime() > after && days.includes(c.getDay())) return c.getTime();
      }
      return null;
    }
  }
}

export interface JobDeps {
  engine: PermissionEngine;
  journal: Journal;
  now?: () => number;
  /** Cómo está el equipo ahora (reposo o no). */
  context?: () => Context;
  /** Ejecuta de verdad una acción ya autorizada (la pone cada plataforma). */
  execute?: (request: ActionRequest) => void;
  /** Texto del resumen del día. */
  summaryText?: () => string;
}

let seq = 0;

export class JobRunner {
  private jobs: Job[] = [];
  private box: OutboxItem[] = [];
  private d: JobDeps;
  private now: () => number;

  constructor(deps: JobDeps, saved?: { jobs: Job[]; outbox: OutboxItem[] }) {
    this.d = deps;
    this.now = deps.now ?? (() => Date.now());
    if (saved) { this.jobs = saved.jobs; this.box = saved.outbox; }
  }

  // ── Gestión ────────────────────────────────────────────────────────────────

  add(spec: JobSpec): Job | { error: "limit" | "past" | "interval" } {
    if (this.jobs.filter((j) => j.status === "active" || j.status === "paused").length >= JOB_LIMITS.jobs) return { error: "limit" };
    if (spec.schedule.type === "every" && spec.schedule.minutes < JOB_LIMITS.minEveryMinutes) return { error: "interval" };
    const t = this.now();
    const next = nextRunAfter(spec.schedule, t);
    if (next == null) return { error: "past" };
    const job: Job = { ...spec, id: `j${t.toString(36)}${(seq++).toString(36)}`, status: "active", createdAt: t, nextRun: next, runs: 0, failures: 0 };
    this.jobs.push(job);
    this.d.journal.add("job", `Programado: ${job.title}`);
    return job;
  }

  list(): Job[] { return this.jobs.filter((j) => j.status !== "done" || j.runs > 0).map((j) => ({ ...j })); }
  active(): Job[] { return this.jobs.filter((j) => j.status === "active"); }

  pause(id: string) { const j = this.find(id); if (j && j.status === "active") j.status = "paused"; }
  resume(id: string) {
    const j = this.find(id);
    if (j && j.status === "paused") {
      j.status = "active";
      // Un recordatorio de una sola vez que venció durante la pausa se entrega al reanudar.
      j.nextRun = j.schedule.type === "once" ? Math.max(j.schedule.at, this.now()) : nextRunAfter(j.schedule, this.now());
      if (j.nextRun == null) j.status = "done";
    }
  }
  cancel(id: string): boolean {
    const n = this.jobs.length;
    this.jobs = this.jobs.filter((j) => j.id !== id);
    if (this.jobs.length < n) this.d.journal.add("job", "Tarea cancelada");
    return this.jobs.length < n;
  }
  cancelAll(): number { const n = this.jobs.length; this.jobs = []; if (n) this.d.journal.add("job", `Canceladas ${n} tareas`); return n; }

  /** "Hocki fuera": todo se pausa y nada corre hasta que la persona lo reactive. */
  pauseAll() { for (const j of this.jobs) if (j.status === "active") j.status = "paused"; this.d.journal.add("job", "Todas las tareas en pausa"); }

  private find(id: string) { return this.jobs.find((j) => j.id === id); }

  // ── Ejecución ──────────────────────────────────────────────────────────────

  /** Llamar seguido (cada segundo basta): corre lo que ya le toca. */
  tick(): number {
    const t = this.now();
    let ran = 0;
    for (const j of this.jobs) {
      if (j.status !== "active" || j.nextRun == null || j.nextRun > t) continue;
      if (this.d.engine.isKilled) continue;
      if (j.awaiting) {
        // Sigue esperando tu respuesta; si la confirmación ya caducó, se suelta.
        if (this.d.engine.pendingCount() === 0) j.awaiting = undefined; else continue;
      }
      this.run(j, t);
      ran++;
    }
    return ran;
  }

  private run(j: Job, t: number) {
    j.lastRun = t;
    j.runs++;
    try {
      this.perform(j, t);
    } catch (e) {
      j.failures++;
      this.d.journal.add("job", `Falló: ${j.title}`, String((e as Error)?.message ?? e));
      if (j.failures >= JOB_LIMITS.maxFailures) { j.status = "failed"; this.say(`Pausé "${j.title}" porque falló varias veces.`, "info"); return; }
    }
    if (j.status !== "active") return;
    const done = j.schedule.type === "once" || (j.maxRuns != null && j.runs >= j.maxRuns);
    j.nextRun = done ? null : nextRunAfter(j.schedule, t);
    if (done || j.nextRun == null) j.status = "done";
  }

  private perform(j: Job, t: number) {
    const a = j.action;
    if (a.type === "notify") {
      this.say(a.message, "reminder");
      this.d.journal.add("job", `Recordatorio: ${j.title}`);
    } else if (a.type === "summary") {
      this.say(this.d.summaryText?.() ?? "Hoy fue un día tranquilo.", "summary");
      this.d.journal.add("job", `Resumen: ${j.title}`);
    } else {
      const ctx = this.d.context?.() ?? { resting: false };
      const dec = this.d.engine.decide(a.request, ctx);
      if (dec.type === "run_preapproved") {
        if (dec.ticketId && !this.d.engine.consume(dec.ticketId)) { this.d.journal.add("job", `Sin permiso vigente: ${j.title}`); return; }
        this.d.execute?.(a.request);
        this.d.journal.add("job", `Ejecutado con tu autorización previa: ${j.title}`);
      } else if (dec.type === "ask") {
        const cid = this.d.engine.openConfirmation(a.request, dec.needsBiometric);
        j.awaiting = cid;
        this.say(`Necesito tu aprobación para: ${a.request.summary}`, "approval", cid);
        this.d.journal.add("job", `Esperando tu aprobación: ${j.title}`);
      } else {
        this.say(`No hice "${a.request.summary}": ${dec.reason}.`, "info");
        this.d.journal.add("job", `Bloqueado: ${j.title}`, dec.reason);
      }
    }
    void t;
  }

  // ── Respuesta a una aprobación pedida por una tarea ────────────────────────

  /** La persona dijo "sí" (con biometría si hacía falta): recién ahí se ejecuta. */
  confirm(confirmationId: string, opts: { biometricOk?: boolean } = {}): boolean {
    const req = this.d.engine.approve(confirmationId, opts);
    if (!req) return false;
    this.d.execute?.(req);
    this.d.journal.add("approval", `Aprobaste: ${req.summary}`);
    for (const j of this.jobs) if (j.awaiting === confirmationId) j.awaiting = undefined;
    return true;
  }

  deny(confirmationId: string) {
    this.d.engine.reject(confirmationId);
    this.d.journal.add("approval", "Rechazaste una acción propuesta");
    for (const j of this.jobs) if (j.awaiting === confirmationId) j.awaiting = undefined;
  }

  // ── Bandeja ("mientras no estabas") ────────────────────────────────────────

  private say(text: string, kind: OutboxItem["kind"], confirmationId?: string) {
    this.box.push({ id: `o${this.now().toString(36)}${(seq++).toString(36)}`, at: this.now(), text, kind, unread: true, ...(confirmationId ? { confirmationId } : {}) });
    if (this.box.length > JOB_LIMITS.maxOutbox) this.box.splice(0, this.box.length - JOB_LIMITS.maxOutbox);
  }

  unread(): OutboxItem[] { return this.box.filter((o) => o.unread); }
  markAllRead() { for (const o of this.box) o.unread = false; }
  outbox(): OutboxItem[] { return [...this.box]; }

  // ── Guardado ───────────────────────────────────────────────────────────────

  snapshot() { return { jobs: this.jobs.map((j) => ({ ...j })), outbox: this.box.map((o) => ({ ...o })) }; }
}
