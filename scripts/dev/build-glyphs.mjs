#!/usr/bin/env node
// Maintainer only: turns the badge fonts into committed glyph tables, so badges draw names as plain
// paths and never ship or load a font. Run with `node scripts/dev/build-glyphs.mjs` after changing a
// font; the output is deterministic. Fonts are downloaded once into scripts/dev/.cache (gitignored).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseFont, contoursToPath } from './truetype.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const CACHE = join(import.meta.dirname, '.cache');
const OUT = join(ROOT, 'public/badge/glyphs');
const LICENSES = join(ROOT, 'public/badge/licenses');
const SOURCE = 'https://raw.githubusercontent.com/google/fonts/main/ofl/';

// Tables get neutral names: the converted outlines are not the original font software, and two of the
// fonts reserve their names under the OFL.
const FONTS = [
  { id: 'anton', file: 'tall', family: 'Anton', path: 'anton/Anton-Regular.ttf' },
  { id: 'creepster', file: 'spooky', family: 'Creepster', path: 'creepster/Creepster-Regular.ttf' },
  { id: 'pixel', file: 'pixel', family: 'Press Start 2P', path: 'pressstart2p/PressStart2P-Regular.ttf' },
  { id: 'bangers', file: 'comic', family: 'Bangers', path: 'bangers/Bangers-Regular.ttf' },
];

// Printable Latin-1: what the badge spec allows in a name.
export const CHARSET = [];
for (let code = 0x20; code <= 0x7e; code++) CHARSET.push(code);
for (let code = 0xa0; code <= 0xff; code++) CHARSET.push(code);

async function cached(path) {
  const file = join(CACHE, path);
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    const response = await fetch(SOURCE + path);
    if (!response.ok) throw new Error(`Download failed for ${path}: ${response.status}`);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  return readFileSync(file);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(LICENSES, { recursive: true });
for (const font of FONTS) {
  const bytes = await cached(font.path);
  const license = (await cached(join(dirname(font.path), 'OFL.txt'))).toString('utf8');
  const parsed = parseFont(bytes);
  const glyphs = {};
  const missing = [];
  for (const code of CHARSET) {
    const glyph = parsed.cmap.get(code);
    if (glyph === undefined) { missing.push(code); continue; }
    glyphs[String.fromCharCode(code)] = [parsed.advance(glyph), contoursToPath(parsed.contours(glyph))];
  }
  const capHeight = parsed.capHeight || Math.round(parsed.ascender * 0.7);
  const table = {
    font: font.id,
    license: `Outlines from ${font.family}, SIL Open Font License 1.1; see /badge/licenses/OFL-${font.file}.txt`,
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    unitsPerEm: parsed.unitsPerEm, ascender: parsed.ascender, descender: parsed.descender, capHeight,
    glyphs,
  };
  writeFileSync(join(OUT, `${font.file}.json`), JSON.stringify(table) + '\n');
  writeFileSync(join(LICENSES, `OFL-${font.file}.txt`),
    `The badge glyph table public/badge/glyphs/${font.file}.json holds outlines converted from the font\n` +
    `"${font.family}" (${SOURCE}${font.path}). The conversion is a Modified Version under the license\n` +
    `below and is distributed under the same SIL Open Font License 1.1.\n\n${license}`);
  const size = Buffer.byteLength(JSON.stringify(table));
  console.log(`${font.file}.json  ${Object.keys(glyphs).length} glyphs  ${(size / 1024).toFixed(1)} KB` +
    (missing.length ? `  missing: ${missing.map(code => code.toString(16)).join(' ')}` : ''));
}
