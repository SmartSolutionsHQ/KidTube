import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Splash themes are folders under public/themes. Only first-party folders shipped with the app are
// listed; nothing is fetched from elsewhere. See docs/THEMES.md for the contract.
export const CONTRACT = 1;
export const FALLBACK = 'glass-gate';
// The launch set keeps this order in galleries; themes added later follow by name.
export const LAUNCH_ORDER = ['ember-tape', 'glass-gate', 'creature-feature', 'blueprint-workshop', 'arcade-crt', 'comic-pow'];
export const REQUIRED_FILES = ['manifest.json', 'splash.css', 'splash.js', 'preview.webp'];
export const MAX_FOLDER_BYTES = 300 * 1024;
// Feed variables a theme may restyle. Values are a #rrggbb colour, a px length or the word "accent".
export const FEED_VARS = ['--tz-flare', '--tz-paper', '--tz-ink', '--tz-surface', '--tz-dim', '--tz-rad-frame', '--tz-rad-sheet'];
const FEED_VALUE = /^(?:#[0-9a-f]{6}|\d{1,3}px|accent)$/i;
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-f]{6}$/i;
const MODES = ['gate', 'channel'];
const MANIFEST_KEYS = ['contract', 'id', 'name', 'description', 'author', 'version', 'tags', 'weight', 'modes', 'sound', 'defaultAccent', 'accents', 'feed', 'endingCopy'];
// pause is required; unlock (a time capsule opening) and ending (end of tape) are optional.
const ACCENT_KEYS = ['pause', 'unlock', 'ending'];
export const ENDING_COPY_MAX = 40;
const HASH_LENGTH = 12;

const isText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

// Returns a list of problems; an empty list means the manifest is valid for the folder it sits in.
export function validateManifest(manifest, folder) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['manifest must be a JSON object'];
  for (const key of Object.keys(manifest)) if (!MANIFEST_KEYS.includes(key)) errors.push(`unknown field ${key}`);
  if (manifest.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (typeof manifest.id !== 'string' || !ID.test(manifest.id) || manifest.id.length > 40) errors.push('id must be lowercase-kebab, up to 40 characters');
  else if (folder !== undefined && manifest.id !== folder) errors.push(`id ${manifest.id} does not match folder ${folder}`);
  if (!isText(manifest.name, 40)) errors.push('name must be 1 to 40 characters');
  if (!isText(manifest.description, 200)) errors.push('description must be 1 to 200 characters');
  if (!isText(manifest.author, 60)) errors.push('author must be 1 to 60 characters');
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) errors.push('version must be semver like 1.0.0');
  if (!Array.isArray(manifest.tags) || manifest.tags.length > 8 || !manifest.tags.every(tag => isText(tag, 24))) errors.push('tags must be up to 8 short strings');
  if (!['light', 'heavy'].includes(manifest.weight)) errors.push('weight must be light or heavy');
  if (!Array.isArray(manifest.modes) || !manifest.modes.length || !manifest.modes.every(mode => MODES.includes(mode))
    || new Set(manifest.modes).size !== manifest.modes.length) errors.push('modes must list gate and/or channel');
  if (typeof manifest.sound !== 'boolean') errors.push('sound must be true or false');
  if (typeof manifest.defaultAccent !== 'string' || !HEX.test(manifest.defaultAccent)) errors.push('defaultAccent must be #rrggbb');
  const accents = manifest.accents;
  if (!accents || typeof accents !== 'object' || Array.isArray(accents) || Object.keys(accents).some(key => !ACCENT_KEYS.includes(key))
    || typeof accents.pause !== 'boolean' || Object.values(accents).some(value => typeof value !== 'boolean')) {
    errors.push('accents must be {pause, unlock?, ending?} with true|false values');
  }
  // Optional words for the end-of-tape warnings, in the theme's voice: { warn5, warn1 }.
  const copy = manifest.endingCopy;
  if (copy !== undefined && (!copy || typeof copy !== 'object' || Array.isArray(copy) || Object.keys(copy).some(key => !['warn5', 'warn1'].includes(key))
    || !Object.values(copy).every(value => isText(value, ENDING_COPY_MAX)))) errors.push(`endingCopy must be {warn5?, warn1?} of up to ${ENDING_COPY_MAX} characters`);
  const feed = manifest.feed;
  if (!feed || typeof feed !== 'object' || Array.isArray(feed)) errors.push('feed must be an object of --tz-* variables');
  else for (const [name, value] of Object.entries(feed)) {
    if (!FEED_VARS.includes(name)) errors.push(`feed variable ${name} is not allowed`);
    else if (typeof value !== 'string' || !FEED_VALUE.test(value)) errors.push(`feed variable ${name} must be #rrggbb, a px length or "accent"`);
  }
  return errors;
}

export function folderBytes(dir) {
  let total = 0;
  for (const name of readdirSync(dir, { recursive: true })) {
    const info = statSync(join(dir, name));
    if (info.isFile()) total += info.size;
  }
  return total;
}

const order = (a, b) => {
  const ia = LAUNCH_ORDER.indexOf(a.id), ib = LAUNCH_ORDER.indexOf(b.id);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  return a.name.localeCompare(b.name);
};

export function createThemes(publicDir) {
  const root = resolve(publicDir, 'themes');
  const hashes = new Map();

  // Same 12-hex SHA-256 prefix server/static.mjs uses, so these URLs are served as immutable.
  function version(file) {
    const info = statSync(file);
    const key = `${info.size}:${info.mtimeMs}`;
    let entry = hashes.get(file);
    if (entry?.key !== key) hashes.set(file, entry = { key, hash: createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, HASH_LENGTH) });
    return entry.hash;
  }

  // Folders are read on each call (a handful of small files), so an edited theme shows up without a restart.
  function list() {
    let entries;
    try { entries = readdirSync(root, { withFileTypes: true }); } catch { return []; }
    const themes = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !ID.test(entry.name)) continue;
      const dir = join(root, entry.name);
      // A folder that cannot be read (a file removed mid-update, bad permissions) is skipped, never thrown.
      try {
        if (!REQUIRED_FILES.every(file => existsSync(join(dir, file)))) continue;
        const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
        if (validateManifest(manifest, entry.name).length) continue;
        const url = file => `/themes/${entry.name}/${file}?v=${version(join(dir, file))}`;
        themes.push({
          id: manifest.id, name: manifest.name, description: manifest.description, author: manifest.author,
          version: manifest.version, tags: manifest.tags, weight: manifest.weight, modes: manifest.modes,
          sound: manifest.sound, defaultAccent: manifest.defaultAccent, accents: manifest.accents, feed: manifest.feed,
          ...(manifest.endingCopy ? { endingCopy: manifest.endingCopy } : {}),
          preview: url('preview.webp'), css: url('splash.css'), js: url('splash.js'),
        });
      } catch { continue; }
    }
    return themes.sort(order);
  }

  function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'application/json' }).end('{"ok":false,"error":"Method not allowed."}');
      return;
    }
    const body = JSON.stringify({ ok: true, contract: CONTRACT, fallback: FALLBACK, themes: list() });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  return { list, handle };
}
