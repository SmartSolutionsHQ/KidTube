import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { asCreator } from './api.js';
import { DEFAULT_CHANNEL_ID, channelById, channelBySlug } from './channels.mjs';
import { publishClip } from './publish.mjs';

const execFileAsync = promisify(execFile);
const CHUNK_SIZE = 4 * 1024 * 1024;
const MAX_SOURCE = 512 * 1024 * 1024;
const MAX_SECONDS = 305;
const ID = /^[a-f0-9-]{36}$/;
const MEDIA = /^([a-f0-9-]{36})(\.jpg)?$/;
const PROBE_TIMEOUT = 30000;
const POSTER_TIMEOUT = 30000;
// FFmpeg reports progress twice a second, so minutes of silence mean it is stuck.
const TRANSCODE_STALL = 2 * 60000;
const TRANSCODE_TIMEOUT = 30 * 60000;
const STAFF = new Set(['admin', 'super']);

function json(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function body(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Upload chunk is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function jsonBody(req) {
  try { return JSON.parse((await body(req, 65536)).toString('utf8')); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Invalid request.');
  }
}

// Runs a tool and kills it when it passes its deadline or, with stallMs, goes quiet on stdout.
export function runProcess(command, args, { timeoutMs, stallMs, onStdout = () => {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let errorText = '', failure = null, stall = null;
    const stop = reason => { failure ??= new Error(`${command} ${reason}`); child.kill('SIGKILL'); };
    const deadline = setTimeout(() => stop(`timed out after ${timeoutMs} ms`), timeoutMs);
    const armStall = () => {
      clearTimeout(stall);
      if (stallMs) stall = setTimeout(() => stop(`stalled for ${stallMs} ms`), stallMs);
    };
    armStall();
    child.stdout.on('data', chunk => { armStall(); onStdout(chunk); });
    child.stderr.on('data', chunk => { errorText = (errorText + chunk.toString()).slice(-2048); });
    child.once('error', error => { failure ??= error; });
    child.once('close', code => {
      clearTimeout(deadline);
      clearTimeout(stall);
      if (failure) reject(failure);
      else if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${errorText}`));
    });
  });
}

async function probe(file) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height',
    '-of', 'json', file,
  ], { timeout: PROBE_TIMEOUT, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  const info = JSON.parse(stdout);
  const video = info.streams?.find(stream => stream.codec_type === 'video' && stream.width > 0 && stream.height > 0);
  const duration = Number(info.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0) throw new Error('no usable video');
  if (duration > MAX_SECONDS) throw new HttpError(400, 'Keep videos under five minutes.');
  return duration;
}

function transcode(input, output, duration, onProgress) {
  const args = [
    '-nostdin', '-y', '-hide_banner', '-loglevel', 'error', '-i', input,
    // Phone videos carry GPS and device details; none of it should reach viewers.
    '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1',
    '-vf', "scale=w='min(854,iw)':h='min(480,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-ar', '44100',
    '-threads', '4', '-movflags', '+faststart', '-progress', 'pipe:1', '-f', 'mp4', output,
  ];
  let progress = '';
  return runProcess('ffmpeg', args, {
    timeoutMs: TRANSCODE_TIMEOUT, stallMs: TRANSCODE_STALL,
    onStdout(chunk) {
      progress += chunk.toString();
      const lines = progress.split('\n');
      progress = lines.pop();
      for (const line of lines) {
        if (line.startsWith('out_time_us=')) {
          const seconds = Number(line.slice(12)) / 1000000;
          if (Number.isFinite(seconds)) onProgress(Math.min(99, Math.floor(seconds / duration * 100)));
        }
      }
    },
  });
}

// One small frame about a second in (the middle of very short clips) so the feed never shows black.
function grabPoster(video, output, duration) {
  return runProcess('ffmpeg', [
    '-nostdin', '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', Math.min(1, duration / 2).toFixed(2), '-i', video, '-map_metadata', '-1',
    '-frames:v', '1', '-vf', "scale=w='min(480,iw)':h=-2", '-q:v', '5', '-f', 'image2', '-c:v', 'mjpeg', output,
  ], { timeoutMs: POSTER_TIMEOUT });
}

export function createUploadManager({ sqlite, env, databasePath, notifications }) {
  const dataDir = process.env.DATA_DIR || dirname(databasePath);
  const incoming = join(dataDir, 'incoming');
  const videos = join(dataDir, 'videos');
  mkdirSync(incoming, { recursive: true, mode: 0o700 });
  mkdirSync(videos, { recursive: true, mode: 0o700 });
  sqlite.prepare("UPDATE upload_jobs SET status='failed', error='Processing was interrupted. Upload again.', updated=? WHERE status='processing'").run(Date.now());
  const getJob = sqlite.prepare('SELECT * FROM upload_jobs WHERE id=?');
  const updateProgress = sqlite.prepare('UPDATE upload_jobs SET progress=?, updated=? WHERE id=?');
  let active = false;

  async function creator(req, payload = {}) {
    const email = String(payload.email || req.headers['x-kid-email'] || '').trim().toLowerCase();
    const token = String(payload.t || req.headers['x-kid-token'] || '');
    return asCreator(env, email, token);
  }

  // Kids upload only to their own channel; parents pick one or get the default.
  function targetChannel(user, slug) {
    if (user.role === 'kid') {
      const own = channelById(sqlite, user.channelId);
      if (!own) throw new HttpError(403, 'Ask a parent to connect your account to your channel.');
      if (slug && slug !== own.slug) throw new HttpError(403, 'You can only upload to your own channel.');
      return own.id;
    }
    if (!slug) return DEFAULT_CHANNEL_ID;
    const channel = channelBySlug(sqlite, slug);
    if (!channel) throw new HttpError(400, 'Choose a channel.');
    return channel.id;
  }

  async function owned(req, id, payload) {
    if (!ID.test(id)) throw new HttpError(404, 'Upload not found.');
    const user = await creator(req, payload);
    if (!user) throw new HttpError(403, 'Not authorized.');
    const job = getJob.get(id);
    if (!job || (job.email !== user.email && user.role !== 'super')) throw new HttpError(404, 'Upload not found.');
    return job;
  }

  async function runJob(job) {
    const dir = join(incoming, job.id);
    const source = join(dir, 'source');
    const temporary = join(videos, `${job.id}.tmp`);
    const output = join(videos, `${job.id}.mp4`);
    const poster = join(videos, `${job.id}.jpg`);
    try {
      const total = Math.ceil(job.size / CHUNK_SIZE);
      const handle = await open(source, 'wx', 0o600);
      try {
        for (let seq = 0; seq < total; seq++) await handle.writeFile(await readFile(join(dir, String(seq))));
      } finally { await handle.close(); }
      if ((await stat(source)).size !== job.size) throw new Error('source size mismatch');
      const duration = await probe(source);
      await transcode(source, temporary, duration, percent => {
        const old = getJob.get(job.id)?.progress || 0;
        if (percent >= old + 5) updateProgress.run(percent, Date.now(), job.id);
      });
      if ((await stat(temporary)).size < 1000) throw new Error('encoded file is empty');
      // A missing poster only costs a still frame, so it never fails the upload.
      const posterSrc = await grabPoster(temporary, poster, duration)
        .then(async () => (await stat(poster)).size > 0 ? `/api/video/${job.id}.jpg` : '')
        .catch(async error => {
          console.error(`Poster for upload ${job.id} failed:`, error);
          await rm(poster, { force: true });
          return '';
        });
      await rename(temporary, output);
      const uploader = sqlite.prepare('SELECT role FROM accounts WHERE email=?').get(job.email);
      const reviewed = channelById(sqlite, job.channel_id)?.review_uploads && !STAFF.has(uploader?.role);
      const clipId = randomUUID();
      const now = Date.now();
      publishClip(sqlite, notifications, {
        id: clipId, title: job.title, src: `/api/video/${job.id}`, poster: posterSrc, kind: 'video',
        publishedAt: new Date(now).toISOString(), duration, channelId: job.channel_id, review: reviewed ? 'pending' : 'approved',
      }, job.id);
      await rm(dir, { recursive: true, force: true })
        .catch(error => console.error(`Could not remove completed upload ${job.id}:`, error));
    } catch (error) {
      console.error(`Upload ${job.id} failed:`, error);
      const message = error instanceof HttpError ? error.message : 'Server could not convert this video. Try another file.';
      sqlite.prepare("UPDATE upload_jobs SET status='failed', error=?, updated=? WHERE id=?")
        .run(message, Date.now(), job.id);
      for (const file of [temporary, output, poster]) await rm(file, { force: true }).catch(() => {});
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function pump() {
    if (active) return;
    const job = sqlite.prepare("SELECT * FROM upload_jobs WHERE status='queued' ORDER BY created LIMIT 1").get();
    if (!job) return;
    active = true;
    sqlite.prepare("UPDATE upload_jobs SET status='processing', updated=? WHERE id=?").run(Date.now(), job.id);
    try { await runJob(job); }
    finally { active = false; queueMicrotask(() => { pump().catch(error => console.error('Upload queue failed', error)); }); }
  }

  // Videos and their posters share the cookie-gated /api/video/ routes and never enter a shared cache.
  async function video(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    const media = MEDIA.exec(pathname.slice('/api/video/'.length));
    if (!media) throw new HttpError(404, 'Video not found.');
    const file = join(videos, media[1] + (media[2] || '.mp4'));
    if (!existsSync(file)) throw new HttpError(404, 'Video not found.');
    const size = statSync(file).size;
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0, end = size - 1, status = 200;
    if (match && (match[1] || match[2])) {
      status = 206;
      if (match[1]) { start = Number(match[1]); end = match[2] ? Number(match[2]) : end; }
      else { start = Math.max(0, size - Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return;
      }
      end = Math.min(end, size - 1);
    }
    const headers = {
      'Content-Type': media[2] ? 'image/jpeg' : 'video/mp4', 'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store',
    };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') res.end(); else createReadStream(file, { start, end }).pipe(res);
  }

  async function handle(req, res, pathname) {
    try {
      if (pathname.startsWith('/api/video/')) return await video(req, res, pathname);
      if (pathname === '/api/upload/raw/start' && req.method === 'POST') {
        const payload = await jsonBody(req);
        const user = await creator(req, payload);
        if (!user) throw new HttpError(403, 'Not authorized.');
        const channelId = targetChannel(user, payload.channel ? String(payload.channel) : '');
        const size = Number(payload.size);
        const title = String(payload.title || '').trim().slice(0, 80);
        if (!Number.isSafeInteger(size) || size < 1000 || size > MAX_SOURCE) throw new HttpError(400, 'File must be under 512 MB.');
        if (!title) throw new HttpError(400, 'Name the video.');
        const pending = sqlite.prepare("SELECT COUNT(*) n FROM upload_jobs WHERE email=? AND status IN ('receiving','queued','processing') AND created>?").get(user.email, Date.now() - 86400000).n;
        if (pending >= 3) throw new HttpError(429, 'Finish an earlier upload before starting another.');
        const id = randomUUID(), now = Date.now();
        mkdirSync(join(incoming, id), { mode: 0o700 });
        sqlite.prepare('INSERT INTO upload_jobs (id,email,title,size,status,created,updated,channel_id) VALUES (?,?,?,?,?,?,?,?)')
          .run(id, user.email, title, size, 'receiving', now, now, channelId);
        return json(res, 200, { ok: true, uploadId: id, chunkSize: CHUNK_SIZE });
      }
      const chunkMatch = /^\/api\/upload\/raw\/chunk\/([a-f0-9-]{36})\/(\d{1,4})$/.exec(pathname);
      if (chunkMatch && req.method === 'POST') {
        const job = await owned(req, chunkMatch[1]);
        if (job.status !== 'receiving') throw new HttpError(409, 'Upload already finished.');
        const seq = Number(chunkMatch[2]), total = Math.ceil(job.size / CHUNK_SIZE);
        if (!Number.isSafeInteger(seq) || seq >= total) throw new HttpError(400, 'Invalid chunk.');
        const expected = Math.min(CHUNK_SIZE, job.size - seq * CHUNK_SIZE);
        if (Number(req.headers['content-length']) > expected) throw new HttpError(413, 'Upload chunk is too large.');
        const bytes = await body(req, expected);
        if (bytes.length !== expected) throw new HttpError(400, 'Incomplete chunk.');
        const dir = join(incoming, job.id);
        const temporary = join(dir, `${seq}.${randomUUID()}.tmp`);
        await writeFile(temporary, bytes, { mode: 0o600 });
        await rename(temporary, join(dir, String(seq)));
        return json(res, 200, { ok: true, seq });
      }
      if (pathname === '/api/upload/raw/finish' && req.method === 'POST') {
        const payload = await jsonBody(req);
        const job = await owned(req, String(payload.uploadId || ''), payload);
        if (job.status !== 'receiving') throw new HttpError(409, 'Upload already finished.');
        const total = Math.ceil(job.size / CHUNK_SIZE), dir = join(incoming, job.id);
        for (let seq = 0; seq < total; seq++) {
          const info = await stat(join(dir, String(seq))).catch(() => null);
          if (!info || info.size !== Math.min(CHUNK_SIZE, job.size - seq * CHUNK_SIZE)) {
            throw new HttpError(400, `Chunk ${seq + 1} is missing. Retry the upload.`);
          }
        }
        const changed = sqlite.prepare("UPDATE upload_jobs SET status='queued', updated=? WHERE id=? AND status='receiving'")
          .run(Date.now(), job.id).changes;
        if (!changed) throw new HttpError(409, 'Upload already finished.');
        pump().catch(error => console.error('Upload queue failed', error));
        return json(res, 202, { ok: true, uploadId: job.id, status: 'queued' });
      }
      if (pathname === '/api/upload/raw/cancel' && req.method === 'POST') {
        const payload = await jsonBody(req);
        const job = await owned(req, String(payload.uploadId || ''), payload);
        if (job.status !== 'receiving') throw new HttpError(409, 'Upload is already processing.');
        sqlite.prepare("UPDATE upload_jobs SET status='failed', error='Upload cancelled.', updated=? WHERE id=?")
          .run(Date.now(), job.id);
        await rm(join(incoming, job.id), { recursive: true, force: true });
        return json(res, 200, { ok: true });
      }
      const statusMatch = /^\/api\/upload\/raw\/status\/([a-f0-9-]{36})$/.exec(pathname);
      if (statusMatch && req.method === 'GET') {
        const job = await owned(req, statusMatch[1]);
        const clip = job.clip_id ? sqlite.prepare(`SELECT c.id,c.title,c.src,c.poster,c.kind,c.blurb,c.published,c.duration,c.position,c.review,ch.slug channel
          FROM clips c LEFT JOIN channels ch ON ch.id=c.channel_id WHERE c.id=?`).get(job.clip_id) : null;
        return json(res, 200, {
          ok: true, status: job.status, progress: job.progress, error: job.error,
          clip: clip && { id: clip.id, title: clip.title, src: clip.src, poster: clip.poster, kind: clip.kind,
            blurb: clip.blurb, publishedAt: clip.published, duration: clip.duration, position: clip.position,
            channel: clip.channel || '', review: clip.review },
        });
      }
      throw new HttpError(404, 'Not found.');
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('Upload request failed:', error);
      if (!res.headersSent) json(res, error.status || 500, { ok: false, error: error.status ? error.message : 'Server error.' });
      else res.destroy(error);
    }
  }

  async function deleteVideo(id) {
    if (!ID.test(id)) return;
    for (const file of [`${id}.mp4`, `${id}.jpg`]) await rm(join(videos, file), { force: true });
  }

  pump().catch(error => console.error('Upload queue failed', error));
  return { handle, deleteVideo };
}
