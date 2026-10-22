import { KID_PASSWORD_MIN, PASSWORD_MAX, passwordRecord } from './passwords.mjs';
import { DEFAULT_CHANNEL_ID, channelById, listChannels } from './channels.mjs';

// Kids and their channels: what the setup wizard (and later the parent dashboard) creates and edits.
// Every function checks its own input and throws FamilyError with a status and a plain message.
export class FamilyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Kid logins are ordinary accounts on a reserved top-level domain, so they can never receive email.
export const KID_DOMAIN = 'kids.invalid';
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const HANDLE = /^[a-z][a-z0-9-]{1,23}$/;
const ACCENT = /^#[0-9a-f]{6}$/i;
// /brand/family.svg is the family badge, so a channel called "family" would be shadowed by it.
export const RESERVED_SLUGS = new Set(['family']);

export const kidEmail = handle => `${handle}@${KID_DOMAIN}`;
export const handleOf = email => String(email || '').endsWith('@' + KID_DOMAIN) ? email.slice(0, -KID_DOMAIN.length - 1) : '';

// "Zoë Ann" → "zoe-ann". Never empty, never reserved; the caller makes it unique.
export function slugFrom(name) {
  const base = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return base || 'kid';
}

// Everything an account left behind, for the caller's own transaction: hearts, comments, watch history,
// reactions, email queue and preferences, unused guest codes and uploads. Activity rows keep what happened
// but say "someone" instead of the person's email and name.
export function erasePerson(sqlite, email) {
  for (const sql of ['DELETE FROM likes WHERE email=?', 'DELETE FROM comments WHERE email=?', 'DELETE FROM views WHERE viewer=?',
    'DELETE FROM reactions WHERE email=?', 'DELETE FROM watch_bonus WHERE email=?', 'DELETE FROM video_notification_deliveries WHERE email=?',
    'DELETE FROM video_email_preferences WHERE email=?', 'DELETE FROM guest_codes WHERE creator=? AND redeemed IS NULL',
    "DELETE FROM upload_jobs WHERE email=? AND status<>'processing'", "DELETE FROM activity WHERE kind='seen' AND subject=?",
    "UPDATE activity SET detail=json_set(detail,'$.name','someone') WHERE json_valid(detail) AND json_extract(detail,'$.target')=?",
    "UPDATE activity SET actor='someone' WHERE actor=?", "UPDATE activity SET subject='someone' WHERE subject=?",
    'DELETE FROM accounts WHERE email=?']) sqlite.prepare(sql).run(email);
  // As a whole JSON string, so a longer address that contains this one is left alone.
  const quoted = JSON.stringify(email);
  sqlite.prepare(`UPDATE activity SET detail=replace(detail,?,'"someone"') WHERE instr(detail,?)>0`).run(quoted, quoted);
}

const text = (value, max, label, { required = false } = {}) => {
  const clean = typeof value === 'string' ? value.trim() : value == null ? '' : null;
  if (clean === null || clean.length > max) throw new FamilyError(400, `${label} can be up to ${max} characters.`);
  if (required && !clean) throw new FamilyError(400, `Add ${label.toLowerCase()}.`);
  return clean;
};

export function createFamily({ sqlite, themeIds = () => [], removeChannelFiles = async () => {} }) {
  const log = (actor, kind, subject, detail) => sqlite.prepare('INSERT INTO activity (ts,actor,kind,subject,detail) VALUES (?,?,?,?,?)')
    .run(Date.now(), actor, kind, String(subject), JSON.stringify(detail));
  const loginFor = channelId => sqlite.prepare("SELECT email FROM accounts WHERE role='kid' AND channel_id=? ORDER BY created LIMIT 1").get(channelId);
  const taken = (slug, id) => !!sqlite.prepare('SELECT 1 FROM channels WHERE slug=? AND id<>?').get(slug, id ?? -1);

  // Channel 1 exists from the first migration. Until someone edits it, the first kid takes it over.
  const pristine = row => row && row.id === DEFAULT_CHANNEL_ID && row.slug === 'main' && row.name === 'Main channel'
    && !row.kicker && !row.logo_rev && !loginFor(row.id);

  function uniqueSlug(name, id) {
    let base = slugFrom(name);
    if (RESERVED_SLUGS.has(base)) base = `${base}-kid`;
    let slug = base;
    for (let n = 2; taken(slug, id); n++) slug = `${base.slice(0, 36)}-${n}`;
    return slug;
  }

  function checkSlug(slug, id) {
    if (!SLUG.test(slug)) throw new FamilyError(400, 'Use lowercase letters, numbers and dashes for the channel address.');
    if (RESERVED_SLUGS.has(slug)) throw new FamilyError(400, `"${slug}" is reserved. Pick another channel address.`);
    if (taken(slug, id)) throw new FamilyError(409, 'Another channel already uses that address.');
    return slug;
  }

  function describe(row) {
    const login = loginFor(row.id);
    let badge = null;
    try { const spec = JSON.parse(row.badge || '{}'); badge = spec && spec.v ? spec : null; } catch {}
    return {
      id: row.id, slug: row.slug, name: row.name, kicker: row.kicker, accent: row.accent, themeId: row.theme_id,
      reviewUploads: !!row.review_uploads, badge, logoUrl: row.logo_rev ? `/brand/${row.slug}.svg?v=${row.logo_rev}` : null,
      login: login ? handleOf(login.email) || login.email : null, placeholder: pristine(row),
    };
  }

  function listKids() {
    return listChannels(sqlite).map(describe);
  }

  // Creates a kid (taking over channel 1 the first time) or updates one by id.
  async function saveKid(input, actor) {
    if (!input || typeof input !== 'object') throw new FamilyError(400, 'Invalid request.');
    const name = text(input.name, 40, 'A name', { required: true });
    const kicker = text(input.kicker, 80, 'The channel line');
    const accent = text(input.accent, 7, 'The accent');
    if (accent && !ACCENT.test(accent)) throw new FamilyError(400, 'Pick an accent color.');
    const themeId = text(input.themeId, 40, 'The splash');
    if (themeId && !themeIds().includes(themeId)) throw new FamilyError(400, 'Pick one of the splash screens.');
    const reviewUploads = input.reviewUploads !== false;
    const login = input.login == null || input.login === false ? null : input.login;
    let handle = '', pass = '';
    if (login) {
      handle = String(login.handle || '').trim().toLowerCase();
      if (!HANDLE.test(handle)) throw new FamilyError(400, 'Login names use 2 to 24 lowercase letters, numbers or dashes, starting with a letter.');
      pass = login.pass == null ? '' : String(login.pass);
      if (pass && (pass.length < KID_PASSWORD_MIN || pass.length > PASSWORD_MAX)) throw new FamilyError(400, `Kid passwords need at least ${KID_PASSWORD_MIN} characters.`);
    }

    let row = input.id == null ? null : channelById(sqlite, Number(input.id));
    if (input.id != null && !row) throw new FamilyError(404, 'That kid was removed. Reload the page.');
    const first = channelById(sqlite, DEFAULT_CHANNEL_ID);
    const target = row || (pristine(first) ? first : null);
    const renaming = !row && !!target;
    const id = target?.id;
    const slug = input.slug ? checkSlug(String(input.slug).trim().toLowerCase(), id)
      : target && !renaming ? target.slug : uniqueSlug(name, id);

    // The account check and its password hash happen before anything is written.
    const existing = id ? loginFor(id) : null;
    const email = handle ? kidEmail(handle) : '';
    if (email) {
      const owner = sqlite.prepare('SELECT role, channel_id FROM accounts WHERE email=?').get(email);
      if (owner && !(owner.role === 'kid' && owner.channel_id === id)) throw new FamilyError(409, `The login name "${handle}" is taken.`);
      if (!pass && existing?.email !== email) throw new FamilyError(400, `Set a password for ${handle}.`);
    }
    const record = email && pass ? await passwordRecord(pass, { min: KID_PASSWORD_MIN }) : null;

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      let channelId = id;
      if (target) {
        sqlite.prepare('UPDATE channels SET slug=?, name=?, kicker=?, accent=?, theme_id=?, review_uploads=? WHERE id=?')
          .run(slug, name, kicker, accent, themeId, reviewUploads ? 1 : 0, id);
      } else {
        const position = sqlite.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM channels').get().n;
        channelId = Number(sqlite.prepare(`INSERT INTO channels (slug,name,kicker,accent,theme_id,review_uploads,position,created)
          VALUES (?,?,?,?,?,?,?,?)`).run(slug, name, kicker, accent, themeId, reviewUploads ? 1 : 0, position, Date.now()).lastInsertRowid);
      }
      if (!email) {
        for (const login of sqlite.prepare("SELECT email FROM accounts WHERE role='kid' AND channel_id=?").all(channelId)) erasePerson(sqlite, login.email);
      } else {
        if (existing && existing.email !== email) erasePerson(sqlite, existing.email);
        if (existing?.email === email) {
          sqlite.prepare('UPDATE accounts SET first=? WHERE email=?').run(name, email);
          if (record) sqlite.prepare('UPDATE accounts SET salt=?, hash=? WHERE email=?').run(record.salt, record.hash, email);
        } else {
          sqlite.prepare(`INSERT INTO accounts (email,first,last,salt,hash,status,role,channel_id,created)
            VALUES (?,?,'',?,?,'approved','kid',?,?)`).run(email, name, record.salt, record.hash, channelId, Date.now());
        }
        // New-video emails go to approved accounts; a .invalid address must never be tried.
        sqlite.prepare('INSERT OR REPLACE INTO video_email_preferences (email, unsubscribed) VALUES (?, 1)').run(email);
      }
      log(actor, 'channel', channelId, { action: target ? 'update' : 'create', slug, name, login: handle || null });
      sqlite.exec('COMMIT');
      return describe(channelById(sqlite, channelId));
    } catch (error) {
      sqlite.exec('ROLLBACK');
      if (/UNIQUE/.test(error.message)) throw new FamilyError(409, 'Another channel already uses that address.');
      throw error;
    }
  }

  // Only a kid added by mistake: a channel with videos stays, and channel 1 always stays.
  async function removeKid(id, actor) {
    const row = channelById(sqlite, Number(id));
    if (!row) throw new FamilyError(404, 'That kid was already removed.');
    if (row.id === DEFAULT_CHANNEL_ID) throw new FamilyError(409, 'The first kid can be renamed but not removed.');
    if (sqlite.prepare('SELECT 1 FROM clips WHERE channel_id=? LIMIT 1').get(row.id)) throw new FamilyError(409, 'This channel has videos, so it stays.');
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      for (const login of sqlite.prepare("SELECT email FROM accounts WHERE role='kid' AND channel_id=?").all(row.id)) erasePerson(sqlite, login.email);
      sqlite.prepare('DELETE FROM channels WHERE id=?').run(row.id);
      log(actor, 'channel', row.id, { action: 'remove', slug: row.slug, name: row.name });
      sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    await removeChannelFiles(row.id);
  }

  return { listKids, saveKid, removeKid };
}
