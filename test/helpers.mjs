// Fixtures shared by the server tests: scratch folders, a running server, a ready install, and the demo's
// seeded snapshot. family-fixture.mjs builds a whole family on top of startInstall.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const ROOT = resolve(import.meta.dirname, '..');
export const PARENT = { email: 'parent@example.com', pass: 'A-test-only-parent-password!' };

// An empty folder that is removed when the test ends.
export function scratch(t, prefix = 'kidtube-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// The test runner's environment without anything that would point a server at another install, as a
// family has it on first run: no .env, no secret, no site address, no demo.
const INSTALL_VARIABLES = ['DATABASE_PATH', 'DATA_DIR', 'SIGN_SECRET', 'SITE_URL', 'NODE_ENV', 'TRUST_PROXY', 'MAIL_MODE', 'HOST_PORT',
  'DEMO_MODE', 'DEMO_RESET_MINUTES', 'DEMO_SNAPSHOT_DIR'];
export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of INSTALL_VARIABLES) delete env[key];
  return { ...env, PORT: '0', HOST: '127.0.0.1', PUBLIC_DIR: join(ROOT, 'public'), ...extra };
}

// Starts server/index.mjs in `cwd` on a free port, as `npm start` would, and stops it when the test ends
// (then runs `cleanup`). Rejects with { code, stderr } if the server exits before it listens.
export async function startServer(t, { cwd, env, args = [], cleanup }) {
  const child = spawn(process.execPath, [...args, join(ROOT, 'server/index.mjs')], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '', logs = '';
  child.stdout.on('data', chunk => { out += chunk; logs += chunk; });
  child.stderr.on('data', chunk => { err += chunk; logs += chunk; });
  const stop = async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit').catch(() => {}); } };
  t.after(async () => { await stop(); await cleanup?.(); });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout ' + err)), 10000);
    child.stdout.on('data', () => {
      const match = /listening on (\d+)/.exec(out);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(Object.assign(new Error(err || `exited ${code}`), { code, stderr: err })); });
  });
  const origin = `http://127.0.0.1:${port}`;

  function call(path, { body, cookie, method, headers = {}, redirect } = {}) {
    return fetch(origin + path, {
      method: method || (body === undefined ? 'GET' : 'POST'), redirect,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  return { origin, port, call, stop, out: () => out, err: () => err, logs: () => logs };
}

// A fresh install made by scripts/setup.mjs and served on a free port with email off.
export async function startInstall(t, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kidtube-install-'));
  const database = join(dir, 'data/kidtube.sqlite');
  const base = { ...process.env };
  delete base.DATABASE_PATH;
  const setup = spawnSync(process.execPath, [join(ROOT, 'scripts/setup.mjs')], {
    cwd: dir, encoding: 'utf8',
    env: { ...base, KIDTUBE_ADMIN_EMAIL: PARENT.email, KIDTUBE_ADMIN_PASSWORD: PARENT.pass, SITE_URL: 'http://localhost:3000' },
  });
  if (setup.status !== 0) throw new Error(setup.stderr);
  const db = new DatabaseSync(database);
  const server = await startServer(t, {
    cwd: dir, args: ['--env-file=.env'],
    env: { ...base, PORT: '0', HOST: '127.0.0.1', DATABASE_PATH: database, PUBLIC_DIR: join(ROOT, 'public'), MAIL_MODE: 'disabled', ...env },
    cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); },
  });

  async function login({ email, pass }) {
    const response = await server.call('/api/login', { body: { email, pass } });
    const json = await response.json();
    return { ...json, email, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }

  return { dir, db, origin: server.origin, call: server.call, login, logs: server.logs };
}

// A data folder holding the demo snapshot (no clips rendered), as `npm run demo:seed` leaves one.
export async function seededDemo(t) {
  const { writeSnapshot } = await import('../scripts/demo-seed.mjs');
  const dir = scratch(t, 'kidtube-demo-');
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir);
  await writeSnapshot(join(dataDir, 'demo-snapshot'), { render: false });
  return { dir, dataDir, database: join(dataDir, 'kidtube.sqlite') };
}

// Every table, every row and every trigger, in a stable order: what "unchanged" means for a database.
export function dump(sqlite) {
  const out = {};
  for (const { name } of sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    out[name] = sqlite.prepare(`SELECT * FROM "${name}"`).all().map(row => JSON.stringify(row, (key, value) => typeof value === 'bigint' ? String(value) : value)).sort();
  }
  out.triggers = sqlite.prepare("SELECT name, sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all().map(row => row.sql);
  return out;
}
