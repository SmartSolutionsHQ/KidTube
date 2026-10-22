import { randomBytes } from 'node:crypto';
import { accessSync, chmodSync, constants, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// First boot needs no .env: the data folder, the signing secret and the database are made here.
// Every problem is an InstallError with a message a parent can act on; index.mjs prints it and exits.
export class InstallError extends Error {}

export const DEFAULT_DATABASE = 'data/kidtube.sqlite';
const MIN_SECRET = 32;

// DATABASE_PATH names the database; DATA_DIR (or the database's folder) holds everything else.
export function installPaths(env = process.env) {
  const database = resolve(env.DATABASE_PATH || DEFAULT_DATABASE);
  const dataDir = resolve(env.DATA_DIR || dirname(database));
  return { database, dataDir, secretFile: join(dataDir, 'secret'), tokenFile: join(dataDir, 'setup-token') };
}

// The exact command that gives this process its folder back, for the common Docker bind-mount trap.
// In Docker, dir is the path inside the container; compose.yaml passes the host side as HOST_DATA
// (a folder such as ./data, or the name of a volume, which has no folder to chown on the computer).
export function ownershipFix(dir, env = process.env) {
  const user = typeof process.getuid === 'function' ? `${process.getuid()}:${process.getgid()}` : '1000:1000';
  const host = env.HOST_DATA;
  if (!host) return `sudo chown -R ${user} "${dir}"`;
  if (host.startsWith('.')) return `sudo chown -R ${user} "${host}" (in the folder with compose.yaml)`;
  if (/[/\\]/.test(host)) return `sudo chown -R ${user} "${host}"`;
  // compose.yaml drops every capability, so the one-off root container takes back just what chown needs.
  return `docker compose run --rm --user root --cap-add CHOWN --cap-add DAC_OVERRIDE --entrypoint chown kidtube -R ${user} ${dir}`;
}

function ensureDataDir(dir) {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    accessSync(dir, constants.W_OK | constants.X_OK);
  } catch (error) {
    if (!['EACCES', 'EPERM', 'EROFS'].includes(error.code)) throw error;
    throw new InstallError([
      `The data folder ${dir} is not writable by this app.`,
      'Give it to the user the app runs as, then start again:',
      `  ${ownershipFix(dir)}`,
    ].join('\n'));
  }
}

// SIGN_SECRET from the environment wins. Otherwise DATA_DIR/secret is created once (0600, never
// overwritten) and read on every later start.
function loadSecret(env, secretFile) {
  if (env.SIGN_SECRET) {
    if (env.SIGN_SECRET.length < MIN_SECRET) throw new InstallError(`SIGN_SECRET must have at least ${MIN_SECRET} characters.`);
    return { secret: env.SIGN_SECRET, source: 'env' };
  }
  try {
    writeFileSync(secretFile, randomBytes(48).toString('hex') + '\n', { flag: 'wx', mode: 0o600 });
    return { secret: readSecret(secretFile), source: 'created' };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return { secret: readSecret(secretFile), source: 'file' };
}

function readSecret(file) {
  const info = statSync(file);
  // A secret other users can read could forge sessions; tighten it rather than refuse to start.
  if (process.platform !== 'win32' && info.mode & 0o077) chmodSync(file, 0o600);
  const secret = readFileSync(file, 'utf8').trim();
  if (secret.length < MIN_SECRET) throw new InstallError(`${file} must hold at least ${MIN_SECRET} characters. Delete it to make a new one (everyone signs in again).`);
  return secret;
}

// Saved and environment values follow one rule: a production install must use HTTPS.
export function checkSiteUrl(value, env = process.env) {
  if (value && env.NODE_ENV === 'production' && !value.startsWith('https:')) {
    throw new InstallError('Production requires an https:// site address.');
  }
}

export function prepareInstall(env = process.env) {
  const paths = installPaths(env);
  ensureDataDir(paths.dataDir);
  if (dirname(paths.database) !== paths.dataDir) ensureDataDir(dirname(paths.database));
  return { ...paths, ...loadSecret(env, paths.secretFile) };
}
