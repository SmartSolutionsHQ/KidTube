#!/usr/bin/env node
// Maintainer only: draws the default home-screen icons (the mark from public/assets/logo.svg on void)
// for installs that have no family badge yet. Run with `node scripts/dev/build-icons.mjs` after changing
// the mark; the output is deterministic. A family's own badge icons replace these once a parent saves one.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const OUT = resolve(import.meta.dirname, '../../public/assets/icons');
const VOID = [0x05, 0x06, 0x0a];
// size: pixels; fill: how much of the icon the mark's 120-unit box takes. Maskable icons keep the mark
// inside the 80% safe circle that launchers crop to.
const ICONS = [
  { file: 'icon-192.png', size: 192, fill: 0.8 },
  { file: 'icon-512.png', size: 512, fill: 0.8 },
  { file: 'icon-maskable-512.png', size: 512, fill: 0.6 },
  { file: 'apple-touch-icon.png', size: 180, fill: 0.72 },
];
const SAMPLES = 4;

const hex = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
// The mark, in logo.svg's own units (viewBox 0 0 120 120, shifted down 5), drawn back to front.
const roundRect = (x, y, w, h, r) => (px, py) => {
  const dx = Math.max(Math.abs(px - (x + w / 2)) - (w / 2 - r), 0);
  const dy = Math.max(Math.abs(py - (y + h / 2)) - (h / 2 - r), 0);
  return Math.abs(px - (x + w / 2)) <= w / 2 && Math.abs(py - (y + h / 2)) <= h / 2 && dx * dx + dy * dy <= r * r;
};
const triangle = (a, b, c) => (px, py) => {
  const side = (p, q) => (q[0] - p[0]) * (py - p[1]) - (q[1] - p[1]) * (px - p[0]);
  const s1 = side(a, b), s2 = side(b, c), s3 = side(c, a);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
};
const stroke = (points, width) => (px, py) => points.slice(1).some((q, i) => {
  const p = points[i], vx = q[0] - p[0], vy = q[1] - p[1];
  const t = Math.max(0, Math.min(1, ((px - p[0]) * vx + (py - p[1]) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - p[0] - t * vx, py - p[1] - t * vy) <= width / 2;
});
const SHAPES = [
  { inside: stroke([[44, 21], [60, 35], [76, 15]], 6), color: hex('#F7F4EC'), alpha: 1 },
  { inside: roundRect(2, 35, 108, 76, 18), color: hex('#4DF6FF'), alpha: 0.6 },
  { inside: roundRect(10, 35, 108, 76, 18), color: hex('#FF3D55'), alpha: 0.6 },
  { inside: roundRect(6, 35, 108, 76, 18), color: hex('#FF5C2B'), alpha: 1 },
  { inside: triangle([50, 57], [76, 73], [50, 89]), color: hex('#F7F4EC'), alpha: 1 },
];
// The mark's visual centre in those units, so it sits in the middle of the square.
const CENTRE = [60, 61.5];

function draw(size, fill) {
  const unit = (size * fill) / 120;
  const pixels = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const ux = (x + (sx + 0.5) / SAMPLES - size / 2) / unit + CENTRE[0];
          const uy = (y + (sy + 0.5) / SAMPLES - size / 2) / unit + CENTRE[1];
          let color = VOID;
          for (const shape of SHAPES) {
            if (shape.inside(ux, uy)) color = color.map((c, i) => c + (shape.color[i] - c) * shape.alpha);
          }
          for (let i = 0; i < 3; i++) sum[i] += color[i];
        }
      }
      for (let i = 0; i < 3; i++) pixels[(y * size + x) * 3 + i] = Math.round(sum[i] / (SAMPLES * SAMPLES));
    }
  }
  return pixels;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  const rows = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) pixels.copy(rows, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const { file, size, fill } of ICONS) {
  const bytes = png(size, draw(size, fill));
  writeFileSync(join(OUT, file), bytes);
  console.log(`${file}: ${size}px, ${bytes.length} bytes`);
}
