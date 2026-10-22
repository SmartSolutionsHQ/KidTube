import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KINDS, RATE_LIMIT } from '../server/reactions.mjs';
import { ROOT, PARENT } from './helpers.mjs';
import { startFamily } from './family-fixture.mjs';

test('every reaction kind is a vendored sticker', () => {
  const stickers = JSON.parse(readFileSync(join(ROOT, 'public/badge/stickers.json'), 'utf8')).stickers.map(sticker => sticker.id);
  assert.deepEqual(KINDS, ['wow', 'flame', 'star', 'party', 'cool']);
  for (const kind of KINDS) assert.ok(stickers.includes(kind), `${kind} is missing from stickers.json`);
});

test('reactions on the real routes', { timeout: 60000 }, async t => {
  const family = await startFamily(t);
  const { db, json, parent, viewer, kid, guest } = family;
  const react = (who, body, cookie = who.cookie) => json('/api/react', { cookie, body: { email: who.email, t: who.t, clipId: 'tobi-1', kind: 'wow', on: true, ...body } });

  await t.test('toggling is idempotent and answers that clip\'s counts', async () => {
    assert.deepEqual((await react(viewer)).body, { ok: true, kind: 'wow', on: true, counts: { wow: 1 } });
    assert.deepEqual((await react(viewer)).body.counts, { wow: 1 }, 'on twice is still one');
    assert.deepEqual((await react(kid, { kind: 'flame' })).body.counts, { wow: 1, flame: 1 });
    assert.deepEqual((await react(parent)).body.counts, { wow: 2, flame: 1 });
    assert.deepEqual((await react(parent, { on: false })).body, { ok: true, kind: 'wow', on: false, counts: { wow: 1, flame: 1 } });
    assert.deepEqual((await react(parent, { on: false })).body.counts, { wow: 1, flame: 1 }, 'off twice is still off');
  });

  await t.test('GET /api/reactions gives counts and the caller\'s own', async () => {
    const mine = await json('/api/reactions', { cookie: viewer.cookie });
    assert.deepEqual(mine.body, { ok: true, counts: { 'tobi-1': { wow: 1, flame: 1 } }, mine: { 'tobi-1': ['wow'] } });
    assert.deepEqual((await json('/api/reactions', { cookie: guest.cookie })).body.mine, {}, 'guests see counts only');
    assert.equal((await json('/api/reactions')).status, 401, 'cookie-gated like /api/likes');
  });

  await t.test('guests and signed-out callers are told to log in; bad kinds and clips are refused', async () => {
    const asGuest = await json('/api/react', { cookie: guest.cookie, body: { clipId: 'tobi-1', kind: 'wow', on: true } });
    assert.deepEqual([asGuest.status, asGuest.body.error], [401, 'log in to react']);
    const guestWithStolenSession = await react(viewer, {}, guest.cookie);
    assert.equal(guestWithStolenSession.status, 401, 'a guest cookie never reacts, whatever the body says');
    assert.equal((await react({ email: viewer.email, t: 'nope' }, {}, viewer.cookie)).status, 401);
    assert.equal((await react(viewer, { kind: 'heart' })).status, 400);
    assert.equal((await react(viewer, { kind: '__proto__' })).status, 400);
    assert.equal((await react(viewer, { clipId: 'no-such-clip' })).status, 404);
    db.prepare("UPDATE clips SET review='pending' WHERE id='ada-1'").run();
    assert.equal((await react(viewer, { clipId: 'ada-1' })).status, 404, 'a clip waiting for review takes no reactions from viewers');
    db.prepare("UPDATE clips SET review='approved' WHERE id='ada-1'").run();
  });

  await t.test('sealed and hidden clips: refused and left out of the counts', async () => {
    assert.equal((await react(viewer, { clipId: 'tobi-2', kind: 'star' })).status, 200);
    db.prepare("UPDATE clips SET opens_at=? WHERE id='tobi-2'").run(Date.now() + 3600000);
    const sealed = await react(viewer, { clipId: 'tobi-2', kind: 'party' });
    assert.deepEqual([sealed.status, sealed.body.error], [403, 'sealed']);
    assert.ok(!('tobi-2' in (await json('/api/reactions', { cookie: viewer.cookie })).body.counts));
    db.prepare("UPDATE clips SET opens_at=0, hidden=1 WHERE id='tobi-2'").run();
    assert.ok(!('tobi-2' in (await json('/api/reactions', { cookie: viewer.cookie })).body.counts));
    db.prepare("UPDATE clips SET hidden=0 WHERE id='tobi-2'").run();
    assert.deepEqual((await json('/api/reactions', { cookie: viewer.cookie })).body.counts['tobi-2'], { star: 1 });
  });

  await t.test('a guest pass for one kid sees only that kid\'s counts', async () => {
    assert.equal((await react(viewer, { clipId: 'ada-1', kind: 'cool' })).status, 200);
    const pass = await json('/api/guest/generate', { body: { email: PARENT.email, t: parent.t, channel: 'tobi' } });
    const redeemed = await family.call('/api/guest/redeem', { body: { code: pass.body.code } });
    const cookie = redeemed.headers.get('set-cookie').split(';')[0];
    const counts = (await json('/api/reactions', { cookie })).body.counts;
    assert.ok('tobi-1' in counts && !('ada-1' in counts));
  });

  await t.test('the dashboard overview carries per-clip counts, no names', async () => {
    const overview = await json(`/api/admin/overview?${family.staffQuery(parent)}`);
    const row = overview.body.clips.find(clip => clip.id === 'tobi-1');
    assert.deepEqual(row.reactions, { wow: 1, flame: 1 });
    assert.doesNotMatch(JSON.stringify(row.reactions), /@/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM activity WHERE kind LIKE 'react%'").get().n, 0, 'no activity rows');
  });

  await t.test(`more than ${RATE_LIMIT} writes a minute get 429`, async () => {
    let last;
    for (let i = 0; i <= RATE_LIMIT; i++) last = await react(kid, { kind: 'star', on: i % 2 === 0 });
    assert.equal(last.status, 429);
    assert.equal((await react(viewer, { kind: 'star' })).status, 200, 'the limit is per account');
  });
});
