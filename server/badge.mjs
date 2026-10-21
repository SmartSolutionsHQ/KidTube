import { readFileSync } from 'node:fs';
import { FONTS, BadgeSpecError, normalizeSpec } from '../public/js/badge/spec.js';
import { renderBadge, stickerMap } from '../public/js/badge/render.js';

// The server draws every badge itself with the same renderer the builder previews with, from a spec
// that passed the whitelist. Glyph tables and stickers are committed data, read once.
const BADGE_DIR = new URL('../public/badge/', import.meta.url);
let data;

export function badgeData() {
  if (!data) {
    const read = name => JSON.parse(readFileSync(new URL(name, BADGE_DIR), 'utf8'));
    const glyphs = {};
    for (const font of FONTS) if (font.file) glyphs[font.id] = read(`glyphs/${font.file}.json`);
    data = { glyphs, stickers: stickerMap(read('stickers.json')) };
  }
  return data;
}

// Validates a spec from a client and returns the clean spec with its SVG; throws BadgeSpecError.
export function renderSpec(input) {
  const { glyphs, stickers } = badgeData();
  const spec = normalizeSpec(input, { stickerIds: new Set(Object.keys(stickers)) });
  return { spec, svg: renderBadge(spec, { glyphs, stickers }) };
}

export { BadgeSpecError };
