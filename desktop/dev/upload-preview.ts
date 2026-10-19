import { UploadCanvas } from "../src/upload/canvas";
import { UploadSeq } from "../src/upload/sequence";

const g = document.getElementById("g")!;
const uc = new UploadCanvas({ ask() {}, cancel() {} });
const dpr = 2;
const c = (uc.el instanceof HTMLCanvasElement ? uc.el : uc.el.querySelector("canvas")) as HTMLCanvasElement;
(async () => {
  for (const [label, x, y] of [["Hocki espera (caja)", 140, 104], ["El cursor se acerca", 330, 100], ["Boca abierta", 90, 100]] as const) {
    UploadSeq.enterZone(140, 104);
    for (let i = 0; i < 40; i++) { UploadSeq.updateCursor(x, y); uc.draw(UploadSeq.frame(), i / 60); await new Promise((r) => setTimeout(r, 16)); }
    const d = document.createElement("div"); d.className = "b";
    const cap = document.createElement("div"); cap.textContent = label;
    const copy = document.createElement("canvas"); copy.width = c.width; copy.height = c.height; copy.style.width = "640px"; copy.style.height = "176px";
    copy.getContext("2d")!.drawImage(c, 0, 0);
    d.append(cap, copy); g.append(d);
    UploadSeq.deactivate();
  }
  document.title = "listo";
})();
