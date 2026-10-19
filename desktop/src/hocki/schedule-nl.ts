// Entiende pedidos como "recuérdame llamar a mamá mañana a las 8" o
// "todos los días a las 6 pm hazme el resumen" y los convierte en una tarea.
// Solo crea tareas seguras (recordatorios y resúmenes); nada que actúe por sí solo.

import type { JobSpec, Schedule } from "./jobs";

/** Quita tildes sin cambiar el largo del texto, para poder cortar el original por posición. */
function fold(s: string): string {
  return s.replace(/[À-ſ]/g, (c) => c.normalize("NFD")[0]).toLowerCase();
}

const WEEKDAYS: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const UNIT = { minuto: 1, minutos: 1, hora: 60, horas: 60 } as const;

export interface ParsedJob { spec: JobSpec; confirmation: string }

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

/** Hora del día mencionada ("a las 8", "a las 6:30 pm", "a las 8 de la noche"). */
function parseClock(f: string): { hour: number; minute: number; span: [number, number] } | null {
  const m = f.match(/\ba las (\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|de la manana|de la tarde|de la noche|de la madrugada)?/);
  if (!m || m.index == null) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (hour > 24 || minute > 59) return null;
  const mer = m[3] ?? "";
  if (/^(pm|p\.m\.|de la tarde|de la noche)$/.test(mer) && hour < 12) hour += 12;
  if (/^(am|a\.m\.|de la manana|de la madrugada)$/.test(mer) && hour === 12) hour = 0;
  if (hour === 24) hour = 0;
  return { hour, minute, span: [m.index, m.index + m[0].length] };
}

/** Quita del texto original los tramos [a,b) indicados. */
function cut(original: string, spans: Array<[number, number]>): string {
  let out = "", at = 0;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) { out += original.slice(at, a); at = b; }
  return (out + original.slice(at)).replace(/\s+/g, " ").replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "").replace(/^(de|que|para|el|la)\s+/i, "");
}

export function parseJobRequest(input: string, now: number): ParsedJob | null {
  const text = input.trim();
  const f = fold(text);
  const spans: Array<[number, number]> = [];

  const isReminder = /\b(recuerdame|recuerdame que|recordame|avisame|avisame que)\b/.exec(f);
  const isSummary = /\b(resumen del dia|resumen de hoy|resume mi dia)\b/.exec(f);
  if (!isReminder && !isSummary) return null;
  if (isReminder) spans.push([isReminder.index, isReminder.index + isReminder[0].length]);
  if (isSummary) spans.push([isSummary.index, isSummary.index + isSummary[0].length]);
  const lead = /\b(hazme|dame|preparame|haz|prepara)\b/.exec(f);
  if (lead && isSummary) spans.push([lead.index, lead.index + lead[0].length]);

  let schedule: Schedule | null = null;
  let when = "";

  // "en 10 minutos", "en 2 horas"
  const rel = f.match(/\ben (\d{1,3}) (minutos?|horas?)\b/);
  // "cada 30 minutos"
  const every = f.match(/\bcada (\d{1,3}) (minutos?|horas?)\b/);
  const daily = f.match(/\b(todos los dias|cada dia|diariamente|a diario)\b/);
  const weekday = f.match(/\b(?:todos los |cada |el )?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)s?\b/);
  const tomorrow = f.match(/(?<!la )\bmanana\b/);
  const clock = parseClock(f);

  if (every) {
    const minutes = Number(every[1]) * UNIT[every[2] as keyof typeof UNIT];
    schedule = { type: "every", minutes };
    when = `cada ${every[1]} ${every[2]}`;
    spans.push([every.index!, every.index! + every[0].length]);
  } else if (rel) {
    schedule = { type: "once", at: now + Number(rel[1]) * UNIT[rel[2] as keyof typeof UNIT] * 60_000 };
    when = `en ${rel[1]} ${rel[2]}`;
    spans.push([rel.index!, rel.index! + rel[0].length]);
  } else if (clock) {
    const repeating = daily ?? (weekday && /\b(todos los|cada)\b/.test(f) ? weekday : null);
    if (daily) spans.push([daily.index!, daily.index! + daily[0].length]);
    spans.push(clock.span);
    if (repeating && !daily) {
      const day = WEEKDAYS[weekday![1]];
      spans.push([weekday!.index!, weekday!.index! + weekday![0].length]);
      schedule = { type: "daily", hour: clock.hour, minute: clock.minute, days: [day] };
      when = `cada ${weekday![1]} a las ${hhmm(clock.hour, clock.minute)}`;
    } else if (daily) {
      schedule = { type: "daily", hour: clock.hour, minute: clock.minute };
      when = `todos los días a las ${hhmm(clock.hour, clock.minute)}`;
    } else {
      const d = new Date(now);
      let target = new Date(d.getFullYear(), d.getMonth(), d.getDate(), clock.hour, clock.minute, 0, 0);
      if (tomorrow) { target = new Date(target.getTime() + 24 * 3600_000); spans.push([tomorrow.index!, tomorrow.index! + tomorrow[0].length]); }
      else if (weekday) {
        spans.push([weekday.index!, weekday.index! + weekday[0].length]);
        const want = WEEKDAYS[weekday[1]];
        let add = (want - target.getDay() + 7) % 7;
        if (add === 0 && target.getTime() <= now) add = 7;
        target = new Date(target.getFullYear(), target.getMonth(), target.getDate() + add, clock.hour, clock.minute, 0, 0);
      } else if (target.getTime() <= now) target = new Date(target.getTime() + 24 * 3600_000);
      schedule = { type: "once", at: target.getTime() };
      when = `${tomorrow ? "mañana" : weekday ? weekday[1] : "hoy"} a las ${hhmm(clock.hour, clock.minute)}`;
    }
  } else if (daily && isSummary) {
    schedule = { type: "daily", hour: 18, minute: 0 };
    when = "todos los días a las 18:00";
    spans.push([daily.index!, daily.index! + daily[0].length]);
  }

  if (!schedule) return null;

  if (isSummary) {
    return {
      spec: { title: "Resumen del día", schedule, action: { type: "summary" } },
      confirmation: `Listo: te haré el resumen del día ${when}.`,
    };
  }
  const what = cut(text, spans);
  if (!what) return null;
  return {
    spec: { title: what, schedule, action: { type: "notify", message: `Recordatorio: ${what}` } },
    confirmation: `Listo, te lo recuerdo ${when}: ${what}.`,
  };
}
