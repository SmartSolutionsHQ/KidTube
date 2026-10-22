#!/usr/bin/env node
// Resets the public demo now, instead of waiting for the server's next hourly reset: the seeded snapshot
// (npm run demo:seed) goes back into the demo's database and data folder in one transaction, safe to run
// while the demo is serving. It shares server/demo.mjs's guard, so it refuses a family's install outright.
//
//   DEMO_MODE=1 npm run demo:reset
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { installPaths } from '../server/config.mjs';
import { DemoError, demoEnabled, guard, prepareBase, readSnapshot, resetDemo, snapshotDir } from '../server/demo.mjs';
import { migrate } from '../server/schema.mjs';

async function main() {
  if (!demoEnabled()) throw new DemoError('Set DEMO_MODE=1 to reset the demo. This script only ever works on the demo.');
  const { database, dataDir } = installPaths();
  const snapshot = readSnapshot(snapshotDir(dataDir));
  if (!existsSync(database)) throw new DemoError(`No database at ${database}. Start the demo once (DEMO_MODE=1 npm start); it restores the snapshot itself.`);
  const sqlite = new DatabaseSync(database, { timeout: 5000 });
  try {
    sqlite.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    guard({ sqlite, dataDir, database });
    await migrate(sqlite);
    const base = await prepareBase(snapshot, dataDir);
    const { files } = resetDemo({ sqlite, dataDir, snapshot, base, database });
    console.log(`The demo is reset: the invented family is back as seeded (${files} files copied).`);
  } finally { sqlite.close(); }
}

main().catch(error => {
  console.error(error instanceof DemoError ? error.message : error);
  process.exit(1);
});
