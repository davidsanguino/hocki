// El "cerebro" de Hocki: une la memoria, el registro, las tareas en segundo plano y la
// profesión de la persona. Resuelve por sí mismo lo que puede (recordar, olvidar,
// programar, listar) y le pasa lo demás al asistente de IA con el contexto correcto.
// No sabe de pantallas: lo usa cada plataforma.

import { Journal, type JournalEntry } from "./journal";
import { JobRunner, type Job, type OutboxItem } from "./jobs";
import { MemoryStore, redact, type MemoryData } from "./memory";
import { buildSystemPrompt, routinesFor } from "./playbooks";
import { PROFESSIONS, professionById, type Profession } from "./professions";
import { parseJobRequest } from "./schedule-nl";
import { buildSummary, type DayEvent } from "./daily-summary";
import { normalize } from "./voice-commands";
import type { ActionRequest, PermissionEngine } from "./permissions";
import type { KV } from "./storage";

const KEY = "hocki.brain.v1";

/** Cómo la gente dice su oficio → id del perfil. Lo más largo se prueba primero. */
const ALIASES: Record<string, string> = {
  "ingeniero de sistemas": "ingeniero-sistemas", "ingeniera de sistemas": "ingeniero-sistemas", programador: "ingeniero-sistemas",
  programadora: "ingeniero-sistemas", desarrollador: "ingeniero-sistemas", desarrolladora: "ingeniero-sistemas",
  "ingeniero industrial": "ingeniero-industrial", "ingeniera industrial": "ingeniero-industrial",
  "ingeniero civil": "ingeniero-civil", "ingeniera civil": "ingeniero-civil",
  "tecnico en sistemas": "tecnico-sistemas", "administrador de empresas": "administrador", administrador: "administrador", administradora: "administrador",
  abogado: "abogado-litigante", abogada: "abogado-litigante", litigante: "abogado-litigante", penalista: "penalista", defensor: "defensor-publico",
  defensora: "defensor-publico", fiscal: "fiscal", juez: "juez", jueza: "juez", magistrado: "juez", magistrada: "juez", procurador: "ministerio-publico",
  procuradora: "ministerio-publico", laboralista: "laboralista", notario: "notario", notaria: "notario", conciliador: "conciliador", conciliadora: "conciliador",
  contador: "contador", contadora: "contador", medico: "medico", medica: "medico", doctor: "medico", doctora: "medico",
  enfermero: "enfermero", enfermera: "enfermero", odontologo: "odontologo", odontologa: "odontologo", dentista: "odontologo",
  psicologo: "psicologo", psicologa: "psicologo", docente: "docente", profesor: "docente", profesora: "docente", profe: "docente", maestro: "docente", maestra: "docente",
  economista: "economista", publicista: "mercadeo", mercadeo: "mercadeo", periodista: "comunicador", comunicador: "comunicador", comunicadora: "comunicador",
  disenador: "disenador", disenadora: "disenador", "disenador grafico": "disenador", arquitecto: "arquitecto", arquitecta: "arquitecto",
  vendedor: "ventas", vendedora: "ventas", comercial: "ventas", electricista: "electricista", agricultor: "agricultor", agronomo: "agricultor",
  comerciante: "emprendedor", emprendedor: "emprendedor", emprendedora: "emprendedor", chef: "chef", cocinero: "chef", cocinera: "chef",
  fisioterapeuta: "fisioterapeuta", conductor: "conductor", conductora: "conductor", taxista: "conductor", camionero: "conductor",
  policia: "fuerza-publica", soldado: "fuerza-publica", militar: "fuerza-publica", cadete: "fuerza-publica",
  estudiante: "estudiante", "recursos humanos": "recursos-humanos", "talento humano": "recursos-humanos", secretario: "secretario-judicial",
};

export function matchProfession(text: string): Profession | null {
  const t = normalize(text);
  const keys = Object.keys(ALIASES).sort((a, b) => b.length - a.length);
  for (const k of keys) if (new RegExp(`\\b${k}\\b`).test(t)) return PROFESSIONS.find((p) => p.id === ALIASES[k]) ?? null;
  return null;
}

export interface BrainState {
  profession: string;
  name?: string;
  memory: MemoryData;
  journal: JournalEntry[];
  jobs: { jobs: Job[]; outbox: OutboxItem[] };
}

export interface BrainDeps {
  engine: PermissionEngine;
  kv: KV;
  now?: () => number;
  /** Ejecuta de verdad una acción ya autorizada. */
  execute?: (r: ActionRequest) => void;
  resting?: () => boolean;
}

export interface LocalReply { text: string }

const list = (items: string[]) => items.map((x) => `• ${x}`).join("\n");
const fmtWhen = (t: number | null) => (t == null ? "—" : new Date(t).toLocaleString("es-CO", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }));

export class HockiBrain {
  profession: string = "general";
  name?: string;
  memory: MemoryStore;
  journal: Journal;
  jobs: JobRunner;
  private d: BrainDeps;
  private now: () => number;
  private turns = 0;

  constructor(deps: BrainDeps, saved?: Partial<BrainState>) {
    this.d = deps;
    this.now = deps.now ?? (() => Date.now());
    this.profession = saved?.profession ?? "general";
    this.name = saved?.name;
    this.memory = new MemoryStore(this.now, saved?.memory);
    this.journal = new Journal(this.now, saved?.journal ?? []);
    this.jobs = new JobRunner({
      engine: deps.engine, journal: this.journal, now: this.now, execute: deps.execute,
      context: () => ({ resting: deps.resting?.() ?? false }),
      summaryText: () => this.summary(),
    }, saved?.jobs);
  }

  static load(deps: BrainDeps): HockiBrain {
    let saved: Partial<BrainState> | undefined;
    try { const raw = deps.kv.get(KEY); if (raw) saved = JSON.parse(raw); } catch { /* guardado dañado: se empieza limpio */ }
    return new HockiBrain(deps, saved);
  }

  save() {
    const s: BrainState = { profession: this.profession, name: this.name, memory: this.memory.data, journal: this.journal.snapshot(), jobs: this.jobs.snapshot() };
    this.d.kv.set(KEY, JSON.stringify(s));
  }

  get professionProfile(): Profession { return professionById(this.profession); }

  // ── Resumen del día ────────────────────────────────────────────────────────

  summary(): string {
    const events: DayEvent[] = this.journal.today().flatMap((e): DayEvent[] => {
      if (e.kind === "chat") return [{ at: e.at, type: "mensaje", title: e.title }];
      if (e.kind !== "job") return [];
      if (/^(Recordatorio|Ejecutado)/.test(e.title)) return [{ at: e.at, type: "tarea", title: e.title.replace(/^[^:]+:\s*/, ""), done: true }];
      if (/^Esperando/.test(e.title)) return [{ at: e.at, type: "tarea", title: e.title.replace(/^[^:]+:\s*/, ""), done: false }];
      return [];
    });
    const s = buildSummary(events, this.d.engine.audit(), new Date(this.now()));
    const chats = events.filter((e) => e.type === "mensaje").length;
    return chats ? `${s.text}\nConversaciones con tu asistente hoy: ${chats}.` : s.text;
  }

  // ── Órdenes que Hocki resuelve solo ────────────────────────────────────────

  /** Devuelve la respuesta si Hocki lo resuelve él mismo; null si es para el asistente de IA. */
  handle(input: string): LocalReply | null {
    const text = input.trim();
    const t = normalize(text);
    if (!t) return null;
    const r = this.route(text, t);
    if (r) { this.journal.add("chat", "Orden resuelta por Hocki"); this.save(); }
    return r;
  }

  private route(text: string, t: string): LocalReply | null {
    // Respuesta a una autorización pendiente (solo la más reciente)
    const pend = [...this.jobs.outbox()].reverse().find((o) => o.kind === "approval" && o.confirmationId && this.jobs.list().some((j) => j.awaiting === o.confirmationId));
    if (pend && pend.confirmationId) {
      if (/^(si|confirmo|apruebo|aprobar|adelante|hazlo|dale)$/.test(t)) {
        return { text: this.jobs.confirm(pend.confirmationId, { biometricOk: false })
          ? "Hecho, ya lo envié con tu autorización."
          : "Esa acción es sensible: necesito que la apruebes con tu huella o Windows Hello / Face ID. No hice nada." };
      }
      if (/^(no|rechazo|rechazar|cancela eso|no lo hagas|deniego)$/.test(t)) {
        this.jobs.deny(pend.confirmationId);
        return { text: "Entendido, no hice nada." };
      }
    }

    // Oficio y nombre
    let m = t.match(/^(?:soy|ahora soy|trabajo como|me dedico a ser|mi profesion es|mi oficio es)\s+(.+)/);
    if (m) {
      const p = matchProfession(m[1]);
      if (p) { this.profession = p.id; this.journal.add("system", `Oficio: ${p.name}`); return { text: `Perfecto, desde ahora te ayudo como ${p.name.toLowerCase()}. ${p.hello ?? ""}`.trim() }; }
    }
    m = text.match(/^(?:me llamo|mi nombre es)\s+([\p{L}][\p{L} ]{0,30})/iu);
    if (m) { this.name = m[1].trim().split(/\s+/)[0]; return { text: `Mucho gusto, ${this.name}.` }; }

    // Memoria encendida o apagada
    if (/\b(activa|enciende|prende|usa)\b.*\bmemoria\b/.test(t)) {
      this.memory.setEnabled(true);
      return { text: "Memoria activada. Guardo solo en este dispositivo, nunca claves ni tarjetas, y puedes decirme \"olvida todo\" cuando quieras." };
    }
    if (/\b(desactiva|apaga|deja de usar)\b.*\bmemoria\b/.test(t)) {
      this.memory.setEnabled(false);
      return { text: "Memoria apagada. No guardaré nada nuevo; lo anterior sigue ahí hasta que me pidas olvidarlo." };
    }

    // Olvidar
    if (/\b(olvida todo|borra (toda )?(tu |mi )?memoria|olvidalo todo)\b/.test(t)) {
      this.memory.forgetAll();
      this.journal.add("memory", "Memoria borrada por completo");
      return { text: "Listo, olvidé todo lo que tenía guardado." };
    }
    m = t.match(/^(?:olvida|borra|elimina)\s+(?:que\s+)?(.+)/);
    if (m && !/\b(recordatorio|tarea|rutina)/.test(m[1])) {
      const n = this.memory.forget(m[1]);
      this.journal.add("memory", "Dato olvidado");
      return { text: n ? `Hecho, olvidé ${n} ${n === 1 ? "dato" : "datos"}.` : "No encontré eso en mi memoria." };
    }

    // Recordar un dato
    m = text.match(/^(?:recuerda|anota|guarda|apunta)(?:\s+que|:)\s+(.+)/i);
    if (m) {
      const r = this.memory.remember(m[1]);
      if (r.ok) { this.journal.add("memory", "Dato guardado"); return { text: "Anotado, lo recordaré." }; }
      if (r.reason === "off") return { text: 'Mi memoria está apagada. Dime "activa tu memoria" y lo guardo.' };
      if (r.reason === "sensitive") return { text: "Eso parece una clave o un número de tarjeta, y esas cosas nunca las guardo." };
      if (r.reason === "full") return { text: "Mi memoria está llena. Dime qué olvidar para hacer espacio." };
      return { text: "¿Qué quieres que recuerde?" };
    }
    if (/^(que|qué)?\s*(recuerdas|sabes de mi|sabes sobre mi)\b/.test(t) || /^que recuerdas\b/.test(t)) {
      const topic = t.replace(/^que (recuerdas|sabes)( de| sobre)?( mi)?\s*/, "").trim();
      if (!this.memory.enabled && this.memory.facts().length === 0) return { text: 'No tengo nada guardado: mi memoria está apagada. Dime "activa tu memoria" si quieres.' };
      if (topic) {
        const found = this.memory.search(topic, 5);
        return { text: found.length ? `Esto recuerdo:\n${list(found.map((f) => redact(f.text)))}` : "No recuerdo nada de eso." };
      }
      const facts = this.memory.facts();
      return { text: facts.length ? `Esto es lo que me pediste recordar:\n${list(facts.map((f) => f.text))}` : "Aún no me has pedido recordar nada." };
    }
    if (/\b(exporta|descarga|dame)\b.*\b(memoria)\b/.test(t)) return { text: this.memory.exportText() };

    // Tareas
    if (/\b(que tengo programado|mis recordatorios|mis tareas|que tareas tienes|tareas programadas)\b/.test(t)) {
      const js = this.jobs.list().filter((j) => j.status === "active" || j.status === "paused");
      return { text: js.length ? `Tengo programado:\n${list(js.map((j, i) => `${i + 1}. ${j.title} — próxima: ${fmtWhen(j.nextRun)}${j.status === "paused" ? " (en pausa)" : ""}`))}` : "No tengo nada programado." };
    }
    m = t.match(/^cancela\s+(?:el |la |mi )?(?:recordatorio|tarea|rutina)?\s*(\d+)?$/);
    if (/^cancela (todo|todos|todas|todas las tareas|todos los recordatorios)\b/.test(t)) return { text: `Cancelé ${this.jobs.cancelAll()} tareas.` };
    if (m && m[1]) {
      const js = this.jobs.list().filter((j) => j.status === "active" || j.status === "paused");
      const j = js[Number(m[1]) - 1];
      return { text: j && this.jobs.cancel(j.id) ? `Cancelé: ${j.title}.` : "No encontré esa tarea." };
    }
    if (/\b(activa|pon|programa|instala)\b.*\b(mis )?rutinas\b/.test(t)) {
      const specs = routinesFor(this.professionProfile);
      const existing = new Set(this.jobs.list().map((j) => j.title));
      let added = 0;
      for (const s of specs) if (!existing.has(s.title) && !("error" in this.jobs.add(s))) added++;
      return { text: added ? `Programé ${added} rutinas para ${this.professionProfile.name.toLowerCase()}. Pídeme "qué tengo programado" para verlas.` : "Esas rutinas ya estaban programadas." };
    }
    const parsed = parseJobRequest(text, this.now());
    if (parsed) {
      const res = this.jobs.add(parsed.spec);
      if ("error" in res) return { text: res.error === "limit" ? "Ya tengo demasiadas tareas; cancela alguna primero." : "Esa hora ya pasó." };
      return { text: parsed.confirmation };
    }

    // Registro y novedades
    if (/\b(que paso mientras no estaba|novedades|que me perdi|pendientes nuevos)\b/.test(t)) {
      const un = this.jobs.unread();
      this.jobs.markAllRead();
      return { text: un.length ? `Mientras no estabas:\n${list(un.map((o) => o.text))}` : "No hay novedades." };
    }
    if (/\b(registro|bitacora)\b.*\b(hoy|del dia)\b|\bque hiciste hoy\b/.test(t)) {
      const e = this.journal.today();
      return { text: e.length ? this.journal.toText(e) : "Hoy aún no hay nada en el registro." };
    }
    return null;
  }

  // ── Para el asistente de IA ────────────────────────────────────────────────

  /**
   * Envuelve la pregunta con las instrucciones de su oficio y lo que Hocki recuerda.
   * Solo viaja lo mínimo: nunca todo el historial.
   */
  wrap(query: string): string {
    const first = this.turns === 0;
    const facts = this.memory.enabled ? this.memory.relevantFacts(query) : [];
    if (first) {
      return `${buildSystemPrompt({ profession: this.professionProfile, name: this.name, facts, now: new Date(this.now()) })}\n\nPregunta de la persona:\n${query}`;
    }
    return facts.length ? `(Recuerda: ${facts.join("; ")})\n\n${query}` : query;
  }

  /** Después de cada turno con el asistente: lo guarda (si hay memoria) y lo anota en el registro. */
  afterTurn(query: string, answer: string) {
    this.turns++;
    this.memory.record("user", query);
    this.memory.record("assistant", answer);
    this.journal.add("chat", "Conversación con el asistente");
    this.save();
  }

  /** Nueva conversación: se reinicia el contexto, no la memoria. */
  newConversation() { this.turns = 0; this.memory.startConversation(); this.save(); }

  // ── Segundo plano ──────────────────────────────────────────────────────────

  /** Llamar cada segundo: ejecuta lo que toca y devuelve lo nuevo para mostrar. */
  tick(): OutboxItem[] {
    const ran = this.jobs.tick();
    const fresh = this.jobs.unread();
    if (ran > 0) this.save();
    return fresh;
  }

  /** "Hocki fuera": todo se detiene. */
  stopAll() { this.jobs.pauseAll(); this.d.engine.kill("Detenido por la persona"); this.save(); }
  /** La persona vuelve a darle vía libre. */
  resumeAll() {
    this.d.engine.resume();
    for (const j of this.jobs.list()) if (j.status === "paused") this.jobs.resume(j.id);
    this.save();
  }
}
