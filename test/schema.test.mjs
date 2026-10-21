import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRAND_NAME } from '../server/brand.mjs';
import { migrate, SCHEMA_VERSION } from '../server/schema.mjs';

// A frozen copy of the tables a pre-migration install had (user_version 0), so later
// edits to the ladder cannot quietly change what an old install looks like.
const V0_SCHEMA = `CREATE TABLE accounts (
    email TEXT PRIMARY KEY, first TEXT NOT NULL, last TEXT NOT NULL,
    salt TEXT NOT NULL, hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    role TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
  CREATE TABLE clips (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, src TEXT NOT NULL,
    poster TEXT DEFAULT '', kind TEXT DEFAULT 'video', blurb TEXT DEFAULT '',
    published TEXT DEFAULT '', duration REAL DEFAULT 0,
    position INTEGER NOT NULL, created INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE likes (clip_id TEXT NOT NULL, email TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (clip_id,email));
  CREATE TABLE comments (id TEXT PRIMARY KEY, clip_id TEXT NOT NULL,
    email TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE media_chunks (id TEXT, seq INTEGER, bytes BLOB, PRIMARY KEY (id,seq));
  CREATE TABLE hits (ip TEXT, ts INTEGER);
  CREATE TABLE guest_codes (code_hash TEXT PRIMARY KEY, creator TEXT NOT NULL, created INTEGER NOT NULL,
    expires INTEGER NOT NULL, redeemed INTEGER, token_hash TEXT, session_expires INTEGER);
  CREATE TABLE guest_code_attempts (ip TEXT, ts INTEGER);
  CREATE TABLE upload_jobs (id TEXT PRIMARY KEY, email TEXT NOT NULL, title TEXT NOT NULL, size INTEGER NOT NULL,
    status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, clip_id TEXT,
    error TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL);
  CREATE TABLE video_announcements (clip_id TEXT PRIMARY KEY, title TEXT NOT NULL, blurb TEXT NOT NULL,
    duration REAL NOT NULL, published TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE video_notification_deliveries (
    clip_id TEXT NOT NULL REFERENCES video_announcements(clip_id), email TEXT NOT NULL,
    delivery_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL,
    sent INTEGER, message_id TEXT, last_error TEXT, PRIMARY KEY (clip_id, email));
  CREATE TABLE video_email_preferences (email TEXT PRIMARY KEY, unsubscribed INTEGER NOT NULL);`;

function v0Database(t, schema = V0_SCHEMA, file = ':memory:') {
  const sqlite = new DatabaseSync(file);
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO accounts (email,first,last,salt,hash,status,role,created)
      VALUES ('parent@example.com','Parent','Owner','salt','hash','approved','super',1);
    INSERT INTO clips (id,title,src,position,created,hidden) VALUES
      ('clip-a','First','/api/video/a',1,1,0), ('clip-b','Second','/api/video/b',2,2,0), ('clip-c','Hidden','/api/video/c',3,3,1);
    INSERT INTO likes VALUES ('clip-a','parent@example.com',1);
    INSERT INTO comments VALUES ('comment-1','clip-a','parent@example.com','Parent O.','Nice!',1);`);
  return sqlite;
}

const tables = sqlite => sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(row => row.name);
const rows = (sqlite, sql) => sqlite.prepare(sql).all().map(row => ({ ...row }));

test('upgrades a pre-migration database in place and keeps its data', async t => {
  const sqlite = v0Database(t);
  assert.equal(await migrate(sqlite), SCHEMA_VERSION);
  assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM clips').get().n, 3);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM likes').get().n, 1);
  assert.equal(sqlite.prepare('SELECT body FROM comments').get().body, 'Nice!');
  for (const table of ['chits', 'upload_jobs', 'video_announcements', 'settings', 'channels', 'views', 'activity']) {
    assert.ok(tables(sqlite).includes(table), table);
  }
});

test('every existing clip lands approved in the default channel', async t => {
  const sqlite = v0Database(t);
  await migrate(sqlite);
  assert.deepEqual(rows(sqlite, 'SELECT id, slug, name, review_uploads FROM channels'),
    [{ id: 1, slug: 'main', name: 'Main channel', review_uploads: 1 }]);
  assert.deepEqual(rows(sqlite, 'SELECT id, channel_id, review, hidden FROM clips ORDER BY id'), [
    { id: 'clip-a', channel_id: 1, review: 'approved', hidden: 0 },
    { id: 'clip-b', channel_id: 1, review: 'approved', hidden: 0 },
    { id: 'clip-c', channel_id: 1, review: 'approved', hidden: 1 },
  ]);
  assert.equal(sqlite.prepare('SELECT hidden FROM comments').get().hidden, 0);
  assert.throws(() => sqlite.prepare("UPDATE clips SET review='live'").run(), /CHECK constraint/);
});

test('an existing install skips the setup wizard and keeps comments open', async t => {
  const sqlite = v0Database(t);
  await migrate(sqlite);
  assert.deepEqual(rows(sqlite, 'SELECT key, value FROM settings ORDER BY key'),
    [{ key: 'comments_default', value: '"open"' }, { key: 'setup_complete', value: 'true' }]);
});

test('channel 1 is permanent and deleting a clip deletes its likes, comments and views', async t => {
  const sqlite = v0Database(t);
  await migrate(sqlite);
  sqlite.exec("INSERT INTO channels (id,slug,name,created) VALUES (2,'ben','Ben',0)");
  assert.throws(() => sqlite.exec('DELETE FROM channels WHERE id=1'), /first channel cannot be deleted/);
  sqlite.exec('DELETE FROM channels WHERE id=2');
  sqlite.exec("INSERT INTO views VALUES ('clip-a','parent@example.com',1), ('clip-b','parent@example.com',1)");
  sqlite.exec("DELETE FROM clips WHERE id='clip-a'");
  const left = table => sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  assert.deepEqual([left('likes'), left('comments'), left('views')], [0, 0, 1]);
});

test('rerunning the ladder, even from a reset version, changes nothing', async t => {
  const sqlite = v0Database(t);
  await migrate(sqlite);
  const snapshot = () => ({
    tables: tables(sqlite), clips: rows(sqlite, 'SELECT * FROM clips ORDER BY id'),
    channels: rows(sqlite, 'SELECT id, slug FROM channels'), settings: rows(sqlite, 'SELECT key, value FROM settings ORDER BY key'),
  });
  const before = snapshot();
  assert.equal(await migrate(sqlite), SCHEMA_VERSION);
  sqlite.exec('PRAGMA user_version=0');
  await migrate(sqlite);
  assert.deepEqual(snapshot(), before);
});

test('copes with a TanzenTube-shaped database that lacks newer columns', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE accounts (email TEXT PRIMARY KEY, first TEXT NOT NULL, last TEXT NOT NULL,
      salt TEXT NOT NULL, hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created INTEGER NOT NULL);
    CREATE TABLE clips (id TEXT PRIMARY KEY, title TEXT NOT NULL, src TEXT NOT NULL);
    INSERT INTO accounts VALUES ('parent@example.com','Parent','Owner','salt','hash','approved',1);
    INSERT INTO clips VALUES ('old','Old clip','/uploads/old.mp4');`);
  await migrate(sqlite);
  assert.deepEqual(rows(sqlite, 'SELECT email, role, channel_id FROM accounts'), [{ email: 'parent@example.com', role: '', channel_id: null }]);
  assert.deepEqual(rows(sqlite, 'SELECT id, hidden, poster, position, channel_id, review FROM clips'),
    [{ id: 'old', hidden: 0, poster: '', position: 0, channel_id: 1, review: 'approved' }]);
});

test('backs up an existing install before upgrading it, and only then', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'kidtube-migrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sqlite = v0Database(t, V0_SCHEMA, join(dir, 'kidtube.sqlite'));
  await migrate(sqlite, { dataDir: dir });
  const backups = readdirSync(join(dir, 'backups'));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^pre-migrate-v0-\d{4}-\d\d-\d\dT[\d-]+Z\.sqlite$/);
  assert.equal(statSync(join(dir, 'backups', backups[0])).mode & 0o777, 0o600);
  const copy = new DatabaseSync(join(dir, 'backups', backups[0]), { readOnly: true });
  try {
    assert.equal(copy.prepare('PRAGMA user_version').get().user_version, 0);
    assert.equal(copy.prepare('SELECT COUNT(*) n FROM clips').get().n, 3);
  } finally { copy.close(); }
  await migrate(sqlite, { dataDir: dir });
  assert.equal(readdirSync(join(dir, 'backups')).length, 1, 'an up-to-date database is not copied again');

  const fresh = new DatabaseSync(join(dir, 'fresh.sqlite'));
  t.after(() => fresh.close());
  await migrate(fresh, { dataDir: join(dir, 'fresh-data') });
  assert.equal(existsSync(join(dir, 'fresh-data')), false, 'a brand-new database needs no backup');
});

test('a fresh database gets channel 1 and every table, and a newer one is refused untouched', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  await migrate(sqlite);
  assert.ok(tables(sqlite).includes('accounts'));
  assert.deepEqual(rows(sqlite, 'SELECT id, slug FROM channels'), [{ id: 1, slug: 'main' }]);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM settings').get().n, 0, 'a new install still runs setup');
  sqlite.exec(`PRAGMA user_version=${SCHEMA_VERSION + 1}`);
  await assert.rejects(migrate(sqlite), new RegExp(`^Error: Database is newer than this app. Upgrade ${BRAND_NAME}.$`));
  assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION + 1);
});
