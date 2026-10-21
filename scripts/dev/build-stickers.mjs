#!/usr/bin/env node
// Maintainer only: extracts the badge stickers from Microsoft's Fluent Emoji "Flat" set (MIT) into
// public/badge/stickers.json as {viewBox, paths:[{d, fill, rule?}]}. Badges then draw stickers from
// plain path data and never embed someone else's SVG. Run with `node scripts/dev/build-stickers.mjs`.
// The SVGs are data: anything beyond paths, circles and ellipses with solid fills stops the build.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const CACHE = join(import.meta.dirname, '.cache/fluent');
// Pinned so a rebuild is reproducible; the MIT license was checked at this commit.
const COMMIT = '1ffb34c752ecf5d402f04cfb4b392c77f57c54bc';
const SOURCE = `https://raw.githubusercontent.com/microsoft/fluentui-emoji/${COMMIT}/`;

// Curated for kids: friendly animals, nature, food, toys and faces. No weapons, nothing gross or scary.
const STICKERS = [
  ['dog', 'Dog', 'Dog face'], ['cat', 'Cat', 'Cat face'], ['fox', 'Fox', 'Fox'], ['panda', 'Panda', 'Panda'],
  ['unicorn', 'Unicorn', 'Unicorn'], ['frog', 'Frog', 'Frog'], ['lion', 'Lion', 'Lion'], ['koala', 'Koala', 'Koala'],
  ['penguin', 'Penguin', 'Penguin'], ['owl', 'Owl', 'Owl'], ['bunny', 'Bunny', 'Rabbit face'], ['bear', 'Bear', 'Bear'],
  ['monkey', 'Monkey', 'Monkey face'], ['butterfly', 'Butterfly', 'Butterfly'], ['ladybug', 'Ladybug', 'Lady beetle'],
  ['turtle', 'Turtle', 'Turtle'], ['octopus', 'Octopus', 'Octopus'], ['dolphin', 'Dolphin', 'Dolphin'],
  ['whale', 'Whale', 'Spouting whale'], ['dino', 'Dino', 'Sauropod'],
  ['sun', 'Sun', 'Sun with face'], ['rainbow', 'Rainbow', 'Rainbow'], ['star', 'Star', 'Star'],
  ['sparkles', 'Sparkles', 'Sparkles'], ['bolt', 'Bolt', 'High voltage'], ['flame', 'Flame', 'Fire'],
  ['snowflake', 'Snowflake', 'Snowflake'], ['cloud', 'Cloud', 'Cloud'], ['moon', 'Moon', 'Crescent moon'],
  ['clover', 'Clover', 'Four leaf clover'], ['sunflower', 'Sunflower', 'Sunflower'],
  ['pizza', 'Pizza', 'Pizza'], ['donut', 'Donut', 'Doughnut'], ['ice-cream', 'Ice cream', 'Soft ice cream'],
  ['watermelon', 'Watermelon', 'Watermelon'], ['strawberry', 'Strawberry', 'Strawberry'], ['banana', 'Banana', 'Banana'],
  ['cupcake', 'Cupcake', 'Cupcake'], ['lollipop', 'Lollipop', 'Lollipop'], ['cookie', 'Cookie', 'Cookie'],
  ['rocket', 'Rocket', 'Rocket'], ['soccer', 'Soccer ball', 'Soccer ball'], ['basketball', 'Basketball', 'Basketball'],
  ['guitar', 'Guitar', 'Guitar'], ['crown', 'Crown', 'Crown'], ['gem', 'Gem', 'Gem stone'], ['balloon', 'Balloon', 'Balloon'],
  ['party', 'Party', 'Party popper'], ['game', 'Game', 'Video game'], ['music', 'Music', 'Musical note'],
  ['skateboard', 'Skateboard', 'Skateboard'], ['kite', 'Kite', 'Kite'], ['trophy', 'Trophy', 'Trophy'],
  ['wand', 'Magic wand', 'Magic wand'], ['planet', 'Planet', 'Ringed planet'], ['teddy', 'Teddy', 'Teddy bear'],
  ['ghost', 'Ghost', 'Ghost'], ['heart', 'Heart', 'Red heart'], ['robot', 'Robot', 'Robot'],
  ['cool', 'Cool', 'Smiling face with sunglasses'], ['wow', 'Wow', 'Star-struck'],
];

const NAMED = { white: '#FFFFFF', black: '#000000' };
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, Z: 0 };
const fmt = value => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

function fill(value) {
  const color = NAMED[value] || value;
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) throw new Error(`Unsupported fill ${value}`);
  return color.toUpperCase();
}

// Re-serializes absolute M/L/H/V/C/Z path data with two decimals; any other syntax is an error.
function cleanPath(d) {
  let i = 0, out = '';
  const skip = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  skip();
  while (i < d.length) {
    const command = d[i++];
    if (!(command in ARITY)) throw new Error(`Unsupported path command ${command}`);
    out += command;
    let first = true;
    do {
      skip();
      const values = [];
      for (let n = 0; n < ARITY[command]; n++) {
        skip();
        NUMBER.lastIndex = i;
        const match = NUMBER.exec(d);
        if (!match) throw new Error(`Bad number in path at ${i}`);
        values.push(fmt(Number(match[0])));
        i = NUMBER.lastIndex;
      }
      if (ARITY[command]) out += (first ? '' : ' ') + values.join(' ').replace(/ -/g, '-');
      first = false;
      skip();
      NUMBER.lastIndex = i;
    } while (ARITY[command] && i < d.length && NUMBER.test(d));
  }
  return out;
}

const r = value => fmt(Number(value));
function circlePath(a) {
  const cx = Number(a.cx), cy = Number(a.cy), rad = Number(a.r);
  return `M${r(cx - rad)} ${r(cy)}A${r(rad)} ${r(rad)} 0 1 0 ${r(cx + rad)} ${r(cy)}A${r(rad)} ${r(rad)} 0 1 0 ${r(cx - rad)} ${r(cy)}Z`;
}
function ellipsePath(a) {
  const cx = Number(a.cx), cy = Number(a.cy), rx = Number(a.rx), ry = Number(a.ry);
  let angle = 0;
  if (a.transform) {
    const match = /^rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)$/.exec(a.transform);
    if (!match || Number(match[2]) !== cx || Number(match[3]) !== cy) throw new Error(`Unsupported transform ${a.transform}`);
    angle = Number(match[1]);
  }
  const t = angle * Math.PI / 180, dx = rx * Math.cos(t), dy = rx * Math.sin(t);
  return `M${r(cx + dx)} ${r(cy + dy)}A${r(rx)} ${r(ry)} ${r(angle)} 1 0 ${r(cx - dx)} ${r(cy - dy)}` +
    `A${r(rx)} ${r(ry)} ${r(angle)} 1 0 ${r(cx + dx)} ${r(cy + dy)}Z`;
}

function extract(svg, name) {
  const paths = [];
  let viewBox = null;
  for (const [, close, tag, rest] of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*)>/g)) {
    if (close) { if (tag !== 'svg') throw new Error(`${name}: unexpected </${tag}>`); continue; }
    const attrs = {};
    for (const [, key, value] of rest.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) attrs[key] = value;
    const allowed = { svg: ['width', 'height', 'viewBox', 'fill', 'xmlns'], path: ['d', 'fill', 'fill-rule', 'clip-rule'],
      circle: ['cx', 'cy', 'r', 'fill'], ellipse: ['cx', 'cy', 'rx', 'ry', 'transform', 'fill'] }[tag];
    if (!allowed) throw new Error(`${name}: unsupported element <${tag}>`);
    for (const key of Object.keys(attrs)) if (!allowed.includes(key)) throw new Error(`${name}: unsupported ${tag} attribute ${key}`);
    if (tag === 'svg') {
      viewBox = attrs.viewBox;
      if (viewBox !== '0 0 32 32') throw new Error(`${name}: unexpected viewBox ${viewBox}`);
      continue;
    }
    const d = tag === 'path' ? cleanPath(attrs.d) : tag === 'circle' ? circlePath(attrs) : ellipsePath(attrs);
    const entry = { d, fill: fill(attrs.fill) };
    if (attrs['fill-rule'] === 'evenodd') entry.rule = 'evenodd';
    else if (attrs['fill-rule']) throw new Error(`${name}: unsupported fill-rule`);
    paths.push(entry);
  }
  if (!viewBox || !paths.length) throw new Error(`${name}: no artwork`);
  return { viewBox, paths };
}

async function cached(path) {
  const file = join(CACHE, path);
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    const response = await fetch(SOURCE + path.split('/').map(encodeURIComponent).join('/'));
    if (!response.ok) throw new Error(`Download failed for ${path}: ${response.status}`);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  return readFileSync(file, 'utf8');
}

const license = await cached('LICENSE');
if (!/^\s*MIT License/.test(license) || !license.includes('Copyright (c) Microsoft Corporation')) throw new Error('The Fluent Emoji license is no longer MIT; stop and review.');
const stickers = [];
for (const [id, label, folder] of STICKERS) {
  const file = `${folder.toLowerCase().replace(/ /g, '_')}_flat.svg`;
  stickers.push({ id, label, ...extract(await cached(`assets/${folder}/Flat/${file}`), folder) });
}
if (new Set(stickers.map(s => s.id)).size !== stickers.length) throw new Error('Duplicate sticker ids.');
const out = {
  license: 'Microsoft Fluent Emoji (Flat), MIT License; see /badge/licenses/fluent-emoji-MIT.txt',
  source: `https://github.com/microsoft/fluentui-emoji/tree/${COMMIT}`,
  stickers,
};
writeFileSync(join(ROOT, 'public/badge/stickers.json'), JSON.stringify(out) + '\n');
writeFileSync(join(ROOT, 'public/badge/licenses/fluent-emoji-MIT.txt'),
  `The badge stickers in public/badge/stickers.json are path data extracted from Microsoft's Fluent Emoji\n` +
  `"Flat" artwork (https://github.com/microsoft/fluentui-emoji, commit ${COMMIT}), used under this license:\n\n` +
  license.replace(/^ {4}/gm, ''));
console.log(`${stickers.length} stickers, ${(JSON.stringify(out).length / 1024).toFixed(1)} KB`);
