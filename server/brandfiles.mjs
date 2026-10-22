import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { viewer } from './access.mjs';
import { asStaff } from './api.js';
import { BadgeSpecError, renderSpec } from './badge.mjs';
import { canViewChannel, channelById, channelBySlug } from './channels.mjs';
import { ImageError, MAX_IMAGE_BYTES, cleanIcon, cleanImage, imageExtension } from './images.mjs';

// Badges, parent pictures and home-screen icons live under DATA_DIR/brand: family/* for the family's
// badge and icons, channels/<id>/* for each kid. Files are named by content hash and never change, so
// they are cached forever; index.json in each folder names the current revision of each kind.
const ICON_SIDES = { 192: 192, 512: 512, 'maskable-512': 512, 'apple-180': 180 };
const FILE = /^(badge|image|icon-(?:192|512|maskable-512|apple-180))-([a-f0-9]{16})\.(svg|png|jpg|webp)$/;
const CHANNEL_ID = /^[1-9]\d{0,8}$/;
const TYPES = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const FOREVER = 'max-age=31536000, immutable';
// A kid's badge and picture: never in a shared cache, and gone from browsers within the hour once a parent
// hides the kids or changes the picture. The family's badge and icons may be kept forever.
const KID_FILE = 'private, max-age=3600';
const MAX_JSON = 16 * 1024;
const MAX_ICON = 1024 * 1024;
const ADMIN_CHANNEL = /^\/api\/admin\/channels\/([^/]+)\/(badge|image)$/;
const ADMIN_ICON = /^\/api\/admin\/brand\/icons\/([^/]+)$/;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function body(req, limit) {
  if (Number(req.headers['content-length']) > limit) throw new HttpError(413, 'That file is too big.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'That file is too big.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function jsonBody(req) {
  const bytes = await body(req, MAX_JSON);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new HttpError(400, 'Invalid request.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Invalid request.');
  return value;
}

const contentHash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

export function createBrandFiles({ sqlite, env, dataDir }) {
  const root = join(dataDir, 'brand');
  const familyDir = join(root, 'family');
  const channelDir = id => join(root, 'channels', String(id));
  mkdirSync(familyDir, { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'channels'), { recursive: true, mode: 0o700 });
  const log = sqlite.prepare('INSERT INTO activity (ts,actor,kind,subject,detail) VALUES (?,?,?,?,?)');
  const bumpBadge = sqlite.prepare('UPDATE channels SET badge=?, logo_rev=logo_rev+1 WHERE id=? RETURNING logo_rev');

  // One change at a time per folder, so the index and the files on disk always agree.
  const queues = new Map();
  function serialized(dir, task) {
    const run = (queues.get(dir) || Promise.resolve()).then(task);
    queues.set(dir, run.catch(() => {}));
    return run;
  }

  async function readIndex(dir) {
    try { return JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')); } catch { return {}; }
  }
  async function writeAtomic(file, bytes) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, file);
  }
  async function prune(dir, kind, keep) {
    for (const name of await readdir(dir).catch(() => [])) {
      const match = FILE.exec(name);
      if (match && match[1] === kind && name !== keep) await rm(join(dir, name), { force: true });
    }
  }

  // Writes the new revision, points the index at it, and only then removes the old ones.
  function replace(dir, kind, extension, bytes) {
    return serialized(dir, async () => {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const name = `${kind}-${contentHash(bytes)}.${extension}`;
      await writeAtomic(join(dir, name), bytes);
      const index = await readIndex(dir);
      index[kind] = name;
      await writeAtomic(join(dir, 'index.json'), JSON.stringify(index));
      await prune(dir, kind, name);
      return name;
    });
  }
  function remove(dir, kind) {
    return serialized(dir, async () => {
      const index = await readIndex(dir);
      if (!index[kind]) return false;
      delete index[kind];
      await writeAtomic(join(dir, 'index.json'), JSON.stringify(index));
      await prune(dir, kind, null);
      return true;
    });
  }

  const channelUrl = (id, name) => name ? `/brand/channels/${id}/${name}` : null;
  const familyUrl = name => name ? `/brand/family/${name}` : null;

  /* ---------- serving ---------- */
  function sendFile(req, res, bytes, name, cacheControl) {
    const etag = `"${FILE.exec(name)?.[2] || contentHash(bytes)}"`;
    const headers = {
      'Content-Type': TYPES[name.split('.').pop()], 'Cache-Control': cacheControl, ETag: etag,
      'Content-Security-Policy': "default-src 'none'", 'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers).end(); return; }
    headers['Content-Length'] = String(bytes.length);
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : bytes);
  }

  async function readStored(dir, name) {
    if (!name || !FILE.test(name)) return null;
    return readFile(join(dir, name)).catch(() => null);
  }

  // Kids' badges and pictures are as private as their names: public only while the front door shows kids,
  // and otherwise only to someone who may watch that kid (a guest pass can be limited to one).
  function kidsVisible(req) {
    return env.settings.get('kids_public') || Boolean(viewer(req, sqlite, env));
  }
  const mayView = (req, channel) => env.settings.get('kids_public') || canViewChannel(viewer(req, sqlite, env), channel);

  async function serve(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    const url = new URL(req.url, 'http://localhost');
    const parts = pathname.split('/').slice(2);
    if (pathname === '/brand/family.svg') {
      const name = (await readIndex(familyDir)).badge;
      const bytes = await readStored(familyDir, name);
      if (!bytes) throw new HttpError(404, 'Not found.');
      return sendFile(req, res, bytes, name, 'no-cache');
    }
    if (parts[0] === 'family' && parts.length === 2) {
      const bytes = await readStored(familyDir, parts[1]);
      if (!bytes) throw new HttpError(404, 'Not found.');
      return sendFile(req, res, bytes, parts[1], `public, ${FOREVER}`);
    }
    const isChannelFile = parts[0] === 'channels' && parts.length === 3;
    const slug = parts.length === 1 && /^(.+)\.svg$/.exec(parts[0])?.[1];
    if (!isChannelFile && !slug) throw new HttpError(404, 'Not found.');
    if (!kidsVisible(req)) throw new HttpError(401, 'Log in to see this.');
    if (isChannelFile) {
      if (!CHANNEL_ID.test(parts[1]) || !mayView(req, { id: Number(parts[1]) })) throw new HttpError(404, 'Not found.');
      const bytes = await readStored(channelDir(parts[1]), parts[2]);
      if (!bytes) throw new HttpError(404, 'Not found.');
      return sendFile(req, res, bytes, parts[2], KID_FILE);
    }
    // /brand/<slug>.svg is the channel's current badge; ?v=<logo_rev> makes the URL safe to keep.
    const channel = channelBySlug(sqlite, slug);
    if (!channel || !mayView(req, channel)) throw new HttpError(404, 'Not found.');
    const dir = channelDir(channel.id);
    const name = (await readIndex(dir)).badge;
    const bytes = await readStored(dir, name);
    if (!bytes) throw new HttpError(404, 'Not found.');
    const current = url.searchParams.get('v') === String(channel.logo_rev);
    return sendFile(req, res, bytes, name, current ? KID_FILE : 'private, no-cache');
  }

  /* ---------- parent changes ---------- */
  async function staff(req, payload = {}) {
    const email = String(req.headers['x-kid-email'] || payload.email || '').trim().toLowerCase();
    const token = String(req.headers['x-kid-token'] || payload.t || '');
    const user = await asStaff(env, email, token);
    if (!user) throw new HttpError(403, 'Only parents can change badges.');
    return user;
  }
  // Kids' badges and pictures and the family's own belong to the owner, like the Kids and Settings screens.
  async function owner(req, payload) {
    const user = await staff(req, payload);
    if (user.role !== 'super') throw new HttpError(403, 'Only the parent who set this up can change this.');
    return user;
  }

  function channelFrom(id) {
    const channel = channelById(sqlite, Number(id));
    if (!channel) throw new HttpError(404, 'Channel not found.');
    return channel;
  }

  async function admin(req, res, pathname) {
    const channelRoute = ADMIN_CHANNEL.exec(pathname);
    if (channelRoute) {
      const [, id, what] = channelRoute;
      if (!CHANNEL_ID.test(id)) throw new HttpError(404, 'Channel not found.');
      const dir = channelDir(id);
      if (what === 'badge' && req.method === 'GET') {
        await staff(req);
        const channel = channelFrom(id);
        const index = await readIndex(dir);
        let spec = null;
        try { const saved = JSON.parse(channel.badge); spec = saved && Object.keys(saved).length ? saved : null; } catch {}
        return json(res, 200, { ok: true, spec, url: channelUrl(id, index.badge), imageUrl: channelUrl(id, index.image) });
      }
      if (what === 'badge' && req.method === 'PUT') {
        const payload = await jsonBody(req);
        const user = await owner(req, payload);
        channelFrom(id);
        const { spec, svg } = renderSpec(payload.spec);
        const name = await replace(dir, 'badge', 'svg', svg);
        const { logo_rev: rev } = bumpBadge.get(JSON.stringify(spec), Number(id));
        const { slug } = channelFrom(id);
        log.run(Date.now(), user.email, 'badge', `channel:${id}`, JSON.stringify({ file: name }));
        return json(res, 200, { ok: true, spec, svg, url: channelUrl(id, name), logoUrl: `/brand/${slug}.svg?v=${rev}` });
      }
      if (what === 'image' && req.method === 'PUT') {
        const user = await owner(req);
        channelFrom(id);
        const image = cleanImage(await body(req, MAX_IMAGE_BYTES));
        const name = await replace(dir, 'image', imageExtension(image.kind), image.bytes);
        log.run(Date.now(), user.email, 'image', `channel:${id}`, JSON.stringify({ file: name }));
        return json(res, 200, { ok: true, url: channelUrl(id, name), width: image.width, height: image.height });
      }
      if (what === 'image' && req.method === 'DELETE') {
        const user = await owner(req);
        channelFrom(id);
        if (await remove(dir, 'image')) log.run(Date.now(), user.email, 'image', `channel:${id}`, '{"removed":true}');
        return json(res, 200, { ok: true });
      }
      throw new HttpError(405, 'Method not allowed.');
    }
    if (pathname === '/api/admin/brand' && req.method === 'GET') {
      await staff(req);
      return json(res, 200, { ok: true, spec: env.settings.get('family_badge'), ...await family() });
    }
    if (pathname === '/api/admin/brand/badge' && req.method === 'PUT') {
      const payload = await jsonBody(req);
      const user = await owner(req, payload);
      const { spec, svg } = renderSpec(payload.spec);
      const name = await replace(familyDir, 'badge', 'svg', svg);
      env.settings.set('family_badge', spec, user.email);
      return json(res, 200, { ok: true, spec, svg, url: familyUrl(name) });
    }
    const iconRoute = ADMIN_ICON.exec(pathname);
    if (iconRoute && req.method === 'PUT') {
      const variant = iconRoute[1];
      if (!Object.hasOwn(ICON_SIDES, variant)) throw new HttpError(404, 'Unknown icon.');
      const user = await owner(req);
      const png = cleanIcon(await body(req, MAX_ICON), ICON_SIDES[variant]);
      const name = await replace(familyDir, `icon-${variant}`, 'png', png);
      log.run(Date.now(), user.email, 'icon', 'family', JSON.stringify({ file: name }));
      return json(res, 200, { ok: true, url: familyUrl(name) });
    }
    throw new HttpError(404, 'Not found.');
  }

  async function handle(req, res, pathname) {
    try {
      if (pathname.startsWith('/brand/')) return await serve(req, res, pathname);
      return await admin(req, res, pathname);
    } catch (error) {
      req.resume();
      if (res.headersSent) { res.destroy(error); return; }
      if (error instanceof HttpError) return json(res, error.status, { ok: false, error: error.message });
      if (error instanceof BadgeSpecError || error instanceof ImageError) return json(res, 400, { ok: false, error: error.message });
      console.error('Brand request failed', error);
      return json(res, 500, { ok: false, error: 'Something went wrong. Try again.' });
    }
  }

  // For the web app manifest (M8): the family's badge and icons, or nulls before a parent saves them.
  async function family() {
    const index = await readIndex(familyDir);
    return {
      badge: familyUrl(index.badge),
      icons: Object.fromEntries(Object.keys(ICON_SIDES).map(variant => [variant, familyUrl(index[`icon-${variant}`])])),
    };
  }

  // For channel deletion (M7): drops the kid's files with the channel.
  function removeChannel(id) {
    if (!CHANNEL_ID.test(String(id))) return Promise.resolve();
    return serialized(channelDir(id), () => rm(channelDir(id), { recursive: true, force: true }));
  }

  return { handle, family, removeChannel };
}
