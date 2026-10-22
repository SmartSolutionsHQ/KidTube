import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { passwordRecord } from '../server/passwords.mjs';
import { canPlayClip, canViewChannel } from '../server/channels.mjs';
import { startInstall, PARENT } from './helpers.mjs';

const KID = { email: 'milo', pass: 'kid-test-pass' };
const VIEWER = { email: 'gran@example.com', pass: 'A-viewer-test-only-password!' };
const MEDIA = {
  milo: '11111111-1111-4111-8111-111111111111',
  juni: '22222222-2222-4222-8222-222222222222',
  waiting: '33333333-3333-4333-8333-333333333333',
};

test('who may see a channel and play a clip', () => {
  const ana = { id: 1 }, ben = { id: 2 };
  assert.equal(canViewChannel(null, ana), false);
  assert.equal(canViewChannel({ role: '', email: 'a@b.co' }, ben), true, 'approved accounts see every kid');
  assert.equal(canViewChannel({ role: 'guest', channelId: null }, ben), true, 'an open guest pass sees every kid');
  assert.equal(canViewChannel({ role: 'guest', channelId: 1 }, ana), true);
  assert.equal(canViewChannel({ role: 'guest', channelId: 1 }, ben), false, 'a scoped pass sees one kid');
  const live = { channel_id: 2, review: 'approved', hidden: 0, uploader: 'kid@kids.invalid' };
  assert.equal(canPlayClip({ role: 'guest', channelId: 1 }, live), false);
  assert.equal(canPlayClip({ role: '', email: 'gran@example.com' }, live), true);
  for (const state of [{ review: 'pending' }, { review: 'rejected' }, { hidden: 1 }]) {
    const clip = { ...live, ...state };
    assert.equal(canPlayClip({ role: '', email: 'gran@example.com' }, clip), false, JSON.stringify(state));
    assert.equal(canPlayClip({ role: 'guest', channelId: null }, clip), false);
    assert.equal(canPlayClip({ role: 'kid', email: 'kid@kids.invalid' }, clip), true, 'the kid who posted it');
    assert.equal(canPlayClip({ role: 'kid', email: 'sib@kids.invalid' }, clip), false, 'not a sibling');
    assert.equal(canPlayClip({ role: 'admin', email: 'co@example.com' }, clip), true);
  }
  assert.equal(canPlayClip({ role: 'super', email: 'p@example.com' }, undefined), false, 'no clip, no file');
});

test('the viewer flow on the server: channels, guest passes, review and old links', { timeout: 60000 }, async t => {
  const install = await startInstall(t);
  const { db } = install;
  db.exec(`UPDATE channels SET slug='milo', name='Milo Tapes', kicker='Side A', accent='#FF5C2B', theme_id='ember-tape', position=1 WHERE id=1;
    INSERT INTO channels (id,slug,name,accent,theme_id,position,created) VALUES (2,'juni','Juni',  '#A98BFF','arcade-crt',2,0)`);
  const videos = join(install.dir, 'data/videos');
  mkdirSync(videos, { recursive: true });
  for (const id of Object.values(MEDIA)) {
    writeFileSync(join(videos, `${id}.mp4`), Buffer.alloc(2048, 1));
    writeFileSync(join(videos, `${id}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  }
  const addClip = (id, media, channel, review = 'approved') => db.prepare(`INSERT INTO clips
    (id,title,src,poster,position,created,channel_id,review,published) VALUES (?,?,?,?,1,0,?,?,'2026-10-20T10:00:00Z')`)
    .run(id, id, `/api/video/${media}`, `/api/video/${media}/poster`, channel, review);
  addClip('milo-1', MEDIA.milo, 1);
  addClip('juni-1', MEDIA.juni, 2);
  addClip('milo-waiting', MEDIA.waiting, 1, 'pending');

  const add = async (account, role = '', channel = null) => {
    const { salt, hash } = await passwordRecord(account.pass, { min: 8 });
    const email = account.email.includes('@') ? account.email : `${account.email}@kids.invalid`;
    db.prepare(`INSERT INTO accounts (email,first,last,salt,hash,status,role,created,channel_id)
      VALUES (?,?,'',?,?,'approved',?,0,?)`).run(email, email.split('@')[0], salt, hash, role, channel);
    return email;
  };
  const kidEmail = await add(KID, 'kid', 1);
  await add(VIEWER);
  db.prepare("INSERT INTO upload_jobs (id,email,title,size,status,created,updated,clip_id,channel_id) VALUES (?,?,?,1,'done',0,0,'milo-waiting',1)")
    .run(MEDIA.waiting, kidEmail, 'milo-waiting');

  const parent = await install.login(PARENT);
  const kid = await install.login(KID);
  const viewer = await install.login(VIEWER);
  assert.equal(kid.role, 'kid', 'a kid signs in with the bare handle');
  kid.email = kidEmail;
  const json = async (path, options) => (await install.call(path, options)).json();
  const status = async (path, cookie) => (await install.call(path, { cookie })).status;
  const ids = async (path, cookie) => (await json(path, { cookie })).clips.map(clip => clip.id);

  await t.test('signed out: the private endpoints answer 401 and /api/me says nobody', async () => {
    for (const path of ['/api/clips', '/api/clips?channel=milo', '/api/channels', '/api/clips/locate?id=milo-1',
      `/api/video/${MEDIA.milo}`, `/api/video/${MEDIA.milo}/poster`]) {
      assert.equal(await status(path), 401, path);
    }
    assert.deepEqual(await json('/api/me'), { ok: true, viewer: null });
  });

  await t.test('/api/me names the account, and the kid account carries its own channel', async () => {
    assert.deepEqual((await json('/api/me', { cookie: kid.cookie })).viewer, { role: 'kid', email: kidEmail, first: 'milo', channel: 'milo' });
    assert.deepEqual((await json('/api/me', { cookie: parent.cookie })).viewer.role, 'super');
    assert.equal((await json('/api/me', { cookie: viewer.cookie })).viewer.channel, null);
  });

  await t.test('each feed is one channel; pending clips stay out of it', async () => {
    assert.deepEqual(await ids('/api/clips?channel=milo', viewer.cookie), ['milo-1']);
    assert.deepEqual(await ids('/api/clips?channel=juni', viewer.cookie), ['juni-1']);
    assert.deepEqual(await ids('/api/clips', viewer.cookie), ['milo-1', 'juni-1']);
    assert.deepEqual(await ids('/api/clips?channel=milo', kid.cookie), ['milo-1'], 'even for the kid who posted it');
  });

  await t.test('a pending clip plays only for parents and the kid who posted it', async () => {
    for (const path of [`/api/video/${MEDIA.waiting}`, `/api/video/${MEDIA.waiting}/poster`]) {
      assert.equal(await status(path, viewer.cookie), 404, path);
      assert.equal(await status(path, kid.cookie), 200, path);
      assert.equal(await status(path, parent.cookie), 200, path);
    }
    assert.equal(await status('/api/clips/locate?id=milo-waiting', viewer.cookie), 404);
    assert.equal((await json('/api/clips/locate?id=milo-waiting', { cookie: kid.cookie })).review, 'pending');
  });

  await t.test('only a parent approves; then the clip leads the feed and plays for everyone', async () => {
    const review = (who, body) => install.call('/api/admin/clips/review', { body: { email: who.email, t: who.t, ...body } });
    assert.equal((await review(kid, { id: 'milo-waiting', decision: 'approve' })).status, 403);
    assert.equal((await review(viewer, { id: 'milo-waiting', decision: 'approve' })).status, 403);
    assert.equal((await review(parent, { id: 'milo-waiting', decision: 'maybe' })).status, 400);
    assert.equal((await review(parent, { id: 'milo-1', decision: 'approve' })).status, 404, 'nothing to approve on a live clip');
    assert.deepEqual(await (await review(parent, { id: 'milo-waiting', decision: 'approve' })).json(), { ok: true, review: 'approved', channel: 'milo' });
    assert.deepEqual(await ids('/api/clips?channel=milo', viewer.cookie), ['milo-waiting', 'milo-1']);
    assert.equal(await status(`/api/video/${MEDIA.waiting}`, viewer.cookie), 200);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM activity WHERE kind='review' AND subject='milo-waiting'").get().n, 1);
    // and back out again, for the reject path
    db.exec("UPDATE clips SET review='pending' WHERE id='milo-waiting'");
    assert.deepEqual(await (await review(parent, { id: 'milo-waiting', decision: 'reject' })).json(), { ok: true, review: 'rejected' });
    assert.equal(await status(`/api/video/${MEDIA.waiting}`, viewer.cookie), 404);
    assert.equal(await status(`/api/video/${MEDIA.waiting}`, kid.cookie), 200);
  });

  await t.test('old #/v/ links resolve to their channel; unknown ids look the same as refused ones', async () => {
    assert.deepEqual(await json('/api/clips/locate?id=juni-1', { cookie: viewer.cookie }), { ok: true, id: 'juni-1', channel: 'juni', review: 'approved' });
    for (const id of ['nope', '../x', '']) assert.equal(await status(`/api/clips/locate?id=${id}`, viewer.cookie), 404, id);
  });

  await t.test('a guest pass for one kid sees only that kid, and the other channel\'s files are refused', async () => {
    const make = async body => (await json('/api/guest/generate', { body: { email: PARENT.email, t: parent.t, ...body } }));
    assert.equal((await install.call('/api/guest/generate', { body: { email: PARENT.email, t: parent.t, channel: 'nobody' } })).status, 400);
    const pass = await make({ channel: 'milo' });
    assert.equal(pass.scope, 'milo');
    const redeemed = await install.call('/api/guest/redeem', { body: { code: pass.code } });
    const guest = await redeemed.json();
    assert.equal(guest.scope, 'milo');
    const cookie = redeemed.headers.get('set-cookie').split(';')[0];
    assert.equal((await json('/api/guest/validate', { body: { token: guest.token } })).scope, 'milo');

    assert.deepEqual((await json('/api/me', { cookie })).viewer, { role: 'guest', scope: 'milo' });
    assert.deepEqual((await json('/api/channels', { cookie })).channels.map(channel => channel.slug), ['milo']);
    assert.deepEqual(await ids('/api/clips', cookie), ['milo-1']);
    assert.deepEqual(await ids('/api/clips?channel=milo', cookie), ['milo-1']);
    assert.equal(await status('/api/clips?channel=juni', cookie), 403);
    assert.equal(await status(`/api/video/${MEDIA.milo}`, cookie), 200);
    assert.equal(await status(`/api/video/${MEDIA.milo}/poster`, cookie), 200);
    assert.equal(await status(`/api/video/${MEDIA.juni}`, cookie), 404);
    assert.equal(await status(`/api/video/${MEDIA.juni}/poster`, cookie), 404);
    assert.equal(await status('/api/clips/locate?id=juni-1', cookie), 404);
    assert.equal((await json('/api/clips/locate?id=milo-1', { cookie })).channel, 'milo');

    // likes and comments on the other kid's clip stay out of reach too
    db.exec("INSERT INTO likes VALUES ('juni-1','gran@example.com',0), ('milo-1','gran@example.com',0)");
    db.exec("INSERT INTO comments (id,clip_id,email,name,body,created,hidden) VALUES ('c1','juni-1','gran@example.com','Gran','Hi Juni',0,0)");
    assert.deepEqual((await json('/api/likes', { cookie })).counts, { 'milo-1': 1 });
    assert.deepEqual((await json('/api/comments?c=juni-1', { cookie })).rows, []);
    assert.equal((await json('/api/comments?c=juni-1', { cookie: viewer.cookie })).rows.length, 1);

    const open = await make({});
    assert.equal(open.scope, null);
    const wide = await install.call('/api/guest/redeem', { body: { code: open.code } });
    const wideCookie = wide.headers.get('set-cookie').split(';')[0];
    assert.deepEqual((await json('/api/channels', { cookie: wideCookie })).channels.map(channel => channel.slug), ['milo', 'juni']);
    assert.equal(await status(`/api/video/${MEDIA.juni}`, wideCookie), 200);
  });

  await t.test('the shell\'s pure router is served as a JavaScript module', async () => {
    const response = await install.call('/js/shell/route.mjs');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/javascript/);
  });

  await t.test('with kids_public off, /api/site carries no kid data at all', async () => {
    db.prepare("INSERT INTO settings VALUES ('kids_public','false',0)").run();
    const text = await (await install.call('/api/site')).text();
    const site = JSON.parse(text);
    assert.equal(site.kidsPublic, false);
    assert.deepEqual(site.channels, []);
    for (const leak of ['milo', 'Milo', 'juni', 'Juni', '#A98BFF', 'arcade-crt', '/brand/']) assert.ok(!text.includes(leak), `no ${leak}`);
    assert.deepEqual((await json('/api/channels', { cookie: viewer.cookie })).channels.map(channel => channel.slug), ['milo', 'juni'],
      'signed in, every kid is still there');
  });
});
