// Loads the badge data the renderer needs: the sticker catalog up front, each font's glyph table the
// first time a badge uses it. Shared by the builder, save.js and any page that draws badges from specs.
import { FONTS } from './spec.js';
import { stickerMap } from './render.js';

const loaders = new Map();

export function createBadgeData(base = '/badge/') {
  if (loaders.has(base)) return loaders.get(base);
  const glyphs = {};
  const pending = new Map();
  let catalog = null;
  let stickers = null;

  async function getJson(path) {
    const response = await fetch(new URL(path, new URL(base, location.href)));
    if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`);
    return response.json();
  }

  async function loadStickers() {
    if (!catalog) {
      catalog = await getJson('stickers.json');
      stickers = stickerMap(catalog);
    }
    return catalog;
  }

  function loadFont(id) {
    const font = FONTS.find(item => item.id === id);
    if (!font?.file || glyphs[id]) return Promise.resolve(glyphs[id] || null);
    if (!pending.has(id)) {
      pending.set(id, getJson(`glyphs/${font.file}.json`).then(table => { glyphs[id] = table; return table; })
        .finally(() => pending.delete(id)));
    }
    return pending.get(id);
  }

  // Everything one spec needs, ready for renderBadge(spec, data).
  async function forSpec(spec) {
    await Promise.all([loadStickers(), loadFont(spec?.text?.font)]);
    return { glyphs, stickers };
  }

  const data = { loadStickers, loadFont, forSpec, get glyphs() { return glyphs; }, get stickers() { return stickers; }, get catalog() { return catalog; } };
  loaders.set(base, data);
  return data;
}
