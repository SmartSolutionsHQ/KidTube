import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { passwordRecord } from '../server/passwords.mjs';
import { describeActivity } from '../server/monitor.mjs';
import { startInstall, PARENT } from './helpers.mjs';

const CO = { email: 'co@example.com', pass: 'A-co-parent-test-password!' };
const VIEWER = { email: 'gran@example.com', pass: 'A-viewer-test-only-password!' };
const KID = { email: 'milo', pass: 'kid-pass-1' };
const MEDIA = {
  live: '11111111-1111-4111-8111-111111111111',
  waiting: '33333333-3333-4333-8333-333333333333',
  juni: '22222222-2222-4222-8222-222222222222',
};

async function family(t) {
  const install = await startInstall(t);
  const { db } = install;
  db.exec(`UPDATE channels SET slug='milo', name='Milo', accent='#FF5C2B', theme_id='ember-tape', position=1 WHERE id=1;
    INSERT INTO channels (id,slug,name,accent,theme_id,position,created) VALUES (2,'juni','Juni','#A98BFF','arcade-crt',2,0)`);
  const videos = join(install.dir, 'data/videos');
  mkdirSync(videos, { recursive: true });
  for (const id of Object.values(MEDIA)) {
    writeFileSync(join(videos, `${id}.mp4`), Buffer.alloc(4096, 1));
    writeFileSync(join(videos, `${id}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  }
  const addClip = (id, media, channel, review = 'approved') => db.prepare(`INSERT INTO clips
    (id,title,src,poster,position,created,channel_id,review,published) VALUES (?,?,?,?,1,0,?,?,'2026-10-20T10:00:00Z')`)
    .run(id, `Clip ${id}`, `/api/video/${media}`, `/api/video/${media}/poster`, channel, review);
  addClip('live', MEDIA.live, 1);
  addClip('waiting', MEDIA.waiting, 1, 'pending');
  addClip('juni-1', MEDIA.juni, 2);
  db.prepare("INSERT INTO upload_jobs (id,email,title,size,status,clip_id,created,updated,channel_id) VALUES ('job-1','milo@kids.invalid','Clip waiting',5000,'done','waiting',0,1,1)").run();
  const add = async (account, role = '', channel = null, status = 'approved') => {
    const { salt, hash } = await passwordRecord(account.pass, { min: 8 });
    const email = account.email.includes('@') ? account.email : `${account.email}@kids.invalid`;
    db.prepare(`INSERT INTO accounts (email,first,last,salt,hash,status,role,created,channel_id)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(email, email.split('@')[0], 'Test', salt, hash, status, role, Date.now(), channel);
  };
  await add(CO, 'admin');
  await add(VIEWER);
  await add(KID, 'kid', 1);
  const as = {};
  for (const [name, account] of Object.entries({ parent: PARENT, co: CO, viewer: VIEWER, kid: KID })) {
    const session = await install.login(account);
    assert.ok(session.ok, `${name} signs in`);
    as[name] = { email: session.email.includes('@') ? session.email : `${session.email}@kids.invalid`, t: session.t, cookie: session.cookie };
  }
  // A signed-in parent call: the session headers, as the dashboard sends them.
  const call = (who, path, body) => install.call(path, {
    body, headers: who ? { 'x-kid-email': as[who].email, 'x-kid-token': as[who].t } : {},
  });
  const ok = async (who, path, body) => {
    const response = await call(who, path, body);
    const json = await response.json();
    assert.equal(response.status, 200, `${who} ${path}: ${json.error}`);
    return json;
  };
  const activity = () => db.prepare("SELECT kind, subject, detail FROM activity WHERE kind NOT IN ('seen','setup') ORDER BY id").all();
  return { ...install, as, call, ok, activity };
}

const STAFF_GETS = ['/api/admin/summary', '/api/admin/storage', '/api/admin/activity', '/api/admin/review',
  '/api/admin/clips', '/api/admin/comments', '/api/admin/guests'];
const OWNER_GETS = ['/api/admin/people', '/api/admin/kids', '/api/admin/settings'];

test('every dashboard route is for parents, and some for the owner only', { timeout: 60000 }, async t => {
  const f = await family(t);
  for (const path of [...STAFF_GETS, ...OWNER_GETS]) {
    for (const who of [null, 'viewer', 'kid']) {
      const response = await f.call(who, path);
      assert.equal(response.status, 403, `${who || 'nobody'} ${path}`);
    }
    assert.equal((await f.call('parent', path)).status, 200, `parent ${path}`);
    assert.equal((await f.call('co', path)).status, OWNER_GETS.includes(path) ? 403 : 200, `co-parent ${path}`);
  }
  const posts = ['/api/admin/review', '/api/admin/clips/hide', '/api/admin/clips/rename', '/api/admin/clips/order',
    '/api/admin/clips/delete', '/api/admin/comments/moderate', '/api/admin/guests', '/api/admin/guests/end',
    '/api/admin/people/status', '/api/admin/people/role', '/api/admin/people/password', '/api/admin/people/delete',
    '/api/admin/kids', '/api/admin/kids/order', '/api/admin/kids/delete', '/api/admin/settings', '/api/admin/settings/email-test'];
  for (const path of posts) {
    for (const who of [null, 'viewer', 'kid']) assert.equal((await f.call(who, path, { id: 'live' })).status, 403, `${who || 'nobody'} POST ${path}`);
  }
  for (const path of posts.filter(path => /people|kids|settings/.test(path))) {
    assert.equal((await f.call('co', path, {})).status, 403, `co-parent POST ${path}`);
  }
  // The session cookie alone does not stand in for the headers (they are the dashboard's CSRF guard).
  assert.equal((await fetch(f.origin + '/api/admin/summary', { headers: { cookie: f.as.parent.cookie } })).status, 403);
  assert.equal((await f.call('parent', '/api/admin/summary', {})).status, 405);
  const summary = await f.ok('co', '/api/admin/summary');
  assert.equal(summary.me.role, 'admin');
  assert.equal(summary.counts.people, null, 'a co-parent does not see sign-up requests');
  assert.deepEqual(summary.kids.map(kid => kid.slug), ['milo', 'juni']);
  assert.equal(summary.features.views, false, 'the v2 views table has no watch history route yet');
});

test('the dashboard page turns kid and viewer accounts away', { timeout: 60000 }, async t => {
  const f = await family(t);
  for (const who of ['kid', 'viewer']) {
    const response = await f.call(null, '/parents', undefined);
    assert.equal(response.status, 200, 'signed out: the sign-in card');
    const refused = await fetch(f.origin + '/parents', { redirect: 'manual', headers: { cookie: f.as[who].cookie } });
    assert.equal(refused.status, 302, who);
    assert.equal(refused.headers.get('location'), '/');
  }
  for (const who of ['parent', 'co']) {
    const page = await fetch(f.origin + '/parents', { redirect: 'manual', headers: { cookie: f.as[who].cookie } });
    assert.equal(page.status, 200, who);
  }
});

test('storage says how much room is left and what videos use', { timeout: 60000 }, async t => {
  const f = await family(t);
  const result = await f.ok('parent', '/api/admin/storage');
  assert.deepEqual(Object.keys(result).sort(), ['free', 'ok', 'total', 'videos']);
  assert.ok(Number.isSafeInteger(result.free) && result.free > 0);
  assert.ok(result.total >= result.free);
  assert.deepEqual(result.videos, { count: 3, bytes: 3 * (4096 + 4) });
});

test('hiding a video takes it out of the feed and its file; showing it puts both back', { timeout: 60000 }, async t => {
  const f = await family(t);
  const feed = async () => (await (await f.call(null, '/api/clips', undefined)).json());
  const viewerFeed = async () => (await (await fetch(f.origin + '/api/clips', { headers: { cookie: f.as.viewer.cookie } })).json()).clips.map(clip => clip.id);
  const media = async () => (await fetch(`${f.origin}/api/video/${MEDIA.live}`, { headers: { cookie: f.as.viewer.cookie } })).status;
  assert.ok((await viewerFeed()).includes('live'));
  assert.equal(await media(), 200);
  assert.equal((await feed()).ok, false, 'signed out gets nothing');
  await f.ok('co', '/api/admin/clips/hide', { id: 'live', hidden: true });
  assert.ok(!(await viewerFeed()).includes('live'));
  assert.equal(await media(), 404);
  const parentMedia = await fetch(`${f.origin}/api/video/${MEDIA.live}`, { headers: { cookie: f.as.parent.cookie } });
  assert.equal(parentMedia.status, 200, 'parents still play a hidden video');
  await f.ok('co', '/api/admin/clips/hide', { id: 'live', hidden: false });
  assert.ok((await viewerFeed()).includes('live'));
  assert.equal(await media(), 200);
  const rows = f.activity().filter(row => row.kind === 'clip');
  assert.deepEqual(rows.map(row => JSON.parse(row.detail).action), ['hide', 'unhide']);
});

test('the review queue approves into the kid\'s feed or keeps a video private', { timeout: 60000 }, async t => {
  const f = await family(t);
  const queue = await f.ok('parent', '/api/admin/review');
  assert.deepEqual(queue.clips.map(clip => [clip.id, clip.kid, clip.uploader]), [['waiting', 'Milo', 'milo@kids.invalid']]);
  assert.equal((await f.ok('parent', '/api/admin/summary')).counts.review, 1);
  const approved = await f.ok('co', '/api/admin/review', { id: 'waiting', decision: 'approve' });
  assert.equal(approved.channel, 'milo');
  const clips = (await (await fetch(f.origin + '/api/clips?channel=milo', { headers: { cookie: f.as.viewer.cookie } })).json()).clips;
  assert.equal(clips[0].id, 'waiting', 'approved videos lead the kid\'s channel');
  assert.equal(f.db.prepare("SELECT actor FROM activity WHERE kind='review' AND subject='waiting'").get().actor, CO.email);
  assert.equal((await f.call('co', '/api/admin/review', { id: 'waiting', decision: 'approve' })).status, 409);

  f.db.exec("UPDATE clips SET review='pending' WHERE id='juni-1'");
  await f.ok('parent', '/api/admin/review', { id: 'juni-1', decision: 'reject' });
  assert.equal(f.db.prepare('SELECT review FROM clips WHERE id=?').get('juni-1').review, 'rejected');
  await f.ok('parent', '/api/admin/clips/delete', { id: 'juni-1' });
  assert.equal(f.db.prepare('SELECT 1 FROM clips WHERE id=?').get('juni-1'), undefined);
  assert.ok(!existsSync(join(f.dir, 'data/videos', `${MEDIA.juni}.mp4`)), 'the file goes too');
});

test('comments: waiting, shown, hidden and deleted', { timeout: 60000 }, async t => {
  const f = await family(t);
  const post = async body => (await (await f.call(null, '/api/comment', { clipId: 'live', body, email: f.as.viewer.email, t: f.as.viewer.t })).json()).row;
  const first = await post('Lovely!');
  assert.equal(first.hidden, true, 'comments wait for review by default');
  const waiting = await f.ok('co', '/api/admin/comments');
  assert.equal(waiting.mode, 'review');
  assert.deepEqual(waiting.comments.map(row => [row.id, row.status, row.clipTitle, row.kid]), [[first.id, 'waiting', 'Clip live', 'Milo']]);
  assert.equal((await f.ok('co', '/api/admin/summary')).counts.comments, 1);
  const visible = async () => (await (await fetch(f.origin + '/api/comments?c=live', { headers: { cookie: f.as.viewer.cookie } })).json()).rows.map(row => row.id);
  assert.deepEqual(await visible(), []);
  await f.ok('co', '/api/admin/comments/moderate', { id: first.id, action: 'approve' });
  assert.deepEqual(await visible(), [first.id]);
  await f.ok('co', '/api/admin/comments/moderate', { id: first.id, action: 'hide' });
  assert.deepEqual(await visible(), []);
  const hidden = await f.ok('co', '/api/admin/comments?status=hidden');
  assert.deepEqual(hidden.comments.map(row => row.id), [first.id], 'a hidden comment is not waiting');
  assert.equal((await f.ok('co', '/api/admin/summary')).counts.comments, 0);
  await f.ok('co', '/api/admin/comments/moderate', { id: first.id, action: 'delete' });
  assert.equal(f.db.prepare('SELECT 1 FROM comments WHERE id=?').get(first.id), undefined);
  assert.equal((await f.call('co', '/api/admin/comments/moderate', { id: first.id, action: 'delete' })).status, 404);
  assert.deepEqual(f.activity().filter(row => row.kind === 'comment').map(row => JSON.parse(row.detail).action), ['approve', 'hide', 'delete']);
});

test('removing a person takes their hearts, comments, history and unused codes with them', { timeout: 60000 }, async t => {
  const f = await family(t);
  const email = VIEWER.email;
  f.db.prepare('INSERT INTO likes (clip_id,email,created) VALUES (?,?,0)').run('live', email);
  f.db.prepare("INSERT INTO comments (id,clip_id,email,name,body,created) VALUES ('c1','live',?,'Gran','Hi',0)").run(email);
  f.db.prepare('INSERT INTO views (clip_id,viewer,ts) VALUES (?,?,0)').run('live', email);
  f.db.prepare('INSERT INTO video_email_preferences (email,unsubscribed) VALUES (?,0)').run(email);
  await fetch(f.origin + '/api/me', { headers: { cookie: f.as.viewer.cookie } });
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM activity WHERE kind='seen' AND subject=?").get(email).n, 1, 'last seen is noted');
  const people = await f.ok('parent', '/api/admin/people');
  assert.ok(people.people.find(person => person.email === email).lastSeen > 0);
  assert.equal((await f.call('parent', '/api/admin/people/delete', { target: PARENT.email })).status, 400, 'not yourself');
  await f.ok('parent', '/api/admin/people/delete', { target: email });
  for (const [table, column] of [['accounts', 'email'], ['likes', 'email'], ['comments', 'email'], ['views', 'viewer'], ['video_email_preferences', 'email']]) {
    assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${column}=?`).get(email).n, 0, table);
  }
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM activity WHERE kind='seen' AND subject=?").get(email).n, 0);
  assert.equal((await fetch(f.origin + '/api/clips', { headers: { cookie: f.as.viewer.cookie } })).status, 401, 'their cookie stops working');
  assert.match(JSON.parse(f.activity().at(-1).detail).action, /^delete$/);
});

test('kid passwords reset at 8 characters, everyone else still needs 12', { timeout: 60000 }, async t => {
  const f = await family(t);
  await f.ok('parent', '/api/admin/people/password', { target: 'milo@kids.invalid', pass: 'new-pass' });
  assert.ok((await f.login({ email: 'milo', pass: 'new-pass' })).ok);
  const short = await f.call('parent', '/api/admin/people/password', { target: VIEWER.email, pass: 'new-pass' });
  assert.equal(short.status, 400);
  assert.match((await short.json()).error, /12/);
  const direct = await f.call(null, '/api/admin/password', { email: f.as.parent.email, t: f.as.parent.t, target: 'milo@kids.invalid', pass: 'short77' });
  assert.equal(direct.status, 400, 'seven is too short even for kids');
  await f.ok('parent', '/api/admin/people/password', { target: VIEWER.email, pass: 'a-new-twelve-char-pass' });
});

test('every change writes an activity row, and the feed reads them back in plain words', { timeout: 60000 }, async t => {
  const f = await family(t);
  const before = f.activity().length;
  const steps = [
    ['co', '/api/admin/clips/rename', { id: 'live', title: 'Skate park' }, 'clip'],
    ['co', '/api/admin/clips/order', { channel: 'milo', order: ['waiting', 'live'] }, 'clip'],
    ['co', '/api/admin/clips/hide', { id: 'live', hidden: true }, 'clip'],
    ['co', '/api/admin/review', { id: 'waiting', decision: 'approve' }, 'review'],
    ['co', '/api/admin/guests', { channel: 'juni', note: 'Grandpa' }, 'guest'],
    ['parent', '/api/admin/people/status', { target: VIEWER.email, status: 'denied' }, 'person'],
    ['parent', '/api/admin/people/role', { target: VIEWER.email, role: 'admin' }, 'person'],
    ['parent', '/api/admin/kids', { name: 'Ada', accent: '#4DB8FF', themeId: 'arcade-crt' }, 'channel'],
    ['parent', '/api/admin/kids/order', { order: [2, 1, 3] }, 'channel'],
    ['parent', '/api/admin/settings', { values: { site_tagline: 'Home movies' } }, 'setting'],
    ['co', '/api/admin/clips/delete', { id: 'juni-1' }, 'clip'],
  ];
  let count = before;
  for (const [who, path, body, kind] of steps) {
    const result = await f.ok(who, path, body);
    if (path === '/api/admin/guests') {
      await f.ok('co', '/api/admin/guests/end', { id: result.id });
      count++;
    }
    const rows = f.activity();
    count++;
    assert.equal(rows.length, count, `${path} writes one row`);
    assert.equal(rows.at(-1).kind, kind, path);
  }
  const ada = f.db.prepare("SELECT id FROM channels WHERE slug='ada'").get().id;
  await f.ok('parent', '/api/admin/kids/delete', { id: ada });
  assert.equal(f.activity().at(-1).kind, 'channel');

  const feed = await f.ok('parent', '/api/admin/activity?limit=50');
  const text = feed.rows.map(row => row.text);
  assert.ok(text.includes('co Test renamed "Clip live" to "Skate park".'), text.join('\n'));
  assert.ok(text.includes('co Test made a guest code for Grandpa (Juni only).'));
  assert.ok(text.includes('co Test approved "Clip waiting" on Milo.'));
  assert.ok(text.includes('milo Test posted "Clip waiting" on Milo.'), 'uploads come from the upload jobs');
  assert.ok(text.includes('gran Test asked to watch.'));
  assert.ok(!text.some(line => /seen/.test(line)));
  const reviews = await f.ok('parent', '/api/admin/activity?kind=review');
  assert.ok(reviews.rows.length >= 1 && reviews.rows.every(row => row.kind === 'review'));
  const juni = await f.ok('parent', '/api/admin/activity?channel=juni');
  assert.ok(juni.rows.length && juni.rows.every(row => row.channel === 'juni'), JSON.stringify(juni.rows));
  const paged = await f.ok('parent', '/api/admin/activity?limit=3');
  assert.equal(paged.rows.length, 3);
  const next = await f.ok('parent', `/api/admin/activity?limit=3&before=${paged.next}`);
  assert.ok(next.rows.every(row => row.at < paged.next));
  assert.equal((await f.call('parent', '/api/admin/activity?kind=nope')).status, 400);
});

test('guest codes carry a kid scope, list their state and can be ended', { timeout: 60000 }, async t => {
  const f = await family(t);
  const made = await f.ok('co', '/api/admin/guests', { channel: 'juni', note: 'Aunt Bea' });
  assert.match(made.code, /^[A-Z0-9]{4}$/);
  assert.equal(made.scope, 'juni');
  assert.equal((await f.call('co', '/api/admin/guests', { channel: 'nobody' })).status, 400);
  let list = await f.ok('co', '/api/admin/guests');
  assert.deepEqual(list.codes.map(code => [code.id, code.state, code.scope, code.scopeName, code.note]), [[made.id, 'waiting', 'juni', 'Juni', 'Aunt Bea']]);
  const redeemed = await f.call(null, '/api/guest/redeem', { code: made.code });
  assert.equal(redeemed.status, 200);
  const cookie = redeemed.headers.get('set-cookie').split(';')[0];
  await fetch(f.origin + '/api/me', { headers: { cookie } });
  list = await f.ok('co', '/api/admin/guests');
  assert.equal(list.codes[0].state, 'active');
  assert.ok(list.codes[0].lastUsed >= list.codes[0].redeemed);
  await f.ok('co', '/api/admin/guests/end', { id: made.id });
  list = await f.ok('co', '/api/admin/guests');
  assert.equal(list.codes[0].state, 'ended');
  assert.equal((await fetch(f.origin + '/api/clips', { headers: { cookie } })).status, 401, 'an ended pass stops at once');
  const unused = await f.ok('co', '/api/admin/guests', {});
  await f.ok('co', '/api/admin/guests/end', { id: unused.id });
  assert.equal((await f.ok('co', '/api/admin/guests')).codes.find(code => code.id === unused.id).state, 'cancelled');
  assert.equal((await f.call(null, '/api/guest/redeem', { code: unused.code })).status, 400, 'a cancelled code no longer works');
});

test('kids: add, reorder and remove with their videos; never the first one', { timeout: 60000 }, async t => {
  const f = await family(t);
  const { kid } = await f.ok('parent', '/api/admin/kids', { name: 'Family', accent: '#4DB8FF', themeId: 'arcade-crt', login: { handle: 'fam', pass: 'eight888' } });
  assert.equal(kid.slug, 'family-kid', 'family stays reserved');
  assert.equal((await f.call('parent', '/api/admin/kids', { name: 'X', slug: 'family' })).status, 400);
  assert.ok((await f.login({ email: 'fam', pass: 'eight888' })).ok, 'kid logins take 8 characters');
  f.db.prepare(`INSERT INTO clips (id,title,src,position,created,channel_id) VALUES ('fk','Fk','/api/video/${MEDIA.juni}',1,0,?)`).run(kid.id);
  await f.ok('parent', '/api/admin/kids/order', { order: [kid.id, 2, 1] });
  assert.deepEqual((await f.ok('parent', '/api/admin/kids')).kids.map(row => row.slug), ['family-kid', 'juni', 'milo']);
  assert.equal((await f.call('parent', '/api/admin/kids/order', { order: [1, 2] })).status, 400, 'every kid, once');
  assert.equal((await f.call('parent', '/api/admin/kids/delete', { id: 1 })).status, 409);
  const removed = await f.ok('parent', '/api/admin/kids/delete', { id: kid.id });
  assert.equal(removed.videos, 1);
  assert.equal(f.db.prepare('SELECT 1 FROM clips WHERE id=?').get('fk'), undefined);
  assert.equal(f.db.prepare("SELECT 1 FROM accounts WHERE email='fam@kids.invalid'").get(), undefined);
  assert.ok(!existsSync(join(f.dir, 'data/videos', `${MEDIA.juni}.mp4`)));
});

test('settings: saved with a row each, locked ones skipped, a bad address refused', { timeout: 60000 }, async t => {
  const f = await family(t);
  const before = await f.ok('parent', '/api/admin/settings');
  assert.ok(before.settings.every(entry => entry.key !== 'setup_complete' && entry.key !== 'family_badge'));
  assert.equal(before.settings.find(entry => entry.key === 'mail_mode').locked, true, 'MAIL_MODE comes from the environment in tests');
  const saved = await f.ok('parent', '/api/admin/settings', { values: { site_name: 'The Test Tapes', comments_default: 'open', mail_mode: 'brevo' } });
  assert.deepEqual(saved.skipped, ['mail_mode'], 'a locked setting is skipped before any check');
  assert.equal(saved.settings.find(entry => entry.key === 'comments_default').value, 'open');
  const rows = f.db.prepare("SELECT subject FROM activity WHERE kind='setting' ORDER BY id DESC LIMIT 2").all().map(row => row.subject);
  assert.deepEqual(rows.sort(), ['comments_default', 'site_name']);
  const count = () => f.db.prepare("SELECT COUNT(*) n FROM activity WHERE kind='setting'").get().n;
  const before2 = count();
  await f.ok('parent', '/api/admin/settings', { values: { site_name: 'The Test Tapes', comments_default: 'open', guest_passes: true } });
  assert.equal(count(), before2, 'saving unchanged values writes nothing');
  assert.equal((await f.call('parent', '/api/admin/settings', { values: { site_url: 'not a url' } })).status, 400);
  assert.equal((await f.call('parent', '/api/admin/settings', { values: { nope: 1 } })).status, 400);
  assert.equal((await f.call('parent', '/api/admin/settings', { values: { site_name: ' ' } })).status, 400);
  assert.equal((await f.call('parent', '/api/admin/settings/email-test', {})).status, 400, 'no test without email on');
  // SITE_URL is in the test install's .env, so the address is checked, then skipped as locked.
  assert.deepEqual((await f.ok('parent', '/api/admin/settings', { values: { site_url: 'http://127.0.0.1:9999/' } })).skipped, ['site_url']);
  const site = await (await f.call(null, '/api/site')).json();
  assert.equal(site.siteName, 'The Test Tapes');
});

test('feed sentences stay plain', () => {
  const names = email => ({ 'p@x.co': 'Noor Halvorsen', 'ezra@kids.invalid': 'Ezra' }[email] || '');
  const kids = key => ({ ezra: 'Ezra' }[key] || '');
  const say = row => describeActivity(row, { names, kids });
  assert.equal(say({ kind: 'upload', actor: 'ezra@kids.invalid', detail: { title: 'Slime lab 3', review: 'pending', channel: 'ezra' } }),
    'Ezra posted "Slime lab 3". It is waiting for review.');
  assert.equal(say({ kind: 'guest', action: 'used', actor: 'guest:abc', detail: { note: 'Gran' } }), 'A guest code for Gran was used. They can watch for 24 hours.');
  assert.equal(say({ kind: 'badge', actor: 'p@x.co', detail: { channel: 'ezra' } }), 'Noor Halvorsen saved a new badge for Ezra.');
  assert.equal(say({ kind: 'setting', action: '', actor: 'p@x.co', subject: 'kids_public', detail: {} }), 'Noor Halvorsen changed the front door names setting.');
  assert.equal(say({ kind: 'upload', actor: 'p@x.co', detail: { title: 'Kite', channel: 'ezra' } }), 'Noor Halvorsen posted "Kite" on Ezra.');
  assert.equal(say({ kind: 'person', action: 'role', actor: 'p@x.co', detail: { name: 'Sam', role: 'admin' } }), 'Noor Halvorsen made Sam a co-parent.');
  assert.equal(say({ kind: 'review', action: 'approved', actor: 'system', detail: { title: '' } }), 'The app approved "Untitled".');
});
