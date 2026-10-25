// Hocki se pasea por la pantalla sin estorbar.
// Observa solo el RITMO de actividad (cuándo hay clics, teclas, desplazamiento y
// dónde está el cursor), nunca qué teclas se pulsan. Si la persona está
// escribiendo o haciendo clic, Hocki se aparta, se vuelve casi transparente y
// deja pasar los clics; si hay calma, pasea.

export type ActivityKind = "move" | "click" | "key" | "scroll";

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export type RoamMode = "busy" | "calm" | "idle";

export interface RoamConfig {
  /** Tamaño de Hocki en pantalla (px). */
  size: number;
  /** Radio alrededor del cursor que Hocki no pisa. */
  cursorRadius: number;
  /** ms desde la última tecla/clic para considerar que la persona está ocupada. */
  busyMs: number;
  /** ms sin ninguna actividad para pasar a "reposo". */
  idleMs: number;
  /** Margen con los bordes de la pantalla. */
  margin: number;
}

export const DEFAULT_ROAM: RoamConfig = { size: 96, cursorRadius: 170, busyMs: 1500, idleMs: 60_000, margin: 12 };

export interface RoamFrame {
  mode: RoamMode;
  /** Posición de la esquina superior izquierda de Hocki. */
  pos: Point;
  opacity: number;
  /** Los clics atraviesan a Hocki (nunca roba una selección). */
  clickThrough: boolean;
  /** A dónde va de verdad (el destino, o el rincón al que se aparta) y a qué velocidad máxima. */
  goal: Point;
  speed: number;
  /** True si se está apartando (rincón) en vez de pasear. */
  retreating: boolean;
}

export class ActivityTracker {
  private lastAny = 0;
  private lastInput = 0; // clic, tecla o scroll
  cursor: Point = { x: 0, y: 0 };

  private now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
    this.lastAny = this.lastInput = this.now();
  }

  note(kind: ActivityKind, at?: Point) {
    const t = this.now();
    this.lastAny = t;
    if (kind !== "move") this.lastInput = t;
    if (at) this.cursor = at;
  }

  mode(cfg: RoamConfig = DEFAULT_ROAM): RoamMode {
    const t = this.now();
    if (t - this.lastInput < cfg.busyMs) return "busy";
    if (t - this.lastAny > cfg.idleMs) return "idle";
    return "calm";
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** ¿Hocki, colocado en `pos`, tocaría el cursor o alguna zona a respetar? */
export function collides(pos: Point, cursor: Point, avoid: Rect[], cfg: RoamConfig = DEFAULT_ROAM): boolean {
  const center = { x: pos.x + cfg.size / 2, y: pos.y + cfg.size / 2 };
  if (Math.hypot(center.x - cursor.x, center.y - cursor.y) < cfg.cursorRadius) return true;
  const box: Rect = { x: pos.x, y: pos.y, w: cfg.size, h: cfg.size };
  return avoid.some((r) => !(box.x + box.w < r.x || r.x + r.w < box.x || box.y + box.h < r.y || r.y + r.h < box.y));
}

/** Rincones donde Hocki casi nunca estorba. */
export function corners(screen: { w: number; h: number }, cfg: RoamConfig = DEFAULT_ROAM): Point[] {
  const m = cfg.margin, s = cfg.size;
  return [
    { x: screen.w - s - m, y: screen.h - s - m },
    { x: m, y: screen.h - s - m },
    { x: screen.w - s - m, y: m },
    { x: m, y: m },
  ];
}

/** El rincón libre más lejano al cursor (y fuera de las zonas a respetar). */
export function retreatSpot(
  cursor: Point, screen: { w: number; h: number }, avoid: Rect[] = [], cfg: RoamConfig = DEFAULT_ROAM,
): Point {
  const cands = corners(screen, cfg).filter((c) => !collides(c, cursor, avoid, cfg));
  const pool = cands.length ? cands : corners(screen, cfg);
  return pool.reduce((best, c) => {
    const d = Math.hypot(c.x - cursor.x, c.y - cursor.y);
    const bd = Math.hypot(best.x - cursor.x, best.y - cursor.y);
    return d > bd ? c : best;
  });
}

/** Siguiente destino de paseo: aleatorio dentro de la pantalla, lejos del cursor. */
export function nextWanderTarget(
  cursor: Point, screen: { w: number; h: number }, avoid: Rect[] = [],
  rand: () => number = Math.random, cfg: RoamConfig = DEFAULT_ROAM,
): Point {
  const maxX = screen.w - cfg.size - cfg.margin;
  const maxY = screen.h - cfg.size - cfg.margin;
  for (let i = 0; i < 24; i++) {
    const p = { x: cfg.margin + rand() * (maxX - cfg.margin), y: cfg.margin + rand() * (maxY - cfg.margin) };
    if (!collides(p, cursor, avoid, cfg)) return p;
  }
  return retreatSpot(cursor, screen, avoid, cfg);
}

/**
 * Un paso de animación. `target` es a dónde quiere ir; la función lo ajusta según
 * la actividad y devuelve posición, opacidad y si deja pasar los clics.
 */
export function stepRoam(
  prev: Point, target: Point, tracker: ActivityTracker, screen: { w: number; h: number },
  dt: number, avoid: Rect[] = [], cfg: RoamConfig = DEFAULT_ROAM,
  /** El rincón al que ya se estaba apartando: se mantiene si sigue libre (no titubea entre rincones). */
  prefer?: Point,
): RoamFrame {
  const mode = tracker.mode(cfg);
  const retreat = () => (prefer && !collides(prefer, tracker.cursor, avoid, cfg) ? prefer : retreatSpot(tracker.cursor, screen, avoid, cfg));
  let goal = target;
  let retreating = false;
  let speed = 140; // px/s en paseo
  let opacity = 1;

  if (mode === "busy") {
    // La persona trabaja: se aparta rápido a un rincón y se vuelve casi invisible.
    goal = retreat();
    retreating = true;
    speed = 420;
    opacity = 0.35;
  } else if (mode === "idle") {
    speed = 60;
  } else if (collides(target, tracker.cursor, avoid, cfg)) {
    goal = retreat();
    retreating = true;
    speed = 300;
  }

  // Aunque ahora esté quieto, si el cursor se acerca a donde está, se corre.
  if (collides(prev, tracker.cursor, avoid, cfg) && mode !== "busy") {
    goal = retreat();
    retreating = true;
    speed = 360;
  }

  const dx = goal.x - prev.x, dy = goal.y - prev.y;
  const dist = Math.hypot(dx, dy);
  const step = Math.min(dist, speed * dt);
  const pos = dist < 0.5 ? { ...goal } : { x: prev.x + (dx / dist) * step, y: prev.y + (dy / dist) * step };
  pos.x = clamp(pos.x, cfg.margin, screen.w - cfg.size - cfg.margin);
  pos.y = clamp(pos.y, cfg.margin, screen.h - cfg.size - cfg.margin);

  return { mode, pos, opacity, clickThrough: mode === "busy", goal, speed, retreating };
}
