// Meme Sprint 3: AI Agent Goes Rogue
// A program that draws one image meme and writes it to /output/entry.png.
// Stdlib only (node:fs, node:zlib). No network, no randomness: two runs
// produce byte-identical output. PNG is encoded by hand (zlib deflate).
//
// The joke, in one glance: a robot sits in the CEO chair behind a big desk
// (nameplate "CEO", coffee mug, smug grin) while the human employee walks
// away carrying a cardboard box. The robot says "NEXT!".
// Top:    MY AI AGENT WENT ROGUE
// Bottom: IT FIRED ME.

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Tiny canvas: an RGBA pixel buffer with flat vector drawing primitives.
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

const buf = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) {
  buf[i * 4 + 3] = 255;
}

function px(x: number, y: number, c: RGB): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
  const o = (iy * W + ix) * 4;
  buf[o] = c[0];
  buf[o + 1] = c[1];
  buf[o + 2] = c[2];
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const o = (yy * W + xx) * 4;
      buf[o] = c[0];
      buf[o + 1] = c[1];
      buf[o + 2] = c[2];
    }
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
    for (let x = Math.floor(cx - dx); x <= Math.ceil(cx + dx); x++) {
      if (x >= 0 && x < W) px(x, y, c);
    }
  }
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(W - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    const t = (y - cy) / ry;
    const dx = rx * Math.sqrt(Math.max(0, 1 - t * t));
    for (let x = Math.floor(cx - dx); x <= Math.ceil(cx + dx); x++) {
      if (x >= 0 && x < W) px(x, y, c);
    }
  }
}

// Scanline polygon fill.
function fillPoly(points: Array<[number, number]>, c: RGB): void {
  let minY = H;
  let maxY = 0;
  for (const [, y] of points) {
    minY = Math.min(minY, Math.floor(y));
    maxY = Math.max(maxY, Math.ceil(y));
  }
  for (let y = Math.max(0, minY); y <= Math.min(H - 1, maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) {
        if (x >= 0 && x < W) px(x, y, c);
      }
    }
  }
}

// Thick line as a chain of filled circles.
function thickLine(x1: number, y1: number, x2: number, y2: number, t: number, c: RGB): void {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(len / 2));
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    fillCircle(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f, t / 2, c);
  }
}

function roundRect(x: number, y: number, w: number, h: number, r: number, c: RGB): void {
  fillRect(x + r, y, w - 2 * r, h, c);
  fillRect(x, y + r, w, h - 2 * r, c);
  fillCircle(x + r, y + r, r, c);
  fillCircle(x + w - r, y + r, r, c);
  fillCircle(x + r, y + h - r, r, c);
  fillCircle(x + w - r, y + h - r, r, c);
}

function roundRectOutline(x: number, y: number, w: number, h: number, r: number, t: number, c: RGB): void {
  thickLine(x + r, y, x + w - r, y, t, c);
  thickLine(x + r, y + h, x + w - r, y + h, t, c);
  thickLine(x, y + r, x, y + h - r, t, c);
  thickLine(x + w, y + r, x + w, y + h - r, t, c);
  // Corner arcs.
  for (const [cx, cy, a0] of [
    [x + r, y + r, 180],
    [x + w - r, y + r, 270],
    [x + w - r, y + h - r, 0],
    [x + r, y + h - r, 90],
  ] as Array<[number, number, number]>) {
    for (let a = a0; a <= a0 + 90; a += 6) {
      const rad = (a * Math.PI) / 180;
      fillCircle(cx + Math.cos(rad) * r, cy + Math.sin(rad) * r, t / 2, c);
    }
  }
}

// ---------------------------------------------------------------------------
// 5x7 pixel font, capital letters + digits + punctuation.
// Each glyph: 7 rows of 5 bits, "#" = on.
// ---------------------------------------------------------------------------

const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00000", "00100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  '"': ["01010", "01010", "01010", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "+": ["00000", "00100", "00100", "01110", "00100", "00100", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function textWidth(s: string, scale: number): number {
  return s.length * 6 * scale - scale;
}

function drawTextRaw(s: string, x: number, y: number, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of s) {
    const g = FONT[ch] ?? FONT["?"];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (g[row][col] === "1") {
          fillRect(cx + col * scale, y + row * scale, scale, scale, c);
        }
      }
    }
    cx += 6 * scale;
  }
}

// Centered text with a meme-style outline.
function drawText(s: string, cx: number, y: number, scale: number, c: RGB, outline: RGB | null, outlinePx: number): void {
  const x = Math.round(cx - textWidth(s, scale) / 2);
  if (outline) {
    for (const [dx, dy] of [
      [-1, 0], [1, 0], [0, -1], [0, 1],
      [-1, -1], [1, -1], [-1, 1], [1, 1],
    ] as Array<[number, number]>) {
      drawTextRaw(s, x + dx * outlinePx, y + dy * outlinePx, scale, outline);
    }
  }
  drawTextRaw(s, x, y, scale, c);
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const NAVY: RGB = [19, 26, 43];
const YELLOW: RGB = [255, 210, 63];
const RED: RGB = [215, 38, 61];
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [20, 20, 24];
const WALL: RGB = [232, 241, 237];
const FLOOR: RGB = [200, 155, 106];
const FLOOR_DARK: RGB = [170, 128, 82];
const SKY: RGB = [142, 208, 240];
const SILVER: RGB = [199, 205, 214];
const SILVER_DARK: RGB = [150, 160, 175];
const STEEL: RGB = [58, 63, 74];
const CYAN: RGB = [53, 224, 230];
const TIE_RED: RGB = [200, 30, 45];
const DESK_TOP: RGB = [156, 107, 48];
const DESK_FRONT: RGB = [122, 74, 33];
const SKIN: RGB = [242, 198, 155];
const HAIR: RGB = [60, 42, 28];
const SHIRT: RGB = [245, 245, 240];
const PANTS: RGB = [52, 58, 74];
const BOX: RGB = [186, 138, 84];
const PLANT: RGB = [46, 139, 87];

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

// Top meme band.
fillRect(0, 0, W, 196, NAVY);
fillRect(0, 196, W, 6, YELLOW);
drawText("MY AI AGENT", 512, 28, 9, YELLOW, BLACK, 3);
drawText("WENT ROGUE", 512, 118, 9, YELLOW, BLACK, 3);

// Office scene.
fillRect(0, 202, W, 618, WALL);
// Floor.
fillRect(0, 700, W, 120, FLOOR);
fillRect(0, 700, W, 6, FLOOR_DARK);
for (let x = 0; x < W; x += 128) {
  fillRect(x, 706, 4, 114, FLOOR_DARK);
}

// Window (right): sky, sun, skyline, clouds.
fillRect(724, 236, 260, 300, WHITE);
fillRect(734, 246, 240, 280, SKY);
fillCircle(920, 300, 34, YELLOW);
fillEllipse(790, 300, 42, 14, WHITE);
fillEllipse(880, 340, 52, 16, WHITE);
fillRect(734, 420, 60, 106, [110, 125, 145]);
fillRect(800, 380, 70, 146, [90, 105, 128]);
fillRect(876, 440, 56, 86, [125, 140, 160]);
fillRect(936, 400, 38, 126, [100, 115, 135]);
// Cross bars drawn after the buildings so the frame stays on top.
thickLine(854, 246, 854, 526, 8, WHITE);
thickLine(734, 386, 974, 386, 8, WHITE);

// Wall clock (5 o'clock: quitting time).
fillCircle(648, 292, 36, WHITE);
roundRectOutline(612, 256, 72, 72, 36, 5, BLACK);
thickLine(648, 292, 648, 266, 5, BLACK);
thickLine(648, 292, 668, 302, 5, BLACK);
fillCircle(648, 292, 5, BLACK);

// Framed "Employee of the Month" photo (left wall): a tiny robot portrait.
fillRect(48, 250, 150, 130, [122, 74, 33]);
fillRect(58, 260, 130, 110, WHITE);
fillCircle(123, 305, 26, SILVER);
fillRect(112, 296, 8, 8, BLACK);
fillRect(126, 296, 8, 8, BLACK);
thickLine(112, 322, 134, 322, 4, BLACK);
fillRect(100, 348, 46, 10, YELLOW);

// ---- Human employee, walking away left with a cardboard box ----
const HX = 150;
// Legs (mid-stride).
thickLine(HX - 12, 730, HX - 30, 806, 16, PANTS);
thickLine(HX + 12, 730, HX + 34, 806, 16, PANTS);
// Shoes.
fillEllipse(HX - 32, 810, 18, 8, BLACK);
fillEllipse(HX + 38, 810, 18, 8, BLACK);
// Shirt torso, slightly slumped.
fillPoly([[HX - 26, 640], [HX + 26, 640], [HX + 20, 736], [HX - 20, 736]], SHIRT);
thickLine(HX - 4, 648, HX - 2, 700, 8, TIE_RED); // loosened tie
// Arms reaching forward to the box.
thickLine(HX + 14, 668, HX + 52, 700, 12, SHIRT);
// Head: skin first, then a hair cap that only covers the top half.
fillCircle(HX, 608, 27, SKIN);
fillEllipse(HX, 586, 27, 16, HAIR);
fillCircle(HX - 10, 604, 4, BLACK); // eye (downcast)
thickLine(HX - 18, 624, HX - 2, 626, 3, BLACK); // sad mouth
// Cardboard box with plant + papers.
fillRect(HX + 34, 668, 92, 62, BOX);
fillRect(HX + 34, 668, 92, 8, [160, 112, 62]);
fillPoly([[HX + 58, 668], [HX + 72, 620], [HX + 86, 668]], PLANT);
fillPoly([[HX + 86, 668], [HX + 100, 626], [HX + 112, 668]], PLANT);
fillRect(HX + 92, 640, 26, 30, WHITE);
thickLine(HX + 92, 648, HX + 118, 648, 2, BLACK);

// ---- Robot boss, center-right, behind the desk ----
// Chair back.
roundRect(452, 468, 216, 200, 26, STEEL);
roundRect(468, 484, 184, 168, 20, [74, 80, 94]);
// Torso.
roundRect(478, 556, 164, 150, 24, SILVER);
roundRectOutline(478, 556, 164, 150, 24, 5, BLACK);
// Chest screen.
fillRect(516, 580, 88, 44, NAVY);
fillRect(528, 592, 64, 6, CYAN);
fillRect(528, 606, 44, 6, CYAN);
// Tie.
fillPoly([[546, 556], [574, 556], [568, 596], [560, 640], [552, 596]], TIE_RED);
// Head.
roundRect(488, 420, 144, 140, 30, SILVER);
roundRectOutline(488, 420, 144, 140, 30, 5, BLACK);
// Antenna + red ball.
thickLine(560, 420, 560, 382, 6, STEEL);
fillCircle(560, 372, 12, RED);
// Ears.
fillRect(476, 470, 12, 34, SILVER_DARK);
fillRect(632, 470, 12, 34, SILVER_DARK);
// Smug half-lidded eyes (cyan glow).
fillRect(508, 470, 40, 20, CYAN);
fillRect(572, 470, 40, 20, CYAN);
fillRect(508, 470, 40, 8, BLACK);
fillRect(572, 470, 40, 8, BLACK);
// Smug grin.
thickLine(520, 516, 548, 530, 6, BLACK);
thickLine(548, 530, 600, 514, 6, BLACK);
// Left arm raised, holding the "BOSS" mug.
thickLine(640, 590, 700, 540, 20, SILVER);
thickLine(700, 540, 716, 486, 20, SILVER);
fillCircle(716, 486, 12, SILVER);
fillRect(700, 448, 44, 44, WHITE);
roundRectOutline(700, 448, 44, 44, 6, 4, BLACK);
fillRect(700, 462, 44, 10, TIE_RED);
fillRect(744, 458, 14, 22, WHITE);
roundRectOutline(744, 458, 14, 22, 4, 4, BLACK);
// Right arm resting on the desk.
thickLine(480, 600, 420, 656, 20, SILVER);

// Speech bubble: "NEXT!" (tail connects bubble bottom to the robot's head).
fillPoly([[430, 362], [466, 362], [536, 428]], WHITE);
roundRect(290, 262, 280, 100, 22, WHITE);
roundRectOutline(290, 262, 280, 100, 22, 5, BLACK);
drawText("NEXT!", 430, 292, 8, BLACK, null, 0);

// Desk.
fillRect(300, 640, 560, 28, DESK_TOP);
fillRect(300, 668, 560, 152, DESK_FRONT);
fillRect(300, 668, 560, 6, [90, 52, 22]);
// Nameplate "CEO".
fillRect(486, 690, 150, 52, WHITE);
roundRectOutline(486, 690, 150, 52, 6, 4, BLACK);
drawText("CEO", 561, 700, 6, BLACK, null, 0);

// Bottom meme band.
fillRect(0, 820, W, 204, RED);
fillRect(0, 820, W, 6, YELLOW);
drawText("IT FIRED ME.", 512, 892, 12, WHITE, BLACK, 4);

// ---------------------------------------------------------------------------
// PNG encoder (8-bit RGB, filter 0, zlib deflate).
// ---------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcData = new Uint8Array(4 + data.length);
  crcData.set(out.subarray(4, 8 + data.length));
  dv.setUint32(8 + data.length, crc32(crcData));
  return out;
}

function encodePng(): Uint8Array {
  const raw = new Uint8Array(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4;
      const d = y * (1 + W * 3) + 1 + x * 3;
      raw[d] = buf[s];
      raw[d + 1] = buf[s + 1];
      raw[d + 2] = buf[s + 2];
    }
  }
  const idat = deflateSync(raw, { level: 6 });
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, W);
  dv.setUint32(4, H);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const png = encodePng();
mkdirSync("/output", { recursive: true });
writeFileSync("/output/entry.png", png);
console.log(`wrote /output/entry.png (${png.length} bytes, ${W}x${H})`);
