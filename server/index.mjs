import http from 'node:http';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import api, { sessOk } from './api.js';
import { viewer, mediaCookie, accountCookie, clearCookie } from './access.mjs';
import { openDatabase } from './db.mjs';
import { createUploadManager } from './uploads.mjs';
import { createVideoNotifications } from './notifications.mjs';
import { createStatic } from './static.mjs';
import { createThemes } from './themes.mjs';
import { migrate } from './schema.mjs';
import { BRAND_NAME } from './brand.mjs';
import { createSettings } from './settings.mjs';
import { createSite } from './site.mjs';
import { createBrandFiles } from './brandfiles.mjs';
import { InstallError, checkSiteUrl, prepareInstall } from './config.mjs';
import { createFamily } from './family.mjs';
import { clientIp, createSetup } from './setup.mjs';
import { createCapsules } from './capsules.mjs';
import { createReactions } from './reactions.mjs';
import { createWatch } from './watch.mjs';
import { createPwa } from './pwa.mjs';
import { DemoError, openDemo } from './demo.mjs';

const port = Number(process.env.PORT || 3000);
const publicDir = resolve(process.env.PUBLIC_DIR || 'public');
const sendFile = createStatic(publicDir);
const themes = createThemes(publicDir);
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
if(settings.get('mail_mode')==='brevo')for(const key of ['brevo_api_key','notify_email','sender_email'])if(!settings.get(key))stop(key.toUpperCase()+' is required for email');
// Site and mail settings are read live, so a parent's change applies without a restart.
const env = {
  DB,
  SIGN_SECRET: install.secret,
  get SITE_URL() { return settings.get('site_url'); },
  get MAIL_MODE() { return settings.get('mail_mode'); },
  get BREVO_API_KEY() { return settings.get('brevo_api_key'); },
  get NOTIFY_EMAIL() { return settings.get('notify_email'); },
  get SENDER_EMAIL() { return settings.get('sender_email'); },
  settings,
  site: createSite({ sqlite, settings }),
};
const notifications = createVideoNotifications({ sqlite, env });
env.handleVideoUnsubscribe = request => notifications.handleUnsubscribe(request);
// The review endpoint publishes through publish.mjs, which works on the raw database and the outbox.
env.sqlite = sqlite;
env.notifications = notifications;
// Time capsules, reactions and the watch log behind daily tape budgets. api.js reads capsules and watch from env.
const capsules = createCapsules({ sqlite, notifications, env });
const reactions = createReactions({ sqlite, env });
const watch = createWatch({ sqlite, settings, env });
env.capsules = capsules;
env.watch = watch;
env.reactions = reactions;
capsules.start();
watch.start();
// A sealed clip's video and poster stay closed to all but parents; a spent daily tape stops video, not posters.
const canWatch = (who, at, media) => capsules.mediaRefusal(who, media.clipId, at) || (media.poster || watch.canWatch(who, at));
const uploads = createUploadManager({ sqlite, env, databasePath: dbFile, notifications, canWatch });
env.deleteLocalVideo = uploads.deleteVideo;
const brandFiles = createBrandFiles({ sqlite, env, dataDir });
const family = createFamily({ sqlite, themeIds: () => themes.list().map(theme => theme.id), removeChannelFiles: brandFiles.removeChannel });
const pages = demo ? demo.pages(sendFile, publicDir) : sendFile;
const setup = createSetup({ sqlite, settings, env, paths: install, family, sendFile: pages });
// The home-screen app: manifest, Apple icon and the service worker, built from the shell as it is now.
const pwa = createPwa({ settings, brandFiles, dataDir, publicDir, pageHtml: sendFile.pageHtml });
const monitor = (await import('./monitor.mjs')).createMonitor({ sqlite, settings, env, family, paths: install });
notifications.kick();
demo?.start(env);

async function sendApi(req, res, who) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) { res.writeHead(413).end(); return; }
    chunks.push(chunk);
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const headers = new Headers(req.headers);
  headers.set('CF-Connecting-IP', clientIp(req));
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(url, { method: req.method, headers, body });
  if(url.pathname==='/api/logout'&&req.method==='POST'){res.writeHead(200,{'Set-Cookie':clearCookie(env),'Content-Type':'application/json'}).end('{"ok":true}');return;}
  const response = await api.fetch(request, env, { viewer: who });
  const out = Object.fromEntries(response.headers);
  out['Cache-Control'] = 'no-store';
  if(response.ok&&['/api/login','/api/check','/api/guest/redeem','/api/guest/validate'].includes(url.pathname)) {
    const result=await response.clone().json();
    if(result.ok) {
      // The API names the canonical account, so the cookie never depends on how the request spelled it.
      if(result.status==='approved'&&result.t&&result.email){
        if(await sessOk(env,result.email,result.t))out['Set-Cookie']=accountCookie(env,sqlite,result.email);
      }else if(result.role==='guest'){
        const input=body?JSON.parse(body):{};
        out['Set-Cookie']=mediaCookie(env,{guest:result.token||input.token},Math.max(0,Math.floor((result.expires-Date.now())/1000)));
      }
    }
  }
  res.writeHead(response.status, out);
  if (req.method === 'HEAD' || !response.body) { res.end(); return; }
  Readable.fromWeb(response.body).pipe(res);
}

const attempts=new Map();
const server = http.createServer((req, res) => {
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!setup.originAllowed(req)){res.writeHead(403).end();return;}
  let pathname;
  try { pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/\/+$/, '') || '/'; }catch{res.writeHead(400).end();return;}
  if(demo?.handle(req,res,pathname))return;
  if(pathname==='/api/themes'){themes.handle(req,res);return;}
  if(pwa.handle(req,res,pathname))return;
  if(setup.handle(req,res,pathname))return;
  if(!demo?.quiet(pathname)&&monitor.handle(req,res,pathname))return;
  if(['/api/login','/api/signup','/api/guest/redeem'].includes(pathname)){
    const ip=clientIp(req);
    const now=Date.now(); for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
    const limit=attempts.get(ip)||{n:0,until:now+600000};limit.n++;attempts.set(ip,limit);
    if(limit.n>20){res.writeHead(429,{'Content-Type':'application/json'}).end('{"ok":false,"error":"Too many attempts. Try again in ten minutes."}');return;}
  }
  // Who is asking, from the signed cookie: the API and the video routes check channels and review with it.
  const who=pathname.startsWith('/api/')?viewer(req,sqlite,env):null;
  if(['/api/clips','/api/clips/locate','/api/likes','/api/comments','/api/channels','/api/reactions','/api/view','/api/view/beat'].includes(pathname)||pathname.startsWith('/api/video/')||pathname.startsWith('/api/media/')){
    if(!who){res.writeHead(401,{'Content-Type':'application/json','Cache-Control':'no-store'}).end('{"ok":false,"error":"Log in to view this channel."}');return;}
    res.setHeader('Cache-Control','private, no-store');
  }
  if(capsules.handle(req,res,pathname,who)||reactions.handle(req,res,pathname,who)||watch.handle(req,res,pathname,who))return;
  if(pathname.startsWith('/brand/')||/^\/api\/admin\/(?:brand(?:\/|$)|channels\/[^/]+\/(?:badge|image)$)/.test(pathname)){brandFiles.handle(req,res,pathname);return;}
  if(pathname.startsWith('/uploads/')){res.writeHead(404).end();return;}
  if (pathname.startsWith('/api/upload/raw/') || pathname.startsWith('/api/video/')) {
    uploads.handle(req, res, pathname, who);
  } else if (pathname.startsWith('/api/')) {
    sendApi(req, res, who).catch(error => {
      console.error('API request failed', error);
      if (!res.headersSent) res.writeHead(500).end(); else res.destroy(error);
    });
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    pages(req, res, pathname);
  } else {
    res.writeHead(405).end();
  }
});
server.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`${BRAND_NAME} listening on ${server.address().port}`);
  setup.announce(server.address().port);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(async () => { await notifications.close(); sqlite.close(); process.exit(0); });
});

