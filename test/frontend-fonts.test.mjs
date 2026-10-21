import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const PUBLIC = join(ROOT, 'public');
// Theme stylesheets name these families and paths, so they are a contract, not a detail.
const FACES = {
  'Anton': { slug: 'anton', weights: [400] },
  'Inter Tight': { slug: 'inter-tight', weights: [400, 500, 600, 700] },
  'DM Mono': { slug: 'dm-mono', weights: [400, 500] },
  'Creepster': { slug: 'creepster', weights: [400] },
};

function declaredFaces() {
  const css = readFileSync(join(PUBLIC, 'css/fonts.css'), 'utf8');
  return [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map(([, block]) => ({
    family: /font-family:\s*'([^']+)'/.exec(block)?.[1],
    weight: Number(/font-weight:\s*(\d+)/.exec(block)?.[1]),
    display: /font-display:\s*([\w-]+)/.exec(block)?.[1],
    urls: [...block.matchAll(/url\('([^']+)'\)/g)].map(match => match[1]),
  }));
}

test('fonts.css declares exactly the self-hosted families and weights', () => {
  const faces = declaredFaces();
  const expected = Object.entries(FACES).flatMap(([family, { slug, weights }]) =>
    weights.map(weight => ({ family, weight, display: 'swap', urls: [`/fonts/${slug}/${slug}-${weight}.woff2`] })));
  assert.deepEqual(faces, expected);
});

test('every font file is a real WOFF2 and every family folder carries its OFL notice', () => {
  for (const { slug, weights } of Object.values(FACES)) {
    const folder = join(PUBLIC, 'fonts', slug);
    const files = readdirSync(folder).sort();
    assert.deepEqual(files, [...weights.map(weight => `${slug}-${weight}.woff2`), 'OFL.txt'].sort(), slug);
    for (const weight of weights) {
      const font = readFileSync(join(folder, `${slug}-${weight}.woff2`));
      assert.equal(font.subarray(0, 4).toString('latin1'), 'wOF2', `${slug} ${weight} is WOFF2`);
      assert.ok(font.length < 64 * 1024, `${slug} ${weight} is a subset, not a full family`);
    }
    assert.match(readFileSync(join(folder, 'OFL.txt'), 'utf8'), /SIL Open Font License, Version 1\.1/);
  }
});

