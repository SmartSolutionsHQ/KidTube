// A running install with two kids, a few clips with real files on disk, and every kind of caller:
// the parent, a co-parent (Family), an approved viewer, a kid login and a guest pass. Invented names only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { passwordRecord } from '../server/passwords.mjs';
import { startInstall, PARENT } from './helpers.mjs';

export const MEDIA = {
  one: '44444444-4444-4444-8444-444444444444',
  two: '55555555-5555-4555-8555-555555555555',
  three: '66666666-6666-4666-8666-666666666666',
};
export const VIEWER = { email: 'nana.okafor@example.com', pass: 'A-viewer-test-only-password!' };
export const COPARENT = { email: 'sam.okafor@example.com', pass: 'A-coparent-test-only-password!' };
export const KID = { email: 'tobi', pass: 'kid-test-pass' };
export const KID_EMAIL = 'tobi@kids.invalid';

export async function startFamily(t, env = {}) {
  const install = await startInstall(t, env);
  const { db } = install;
  db.exec(`UPDATE channels SET slug='tobi', name='Tobi', theme_id='ember-tape', position=1 WHERE id=1;
    INSERT INTO channels (id,slug,name,theme_id,position,created) VALUES (2,'ada','Ada','arcade-crt',2,0)`);
  const videos = join(install.dir, 'data/videos');
  mkdirSync(videos, { recursive: true });
  for (const id of Object.values(MEDIA)) {
    writeFileSync(join(videos, `${id}.mp4`), Buffer.alloc(4096, 1));
    writeFileSync(join(videos, `${id}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  }
  const addClip = (id, media, channel, position, extra = {}) => db.prepare(`INSERT INTO clips
    (id,title,src,poster,position,created,channel_id,review,published,duration,blurb,opens_at,capsule_note,sealed_by)
    VALUES (?,?,?,?,?,0,?,?,'2026-10-20T10:00:00Z',12,'A blurb',?,?,?)`)
    .run(id, `Clip ${id}`, `/api/video/${media}`, `/api/video/${media}/poster`, position, channel, extra.review || 'approved',
      extra.opensAt || 0, extra.note || '', extra.sealedBy || '');
  addClip('tobi-1', MEDIA.one, 1, 1);
  addClip('tobi-2', MEDIA.two, 1, 2);
  addClip('ada-1', MEDIA.three, 2, 1);

  const add = async (account, role = '', channel = null, first = 'Someone', last = '') => {
    const { salt, hash } = await passwordRecord(account.pass, { min: 8 });
    const email = account.email.includes('@') ? account.email : `${account.email}@kids.invalid`;
    db.prepare(`INSERT INTO accounts (email,first,last,salt,hash,status,role,created,channel_id) VALUES (?,?,?,?,?,'approved',?,0,?)`)
      .run(email, first, last, salt, hash, role, channel);
    return email;
  };
  db.prepare("UPDATE accounts SET first='Remi', last='Okafor' WHERE email=?").run(PARENT.email);
  await add(VIEWER, '', null, 'Nana', 'Okafor');
  await add(COPARENT, 'admin', null, 'Sam', 'Okafor');
  await add(KID, 'kid', 1, 'Tobi');

  const parent = await install.login(PARENT);
  const coparent = await install.login(COPARENT);
  const viewer = await install.login(VIEWER);
  const kid = { ...(await install.login(KID)), email: KID_EMAIL };
  const pass = await (await install.call('/api/guest/generate', { body: { email: PARENT.email, t: parent.t } })).json();
  const redeemed = await install.call('/api/guest/redeem', { body: { code: pass.code } });
  const guest = { cookie: redeemed.headers.get('set-cookie')?.split(';')[0], token: (await redeemed.json()).token };

  const json = async (path, options) => {
    const response = await install.call(path, options);
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const status = async (path, options) => (await install.call(path, options)).status;
  const staffQuery = who => `e=${Buffer.from(who.email).toString('base64url')}&t=${encodeURIComponent(who.t)}`;
  return { ...install, addClip, parent, coparent, viewer, kid, guest, json, status, staffQuery };
}
