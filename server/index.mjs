// The server: opens the install, wires the modules together, and hands each request to the one module
// that answers it. Handlers are tried in order and the first one that claims a request answers it.
import http from 'node:http';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import api, { sessOk } from './api.js';
import { viewer, mediaCookie, accountCookie, clearCookie } from './access.mjs';
import { BRAND_NAME } from './brand.mjs';
import { createBrandFiles } from './brandfiles.mjs';
import { createCapsules } from './capsules.mjs';
import { InstallError, checkSiteUrl, prepareInstall } from './config.mjs';
import { openDatabase } from './db.mjs';
import { DemoError, openDemo } from './demo.mjs';
import { createFamily } from './family.mjs';
import { sendJson } from './jsonio.mjs';
import { createMonitor } from './monitor.mjs';
import { createVideoNotifications } from './notifications.mjs';
import { createPwa } from './pwa.mjs';
import { createReactions } from './reactions.mjs';
import { migrate } from './schema.mjs';
import { createSettings } from './settings.mjs';
import { clientIp, createSetup } from './setup.mjs';
import { createSite } from './site.mjs';
import { createStatic } from './static.mjs';
import { createThemes } from './themes.mjs';
import { createUploadManager } from './uploads.mjs';
import { createWatch } from './watch.mjs';

/* ---------- boot ---------- */

const port = Number(process.env.PORT || 3000);
const publicDir = resolve(process.env.PUBLIC_DIR || 'public');
const sendFile = createStatic(publicDir);
const themes = createThemes(publicDir);
const themeIds = () => themes.list().map(theme => theme.id);

// First boot needs no .env: the data folder, the signing secret and the database are created here,
// and SITE_URL waits for the setup wizard. Problems a parent can fix print one plain message.
const stop = message => { console.error(message); process.exit(1); };
let install;
try { install = prepareInstall(); } catch (error) { if (error instanceof InstallError) stop(error.message); throw error; }
const { database: dbFile, dataDir } = install;
const { sqlite, DB } = openDatabase(dbFile, { allowEmpty: true });
// DEMO_MODE=1 makes this the public demo (server/demo.mjs). It refuses a family's install before anything is written.
let demo = null;
try { demo = openDemo({ sqlite, dataDir, database: dbFile }); } catch (error) { if (error instanceof DemoError) stop(error.message); throw error; }
await migrate(sqlite, { dataDir });
if (demo) await demo.restore();

const settings = createSettings(sqlite, demo ? demo.environment(process.env) : process.env);
try { checkSiteUrl(settings.get('site_url')); } catch (error) { stop(error.message); }
if (settings.get('mail_mode') === 'brevo') {
  for (const key of ['brevo_api_key', 'notify_email', 'sender_email']) if (!settings.get(key)) stop(`${key.toUpperCase()} is required for email`);
}

/* ---------- the modules ---------- */

// What api.js and the route modules share. Site and mail settings are read live, so a parent's change
// applies without a restart.
const env = {
  DB, sqlite, settings,
  SIGN_SECRET: install.secret,
  get SITE_URL() { return settings.get('site_url'); },
  get MAIL_MODE() { return settings.get('mail_mode'); },
  get BREVO_API_KEY() { return settings.get('brevo_api_key'); },
  get NOTIFY_EMAIL() { return settings.get('notify_email'); },
  get SENDER_EMAIL() { return settings.get('sender_email'); },
  site: createSite({ sqlite, settings }),
};
const notifications = createVideoNotifications({ sqlite, env });
// Time capsules, reactions and the watch log behind daily tape budgets; api.js reads them from env too.
const capsules = createCapsules({ sqlite, notifications, env });
const reactions = createReactions({ sqlite, env });
const watch = createWatch({ sqlite, settings, env });
Object.assign(env, { notifications, capsules, reactions, watch });
capsules.start();
watch.start();

// A sealed clip's video and poster stay closed to all but parents; a spent daily tape stops video, not posters.
const canWatch = (who, at, media) => capsules.mediaRefusal(who, media.clipId, at) || (media.poster || watch.canWatch(who, at));
const uploads = createUploadManager({ sqlite, env, databasePath: dbFile, notifications, canWatch });
env.deleteLocalVideo = uploads.deleteVideo;
const brandFiles = createBrandFiles({ sqlite, env, dataDir });
const family = createFamily({ sqlite, themeIds, removeChannelFiles: brandFiles.removeChannel });
// In the demo every page also carries the demo banner.
const pages = demo ? demo.pages(sendFile) : sendFile;
const setup = createSetup({ sqlite, settings, env, paths: install, family, sendFile: pages });
// The home-screen app: manifest, Apple icon and the service worker, built from the shell as it is now.
const pwa = createPwa({ settings, brandFiles, dataDir, publicDir, pageHtml: sendFile.pageHtml });
const monitor = createMonitor({ sqlite, settings, env, family, paths: install });
notifications.kick();
demo?.start(env, { themeIds });

/* ---------- requests ---------- */

// Routes for a signed-in viewer (an account or a guest pass), never stored by a shared cache.
const SIGNED_IN = new Set(['/api/clips', '/api/clips/locate', '/api/likes', '/api/comments', '/api/channels', '/api/reactions', '/api/view', '/api/view/beat']);
const signedInOnly = pathname => SIGNED_IN.has(pathname) || pathname.startsWith('/api/video/') || pathname.startsWith('/api/media/');
const BRAND_ADMIN = /^\/api\/admin\/(?:brand(?:\/|$)|channels\/[^/]+\/(?:badge|image)$)/;

// Signing in and redeeming guest codes: 20 tries per address in a ten-minute window, on top of
// api.js's own per-account and per-code limits.
const SIGN_IN = new Set(['/api/login', '/api/signup', '/api/guest/redeem']);
const attempts = new Map();
function tooManySignIns(req) {
  const ip = clientIp(req), now = Date.now();
  for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
  const entry = attempts.get(ip) || { n: 0, until: now + 10 * 60 * 1000 };
  entry.n++;
  attempts.set(ip, entry);
  return entry.n > 20;
}

// The answers that start a session, which also set the signed cookie the video routes read.
const SESSION_ROUTES = new Set(['/api/login', '/api/check', '/api/guest/redeem', '/api/guest/validate']);

// api.js speaks fetch's Request and Response; this turns a node:http request into one and back.
async function sendApi(req, res, who) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) { res.writeHead(413).end(); return; }
    chunks.push(chunk);
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/logout' && req.method === 'POST') { sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(env) }); return; }
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(url, { method: req.method, headers: new Headers(req.headers), body });
  const response = await api.fetch(request, env, { viewer: who, ip: clientIp(req) });
  const headers = { ...Object.fromEntries(response.headers), 'Cache-Control': 'no-store' };
  if (response.ok && SESSION_ROUTES.has(url.pathname)) {
    const result = await response.clone().json();
    // The API names the canonical account, so the cookie never depends on how the request spelled it.
    if (result.ok && result.status === 'approved' && result.t && result.email) {
      if (await sessOk(env, result.email, result.t)) headers['Set-Cookie'] = accountCookie(env, sqlite, result.email);
    } else if (result.ok && result.role === 'guest') {
      const token = result.token || (body ? JSON.parse(body) : {}).token;
      headers['Set-Cookie'] = mediaCookie(env, { guest: token }, Math.max(0, Math.floor((result.expires - Date.now()) / 1000)));
    }
  }
  res.writeHead(response.status, headers);
  if (req.method === 'HEAD' || !response.body) { res.end(); return; }
  Readable.fromWeb(response.body).pipe(res);
}

function route(req, res) {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // The health check answers whatever the Host, so Docker and monitors on the box itself keep working.
  if (!setup.hostAllowed(req) && req.url.split('?')[0] !== '/api/health') {
    res.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      .end('This is not the web address this family uses. Open the address from the parent dashboard, or add this name to ALLOWED_HOSTS.\n');
    return;
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !setup.originAllowed(req)) { res.writeHead(403).end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/\/+$/, '') || '/'; }
  catch { res.writeHead(400).end(); return; }

  if (demo?.handle(req, res, pathname)) return;
  if (pathname === '/api/themes') { themes.handle(req, res); return; }
  if (pwa.handle(req, res, pathname)) return;
  if (setup.handle(req, res, pathname)) return;
  // The demo's visitors share accounts, so it keeps their visits out of the dashboard's "last seen".
  if (!demo?.quiet(pathname) && monitor.handle(req, res, pathname)) return;
  if (SIGN_IN.has(pathname) && tooManySignIns(req)) {
    sendJson(res, 429, { ok: false, error: 'Too many attempts. Try again in ten minutes.' });
    return;
  }

  // Who is asking, from the signed cookie: the API and the video routes check channels and review with it.
  const who = pathname.startsWith('/api/') ? viewer(req, sqlite, env) : null;
  if (signedInOnly(pathname)) {
    if (!who) { sendJson(res, 401, { ok: false, error: 'Log in to view this channel.' }); return; }
    res.setHeader('Cache-Control', 'private, no-store');
  }
  if (capsules.handle(req, res, pathname, who) || reactions.handle(req, res, pathname, who) || watch.handle(req, res, pathname, who)) return;
  if (pathname.startsWith('/brand/') || BRAND_ADMIN.test(pathname)) { brandFiles.handle(req, res, pathname); return; }
  // An older layout kept videos under public/uploads; anything left there is never served.
  if (pathname.startsWith('/uploads/')) { res.writeHead(404).end(); return; }
  if (pathname.startsWith('/api/upload/raw/') || pathname.startsWith('/api/video/')) { uploads.handle(req, res, pathname, who); return; }
  if (pathname.startsWith('/api/')) {
    sendApi(req, res, who).catch(error => {
      console.error('API request failed', error);
      if (!res.headersSent) res.writeHead(500).end(); else res.destroy(error);
    });
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') { pages(req, res, pathname); return; }
  res.writeHead(405).end();
}

const server = http.createServer(route);
server.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`${BRAND_NAME} listening on ${server.address().port}`);
  setup.announce(server.address().port);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(async () => { await notifications.close(); sqlite.close(); process.exit(0); });
});
