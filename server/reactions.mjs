// Reactions: five stickers a signed-in viewer can toggle on a clip, next to the heart. Each kind is the id
// of a vendored Fluent sticker in public/badge/stickers.json, so the feed draws them with the badge paths.
// Guests watch only; sealed clips take none. No emails or activity rows, just counts.
import { HttpError, answer, rateLimit, readJson, sendJson } from './jsonio.mjs';
import { sessOk } from './api.js';
import { CLIP_ACCESS_SQL, canPlayClip, canViewChannel, isClipId } from './channels.mjs';
import { sealedFor } from './capsules.mjs';

export const KINDS = ['wow', 'flame', 'star', 'party', 'cool'];
export const RATE_LIMIT = 60;
export const RATE_WINDOW_MS = 60 * 1000;

export function createReactions({ sqlite, env, now = Date.now }) {
  // Per account: 60 writes a minute is far beyond tapping, well under a script.
  const limited = rateLimit({ limit: RATE_LIMIT, windowMs: RATE_WINDOW_MS });
  const visible = `JOIN clips c ON c.id=r.clip_id WHERE c.hidden=0 AND c.review='approved' AND c.opens_at<=?`;

  const countsFor = clipId => Object.fromEntries(sqlite.prepare('SELECT kind, COUNT(*) n FROM reactions WHERE clip_id=? GROUP BY kind').all(clipId)
    .map(row => [row.kind, row.n]));

  // { counts: { <clipId>: { wow: 3 } }, mine: { <clipId>: ['wow'] } } for the clips this viewer may watch.
  function list(who) {
    const at = now();
    const counts = {}, mine = {};
    for (const row of sqlite.prepare(`SELECT r.clip_id, r.kind, c.channel_id, COUNT(*) n FROM reactions r ${visible} GROUP BY r.clip_id, r.kind`).all(at)) {
      if (!canViewChannel(who, { id: row.channel_id })) continue;
      (counts[row.clip_id] ??= {})[row.kind] = row.n;
    }
    if (who?.email) {
      for (const row of sqlite.prepare(`SELECT r.clip_id, r.kind FROM reactions r ${visible} AND r.email=?`).all(at, who.email)) {
        if (counts[row.clip_id]) (mine[row.clip_id] ??= []).push(row.kind);
      }
    }
    return { ok: true, counts, mine };
  }

  async function react(req, who) {
    const body = await readJson(req);
    const kind = String(body.kind || '');
    if (!KINDS.includes(kind)) throw new HttpError(400, 'Pick one of the reaction stickers.');
    if (who?.role === 'guest') throw new HttpError(401, 'log in to react');
    const email = await sessOk(env, String(body.email || '').trim().toLowerCase(), String(body.t || ''));
    if (!email) throw new HttpError(401, 'log in to react');
    const clipId = String(body.clipId || '');
    if (!isClipId(clipId)) throw new HttpError(400, 'Choose a video.');
    const viewer = { email, role: sqlite.prepare('SELECT role FROM accounts WHERE email=?').get(email)?.role || '' };
    if (!canPlayClip(viewer, sqlite.prepare(`${CLIP_ACCESS_SQL} WHERE c.id=?`).get(clipId))) throw new HttpError(404, 'That video is gone.');
    const at = now();
    const sealed = sealedFor(sqlite, clipId, viewer, at);
    if (sealed) throw new HttpError(403, 'sealed', { opensAt: sealed.opensAt });
    if (limited(email, at)) throw new HttpError(429, 'Slow down a little.');
    if (body.on) sqlite.prepare('INSERT OR IGNORE INTO reactions (clip_id,email,kind,created) VALUES (?,?,?,?)').run(clipId, email, kind, at);
    else sqlite.prepare('DELETE FROM reactions WHERE clip_id=? AND email=? AND kind=?').run(clipId, email, kind);
    return { ok: true, kind, on: !!body.on, counts: countsFor(clipId) };
  }

  // Per clip, for the dashboard overview: { <clipId>: { wow: 2, flame: 1 } }.
  function totals() {
    const out = {};
    for (const row of sqlite.prepare('SELECT clip_id, kind, COUNT(*) n FROM reactions GROUP BY clip_id, kind').all()) (out[row.clip_id] ??= {})[row.kind] = row.n;
    return out;
  }

  function handle(req, res, pathname, who) {
    if (pathname === '/api/reactions' && req.method === 'GET') { answer(res, async () => sendJson(res, 200, list(who))); return true; }
    if (pathname === '/api/react' && req.method === 'POST') { answer(res, async () => sendJson(res, 200, await react(req, who))); return true; }
    return false;
  }

  return { handle, list, totals };
}
