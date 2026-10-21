import { DEFAULT_ACCENT, TAGLINE } from './brand.mjs';

export class SettingError extends Error {}

const text = max => value => {
  if (typeof value !== 'string' || value.trim().length > max) throw new SettingError(`Use text of up to ${max} characters.`);
  return value.trim();
};
const matching = (pattern, hint) => value => {
  if (typeof value !== 'string' || !pattern.test(value)) throw new SettingError(hint);
  return value.toLowerCase();
};
const flag = value => {
  if (typeof value === 'boolean') return value;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  throw new SettingError('Use true or false.');
};

// Each setting reads its environment variable first, then the settings table, then the fallback.
const SETTINGS = {
  familyName: { env: 'FAMILY_NAME', fallback: '', parse: text(60) },
  tagline: { env: 'TAGLINE', fallback: TAGLINE, parse: text(120) },
  gateTheme: { env: 'GATE_THEME', fallback: 'ember-tape', parse: matching(/^[a-z0-9-]{1,40}$/i, 'Use a theme id.') },
  accent: { env: 'ACCENT', fallback: DEFAULT_ACCENT, parse: matching(/^#[0-9a-f]{6}$/i, 'Use a color like #FF5C2B.') },
  kidsPublic: { env: 'KIDS_PUBLIC', fallback: true, parse: flag },
  signups: { env: 'SIGNUPS', fallback: true, parse: flag },
  guestCodes: { env: 'GUEST_CODES', fallback: true, parse: flag },
  reviewComments: { env: 'REVIEW_COMMENTS', fallback: false, parse: flag },
};
export const SETTING_KEYS = Object.keys(SETTINGS);

function spec(key) {
  if (!Object.hasOwn(SETTINGS, key)) throw new SettingError(`Unknown setting ${key}.`);
  return SETTINGS[key];
}

export function createSettings(sqlite, env = process.env) {
  // A bad environment value stops startup, like the other configuration checks.
  const overrides = new Map();
  for (const [key, { env: name, parse }] of Object.entries(SETTINGS)) {
    if (env[name] === undefined || env[name] === '') continue;
    try { overrides.set(key, parse(env[name])); }
    catch (error) { throw new Error(`${name}: ${error.message}`); }
  }
  const read = sqlite.prepare('SELECT value FROM settings WHERE key=?');
  const write = sqlite.prepare(`INSERT INTO settings (key,value,updated) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated`);

  function get(key) {
    const { parse, fallback } = spec(key);
    if (overrides.has(key)) return overrides.get(key);
    const row = read.get(key);
    if (row) {
      try { return parse(JSON.parse(row.value)); }
      catch (error) { console.error(`Ignoring stored setting ${key}:`, error.message); }
    }
    return fallback;
  }

  // Saves the parent's choice; an environment variable still wins until it is removed.
  function set(key, value) {
    write.run(key, JSON.stringify(spec(key).parse(value)), Date.now());
    return get(key);
  }

  const all = () => Object.fromEntries(SETTING_KEYS.map(key => [key, get(key)]));
  function locked(key) { spec(key); return overrides.has(key); }
  return { get, set, all, locked };
}
