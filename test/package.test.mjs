import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { ROOT } from './helpers.mjs';

// npm sits next to node in every official Node install (and in CI's setup-node).
const npm = [join(dirname(process.execPath), 'npm'), 'npm'].find(path => path === 'npm' || existsSync(path));

test('the package ships the app and the family docs, never maintainer folders or private data', () => {
  const run = spawnSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const files = JSON.parse(run.stdout)[0].files.map(file => file.path);
  for (const path of [
    'package.json', 'README.md', 'LICENSE', 'SECURITY.md', 'CHANGELOG.md', 'Dockerfile', 'compose.yaml',
    'bin/create-kidtube.mjs', 'server/index.mjs', 'server/pwa.mjs', 'server/pwa-worker.js',
    'public/index.html', 'public/offline.html', 'public/install/index.html', 'public/js/shell/pwa.js',
    'public/assets/icons/icon-512.png', 'public/assets/icons/apple-touch-icon.png',
    'docs/INSTALL.md', 'docs/UPGRADING.md', 'docs/VERIFY.md', 'docs/RENAMING.md', 'docs/THEMES.md',
    'scripts/setup.mjs', 'scripts/backup.mjs',
  ]) assert.ok(files.includes(path), `the package has ${path}`);
  const leaked = files.filter(path => /^(?:docs\/(?:plan|superpowers)|scripts\/dev|\.github|data|backups|node_modules)\//.test(path)
    || /(?:^|\/)\.env$|\.sqlite(?:-wal|-shm)?$|(?:^|\/)secret$|(?:^|\/)setup-token$/.test(path));
  assert.deepEqual(leaked, [], 'no maintainer folders, secrets or family data');
  assert.ok(files.every(path => !path.startsWith('docs/') || /^docs\/[^/]+\.md$/.test(path) || path.startsWith('docs/images/')),
    'docs ships its top-level guides (and their images) only');
});
