// Hocki pasea por toda la pantalla sin estorbar. Unas 30 veces por segundo pregunta al sistema
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
  /** Posición y velocidad propias (con decimales): la ventana solo recibe el redondeo. */
  private fpos: { x: number; y: number } | null = null;
  private vel = { x: 0, y: 0 };
  private retreatGoal: { x: number; y: number } | null = null;
  private retreatSince = 0;
  private heading = 0;

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
      const osPos = { x: raw.pos[0] - wx + inset, y: raw.pos[1] - wy + inset };
      // Su propia posición con decimales; si alguien lo movió (arrastre, otra pantalla), se resincroniza.
      if (!this.fpos || Math.hypot(osPos.x - this.fpos.x, osPos.y - this.fpos.y) > 6) { this.fpos = { ...osPos }; this.vel = { x: 0, y: 0 }; }
      const pos = this.fpos;
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
      const goalIn = this.target ?? pos;
      // El rincón elegido se mantiene al menos 1,2 s: así no titubea entre dos rincones.
      const prefer = this.retreatGoal && t - this.retreatSince < 1200 ? this.retreatGoal : this.retreatGoal ?? undefined;
      const frame = stepRoam(pos, goalIn, this.tracker, screen, dt, [], cfg, prefer);
      if (frame.retreating) {
        if (!this.retreatGoal || frame.goal.x !== this.retreatGoal.x || frame.goal.y !== this.retreatGoal.y) { this.retreatGoal = frame.goal; this.retreatSince = t; }
      } else this.retreatGoal = null;

      // Movimiento suave: acelera, frena al llegar y nunca da saltos.
      const gx = frame.goal.x - pos.x, gy = frame.goal.y - pos.y;
      const dist = Math.hypot(gx, gy);
      const arrive = Math.min(frame.speed, dist * 2.2);
      const want = dist > 0.5 ? { x: (gx / dist) * arrive, y: (gy / dist) * arrive } : { x: 0, y: 0 };
      const k = Math.min(1, dt * (frame.retreating ? 9 : 5));
      this.vel.x += (want.x - this.vel.x) * k;
      this.vel.y += (want.y - this.vel.y) * k;
      const m = cfg.margin;
      const nx = Math.max(m, Math.min(screen.w - cfg.size - m, pos.x + this.vel.x * dt));
      const ny = Math.max(m, Math.min(screen.h - cfg.size - m, pos.y + this.vel.y * dt));
      this.fpos = { x: nx, y: ny };
      const tx = Math.round(nx - inset + wx), ty = Math.round(ny - inset + wy);
      const stepped = tx !== raw.pos[0] || ty !== raw.pos[1];
      if (stepped) await this.io.moveTo(tx, ty);
      // Mira hacia donde camina, sin cambiar de lado por un temblor.
      if (Math.abs(this.vel.x) > 25) this.heading = Math.sign(this.vel.x);
      else if (Math.hypot(this.vel.x, this.vel.y) < 5) this.heading = 0;

      // Llegó: se queda un rato quieto antes de volver a pasear.
      if (this.target && Math.hypot(this.target.x - nx, this.target.y - ny) < 3) {
        this.target = null;
        this.pauseUntil = t + 2500 + this.rand() * 6000;
      }
      // Si tuvo que apartarse por actividad, deja el destino y espera a que pase.
      if (frame.mode === "busy") { this.target = null; this.pauseUntil = t + 1500; }

      return { mode: frame.mode, opacity: frame.opacity, moved: stepped, heading: this.heading };
    } finally {
      this.busy = false;
    }
  }
}
