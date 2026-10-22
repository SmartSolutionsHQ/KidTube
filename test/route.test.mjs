import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEEP_LINK, channelHash, parseRoute, routeClip } from '../public/js/shell/route.mjs';

test('channel, clip, legacy and front-door routes', () => {
  assert.deepEqual(parseRoute('#/c/milo'), { name: 'channel', slug: 'milo' });
  assert.deepEqual(parseRoute('#/c/milo/'), { name: 'channel', slug: 'milo' });
  assert.deepEqual(parseRoute('#/c/zoe-ann/v/1b2c-3d_4'), { name: 'clip', slug: 'zoe-ann', id: '1b2c-3d_4' });
  assert.deepEqual(parseRoute('#/v/1b2c3d4e-0000-4000-8000-000000000000'), { name: 'legacy', id: '1b2c3d4e-0000-4000-8000-000000000000' });
  for (const hash of ['', '#', '#/', '#/about', '#/c/', '#/c/Milo', '#/c/-milo', '#/c/a%2Fb', '#/v/', '#/v/a/b', '#/v/<x>', '#/c/milo/v/a b']) {
    const route = parseRoute(hash);
    assert.ok(route.name === 'home' || route.name === 'channel', hash);
    assert.equal(routeClip(route), null, hash);
  }
  // A channel link with junk after the slug still opens the channel.
  assert.deepEqual(parseRoute('#/c/milo/x/y'), { name: 'channel', slug: 'milo' });
  assert.deepEqual(parseRoute('#/c/milo/v/%E0%A4%A'), { name: 'channel', slug: 'milo' }, 'bad escapes never throw');
});

test('hashes are built from safe parts only', () => {
  assert.equal(channelHash('milo'), '#/c/milo');
  assert.equal(channelHash('milo', 'abc-1'), '#/c/milo/v/abc-1');
  assert.equal(channelHash('', 'abc-1'), '#/v/abc-1');
  assert.equal(channelHash('../x', 'a/b'), '#/');
  assert.equal(channelHash('milo', 'a/b'), '#/c/milo');
  for (const hash of [channelHash('milo', 'abc-1'), channelHash('', 'abc-1')]) assert.deepEqual(parseRoute(hash).id, 'abc-1');
});

test('the feed deep-link pattern reads both link forms', () => {
  assert.equal('#/c/milo/v/abc-1'.match(DEEP_LINK)[1], 'abc-1');
  assert.equal('#/v/abc-1'.match(DEEP_LINK)[1], 'abc-1');
  assert.equal('#/c/milo'.match(DEEP_LINK), null);
  // feed.js carries the same pattern inline; keep the two in step.
  const feed = readFileSync(new URL('../public/js/feed.js', import.meta.url), 'utf8');
  assert.ok(feed.includes(DEEP_LINK.source), 'feed.js uses the shared deep-link pattern');
});
