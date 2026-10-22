// Badge spec v1: the only thing a badge is saved as. The browser and the server both validate with this
// module, and the server redraws the SVG from the validated spec, so no drawing ever comes from a client.
// Pure: no DOM and no Node APIs.

export const SPEC_VERSION = 1;
export const MAX_BYTES = 4096;
export const MAX_TEXT = 10;
export const MAX_STICKERS = 3;

export const SHAPES = [
  { id: 'circle', label: 'Circle' }, { id: 'rounded', label: 'Rounded' }, { id: 'shield', label: 'Shield' },
  { id: 'star', label: 'Star' }, { id: 'hexagon', label: 'Hex' }, { id: 'burst', label: 'Burst' },
  { id: 'blob', label: 'Blob' }, { id: 'ticket', label: 'Ticket' }, { id: 'tv', label: 'TV' },
];

// `file` names the glyph table in /badge/glyphs; `system` draws with the device's own font instead.
export const FONTS = [
  { id: 'anton', label: 'Tall', file: 'tall' }, { id: 'creepster', label: 'Creepy', file: 'spooky' },
  { id: 'pixel', label: 'Pixel', file: 'pixel' }, { id: 'bangers', label: 'Comic', file: 'comic' },
  { id: 'system', label: 'Plain', file: null },
];

export const PALETTE = [
  { hex: '#FF5C2B', label: 'Ember' }, { hex: '#C6FF3D', label: 'Volt' }, { hex: '#4DB8FF', label: 'Sky' },
  { hex: '#FF6FB5', label: 'Bubblegum' }, { hex: '#A98BFF', label: 'Grape' }, { hex: '#FFD23F', label: 'Sunny' },
  { hex: '#3DFFB0', label: 'Mint' }, { hex: '#F7F4EC', label: 'Chalk' },
];
export const INK = '#0B0C10';
export const CHALK = '#F7F4EC';
export const TEXT_COLORS = [{ hex: INK, label: 'Ink' }, ...PALETTE];

export const EFFECTS = [
  { id: 'rgbSplit', label: 'RGB split' }, { id: 'outline', label: 'Outline' },
  { id: 'tilt', label: 'Tilt' }, { id: 'shadow', label: 'Shadow' },
];

// Sticker positions are in the badge's 200 x 200 canvas; scale 1 draws a sticker 64 units wide.
export const STICKER_RANGE = { x: [0, 200], y: [0, 200], scale: [0.4, 2.5], rotate: [-180, 180] };
export const STICKER_SPOTS = [{ x: 156, y: 44 }, { x: 44, y: 156 }, { x: 156, y: 156 }];

export const DEFAULT_SPEC = Object.freeze({
  v: 1, shape: 'circle', bg: '#FF5C2B',
  text: { value: '', font: 'anton', color: INK },
  stickers: [],
  effects: { rgbSplit: false, outline: true, tilt: false, shadow: false },
});

export class BadgeSpecError extends Error {}

const COLOR = /^#[0-9A-Fa-f]{6}$/;
const STICKER_ID = /^[a-z][a-z0-9-]{0,23}$/;
const fail = message => { throw new BadgeSpecError(message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

function only(value, keys, where) {
  if (!isObject(value)) fail(`${where} must be an object.`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${where} has an unknown key "${key}".`);
  return value;
}
function color(value, where) {
  if (typeof value !== 'string' || !COLOR.test(value)) fail(`${where} must be a color like #FF5C2B.`);
  return value.toUpperCase();
}
function oneOf(value, list, where) {
  if (!list.some(item => item.id === value)) fail(`${where} must be one of: ${list.map(item => item.id).join(', ')}.`);
  return value;
}
// Out-of-range numbers are pulled back into range; numbers are rounded so specs stay small and stable.
function clamp(value, [min, max], step, where) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${where} must be a number.`);
  const rounded = Math.round(Math.min(max, Math.max(min, value)) / step) * step;
  return Number(rounded.toFixed(2)) || 0;
}
function bool(value, where) {
  if (typeof value !== 'boolean') fail(`${where} must be true or false.`);
  return value;
}

// Printable Latin-1, which is what the glyph tables cover; the invisible soft hyphen is left out.
export function allowedChar(code) {
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff && code !== 0xad);
}

export function specBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

// Returns a clean copy with defaults filled in, or throws BadgeSpecError. `stickerIds` is the catalog.
export function normalizeSpec(input, { stickerIds } = {}) {
  if (!isObject(input)) fail('A badge must be an object.');
  let size;
  try { size = specBytes(input); } catch { fail('A badge must be plain JSON.'); }
  if (size > MAX_BYTES) fail(`A badge must be under ${MAX_BYTES} bytes.`);
  only(input, ['v', 'shape', 'bg', 'text', 'stickers', 'effects'], 'The badge');
  if (input.v !== SPEC_VERSION) fail('Unknown badge version.');
  const spec = structuredCloneSpec(DEFAULT_SPEC);
  if (input.shape !== undefined) spec.shape = oneOf(input.shape, SHAPES, 'shape');
  if (input.bg !== undefined) spec.bg = color(input.bg, 'bg');

  if (input.text !== undefined) {
    const text = only(input.text, ['value', 'font', 'color'], 'text');
    if (text.value !== undefined) {
      if (typeof text.value !== 'string') fail('text.value must be text.');
      const value = text.value.trim();
      if (value.length > MAX_TEXT) fail(`Names can be up to ${MAX_TEXT} letters.`);
      for (const char of value) if (!allowedChar(char.charCodeAt(0)) || char.length > 1) fail(`The badge can't draw "${char}".`);
      spec.text.value = value;
    }
    if (text.font !== undefined) spec.text.font = oneOf(text.font, FONTS, 'text.font');
    if (text.color !== undefined) spec.text.color = color(text.color, 'text.color');
  }

  if (input.stickers !== undefined) {
    if (!Array.isArray(input.stickers)) fail('stickers must be a list.');
    if (input.stickers.length > MAX_STICKERS) fail(`Up to ${MAX_STICKERS} stickers.`);
    spec.stickers = input.stickers.map((raw, index) => {
      const sticker = only(raw, ['id', 'x', 'y', 'scale', 'rotate'], `stickers[${index}]`);
      if (typeof sticker.id !== 'string' || !STICKER_ID.test(sticker.id)) fail(`stickers[${index}].id is not a sticker.`);
      if (stickerIds && !stickerIds.has(sticker.id)) fail(`There is no "${sticker.id}" sticker.`);
      const spot = STICKER_SPOTS[index];
      return {
        id: sticker.id,
        x: sticker.x === undefined ? spot.x : clamp(sticker.x, STICKER_RANGE.x, 0.5, `stickers[${index}].x`),
        y: sticker.y === undefined ? spot.y : clamp(sticker.y, STICKER_RANGE.y, 0.5, `stickers[${index}].y`),
        scale: sticker.scale === undefined ? 1 : clamp(sticker.scale, STICKER_RANGE.scale, 0.05, `stickers[${index}].scale`),
        rotate: sticker.rotate === undefined ? 0 : clamp(sticker.rotate, STICKER_RANGE.rotate, 1, `stickers[${index}].rotate`),
      };
    });
  }

  if (input.effects !== undefined) {
    const effects = only(input.effects, EFFECTS.map(effect => effect.id), 'effects');
    for (const { id } of EFFECTS) if (effects[id] !== undefined) spec.effects[id] = bool(effects[id], `effects.${id}`);
  }
  return spec;
}

// The same, as a result object for callers that would rather not catch.
export function validateSpec(input, options) {
  try { return { ok: true, spec: normalizeSpec(input, options) }; }
  catch (error) {
    if (error instanceof BadgeSpecError) return { ok: false, error: error.message };
    throw error;
  }
}

function structuredCloneSpec(spec) {
  return JSON.parse(JSON.stringify(spec));
}
