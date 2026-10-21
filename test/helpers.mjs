import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const ROOT = resolve(import.meta.dirname, '..');
export const PARENT = { email: 'parent@example.com', pass: 'A-test-only-parent-password!' };

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
  const child = spawn(process.execPath, ['--env-file=.env', join(ROOT, 'server/index.mjs')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...base, PORT: '0', HOST: '127.0.0.1', DATABASE_PATH: database, PUBLIC_DIR: join(ROOT, 'public'), MAIL_MODE: 'disabled', ...env },
  });
  let logs = '';
  child.stderr.on('data', chunk => { logs += chunk; });
  const db = new DatabaseSync(database);
  t.after(async () => {
    child.kill();
    await once(child, 'exit').catch(() => {});
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout ' + logs)), 10000);
    child.stdout.on('data', chunk => {
      const match = /listening on (\d+)/.exec(String(chunk));
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(logs)); });
  });
  const origin = `http://127.0.0.1:${port}`;

  function call(path, { body, cookie, method, headers = {} } = {}) {
    return fetch(origin + path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function login({ email, pass }) {
    const response = await call('/api/login', { body: { email, pass } });
    const json = await response.json();
    return { ...json, email, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }

  return { dir, db, origin, call, login, logs: () => logs };
}
