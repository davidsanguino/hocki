// Mini Hockis (pills + compact grid) — port of MiniBotCanvasView.
// Each canvas owns a BotEngine; the island's frame loop ticks every live one.

import { BotEngine, hexToRGB } from "./engine";
import type { AgentTask } from "../core/state";

interface MiniBot {
  canvas: HTMLCanvasElement;
  engine: BotEngine;
  cssSize: number;
  taskId: string;
  color: string;
  /** El cerdito toma el color de su integración (al pasar el cursor o seleccionarla). */
  tinted: boolean;
  /** Asked every frame: whether this one dances (the music pill's, MiniBotCanvasView). */
  dancing?: () => boolean;
}

const live = new Map<HTMLCanvasElement, MiniBot>();

/**
 * Creates a mini Hocki whose **body** is `bodySize` CSS pixels across.
 *
 * The engine draws the body at 60 % of its canvas, so the canvas is
 * `bodySize / 0.6` and is centred in a `bodySize` slot, overflowing it — the
 * same thing SwiftUI does with a `.frame(width: 22/0.6)` inside a
 * `.frame(width: 22)`. Sizing the canvas itself to `bodySize` would shrink the
 * whole drawing to 60 %, which is what used to happen.
 */
export function createMiniBot(task: AgentTask, bodySize: number, dancing?: () => boolean): HTMLElement {
  const slot = document.createElement("span");
  slot.className = "mini";
  slot.style.width = `${bodySize}px`;
  slot.style.height = `${bodySize}px`;

  const canvas = document.createElement("canvas");
  const engineSize = bodySize / 0.6;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(engineSize * dpr);
  canvas.height = Math.round(engineSize * dpr);
  canvas.style.width = `${engineSize}px`;
  canvas.style.height = `${engineSize}px`;
  slot.append(canvas);

  const engine = new BotEngine();
  engine.isMini = true;
  // El cerdito conserva su color rosado; el color de la integración es solo un
  // resplandor pequeño y casi sin desenfoque detrás de él.
  setGlow(slot, task.color);
  engine.setState(task.state, true);
  if (task.emote) engine.setPermanentEmote(task.emote);
  if (task.miniEye) {
    engine.permanentEye = task.miniEye;
    engine.eyeOverride = task.miniEye;
    engine.eyeOverrideUntil = Number.POSITIVE_INFINITY;
  }

  live.set(canvas, { canvas, engine, cssSize: engineSize, taskId: task.id, color: task.color, tinted: false, dancing });
  return slot;
}

/** Resplandor de la integración: pequeño, con desenfoque mínimo, pegado a la silueta. */
export function setGlow(slot: HTMLElement, hex: string) {
  const [r, g, b] = hexToRGB(hex).map((v) => Math.round(v * 255));
  const value = `drop-shadow(0 0 2px rgba(${r}, ${g}, ${b}, 0.85))`;
  if (slot.style.filter !== value) slot.style.filter = value;
}

/** Rosado en reposo; con el color de su integración mientras la tocas o la seleccionas. */
export function tintMiniBot(slot: HTMLElement, on: boolean) {
  const canvas = slot.querySelector("canvas");
  const mb = canvas ? live.get(canvas) : undefined;
  if (!mb) return;
  mb.tinted = on;
  mb.engine.bodyColor = on ? hexToRGB(mb.color) : null;
}

let cursor: { x: number; y: number } | null = null;

/** Dónde está el cursor (coordenadas de la ventana); los cerditos miran hacia allá. */
export function setMiniCursor(x: number, y: number) {
  cursor = x < -1000 || y < -1000 ? null : { x, y };
}

/** Mirada hacia el cursor: igual que el Hocki grande (gaze en desktop-logic). */
export function gazeToward(cx: number, cy: number, mouse: { x: number; y: number } | null): { lookX: number; lookY: number } {
  if (!mouse) return { lookX: 0, lookY: 0 };
  return { lookX: Math.tanh((mouse.x - cx) / 260), lookY: -Math.tanh((mouse.y - cy) / 200) };
}

export function releaseMiniBot(canvas: HTMLCanvasElement) {
  live.delete(canvas);
}

/** Drops every canvas no longer in the document (views are rebuilt wholesale). */
export function pruneMiniBots() {
  for (const [canvas] of live) {
    if (!canvas.isConnected) live.delete(canvas);
  }
}

export function syncMiniBotStates(tasks: AgentTask[]) {
  for (const mb of live.values()) {
    const task = tasks.find((t) => t.id === mb.taskId);
    if (!task) continue;
    mb.engine.setState(task.state);
    mb.color = task.color;
    if (mb.tinted) mb.engine.bodyColor = hexToRGB(task.color);
    const slot = mb.canvas.parentElement;
    if (slot) setGlow(slot, task.color);
  }
}

export function tickMiniBots(dt: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const mb of live.values()) {
    const ctx = mb.canvas.getContext("2d");
    if (!ctx) continue;
    const r = mb.canvas.getBoundingClientRect();
    const g = gazeToward(r.left + r.width / 2, r.top + r.height / 2, cursor);
    mb.engine.lookX = g.lookX;
    mb.engine.lookY = g.lookY;
    mb.engine.setDancing(mb.dancing?.() ?? false);
    mb.engine.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, mb.cssSize, mb.cssSize);
    ctx.save();
    mb.engine.applyDance(ctx, mb.cssSize, mb.cssSize);
    mb.engine.draw(ctx, mb.cssSize, mb.cssSize);
    ctx.restore();
  }
}

export const miniBotCount = () => live.size;
