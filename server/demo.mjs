// Demo mode: the public demo site. DEMO_MODE=1 in the server's environment (never anything a browser can
// send) turns an install into a copy of an invented family that anyone can try in ten seconds:
//
//   - one-tap roles at the front door ("Try it as: a kid / Grandma / a parent"), no passwords;
//   - every change refused on the server with a calm message, except likes and reactions (fixed sets,
//     rate-limited per visitor in memory) and watching, which is answered but never logged;
//   - the seeded snapshot (scripts/demo-seed.mjs) restored at boot and every DEMO_RESET_MINUTES, in one
//     SQLite transaction on the live connection, with every time moved forward so the family looks fresh;
//   - a banner on every page (public/js/shell/demo-banner.js), injected here so a normal install never
//     loads it;
//   - a private sandbox per visitor (server/demo-sandbox.mjs) where they may customize a demo kid or make
//     two of their own, kept in memory under a cookie and never written to the family's tables or files.
//
// It refuses to run on a family's install: both the database (a marker row in settings) and the data
// folder (demo-mode.json) must say they are the demo, or be empty. Nothing here stores a visitor's IP.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { accountCookie, viewer } from './access.mjs';
import { sessToken } from './api.js';
import { BRAND_NAME, BRAND_TOKENS } from './brand.mjs';
import { migrate, SCHEMA_VERSION } from './schema.mjs';
import { clientIp } from './setup.mjs';
import { createSandboxes } from './demo-sandbox.mjs';
import { readJson, sendJson } from './jsonio.mjs';
import { PAGE_POLICY } from './static.mjs';

export class DemoError extends Error {}

export const DEMO_MARKER = 'kidtube-demo-v1';
// The marker lives in the settings table under a key settings.mjs does not know, so no screen shows it.
export const MARKER_KEY = 'demo_marker';
export const FOLDER_MARKER = 'demo-mode.json';
export const SNAPSHOT_META = 'demo.json';
export const SNAPSHOT_DATABASE = 'demo.sqlite';
export const SNAPSHOT_FILES = 'files';
// Rewritten by every reset, so the running server sees a reset made by scripts/demo-reset.mjs and drops
// every visitor's sandbox with it.
export const RESET_STAMP = 'demo-last-reset.json';
// The folders under DATA_DIR the snapshot fills. Restores add and replace files there, never delete.
export const FILE_ROOTS = ['videos', 'brand'];
export const DEFAULT_RESET_MINUTES = 60;
// The README's install section, from package.json's repository, so a rename never has to touch this file.
// DEMO_INSTALL_URL overrides it (a landing page, say).
export const INSTALL_URL = (() => {
  try {
    const { repository } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return `${String(repository.url || repository).replace(/^git\+/, '').replace(/\.git$/, '')}#install-in-three-lines`;
  } catch { return ''; }
})();

// The accounts behind the one-tap roles. The seed creates them; `go` is where each one lands.
export const DEMO_ROLES = {
  kid: { email: 'juni@kids.invalid', label: 'a kid', name: 'Juni', go: '/#/c/juni' },
  grandma: { email: 'grandma@demo.invalid', label: 'Grandma', name: 'Grandma Rosa', go: '/' },
  parent: { email: 'parent@demo.invalid', label: 'a parent', name: 'Sam', go: '/parents' },
};
// The account hash a password can never match (passwords.mjs wants scrypt:<128 hex>), so the demo
// accounts open only through /api/demo/enter.
export const NO_PASSWORD = 'demo:no-password';

// Every timestamp column, moved forward on each restore by (now - seededAt). 'ms' columns hold epoch
// milliseconds (0 or NULL means unset and stays so); 'iso' columns hold ISO strings. test/demo.test.mjs
// fails when the schema grows a column this list does not place, so a new one is never left behind.
export const TIME_COLUMNS = {
  accounts: { created: 'ms' },
  activity: { ts: 'ms' },
  channels: { created: 'ms' },
  chits: { ts: 'ms' },
  clips: { created: 'ms', opens_at: 'ms', opened_at: 'ms', published: 'iso' },
  comments: { created: 'ms' },
  guest_code_attempts: { ts: 'ms' },
  guest_codes: { created: 'ms', expires: 'ms', redeemed: 'ms', session_expires: 'ms' },
  hits: { ts: 'ms' },
  likes: { created: 'ms' },
  media: { created: 'ms' },
  reactions: { created: 'ms' },
  settings: { updated: 'ms' },
  upload_jobs: { created: 'ms', updated: 'ms', opens_at: 'ms' },
  video_announcements: { created: 'ms', published: 'iso' },
  video_notification_deliveries: { next_attempt: 'ms', sent: 'ms' },
  views: { started: 'ms', updated: 'ms' },
  watch_bonus: { created: 'ms' },
};

// What each refused change says. None of them may mention signing in: the dashboard signs a parent out
// on a 403 that does (public/js/parent/api.js).
const CALM = 'Changes are off in the demo. Everything here resets every hour.';
const REFUSALS = [
  [/^\/api\/signup$/, 'Sign-ups are off in the demo. On your own install, a parent approves everyone who asks to join.'],
  [/^\/api\/login$/, 'The demo has no passwords. Pick one of the "Try it as" buttons instead.'],
  [/^\/api\/upload\//, 'Uploads are off in the demo. On your own install, kids record here and a parent can check each video first.'],
  [/^\/api\/comment/, 'Comments are read-only in the demo, so nothing you write reaches other visitors.'],
  [/^\/api\/(?:guest|admin\/guests)/, 'Guest codes are off in the demo. On your own install, a parent makes one-day codes here.'],
  [/^\/api\/(?:admin\/)?settings\/email-test$|^\/api\/setup\/email/, 'Email is off in the demo, so nothing is ever sent.'],
  [/^\/api\/admin\/kids\/order$/, 'The kids keep their order in the demo. Your own changes to a kid stay on this device.'],
  [/^\/api\/admin\/channels\/[^/]+\/image$/, 'Pictures are off in the demo, like uploads. Try the badge builder instead.'],
];
// Writes a visitor may make: signing out, checking a stored guest pass (read only), likes and reactions.
// Views are answered here without being logged. Everything else that is not a GET is refused.
const OPEN_WRITES = new Set(['/api/logout', '/api/guest/validate', '/api/like', '/api/react']);
// sandbox:new counts new sandboxes per visitor, so clearing cookies in a loop cannot push others out.
const LIMITED = { '/api/like': 40, '/api/react': 40, '/api/demo/enter': 12, 'sandbox:new': 6 };
const LIMIT_WINDOW_MS = 60 * 1000;
// Pages that answer a bare path, as in static.mjs.
const PRETTY = new Set(['/about', '/parents', '/install']);
const BANNER_SCRIPT = '/js/shell/demo-banner.js';
const BANNER_STYLE = '/css/demo.css';
// "Make your own kid's page" (public/js/demo/make.js). Its page lives here, not in public/, so a family's
// install has no such page at all.
export const MAKE_PATH = '/demo/make';
const MAKE_PAGE = new URL('./demo-make.html', import.meta.url);
const ASSET_REFERENCE = /(\b(?:src|href)=)(["'])(\/[^"'?#\s]+\.(?:js|css))\2/g;
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MINUTE = 60000;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// DEMO_MODE=1 (or true, yes, on) turns it on; unset, empty or 0 leaves a normal install. Anything else
// stops the server, so a typo never quietly runs a family's install as a demo or the demo as a family's.
export function demoEnabled(env = process.env) {
  const value = String(env.DEMO_MODE ?? '').trim();
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)?$/i.test(value)) return false;
  throw new DemoError('DEMO_MODE must be 1 to run the public demo, or unset for a normal install.');
}

export function resetMinutes(env = process.env) {
  if (env.DEMO_RESET_MINUTES === undefined || env.DEMO_RESET_MINUTES === '') return DEFAULT_RESET_MINUTES;
  const minutes = Number(env.DEMO_RESET_MINUTES);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new DemoError('DEMO_RESET_MINUTES must be a whole number from 1 to 1440.');
  return minutes;
}

export const snapshotDir = (dataDir, env = process.env) => resolve(env.DEMO_SNAPSHOT_DIR || join(dataDir, 'demo-snapshot'));

// ---------- the guard ----------

const hasTable = (sqlite, name) => !!sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name);

// 'demo' (the marker is there), 'empty' (no accounts, clips or comments yet), or 'family' (anything else).
export function databaseKind(sqlite) {
  if (hasTable(sqlite, 'settings')) {
    const row = sqlite.prepare('SELECT value FROM settings WHERE key=?').get(MARKER_KEY);
    if (row) {
      let value = null;
      try { value = JSON.parse(row.value); } catch {}
      return value === DEMO_MARKER ? 'demo' : 'family';
    }
  }
  for (const table of ['accounts', 'clips', 'comments']) {
    if (hasTable(sqlite, table) && sqlite.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) return 'family';
  }
  return 'empty';
}

// The same question for DATA_DIR: 'demo' (demo-mode.json says so), 'empty' (no videos, pictures,
// uploads in progress or backups), or 'family'.
export function folderKind(dataDir) {
  try {
    if (JSON.parse(readFileSync(join(dataDir, FOLDER_MARKER), 'utf8')).marker === DEMO_MARKER) return 'demo';
  } catch {}
  const entries = dir => { try { return readdirSync(join(dataDir, dir), { recursive: true }); } catch { return []; } };
  if (entries('videos').length || entries('incoming').length || entries('backups').length) return 'family';
  if (entries('brand').some(name => String(name).endsWith('index.json'))) return 'family';
  return 'empty';
}

// Throws unless this database and folder are the demo's (or still empty). Called before any write.
export function guard({ sqlite, dataDir, database = 'the database' }) {
  const db = databaseKind(sqlite), folder = folderKind(dataDir);
  if (db === 'family' || folder === 'family') {
    const what = db === 'family' ? database : dataDir;
    throw new DemoError([
      `DEMO_MODE is on, but ${what} belongs to a family's install, not the demo.`,
      'The demo resets its data every hour, so it never runs on a real family\'s videos.',
      'Give the demo its own folder (DATA_DIR and DATABASE_PATH), or remove DEMO_MODE.',
    ].join('\n'));
  }
  return { database: db, folder };
}

function markFolder(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, FOLDER_MARKER);
  if (!existsSync(file)) writeFileSync(file, JSON.stringify({ marker: DEMO_MARKER, note: 'This folder holds the public demo. It is reset every hour.' }) + '\n', { mode: 0o600 });
}

// ---------- the snapshot ----------

export function readSnapshot(dir) {
  let meta;
  try { meta = JSON.parse(readFileSync(join(dir, SNAPSHOT_META), 'utf8')); }
  catch { throw new DemoError(`No demo snapshot in ${dir}. Run "npm run demo:seed" first (it needs FFmpeg).`); }
  if (meta.marker !== DEMO_MARKER || !Number.isSafeInteger(meta.seededAt) || !meta.files || typeof meta.files !== 'object') {
    throw new DemoError(`${join(dir, SNAPSHOT_META)} is not a demo snapshot. Run "npm run demo:seed" again.`);
  }
  if (meta.schema > SCHEMA_VERSION) throw new DemoError(`The demo snapshot was made by a newer ${BRAND_NAME}. Upgrade, or seed again.`);
  const database = join(dir, SNAPSHOT_DATABASE);
  if (!existsSync(database)) throw new DemoError(`${database} is missing. Run "npm run demo:seed" again.`);
  for (const rel of Object.keys(meta.files)) {
    if (!FILE_ROOTS.some(root => rel.startsWith(root + '/')) || rel.split('/').some(part => part === '..' || !part)) {
      throw new DemoError(`The demo snapshot lists a file outside ${FILE_ROOTS.join(' and ')}: ${rel}`);
    }
  }
  return { dir, meta, database, files: join(dir, SNAPSHOT_FILES) };
}

// The snapshot's database, copied next to the live one and brought to this app's schema, so a demo
// seeded before an upgrade keeps working. Restores read from this copy; the snapshot is never written.
export async function prepareBase(snapshot, dataDir) {
  const base = join(dataDir, 'demo-base.sqlite');
  const temporary = `${base}.${process.pid}.tmp`;
  copyFileSync(snapshot.database, temporary);
  const sqlite = new DatabaseSync(temporary);
  try {
    await migrate(sqlite);
    if (databaseKind(sqlite) !== 'demo') throw new DemoError(`${snapshot.database} has no demo marker. Run "npm run demo:seed" again.`);
  } finally { sqlite.close(); }
  renameSync(temporary, base);
  return base;
}

// Copies every snapshot file that is missing or different into DATA_DIR, each through a temporary
// name so a reader never sees half a file. Returns how many it wrote.
export function syncFiles(snapshot, dataDir) {
  let written = 0;
  for (const [rel, hash] of Object.entries(snapshot.meta.files)) {
    const target = join(dataDir, rel);
    const current = existsSync(target) && statSync(target).isFile() ? sha256(readFileSync(target)) : null;
    if (current === hash) continue;
    const source = join(snapshot.files, rel);
    if (sha256(readFileSync(source)) !== hash) throw new DemoError(`${source} does not match the snapshot. Run "npm run demo:seed" again.`);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${process.pid}.tmp`;
    copyFileSync(source, temporary);
    renameSync(temporary, target);
    written++;
  }
  return written;
}

const quote = name => `"${String(name).replace(/"/g, '""')}"`;

// Replaces every row of the live database with the base copy's, all in one transaction, then moves
// every timestamp forward by `shift` ms. Triggers are set aside inside the transaction (the first
// channel's guard would refuse the delete) and put back before it commits, so no reader ever sees a
// database without them, or half a reset. Synchronous: nothing else runs on this connection meanwhile.
export function restoreDatabase(sqlite, baseFile, { shift = 0 } = {}) {
  sqlite.prepare('ATTACH DATABASE ? AS demo_base').run(baseFile);
  try {
    const marker = sqlite.prepare('SELECT value FROM demo_base.settings WHERE key=?').get(MARKER_KEY);
    if (!marker || JSON.parse(marker.value) !== DEMO_MARKER) throw new DemoError(`${baseFile} has no demo marker.`);
    const tables = schema => sqlite.prepare(`SELECT name FROM ${schema}.sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(row => row.name);
    const columns = (schema, table) => sqlite.prepare(`SELECT name FROM pragma_table_info(?, ?)`).all(table, schema).map(row => row.name);
    const live = tables('main'), base = new Set(tables('demo_base'));
    const triggers = sqlite.prepare("SELECT name, sql FROM main.sqlite_schema WHERE type='trigger' AND sql IS NOT NULL").all();
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.exec('PRAGMA defer_foreign_keys=ON');
      for (const { name } of triggers) sqlite.exec(`DROP TRIGGER main.${quote(name)}`);
      for (const table of live) sqlite.exec(`DELETE FROM main.${quote(table)}`);
      for (const table of live.filter(name => base.has(name))) {
        const shared = columns('demo_base', table);
        const wanted = new Set(columns('main', table));
        const list = shared.filter(name => wanted.has(name)).map(quote).join(', ');
        if (list) sqlite.exec(`INSERT INTO main.${quote(table)} (${list}) SELECT ${list} FROM demo_base.${quote(table)}`);
      }
      if (shift) shiftTimes(sqlite, live, shift);
      for (const { sql } of triggers) sqlite.exec(sql);
      sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } finally {
    sqlite.exec('DETACH DATABASE demo_base');
  }
}

function shiftTimes(sqlite, tables, shift) {
  for (const table of tables) {
    const present = new Set(sqlite.prepare('SELECT name FROM pragma_table_info(?)').all(table).map(row => row.name));
    for (const [column, kind] of Object.entries(TIME_COLUMNS[table] || {})) {
      if (!present.has(column)) continue;
      if (kind === 'ms') {
        sqlite.prepare(`UPDATE ${quote(table)} SET ${quote(column)}=${quote(column)}+? WHERE ${quote(column)}>0`).run(shift);
        continue;
      }
      const update = sqlite.prepare(`UPDATE ${quote(table)} SET ${quote(column)}=? WHERE rowid=?`);
      for (const row of sqlite.prepare(`SELECT rowid AS id, ${quote(column)} AS value FROM ${quote(table)} WHERE ${quote(column)}<>''`).all()) {
        const at = Date.parse(row.value);
        if (Number.isFinite(at)) update.run(new Date(at + shift).toISOString(), row.id);
      }
    }
  }
}

// One full reset: the guard, the files, then the database. Used at boot, by the timer and by
// scripts/demo-reset.mjs. `at` is the moment the family should look freshly seeded.
export function resetDemo({ sqlite, dataDir, snapshot, base, at = Date.now(), database }) {
  guard({ sqlite, dataDir, database });
  markFolder(dataDir);
  const files = syncFiles(snapshot, dataDir);
  const shift = Math.floor((at - snapshot.meta.seededAt) / MINUTE) * MINUTE;
  restoreDatabase(sqlite, base, { shift });
  try { sqlite.exec('PRAGMA wal_checkpoint(PASSIVE)'); } catch {}
  writeFileSync(join(dataDir, RESET_STAMP), JSON.stringify({ at }) + '\n', { mode: 0o600 });
  return { files, shift };
}

// ---------- the running demo ----------

// Returns null when DEMO_MODE is off. Otherwise checks the database and folder before migrate() touches
// anything (throws DemoError for a family's install) and returns the demo, ready for restore() and start().
export function openDemo({ sqlite, dataDir, database, env: processEnv = process.env, now = Date.now }) {
  if (!demoEnabled(processEnv)) return null;
  const minutes = resetMinutes(processEnv);
  guard({ sqlite, dataDir, database });
  const snapshot = readSnapshot(snapshotDir(dataDir, processEnv));
  const installUrl = processEnv.DEMO_INSTALL_URL || INSTALL_URL;
  const salt = randomBytes(32);
  const hits = new Map();
  let base = null, env = null, timer = null, lastReset = 0, nextReset = 0, sandboxes = null;

  const interval = minutes * MINUTE;
  const nextAfter = at => Math.floor(at / interval) * interval + interval;

  // Per visitor, in memory only: the address is keyed through a per-boot secret and never written down.
  function limited(req, pathname) {
    const limit = LIMITED[pathname];
    if (!limit) return false;
    const at = now();
    const key = pathname + '|' + createHmac('sha256', salt).update(clientIp(req)).digest('hex').slice(0, 24);
    if (hits.size > 20000) hits.clear();
    const recent = (hits.get(key) || []).filter(time => time > at - LIMIT_WINDOW_MS);
    recent.push(at);
    hits.set(key, recent);
    return recent.length > limit;
  }

  function reset() {
    const at = now();
    const result = resetDemo({ sqlite, dataDir, snapshot, base, at, database });
    lastReset = at;
    sandboxes?.clearAll();
    return result;
  }

  function schedule() {
    nextReset = nextAfter(now());
    timer = setTimeout(() => {
      try { reset(); } catch (error) { console.error('The demo reset failed; trying again at the next one.', error); }
      schedule();
    }, Math.max(1000, nextReset - now()));
    timer.unref?.();
  }

  // Right after migrate(), before any module reads the database: the base copy and the first reset.
  async function restore() {
    base = await prepareBase(snapshot, dataDir);
    const { files } = reset();
    console.log(`Demo mode: restored the invented family (${files} files copied); resets every ${minutes === 1 ? 'minute' : `${minutes} minutes`}.`);
  }

  // Once the app's env exists (the routes read settings and watch from it): one reset every interval, and
  // the visitors' sandboxes. themeIds lists the splash screens a sandboxed kid may pick.
  function start(appEnv, { themeIds = () => [] } = {}) {
    env = appEnv;
    sandboxes = createSandboxes({
      sqlite, env, themeIds, now, nextReset: () => nextReset, resetStamp: join(dataDir, RESET_STAMP),
      limitNew: req => limited(req, 'sandbox:new'),
    });
    schedule();
  }

  function info() {
    const site = env.settings.all();
    return {
      ok: true, demo: true, family: site.site_name, brand: BRAND_NAME, now: now(), lastReset, nextReset, resetMinutes: minutes,
      installUrl, roles: Object.entries(DEMO_ROLES).map(([id, role]) => ({ id, label: role.label, name: role.name, email: role.email })),
    };
  }

  // The one-tap sign-in: the same session and cookie a real login gets, for a demo account only.
  async function enter(req, res) {
    if (limited(req, '/api/demo/enter')) { req.resume(); return sendJson(res, 429, { ok: false, error: 'Slow down a little.' }); }
    const body = await readJson(req, 4096).catch(() => null);
    const role = body && Object.hasOwn(DEMO_ROLES, body.role) ? DEMO_ROLES[body.role] : null;
    if (!role) return sendJson(res, 400, { ok: false, error: 'Pick a kid, Grandma or a parent.' });
    const account = sqlite.prepare('SELECT email, role, status FROM accounts WHERE email=?').get(role.email);
    if (!account || account.status !== 'approved') return sendJson(res, 503, { ok: false, error: 'The demo is resetting. Try again in a moment.' });
    const t = await sessToken(env, account.email);
    sendJson(res, 200, { ok: true, email: account.email, status: 'approved', role: account.role, t, go: role.go }, { 'Set-Cookie': accountCookie(env, sqlite, account.email) });
  }

  // The feed reports what it watched; the demo says thanks and keeps nothing, so one visitor's
  // watching never shows in "Who watched" or spends a shared kid's daily tape.
  async function watched(req, res, pathname) {
    await readJson(req).catch(() => null);
    const who = viewer(req, sqlite, env);
    if (!who) return sendJson(res, 401, { ok: false, error: 'Log in to view this channel.' });
    const budget = env.watch && who.email ? env.watch.budgetFor(who.email) : null;
    sendJson(res, 200, pathname === '/api/view' ? { ok: true, viewId: 0, budget } : { ok: true, added: 0, budget });
  }

  function refuse(req, res, pathname) {
    req.resume();
    const error = REFUSALS.find(([pattern]) => pattern.test(pathname))?.[1] || CALM;
    sendJson(res, 403, { ok: false, demo: true, error });
  }

  // Runs before every other route. True when the demo answered the request.
  function handle(req, res, pathname) {
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    if (pathname === '/api/demo') {
      if (method !== 'GET') { req.resume(); sendJson(res, 405, { ok: false, error: 'Method not allowed.' }); return true; }
      sendJson(res, 200, info());
      return true;
    }
    if (pathname === '/api/demo/enter') {
      if (method !== 'POST') { req.resume(); sendJson(res, 405, { ok: false, error: 'Method not allowed.' }); return true; }
      enter(req, res).catch(error => { console.error('Demo sign-in failed', error); if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Something went wrong. Try again.' }); });
      return true;
    }
    // A visitor's own sandbox, and the dashboard's kid routes it answers for the demo's parent.
    if (sandboxes?.handle(req, res, pathname, refuse)) return true;
    // An unsubscribe link is a GET that writes; the demo's accounts have no inbox anyway.
    if (pathname === '/api/notifications/unsubscribe') { refuse(req, res, pathname); return true; }
    if (method === 'GET' || method === 'OPTIONS') { sandboxes?.overlay(req, res, pathname); return false; }
    if (pathname === '/api/view' || pathname === '/api/view/beat') {
      watched(req, res, pathname).catch(error => { console.error('Demo view failed', error); if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Something went wrong.' }); });
      return true;
    }
    if (OPEN_WRITES.has(pathname)) {
      if (!limited(req, pathname)) return false;
      req.resume();
      sendJson(res, 429, { ok: false, error: 'Slow down a little.' });
      return true;
    }
    refuse(req, res, pathname);
    return true;
  }

  // The shell's and feed's reads that would note "last seen": visitors share the demo accounts, so
  // one visitor's visit would show up on another's dashboard.
  const quiet = pathname => pathname === '/api/me' || pathname === '/api/clips';

  // Wraps the static sender so every page carries the banner. Only the demo serves these two files'
  // tags; a normal install's pages are exactly as they are on disk.
  function pages(sendFile, publicDir) {
    // The same ?v= stamp static.mjs gives (re-read when the file changes), so both are cached like any asset.
    const stamps = new Map();
    const stamp = path => {
      try {
        const file = join(publicDir, '.' + path), key = String(statSync(file).mtimeMs);
        if (stamps.get(path)?.key !== key) stamps.set(path, { key, value: `${path}?v=${sha256(readFileSync(file)).slice(0, 12)}` });
        return stamps.get(path).value;
      } catch { return path; }
    };
    // The make page, branded and stamped the way static.mjs does a page in public/.
    const makePage = () => readFileSync(MAKE_PAGE, 'utf8')
      .replace(/\{\{brand\.(\w+)\}\}/g, (token, name) => Object.hasOwn(BRAND_TOKENS, name) ? escapeHtml(BRAND_TOKENS[name]) : token)
      .replace(ASSET_REFERENCE, (reference, attribute, quote, path) => `${attribute}${quote}${stamp(path)}${quote}`);
    const served = (req, res, pathname) => {
      const tags = `<link rel="stylesheet" href="${stamp(BANNER_STYLE)}">\n  <script type="module" src="${stamp(BANNER_SCRIPT)}"></script>\n`;
      const make = pathname === MAKE_PATH;
      const target = pathname === '/' ? '/index.html' : PRETTY.has(pathname) ? `${pathname}/index.html` : pathname;
      if (!['GET', 'HEAD'].includes(req.method) || (!make && !target.endsWith('.html'))) return sendFile(req, res, pathname);
      const html = make ? makePage() : sendFile.pageHtml(target);
      if (!html) return sendFile(req, res, pathname);
      const body = Buffer.from(html.replace('</head>', `  ${tags}</head>`));
      const etag = `W/"demo-${sha256(body).slice(0, 16)}"`;
      const headers = {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ETag: etag,
        'Content-Security-Policy': PAGE_POLICY, 'X-Content-Type-Options': 'nosniff',
      };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers).end(); return; }
      res.writeHead(200, { ...headers, 'Content-Length': String(body.length) });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    served.pageHtml = sendFile.pageHtml;
    return served;
  }

  // Settings the demo holds fixed, as if set in the environment: no email, no sign-up form.
  const environment = source => ({ ...source, MAIL_MODE: 'disabled', SIGNUP_MODE: 'closed' });

  return {
    restore, start, reset, handle, quiet, pages, environment, snapshot,
    get nextReset() { return nextReset; },
    close: () => clearTimeout(timer),
  };
}
