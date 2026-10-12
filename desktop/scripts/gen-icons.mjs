// Draws Hocki into the PNG/ICO set Tauri needs. No dependencies: the icons are
// rasterised here and encoded with node:zlib, so the app icon stays "drawn in
// code" like the character itself.
//
//   node scripts/gen-icons.mjs

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");

// ── Hocki ─────────────────────────────────────────────────────────────────────

const BODY = [249, 192, 205]; // #F9C0CD
const BODY_DARK = [241, 160, 180]; // #F1A0B4
const EAR = [240, 150, 172];
const SNOUT = [245, 160, 181]; // #F5A0B5
const NOSTRIL = [150, 50, 80];
const INK = [42, 26, 30]; // #2A1A1E
const RIM = [110, 40, 62];

const SS = 4; // supersampling factor

const inEllipse = (x, y, cx, cy, rx, ry, rot = 0) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  const dx = x - cx, dy = y - cy;
  const u = dx * c + dy * s, v = -dx * s + dy * c;
  return (u / rx) ** 2 + (v / ry) ** 2 <= 1;
};

/** Hocki: cabeza redonda rosada, orejas caídas, hocico con fosas y ojos. */
function shapes(size) {
  const R = size * 0.34;
  const cx = size / 2;
  const cy = size / 2 + R * 0.12;
  const rim = R * 0.06;
  const list = [];
  // [test, color-fn, rimmed]
  const ear = (sd) => (x, y) => inEllipse(x, y, cx + sd * R * 0.98, cy - R * 0.46, R * 0.42, R * 0.3, sd * 0.6);
  list.push({ t: ear(-1), c: () => EAR, r: true });
  list.push({ t: ear(1), c: () => EAR, r: true });
  list.push({
    t: (x, y) => inEllipse(x, y, cx, cy, R * 1.05, R * 0.98),
    c: (x, y) => {
      const t = Math.min(1, Math.max(0, ((x - cx) * -0.6 + (y - cy) * 0.8) / (2 * R) + 0.5));
      return [0, 1, 2].map((i) => BODY[i] + (BODY_DARK[i] - BODY[i]) * t);
    },
    r: true,
  });
  list.push({ t: (x, y) => inEllipse(x, y, cx, cy + R * 0.3, R * 0.34, R * 0.24), c: () => SNOUT, r: false });
  for (const sd of [-1, 1]) {
    list.push({ t: (x, y) => inEllipse(x, y, cx + sd * R * 0.11, cy + R * 0.3, R * 0.06, R * 0.09), c: () => NOSTRIL, r: false });
    list.push({ t: (x, y) => inEllipse(x, y, cx + sd * R * 0.4, cy - R * 0.1, R * 0.12, R * 0.19), c: () => INK, r: false });
  }
  return { list, rim };
}

function renderHocki(size) {
  const px = new Uint8Array(size * size * 4);
  const { list, rim } = shapes(size);
  const total = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const X = x + (sx + 0.5) / SS;
          const Y = y + (sy + 0.5) / SS;
          let col = null;
          // contorno oscuro: cualquier forma con borde, ampliada
          for (const sh of list) {
            if (!sh.r) continue;
            // aproximación del contorno: se prueba la forma desplazada en 8 direcciones
            for (let k = 0; k < 8 && !col; k++) {
              const ang = (k / 8) * Math.PI * 2;
              if (sh.t(X + Math.cos(ang) * rim, Y + Math.sin(ang) * rim)) col = RIM;
            }
            if (col) break;
          }
          for (const sh of list) {
            if (sh.t(X, Y)) col = sh.c(X, Y);
          }
          if (col) { r += col[0]; g += col[1]; b += col[2]; a += 1; }
        }
      }
      if (a === 0) continue;
      const o = (y * size + x) * 4;
      px[o] = Math.round(r / a);
      px[o + 1] = Math.round(g / a);
      px[o + 2] = Math.round(b / a);
      px[o + 3] = Math.round((a / total) * 255);
    }
  }
  return px;
}

// ── PNG ───────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── ICO (PNG-in-ICO, Vista and later) ─────────────────────────────────────────

function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// ── Go ────────────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });

const png = (size) => encodePNG(size, renderHocki(size));

const files = {
  "32x32.png": png(32),
  "128x128.png": png(128),
  "128x128@2x.png": png(256),
  "icon.png": png(512),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), data);
  console.log(`${name} — ${data.length} bytes`);
}

const ico = encodeICO([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) })));
writeFileSync(join(OUT, "icon.ico"), ico);
console.log(`icon.ico — ${ico.length} bytes`);
