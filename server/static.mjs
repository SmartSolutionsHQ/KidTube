import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, relative, sep, extname } from 'node:path';

const types = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};
const textTypes = new Set(['.css', '.js', '.html', '.json', '.svg']);

function encodingQuality(header, encoding) {
  const values = header.toLowerCase().split(',').map(value => value.trim().split(';'));
  const value = values.find(([name]) => name === encoding) || values.find(([name]) => name === '*');
  if (!value) return 0;
  const quality = value.slice(1).find(part => part.trim().startsWith('q='));
  const q = quality ? Number(quality.trim().slice(2)) : 1;
  return Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0;
}

export function sendFile(publicDir, req, res, pathname) {
  const page = pathname === '/' ? '/index.html'
    : ['/about', '/parents'].includes(pathname) ? `${pathname}/index.html` : pathname;
  let decoded;
  try { decoded = decodeURIComponent(page); } catch { res.writeHead(400).end(); return; }
  const file = resolve(publicDir, '.' + decoded);
  const rel = relative(publicDir, file);
  if (rel.startsWith('..' + sep) || rel === '..' || rel.startsWith(sep)) { res.writeHead(403).end(); return; }
  if (!existsSync(file)) { res.writeHead(404).end(); return; }
  const info = statSync(file);
  if (!info.isFile()) { res.writeHead(404).end(); return; }
  const ext = extname(file).toLowerCase();
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  const headers = {
    'Content-Type': types[ext] || 'application/octet-stream', 'Accept-Ranges': 'bytes',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
    ETag: etag, 'Last-Modified': info.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff', 'X-KidTube-Origin': 'node',
  };
  const compressible = textTypes.has(ext);
  if (compressible) headers.Vary = 'Accept-Encoding';
  const matches = req.headers['if-none-match'];
  const fresh = matches !== undefined
    ? matches.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''))
    : req.headers['if-modified-since'] && Math.floor(info.mtimeMs / 1000) * 1000 <= Date.parse(req.headers['if-modified-since']);
  if (fresh) { res.writeHead(304, headers).end(); return; }

  let selected = file, size = info.size;
  if (compressible && !req.headers.range) {
    const accepted = req.headers['accept-encoding'] || '';
    const encodings = ['br', 'gzip'].map(name => ({ name, quality: encodingQuality(accepted, name) }))
      .filter(value => value.quality > 0).sort((a, b) => b.quality - a.quality);
    for (const { name } of encodings) {
      const candidate = file + (name === 'br' ? '.br' : '.gz');
      if (!existsSync(candidate)) continue;
      selected = candidate;
      size = statSync(candidate).size;
      headers['Content-Encoding'] = name;
      break;
    }
  }
  // A weak entity tag cannot satisfy If-Range's strong comparison.
  const ifRange = req.headers['if-range'];
  const useRange = !ifRange || (!ifRange.includes('"') && Date.parse(ifRange) >= Math.floor(info.mtimeMs / 1000) * 1000);
  const match = useRange && /^bytes=(\d*)-(\d*)$/i.exec(req.headers.range || '');
  let start = 0, end = size - 1, status = 200;
  if (match && (match[1] || match[2])) {
    status = 206;
    if (match[1]) { start = Number(match[1]); end = match[2] ? Number(match[2]) : end; }
    else start = Math.max(0, size - Number(match[2]));
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` }).end(); return;
    }
    end = Math.min(end, size - 1);
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(Math.max(0, end - start + 1));
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || !size) { res.end(); return; }
  const stream = createReadStream(selected, { start, end });
  stream.on('error', error => res.destroy(error));
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
