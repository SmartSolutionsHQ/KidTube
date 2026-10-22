// End of tape: the watch log and honest daily budgets. The feed starts a view after a few seconds of play
// and reports watched seconds every 15 s (and on pause, swipe and hide); the server never credits more than
// the wall time since the last report plus a little slack. A budgeted account whose tape for the family's
// day is spent gets its video refused until local midnight. Parents, Family and guests are never limited.
// The log stores who, what, when and how long: no IP address, no user agent. Rows older than
// views_retention_days are pruned at boot and daily. GET /api/admin/views reads it for "Who watched".
import { HttpError, answer, readJson, sendJson, staffFor } from './jsonio.mjs';
import { CLIP_ACCESS_SQL, canPlayClip } from './channels.mjs';
import { sealedFor } from './capsules.mjs';
import { SERVER_TIMEZONE } from './settings.mjs';

export const BUDGET_CHOICES = [0, 15, 30, 45, 60, 90, 120, 180];
export const BONUS_MIN = 15;
export const BONUS_MAX = 120;
export const BEAT_SLACK_S = 2;
// A view starts after a few seconds of play; those seconds count too, up to this many.
export const START_CREDIT_S = 5;
export const PRUNE_MS = 24 * 60 * 60 * 1000;
const START_LIMIT = 240;
const VIEW_OPEN_MS = 12 * 60 * 60 * 1000;
const STAFF_ROLES = new Set(['admin', 'super']);
const EMAIL_OK = value => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length < 120;
const CLIP_OK = /^[A-Za-z0-9_-]{1,80}$/;
const MINUTE = 60000;

const formatters = new Map();
function dateFormat(timezone) {
  if (!formatters.has(timezone)) formatters.set(timezone, new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }));
  return formatters.get(timezone);
}

// The family's calendar day for an instant, as YYYY-MM-DD.
export function dayKey(now, timezone) {
  const parts = Object.fromEntries(dateFormat(timezone).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// The first whole minute in (lo, hi] where test turns true. Zone offsets are whole minutes, so local
// midnight always falls on one, including on DST days and in zones where midnight itself is skipped.
function firstMinute(lo, hi, test) {
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (test(mid * MINUTE)) hi = mid; else lo = mid;
  }
  return hi * MINUTE;
}

// The next local midnight after now, in ms.
export function resetsAt(now, timezone) {
  const today = dayKey(now, timezone), minute = Math.floor(now / MINUTE);
  return firstMinute(minute, minute + 48 * 60, time => dayKey(time, timezone) !== today);
}

// The local midnight that started today, in ms.
export function dayStart(now, timezone) {
  const today = dayKey(now, timezone), minute = Math.floor(now / MINUTE);
  return firstMinute(minute - 48 * 60, minute, time => dayKey(time, timezone) === today);
}

const displayName = (first, last) => `${String(first || '').trim()}${String(last || '').trim() ? ` ${String(last).trim()[0].toUpperCase()}.` : ''}`.trim();

export function createWatch({ sqlite, settings, env, now = Date.now }) {
  const starts = new Map();
  let timer = null;
  const timezone = () => settings.get('family_timezone');
  const log = (actor, kind, subject, detail) => sqlite.prepare('INSERT INTO activity (ts,actor,kind,subject,detail) VALUES (?,?,?,?,?)')
    .run(now(), actor, kind, subject, JSON.stringify(detail));

  // Today's watching for any account: seconds used and bonus minutes granted, in the family's day.
  function today(email, at = now()) {
    const zone = timezone();
    const start = dayStart(at, zone), end = resetsAt(at, zone);
    const used = sqlite.prepare('SELECT COALESCE(SUM(seconds),0) s FROM views WHERE viewer=? AND started>=? AND started<?').get(email, start, end).s;
    const bonus = sqlite.prepare('SELECT COALESCE(SUM(minutes),0) m FROM watch_bonus WHERE email=? AND day=?').get(email, dayKey(at, zone)).m;
    return { used, bonus, start, resetsAt: end };
  }

  // null for an account without a daily tape; otherwise seconds: { limit, used, remaining, resetsAt }.
  function budgetFor(email, at = now()) {
    if (!email) return null;
    const account = sqlite.prepare('SELECT role, status, watch_budget_minutes m FROM accounts WHERE email=?').get(email);
    if (!account || account.status !== 'approved' || STAFF_ROLES.has(account.role) || !account.m) return null;
    const day = today(email, at);
    const limit = (account.m + day.bonus) * 60;
    return { limit, used: day.used, remaining: Math.max(0, limit - day.used), resetsAt: day.resetsAt };
  }

  // The media gate's budget half: posters always load, video stops when the tape is spent.
  function canWatch(viewer, at = now()) {
    const budget = budgetFor(viewer?.email, at);
    return !budget || budget.remaining > 0 ? true : { error: 'end-of-tape', resetsAt: budget.resetsAt };
  }

  // budget.end goes in the activity log once per account per family day.
  function noteEnd(email, budget, at) {
    if (!budget || budget.remaining > 0) return;
    const start = dayStart(at, timezone());
    if (sqlite.prepare("SELECT 1 FROM activity WHERE kind='budget.end' AND subject=? AND ts>=?").get(email, start)) return;
    log(email, 'budget.end', email, { day: dayKey(at, timezone()), limit: budget.limit });
  }

  const viewerKey = who => who?.email || (who?.guestId ? `guest:${who.guestId}` : '');

  async function startView(req, who) {
    const body = await readJson(req);
    const key = viewerKey(who);
    if (!key) throw new HttpError(401, 'Log in to view this channel.');
    const clipId = String(body.clipId || '');
    if (!CLIP_OK.test(clipId)) throw new HttpError(400, 'Choose a video.');
    const clip = sqlite.prepare(`${CLIP_ACCESS_SQL} WHERE c.id=?`).get(clipId);
    if (!canPlayClip(who, clip)) throw new HttpError(404, 'That video is gone.');
    const at = now();
    const sealed = sealedFor(sqlite, clipId, who, at);
    if (sealed) throw new HttpError(403, 'sealed', { opensAt: sealed.opensAt });
    const budget = budgetFor(who.email, at);
    if (budget && budget.remaining <= 0) { noteEnd(who.email, budget, at); throw new HttpError(403, 'end-of-tape', { resetsAt: budget.resetsAt, budget }); }
    const recent = (starts.get(key) || []).filter(time => time > at - 3600000);
    if (starts.size > 5000) starts.clear();
    recent.push(at);
    starts.set(key, recent);
    if (recent.length > START_LIMIT) throw new HttpError(429, 'Slow down a little.');
    const credit = Math.floor(Math.min(START_CREDIT_S, Math.max(0, Number(body.seconds) || 0)));
    const viewId = Number(sqlite.prepare('INSERT INTO views (clip_id,channel_id,viewer,started,updated,seconds) VALUES (?,?,?,?,?,?)')
      .run(clipId, clip.channel_id, key, at, at, credit).lastInsertRowid);
    return { ok: true, viewId, budget: credit ? budgetFor(who.email, at) : budget };
  }

  // seconds is what the viewer watched since its last report; the server adds at most the wall time
  // since then plus BEAT_SLACK_S, so a client cannot bank time it has not spent.
  async function beat(req, who) {
    const body = await readJson(req);
    const key = viewerKey(who);
    if (!key) throw new HttpError(401, 'Log in to view this channel.');
    const row = sqlite.prepare('SELECT id, viewer, started, updated FROM views WHERE id=?').get(Number(body.viewId) || 0);
    if (!row || row.viewer !== key) throw new HttpError(404, 'That view is gone.');
    const at = now();
    if (at - row.started > VIEW_OPEN_MS) throw new HttpError(409, 'Start the video again.');
    const claimed = Math.max(0, Number(body.seconds) || 0);
    const add = Math.floor(Math.min(claimed, Math.max(0, at - row.updated) / 1000 + BEAT_SLACK_S));
    sqlite.prepare('UPDATE views SET seconds=seconds+?, updated=?, completed=MAX(completed,?) WHERE id=?').run(add, at, body.completed ? 1 : 0, row.id);
    const budget = budgetFor(who.email, at);
    if (budget) noteEnd(who.email, budget, at);
    return { ok: true, added: add, budget };
  }

  // "Who watched", newest first: ?channel=<slug>&viewer=<email|guest:…>&before=<started ms>&limit=
  function views(url) {
    const channel = url.searchParams.get('channel') || '';
    const viewer = url.searchParams.get('viewer') || '';
    const before = Number(url.searchParams.get('before')) || 0;
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
    const where = [], params = [];
    if (channel) { where.push('ch.slug=?'); params.push(channel); }
    if (viewer) { where.push('v.viewer=?'); params.push(viewer.toLowerCase()); }
    if (before) { where.push('v.started<?'); params.push(before); }
    const rows = sqlite.prepare(`SELECT v.clip_id, v.viewer, v.started, v.seconds, v.completed, c.title, c.duration, ch.slug, a.first, a.last
      FROM views v LEFT JOIN clips c ON c.id=v.clip_id LEFT JOIN channels ch ON ch.id=v.channel_id LEFT JOIN accounts a ON a.email=v.viewer
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY v.started DESC, v.id DESC LIMIT ?`).all(...params, limit);
    return {
      ok: true,
      rows: rows.map(row => ({
        clipId: row.clip_id, clipTitle: row.title || '', channel: row.slug || '', viewer: row.viewer,
        viewerName: row.viewer.startsWith('guest:') ? 'Guest' : displayName(row.first, row.last) || row.viewer,
        started: row.started, seconds: row.seconds, duration: row.duration || 0, completed: !!row.completed,
      })),
      next: rows.length === limit ? rows[rows.length - 1].started : null,
    };
  }

  function account(email) {
    const row = sqlite.prepare('SELECT email, first, role, status, watch_budget_minutes m FROM accounts WHERE email=?').get(email);
    if (!row) throw new HttpError(404, 'No account with that email.');
    return row;
  }

  function budgetState(email, at = now()) {
    const row = account(email);
    const day = today(email, at);
    return { ok: true, target: row.email, first: row.first, role: row.role, staff: STAFF_ROLES.has(row.role), minutes: row.m,
      usedToday: day.used, bonusToday: day.bonus, resetsAt: day.resetsAt, budget: budgetFor(email, at), timezone: timezone() };
  }

  async function setBudget(body, staff) {
    const target = String(body.target || '').trim().toLowerCase();
    const minutes = Number(body.minutes);
    if (!EMAIL_OK(target)) throw new HttpError(400, 'Choose an account.');
    if (!BUDGET_CHOICES.includes(minutes)) throw new HttpError(400, `Use one of ${BUDGET_CHOICES.join(', ')} minutes.`);
    const row = account(target);
    if (STAFF_ROLES.has(row.role)) throw new HttpError(400, 'Parents are never limited.');
    sqlite.prepare('UPDATE accounts SET watch_budget_minutes=? WHERE email=?').run(minutes, target);
    log(staff.email, 'budget.set', target, { minutes });
    return budgetState(target);
  }

  async function addBonus(body, staff) {
    const target = String(body.target || '').trim().toLowerCase();
    const minutes = Number(body.minutes);
    if (!EMAIL_OK(target)) throw new HttpError(400, 'Choose an account.');
    if (!Number.isInteger(minutes) || minutes < BONUS_MIN || minutes > BONUS_MAX) throw new HttpError(400, `Add ${BONUS_MIN} to ${BONUS_MAX} minutes.`);
    const row = account(target);
    if (STAFF_ROLES.has(row.role) || !row.m) throw new HttpError(409, 'This account has no daily limit.');
    const at = now();
    const day = dayKey(at, timezone());
    sqlite.prepare('INSERT INTO watch_bonus (email,day,minutes,actor,created) VALUES (?,?,?,?,?)').run(target, day, minutes, staff.email, at);
    log(staff.email, 'budget.bonus', target, { minutes, day });
    return budgetState(target, at);
  }

  async function setTimezone(body, staff) {
    if (settings.describe().find(entry => entry.key === 'family_timezone')?.locked) throw new HttpError(409, 'FAMILY_TIMEZONE is set on the server, so change it there.');
    try { settings.set('family_timezone', body.timezone, staff.email); } catch (error) { throw new HttpError(400, error.message); }
    return clock();
  }

  function clock() {
    const entry = settings.describe().find(item => item.key === 'family_timezone');
    return { ok: true, timezone: entry.value, locked: entry.locked, now: now() };
  }

  function prune(at = now()) {
    const days = Number(settings.get('views_retention_days')) || 90;
    return Number(sqlite.prepare('DELETE FROM views WHERE started<?').run(at - days * 86400000).changes);
  }

  // At first boot the server's zone becomes the family's, stored so a later server move keeps their days.
  function start() {
    if (!process.env.FAMILY_TIMEZONE && !sqlite.prepare("SELECT 1 FROM settings WHERE key='family_timezone'").get()) settings.set('family_timezone', SERVER_TIMEZONE, 'system');
    prune();
    timer = setInterval(() => prune(), PRUNE_MS);
    timer.unref();
  }
  const stop = () => clearInterval(timer);

  function staffRoute(res, req, who, run, { post = true } = {}) {
    answer(res, async () => {
      const body = post ? await readJson(req) : null;
      const staff = await staffFor(env, req, who, body);
      if (!staff) throw new HttpError(403, 'Sign in as a parent.');
      sendJson(res, 200, await run(body, staff, new URL(req.url, 'http://localhost')));
    });
    return true;
  }

  function handle(req, res, pathname, who) {
    const post = req.method === 'POST', get = req.method === 'GET';
    if (pathname === '/api/view' && post) { answer(res, async () => sendJson(res, 200, await startView(req, who))); return true; }
    if (pathname === '/api/view/beat' && post) { answer(res, async () => sendJson(res, 200, await beat(req, who))); return true; }
    if (pathname === '/api/admin/views' && get) return staffRoute(res, req, who, (body, staff, url) => views(url), { post: false });
    // ?target=<email> for one account, or ?channel=<slug> for the kid logins on one kid's channel.
    if (pathname === '/api/admin/budget' && get) {
      return staffRoute(res, req, who, (body, staff, url) => {
        const channel = url.searchParams.get('channel');
        if (!channel) return budgetState(String(url.searchParams.get('target') || '').trim().toLowerCase());
        const kids = sqlite.prepare(`SELECT a.email FROM accounts a JOIN channels ch ON ch.id=a.channel_id
          WHERE ch.slug=? AND a.role='kid' AND a.status='approved' ORDER BY a.created`).all(channel);
        return { ok: true, channel, accounts: kids.map(row => budgetState(row.email)) };
      }, { post: false });
    }
    if (pathname === '/api/admin/budget' && post) return staffRoute(res, req, who, setBudget);
    if (pathname === '/api/admin/budget/bonus' && post) return staffRoute(res, req, who, addBonus);
    if (pathname === '/api/admin/timezone' && get) return staffRoute(res, req, who, () => clock(), { post: false });
    if (pathname === '/api/admin/timezone' && post) return staffRoute(res, req, who, setTimezone);
    return false;
  }

  return { handle, start, stop, prune, budgetFor, canWatch, today };
}
