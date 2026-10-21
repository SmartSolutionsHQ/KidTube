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
    // Accounts created by the original Worker had no role column.
    addColumn(sqlite, 'accounts', 'role', "TEXT NOT NULL DEFAULT ''");
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
    addColumn(sqlite, 'clips', 'channel_id', 'INTEGER REFERENCES channels(id)');
    addColumn(sqlite, 'clips', 'poster', "TEXT DEFAULT ''");
    addColumn(sqlite, 'clips', 'review', "TEXT NOT NULL DEFAULT 'live' CHECK (review IN ('live','pending','rejected'))");
    addColumn(sqlite, 'upload_jobs', 'channel_id', 'INTEGER REFERENCES channels(id)');
    addColumn(sqlite, 'accounts', 'channel_id', 'INTEGER REFERENCES channels(id)');
    addColumn(sqlite, 'comments', 'hidden', 'INTEGER NOT NULL DEFAULT 0');
    sqlite.exec(`CREATE INDEX IF NOT EXISTS clips_by_channel ON clips(channel_id, position);
    CREATE TRIGGER IF NOT EXISTS clips_delete_cascade AFTER DELETE ON clips BEGIN
      DELETE FROM likes WHERE clip_id=OLD.id;
      DELETE FROM comments WHERE clip_id=OLD.id;
      DELETE FROM views WHERE clip_id=OLD.id;
    END;`);
    // Existing videos belonged to the install's one channel; give it a row the parent can rename.
    if (sqlite.prepare('SELECT 1 FROM clips WHERE channel_id IS NULL LIMIT 1').get()) {
      const first = sqlite.prepare('SELECT id FROM channels ORDER BY position, id LIMIT 1').get()
        ?? { id: sqlite.prepare("INSERT INTO channels (slug,name,created) VALUES ('main','Main channel',?)").run(Date.now()).lastInsertRowid };
      sqlite.prepare('UPDATE clips SET channel_id=? WHERE channel_id IS NULL').run(first.id);
    }
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

function addColumn(sqlite, table, column, definition) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(({ name }) => name === column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function initializeSchema(sqlite) {
  for (;;) {
    // Read the version inside the write lock so two processes never run the same step.
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const version = sqlite.prepare('PRAGMA user_version').get().user_version;
      if (version > SCHEMA_VERSION) throw new Error(`Database schema v${version} is newer than this build supports (v${SCHEMA_VERSION}). Install the newer release.`);
      if (version === SCHEMA_VERSION) { sqlite.exec('COMMIT'); return version; }
      MIGRATIONS[version](sqlite);
      sqlite.exec(`PRAGMA user_version=${version + 1}`);
      sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }
}
