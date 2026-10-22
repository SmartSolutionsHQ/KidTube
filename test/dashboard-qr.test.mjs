import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr, formatBits, qrPath, reedSolomon, versionBits, QrError } from '../public/js/parent/qr.js';

// A decoder written from the standard, sharing no code with the encoder: it finds the function patterns,
// reads the format bits, unmasks, walks the codewords, checks every Reed-Solomon block and reads the bytes.
const SPEC = {
  // version: [ec per block, [[blocks, data per block], ...]] for level M, and L for the versions tested.
  M: { 1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]], 6: [16, [[4, 27]]],
    7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]] },
  L: { 1: [7, [[1, 19]]], 3: [15, [[1, 55]]], 7: [20, [[2, 78]]], 10: [18, [[2, 68], [2, 69]]] },
};
const ALIGNMENT = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

const gf = (() => {
  const exp = [], log = [];
  for (let i = 0, x = 1; i < 255; i++) { exp[i] = x; log[x] = i; x = x * 2 >= 256 ? (x * 2) ^ 0x11d : x * 2; }
  const mul = (a, b) => (a === 0 || b === 0 ? 0 : exp[(log[a] + log[b]) % 255]);
  return { exp, mul };
})();

function bchRemainder(value, poly, degree) {
  let rem = value << degree;
  for (let bit = 31; bit >= degree; bit--) if (rem & (1 << bit)) rem ^= poly << (bit - degree);
  return rem;
}

function decode(m) {
  const size = m.length;
  const version = (size - 17) / 4;
  assert.ok(Number.isInteger(version) && version >= 1, 'square of a QR size');
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (r0, r1, c0, c1) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) reserved[r][c] = true; };
  mark(0, 8, 0, 8); mark(0, 8, size - 8, size - 1); mark(size - 8, size - 1, 0, 8);
  mark(6, 6, 0, size - 1); mark(0, size - 1, 6, 6);
  const centers = ALIGNMENT[version] || [];
  const last = centers.at(-1);
  for (const r of centers) for (const c of centers) {
    if ((r === 6 && c === 6) || (r === 6 && c === last) || (r === last && c === 6)) continue;
    mark(r - 2, r + 2, c - 2, c + 2);
  }
  if (version >= 7) { mark(0, 5, size - 11, size - 9); mark(size - 11, size - 9, 0, 5); }

  // finder patterns: a dark 7x7 ring, a light ring, a dark 3x3 core
  for (const [r, c] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
      const ring = Math.min(i, j, 6 - i, 6 - j);
      assert.equal(m[r + i][c + j], ring !== 1, `finder at ${r},${c}`);
    }
  }
  for (let i = 8; i < size - 8; i++) { assert.equal(m[6][i], i % 2 === 0, 'timing row'); assert.equal(m[i][6], i % 2 === 0, 'timing column'); }
  assert.equal(m[size - 8][8], true, 'the dark module');

  let format = 0;
  for (const [r, c] of [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]) {
    format = (format << 1) | (m[r][c] ? 1 : 0);
  }
  let second = 0;
  for (let i = 0; i < 7; i++) second = (second << 1) | (m[size - 1 - i][8] ? 1 : 0);
  for (let i = 0; i < 8; i++) second = (second << 1) | (m[8][size - 8 + i] ? 1 : 0);
  assert.equal(second, format, 'both format copies agree');
  format ^= 0x5412;
  assert.equal(bchRemainder(format >>> 10, 0x537, 10), format & 0x3ff, 'format BCH');
  const level = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' }[format >>> 13];
  const mask = (format >>> 10) & 7;
  if (version >= 7) {
    let bits = 0;
    for (let i = 17; i >= 0; i--) bits = (bits << 1) | (m[Math.floor(i / 3)][size - 11 + (i % 3)] ? 1 : 0);
    assert.equal(bits >>> 12, version, 'version information');
    assert.equal(bchRemainder(version, 0x1f25, 12), bits & 0xfff, 'version BCH');
  }

  const flip = [
    (i, j) => (i + j) % 2 === 0, i => i % 2 === 0, (i, j) => j % 3 === 0, (i, j) => (i + j) % 3 === 0,
    (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0, (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
    (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0, (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
  ][mask];
  const bits = [];
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (let n = 0; n < size; n++) {
      const row = upward ? size - 1 - n : n;
      for (const c of [col, col - 1]) if (!reserved[row][c]) bits.push(m[row][c] !== flip(row, c) ? 1 : 0);
    }
    upward = !upward;
  }
  const words = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((v, b) => v * 2 + b, 0));

  const [ec, groups] = SPEC[level][version];
  const sizes = groups.flatMap(([n, k]) => new Array(n).fill(k));
  const blocks = sizes.map(() => []);
  let at = 0;
  for (let i = 0; i < Math.max(...sizes); i++) sizes.forEach((k, b) => { if (i < k) blocks[b].push(words[at++]); });
  for (let i = 0; i < ec; i++) blocks.forEach(block => block.push(words[at++]));
  for (const block of blocks) {
    for (let s = 0; s < ec; s++) {
      let syndrome = 0;
      for (const value of block) syndrome = gf.mul(syndrome, gf.exp[s]) ^ value;
      assert.equal(syndrome, 0, 'every Reed-Solomon syndrome is zero');
    }
  }
  const data = blocks.flatMap((block, b) => block.slice(0, sizes[b]));
  const stream = data.flatMap(byte => [7, 6, 5, 4, 3, 2, 1, 0].map(k => (byte >> k) & 1));
  const read = (from, n) => stream.slice(from, from + n).reduce((v, b) => v * 2 + b, 0);
  assert.equal(read(0, 4), 0b0100, 'byte mode');
  const countBits = version < 10 ? 8 : 16;
  const length = read(4, countBits);
  const bytes = Array.from({ length }, (_, i) => read(4 + countBits + i * 8, 8));
  return { text: new TextDecoder().decode(new Uint8Array(bytes)), version, level, mask };
}

test('Reed-Solomon and the BCH codes match the standard\'s worked values', () => {
  // ISO 18004 / Thonky's 1-M "HELLO WORLD" block.
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(reedSolomon(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  assert.equal(formatBits('M', 0).toString(2).padStart(15, '0'), '101010000010010');
  assert.equal(formatBits('L', 0).toString(2).padStart(15, '0'), '111011111000100');
  assert.equal(formatBits('L', 4).toString(2).padStart(15, '0'), '110011000101111');
  assert.equal(versionBits(7).toString(2).padStart(18, '0'), '000111110010010100');
  assert.equal(versionBits(10).toString(2).padStart(18, '0'), '001010010011010011');
});

test('what the encoder draws, the decoder reads back', () => {
  const samples = [
    'K7Q2', 'http://192.168.1.20:3000', 'https://videos.halvorsen.example', 'Guest code ZX9P for Ezra',
    'Zoë and Ané 🎬 watch together', 'x'.repeat(100), 'y'.repeat(130), 'https://a-much-longer-family-address.example.org/'.repeat(4).slice(0, 200),
  ];
  const versions = new Set();
  for (const text of samples) {
    for (const level of ['M', 'L']) {
      const qr = encodeQr(text, { level });
      if (!SPEC[level][qr.version]) continue;
      const out = decode(qr.modules);
      assert.equal(out.text, text);
      assert.equal(out.version, qr.version);
      assert.equal(out.level, level);
      assert.equal(out.mask, qr.mask);
      versions.add(qr.version);
    }
  }
  assert.ok(versions.has(1) && versions.has(10) && [...versions].some(v => v >= 7 && v < 10), [...versions].join());
  for (let mask = 0; mask < 8; mask++) assert.equal(decode(encodeQr('every mask', { mask }).modules).text, 'every mask');
  for (let v = 1; v <= 10; v++) assert.equal(decode(encodeQr('v', { minVersion: v }).modules).version, v);
});

test('sizes, limits and the SVG path', () => {
  assert.equal(encodeQr('K7Q2').size, 21);
  assert.equal(encodeQr('x'.repeat(213)).version, 10);
  assert.throws(() => encodeQr('x'.repeat(214)), QrError);
  assert.throws(() => encodeQr('x', { level: 'H' }), QrError);
  const qr = encodeQr('K7Q2');
  const path = qrPath(qr);
  const squares = path.match(/M\d+ \d+h1v1h-1z/g);
  assert.equal(squares.length, qr.modules.flat().filter(Boolean).length);
  assert.equal(path, squares.join(''), 'nothing but squares');
  assert.ok(squares.every(square => { const [x, y] = square.slice(1).split(/[ h]/).map(Number); return x >= 4 && y >= 4 && x < 25 && y < 25; }));
});
