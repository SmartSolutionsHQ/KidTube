import http from 'node:http';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import api, { sessOk } from './api.js';
import { viewer, mediaCookie, accountCookie, clearCookie } from './access.mjs';
import { openDatabase } from './db.mjs';
import { createUploadManager } from './uploads.mjs';
import { createVideoNotifications } from './notifications.mjs';
import { publishClip } from './publish.mjs';
import { sendFile } from './static.mjs';
import { initializeSchema } from './schema.mjs';

const port = Number(process.env.PORT || 3000);
const publicDir = resolve(process.env.PUBLIC_DIR || 'public');
const dbFile = process.env.DATABASE_PATH || 'data/kidtube.sqlite';
for (const key of ['SIGN_SECRET', 'SITE_URL']) {
  if (!process.env[key]) throw new Error(`${key} is required`);
}
if(process.env.SIGN_SECRET.length<32) throw new Error('SIGN_SECRET must have at least 32 characters. Run npm run setup.');
const site=new URL(process.env.SITE_URL);
if(!['http:','https:'].includes(site.protocol)||site.username||site.password||site.pathname!=='/'||site.search||site.hash)throw new Error('SITE_URL must be an HTTP(S) origin without a path.');
if(process.env.NODE_ENV==='production'&&site.protocol!=='https:')throw new Error('Production requires HTTPS SITE_URL.');
if(!['disabled','brevo'].includes(process.env.MAIL_MODE||'disabled'))throw new Error('MAIL_MODE must be disabled or brevo');
if(process.env.MAIL_MODE==='brevo')for(const key of ['BREVO_API_KEY','NOTIFY_EMAIL','SENDER_EMAIL'])if(!process.env[key])throw new Error(key+' is required for email');
const { sqlite, DB } = openDatabase(dbFile, { allowEmpty: process.env.ALLOW_EMPTY_DB === '1' });
initializeSchema(sqlite);
const env = {
  DB,
  SIGN_SECRET: process.env.SIGN_SECRET,
  BREVO_API_KEY: process.env.BREVO_API_KEY,
  NOTIFY_EMAIL: process.env.NOTIFY_EMAIL,
  SENDER_EMAIL: process.env.SENDER_EMAIL,
  SITE_URL: site.origin,
  MAIL_MODE: process.env.MAIL_MODE || 'disabled',
};
const notifications = createVideoNotifications({ sqlite, env });
env.publishClip = clip => publishClip(sqlite, notifications, clip);
env.handleVideoUnsubscribe = request => notifications.handleUnsubscribe(request);
const uploads = createUploadManager({ sqlite, env, databasePath: dbFile, notifications });
env.deleteLocalVideo = uploads.deleteVideo;
notifications.kick();

async function sendApi(req, res) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) { res.writeHead(413).end(); return; }
    chunks.push(chunk);
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const headers = new Headers(req.headers);
  headers.set('CF-Connecting-IP', process.env.TRUST_PROXY === '1' ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress) : (req.socket.remoteAddress || 'unknown'));
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(url, { method: req.method, headers, body });
  if(url.pathname==='/api/logout'&&req.method==='POST'){res.writeHead(200,{'Set-Cookie':clearCookie(env),'Content-Type':'application/json'}).end('{"ok":true}');return;}
  const response = await api.fetch(request, env, {});
  const out = Object.fromEntries(response.headers);
  out['Cache-Control'] = 'no-store';
  if(response.ok&&['/api/login','/api/check','/api/guest/redeem','/api/guest/validate'].includes(url.pathname)) {
    const result=await response.clone().json();
    if(result.ok) {
      const input=body?JSON.parse(body):{};
      if(result.status==='approved'&&result.t){
        const email=url.pathname==='/api/check'?Buffer.from(url.searchParams.get('e')||'','base64url').toString():String(input.email||'').trim().toLowerCase();
        if(await sessOk(env,email,result.t))out['Set-Cookie']=accountCookie(env,sqlite,email);
      }else if(result.role==='guest')out['Set-Cookie']=mediaCookie(env,{guest:result.token||input.token},Math.max(0,Math.floor((result.expires-Date.now())/1000)));
    }
  }
  out['X-KidTube-Origin'] = 'node';
  res.writeHead(response.status, out);
  if (req.method === 'HEAD' || !response.body) { res.end(); return; }
  Readable.fromWeb(response.body).pipe(res);
}

const attempts=new Map();
const server = http.createServer((req, res) => {
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin&&req.headers.origin!==env.SITE_URL){res.writeHead(403).end();return;}
  let pathname;
  try { pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/\/+$/, '') || '/'; }catch{res.writeHead(400).end();return;}
  if(['/api/login','/api/signup','/api/guest/redeem'].includes(pathname)){
    const ip=process.env.TRUST_PROXY==='1'?(req.headers['x-forwarded-for']||req.socket.remoteAddress):req.socket.remoteAddress;
    const now=Date.now(); for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
    const limit=attempts.get(ip)||{n:0,until:now+600000};limit.n++;attempts.set(ip,limit);
    if(limit.n>20){res.writeHead(429,{'Content-Type':'application/json'}).end('{"ok":false,"error":"Too many attempts. Try again in ten minutes."}');return;}
  }
  if(pathname==='/api/clips'||pathname==='/api/likes'||pathname==='/api/comments'||pathname.startsWith('/api/video/')||pathname.startsWith('/api/media/')){
    if(!viewer(req,sqlite,env)){res.writeHead(401,{'Content-Type':'application/json','Cache-Control':'no-store'}).end('{"ok":false,"error":"Log in to view this channel."}');return;}
    res.setHeader('Cache-Control','private, no-store');
  }
  if(pathname.startsWith('/uploads/')){res.writeHead(404).end();return;}
  if (pathname.startsWith('/api/upload/raw/') || pathname.startsWith('/api/video/')) {
    uploads.handle(req, res, pathname);
  } else if (pathname.startsWith('/api/')) {
    sendApi(req, res).catch(error => {
      console.error('API request failed', error);
      if (!res.headersSent) res.writeHead(500).end(); else res.destroy(error);
    });
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    sendFile(publicDir, req, res, pathname);
  } else {
    res.writeHead(405).end();
  }
});
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`KidTube listening on ${server.address().port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(async () => { await notifications.close(); sqlite.close(); process.exit(0); });
});

