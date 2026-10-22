import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, cleanEnv, startServer } from './helpers.mjs';
import { CODE_ALPHABET, newCode, normalizeCode } from '../server/setup.mjs';
import { slugFrom } from '../server/family.mjs';
import { ownershipFix } from '../server/config.mjs';
import { accentCheck, addressNotes, formatCode, initials, kidPassword } from '../public/setup/helpers.js';

const OWNER = { first: 'Ada', last: 'Okafor', email: 'ada@example.com', pass: 'A-test-only-owner-password!' };
const mode = file => statSync(file).mode & 0o777;

// Starts server/index.mjs in an empty folder (or `dir`), the way `npm start` or Docker would on first run.
async function startFresh(t, { env = {}, dir } = {}) {
  dir ??= mkdtempSync(join(tmpdir(), 'kidtube-fresh-'));
  const server = await startServer(t, { cwd: dir, env: cleanEnv(env) });
  // The setup lines follow the "listening" line in the same tick, but may arrive in a later chunk.
  await new Promise(resolve => setTimeout(resolve, 150));
  const code = /Setup code: (KT-[0-9A-Z-]+)/.exec(server.out())?.[1];
  const call = (path, options = {}) => server.call(path, { redirect: 'manual', ...options });
  return { ...server, dir, code, call, data: join(dir, 'data') };
}

async function claimed(t, env) {
  const app = await startFresh(t, { env });
  const response = await app.call('/api/setup/claim', { body: { code: app.code, ...OWNER } });
  assert.equal(response.status, 200, await response.clone().text());
  const owner = await response.json();
  const auth = { 'x-kid-email': owner.email, 'x-kid-token': owner.t };
  return { ...app, owner, auth, cookie: response.headers.get('set-cookie').split(';')[0] };
}

test('setup codes are Crockford base32, about 100 bits, and forgive look-alike letters', () => {
  const code = newCode();
  assert.match(code, /^KT(?:-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
  assert.equal(CODE_ALPHABET.length, 32);
  assert.doesNotMatch(CODE_ALPHABET, /[ILOU]/);
  assert.notEqual(newCode(), code);
  assert.equal(normalizeCode('kt-0aa1b-o0il1-xxxxx-yyyyy'), '0AA1B00111XXXXXYYYYY');
  assert.equal(formatCode('kt7qmxr4pd9'), 'KT-7QMXR-4PD9');
  assert.equal(initials('The Okafor Tapes'), 'O');
  assert.equal(initials('Mia and Leo'), 'ML');
  assert.match(kidPassword(), /^[a-z]+-[a-z]+-\d{2}$/);
  assert.equal(accentCheck('#FF5C2B').ok, true);
  assert.equal(accentCheck('#1E2A40').ok, false);
  assert.equal(slugFrom('Zoë Ann!'), 'zoe-ann');
  assert.equal(addressNotes('http://192.168.1.20:3000')[0].level, 'warn');
  assert.equal(addressNotes('http://videos.example.com', { production: true })[0].level, 'bad');
  assert.deepEqual(addressNotes('https://videos.example.com'), []);
});

test('first boot with no .env creates the secret, database and setup code, and holds every other API', { timeout: 30000 }, async t => {
  const app = await startFresh(t);
  const token = join(app.data, 'setup-token');
  assert.equal(mode(join(app.data, 'secret')), 0o600);
  assert.equal(mode(token), 0o600);
  assert.equal(mode(join(app.data, 'kidtube.sqlite')), 0o600);
  assert.equal(mode(app.data), 0o700);
  assert.equal(readFileSync(token, 'utf8').trim(), app.code);
  assert.ok(readFileSync(join(app.data, 'secret'), 'utf8').trim().length >= 64);
  assert.equal(existsSync(join(app.dir, '.env')), false);
  assert.match(app.out(), /Open http:\/\/localhost:\d+\/setup/);

  for (const path of ['/api/clips', '/api/channels', '/api/admin/overview', '/api/upload/raw/start', '/api/admin/brand']) {
    const response = await app.call(path);
    assert.equal(response.status, 503, path);
    assert.deepEqual(await response.json(), { ok: false, setup: true, error: 'This install is still being set up.' });
  }
  for (const path of ['/api/login', '/api/signup', '/api/guest/redeem']) {
    assert.equal((await app.call(path, { body: {} })).status, 503, path);
  }
  assert.equal((await app.call('/api/health')).status, 200);
  assert.equal((await app.call('/api/themes')).status, 200);
  assert.equal((await app.call('/api/site').then(r => r.json())).setup, 'required');
  for (const path of ['/', '/parents', '/about']) {
    const response = await app.call(path);
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get('location'), '/setup');
  }
  const page = await app.call('/setup');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.doesNotMatch(await page.text(), /\{\{brand\./);
  assert.equal((await app.call('/api/setup/state').then(r => r.json())).stage, 'code');

  // A restart makes a new code and keeps the secret.
  const secret = readFileSync(join(app.data, 'secret'), 'utf8');
  await app.stop();
  const again = await startFresh(t, { dir: app.dir });
  assert.notEqual(again.code, app.code);
  assert.equal(readFileSync(token, 'utf8').trim(), again.code);
  assert.equal(readFileSync(join(app.data, 'secret'), 'utf8'), secret);
  assert.equal((await again.call('/api/setup/verify', { body: { code: app.code } })).status, 403);
  // Lowercase, spaces and O for 0 still match.
  const typed = again.code.toLowerCase().replace(/0/g, 'o').replace(/-/g, ' ');
  assert.equal((await again.call('/api/setup/verify', { body: { code: typed } })).status, 200);
});

test('wrong codes get 403, then 429 per address, and 30 in all turn the code off until a restart', { timeout: 30000 }, async t => {
  const app = await startFresh(t, { env: { TRUST_PROXY: '1' } });
  const from = ip => ({ 'x-forwarded-for': ip });
  const guess = (ip, code = 'KT-00000-00000-00000-00000') => app.call('/api/setup/claim', { body: { code, ...OWNER }, headers: from(ip) });
  for (let i = 0; i < 5; i++) assert.equal((await guess('10.0.0.1')).status, 403);
  const limited = await guess('10.0.0.1');
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /ten minutes/);
  assert.equal((await guess('10.0.0.1', app.code)).status, 429, 'the right code waits too');
  assert.equal((await app.call('/api/setup/verify', { body: { code: app.code }, headers: from('10.0.0.1') })).status, 429);
  for (let ip = 2; ip <= 6; ip++) for (let i = 0; i < 5; i++) assert.equal((await guess(`10.0.0.${ip}`)).status, 403);
  const dead = await guess('10.0.0.99', app.code);
  assert.equal(dead.status, 423);
  assert.match((await dead.json()).error, /Restart/);
  assert.equal(existsSync(join(app.data, 'setup-token')), false);
  assert.equal((await app.call('/api/setup/state').then(r => r.json())).disabled, true);
  assert.match(app.out(), /turned off/);

  await app.stop();
  const restarted = await startFresh(t, { dir: app.dir, env: { TRUST_PROXY: '1' } });
  assert.equal((await restarted.call('/api/setup/verify', { body: { code: restarted.code }, headers: from('10.0.0.99') })).status, 200);
});

test('of five simultaneous claims exactly one wins; afterwards the code is gone and claims get 410', { timeout: 30000 }, async t => {
  const app = await startFresh(t);
  const results = await Promise.all([1, 2, 3, 4, 5].map(n =>
    app.call('/api/setup/claim', { body: { code: app.code, ...OWNER, email: `parent${n}@example.com` } })));
  const statuses = results.map(response => response.status).sort();
  assert.deepEqual(statuses, [200, 409, 409, 409, 409]);
  const winner = results.find(response => response.status === 200);
  const owner = await winner.json();
  assert.equal(owner.role, 'super');
  assert.match(owner.t, /^\d{13}\./);
  assert.match(winner.headers.get('set-cookie'), /^kid_access=.*HttpOnly; SameSite=Strict/);
  assert.equal(existsSync(join(app.data, 'setup-token')), false);

  const db = new DatabaseSync(join(app.data, 'kidtube.sqlite'));
  t.after(() => db.close());
  assert.equal(db.prepare("SELECT COUNT(*) n FROM accounts WHERE role='super'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM activity WHERE kind='setup' AND subject='claim'").get().n, 1);

  assert.equal((await app.call('/api/setup/claim', { body: { code: app.code, ...OWNER } })).status, 410);
  assert.equal((await app.call('/api/setup/verify', { body: { code: app.code } })).status, 410);

  // Claimed but not finished: the APIs work, visitors see a calm notice, the owner sees the site.
  const cookie = winner.headers.get('set-cookie').split(';')[0];
  assert.equal((await app.call('/api/clips', { headers: { cookie } })).status, 200);
  const notice = await app.call('/');
  assert.equal(notice.status, 200);
  assert.match(await notice.text(), /Still being set up/);
  assert.doesNotMatch(await app.call('/', { headers: { cookie } }).then(r => r.text()), /Still being set up/);
  assert.equal((await app.call('/api/setup/state').then(r => r.json())).stage, 'signin');
  const auth = { 'x-kid-email': owner.email, 'x-kid-token': owner.t };
  const state = await app.call('/api/setup/state', { headers: auth }).then(r => r.json());
  assert.equal(state.stage, 'wizard');
  assert.equal(state.reached, 3);

  assert.equal((await app.call('/api/setup/complete', { body: {}, headers: auth })).status, 200);
  assert.equal((await app.call('/api/site').then(r => r.json())).setup, 'complete');
  assert.doesNotMatch(await app.call('/').then(r => r.text()), /Still being set up/);
  assert.equal((await app.call('/api/setup/state').then(r => r.json())).stage, 'finished');

  // A restart after the claim prints no code and writes no token file.
  await app.stop();
  const again = await startFresh(t, { dir: app.dir });
  assert.equal(again.code, undefined);
  assert.equal(existsSync(join(app.data, 'setup-token')), false);
});

test('before the site address is saved the request\'s own origin passes; afterwards only the site address', { timeout: 30000 }, async t => {
  const app = await startFresh(t, { env: { TRUST_PROXY: '1' } });
  const post = (origin, extra = {}) => app.call('/api/login', { body: {}, headers: { origin, ...extra } });
  assert.equal((await post(app.origin)).status, 503, 'same host passes the origin check');
  assert.equal((await post('https://evil.example')).status, 403);
  assert.equal((await post(`https://127.0.0.1:${app.port}`)).status, 403, 'the scheme must match too');
  assert.equal((await post(`https://127.0.0.1:${app.port}`, { 'x-forwarded-proto': 'https' })).status, 503, 'a trusted proxy names the scheme');

  const claim = await app.call('/api/setup/claim', { body: { code: app.code, ...OWNER }, headers: { origin: app.origin } });
  const owner = await claim.json();
  const auth = { 'x-kid-email': owner.email, 'x-kid-token': owner.t };
  const saved = await app.call('/api/setup/family', { body: { name: 'The Okafor Tapes', tagline: 'Home videos', siteUrl: 'http://localhost:3000/' }, headers: { ...auth, origin: app.origin } });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).siteUrl, 'http://localhost:3000');
  assert.equal((await post(app.origin)).status, 403, 'the old host no longer passes');
  assert.notEqual((await post('http://localhost:3000')).status, 403);
  assert.equal((await post('https://evil.example')).status, 403);
});

test('production needs an https address, saved or from the environment', { timeout: 30000 }, async t => {
  const app = await claimed(t, { NODE_ENV: 'production' });
  const save = siteUrl => app.call('/api/setup/family', { body: { name: 'The Okafor Tapes', siteUrl }, headers: app.auth });
  const plain = await save('http://videos.example.com');
  assert.equal(plain.status, 400);
  assert.match((await plain.json()).error, /https/);
  assert.equal((await save('https://videos.example.com')).status, 200);

  const refused = await startFresh(t, { env: { NODE_ENV: 'production', SITE_URL: 'http://videos.example.com' } }).catch(error => error);
  assert.ok(refused instanceof Error);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /Production requires an https/);
});

test('kids: the first takes over channel 1, "family" is reserved, and a kid signs in with a bare handle', { timeout: 30000 }, async t => {
  const app = await claimed(t);
  const kid = body => app.call('/api/setup/kids', { body, headers: app.auth });
  assert.equal((await app.call('/api/setup/kids', { body: { name: 'Juni' } })).status, 401, 'needs the owner');
  assert.equal((await app.call('/api/setup/kids/done', { body: {}, headers: app.auth })).status, 400, 'no kids yet');

  const juni = await kid({ name: 'Juni', kicker: 'Science and slime', accent: '#A98BFF', themeId: 'glass-gate', login: { handle: 'juni', pass: 'sunny-otter-42' } });
  assert.equal(juni.status, 200, await juni.clone().text());
  const first = (await juni.json()).kid;
  assert.equal(first.id, 1);
  assert.equal(first.slug, 'juni');
  assert.equal(first.login, 'juni');
  assert.equal(first.reviewUploads, true);

  const reserved = await kid({ name: 'Milo', slug: 'family' });
  assert.equal(reserved.status, 400);
  assert.match((await reserved.json()).error, /reserved/);
  const named = await kid({ name: 'Family' });
  assert.equal((await named.json()).kid.slug, 'family-kid');
  assert.equal((await kid({ name: 'Milo', themeId: 'not-a-theme' })).status, 400);
  assert.equal((await kid({ name: 'Milo', login: { handle: 'juni', pass: 'another-pass' } })).status, 409, 'handles are unique');
  assert.equal((await kid({ name: 'Milo', login: { handle: 'milo', pass: 'short' } })).status, 400, '8 characters at least');
  const milo = await kid({ name: 'Milo', accent: '#FF5C2B', themeId: 'arcade-crt', reviewUploads: false, login: { handle: 'milo', pass: 'brave-comet-17' } }).then(r => r.json());
  assert.equal(milo.kid.slug, 'milo');
  assert.equal(milo.kid.reviewUploads, false);
  assert.equal((await app.call('/api/setup/kids/done', { body: {}, headers: app.auth })).status, 200);

  const login = await app.call('/api/login', { body: { email: 'juni', pass: 'sunny-otter-42' } });
  const session = await login.json();
  assert.equal(session.ok, true);
  assert.equal(session.email, 'juni@kids.invalid');
  assert.equal(session.role, 'kid');
  assert.match(login.headers.get('set-cookie'), /^kid_access=/);
  assert.equal((await app.call('/api/login', { body: { email: 'Juni', pass: 'wrong-password-1' } })).status, 401);
  // A kid's session cannot drive the wizard.
  assert.equal((await app.call('/api/setup/kids', { body: { name: 'X' }, headers: { 'x-kid-email': session.email, 'x-kid-token': session.t } })).status, 401);

  const db = new DatabaseSync(join(app.data, 'kidtube.sqlite'));
  t.after(() => db.close());
  assert.equal(db.prepare("SELECT unsubscribed FROM video_email_preferences WHERE email='juni@kids.invalid'").get().unsubscribed, 1);
  assert.equal(db.prepare('SELECT channel_id FROM accounts WHERE email=?').get('juni@kids.invalid').channel_id, 1);

  // Editing keeps the slug and the password unless a new one is given; removing only works for extra kids.
  const edited = await kid({ id: 1, name: 'Juniper', login: { handle: 'juni' } }).then(r => r.json());
  assert.equal(edited.kid.slug, 'juni');
  assert.equal((await app.call('/api/login', { body: { email: 'juni', pass: 'sunny-otter-42' } })).status, 200);
  assert.equal((await app.call('/api/setup/kids/1', { method: 'DELETE', headers: app.auth })).status, 409);
  assert.equal((await app.call(`/api/setup/kids/${milo.kid.id}`, { method: 'DELETE', headers: app.auth })).status, 200);
  assert.equal((await app.call('/api/login', { body: { email: 'milo', pass: 'brave-comet-17' } })).status, 401);

  const site = await app.call('/api/site').then(r => r.json());
  assert.deepEqual(site.channels.map(channel => channel.slug), ['juni', 'family-kid']);
});

test('the other wizard steps save settings for the owner only', { timeout: 30000 }, async t => {
  const app = await claimed(t);
  assert.equal((await app.call('/api/setup/watch', { body: { kidsPublic: false } })).status, 401);
  const watch = await app.call('/api/setup/watch', { body: { kidsPublic: false, signupMode: 'closed', guestPasses: false, comments: 'off' }, headers: app.auth });
  assert.equal(watch.status, 200);
  const site = await app.call('/api/site').then(r => r.json());
  assert.equal(site.kidsPublic, false);
  assert.equal(site.signupMode, 'closed');
  assert.equal(site.guestPasses, false);
  assert.equal((await app.call('/api/setup/watch', { body: { comments: 'sometimes' }, headers: app.auth })).status, 400);

  const missing = await app.call('/api/setup/email', { body: { mode: 'brevo', sender: 'videos@example.com', notify: 'ada@example.com' }, headers: app.auth });
  assert.equal(missing.status, 400);
  assert.equal((await app.call('/api/setup/email', { body: { mode: 'disabled' }, headers: app.auth })).status, 200);
  assert.equal((await app.call('/api/setup/email/test', { body: {}, headers: app.auth })).status, 400, 'nothing to test while email is off');
  const state = await app.call('/api/setup/state', { headers: app.auth }).then(r => r.json());
  assert.equal(state.reached, 7);
  assert.equal(state.email.mode, 'disabled');
});

test('the command-line setup still works and refuses an install the server already created', { timeout: 30000 }, async t => {
  const cli = (cwd, env = {}) => spawnSync(process.execPath, [join(ROOT, 'scripts/setup.mjs')], {
    cwd, encoding: 'utf8', env: { ...cleanEnv(), KIDTUBE_ADMIN_EMAIL: OWNER.email, KIDTUBE_ADMIN_PASSWORD: OWNER.pass, SITE_URL: 'http://localhost:3000', ...env },
  });
  const fresh = mkdtempSync(join(tmpdir(), 'kidtube-cli-'));
  t.after(() => rmSync(fresh, { recursive: true, force: true }));
  const first = cli(fresh);
  assert.equal(first.status, 0, first.stderr);
  assert.ok(existsSync(join(fresh, '.env')));
  assert.notEqual(cli(fresh).status, 0);

  const app = await startFresh(t);
  t.after(() => rmSync(app.dir, { recursive: true, force: true }));
  await app.stop();
  const refused = cli(app.dir);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /\/setup/);
  assert.equal(existsSync(join(app.dir, '.env')), false);

  // The CLI install boots straight into the finished site, with no code.
  const booted = await startFresh(t, { dir: fresh, env: { SIGN_SECRET: readFileSync(join(fresh, '.env'), 'utf8').match(/SIGN_SECRET=(\w+)/)[1], SITE_URL: 'http://localhost:3000' } });
  assert.equal(booted.code, undefined);
  assert.equal((await booted.call('/api/site').then(r => r.json())).setup, 'complete');
});

test('in Docker the ownership fix names the folder on the computer, not the path inside the container', () => {
  const user = `${process.getuid()}:${process.getgid()}`;
  assert.equal(ownershipFix('/srv/kidtube/data', {}), `sudo chown -R ${user} "/srv/kidtube/data"`);
  // compose.yaml passes the host side of the /data mount as HOST_DATA.
  assert.equal(ownershipFix('/data', { HOST_DATA: './data' }), `sudo chown -R ${user} "./data" (in the folder with compose.yaml)`);
  assert.equal(ownershipFix('/data', { HOST_DATA: '/volume1/kidtube' }), `sudo chown -R ${user} "/volume1/kidtube"`);
  // A named volume has no folder to chown on the computer, so the fix runs inside a one-off container.
  assert.equal(ownershipFix('/data', { HOST_DATA: 'kidtube-data' }), `docker compose run --rm --user root --cap-add CHOWN --cap-add DAC_OVERRIDE --entrypoint chown kidtube -R ${user} /data`);
});

test('a data folder the app cannot write stops it with the exact ownership fix',{ skip: process.getuid?.() === 0 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'kidtube-locked-'));
  t.after(() => { chmodSync(join(dir, 'data'), 0o700); rmSync(dir, { recursive: true, force: true }); });
  mkdirSync(join(dir, 'data'));
  chmodSync(join(dir, 'data'), 0o500);
  const error = await startFresh(t, { dir }).catch(problem => problem);
  assert.equal(error.code, 1);
  assert.match(error.stderr, /not writable/);
  assert.match(error.stderr, new RegExp(`sudo chown -R ${process.getuid()}:${process.getgid()} ".*data"`));
});
