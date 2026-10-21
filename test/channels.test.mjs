import test from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_NAME, TAGLINE } from '../server/settings.mjs';
import { startInstall, PARENT } from './helpers.mjs';

const VIDEO = '22222222-2222-4222-8222-222222222222';

function addChannels(db) {
  db.exec(`INSERT INTO channels (id,slug,name,kicker,accent,theme_id,logo_rev,position,created) VALUES
    (1,'ana','Ana','Side A','#4df6ff','arcade',3,1,0),
    (2,'ben','Ben','','','',0,2,0)`);
}

function addClip(db, id, { channel = 1, review = 'live', hidden = 0, position = 1 } = {}) {
  db.prepare(`INSERT INTO clips (id,title,src,poster,position,created,channel_id,review,hidden)
    VALUES (?,?,?,?,?,0,?,?,?)`).run(id, 'Clip ' + id, '/api/video/' + VIDEO, `/api/video/${VIDEO}.jpg`, position, channel, review, hidden);
}

test('front door, channels and the clip catalog', { timeout: 30000 }, async t => {
  const install = await startInstall(t);
  addChannels(install.db);
  const parent = await install.login(PARENT);
  const json = async (path, options) => (await install.call(path, options)).json();

  await t.test('/api/site is public and lists kids only while kidsPublic is on', async () => {
    const site = await json('/api/site');
    assert.deepEqual(site, {
      ok: true, brand: BRAND_NAME, tagline: TAGLINE, familyName: '', gateTheme: 'ember-tape', accent: '#ff5c2b',
      setup: 'complete', kidsPublic: true,
      channels: [
        { slug: 'ana', name: 'Ana', kicker: 'Side A', accent: '#4df6ff', themeId: 'arcade', logoUrl: '/brand/ana.svg?v=3' },
        { slug: 'ben', name: 'Ben', kicker: '', accent: '#ff5c2b', themeId: 'ember-tape', logoUrl: null },
      ],
    });
    install.db.prepare("INSERT INTO settings VALUES ('kidsPublic','false',0), ('familyName','\"The Riveras\"',0)").run();
    const private_ = await json('/api/site');
    assert.equal(private_.kidsPublic, false);
    assert.deepEqual(private_.channels, []);
    assert.equal(private_.familyName, 'The Riveras');
    assert.ok(!JSON.stringify(private_).includes('Ana'), 'no kid names leak through other fields');
  });

  await t.test('signed-out visitors get 401 from every private endpoint', async () => {
    for (const path of ['/api/clips', '/api/channels', '/api/channels/', '/api/likes', '/api/comments?c=clip-live',
      `/api/video/${VIDEO}`, `/api/video/${VIDEO}.jpg`]) {
      const response = await install.call(path);
      assert.equal(response.status, 401, path);
      assert.equal(response.headers.get('cache-control'), 'no-store', path);
    }
  });

  await t.test('/api/channels lists every channel to signed-in viewers, even when private', async () => {
    const { channels } = await json('/api/channels', { cookie: parent.cookie });
    assert.deepEqual(channels.map(channel => [channel.slug, channel.tagline]), [['ana', TAGLINE], ['ben', TAGLINE]]);
  });

  await t.test('/api/clips shows only live, unhidden clips with their channel and poster', async () => {
    addClip(install.db, 'clip-live', { position: 1 });
    addClip(install.db, 'clip-ben', { channel: 2, position: 2 });
    addClip(install.db, 'clip-pending', { review: 'pending', position: 3 });
    addClip(install.db, 'clip-rejected', { review: 'rejected', position: 4 });
    addClip(install.db, 'clip-hidden', { hidden: 1, position: 5 });
    const { clips } = await json('/api/clips', { cookie: parent.cookie });
    assert.deepEqual(clips.map(clip => [clip.id, clip.channel, clip.poster]), [
      ['clip-live', 'ana', `/api/video/${VIDEO}.jpg`],
      ['clip-ben', 'ben', `/api/video/${VIDEO}.jpg`],
    ]);
    const overview = await json(`/api/admin/overview?e=${Buffer.from(PARENT.email).toString('base64url')}&t=${parent.t}`);
    assert.deepEqual(overview.clips.find(clip => clip.id === 'clip-pending'), {
      id: 'clip-pending', title: 'Clip clip-pending', position: 3, review: 'pending', hidden: false, channel: 'ana',
      likes: 0, comments: 0, likers: [],
    });
  });

  await t.test('deleting a clip deletes its likes and comments', async () => {
    const signed = body => ({ body: { email: PARENT.email, t: parent.t, ...body } });
    assert.equal((await json('/api/like', signed({ clipId: 'clip-live', on: true }))).ok, true);
    assert.equal((await json('/api/comment', signed({ clipId: 'clip-live', body: 'So good' }))).ok, true);
    assert.equal((await json('/api/clips/delete', signed({ id: 'clip-live' }))).ok, true);
    const count = table => install.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE clip_id='clip-live'`).get().n;
    assert.deepEqual([count('likes'), count('comments')], [0, 0]);
  });

  await t.test('moderation toggles close signups and guest passes and hold comments', async () => {
    const signed = body => ({ body: { email: PARENT.email, t: parent.t, ...body } });
    install.db.prepare("INSERT INTO settings VALUES ('signups','false',0), ('guestCodes','false',0), ('reviewComments','true',0)").run();
    const signup = await install.call('/api/signup', { body: { first: 'New', last: 'Viewer', email: 'new@example.com', pass: 'A-viewer-test-password!' } });
    assert.equal(signup.status, 403);
    assert.equal((await install.call('/api/guest/generate', signed({}))).status, 403);
    assert.equal((await install.call('/api/guest/redeem', { body: { code: 'AB2C' } })).status, 403);
    const held = await json('/api/comment', signed({ clipId: 'clip-ben', body: 'Waiting for a parent' }));
    assert.equal(held.row.hidden, true);
    const { rows } = await json('/api/comments?c=clip-ben', { cookie: parent.cookie });
    assert.deepEqual(rows, []);
  });

  await t.test('the owner can make a kid account for exactly one channel', async () => {
    install.db.exec(`INSERT INTO accounts (email,first,last,salt,hash,status,role,created)
      VALUES ('ana@example.com','Ana','R','salt','hash','approved','',0)`);
    const role = body => json('/api/admin/role', { body: { email: PARENT.email, t: parent.t, target: 'ana@example.com', ...body } });
    assert.equal((await role({ role: 'kid' })).ok, false, 'a kid account needs a channel');
    assert.equal((await role({ role: 'kid', channel: 'ana' })).changes, 1);
    assert.deepEqual({ ...install.db.prepare("SELECT role, channel_id FROM accounts WHERE email='ana@example.com'").get() },
      { role: 'kid', channel_id: 1 });
    assert.equal((await role({ role: '' })).changes, 1);
    assert.equal(install.db.prepare("SELECT channel_id FROM accounts WHERE email='ana@example.com'").get().channel_id, null);
  });
});
