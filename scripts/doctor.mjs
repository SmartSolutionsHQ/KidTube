import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { installPaths, ownershipFix } from '../server/config.mjs';

// Read-only checks for a Node install. It creates nothing and sends no email; a first install with
// no .env is fine, because the server makes its own secret and database on first start.
let failures = 0;
const line = (status, name, detail = '') => console.log(`${status}: ${name}${detail ? ` (${detail})` : ''}`);
function check(name, ok, hint = '') { line(ok ? 'OK' : 'MISSING', name, ok ? '' : hint); if (!ok) failures++; }
const info = (name, detail) => line('NOTE', name, detail);

check('Node 24.16 or later in the Node 24 line', Number(process.versions.node.split('.')[0]) === 24 && Number(process.versions.node.split('.')[1]) >= 16, process.versions.node);
for (const binary of ['ffmpeg', 'ffprobe']) check(binary, spawnSync(binary, ['-version'], { stdio: 'ignore' }).status === 0, 'needed for uploads; Docker includes it');

const { database, dataDir, secretFile } = installPaths();
// The nearest folder that exists must be writable, or the first start cannot create the rest.
let folder = dataDir;
while (!existsSync(folder) && dirname(folder) !== folder) folder = dirname(folder);
let writable = true;
try { accessSync(folder, constants.W_OK | constants.X_OK); } catch { writable = false; }
check(`Data folder ${dataDir} is writable`, writable, `run: ${ownershipFix(folder)}`);

if (process.env.SIGN_SECRET) check('Signing secret from SIGN_SECRET (32+ characters)', process.env.SIGN_SECRET.length >= 32);
else if (existsSync(secretFile)) check(`Signing secret in ${secretFile} is private`, process.platform === 'win32' || (statSync(secretFile).mode & 0o077) === 0, 'the server tightens it to 0600 on start');
else info('Signing secret', `made in ${secretFile} on first start`);

if (!existsSync(database)) {
  info('Database', `created on first start at ${database}; then open /setup with the code from the log`);
} else {
  try {
    const db = new DatabaseSync(database, { readOnly: true });
    const owner = db.prepare("SELECT 1 FROM accounts WHERE role='super' LIMIT 1").get();
    const done = db.prepare("SELECT value FROM settings WHERE key='setup_complete'").get()?.value === 'true';
    db.close();
    if (!owner) info('Setup', 'waiting for a parent: open /setup and enter the setup code from the log or data/setup-token');
    else if (!done) info('Setup', 'started; sign in at /setup to finish it');
    else check('Setup finished', true);
  } catch (error) {
    check('Database readable', false, error.message);
  }
}

const site = process.env.SITE_URL || '';
if (!site) info('Site address', 'not in the environment; the setup page saves it');
else {
  check('SITE_URL is an http(s) address', /^https?:\/\//.test(site));
  if (process.env.NODE_ENV === 'production') check('Production uses https', site.startsWith('https:'));
}
if (process.env.MAIL_MODE === 'brevo') for (const key of ['BREVO_API_KEY', 'SENDER_EMAIL', 'NOTIFY_EMAIL']) check(key, Boolean(process.env[key]));
console.log('Mail mode from the environment: ' + (process.env.MAIL_MODE || 'not set (the setup page can turn it on)') + '. This check sends no email.');
process.exitCode = failures ? 1 : 0;
