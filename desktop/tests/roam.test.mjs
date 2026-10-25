// Paseo de Hocki por la pantalla: respeta clics, teclas y el cursor.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DesktopRoamer } from "../src/hocki/desktop-roam.ts";

const WORK = [0, 0, 1920, 1040];
function rig(over = {}) {
  const c = { t: 100000 };
  const state = { cursor: [100, 100], pos: [900, 500], work: WORK, scale: 1, pressed: false, typing: false, ...over };
  const moves = [];
  let seed = 0.37;
  const rand = () => (seed = (seed * 9301 + 49297) % 233280 / 233280 * 0.999);
  const io = {
    input: async () => (state.off ? null : { ...state }),
    moveTo: async (x, y) => { moves.push([x, y]); state.pos = [x, y]; },
  };
  const r = new DesktopRoamer(io, { now: () => c.t, rand });
  const step = async (n = 1, ms = 70) => { let last; for (let i = 0; i < n; i++) { c.t += ms; last = await r.tick(); } return last; };
  return { c, state, moves, r, step };
}

test("en calma pasea: se mueve y se mantiene dentro de la pantalla", async () => {
  const { state, moves, step } = rig();
  await step(120);
  assert.ok(moves.length > 5, "se movió");
  for (const [x, y] of moves) {
    assert.ok(x >= -10 && x <= 1920 && y >= -10 && y <= 1040, `dentro (${x},${y})`);
  }
  assert.ok(state.pos[0] !== 900 || state.pos[1] !== 500);
});

test("si no está libre en el escritorio no mueve nada", async () => {
  const { moves, step, state } = rig({ off: true });
  const r = await step(10);
  assert.equal(r, null);
  assert.equal(moves.length, 0);
  assert.equal(state.pos[0], 900);
});

test("con clics o teclas se aparta a un rincón y se vuelve casi transparente", async () => {
  const { state, step } = rig({ cursor: [960, 520], pos: [940, 500], pressed: true });
  const r = await step(60);
  assert.equal(r.mode, "busy");
  assert.ok(r.opacity < 0.5);
  const [x, y] = state.pos;
  assert.ok(Math.hypot(x + 60 - 960, y + 60 - 520) > 300, "lejos del cursor");
  const t = rig({ cursor: [960, 520], pos: [940, 500], typing: true });
  assert.equal((await t.step(5)).mode, "busy");
});

test("nunca pisa el cursor mientras pasea", async () => {
  const { state, step } = rig({ cursor: [960, 520], pos: [200, 200] });
  for (let i = 0; i < 200; i++) {
    await step(1);
    const d = Math.hypot(state.pos[0] + 60 - 960, state.pos[1] + 60 - 520);
    assert.ok(d > 100, `a ${Math.round(d)} px del cursor`);
  }
});

test("respeta el área útil (barra de tareas) y pantallas con otro origen", async () => {
  const { state, step } = rig({ work: [1920, 0, 1920, 1000], pos: [2400, 300], cursor: [2500, 900] });
  await step(150);
  assert.ok(state.pos[0] >= 1900 && state.pos[0] <= 3840 - 40);
  assert.ok(state.pos[1] >= -10 && state.pos[1] <= 1000);
});

test("con pantalla escalada (150 %) también se mantiene dentro", async () => {
  const { state, step } = rig({ scale: 1.5, work: [0, 0, 2880, 1560], pos: [1000, 600], cursor: [200, 200] });
  await step(150);
  assert.ok(state.pos[0] >= -10 && state.pos[0] <= 2880);
  assert.ok(state.pos[1] >= -10 && state.pos[1] <= 1560);
});

test("se mueve fluido: sin saltos ni temblores entre rincones", async () => {
  const { state, moves, step } = rig({ cursor: [100, 100], pos: [900, 500] });
  await step(300, 33);
  for (let i = 1; i < moves.length; i++) {
    const d = Math.hypot(moves[i][0] - moves[i - 1][0], moves[i][1] - moves[i - 1][1]);
    assert.ok(d <= 16, `paso de ${d.toFixed(1)} px`);
  }
  // Ocupado con el cursor quieto: va a un rincón y se queda ahí (no va y viene).
  const b = rig({ cursor: [960, 520], pos: [940, 500], typing: true });
  await b.step(120, 33);
  const settled = [...b.state.pos];
  await b.step(40, 33);
  assert.ok(Math.hypot(b.state.pos[0] - settled[0], b.state.pos[1] - settled[1]) < 3, "quieto en su rincón");
  void state;
});
