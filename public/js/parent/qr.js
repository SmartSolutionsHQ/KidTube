// A small QR code encoder for guest-code cards: byte mode, error correction L or M, versions 1 to 10
// (up to 213 bytes at M). No DOM and no dependencies, so the tests import it in Node.
//
//   const qr = encodeQr('https://videos.example.com')   → { version, size, level, mask, modules: boolean[][] }
//   qrPath(qr)                                          → an SVG path "d" with one square per dark module,
//                                                         drawn inside a 4-module quiet zone ((size + 8) units wide)
//
// The layout follows ISO/IEC 18004: finder, timing and alignment patterns, format and version information,
// Reed-Solomon blocks interleaved, and the mask with the lowest penalty.

// [error correction codewords per block, [blocks, data codewords per block], ...more groups], by version 1..10.
export const BLOCKS = {
  L: [[7, [1, 19]], [10, [1, 34]], [15, [1, 55]], [20, [1, 80]], [26, [1, 108]], [18, [2, 68]], [20, [2, 78]],
    [24, [2, 97]], [30, [2, 116]], [18, [2, 68], [2, 69]]],
  M: [[10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]], [16, [4, 27]], [18, [4, 31]],
    [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]]],
};
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const REMAINDER = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0];
export const LEVEL_BITS = { L: 1, M: 0 };
export const MAX_VERSION = 10;

/* ---------- GF(256) and Reed-Solomon ---------- */
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
export const gfMul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
export const gfExp = i => EXP[i % 255];

function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) { next[j] ^= poly[j]; next[j + 1] ^= gfMul(poly[j], EXP[i]); }
    poly = next;
  }
  return poly;
}

// The error correction codewords for one block of data codewords.
export function reedSolomon(data, degree) {
  const gen = generator(degree);
  const rest = [...data, ...new Array(degree).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const factor = rest[i];
    if (factor) for (let j = 0; j < gen.length; j++) rest[i + j] ^= gfMul(gen[j], factor);
  }
  return rest.slice(data.length);
}

/* ---------- data codewords ---------- */
export const capacity = (version, level) => BLOCKS[level][version - 1].slice(1).reduce((sum, [n, k]) => sum + n * k, 0);
const countBits = version => (version < 10 ? 8 : 16);

function dataCodewords(bytes, version, level) {
  const bits = [];
  const push = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);
  const total = capacity(version, level) * 8;
  push(0, Math.min(4, total - bits.length));
  while (bits.length % 8) bits.push(0);
  const words = [];
  for (let i = 0; i < bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  for (let pad = 0xec; words.length < total / 8; pad ^= 0xec ^ 0x11) words.push(pad);
  return words;
}

// Splits the data into blocks, adds error correction and interleaves both, as the symbol stores them.
export function finalCodewords(data, version, level) {
  const [ec, ...groups] = BLOCKS[level][version - 1];
  const blocks = [];
  let at = 0;
  for (const [count, size] of groups) for (let b = 0; b < count; b++) { blocks.push(data.slice(at, at + size)); at += size; }
  const ecs = blocks.map(block => reedSolomon(block, ec));
  const out = [];
  const longest = Math.max(...blocks.map(block => block.length));
  for (let i = 0; i < longest; i++) for (const block of blocks) if (i < block.length) out.push(block[i]);
  for (let i = 0; i < ec; i++) for (const block of ecs) out.push(block[i]);
  return out;
}

/* ---------- format and version information ---------- */
export function formatBits(level, mask) {
  const data = (LEVEL_BITS[level] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

export function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

/* ---------- the matrix ---------- */
// Function patterns for a version: which modules are fixed, and their colours. x is the column, y the row.
export function functionModules(version) {
  const size = version * 4 + 17;
  const dark = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, value) => { if (x >= 0 && y >= 0 && x < size && y < size) { dark[y][x] = value; fixed[y][x] = true; } };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(cx + dx, cy + dy, d !== 2 && d !== 4);
    }
  }
  const centers = ALIGN[version - 1];
  for (const cy of centers) for (const cx of centers) {
    if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // Reserve the format areas (filled once the mask is known) and draw the version blocks.
  for (const [x, y] of formatPositions(size)) set(x, y, false);
  set(8, size - 8, true);
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const on = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, on);
      set(b, a, on);
    }
  }
  return { size, dark, fixed };
}

// Where the 15 format bits go, as [x, y, bit]: one copy around the top-left finder, one split between
// the other two.
export function* formatPositions(size) {
  for (let i = 0; i <= 5; i++) yield [8, i, i];
  yield [8, 7, 6];
  yield [8, 8, 7];
  yield [7, 8, 8];
  for (let i = 9; i < 15; i++) yield [14 - i, 8, i];
  for (let i = 0; i < 8; i++) yield [size - 1 - i, 8, i];
  for (let i = 8; i < 15; i++) yield [8, size - 15 + i, i];
}

export function drawFormat(dark, size, bits) {
  for (const [x, y, i] of formatPositions(size)) dark[y][x] = ((bits >>> i) & 1) === 1;
  dark[size - 8][8] = true;
}

export const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

// The order the symbol stores codeword bits in: two-column strips from the right, up then down, skipping
// the vertical timing column. Shared with the tests' decoder.
export function* dataOrder(size, fixed) {
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fixed[y][x]) yield [x, y];
      }
    }
  }
}

function penalty(m) {
  const size = m.length;
  let score = 0;
  const lines = [];
  for (let i = 0; i < size; i++) { lines.push(m[i]); lines.push(m.map(row => row[i])); }
  const finder = [true, false, true, true, true, false, true];
  for (const line of lines) {
    for (let i = 0, run = 1; i < size; i++) {
      if (i > 0 && line[i] === line[i - 1]) run++; else run = 1;
      if (run === 5) score += 3; else if (run > 5) score++;
    }
    for (let i = 0; i + 7 <= size; i++) {
      if (!finder.every((v, k) => line[i + k] === v)) continue;
      const before = i >= 4 && [1, 2, 3, 4].every(k => !line[i - k]);
      const after = i + 11 <= size && [7, 8, 9, 10].every(k => !line[i + k]);
      if (before || after) score += 40;
    }
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
  }
  const dark = m.reduce((n, row) => n + row.filter(Boolean).length, 0);
  score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return score;
}

export class QrError extends Error {}

// Encodes text (UTF-8) in the smallest version that fits. level: 'M' (default, survives some smudging) or 'L'.
export function encodeQr(text, { level = 'M', mask: forcedMask = null, minVersion = 1 } = {}) {
  if (!BLOCKS[level]) throw new QrError('Use error correction L or M.');
  const bytes = [...new TextEncoder().encode(String(text))];
  let version = Math.max(1, minVersion);
  while (version <= MAX_VERSION && 4 + countBits(version) + bytes.length * 8 > capacity(version, level) * 8) version++;
  if (version > MAX_VERSION) throw new QrError('That is too long for a QR code on this card.');
  const codewords = finalCodewords(dataCodewords(bytes, version, level), version, level);
  const base = functionModules(version);
  const { size, fixed } = base;
  const plain = base.dark.map(row => row.slice());
  let index = 0;
  const total = codewords.length * 8;
  for (const [x, y] of dataOrder(size, fixed)) {
    plain[y][x] = index < total ? ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) === 1 : false;
    index++;
  }
  if (index !== total + REMAINDER[version - 1]) throw new QrError('Internal QR layout error.');
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    if (forcedMask !== null && mask !== forcedMask) continue;
    const modules = plain.map((row, y) => row.map((on, x) => (fixed[y][x] ? on : on !== MASKS[mask](x, y))));
    drawFormat(modules, size, formatBits(level, mask));
    const score = penalty(modules);
    if (!best || score < best.score) best = { mask, modules, score };
  }
  return { version, size, level, mask: best.mask, modules: best.modules };
}

// One square per dark module, offset by the 4-module quiet zone. Use viewBox="0 0 (size+8) (size+8)".
export function qrPath({ modules }) {
  const parts = [];
  modules.forEach((row, y) => row.forEach((on, x) => { if (on) parts.push(`M${x + 4} ${y + 4}h1v1h-1z`); }));
  return parts.join('');
}
