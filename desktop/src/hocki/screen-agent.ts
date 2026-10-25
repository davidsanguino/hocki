// El ayudante de pantalla de Hocki: mira, piensa con la IA que TÚ elegiste y actúa, paso a paso.
//
//   1. Captura de la pantalla (Rust, screen_agent.rs).
//   2. La IA elegida en Ajustes (Claude, OpenAI, Gemini, OpenRouter, Ollama, LM Studio…) responde
//      con UNA acción en JSON.
//   3. Hocki la hace con el mouse o el teclado y vuelve a mirar.
//
// Frenos: solo dentro del programa que autorizaste, un máximo de pasos, «Hocki fuera» o «para»
// lo detienen al instante, y antes de borrar, enviar, publicar, comprar o sobrescribir pregunta.
// Nunca escribe contraseñas ni datos de tarjetas.

export type AgentActionKind = "click" | "double_click" | "right_click" | "type" | "keys" | "scroll" | "wait" | "done" | "ask";

export interface AgentAction {
  action: AgentActionKind;
  x?: number;
  y?: number;
  text?: string;
  keys?: string;
  amount?: number;
  /** Lo que la IA cree que hace, en una frase (se muestra en el chat). */
  thought?: string;
  /** La IA avisa de que es delicado. */
  delicate?: boolean;
}

export interface Snapshot { width: number; height: number; scale: number; left: number; top: number }

export interface AgentIO {
  snapshot(): Promise<Snapshot | null>;
  think(prompt: string): Promise<string>;
  input(kind: "click" | "double" | "right" | "scroll" | "keys", x: number, y: number, text: string): Promise<boolean>;
  /** Trae al frente el programa autorizado; false si no está abierto. */
  focus(): Promise<boolean>;
  /** Un mensaje para el chat (y la voz). */
  say(text: string): void;
  /** Pregunta sí/no a la persona; se resuelve con su respuesta. */
  confirm(question: string): Promise<boolean>;
  wait(ms: number): Promise<void>;
  forget(): void;
}

export const MAX_STEPS = 15;

/** Palabras que hacen delicado un paso, diga lo que diga la IA. */
const DELICATE = /\b(borr|elimin|suprim|envi[ao]|enviar|send|delete|remove|publi|post\b|compart|share|compr(a|ar|o|e)\b|pag(a|ar|o|ue)\b|buy|purchase|checkout|sobrescrib|overwrit|reemplaz|replace|formate|vaci[ao]|empty|desinstal|uninstall|cerrar sesion|sign out|log ?out)/i;
/** Cosas que Hocki jamás escribe por ti. */
const SECRET = /\b(contrasen|password|clave de|pin\b|cvv|numero de (la )?tarjeta|tarjeta de credito|tarjeta debito|card number|token|api key)/i;

export function isDelicate(a: AgentAction): boolean {
  if (a.delicate) return true;
  const t = `${a.thought ?? ""} ${a.text ?? ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return DELICATE.test(t);
}

export function wantsSecret(a: AgentAction): boolean {
  return a.action === "type" && SECRET.test((a.thought ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
}

/** Saca la acción del texto de la IA (acepta ```json …```, texto alrededor, comas finales). */
export function parseAction(reply: string): AgentAction | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw = reply.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1");
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(raw); } catch {
    raw = raw.replace(/'/g, '"');
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  const kinds: AgentActionKind[] = ["click", "double_click", "right_click", "type", "keys", "scroll", "wait", "done", "ask"];
  let action = String(obj.action ?? "").toLowerCase().replace(/[\s-]/g, "_") as AgentActionKind;
  if (action === ("doubleclick" as AgentActionKind)) action = "double_click";
  if (action === ("rightclick" as AgentActionKind)) action = "right_click";
  if (!kinds.includes(action)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : undefined);
  let x = num(obj.x), y = num(obj.y);
  // Algunos modelos responden "point": [x, y] o "coordinate": [x, y].
  const pair = (obj.point ?? obj.coordinate ?? obj.coordinates) as unknown;
  if ((x === undefined || y === undefined) && Array.isArray(pair) && pair.length >= 2) { x = num(pair[0]); y = num(pair[1]); }
  const a: AgentAction = { action };
  if (x !== undefined) a.x = x;
  if (y !== undefined) a.y = y;
  if (typeof obj.text === "string") a.text = obj.text;
  if (typeof obj.keys === "string") a.keys = obj.keys;
  const amount = num(obj.amount);
  if (amount !== undefined) a.amount = amount;
  if (typeof obj.thought === "string") a.thought = obj.thought.slice(0, 200);
  if (obj.delicate === true) a.delicate = true;
  if (["click", "double_click", "right_click"].includes(action) && (a.x === undefined || a.y === undefined)) return null;
  if (action === "type" && !a.text) return null;
  if (action === "keys" && !a.keys) return null;
  return a;
}

/** Teclas en lenguaje de la IA ("ctrl+s", "enter", "alt+f4") → formato SendKeys. Null si no se entiende. */
export function toSendKeys(combo: string): string | null {
  const NAMED: Record<string, string> = {
    enter: "{ENTER}", return: "{ENTER}", tab: "{TAB}", esc: "{ESC}", escape: "{ESC}", backspace: "{BACKSPACE}",
    delete: "{DELETE}", del: "{DELETE}", supr: "{DELETE}", up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}",
    home: "{HOME}", end: "{END}", pageup: "{PGUP}", pagedown: "{PGDN}", space: " ", espacio: " ", insert: "{INSERT}",
  };
  const parts = combo.toLowerCase().split(/\s*\+\s*/).filter(Boolean);
  if (!parts.length) return null;
  let mods = "";
  const key = parts.pop()!;
  for (const m of parts) {
    if (m === "ctrl" || m === "control") mods += "^";
    else if (m === "shift" || m === "mayus") mods += "+";
    else if (m === "alt") mods += "%";
    else return null; // la tecla Windows y otras no se mandan
  }
  let k: string;
  if (NAMED[key]) k = NAMED[key];
  else if (/^f([1-9]|1[0-2])$/.test(key)) k = `{${key.toUpperCase()}}`;
  else if (/^[a-z0-9]$/.test(key)) k = key;
  else if (/^[-=,.;/']$/.test(key)) k = key;
  else return null;
  // Alt+F4 cierra la ventana: se trata como delicado aparte (ver run()).
  return mods + k;
}

/** Escapa un texto para escribirlo tal cual con SendKeys. */
export function typeText(text: string): string {
  return text.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`).replace(/\r?\n/g, "{ENTER}");
}

export function buildPrompt(goal: string, appName: string, snap: Snapshot, history: string[], learned: string[], recipe?: { goal: string; steps: string[] }): string {
  return [
    "You are Hocki, a careful assistant that operates a Windows computer for the user, one step at a time.",
    `The user's task (in Spanish): "${goal}"`,
    `Work ONLY inside the program "${appName}". Do not open other programs, settings, browsers or files the task does not need.`,
    `The attached image is the current screen, ${snap.width}x${snap.height} pixels. Coordinates are pixels of THAT image, origin top-left.`,
    learned.length ? `Some buttons/menus this program has: ${learned.slice(0, 60).join(", ")}.` : "",
    recipe ? `You already did a similar task before ("${recipe.goal}") with these steps; reuse them if the screen matches:\n${recipe.steps.slice(0, 15).map((h, i) => `${i + 1}. ${h}`).join("\n")}` : "",
    history.length ? `Steps already done:\n${history.map((h, i) => `${i + 1}. ${h}`).join("\n")}` : "No steps done yet.",
    "Reply with ONLY one JSON object, no other text:",
    '{"thought": "<one short sentence in Spanish: what you see and why>", "action": "click|double_click|right_click|type|keys|scroll|wait|done|ask", "x": <int>, "y": <int>, "text": "<text to type, or the question/answer for ask/done>", "keys": "<e.g. ctrl+s, enter, alt+tab>", "amount": <scroll notches, negative = down>, "delicate": <true if this step deletes, sends, publishes, buys or overwrites something>}',
    "Rules: one action per reply. Click the center of the element. Use 'done' with a short Spanish summary when the task is finished. Use 'ask' with a Spanish question if you need information or the screen is unclear. Never type passwords, card numbers or secrets; ask instead. If the program is not visible, use 'ask'.",
  ].filter(Boolean).join("\n");
}

export interface RunResult { status: "done" | "asked" | "stopped" | "limit" | "error"; message: string; steps: number; history?: string[] }

/** Ejecuta la tarea paso a paso. `stopped()` se consulta antes de cada paso («Hocki fuera», «para»). */
export async function runAgent(
  goal: string,
  appName: string,
  io: AgentIO,
  opts: { stopped: () => boolean; learned?: string[]; maxSteps?: number; recipe?: { goal: string; steps: string[] } } = { stopped: () => false },
): Promise<RunResult> {
  const max = opts.maxSteps ?? MAX_STEPS;
  const history: string[] = [];
  let badReplies = 0;
  try {
    for (let step = 0; step < max; step++) {
      if (opts.stopped()) return { status: "stopped", message: "Me detuve.", steps: step };
      if (!(await io.focus())) return { status: "error", message: `${appName} no está abierta. Dime «abre ${appName}» y lo intento de nuevo.`, steps: step };
      const snap = await io.snapshot();
      if (!snap) return { status: "error", message: "No pude ver la pantalla.", steps: step };
      if (opts.stopped()) return { status: "stopped", message: "Me detuve.", steps: step };
      let reply: string;
      try {
        reply = await io.think(buildPrompt(goal, appName, snap, history, opts.learned ?? [], opts.recipe));
      } catch (e) {
        return { status: "error", message: `La IA no respondió: ${String(e).replace(/^Error:\s*/, "")}`, steps: step };
      }
      const a = parseAction(reply);
      if (!a) {
        if (++badReplies >= 2) {
          return { status: "error", message: "La IA que elegiste no me está dando pasos claros. Para ver la pantalla necesita un modelo con visión (por ejemplo Claude, GPT-4o, Gemini, o en Ollama qwen2.5vl / gemma3 / llava).", steps: step };
        }
        continue;
      }
      badReplies = 0;
      if (opts.stopped()) return { status: "stopped", message: "Me detuve.", steps: step };
      if (a.action === "done") return { status: "done", message: a.text || a.thought || "Listo.", steps: step, history };
      if (a.action === "ask") return { status: "asked", message: a.text || a.thought || "Necesito que me ayudes con algo.", steps: step };
      if (wantsSecret(a)) return { status: "asked", message: "Aquí hay que escribir una contraseña o un dato privado: eso lo haces tú. Avísame cuando sigamos.", steps: step };

      const keys = a.action === "keys" ? toSendKeys(a.keys!) : null;
      if (a.action === "keys" && !keys) { history.push(`(no pude usar las teclas ${a.keys})`); continue; }
      const closes = a.action === "keys" && /%\{F4\}|\^w$/i.test(keys ?? "");
      if (isDelicate(a) || closes) {
        const ok = await io.confirm(`Voy a hacer algo delicado: ${a.thought ?? a.action}. ¿Lo hago?`);
        if (!ok) return { status: "stopped", message: "Entendido, no lo hice y me detuve.", steps: step };
        if (opts.stopped()) return { status: "stopped", message: "Me detuve.", steps: step };
      }
      if (a.thought) io.say(`Paso ${step + 1}: ${a.thought}`);
      // De la imagen a la pantalla real.
      const sx = Math.round(snap.left + (a.x ?? 0) / snap.scale);
      const sy = Math.round(snap.top + (a.y ?? 0) / snap.scale);
      let ok = true;
      switch (a.action) {
        case "click": ok = await io.input("click", sx, sy, ""); break;
        case "double_click": ok = await io.input("double", sx, sy, ""); break;
        case "right_click": ok = await io.input("right", sx, sy, ""); break;
        case "type": ok = await io.input("keys", 0, 0, typeText(a.text!)); break;
        case "keys": ok = await io.input("keys", 0, 0, keys!); break;
        case "scroll": ok = await io.input("scroll", a.x !== undefined ? sx : snap.left + snap.width / snap.scale / 2, a.y !== undefined ? sy : snap.top + snap.height / snap.scale / 2, String(Math.max(-15, Math.min(15, Math.round(a.amount ?? -3))))); break;
        case "wait": break;
      }
      if (!ok) return { status: "error", message: "No pude mover el mouse o el teclado.", steps: step };
      history.push(`${a.action}${a.x !== undefined ? ` (${a.x},${a.y})` : ""}${a.text ? ` "${a.text.slice(0, 40)}"` : ""}${a.keys ? ` ${a.keys}` : ""} — ${a.thought ?? ""}`);
      await io.wait(a.action === "wait" ? 2000 : 900);
    }
    return { status: "limit", message: `Hice ${max} pasos y no terminé. Dime si sigo («continúa») o cómo lo hago.`, steps: max };
  } finally {
    io.forget();
  }
}

/** Quién lleva la tarea en curso: una a la vez, con su «¿lo hago?» pendiente y su freno. */
export class AgentController {
  private pendingAnswer: ((yes: boolean) => void) | null = null;
  private stopFlag = false;
  private running = false;
  private make: (app: { id: string; name: string }) => AgentIO;

  constructor(make: (app: { id: string; name: string }) => AgentIO) { this.make = make; }

  busy() { return this.running; }
  waiting() { return this.pendingAnswer !== null; }

  /** Empieza una tarea; false si ya hay otra en marcha. */
  start(app: { id: string; name: string }, goal: string, learned: string[], done: (r: RunResult) => void, recipe?: { goal: string; steps: string[] }): boolean {
    if (this.running) return false;
    this.running = true;
    this.stopFlag = false;
    const base = this.make(app);
    const io: AgentIO = {
      ...base,
      confirm: (q) => new Promise<boolean>((resolve) => {
        this.pendingAnswer = resolve;
        base.say(`${q} Responde «sí» o «no».`);
      }),
    };
    void runAgent(goal, app.name, io, { stopped: () => this.stopFlag, learned, recipe })
      .then(done, (e) => done({ status: "error", message: String(e), steps: 0 }))
      .finally(() => { this.running = false; this.pendingAnswer = null; });
    return true;
  }

  /** La respuesta al «¿lo hago?»; false si no había ninguna pregunta. */
  answer(yes: boolean): boolean {
    const r = this.pendingAnswer;
    if (!r) return false;
    this.pendingAnswer = null;
    r(yes);
    return true;
  }

  halt() {
    this.stopFlag = true;
    this.answer(false);
  }
}
