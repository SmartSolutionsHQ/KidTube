import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LEAD_MS, MIN_LEAD_MS, createCapsules, sealedFor, validateSeal } from '../server/capsules.mjs';
import { approveClip, publishClip } from '../server/publish.mjs';
import { videoEmail } from '../server/notifications.mjs';
import { PARENT } from './helpers.mjs';
import { MEDIA, memoryDatabase, startFamily } from './family-fixture.mjs';

const MINUTE = 60000;
const roundUp = ms => Math.ceil(ms / MINUTE) * MINUTE;
const NOW = Date.UTC(2026, 9, 22, 15, 0);

test('validateSeal: an hour to 25 years away, whole minutes, a short printable note', () => {
  assert.deepEqual(validateSeal(NOW + MIN_LEAD_MS, '  From Nana.  ', NOW), { ok: true, opensAt: NOW + MIN_LEAD_MS, note: 'From Nana.' });
  assert.equal(validateSeal(String(NOW + 2 * MIN_LEAD_MS), '', NOW).opensAt, NOW + 2 * MIN_LEAD_MS, 'a numeric string is fine');
  assert.deepEqual(validateSeal(NOW + MIN_LEAD_MS - MINUTE, '', NOW), { ok: false, error: 'Pick a date at least an hour away.' });
  assert.deepEqual(validateSeal(NOW - MIN_LEAD_MS, '', NOW), { ok: false, error: 'Pick a date at least an hour away.' });
  assert.equal(validateSeal(NOW + MAX_LEAD_MS - (NOW + MAX_LEAD_MS) % MINUTE, '', NOW).ok, true);
  assert.deepEqual(validateSeal(NOW + MAX_LEAD_MS + MINUTE, '', NOW), { ok: false, error: 'Pick a date within the next 25 years.' });
  assert.equal(validateSeal(NOW + MIN_LEAD_MS + 1, '', NOW).ok, false, 'whole minutes only');
  assert.equal(validateSeal('soon', '', NOW).ok, false);
  assert.equal(validateSeal(null, '', NOW).ok, false);
  assert.equal(validateSeal(NOW + MIN_LEAD_MS, 'x'.repeat(140), NOW).ok, true);
  assert.deepEqual(validateSeal(NOW + MIN_LEAD_MS, 'x'.repeat(141), NOW), { ok: false, error: 'Keep the note to 140 characters.' });
  assert.equal(validateSeal(NOW + MIN_LEAD_MS, '🎂'.repeat(140), NOW).ok, true, 'characters, not UTF-16 units');
  assert.equal(validateSeal(NOW + MIN_LEAD_MS, 'line one\nline two', NOW).note, 'line one line two');
  assert.equal(validateSeal(NOW + MIN_LEAD_MS, 'bell\u0007', NOW).ok, false);
  assert.equal(validateSeal(NOW + MIN_LEAD_MS, 'hidden‮text', NOW).ok, false, 'no direction overrides');
});

test('sealedFor is clock based and lets only parents through', async t => {
  const sqlite = await memoryDatabase(t);
  sqlite.prepare("INSERT INTO clips (id,title,src,position,created,opens_at) VALUES ('c','C','/x',1,0,?)").run(NOW + MINUTE);
  assert.deepEqual(sealedFor(sqlite, 'c', { role: '', email: 'v@example.com' }, NOW), { opensAt: NOW + MINUTE });
  assert.deepEqual(sealedFor(sqlite, 'c', { role: 'kid', email: 'k@kids.invalid' }, NOW), { opensAt: NOW + MINUTE });
  assert.deepEqual(sealedFor(sqlite, 'c', { role: 'guest' }, NOW), { opensAt: NOW + MINUTE });
  assert.equal(sealedFor(sqlite, 'c', null, NOW + MINUTE), null, 'open the moment the date passes, tick or no tick');
  assert.equal(sealedFor(sqlite, 'c', { role: 'admin', email: 'a@example.com' }, NOW), null);
  assert.equal(sealedFor(sqlite, 'c', { role: 'super', email: 'p@example.com' }, NOW), null);
  assert.equal(sealedFor(sqlite, 'missing', null, NOW), null);
});

function outbox() {
  const sent = [];
  return { sent, enqueue(clip) { sent.push(clip); }, kick() { sent.kicked = (sent.kicked || 0) + 1; } };
}

test('tick opens a due capsule once: it leads its channel, is announced and logged', async t => {
  const sqlite = await memoryDatabase(t);
  sqlite.exec(`INSERT INTO clips (id,title,src,position,created,channel_id,published) VALUES
    ('a','A','/a',1,0,1,'2026-10-01'), ('b','B','/b',2,0,1,'2026-10-02'), ('later','Later','/l',3,0,1,'2026-10-03'), ('gone','Gone','/g',4,0,1,'2026-10-04')`);
  sqlite.prepare("UPDATE clips SET opens_at=?, capsule_note='Open me', sealed_by=? WHERE id='b'").run(NOW - MINUTE, PARENT.email);
  sqlite.prepare("UPDATE clips SET opens_at=? WHERE id='later'").run(NOW + MINUTE);
  sqlite.prepare("UPDATE clips SET opens_at=?, hidden=1 WHERE id='gone'").run(NOW - MINUTE);
  const notifications = outbox();
  const capsules = createCapsules({ sqlite, notifications, env: {}, now: () => NOW });
  assert.deepEqual(capsules.tick(NOW), ['b']);
  assert.deepEqual(sqlite.prepare('SELECT id, position, opened_at FROM clips ORDER BY position').all().map(row => ({ ...row })), [
    { id: 'b', position: 1, opened_at: NOW }, { id: 'a', position: 2, opened_at: 0 }, { id: 'later', position: 4, opened_at: 0 }, { id: 'gone', position: 5, opened_at: 0 },
  ]);
  assert.equal(notifications.sent.length, 1);
  assert.equal(notifications.sent[0].id, 'b');
  assert.equal(notifications.sent[0].capsule, true);
  assert.equal(notifications.sent[0].capsuleNote, 'Open me');
  assert.equal(notifications.sent.kicked, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM activity WHERE kind='capsule.open' AND subject='b'").get().n, 1);
  assert.deepEqual(capsules.tick(NOW + MINUTE), ['later'], 'each opens once, on its own date');
  assert.deepEqual(capsules.tick(NOW + 2 * MINUTE), [], 'nothing opens twice; hidden clips wait until they are shown');
  assert.equal(notifications.sent.length, 2);
});

test('a kid\'s sealed upload waits for review, and approval opens it only once its date has passed', async t => {
  const sqlite = await memoryDatabase(t);
  const notifications = outbox();
  const clip = (id, opensAt) => ({ id, title: id, src: `/api/video/${id}`, publishedAt: '2026-10-22T10:00:00Z', duration: 9, review: 'pending',
    opensAt, capsuleNote: 'For later', sealedBy: 'tobi@kids.invalid' });
  publishClip(sqlite, notifications, clip('future', Date.now() + 3 * MIN_LEAD_MS));
  publishClip(sqlite, notifications, clip('passed', Date.now() + 3 * MIN_LEAD_MS));
  assert.equal(notifications.sent.length, 0, 'pending clips are not announced');
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM activity WHERE kind='capsule.seal'").get().n, 2);
  // Its date passes while it waits: the tick leaves it alone because it is not approved yet.
  sqlite.prepare("UPDATE clips SET opens_at=? WHERE id='passed'").run(Date.now() - MINUTE);
  const capsules = createCapsules({ sqlite, notifications, env: {} });
  assert.deepEqual(capsules.tick(), []);
  approveClip(sqlite, notifications, 'future', PARENT.email);
  assert.equal(notifications.sent.length, 0, 'a still-sealed capsule is announced when it opens, not when approved');
  assert.equal(sqlite.prepare("SELECT opened_at FROM clips WHERE id='future'").get().opened_at, 0);
  approveClip(sqlite, notifications, 'passed', PARENT.email);
  assert.equal(notifications.sent.length, 1);
  assert.equal(notifications.sent[0].capsule, true);
  assert.ok(sqlite.prepare("SELECT opened_at FROM clips WHERE id='passed'").get().opened_at > 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM activity WHERE kind='capsule.open' AND subject='passed'").get().n, 1);
  assert.deepEqual(capsules.tick(), [], 'approval opened it; the tick does not open it again');
});

test('publishing a parent\'s sealed upload stores the seal and holds the announcement', async t => {
  const sqlite = await memoryDatabase(t);
  const notifications = outbox();
  const opensAt = roundUp(Date.now() + 2 * MIN_LEAD_MS);
  publishClip(sqlite, notifications, { id: 'cap', title: 'Cap', src: '/api/video/cap', publishedAt: '2026-10-22T10:00:00Z', duration: 9,
    opensAt, capsuleNote: 'From Nana', sealedBy: PARENT.email });
  assert.deepEqual({ ...sqlite.prepare("SELECT review, opens_at, opened_at, capsule_note, sealed_by FROM clips WHERE id='cap'").get() },
    { review: 'approved', opens_at: opensAt, opened_at: 0, capsule_note: 'From Nana', sealed_by: PARENT.email });
  assert.equal(notifications.sent.length, 0);
});

test('the capsule email has its own subject and carries the note, escaped', () => {
  const clip = { id: 'cap', title: 'First steps', duration: 12, published: '2026-10-22T10:00:00Z', channel: 'tobi', channel_name: 'Tobi <3', capsule_note: 'Open on your 10th <b>birthday</b>' };
  const email = videoEmail(clip, { siteUrl: new URL('http://localhost:3000'), unsubscribeUrl: 'http://localhost:3000/u' });
  assert.equal(email.subject, "A time capsule just opened on Tobi <3's channel");
  assert.match(email.text, /Open on your 10th <b>birthday<\/b>/);
  assert.match(email.html, /Tobi &lt;3&#39;s channel/);
  assert.match(email.html, /&lt;b&gt;birthday&lt;\/b&gt;/);
  assert.doesNotMatch(email.html, /<b>birthday/);
  assert.equal(videoEmail({ ...clip, capsule_note: null }, { siteUrl: new URL('http://localhost:3000'), unsubscribeUrl: 'x' }).subject, 'New video on KidTube');
});

test('time capsules on the real routes', { timeout: 60000 }, async t => {
  const family = await startFamily(t);
  const { db, json, status, parent, coparent, viewer, kid, guest } = family;
  const opensAt = roundUp(Date.now() + 3 * MIN_LEAD_MS);
  // A like from before it was sealed must not show while it is.
  assert.equal((await json('/api/like', { body: { clipId: 'tobi-2', email: viewer.email, t: viewer.t, on: true } })).status, 200);

  await t.test('only parents seal, with readable errors', async () => {
    const seal = (who, body) => json('/api/admin/clips/seal', { body: { email: who.email, t: who.t, id: 'tobi-2', ...body } });
    assert.equal((await seal(viewer, { opensAt })).status, 403);
    assert.equal((await seal(kid, { opensAt })).status, 403);
    assert.deepEqual((await seal(parent, { opensAt: Date.now() - MINUTE })).body, { ok: false, error: 'Pick a date at least an hour away.' });
    assert.equal((await seal(parent, { opensAt, id: 'nope' })).status, 404);
    const sealed = await seal(coparent, { opensAt, note: 'From Nana. Open on your 10th birthday.' });
    assert.equal(sealed.status, 200);
    assert.equal(sealed.body.clip.sealed, true);
    assert.equal(sealed.body.clip.sealedBy, 'Sam');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM activity WHERE kind='capsule.seal' AND subject='tobi-2'").get().n, 1);
  });

  await t.test('the feed lists it in place as a locked tape without media', async () => {
    const { body } = await json('/api/clips?channel=tobi', { cookie: viewer.cookie });
    assert.deepEqual(body.clips.map(clip => clip.id), ['tobi-1', 'tobi-2']);
    assert.deepEqual(body.clips[1], { id: 'tobi-2', title: 'Clip tobi-2', channel: 'tobi', publishedAt: '2026-10-20T10:00:00Z', seq: 2,
      sealed: true, opensAt, capsuleNote: 'From Nana. Open on your 10th birthday.', sealedBy: 'Sam' });
    for (const key of ['src', 'poster', 'duration', 'blurb', 'kind']) assert.ok(!(key in body.clips[1]), key);
    const staffView = await json('/api/clips?channel=tobi', { cookie: parent.cookie });
    assert.equal(staffView.body.clips[1].sealed, true, 'parents see the locked tape in the feed too');
  });

  await t.test('its video, poster, comments, likes and reactions refuse everyone but parents', async () => {
    const video = `/api/video/${MEDIA.two}`;
    for (const who of [viewer, kid, guest]) {
      for (const path of [video, `${video}/poster`, '/api/comments?c=tobi-2']) {
        const answer = await json(path, { cookie: who.cookie, headers: { range: 'bytes=0-99' } });
        assert.equal(answer.status, 403, path);
        assert.deepEqual(answer.body, { ok: false, error: 'sealed', opensAt });
      }
    }
    for (const [path, body] of [['/api/comment', { body: 'hi' }], ['/api/like', { on: true }], ['/api/react', { kind: 'wow', on: true }]]) {
      const answer = await json(path, { cookie: viewer.cookie, body: { clipId: 'tobi-2', email: viewer.email, t: viewer.t, ...body } });
      assert.equal(answer.status, 403, path);
      assert.equal(answer.body.error, 'sealed');
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM comments WHERE clip_id='tobi-2'").get().n, 0);
    const likes = await json(`/api/likes?${family.staffQuery(viewer)}`, { cookie: viewer.cookie });
    assert.ok(!('tobi-2' in likes.body.counts) && !('tobi-2' in likes.body.liked), 'counts leave sealed clips out');
    for (const who of [parent, coparent]) {
      assert.equal(await status(video, { cookie: who.cookie }), 200);
      assert.equal(await status(`${video}/poster`, { cookie: who.cookie }), 200);
    }
    assert.equal(await status(`/api/video/${MEDIA.one}`, { cookie: viewer.cookie }), 200, 'its neighbours play as usual');
  });

  await t.test('opening it now re-leads the channel and the feed gets openedAt', async () => {
    assert.equal((await json('/api/admin/clips/unseal', { body: { email: viewer.email, t: viewer.t, id: 'tobi-2' } })).status, 403);
    const opened = await json('/api/admin/clips/unseal', { body: { email: PARENT.email, t: parent.t, id: 'tobi-2' } });
    assert.equal(opened.status, 200);
    assert.equal(opened.body.clip.sealed, false);
    assert.ok(opened.body.clip.openedAt > 0);
    const { body } = await json('/api/clips?channel=tobi', { cookie: viewer.cookie });
    assert.deepEqual(body.clips.map(clip => clip.id), ['tobi-2', 'tobi-1']);
    assert.equal(body.clips[0].openedAt, opened.body.clip.openedAt);
    assert.equal(body.clips[0].src, `/api/video/${MEDIA.two}`);
    assert.equal(await status(`/api/video/${MEDIA.two}`, { cookie: viewer.cookie }), 200);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM activity WHERE kind IN ('capsule.unseal','capsule.open') AND subject='tobi-2'").get().n, 2);
    assert.equal((await json('/api/admin/clips/unseal', { body: { email: PARENT.email, t: parent.t, id: 'tobi-2' } })).status, 409, 'already open');
  });

  await t.test('the dashboard lists capsules per kid', async () => {
    const list = await json(`/api/admin/capsules?channel=tobi&${family.staffQuery(parent)}`);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.capsules.map(capsule => [capsule.id, capsule.sealed]), [['tobi-2', false]]);
    assert.equal((await json('/api/admin/capsules', { cookie: viewer.cookie })).status, 403);
    assert.equal((await json('/api/admin/capsules', { cookie: parent.cookie })).status, 200, 'a parent cookie is enough to read');
  });

  await t.test('sealing at upload is validated before any bytes arrive', async () => {
    const start = body => json('/api/upload/raw/start', { body: { email: PARENT.email, t: parent.t, title: 'Birthday', size: 4096, channel: 'tobi', ...body } });
    assert.deepEqual((await start({ opensAt: Date.now() + MINUTE })).body, { ok: false, error: 'Pick a date at least an hour away.' });
    const good = await start({ opensAt, capsuleNote: 'Happy birthday' });
    assert.equal(good.status, 200);
    assert.deepEqual({ ...db.prepare('SELECT opens_at, capsule_note FROM upload_jobs WHERE id=?').get(good.body.uploadId) }, { opens_at: opensAt, capsule_note: 'Happy birthday' });
  });
});
