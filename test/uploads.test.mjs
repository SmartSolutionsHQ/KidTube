import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { passwordRecord } from '../server/passwords.mjs';
import { runProcess } from '../server/uploads.mjs';
import { startInstall, PARENT } from './helpers.mjs';

const KID = { email: 'ana@example.com', pass: 'A-kid-test-only-password!' };

test('tools that hang, go quiet, fail or are missing reject instead of blocking the queue', async () => {
  const node = process.execPath;
  await assert.rejects(runProcess(node, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 300 }), /timed out after 300 ms/);
  await assert.rejects(runProcess(node, ['-e', "process.stdout.write('x'); setInterval(() => {}, 1000)"], { timeoutMs: 10000, stallMs: 300 }),
    /stalled for 300 ms/);
  await assert.rejects(runProcess(node, ['-e', "console.error('bad input'); process.exit(3)"], { timeoutMs: 10000 }), /exited 3: bad input/);
  await assert.rejects(runProcess('kidtube-missing-tool', [], { timeoutMs: 10000 }), /ENOENT/);
  const seen = [];
  await runProcess(node, ['-e', "process.stdout.write('progress')"], { timeoutMs: 10000, stallMs: 5000, onStdout: chunk => seen.push(String(chunk)) });
  assert.deepEqual(seen, ['progress']);
});

function makeVideo(dir) {
  const file = join(dir, 'source.mp4');
  const result = spawnSync('ffmpeg', ['-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc=s=320x240:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-metadata', 'title=Our street', '-metadata', 'comment=GPS 40.7128,-74.0060', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, 'FFmpeg is required for integration tests: ' + result.stderr);
  return readFileSync(file);
}

async function upload(install, account, bytes, extra = {}) {
  const auth = { email: account.email, t: account.t };
  const start = await install.call('/api/upload/raw/start', { body: { ...auth, title: 'Test video', size: bytes.length, ...extra } });
  const started = await start.json();
  if (!start.ok) return { status: start.status, ...started };
  const headers = { 'content-type': 'application/octet-stream', 'x-kid-email': account.email, 'x-kid-token': account.t };
  for (let seq = 0; seq * started.chunkSize < bytes.length; seq++) {
    const body = bytes.subarray(seq * started.chunkSize, (seq + 1) * started.chunkSize);
    const chunk = await fetch(`${install.origin}/api/upload/raw/chunk/${started.uploadId}/${seq}`, { method: 'POST', headers, body });
    assert.equal(chunk.status, 200);
  }
  assert.equal((await install.call('/api/upload/raw/finish', { body: { ...auth, uploadId: started.uploadId } })).status, 202);
  for (let attempt = 0; attempt < 120; attempt++) {
    const status = await (await install.call(`/api/upload/raw/status/${started.uploadId}`, { headers })).json();
    if (status.status === 'done' || status.status === 'failed') return { uploadId: started.uploadId, ...status };
    await wait(250);
  }
  throw new Error('Upload did not finish: ' + install.logs());
}

test('uploads land in the right channel with a poster, and kid uploads wait for review', { timeout: 120000 }, async t => {
  const install = await startInstall(t);
  install.db.exec(`INSERT INTO channels (id,slug,name,review_uploads,position,created) VALUES
    (1,'ana','Ana',1,1,0), (2,'ben','Ben',1,2,0)`);
  const { salt, hash } = await passwordRecord(KID.pass);
  install.db.prepare(`INSERT INTO accounts (email,first,last,salt,hash,status,role,created,channel_id)
    VALUES (?,'Ana','R',?,?,'approved','kid',0,1)`).run(KID.email, salt, hash);
  const parent = await install.login(PARENT);
  const kid = await install.login(KID);
  assert.equal(kid.role, 'kid');
  const video = makeVideo(install.dir);
  const videos = join(install.dir, 'data/videos');
  const clips = async () => (await (await install.call('/api/clips', { cookie: parent.cookie })).json()).clips;

  await t.test('a kid cannot upload to a sibling channel or without a channel', async () => {
    const sibling = await upload(install, kid, video, { channel: 'ben' });
    assert.deepEqual(sibling, { status: 403, ok: false, error: 'You can only upload to your own channel.' });
    install.db.exec("UPDATE accounts SET channel_id=NULL WHERE email='ana@example.com'");
    assert.equal((await upload(install, kid, video)).status, 403);
    install.db.exec("UPDATE accounts SET channel_id=1 WHERE email='ana@example.com'");
    assert.equal((await upload(install, parent, video, { channel: 'nobody' })).status, 400);
    assert.equal(install.db.prepare('SELECT COUNT(*) n FROM upload_jobs').get().n, 0);
  });

  await t.test('a kid upload gets a poster and stays out of the feed until reviewed', async () => {
    const result = await upload(install, kid, video, { channel: 'ana' });
    assert.equal(result.status, 'done', result.error);
    assert.equal(result.clip.review, 'pending');
    assert.equal(result.clip.channel, 'ana');
    assert.equal(result.clip.poster, `/api/video/${result.uploadId}.jpg`);
    const poster = readFileSync(join(videos, `${result.uploadId}.jpg`));
    assert.deepEqual([...poster.subarray(0, 3)], [0xff, 0xd8, 0xff], 'the poster is a JPEG');
    assert.ok(poster.length < 100000, 'the poster stays small');
    assert.ok(!(await clips()).some(clip => clip.id === result.clip.id));
    assert.equal(install.db.prepare('SELECT COUNT(*) n FROM video_announcements').get().n, 0, 'pending clips are not announced');
  });

  await t.test('parent uploads go live in the chosen or default channel, posters stay private', async () => {
    const chosen = await upload(install, parent, video, { channel: 'ben' });
    const fallback = await upload(install, parent, video);
    assert.deepEqual([chosen.clip.review, chosen.clip.channel], ['live', 'ben']);
    assert.deepEqual([fallback.clip.review, fallback.clip.channel], ['live', 'ana']);
    assert.deepEqual((await clips()).map(clip => [clip.id, clip.channel, clip.poster]), [
      [fallback.clip.id, 'ana', `/api/video/${fallback.uploadId}.jpg`],
      [chosen.clip.id, 'ben', `/api/video/${chosen.uploadId}.jpg`],
    ]);
    const poster = await install.call(chosen.clip.poster, { cookie: parent.cookie });
    assert.equal(poster.status, 200);
    assert.equal(poster.headers.get('content-type'), 'image/jpeg');
    assert.match(poster.headers.get('cache-control'), /no-store/);
    assert.equal((await install.call(chosen.clip.poster)).status, 401);
    assert.equal((await install.call(`/api/video/${chosen.uploadId}.png`, { cookie: parent.cookie })).status, 404);

    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', join(videos, `${chosen.uploadId}.mp4`)], { encoding: 'utf8' });
    const tags = JSON.parse(probe.stdout).format.tags || {};
    assert.equal(tags.title, undefined, 'source metadata is stripped');
    assert.equal(tags.comment, undefined, 'source metadata is stripped');

    const signed = { email: PARENT.email, t: parent.t };
    assert.equal((await (await install.call('/api/clips/delete', { body: { ...signed, id: chosen.clip.id } })).json()).ok, true);
    assert.equal(existsSync(join(videos, `${chosen.uploadId}.mp4`)), false);
    assert.equal(existsSync(join(videos, `${chosen.uploadId}.jpg`)), false);
  });
});
