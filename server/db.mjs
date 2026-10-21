import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(file, { allowEmpty = false } = {}) {
  if (file !== ':memory:' && !existsSync(file) && !allowEmpty) {
    throw new Error(`Database missing at ${file}; run npm run setup before starting`);
  }
  const created = file !== ':memory:' && !existsSync(file);
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const sqlite = new DatabaseSync(file, { timeout: 5000 });
  // A new database holds password hashes, so only this user may read it.
  if (created) chmodSync(file, 0o600);
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');

  // The former Worker uses D1's prepare().bind().run() interface for all SQL.
  const DB = {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async run() {
              const stmt = sqlite.prepare(sql);
              const values = params.map(value => value instanceof ArrayBuffer ? Buffer.from(value) : value);
              if (/^\s*(?:SELECT|WITH|PRAGMA)\b/i.test(sql)) {
                return { success: true, results: stmt.all(...values) };
              }
              const result = stmt.run(...values);
              return { success: true, results: [], meta: { changes: Number(result.changes) } };
            },
          };
        },
      };
    },
  };
  return { sqlite, DB };
}

