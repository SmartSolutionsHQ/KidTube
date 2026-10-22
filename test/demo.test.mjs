// The public demo (server/demo.mjs, scripts/demo-seed.mjs): every write refused on the server in demo
// mode and working without it, the one-tap roles only in demo mode, resets that put the snapshot back
// exactly, a guard that never touches a family's install, and a seed that is the same on every run.
// Snapshots here are made without FFmpeg (badges only), so the tests run anywhere.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  DEMO_ROLES, DemoError, TIME_COLUMNS, demoEnabled, guard, openDemo, prepareBase, readSnapshot, resetDemo, resetMinutes,
} from '../server/demo.mjs';
import { migrate } from '../server/schema.mjs';
import { SEEDED_AT, buildDatabase, writeSnapshot } from '../scripts/demo-seed.mjs';
import { ROOT } from './helpers.mjs';
import { startFamily } from './family-fixture.mjs';

const HOUR = 3600000;
const scratch = t => {
  const dir = mkdtempSync(join(tmpdir(), 'kidtube-demo-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// Every table, every row, in a stable order: what "exactly" means for a reset.
function dump(sqlite) {
  const out = {};
  for (const { name } of sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    out[name] = sqlite.prepare(`SELECT * FROM "${name}"`).all().map(row => JSON.stringify(row, (key, value) => typeof value === 'bigint' ? String(value) : value)).sort();
  }
  out.triggers = sqlite.prepare("SELECT name, sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all().map(row => row.sql);
  return out;
}

// A data folder with a snapshot in it (no clips), as `npm run demo:seed` leaves one.
async function seeded(t) {
  const dir = scratch(t);
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir);
  await writeSnapshot(join(dataDir, 'demo-snapshot'), { render: false });
  return { dir, dataDir, database: join(dataDir, 'kidtube.sqlite') };
}

// The server in a scratch folder, as `DEMO_MODE=1 npm start` runs it.
async function startServer(t, dir, env = {}) {
  const base = { ...process.env };
  for (const key of ['DATABASE_PATH', 'DATA_DIR', 'DEMO_MODE', 'DEMO_RESET_MINUTES', 'DEMO_SNAPSHOT_DIR', 'SITE_URL', 'MAIL_MODE']) delete base[key];
  const child = spawn(process.execPath, [join(ROOT, 'server/index.mjs')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...base, PORT: '0', HOST: '127.0.0.1', PUBLIC_DIR: join(ROOT, 'public'), DATABASE_PATH: join(dir, 'data/kidtube.sqlite'), ...env },
  });
  let logs = '';
  child.stderr.on('data', chunk => { logs += chunk; });
  child.stdout.on('data', chunk => { logs += chunk; });
  t.after(async () => { child.kill(); await once(child, 'exit').catch(() => {}); });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout ' + logs)), 10000);
    child.stdout.on('data', chunk => {
      const match = /listening on (\d+)/.exec(String(chunk));
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(Object.assign(new Error(logs), { code })); });
  });
  const origin = `http://127.0.0.1:${port}`;
  const call = (path, { body, method, headers = {} } = {}) => fetch(origin + path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { origin, call, logs: () => logs };
}

// Runs the server until it exits on its own, for the refusals.
async function failedStart(dir, env) {
  const base = { ...process.env };
  for (const key of ['DATABASE_PATH', 'DATA_DIR', 'DEMO_MODE', 'DEMO_SNAPSHOT_DIR']) delete base[key];
  const child = spawn(process.execPath, [join(ROOT, 'server/index.mjs')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...base, PORT: '0', HOST: '127.0.0.1', PUBLIC_DIR: join(ROOT, 'public'), DATABASE_PATH: join(dir, 'data/kidtube.sqlite'), ...env },
  });
  let logs = '';
  child.stderr.on('data', chunk => { logs += chunk; });
  child.stdout.on('data', chunk => { logs += chunk; });
  const timer = setTimeout(() => child.kill(), 10000);
  const [code] = await once(child, 'exit');
  clearTimeout(timer);
  return { code, logs };
}

// Every route that changes something, with a body that would succeed for a parent outside the demo.
// A new route is refused in demo mode anyway (the demo allows writes by name, not refuses them by name).
const UUID = '00000000-0000-4000-8000-000000000000';
const WRITES = [
  ['POST', '/api/signup', { first: 'Visitor', last: 'Example', email: 'visitor@example.com', pass: 'a-long-enough-password' }],
  ['POST', '/api/login', { email: 'someone@example.com', pass: 'a-long-enough-password' }],
  ['POST', '/api/guest/generate', {}],
  ['POST', '/api/guest/redeem', { code: 'ABC2' }],
  ['POST', '/api/admin/clips/review', { id: 'x', decision: 'approve' }],
  ['POST', '/api/clips/reorder', { order: ['x'] }],
  ['POST', '/api/clips/rename', { id: 'x', title: 'New' }],
  ['POST', '/api/clips/delete', { id: 'x' }],
  ['POST', '/api/admin/status', { target: 'x@example.com', status: 'denied' }],
  ['POST', '/api/admin/role', { target: 'x@example.com', role: 'admin' }],
  ['POST', '/api/admin/password', { target: 'x@example.com', pass: 'a-long-enough-password' }],
  ['POST', '/api/comment', { clipId: 'x', body: 'Hello there' }],
  ['POST', '/api/comment/delete', { id: 'x' }],
  ['POST', '/api/setup/verify', { code: '123456' }],
  ['POST', '/api/setup/claim', {}],
  ['POST', '/api/setup/family', {}],
  ['POST', '/api/setup/kids', {}],
  ['POST', '/api/setup/kids/done', {}],
  ['POST', '/api/setup/watch', {}],
  ['POST', '/api/setup/email', {}],
  ['POST', '/api/setup/email/test', {}],
  ['POST', '/api/setup/complete', {}],
  ['DELETE', '/api/setup/kids/2', {}],
  ['POST', '/api/admin/review', { id: 'x', decision: 'approve' }],
  ['POST', '/api/admin/clips/hide', { id: 'x', hidden: true }],
  ['POST', '/api/admin/clips/rename', { id: 'x', title: 'New' }],
  ['POST', '/api/admin/clips/order', { channel: 'x', order: [] }],
  ['POST', '/api/admin/clips/delete', { id: 'x' }],
  ['POST', '/api/admin/comments/moderate', { id: 'x', action: 'show' }],
  ['POST', '/api/admin/people/status', { target: 'x@example.com', status: 'denied' }],
  ['POST', '/api/admin/people/role', { target: 'x@example.com', role: 'admin' }],
  ['POST', '/api/admin/people/password', { target: 'x@example.com', pass: 'a-long-enough-password' }],
  ['POST', '/api/admin/people/delete', { target: 'x@example.com' }],
  ['POST', '/api/admin/kids', { name: 'New kid' }],
  ['POST', '/api/admin/kids/order', { order: [] }],
  ['POST', '/api/admin/kids/delete', { id: 99 }],
  ['POST', '/api/admin/guests', { note: 'Grandpa' }],
  ['POST', '/api/admin/guests/end', { id: 'x' }],
  ['POST', '/api/admin/settings', { values: { site_name: 'Changed' } }],
  ['POST', '/api/admin/settings/email-test', {}],
  ['POST', '/api/admin/clips/seal', { id: 'x', opensAt: Date.now() + 2 * HOUR }],
  ['POST', '/api/admin/clips/unseal', { id: 'x' }],
  ['POST', '/api/admin/budget', { target: 'x@example.com', minutes: 30 }],
  ['POST', '/api/admin/budget/bonus', { target: 'x@example.com', minutes: 15 }],
  ['POST', '/api/admin/timezone', { timezone: 'Europe/Paris' }],
  ['PUT', '/api/admin/channels/1/badge', { spec: { v: 1 } }],
  ['PUT', '/api/admin/channels/1/image', {}],
  ['DELETE', '/api/admin/channels/1/image', {}],
  ['PUT', '/api/admin/brand/badge', { spec: { v: 1 } }],
  ['PUT', '/api/admin/brand/icons/192', {}],
  ['POST', '/api/upload/raw/start', { title: 'New', size: 100 }],
  ['POST', `/api/upload/raw/${UUID}/0`, {}],
  ['POST', '/api/upload/raw/finish', { id: UUID }],
  ['POST', '/api/upload/raw/cancel', { id: UUID }],
  ['GET', '/api/notifications/unsubscribe?token=x', undefined],
  ['POST', '/api/a-route-added-later', {}],
];

function writeCall(server, [method, path, body], who) {
  const headers = who ? { 'X-Kid-Email': who.email, 'X-Kid-Token': who.t } : {};
  return server.call(path, { method, headers, body: body === undefined ? undefined : { ...(who ? { email: who.email, t: who.t } : {}), ...body } });
}

test('DEMO_MODE and DEMO_RESET_MINUTES: on only when asked, and a typo stops the server', () => {
  for (const value of [undefined, '', '0', 'off', 'false']) assert.equal(demoEnabled({ DEMO_MODE: value }), false, String(value));
  for (const value of ['1', 'true', 'on', 'YES']) assert.equal(demoEnabled({ DEMO_MODE: value }), true, value);
  for (const value of ['2', 'demo', 'enabled']) assert.throws(() => demoEnabled({ DEMO_MODE: value }), DemoError);
  assert.equal(resetMinutes({}), 60);
  assert.equal(resetMinutes({ DEMO_RESET_MINUTES: '5' }), 5);
  for (const value of ['0', '1.5', 'soon', '2000']) assert.throws(() => resetMinutes({ DEMO_RESET_MINUTES: value }), DemoError);
  assert.equal(openDemo({ sqlite: null, dataDir: '/nowhere', env: {} }), null, 'off: nothing is opened or checked');
});

test('the seed is deterministic', async t => {
  const dir = scratch(t);
  const files = [join(dir, 'one.sqlite'), join(dir, 'two.sqlite')];
  for (const file of files) await buildDatabase(file);
  const [one, two] = files.map(file => { const sqlite = new DatabaseSync(file); try { return dump(sqlite); } finally { sqlite.close(); } });
  assert.deepEqual(one, two);
  assert.deepEqual(readFileSync(files[0]), readFileSync(files[1]), 'byte for byte');
  const sqlite = new DatabaseSync(files[0]);
  t.after(() => sqlite.close());
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM channels').get().n, 3);
  assert.equal(new Set(sqlite.prepare('SELECT theme_id FROM channels').all().map(row => row.theme_id)).size, 3, 'three splash themes');
  assert.equal(new Set(sqlite.prepare('SELECT accent FROM channels').all().map(row => row.accent)).size, 3, 'three accents');
  assert.ok(sqlite.prepare('SELECT badge FROM channels').all().every(row => JSON.parse(row.badge).v === 1), 'badges from the real renderer');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM clips').get().n, 12);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM clips WHERE opens_at > ?').get(SEEDED_AT).n, 1, 'one sealed capsule');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM accounts WHERE watch_budget_minutes > 0').get().n, 1, 'one daily tape');
  for (const table of ['likes', 'reactions', 'comments', 'views']) assert.ok(sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n > 0, table);
  for (const role of Object.values(DEMO_ROLES)) assert.ok(sqlite.prepare("SELECT 1 FROM accounts WHERE email=? AND status='approved'").get(role.email), role.email);
  assert.ok(sqlite.prepare("SELECT email FROM accounts").all().every(row => /\.invalid$/.test(row.email)), 'no address that can receive mail');
  for (const table of ['hits', 'chits', 'guest_code_attempts']) assert.equal(sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, `${table} holds no addresses`);
});

test('every timestamp column in the schema is moved on reset, or named here as not a time', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  await migrate(sqlite);
  const NOT_TIME = new Set(['accounts.watch_budget_minutes', 'accounts.channel_id', 'activity.id', 'channels.id', 'channels.logo_rev',
    'channels.review_uploads', 'channels.position', 'clips.position', 'comments.hidden', 'clips.hidden', 'clips.channel_id', 'guest_codes.channel_id',
    'media.size', 'media_chunks.seq', 'upload_jobs.size', 'upload_jobs.progress', 'upload_jobs.channel_id', 'video_announcements.channel_id',
    'video_notification_deliveries.attempts', 'video_email_preferences.unsubscribed', 'views.id', 'views.channel_id', 'views.seconds',
    'views.completed', 'watch_bonus.minutes']);
  const unplaced = [];
  for (const { name } of sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    for (const column of sqlite.prepare('SELECT name, type FROM pragma_table_info(?)').all(name)) {
      const key = `${name}.${column.name}`;
      const integer = /INT/i.test(column.type);
      if (TIME_COLUMNS[name]?.[column.name]) continue;
      if (integer && !NOT_TIME.has(key)) unplaced.push(key);
      if (/published|_at$|created|updated/.test(column.name)) unplaced.push(key);
    }
  }
  assert.deepEqual(unplaced, []);
});

test('a reset puts the snapshot back exactly, moves every time forward, and keeps the triggers', async t => {
  const { dataDir, database } = await seeded(t);
  const snapshot = readSnapshot(join(dataDir, 'demo-snapshot'));
  const sqlite = new DatabaseSync(database);
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys=ON');
  assert.deepEqual(guard({ sqlite, dataDir }), { database: 'empty', folder: 'empty' });
  await migrate(sqlite);
  const base = await prepareBase(snapshot, dataDir);
  const reference = (() => { const db = new DatabaseSync(base); try { return dump(db); } finally { db.close(); } })();

  resetDemo({ sqlite, dataDir, snapshot, base, at: SEEDED_AT });
  assert.deepEqual(dump(sqlite), reference, 'restored as seeded');
  assert.equal(guard({ sqlite, dataDir }).database, 'demo');
  for (const rel of Object.keys(snapshot.meta.files)) assert.ok(readFileSync(join(dataDir, rel)).length, `${rel} copied`);

  // What visitors and the clock can change, and some things they cannot, all undone.
  sqlite.exec(`DELETE FROM likes; INSERT INTO reactions VALUES ('demo-juni-rocket','grandma@demo.invalid','cool',1);
    UPDATE settings SET value='"Changed"' WHERE key='site_name'; DELETE FROM clips WHERE id='demo-otto-dino';
    UPDATE clips SET opened_at=5 WHERE id='demo-juni-capsule'; INSERT INTO hits VALUES ('203.0.113.9', 1);
    INSERT INTO views (clip_id,channel_id,viewer,started,updated) VALUES ('demo-juni-rocket',1,'grandma@demo.invalid',1,1);
    CREATE TABLE stray (x)`);
  writeFileSync(join(dataDir, Object.keys(snapshot.meta.files)[0]), 'tampered');
  resetDemo({ sqlite, dataDir, snapshot, base, at: SEEDED_AT });
  const after = dump(sqlite);
  assert.deepEqual(after.stray, []);
  delete after.stray;
  assert.deepEqual(after, reference, 'restored again, triggers included');
  assert.deepEqual(readFileSync(join(dataDir, Object.keys(snapshot.meta.files)[0])), readFileSync(join(snapshot.files, Object.keys(snapshot.meta.files)[0])));

  // Later on, the same family, with every time moved by the same whole minutes.
  const at = SEEDED_AT + 30 * 86400000 + 5 * HOUR + 59000;
  resetDemo({ sqlite, dataDir, snapshot, base, at });
  const shift = 30 * 86400000 + 5 * HOUR;
  const row = id => sqlite.prepare('SELECT opens_at, created, published FROM clips WHERE id=?').get(id);
  const seededRow = id => { const db = new DatabaseSync(base); try { return db.prepare('SELECT opens_at, created, published FROM clips WHERE id=?').get(id); } finally { db.close(); } };
  assert.equal(row('demo-juni-capsule').opens_at, seededRow('demo-juni-capsule').opens_at + shift, 'the capsule opens the same time after each reset');
  assert.equal(row('demo-juni-rocket').opens_at, 0, 'unset stays unset');
  assert.equal(Date.parse(row('demo-juni-rocket').published), Date.parse(seededRow('demo-juni-rocket').published) + shift);
  assert.equal(row('demo-juni-rocket').created, seededRow('demo-juni-rocket').created + shift);
  assert.ok(sqlite.prepare('SELECT MAX(started) m FROM views').get().m < at, 'watching stays in the past');
});

test('the guard refuses a family database and a family folder, and leaves them untouched', async t => {
  const { dataDir } = await seeded(t);
  const snapshot = readSnapshot(join(dataDir, 'demo-snapshot'));
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  await migrate(sqlite);
  const base = await prepareBase(snapshot, dataDir);
  sqlite.exec("INSERT INTO accounts (email,first,last,salt,hash,status,role,created) VALUES ('mum@example.com','Mum','','s','h','approved','super',1)");
  const before = dump(sqlite);
  assert.throws(() => resetDemo({ sqlite, dataDir, snapshot, base }), DemoError);
  assert.throws(() => openDemo({ sqlite, dataDir, env: { DEMO_MODE: '1' } }), /belongs to a family's install/);
  assert.deepEqual(dump(sqlite), before);

  // A marker that is not the demo's counts as a family's too.
  const marked = new DatabaseSync(':memory:');
  t.after(() => marked.close());
  await migrate(marked);
  marked.prepare("INSERT INTO settings (key,value,updated) VALUES ('demo_marker','\"something-else\"',1)").run();
  assert.throws(() => guard({ sqlite: marked, dataDir }), DemoError);

  // An empty database next to a family's videos is still a family's install.
  const empty = new DatabaseSync(':memory:');
  t.after(() => empty.close());
  await migrate(empty);
  const familyDir = join(scratch(t), 'data');
  mkdirSync(join(familyDir, 'videos'), { recursive: true });
  writeFileSync(join(familyDir, 'videos', 'their-video.mp4'), 'a family video');
  assert.throws(() => guard({ sqlite: empty, dataDir: familyDir }), /belongs to a family's install/);
  assert.equal(readFileSync(join(familyDir, 'videos', 'their-video.mp4'), 'utf8'), 'a family video');
});

test('DEMO_MODE on a family install stops the server before anything is written', async t => {
  const family = await startFamily(t);
  const before = dump(family.db);
  const result = await failedStart(family.dir, { DEMO_MODE: '1' });
  assert.equal(result.code, 1, result.logs);
  assert.match(result.logs, /belongs to a family's install/);
  assert.deepEqual(dump(family.db), before);
});

test('demo mode without a snapshot says how to make one', async t => {
  const dir = scratch(t);
  const result = await failedStart(dir, { DEMO_MODE: '1' });
  assert.equal(result.code, 1);
  assert.match(result.logs, /npm run demo:seed/);
});

test('without DEMO_MODE there is no one-tap sign-in, no demo route and no banner', async t => {
  const family = await startFamily(t);
  assert.equal((await family.call('/api/demo')).status, 404);
  const enter = await family.call('/api/demo/enter', { body: { role: 'parent' } });
  assert.equal(enter.status, 404);
  assert.equal(enter.headers.get('set-cookie'), null);
  for (const page of ['/', '/parents', '/about', '/install']) assert.doesNotMatch(await (await family.call(page)).text(), /demo-banner|demo\.css/, page);
});

test('every write works normally without DEMO_MODE', async t => {
  const family = await startFamily(t);
  for (const write of WRITES) {
    const response = await writeCall(family, write, family.parent);
    const body = await response.json().catch(() => null);
    assert.ok(!body?.demo, `${write[0]} ${write[1]} is not refused as a demo`);
  }
  // A few that must really go through.
  const ok = async (path, body, who = family.parent) => {
    const response = await family.call(path, { body: { email: who.email, t: who.t, ...body }, headers: { 'X-Kid-Email': who.email, 'X-Kid-Token': who.t } });
    const reply = await response.json();
    assert.ok(response.ok && reply.ok, `${path}: ${JSON.stringify(reply)}`);
  };
  await ok('/api/signup', { first: 'Ada', last: 'Example', email: 'ada.example@example.com', pass: 'a-long-enough-password' });
  await ok('/api/comment', { clipId: 'tobi-1', body: 'Lovely' }, family.viewer);
  await ok('/api/admin/guests', { note: 'Grandpa' });
  await ok('/api/admin/settings', { values: { site_name: 'The Okafors' } });
  assert.equal(family.db.prepare("SELECT value FROM settings WHERE key='site_name'").get().value, '"The Okafors"');
});

test('demo mode: one-tap roles, every write refused for every role, likes and reactions only', async t => {
  const { dir, database } = await seeded(t);
  const server = await startServer(t, dir, { DEMO_MODE: '1' });
  const db = new DatabaseSync(database);
  t.after(() => db.close());

  const info = await (await server.call('/api/demo')).json();
  assert.equal(info.demo, true);
  assert.equal(info.family, 'The Demo Family');
  assert.ok(info.nextReset > info.now && info.nextReset - info.now <= HOUR);
  assert.deepEqual(info.roles.map(role => role.id), ['kid', 'grandma', 'parent']);

  const sessions = {};
  for (const role of Object.keys(DEMO_ROLES)) {
    const response = await server.call('/api/demo/enter', { body: { role } });
    const reply = await response.json();
    assert.equal(response.status, 200);
    assert.equal(reply.email, DEMO_ROLES[role].email);
    assert.ok(reply.t);
    assert.match(response.headers.get('set-cookie'), /^kid_access=/);
    sessions[role] = { ...reply, cookie: response.headers.get('set-cookie').split(';')[0] };
  }
  assert.equal((await server.call('/api/demo/enter', { body: { role: 'admin' } })).status, 400);
  assert.equal((await server.call('/api/demo/enter')).status, 405);
  const me = await (await server.call('/api/me', { headers: { cookie: sessions.grandma.cookie } })).json();
  assert.equal(me.viewer.email, DEMO_ROLES.grandma.email);

  const before = dump(db);
  for (const who of [null, ...Object.values(sessions)]) {
    for (const write of WRITES) {
      const response = await writeCall(server, write, who);
      const body = await response.json().catch(() => null);
      assert.equal(response.status, 403, `${write[0]} ${write[1]} as ${who?.email || 'a visitor'}`);
      assert.equal(body?.demo, true);
      assert.doesNotMatch(body.error, /sign in/i, 'the dashboard would sign the parent out');
    }
  }
  assert.deepEqual(dump(db), before, 'nothing changed');

  // Watching is answered (with Juni's tape) and never logged.
  const views = db.prepare('SELECT COUNT(*) n FROM views').get().n;
  const view = await (await server.call('/api/view', { body: { clipId: 'demo-juni-rocket', seconds: 3 }, headers: { cookie: sessions.kid.cookie } })).json();
  assert.equal(view.ok, true);
  assert.equal(view.budget.limit, 30 * 60);
  assert.equal((await (await server.call('/api/view/beat', { body: { viewId: 0, seconds: 15 }, headers: { cookie: sessions.kid.cookie } })).json()).added, 0);
  assert.equal((await server.call('/api/view', { body: { clipId: 'demo-juni-rocket' } })).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM views').get().n, views);

  // Likes and reactions stay on, within a limit per visitor.
  const like = await (await server.call('/api/like', { body: { email: sessions.grandma.email, t: sessions.grandma.t, clipId: 'demo-otto-skate', on: true } })).json();
  assert.equal(like.liked, true);
  const react = await (await server.call('/api/react', { body: { email: sessions.grandma.email, t: sessions.grandma.t, clipId: 'demo-otto-skate', kind: 'wow', on: true } })).json();
  assert.equal(react.ok, true);
  let status = 200;
  for (let n = 0; n < 45 && status !== 429; n++) {
    status = (await server.call('/api/like', { body: { email: sessions.grandma.email, t: sessions.grandma.t, clipId: 'demo-otto-skate', on: n % 2 === 0 } })).status;
  }
  assert.equal(status, 429, 'likes are rate-limited');

  for (const table of ['hits', 'chits', 'guest_code_attempts']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, `no address in ${table}`);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM activity WHERE kind='seen' AND ts > ?").get(Date.now() - 60000).n, 0, 'no visitor shows as last seen');

  // Every page carries the banner, under the same content policy.
  for (const page of ['/', '/parents', '/about', '/install']) {
    const response = await server.call(page);
    assert.equal(response.status, 200, page);
    assert.match(await response.text(), /<script type="module" src="\/js\/shell\/demo-banner\.js\?v=[a-f0-9]{12}"><\/script>/, page);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  }
  assert.equal((await server.call('/js/shell/demo-banner.js')).status, 200);
});

test('demo mode restores the snapshot on boot, over whatever visitors left', async t => {
  const { dir, database } = await seeded(t);
  let server = await startServer(t, dir, { DEMO_MODE: '1' });
  const enter = await (await server.call('/api/demo/enter', { body: { role: 'grandma' } })).json();
  await server.call('/api/like', { body: { email: enter.email, t: enter.t, clipId: 'demo-juni-rocket', on: false } });
  const db = new DatabaseSync(database);
  t.after(() => db.close());
  const liked = () => db.prepare("SELECT COUNT(*) n FROM likes WHERE clip_id='demo-juni-rocket' AND email=?").get(enter.email).n;
  assert.equal(liked(), 0);
  server = await startServer(t, dir, { DEMO_MODE: '1' });
  assert.equal(liked(), 1);
  assert.match(server.logs(), /restored the invented family/);
});

test('the reset script resets a running demo and refuses everything else', async t => {
  const { dir, database } = await seeded(t);
  const run = async env => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts/demo-reset.mjs')], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DATABASE_PATH: database, DATA_DIR: '', DEMO_SNAPSHOT_DIR: '', ...env } });
    let logs = '';
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    const [code] = await once(child, 'exit');
    return { code, logs };
  };
  assert.match((await run({ DEMO_MODE: '' })).logs, /Set DEMO_MODE=1/);
  const server = await startServer(t, dir, { DEMO_MODE: '1' });
  const enter = await (await server.call('/api/demo/enter', { body: { role: 'grandma' } })).json();
  await server.call('/api/like', { body: { email: enter.email, t: enter.t, clipId: 'demo-juni-rocket', on: false } });
  const result = await run({ DEMO_MODE: '1' });
  assert.equal(result.code, 0, result.logs);
  const db = new DatabaseSync(database);
  t.after(() => db.close());
  assert.equal(db.prepare("SELECT COUNT(*) n FROM likes WHERE clip_id='demo-juni-rocket' AND email=?").get(enter.email).n, 1);
  assert.equal((await server.call('/api/demo')).status, 200, 'the running demo keeps serving');
});

test('the seed refuses to overwrite a folder that is not a demo snapshot', async t => {
  const dir = scratch(t);
  const target = join(dir, 'not-a-snapshot');
  mkdirSync(target);
  writeFileSync(join(target, 'keep.txt'), 'mine');
  await assert.rejects(writeSnapshot(target, { render: false }), /not a demo snapshot/);
  assert.equal(readFileSync(join(target, 'keep.txt'), 'utf8'), 'mine');
  const snapshot = join(dir, 'snap');
  await writeSnapshot(snapshot, { render: false });
  await writeSnapshot(snapshot, { render: false });
  assert.equal(readSnapshot(snapshot).meta.seededAt, SEEDED_AT, 'a snapshot is replaced by a fresh one');
});
