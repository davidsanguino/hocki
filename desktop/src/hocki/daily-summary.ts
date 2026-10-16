// Resumen del día de Hocki. Se arma en el dispositivo con lo que Hocki vio
// pasar hoy (tareas, agentes, aprobaciones, recordatorios). Nada sale de aquí.

import type { AuditEntry } from "./permissions";

export type DayEventType = "tarea" | "agente" | "mensaje" | "recordatorio" | "nota";

export interface DayEvent {
  at: number;
  type: DayEventType;
  title: string;
  /** Para tareas y recordatorios: ¿quedó hecho? */
  done?: boolean;
}

export interface Summary {
  headline: string;
  done: string[];
  pending: string[];
  agents: string[];
  actions: { approved: number; rejected: number; blocked: number };
  text: string;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildSummary(events: DayEvent[], audit: readonly AuditEntry[], day: Date = new Date()): Summary {
  const from = startOfDay(day), to = from + 24 * 60 * 60 * 1000;
  const today = events.filter((e) => e.at >= from && e.at < to).sort((a, b) => a.at - b.at);

  const done = today.filter((e) => (e.type === "tarea" || e.type === "recordatorio") && e.done).map((e) => e.title);
  const pending = today.filter((e) => (e.type === "tarea" || e.type === "recordatorio") && !e.done).map((e) => e.title);
  const agents = today.filter((e) => e.type === "agente").map((e) => e.title);

  const aud = audit.filter((a) => a.at >= from && a.at < to);
  const actions = {
    approved: aud.filter((a) => a.decision === "approved").length,
    rejected: aud.filter((a) => a.decision === "rejected" || a.decision === "expired").length,
    blocked: aud.filter((a) => a.decision === "deny" || a.decision === "killed").length,
  };

  const headline = done.length || agents.length
    ? `Hoy completaste ${plural(done.length, "tarea", "tareas")}` +
      (agents.length ? ` y tus agentes cerraron ${plural(agents.length, "sesión", "sesiones")}` : "") + "."
    : "Hoy fue un día tranquilo.";

  const lines = [headline];
  if (done.length) lines.push("Hecho:", ...done.map((t) => `  • ${t}`));
  if (pending.length) lines.push("Pendiente para mañana:", ...pending.map((t) => `  • ${t}`));
  if (agents.length) lines.push("Agentes:", ...agents.map((t) => `  • ${t}`));
  if (actions.approved || actions.rejected || actions.blocked) {
    lines.push(
      `Acciones de Hocki: ${plural(actions.approved, "aprobada", "aprobadas")}, ` +
      `${plural(actions.rejected, "rechazada o vencida", "rechazadas o vencidas")}, ` +
      `${plural(actions.blocked, "bloqueada", "bloqueadas")}.`,
    );
  }

  return { headline, done, pending, agents, actions, text: lines.join("\n") };
}
