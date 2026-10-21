// The one badge renderer, shared by the builder preview and the server. Pure and deterministic: the same
// spec and data give byte-identical SVG in every browser and in Node. Only whitelisted elements and
// attributes come out (svg, title, g, path, text), every value is escaped, and names are drawn as paths
// from committed glyph tables, so a saved badge looks the same everywhere and carries no font or script.
import { CHALK, INK, normalizeSpec } from './spec.js';

const SIZE = 200;
// Shapes sit inside 10..190 so outline, shadow and tilt stay on the canvas. Literals, not computed,
// so no engine's trigonometry can change a byte.
const SHAPE_PATHS = {
  circle: 'M100 12A88 88 0 1 1 100 188A88 88 0 1 1 100 12Z',
  rounded: 'M52 16H148Q184 16 184 52V148Q184 184 148 184H52Q16 184 16 148V52Q16 16 52 16Z',
  shield: 'M100 12L180 38V98C180 146 146 178 100 190C54 178 20 146 20 98V38Z',
  star: 'M100 12L125.9 68.4L187.5 75.6L141.8 117.6L154.1 178.4L100 148L45.9 178.4L58.2 117.6L12.5 75.6L74.1 68.4Z',
  hexagon: 'M100 10L178 55V145L100 190L22 145V55Z',
  burst: 'M100 10L116.7 26.9L139 18.9L146.8 41.4L170.4 43.9L167.6 67.5L187.7 80L175 100L187.7 120L167.6 132.5' +
    'L170.4 156.1L146.8 158.6L139 181.1L116.7 173.1L100 190L83.3 173.1L61 181.1L53.2 158.6L29.6 156.1L32.4 132.5' +
    'L12.3 120L25 100L12.3 80L32.4 67.5L29.6 43.9L53.2 41.4L61 18.9L83.3 26.9Z',
  blob: 'M100 16C148 14 186 48 182 100C178 148 144 186 98 184C48 182 16 148 18 100C20 54 52 18 100 16Z',
  ticket: 'M16 54H184V86A14 14 0 0 0 184 114V146H16V114A14 14 0 0 0 16 86Z',
  tv: 'M42 64H158Q182 64 182 88V160Q182 184 158 184H42Q18 184 18 160V88Q18 64 42 64Z',
};
const TV_ANTENNA = 'M78 36L100 56L122 28';
// Where the name goes: centre, widest line, tallest capital.
const TEXT_BOX = {
  circle: { cx: 100, cy: 100, w: 140, h: 64 }, rounded: { cx: 100, cy: 100, w: 148, h: 70 },
  shield: { cx: 100, cy: 94, w: 128, h: 60 }, star: { cx: 100, cy: 108, w: 70, h: 34 },
  hexagon: { cx: 100, cy: 100, w: 128, h: 60 }, burst: { cx: 100, cy: 100, w: 120, h: 56 },
  blob: { cx: 100, cy: 100, w: 140, h: 64 }, ticket: { cx: 100, cy: 100, w: 140, h: 52 },
  tv: { cx: 100, cy: 124, w: 130, h: 58 },
};
const SPLIT = [{ dx: -3, fill: '#4DF6FF' }, { dx: 3, fill: '#FF3D55' }];
const SYSTEM_FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

export const SHAPE_IDS = Object.keys(SHAPE_PATHS);

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeXml = value => String(value).replace(/[&<>"']/g, char => ESCAPES[char]);
// toFixed and Number-to-string are exactly specified, so these strings match across engines.
const num = (value, digits = 2) => String(Number(value.toFixed(digits)) || 0);

function element(name, attrs, children = '') {
  const list = Object.entries(attrs).filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`).join('');
  return children ? `<${name}${list}>${children}</${name}>` : `<${name}${list}/>`;
}

// Light fills get an ink outline, everything else a chalk one, like a sticker on a dark wall.
const isLight = hex => [1, 3, 5].every(at => parseInt(hex.slice(at, at + 2), 16) >= 0xd0);

// One path for the whole name, in font units with y up; each glyph's leading relative move becomes an
// absolute move to its pen position, so the glyphs' own relative commands carry on unchanged.
export function textPath(value, table) {
  let d = '', pen = 0;
  const space = table.glyphs[' '] ? table.glyphs[' '][0] : table.unitsPerEm / 3;
  for (const char of value) {
    const glyph = table.glyphs[char];
    if (!glyph) { pen += space; continue; }
    const [advance, outline] = glyph;
    const lead = /^m(-?\d+)\s?(-?\d+)/.exec(outline);
    if (outline && !lead) throw new Error('Unexpected glyph data.');
    if (lead) d += `M${pen + Number(lead[1])} ${lead[2]}${outline.slice(lead[0].length)}`;
    pen += advance;
  }
  return { d, width: pen };
}

function textLayers(spec, glyphs) {
  const { value, font, color } = spec.text;
  if (!value) return '';
  const box = TEXT_BOX[spec.shape];
  const fills = [...(spec.effects.rgbSplit ? SPLIT : []), { dx: 0, fill: color }];
  if (font === 'system') {
    // The device draws this one, so the size is an estimate: about 0.62 em per letter, caps 0.72 em.
    const size = Math.min(box.h / 0.72, box.w / (value.length * 0.62));
    const y = box.cy + size * 0.36;
    return fills.map(({ dx, fill }) => element('text', {
      x: num(box.cx + dx), y: num(y), 'text-anchor': 'middle', 'font-family': SYSTEM_FONT, 'font-weight': '800',
      'font-size': num(size), fill, 'fill-opacity': dx ? '0.85' : undefined,
    }, escapeXml(value))).join('');
  }
  const table = glyphs?.[font];
  if (!table) throw new Error(`Glyphs for ${font} are not loaded.`);
  const { d, width } = textPath(value, table);
  if (!d) return '';
  const scale = Math.min(box.h / table.capHeight, box.w / width);
  const x = box.cx - (width * scale) / 2;
  const y = box.cy + (table.capHeight * scale) / 2;
  const s = num(scale, 5);
  return fills.map(({ dx, fill }) => element('path', {
    d, transform: `matrix(${s} 0 0 -${s} ${num(x + dx)} ${num(y)})`, fill, 'fill-opacity': dx ? '0.85' : undefined,
  })).join('');
}

function stickerLayers(spec, stickers) {
  return spec.stickers.map(placed => {
    const art = stickers?.[placed.id];
    if (!art) throw new Error(`Sticker ${placed.id} is not loaded.`);
    const [, , w, h] = art.viewBox.split(' ').map(Number);
    const k = num((64 / Math.max(w, h)) * placed.scale, 4);
    const transform = `translate(${num(placed.x)} ${num(placed.y)}) rotate(${num(placed.rotate)}) scale(${k}) translate(${num(-w / 2)} ${num(-h / 2)})`;
    const paths = art.paths.map(path => element('path', { d: path.d, fill: path.fill, 'fill-rule': path.rule })).join('');
    return element('g', { transform }, paths);
  }).join('');
}

// A short description for screen readers and the SVG's <title>.
export function badgeLabel(spec) {
  const shape = spec.shape === 'tv' ? 'TV' : spec.shape;
  return spec.text.value ? `${spec.text.value} badge, ${shape}` : `Badge, ${shape}`;
}

// data: { glyphs: { <font id>: table }, stickers: { <id>: { viewBox, paths } } }. Only the spec's own
// font and stickers need to be present. The spec is validated again here, so callers can't skip it.
export function renderBadge(input, data = {}, { size = SIZE } = {}) {
  const spec = normalizeSpec(input, { stickerIds: data.stickers ? new Set(Object.keys(data.stickers)) : undefined });
  const shape = SHAPE_PATHS[spec.shape];
  const outline = isLight(spec.bg) ? INK : CHALK;
  const layers = [];
  if (spec.effects.shadow) {
    layers.push(element('path', { d: shape, fill: '#05060A', 'fill-opacity': '0.55', transform: 'translate(5 7)' }));
  }
  if (spec.shape === 'tv') {
    layers.push(element('path', {
      d: TV_ANTENNA, fill: 'none', stroke: spec.effects.outline ? outline : spec.bg, 'stroke-width': '7',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }));
  }
  layers.push(element('path', {
    d: shape, fill: spec.bg,
    ...(spec.effects.outline ? { stroke: outline, 'stroke-width': '8', 'stroke-linejoin': 'round' } : {}),
  }));
  layers.push(textLayers(spec, data.glyphs));
  layers.push(stickerLayers(spec, data.stickers));
  const body = element('title', {}, escapeXml(badgeLabel(spec))) +
    element('g', { transform: spec.effects.tilt ? 'rotate(-8 100 100)' : undefined }, layers.join(''));
  return element('svg', {
    xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${SIZE} ${SIZE}`, width: String(size), height: String(size), role: 'img',
  }, body);
}

// Turns the stickers.json list into the lookup renderBadge wants.
export function stickerMap(catalog) {
  return Object.fromEntries(catalog.stickers.map(({ id, viewBox, paths }) => [id, { viewBox, paths }]));
}
