// Request and response helpers for the routes that run on node:http directly (everything but api.js):
// JSON bodies and answers, HttpError, the parent's dashboard session, and an in-memory rate limit.
import { asStaff } from './api.js';
import { isStaff } from './channels.mjs';

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

export function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

// sendBeacon posts text/plain, so the body is parsed whatever its content type says.
export async function readJson(req, limit = 16384) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'That request is too big.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {}
  throw new HttpError(400, 'Invalid request.');
}

// The session the dashboard pages send in X-Kid-Email / X-Kid-Token: { email, role } for a parent or
// co-parent, else null.
export async function headerStaff(env, req) {
  const email = String(req.headers['x-kid-email'] || '').trim().toLowerCase();
  const token = String(req.headers['x-kid-token'] || '');
  return email && token ? asStaff(env, email, token) : null;
}

const unb64u = value => { try { return Buffer.from(String(value || ''), 'base64url').toString('utf8'); } catch { return ''; } };

// Parents and Family. POSTs carry the dashboard session in the body like every admin route; reads take
// X-Kid-Email / X-Kid-Token headers, the older ?e=<base64url email>&t=, or a staff cookie.
export async function staffFor(env, req, who, body) {
  if (body) return asStaff(env, String(body.email || '').trim().toLowerCase(), String(body.t || ''));
  if (req.headers['x-kid-email']) return headerStaff(env, req);
  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.has('e')) return asStaff(env, unb64u(url.searchParams.get('e')).trim().toLowerCase(), url.searchParams.get('t') || '');
  return isStaff(who) ? who : null;
}

// A sliding-window limit kept in memory: hit(key) counts one use and is true once key has gone over
// `limit` uses in `windowMs`. Past maxKeys the whole map is dropped, so a flood cannot grow it forever.
export function rateLimit({ limit, windowMs, maxKeys = 5000 }) {
  const uses = new Map();
  return function hit(key, at = Date.now()) {
    const recent = (uses.get(key) || []).filter(time => time > at - windowMs);
    if (uses.size > maxKeys) uses.clear();
    recent.push(at);
    uses.set(key, recent);
    return recent.length > limit;
  };
}

// Runs a route and turns thrown HttpErrors into JSON answers.
export async function answer(res, route) {
  try {
    await route();
  } catch (error) {
    if (!(error instanceof HttpError)) console.error('Request failed:', error);
    if (res.headersSent) { res.destroy(); return; }
    if (error instanceof HttpError) sendJson(res, error.status, { ok: false, error: error.message, ...error.extra });
    else sendJson(res, 500, { ok: false, error: 'Something went wrong. Try again.' });
  }
}
