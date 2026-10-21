import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initializeSchema, SCHEMA_VERSION } from '../server/schema.mjs';

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

function v0Database(t, schema = V0_SCHEMA) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO accounts (email,first,last,salt,hash,status,created)
      VALUES ('parent@example.com','Parent','Owner','salt','hash','approved',1);
    INSERT INTO clips (id,title,src,position,created,hidden) VALUES
      ('clip-a','First','/api/video/a',1,1,0), ('clip-b','Second','/api/video/b',2,2,0), ('clip-c','Hidden','/api/video/c',3,3,1);
    INSERT INTO likes VALUES ('clip-a','parent@example.com',1);
    INSERT INTO comments VALUES ('comment-1','clip-a','parent@example.com','Parent O.','Nice!',1);`);
  return sqlite;
}

const tables = sqlite => sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(row => row.name);

test('upgrades a pre-migration database in place and keeps its data', t => {
  const sqlite = v0Database(t);
  assert.equal(initializeSchema(sqlite), SCHEMA_VERSION);
  assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM clips').get().n, 3);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM likes').get().n, 1);
  assert.equal(sqlite.prepare('SELECT body FROM comments').get().body, 'Nice!');
  for (const table of ['chits', 'upload_jobs', 'video_announcements']) assert.ok(tables(sqlite).includes(table), table);
});

test('rerunning the ladder, even from a reset version, changes nothing', t => {
  const sqlite = v0Database(t);
  initializeSchema(sqlite);
  const before = { tables: tables(sqlite), clips: sqlite.prepare('SELECT * FROM clips ORDER BY id').all() };
  assert.equal(initializeSchema(sqlite), SCHEMA_VERSION);
  sqlite.exec('PRAGMA user_version=0');
  initializeSchema(sqlite);
  assert.deepEqual({ tables: tables(sqlite), clips: sqlite.prepare('SELECT * FROM clips ORDER BY id').all() }, before);
});

test('adds the role column to accounts created by the original Worker', t => {
  const sqlite = v0Database(t, V0_SCHEMA.replace("\n    role TEXT NOT NULL DEFAULT '',", ''));
  const columns = () => sqlite.prepare('PRAGMA table_info(accounts)').all().map(row => row.name);
  assert.ok(!columns().includes('role'));
  initializeSchema(sqlite);
  assert.deepEqual(sqlite.prepare('SELECT email, role FROM accounts').all().map(row => ({ ...row })),
    [{ email: 'parent@example.com', role: '' }]);
});

test('a fresh database gets every table, and a newer one is refused untouched', t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  initializeSchema(sqlite);
  assert.ok(tables(sqlite).includes('accounts'));
  sqlite.exec(`PRAGMA user_version=${SCHEMA_VERSION + 1}`);
  assert.throws(() => initializeSchema(sqlite), /newer than this build/);
  assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION + 1);
});
