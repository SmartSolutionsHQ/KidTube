import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { passwordRecord, passwordMatches } from '../server/passwords.mjs';
import { publishVideo } from '../public/js/server-upload-v1.js';
const root=resolve('.');
const password='A-test-only-parent-password!';

test('password storage is salted scrypt and rejects incorrect credentials',async()=>{
 const a=await passwordRecord(password),b=await passwordRecord(password);
 assert.notEqual(a.hash,b.hash);assert.equal(await passwordMatches(password,a),true);
 assert.equal(await passwordMatches('incorrect',a),false);
 await assert.rejects(passwordRecord('short'));
});

test('clean install, approvals, protected media, guest expiry, and password revocation',{timeout:60000},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'kidtube-starter-'));
 const env={...process.env,KIDTUBE_ADMIN_EMAIL:'parent@example.com',KIDTUBE_ADMIN_PASSWORD:password,SITE_URL:'http://localhost:3000'};
 delete env.DATABASE_PATH;
 const setup=spawnSync(process.execPath,[join(root,'scripts/setup.mjs')],{cwd:dir,env,encoding:'utf8'});
 assert.equal(setup.status,0,setup.stderr);
 const second=spawnSync(process.execPath,[join(root,'scripts/setup.mjs')],{cwd:dir,env,encoding:'utf8'});
 assert.notEqual(second.status,0);assert.match(second.stderr,/already exists/);
 const database=join(dir,'data/kidtube.sqlite');const db=new DatabaseSync(database);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM accounts').get().n,1);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM clips').get().n,0);
 const id='11111111-1111-4111-8111-111111111111';
 mkdirSync(join(dir,'data/videos'),{recursive:true});writeFileSync(join(dir,'data/videos',id+'.mp4'),'TEST-VIDEO-PAYLOAD');
 db.prepare('INSERT INTO clips(id,title,src,position,created) VALUES(?,?,?,?,?)').run(id,'Private fixture','/api/video/'+id,0,Date.now());
 const child=spawn(process.execPath,['--env-file=.env',join(root,'server/index.mjs')],{cwd:dir,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATABASE_PATH:database,PUBLIC_DIR:join(root,'public'),MAIL_MODE:'disabled'},stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',c=>errors+=c);
 t.after(async()=>{child.kill();await once(child,'exit').catch(()=>{});db.close();rmSync(dir,{recursive:true,force:true});});
 const port=await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error('Startup timeout '+errors)),10000);child.stdout.on('data',c=>{const m=/listening on (\d+)/.exec(String(c));if(m){clearTimeout(timer);yes(m[1]);}});child.once('exit',()=>{clearTimeout(timer);no(Error(errors));});});
 const base='http://127.0.0.1:'+port;
 const call=(path,body,cookie)=>fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
 for(const path of ['/api/clips','/api/clips/','/api/video/'+id,'/api/media/example','/api/comments?c='+id])assert.equal((await call(path)).status,401,path);
 assert.equal((await call('/api/check?e='+Buffer.from('parent@example.com').toString('base64url')).then(r=>r.json())).t,undefined);
 assert.equal((await call('/api/pending')).status,403);
 const response=await call('/api/login',{email:'parent@example.com',pass:password});const parent=await response.json();
 assert.equal(parent.status,'approved');assert.equal(parent.role,'super');assert.ok(parent.t);
 const cookie=response.headers.get('set-cookie').split(';')[0];assert.match(response.headers.get('set-cookie'),/HttpOnly/);
 assert.equal((await call('/api/clips',null,cookie)).status,200);
 const media=await call('/api/video/'+id,null,cookie);assert.equal(media.status,200);assert.equal(await media.text(),'TEST-VIDEO-PAYLOAD');assert.match(media.headers.get('cache-control'),/no-store/);
 const range=await fetch(base+'/api/video/'+id,{headers:{cookie,range:'bytes=0-3'}});assert.equal(range.status,206);assert.equal(await range.text(),'TEST');
 const signed=body=>({email:'parent@example.com',t:parent.t,...body});
 await t.test('browser upload client sends chunks and produces a playable protected MP4', async()=>{
  const source=join(dir,'source.mp4');
  const encoded=spawnSync('ffmpeg',['-nostdin','-y','-f','lavfi','-i','color=c=blue:s=320x240:d=1','-c:v','libx264','-pix_fmt','yuv420p',source],{encoding:'utf8'});
  assert.equal(encoded.status,0,'FFmpeg is required for integration tests: '+encoded.stderr);
  const nativeFetch=globalThis.fetch;
  globalThis.fetch=(path,options)=>nativeFetch(typeof path==='string'&&path.startsWith('/')?base+path:path,options);
  let clip;
  try {clip=await publishVideo(new File([readFileSync(source)],'fixture.mp4',{type:'video/mp4'}),'Synthetic test video',{email:'parent@example.com',t:parent.t});}
  finally{globalThis.fetch=nativeFetch;}
  assert.ok(clip.id);assert.equal((await call(clip.src)).status,401);
  const video=await call(clip.src,null,cookie);assert.equal(video.status,200);assert.ok((await video.arrayBuffer()).byteLength>1000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM video_notification_deliveries').get().n,0);
 });
 const created=await call('/api/signup',{first:'Test',last:'Viewer',email:'viewer@example.com',pass:password}).then(r=>r.json());assert.equal(created.status,'pending');
 const pending=await call('/api/login',{email:'viewer@example.com',pass:password});assert.equal(pending.headers.get('set-cookie'),null);
 const approved=await call('/api/admin/status',signed({target:'viewer@example.com',status:'approved'})).then(r=>r.json());
 assert.equal(approved.ok,true,JSON.stringify(approved));
 const viewerResponse=await call('/api/login',{email:'viewer@example.com',pass:password});const viewerCookie=viewerResponse.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('/api/clips',null,viewerCookie)).status,200);
 const guest=await call('/api/guest/generate',signed({})).then(r=>r.json());assert.ok(guest.code);
 const redeem=await call('/api/guest/redeem',{code:guest.code});const guestCookie=redeem.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('/api/clips',null,guestCookie)).status,200);
 assert.equal((await call('/api/guest/redeem',{code:guest.code})).status,400);
 db.prepare('UPDATE guest_codes SET session_expires=0').run();assert.equal((await call('/api/clips',null,guestCookie)).status,401);
 db.prepare("UPDATE accounts SET status='denied' WHERE email='viewer@example.com'").run();assert.equal((await call('/api/clips',null,viewerCookie)).status,401);
 const reset=await call('/api/admin/password',signed({target:'parent@example.com',pass:'A-new-test-password-only!'})).then(r=>r.json());assert.equal(reset.ok,true,JSON.stringify(reset));
 assert.equal((await call('/api/clips',null,cookie)).status,401);
 const overview=await call('/api/admin/overview?e='+Buffer.from('parent@example.com').toString('base64url')+'&t='+parent.t);assert.equal(overview.status,403);
 const logout=await call('/api/logout',{});assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
});

test('generator copies a blank installation and refuses an existing destination',()=>{
 const dir=mkdtempSync(join(tmpdir(),'kidtube-generator-'));const target=join(dir,'family');
 try{
  const result=spawnSync(process.execPath,['bin/create-kidtube.mjs',target],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.ok(existsSync(join(target,'server/index.mjs')));
  assert.equal(existsSync(join(target,'.env')),false);assert.equal(existsSync(join(target,'data')),false);
  assert.ok(readFileSync(join(target,'.gitignore'),'utf8').includes('data/'));
  assert.ok(existsSync(join(target,'docs/OPERATIONS.md')));assert.equal(existsSync(join(target,'docs/plan')),false);
  assert.notEqual(spawnSync(process.execPath,['bin/create-kidtube.mjs',target],{cwd:root}).status,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
