import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ago, agoLong, bytes, clock, countLine, until } from '../public/js/parent/format.js';
import extensions from '../public/js/parent/extensions.js';
import { SLOTS, mountSlot } from '../public/js/parent/slots.js';
import { ROOT } from './helpers.mjs';

const NOW = Date.UTC(2026, 9, 22, 18, 0);

test('times, lengths and sizes read plainly', () => {
  const o = { now: NOW, timeZone: 'UTC', locale: 'en-US' };
  assert.equal(ago(NOW - 30000, o), 'just now');
  assert.equal(ago(NOW - 12 * 60000, o), '12 min');
  assert.equal(ago(NOW - 2 * 3600000, o), '2 h');
  assert.equal(ago(NOW - 2 * 86400000, o), 'Tue');
  assert.equal(ago(NOW - 30 * 86400000, o), 'Sep 22');
  assert.equal(agoLong(NOW - 60000, o), '1 minute ago');
  assert.equal(agoLong(NOW - 30 * 3600000, o), 'yesterday');
  assert.equal(until(NOW + 3600000, o), 'today at 7:00 PM');
  assert.equal(until(NOW + 23 * 3600000, o), 'tomorrow at 5:00 PM');
  assert.equal(clock(89), '1:29');
  assert.equal(clock(3725), '1:02:05');
  assert.equal(bytes(18_400_000_000), '18.4 GB');
  assert.equal(bytes(640_000_000), '640 MB');
  assert.equal(bytes(512), '512 bytes');
  assert.equal(countLine('review', 1), 'video to review');
  assert.equal(countLine('people', 2), 'people asking to watch');
});

// A tiny stand-in for the DOM: enough for mountSlot.
function fakeHost() {
  const doc = { createElement: () => { const node = { dataset: {}, className: '', removed: false, remove() { this.removed = true; } }; return node; } };
  return { ownerDocument: doc, children: [], append(node) { this.children.push(node); } };
}

test('extension slots: the launch story fills each slot once, mounted in order, cleaned up, and a broken one is skipped', () => {
  assert.deepEqual(SLOTS, ['clip-actions', 'person-settings', 'kid-settings', 'family-settings']);
  assert.deepEqual(extensions.map(entry => entry.slot), SLOTS, 'one launch-story control per slot');
  assert.ok(extensions.every(entry => typeof entry.module.mount === 'function'));
  const calls = [];
  const list = [
    { slot: 'clip-actions', module: { mount(host, ctx) { calls.push(['a', ctx.clip.id, host.dataset.slot]); return () => calls.push(['a gone']); } } },
    { slot: 'kid-settings', module: { mount() { calls.push(['wrong slot']); } } },
    { slot: 'clip-actions', module: { mount() { throw new Error('broken'); } } },
    { slot: 'clip-actions', module: { mount() { calls.push(['c']); return { destroy: () => calls.push(['c gone']) }; } } },
  ];
  const host = fakeHost();
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  const dispose = mountSlot(host, 'clip-actions', { clip: { id: 'x' } }, list);
  console.error = original;
  assert.deepEqual(calls, [['a', 'x', 'clip-actions'], ['c']]);
  assert.equal(errors.length, 1);
  assert.equal(host.children[1].removed, true, 'the broken one leaves nothing behind');
  dispose();
  assert.deepEqual(calls.slice(2), [['a gone'], ['c gone']]);
  assert.throws(() => mountSlot(host, 'nope', {}), /Unknown dashboard slot/);
});

test('the dashboard keeps to its own scripts and stays calm', () => {
  const dir = join(ROOT, 'public/js/parent');
  const html = readFileSync(join(ROOT, 'public/parents/index.html'), 'utf8');
  assert.ok(html.includes('<script type="module" src="/js/parent/app.js"></script>'));
  assert.ok(!html.includes('admin.js'));
  assert.match(html, /\{\{brand\.name\}\} by/, 'the credit names the product through the brand token');
  for (const name of readdirSync(dir)) {
    const source = readFileSync(join(dir, name), 'utf8');
    assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/, `${name} builds the page from nodes, not markup`);
    assert.doesNotMatch(source, /\bKidTube\b/, `${name} names the product only through the brand`);
  }
  const app = readFileSync(join(dir, 'app.js'), 'utf8');
  for (const tab of ['home', 'review', 'kids', 'videos', 'comments', 'people', 'guests', 'activity', 'watched', 'settings']) {
    assert.match(app, new RegExp(`id: '${tab}'`), `the ${tab} tab is in the nav`);
  }
  for (const tab of ['kids', 'people', 'watched', 'settings']) assert.match(app, new RegExp(`id: '${tab}'[^}]*owner: true`), `${tab} is for the owner`);
});
