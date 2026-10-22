// Regressions for docs/plan/security-review.md: each test names the finding it pins down.
import test from 'node:test';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { addressKey, clientIp, createSetup } from '../server/setup.mjs';
import { createMonitor } from '../server/monitor.mjs';
import { createSettings } from '../server/settings.mjs';
import { createFamily } from '../server/family.mjs';
import { createVideoNotifications } from '../server/notifications.mjs';
import { publishClip } from '../server/publish.mjs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUploadManager, STALE_UPLOAD_MS } from '../server/uploads.mjs';
import { sessOk, sessToken } from '../server/api.js';
import { openDatabase } from '../server/db.mjs';
import { migrate } from '../server/schema.mjs';
import { ROOT, startInstall, PARENT } from './helpers.mjs';
import { startFamily, memoryDatabase, KID, KID_EMAIL, VIEWER } from './family-fixture.mjs';

const fakeReq = (forwarded, remote = '10.0.0.9') => ({ headers: forwarded ? { 'x-forwarded-for': forwarded } : {}, socket: { remoteAddress: remote } });

test('H1: behind a trusted proxy, limits count the address the proxy saw, not what the client wrote', t => {
  const before = process.env.TRUST_PROXY;
  t.after(() => { if (before === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = before; });
  process.env.TRUST_PROXY = '1';
  // nginx's $proxy_add_x_forwarded_for appends the real address after whatever the client sent.
  assert.equal(clientIp(fakeReq('198.51.100.1, 203.0.113.7')), '203.0.113.7');
  assert.equal(clientIp(fakeReq('anything-at-all, 203.0.113.7')), clientIp(fakeReq('203.0.113.7')));
  delete process.env.TRUST_PROXY;
  assert.equal(clientIp(fakeReq('198.51.100.1')), '10.0.0.9', 'without TRUST_PROXY the header is ignored');
});

test('M2: IPv6 addresses in one /64 share a limit, and IPv4-mapped addresses read as IPv4', () => {
  assert.equal(addressKey('2001:db8:1:2:aaaa::1'), addressKey('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
  assert.notEqual(addressKey('2001:db8:1:2::1'), addressKey('2001:db8:1:3::1'));
  assert.equal(addressKey('2001:0db8:0001:0002::1'), '2001:db8:1:2::/64');
  assert.equal(addressKey('::1'), '0:0:0:0::/64');
  assert.equal(addressKey('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(addressKey('203.0.113.7'), '203.0.113.7');
  assert.equal(addressKey(undefined), 'unknown');
});

test('H1/M2: rate limits hold against a changing X-Forwarded-For and against many addresses', { timeout: 60000 }, async t => {
  const install = await startFamily(t, { TRUST_PROXY: '1' });
  const login = (email, pass, from) => install.call('/api/login', { body: { email, pass }, headers: { 'x-forwarded-for': from } });

  await t.test('a client inventing a new first X-Forwarded-For entry each try still meets the address limit', async () => {
    const statuses = [];
    for (let i = 0; i < 25; i++) statuses.push((await login('nobody@example.com', 'wrong-' + i, `198.51.100.${i}, 203.0.113.7`)).status);
    assert.ok(statuses.includes(429), `no 429 in ${statuses.join(',')}`);
  });

  await t.test('ten wrong passwords for one kid, from ten addresses, pause that login', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await login(KID.email, 'wrong-guess-' + i, `192.0.2.${i}`)).status, 401);
    const right = await login(KID.email, KID.pass, '192.0.2.99');
    assert.equal(right.status, 429, 'even the right password waits');
    assert.equal(install.db.prepare('SELECT status FROM accounts WHERE email=?').get(KID_EMAIL).status, 'approved');
    // Other accounts are unaffected.
    assert.equal((await login(PARENT.email, PARENT.pass, '192.0.2.98')).status, 200);
  });

  await t.test('guest codes are six characters, and wrong codes from many addresses pause redeeming', async () => {
    const parent = await install.login(PARENT);
    const made = await (await install.call('/api/guest/generate', { body: { email: PARENT.email, t: parent.t } })).json();
    assert.match(made.code, /^[A-HJ-NP-Z2-9]{6}$/);
    const statuses = [];
    for (let i = 0; i < 35; i++) {
      statuses.push((await install.call('/api/guest/redeem', { body: { code: 'ZZZZZ' + (i % 8 + 2) }, headers: { 'x-forwarded-for': `192.0.2.${100 + i}` } })).status);
    }
    assert.deepEqual([...new Set(statuses.slice(0, 30))], [400]);
    assert.deepEqual([...new Set(statuses.slice(30))], [429]);
  });
});

test('H1: a fresh install without a proxy keeps the per-address login limit', { timeout: 30000 }, async t => {
  const install = await startInstall(t);
  const statuses = [];
  for (let i = 0; i < 22; i++) statuses.push((await install.call('/api/login', { body: { email: `n${i}@example.com`, pass: 'x' } })).status);
  assert.equal(statuses.at(-1), 429);
});

test('M1: co-parents can review and moderate, but watch history, people, tapes and badges stay with the owner', { timeout: 60000 }, async t => {
  const family = await startFamily(t);
  const { json, parent, coparent, staffQuery } = family;
  const as = who => ({ email: who.email, t: who.t });
  const spec = { v: 1, shape: 'star', bg: '#FF5C2B', text: { value: 'TOBI', font: 'anton', color: '#0B0C10' } };
  const routes = [
    ['GET', '/api/admin/views', who => ({ path: `/api/admin/views?${staffQuery(who)}` })],
    ['GET', '/api/admin/budget', who => ({ path: `/api/admin/budget?target=tobi%40kids.invalid&${staffQuery(who)}` })],
    ['POST', '/api/admin/budget', who => ({ body: { ...as(who), target: KID_EMAIL, minutes: 30 } })],
    ['POST', '/api/admin/budget/bonus', who => ({ body: { ...as(who), target: KID_EMAIL, minutes: 15 } })],
    ['POST', '/api/admin/timezone', who => ({ body: { ...as(who), timezone: 'UTC' } })],
    ['PUT', '/api/admin/channels/1/badge', who => ({ method: 'PUT', body: { ...as(who), spec } })],
    ['PUT', '/api/admin/brand/badge', who => ({ method: 'PUT', body: { ...as(who), spec } })],
  ];
  const call = (who, path, make) => { const { path: p = path, ...options } = make(who); return json(p, options); };
  for (const [method, path, make] of routes) assert.equal((await call(coparent, path, make)).status, 403, `co-parent ${method} ${path}`);
  // The owner still can (the bonus needs a daily tape, which the budget route just before it sets).
  for (const [method, path, make] of routes) assert.equal((await call(parent, path, make)).status, 200, `owner ${method} ${path}`);
  // The overview keeps the co-parent's review work but not the people list or anyone's email.
  const mine = await json(`/api/admin/overview?${staffQuery(coparent)}`);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.accounts, []);
  assert.ok(mine.body.clips.length > 0);
  assert.ok(!JSON.stringify(mine.body).includes('@'), 'no email addresses for a co-parent');
  assert.ok((await json(`/api/admin/overview?${staffQuery(parent)}`)).body.accounts.length >= 4);
});

test('M3: uploads nobody finished are swept after a day, with any stray folders', async t => {
  const sqlite = await memoryDatabase(t);
  const dir = mkdtempSync(join(tmpdir(), 'kidtube-sweep-'));
  const dataDir = process.env.DATA_DIR;
  delete process.env.DATA_DIR;
  t.after(() => { if (dataDir !== undefined) process.env.DATA_DIR = dataDir; rmSync(dir, { recursive: true, force: true }); });
  const uploads = createUploadManager({ sqlite, env: {}, databasePath: join(dir, 'kidtube.sqlite'), notifications: { enqueue() {}, kick() {} } });
  const now = Date.now();
  const job = (id, created, status = 'receiving') => {
    sqlite.prepare('INSERT INTO upload_jobs (id,email,title,size,status,created,updated) VALUES (?,?,?,?,?,?,?)').run(id, KID_EMAIL, 'A clip', 5000, status, created, created);
    mkdirSync(join(dir, 'incoming', id), { recursive: true });
    writeFileSync(join(dir, 'incoming', id, '0'), 'raw phone video with GPS');
    return join(dir, 'incoming', id);
  };
  const stale = job('11111111-1111-4111-8111-111111111111', now - STALE_UPLOAD_MS - 60000);
  const fresh = job('22222222-2222-4222-8222-222222222222', now - 60000);
  const queued = job('33333333-3333-4333-8333-333333333333', now - STALE_UPLOAD_MS - 60000, 'queued');
  const stray = join(dir, 'incoming', '44444444-4444-4444-8444-444444444444');
  mkdirSync(stray, { recursive: true });
  await uploads.sweep(now);
  assert.equal(existsSync(stale), false, 'the raw chunks of an abandoned upload are gone');
  assert.equal(sqlite.prepare('SELECT status FROM upload_jobs WHERE id=?').get('11111111-1111-4111-8111-111111111111').status, 'failed');
  assert.equal(existsSync(fresh), true, 'an upload still on its way stays');
  assert.equal(existsSync(queued), true, 'a finished upload waiting to convert stays');
  assert.equal(existsSync(stray), false);
});

test('L1 and M4: kids\' badges stay within a guest pass and never sit in a shared cache', { timeout: 60000 }, async t => {
  const family = await startFamily(t);
  const { call, db, parent, guest } = family;
  const spec = { v: 1, shape: 'star', bg: '#FF5C2B', text: { value: 'TOBI', font: 'anton', color: '#0B0C10' } };
  const saved = await (await call('/api/admin/channels/1/badge', { method: 'PUT', body: { email: parent.email, t: parent.t, spec } })).json();
  const pass = await (await call('/api/guest/generate', { body: { email: parent.email, t: parent.t, channel: 'ada' } })).json();
  const adaOnly = (await call('/api/guest/redeem', { body: { code: pass.code } })).headers.get('set-cookie').split(';')[0];
  const get = (path, cookie) => fetch(family.origin + path, { headers: cookie ? { cookie } : {} });

  const shown = await get(saved.url);
  assert.equal(shown.status, 200, 'kids_public is on by default');
  assert.equal(shown.headers.get('cache-control'), 'private, max-age=3600');
  assert.equal((await get(saved.logoUrl)).headers.get('cache-control'), 'private, max-age=3600');

  db.prepare("INSERT INTO settings (key,value,updated) VALUES ('kids_public','false',0) ON CONFLICT(key) DO UPDATE SET value='false'").run();
  for (const path of [saved.url, saved.logoUrl, '/brand/tobi.svg']) {
    assert.equal((await get(path)).status, 401, `signed out ${path}`);
    assert.equal((await get(path, adaOnly)).status, 404, `Ada's guest pass ${path}`);
    assert.equal((await get(path, guest.cookie)).status, 200, `a whole-family pass ${path}`);
  }
});

test('L2: likes and comments only land on, and only count, clips the caller may play', { timeout: 60000 }, async t => {
  const family = await startFamily(t);
  const { json, db, addClip, viewer, parent } = family;
  addClip('tobi-pending', '77777777-7777-4777-8777-777777777777', 1, 3, { review: 'pending' });
  db.prepare("INSERT INTO likes (clip_id,email,created) VALUES ('tobi-pending','someone@example.com',0), ('tobi-1','someone@example.com',0)").run();
  db.prepare("INSERT INTO comments (id,clip_id,email,name,body,created) VALUES ('ghost-1','gone-clip','someone@example.com','Someone','left behind',0)").run();
  const as = who => ({ email: who.email, t: who.t });
  for (const clipId of ['tobi-pending', 'no-such-clip']) {
    assert.equal((await json('/api/like', { body: { ...as(viewer), clipId, on: true } })).status, 404, `like ${clipId}`);
    assert.equal((await json('/api/comment', { body: { ...as(viewer), clipId, body: 'hello' } })).status, 404, `comment ${clipId}`);
  }
  assert.equal(db.prepare("SELECT COUNT(*) n FROM comments WHERE clip_id IN ('tobi-pending','no-such-clip')").get().n, 0);
  assert.equal((await json('/api/like', { body: { ...as(viewer), clipId: 'tobi-1', on: true } })).body.count, 2);
  assert.equal((await json('/api/comment', { body: { ...as(viewer), clipId: 'tobi-1', body: 'hello' } })).status, 200);
  const counts = (await json('/api/likes', { cookie: viewer.cookie })).body.counts;
  assert.equal(counts['tobi-1'], 2);
  assert.equal(counts['tobi-pending'], undefined, 'a clip waiting for review is not named to viewers');
  assert.equal((await json('/api/likes', { cookie: parent.cookie })).body.counts['tobi-pending'], 1, 'parents still see it');
  assert.deepEqual((await json('/api/comments?c=gone-clip', { cookie: viewer.cookie })).body.rows, []);
});

test('L3: pages never put a session token in a URL', () => {
  const files = ['public/js/feed.js', 'public/js/shell/auth-dialog.js', ...readdirSync(join(ROOT, 'public/js/launch')).map(name => `public/js/launch/${name}`)];
  for (const file of files) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    assert.doesNotMatch(source, /[?&]t=/, file);
    assert.doesNotMatch(source, /[?&]e=\$\{|"[?&]e=" \+/, file);
  }
});

test('L3: GET routes take the session from X-Kid-Email and X-Kid-Token', { timeout: 60000 }, async t => {
  const family = await startFamily(t);
  const { json, parent, viewer } = family;
  const headers = who => ({ 'x-kid-email': who.email, 'x-kid-token': who.t });
  assert.equal((await json('/api/check', { headers: headers(viewer) })).body.status, 'approved');
  await json('/api/like', { body: { email: viewer.email, t: viewer.t, clipId: 'tobi-1', on: true } });
  // The feed's own reads also carry the media cookie, which index.mjs asks for first.
  assert.equal((await json('/api/likes', { cookie: viewer.cookie, headers: headers(viewer) })).body.liked['tobi-1'], true);
  assert.equal((await json('/api/admin/views', { headers: headers(parent) })).status, 200);
  assert.equal((await json('/api/admin/overview', { headers: headers(parent) })).status, 200);
  assert.equal((await json('/api/admin/views', { headers: headers(viewer) })).status, 403);
});

test('L4: session signatures are checked in constant time', async t => {
  const { sqlite, DB } = openDatabase(':memory:');
  t.after(() => sqlite.close());
  await migrate(sqlite);
  sqlite.prepare("INSERT INTO accounts (email,first,last,salt,hash,status,created) VALUES ('nana@example.com','Nana','O','s','scrypt:x','approved',0)").run();
  const env = { DB, SIGN_SECRET: 'a-test-only-signing-secret-of-enough-length' };
  const token = await sessToken(env, 'nana@example.com');
  assert.equal(await sessOk(env, 'nana@example.com', token), 'nana@example.com');
  const [expires, sig] = token.split('.');
  for (const bad of [`${expires}.${sig.replace(/.$/, c => c === '0' ? '1' : '0')}`, `${expires}.${sig.toUpperCase()}`, `${expires}.${sig.slice(2)}`, `${expires}.zz${sig.slice(2)}`]) {
    assert.equal(await sessOk(env, 'nana@example.com', bad), null, bad);
  }
  const source = readFileSync(join(ROOT, 'server/api.js'), 'utf8');
  const body = source.slice(source.indexOf('async function sessOk'), source.indexOf('const dispName'));
  assert.doesNotMatch(body, /sig\s*!==/, 'no plain string comparison of the signature');
  assert.match(body, /sameHex\(/);
});

test('L5: signup gives one answer whether or not the email has an account, and refuses kid logins', { timeout: 60000 }, async t => {
  const family = await startFamily(t);
  const { json, db, viewer } = family;
  const ask = (email, i) => json('/api/signup', { body: { first: 'Ask', last: 'Er', email, pass: 'a-long-enough-password' }, headers: { 'x-forwarded-for': `192.0.2.${i}` } });
  const fresh = await ask('brand-new@example.com', 1);
  const again = await ask('brand-new@example.com', 2);
  const approved = await ask(viewer.email, 3);
  assert.equal(fresh.status, 200);
  assert.deepEqual([again.status, again.body], [fresh.status, fresh.body]);
  assert.deepEqual([approved.status, approved.body], [fresh.status, fresh.body], 'an approved account looks the same');
  const kid = await ask(KID_EMAIL, 4), madeUpKid = await ask('nobody-here@kids.invalid', 5);
  assert.deepEqual([kid.status, kid.body], [madeUpKid.status, madeUpKid.body]);
  assert.equal(kid.status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM accounts WHERE email='brand-new@example.com'").get().n, 1);
  assert.equal((await family.login(VIEWER)).status, 'approved', 'the existing account and its password are untouched');
});

test('L6: removing a person, or a kid login from the kid form, leaves no email or name behind', { timeout: 60000 }, async t => {
  const family = await startFamily(t);
  const { json, db, parent, viewer } = family;
  const owner = { 'x-kid-email': parent.email, 'x-kid-token': parent.t };
  const everywhere = needle => db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().flatMap(({ name }) =>
    db.prepare(`PRAGMA table_info(${name})`).all().filter(column => db.prepare(`SELECT COUNT(*) n FROM ${name} WHERE instr(CAST(${column.name} AS TEXT), ?)>0`).get(needle).n)
      .map(column => `${name}.${column.name}`));
  // A trail like a real account's: approved, password reset, a sent email, an upload job, a budget.
  await json('/api/admin/people/password', { headers: owner, body: { target: viewer.email, pass: 'another-long-password' } });
  db.prepare("INSERT INTO video_announcements (clip_id,title,blurb,duration,published,created) VALUES ('tobi-1','t','',1,'',0)").run();
  db.prepare("INSERT INTO video_notification_deliveries (clip_id,email,delivery_key,status,next_attempt) VALUES ('tobi-1',?,'k1','sent',0)").run(viewer.email);
  db.prepare("INSERT INTO upload_jobs (id,email,title,size,status,created,updated) VALUES ('99999999-9999-4999-8999-999999999999',?,'t',1,'done',0,0)").run(viewer.email);
  db.prepare("INSERT INTO activity (ts,actor,kind,subject,detail) VALUES (0,?,'person',?,?)").run(parent.email, viewer.email, JSON.stringify({ action: 'approved', target: viewer.email, name: 'Nana Okafor' }));
  db.prepare("INSERT INTO activity (ts,actor,kind,subject,detail) VALUES (0,?,'comment','x','{}')").run(viewer.email);
  db.prepare("INSERT INTO activity (ts,actor,kind,subject,detail) VALUES (0,'system','guest','x',?)").run(JSON.stringify({ note: 'x', by: `x${viewer.email}` }));
  assert.ok(everywhere(viewer.email).length > 3);
  assert.equal((await json('/api/admin/people/delete', { headers: owner, body: { target: viewer.email } })).status, 200);
  assert.deepEqual(everywhere(viewer.email).filter(where => !where.startsWith('activity.detail')), []);
  assert.ok(!db.prepare('SELECT detail FROM activity').all().some(row => row.detail.includes(`"${viewer.email}"`)));
  assert.ok(db.prepare('SELECT detail FROM activity').all().some(row => row.detail.includes(`x${viewer.email}`)), 'a longer address that contains it is left alone');
  assert.deepEqual(everywhere('Nana Okafor'), []);
  const feed = await json('/api/admin/activity?kind=people', { headers: owner });
  assert.ok(feed.body.rows.some(row => /someone/.test(row.text)));

  // A kid login taken off in the kid form goes the same way.
  db.prepare("INSERT INTO likes (clip_id,email,created) VALUES ('tobi-1',?,0)").run(KID_EMAIL);
  db.prepare("INSERT INTO views (clip_id,channel_id,viewer,started,updated) VALUES ('tobi-1',1,?,0,0)").run(KID_EMAIL);
  assert.equal((await json('/api/admin/kids', { headers: owner, body: { id: 1, name: 'Tobi', login: null } })).status, 200);
  assert.deepEqual(everywhere(KID_EMAIL), []);
});

test('L7: rate-limit addresses go within the hour, and the setup claim keeps no address', async t => {
  const { sqlite, DB } = openDatabase(':memory:');
  t.after(() => sqlite.close());
  await migrate(sqlite);
  const settings = createSettings(sqlite, {});
  const env = { DB, SIGN_SECRET: 'a-test-only-signing-secret-of-enough-length', SITE_URL: '', settings };
  const family = createFamily({ sqlite });
  let clock = Date.now();
  const monitor = createMonitor({ sqlite, settings, env, family, paths: {}, now: () => clock });
  t.after(() => monitor.close());
  for (const table of ['hits', 'chits', 'guest_code_attempts']) {
    sqlite.prepare(`INSERT INTO ${table} (ip,ts) VALUES ('203.0.113.7',?), ('198.51.100.1',?)`).run(clock - 2 * 3600000, clock - 60000);
  }
  monitor.pruneAddresses();
  for (const table of ['hits', 'chits', 'guest_code_attempts']) {
    assert.deepEqual(sqlite.prepare(`SELECT ip FROM ${table}`).all().map(row => row.ip), ['198.51.100.1'], table);
  }
  clock += 2 * 3600000;
  monitor.prune();
  for (const table of ['hits', 'chits', 'guest_code_attempts']) assert.equal(sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, table);

  const dir = mkdtempSync(join(tmpdir(), 'kidtube-claim-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const paths = { tokenFile: join(dir, 'setup-token'), dataDir: dir };
  const setup = createSetup({ sqlite, settings, env, paths, family, sendFile() {}, log() {} });
  const code = readFileSync(paths.tokenFile, 'utf8').trim();
  const status = await new Promise(resolve => {
    const body = Buffer.from(JSON.stringify({ code, first: 'Remi', last: 'Okafor', email: 'remi@example.com', pass: 'a-long-enough-password' }));
    const req = { method: 'POST', url: '/api/setup/claim', headers: { host: 'localhost' }, socket: { remoteAddress: '203.0.113.7' },
      async *[Symbol.asyncIterator]() { yield body; } };
    const res = { headersSent: false, writeHead(code) { this.code = code; return this; }, end() { resolve(this.code); }, destroy() { resolve(0); } };
    setup.handle(req, res, '/api/setup/claim');
  });
  assert.equal(status, 200);
  const claim = sqlite.prepare("SELECT detail FROM activity WHERE kind='setup' AND subject='claim'").get();
  assert.ok(claim, 'the claim is still recorded');
  assert.ok(!claim.detail.includes('203.0.113.7'), claim.detail);
});

test('L8: clip changes made through the direct routes are recorded once, like the dashboard\'s', { timeout: 60000 }, async t => {
  const family = await startFamily(t);
  const { json, db, coparent } = family;
  const rows = () => db.prepare("SELECT actor, subject, detail FROM activity WHERE kind='clip' ORDER BY id").all()
    .map(row => [row.actor, row.subject, JSON.parse(row.detail).action]);
  const as = { email: coparent.email, t: coparent.t };
  assert.equal((await json('/api/clips/rename', { body: { ...as, id: 'tobi-1', title: 'Quietly renamed' } })).status, 200);
  assert.equal((await json('/api/clips/reorder', { body: { ...as, order: ['tobi-2', 'tobi-1'] } })).status, 200);
  assert.equal((await json('/api/clips/delete', { body: { ...as, id: 'ada-1' } })).status, 200);
  assert.deepEqual(rows(), [[coparent.email, 'tobi-1', 'rename'], [coparent.email, 'channel:1', 'order'], [coparent.email, 'ada-1', 'delete']]);
  const headers = { 'x-kid-email': coparent.email, 'x-kid-token': coparent.t };
  assert.equal((await json('/api/admin/clips/rename', { headers, body: { id: 'tobi-2', title: 'Through the dashboard' } })).status, 200);
  assert.equal(rows().filter(([, subject]) => subject === 'tobi-2').length, 1, 'the dashboard route still writes exactly one row');
});

test('L9: new-video emails link to the web address the wizard saved after boot', async t => {
  const { sqlite } = openDatabase(':memory:');
  t.after(() => sqlite.close());
  await migrate(sqlite);
  sqlite.prepare("INSERT INTO accounts (email,first,last,salt,hash,status,created) VALUES ('nana@example.com','Nana','O','s','h','approved',0)").run();
  const env = { SIGN_SECRET: 'a-test-only-signing-secret-of-enough-length', SITE_URL: '', MAIL_MODE: 'brevo', BREVO_API_KEY: 'k', SENDER_EMAIL: 'tube@example.com' };
  const sent = [];
  const notifications = createVideoNotifications({ sqlite, env, logger: { error() {} },
    fetchImpl: async (url, options) => { sent.push(JSON.parse(options.body)); return Response.json({ messageId: 'm1' }, { status: 201 }); } });
  t.after(() => notifications.close());
  env.SITE_URL = 'https://videos.example.test';
  publishClip(sqlite, notifications, { id: 'clip-1', title: 'A clip', src: '/api/video/x', duration: 3, kind: 'video', publishedAt: '2026-10-22T10:00:00Z' });
  await notifications.kick();
  assert.equal(sent.length, 1);
  assert.match(sent[0].htmlContent, /https:\/\/videos\.example\.test\/#\/c\/main\/v\/clip-1/);
  assert.match(sent[0].textContent, /https:\/\/videos\.example\.test\/api\/notifications\/unsubscribe\?/);
  assert.doesNotMatch(sent[0].htmlContent, /localhost/);
});

// node's fetch picks the Host header itself, so these requests go through node:http.
const withHost = (origin, path, host) => new Promise((resolve, reject) => {
  const url = new URL(path, origin);
  request({ host: url.hostname, port: url.port, path: url.pathname + url.search, headers: { host } }, response => {
    let text = '';
    response.on('data', chunk => { text += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, text }));
  }).on('error', reject).end();
});

test('L10: once the family has a web address, other host names are refused (DNS rebinding)', { timeout: 60000 }, async t => {
  const install = await startInstall(t, { ALLOWED_HOSTS: 'kidbox.local, Videos.Example.Test' });
  // The install's web address is http://localhost:3000.
  for (const host of ['evil.example', 'evil.example:3000', 'localhost.evil.example', 'kidbox.lan']) {
    const answer = await withHost(install.origin, '/api/site', host);
    assert.equal(answer.status, 421, host);
    assert.doesNotMatch(answer.text, /"ok"/, host);
  }
  for (const host of ['localhost:3000', 'LOCALHOST', '127.0.0.1:3000', '192.168.1.20:3000', '[::1]:3000', 'kids.localhost', 'kidbox.local', 'videos.example.test:8443']) {
    assert.equal((await withHost(install.origin, '/api/site', host)).status, 200, host);
  }
  assert.equal((await withHost(install.origin, '/api/health', 'anything.example')).status, 200, 'the health check never depends on the name');
  assert.equal((await withHost(install.origin, '/', 'evil.example')).status, 421, 'pages too');
});

test('L10: before setup, anyone may ask for the state, but it no longer names the data folder', { timeout: 60000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'kidtube-fresh-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, PORT: '0', HOST: '127.0.0.1', DATABASE_PATH: join(dir, 'data/kidtube.sqlite'), PUBLIC_DIR: join(ROOT, 'public'), MAIL_MODE: 'disabled' };
  for (const key of ['SIGN_SECRET', 'SITE_URL', 'DATA_DIR', 'TRUST_PROXY']) delete env[key];
  const child = spawn(process.execPath, [join(ROOT, 'server/index.mjs')], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { const match = /listening on (\d+)/.exec(String(chunk)); if (match) resolve(match[1]); });
    child.once('exit', () => reject(new Error('the server stopped')));
  });
  const state = await (await fetch(`http://127.0.0.1:${port}/api/setup/state`)).json();
  assert.equal(state.stage, 'code');
  assert.equal('tokenFile' in state, false);
  assert.ok(!JSON.stringify(state).includes(dir), 'the data folder path is not in the answer');
  assert.equal((await withHost(`http://127.0.0.1:${port}`, '/api/setup/state', 'any-name.example')).status, 200, 'no web address yet, so any name works');
});
