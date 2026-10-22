// The demo's private customize sandbox. Only server/demo.mjs creates it, and only with DEMO_MODE=1, so a
// family's install has none of these routes, cookies or overlays.
//
// A visitor may change a demo kid's name, channel line, accent, badge and splash, and make up to two kids
// of their own. Nothing is written to the database or the data folder: every change lives in memory under
// a random sandbox id, carried by an HttpOnly, SameSite=Strict cookie that names nothing else. No address
// or account is stored with it. The family's own reads are then answered as usual and adjusted for that
// cookie only, so one visitor's changes never reach another visitor, a shared count or a shared file.
//
//   GET  /api/demo/sandbox                        what this visitor changed, and the limits
//   POST /api/demo/sandbox/reset                  forget this visitor's changes
//   GET  /api/demo/sandbox/badge/<slug>.svg?v=n   a badge drawn from this visitor's spec, never cached
//
// The dashboard's own kid routes answer from the sandbox for the demo's parent: POST /api/admin/kids,
// POST /api/admin/kids/delete and GET/PUT /api/admin/channels/<id>/badge. Reads that show kids
// (/api/site, /api/channels, /api/admin/summary, /api/admin/kids) carry the visitor's view, and a kid
// the visitor made borrows a few of the family's clips (/api/clips?channel=my-kid-1).
import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { BadgeSpecError, renderSpec } from './badge.mjs';
import { channelById, listChannels } from './channels.mjs';
import { HttpError, headerStaff, readJson, sendJson } from './jsonio.mjs';

export const SANDBOX_COOKIE = 'kt_sandbox';
export const SANDBOX_LIMITS = Object.freeze({
  sandboxes: 2000,          // live sandboxes; the one used longest ago goes first
  bytes: 24 * 1024,         // what one sandbox may hold, as JSON
  created: 2,               // kids a visitor may make
  name: 40, kicker: 80,     // the same lengths as a family's kid
  writesPerMinute: 30,      // per sandbox
  borrowed: 4,              // clips a made kid borrows
});
// A made kid's channel: id 900000001 and slug my-kid-1, out of the way of any real channel.
export const CREATED_BASE_ID = 900000000;
const createdSlug = n => `my-kid-${n}`;
const CREATED_SLUG = /^my-kid-([1-9])$/;
const ID = /^[A-Za-z0-9_-]{22}$/;
const ACCENT = /^#[0-9a-f]{6}$/i;
// Controls, line breaks and direction overrides would let a name pretend to be something else.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069\ufeff]/;
const BADGE_ROUTE = /^\/api\/demo\/sandbox\/badge\/([a-z0-9-]{1,40})\.svg$/;
const CHANNEL_BADGE = /^\/api\/admin\/channels\/([^/]+)\/badge$/;
const MINUTE = 60000;

export const SANDBOX_NOTE = 'Your changes are only on this device and disappear at the next reset.';
const TOO_BIG = 'That is more than the demo keeps for one visitor. Reset your changes and try again.';
const SLOW = 'Slow down a little.';

// The parent's session, as the dashboard sends it. Only the owner edits kids, as on a real install.
async function parentOf(env, req) {
  const user = await headerStaff(env, req);
  return user?.role === 'super' ? user : null;
}

// The same rules as a family's kid (family.mjs), plus no invisible or control characters.
function text(value, max, label, { required = false } = {}) {
  const clean = typeof value === 'string' ? value.trim() : value == null ? '' : null;
  if (clean === null || clean.length > max) throw new HttpError(400, `${label} can be up to ${max} characters.`);
  if (UNSAFE_TEXT.test(clean)) throw new HttpError(400, `${label} can't use invisible or control characters.`);
  if (required && !clean) throw new HttpError(400, `Add ${label.toLowerCase()}.`);
  return clean;
}

function cookieValue(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SANDBOX_COOKIE) return rest.join('=');
  }
  return '';
}

// env: the app's env (settings, SITE_URL). themeIds() lists the splash screens. limitNew(req) is true when
// this address has opened too many sandboxes lately (demo.mjs keeps that count, keyed by a per-boot HMAC).
// resetStamp is the file every demo reset rewrites, so a reset from scripts/demo-reset.mjs clears them too.
// limits and ownerOf are for the tests.
export function createSandboxes({
  sqlite, env, themeIds = () => [], limitNew = () => false, nextReset = () => 0, resetStamp = '', now = Date.now,
  limits = SANDBOX_LIMITS, ownerOf = parentOf,
}) {
  const boxes = new Map();
  let knownReset = 0;

  function clearAll() { boxes.clear(); }

  // A reset made by another process (the reset script) shows as a newer stamp; every sandbox predates it.
  function checkStamp() {
    if (!resetStamp) return;
    const at = statSync(resetStamp, { throwIfNoEntry: false })?.mtimeMs || 0;
    if (at > knownReset) {
      if (knownReset) clearAll();
      knownReset = at;
    }
  }

  function find(req) {
    const id = cookieValue(req);
    if (!ID.test(id)) return null;
    checkStamp();
    const box = boxes.get(id);
    if (!box) return null;
    // Map order is the eviction order, so a sandbox in use moves to the back.
    boxes.delete(id);
    boxes.set(id, box);
    return box;
  }

  const secure = () => String(env.SITE_URL || '').startsWith('https:');
  function cookie(id, maxAge) {
    return `${SANDBOX_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure() ? '; Secure' : ''}`;
  }
  // The cookie lasts until the next reset, when the sandbox is gone anyway.
  const untilReset = () => Math.max(60, Math.ceil((nextReset() - now()) / 1000));

  // This visitor's sandbox, made on their first change. Sets the cookie on res for a new one.
  function open(req, res) {
    const found = find(req);
    if (found) return found;
    if (limitNew(req)) throw new HttpError(429, SLOW);
    checkStamp();
    while (boxes.size >= limits.sandboxes) boxes.delete(boxes.keys().next().value);
    const id = randomBytes(16).toString('base64url');
    const box = { kids: new Map(), created: [], rev: 0, writes: [] };
    boxes.set(id, box);
    res.setHeader('Set-Cookie', cookie(id, untilReset()));
    return box;
  }

  function spend(box) {
    const at = now();
    box.writes = box.writes.filter(time => time > at - MINUTE);
    if (box.writes.length >= limits.writesPerMinute) throw new HttpError(429, SLOW);
    box.writes.push(at);
  }

  const stored = box => ({ kids: [...box.kids], created: box.created });
  // Applies a change to a copy first, so a change that would make the sandbox too big changes nothing.
  function commit(box, change) {
    const next = { kids: new Map([...box.kids].map(([id, kid]) => [id, { ...kid }])), created: box.created.map(kid => ({ ...kid })), rev: box.rev };
    const result = change(next);
    if (JSON.stringify(stored(next)).length > limits.bytes) throw new HttpError(413, TOO_BIG);
    Object.assign(box, next);
    return result;
  }

  const empty = box => !box || (!box.kids.size && !box.created.length);
  const site = () => env.settings.all();
  const badgeUrl = (slug, rev) => `/api/demo/sandbox/badge/${slug}.svg?v=${rev}`;

  // The visitor's view of a family kid: their changes over the family's values.
  function seededView(row, box) {
    const own = box?.kids.get(row.id);
    const family = site();
    const view = {
      id: row.id, slug: row.slug, name: row.name, kicker: row.kicker, accent: row.accent || family.family_accent,
      themeId: row.theme_id || family.gate_theme, logoUrl: row.logo_rev ? `/brand/${row.slug}.svg?v=${row.logo_rev}` : null, sandbox: null,
    };
    if (!own) return view;
    for (const key of ['name', 'kicker', 'accent', 'themeId']) if (own[key] !== undefined) view[key] = own[key] || (key === 'accent' ? family.family_accent : key === 'themeId' ? family.gate_theme : '');
    if (own.badge) view.logoUrl = badgeUrl(row.slug, own.rev);
    view.sandbox = 'changed';
    return view;
  }

  function createdView(kid) {
    const family = site();
    return {
      id: CREATED_BASE_ID + kid.n, slug: createdSlug(kid.n), name: kid.name, kicker: kid.kicker,
      accent: kid.accent || family.family_accent, themeId: kid.themeId || family.gate_theme,
      logoUrl: kid.badge ? badgeUrl(createdSlug(kid.n), kid.rev) : null, sandbox: 'created',
    };
  }

  const publicFields = view => ({ slug: view.slug, name: view.name, kicker: view.kicker, accent: view.accent, themeId: view.themeId, logoUrl: view.logoUrl });

  // ---------- reads, adjusted for this visitor ----------

  // Swaps the family's kid entries (matched by `key`) for the visitor's view, then adds their own kids.
  function overlayList(list, box, { key = 'slug', shape, extra = () => ({}) }) {
    if (!Array.isArray(list)) return list;
    const rows = new Map(listChannels(sqlite).map(row => [key === 'id' ? row.id : row.slug, row]));
    const out = list.map(entry => {
      const row = rows.get(entry[key]);
      return row && box?.kids.has(row.id) ? { ...entry, ...shape(seededView(row, box), entry) } : entry;
    });
    for (const kid of box?.created || []) out.push({ ...shape(createdView(kid), null), ...extra(kid) });
    return out;
  }

  const adminKid = (view, entry) => {
    const spec = view.sandbox === 'created' ? null : entry?.badge;
    return {
      id: view.id, slug: view.slug, name: view.name, kicker: view.kicker, accent: view.accent, themeId: view.themeId,
      logoUrl: view.logoUrl, badge: spec, sandbox: view.sandbox,
    };
  };

  function overlayAdminKids(value, box) {
    const out = { ...value, sandbox: info(box) };
    if (!Array.isArray(value.kids)) return out;
    out.kids = overlayList(value.kids, box, {
      key: 'id',
      shape: (view, entry) => {
        const own = view.sandbox === 'created' ? box.created.find(kid => CREATED_BASE_ID + kid.n === view.id) : box?.kids.get(view.id);
        return { ...adminKid(view, entry), badge: own?.badge || entry?.badge || null };
      },
      extra: () => ({ reviewUploads: false, login: null, placeholder: false, videos: 0 }),
    }).map(kid => ({ ...kid, sandbox: kid.sandbox || null }));
    return out;
  }

  // A made kid's feed: a few of the family's clips, one kid at a time, each saying where it came from.
  function borrowed(value, box, n) {
    if (!Array.isArray(value.clips)) return value;
    const names = new Map(listChannels(sqlite).map(row => [row.slug, seededView(row, box).name]));
    const byKid = new Map();
    for (const clip of value.clips) {
      if (clip.sealed || !clip.src) continue;
      if (!byKid.has(clip.channel)) byKid.set(clip.channel, []);
      byKid.get(clip.channel).push(clip);
    }
    const picked = [];
    for (let round = 0; picked.length < limits.borrowed && [...byKid.values()].some(list => list.length > round); round++) {
      for (const list of byKid.values()) if (list[round] && picked.length < limits.borrowed) picked.push(list[round]);
    }
    return {
      ...value, borrowed: true,
      clips: picked.map((clip, i) => ({
        ...clip, seq: i + 1, channel: createdSlug(n),
        blurb: `Borrowed from ${names.get(clip.channel) || 'the demo family'}'s channel, so you can see this page in action. Uploads are off in the demo.`,
      })),
    };
  }

  // Lets the route answer as usual, then rewrites its JSON for this visitor. Only 200 answers change.
  function rewrite(res, transform) {
    const original = { writeHead: res.writeHead, write: res.write, end: res.end };
    let status = 200;
    const headers = {};
    const chunks = [];
    const bytes = (chunk, encoding) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8');
    res.writeHead = (code, ...rest) => {
      status = code;
      for (const part of rest) if (part && typeof part === 'object') Object.assign(headers, part);
      return res;
    };
    res.write = (chunk, encoding, callback) => {
      if (chunk != null && typeof chunk !== 'function') chunks.push(bytes(chunk, encoding));
      for (const fn of [encoding, callback]) if (typeof fn === 'function') fn();
      return true;
    };
    res.end = (chunk, encoding, callback) => {
      Object.assign(res, original);
      if (chunk != null && typeof chunk !== 'function') chunks.push(bytes(chunk, encoding));
      let body = Buffer.concat(chunks);
      if (status === 200) {
        try { body = Buffer.from(JSON.stringify(transform(JSON.parse(body.toString('utf8'))))); } catch {}
      }
      for (const name of Object.keys(headers)) if (name.toLowerCase() === 'content-length') delete headers[name];
      res.removeHeader('Content-Length');
      res.writeHead(status, { ...headers, 'Content-Length': String(body.length) });
      res.end(body, ...[encoding, callback].filter(fn => typeof fn === 'function'));
      return res;
    };
  }

  // Before the family's routes run: false lets them answer (perhaps rewritten), true when answered here.
  function overlay(req, res, pathname) {
    if (req.method !== 'GET') return false;
    if (pathname === '/api/admin/kids') {
      const box = find(req);
      rewrite(res, value => overlayAdminKids(value, box));
      return false;
    }
    const box = find(req);
    if (empty(box)) return false;
    if (pathname === '/api/site') rewrite(res, value => (value.channels?.length ? { ...value, channels: overlayList(value.channels, box, { shape: publicFields }) } : value));
    else if (pathname === '/api/channels') {
      const tagline = site().site_tagline;
      rewrite(res, value => ({ ...value, channels: overlayList(value.channels, box, { shape: (view, entry) => ({ ...publicFields(view), tagline: entry?.tagline || tagline }) }) }));
    } else if (pathname === '/api/admin/summary') {
      rewrite(res, value => ({ ...value, kids: overlayList(value.kids, box, { key: 'id', shape: view => ({ id: view.id, slug: view.slug, name: view.name, accent: view.accent, logoUrl: view.logoUrl }) }) }));
    } else if (pathname === '/api/clips') {
      const url = new URL(req.url, 'http://localhost');
      const n = Number(CREATED_SLUG.exec(url.searchParams.get('channel') || '')?.[1]);
      if (!box.created.some(kid => kid.n === n)) return false;
      // Every clip this visitor may watch, then a few of them; the family's own access rules still apply.
      url.searchParams.delete('channel');
      req.url = url.pathname + url.search;
      rewrite(res, value => borrowed(value, box, n));
    }
    return false;
  }

  // ---------- this visitor's changes ----------

  function info(box) {
    const views = box ? [
      ...listChannels(sqlite).filter(row => box.kids.has(row.id)).map(row => seededView(row, box)),
      ...box.created.map(createdView),
    ] : [];
    return {
      on: true, active: !empty(box), note: SANDBOX_NOTE, created: box?.created.length || 0, createdMax: limits.created,
      kids: views.map(view => ({ id: view.id, slug: view.slug, name: view.name, kind: view.sandbox })), nextReset: nextReset(),
    };
  }

  const createdOf = (box, id) => box?.created.find(kid => CREATED_BASE_ID + kid.n === Number(id)) || null;

  function saveKid(box, input) {
    const name = text(input.name, limits.name, 'A name', { required: true });
    const kicker = text(input.kicker, limits.kicker, 'The channel line');
    const accent = text(input.accent, 7, 'The accent');
    if (accent && !ACCENT.test(accent)) throw new HttpError(400, 'Pick an accent color.');
    const themeId = text(input.themeId, 40, 'The splash');
    if (themeId && !themeIds().includes(themeId)) throw new HttpError(400, 'Pick one of the splash screens.');
    const fields = { name, kicker, accent: accent.toUpperCase(), themeId };
    return commit(box, next => {
      if (input.id == null || input.id === '') {
        if (next.created.length >= limits.created) throw new HttpError(409, `You can make up to ${limits.created} kids in the demo. Remove one, or reset your changes.`);
        const used = new Set(next.created.map(kid => kid.n));
        const n = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(value => !used.has(value));
        const kid = { n, ...fields, badge: null, rev: 0 };
        next.created.push(kid);
        return createdView(kid);
      }
      const made = next.created.find(kid => CREATED_BASE_ID + kid.n === Number(input.id));
      if (made) { Object.assign(made, fields); return createdView(made); }
      const row = Number.isSafeInteger(Number(input.id)) ? channelById(sqlite, Number(input.id)) : null;
      if (!row) throw new HttpError(404, 'That kid was removed. Reload the page.');
      next.kids.set(row.id, { ...next.kids.get(row.id), ...fields });
      return { ...seededView(row, next) };
    });
  }

  function removeKid(box, id) {
    if (!box) throw new HttpError(404, 'There is nothing of yours to undo.');
    return commit(box, next => {
      const index = next.created.findIndex(kid => CREATED_BASE_ID + kid.n === Number(id));
      if (index >= 0) { next.created.splice(index, 1); return 'removed'; }
      if (next.kids.delete(Number(id))) return 'undone';
      throw new HttpError(404, 'There is nothing of yours to undo for this kid.');
    });
  }

  function saveBadge(box, id, input) {
    const { spec, svg } = renderSpec(input.spec);
    const result = commit(box, next => {
      next.rev += 1;
      const made = next.created.find(kid => CREATED_BASE_ID + kid.n === Number(id));
      if (made) {
        Object.assign(made, { badge: spec, rev: next.rev });
        return createdView(made);
      }
      const row = channelById(sqlite, Number(id));
      if (!row) throw new HttpError(404, 'Channel not found.');
      next.kids.set(row.id, { ...next.kids.get(row.id), badge: spec, rev: next.rev });
      return seededView(row, next);
    });
    return { ok: true, spec, svg, url: result.logoUrl, logoUrl: result.logoUrl };
  }

  function badgeSpecFor(box, slug) {
    const n = Number(CREATED_SLUG.exec(slug)?.[1]);
    if (n) return box?.created.find(kid => kid.n === n)?.badge || null;
    const row = listChannels(sqlite).find(entry => entry.slug === slug);
    return row ? box?.kids.get(row.id)?.badge || null : null;
  }

  function sendBadge(req, res, slug) {
    const spec = badgeSpecFor(find(req), slug);
    if (!spec) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('Not found\n'); return; }
    const { svg } = renderSpec(spec);
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, no-store', 'Content-Length': String(Buffer.byteLength(svg)),
      'Content-Security-Policy': "default-src 'none'", 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : svg);
  }

  async function route(req, res, pathname, refuse) {
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    if (pathname === '/api/demo/sandbox') {
      if (method !== 'GET') { req.resume(); return sendJson(res, 405, { ok: false, error: 'Method not allowed.' }); }
      return sendJson(res, 200, { ok: true, ...info(find(req)) });
    }
    if (pathname === '/api/demo/sandbox/reset') {
      if (method !== 'POST') { req.resume(); return sendJson(res, 405, { ok: false, error: 'Method not allowed.' }); }
      req.resume();
      const id = cookieValue(req);
      if (ID.test(id)) boxes.delete(id);
      return sendJson(res, 200, { ok: true, ...info(null) }, { 'Set-Cookie': cookie('', 0) });
    }
    const badge = BADGE_ROUTE.exec(pathname);
    if (badge) {
      if (method !== 'GET') { req.resume(); return sendJson(res, 405, { ok: false, error: 'Method not allowed.' }); }
      return sendBadge(req, res, badge[1]);
    }

    // The dashboard's kid routes, for the demo's parent. Anyone else gets the demo's usual refusal.
    if (!await ownerOf(env, req)) return refuse();
    if (pathname === '/api/admin/kids') {
      const input = await readJson(req);
      const box = open(req, res);
      spend(box);
      return sendJson(res, 200, { ok: true, kid: { ...saveKid(box, input), reviewUploads: false, login: null, placeholder: false } });
    }
    if (pathname === '/api/admin/kids/delete') {
      const input = await readJson(req);
      const box = find(req);
      if (box) spend(box);
      const done = removeKid(box, input.id);
      return sendJson(res, 200, { ok: true, done });
    }
    const channel = CHANNEL_BADGE.exec(pathname);
    if (channel && method === 'GET') {
      const box = find(req);
      const made = createdOf(box, channel[1]);
      const row = made ? null : channelById(sqlite, Number(channel[1]));
      if (!made && !row) return sendJson(res, 404, { ok: false, error: 'Channel not found.' });
      const view = made ? createdView(made) : seededView(row, box);
      let spec = made ? made.badge : box?.kids.get(row.id)?.badge || null;
      if (!spec && row) { try { const saved = JSON.parse(row.badge || 'null'); spec = saved && Object.keys(saved).length ? saved : null; } catch {} }
      return sendJson(res, 200, { ok: true, spec, url: view.logoUrl, imageUrl: null });
    }
    if (channel && method === 'PUT') {
      const input = await readJson(req);
      const box = open(req, res);
      spend(box);
      return sendJson(res, 200, saveBadge(box, channel[1], input));
    }
    return refuse();
  }

  // The sandbox's own routes and the dashboard routes it answers. True when it answered.
  function handle(req, res, pathname, refuse) {
    const own = pathname === '/api/demo/sandbox' || pathname.startsWith('/api/demo/sandbox/');
    const kids = (pathname === '/api/admin/kids' || pathname === '/api/admin/kids/delete') && req.method === 'POST';
    const badge = CHANNEL_BADGE.test(pathname) && ['GET', 'HEAD', 'PUT'].includes(req.method);
    if (!own && !kids && !badge) return false;
    route(req, res, pathname, () => refuse(req, res, pathname)).catch(error => {
      req.resume();
      if (res.headersSent) { res.destroy(); return; }
      if (error instanceof HttpError) return sendJson(res, error.status, { ok: false, demo: true, error: error.message });
      if (error instanceof BadgeSpecError) return sendJson(res, 400, { ok: false, demo: true, error: error.message });
      console.error('Demo sandbox request failed', error);
      sendJson(res, 500, { ok: false, error: 'Something went wrong. Try again.' });
    });
    return true;
  }

  return { handle, overlay, clearAll, get size() { return boxes.size; } };
}
