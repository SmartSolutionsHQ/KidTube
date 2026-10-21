import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { asStaff } from './api.js';
import { publishClip } from './publish.mjs';

const execFileAsync = promisify(execFile);
const CHUNK_SIZE = 4 * 1024 * 1024;
const MAX_SOURCE = 512 * 1024 * 1024;
const MAX_SECONDS = 305;
const ID = /^[a-f0-9-]{36}$/;

function json(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-KidTube-Origin': 'node',
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

async function probe(file) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height',
    '-of', 'json', file,
  ], { timeout: 30000, maxBuffer: 1024 * 1024 });
  const info = JSON.parse(stdout);
  const video = info.streams?.find(stream => stream.codec_type === 'video' && stream.width > 0 && stream.height > 0);
  const duration = Number(info.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0) throw new Error('no usable video');
  if (duration > MAX_SECONDS) throw new HttpError(400, 'Keep videos under five minutes.');
  return duration;
}

function transcode(input, output, duration, onProgress) {
  return new Promise((resolve, reject) => {
    const args = [
      '-nostdin', '-y', '-hide_banner', '-loglevel', 'error', '-i', input,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', "scale=w='min(854,iw)':h='min(480,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k', '-ar', '44100',
      '-threads', '4', '-movflags', '+faststart', '-progress', 'pipe:1', '-f', 'mp4', output,
    ];
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let progress = '', errorText = '';
    child.stdout.on('data', chunk => {
      progress += chunk.toString();
      const lines = progress.split('\n');
      progress = lines.pop();
      for (const line of lines) {
        if (line.startsWith('out_time_us=')) {
          const seconds = Number(line.slice(12)) / 1000000;
          if (Number.isFinite(seconds)) onProgress(Math.min(99, Math.floor(seconds / duration * 100)));
        }
      }
    });
    child.stderr.on('data', chunk => { errorText = (errorText + chunk.toString()).slice(-2048); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${errorText}`)));
  });
}

export function createUploadManager({ sqlite, env, databasePath, notifications }) {
  const dataDir = process.env.DATA_DIR || dirname(databasePath);
  const incoming = join(dataDir, 'incoming');
  const videos = join(dataDir, 'videos');
  mkdirSync(incoming, { recursive: true, mode: 0o700 });
  mkdirSync(videos, { recursive: true, mode: 0o700 });
  sqlite.exec(`CREATE TABLE IF NOT EXISTS upload_jobs (
    id TEXT PRIMARY KEY, email TEXT NOT NULL, title TEXT NOT NULL, size INTEGER NOT NULL,
    status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, clip_id TEXT,
    error TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL)`);
  sqlite.prepare("UPDATE upload_jobs SET status='failed', error='Processing was interrupted. Upload again.', updated=? WHERE status='processing'").run(Date.now());
  const getJob = sqlite.prepare('SELECT * FROM upload_jobs WHERE id=?');
  const updateProgress = sqlite.prepare('UPDATE upload_jobs SET progress=?, updated=? WHERE id=?');
  let active = false;

  async function staff(req, payload = {}) {
    const email = String(payload.email || req.headers['x-kid-email'] || '').trim().toLowerCase();
    const token = String(payload.t || req.headers['x-kid-token'] || '');
    return asStaff(env, email, token);
  }

  async function owned(req, id, payload) {
    if (!ID.test(id)) throw new HttpError(404, 'Upload not found.');
    const user = await staff(req, payload);
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
      await rename(temporary, output);
      const clipId = randomUUID();
      const now = Date.now();
      publishClip(sqlite, notifications, {
        id: clipId, title: job.title, src: `/api/video/${job.id}`, kind: 'video',
        publishedAt: new Date(now).toISOString(), duration,
      }, job.id);
      await rm(dir, { recursive: true, force: true })
        .catch(error => console.error(`Could not remove completed upload ${job.id}:`, error));
    } catch (error) {
      console.error(`Upload ${job.id} failed:`, error);
      const message = error instanceof HttpError ? error.message : 'Server could not convert this video. Try another file.';
      sqlite.prepare("UPDATE upload_jobs SET status='failed', error=?, updated=? WHERE id=?")
        .run(message, Date.now(), job.id);
      await rm(temporary, { force: true }).catch(() => {});
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

  async function video(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    const id = pathname.slice('/api/video/'.length);
    if (!ID.test(id)) throw new HttpError(404, 'Video not found.');
    const file = join(videos, `${id}.mp4`);
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
      'Content-Type': 'video/mp4', 'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store',
      'X-KidTube-Origin': 'node',
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
        const user = await staff(req, payload);
        if (!user) throw new HttpError(403, 'Not authorized.');
        const size = Number(payload.size);
        const title = String(payload.title || '').trim().slice(0, 80);
        if (!Number.isSafeInteger(size) || size < 1000 || size > MAX_SOURCE) throw new HttpError(400, 'File must be under 512 MB.');
        if (!title) throw new HttpError(400, 'Name the video.');
        const pending = sqlite.prepare("SELECT COUNT(*) n FROM upload_jobs WHERE email=? AND status IN ('receiving','queued','processing') AND created>?").get(user.email, Date.now() - 86400000).n;
        if (pending >= 3) throw new HttpError(429, 'Finish an earlier upload before starting another.');
        const id = randomUUID(), now = Date.now();
        mkdirSync(join(incoming, id), { mode: 0o700 });
        sqlite.prepare('INSERT INTO upload_jobs (id,email,title,size,status,created,updated) VALUES (?,?,?,?,?,?,?)')
          .run(id, user.email, title, size, 'receiving', now, now);
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
        const clip = job.clip_id ? sqlite.prepare('SELECT id,title,src,poster,kind,blurb,published,duration,position FROM clips WHERE id=?').get(job.clip_id) : null;
        return json(res, 200, {
          ok: true, status: job.status, progress: job.progress, error: job.error,
          clip: clip && { id: clip.id, title: clip.title, src: clip.src, poster: clip.poster, kind: clip.kind,
            blurb: clip.blurb, publishedAt: clip.published, duration: clip.duration, position: clip.position },
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
    if (ID.test(id)) await rm(join(videos, `${id}.mp4`), { force: true });
  }

  pump().catch(error => console.error('Upload queue failed', error));
  return { handle, deleteVideo };
}
