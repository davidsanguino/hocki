// Hocki pasea por toda la pantalla sin estorbar. Cada ~70 ms pregunta al sistema
// dónde está el cursor y si la persona está haciendo clic o escribiendo (solo el
// ritmo, nunca qué tecla), decide el siguiente paso con roaming.ts y mueve su
// ventanita. Su ventana deja pasar los clics salvo sobre su cuerpo, y cuando hay
// actividad se aparta a un rincón y se vuelve casi transparente.

import { ActivityTracker, DEFAULT_ROAM, nextWanderTarget, stepRoam, type RoamConfig, type RoamMode } from "./roaming";

/** Lo que entrega el sistema (píxeles físicos). */
export interface RoamSnapshot {
  cursor: [number, number];
  pos: [number, number];
  /** x, y, ancho, alto del área útil de la pantalla (sin barra de tareas). */
  work: [number, number, number, number];
  scale: number;
  pressed: boolean;
  typing: boolean;
}

export interface RoamIO {
  input(): Promise<RoamSnapshot | null>;
  moveTo(x: number, y: number): Promise<void>;
}

export interface RoamResult {
  mode: RoamMode;
  opacity: number;
  moved: boolean;
  /** Dirección del paso: -1 izquierda, 1 derecha, 0 quieto. */
  heading: number;
}

/** Lado de su ventana (px lógicos), igual que PANEL_SIZE. */
const WINDOW = 120;
/** Su cuerpo real ocupa poco de la ventana: así de grande cuenta para no estorbar. */
const BODY = 0.55;

export class DesktopRoamer {
  private io: RoamIO;
  private now: () => number;
  private rand: () => number;
  private tracker: ActivityTracker;
  private target: { x: number; y: number } | null = null;
  private pauseUntil = 0;
  private last = 0;
  private lastCursor: [number, number] | null = null;
  private busy = false;

  constructor(io: RoamIO, opts: { now?: () => number; rand?: () => number } = {}) {
    this.io = io;
    this.now = opts.now ?? (() => Date.now());
    this.rand = opts.rand ?? Math.random;
    this.tracker = new ActivityTracker(this.now);
  }

  /** Un paso. Devuelve null si ahora no le toca moverse (no está libre en el escritorio). */
  async tick(): Promise<RoamResult | null> {
    if (this.busy) return null; // la llamada anterior sigue en curso
    this.busy = true;
    try {
      const raw = await this.io.input();
      if (!raw) { this.last = 0; return null; }
      const t = this.now();
      const dt = this.last ? Math.min(0.12, Math.max(0.001, (t - this.last) / 1000)) : 0.07;
      this.last = t;

      const s = raw.scale || 1;
      const size = WINDOW * s * BODY;
      const cfg: RoamConfig = { ...DEFAULT_ROAM, size, cursorRadius: DEFAULT_ROAM.cursorRadius * s, margin: DEFAULT_ROAM.margin * s };
      const [wx, wy, ww, wh] = raw.work;
      // Su ventana es mayor que su cuerpo: se centra el cuerpo en ella.
      const inset = (WINDOW * s - size) / 2;
      const screen = { w: ww + 2 * inset, h: wh + 2 * inset };
      const pos = { x: raw.pos[0] - wx + inset, y: raw.pos[1] - wy + inset };
      const cursor = { x: raw.cursor[0] - wx + inset, y: raw.cursor[1] - wy + inset };

      // Actividad: clics y teclas = ocupado; solo mover el cursor no lo es.
      const moved = !this.lastCursor || Math.hypot(raw.cursor[0] - this.lastCursor[0], raw.cursor[1] - this.lastCursor[1]) > 2;
      this.lastCursor = raw.cursor;
      if (raw.pressed) this.tracker.note("click", cursor);
      else if (raw.typing) this.tracker.note("key", cursor);
      else if (moved) this.tracker.note("move", cursor);
      else this.tracker.cursor = cursor;

      if (!this.target && t >= this.pauseUntil) {
        this.target = nextWanderTarget(cursor, screen, [], this.rand, cfg);
      }
      const goal = this.target ?? pos;
      const frame = stepRoam(pos, goal, this.tracker, screen, dt, [], cfg);

      const dx = frame.pos.x - pos.x, dy = frame.pos.y - pos.y;
      const stepped = Math.hypot(dx, dy) > 0.5;
      if (stepped) await this.io.moveTo(Math.round(frame.pos.x - inset + wx), Math.round(frame.pos.y - inset + wy));

      // Llegó: se queda un rato quieto antes de volver a pasear.
      if (this.target && Math.hypot(this.target.x - frame.pos.x, this.target.y - frame.pos.y) < 2) {
        this.target = null;
        this.pauseUntil = t + 2500 + this.rand() * 6000;
      }
      // Si tuvo que apartarse por actividad, deja el destino y espera a que pase.
      if (frame.mode === "busy") { this.target = null; this.pauseUntil = t + 1500; }

      return { mode: frame.mode, opacity: frame.opacity, moved: stepped, heading: stepped ? Math.sign(dx) : 0 };
    } finally {
      this.busy = false;
    }
  }
}
