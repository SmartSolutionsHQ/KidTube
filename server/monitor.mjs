import { createHmac } from 'node:crypto';
import { readdir, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import api, { asStaff } from './api.js';
import { viewer as cookieViewer } from './access.mjs';
import { BRAND_NAME } from './brand.mjs';
import { DEFAULT_CHANNEL_ID, channelById, channelBySlug, isStaff, listChannels } from './channels.mjs';
import { InstallError, checkSiteUrl } from './config.mjs';
import { FamilyError, erasePerson } from './family.mjs';
import { sendMail } from './mail.mjs';
import { approveClip, rejectClip } from './publish.mjs';
import { SettingError } from './settings.mjs';

// The parent dashboard's API (M7). Every route needs a parent's session in X-Kid-Email / X-Kid-Token, like
// the setup and badge routes; 'super' is the owner, 'admin' a co-parent. Every change writes an activity row.
// Where api.js already does the work (rename, reorder, delete, approvals, roles, passwords, guest codes) this
// module calls it through api.fetch and adds the activity row, so each rule lives in one place.

const MAX_BODY = 64 * 1024;
const CLIP = /^[A-Za-z0-9_-]{1,80}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Presence: a viewer's "last seen" is one activity row per person, refreshed at most every five minutes.
export const SEEN_EVERY = 5 * 60 * 1000;
const DAY = 86400000;
const FEED_KINDS = ['review', 'upload', 'comment', 'people', 'guest', 'kids', 'videos', 'settings'];
// Settings a parent may change from the dashboard; the rest belong to setup or the environment.
export const EDITABLE = ['site_name', 'site_tagline', 'family_accent', 'gate_theme', 'kids_public', 'signup_mode',
  'guest_passes', 'comments_default', 'review_uploads_default', 'splash_sound', 'views_retention_days',
  'activity_retention_days', 'mail_mode', 'brevo_api_key', 'sender_email', 'notify_email', 'site_url'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'That request is too big.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {}
  throw new HttpError(400, 'Invalid request.');
}

const parse = text => { try { return JSON.parse(text || '{}') || {}; } catch { return {}; } };
const fullName = row => [row?.first, row?.last].map(part => String(part || '').trim()).filter(Boolean).join(' ');
const quote = value => `"${String(value || '').trim() || 'Untitled'}"`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// One sentence per feed row, in the parent side's plain words. row: { kind, action, actor, detail, ... }
// names(email) gives a display name; kids(id or slug) a kid's name.
export function describeActivity(row, { names = () => '', kids = () => '' } = {}) {
  const who = names(row.actor) || (row.actor === 'system' ? 'The app' : row.actor || 'Someone');
  const d = row.detail || {};
  const kid = kids(d.channel ?? d.channelId) || d.kid || '';
  switch (`${row.kind}:${row.action || ''}`) {
    case 'upload:': return `${who} posted ${quote(d.title)}${kid && kid !== who ? ` on ${kid}` : ''}.${d.review === 'pending' ? ' It is waiting for review.' : ''}`;
    case 'signup:': return `${who} asked to watch.`;
    case 'comment:posted': return `${who} commented on ${quote(d.title)}.${d.waiting ? ' It is waiting for review.' : ''}`;
    case 'review:approved': return `${who} approved ${quote(d.title)}${kid ? ` on ${kid}` : ''}.`;
    case 'review:rejected': return `${who} kept ${quote(d.title)} private.`;
    case 'clip:hide': return `${who} hid ${quote(d.title)}.`;
    case 'clip:unhide': return `${who} showed ${quote(d.title)} again.`;
    case 'clip:rename': return `${who} renamed ${quote(d.from)} to ${quote(d.title)}.`;
    case 'clip:order': return `${who} changed the order of ${kid ? `${kid}'s` : 'the'} videos.`;
    case 'clip:delete': return `${who} deleted ${quote(d.title)}.`;
    case 'comment:approve': return `${who} let a comment on ${quote(d.title)} show.`;
    case 'comment:hide': return `${who} hid a comment on ${quote(d.title)}.`;
    case 'comment:delete': return `${who} deleted a comment on ${quote(d.title)}.`;
    case 'person:approved': return `${who} let ${d.name || d.target} watch.`;
    case 'person:denied': return `${who} turned down ${d.name || d.target}.`;
    case 'person:pending': return `${who} moved ${d.name || d.target} back to waiting.`;
    case 'person:role': return `${who} made ${d.name || d.target} ${d.role === 'admin' ? 'a co-parent' : 'a viewer'}.`;
    case 'person:password': return `${who} set a new password for ${d.name || d.target}.`;
    case 'person:delete': return `${who} removed ${d.name || d.target} and everything they added.`;
    case 'guest:create': return `${who} made a guest code${d.note ? ` for ${d.note}` : ''}${kid ? ` (${kid} only)` : ''}.`;
    case 'guest:used': return `A guest code${d.note ? ` for ${d.note}` : ''} was used. They can watch for 24 hours.`;
    case 'guest:end': return `${who} ended a guest code${d.note ? ` for ${d.note}` : ''}.`;
    case 'channel:create': return `${who} added ${d.name || 'a kid'}.`;
    case 'channel:update': return `${who} changed ${d.name || 'a kid'}'s channel.`;
    case 'channel:remove': return `${who} removed ${d.name || 'a kid'}${d.videos ? ` and ${plural(d.videos, 'video', 'videos')}` : ''}.`;
    case 'channel:order': return `${who} changed the order of the kids.`;
    case 'badge:': return `${who} saved a new badge${kid ? ` for ${kid}` : ''}.`;
    case 'image:': return `${who} changed ${kid ? `${kid}'s` : 'a'} picture.`;
    case 'icon:': return `${who} saved the family badge.`;
    case 'setting:': return row.subject === 'setup_complete' ? `${who} finished setting up the family.`
      : `${who} changed the ${SETTING_NAMES[row.subject] || row.subject} setting.`;
    case 'setup:claim': return `${who} set up the family.`;
    case 'email:test': return `${who} sent a test email to ${d.to}.`;
    case 'capsule.seal:': return `${who} sealed ${quote(d.title)} as a time capsule.`;
    case 'capsule.unseal:': return `${who} opened the time capsule ${quote(d.title)} early.`;
    case 'capsule.open:': return `The time capsule ${quote(d.title)} opened.`;
    case 'budget.set:': return Number(d.minutes) > 0
      ? `${who} set ${names(row.subject) || row.subject}'s daily tape to ${plural(Number(d.minutes), 'minute', 'minutes')}.`
      : `${who} took away ${names(row.subject) || row.subject}'s daily tape.`;
    case 'budget.bonus:': return `${who} gave ${names(row.subject) || row.subject} ${plural(Number(d.minutes) || 0, 'extra minute', 'extra minutes')} today.`;
    case 'budget.end:': return `${names(row.subject) || row.subject} reached the end of today's tape.`;
    default: return `${who}: ${row.kind}${row.action ? ` ${row.action}` : ''}.`;
  }
}

export const SETTING_NAMES = {
  site_name: 'family name', site_tagline: 'tagline', family_accent: 'family color', gate_theme: 'front door splash',
  kids_public: 'front door names', signup_mode: 'new viewers', guest_passes: 'guest codes',
  comments_default: 'comments', review_uploads_default: 'upload review for new kids', splash_sound: 'splash sound',
  views_retention_days: 'how long watch history is kept', activity_retention_days: 'how long activity is kept',
  mail_mode: 'email', brevo_api_key: 'email key', sender_email: 'sender address', notify_email: 'notice address',
  site_url: 'web address', family_badge: 'family badge', setup_complete: 'setup',
};

// Which feed group a row belongs to, for the Activity filter.
const GROUP = { upload: 'upload', signup: 'people', person: 'people', review: 'review', comment: 'comment', guest: 'guest',
  channel: 'kids', badge: 'kids', image: 'kids', clip: 'videos', setting: 'settings', icon: 'settings', setup: 'settings', email: 'settings',
  'capsule.seal': 'videos', 'capsule.unseal': 'videos', 'capsule.open': 'videos',
  'budget.set': 'people', 'budget.bonus': 'people', 'budget.end': 'people' };

export function createMonitor({ sqlite, settings, env, family, paths = {}, now = () => Date.now() }) {
  const hmac = text => createHmac('sha256', env.SIGN_SECRET).update(text).digest('hex');
  const insertActivity = sqlite.prepare('INSERT INTO activity (ts,actor,kind,subject,detail) VALUES (?,?,?,?,?)');
  const log = (actor, kind, subject, detail) => insertActivity.run(now(), actor, kind, String(subject ?? ''), JSON.stringify(detail || {}));
  const locked = key => settings.describe().find(entry => entry.key === key)?.locked === true;

  /* ---------- who is asking ---------- */
  async function staff(req, { owner = false } = {}) {
    const email = String(req.headers['x-kid-email'] || '').trim().toLowerCase();
    const token = String(req.headers['x-kid-token'] || '');
    const user = email && token ? await asStaff(env, email, token) : null;
    if (!user) throw new HttpError(403, 'Sign in as a parent to see this.');
    if (owner && user.role !== 'super') throw new HttpError(403, 'Only the parent who set this up can change this.');
    return { ...user, t: token };
  }

  // Runs one of api.js's own routes as this parent and returns its answer.
  async function delegate(user, path, body) {
    const request = new Request(`http://monitor.local${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, email: user.email, t: user.t }),
    });
    // internal: these routes write their own activity rows, so api.js doesn't add a second.
    const response = await api.fetch(request, env, { viewer: null, internal: true });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new HttpError(response.status >= 400 ? response.status : 400, result.error || 'That did not work. Try again.');
    return result;
  }

  /* ---------- names ---------- */
  function nameBook() {
    const people = new Map(sqlite.prepare('SELECT email, first, last FROM accounts').all().map(row => [row.email, fullName(row) || row.email]));
    const channels = listChannels(sqlite);
    const kids = new Map();
    for (const row of channels) { kids.set(String(row.id), row.name); kids.set(row.slug, row.name); }
    return {
      names: email => people.get(email) || (String(email || '').startsWith('guest:') ? 'A guest' : ''),
      kids: key => (key == null || key === '' ? '' : kids.get(String(key)) || ''),
      channels,
    };
  }

  /* ---------- presence ---------- */
  const seen = new Map();
  // Called for the shell's /api/me and the feed's /api/clips: who the cookie names, at most every five minutes.
  function touch(req) {
    const who = cookieViewer(req, sqlite, env);
    if (!who) return;
    let subject = who.email;
    if (who.role === 'guest') {
      try {
        const value = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('kid_access=')).slice(11);
        const session = JSON.parse(Buffer.from(value.split('.')[0], 'base64url'));
        subject = 'guest:' + hmac('guest-session|' + session.guest).slice(0, 12);
      } catch { return; }
    }
    if (!subject) return;
    const at = now();
    if ((seen.get(subject) || 0) > at - SEEN_EVERY) return;
    seen.set(subject, at);
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.prepare("DELETE FROM activity WHERE kind='seen' AND subject=?").run(subject);
      insertActivity.run(at, subject, 'seen', subject, '{}');
      sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }
  const lastSeen = () => new Map(sqlite.prepare("SELECT subject, ts FROM activity WHERE kind='seen'").all().map(row => [row.subject, row.ts]));

  /* ---------- retention ---------- */
  // Rate limits keep addresses for an hour at most (signups); afterwards nothing needs them. api.js only
  // clears each table when that route is used again, which in a small family can be months.
  function pruneAddresses() {
    const before = now() - 60 * 60 * 1000;
    for (const table of ['hits', 'chits', 'guest_code_attempts']) sqlite.prepare(`DELETE FROM ${table} WHERE ts < ?`).run(before);
  }

  // Activity and watch history older than the family's settings go, at boot and once a day.
  function prune() {
    pruneAddresses();
    const at = now();
    sqlite.prepare('DELETE FROM activity WHERE ts < ?').run(at - settings.get('activity_retention_days') * DAY);
    const columns = sqlite.prepare('PRAGMA table_info(views)').all().map(column => column.name);
    const time = columns.includes('started') ? 'started' : columns.includes('ts') ? 'ts' : null;
    if (time) sqlite.prepare(`DELETE FROM views WHERE ${time} < ?`).run(at - settings.get('views_retention_days') * DAY);
  }

  /* ---------- counts and storage ---------- */
  const COMMENT_STATE = `(SELECT json_extract(a.detail,'$.action') FROM activity a
    WHERE a.kind='comment' AND a.subject=m.id ORDER BY a.id DESC LIMIT 1)`;
  function counts(role) {
    return {
      review: sqlite.prepare("SELECT COUNT(*) n FROM clips WHERE review='pending'").get().n,
      comments: sqlite.prepare(`SELECT COUNT(*) n FROM comments m WHERE m.hidden=1 AND COALESCE(${COMMENT_STATE},'')<>'hide'`).get().n,
      people: role === 'super' ? sqlite.prepare("SELECT COUNT(*) n FROM accounts WHERE status='pending'").get().n : null,
    };
  }

  async function storage() {
    const dataDir = paths.dataDir;
    const disk = await statfs(dataDir);
    let count = 0, bytes = 0;
    const videos = join(dataDir, 'videos');
    for (const name of await readdir(videos).catch(() => [])) {
      if (!/\.(?:mp4|jpg)$/.test(name)) continue;
      const info = await stat(join(videos, name)).catch(() => null);
      if (!info?.isFile()) continue;
      bytes += info.size;
      if (name.endsWith('.mp4')) count++;
    }
    return { free: disk.bavail * disk.bsize, total: disk.blocks * disk.bsize, videos: { count, bytes } };
  }

  /* ---------- the feed ---------- */
  // Activity rows plus what other parts of the app record in their own tables: uploads, sign-up requests,
  // comments and guest codes being used. Newest first, `before` pages back.
  function feed({ before = Infinity, limit = 30, kind = '', channel = '' } = {}) {
    const book = nameBook();
    const cap = Math.min(Math.max(1, limit), 100);
    const until = Number.isFinite(before) ? before : 8.64e15;
    const want = row => (!kind || GROUP[row.kind] === kind) && (!channel || row.channel === channel);
    const rows = [];
    const slugOf = new Map(book.channels.map(row => [String(row.id), row.slug]));

    // activity: skip presence and setup progress; read in pages until enough rows match.
    if (!kind || ['review', 'people', 'comment', 'guest', 'kids', 'videos', 'settings'].includes(kind)) {
      let cursor = until;
      for (let found = 0; found < cap;) {
        const batch = sqlite.prepare(`SELECT id, ts, actor, kind, subject, detail FROM activity
          WHERE ts < ? AND kind NOT IN ('seen', 'icon') AND NOT (kind='setup' AND subject='step') ORDER BY ts DESC, id DESC LIMIT 200`).all(cursor);
        if (!batch.length) break;
        for (const row of batch) {
          const detail = parse(row.detail);
          const item = { at: row.ts, kind: row.kind, action: detail.action || detail.decision || (row.kind === 'setup' ? row.subject : ''), actor: row.actor, subject: row.subject, detail };
          if (row.kind === 'channel') item.channel = slugOf.get(row.subject) || detail.slug || '';
          else if (/^channel:\d+$/.test(row.subject)) {
            item.channel = slugOf.get(row.subject.slice(8)) || '';
            detail.channel ??= item.channel;
          }
          else item.channel = detail.channel || '';
          if (row.kind === 'review' && !detail.title) detail.title = sqlite.prepare('SELECT title FROM clips WHERE id=?').get(row.subject)?.title || 'a video';
          // Time capsules are logged by clip id; the feed names the video and files it under its kid.
          if (row.kind.startsWith('capsule.')) {
            const clip = sqlite.prepare('SELECT c.title, ch.slug FROM clips c LEFT JOIN channels ch ON ch.id=c.channel_id WHERE c.id=?').get(row.subject);
            detail.title ??= clip?.title;
            item.channel ||= clip?.slug || '';
          }
          if (want(item)) { rows.push(item); found++; }
        }
        cursor = batch.at(-1).ts;
        if (batch.length < 200) break;
      }
    }
    if (!kind || kind === 'upload') {
      for (const row of sqlite.prepare(`SELECT j.email, j.updated, c.title, c.review, ch.slug FROM upload_jobs j
        JOIN clips c ON c.id=j.clip_id LEFT JOIN channels ch ON ch.id=c.channel_id
        WHERE j.status='done' AND j.updated < ? ${channel ? 'AND ch.slug=?' : ''} ORDER BY j.updated DESC LIMIT ?`).all(...[until, ...(channel ? [channel] : []), cap])) {
        rows.push({ at: row.updated, kind: 'upload', action: '', actor: row.email, channel: row.slug || '', detail: { title: row.title, review: row.review, channel: row.slug } });
      }
    }
    if ((!kind || kind === 'people') && !channel) {
      for (const row of sqlite.prepare("SELECT email, created FROM accounts WHERE created < ? AND role NOT IN ('super','kid') ORDER BY created DESC LIMIT ?").all(until, cap)) {
        rows.push({ at: row.created, kind: 'signup', action: '', actor: row.email, channel: '', detail: {} });
      }
    }
    if (!kind || kind === 'comment') {
      for (const row of sqlite.prepare(`SELECT m.email, m.created, m.hidden, c.title, ch.slug FROM comments m
        LEFT JOIN clips c ON c.id=m.clip_id LEFT JOIN channels ch ON ch.id=c.channel_id
        WHERE m.created < ? ${channel ? 'AND ch.slug=?' : ''} ORDER BY m.created DESC LIMIT ?`).all(...[until, ...(channel ? [channel] : []), cap])) {
        rows.push({ at: row.created, kind: 'comment', action: 'posted', actor: row.email, channel: row.slug || '', detail: { title: row.title, waiting: !!row.hidden } });
      }
    }
    if (!kind || kind === 'guest') {
      for (const row of sqlite.prepare(`SELECT g.code_hash, g.redeemed, g.session_expires, ch.slug FROM guest_codes g
        LEFT JOIN channels ch ON ch.id=g.channel_id WHERE g.redeemed IS NOT NULL AND g.redeemed < ? ${channel ? 'AND ch.slug=?' : ''}
        ORDER BY g.redeemed DESC LIMIT ?`).all(...[until, ...(channel ? [channel] : []), cap])) {
        const note = guestNote(row.code_hash.slice(0, 12));
        rows.push({ at: row.redeemed, kind: 'guest', action: 'used', actor: 'guest:' + row.code_hash.slice(0, 12), channel: row.slug || '',
          detail: { note, channel: row.slug } });
      }
    }
    rows.sort((a, b) => b.at - a.at);
    const page = rows.slice(0, cap);
    return {
      rows: page.map(row => ({ at: row.at, kind: GROUP[row.kind] || row.kind, channel: row.channel || null, actor: row.actor,
        text: describeActivity(row, book) })),
      next: page.length === cap ? page.at(-1).at : null,
    };
  }

  const guestNote = id => {
    const row = sqlite.prepare("SELECT detail FROM activity WHERE kind='guest' AND subject=? ORDER BY id LIMIT 1").get(id);
    return row ? parse(row.detail).note || '' : '';
  };

  /* ---------- routes ---------- */
  const clipRow = id => sqlite.prepare(`SELECT c.*, ch.slug AS channel FROM clips c LEFT JOIN channels ch ON ch.id=c.channel_id WHERE c.id=?`).get(id);
  const needClip = id => {
    if (!CLIP.test(String(id || ''))) throw new HttpError(400, 'Pick a video.');
    const clip = clipRow(id);
    if (!clip) throw new HttpError(404, 'That video is gone. Reload the page.');
    return clip;
  };
  const uploaderSql = `(SELECT j.email FROM upload_jobs j WHERE j.clip_id=c.id LIMIT 1)`;
  const clipOut = row => ({
    id: row.id, title: row.title, channel: row.channel || '', position: row.position, review: row.review, hidden: !!row.hidden,
    poster: row.poster || '', src: row.src, duration: row.duration || 0, created: row.created, published: row.published || '',
    uploader: row.uploader || '', likes: row.likes || 0, comments: row.comments || 0,
  });

  const routes = {
    async 'GET /api/admin/summary'(req) {
      const user = await staff(req);
      const account = sqlite.prepare('SELECT first, last FROM accounts WHERE email=?').get(user.email) || {};
      const site = settings.all();
      return {
        me: { email: user.email, role: user.role, first: account.first || '', name: fullName(account) || user.email },
        family: { name: site.site_name, accent: site.family_accent, siteUrl: site.site_url, guestPasses: site.guest_passes,
          comments: site.comments_default, signupMode: site.signup_mode, kidsPublic: site.kids_public, viewsDays: site.views_retention_days },
        counts: counts(user.role),
        // Watch history arrives with the launch-story milestone's views table (it has a started column).
        features: { views: sqlite.prepare('PRAGMA table_info(views)').all().some(column => column.name === 'started') },
        kids: listChannels(sqlite).map(row => ({ id: row.id, slug: row.slug, name: row.name, accent: row.accent || site.family_accent,
          logoUrl: row.logo_rev ? `/brand/${row.slug}.svg?v=${row.logo_rev}` : null })),
      };
    },

    async 'GET /api/admin/storage'(req) {
      await staff(req);
      return storage();
    },

    async 'GET /api/admin/activity'(req, url) {
      await staff(req);
      const before = Number(url.searchParams.get('before')) || Infinity;
      const kind = String(url.searchParams.get('kind') || '');
      if (kind && !FEED_KINDS.includes(kind)) throw new HttpError(400, 'Unknown kind.');
      const limit = Number(url.searchParams.get('limit')) || 30;
      return feed({ before, limit, kind, channel: String(url.searchParams.get('channel') || '') });
    },

    // Waiting for a parent: kid uploads on channels with review turned on.
    async 'GET /api/admin/review'(req) {
      await staff(req);
      const book = nameBook();
      const rows = sqlite.prepare(`SELECT c.*, ch.slug AS channel, ${uploaderSql} AS uploader FROM clips c
        LEFT JOIN channels ch ON ch.id=c.channel_id WHERE c.review='pending' ORDER BY c.created`).all();
      return { clips: rows.map(row => ({ ...clipOut(row), kid: book.kids(row.channel), uploaderName: book.names(row.uploader) })) };
    },

    async 'POST /api/admin/review'(req) {
      const user = await staff(req);
      const body = await readJson(req);
      const clip = needClip(body.id);
      if (body.decision === 'approve') {
        const channel = approveClip(sqlite, env.notifications, clip.id, user.email);
        if (channel === null) throw new HttpError(409, 'That video is already live.');
        return { review: 'approved', channel };
      }
      if (body.decision === 'reject') {
        if (!rejectClip(sqlite, clip.id, user.email)) throw new HttpError(409, 'That video is not waiting any more.');
        return { review: 'rejected' };
      }
      throw new HttpError(400, 'Choose approve or keep private.');
    },

    async 'GET /api/admin/clips'(req, url) {
      await staff(req);
      const slug = String(url.searchParams.get('channel') || '');
      const channel = slug ? channelBySlug(sqlite, slug) : null;
      if (slug && !channel) throw new HttpError(404, 'That kid is gone. Reload the page.');
      const rows = sqlite.prepare(`SELECT c.*, ch.slug AS channel, ${uploaderSql} AS uploader,
        (SELECT COUNT(*) FROM likes l WHERE l.clip_id=c.id) AS likes, (SELECT COUNT(*) FROM comments m WHERE m.clip_id=c.id) AS comments
        FROM clips c LEFT JOIN channels ch ON ch.id=c.channel_id ${channel ? 'WHERE c.channel_id=?' : ''}
        ORDER BY ch.position, c.channel_id, c.position`).all(...(channel ? [channel.id] : []));
      return { clips: rows.map(clipOut) };
    },

    async 'POST /api/admin/clips/hide'(req) {
      const user = await staff(req);
      const body = await readJson(req);
      const clip = needClip(body.id);
      const hidden = body.hidden === true;
      sqlite.prepare('UPDATE clips SET hidden=? WHERE id=?').run(hidden ? 1 : 0, clip.id);
      log(user.email, 'clip', clip.id, { action: hidden ? 'hide' : 'unhide', title: clip.title, channel: clip.channel });
      return { hidden };
    },

    async 'POST /api/admin/clips/rename'(req) {
      const user = await staff(req);
      const body = await readJson(req);
      const clip = needClip(body.id);
      const title = String(body.title || '').trim().slice(0, 80);
      if (!title) throw new HttpError(400, 'Give the video a name.');
      await delegate(user, '/api/clips/rename', { id: clip.id, title });
      log(user.email, 'clip', clip.id, { action: 'rename', from: clip.title, title, channel: clip.channel });
      return { title };
    },

    async 'POST /api/admin/clips/order'(req) {
      const user = await staff(req);
      const body = await readJson(req);
      const channel = channelBySlug(sqlite, String(body.channel || ''));
      if (!channel) throw new HttpError(404, 'That kid is gone. Reload the page.');
      const order = Array.isArray(body.order) ? body.order.map(String).filter(id => CLIP.test(id)) : [];
      const mine = new Set(sqlite.prepare('SELECT id FROM clips WHERE channel_id=?').all(channel.id).map(row => row.id));
      if (!order.length || order.some(id => !mine.has(id))) throw new HttpError(400, 'Reload the page and try again.');
      await delegate(user, '/api/clips/reorder', { order });
      log(user.email, 'clip', `channel:${channel.id}`, { action: 'order', channel: channel.slug });
      return { count: order.length };
    },

    async 'POST /api/admin/clips/delete'(req) {
      const user = await staff(req);
      const body = await readJson(req);
      const clip = needClip(body.id);
      await delegate(user, '/api/clips/delete', { id: clip.id });
      log(user.email, 'clip', clip.id, { action: 'delete', title: clip.title, channel: clip.channel });
      return {};
    },

    // Comments: 'waiting' (held by the comments setting), 'hidden' (a parent hid it), 'showing'.
    async 'GET /api/admin/comments'(req, url) {
      await staff(req);
      const status = String(url.searchParams.get('status') || 'waiting');
      const book = nameBook();
      const rows = sqlite.prepare(`SELECT m.id, m.clip_id, m.email, m.name, m.body, m.created, m.hidden, ${COMMENT_STATE} AS last,
        c.title, ch.slug AS channel FROM comments m LEFT JOIN clips c ON c.id=m.clip_id LEFT JOIN channels ch ON ch.id=c.channel_id
        ORDER BY m.created DESC LIMIT 500`).all();
      const out = rows.map(row => ({
        id: row.id, clipId: row.clip_id, clipTitle: row.title || 'a deleted video', channel: row.channel || '', kid: book.kids(row.channel),
        name: row.name, email: row.email, body: row.body, created: row.created,
        status: !row.hidden ? 'showing' : row.last === 'hide' ? 'hidden' : 'waiting',
      }));
      return { comments: status === 'all' ? out : out.filter(row => row.status === status), mode: settings.get('comments_default') };
    },

    async 'POST /api/admin/comments/moderate'(req) {
      const user = await staff(req);
      const body = await readJson(req);
      const id = String(body.id || '');
      const row = id.length <= 80 && sqlite.prepare('SELECT m.id, m.clip_id, c.title, ch.slug FROM comments m LEFT JOIN clips c ON c.id=m.clip_id LEFT JOIN channels ch ON ch.id=c.channel_id WHERE m.id=?').get(id);
      if (!row) throw new HttpError(404, 'That comment is gone. Reload the page.');
      const action = String(body.action || '');
      if (action === 'approve') sqlite.prepare('UPDATE comments SET hidden=0 WHERE id=?').run(id);
      else if (action === 'hide') sqlite.prepare('UPDATE comments SET hidden=1 WHERE id=?').run(id);
      else if (action === 'delete') sqlite.prepare('DELETE FROM comments WHERE id=?').run(id);
      else throw new HttpError(400, 'Choose show, hide or delete.');
      log(user.email, 'comment', id, { action, title: row.title || '', clip: row.clip_id, channel: row.slug || '' });
      return { action };
    },

    async 'GET /api/admin/people'(req) {
      await staff(req, { owner: true });
      const seenAt = lastSeen();
      const rows = sqlite.prepare(`SELECT a.email, a.first, a.last, a.status, a.role, a.created, ch.slug AS channel
        FROM accounts a LEFT JOIN channels ch ON ch.id=a.channel_id ORDER BY (a.status='pending') DESC, a.created`).all();
      return { people: rows.map(row => ({ email: row.email, first: row.first, last: row.last, name: fullName(row) || row.email,
        status: row.status, role: row.role || '', channel: row.channel || null, created: row.created, lastSeen: seenAt.get(row.email) || null })) };
    },

    async 'POST /api/admin/people/status'(req) {
      const user = await staff(req, { owner: true });
      const body = await readJson(req);
      const person = needPerson(body.target);
      const status = String(body.status || '');
      const result = await delegate(user, '/api/admin/status', { target: person.email, status });
      log(user.email, 'person', person.email, { action: status, target: person.email, name: fullName(person) });
      return { mailed: !!result.mailed };
    },

    async 'POST /api/admin/people/role'(req) {
      const user = await staff(req, { owner: true });
      const body = await readJson(req);
      const person = needPerson(body.target);
      const role = String(body.role || '');
      if (!['', 'admin'].includes(role)) throw new HttpError(400, 'Choose viewer or co-parent.');
      if (person.role === 'kid' || person.role === 'super') throw new HttpError(400, 'This account\'s role is set elsewhere.');
      await delegate(user, '/api/admin/role', { target: person.email, role });
      log(user.email, 'person', person.email, { action: 'role', role, target: person.email, name: fullName(person) });
      return { role };
    },

    async 'POST /api/admin/people/password'(req) {
      const user = await staff(req, { owner: true });
      const body = await readJson(req);
      const person = needPerson(body.target);
      await delegate(user, '/api/admin/password', { target: person.email, pass: String(body.pass || '') });
      log(user.email, 'person', person.email, { action: 'password', target: person.email, name: fullName(person) });
      return {};
    },

    // Removes a person and what they added: hearts, comments, watch history, queued emails and unused guest codes.
    async 'POST /api/admin/people/delete'(req) {
      const user = await staff(req, { owner: true });
      const body = await readJson(req);
      const person = needPerson(body.target);
      if (person.email === user.email) throw new HttpError(400, 'You can\'t remove your own account.');
      removePerson(person.email);
      // The record of the removal names nobody, like the rows erasePerson rewrote.
      log(user.email, 'person', 'someone', { action: 'delete', name: 'someone' });
      return {};
    },

    async 'GET /api/admin/kids'(req) {
      await staff(req, { owner: true });
      const clips = new Map(sqlite.prepare('SELECT channel_id, COUNT(*) n FROM clips GROUP BY channel_id').all().map(row => [row.channel_id, row.n]));
      return { kids: family.listKids().map(kid => ({ ...kid, videos: clips.get(kid.id) || 0 })), reviewDefault: settings.get('review_uploads_default') };
    },

    async 'POST /api/admin/kids'(req) {
      const user = await staff(req, { owner: true });
      const kid = await family.saveKid(await readJson(req), user.email);
      return { kid };
    },

    async 'POST /api/admin/kids/order'(req) {
      const user = await staff(req, { owner: true });
      const body = await readJson(req);
      const ids = Array.isArray(body.order) ? body.order.map(Number) : [];
      const all = listChannels(sqlite).map(row => row.id);
      if (ids.length !== all.length || new Set(ids).size !== ids.length || ids.some(id => !all.includes(id))) throw new HttpError(400, 'Reload the page and try again.');
      const set = sqlite.prepare('UPDATE channels SET position=? WHERE id=?');
      sqlite.exec('BEGIN IMMEDIATE');
      try { ids.forEach((id, index) => set.run(index + 1, id)); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      log(user.email, 'channel', 'order', { action: 'order', order: ids });
      return {};
    },

    // A kid goes with their videos, their login and passes made just for them. The first channel stays.
    async 'POST /api/admin/kids/delete'(req) {
      const user = await staff(req, { owner: true });
      const body = await readJson(req);
      const kid = channelById(sqlite, Number(body.id));
      if (!kid) throw new HttpError(404, 'That kid was already removed.');
      if (kid.id === DEFAULT_CHANNEL_ID) throw new HttpError(409, 'The first kid can be renamed but not removed.');
      if (listChannels(sqlite).length <= 1) throw new HttpError(409, 'A family keeps at least one kid.');
      const clips = sqlite.prepare('SELECT id, src, title FROM clips WHERE channel_id=?').all(kid.id);
      for (const login of sqlite.prepare("SELECT email FROM accounts WHERE role='kid' AND channel_id=?").all(kid.id)) removePerson(login.email);
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        for (const clip of clips) {
          sqlite.prepare('DELETE FROM clips WHERE id=?').run(clip.id);
          log(user.email, 'clip', clip.id, { action: 'delete', title: clip.title, channel: kid.slug });
          const media = /^\/api\/media\/([A-Za-z0-9-]{8,80})$/.exec(clip.src || '');
          if (media) { sqlite.prepare('DELETE FROM media WHERE id=?').run(media[1]); sqlite.prepare('DELETE FROM media_chunks WHERE id=?').run(media[1]); }
        }
        sqlite.prepare('DELETE FROM guest_codes WHERE channel_id=?').run(kid.id);
        sqlite.exec('COMMIT');
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      for (const clip of clips) {
        const local = /^\/api\/video\/([a-f0-9-]{36})$/.exec(clip.src || '');
        if (local && env.deleteLocalVideo) await env.deleteLocalVideo(local[1]);
      }
      // removeKid writes the channel's own activity row.
      await family.removeKid(kid.id, user.email);
      return { videos: clips.length };
    },

    async 'GET /api/admin/guests'(req) {
      await staff(req);
      const book = nameBook();
      const at = now();
      const seenAt = lastSeen();
      const rows = sqlite.prepare(`SELECT g.*, ch.slug FROM guest_codes g LEFT JOIN channels ch ON ch.id=g.channel_id
        ORDER BY g.created DESC LIMIT 50`).all();
      return {
        enabled: settings.get('guest_passes') === true,
        codes: rows.map(row => {
          const id = row.code_hash.slice(0, 12);
          const cancelled = !!sqlite.prepare("SELECT 1 FROM activity WHERE kind='guest' AND subject=? AND json_extract(detail,'$.action')='end'").get(id);
          const state = row.redeemed == null ? (row.expires > at ? 'waiting' : cancelled ? 'cancelled' : 'expired') : row.session_expires > at ? 'active' : 'ended';
          return { id, created: row.created, creator: row.creator, creatorName: book.names(row.creator), expires: row.expires,
            redeemed: row.redeemed, sessionExpires: row.session_expires, scope: row.slug || null, scopeName: book.kids(row.slug) || null,
            note: guestNote(id), state, viewer: row.token_hash ? 'guest:' + row.token_hash.slice(0, 12) : null, lastUsed: row.token_hash ? seenAt.get('guest:' + row.token_hash.slice(0, 12)) || row.redeemed : null };
        }),
      };
    },

    async 'POST /api/admin/guests'(req) {
      const user = await staff(req);
      const body = await readJson(req);
      const note = String(body.note || '').trim().slice(0, 40);
      const channel = String(body.channel || '');
      const result = await delegate(user, '/api/guest/generate', channel ? { channel } : {});
      const id = hmac('guest-code|' + result.code).slice(0, 12);
      log(user.email, 'guest', id, { action: 'create', note, channel: result.scope || '' });
      return { code: result.code, expires: result.expires, scope: result.scope, id, note };
    },

    async 'POST /api/admin/guests/end'(req) {
      const user = await staff(req);
      const body = await readJson(req);
      const id = String(body.id || '');
      const row = /^[a-f0-9]{12}$/.test(id) && sqlite.prepare('SELECT code_hash FROM guest_codes WHERE substr(code_hash,1,12)=?').get(id);
      if (!row) throw new HttpError(404, 'That code is gone. Reload the page.');
      const at = now();
      sqlite.prepare('UPDATE guest_codes SET expires=MIN(expires,?), session_expires=CASE WHEN session_expires IS NULL THEN NULL ELSE MIN(session_expires,?) END WHERE code_hash=?')
        .run(at, at, row.code_hash);
      log(user.email, 'guest', id, { action: 'end', note: guestNote(id) });
      return {};
    },

    async 'GET /api/admin/settings'(req) {
      await staff(req, { owner: true });
      return { settings: settings.describe().filter(entry => EDITABLE.includes(entry.key)), production: process.env.NODE_ENV === 'production' };
    },

    // Saves the settings given; locked ones (set in the environment) are skipped and named in the answer.
    async 'POST /api/admin/settings'(req) {
      const user = await staff(req, { owner: true });
      const body = await readJson(req);
      const values = body.values && typeof body.values === 'object' ? body.values : {};
      const keys = Object.keys(values);
      const unknown = keys.filter(key => !EDITABLE.includes(key));
      if (unknown.length) throw new HttpError(400, `Unknown setting ${unknown[0]}.`);
      const changes = {};
      for (const key of keys) {
        let value = values[key];
        if (key === 'brevo_api_key' && (value === '' || value === '********')) continue;
        if (key === 'site_name' && !String(value || '').trim()) throw new HttpError(400, 'Add a family name.');
        if (key === 'site_url') {
          try { value = new URL(String(value)).origin; } catch { throw new HttpError(400, 'Use a web address like https://videos.example.com.'); }
          try { checkSiteUrl(value); } catch (error) { if (error instanceof InstallError) throw new HttpError(400, error.message); throw error; }
        }
        changes[key] = value;
      }
      const skipped = Object.keys(changes).filter(locked);
      for (const key of skipped) delete changes[key];
      const mode = changes.mail_mode ?? settings.get('mail_mode');
      if (mode === 'brevo') {
        if (!changes.brevo_api_key && !settings.get('brevo_api_key')) throw new HttpError(400, 'Paste your Brevo API key.');
        for (const [key, label] of [['sender_email', 'the sender address'], ['notify_email', 'where to send notices']]) {
          if (!(changes[key] ?? settings.get(key))) throw new HttpError(400, `Add ${label}.`);
        }
      }
      // Only real changes are saved, so the activity feed lists what the parent actually changed.
      const same = (key, value) => { try { return JSON.stringify(settings.get(key)) === JSON.stringify(value); } catch { return false; } };
      for (const [key, value] of Object.entries(changes)) if (!same(key, value)) settings.set(key, value, user.email);
      return { settings: settings.describe().filter(entry => EDITABLE.includes(entry.key)), skipped };
    },

    async 'POST /api/admin/settings/email-test'(req) {
      const user = await staff(req, { owner: true });
      if (settings.get('mail_mode') !== 'brevo') throw new HttpError(400, 'Turn email on and save first.');
      const to = settings.get('notify_email');
      try {
        await sendMail(env, { email: to }, `${BRAND_NAME} test email`,
          `<p>This is a test from ${BRAND_NAME}. Email works.</p>`, `This is a test from ${BRAND_NAME}. Email works.`);
      } catch (error) {
        console.error('Test email failed:', error);
        throw new HttpError(502, `The email service said no${error.status ? ` (HTTP ${error.status})` : ''}. Check the key and that the sender address is verified in Brevo.`);
      }
      log(user.email, 'email', 'test', { action: 'test', to });
      return { to };
    },
  };

  function needPerson(target) {
    const email = String(target || '').trim().toLowerCase();
    const person = EMAIL.test(email) && sqlite.prepare('SELECT * FROM accounts WHERE email=?').get(email);
    if (!person) throw new HttpError(404, 'That person is gone. Reload the page.');
    return person;
  }

  function removePerson(email) {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      erasePerson(sqlite, email);
      sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    seen.delete(email);
  }

  async function answer(req, res, route, url) {
    try {
      const result = await route(req, url);
      json(res, 200, { ok: true, ...result });
    } catch (error) {
      if (res.headersSent) { res.destroy(error); return; }
      if (error instanceof HttpError) return json(res, error.status, { ok: false, error: error.message });
      if (error instanceof FamilyError) return json(res, error.status, { ok: false, error: error.message });
      if (error instanceof SettingError) return json(res, 400, { ok: false, error: error.message });
      console.error('Dashboard request failed', error);
      json(res, 500, { ok: false, error: 'Something went wrong. Try again.' });
    }
  }

  // Answers the request and returns true when the dashboard owns it; otherwise the normal routes run.
  function handle(req, res, pathname) {
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const route = routes[`${method} ${pathname}`];
    if (route) { answer(req, res, route, new URL(req.url, 'http://localhost')); return true; }
    if (Object.keys(routes).some(key => key.endsWith(' ' + pathname))) { json(res, 405, { ok: false, error: 'Method not allowed.' }); return true; }
    // Kid and viewer accounts never reach the dashboard; signed-out parents get its sign-in card.
    if (pathname === '/parents' && method === 'GET') {
      const who = cookieViewer(req, sqlite, env);
      if (who && !isStaff(who)) { res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' }).end(); return true; }
    }
    if ((pathname === '/api/me' || pathname === '/api/clips') && method === 'GET') {
      try { touch(req); } catch (error) { console.error('Could not note last seen', error); }
    }
    return false;
  }

  prune();
  const daily = setInterval(() => { try { prune(); } catch (error) { console.error('Retention prune failed', error); } }, DAY);
  daily.unref?.();
  const hourly = setInterval(() => { try { pruneAddresses(); } catch (error) { console.error('Address prune failed', error); } }, 60 * 60 * 1000);
  hourly.unref?.();

  return { handle, prune, pruneAddresses, feed, touch, storage, close: () => { clearInterval(daily); clearInterval(hourly); } };
}
