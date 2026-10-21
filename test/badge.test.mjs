import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SPEC, EFFECTS, FONTS, MAX_BYTES, PALETTE, SHAPES, normalizeSpec, validateSpec } from '../public/js/badge/spec.js';
import { renderBadge, stickerMap } from '../public/js/badge/render.js';
import { badgeData, renderSpec } from '../server/badge.mjs';
import { ROOT } from './helpers.mjs';

const catalog = JSON.parse(readFileSync(join(ROOT, 'public/badge/stickers.json'), 'utf8'));
const stickerIds = new Set(catalog.stickers.map(sticker => sticker.id));
const data = badgeData();

test('spec v1 validation: whitelist, defaults, clamping and size', async t => {
  const ok = (input, expected) => {
    const result = validateSpec(input, { stickerIds });
    assert.equal(result.ok, true, `${JSON.stringify(input)}: ${result.error}`);
    if (expected) assert.deepEqual(result.spec, expected);
    return result.spec;
  };
  const bad = (input, pattern) => {
    const result = validateSpec(input, { stickerIds });
    assert.equal(result.ok, false, `${JSON.stringify(input)} should be refused`);
    assert.match(result.error, pattern);
  };

  await t.test('a bare spec gets the defaults', () => {
    ok({ v: 1 }, JSON.parse(JSON.stringify(DEFAULT_SPEC)));
  });

  await t.test('every shape, font and effect in the lists is accepted', () => {
    for (const { id } of SHAPES) assert.equal(ok({ v: 1, shape: id }).shape, id);
    for (const { id } of FONTS) assert.equal(ok({ v: 1, text: { font: id } }).text.font, id);
    for (const { id } of EFFECTS) assert.equal(ok({ v: 1, effects: { [id]: true } }).effects[id], true);
    assert.deepEqual(SHAPES.map(shape => shape.id), ['circle', 'rounded', 'shield', 'star', 'hexagon', 'burst', 'blob', 'ticket', 'tv']);
    assert.deepEqual(FONTS.map(font => font.id), ['anton', 'creepster', 'pixel', 'bangers', 'system']);
    assert.deepEqual(EFFECTS.map(effect => effect.id), ['rgbSplit', 'outline', 'tilt', 'shadow']);
  });

  await t.test('colours are normalized and names trimmed', () => {
    const spec = ok({ v: 1, bg: '#ff5c2b', text: { value: '  Zoë ', color: '#abcdef' } });
    assert.equal(spec.bg, '#FF5C2B');
    assert.equal(spec.text.color, '#ABCDEF');
    assert.equal(spec.text.value, 'Zoë');
    assert.equal(ok({ v: 1, text: { value: 'ÀÉÎÕÜ ñ ß' } }).text.value, 'ÀÉÎÕÜ ñ ß');
  });

  await t.test('sticker numbers are clamped and rounded, positions default per slot', () => {
    const spec = ok({ v: 1, stickers: [{ id: 'bolt', x: -50, y: 999, scale: 9, rotate: 720 }, { id: 'star', scale: 0.01, rotate: -12.6 }, { id: 'heart', x: 33.333 }] });
    assert.deepEqual(spec.stickers[0], { id: 'bolt', x: 0, y: 200, scale: 2.5, rotate: 180 });
    assert.deepEqual(spec.stickers[1], { id: 'star', x: 44, y: 156, scale: 0.4, rotate: -13 });
    assert.deepEqual(spec.stickers[2], { id: 'heart', x: 33.5, y: 156, scale: 1, rotate: 0 });
  });

  const refusals = [
    [null, /object/], [[], /object/], ['{"v":1}', /object/], [{}, /version/], [{ v: 2 }, /version/], [{ v: '1' }, /version/],
    [{ v: 1, extra: true }, /unknown key "extra"/], [JSON.parse('{"v":1,"__proto__":{"x":1}}'), /unknown key "__proto__"/], [{ v: 1, __proto__: { polluted: 1 }, shape: 'circle' }, null],
    [{ v: 1, shape: 'cassette' }, /shape/], [{ v: 1, shape: 'CIRCLE' }, /shape/],
    [{ v: 1, bg: 'red' }, /color/], [{ v: 1, bg: '#FFF' }, /color/], [{ v: 1, bg: '#FF5C2B;' }, /color/], [{ v: 1, bg: 'url(#x)' }, /color/],
    [{ v: 1, text: 'MILO' }, /text must be an object/], [{ v: 1, text: { value: 'ABCDEFGHIJK' } }, /up to 10/],
    [{ v: 1, text: { value: '<script>' } }, null], [{ v: 1, text: { value: 'a\u0000b' } }, /can't draw/],
    [{ v: 1, text: { value: 'hi‮' } }, /can't draw/], [{ v: 1, text: { value: '😀' } }, /can't draw/],
    [{ v: 1, text: { value: 'Ω' } }, /can't draw/], [{ v: 1, text: { value: 'soft­hy' } }, /can't draw/],
    [{ v: 1, text: { value: 42 } }, /text\.value/], [{ v: 1, text: { font: 'comic-sans' } }, /font/], [{ v: 1, text: { size: 4 } }, /unknown key "size"/],
    [{ v: 1, stickers: {} }, /list/], [{ v: 1, stickers: [{ id: 'bolt' }, { id: 'bolt' }, { id: 'star' }, { id: 'heart' }] }, /Up to 3/],
    [{ v: 1, stickers: [{ id: 'knife' }] }, /no "knife" sticker/], [{ v: 1, stickers: [{ id: '../x' }] }, /not a sticker/],
    [{ v: 1, stickers: [{ id: 'bolt', x: '10' }] }, /number/], [{ v: 1, stickers: [{ id: 'bolt', x: NaN }] }, /number/],
    [{ v: 1, stickers: [{ id: 'bolt', href: 'x' }] }, /unknown key "href"/],
    [{ v: 1, effects: { glow: true } }, /unknown key "glow"/], [{ v: 1, effects: { tilt: 'yes' } }, /true or false/],
    [{ v: 1, effects: [] }, /object/], [{ v: 1, text: { value: 'A'.repeat(MAX_BYTES) } }, /under 4096 bytes/],
  ];
  await t.test('anything off the whitelist is refused', () => {
    for (const [input, pattern] of refusals) {
      if (pattern === null) {
        // Allowed shapes of input that must still come out harmless.
        const result = validateSpec(input, { stickerIds });
        if (result.ok) assert.ok(!('polluted' in result.spec));
        continue;
      }
      bad(input, pattern);
    }
  });

  await t.test('a spec with a setter or class instance is not plain JSON', () => {
    bad({ v: 1, text: new (class { value = 'x'; })() }, /object/);
    assert.throws(() => normalizeSpec({ v: 1, toJSON() { throw new Error('boom'); } }), /plain JSON/);
  });
});

test('rendering is deterministic and matches the committed snapshot', () => {
  const spec = {
    v: 1, shape: 'shield', bg: '#C6FF3D',
    text: { value: 'Dax', font: 'creepster', color: '#0B0C10' },
    stickers: [{ id: 'ghost', x: 150, y: 46, scale: 1.1, rotate: 12 }],
    effects: { rgbSplit: true, outline: true, tilt: true, shadow: true },
  };
  const first = renderBadge(spec, data);
  assert.equal(renderBadge(JSON.parse(JSON.stringify(spec)), data), first);
  assert.equal(renderSpec(spec).svg, first, 'the server path draws the same bytes');
  assert.ok(first.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200" role="img"><title>Dax badge, shield</title><g transform="rotate(-8 100 100)">'));
  // Update deliberately (and look at the badge) if the renderer, glyphs or stickers change.
  assert.equal(createHash('sha256').update(first).digest('hex').slice(0, 16), SNAPSHOT);
});
const SNAPSHOT = 'f2fe59edb6b5e532';

// A strict tokenizer: only these elements and attributes, with values of the expected shape.
const NUMBER = '-?\\d+(?:\\.\\d+)?';
const PATH = /^[MmLlHhVvCcQqAaZz0-9 .,-]+$/;
const ATTRIBUTES = {
  svg: { xmlns: /^http:\/\/www\.w3\.org\/2000\/svg$/, viewBox: /^0 0 200 200$/, width: /^\d+$/, height: /^\d+$/, role: /^img$/ },
  title: {},
  g: { transform: new RegExp(`^(?:rotate\\(-8 100 100\\)|translate\\(${NUMBER} ${NUMBER}\\) rotate\\(${NUMBER}\\) scale\\(${NUMBER}\\) translate\\(${NUMBER} ${NUMBER}\\))$`) },
  path: {
    d: PATH, fill: /^(?:#[0-9A-F]{6}|none)$/, 'fill-opacity': /^0\.\d+$/, 'fill-rule': /^evenodd$/, stroke: /^#[0-9A-F]{6}$/,
    'stroke-width': /^\d+$/, 'stroke-linejoin': /^round$/, 'stroke-linecap': /^round$/,
    transform: new RegExp(`^(?:translate\\(5 7\\)|matrix\\(${NUMBER} 0 0 ${NUMBER} ${NUMBER} ${NUMBER}\\))$`),
  },
  text: {
    x: new RegExp(`^${NUMBER}$`), y: new RegExp(`^${NUMBER}$`), 'text-anchor': /^middle$/, 'font-family': /^[A-Za-z, -]+$/,
    'font-weight': /^800$/, 'font-size': new RegExp(`^${NUMBER}$`), fill: /^#[0-9A-F]{6}$/, 'fill-opacity': /^0\.\d+$/,
  },
};
const FORBIDDEN = /<\s*(?:script|use|style|foreignObject|image|a|iframe|animate|set)\b|\b(?:href|style|on[a-z]+)\s*=|javascript:|url\(/i;

function assertSafeSvg(svg) {
  const stack = [];
  let at = 0;
  while (at < svg.length) {
    if (svg[at] !== '<') {
      const end = svg.indexOf('<', at);
      const text = svg.slice(at, end < 0 ? svg.length : end);
      assert.ok(['title', 'text'].includes(stack.at(-1)), `text only inside title or text, got ${JSON.stringify(text)}`);
      assert.ok(!/&(?!(?:amp|lt|gt|quot|#39);)/.test(text), 'text is escaped');
      at += text.length;
      continue;
    }
    const tag = /^<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z:-]+="[^"<>]*")*)\s*(\/?)>/.exec(svg.slice(at));
    assert.ok(tag, `malformed markup at ${at}: ${svg.slice(at, at + 40)}`);
    const [whole, closing, name, attributes, selfClosing] = tag;
    assert.ok(!FORBIDDEN.test(whole), `no script, use, href, style, handlers or foreignObject: ${whole.slice(0, 60)}`);
    assert.ok(Object.hasOwn(ATTRIBUTES, name), `element <${name}> is not allowed`);
    if (closing) {
      assert.equal(stack.pop(), name);
    } else {
      for (const [, key, value] of attributes.matchAll(/\s+([a-zA-Z:-]+)="([^"]*)"/g)) {
        const rule = ATTRIBUTES[name][key];
        assert.ok(rule, `attribute ${key} is not allowed on <${name}>`);
        assert.match(value, rule, `<${name} ${key}>`);
      }
      if (!selfClosing) stack.push(name);
    }
    at += whole.length;
  }
  assert.deepEqual(stack, [], 'every element is closed');
}

// Small deterministic PRNG so a failing fuzz case can be replayed.
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

test('every rendered badge passes the element and attribute whitelist, including 500 fuzzed specs', () => {
  const rand = random(20261021);
  const pick = list => list[Math.floor(rand() * list.length)];
  const hostile = ['<script>alert(1)</script>', '"><svg onload=x>', "' onmouseover='x", '&amp;&lt;', 'javascript:', '</text><use href="#a"/>',
    'url(#x)', '<![CDATA[x]]>', 'A&B "C"', '<>&\'"', '\u0000', '‮', 'Zoë & Åsa'];
  const ids = [...stickerIds];
  let rendered = 0;
  for (let i = 0; i < 500; i++) {
    const spec = { v: 1 };
    if (rand() < 0.9) spec.shape = pick(SHAPES).id;
    if (rand() < 0.9) spec.bg = rand() < 0.7 ? pick(PALETTE).hex : '#' + Math.floor(rand() * 0xffffff).toString(16).padStart(6, '0');
    if (rand() < 0.95) {
      const value = rand() < 0.3 ? pick(hostile) : Array.from({ length: Math.floor(rand() * 11) },
        () => String.fromCharCode(rand() < 0.8 ? 0x20 + Math.floor(rand() * 95) : 0xa0 + Math.floor(rand() * 96))).join('');
      spec.text = { value, font: pick(FONTS).id, color: pick(PALETTE).hex };
    }
    if (rand() < 0.8) {
      spec.stickers = Array.from({ length: Math.floor(rand() * 4) }, () => ({
        id: pick(ids), x: rand() * 260 - 30, y: rand() * 260 - 30, scale: rand() * 3, rotate: rand() * 400 - 200,
      }));
    }
    spec.effects = Object.fromEntries(EFFECTS.map(({ id }) => [id, rand() < 0.5]));
    const result = validateSpec(spec, { stickerIds });
    if (!result.ok) continue;
    const svg = renderBadge(result.spec, data);
    assertSafeSvg(svg);
    rendered++;
  }
  assert.ok(rendered > 400, `most fuzzed specs render (${rendered})`);
  // The renderer also refuses a spec that never went through validation.
  assert.throws(() => renderBadge({ v: 1, shape: 'circle', text: { value: '<x>' }, onload: 'x' }, data), /unknown key "onload"/);
});

test('sticker and glyph data are plain path data with solid fills', () => {
  assert.ok(catalog.stickers.length >= 55 && catalog.stickers.length <= 70, `about 60 stickers (${catalog.stickers.length})`);
  assert.match(catalog.license, /MIT/);
  assert.match(readFileSync(join(ROOT, 'public/badge/licenses/fluent-emoji-MIT.txt'), 'utf8'), /MIT License[\s\S]*Copyright \(c\) Microsoft Corporation/);
  for (const sticker of catalog.stickers) {
    assert.match(sticker.id, /^[a-z][a-z0-9-]{0,23}$/);
    assert.match(sticker.label, /^[A-Za-z ]{2,20}$/);
    assert.equal(sticker.viewBox, '0 0 32 32');
    assert.ok(sticker.paths.length > 0);
    for (const path of sticker.paths) {
      assert.deepEqual(Object.keys(path).filter(key => !['d', 'fill', 'rule'].includes(key)), [], sticker.id);
      assert.match(path.d, /^M[MLHVCAZ0-9 .-]+$/, sticker.id);
      assert.match(path.fill, /^#[0-9A-F]{6}$/, sticker.id);
      if (path.rule) assert.equal(path.rule, 'evenodd');
    }
  }
  assert.deepEqual(Object.keys(stickerMap(catalog)).length, catalog.stickers.length);
  for (const font of FONTS.filter(font => font.file)) {
    const table = JSON.parse(readFileSync(join(ROOT, `public/badge/glyphs/${font.file}.json`), 'utf8'));
    assert.equal(table.font, font.id);
    assert.match(table.license, /SIL Open Font License/);
    assert.ok(readFileSync(join(ROOT, `public/badge/licenses/OFL-${font.file}.txt`), 'utf8').includes('SIL OPEN FONT LICENSE Version 1.1'));
    assert.ok(Object.keys(table.glyphs).length >= 188, `${font.id} covers Latin-1`);
    for (const [char, [advance, d]] of Object.entries(table.glyphs)) {
      assert.equal(char.length, 1);
      assert.ok(Number.isInteger(advance) && advance >= 0);
      assert.match(d, /^(?:m-?\d+[ -]?-?\d+[mlqz0-9 -]*)?$/, `${font.id} ${char}`);
    }
  }
  // Licenses ship next to the tables, and nothing else sits in the folder.
  assert.deepEqual(readdirSync(join(ROOT, 'public/badge/licenses')).sort(),
    ['OFL-comic.txt', 'OFL-pixel.txt', 'OFL-spooky.txt', 'OFL-tall.txt', 'fluent-emoji-MIT.txt']);
});

test('names draw as paths, and the system font falls back to escaped text', () => {
  const pathBadge = renderBadge({ v: 1, text: { value: 'MILO', font: 'anton' } }, data);
  assert.ok(!pathBadge.includes('<text'));
  assert.match(pathBadge, /<path d="M\d/);
  const system = renderBadge({ v: 1, text: { value: '<b>&"\'', font: 'system' } }, data);
  assert.ok(system.includes('>&lt;b&gt;&amp;&quot;&#39;</text>'));
  assertSafeSvg(system);
  const split = renderBadge({ v: 1, text: { value: 'KAI', font: 'pixel' }, effects: { rgbSplit: true } }, data);
  assert.equal(split.match(/fill="#4DF6FF"|fill="#FF3D55"/g).length, 2);
  // A character a font lacks still lays out (Creepster has no plus-minus sign).
  assert.doesNotThrow(() => renderBadge({ v: 1, text: { value: 'A±B', font: 'creepster' } }, data));
});
