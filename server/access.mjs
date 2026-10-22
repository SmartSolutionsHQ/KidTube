import { createHmac, timingSafeEqual } from 'node:crypto';
const hmac = (env, text) => createHmac('sha256',env.SIGN_SECRET).update(text).digest('hex');
export function mediaCookie(env, session, maxAge=7*86400) {
  const body=Buffer.from(JSON.stringify({...session,exp:Date.now()+maxAge*1000})).toString('base64url');
  return `kid_access=${body}.${hmac(env,body)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${env.SITE_URL.startsWith('https:')?'; Secure':''}`;
}
export function clearCookie(env) { return `kid_access=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${env.SITE_URL.startsWith('https:')?'; Secure':''}`; }
export function viewer(req,sqlite,env) {
  try {
    const value=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('kid_access='))?.slice(11);
    const [body,sig]=value.split('.');
    if(!/^[a-f0-9]{64}$/.test(sig)||!timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(hmac(env,body),'hex')))return null;
    const s=JSON.parse(Buffer.from(body,'base64url'));
    if(s.exp<=Date.now())return null;
    if(s.guest){
      // A pass may be limited to one kid's channel; channelId null means the whole family.
      const row=sqlite.prepare('SELECT session_expires,channel_id FROM guest_codes WHERE token_hash=?').get(hmac(env,'guest-session|'+s.guest));
      return row?.session_expires>Date.now()?{role:'guest',channelId:row.channel_id??null}:null;
    }
    const row=sqlite.prepare('SELECT status,role,hash FROM accounts WHERE email=?').get(s.email);
    return row?.status==='approved'&&hmac(env,row.hash)===s.version?{email:s.email,role:row.role}:null;
  }catch{return null;}
}
export function accountCookie(env,sqlite,email) {
  const row=sqlite.prepare('SELECT hash FROM accounts WHERE email=?').get(email);
  return mediaCookie(env,{email,version:hmac(env,row.hash)});
}
