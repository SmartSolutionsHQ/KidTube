// Regressions for docs/plan/security-review.md: each test names the finding it pins down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addressKey, clientIp } from '../server/setup.mjs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUploadManager, STALE_UPLOAD_MS } from '../server/uploads.mjs';
import { sessOk, sessToken } from '../server/api.js';
import { openDatabase } from '../server/db.mjs';
import { migrate } from '../server/schema.mjs';
import { ROOT, startInstall, PARENT } from './helpers.mjs';
import { startFamily, memoryDatabase, KID, KID_EMAIL } from './family-fixture.mjs';

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
