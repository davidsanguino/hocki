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
import type { ActionRequest, Grants, Level, PermissionEngine } from "./permissions";
import { matchApp, type AppAutomation, type AppDef } from "./apps";
import { TOOLS, toolById, toolHelp, toolPrompt, type Tool } from "./tools";
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

export type OnboardStep = "name" | "job" | "done";

export interface BrainState {
  onboard?: OnboardStep;
  tool?: string;
  grants?: Grants;
  apps?: string[];
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
  /** Catálogo de apps y sus permisos; sin él, Hocki no abre aplicaciones. */
  apps?: AppAutomation;
  /** Abre de verdad una app ya autorizada (lo pone cada plataforma). */
  launch?: (app: AppDef) => void;
}

export const HELP_TEXT = [
  "Esto puedo hacer por ti, solo escríbemelo:",
  "• \"Soy abogada\" (o tu oficio): me adapto a tu trabajo. \"Activa mis rutinas\" programa recordatorios propios de tu oficio.",
  "• \"Activa tu memoria\", \"recuerda que…\", \"qué recuerdas\", \"olvida todo\".",
  "• \"Recuérdame llamar a mamá en 10 minutos\" o \"…mañana a las 8\" o \"cada 30 minutos\".",
  "• \"Qué tengo programado\", \"cancela todo\", \"qué pasó mientras no estaba\", \"registro de hoy\".",
  "• \"Sal a pasear\" / \"quédate quieto\" / \"vuelve a la isla\": me muevo por tu pantalla sin estorbar.",
  "• \"Escúchame siempre\": activo la voz. Dime \"Hocki, abre\", \"Hocki, cierra\" o \"Hocki fuera\".",
  "• \"Abre Photoshop\" (Word, Excel, Blender, AutoCAD…): abro tus programas con tu permiso. \"Ayúdame con Blender\": te escribo scripts, macros y guías.",
].join("\n");

/** Cosas que Hocki hace en pantalla; las ejecuta la isla al recibirlas. */
export type HockiAction = "walk" | "still" | "home" | "open" | "close" | "listen_on" | "listen_off" | "voice_next" | "voice_test";
export interface LocalReply { text: string; action?: HockiAction }

const HINT_AFTER = "\nSi quieres, dime «activa mis rutinas» para recordatorios de tu oficio y «activa tu memoria» para que recuerde lo que me pidas. «comandos» muestra todo.";
const list = (items: string[]) => items.map((x) => `• ${x}`).join("\n");
const fmtWhen = (t: number | null) => (t == null ? "—" : new Date(t).toLocaleString("es-CO", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }));

export class HockiBrain {
  profession: string = "general";
  name?: string;
  /** Primera vez: Hocki pregunta nombre y oficio. Quien ya tenía datos guardados no lo repite. */
  onboard: OnboardStep;
  private jobTries = 0;
  /** Herramienta con la que se está trabajando (Blender, Excel…): da contexto a la IA. */
  tool?: string;
  private pendingApp: string | null = null;
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
    this.onboard = saved?.onboard ?? (saved ? "done" : "name");
    this.tool = saved?.tool;
    if (saved?.grants) { deps.engine.grants.level = saved.grants.level; deps.engine.grants.kinds = { ...saved.grants.kinds }; }
    for (const id of saved?.apps ?? []) deps.apps?.grantApp(id);
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
    const s: BrainState = { onboard: this.onboard, tool: this.tool, grants: this.d.engine.grants, apps: this.d.apps?.grantedIds(), profession: this.profession, name: this.name, memory: this.memory.data, journal: this.journal.snapshot(), jobs: this.jobs.snapshot() };
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

  // ── Primera vez ────────────────────────────────────────────────────────────

  /** Lo primero que Hocki le dice a quien lo abre por primera vez; null si ya se conocen. */
  onboardingPrompt(): string | null {
    if (this.onboard === "done") return null;
    return this.onboard === "name"
      ? "¡Hola, soy Hocki, tu compañero! Para ayudarte mejor, ¿cómo te llamas? (Si prefieres, escribe «omitir».)"
      : `¿A qué te dedicas${this.name ? `, ${this.name}` : ""}? Dime tu profesión u oficio y me adapto a ti.`;
  }

  private onboard_(text: string, t: string): LocalReply | null {
    if (/^(omitir|saltar|luego|despues|no gracias|ahora no)\b/.test(t)) {
      this.onboard = "done";
      return { text: `Sin problema. Cuando quieras dime «soy abogada», «soy docente»… o escribe «comandos» para ver todo lo que puedo hacer.` };
    }
    // Una pregunta o una frase larga no es un nombre ni un oficio: se deja pasar al asistente y se omite la bienvenida.
    if (/\?/.test(text) || text.trim().split(/\s+/).length > 5) { this.onboard = "done"; return null; }
    if (this.onboard === "name") {
      const m = text.match(/^(?:me llamo|mi nombre es|soy|yo soy|llamame)?\s*([\p{L}][\p{L}'-]{1,24})/iu);
      const guess = matchProfession(text);
      if (guess && /^(soy|yo soy)\b/i.test(text.trim())) {
        // Contestó con su oficio en vez de su nombre: se anota y se pregunta el nombre luego.
        this.profession = guess.id;
        return { text: `¡Qué bien, ${guess.name.toLowerCase()}! ¿Y cómo te llamas?` };
      }
      if (!m) return { text: "No alcancé a entenderte. ¿Cómo te llamas? (o escribe «omitir»)" };
      this.name = m[1].charAt(0).toUpperCase() + m[1].slice(1);
      this.onboard = this.profession !== "general" ? "done" : "job";
      return this.onboard === "done"
        ? { text: `Mucho gusto, ${this.name}. ${this.professionProfile.hello ?? ""}`.trim() + HINT_AFTER }
        : { text: `Mucho gusto, ${this.name}. ${this.onboardingPrompt()}` };
    }
    // step "job"
    const p = matchProfession(text);
    if (p) {
      this.profession = p.id;
      this.onboard = "done";
      return { text: `¡Listo! Desde ahora te ayudo como ${p.name.toLowerCase()}. ${p.pitch} ${p.hello ?? ""}`.trim() + HINT_AFTER };
    }
    this.jobTries++;
    if (this.jobTries >= 2) {
      this.onboard = "done";
      return { text: "Por ahora te ayudo en general. Cuando quieras, dime «soy …» y tu profesión, y me adapto." + HINT_AFTER };
    }
    const ex = ["abogado", "médico", "docente", "contador", "ingeniero", "enfermera", "psicólogo", "policía", "estudiante", "emprendedor"];
    return { text: `No reconocí esa profesión todavía. Prueba con una como: ${ex.join(", ")}… o escribe «omitir».` };
  }

  private route(text: string, t: string): LocalReply | null {
    if (this.onboard !== "done") {
      const r = this.onboard_(text, t);
      if (r) return r;
    }
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

    const sys = this.systemRoute(t);
    if (sys) return sys;

    if (/\b(comandos|que sabes hacer|que puedo pedirte|como uso la memoria)\b/.test(t)) return { text: HELP_TEXT };

    // Cuerpo y voz de Hocki
    if (/\b(sal a pasear|ve a pasear|pasea|camina libre|ven al escritorio|sal al escritorio)\b/.test(t))
      return { text: "¡Voy a pasear! Me aparto cuando estés haciendo clic o escribiendo.", action: "walk" };
    if (/\b(quedate quieto|no pasees|deja de pasear|no camines)\b/.test(t)) return { text: "Me quedo quietecito aquí.", action: "still" };
    if (/\b(vuelve a la isla|regresa a la isla|a la isla)\b/.test(t)) return { text: "Vuelvo a la isla.", action: "home" };
    if (/\b(cambia (de|tu) voz|otra voz|prueba otra voz|voz diferente)\b/.test(t)) return { text: "Probando otra voz…", action: "voice_next" };
    if (/\b(prueba tu voz|habla para probar|di algo|hablame)\b/.test(t)) return { text: "¡Hola, jefe! Soy Hocki. ¿Qué tal suena mi voz?", action: "voice_test" };
    if (/\b(escuchame siempre|escucha siempre|activa (el )?micro(fono)?|activa la voz|activa tu oido)\b/.test(t))
      return { text: "Listo, te escucho. Dime «Hocki» antes de cada orden o pregunta. En Windows uso el reconocimiento de voz del propio sistema, sin internet; necesita el idioma español con voz instalado.", action: "listen_on" };
    if (/\b(deja de escuchar|desactiva (el )?micro(fono)?|apaga la voz|no me escuches)\b/.test(t))
      return { text: "Dejé de escuchar.", action: "listen_off" };

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


  // ── Permisos, apps y herramientas ──────────────────────────────────────────

  private static LEVELS: Array<[RegExp, Level, string]> = [
    [/\bapagado\b/, "off", "Quedo apagado: no hago nada sobre tus aplicaciones."],
    [/\bobservar\b/, "observe", "Solo observo."],
    [/\bsugerir\b/, "suggest", "Solo te sugiero; tú haces."],
    [/\bconfirmar\b/, "confirm", "Modo confirmar: hago lo que me pidas y siempre te pregunto antes de algo sensible."],
    [/\breposo\b/, "rest", "Modo reposo: solo hago lo que dejaste autorizado de antemano cuando el equipo está en reposo."],
  ];

  private matchTool(text: string): Tool | null {
    const t = normalize(text);
    let best: Tool | null = null, len = 0;
    for (const tool of TOOLS) {
      for (const n of [tool.name, tool.id, ...(tool.aliases ?? [])].map(normalize)) {
        const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (n.length > len && new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(t)) { best = tool; len = n.length; }
      }
    }
    return best;
  }

  private systemRoute(t: string): LocalReply | null {
    const apps = this.d.apps;

    // Nivel de permiso
    let m = t.match(/\b(nivel|modo)\b(.*)/);
    if (m && !/\b(pasear|quieto)\b/.test(t)) {
      for (const [re, level, msg] of HockiBrain.LEVELS) {
        if (re.test(m[2])) {
          this.d.engine.grants.level = level;
          if (level === "confirm" || level === "rest") this.d.engine.grants.kinds.open_app = true;
          return { text: msg };
        }
      }
    }
    if (/^(reactivate|reanuda|vuelve a trabajar|continua)$/.test(t)) { this.resumeAll(); return { text: "Listo, estoy de vuelta." }; }

    // Respuesta al "¿me das permiso para abrir X?"
    if (this.pendingApp && apps) {
      const app = apps.app(this.pendingApp);
      if (/^(si|dale|claro|ok|listo|de una|permiso concedido)$/.test(t) && app) {
        this.pendingApp = null;
        apps.grantApp(app.id);
        if (this.d.engine.grants.level === "off") this.d.engine.grants.level = "confirm";
        this.d.engine.grants.kinds.open_app = true;
        this.journal.add("approval", `Permiso para abrir ${app.name}`);
        return this.openApp(app);
      }
      if (/^(no|nunca|no gracias|cancela)$/.test(t)) { this.pendingApp = null; return { text: "Entendido, no la abro." }; }
    }
    m = t.match(/^(?:quita|retira|revoca)\s+(?:el )?permiso\s+(?:de |para |a )?(.+)/);
    if (m && apps) {
      const app = matchApp(m[1], apps.list());
      if (app) { apps.revokeApp(app.id); return { text: `Listo, ya no puedo abrir ${app.name}.` }; }
    }

    // Abrir una aplicación
    m = t.match(/^(?:por favor\s+)?(?:abre|abreme|abrir|inicia|lanza|ejecuta|open)\s+(.+)/);
    if (m && apps && !/\b(hocki|isla|chat|memoria)\b/.test(m[1])) {
      const app = matchApp(m[1], apps.list());
      if (!app) return null;
      if (!apps.isGranted(app.id)) {
        this.pendingApp = app.id;
        return { text: `Para abrir ${app.name} necesito tu permiso (solo para abrirla). ¿Me lo das? Responde «sí» o «no».` };
      }
      return this.openApp(app);
    }

    // Trabajar con una herramienta
    m = t.match(/^(?:salir de|dejar|deja|termina|terminar|ya no uso|cerrar modo)\s+(.+)/);
    if (m) {
      const tool = this.matchTool(m[1]);
      if (tool && this.tool === tool.id) { this.tool = undefined; return { text: `Salí del modo ${tool.name}. Sigo contigo en general.` }; }
    }
    m = t.match(/^modo\s+(.+)/);
    if (m) {
      const tool = this.matchTool(m[1]);
      if (tool) { this.tool = tool.id; return { text: toolHelp(tool) }; }
    }
    m = t.match(/(?:ayudame|ayudanos|ayuda|trabajemos|vamos a trabajar|usemos|modo|trabajo|estoy trabajando|que puedes hacer|que sabes hacer)\b.*\b(?:con|en|de)\s+(.+)/);
    if (m) {
      const tool = this.matchTool(m[1]);
      if (tool) {
        this.tool = tool.id;
        const hint = apps?.app(tool.id) && !apps.isGranted(tool.id) ? `\nSi quieres que la abra, dime «abre ${tool.name}».` : "";
        return { text: toolHelp(tool) + hint };
      }
    }
    return null;
  }

  private openApp(app: AppDef): LocalReply {
    const apps = this.d.apps;
    if (!apps) return { text: "Abrir aplicaciones no está disponible aquí." };
    const res = apps.open(app.id, "user", { resting: this.d.resting?.() ?? false });
    const d = res.decision;
    if (d.type === "deny") {
      if (/detenido/.test(d.reason)) return { text: "Estoy detenido. Escribe «reactívate» o dime «abre Hocki» para volver." };
      return { text: `No puedo abrir ${app.name}: ${d.reason}. Escribe «modo confirmar» para darme ese permiso.` };
    }
    if (d.type === "suggest_only") return { text: `Estoy en modo sugerir: abre ${app.name} tú. Escribe «modo confirmar» si quieres que lo haga yo.` };
    if (d.type === "ask") {
      if (d.needsBiometric) return { text: `${app.name} es sensible: ábrela tú. Yo no la toco sin tu verificación.` };
      // Lo que la persona acaba de pedir es la confirmación.
      const cid = this.d.engine.openConfirmation(res.request!, false);
      this.d.engine.approve(cid);
    }
    this.d.launch?.(app);
    this.journal.add("approval", `Abrí ${app.name}`);
    const help = toolById(app.id) ? ` Si quieres ayuda con ella, dime «ayúdame con ${app.name}».` : "";
    return { text: `Abriendo ${app.name}…${help}` };
  }

  // ── Para el asistente de IA ────────────────────────────────────────────────

  /**
   * Envuelve la pregunta con las instrucciones de su oficio y lo que Hocki recuerda.
   * Solo viaja lo mínimo: nunca todo el historial.
   */
  wrap(query: string): string {
    const first = this.turns === 0;
    const facts = this.memory.enabled ? this.memory.relevantFacts(query) : [];
    const tool = this.tool ? toolById(this.tool) : undefined;
    if (first) {
      const sys = buildSystemPrompt({ profession: this.professionProfile, name: this.name, facts, now: new Date(this.now()) });
      return `${sys}${tool ? `\n\n${toolPrompt(tool)}` : ""}\n\nPregunta de la persona:\n${query}`;
    }
    const ctx = [tool ? `Herramienta activa: ${tool.name} (${tool.scripting}). Responde con scripts completos y dónde ejecutarlos.` : "", facts.length ? `Recuerda: ${facts.join("; ")}` : ""].filter(Boolean).join(" ");
    return ctx ? `(${ctx})\n\n${query}` : query;
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
