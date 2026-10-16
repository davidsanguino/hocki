// Perfiles por profesión: Hocki adapta sus atajos, recordatorios y temas de
// consulta a lo que hace la persona. Empezamos por las profesiones jurídicas de
// Colombia y los perfiles de David; se pueden añadir más sin tocar el resto.
//
// Aviso: Hocki orienta y organiza, no da asesoría jurídica. Las normas se citan
// como temas de consulta: siempre hay que verificar su vigencia en fuentes oficiales.

export interface Profession {
  id: string;
  name: string;
  /** Qué hace Hocki por esta persona, en una frase. */
  pitch: string;
  /** Atajos que aparecen en el menú de Hocki. */
  quickActions: string[];
  /** Términos y plazos típicos del oficio que Hocki ayuda a vigilar. */
  deadlines: string[];
  /** Normas y temas base para sus consultas (verificar vigencia). */
  knowledge: string[];
  /** "legal" o "general"; por omisión, las del bloque jurídico son "legal". */
  group?: "legal" | "general";
  /** Cómo le habla Hocki: formal, cercano o motivador. */
  tone?: "formal" | "cercano" | "motivador";
  /** Saludo propio del oficio. */
  hello?: string;
  /** Consejos cortos del oficio que Hocki puede decir de vez en cuando. */
  tips?: string[];
}

const NORMAS_BASE = [
  "Constitución Política de 1991",
  "Ley 1581 de 2012 (protección de datos personales)",
  "Ley 1755 de 2015 (derecho de petición)",
];

export const PROFESSIONS: Profession[] = [
  {
    id: "abogado-litigante",
    name: "Abogado litigante",
    pitch: "Agenda de audiencias y términos, borradores de escritos y resumen diario de tus procesos.",
    quickActions: ["Agendar audiencia", "Calcular término", "Borrador de memorial", "Resumen de procesos de hoy"],
    deadlines: ["Términos procesales en días hábiles", "Traslados", "Recursos de reposición y apelación", "Audiencias"],
    knowledge: [...NORMAS_BASE, "Código General del Proceso (Ley 1564 de 2012)", "Código Civil", "Código de Comercio",
      "Código Sustantivo del Trabajo", "Ley 1123 de 2007 (Código Disciplinario del Abogado)"],
  },
  {
    id: "penalista",
    name: "Abogado penalista / defensor",
    pitch: "Controla audiencias, términos de la actuación penal y entrevistas con tus defendidos.",
    quickActions: ["Agendar audiencia", "Línea de tiempo del caso", "Lista de pruebas", "Resumen del día"],
    deadlines: ["Audiencias de garantías", "Términos de la Ley 906", "Recursos", "Preclusión y prescripción"],
    knowledge: [...NORMAS_BASE, "Código Penal (Ley 599 de 2000)", "Código de Procedimiento Penal (Ley 906 de 2004)",
      "Ley 1098 de 2006 (Infancia y Adolescencia)"],
  },
  {
    id: "fiscal",
    name: "Fiscal",
    pitch: "Organiza noticias criminales, actos de investigación y audiencias por prioridad.",
    quickActions: ["Noticias criminales pendientes", "Agendar audiencia", "Cadena de custodia", "Resumen del día"],
    deadlines: ["Términos de investigación", "Solicitudes de audiencia", "Imputación y acusación"],
    knowledge: [...NORMAS_BASE, "Código Penal (Ley 599 de 2000)", "Código de Procedimiento Penal (Ley 906 de 2004)"],
  },
  {
    id: "juez",
    name: "Juez / magistrado",
    pitch: "Tablero de despacho: procesos por fallar, términos que vencen y audiencias de la semana.",
    quickActions: ["Procesos por vencer", "Agenda de audiencias", "Borrador de providencia", "Resumen del día"],
    deadlines: ["Términos para decidir", "Tutelas (10 días)", "Impugnaciones (3 días)", "Audiencias"],
    knowledge: [...NORMAS_BASE, "Ley 270 de 1996 (Estatutaria de la Administración de Justicia)",
      "Código General del Proceso (Ley 1564 de 2012)", "Decreto 2591 de 1991 (tutela)"],
  },
  {
    id: "defensor-publico",
    name: "Defensor público / de familia",
    pitch: "Seguimiento de casos asignados, citas con usuarios y términos urgentes.",
    quickActions: ["Casos asignados", "Citar usuario", "Calcular término", "Resumen del día"],
    deadlines: ["Audiencias", "Términos de recursos", "Seguimiento de medidas de protección"],
    knowledge: [...NORMAS_BASE, "Ley 1098 de 2006 (Infancia y Adolescencia)", "Código de Procedimiento Penal (Ley 906 de 2004)"],
  },
  {
    id: "ministerio-publico",
    name: "Procurador / ministerio público",
    pitch: "Seguimiento de procesos disciplinarios y de intervención, con alertas de términos.",
    quickActions: ["Procesos disciplinarios", "Calcular término", "Borrador de concepto", "Resumen del día"],
    deadlines: ["Términos disciplinarios", "Intervenciones", "Conceptos"],
    knowledge: [...NORMAS_BASE, "Código General Disciplinario (Ley 1952 de 2019)"],
  },
  {
    id: "contencioso",
    name: "Abogado de lo contencioso administrativo",
    pitch: "Vigila caducidades y términos frente a entidades públicas.",
    quickActions: ["Calcular caducidad", "Agendar audiencia", "Borrador de demanda", "Resumen del día"],
    deadlines: ["Caducidad de medios de control", "Silencio administrativo", "Derecho de petición (15 días hábiles)"],
    knowledge: [...NORMAS_BASE, "CPACA (Ley 1437 de 2011)", "Ley 2080 de 2021 (reforma al CPACA)"],
  },
  {
    id: "laboralista",
    name: "Abogado laboralista",
    pitch: "Liquidaciones de referencia, plazos de prescripción y citas con trabajadores o empresas.",
    quickActions: ["Calcular plazo", "Cita con cliente", "Borrador de carta", "Resumen del día"],
    deadlines: ["Prescripción de acreencias laborales", "Audiencias", "Descargos disciplinarios"],
    knowledge: [...NORMAS_BASE, "Código Sustantivo del Trabajo", "Ley 1010 de 2006 (acoso laboral)"],
  },
  {
    id: "juridico-empresarial",
    name: "Asesor jurídico corporativo",
    pitch: "Contratos por vencer, poderes y renovaciones, todo en un solo recordatorio.",
    quickActions: ["Contratos por vencer", "Renovaciones", "Borrador de contrato", "Resumen del día"],
    deadlines: ["Vencimiento de contratos", "Renovación de matrícula mercantil", "Asambleas y actas"],
    knowledge: [...NORMAS_BASE, "Código de Comercio", "Código Civil"],
  },
  {
    id: "notario",
    name: "Notario / personal notarial",
    pitch: "Agenda de firmas y escrituras, lista de requisitos por trámite y alertas de turnos.",
    quickActions: ["Agenda de firmas", "Requisitos del trámite", "Borrador de minuta", "Resumen del día"],
    deadlines: ["Citas de firma", "Vigencia de certificados"],
    knowledge: [...NORMAS_BASE, "Decreto 960 de 1970 (Estatuto del Notariado)", "Código Civil"],
  },
  {
    id: "conciliador",
    name: "Conciliador / árbitro",
    pitch: "Citaciones, actas y seguimiento de acuerdos.",
    quickActions: ["Citar partes", "Borrador de acta", "Seguimiento de acuerdos", "Resumen del día"],
    deadlines: ["Audiencias de conciliación", "Cumplimiento de acuerdos"],
    knowledge: [...NORMAS_BASE, "Ley 2220 de 2022 (Estatuto de Conciliación)"],
  },
  {
    id: "secretario-judicial",
    name: "Secretario / escribiente judicial",
    pitch: "Control de traslados, notificaciones y expedientes, con alertas de términos.",
    quickActions: ["Notificaciones pendientes", "Calcular término", "Lista de traslados", "Resumen del día"],
    deadlines: ["Traslados", "Notificaciones", "Ejecutoria de providencias"],
    knowledge: [...NORMAS_BASE, "Código General del Proceso (Ley 1564 de 2012)", "Ley 270 de 1996"],
  },
  {
    id: "policia-judicial",
    name: "Policía / policía judicial",
    pitch: "Informes y partes ordenados, cadena de custodia y recordatorios del servicio.",
    quickActions: ["Borrador de informe", "Cadena de custodia", "Recordatorios del servicio", "Resumen del día"],
    deadlines: ["Entrega de informes", "Audiencias como testigo", "Turnos"],
    knowledge: [...NORMAS_BASE, "Código Nacional de Policía y Convivencia (Ley 1801 de 2016)",
      "Código de Procedimiento Penal (Ley 906 de 2004)", "Código Penal (Ley 599 de 2000)"],
  },
  {
    id: "estudiante-derecho",
    name: "Estudiante de derecho / investigador",
    pitch: "Plan de estudio, fichas de jurisprudencia y repaso espaciado.",
    quickActions: ["Plan de estudio", "Ficha de sentencia", "Repaso de hoy", "Resumen del día"],
    deadlines: ["Entregas", "Exámenes", "Semilleros"],
    knowledge: [...NORMAS_BASE, "Código Civil", "Código Penal (Ley 599 de 2000)", "Código General del Proceso (Ley 1564 de 2012)"],
  },
  {
    id: "desarrollador",
    name: "Desarrollador / diseñador",
    pitch: "Cuándo terminan tus agentes de código, pendientes de revisión y resumen del trabajo.",
    quickActions: ["Estado de mis agentes", "Pendientes de revisión", "Resumen del día"],
    deadlines: ["Entregas", "Despliegues"],
    knowledge: ["Ley 1581 de 2012 (protección de datos personales)"],
  },
  {
    id: "general",
    name: "Uso general",
    pitch: "Compañero para recordatorios, notas y resumen del día.",
    quickActions: ["Recordatorio", "Nota rápida", "Resumen del día"],
    deadlines: [],
    knowledge: [],
  },
];

import { NATIONAL_PROFESSIONS } from "./professions-national";

const GENERAL = PROFESSIONS.pop()!; // "general" va siempre al final
const LEGAL_TIPS = [
  "Revisa hoy los términos que vencen esta semana.",
  "Guarda cada actuación con fecha: el expediente lo agradece.",
  "Verifica la vigencia de la norma antes de citarla.",
];
for (const p of PROFESSIONS) {
  p.group ??= p.id === "desarrollador" || p.id === "estudiante-derecho" || p.id === "policia-judicial" ? "general" : "legal";
  p.tone ??= "formal";
  p.tips ??= p.group === "legal" ? LEGAL_TIPS : [];
}
PROFESSIONS.push(...NATIONAL_PROFESSIONS, GENERAL);
GENERAL.group = "general"; GENERAL.tone = "cercano"; GENERAL.hello ??= "¡Hola! ¿En qué te ayudo?"; GENERAL.tips ??= [];

export const DISCLAIMER =
  "Hocki organiza y orienta; no reemplaza a un abogado ni da asesoría jurídica. Verifica la vigencia de toda norma en fuentes oficiales.";

export function professionById(id: string): Profession {
  return PROFESSIONS.find((p) => p.id === id) ?? PROFESSIONS[PROFESSIONS.length - 1];
}

// ── Cálculo de términos en días hábiles ───────────────────────────────────────

const key = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/**
 * Suma `n` días hábiles (sin sábados, domingos ni los festivos que le pases) a
 * partir del día SIGUIENTE a `from`. Los festivos de Colombia no se calculan aquí:
 * se entregan como lista (Date[]) para no equivocarse con cambios de calendario.
 */
export function addBusinessDays(from: Date, n: number, holidays: Date[] = []): Date {
  const skip = new Set(holidays.map(key));
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !skip.has(key(d))) left--;
  }
  return d;
}

/** Plazos de uso frecuente (días hábiles). */
export const COMMON_TERMS = {
  tutelaFallo: { label: "Fallo de tutela", days: 10 },
  tutelaImpugnacion: { label: "Impugnación de tutela", days: 3 },
  peticion: { label: "Respuesta a derecho de petición", days: 15 },
} as const;
