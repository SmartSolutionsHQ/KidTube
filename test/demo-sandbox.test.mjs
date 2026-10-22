// The demo's private customize sandbox (server/demo-sandbox.mjs): absent without DEMO_MODE, invisible to
// every other visitor, capped and rate-limited, cleared by resets, badges drawn by the real renderer and
// nothing written to the family's tables or files.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { renderSpec } from '../server/badge.mjs';
import { CREATED_BASE_ID, SANDBOX_COOKIE, SANDBOX_LIMITS, SANDBOX_NOTE, createSandboxes } from '../server/demo-sandbox.mjs';
import { migrate } from '../server/schema.mjs';
import { writeSnapshot } from '../scripts/demo-seed.mjs';
import { ROOT } from './helpers.mjs';
import { startFamily } from './family-fixture.mjs';

const scratch = t => {
  const dir = mkdtempSync(join(tmpdir(), 'kidtube-sandbox-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

async function seeded(t) {
  const dir = scratch(t);
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir);
  await writeSnapshot(join(dataDir, 'demo-snapshot'), { render: false });
  return { dir, dataDir, database: join(dataDir, 'kidtube.sqlite') };
}

async function startDemo(t, dir, env = {}) {
  const base = { ...process.env };
  for (const key of ['DATABASE_PATH', 'DATA_DIR', 'DEMO_MODE', 'DEMO_RESET_MINUTES', 'DEMO_SNAPSHOT_DIR', 'SITE_URL', 'MAIL_MODE']) delete base[key];
  const child = spawn(process.execPath, [join(ROOT, 'server/index.mjs')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...base, PORT: '0', HOST: '127.0.0.1', PUBLIC_DIR: join(ROOT, 'public'), DATABASE_PATH: join(dir, 'data/kidtube.sqlite'), DEMO_MODE: '1', ...env },
  });
  let logs = '';
  child.stderr.on('data', chunk => { logs += chunk; });
  t.after(async () => { child.kill(); await once(child, 'exit').catch(() => {}); });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout ' + logs)), 10000);
    child.stdout.on('data', chunk => {
      const match = /listening on (\d+)/.exec(String(chunk));
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(logs)); });
  });
  return `http://127.0.0.1:${port}`;
}

// One browser: its own cookies, and the session the page keeps in localStorage.
function visitor(origin) {
  const jar = new Map();
  let session = null;
  async function call(path, { body, method, headers = {}, raw = false } = {}) {
    const response = await fetch(origin + path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(jar.size ? { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') } : {}),
        ...(session ? { 'X-Kid-Email': session.email, 'X-Kid-Token': session.t } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';');
      const [name, value] = pair.split('=');
      if (attributes.some(part => /max-age=0\b/i.test(part.trim()))) jar.delete(name); else jar.set(name, value);
    }
    return raw ? response : { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
  }
  async function enter(role) {
    const { body } = await call('/api/demo/enter', { body: { role } });
    session = { email: body.email, t: body.t };
    return body;
  }
  return { call, enter, jar, get session() { return session; } };
}

function dump(sqlite) {
  const out = {};
  for (const { name } of sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    out[name] = sqlite.prepare(`SELECT * FROM "${name}"`).all().map(row => JSON.stringify(row, (key, value) => typeof value === 'bigint' ? String(value) : value)).sort();
  }
  return out;
}

function folderHash(dir) {
  const hash = createHash('sha256');
  for (const name of readdirSync(dir, { recursive: true }).map(String).sort()) {
    const file = join(dir, name);
    hash.update(name);
    if (statSync(file).isFile()) hash.update(readFileSync(file));
  }
  return hash.digest('hex');
}

const BADGE = { v: 1, shape: 'star', bg: '#7CE38B', text: { value: 'AVA', font: 'bangers', color: '#0B0C10' }, stickers: [{ id: 'rocket', x: 150, y: 50, scale: 1, rotate: 0 }], effects: { rgbSplit: false, outline: true, tilt: false, shadow: false } };

test('without DEMO_MODE there is no sandbox: no routes, no cookie, no overlay', async t => {
  const family = await startFamily(t);
  const parent = { 'X-Kid-Email': family.parent.email, 'X-Kid-Token': family.parent.t };
  for (const [method, path] of [['GET', '/api/demo/sandbox'], ['POST', '/api/demo/sandbox/reset'], ['GET', '/api/demo/sandbox/badge/tobi.svg'], ['GET', '/api/demo/sandbox/badge/my-kid-1.svg']]) {
    const response = await family.call(path, { method, headers: parent, body: method === 'POST' ? {} : undefined });
    assert.equal(response.status, 404, `${method} ${path}`);
    assert.equal(response.headers.get('set-cookie'), null, `${method} ${path} sets no cookie`);
  }
  const kids = await (await family.call('/api/admin/kids', { headers: parent })).json();
  assert.equal(kids.sandbox, undefined, 'the Kids tab is the real one');
  const added = await family.call('/api/admin/kids', { headers: parent, body: { name: 'Bram', accent: '#7CE38B', themeId: 'glass-gate' } });
  assert.equal(added.status, 200);
  assert.doesNotMatch(added.headers.get('set-cookie') || '', new RegExp(SANDBOX_COOKIE));
  assert.ok(family.db.prepare("SELECT 1 FROM channels WHERE name='Bram'").get(), 'a real kid, in the real table');
  const clips = await (await family.call('/api/clips?channel=my-kid-1', { headers: { cookie: family.parent.cookie } })).json();
  assert.deepEqual(clips.clips, [], 'no borrowed clips');
  assert.equal((await family.call('/demo/make')).status, 404, 'no make page');
});

test('the make page exists only in demo mode, under the page policy and with the banner', async t => {
  const { dir } = await seeded(t);
  const origin = await startDemo(t, dir);
  const response = await fetch(origin + '/demo/make');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  const html = await response.text();
  assert.match(html, /<script type="module" src="\/js\/demo\/make\.js\?v=[a-f0-9]{12}"><\/script>/);
  assert.match(html, /demo-banner\.js\?v=/);
  assert.doesNotMatch(html, /\{\{brand\./, 'brand tokens filled in');
  assert.match(html, /disappear at the next reset/);
});

test('one visitor\'s changes reach only that visitor, and nothing is written to the family\'s tables or files', async t => {
  const { dir, dataDir, database } = await seeded(t);
  const origin = await startDemo(t, dir);
  const db = new DatabaseSync(database);
  t.after(() => db.close());
  const a = visitor(origin), b = visitor(origin);
  await a.enter('parent');
  await b.enter('parent');

  const reads = async who => ({
    site: (await who.call('/api/site')).body,
    channels: (await who.call('/api/channels')).body,
    summary: (await who.call('/api/admin/summary')).body.kids,
    kids: (await who.call('/api/admin/kids')).body.kids,
    made: (await who.call('/api/clips?channel=my-kid-1')).body.clips,
  });
  const before = await reads(b);
  const tables = dump(db);
  const brand = folderHash(join(dataDir, 'brand'));
  assert.equal(before.kids.length, 3);
  assert.deepEqual(before.made, []);

  // Visitor A customizes Juni (id 1) and makes a kid of their own, with a badge each.
  const juni = await a.call('/api/admin/kids', { body: { id: 1, name: 'Juniper', kicker: 'Moon base builder', accent: '#7ce38b', themeId: 'comic-pow', login: { handle: 'hacker', pass: 'not-stored' }, reviewUploads: false } });
  assert.equal(juni.status, 200, JSON.stringify(juni.body));
  assert.match(juni.headers.get('set-cookie'), new RegExp(`^${SANDBOX_COOKIE}=[A-Za-z0-9_-]{22}; Path=/; HttpOnly; SameSite=Strict; Max-Age=\\d+$`));
  const juniBadge = await a.call('/api/admin/channels/1/badge', { method: 'PUT', body: { spec: { ...BADGE, text: { ...BADGE.text, value: 'JUNIPER' } } } });
  assert.equal(juniBadge.status, 200);
  assert.match(juniBadge.body.logoUrl, /^\/api\/demo\/sandbox\/badge\/juni\.svg\?v=\d+$/);
  const ava = await a.call('/api/admin/kids', { body: { name: 'Ava', kicker: 'Space cadet', accent: '#4DB8FF', themeId: 'arcade-crt' } });
  assert.equal(ava.body.kid.id, CREATED_BASE_ID + 1);
  assert.equal(ava.body.kid.slug, 'my-kid-1');
  const avaBadge = await a.call(`/api/admin/channels/${ava.body.kid.id}/badge`, { method: 'PUT', body: { spec: BADGE } });
  assert.equal(avaBadge.status, 200);

  // A sees it everywhere the app shows kids.
  const mine = await reads(a);
  const site = Object.fromEntries(mine.site.channels.map(kid => [kid.slug, kid]));
  assert.equal(site.juni.name, 'Juniper');
  assert.equal(site.juni.kicker, 'Moon base builder');
  assert.equal(site.juni.accent, '#7CE38B');
  assert.equal(site.juni.themeId, 'comic-pow');
  assert.equal(site.juni.logoUrl, juniBadge.body.logoUrl);
  assert.equal(site['my-kid-1'].name, 'Ava');
  assert.deepEqual(mine.channels.channels.map(kid => kid.slug), ['juni', 'otto', 'mabel', 'my-kid-1']);
  assert.equal(mine.summary.find(kid => kid.id === 1).name, 'Juniper');
  assert.equal(mine.kids.find(kid => kid.id === 1).sandbox, 'changed');
  assert.equal(mine.kids.find(kid => kid.slug === 'my-kid-1').sandbox, 'created');
  assert.equal(mine.kids.find(kid => kid.id === 1).login, 'juni', 'a login is never changed by the sandbox');
  assert.ok(mine.made.length > 0 && mine.made.length <= SANDBOX_LIMITS.borrowed);
  assert.ok(mine.made.every(clip => clip.channel === 'my-kid-1' && /^Borrowed from /.test(clip.blurb) && !clip.sealed));
  assert.ok(mine.made.some(clip => /Juniper's channel/.test(clip.blurb)), 'named as this visitor sees the kid');
  const sandbox = (await a.call('/api/demo/sandbox')).body;
  assert.equal(sandbox.active, true);
  assert.equal(sandbox.note, SANDBOX_NOTE);
  assert.deepEqual(sandbox.kids.map(kid => kid.kind), ['changed', 'created']);

  // A's badges are A's alone, drawn by the server and never cached.
  const svg = await a.call(site['my-kid-1'].logoUrl, { raw: true });
  assert.equal(svg.status, 200);
  assert.equal(svg.headers.get('cache-control'), 'private, no-store');
  assert.equal(svg.headers.get('content-type'), 'image/svg+xml');
  assert.equal(svg.headers.get('content-security-policy'), "default-src 'none'");
  assert.equal(await svg.text(), renderSpec(BADGE).svg);
  assert.equal((await b.call(site['my-kid-1'].logoUrl, { raw: true })).status, 404);
  assert.equal((await b.call(site.juni.logoUrl, { raw: true })).status, 404);

  // B, and anyone signed out, sees the family as it is.
  assert.deepEqual(await reads(b), before);
  const stranger = visitor(origin);
  assert.deepEqual((await stranger.call('/api/site')).body, before.site);
  assert.equal((await b.call('/api/demo/sandbox')).body.active, false);
  // Even with A's sandbox open as Grandma, B's reads are B's.
  await a.enter('grandma');
  assert.equal((await a.call('/api/channels')).body.channels.find(kid => kid.slug === 'juni').name, 'Juniper', 'the sandbox follows the device, not the role');
  assert.deepEqual(await reads(b), before);

  // Nothing reached the family's tables, activity, counts or brand files.
  assert.deepEqual(dump(db), tables);
  assert.equal(folderHash(join(dataDir, 'brand')), brand);
  assert.ok(!readdirSync(dataDir, { recursive: true }).some(name => /sandbox/i.test(String(name))), 'no sandbox file in the data folder');

  // Reset my changes: gone for A too, and the cookie with it.
  await a.enter('parent');
  const reset = await a.call('/api/demo/sandbox/reset', { body: {} });
  assert.match(reset.headers.get('set-cookie'), new RegExp(`^${SANDBOX_COOKIE}=; .*Max-Age=0`));
  assert.equal(a.jar.has(SANDBOX_COOKIE), false);
  assert.deepEqual(await reads(a), before);
});

test('caps, text rules and rate limits, on the server', async t => {
  const { dir } = await seeded(t);
  const origin = await startDemo(t, dir);
  const a = visitor(origin);
  await a.enter('parent');
  const save = body => a.call('/api/admin/kids', { body });

  for (const [body, pattern] of [
    [{ name: '' }, /Add a name/],
    [{ name: 'x'.repeat(41) }, /up to 40/],
    [{ name: 'Ava', kicker: 'x'.repeat(81) }, /up to 80/],
    [{ name: 'Ava\u202eevil' }, /invisible or control/],
    [{ name: 'Ava\nBob' }, /invisible or control/],
    [{ name: 'Ava', accent: 'red' }, /accent/],
    [{ name: 'Ava', themeId: 'not-a-theme' }, /splash/],
    [{ id: 777, name: 'Ava' }, /removed/],
  ]) {
    const response = await save(body);
    assert.ok([400, 404].includes(response.status), JSON.stringify(body));
    assert.match(response.body.error, pattern);
  }
  assert.equal((await save({ name: 'One' })).status, 200);
  assert.equal((await save({ name: 'Two' })).status, 200);
  const third = await save({ name: 'Three' });
  assert.equal(third.status, 409);
  assert.match(third.body.error, /up to 2 kids/);
  // Removing one makes room; its badge URL stops answering.
  assert.equal((await a.call('/api/admin/kids/delete', { body: { id: CREATED_BASE_ID + 1 } })).body.done, 'removed');
  assert.equal((await save({ name: 'Three' })).body.kid.slug, 'my-kid-1');

  // Kid and Grandma sessions get the demo's refusal, as for every other change.
  const kid = visitor(origin);
  await kid.enter('kid');
  const refused = await kid.call('/api/admin/kids', { body: { name: 'Sneaky' } });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.demo, true);
  assert.equal(kid.jar.has(SANDBOX_COOKIE), false, 'no sandbox for a refused change');

  // Everything else stays locked, sandbox or not.
  for (const [method, path, body] of [['POST', '/api/admin/kids/order', { order: [1, 2, 3] }], ['PUT', '/api/admin/channels/1/image', {}],
    ['POST', '/api/upload/raw/start', { title: 'x', size: 10 }], ['POST', '/api/comment', { clipId: 'demo-juni-rocket', body: 'hi' }],
    ['POST', '/api/admin/settings', { values: { site_name: 'Mine' } }], ['POST', '/api/admin/people/delete', { target: 'grandma@demo.invalid' }],
    ['PUT', '/api/admin/brand/badge', { spec: BADGE }], ['POST', '/api/signup', {}], ['POST', '/api/admin/settings/email-test', {}]]) {
    const response = await a.call(path, { method, body });
    assert.equal(response.status, 403, path);
    assert.equal(response.body.demo, true, path);
  }

  // Writes per sandbox: 30 a minute.
  let status = 200;
  for (let n = 0; n < 40 && status === 200; n++) status = (await save({ id: 2, name: `Otto ${n}` })).status;
  assert.equal(status, 429);

  // New sandboxes per visitor: a few a minute, so dropping the cookie in a loop can't push others out.
  const statuses = [];
  for (let n = 0; n < 8; n++) {
    a.jar.delete(SANDBOX_COOKIE);
    statuses.push((await save({ name: 'Again' })).status);
  }
  assert.ok(statuses.includes(429), statuses.join(','));
});

test('badge specs are checked exactly like the real badge route, and free text stays text', async t => {
  const { dir } = await seeded(t);
  const origin = await startDemo(t, dir);
  const a = visitor(origin);
  await a.enter('parent');
  const bad = [
    { v: 2 }, { v: 1, shape: 'triangle' }, { v: 1, bg: 'red' }, { v: 1, extra: true }, { v: 1, text: { value: 'TOO LONG FOR IT' } },
    { v: 1, text: { value: 'A\u0007' } }, { v: 1, stickers: [{ id: 'no-such-sticker', x: 1, y: 1, scale: 1, rotate: 0 }] },
    { v: 1, stickers: Array(4).fill({ id: 'rocket', x: 1, y: 1, scale: 1, rotate: 0 }) }, { v: 1, text: { value: 'x'.repeat(5000) } }, 'not a spec',
  ];
  for (const spec of bad) {
    let expected;
    try { renderSpec(spec); } catch (error) { expected = error.message; }
    assert.ok(expected, `the real renderer refuses ${JSON.stringify(spec).slice(0, 60)}`);
    const response = await a.call('/api/admin/channels/2/badge', { method: 'PUT', body: { spec } });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, expected);
  }
  // A system-font badge with markup in its text is escaped by the renderer.
  const spec = { v: 1, shape: 'circle', bg: '#FF5C2B', text: { value: '<a&"b\'>', font: 'system', color: '#0B0C10' } };
  const saved = await a.call('/api/admin/channels/2/badge', { method: 'PUT', body: { spec } });
  assert.equal(saved.status, 200);
  const svg = await (await a.call(saved.body.logoUrl, { raw: true })).text();
  assert.equal(svg, renderSpec(spec).svg);
  assert.match(svg, /&lt;a&amp;&quot;b&#39;&gt;|&lt;a&amp;&quot;b&apos;&gt;/);
  assert.doesNotMatch(svg, /<a&/);

  // Names are data: kept as typed, sent as JSON with nosniff, and never as markup.
  const name = '<img src=x onerror=alert(1)>';
  assert.equal((await a.call('/api/admin/kids', { body: { name, kicker: '"><script>x</script>' } })).status, 200);
  const site = await a.call('/api/site', { raw: true });
  assert.match(site.headers.get('content-type'), /^application\/json/);
  assert.equal(site.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await site.json()).channels.at(-1).name, name);

  // The pages that show a sandboxed kid build their DOM from text, never from markup.
  for (const file of ['public/js/demo/make.js', 'public/js/shell/demo-banner.js']) {
    assert.doesNotMatch(readFileSync(join(ROOT, file), 'utf8'), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, file);
  }
});

test('a reset clears every visitor\'s sandbox, even one made by the reset script', async t => {
  const { dir, database } = await seeded(t);
  const origin = await startDemo(t, dir);
  const a = visitor(origin);
  await a.enter('parent');
  await a.call('/api/admin/kids', { body: { name: 'Ava' } });
  assert.equal((await a.call('/api/demo/sandbox')).body.active, true);
  const child = spawn(process.execPath, [join(ROOT, 'scripts/demo-reset.mjs')], {
    cwd: dir, stdio: 'ignore', env: { ...process.env, DATABASE_PATH: database, DATA_DIR: '', DEMO_SNAPSHOT_DIR: '', DEMO_MODE: '1' },
  });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  assert.equal((await a.call('/api/demo/sandbox')).body.active, false);
  assert.equal((await a.call('/api/site')).body.channels.length, 3);
});

// In-process: the limits a real visitor can't reach through valid input.
function fakeRequest(method, path, body, cookie = '') {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  return Object.assign(request, { method, url: path, headers: cookie ? { cookie } : {} });
}
function fakeResponse() {
  const res = { headers: {}, status: 0, body: '' };
  res.done = new Promise(resolve => {
    res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
    res.removeHeader = name => { delete res.headers[name.toLowerCase()]; };
    res.writeHead = (status, headers = {}) => { res.status = status; for (const [k, v] of Object.entries(headers)) res.headers[k.toLowerCase()] = v; return res; };
    res.end = chunk => { res.body = chunk ? String(chunk) : ''; resolve(res); return res; };
  });
  res.headersSent = false;
  return res;
}

const RESET_AT = Date.now() + 3600000;
test('sandbox limits: the oldest sandbox goes first, and one sandbox stays small', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  await migrate(sqlite);
  const env = { SITE_URL: 'https://demo.example', settings: { all: () => ({ family_accent: '#FF5C2B', gate_theme: 'glass-gate', site_tagline: '' }) } };
  const sandboxes = createSandboxes({
    sqlite, env, themeIds: () => ['glass-gate'], nextReset: () => RESET_AT,
    limits: { ...SANDBOX_LIMITS, sandboxes: 2, bytes: 900 }, ownerOf: async () => ({ role: 'super' }),
  });
  const refuse = (req, res) => res.writeHead(403).end('{}');
  async function send(method, path, body, cookie) {
    const res = fakeResponse();
    assert.equal(sandboxes.handle(fakeRequest(method, path, body, cookie), res, path, refuse), true);
    await res.done;
    return { ...res, json: JSON.parse(res.body || 'null'), cookie: String(res.headers['set-cookie'] || '').split(';')[0] };
  }
  const first = await send('POST', '/api/admin/kids', { name: 'First' });
  assert.match(first.headers['set-cookie'], /; Secure$/, 'Secure on an https demo');
  const second = await send('POST', '/api/admin/kids', { name: 'Second' });
  await send('POST', '/api/admin/kids', { name: 'Third' });
  assert.equal(sandboxes.size, 2);
  assert.equal((await send('GET', '/api/demo/sandbox', undefined, first.cookie)).json.active, false, 'the oldest was evicted');
  assert.equal((await send('GET', '/api/demo/sandbox', undefined, second.cookie)).json.active, true);

  // 900 bytes: a badge or two fits, and the change that would not fit changes nothing.
  const spec = { ...BADGE, stickers: [BADGE.stickers[0], { ...BADGE.stickers[0], x: 40 }, { ...BADGE.stickers[0], x: 90 }] };
  const steps = [
    ['PUT', `/api/admin/channels/${CREATED_BASE_ID + 1}/badge`, { spec }],
    ['PUT', '/api/admin/channels/1/badge', { spec }],
    ['POST', '/api/admin/kids', { name: 'Fourth', kicker: 'x'.repeat(80) }],
    ['PUT', `/api/admin/channels/${CREATED_BASE_ID + 2}/badge`, { spec }],
  ];
  let refused = null, kept = null;
  for (const [method, path, body] of steps) {
    const before = (await send('GET', '/api/demo/sandbox', undefined, second.cookie)).json;
    const result = await send(method, path, body, second.cookie);
    if (result.status === 413) { refused = result; kept = before; break; }
    assert.equal(result.status, 200, path);
  }
  assert.ok(refused, 'the cap was reached');
  assert.match(refused.json.error, /more than the demo keeps/);
  assert.deepEqual((await send('GET', '/api/demo/sandbox', undefined, second.cookie)).json, kept, 'nothing changed');
  sandboxes.clearAll();
  assert.equal(sandboxes.size, 0);
});
