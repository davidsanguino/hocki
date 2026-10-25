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
import { appNames, cleanProgramName, matchApp, type AppAutomation, type AppDef } from "./apps";
import { matchSkill, sendKeysText, skillsFor } from "./app-skills";
import { LEGAL_NOTICE, PRIVACY_NOTICE } from "./notices";
import { findInstalled, ingest, summarize, type InstalledApp, type Inventory } from "./installed";
import { domainNamed, expertContext, tipsText } from "./domains";
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
  /** Programas propios que le pediste abrir (nombre para buscarlos en el menú Inicio). */
  customs?: { id: string; name: string; find: string[] }[];
  /** Botones y menús que Hocki aprendió de cada programa (solo nombres). */
  learned?: Record<string, string[]>;
  /** Ya vio los avisos de privacidad y legal del control de programas. */
  noticesShown?: boolean;
  /** Aceptó que Hocki mire la pantalla y la envíe a la IA que eligió. */
  screenConsent?: boolean;
  /** Lo que tiene instalado (nombres y AppID) y si dio permiso para leerlo. */
  inventory?: Inventory;
  inventoryConsent?: boolean;
  scanOffered?: boolean;
  /** Tareas que salieron bien, para repetirlas más rápido. */
  recipes?: Recipe[];
  /** Atajos que le enseñaste: «cuando diga X, haz Y». */
  aliases?: Record<string, string>;
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
  launch?: (app: AppDef) => Promise<boolean> | void;
  /** Pide a una app que cierre sus ventanas (cuántas cerró). */
  close?: (app: AppDef) => Promise<number> | void;
  /** Avisa de algo que ocurre después de responder (por ejemplo: «no encontré ese programa»). */
  notify?: (text: string) => void;
  /** Maneja un programa: "keys" (atajo), "type" (texto), "click" (botón/menú) o "list" (aprender). */
  act?: (app: AppDef, action: AppAction, arg: string) => Promise<string[]> | void;
  agent?: AgentPort;
  /** Lee la lista de programas y apps del equipo (solo nombres). */
  scan?: () => Promise<InstalledApp[]>;
  /** Nombre de la IA elegida en Ajustes, para decir a dónde van las capturas. */
  aiName?: () => string;
}

export type AppAction = "keys" | "type" | "click" | "list";
interface PendingAct { appId: string; action: AppAction | "agent"; arg: string; label: string }

/** Cómo se hizo una tarea que salió bien: Hocki la reutiliza la próxima vez (aprende rápido). */
export interface Recipe { appId: string; goal: string; steps: string[]; at: number }

/** Parecido entre dos frases (palabras en común). */
export function similarity(a: string, b: string): number {
  const words = (x: string) => new Set(normalize(x).split(" ").filter((w) => w.length > 2));
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / Math.max(A.size, B.size);
}

/** El ayudante de pantalla (screen-agent.ts): mira, piensa con la IA elegida y actúa. */
export interface AgentPort {
  start(app: AppDef, goal: string, learned: string[], done: (r: { status: string; message: string; steps: number; history?: string[] }) => void, recipe?: Recipe): boolean;
  answer(yes: boolean): boolean;
  waiting(): boolean;
  busy(): boolean;
  halt(): void;
}

export const SCAN_OFFER = "¿Me dejas estudiar tu equipo? Leo solo la lista de programas y apps del menú Inicio (los que instalaste y los de fábrica) para poder ayudarte con cualquiera. No abro nada, no miro tus archivos y no sale de este equipo. Para actuar en cada programa te pediré permiso la primera vez. ¿Sí o no?";

export const HELP_TEXT = [
  "Esto puedo hacer por ti, solo escríbemelo:",
  "• \"Soy abogada\" (o tu oficio): me adapto a tu trabajo. \"Activa mis rutinas\" programa recordatorios propios de tu oficio.",
  "• \"Activa tu memoria\", \"recuerda que…\", \"qué recuerdas\", \"olvida todo\".",
  "• \"Recuérdame llamar a mamá en 10 minutos\" o \"…mañana a las 8\" o \"cada 30 minutos\".",
  "• \"Qué tengo programado\", \"cancela todo\", \"qué pasó mientras no estaba\", \"registro de hoy\".",
  "• \"Sal a pasear\" / \"quédate quieto\" / \"vuelve a la isla\": me muevo por tu pantalla sin estorbar.",
  "• \"Cuando diga modo diseño, abre Illustrator\": aprendo tus propios atajos. \"Qué atajos te enseñé\", \"olvida el atajo …\". \"Consejos de marketing\" (o diseño, video, Excel, 3D…).",
  "• Di «¡Hey Hocki!» y luego tu orden (o todo junto: «Hey Hocki, abre Word»). \"Voz más aguda/grave\", \"habla más rápido/despacio\", \"voz natural\" o \"voz de Windows\" cambian cómo hablo.",
  "• \"Registra mi voz\": aprendo cómo suena tu voz (con tu permiso y el del micrófono) y solo te obedezco a ti. \"Borra mi voz\" la elimina. \"Cambia de voz\" prueba otra voz mía.",
  "• \"Escúchame siempre\": activo la voz. Dime \"Hocki, abre\", \"Hocki, cierra\" o \"Hocki fuera\".",
  "• \"Estudia mi equipo\": aprendo qué programas y apps tienes. \"¿Qué programas tengo?\", \"¿tengo Blender?\".",
  "• \"En Illustrator, hazlo tú: exporta el logo en PNG\": miro la pantalla y lo hago paso a paso con la IA que elegiste (\"para\" me detiene).",
  "• \"Abre Photoshop\" / \"cierra Photoshop\" (Word, Excel, Blender, AutoCAD… o cualquier programa instalado): lo hago con tu permiso, programa por programa. \"Ayúdame con Blender\": te escribo scripts, macros y guías.",
].join("\n");

/** Cosas que Hocki hace en pantalla; las ejecuta la isla al recibirlas. */
export type HockiAction = "walk" | "still" | "home" | "open" | "close" | "listen_on" | "listen_off" | "voice_next" | "voice_test" | "voice_enroll" | "voice_forget" | "voice_gate_on" | "voice_gate_off"
  | "voice_higher" | "voice_lower" | "voice_faster" | "voice_slower" | "voice_natural" | "voice_system" | "voice_download";
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
  private pendingEnroll = false;
  private pendingAfter: "open" | "close" | "act" = "open";
  private pendingAct: PendingAct | null = null;
  private pendingDelicate: PendingAct | null = null;
  /** El programa con el que se está trabajando ahora (el último abierto o nombrado). */
  activeApp?: string;
  learned: Record<string, string[]> = {};
  private noticesShown = false;
  private screenConsent = false;
  inventory: Inventory | null = null;
  private inventoryConsent = false;
  private scanOffered = false;
  private pendingScan = false;
  recipes: Recipe[] = [];
  aliases: Record<string, string> = {};
  private pendingAsk: { onYes: () => string; onNo: () => string } | null = null;
  private scanning = false;
  /** Programa → AppID de Windows (para abrir también las apps de la Tienda). */
  private appIds = new Map<string, string>();
  private pendingScreen: PendingAct | null = null;
  private lastGoal: { appId: string; goal: string } | null = null;
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
    this.learned = saved?.learned ?? {};
    this.noticesShown = !!saved?.noticesShown;
    this.screenConsent = !!saved?.screenConsent;
    this.inventoryConsent = !!saved?.inventoryConsent;
    this.recipes = Array.isArray(saved?.recipes) ? saved!.recipes : [];
    this.aliases = saved?.aliases && typeof saved.aliases === "object" ? saved.aliases : {};
    this.scanOffered = !!saved?.scanOffered;
    if (saved?.inventory && Array.isArray(saved.inventory.apps)) {
      this.inventory = saved.inventory;
      if (deps.apps) ingest(this.inventory, deps.apps, this.appIds);
    }
    if (saved?.grants) { deps.engine.grants.level = saved.grants.level; deps.engine.grants.kinds = { ...saved.grants.kinds }; }
    for (const c of saved?.customs ?? []) deps.apps?.addCustom({ id: c.id, name: c.name, launch: {}, find: c.find });
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
    const s: BrainState = { onboard: this.onboard, tool: this.tool, grants: this.d.engine.grants, apps: this.d.apps?.grantedIds(), customs: this.d.apps?.list().filter((a) => a.custom && a.find && !a.id.startsWith("i-")).map((a) => ({ id: a.id, name: a.name, find: a.find! })), learned: this.learned, noticesShown: this.noticesShown, screenConsent: this.screenConsent, inventory: this.inventory ?? undefined, inventoryConsent: this.inventoryConsent, scanOffered: this.scanOffered, recipes: this.recipes, aliases: this.aliases, profession: this.profession, name: this.name, memory: this.memory.data, journal: this.journal.snapshot(), jobs: this.jobs.snapshot() };
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
    let t = normalize(text);
    if (!t) return null;
    // Un atajo que le enseñaste: se cambia por la orden completa.
    let said = text;
    const alias = this.aliases[t] ?? this.aliases[t.replace(/^(hey |oye )?hocki /, "")];
    if (alias) { said = alias; t = normalize(alias); }
    const r = this.route(said, t);
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
    // Una pregunta de sí/no que hizo la isla (descargas de voz, etc.)
    if (this.pendingAsk) {
      const a = this.pendingAsk;
      if (/^(si|dale|claro|ok|de una|acepto|hazlo|listo|descargalo|adelante)$/.test(t)) { this.pendingAsk = null; return { text: a.onYes() }; }
      if (/^(no|luego|ahora no|despues|no gracias|cancela)$/.test(t)) { this.pendingAsk = null; return { text: a.onNo() }; }
    }
    if (this.onboard !== "done") {
      const r = this.onboard_(text, t);
      if (r && (this.onboard as OnboardStep) === "done" && !this.inventoryConsent && !this.scanOffered && this.d.scan) {
        this.scanOffered = true;
        this.pendingScan = true;
        return { ...r, text: `${r.text}\n\n${SCAN_OFFER}` };
      }
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

    const learnR = this.learnRoute(text, t);
    if (learnR) return learnR;

    const inv = this.inventoryRoute(text, t);
    if (inv) return inv;

    const sys = this.systemRoute(t);
    if (sys) return sys;

    if (/\b(comandos|que sabes hacer|que puedo pedirte|como uso la memoria)\b/.test(t) && !/\b(sabes|puedes) hacer (en|con) /.test(t)) return { text: HELP_TEXT };
    if (/\b(aviso de privacidad|privacidad)\b/.test(t) && t.split(" ").length <= 5) return { text: PRIVACY_NOTICE };
    if (/\baviso legal\b/.test(t)) return { text: LEGAL_NOTICE };

    // Cuerpo y voz de Hocki
    if (/\b(sal a pasear|ve a pasear|pasea|camina libre|ven al escritorio|sal al escritorio)\b/.test(t))
      return { text: "¡Voy a pasear! Me aparto cuando estés haciendo clic o escribiendo.", action: "walk" };
    if (/\b(quedate quieto|no pasees|deja de pasear|no camines)\b/.test(t)) return { text: "Me quedo quietecito aquí.", action: "still" };
    if (/\b(vuelve a la isla|regresa a la isla|a la isla)\b/.test(t)) return { text: "Vuelvo a la isla.", action: "home" };
    if (/\b(cambia (de|tu) voz|otra voz|prueba otra voz|voz diferente)\b/.test(t)) return { text: "Probando otra voz…", action: "voice_next" };
    if (/\b(voz mas aguda|habla mas agudo|sube (el|tu) tono|mas agudo)\b/.test(t)) return { text: "Un poco más agudo.", action: "voice_higher" };
    if (/\b(voz mas grave|habla mas grave|baja (el|tu) tono|mas grave)\b/.test(t)) return { text: "Un poco más grave.", action: "voice_lower" };
    if (/\b(habla mas rapido|mas rapido al hablar|acelera (la|tu) voz)\b/.test(t)) return { text: "Hablo un poco más rápido.", action: "voice_faster" };
    if (/\b(habla mas (lento|despacio)|mas despacio al hablar)\b/.test(t)) return { text: "Hablo más despacio.", action: "voice_slower" };
    if (/\b(descarga|instala|baja)\b.*\b(tu voz|tu oido|la voz|el oido)\b/.test(t)) return { text: "Preparo mi oído y mi voz…", action: "voice_download" };
    if (/\b(voz natural|tu voz propia|usa tu voz|voz de hocki)\b/.test(t)) return { text: "Uso mi voz natural.", action: "voice_natural" };
    if (/\b(voz del sistema|voz de windows|voz normal)\b/.test(t)) return { text: "Uso la voz de Windows.", action: "voice_system" };
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
    const ctl = this.appControl(text, t);
    if (ctl) return ctl;
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

    // Registro de la voz: primero se pide el consentimiento
    if (this.pendingEnroll) {
      if (/^(si|dale|claro|ok|listo|empecemos|de una|empieza)$/.test(t)) { this.pendingEnroll = false; return { text: "Perfecto. Windows te va a pedir permiso para el micrófono: acéptalo.", action: "voice_enroll" }; }
      if (/^(no|nunca|no gracias|cancela|luego)$/.test(t)) { this.pendingEnroll = false; return { text: "Está bien, no guardo tu voz. Cuando quieras, dime «registra mi voz»." }; }
    }
    if (/\b(registra|guarda|aprende|recuerda|entrena|configura)\b.*\b(mi voz|voz)\b|\bprueba (inicial )?de voz\b|\breconoce(me)? (mi voz|por la voz)\b/.test(t) && !/\b(borra|olvida|elimina)\b/.test(t)) {
      this.pendingEnroll = true;
      return { text: "Para reconocer tu voz guardo una huella de números (nunca el audio) solo en este equipo; la borras cuando quieras con «borra mi voz». Te pediré decir unas 4 frases cortas. No es una seguridad fuerte: lo importante (pagos, claves) seguirá pidiendo tu verificación. ¿Empezamos? «sí» o «no»." };
    }
    if (/\b(borra|olvida|elimina|quita)\b.*\bmi voz\b/.test(t)) return { text: "Listo, borré tu huella de voz.", action: "voice_forget" };
    if (/\b(obedece(me)? (solo )?a (cualquiera|todos)|escucha a cualquiera|no importa quien hable)\b/.test(t)) return { text: "Entendido, te oigo a ti y a cualquiera.", action: "voice_gate_off" };
    if (/\b(obedece(me)? solo a mi|solo mi voz|solo a mi voz|solo me obedezcas a mi)\b/.test(t)) return { text: "Listo, solo obedezco a tu voz (si ya la registraste).", action: "voice_gate_on" };

    // Respuesta al "¿me das permiso para abrir/cerrar X?"
    if (this.pendingApp && apps) {
      const app = apps.app(this.pendingApp);
      if (/^(si|dale|claro|ok|listo|de una|permiso concedido)$/.test(t) && app) {
        this.pendingApp = null;
        apps.grantApp(app.id);
        if (this.d.engine.grants.level === "off") this.d.engine.grants.level = "confirm";
        this.d.engine.grants.kinds.open_app = true;
        this.journal.add("approval", `Permiso para abrir, cerrar y manejar ${app.name}`);
        const first = this.noticesShown ? "" : `\n\n${PRIVACY_NOTICE}\n\n${LEGAL_NOTICE}`;
        this.noticesShown = true;
        const r = this.pendingAfter === "close" ? this.closeApp(app)
          : this.pendingAfter === "act" && this.pendingAct ? this.runAct(app, this.pendingAct)
          : this.openApp(app);
        this.pendingAct = null;
        return { ...r, text: r.text + first };
      }
      if (/^(no|nunca|no gracias|cancela)$/.test(t)) { this.pendingApp = null; this.pendingAct = null; return { text: "Entendido, no toco esa app." }; }
    }
    m = t.match(/^(?:quita|retira|revoca)\s+(?:el )?permiso\s+(?:de |para |a )?(.+)/);
    if (m && apps) {
      const app = matchApp(m[1], apps.list());
      if (app) { apps.revokeApp(app.id); return { text: `Listo, ya no puedo abrir ${app.name}.` }; }
    }

    // Abrir o cerrar una aplicación
    m = t.match(/^(?:por favor\s+)?(?:abre|abreme|abrir|inicia|lanza|ejecuta|open)\s+(.+)/);
    const mc = m ? null : t.match(/^(?:por favor\s+)?(?:cierra|cierrame|cerrar|apaga|termina|close)\s+(.+)/);
    const target = (m ?? mc)?.[1];
    if (target && apps && !/\b(hocki|isla|chat|memoria|ventana|todo|sesion|conversacion|archivo|documento|carpeta|proyecto|imagen|correo|pestana)\b/.test(target)) {
      const app = matchApp(target, apps.list()) ?? this.customApp(target);
      if (!app) return null;
      const after = m ? "open" : "close";
      if (!apps.isGranted(app.id)) {
        this.pendingApp = app.id;
        this.pendingAfter = after;
        return { text: `Para ${after === "open" ? "abrir" : "cerrar"} ${app.name} necesito tu permiso, una sola vez: abrirla, cerrarla y manejarla por dentro cuando me lo pidas (antes de borrar, enviar o publicar te pregunto). ¿Me lo das? Responde «sí» o «no».` };
      }
      return after === "open" ? this.openApp(app) : this.closeApp(app);
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
        const inApp = apps?.app(tool.id);
        return { text: toolHelp(tool) + hint + (inApp ? `\n\n${this.skillsHelp(inApp)}` : "") };
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
    const launched = this.d.launch?.(app);
    if (launched && typeof (launched as Promise<boolean>).then === "function") {
      void (launched as Promise<boolean>).then((ok) => {
        if (!ok) { this.d.notify?.(`No encontré «${app.name}» instalado en este equipo (la busco en el menú Inicio). Dime cómo aparece ahí su nombre.`); return; }
        // La primera vez que se abre, Hocki aprende en silencio sus botones y menús.
        if (!this.learned[app.id] && this.d.act && typeof setTimeout === "function") {
          setTimeout(() => {
            const r = this.d.act?.(app, "list", "");
            if (r && typeof (r as Promise<string[]>).then === "function") {
              void (r as Promise<string[]>).then((lines) => {
                const names = (lines ?? []).filter((l) => l.startsWith("N:")).map((l) => l.slice(2)).slice(0, 200);
                if (names.length) { this.learned[app.id] = names; this.save(); }
              });
            }
          }, 9000);
        }
      });
    }
    this.journal.add("approval", `Abrí ${app.name}`);
    this.activeApp = app.id;
    const help = toolById(app.id) ? ` Si quieres ayuda con ella, dime «ayúdame con ${app.name}».` : "";
    return { text: `Abriendo ${app.name}…${help}` };
  }

  private closeApp(app: AppDef): LocalReply {
    const apps = this.d.apps;
    if (!apps) return { text: "Cerrar aplicaciones no está disponible aquí." };
    const res = apps.close(app.id, "user", { resting: this.d.resting?.() ?? false });
    const d = res.decision;
    if (d.type === "deny") {
      if (/detenido/.test(d.reason)) return { text: "Estoy detenido. Escribe «reactívate» para volver." };
      return { text: `No puedo cerrar ${app.name}: ${d.reason}. Escribe «modo confirmar» para darme ese permiso.` };
    }
    if (d.type === "suggest_only") return { text: `Estoy en modo sugerir: cierra ${app.name} tú. Escribe «modo confirmar» si quieres que lo haga yo.` };
    if (d.type === "ask") {
      if (d.needsBiometric) return { text: `${app.name} es sensible: ciérrala tú. Yo no la toco sin tu verificación.` };
      const cid = this.d.engine.openConfirmation(res.request!, false);
      this.d.engine.approve(cid);
    }
    const closed = this.d.close?.(app);
    if (closed && typeof (closed as Promise<number>).then === "function") {
      void (closed as Promise<number>).then((n) => {
        this.d.notify?.(n > 0
          ? `Le pedí a ${app.name} que se cierre. Si tenía algo sin guardar, te pregunta ahí mismo.`
          : `No veo ${app.name} abierta (o no pude cerrarla sin forzarla). No la fuerzo: ciérrala tú si hace falta.`);
      });
    }
    this.journal.add("approval", `Cerré ${app.name}`);
    if (this.activeApp === app.id) this.activeApp = undefined;
    return { text: `Cerrando ${app.name}…` };
  }

  // ── Manejar programas por dentro ──────────────────────────────────────────

  /**
   * "Guarda", "en Illustrator crea contornos", "haz clic en Archivo", "escribe: hola",
   * "aprende Word". Solo en programas con permiso; lo delicado se confirma antes.
   */
  private appControl(text: string, t: string): LocalReply | null {
    const apps = this.d.apps;
    if (!apps) return null;
    // Respuesta al "¿lo hago?" de algo delicado
    if (this.pendingDelicate) {
      const p = this.pendingDelicate;
      if (/^(si|dale|hazlo|confirmo|adelante|ok)$/.test(t)) {
        this.pendingDelicate = null;
        const app = apps.app(p.appId);
        return app ? this.exec(app, p) : null;
      }
      if (/^(no|cancela|mejor no|no lo hagas)$/.test(t)) { this.pendingDelicate = null; return { text: "Entendido, no lo hice." }; }
    }

    // El ayudante de pantalla: su «¿lo hago?», su freno y el permiso para mirar
    const agent = this.d.agent;
    if (agent?.waiting()) {
      if (/^(si|dale|hazlo|confirmo|adelante|ok)$/.test(t)) { agent.answer(true); return { text: "Sigo." }; }
      if (/^(no|cancela|mejor no|no lo hagas|para)$/.test(t)) { agent.answer(false); return { text: "Entendido, no lo hago." }; }
    }
    if (agent?.busy() && /^(para|detente|basta|alto|cancela la tarea|deja eso|stop)$/.test(t)) { agent.halt(); return { text: "Me detengo." }; }
    if (this.pendingScreen) {
      const p = this.pendingScreen;
      if (/^(si|dale|claro|ok|acepto|de una)$/.test(t)) {
        this.pendingScreen = null;
        this.screenConsent = true;
        const app = apps.app(p.appId);
        return app ? this.request(app, p) : null;
      }
      if (/^(no|cancela|mejor no)$/.test(t)) { this.pendingScreen = null; return { text: "Está bien, no miro la pantalla. Puedo seguir usando atajos y botones por su nombre." }; }
    }

    let cmd = t.replace(/^(?:(?:hocki|oye|por favor)[\s,]+)+/, "").replace(/(?:\s+(?:por favor|hocki))+$/, "").trim();
    let raw = text.replace(/^(?:(?:hocki|oye|por favor)[\s,]+)+/i, "").trim();
    // ¿Nombró el programa? ("en Illustrator, …", "… en Word")
    let app: AppDef | null = null;
    const named = matchApp(cmd, apps.list());
    if (named) {
      for (const n of appNames(named).sort((x, y) => y.length - x.length)) {
        const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`(^|\\s)(?:en|con|de|a) (?:el |la )?${esc}(?:[,:]|\\s|$)`);
        if (re.test(cmd)) {
          cmd = cmd.replace(re, " ").replace(/\s+/g, " ").trim();
          raw = raw.replace(new RegExp(`(^|\\s)(?:en|con|de|a) (?:el |la )?${esc}[,:]?`, "i"), " ").replace(/\s+/g, " ").trim();
          app = named;
          break;
        }
      }
    }
    // Una tarea entera: Hocki mira la pantalla y la hace paso a paso
    if (/^(continua|sigue|continua la tarea|sigue con la tarea)$/.test(cmd) && this.lastGoal) {
      const la = apps.app(this.lastGoal.appId);
      if (la) return this.startAgent(la, this.lastGoal.goal);
    }
    const am = raw.match(/^(?:h[aá]zlo t[uú]|t[uú] hazlo|enc[aá]rgate(?: de)?|haz por m[ií]|hazme el favor de|automatiza|haz la tarea)\s*:?\s+([\s\S]+)$/i);
    if (am) {
      if (!app && !this.activeApp) return { text: "¿En qué programa lo hago? Dime por ejemplo «en Illustrator, hazlo tú: exporta el logo en PNG»." };
      const target = app ?? apps.app(this.activeApp!) ?? null;
      if (target) return this.startAgent(target, am[1].trim());
    }

    // "aprende Word": el programa va justo detrás del verbo
    const lm = cmd.match(/^(aprende|estudia|explora|conoce|aprendete)(?: a usar)? (.+)$/);
    if (lm && !app && named && appNames(named).includes(lm[2].replace(/^(el|la) /, ""))) { app = named; cmd = lm[1]; }
    // Lo que sabe hacer en un programa
    if (app && /^(?:que (?:sabes|puedes) hacer|atajos|que atajos sabes)$/.test(cmd)) return { text: this.skillsHelp(app) };
    if (!app && this.activeApp) app = apps.app(this.activeApp) ?? null;

    // Aprender un programa (leer sus botones y menús)
    if (/^(?:aprende|estudia|explora|conoce|aprendete)(?: (?:a usar|este programa|esta app|el programa|la app))?$/.test(cmd) || /^que botones (?:hay|tiene)/.test(cmd)) {
      if (!app) return { text: "¿Qué programa aprendo? Dime por ejemplo «aprende Word» con el programa abierto." };
      return this.request(app, { appId: app.id, action: "list", arg: "", label: "aprender sus botones y menús" });
    }
    // Escribir texto
    let m = raw.match(/^(?:escribe|escribir|teclea|tipea)\s*:?\s+([\s\S]+)$/i);
    if (m) {
      if (!app) return { text: "¿En qué programa escribo? Dime por ejemplo «en Word escribe: hola»." };
      return this.request(app, { appId: app.id, action: "type", arg: sendKeysText(m[1].trim()), label: `escribir «${m[1].trim().slice(0, 40)}»` });
    }
    // Pulsar un botón o menú por su nombre
    m = raw.match(/^(?:haz cli(?:c|ck)|da(?:le)? cli(?:c|ck)|cli(?:c|ck)|pulsa|presiona|oprime|toca)\s+(?:en\s+)?(?:el |la |los |las )?(?:bot[oó]n |men[uú] |opci[oó]n |pesta[nñ]a )?(.+)$/i);
    if (m) {
      if (!app) return { text: "¿En qué programa? Dime por ejemplo «en Word haz clic en Insertar»." };
      const name = m[1].replace(/[.!¡¿?"«»]/g, "").trim();
      if (!name) return null;
      const delicate = /\b(eliminar|borrar|suprimir|enviar|publicar|compartir|pagar|comprar|reemplazar|sobrescribir|vaciar|formatear)\b/i.test(normalize(name));
      const p: PendingAct = { appId: app.id, action: "click", arg: name, label: `pulsar «${name}»` };
      return delicate ? this.askDelicate(app, p) : this.request(app, p);
    }
    // Un atajo conocido de ese programa
    if (!app) return null;
    const skill = cmd.split(" ").length <= 6 ? matchSkill(cmd, skillsFor(app.id)) : null;
    if (!skill) {
      // "En Illustrator, cambia el fondo a azul": con el programa nombrado, una orden larga es una tarea.
      const explicit = named && app.id === named.id;
      const question = /^(como|que|cual|cuales|por que|donde|cuando|quien|sabes|puedes)\b/.test(cmd) || /\?\s*$/.test(text);
      if (explicit && this.d.agent && !question && cmd.split(" ").length >= 3) return this.startAgent(app, raw);
      return null;
    }
    const p: PendingAct = { appId: app.id, action: "keys", arg: skill.keys, label: skill.label };
    return skill.delicate ? this.askDelicate(app, p) : this.request(app, p);
  }

  // ── Aprender rápido: atajos que le enseñas y consejos por campo ───────────

  private learnRoute(text: string, t: string): LocalReply | null {
    const m = text.match(/^(?:cuando|si)\s+(?:te\s+)?digas?\s+["«“']?([^"»”',:]+?)["»”']?\s*[,:]\s*(.+)$/i);
    if (m) {
      const trigger = normalize(m[1]);
      const action = m[2].trim().replace(/^(tu\s+|entonces\s+)/i, "");
      if (trigger.length < 2 || trigger.split(" ").length > 6) return { text: "Dime un atajo corto, por ejemplo: «cuando diga modo diseño, abre Illustrator»." };
      if (Object.keys(this.aliases).length >= 60) return { text: "Ya tengo muchos atajos; dime «olvida el atajo …» para hacer espacio." };
      this.aliases[trigger] = action;
      this.journal.add("memory", `Atajo aprendido: ${trigger}`);
      return { text: `¡Aprendido! Cuando digas «${m[1].trim()}» haré: ${action}` };
    }
    const f = t.match(/^olvida (?:el )?atajo (.+)$/);
    if (f) {
      const k = normalize(f[1]);
      if (this.aliases[k]) { delete this.aliases[k]; return { text: `Olvidé el atajo «${f[1]}».` }; }
      return { text: "No tenía ese atajo." };
    }
    if (/^(que|cuales) atajos (te ensene|sabes|tienes|conoces)/.test(t)) {
      const list = Object.entries(this.aliases);
      return { text: list.length ? `Atajos que me enseñaste:\n${list.map(([k, v]) => `• «${k}» → ${v}`).join("\n")}` : "Aún no me has enseñado atajos. Prueba: «cuando diga modo diseño, abre Illustrator»." };
    }
    const d = t.match(/^(?:que sabes de|consejos (?:de|para|sobre)|tips (?:de|para|sobre)|ensename (?:de|sobre)|dame consejos (?:de|para|sobre))\s+(.+)$/);
    if (d) {
      const dom = domainNamed(d[1]);
      if (dom) return { text: tipsText(dom) };
    }
    return null;
  }

  // ── Lo que tienes instalado ───────────────────────────────────────────────

  private inventoryRoute(text: string, t: string): LocalReply | null {
    if (!this.d.scan) return null;
    if (this.pendingScan) {
      if (/^(si|dale|claro|ok|de una|acepto|hazlo|listo)$/.test(t)) {
        this.pendingScan = false;
        this.inventoryConsent = true;
        void this.runScan(true);
        return { text: "Perfecto, estoy revisando tu equipo…" };
      }
      if (/^(no|luego|ahora no|despues|no gracias)$/.test(t)) {
        this.pendingScan = false;
        return { text: "Está bien. Cuando quieras dime «estudia mi equipo»." };
      }
    }
    if (/\b(estudia|revisa|escanea|aprende|analiza|conoce)\b.*\b(mi equipo|mi computador|mi pc|mi computadora|mis programas|mis apps|mis aplicaciones|lo que tengo instalado)\b/.test(t)) {
      if (!this.inventoryConsent) { this.pendingScan = true; return { text: SCAN_OFFER }; }
      void this.runScan(true);
      return { text: "Vuelvo a revisar tu equipo…" };
    }
    if (/\bque (programas|apps|aplicaciones) (tengo|hay|tienes)\b|\bmis programas instalados\b/.test(t)) {
      if (!this.inventory) { this.pendingScan = !this.inventoryConsent; return { text: this.inventoryConsent ? "Aún no termino de revisar tu equipo." : SCAN_OFFER }; }
      return { text: summarize(this.inventory) };
    }
    const m = text.match(/^(?:¿)?\s*(?:tengo|tienes|hay)\s+(?:instalad[oa]\s+)?(?:el |la |un |una )?(.+?)(?:\s+instalad[oa])?\s*\??$/i);
    if (m && this.inventory && m[1].split(/\s+/).length <= 3 && /\?|instalad/i.test(text) && !/^(que|una? (reunion|cita|pregunta|duda)|tiempo|hambre|sueno|frio|calor)/.test(normalize(m[1]))) {
      const found = findInstalled(this.inventory, m[1]);
      return { text: found ? `Sí, tienes ${found.name}. Dime «abre ${found.name}» cuando quieras.` : `No veo «${m[1]}» en tu equipo. Si lo instalaste hace poco, dime «estudia mi equipo».` };
    }
    return null;
  }

  private async runScan(tell: boolean): Promise<void> {
    if (this.scanning || !this.d.scan) return;
    this.scanning = true;
    try {
      const list = await this.d.scan();
      if (!list?.length) { if (tell) this.d.notify?.("No pude leer la lista de programas de este equipo (por ahora solo en Windows)."); return; }
      this.inventory = { at: this.now(), apps: list.slice(0, 800) };
      const added = this.d.apps ? ingest(this.inventory, this.d.apps, this.appIds) : 0;
      this.journal.add("system", `Revisé el equipo: ${list.length} programas`);
      this.save();
      if (tell) this.d.notify?.(`${summarize(this.inventory)}\n\nYa puedo abrir, cerrar y ayudarte con cualquiera${added ? ` (aprendí ${added} que no conocía)` : ""}. La primera vez que actúe en uno te pido permiso. Prueba «abre …», «en … hazlo tú: …» o «qué sabes hacer en …».`);
    } finally {
      this.scanning = false;
    }
  }

  /** La isla deja una pregunta de sí/no: la próxima respuesta «sí» o «no» la contesta. */
  ask(onYes: () => string, onNo: () => string) { this.pendingAsk = { onYes, onNo }; }

  /** Quien ya terminó la bienvenida antes de esta versión: la oferta de estudiar el equipo, una vez. */
  scanOfferOnce(): string | null {
    if (this.onboard !== "done" || this.inventoryConsent || this.scanOffered || !this.d.scan) return null;
    this.scanOffered = true;
    this.pendingScan = true;
    this.save();
    return SCAN_OFFER;
  }

  /** El AppID con que Windows abre ese programa (si lo vio al estudiar el equipo). */
  appIdOf(id: string): string | undefined { return this.appIds.get(id); }

  /** Pide permiso para mirar la pantalla (una vez) y para el programa (una vez), y arranca. */
  private startAgent(app: AppDef, goal: string): LocalReply {
    if (!this.d.agent) return { text: "Ver la pantalla no está disponible aquí." };
    const p: PendingAct = { appId: app.id, action: "agent", arg: goal.slice(0, 400), label: `tarea: ${goal.slice(0, 60)}` };
    if (!this.screenConsent) {
      this.pendingScreen = p;
      const ai = this.d.aiName?.() ?? "la IA que elegiste";
      return { text: `Para hacer tareas completas necesito mirar tu pantalla: tomo una captura en cada paso y se la envío a ${ai} (la IA que elegiste en Ajustes) para que decida qué hacer; luego la borro. Si usas un modelo local (Ollama, LM Studio) no sale de tu equipo; si es en la nube, sí viaja a ese servicio y puede costar créditos. Solo actúo dentro del programa que autorices y te pregunto antes de lo delicado. ¿Aceptas? «sí» o «no».` };
    }
    return this.request(app, p);
  }

  private skillsHelp(app: AppDef): string {
    const sk = skillsFor(app.id).map((k) => k.label);
    const learned = this.learned[app.id]?.length ? `\nAdemás aprendí ${this.learned[app.id].length} botones y menús: dime «haz clic en …».` : "\nDime «aprende " + app.name + "» con el programa abierto y leo sus botones y menús.";
    return `En ${app.name} sé hacer: ${sk.join(", ")}.\nTambién: «escribe: …» y «haz clic en …».${learned}`;
  }

  /** Lo delicado (borrar, enviar, publicar) se pregunta siempre, aunque haya permiso. */
  private askDelicate(app: AppDef, p: PendingAct): LocalReply {
    if (!this.d.apps?.isGranted(app.id)) return this.request(app, p);
    this.pendingDelicate = p;
    return { text: `Eso es delicado (${p.label} en ${app.name}). ¿Lo hago? Responde «sí» o «no».` };
  }

  /** Pide el permiso (una sola vez por programa) o lo hace. */
  private request(app: AppDef, p: PendingAct): LocalReply {
    if (!this.d.apps!.isGranted(app.id)) {
      this.pendingApp = app.id;
      this.pendingAfter = "act";
      this.pendingAct = p;
      return { text: `Para manejar ${app.name} necesito tu permiso, una sola vez: abrirla, cerrarla y usarla cuando me lo pidas (antes de borrar, enviar o publicar te pregunto; pagos y contraseñas nunca). ¿Me lo das? Responde «sí» o «no».` };
    }
    return this.runAct(app, p);
  }

  private runAct(app: AppDef, p: PendingAct): LocalReply {
    const res = this.d.apps!.use(app.id, p.label, "user", { resting: this.d.resting?.() ?? false });
    const d = res.decision;
    if (d.type === "deny") {
      if (/detenido/.test(d.reason)) return { text: "Estoy detenido. Escribe «reactívate» para volver." };
      return { text: `No puedo hacerlo en ${app.name}: ${d.reason}.` };
    }
    if (d.type === "suggest_only") return { text: `Estoy en modo sugerir: hazlo tú (${p.label}). Escribe «modo confirmar» si quieres que lo haga yo.` };
    if (d.type === "ask") {
      if (d.needsBiometric) return { text: `${app.name} es sensible (dinero o claves): ahí no actúo.` };
      const cid = this.d.engine.openConfirmation(res.request!, false);
      this.d.engine.approve(cid);
    }
    return this.exec(app, p);
  }

  private exec(app: AppDef, p: PendingAct): LocalReply {
    this.activeApp = app.id;
    this.journal.add("approval", `${app.name}: ${p.label}`);
    if (p.action === "agent") {
      const agent = this.d.agent;
      if (!agent) return { text: "Ver la pantalla no está disponible aquí." };
      this.lastGoal = { appId: app.id, goal: p.arg };
      const recipe = this.recipes
        .filter((x) => x.appId === app.id)
        .map((x) => ({ x, s: similarity(x.goal, p.arg) }))
        .filter((c) => c.s >= 0.5)
        .sort((a, b) => b.s - a.s)[0]?.x;
      const ok = agent.start(app, p.arg, this.learned[app.id] ?? [], (r) => {
        this.journal.add("approval", `${app.name}: tarea ${r.status} (${r.steps} pasos)`);
        // Lo que salió bien queda aprendido para la próxima vez.
        if (r.status === "done" && r.history?.length) {
          this.recipes = this.recipes.filter((x) => !(x.appId === app.id && similarity(x.goal, p.arg) >= 0.8));
          this.recipes.push({ appId: app.id, goal: p.arg, steps: r.history.slice(0, 20), at: this.now() });
          if (this.recipes.length > 80) this.recipes.splice(0, this.recipes.length - 80);
        }
        this.save();
        this.d.notify?.(r.message + (recipe && r.status === "done" ? " (lo hice como la vez pasada)" : ""));
      }, recipe);
      if (!ok) return { text: "Ya estoy haciendo otra tarea. Dime «para» si quieres que la deje." };
      return { text: `Voy con eso en ${app.name}: miro la pantalla y lo hago paso a paso (máximo 15). Di «para» o «Hocki fuera» para detenerme.` };
    }
    const out = this.d.act?.(app, p.action as AppAction, p.arg);
    if (out && typeof (out as Promise<string[]>).then === "function") {
      void (out as Promise<string[]>).then((lines) => this.afterAct(app, p, lines ?? []));
    }
    if (p.action === "list") return { text: `Estoy leyendo los botones y menús de ${app.name}…` };
    if (p.action === "click") return { text: `Busco «${p.arg}» en ${app.name}…` };
    return { text: `Listo: ${p.label} en ${app.name}.` };
  }

  private afterAct(app: AppDef, p: PendingAct, lines: string[]) {
    const err = lines.find((l) => l.startsWith("ERR:"))?.slice(4);
    const say = (x: string) => this.d.notify?.(x);
    if (err === "not-running") return say(`${app.name} no está abierta. Dime «abre ${app.name}» y lo intento de nuevo.`);
    if (err === "unsupported") return say("Manejar programas por dentro solo está disponible en Windows por ahora.");
    if (err === "not-found") {
      const known = this.learned[app.id]?.filter((n) => normalize(n).includes(normalize(p.arg).split(" ")[0])).slice(0, 5) ?? [];
      return say(`No encontré «${p.arg}» en ${app.name}.${known.length ? ` ¿Quisiste decir: ${known.join(", ")}?` : " Dime «aprende " + app.name + "» y te digo qué botones veo."}`);
    }
    if (err === "no-action") return say(`Encontré «${p.arg}», pero no se deja pulsar desde la accesibilidad de Windows. Prueba con su atajo de teclado.`);
    if (err) return say(`No pude hacerlo en ${app.name}.`);
    if (p.action === "list") {
      const names = lines.filter((l) => l.startsWith("N:")).map((l) => l.slice(2)).slice(0, 200);
      if (!names.length) return say(`${app.name} no me muestra sus botones (algunos programas, como varios de Adobe, los ocultan a la accesibilidad). Igual puedo usar sus atajos: dime «qué sabes hacer en ${app.name}».`);
      this.learned[app.id] = names;
      const keys = Object.keys(this.learned);
      if (keys.length > 40) delete this.learned[keys[0]];
      this.save();
      return say(`Aprendí ${names.length} botones y menús de ${app.name}, por ejemplo: ${names.slice(0, 12).join(", ")}. Dime «haz clic en …» cuando quieras.`);
    }
    if (p.action === "click") {
      const done = lines.find((l) => l.startsWith("OK:"))?.slice(3);
      return say(`Pulsé «${done ?? p.arg}» en ${app.name}.`);
    }
  }

  /** Un programa instalado que no está en el catálogo: se busca en el menú Inicio por su nombre. */
  private customApp(raw: string): AppDef | null {
    const apps = this.d.apps;
    if (!apps || apps.mode !== "any") return null;
    const name = cleanProgramName(raw.replace(/^(?:(?:el|la|los|las|mi|un|una|programa|aplicacion|app|de|del)\s+)+/, ""));
    if (!name) return null;
    // ¿Es uno de los que tienes instalados? Entonces se usa su nombre real.
    const inst = findInstalled(this.inventory, name);
    if (inst) {
      const known = apps.list().find((a) => a.name === inst.name);
      if (known) return known;
    }
    const id = "x-" + name.replace(/[^a-z0-9]+/g, "-");
    const shown = name.replace(/\b\w/g, (c) => c.toUpperCase());
    apps.addCustom({ id, name: shown, launch: {}, find: name.split(" ") });
    return apps.app(id) ?? null;
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
      const exp = expertContext(query);
      return `${sys}${tool ? `\n\n${toolPrompt(tool)}` : ""}${exp ? `\n\n${exp}` : ""}\n\nPregunta de la persona:\n${query}`;
    }
    const ctx = [tool ? `Herramienta activa: ${tool.name} (${tool.scripting}). Responde con scripts completos y dónde ejecutarlos.` : "", facts.length ? `Recuerda: ${facts.join("; ")}` : "", expertContext(query)].filter(Boolean).join(" ");
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
    if (this.inventoryConsent && this.d.scan && !this.scanning && (!this.inventory || this.now() - this.inventory.at > 7 * 86_400_000)) void this.runScan(false);
    const ran = this.jobs.tick();
    const fresh = this.jobs.unread();
    if (ran > 0) this.save();
    return fresh;
  }

  /** "Hocki fuera": todo se detiene. */
  stopAll() { this.d.agent?.halt(); this.jobs.pauseAll(); this.d.engine.kill("Detenido por la persona"); this.save(); }
  /** La persona vuelve a darle vía libre. */
  resumeAll() {
    this.d.engine.resume();
    for (const j of this.jobs.list()) if (j.status === "paused") this.jobs.resume(j.id);
    this.save();
  }
}
