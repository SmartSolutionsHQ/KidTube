// Family settings: for each one, its environment variable, stored value, default and parser. The setup
// wizard and the dashboard change them; everything else reads them through createSettings().
import { DEFAULT_ACCENT, TAGLINE } from './brand.mjs';

export class SettingError extends Error {}

const text = max => value => {
  if (typeof value !== 'string' || value.trim().length > max) throw new SettingError(`Use text of up to ${max} characters.`);
  return value.trim();
};
const matching = (pattern, hint) => value => {
  if (typeof value !== 'string' || !pattern.test(value)) throw new SettingError(hint);
  return value;
};
const choice = (...options) => value => {
  if (!options.includes(value)) throw new SettingError(`Use one of: ${options.join(', ')}.`);
  return value;
};
const flag = value => {
  if (typeof value === 'boolean') return value;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  throw new SettingError('Use true or false.');
};
const days = value => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 3650) throw new SettingError('Use a whole number of days from 1 to 3650.');
  return number;
};
const email = value => {
  if (value === '') return '';
  if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()) || value.length >= 120) throw new SettingError('Use an email address.');
  return value.trim().toLowerCase();
};
const origin = value => {
  let url;
  try { url = new URL(value); } catch { throw new SettingError('Use an HTTP(S) origin without a path.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new SettingError('Use an HTTP(S) origin without a path.');
  }
  return url.origin;
};
// UTC is valid everywhere but missing from some engines' list of zones.
const timezone = value => {
  if (typeof value !== 'string' || !(['UTC', 'Etc/UTC'].includes(value) || Intl.supportedValuesOf('timeZone').includes(value))) {
    throw new SettingError('Use a time zone name like America/Chicago.');
  }
  return value;
};
export const SERVER_TIMEZONE = (() => { try { return timezone(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { return 'UTC'; } })();
// The badge builder validates the spec itself; here it only has to be a small JSON object.
const badge = value => {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 4096) throw new SettingError('Use a badge spec under 4 KB.');
  return value;
};

// Each setting reads a non-empty environment variable first (which locks it), then the settings table,
// then the fallback. Public ones may appear in GET /api/site; secret ones are masked by describe().
const SETTINGS = {
  site_name: { env: 'SITE_NAME', fallback: '', parse: text(60), public: true },
  site_tagline: { env: 'SITE_TAGLINE', fallback: TAGLINE, parse: text(120), public: true },
  site_url: { env: 'SITE_URL', fallback: '', parse: origin },
  family_accent: { env: 'FAMILY_ACCENT', fallback: DEFAULT_ACCENT, parse: matching(/^#[0-9a-f]{6}$/i, 'Use a color like #FF5C2B.'), public: true },
  gate_theme: { env: 'GATE_THEME', fallback: 'ember-tape', parse: matching(/^[a-z0-9-]{1,40}$/, 'Use a theme id.'), public: true },
  family_badge: { fallback: null, parse: badge, public: true },
  kids_public: { env: 'KIDS_PUBLIC', fallback: true, parse: flag, public: true },
  signup_mode: { env: 'SIGNUP_MODE', fallback: 'approval', parse: choice('approval', 'closed'), public: true },
  guest_passes: { env: 'GUEST_PASSES', fallback: true, parse: flag, public: true },
  comments_default: { env: 'COMMENTS_DEFAULT', fallback: 'review', parse: choice('review', 'open', 'off') },
  review_uploads_default: { env: 'REVIEW_UPLOADS_DEFAULT', fallback: 'creators', parse: choice('creators', 'none') },
  mail_mode: { env: 'MAIL_MODE', fallback: 'disabled', parse: choice('disabled', 'brevo') },
  brevo_api_key: { env: 'BREVO_API_KEY', fallback: '', parse: text(200), secret: true },
  notify_email: { env: 'NOTIFY_EMAIL', fallback: '', parse: email },
  sender_email: { env: 'SENDER_EMAIL', fallback: '', parse: email },
  splash_sound: { env: 'SPLASH_SOUND', fallback: true, parse: flag, public: true },
  views_retention_days: { env: 'VIEWS_RETENTION_DAYS', fallback: 90, parse: days },
  activity_retention_days: { env: 'ACTIVITY_RETENTION_DAYS', fallback: 365, parse: days },
  // Days, capsule countdowns and the daily tape reset follow the family's clock, not the server's.
  family_timezone: { env: 'FAMILY_TIMEZONE', fallback: SERVER_TIMEZONE, parse: timezone, public: true },
  setup_complete: { fallback: false, parse: flag },
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
    if (!name || env[name] === undefined || env[name] === '') continue;
    try { overrides.set(key, parse(env[name])); }
    catch (error) { throw new Error(`${name}: ${error.message}`); }
  }
  const read = sqlite.prepare('SELECT value FROM settings WHERE key=?');
  const write = sqlite.prepare(`INSERT INTO settings (key,value,updated) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated`);
  const log = sqlite.prepare("INSERT INTO activity (ts,actor,kind,subject,detail) VALUES (?,?,'setting',?,?)");

  function lookup(key) {
    const { parse, fallback } = spec(key);
    if (overrides.has(key)) return { value: overrides.get(key), source: 'env' };
    const row = read.get(key);
    if (row) {
      try { return { value: parse(JSON.parse(row.value)), source: 'db' }; }
      catch (error) { console.error(`Ignoring stored setting ${key}:`, error.message); }
    }
    return { value: fallback, source: 'default' };
  }

  const get = key => lookup(key).value;
  const all = () => Object.fromEntries(SETTING_KEYS.map(key => [key, get(key)]));

  // Saves a parent's choice and records who made it; an environment variable still wins until removed.
  function set(key, value, actor = 'system') {
    const { parse, secret } = spec(key);
    const clean = parse(value);
    const now = Date.now();
    write.run(key, JSON.stringify(clean), now);
    log.run(now, actor, key, JSON.stringify({ value: secret ? '(hidden)' : clean }));
    return get(key);
  }

  // For the parent dashboard: every setting, where its value came from, secrets masked.
  function describe() {
    return SETTING_KEYS.map(key => {
      const { value, source } = lookup(key);
      const { secret = false, public: shown = false } = SETTINGS[key];
      return { key, value: secret && value ? '********' : value, source, locked: source === 'env', public: shown, secret };
    });
  }

  return { get, set, all, describe };
}
