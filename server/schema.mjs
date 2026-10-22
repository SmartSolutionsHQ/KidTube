import { backup } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_NAME } from './brand.mjs';

// Every table lives here. Each step upgrades a database from PRAGMA user_version N to N+1,
// and is safe to rerun so a half-known database (an old install, an import) still lands cleanly.
const MIGRATIONS = [
  // v1: the tables the app created on the fly before migrations existed.
  sqlite => {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS accounts (
      email TEXT PRIMARY KEY, first TEXT NOT NULL, last TEXT NOT NULL,
      salt TEXT NOT NULL, hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      role TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS clips (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, src TEXT NOT NULL,
      poster TEXT DEFAULT '', kind TEXT DEFAULT 'video', blurb TEXT DEFAULT '',
      published TEXT DEFAULT '', duration REAL DEFAULT 0,
      position INTEGER NOT NULL, created INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS likes (clip_id TEXT NOT NULL, email TEXT NOT NULL,
      created INTEGER NOT NULL, PRIMARY KEY (clip_id,email));
    CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, clip_id TEXT NOT NULL,
      email TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS media_chunks (id TEXT, seq INTEGER, bytes BLOB, PRIMARY KEY (id,seq));
    CREATE TABLE IF NOT EXISTS hits (ip TEXT, ts INTEGER);
    CREATE TABLE IF NOT EXISTS chits (ip TEXT, ts INTEGER);
    CREATE TABLE IF NOT EXISTS guest_codes (
      code_hash TEXT PRIMARY KEY, creator TEXT NOT NULL, created INTEGER NOT NULL,
      expires INTEGER NOT NULL, redeemed INTEGER, token_hash TEXT, session_expires INTEGER);
    CREATE TABLE IF NOT EXISTS guest_code_attempts (ip TEXT, ts INTEGER);
    CREATE TABLE IF NOT EXISTS upload_jobs (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, title TEXT NOT NULL, size INTEGER NOT NULL,
      status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, clip_id TEXT,
      error TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS video_announcements (
      clip_id TEXT PRIMARY KEY, title TEXT NOT NULL, blurb TEXT NOT NULL,
      duration REAL NOT NULL, published TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS video_notification_deliveries (
      clip_id TEXT NOT NULL REFERENCES video_announcements(clip_id), email TEXT NOT NULL,
      delivery_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL,
      sent INTEGER, message_id TEXT, last_error TEXT,
      PRIMARY KEY (clip_id, email));
    CREATE INDEX IF NOT EXISTS video_notification_pending ON video_notification_deliveries(status, next_attempt);
    CREATE TABLE IF NOT EXISTS video_email_preferences (email TEXT PRIMARY KEY, unsubscribed INTEGER NOT NULL);`);
    // Databases from the original Worker (and TanzenTube) may lack columns added since.
    ensureColumn(sqlite, 'accounts', 'role', "TEXT NOT NULL DEFAULT ''");
    for (const [column, definition] of [['poster', "TEXT DEFAULT ''"], ['kind', "TEXT DEFAULT 'video'"], ['blurb', "TEXT DEFAULT ''"],
      ['published', "TEXT DEFAULT ''"], ['duration', 'REAL DEFAULT 0'], ['position', 'INTEGER NOT NULL DEFAULT 0'],
      ['created', 'INTEGER NOT NULL DEFAULT 0'], ['hidden', 'INTEGER NOT NULL DEFAULT 0']]) {
      ensureColumn(sqlite, 'clips', column, definition);
    }
  },

  // v2: settings, a channel per kid, review states, moderation, views and activity.
  sqlite => {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      kicker TEXT NOT NULL DEFAULT '', tagline TEXT NOT NULL DEFAULT '', accent TEXT NOT NULL DEFAULT '',
      theme_id TEXT NOT NULL DEFAULT '', badge TEXT NOT NULL DEFAULT '{}', logo_rev INTEGER NOT NULL DEFAULT 0,
      review_uploads INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS views (clip_id TEXT NOT NULL, viewer TEXT NOT NULL, ts INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS views_by_clip ON views(clip_id, viewer, ts);
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}');
    CREATE INDEX IF NOT EXISTS activity_by_time ON activity(ts);`);
    // Channel 1 always exists, so link columns default to it. SQLite will not add a REFERENCES column
    // with a non-NULL default while foreign keys are on, so the app checks these links itself.
    sqlite.prepare("INSERT OR IGNORE INTO channels (id,slug,name,created) VALUES (1,'main','Main channel',?)").run(Date.now());
    ensureColumn(sqlite, 'clips', 'channel_id', 'INTEGER NOT NULL DEFAULT 1');
    ensureColumn(sqlite, 'clips', 'review', "TEXT NOT NULL DEFAULT 'approved' CHECK (review IN ('pending','approved','rejected'))");
    ensureColumn(sqlite, 'upload_jobs', 'channel_id', 'INTEGER NOT NULL DEFAULT 1');
    ensureColumn(sqlite, 'video_announcements', 'channel_id', 'INTEGER NOT NULL DEFAULT 1');
    ensureColumn(sqlite, 'accounts', 'channel_id', 'INTEGER');
    ensureColumn(sqlite, 'comments', 'hidden', 'INTEGER NOT NULL DEFAULT 0');
    sqlite.exec(`CREATE INDEX IF NOT EXISTS clips_by_channel ON clips(channel_id, position);
    CREATE TRIGGER IF NOT EXISTS clips_delete_cascade AFTER DELETE ON clips BEGIN
      DELETE FROM likes WHERE clip_id=OLD.id;
      DELETE FROM comments WHERE clip_id=OLD.id;
      DELETE FROM views WHERE clip_id=OLD.id;
    END;
    CREATE TRIGGER IF NOT EXISTS channels_keep_first BEFORE DELETE ON channels WHEN OLD.id=1 BEGIN
      SELECT RAISE(ABORT, 'The first channel cannot be deleted. Rename it instead.');
    END;`);
    // An install that already has an owner keeps working as before: no setup wizard, comments stay open.
    if (sqlite.prepare("SELECT 1 FROM accounts WHERE role='super' LIMIT 1").get()) {
      const keep = sqlite.prepare('INSERT OR IGNORE INTO settings (key,value,updated) VALUES (?,?,?)');
      keep.run('setup_complete', 'true', Date.now());
      keep.run('comments_default', '"open"', Date.now());
    }
  },

  // v3: a guest pass may be limited to one kid's channel (NULL = the whole family).
  sqlite => {
    ensureColumn(sqlite, 'guest_codes', 'channel_id', 'INTEGER');
  },

  // v4: time capsules, reactions, and the watch log behind daily tape budgets and "who watched".
  sqlite => {
    // A clip is sealed while opens_at is in the future; nothing stores "sealed" as a flag.
    ensureColumn(sqlite, 'clips', 'opens_at', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn(sqlite, 'clips', 'opened_at', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn(sqlite, 'clips', 'sealed_by', "TEXT NOT NULL DEFAULT ''");
    ensureColumn(sqlite, 'clips', 'capsule_note', "TEXT NOT NULL DEFAULT ''");
    // A seal chosen at upload rides on the job until the clip is published.
    ensureColumn(sqlite, 'upload_jobs', 'opens_at', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn(sqlite, 'upload_jobs', 'capsule_note', "TEXT NOT NULL DEFAULT ''");
    ensureColumn(sqlite, 'video_announcements', 'capsule_note', 'TEXT');
    ensureColumn(sqlite, 'accounts', 'watch_budget_minutes', 'INTEGER NOT NULL DEFAULT 0');
    // The v2 views table was never written; its shape could not hold watch time.
    if (!sqlite.prepare('PRAGMA table_info(views)').all().some(({ name }) => name === 'started')) sqlite.exec('DROP TABLE IF EXISTS views');
    sqlite.exec(`CREATE TABLE IF NOT EXISTS reactions (clip_id TEXT NOT NULL, email TEXT NOT NULL, kind TEXT NOT NULL,
      created INTEGER NOT NULL, PRIMARY KEY (clip_id, email, kind));
    CREATE TABLE IF NOT EXISTS views (id INTEGER PRIMARY KEY, clip_id TEXT NOT NULL, channel_id INTEGER NOT NULL,
      viewer TEXT NOT NULL, started INTEGER NOT NULL, updated INTEGER NOT NULL,
      seconds INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS views_by_viewer_day ON views(viewer, started);
    CREATE INDEX IF NOT EXISTS views_by_clip ON views(clip_id, started);
    CREATE INDEX IF NOT EXISTS views_by_time ON views(started);
    CREATE TABLE IF NOT EXISTS watch_bonus (email TEXT NOT NULL, day TEXT NOT NULL, minutes INTEGER NOT NULL,
      actor TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS watch_bonus_by_day ON watch_bonus(email, day);
    DROP TRIGGER IF EXISTS clips_delete_cascade;
    CREATE TRIGGER clips_delete_cascade AFTER DELETE ON clips BEGIN
      DELETE FROM likes WHERE clip_id=OLD.id;
      DELETE FROM comments WHERE clip_id=OLD.id;
      DELETE FROM views WHERE clip_id=OLD.id;
      DELETE FROM reactions WHERE clip_id=OLD.id;
    END;`);
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

function ensureColumn(sqlite, table, column, definition) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(({ name }) => name === column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const version = sqlite => sqlite.prepare('PRAGMA user_version').get().user_version;
const tooNew = () => new Error(`Database is newer than this app. Upgrade ${BRAND_NAME}.`);

// Upgrades the database in place. With dataDir, an existing install is first copied to
// <dataDir>/backups/pre-migrate-v<from>-<time>.sqlite so a failed upgrade can be undone by hand.
export async function migrate(sqlite, { dataDir } = {}) {
  const from = version(sqlite);
  if (from > SCHEMA_VERSION) throw tooNew();
  if (from === SCHEMA_VERSION) return from;
  if (dataDir && sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' LIMIT 1").get()) {
    const folder = join(dataDir, 'backups');
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const file = join(folder, `pre-migrate-v${from}-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
    await backup(sqlite, file);
    chmodSync(file, 0o600);
  }
  for (;;) {
    // Read the version inside the write lock so two processes never run the same step.
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const current = version(sqlite);
      if (current > SCHEMA_VERSION) throw tooNew();
      if (current === SCHEMA_VERSION) { sqlite.exec('COMMIT'); return current; }
      MIGRATIONS[current](sqlite);
      sqlite.exec(`PRAGMA user_version=${current + 1}`);
      sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }
}
