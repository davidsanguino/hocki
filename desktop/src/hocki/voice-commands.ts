// Órdenes de voz de Hocki (texto ya transcrito → intención).
// El reconocimiento del habla lo hace cada plataforma; aquí solo se entiende la
// frase, igual en todos los sistemas. Funciona sin conexión.

export type VoiceIntent =
  | "stop"       // "Hocki fuera", "Detener Hocki": corta todo y se esconde
  | "wake"       // "Hola Hocki", "Oye Hocki"
  | "sleep"      // "Hocki a dormir": pasa a reposo
  | "summary"    // "Hocki, resumen del día"
  | "hide"       // "Hocki escóndete": se aparta sin detener nada
  | "show"       // "Hocki ven"
  | "where"      // "¿Dónde estás, Hocki?" → aparece la isla y responde "Acá estoy, jefe"
  | "open"       // "Abre Hocki", "Inicia Hocki": despliega la isla
  | "close"      // "Cierra Hocki": cierra la isla pero sigue escuchando para volver a abrirse
  | "walk"       // "Hocki, sal a pasear": se va al escritorio y pasea
  | "still"      // "Hocki, quédate quieto": deja de pasear
  | "home"       // "Hocki, vuelve a la isla"
  | "unknown";

export interface VoiceResult {
  intent: VoiceIntent;
  /** true si la frase nombraba a Hocki (o una variante cercana). */
  addressed: boolean;
}

/** Minúsculas, sin tildes ni signos, espacios simples. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cómo suelen transcribir los motores de voz el nombre. */
const NAME_ALIASES = new Set(["hocki", "hoki", "jocki", "joki", "hockey", "hoqui", "jockey", "hoky", "ocki", "oki", "joqui", "yoqui", "yoki", "jogui", "hoqui", "jokey", "jocky", "hocky", "yocki", "joky"]);

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

export function isName(token: string): boolean {
  return NAME_ALIASES.has(token) || distance(token, "hocki") <= 1;
}

/** La frase sin el nombre de Hocki ("Hocki, recuérdame…" → "recuérdame…"). */
export function stripName(raw: string): string {
  return raw
    .split(/\s+/)
    .filter((w) => !isName(normalize(w)) || normalize(w) === "")
    .join(" ")
    .replace(/^[\s,.:;¡!¿?-]+/, "")
    .trim();
}

const has = (t: string, ...phrases: string[]) => phrases.some((p) => t.includes(p));

/**
 * La parada es la orden más importante: se acepta en varias formas y, a
 * diferencia del resto, también si se dice sin nombrar a Hocki pero sí con
 * "fuera de aquí" / "para ya", porque equivocarse hacia el lado de parar es seguro.
 */
export function parseVoice(raw: string): VoiceResult {
  const t = normalize(raw);
  if (!t) return { intent: "unknown", addressed: false };
  const tokens = t.split(" ");
  const addressed = tokens.some(isName);

  // Sustituye cualquier variante del nombre por "hocki" para comparar frases.
  const s = tokens.map((w) => (isName(w) ? "hocki" : w)).join(" ");

  if (has(s, "hocki fuera", "fuera hocki", "detener hocki", "detente hocki", "hocki detente", "hocki detener",
    "para hocki", "hocki para", "hocki stop", "stop hocki", "hocki basta", "basta hocki", "cancela todo hocki")) {
    return { intent: "stop", addressed: true };
  }
  if (!addressed && has(s, "fuera de aqui", "para ya", "detente ya")) {
    return { intent: "stop", addressed: false };
  }
  if (!addressed) return { intent: "unknown", addressed: false };

  if (has(s, "donde estas", "donde andas", "donde te metiste", "donde te escondes")) return { intent: "where", addressed };
  if (has(s, "resumen del dia", "resumen de hoy", "como estuvo mi dia", "resume mi dia")) return { intent: "summary", addressed };
  if (has(s, "abre hocki", "abrir hocki", "hocki abre", "hocki abrete", "abrete hocki", "inicia hocki", "iniciar hocki",
    "hocki inicia", "hocki iniciate", "enciende hocki", "hocki enciende", "arranca hocki", "hocki arranca", "activate hocki", "hocki activate")) {
    return { intent: "open", addressed };
  }
  if (has(s, "cierra hocki", "cerrar hocki", "hocki cierra", "hocki cierrate", "cierrate hocki", "apaga hocki", "hocki apagate", "apagate hocki")) {
    return { intent: "close", addressed };
  }
  if (has(s, "quedate quieto", "hocki quieto", "quieto hocki", "no pasees", "deja de pasear", "dejar de pasear", "para de caminar", "no camines")) {
    return { intent: "still", addressed };
  }
  if (has(s, "a pasear", "hocki pasea", "pasea hocki", "hocki camina", "camina hocki", "al escritorio")) return { intent: "walk", addressed };
  if (has(s, "a la isla", "vuelve a la isla", "regresa a la isla", "hocki a casa", "vuelve a casa")) return { intent: "home", addressed };
  if (has(s, "a dormir", "reposo", "descansa", "duermete")) return { intent: "sleep", addressed };
  if (has(s, "escondete", "apartate", "quitate", "oculta")) return { intent: "hide", addressed };
  if (has(s, "hocki ven", "ven hocki", "aparece", "sal hocki", "hocki sal")) return { intent: "show", addressed };
  if (has(s, "hola hocki", "oye hocki", "hey hocki", "ey hocki", "hocki despierta", "despierta hocki", "buenos dias hocki")) {
    return { intent: "wake", addressed };
  }
  // Solo el nombre ("¡Hocki!") también lo despierta.
  if (tokens.length === 1) return { intent: "wake", addressed };
  return { intent: "unknown", addressed };
}

/** Frases que mostramos en ajustes, para que la persona sepa qué decir. */
export const VOICE_HELP: Record<Exclude<VoiceIntent, "unknown">, string[]> = {
  stop: ["Hocki fuera", "Detener Hocki"],
  wake: ["Hola Hocki", "Oye Hocki"],
  sleep: ["Hocki a dormir"],
  summary: ["Hocki, resumen del día"],
  hide: ["Hocki escóndete"],
  show: ["Hocki ven"],
  where: ["¿Dónde estás, Hocki?"],
  open: ["Abre Hocki", "Inicia Hocki"],
  close: ["Cierra Hocki"],
  walk: ["Hocki, sal a pasear"],
  still: ["Hocki, quédate quieto"],
  home: ["Hocki, vuelve a la isla"],
};
