/* Account, moderation, and catalog API. */
import { timingSafeEqual } from 'node:crypto';
import { passwordRecord, passwordMatches } from './passwords.mjs';
import { sendMail } from './mail.mjs';
import { BRAND_NAME, WORDMARK } from './brand.mjs';
import { KID_DOMAIN, kidEmail } from './family.mjs';
import { CLIP_ACCESS_SQL, canPlayClip, canViewChannel } from './channels.mjs';
import { approveClip, rejectClip } from './publish.mjs';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '');
    /* who the signed cookie names (access.mjs), or null; index.mjs passes it in */
    const viewer = (ctx && ctx.viewer) || null;
    try {
      /* a sealed time capsule's comments, likes and legacy media are closed to all but parents (capsules.mjs) */
      const sealed = env.capsules && await env.capsules.guard(req, p, viewer);
      if (sealed) return sealed;
      if (p === '/api/health') return J({ ok: true, mode: 'server' });
      if (p === '/api/site') return J(env.site.info());
      if (p === '/api/channels') return J(env.site.channels(viewer));
      if (p === '/api/me') return await me(env, viewer);
      if (p === '/api/notifications/unsubscribe' && env.handleVideoUnsubscribe) return env.handleVideoUnsubscribe(req);

      if (req.method === 'POST' && p === '/api/signup') return await signup(req, env);
      if (req.method === 'POST' && p === '/api/login') return await login(req, env);
      if (req.method === 'POST' && p === '/api/guest/generate') return await guestGenerate(req, env);
      if (req.method === 'POST' && p === '/api/guest/redeem') return await guestRedeem(req, env);
      if (req.method === 'POST' && p === '/api/guest/validate') return await guestValidate(req, env);
      if (p === '/api/check') return await check(req, url, env);
      if (p === '/api/pending') return DENY403();
      if (p === '/api/decide') return PAGE('Open the parent dashboard to review account requests.', 200);
      if (p === '/api/clips') return await clipsList(url, env, viewer);
      if (p === '/api/clips/locate') return await clipsLocate(url, env, viewer);
      if (req.method === 'POST' && p === '/api/admin/clips/review') return await clipsReview(req, env);
      if (req.method === 'POST' && p === '/api/clips/reorder') return await clipsReorder(req, env, ctx);
      if (req.method === 'POST' && p === '/api/clips/rename') return await clipsRename(req, env, ctx);
      if (req.method === 'POST' && p === '/api/clips/delete') return await clipsDelete(req, env, ctx);
      if (p.startsWith('/api/media/')) return await mediaServe(req, env, p, viewer);
      if (p === '/api/admin/overview') return await adminOverview(req, url, env);
      if (req.method === 'POST' && p === '/api/admin/status') return await adminStatus(req, env);
      if (req.method === 'POST' && p === '/api/admin/role') return await adminRole(req, env);
      if (req.method === 'POST' && p === '/api/admin/password') return await adminPassword(req, env);
      if (p === '/api/likes') { const r = await likesAll(req, url, env, viewer); return env.capsules ? env.capsules.omitSealed(r) : r; }
      if (req.method === 'POST' && p === '/api/like') return await likeSet(req, env);
      if (p === '/api/comments') return await commentsList(req, url, env, viewer);
      if (req.method === 'POST' && p === '/api/comment') return await commentAdd(req, env);
      if (req.method === 'POST' && p === '/api/comment/delete') return await commentDelete(req, env);
      return J({ ok: false, error: 'not found' }, 404);
    } catch (err) {
      console.error(`API ${req.method} ${p} failed:`, err);
      return J({ ok: false, error: 'server error' }, 500);
    }
  },
};

/* ---------- helpers ---------- */
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json' } });
const enc = new TextEncoder();
const unb64u = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
const unb64uSafe = (s) => { try { return unb64u(s || ''); } catch (e) { return ''; } };
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const EMAIL_OK = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length < 120;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

async function db(env, q, params) {
  const r = await env.DB.prepare(q).bind(...(params || [])).run();
  return r;
}

/* ---------- signup ---------- */
const CLOSED403 = (what) => J({ ok: false, error: 'This family is not taking new ' + what + ' right now.' }, 403);
async function signup(req, env) {
  if (env.settings.get('signup_mode') === 'closed') return CLOSED403('accounts');
  const b = await req.json().catch(() => null);
  if (!b) return J({ ok: false, error: 'bad body' }, 400);
  const first = String(b.first || '').trim().slice(0, 40);
  const last = String(b.last || '').trim().slice(0, 40);
  const email = String(b.email || '').trim().toLowerCase();
  if (typeof b.pass !== 'string' || b.pass.length < 12 || b.pass.length > 128) return J({ok:false,error:'Use a password of 12–128 characters.'},400);
  const {salt,hash}=await passwordRecord(b.pass);
  if (!first || !last) return J({ ok: false, error: 'name' }, 400);
  /* kid logins live on the reserved .invalid domain and are made only by a parent */
  if (!EMAIL_OK(email) || email.endsWith('@' + KID_DOMAIN)) return J({ ok: false, error: 'email' }, 400);


  /* light rate limit per IP: max 5 signups per hour */
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  await db(env, 'DELETE FROM hits WHERE ts < ?', [Date.now() - 3600000]);
  await db(env, 'INSERT INTO hits (ip, ts) VALUES (?, ?)', [ip, Date.now()]);
  const c = await db(env, 'SELECT COUNT(*) AS n FROM hits WHERE ip = ? AND ts > ?', [ip, Date.now() - 3600000]);
  if ((c.results && c.results[0] && c.results[0].n || 0) > 5) return J({ ok: false, error: 'slow down' }, 429);

  /* Every request gets the same answer, so signup can't be used to learn who has an account (kid logins
     included); only a new request emails the parent. */
  const SENT = () => J({ ok: true, status: 'pending' });
  const exists = await db(env, 'SELECT status FROM accounts WHERE email = ?', [email]);
  if (exists.results && exists.results.length) return SENT();
  await db(env, 'INSERT INTO accounts (email, first, last, salt, hash, status, created) VALUES (?,?,?,?,?,?,?)',
    [email, first, last, salt, hash, 'pending', Date.now()]);
  await notify(env, first, last, email);
  return SENT();
}

/* ---------- notify email via Brevo; the request is saved either way ---------- */
async function notify(env, first, last, email) {
  const link = new URL('/parents',env.SITE_URL).href;
  const who = esc(first+' '+last+' ('+email+')');
  try {
    await sendMail(env,{email:env.NOTIFY_EMAIL},`${BRAND_NAME}: new account request`,
      '<p>'+who+' requested access.</p><p><a href="'+esc(link)+'">Open the parent dashboard</a> to approve or deny this request.</p>',
      'New account request. Review it at '+link);
    return true;
  } catch (error) {
    console.error('Account request email failed:', error);
    return false;
  }
}

/* ---------- approval email to the approved viewer ---------- */
async function approvalMail(env, email, first) {
  const who = esc(first || 'Viewer');
  const site = env.SITE_URL;
  const html = `<div style="font-family:Arial,sans-serif;background:#0B0C10;color:#F7F4EC;padding:26px;border-radius:10px">
    <p style="color:#3265FF;letter-spacing:.3em;font-size:11px;margin:0 0 10px">${WORDMARK}</p>
    <h2 style="margin:0 0 12px">You're in, ${who}!</h2>
    <p style="margin:0 0 16px;line-height:1.5">The channel owner approved your account. Come back and log in with the email and password you picked:</p>
    <p style="margin:0 0 10px"><a href="${site}" style="background:#3265FF;color:#0B0C10;padding:10px 18px;border-radius:4px;text-decoration:none;font-weight:bold">Enter the tube</a></p>
    <p style="color:#A6A0AE;font-size:11px;margin:14px 0 0">If you did not sign up for ${BRAND_NAME} you can ignore this email.</p></div>`;
  const text = "You're in, " + (first || 'Viewer') + "! The channel owner approved your " + BRAND_NAME + " account. Log in at " + site;
  await sendMail(env, { email: email, name: first || undefined }, "You're approved for " + BRAND_NAME, html, text);
}

/* ---------- login: unknown emails and wrong passwords look identical ---------- */
const DECOY = { salt: '0'.repeat(32), hash: 'scrypt:' + '0'.repeat(128) };
const BAD_LOGIN = () => J({ ok: false, error: 'Wrong email or password.' }, 401);
/* Wrong passwords per account, from any address: a kid's short password can't be worked through by many
   machines at once. Unknown emails count the same, so the pause says nothing about who has an account. */
const LOGIN_FAILS = 10, LOGIN_WINDOW = 15 * 60 * 1000;
const loginFails = new Map();
function failsFor(email, now) {
  if (loginFails.size > 10000) for (const [key, list] of loginFails) if (list.at(-1) <= now - LOGIN_WINDOW) loginFails.delete(key);
  return (loginFails.get(email) || []).filter((at) => at > now - LOGIN_WINDOW);
}
async function login(req, env) {
  const b = await req.json().catch(() => null);
  if (!b) return J({ ok: false, error: 'bad body' }, 400);
  let email = String(b.email || '').trim().toLowerCase();
  /* kids sign in with a bare login name such as "juni" */
  if (/^[a-z][a-z0-9-]{1,23}$/.test(email)) email = kidEmail(email);
  const pass = String(b.pass || '');
  if (!EMAIL_OK(email) || !pass) return J({ ok: false, error: 'creds' }, 400);
  const now = Date.now();
  const fails = failsFor(email, now);
  if (fails.length >= LOGIN_FAILS) return J({ ok: false, error: 'Too many wrong passwords for this account. Try again in 15 minutes.' }, 429);
  const r = await db(env, 'SELECT salt, hash, status, role FROM accounts WHERE email = ?', [email]);
  const row = r.results && r.results[0];
  /* hash against a decoy so a missing account takes as long as a wrong password */
  const matches = await passwordMatches(pass, row || DECOY);
  if (!row || !matches) { loginFails.set(email, [...fails, now]); return BAD_LOGIN(); }
  loginFails.delete(email);
  return J({ ok: true, email, status: row.status, role: String(row.role || ''), t: await sessToken(env, email) });
}

/* ---------- status check: without a valid session it says nothing about the email ---------- */
/* The session a GET carries: X-Kid-Email and X-Kid-Token headers, which the pages send so tokens stay out
   of logs, or the older ?e=<base64url email>&t= that a shell cached before the change may still use. */
function getSession(req, url) {
  const email = req.headers.get('x-kid-email');
  if (email) return { email: email.trim().toLowerCase(), t: req.headers.get('x-kid-token') || '' };
  return { email: unb64uSafe(url.searchParams.get('e')).trim().toLowerCase(), t: url.searchParams.get('t') || '' };
}
async function check(req, url, env) {
  const { email, t } = getSession(req, url);
  if (!await sessOk(env, email, t)) return J({ ok: true, status: 'none', role: '' });
  return J({ ok: true, email, status: 'approved', role: await roleOf(env, email), t });
}

/* Sessions expire after seven days and password changes invalidate them. */
const CLIP_OK = (s) => /^[A-Za-z0-9_-]{1,80}$/.test(String(s || ''));
/* signatures compare in constant time, like the media cookie's */
const sameHex = (given, expected) => /^[a-f0-9]{64}$/.test(String(given)) && timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
async function sessToken(env,email) {
 const r=await db(env,'SELECT hash FROM accounts WHERE email=?',[email]);
 const expires=Date.now()+7*86400000;
 return expires+'.'+await hmac(env.SIGN_SECRET,'sess|'+email+'|'+expires+'|'+r.results[0].hash);
}
async function sessOk(env, email, t) {
  if (!EMAIL_OK(email) || !t) return null;
  const [expires,sig]=String(t).split('.');
  if(!/^\d{13}$/.test(expires)||Number(expires)<=Date.now()||Number(expires)>Date.now()+7*86400000)return null;
  const credential=await db(env,'SELECT hash FROM accounts WHERE email=?',[email]);
  if(!credential.results[0] || !sameHex(sig, await hmac(env.SIGN_SECRET,'sess|'+email+'|'+expires+'|'+credential.results[0].hash)))return null;
  const r = await db(env, 'SELECT status FROM accounts WHERE email = ?', [email]);
  const row = r.results && r.results[0];
  return row && row.status === 'approved' ? email : null;
}
const dispName = (first, last) => (String(first || '').trim() +
  (String(last || '').trim() ? ' ' + String(last).trim().charAt(0).toUpperCase() + '.' : '')).trim();

/* ---------- roles: '' viewer, 'kid' (uploads to one channel), 'admin' (Family), 'super' (the owner) ---------- */
async function roleOf(env, email) {
  const r = await db(env, 'SELECT role, status FROM accounts WHERE email = ?', [email]);
  const row = r.results && r.results[0];
  return row && row.status === 'approved' ? String(row.role || '') : '';
}
async function asStaff(env, email, t) {
  const e = await sessOk(env, email, t);
  if (!e) return null;
  const role = await roleOf(env, e);
  return (role === 'admin' || role === 'super') ? { email: e, role: role } : null;
}
/* staff, plus kid accounts that upload to their own channel */
async function asCreator(env, email, t) {
  const e = await sessOk(env, email, t);
  if (!e) return null;
  const r = await db(env, 'SELECT role, channel_id FROM accounts WHERE email = ?', [e]);
  const row = r.results && r.results[0];
  return row && ['admin', 'super', 'kid'].includes(row.role) ? { email: e, role: row.role, channelId: row.channel_id } : null;
}
export { asStaff, asCreator, sessOk, sessToken };
async function staffFrom(req, env) {
  const b = await req.json().catch(() => null);
  if (!b) return null;
  const s = await asStaff(env, String(b.email || '').trim().toLowerCase(), String(b.t || ''));
  return s ? { staff: s, body: b } : null;
}
const DENY403 = () => J({ ok: false, error: 'not authorized' }, 403);
const SUPER403 = () => J({ ok: false, error: 'super only' }, 403);

/* ---------- one-use guest codes and 24-hour view-only sessions ---------- */
const GUEST_DAY = 24 * 60 * 60 * 1000;
/* six symbols from 32 that can't be misread (no I, O, 0 or 1): about a billion codes */
const CODE_SYMBOLS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function freshGuestCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => CODE_SYMBOLS[b % CODE_SYMBOLS.length]).join('');
}
/* wrong guest codes from every address together; past this, redeeming pauses for everyone */
const GUEST_FAILS = 30, GUEST_WINDOW = 10 * 60 * 1000;
let guestFails = [];
/* a pass may be limited to one kid's channel: { channel: '<slug>' } */
async function guestGenerate(req, env) {
  const ctx = await staffFrom(req, env);
  if (!ctx) return DENY403();
  if (!env.settings.get('guest_passes')) return CLOSED403('guest passes');
  const slug = String(ctx.body.channel || '');
  const scope = slug ? ((await db(env, 'SELECT id FROM channels WHERE slug = ?', [slug])).results || [])[0] : null;
  if (slug && !scope) return J({ ok: false, error: 'Choose a kid for this pass.' }, 400);
  const now = Date.now();
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = freshGuestCode();
    const codeHash = await hmac(env.SIGN_SECRET, 'guest-code|' + code);
    const result = await db(env, `INSERT OR IGNORE INTO guest_codes
      (code_hash, creator, created, expires, channel_id) VALUES (?,?,?,?,?)`,
      [codeHash, ctx.staff.email, now, now + GUEST_DAY, scope ? scope.id : null]);
    if (result.meta && result.meta.changes) {
      return J({ ok: true, code, expires: now + GUEST_DAY, scope: scope ? slug : null });
    }
  }
  return J({ ok: false, error: 'Could not create a code. Try again.' }, 503);
}
async function guestRedeem(req, env) {
  if (!env.settings.get('guest_passes')) return CLOSED403('guest passes');
  const payload = await req.json().catch(() => null);
  if (!payload) return J({ ok: false, error: 'Invalid request.' }, 400);
  const code = String(payload.code || '').trim().toUpperCase();
  /* four-character codes made before the six-character ones still work for their last day */
  if (!/^[A-Z0-9]{4}(?:[A-Z0-9]{2})?$/.test(code)) return J({ ok: false, error: 'Enter the six-character code.' }, 400);
  const now = Date.now();
  guestFails = guestFails.filter((at) => at > now - GUEST_WINDOW);
  if (guestFails.length >= GUEST_FAILS) return J({ ok: false, error: 'Too many wrong codes. Try again in ten minutes.' }, 429);
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  await db(env, 'DELETE FROM guest_code_attempts WHERE ts < ?', [now - 10 * 60 * 1000]);
  const recent = await db(env, 'SELECT COUNT(*) AS n FROM guest_code_attempts WHERE ip = ?', [ip]);
  if (((recent.results || [])[0]?.n || 0) >= 5) {
    return J({ ok: false, error: 'Too many attempts. Try again in ten minutes.' }, 429);
  }
  await db(env, 'INSERT INTO guest_code_attempts (ip, ts) VALUES (?,?)', [ip, now]);
  const codeHash = await hmac(env.SIGN_SECRET, 'guest-code|' + code);
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const tokenHash = await hmac(env.SIGN_SECRET, 'guest-session|' + token);
  const expires = now + GUEST_DAY;
  const result = await db(env, `UPDATE guest_codes
    SET redeemed = ?, token_hash = ?, session_expires = ?
    WHERE code_hash = ? AND redeemed IS NULL AND expires > ?`,
  [now, tokenHash, expires, codeHash, now]);
  if (!result.meta || !result.meta.changes) {
    guestFails.push(now);
    return J({ ok: false, error: 'That code is invalid, already used, or expired.' }, 400);
  }
  return J({ ok: true, token, expires, role: 'guest', scope: await guestScope(env, tokenHash) });
}
async function guestScope(env, tokenHash) {
  const r = await db(env, 'SELECT ch.slug FROM guest_codes g JOIN channels ch ON ch.id = g.channel_id WHERE g.token_hash = ?', [tokenHash]);
  return (r.results && r.results[0] && r.results[0].slug) || null;
}
async function guestValidate(req, env) {
  const payload = await req.json().catch(() => null);
  const token = String(payload?.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return J({ ok: false, error: 'Invalid guest session.' }, 403);
  const tokenHash = await hmac(env.SIGN_SECRET, 'guest-session|' + token);
  const result = await db(env, 'SELECT session_expires FROM guest_codes WHERE token_hash = ? AND session_expires > ?',
    [tokenHash, Date.now()]);
  const row = result.results && result.results[0];
  if (!row) return J({ ok: false, error: 'Guest access has expired.' }, 403);
  return J({ ok: true, expires: row.session_expires, role: 'guest', scope: await guestScope(env, tokenHash) });
}
async function superFrom(req, env) {
  const ctx = await staffFrom(req, env);
  return ctx && ctx.staff.role === 'super' ? ctx : null;
}

/* ---------- server-owned clip catalog (the admin panel edits it) ---------- */

/* viewers only ever see approved, unhidden clips, on channels they may watch */
/* positions count within a channel, so the reel runs channel by channel; ?channel=<slug> picks one */
const CHANNEL_ORDER = 'ORDER BY ch.position, c.channel_id, c.position';
const OUTSIDE_PASS = () => J({ ok: false, error: 'This channel is not part of your guest pass.' }, 403);
async function clipsList(url, env, viewer) {
  const slug = url.searchParams.get('channel');
  if (slug) {
    const ch = ((await db(env, 'SELECT id FROM channels WHERE slug = ?', [slug])).results || [])[0];
    if (ch && !canViewChannel(viewer, ch)) return OUTSIDE_PASS();
  }
  const r = await db(env, `SELECT c.id, c.title, c.src, c.poster, c.kind, c.blurb, c.published, c.duration, c.channel_id, ch.slug AS channel,
    c.opens_at, c.opened_at, c.capsule_note, c.sealed_by
    FROM clips c LEFT JOIN channels ch ON ch.id = c.channel_id
    WHERE c.hidden = 0 AND c.review = 'approved' ${slug ? 'AND ch.slug = ?' : ''} ${CHANNEL_ORDER}`, slug ? [slug] : []);
  /* seq is the place in this list, which feed.js sorts by. A sealed time capsule keeps its place as a
     locked tape, with no media, length, blurb or kind; an opened one carries openedAt for its unlock */
  const now = Date.now();
  const clips = (r.results || []).filter((c) => canViewChannel(viewer, { id: c.channel_id })).map((c, i) => (c.opens_at > now && env.capsules
    ? { id: c.id, title: c.title, channel: c.channel || '', publishedAt: c.published || '', seq: i + 1, ...env.capsules.lockedFields(c) }
    : {
      id: c.id, title: c.title, src: c.src, poster: c.poster || '', kind: c.kind || 'video',
      blurb: c.blurb || '', publishedAt: c.published || '', duration: c.duration || 0, seq: i + 1,
      channel: c.channel || '', ...(c.opened_at ? { openedAt: c.opened_at } : {}),
    }));
  /* a budgeted account's daily tape (watch.mjs); null when it has no limit */
  const budget = env.watch && viewer && viewer.email ? env.watch.budgetFor(viewer.email, now) : null;
  return J({ ok: true, clips: clips, budget });
}

/* where a clip lives, for links made before channels (#/v/<id>) and for a stale channel name;
   a clip the viewer may not play looks the same as one that does not exist */
async function clipsLocate(url, env, viewer) {
  const id = url.searchParams.get('id') || '';
  if (!CLIP_OK(id)) return J({ ok: false, error: 'not found' }, 404);
  const clip = ((await db(env, `${CLIP_ACCESS_SQL} WHERE c.id = ?`, [id])).results || [])[0];
  if (!clip || !clip.channel || !canPlayClip(viewer, clip)) return J({ ok: false, error: 'not found' }, 404);
  return J({ ok: true, id: clip.id, channel: clip.channel, review: clip.review });
}

/* the parent's yes or no on a kid's upload; M7's review queue is the real screen for it */
async function clipsReview(req, env) {
  const ctx = await staffFrom(req, env);
  if (!ctx) return DENY403();
  const id = String(ctx.body.id || '');
  const decision = String(ctx.body.decision || '');
  if (!CLIP_OK(id) || !['approve', 'reject'].includes(decision)) return J({ ok: false, error: 'bad' }, 400);
  if (decision === 'reject') return rejectClip(env.sqlite, id, ctx.staff.email) ? J({ ok: true, review: 'rejected' }) : J({ ok: false, error: 'Nothing is waiting with that id.' }, 404);
  const channel = approveClip(env.sqlite, env.notifications, id, ctx.staff.email);
  return channel === null ? J({ ok: false, error: 'Nothing is waiting with that id.' }, 404) : J({ ok: true, review: 'approved', channel });
}

/* who the cookie names, for the viewer shell: never 401, so a signed-out visitor gets { viewer: null } */
async function me(env, viewer) {
  if (!viewer) return J({ ok: true, viewer: null });
  if (viewer.role === 'guest') {
    const r = viewer.channelId == null ? null : await db(env, 'SELECT slug FROM channels WHERE id = ?', [viewer.channelId]);
    return J({ ok: true, viewer: { role: 'guest', scope: (r && r.results[0] && r.results[0].slug) || null } });
  }
  const r = await db(env, 'SELECT a.first, a.role, ch.slug FROM accounts a LEFT JOIN channels ch ON ch.id = a.channel_id WHERE a.email = ?', [viewer.email]);
  const row = (r.results || [])[0] || {};
  return J({ ok: true, viewer: { role: String(row.role || ''), email: viewer.email, first: row.first || '', channel: row.role === 'kid' ? row.slug || null : null } });
}

/* Called directly, these write the activity row the dashboard's own routes write (monitor.mjs), so no
   change goes unrecorded; the dashboard passes ctx.internal and records it itself. */
function audit(env, from, actor, subject, detail) {
  if ((from && from.internal) || !env.sqlite) return;
  env.sqlite.prepare("INSERT INTO activity (ts,actor,kind,subject,detail) VALUES (?,?,'clip',?,?)").run(Date.now(), actor, subject, JSON.stringify(detail));
}
const clipFacts = async (env, id) => ((await db(env, 'SELECT c.title, c.channel_id, ch.slug FROM clips c LEFT JOIN channels ch ON ch.id = c.channel_id WHERE c.id = ?', [id])).results || [])[0];

async function clipsReorder(req, env, from) {
  const ctx = await staffFrom(req, env);
  if (!ctx) return DENY403();
  const list = Array.isArray(ctx.body.order) ? [...new Set(ctx.body.order.filter((s) => CLIP_OK(s)))] : [];
  if (!list.length) return J({ ok: false, error: 'order' }, 400);
  /* each clip takes the next position within its own channel, in the order given */
  const r = await db(env, `SELECT id, channel_id FROM clips WHERE id IN (${list.map(() => '?').join(',')})`, list);
  const channelOf = new Map((r.results || []).map((c) => [c.id, c.channel_id]));
  const next = new Map();
  for (const id of list.filter((id) => channelOf.has(id))) {
    const position = (next.get(channelOf.get(id)) || 0) + 1;
    next.set(channelOf.get(id), position);
    await db(env, 'UPDATE clips SET position = ? WHERE id = ?', [position, id]);
  }
  for (const channelId of next.keys()) {
    const slug = ((await db(env, 'SELECT slug FROM channels WHERE id = ?', [channelId])).results || [])[0]?.slug || '';
    audit(env, from, ctx.staff.email, `channel:${channelId}`, { action: 'order', channel: slug });
  }
  return J({ ok: true, count: list.length });
}

async function clipsRename(req, env, from) {
  const ctx = await staffFrom(req, env);
  if (!ctx) return DENY403();
  const id = String(ctx.body.id || '');
  const title = String(ctx.body.title || '').trim().slice(0, 80);
  if (!CLIP_OK(id) || !title) return J({ ok: false, error: 'title' }, 400);
  const before = await clipFacts(env, id);
  const r = await db(env, 'UPDATE clips SET title = ? WHERE id = ?', [title, id]);
  if (before) audit(env, from, ctx.staff.email, id, { action: 'rename', from: before.title, title, channel: before.slug || '' });
  return J({ ok: true, changes: (r.meta && r.meta.changes) || 0 });
}

async function clipsDelete(req, env, from) {
  const ctx = await staffFrom(req, env);
  if (!ctx) return DENY403();
  const id = String(ctx.body.id || '');
  if (!CLIP_OK(id)) return J({ ok: false, error: 'id' }, 400);
  const c = await db(env, 'SELECT src FROM clips WHERE id = ?', [id]);
  const row = c.results && c.results[0];
  if (!row) return J({ ok: false, error: 'no clip' }, 404);
  const m = (row.src || '').match(/^\/api\/media\/([A-Za-z0-9-]{8,80})$/);
  const facts = await clipFacts(env, id);
  await db(env, 'DELETE FROM clips WHERE id = ?', [id]);
  audit(env, from, ctx.staff.email, id, { action: 'delete', title: facts.title, channel: facts.slug || '' });
  if (m) {
    await db(env, 'DELETE FROM media WHERE id = ?', [m[1]]);
    await db(env, 'DELETE FROM media_chunks WHERE id = ?', [m[1]]);
  }
  const local = (row.src || '').match(/^\/api\/video\/([a-f0-9-]{36})$/);
  if (local && env.deleteLocalVideo) await env.deleteLocalVideo(local[1]);
  return J({ ok: true });
}

/* ---------- legacy media: clips stored as chunks by the original Worker ---------- */
const CHUNK = 700000;                /* bytes per stored chunk */

/* stitch the requested byte range out of chunk rows (serve <= ~2MB per reply) */
function stitchChunks(rows, start, need) {
  const out = new Uint8Array(need);
  let filled = 0;
  for (const row of rows) {
    const bytes = new Uint8Array(row.bytes);
    if (filled === 0) {
      const take = Math.min(bytes.length - start, need);
      out.set(bytes.subarray(start, start + take), 0);
      filled = take;
    } else {
      const take = Math.min(bytes.length, need - filled);
      out.set(bytes.subarray(0, take), filled);
      filled += take;
    }
    if (filled >= need) break;
  }
  return filled === need ? out : null;
}

async function mediaServe(req, env, p, viewer) {
  const id = (p.match(/^\/api\/media\/([A-Za-z0-9-]{8,80})$/) || [])[1];
  if (!id) return new Response('bad id', { status: 404 });
  /* like /api/video/: only through a clip the viewer may play */
  const owner = ((await db(env, `${CLIP_ACCESS_SQL} WHERE c.src = ?`, ['/api/media/' + id])).results || [])[0];
  if (!canPlayClip(viewer, owner)) return new Response('not found', { status: 404 });
  const mr = await db(env, 'SELECT mime, size FROM media WHERE id = ?', [id]);
  const mrow = mr.results && mr.results[0];
  if (!mrow) return new Response('not found', { status: 404 });
  const size = mrow.size;
  const rangeHeader = req.headers.get('Range') || '';
  const rm = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  const ranged = !!(rm && (rm[1] || rm[2]));
  let start = 0;
  let end = size - 1;
  if (rm && rm[1]) {
    start = Number(rm[1]);
    end = rm[2] ? Number(rm[2]) : size - 1;
  } else if (rm && rm[2]) {
    /* suffix range bytes=-N: the last N bytes */
    const n = Math.min(Number(rm[2]), size);
    start = size - n;
    end = size - 1;
  }
  if (!Number.isFinite(start) || start < 0 || start >= size || end < start) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  end = Math.min(end, size - 1);
  const len = end - start + 1;
  const headers = {
    'Content-Type': mrow.mime,
    'Content-Length': String(len),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
  };
  if (ranged) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
  /* small bounded window: one query, stitch in memory (the browser's normal
     playback pattern) */
  if (ranged && rm[2] && len <= 4 * 1024 * 1024) {
    const a = Math.floor(start / CHUNK);
    const b = Math.floor(end / CHUNK);
    const rows = await db(env, 'SELECT seq, bytes FROM media_chunks WHERE id = ? AND seq BETWEEN ? AND ? ORDER BY seq ASC', [id, a, b]);
    const out = stitchChunks(rows.results || [], start - a * CHUNK, len);
    if (!out) return new Response('media chunks missing', { status: 500 });
    return new Response(out, { status: 206, headers });
  }
  /* full file and open-ended ranges stream chunk-by-chunk (flat memory, and
     the browser reaches the moov box at the tail of phone recordings) */
  return new Response(chunkStream(env, id, start, end, size), { status: ranged ? 206 : 200, headers });
}

/* streams media bytes [from..to] out of D1 one stored chunk at a time */
function chunkStream(env, id, from, to, size) {
  let pos = from;
  return new ReadableStream({
    async pull(controller) {
      if (pos > to) { controller.close(); return; }
      const a = Math.floor(pos / CHUNK);
      const segEnd = Math.min(to, size - 1, (a + 1) * CHUNK - 1);
      const r = await db(env, 'SELECT bytes FROM media_chunks WHERE id = ? AND seq = ?', [id, a]);
      const row = r.results && r.results[0];
      if (!row || !row.bytes) { controller.close(); return; }
      const bytes = new Uint8Array(row.bytes);
      const off = pos - a * CHUNK;
      controller.enqueue(bytes.subarray(off, segEnd - a * CHUNK + 1));
      pos = segEnd + 1;
    },
  });
}

/* ---------- staff analytics + super controls ---------- */
async function adminOverview(req, url, env) {
  const session = getSession(req, url);
  const s = await asStaff(env, session.email, session.t);
  if (!s) return DENY403();
  const acc = await db(env, 'SELECT email, first, last, status, role, created FROM accounts ORDER BY created ASC');
  const cpl = await db(env, `SELECT c.id, c.title, c.position, c.review, c.hidden, ch.slug AS channel,
    c.opens_at, c.opened_at, c.capsule_note
    FROM clips c LEFT JOIN channels ch ON ch.id = c.channel_id ${CHANNEL_ORDER}`);
  const reactionTotals = env.reactions ? env.reactions.totals() : {};
  const lk = await db(env, 'SELECT clip_id, email FROM likes');
  const cmAgg = await db(env, 'SELECT clip_id, COUNT(*) AS n FROM comments GROUP BY clip_id');
  const cm = await db(env, 'SELECT clip_id, name, body, created, hidden FROM comments ORDER BY created DESC LIMIT 40');
  const byName = {};
  for (const a of (acc.results || [])) byName[a.email] = dispName(a.first, a.last) || a.email;
  const likesByClip = {}, likesByFan = {}, likers = {};
  for (const l of (lk.results || [])) {
    likesByClip[l.clip_id] = (likesByClip[l.clip_id] || 0) + 1;
    likesByFan[l.email] = (likesByFan[l.email] || 0) + 1;
    (likers[l.clip_id] = likers[l.clip_id] || []).push(byName[l.email] || 'Someone');
  }
  const cmCount = {};
  for (const c of (cmAgg.results || [])) cmCount[c.clip_id] = c.n;
  const clips = (cpl.results || []).map((c) => ({
    id: c.id, title: c.title, position: c.position,
    review: c.review, hidden: !!c.hidden, channel: c.channel || '',
    likes: likesByClip[c.id] || 0, comments: cmCount[c.id] || 0,
    likers: (likers[c.id] || []).slice(0, 24),
    reactions: reactionTotals[c.id] || {},
    sealed: c.opens_at > Date.now(), opensAt: c.opens_at || 0, openedAt: c.opened_at || 0, capsuleNote: c.capsule_note || '',
  }));
  /* the people list and their emails stay with the owner, as in /api/admin/people */
  const owner = s.role === 'super';
  const fans = Object.entries(likesByFan)
    .map(([email, n]) => ({ name: byName[email] || (owner ? email : 'Someone'), ...(owner ? { email } : {}), likes: n }))
    .sort((x, y) => y.likes - x.likes).slice(0, 12);
  return J({
    ok: true, role: s.role,
    accounts: owner ? acc.results || [] : [],
    clips: clips, topFans: fans,
    recent: (cm.results || []).map((c) => ({ clip: c.clip_id, name: c.name, body: c.body, at: c.created, hidden: !!c.hidden })),
  });
}

async function adminStatus(req, env) {
  const ctx = await superFrom(req, env);
  if (!ctx) return SUPER403();
  const email = String(ctx.body.target || '').trim().toLowerCase();
  const status = String(ctx.body.status || '');
  if (!EMAIL_OK(email) || ['approved', 'denied', 'pending'].indexOf(status) < 0) return J({ ok: false, error: 'bad' }, 400);
  if (email === ctx.staff.email && status !== 'approved') return J({ok:false,error:'You cannot disable your own owner account.'},400);
  const before = await db(env, 'SELECT first,status FROM accounts WHERE email=?', [email]);
  const r = await db(env, 'UPDATE accounts SET status = ? WHERE email = ?', [status, email]);
  let mailed = false;
  if(status==='approved' && before.results[0] && before.results[0].status!=='approved' && env.MAIL_MODE!=='disabled'){
    /* the approval stays saved; the dashboard works without email */
    try { await approvalMail(env,email,before.results[0].first); mailed=true; } catch (error) { console.error('Approval email failed:', error); }
  }
  return J({ ok: true, changes: (r.meta && r.meta.changes) || 0, mailed });
}

async function adminRole(req, env) {
  const ctx = await superFrom(req, env);
  if (!ctx) return SUPER403();
  const email = String(ctx.body.target || '').trim().toLowerCase();
  const role = String(ctx.body.role || '');
  if (!EMAIL_OK(email) || ['', 'admin', 'kid'].indexOf(role) < 0) return J({ ok: false, error: 'bad' }, 400);
  if (email === ctx.staff.email) return J({ ok: false, error: 'cannot change your own role' }, 400);
  /* a kid account belongs to exactly one channel */
  const ch = role === 'kid' ? await db(env, 'SELECT id FROM channels WHERE slug = ?', [String(ctx.body.channel || '')]) : null;
  if (ch && !ch.results.length) return J({ ok: false, error: 'Choose the kid\'s channel.' }, 400);
  const r = await db(env, 'UPDATE accounts SET role = ?, channel_id = ? WHERE email = ?', [role, ch ? ch.results[0].id : null, email]);
  return J({ ok: true, changes: (r.meta && r.meta.changes) || 0 });
}

async function adminPassword(req, env) {
  const ctx = await superFrom(req, env);
  if (!ctx) return SUPER403();
  const email = String(ctx.body.target || '').trim().toLowerCase();
  const pass = String(ctx.body.pass || '');
  /* kid logins may use 8 characters (family.mjs); everyone else keeps 12 */
  const min = (await roleOf(env, email)) === 'kid' ? 8 : 12;
  if (!EMAIL_OK(email) || pass.length < min || pass.length > 128) return J({ ok: false, error: 'password must be at least ' + min + ' characters' }, 400);
  const record=await passwordRecord(pass, { min });
  const r = await db(env, 'UPDATE accounts SET salt = ?, hash = ? WHERE email = ?', [record.salt, record.hash, email]);
  return J({ ok: true, changes: (r.meta && r.meta.changes) || 0 });
}

async function likesAll(req, url, env, viewer) {
  /* counts only for clips this viewer may play: a guest pass limited to one kid sees that kid's, and
     clips waiting for review or hidden never show up for viewers */
  const cr = await db(env, `SELECT l.clip_id AS c, COUNT(*) AS n, k.channel_id, k.review, k.hidden FROM likes l
    JOIN clips k ON k.id = l.clip_id GROUP BY l.clip_id`);
  const counts = {};
  for (const row of (cr.results || [])) if (canPlayClip(viewer, row)) counts[row.c] = row.n;
  const { email, t } = getSession(req, url);
  const liked = {};
  if (EMAIL_OK(email) && await sessOk(env, email, t)) {
    const lr = await db(env, 'SELECT clip_id AS c FROM likes WHERE email = ?', [email]);
    for (const row of (lr.results || [])) liked[row.c] = true;
  }
  return J({ ok: true, counts: counts, liked: liked });
}

async function likeSet(req, env) {
  const b = await req.json().catch(() => null);
  if (!b) return J({ ok: false, error: 'bad body' }, 400);
  if (!CLIP_OK(b.clipId)) return J({ ok: false, error: 'clip' }, 400);
  const email = await sessOk(env, String(b.email || '').trim().toLowerCase(), String(b.t || ''));
  if (!email) return J({ ok: false, error: 'log in to like' }, 401);
  if (!await playable(env, email, b.clipId)) return GONE404();
  if (b.on) await db(env, 'INSERT OR IGNORE INTO likes (clip_id, email, created) VALUES (?,?,?)', [b.clipId, email, Date.now()]);
  else await db(env, 'DELETE FROM likes WHERE clip_id = ? AND email = ?', [b.clipId, email]);
  const c = await db(env, 'SELECT COUNT(*) AS n FROM likes WHERE clip_id = ?', [b.clipId]);
  const count = (c.results && c.results[0] && c.results[0].n) || 0;
  return J({ ok: true, liked: !!b.on, count: count });
}

/* likes and comments only for a clip the account may play, like reactions and the watch log */
const GONE404 = () => J({ ok: false, error: 'That video is gone.' }, 404);
async function playable(env, email, clipId) {
  const clip = ((await db(env, `${CLIP_ACCESS_SQL} WHERE c.id = ?`, [clipId])).results || [])[0];
  return canPlayClip({ email, role: await roleOf(env, email) }, clip);
}
async function commentsList(req, url, env, viewer) {
  const clip = url.searchParams.get('c') || '';
  if (!CLIP_OK(clip)) return J({ ok: false, error: 'clip' }, 400);
  const owner = ((await db(env, `${CLIP_ACCESS_SQL} WHERE c.id = ?`, [clip])).results || [])[0];
  if (!canPlayClip(viewer, owner)) return J({ ok: true, rows: [] });
  const { email, t } = getSession(req, url);
  const known = EMAIL_OK(email) && !!(await sessOk(env, email, t));
  const r = await db(env, 'SELECT id, email, name, body, created FROM comments WHERE clip_id = ? AND hidden = 0 ORDER BY created ASC LIMIT 500', [clip]);
  const rows = (r.results || []).map((m) => ({
    id: m.id, name: m.name, body: m.body, at: m.created,
    mine: !!(known && m.email === email),
  }));
  return J({ ok: true, rows: rows });
}

async function commentAdd(req, env) {
  const b = await req.json().catch(() => null);
  if (!b) return J({ ok: false, error: 'bad body' }, 400);
  if (!CLIP_OK(b.clipId)) return J({ ok: false, error: 'clip' }, 400);
  const body = String(b.body || '').trim();
  if (!body || body.length > 500) return J({ ok: false, error: 'body' }, 400);
  const email = await sessOk(env, String(b.email || '').trim().toLowerCase(), String(b.t || ''));
  if (!email) return J({ ok: false, error: 'log in to comment' }, 401);
  if (!await playable(env, email, b.clipId)) return GONE404();
  const mode = env.settings.get('comments_default');
  if (mode === 'off') return J({ ok: false, error: 'Comments are turned off.' }, 403);
  /* light rate limit per IP: max 10 comments per 10 minutes */
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  await db(env, 'DELETE FROM chits WHERE ts < ?', [Date.now() - 600000]);
  await db(env, 'INSERT INTO chits (ip, ts) VALUES (?, ?)', [ip, Date.now()]);
  const c = await db(env, 'SELECT COUNT(*) AS n FROM chits WHERE ip = ? AND ts > ?', [ip, Date.now() - 600000]);
  if ((c.results && c.results[0] && c.results[0].n || 0) > 10) return J({ ok: false, error: 'slow down' }, 429);
  const a = await db(env, 'SELECT first, last FROM accounts WHERE email = ?', [email]);
  const acc = a.results && a.results[0];
  const name = dispName(acc && acc.first, acc && acc.last) || 'A viewer';
  const id = crypto.randomUUID();
  const created = Date.now();
  /* under review, a parent unhides each comment before others see it */
  const held = mode === 'review';
  await db(env, 'INSERT INTO comments (id, clip_id, email, name, body, created, hidden) VALUES (?,?,?,?,?,?,?)',
    [id, b.clipId, email, name, body, created, held ? 1 : 0]);
  return J({ ok: true, row: { id: id, name: name, body: body, at: created, mine: true, ...(held ? { hidden: true } : {}) } });
}

async function commentDelete(req, env) {
  const b = await req.json().catch(() => null);
  if (!b) return J({ ok: false, error: 'bad body' }, 400);
  const email = await sessOk(env, String(b.email || '').trim().toLowerCase(), String(b.t || ''));
  if (!email) return J({ ok: false, error: 'log in' }, 401);
  const id = String(b.id || '');
  if (!id || id.length > 80) return J({ ok: false, error: 'id' }, 400);
  const r = await db(env, 'DELETE FROM comments WHERE id = ? AND email = ?', [id, email]);
  return J({ ok: true, changes: (r.meta && r.meta.changes) || 0 });
}

function PAGE(msg, code) {
  return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${BRAND_NAME}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05060A;color:#F7F4EC;
font-family:'Inter Tight',system-ui,sans-serif}div{max-width:420px;padding:30px;border:1px solid rgba(247,244,236,.25);border-radius:16px;
background:rgba(255,255,255,.06)}p.k{color:#3265FF;letter-spacing:.3em;font-size:11px;margin:0 0 10px;font-weight:600}</style></head>
<body><div><p class="k">${WORDMARK}</p><p style="margin:0;line-height:1.5">${esc(msg)}</p></div></body></html>`,
    { status: code, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
