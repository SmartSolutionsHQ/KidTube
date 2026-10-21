import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createVideoNotifications, videoEmail } from '../server/notifications.mjs';
import { publishClip } from '../server/publish.mjs';

const env = {
  SIGN_SECRET: 'test-secret', BREVO_API_KEY: 'fake-key', SENDER_EMAIL: 'tube@example.com',
  SITE_URL: 'https://tube.example.com',
};
const clip = {
  id: 'new-clip-1', title: 'Family & the <Bean> Brigade', blurb: 'Bring "pizza" <script>alert(1)</script>',
  src: '/api/video/test-video', duration: 62.4, kind: 'video', publishedAt: '2026-10-20T18:30:00Z',
};

function fixture(t, fetchImpl) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE clips (id TEXT PRIMARY KEY, title TEXT NOT NULL, src TEXT NOT NULL,
      poster TEXT, kind TEXT, blurb TEXT, published TEXT, duration REAL,
      position INTEGER, created INTEGER, hidden INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE accounts (email TEXT PRIMARY KEY, status TEXT NOT NULL, role TEXT);
    INSERT INTO accounts VALUES ('viewer@example.com','approved',''), ('kid@example.com','approved','admin'),
      ('parent@example.com','approved','super'), ('pending@example.com','pending',''), ('denied@example.com','denied','');`);
  let clock = Date.parse('2026-10-20T18:30:00Z');
  const sent = [];
  const fetcher = fetchImpl || (async (url, options) => {
    sent.push({ url, httpHeaders: options.headers, ...JSON.parse(options.body) });
    return Response.json({ messageId: `message-${sent.length}` }, { status: 201 });
  });
  const options = { sqlite, env, now: () => clock, fetchImpl: fetcher, logger: { error() {} } };
  let notifications = createVideoNotifications(options);
  t.after(async () => { await notifications.close(); sqlite.close(); });
  return {
    sqlite, sent, get notifications() { return notifications; },
    advance(ms) { clock += ms; },
    async restart() { await notifications.close(); notifications = createVideoNotifications(options); },
    publish(value = clip) { publishClip(sqlite, notifications, value); },
    queue(value = clip) {
      // Hold delivery until the test is ready to exercise a restart or an account change.
      const paused = { enqueue: notifications.enqueue, kick() {} };
      publishClip(sqlite, paused, value);
    },
  };
}

function unsubscribeRequest(message, method = 'GET') {
  const url = message.textContent.match(/Stop new-video emails: (\S+)/)[1];
  return new Request(url, { method });
}

test('announces a published video to approved accounts individually with escaped details and a clip link', async t => {
  const f = fixture(t);
  f.publish();
  await f.notifications.kick();
  assert.deepEqual(f.sent.map(m => m.to[0].email).sort(), ['kid@example.com', 'parent@example.com', 'viewer@example.com']);
  for (const message of f.sent) {
    assert.equal(message.subject, 'New video on KidTube');
    assert.equal(message.to.length, 1);
    assert.equal(message.bcc, undefined);
    assert.equal(message.httpHeaders['api-key'], 'fake-key');
    assert.match(message.textContent, /family channel/);
    assert.match(message.textContent, /Family & the <Bean> Brigade/);
    assert.match(message.textContent, /Length: 1:02/);
    assert.match(message.textContent, /Oct 20, 2026, 6:30 PM \(UTC\)/);
    assert.match(message.htmlContent, /Family &amp; the &lt;Bean&gt; Brigade/);
    assert.ok(!message.htmlContent.includes('<script>'));
    assert.match(message.htmlContent, /https:\/\/tube\.example\.com\/#\/v\/new-clip-1/);
    assert.match(message.htmlContent, /Watch the new vid/);
  }
  assert.equal(new Set(f.sent.map(m => m.headers.idempotencyKey)).size, 3);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM video_notification_deliveries WHERE status='sent'").get().n, 3);
  f.notifications.enqueue(clip);
  f.sqlite.prepare("UPDATE clips SET title='Renamed', position=2 WHERE id=?").run(clip.id);
  await f.restart();
  await f.notifications.kick();
  assert.equal(f.sent.length, 3, 'restart, rename, and repeated enqueue do not announce the same clip again');
});

test('unsubscribe needs a signed confirmation and stops queued and future video emails only', async t => {
  const f = fixture(t);
  f.publish();
  await f.notifications.kick();
  const viewer = f.sent.find(m => m.to[0].email === 'viewer@example.com');
  const get = unsubscribeRequest(viewer);
  const confirmation = f.notifications.handleUnsubscribe(get);
  assert.equal(confirmation.status, 200);
  assert.match(await confirmation.text(), /<form method="post"/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM video_email_preferences').get().n, 0, 'link scanners cannot unsubscribe');
  const forged = new URL(get.url);
  forged.searchParams.set('s', '0'.repeat(64));
  assert.equal(f.notifications.handleUnsubscribe(new Request(forged, { method: 'POST' })).status, 403);
  assert.equal(f.notifications.handleUnsubscribe(new Request(get.url, { method: 'DELETE' })).status, 405);
  f.queue({ ...clip, id: 'queued-clip' });
  assert.equal(f.notifications.handleUnsubscribe(unsubscribeRequest(viewer, 'POST')).status, 200);
  assert.equal(f.notifications.handleUnsubscribe(unsubscribeRequest(viewer, 'POST')).status, 200, 'confirmation is safe to repeat');
  await f.notifications.kick();
  f.publish({ ...clip, id: 'future-clip' });
  await f.notifications.kick();
  assert.equal(f.sent.filter(m => m.to[0].email === 'viewer@example.com').length, 1);
  assert.equal(f.sqlite.prepare("SELECT status FROM accounts WHERE email='viewer@example.com'").get().status, 'approved');
  assert.equal(f.sqlite.prepare("SELECT status FROM video_notification_deliveries WHERE clip_id='queued-clip' AND email='viewer@example.com'").get().status, 'skipped');
});

test('resumes persisted deliveries and rechecks account status and clip availability', async t => {
  const f = fixture(t);
  f.queue();
  f.sqlite.prepare("UPDATE accounts SET status='denied' WHERE email='viewer@example.com'").run();
  f.sqlite.prepare("DELETE FROM accounts WHERE email='parent@example.com'").run();
  await f.restart();
  await f.notifications.kick();
  assert.deepEqual(f.sent.map(m => m.to[0].email), ['kid@example.com']);
  f.queue({ ...clip, id: 'hidden-clip' });
  f.sqlite.prepare("UPDATE clips SET hidden=1 WHERE id='hidden-clip'").run();
  f.queue({ ...clip, id: 'deleted-clip' });
  f.sqlite.prepare("DELETE FROM clips WHERE id='deleted-clip'").run();
  await f.notifications.kick();
  assert.equal(f.sent.length, 1);
});

test('does not backfill old clips or include people approved after publication', async t => {
  const f = fixture(t);
  f.sqlite.prepare("INSERT INTO clips (id,title,src) VALUES ('old-clip','Old video','/old.mp4')").run();
  await f.restart();
  await f.notifications.kick();
  assert.equal(f.sent.length, 0);
  f.queue();
  f.sqlite.prepare("UPDATE accounts SET status='approved' WHERE email='pending@example.com'").run();
  await f.notifications.kick();
  assert.equal(f.sent.length, 3);
});

test('retries provider failures across restart with the same delivery key and respects Retry-After', async t => {
  const requests = [];
  let calls = 0;
  const f = fixture(t, async (url, options) => {
    requests.push(JSON.parse(options.body));
    if (++calls === 1) return Response.json({ code: 'too_many_requests' }, { status: 429, headers: { 'retry-after': '120' } });
    if (calls === 4) return Response.json({ code: 'duplicate_parameter' }, { status: 400 });
    return Response.json({ messageId: 'accepted' }, { status: 201 });
  });
  f.publish();
  await f.notifications.kick();
  assert.equal(calls, 3, 'one recipient failure does not block the others');
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM video_notification_deliveries WHERE status='pending'").get().n, 1);
  f.advance(60000);
  await f.restart();
  await f.notifications.kick();
  assert.equal(calls, 3);
  f.advance(60000);
  await f.notifications.kick();
  assert.equal(calls, 4);
  assert.deepEqual(requests[3], requests[0], 'retry uses the same email and Brevo UUID');
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM video_notification_deliveries WHERE status='sent'").get().n, 3);
});

test('records permanent failures and bounds transient retries without undoing publication', async t => {
  let permanent = true;
  const f = fixture(t, async () => {
    if (permanent) return Response.json({ code: 'invalid_parameter' }, { status: 400 });
    throw new Error('Network unavailable');
  });
  f.publish();
  await f.notifications.kick();
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM video_notification_deliveries WHERE status='failed' AND attempts=1").get().n, 3);
  assert.ok(f.sqlite.prepare('SELECT id FROM clips WHERE id=?').get(clip.id));
  permanent = false;
  f.publish({ ...clip, id: 'retry-clip' });
  await f.notifications.kick();
  for (let attempt = 1; attempt < 8; attempt++) {
    f.advance(3600000);
    await f.notifications.kick();
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM video_notification_deliveries WHERE clip_id='retry-clip' AND status='failed' AND attempts=8").get().n, 3);
});

test('rolls back publication with the outbox if saving recipients fails', async t => {
  const f = fixture(t);
  f.sqlite.exec(`CREATE TRIGGER fail_delivery BEFORE INSERT ON video_notification_deliveries
    BEGIN SELECT RAISE(ABORT, 'disk error'); END`);
  assert.throws(() => f.publish(), /disk error/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM clips').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM video_announcements').get().n, 0);
  assert.equal(f.sent.length, 0);
});

test('email links keep working when another newer video exists', () => {
  const message = videoEmail({ ...clip, published: clip.publishedAt }, { siteUrl: env.SITE_URL, unsubscribeUrl: 'https://tube.example.com/unsubscribe' });
  assert.match(message.text, /Watch the new vid: https:\/\/tube\.example\.com\/#\/v\/new-clip-1/);
});
