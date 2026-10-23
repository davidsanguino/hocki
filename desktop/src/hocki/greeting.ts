// La animación de inicio de Hocki: sale del notch, cruza trotando con las
// orejas al viento, resopla, se sienta y saluda con "¡Hola, soy Hocki!".
// Todo se dibuja en el mismo espacio de referencia de 640×150 de siempre.
// El cerdito es el mismo BotEngine que usa la isla, así que orejas, hocico, cola
// y parpadeo son idénticos a los del Hocki de todos los días.

import { closeCurve } from "../core/anim";
import { Sound } from "../core/sound";
import { COMPACT_W, NOTCH_H, NOTCH_W } from "../core/layout";
import { BotEngine, newHockiEngine } from "./engine";

// ── Timing (segundos) ─────────────────────────────────────────────────────────

const T = {
  drop0: 0.2,     // aparece en el notch
  land: 0.6,      // toca el suelo
  trot0: 0.95,    // empieza a trotar hacia la izquierda
  turn0: 1.62,    // llega al borde y da la vuelta
  trot1: 1.74,    // trota hacia la derecha
  brake0: 2.5,    // frena
  snort: 2.95,    // resopla
  sit0: 3.1,      // se sienta
  sit1: 3.32,
  text0: 3.15,    // aparece el texto
  end: 4.6,
  autoLeave: 4.9,
  COLLAPSE: 0.34,
};

export const GREETING_END = T.end;
export const GREETING_TEXT = "¡Hola, soy Hocki!";

/** The greeting's own sound, played from the start (greeting.wav, the Mac's file). */
const GREETING_SOUND = "greeting";

// ── Geometry (640×150) ────────────────────────────────────────────────────────

export const GREETING_W = 640;
export const GREETING_H = 150;
const C0 = { x: 320, y: 90 };
const HB = 58;
export const ASP = 1.34;
const EAR_X = 40;
const EAR_HB = 17;
const CARD = { x: 10, y: 36, w: 620, h: 104 };
const CARD_R = 20;

const X_LEFT = 120;
const X_RIGHT = 520;
const X_SIT = 215;
/** Lado del lienzo con el que se dibuja el BotEngine: su cuerpo mide ≈58.8 de alto, igual que HB. */
const ENGINE_BOX = 100;
const ENGINE_BODY_H = ENGINE_BOX * 0.3 * 0.98 * 2;

/** IslandRestingLayout for the compact island the greeting lands in. */
const COMPACT = {
  width: COMPACT_W,
  height: NOTCH_H,
  botDiameter: Math.min(20, Math.max(0, NOTCH_H - 6)),
  botCenterY: NOTCH_H / 2,
  miniGridScale: Math.min(1, Math.max(0, NOTCH_H - 4) / 28),
  miniGridCenterX: COMPACT_W - 40,
};

// ── Easing ────────────────────────────────────────────────────────────────────

const E = {
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  easeIn: (t: number) => t * t * t,
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);

// ── Pose ──────────────────────────────────────────────────────────────────────

export interface Pose {
  /** Alto del cuerpo, x/y centro, escala y inclinación. */
  hb: number; x: number; y: number; sx: number; sy: number; tilt: number;
  eye: "dot" | "happy";
  /** 0..1: cuánto está trotando (patitas y orejas al viento). */
  gait: number;
  /** Fase del trote (rad). */
  phase: number;
  /** Segundos desde el resoplido (−1 si aún no). */
  snort: number;
  halo: number; minis: number; fx: number;
  card: number; text: number;
  iw: number; ih: number;
}

const TROT_HZ = 2.25; // pasos por pie y segundo: 4.5 saltitos por segundo

function greetPose(t: number): Pose {
  // Island size — only the spread of the warp streaks uses it.
  const gx = seg(t, 0, 0.5);
  const g = Math.sin((Math.PI * gx) / 2) + 0.04 * Math.sin(Math.PI * gx) * gx;
  const iw = lerp(NOTCH_W, GREETING_W, g);
  const ih = lerp(COMPACT.height, GREETING_H, g);

  const cx = C0.x;
  const cy = C0.y;
  // Body height: invisible before 0.20, grows 0.15 → 1 with a back ease.
  const hb = t < T.drop0 ? 0 : lerp(HB * 0.15, HB, E.back(seg(t, T.drop0, T.land)));

  const landY = cy + 0.12 * HB;

  // Horizontal: stands, trots left, turns, trots right across, brakes, sits.
  let x: number;
  if (t < T.trot0) x = cx;
  else if (t < T.turn0) x = lerp(cx, X_LEFT, E.inOut(seg(t, T.trot0, T.turn0)));
  else if (t < T.trot1) x = X_LEFT;
  else if (t < T.brake0) x = lerp(X_LEFT, X_RIGHT, E.inOut(seg(t, T.trot1, T.brake0)));
  else if (t < T.snort) x = lerp(X_RIGHT, X_SIT, E.out(seg(t, T.brake0, T.snort)));
  else x = X_SIT;

  // Gait envelope: on while trotting, off while braking.
  const gait = seg(t, T.trot0, T.trot0 + 0.1) * (1 - seg(t, T.brake0 + 0.15, T.snort));
  const phase = t < T.trot0 ? 0 : 2 * Math.PI * TROT_HZ * (t - T.trot0);
  const hop = Math.abs(Math.sin(phase)) * 0.2 * HB * gait;

  // Vertical: drop out of the notch, land, trot hopping, sit.
  let y: number;
  if (t < T.drop0) y = COMPACT.botCenterY;
  else if (t < T.land) y = lerp(COMPACT.botCenterY, landY, E.easeIn(seg(t, T.drop0, T.land)));
  else if (t < T.land + 0.16) y = lerp(landY, cy, E.out(seg(t, T.land, T.land + 0.16)));
  else y = cy;
  y -= hop;
  if (t >= T.sit0) y += 0.07 * HB * E.inOut(seg(t, T.sit0, T.sit1));

  // Squash and stretch
  const landSqK = t >= 0.52 && t < 0.72 ? Math.sin(Math.PI * seg(t, 0.52, 0.72)) : 0;
  let sx = 1 + 0.14 * landSqK;
  let sy = 1 - 0.14 * landSqK;
  const turnK = t >= T.turn0 - 0.06 && t < T.trot1 + 0.04 ? Math.sin(Math.PI * seg(t, T.turn0 - 0.06, T.trot1 + 0.04)) : 0;
  sx -= 0.12 * turnK;
  sy += 0.08 * turnK;
  const snortK = t >= T.snort - 0.05 && t < T.snort + 0.18 ? Math.sin(Math.PI * seg(t, T.snort - 0.05, T.snort + 0.18)) : 0;
  sx += 0.1 * snortK;
  sy -= 0.08 * snortK;
  const sitK = E.inOut(seg(t, T.sit0, T.sit1));
  sx += 0.06 * sitK;
  sy -= 0.06 * sitK;
  sx += 0.04 * gait * Math.sin(2 * phase);
  sy -= 0.04 * gait * Math.sin(2 * phase);

  // Lean into the run, rock with the steps, rock back when braking.
  const dir = t < T.turn0 ? -1 : 1;
  const brake = t >= T.brake0 && t < T.snort ? Math.sin(Math.PI * seg(t, T.brake0, T.snort)) : 0;
  const tilt = gait * (dir * 0.06 + 0.05 * Math.sin(phase)) - 0.1 * brake;

  return {
    hb, x, y, sx, sy, tilt,
    eye: t >= T.snort + 0.15 && t < T.end - 0.4 ? "happy" : "dot",
    gait, phase,
    snort: t >= T.snort ? t - T.snort : -1,
    halo: E.out(seg(t, 0.3, 0.7)),
    minis: 0,
    fx: 1,
    card: seg(t, 0.18, 0.45),
    text: E.out(seg(t, T.text0, T.text0 + 0.3)),
    iw, ih,
  };
}

function smallPose(): Pose {
  return {
    hb: (EAR_HB * COMPACT.botDiameter) / 20,
    x: GREETING_W / 2 - COMPACT.width / 2 + EAR_X,
    y: COMPACT.botCenterY,
    sx: 1, sy: 1, tilt: 0,
    eye: "dot",
    gait: 0, phase: 0, snort: -1,
    halo: 0.6, minis: 1, fx: 1,
    card: 0, text: 0,
    iw: COMPACT.width, ih: COMPACT.height,
  };
}

/** Hocki's pose `t` seconds in; `tc` is when the collapse began (∞ if not yet). */
export function greetingPose(t: number, tc = Number.POSITIVE_INFINITY): Pose {
  if (t < tc) return greetPose(Math.min(t, T.end + 10));
  const a = greetPose(tc);
  const b = smallPose();
  // Same curve and duration (340 ms) as the island shrinking around him.
  const k = seg(t, tc, tc + T.COLLAPSE);
  const e = k >= 1 ? 1 : closeCurve(k);
  const p: Pose = { ...a };
  p.iw = lerp(a.iw, b.iw, e);
  p.ih = lerp(a.ih, b.ih, e);
  p.x = lerp(a.x, b.x, e);
  p.y = lerp(a.y, b.y, e);
  p.hb = lerp(a.hb, b.hb, e);
  p.halo = lerp(a.halo, b.halo, e);
  p.card = a.card * (1 - seg(t, tc, tc + 0.18));
  p.text = a.text * (1 - seg(t, tc, tc + 0.1));
  p.gait = a.gait * (1 - seg(t, tc, tc + 0.1));
  p.tilt = a.tilt * (1 - e);
  p.sx = lerp(a.sx, 1, e);
  p.sy = lerp(a.sy, 1, e);
  p.eye = "dot";
  p.minis = E.back(seg(t, tc + 0.24, tc + 0.42));
  p.fx = 1 - seg(t, tc, tc + 0.2);
  return p;
}

/**
 * Ángulos de las orejas (rad; positivo = paradas) en este instante, o null para
 * dejar las del estado normal. Al trotar se agitan al ritmo de los saltitos, al
 * resoplar se paran de golpe y al sentarse se mueven contentas.
 */
export function earsAt(t: number, p: Pose): [number, number] | null {
  if (p.hb <= 0 || t >= T.end) return null;
  if (p.gait > 0.05) {
    const a = 0.15 + 0.6 * Math.abs(Math.sin(p.phase));
    const b = 0.15 + 0.6 * Math.abs(Math.sin(p.phase + 0.9));
    return [lerp(0.1, a, p.gait), lerp(0.1, b, p.gait)];
  }
  if (p.snort >= 0 && p.snort < 0.35) return [1.15, 1.15];
  if (p.snort >= 0.35) {
    const w = p.snort - 0.35;
    return [0.55 + 0.25 * Math.sin(w * 9), 0.55 + 0.25 * Math.sin(w * 9 + Math.PI)];
  }
  return null;
}

/**
 * Bounding box of Hocki in the 640×150 space — body, ears, tail and (while he
 * trots) the little hooves: what must stay inside the island.
 */
export function hockiBounds(p: Pose): { left: number; right: number; top: number; bottom: number } | null {
  const hh = p.hb / 2;
  const hw = hh * 1.08;
  if (hh <= 0.4) return null;
  const pad = 1 + Math.abs(p.tilt) * 0.6;
  return {
    left: p.x - hw * 1.32 * pad * p.sx,
    right: p.x + hw * 1.4 * pad * p.sx,
    top: p.y - hh * 1.4 * p.sy,
    bottom: p.y + (hh + 0.28 * hh * p.gait) * p.sy,
  };
}

// ── Drawing ───────────────────────────────────────────────────────────────────

function rr(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, R: number) {
  const r = Math.max(0, Math.min(R, W / 2, H / 2));
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + W, Y, X + W, Y + H, r);
  x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r);
  x.arcTo(X, Y, X + W, Y, r);
  x.closePath();
}

function miniPath(hw: number, hh: number): Path2D {
  const n = 3.2;
  const p = new Path2D();
  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const px = hw * (ca < 0 ? -1 : 1) * Math.pow(Math.abs(ca), 2 / n);
    const py = hh * (sa < 0 ? -1 : 1) * Math.pow(Math.abs(sa), 2 / n);
    if (i === 0) p.moveTo(px, py);
    else p.lineTo(px, py);
  }
  p.closePath();
  return p;
}


const HOOF = "rgb(226,121,152)";

/** Las patitas: dos pezuñas que se alternan al trotar. */
function drawFeet(x: CanvasRenderingContext2D, p: Pose) {
  if (p.gait <= 0.02) return;
  const hh = p.hb / 2;
  x.save();
  x.translate(p.x, p.y);
  x.rotate(p.tilt);
  x.scale(p.sx, p.sy);
  x.globalAlpha = p.gait;
  x.fillStyle = HOOF;
  for (const [sd, ph] of [[-1, 0], [1, Math.PI]] as const) {
    const lift = Math.max(0, Math.sin(p.phase + ph)) * 0.14 * hh;
    x.beginPath();
    x.ellipse(sd * hh * 0.42, hh * 0.9 + 0.05 * hh - lift, hh * 0.2, hh * 0.15, 0, 0, Math.PI * 2);
    x.fill();
  }
  x.restore();
}

/** Resoplido: unas bocanadas blancas que salen del hocico. */
function drawSnort(x: CanvasRenderingContext2D, p: Pose) {
  if (p.snort < 0 || p.snort > 0.5) return;
  const k = p.snort / 0.5;
  const hh = p.hb / 2;
  x.save();
  for (const sd of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const kk = clamp(k * 1.2 - i * 0.12, 0, 1);
      if (kk <= 0) continue;
      const px = p.x + sd * (hh * 0.2 + kk * hh * 0.9 + i * 2);
      const py = p.y + hh * 0.35 + kk * hh * 0.35 - i * 2;
      x.fillStyle = `rgba(255,255,255,${0.7 * (1 - kk)})`;
      x.beginPath();
      x.arc(px, py, 1.5 + kk * 3.5 + i * 0.4, 0, Math.PI * 2);
      x.fill();
    }
  }
  x.restore();
}

function drawHocki(x: CanvasRenderingContext2D, bot: BotEngine, p: Pose) {
  const hh = p.hb / 2;
  if (hh <= 0.4) return;

  // Halo: a soft pink aura, two passes
  if (p.halo > 0) {
    for (const [R, alpha] of [[hh * 1.08 * 2.6, 0.18], [hh * 1.08 * 4.2, 0.07]] as const) {
      const g = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      g.addColorStop(0, `rgba(255,170,195,${alpha * p.halo})`);
      g.addColorStop(1, "rgba(255,170,195,0)");
      x.fillStyle = g;
      x.beginPath();
      x.arc(p.x, p.y, R, 0, Math.PI * 2);
      x.fill();
    }
  }

  drawFeet(x, p);

  // The same pig as the island's, scaled so its body is p.hb tall.
  const k = p.hb / ENGINE_BODY_H;
  x.save();
  x.translate(p.x, p.y);
  x.rotate(p.tilt);
  x.scale(p.sx * k, p.sy * k);
  x.translate(-ENGINE_BOX / 2, -ENGINE_BOX / 2 - ENGINE_BOX * 0.3 * 0.06 - 0);
  bot.draw(x, ENGINE_BOX, ENGINE_BOX);
  x.restore();

  drawSnort(x, p);
}

function drawParticles(x: CanvasRenderingContext2D, t: number, p: Pose) {
  if (!(p.card > 0 || p.fx < 1)) return;

  // Warp streaks: white vertical lines while Hocki falls in
  if (t < 0.55) {
    const fadeOut = 1 - seg(t, 0.4, 0.55);
    x.lineCap = "butt";
    for (const s of PARTICLES.warps) {
      if (t < s.t0) continue;
      const yBot = (t - s.t0) * s.speed;
      const yTop = yBot - s.len;
      if (yBot <= 0) continue;
      const sx = GREETING_W / 2 - p.iw / 2 + s.xNorm * p.iw;
      x.strokeStyle = `rgba(255,255,255,${s.alpha * p.fx * fadeOut})`;
      x.lineWidth = s.thick;
      x.beginPath();
      x.moveTo(sx, Math.max(0, yTop));
      x.lineTo(sx, Math.min(GREETING_H, yBot));
      x.stroke();
    }
  }

  // Ring: one white burst at 0.45 s
  const k = seg(t, 0.45, 0.45 + 1.35);
  if (k > 0 && k < 1) {
    const rx = lerp(14, 380, E.out(k));
    const ry = rx * 0.34;
    const fade = (1 - k) * (k < 0.08 ? k / 0.08 : 1) * p.fx * p.card;
    for (const dot of PARTICLES.ring) {
      const r = 1 + dot.j;
      x.fillStyle = `rgba(255,255,255,${dot.al * fade})`;
      x.fillRect(C0.x + Math.cos(dot.a) * rx * r, C0.y + Math.sin(dot.a) * ry * r, dot.s, dot.s);
    }
  }
}

const MINI_GLOWS = ["#E86A6A", "#3E86E0", "#EFAE5A", "#8C73F2"];
const PINK = "#F1A0B4";

/** Las miniaturas de integraciones: cerditos rosados con un resplandor mínimo del color de cada una. */
function drawMinis(x: CanvasRenderingContext2D, alpha: number) {
  if (alpha <= 0.01) return;
  const cx = GREETING_W / 2 - COMPACT.width / 2 + COMPACT.miniGridCenterX;
  const cy = COMPACT.botCenterY;
  const sp = 6 * COMPACT.miniGridScale;
  const offsets: [number, number][] = [[-sp, -sp], [sp, -sp], [-sp, sp], [sp, sp]];
  offsets.forEach(([dx, dy], i) => {
    x.save();
    x.translate(cx + dx, cy + dy);
    const scale = alpha * COMPACT.miniGridScale;
    x.scale(scale, scale);
    x.shadowColor = MINI_GLOWS[i];
    x.shadowBlur = 2;
    x.fillStyle = PINK;
    x.fill(miniPath(5.3, 4));
    x.restore();
  });
}

function drawText(x: CanvasRenderingContext2D, p: Pose) {
  if (p.text <= 0.01) return;
  x.save();
  x.globalAlpha = p.text;
  x.fillStyle = "#FFFFFF";
  x.font = '700 26px Inter, "Segoe UI", system-ui, sans-serif';
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(GREETING_TEXT, 430 + (1 - p.text) * 14, 92);
  x.restore();
}

// ── Particles (seeded LCG, seed = 7, same sequence as the Swift version) ──────

interface WarpStreak { xNorm: number; speed: number; len: number; thick: number; alpha: number; t0: number }
interface RingDot { a: number; j: number; s: number; al: number }

const PARTICLES = (() => {
  let seed = 7;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  // ~70 white warp streaks for the fall-in (0 → 0.55 s)
  const warps: WarpStreak[] = Array.from({ length: 70 }, () => ({
    xNorm: rnd(),
    speed: 400 + rnd() * 300,
    len: 6 + rnd() * 16,
    thick: 1 + rnd() * 0.5,
    alpha: 0.25 + rnd() * 0.55,
    t0: rnd() * 0.35,
  }));
  // one white burst ring at 0.45 s
  const ring: RingDot[] = Array.from({ length: 90 }, () => ({
    a: rnd() * Math.PI * 2,
    j: (rnd() - 0.5) * 0.22,
    s: 0.7 + rnd() * 0.9,
    al: 0.45 + rnd() * 0.55,
  }));
  return { warps, ring };
})();

// ── Controller ────────────────────────────────────────────────────────────────

/**
 * Runs the greeting animation on its own canvas. `onComplete` fires once at
 * T.end (or right after the collapse when interrupted) so the FSM can move on.
 */
export class Greeting {
  private startMs = 0;
  private tc = Number.POSITIVE_INFINITY;
  private fired = false;
  private timers: number[] = [];
  private bot = newHockiEngine();
  private lastDraw = 0;

  onComplete: (() => void) | null = null;

  start() {
    this.startMs = performance.now();
    this.lastDraw = this.startMs;
    this.bot = newHockiEngine();
    this.bot.setState("idle", true);
    this.tc = Number.POSITIVE_INFINITY;
    this.fired = false;
    this.cancelTimers();
    // The score plays from the start; it outlives greetComplete a little on
    // purpose and fades when the greeting view goes away (see leave()).
    Sound.play(GREETING_SOUND);
    this.timers.push(window.setTimeout(() => this.fire(), (T.end + 0.05) * 1000));
  }

  /** Mouse entered the island during the greeting — hold it open. */
  hover() {
    if (this.tc >= T.autoLeave) this.tc = Number.POSITIVE_INFINITY;
  }

  /** Mouse left — collapse from now. */
  interrupt() {
    const t = (performance.now() - this.startMs) / 1000;
    if (!Number.isFinite(this.tc) || this.tc > t) this.tc = t;
    this.cancelTimers();
    Sound.fadeOut(GREETING_SOUND, 0.25);
  }

  /** The greeting view is gone: let what is left of its sound fade away. */
  leave() {
    this.cancelTimers();
    Sound.fadeOut(GREETING_SOUND, 0.2);
  }

  get elapsed(): number {
    return (performance.now() - this.startMs) / 1000;
  }

  get done(): boolean {
    return this.fired;
  }

  private fire() {
    if (this.fired) return;
    this.fired = true;
    this.cancelTimers();
    this.onComplete?.();
  }

  private cancelTimers() {
    this.timers.forEach((id) => window.clearTimeout(id));
    this.timers = [];
  }

  draw(x: CanvasRenderingContext2D) {
    const nowMs = performance.now();
    const dt = Math.min(0.05, Math.max(0, (nowMs - this.lastDraw) / 1000));
    this.lastDraw = nowMs;
    const t = this.elapsed;
    if (!this.fired && t >= T.end && this.tc >= T.autoLeave) this.fire();

    const p = greetingPose(t, this.tc);
    x.clearRect(0, 0, GREETING_W, GREETING_H);

    if (p.card > 0) {
      x.save();
      x.globalAlpha = p.card;
      rr(x, CARD.x, CARD.y, CARD.w, CARD.h, CARD_R);
      x.fillStyle = "#141518";
      x.fill();
      x.restore();

      x.save();
      rr(x, CARD.x, CARD.y, CARD.w, CARD.h, CARD_R);
      x.clip();
      drawParticles(x, t, p);
      x.restore();
    } else if (Number.isFinite(this.tc) && t >= this.tc) {
      drawParticles(x, t, p);
    }

    // Orejas y ojos los manda la animación; el resto (parpadeo, cola) es del cerdito.
    this.bot.earOverride = earsAt(t, p);
    if (p.eye === "happy") {
      this.bot.eyeOverride = "happy";
      this.bot.eyeOverrideUntil = Number.POSITIVE_INFINITY;
    } else if (this.bot.eyeOverrideUntil === Number.POSITIVE_INFINITY) {
      this.bot.eyeOverride = null;
      this.bot.eyeOverrideUntil = 0;
    }
    this.bot.update(dt);

    drawMinis(x, p.minis);
    drawText(x, p);
    drawHocki(x, this.bot, p);
  }
}
