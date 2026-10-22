import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './helpers.mjs';

const load = file => import(pathToFileURL(join(ROOT, 'public', file)).href);

test('capsule countdowns read in words, in the family time zone', async () => {
  const { countdown, opensLabel, lockedSlideMarkup } = await load('js/shell/capsules.js');
  const now = Date.parse('2026-10-22T19:00:00Z'); // 12:00 in Los Angeles
  const zone = 'America/Los_Angeles';
  assert.equal(countdown(now + 30000, now, zone), 'any second now');
  assert.equal(countdown(now + 60000, now, zone), 'in 1 minute');
  assert.equal(countdown(now + 12 * 60000, now, zone), 'in 12 minutes');
  assert.match(countdown(now + 5 * 3600000, now, zone), /^today at 5:00/);
  assert.equal(countdown(now + 20 * 3600000, now, zone), 'tomorrow');
  assert.equal(countdown(now + 212 * 86400000, now, zone), 'in 212 days');
  assert.equal(countdown(now - 1, now, zone), 'opening now');
  assert.match(countdown(Date.parse('2026-10-23T06:30:00Z'), now, zone), /^today at 11:30[\s\u202f]PM$/, 'late tonight is still today');
  assert.match(opensLabel(Date.parse('2027-03-13T18:00:00Z'), zone), /^Opens Sat, Mar 13, 2027$/);
  const html = lockedSlideMarkup({ id: 'c1', title: '<b>Hi</b>', opensAt: now + 86400000 * 3, capsuleNote: 'From "Nana"', sealedBy: 'Sam' }, 0, 2, zone);
  assert.match(html, /&lt;b&gt;Hi&lt;\/b&gt;/);
  assert.match(html, /From &quot;Nana&quot;/);
  assert.doesNotMatch(html, /<video|data-act="like"|data-act="comments"|data-act="react"/, 'nothing to play, like, comment on or react to');
});

test('reaction labels and rail markup', async () => {
  const { KINDS, reactionLabel, railButtonMarkup } = await load('js/shell/reactions.js');
  assert.deepEqual(KINDS, ['wow', 'flame', 'star', 'party', 'cool']);
  assert.equal(reactionLabel('wow', 3, false), 'Wow. 3 people.');
  assert.equal(reactionLabel('star', 1, true), 'Star. 1 person. You reacted.');
  assert.match(railButtonMarkup(), /aria-haspopup="true"/);
});

test('the parent modules export mount(host, ctx) and build no HTML strings', async () => {
  for (const name of ['capsule-actions', 'tape-budget', 'kid-tape', 'family-clock']) {
    const mod = await load(`js/launch/${name}.js`);
    assert.equal(typeof mod.mount, 'function', name);
    assert.equal(mod.mount.length, 2, name);
    assert.doesNotMatch(readFileSync(join(ROOT, 'public/js/launch', `${name}.js`), 'utf8'), /innerHTML|insertAdjacentHTML/, name);
  }
});

test('the feed and its shell modules never reach outside the site', () => {
  for (const file of ['js/shell/capsules.js', 'js/shell/reactions.js', 'js/shell/watch.js', 'js/shell/endings.js', 'js/launch/common.js']) {
    const source = readFileSync(join(ROOT, 'public', file), 'utf8').replaceAll('http://www.w3.org/2000/svg', '');
    assert.doesNotMatch(source, /https?:\/\//, file);
  }
});
