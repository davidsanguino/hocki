import { BotEngine } from "../src/hocki/engine";
import type { BotStateName } from "../src/core/layout";

const states: BotStateName[] = ["idle", "working", "thinking", "searching", "approval", "question", "error", "finished", "ratelimit", "sleeping", "dizzy", "listening", "verifying"];
const g = document.getElementById("g")!;
const items = states.map((s) => {
  const d = document.createElement("div"); d.className = "c";
  const c = document.createElement("canvas"); const dpr = 2;
  c.width = 220 * dpr; c.height = 180 * dpr;
  const l = document.createElement("div"); l.textContent = s;
  d.append(c, l); g.append(d);
  const e = new BotEngine(); if (location.search.includes("mini")) { e.isMini = true; e.bodyColor = [[0.13,0.77,0.37],[0.97,0.62,0.2],[0.45,0.4,1],[0.95,0.3,0.4]][states.indexOf(s)%4] as any; } e.setState(s, true); if (location.search.includes("witch")) e.setOutfit("witchHat", false);
  return { c, e, dpr };
});
let last = performance.now();
function frame() {
  const t = performance.now(); const dt = (t - last) / 1000; last = t;
  for (const { c, e, dpr } of items) {
    e.update(dt);
    const x = c.getContext("2d")!;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, 220, 180);
    e.draw(x, 220, 180);
  }
  requestAnimationFrame(frame);
}
frame();
