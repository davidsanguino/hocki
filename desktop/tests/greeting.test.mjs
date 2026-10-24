// The launch greeting (src/hocki/greeting.ts): Hocki must never be cut off by
// the island while it grows, while he bounces and waves, or while it shrinks
// back to the compact island.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GREETING_END, GREETING_TEXT, GREETING_W, earsAt, greetingPose, hockiBounds } from "../src/hocki/greeting.ts";
import { Tracked } from "../src/core/anim.ts";
import { COMPACT_W, NOTCH_H, NOTCH_W, VIEW_LAYOUTS } from "../src/core/layout.ts";

const FRAME = 1 / 60;
const SLACK = 0.5; // anti-aliasing

/** Hocki's box against the island's, which is centred in the 640 px greeting canvas. */
function assertInside(t, tc, w, h) {
  const b = hockiBounds(greetingPose(t, tc));
  if (!b) return;
  const left = GREETING_W / 2 - w / 2;
  const right = GREETING_W / 2 + w / 2;
  const at = `t=${t.toFixed(3)} tc=${tc}`;
  // No check on the top: he drops in from the edge of the screen, like out of
  // the notch on a Mac, so his head is meant to come out of it.
  assert.ok(b.bottom <= h + SLACK, `${at}: bottom ${b.bottom.toFixed(1)} below the island (${h.toFixed(1)})`);
  assert.ok(b.left >= left - SLACK, `${at}: left ${b.left.toFixed(1)} outside ${left.toFixed(1)}`);
  assert.ok(b.right <= right + SLACK, `${at}: right ${b.right.toFixed(1)} outside ${right.toFixed(1)}`);
}

/** Runs the island geometry the way Island does: spring open, then the 340 ms close curve. */
function run(tc) {
  const width = new Tracked(NOTCH_W);
  const height = new Tracked(0);
  width.springTo(GREETING_W);
  height.springTo(VIEW_LAYOUTS.greeting.height);
  let collapsed = false;
  const stop = Number.isFinite(tc) ? tc + 0.6 : GREETING_END + 0.5;
  for (let t = 0; t <= stop; t += FRAME) {
    const now = t * 1000;
    if (!collapsed && t >= tc) {
      collapsed = true;
      width.curveTowards(COMPACT_W, 340, now);
      height.curveTowards(NOTCH_H, 340, now);
    }
    width.step(FRAME, now);
    height.step(FRAME, now);
    assertInside(t, tc, width.value, height.value);
  }
}

test("Hocki stays inside the island for the whole greeting", () => {
  run(Number.POSITIVE_INFINITY);
});

test("Hocki stays inside the island when the greeting is cut short", () => {
  for (let tc = 0.3; tc < GREETING_END + 0.4; tc += 0.1) run(tc);
});

test("trota hacia el borde izquierdo, cruza a la derecha y se sienta a saludar", () => {
  const start = greetingPose(0.8);
  assert.equal(start.x, 320);
  const left = greetingPose(1.65);
  assert.ok(left.x < 150, `borde izquierdo x=${left.x}`);
  assert.ok(left.gait > 0.9, "trotando");
  const right = greetingPose(2.45);
  assert.ok(right.x > 480, `borde derecho x=${right.x}`);
  const sat = greetingPose(3.5);
  assert.equal(sat.x, 215);
  assert.equal(sat.gait, 0, "ya no trota");
  assert.equal(sat.eye, "happy");
  assert.ok(sat.text > 0.9, "el texto ya se ve");
});

test("las patitas y los saltitos solo existen mientras trota", () => {
  assert.ok(greetingPose(0.5).gait === 0);
  const hops = [];
  for (let t = 1.2; t < 1.6; t += 0.02) hops.push(greetingPose(t).y);
  assert.ok(Math.max(...hops) - Math.min(...hops) > 5, "salta al trotar");
  assert.equal(greetingPose(4).y, greetingPose(4.5).y, "sentado queda quieto");
});

test("orejas: al viento al trotar, paradas al resoplar, contentas al sentarse", () => {
  const trot = earsAt(1.3, greetingPose(1.3));
  assert.ok(trot && trot[0] >= 0.1 && trot[0] <= 0.8, `trote ${trot}`);
  const snort = earsAt(3.05, greetingPose(3.05));
  assert.deepEqual(snort, [1.15, 1.15]);
  const happy = earsAt(3.8, greetingPose(3.8));
  assert.ok(happy && Math.abs(happy[0] - happy[1]) > 0.05, "se mueven");
  assert.equal(earsAt(0.1, greetingPose(0.1)), null);
});

test("el texto de la tarjeta es el saludo de Hocki", () => {
  assert.equal(GREETING_TEXT, "¡Hola, soy Hocki!");
});

test("he lands where the compact island's Hocki sits", () => {
  const end = greetingPose(10, 5);
  assert.equal(end.y, NOTCH_H / 2);
  assert.equal(end.x, GREETING_W / 2 - COMPACT_W / 2 + 40);
  assert.equal(end.minis, 1);
});
