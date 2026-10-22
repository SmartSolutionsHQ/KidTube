import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettings } from '../server/settings.mjs';
import { BEAT_SLACK_S, createWatch, dayKey, dayStart, resetsAt } from '../server/watch.mjs';
import { PARENT } from './helpers.mjs';
import { KID_EMAIL, MEDIA, drive, memoryDatabase, startFamily } from './family-fixture.mjs';

const LA = 'America/Los_Angeles';
const iso = ms => new Date(ms).toISOString();

test('dayKey, dayStart and resetsAt follow the family clock across DST and a zone change', () => {
  // A normal day in Los Angeles (PDT, UTC-7).
  const noon = Date.parse('2026-10-22T19:00:00Z');
  assert.equal(dayKey(noon, LA), '2026-10-22');
  assert.equal(iso(dayStart(noon, LA)), '2026-10-22T07:00:00.000Z');
  assert.equal(iso(resetsAt(noon, LA)), '2026-10-23T07:00:00.000Z');
  // Clocks fall back on Sunday 1 November 2026: a 25-hour day.
  const fallBack = Date.parse('2026-11-01T20:00:00Z');
  assert.equal(iso(dayStart(fallBack, LA)), '2026-11-01T07:00:00.000Z');
  assert.equal(iso(resetsAt(fallBack, LA)), '2026-11-02T08:00:00.000Z');
  // Clocks spring forward on Sunday 8 March 2026: a 23-hour day.
  const springForward = Date.parse('2026-03-08T20:00:00Z');
  assert.equal(iso(dayStart(springForward, LA)), '2026-03-08T08:00:00.000Z');
  assert.equal(iso(resetsAt(springForward, LA)), '2026-03-09T07:00:00.000Z');
  // Just before and at local midnight.
  assert.equal(dayKey(Date.parse('2026-10-23T06:59:59Z'), LA), '2026-10-22');
  assert.equal(dayKey(Date.parse('2026-10-23T07:00:00Z'), LA), '2026-10-23');
  assert.equal(iso(resetsAt(Date.parse('2026-10-23T06:59:59.999Z'), LA)), '2026-10-23T07:00:00.000Z');
  // The same instant is a different day in Auckland, and the reset moves with the zone.
  assert.equal(dayKey(noon, 'Pacific/Auckland'), '2026-10-23');
  assert.equal(iso(resetsAt(noon, 'Pacific/Auckland')), '2026-10-23T11:00:00.000Z');
  assert.equal(iso(resetsAt(noon, 'UTC')), '2026-10-23T00:00:00.000Z');
  assert.equal(iso(resetsAt(noon, 'Asia/Kolkata')), '2026-10-23T18:30:00.000Z', 'half-hour zones (already the 23rd there)');
});

async function ledger(t, start) {
  const sqlite = await memoryDatabase(t);
  const settings = createSettings(sqlite, {});
  settings.set('family_timezone', LA);
  const clock = { now: start };
  const watch = createWatch({ sqlite, settings, env: {}, now: () => clock.now });
  sqlite.exec(`INSERT INTO accounts (email,first,last,salt,hash,status,role,created,channel_id,watch_budget_minutes) VALUES
    ('kid@kids.invalid','Tobi','','s','h','approved','kid',0,1,30), ('nana@example.com','Nana','O','s','h','approved','',0,NULL,0),
    ('mum@example.com','Remi','O','s','h','approved','super',0,NULL,30), ('co@example.com','Sam','O','s','h','approved','admin',0,NULL,30);
    INSERT INTO clips (id,title,src,position,created,channel_id,duration) VALUES ('c1','One','/api/video/x',1,0,1,40);`);
  const who = email => ({ email, role: sqlite.prepare('SELECT role FROM accounts WHERE email=?').get(email)?.role || '' });
  const start$ = (email, clipId = 'c1') => drive(watch.handle, { url: '/api/view', body: { clipId }, who: email.startsWith?.('guest') ? { role: 'guest', channelId: null, guestId: 'abcdefabcdef' } : who(email) });
  const beat = (email, body) => drive(watch.handle, { url: '/api/view/beat', body, who: who(email) });
  const used = (email, seconds) => sqlite.prepare('INSERT INTO views (clip_id,channel_id,viewer,started,updated,seconds) VALUES (?,?,?,?,?,?)')
    .run('c1', 1, email, clock.now, clock.now, seconds);
  return { sqlite, settings, clock, watch, start: start$, beat, used };
}

test('a heartbeat never credits more than the wall time since the last one, plus slack', async t => {
  const { clock, start, beat, sqlite, watch } = await ledger(t, Date.parse('2026-10-22T19:00:00Z'));
  const view = await start('nana@example.com');
  assert.equal(view.status, 200);
  assert.equal(view.body.budget, null, 'unbudgeted accounts get budget: null');
  clock.now += 15000;
  const first = await beat('nana@example.com', { viewId: view.body.viewId, seconds: 600 });
  assert.equal(first.body.added, 15 + BEAT_SLACK_S, 'a 600 s claim after 15 s of wall time adds 17');
  clock.now += 15000;
  assert.equal((await beat('nana@example.com', { viewId: view.body.viewId, seconds: 14, completed: true })).body.added, 14);
  assert.deepEqual({ ...sqlite.prepare('SELECT seconds, completed FROM views WHERE id=?').get(view.body.viewId) }, { seconds: 31, completed: 1 });
  clock.now += 1000;
  assert.equal((await beat('nana@example.com', { viewId: view.body.viewId, seconds: -50 })).body.added, 0, 'negative claims add nothing');
  assert.equal((await beat('kid@kids.invalid', { viewId: view.body.viewId, seconds: 5 })).status, 404, 'only the viewer who started it may report on it');
  const late = await drive(watch.handle, { url: '/api/view', body: { clipId: 'c1', seconds: 30 }, who: { email: 'nana@example.com', role: '' } });
  assert.equal(sqlite.prepare('SELECT seconds FROM views WHERE id=?').get(late.body.viewId).seconds, 5, 'the seconds before a view starts count, up to 5');
});

test('budgets: staff and guests never; a spent tape ends today, bonus extends today only, midnight resets', async t => {
  const evening = Date.parse('2026-10-23T06:30:00Z'); // 23:30 in Los Angeles
  const { clock, watch, start, beat, used, sqlite } = await ledger(t, evening);
  assert.equal(watch.budgetFor('mum@example.com'), null, 'the owner is never limited, even with minutes stored');
  assert.equal(watch.budgetFor('co@example.com'), null, 'Family is never limited');
  assert.equal(watch.budgetFor('nana@example.com'), null);
  assert.equal((await start('guest:abcdefabcdef')).body.budget, null, 'guests are never limited');
  assert.deepEqual(watch.budgetFor('kid@kids.invalid'), { limit: 1800, used: 0, remaining: 1800, resetsAt: Date.parse('2026-10-23T07:00:00Z') });

  used('kid@kids.invalid', 1790);
  const view = await start('kid@kids.invalid');
  assert.equal(view.body.budget.remaining, 10);
  clock.now += 15000;
  const spent = await beat('kid@kids.invalid', { viewId: view.body.viewId, seconds: 15 });
  assert.equal(spent.body.budget.remaining, 0);
  assert.deepEqual(watch.canWatch({ email: 'kid@kids.invalid' }), { error: 'end-of-tape', resetsAt: Date.parse('2026-10-23T07:00:00Z') });
  const refused = await start('kid@kids.invalid');
  assert.deepEqual([refused.status, refused.body.error], [403, 'end-of-tape']);
  clock.now += 1000;
  await beat('kid@kids.invalid', { viewId: view.body.viewId, seconds: 1 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM activity WHERE kind='budget.end'").get().n, 1, 'budget.end once per day');

  sqlite.prepare("INSERT INTO watch_bonus (email,day,minutes,actor,created) VALUES ('kid@kids.invalid','2026-10-22',15,'mum@example.com',0)").run();
  assert.equal(watch.budgetFor('kid@kids.invalid').remaining, 1800 + 900 - 1806);
  assert.equal(watch.canWatch({ email: 'kid@kids.invalid' }), true);

  clock.now = Date.parse('2026-10-23T07:01:00Z'); // 00:01 the next day
  assert.deepEqual(watch.budgetFor('kid@kids.invalid'), { limit: 1800, used: 0, remaining: 1800, resetsAt: Date.parse('2026-10-24T07:00:00Z') },
    'a new day: yesterday\'s minutes and bonus are gone');
  used('kid@kids.invalid', 1800);
  const again = await start('kid@kids.invalid');
  assert.equal(again.status, 403);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM activity WHERE kind='budget.end'").get().n, 2, 'and once more the next day');
});

test('changing the family zone moves the day boundary', async t => {
  const { settings, watch, used } = await ledger(t, Date.parse('2026-10-22T19:00:00Z'));
  used('kid@kids.invalid', 600);
  assert.equal(watch.budgetFor('kid@kids.invalid').used, 600);
  // The view started at the same instant, so it still counts; the reset moves to Auckland's midnight.
  settings.set('family_timezone', 'Pacific/Auckland');
  assert.equal(watch.budgetFor('kid@kids.invalid').resetsAt, Date.parse('2026-10-23T11:00:00Z'));
  assert.equal(watch.budgetFor('kid@kids.invalid').used, 600);
});

test('prune drops views older than the retention setting', async t => {
  const { sqlite, settings, watch, clock } = await ledger(t, Date.parse('2026-10-22T19:00:00Z'));
  settings.set('views_retention_days', 30);
  const at = days => sqlite.prepare("INSERT INTO views (clip_id,channel_id,viewer,started,updated) VALUES ('c1',1,'nana@example.com',?,?)").run(clock.now - days * 86400000, clock.now);
  at(31); at(29); at(0);
  assert.equal(watch.prune(), 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM views').get().n, 2);
});

test('the watch log holds no IP address or user agent', async t => {
  const { sqlite } = await ledger(t, Date.now());
  const columns = sqlite.prepare('PRAGMA table_info(views)').all().map(row => row.name);
  assert.deepEqual(columns, ['id', 'clip_id', 'channel_id', 'viewer', 'started', 'updated', 'seconds', 'completed']);
});

test('end of tape on the real routes', { timeout: 60000 }, async t => {
  const family = await startFamily(t, { FAMILY_TIMEZONE: 'UTC' });
  const { db, json, status, parent, coparent, viewer, kid, guest } = family;
  const video = `/api/video/${MEDIA.one}`;
  const budget = (who, body) => json('/api/admin/budget', { body: { email: who.email, t: who.t, ...body } });

  await t.test('parents set a daily tape; viewers and kids cannot', async () => {
    assert.equal((await budget(viewer, { target: KID_EMAIL, minutes: 30 })).status, 403);
    assert.equal((await budget(kid, { target: KID_EMAIL, minutes: 30 })).status, 403);
    assert.equal((await budget(parent, { target: KID_EMAIL, minutes: 25 })).status, 400, 'one of the listed choices');
    assert.deepEqual((await budget(parent, { target: coparent.email, minutes: 30 })).body, { ok: false, error: 'Parents are never limited.' });
    const set = await budget(coparent, { target: KID_EMAIL, minutes: 30 });
    assert.equal(set.status, 200);
    assert.equal(set.body.minutes, 30);
    assert.deepEqual(set.body.budget, { limit: 1800, used: 0, remaining: 1800, resetsAt: set.body.resetsAt });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM activity WHERE kind='budget.set' AND subject=?").get(KID_EMAIL).n, 1);
    const kids = await json('/api/admin/budget?channel=tobi', { cookie: parent.cookie });
    assert.deepEqual(kids.body.accounts.map(account => [account.target, account.minutes]), [[KID_EMAIL, 30]], 'the kid logins on one channel');
    assert.deepEqual((await json('/api/admin/budget?channel=ada', { cookie: parent.cookie })).body.accounts, []);
    const state = await json(`/api/admin/budget?target=${encodeURIComponent(KID_EMAIL)}&${family.staffQuery(parent)}`);
    assert.equal(state.body.minutes, 30);
    assert.equal(state.body.timezone, 'UTC');
  });

  await t.test('the feed gets the budget with its clips, and views report against it', async () => {
    assert.equal((await json('/api/clips', { cookie: viewer.cookie })).body.budget, null);
    assert.equal((await json('/api/clips', { cookie: guest.cookie })).body.budget, null);
    assert.equal((await json('/api/clips', { cookie: kid.cookie })).body.budget.remaining, 1800);
    const view = await json('/api/view', { cookie: kid.cookie, body: { clipId: 'tobi-1' } });
    assert.equal(view.status, 200);
    assert.equal(view.body.budget.limit, 1800);
    const beat = await json('/api/view/beat', { cookie: kid.cookie, body: { viewId: view.body.viewId, seconds: 2 } });
    assert.equal(beat.body.added, 2);
    assert.equal(beat.body.budget.used, 2);
    assert.equal((await json('/api/view', { body: { clipId: 'tobi-1' } })).status, 401, 'cookie-gated');
    assert.equal((await json('/api/view', { cookie: guest.cookie, body: { clipId: 'no-clip' } })).status, 404);
  });

  await t.test('a spent tape refuses video, not posters, and a bonus reopens it for today', async () => {
    db.prepare("INSERT INTO views (clip_id,channel_id,viewer,started,updated,seconds) VALUES ('tobi-1',1,?,?,?,1800)").run(KID_EMAIL, Date.now(), Date.now());
    const refused = await json(video, { cookie: kid.cookie, headers: { range: 'bytes=0-10' } });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, 'end-of-tape');
    assert.equal(refused.body.resetsAt, Date.parse(new Date().toISOString().slice(0, 10)) + 86400000);
    assert.equal(await status(`${video}/poster`, { cookie: kid.cookie }), 200);
    assert.equal(await status(video, { cookie: viewer.cookie }), 200, 'other viewers are unaffected');
    assert.equal(await status(video, { cookie: parent.cookie }), 200);
    assert.equal((await json('/api/clips', { cookie: kid.cookie })).body.budget.remaining, 0);
    assert.equal((await json('/api/view', { cookie: kid.cookie, body: { clipId: 'tobi-1' } })).status, 403);
    assert.equal((await json('/api/admin/budget/bonus', { body: { email: PARENT.email, t: parent.t, target: KID_EMAIL, minutes: 5 } })).status, 400);
    assert.equal((await json('/api/admin/budget/bonus', { body: { email: PARENT.email, t: parent.t, target: viewer.email, minutes: 15 } })).status, 409, 'no limit, no bonus');
    const bonus = await json('/api/admin/budget/bonus', { body: { email: PARENT.email, t: parent.t, target: KID_EMAIL, minutes: 15 } });
    assert.equal(bonus.status, 200);
    assert.equal(bonus.body.bonusToday, 15);
    assert.ok(bonus.body.budget.remaining > 800);
    assert.equal(await status(video, { cookie: kid.cookie }), 200);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM activity WHERE kind='budget.bonus'").get().n, 1);
  });

  await t.test('GET /api/admin/views lists who watched, newest first, staff only', async () => {
    const guestView = await json('/api/view', { cookie: guest.cookie, body: { clipId: 'ada-1' } });
    assert.equal(guestView.status, 200);
    const staffView = await json('/api/view', { cookie: parent.cookie, body: { clipId: 'tobi-2' } });
    assert.equal(staffView.status, 200, 'parents are recorded too');
    assert.equal((await json('/api/admin/views', { cookie: viewer.cookie })).status, 403);
    assert.equal((await json('/api/admin/views', { cookie: kid.cookie })).status, 403);
    const all = await json(`/api/admin/views?${family.staffQuery(parent)}`);
    assert.equal(all.status, 200);
    const [newest] = all.body.rows;
    assert.deepEqual(Object.keys(newest), ['clipId', 'clipTitle', 'channel', 'viewer', 'viewerName', 'started', 'seconds', 'duration', 'completed']);
    assert.deepEqual({ ...newest, started: 0 }, { clipId: 'tobi-2', clipTitle: 'Clip tobi-2', channel: 'tobi', viewer: PARENT.email,
      viewerName: 'Remi O.', started: 0, seconds: 0, duration: 12, completed: false });
    const guestRow = all.body.rows.find(row => row.clipId === 'ada-1');
    assert.match(guestRow.viewer, /^guest:[a-f0-9]{12}$/);
    assert.equal(guestRow.viewerName, 'Guest');
    assert.ok(all.body.rows.every((row, i, rows) => i === 0 || rows[i - 1].started >= row.started), 'newest first');
    const ada = await json('/api/admin/views?channel=ada', { cookie: parent.cookie });
    assert.deepEqual(ada.body.rows.map(row => row.clipId), ['ada-1']);
    const kidOnly = await json(`/api/admin/views?viewer=${encodeURIComponent(KID_EMAIL)}`, { cookie: coparent.cookie });
    assert.ok(kidOnly.body.rows.length >= 2 && kidOnly.body.rows.every(row => row.viewer === KID_EMAIL && row.viewerName === 'Tobi'));
    const page = await json('/api/admin/views?limit=1', { cookie: parent.cookie });
    assert.equal(page.body.rows.length, 1);
    assert.equal(page.body.next, page.body.rows[0].started);
    const older = await json(`/api/admin/views?before=${page.body.next}`, { cookie: parent.cookie });
    assert.ok(older.body.rows.every(row => row.started < page.body.next));
  });

  await t.test('the family clock is public in /api/site and parents can change it', async () => {
    assert.equal((await json('/api/site')).body.timezone, 'UTC');
    const locked = await json('/api/admin/timezone', { body: { email: PARENT.email, t: parent.t, timezone: 'Europe/Berlin' } });
    assert.equal(locked.status, 409, 'FAMILY_TIMEZONE in the environment wins');
  });
});

test('the family clock: stored at first boot, validated, changed by parents', { timeout: 60000 }, async t => {
  const family = await startFamily(t);
  const { json, parent, viewer, db } = family;
  const stored = db.prepare("SELECT value FROM settings WHERE key='family_timezone'").get();
  assert.ok(stored, 'the server zone is stored so a server move keeps the family\'s days');
  const change = timezone => json('/api/admin/timezone', { body: { email: PARENT.email, t: parent.t, timezone } });
  assert.equal((await json('/api/admin/timezone', { body: { email: viewer.email, t: viewer.t, timezone: 'Europe/Berlin' } })).status, 403);
  assert.equal((await change('Mars/Olympus')).status, 400);
  const changed = await change('Europe/Berlin');
  assert.equal(changed.status, 200);
  assert.equal(changed.body.timezone, 'Europe/Berlin');
  assert.equal((await json('/api/site')).body.timezone, 'Europe/Berlin');
  assert.equal((await change('UTC')).body.timezone, 'UTC', 'UTC is always allowed');
});
