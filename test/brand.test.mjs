import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

// The product will be renamed before launch; only server/brand.mjs may spell its name.
test('the server names the product only through server/brand.mjs', () => {
  const server = join(ROOT, 'server');
  const hits = [];
  for (const name of readdirSync(server, { recursive: true })) {
    if (name === 'brand.mjs' || !/\.m?js$/.test(name)) continue;
    readFileSync(join(server, name), 'utf8').split('\n').forEach((line, index) => {
      if (/KidTube|KIDTUBE/.test(line)) hits.push(`server/${name}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});
