// Initialize all shared tables before the first account or upload exists.
export function initializeSchema(sqlite) {
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
    CREATE TABLE IF NOT EXISTS media_chunks (id TEXT, seq INTEGER, bytes BLOB, PRIMARY KEY (id,seq));`);
}
