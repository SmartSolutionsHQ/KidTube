// Time capsules: a clip sealed until a date. It keeps its place in the channel as a locked tape, and its
// video, poster, comments, likes and reactions stay closed to everyone but parents until it opens. A clip
// is sealed while opens_at is in the future, read from the clock on every request, so a late or missed
// tick can never open one early. The tick only does the opening ceremony: lead the channel, announce, log.
import { HttpError, answer, readJson, sendJson, staffFor } from './jsonio.mjs';
import { isStaff } from './channels.mjs';

export const MIN_LEAD_MS = 60 * 60 * 1000;
export const MAX_LEAD_MS = Math.round(25 * 365.25 * 86400000);
export const NOTE_MAX = 140;
export const TICK_MS = 60 * 1000;
const CLIP_OK = /^[A-Za-z0-9_-]{1,80}$/;

// opensAt in ms: at least an hour and at most 25 years away, on a whole minute. The note is optional.
export function validateSeal(opensAt, note, now = Date.now()) {
  const fail = error => ({ ok: false, error });
  const at = typeof opensAt === 'string' && /^\d+$/.test(opensAt) ? Number(opensAt) : opensAt;
  if (!Number.isSafeInteger(at)) return fail('Pick a date and time for it to open.');
  if (at < now + MIN_LEAD_MS) return fail('Pick a date at least an hour away.');
  if (at > now + MAX_LEAD_MS) return fail('Pick a date within the next 25 years.');
  if (at % 60000 !== 0) return fail('Pick a time on a whole minute.');
  const text = String(note ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  if (/\p{C}/u.test(text)) return fail('The note has characters that cannot be shown.');
  if ([...text].length > NOTE_MAX) return fail(`Keep the note to ${NOTE_MAX} characters.`);
  return { ok: true, opensAt: at, note: text };
}

// The one place the sealed rule lives: null when the caller may see the clip, else { opensAt }.
export function sealedFor(sqlite, clipId, viewer, now = Date.now()) {
  if (isStaff(viewer)) return null;
  const row = sqlite.prepare('SELECT opens_at FROM clips WHERE id=?').get(String(clipId));
  return row && row.opens_at > now ? { opensAt: row.opens_at } : null;
}

const logActivity = (sqlite, actor, kind, subject, detail) => sqlite.prepare(
  'INSERT INTO activity (ts,actor,kind,subject,detail) VALUES (?,?,?,?,?)').run(Date.now(), actor, kind, subject, JSON.stringify(detail));

// Opens one due clip inside the caller's transaction: it leads its channel and the new-video email goes
// out with the capsule subject. publish.mjs calls this when a parent approves a clip whose date passed.
export function openCapsule(sqlite, notifications, clip, now = Date.now(), actor = 'system') {
  sqlite.prepare('UPDATE clips SET position=position+1 WHERE channel_id=? AND id<>?').run(clip.channel_id, clip.id);
  sqlite.prepare('UPDATE clips SET position=1, opened_at=? WHERE id=?').run(now, clip.id);
  if (!clip.hidden) {
    notifications.enqueue({ id: clip.id, title: clip.title, blurb: clip.blurb, duration: clip.duration, kind: clip.kind,
      publishedAt: clip.published, channelId: clip.channel_id, capsule: true, capsuleNote: clip.capsule_note || '' });
  }
  logActivity(sqlite, actor, 'capsule.open', clip.id, { opensAt: clip.opens_at });
}

const DUE = `SELECT * FROM clips WHERE opens_at>0 AND opens_at<=? AND opened_at=0 AND review='approved' AND hidden=0`;

export function createCapsules({ sqlite, notifications, env, now = Date.now }) {
  const firstName = sqlite.prepare('SELECT first FROM accounts WHERE email=?');
  let timer = null;

  // Opens every clip whose date has passed (or just clipId), each in its own write transaction.
  function tick(at = now(), clipId = null) {
    const due = clipId ? sqlite.prepare(`${DUE} AND id=?`).all(at, clipId) : sqlite.prepare(DUE).all(at);
    const opened = [];
    for (const { id } of due) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        // Another process may have opened it between the scan and the lock.
        const clip = sqlite.prepare(`${DUE} AND id=?`).get(at, id);
        if (clip) { openCapsule(sqlite, notifications, clip, at); opened.push(id); }
        sqlite.exec('COMMIT');
      } catch (error) { sqlite.exec('ROLLBACK'); console.error(`Capsule ${id} could not open:`, error); }
    }
    if (opened.length) notifications.kick();
    return opened;
  }

  function start() {
    tick();
    timer = setInterval(() => tick(), TICK_MS);
    timer.unref();
  }
  const stop = () => clearInterval(timer);

  // Parents seal an approved clip (again, to change the date or note) or open it now.
  function seal(id, opensAt, note, actor, at = now()) {
    const check = validateSeal(opensAt, note, at);
    if (!check.ok) throw new HttpError(400, check.error);
    const clip = sqlite.prepare('SELECT id, review FROM clips WHERE id=?').get(id);
    if (!clip) throw new HttpError(404, 'That video is gone.');
    if (clip.review !== 'approved') throw new HttpError(409, 'Approve the video before sealing it.');
    sqlite.prepare('UPDATE clips SET opens_at=?, opened_at=0, sealed_by=?, capsule_note=? WHERE id=?').run(check.opensAt, actor, check.note, id);
    logActivity(sqlite, actor, 'capsule.seal', id, { opensAt: check.opensAt });
    return describe(id, at);
  }

  function unseal(id, actor, at = now()) {
    const clip = sqlite.prepare('SELECT opens_at FROM clips WHERE id=?').get(id);
    if (!clip) throw new HttpError(404, 'That video is gone.');
    if (!(clip.opens_at > at)) throw new HttpError(409, 'That video is not sealed.');
    sqlite.prepare('UPDATE clips SET opens_at=? WHERE id=?').run(at, id);
    logActivity(sqlite, actor, 'capsule.unseal', id, { opensAt: clip.opens_at });
    // Opened through the same path as a date passing, so it also leads the channel and is announced.
    tick(at, id);
    return describe(id, at);
  }

  // What the feed may show about a sealed clip: never its media, length, blurb or kind.
  function lockedFields(row) {
    return { sealed: true, opensAt: row.opens_at, capsuleNote: row.capsule_note || '', sealedBy: row.sealed_by ? (firstName.get(row.sealed_by)?.first || '') : '' };
  }

  function describe(id, at = now()) {
    const row = sqlite.prepare(`SELECT c.id, c.title, c.review, c.hidden, c.opens_at, c.opened_at, c.capsule_note, c.sealed_by, ch.slug AS channel
      FROM clips c LEFT JOIN channels ch ON ch.id=c.channel_id WHERE c.id=?`).get(id);
    if (!row) return null;
    return { id: row.id, title: row.title, channel: row.channel || '', review: row.review, hidden: !!row.hidden,
      sealed: row.opens_at > at, opensAt: row.opens_at, openedAt: row.opened_at, capsuleNote: row.capsule_note || '',
      sealedBy: row.sealed_by ? (firstName.get(row.sealed_by)?.first || row.sealed_by) : '' };
  }

  const refusal = opensAt => new Response(JSON.stringify({ ok: false, error: 'sealed', opensAt }),
    { status: 403, headers: { 'content-type': 'application/json' } });

  // api.js asks this before its own routes: comments, likes and legacy media of a sealed clip are refused.
  async function guard(req, p, viewer, at = now()) {
    let clipId = '';
    if (p === '/api/comments') clipId = new URL(req.url).searchParams.get('c') || '';
    else if (req.method === 'POST' && (p === '/api/comment' || p === '/api/like')) clipId = (await req.clone().json().catch(() => null))?.clipId || '';
    else if (p.startsWith('/api/media/')) clipId = sqlite.prepare('SELECT id FROM clips WHERE src=?').get(p)?.id || '';
    if (!clipId || !CLIP_OK.test(String(clipId))) return null;
    const sealed = sealedFor(sqlite, clipId, viewer, at);
    return sealed ? refusal(sealed.opensAt) : null;
  }

  // Counts keyed by clip id (GET /api/likes) leave sealed clips out.
  async function omitSealed(response, at = now()) {
    if (!response.ok) return response;
    const body = await response.json();
    const sealed = new Set(sqlite.prepare('SELECT id FROM clips WHERE opens_at>?').all(at).map(row => row.id));
    for (const key of ['counts', 'liked', 'mine']) if (body[key]) for (const id of sealed) delete body[key][id];
    return new Response(JSON.stringify(body), { status: response.status, headers: { 'content-type': 'application/json' } });
  }

  // /api/video/<id> and its poster: the media gate uploads.mjs calls through canWatch.
  function mediaRefusal(viewer, clipId, at = now()) {
    const sealed = sealedFor(sqlite, clipId, viewer, at);
    return sealed ? { error: 'sealed', opensAt: sealed.opensAt } : null;
  }

  function handle(req, res, pathname, who) {
    if (pathname === '/api/admin/clips/seal' && req.method === 'POST') {
      answer(res, async () => {
        const body = await readJson(req);
        const staff = await staffFor(env, req, who, body);
        if (!staff) throw new HttpError(403, 'Sign in as a parent.');
        const id = String(body.id || '');
        if (!CLIP_OK.test(id)) throw new HttpError(400, 'Choose a video.');
        sendJson(res, 200, { ok: true, clip: seal(id, body.opensAt, body.note, staff.email) });
      });
      return true;
    }
    if (pathname === '/api/admin/clips/unseal' && req.method === 'POST') {
      answer(res, async () => {
        const body = await readJson(req);
        const staff = await staffFor(env, req, who, body);
        if (!staff) throw new HttpError(403, 'Sign in as a parent.');
        const id = String(body.id || '');
        if (!CLIP_OK.test(id)) throw new HttpError(400, 'Choose a video.');
        sendJson(res, 200, { ok: true, clip: unseal(id, staff.email) });
      });
      return true;
    }
    // Every clip that has had a date: GET /api/admin/capsules[?channel=<slug>][&id=<clip>]
    if (pathname === '/api/admin/capsules' && req.method === 'GET') {
      answer(res, async () => {
        if (!await staffFor(env, req, who)) throw new HttpError(403, 'Sign in as a parent.');
        const url = new URL(req.url, 'http://localhost');
        const channel = url.searchParams.get('channel'), id = url.searchParams.get('id');
        const rows = sqlite.prepare(`SELECT c.id FROM clips c LEFT JOIN channels ch ON ch.id=c.channel_id
          WHERE c.opens_at>0 ${channel ? 'AND ch.slug=?' : ''} ${id ? 'AND c.id=?' : ''} ORDER BY c.opens_at`).all(...[channel, id].filter(Boolean));
        const at = now();
        sendJson(res, 200, { ok: true, now: at, capsules: rows.map(row => describe(row.id, at)) });
      });
      return true;
    }
    return false;
  }

  return { tick, start, stop, seal, unseal, describe, lockedFields, guard, omitSealed, mediaRefusal, handle };
}
