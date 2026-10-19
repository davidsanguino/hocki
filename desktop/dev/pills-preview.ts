import { createMiniBot, setMiniCursor, tickMiniBots, tintMiniBot } from "../src/hocki/minibots";

const data = [["VS Code", "#FFFFFF"], ["Resend", "#22C55E"], ["n8n", "#F5A524"], ["GitHub", "#EF4444"]];
const row = document.getElementById("r")!;
data.forEach(([name, color], i) => {
  const task: any = { id: name, name, color, state: "idle", steps: [], isIntegration: true };
  const slot = createMiniBot(task, 24);
  const pill = document.createElement("div"); pill.className = "pill";
  pill.append(slot, Object.assign(document.createElement("span"), { textContent: name }));
  pill.style.borderColor = `${color}55`;
  row.append(pill);
  if (i === 2) { tintMiniBot(slot, true); pill.style.background = `${color}2e`; }
});
setMiniCursor(700, 20);
let last = performance.now();
const loop = (n: number) => { tickMiniBots(Math.min(0.05, (n - last) / 1000)); last = n; requestAnimationFrame(loop); };
requestAnimationFrame(loop);
