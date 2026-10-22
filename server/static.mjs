// Serves public/: pages with the brand filled in and their scripts and stylesheets stamped with content
// hashes (kept forever), precompressed .br/.gz files when the browser takes them, and byte ranges.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative, sep, extname, join } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { fillBrand } from './brand.mjs';

const types = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};
const textTypes = new Set(['.css', '.js', '.mjs', '.html', '.json', '.svg']);
const HASHED = new Set(['.js', '.mjs', '.css']);
const HASH_LENGTH = 12;
// Root-relative script and stylesheet references in a page's src and href attributes.
const ASSET_REFERENCE = /(\b(?:src|href)=)(["'])(\/[^"'?#\s]+\.(?:js|css))\2/g;
const IMMUTABLE = 'public, max-age=31536000, immutable';
// Folders whose index.html answers the bare path.
const PRETTY = new Set(['/about', '/parents', '/install']);
// Every page gets the same policy as a header, so no page can forget it or weaken it with a <meta>.
export const PAGE_POLICY = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "media-src 'self' blob:", "font-src 'self'", "connect-src 'self'", "worker-src 'self' blob:", "manifest-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

function encodingQuality(header, encoding) {
  const values = header.toLowerCase().split(',').map(value => value.trim().split(';'));
  const value = values.find(([name]) => name === encoding) || values.find(([name]) => name === '*');
  if (!value) return 0;
  const quality = value.slice(1).find(part => part.trim().startsWith('q='));
  const q = quality ? Number(quality.trim().slice(2)) : 1;
  return Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0;
}

const digest = data => createHash('sha256').update(data).digest('hex');

export function createStatic(publicDir) {
  const root = resolve(publicDir);
  const fingerprints = new Map();
  const pages = new Map();
  const inside = file => {
    const rel = relative(root, file);
    return !(rel.startsWith('..' + sep) || rel === '..' || rel.startsWith(sep));
  };

  // Content hashes are keyed by size and mtime, so an edited file rehashes on its next use.
  function fingerprint(file) {
    const info = statSync(file, { throwIfNoEntry: false });
    if (!info?.isFile()) return null;
    const key = `${info.size}:${info.mtimeMs}`;
    let entry = fingerprints.get(file);
    if (entry?.key !== key) fingerprints.set(file, entry = { key, mtimeMs: info.mtimeMs, hash: digest(readFileSync(file)).slice(0, HASH_LENGTH) });
    return entry;
  }

  // Pages name the product through {{brand.name}} and friends (server/brand.mjs), and every script and
  // stylesheet they load gets its ?v= content hash. assets collects [file, fingerprint] for each one.
  function stampHtml(html, assets = []) {
    return fillBrand(html).replace(ASSET_REFERENCE, (reference, attribute, quote, path) => {
      const asset = resolve(root, '.' + path);
      const entry = inside(asset) && fingerprint(asset);
      if (!entry) return reference;
      assets.push([asset, entry]);
      return `${attribute}${quote}${path}?v=${entry.hash}${quote}`;
    });
  }

  // Pages are stamped and compressed in memory, so .br/.gz always match the stamped bytes.
  function page(file, info) {
    const key = `${info.size}:${info.mtimeMs}`;
    const cached = pages.get(file);
    if (cached?.key === key && cached.assets.every(([asset, hash]) => fingerprint(asset)?.hash === hash)) return cached;
    const used = [];
    const identity = Buffer.from(stampHtml(readFileSync(file, 'utf8'), used));
    const stamped = {
      key, assets: used.map(([asset, entry]) => [asset, entry.hash]),
      // A changed script must also move Last-Modified, or If-Modified-Since would keep the old page.
      mtimeMs: Math.max(info.mtimeMs, ...used.map(([, entry]) => entry.mtimeMs)),
      identity, etag: `W/"${digest(identity).slice(0, 16)}"`,
      br: brotliCompressSync(identity, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }),
      gzip: gzipSync(identity, { level: 9 }),
    };
    pages.set(file, stamped);
    return stamped;
  }

  function cacheControl(req, file, ext) {
    if (ext === '.html') return 'no-cache';
    if (!HASHED.has(ext)) return 'public, max-age=86400';
    // Only a reference carrying the current hash may be kept forever; anything else revalidates.
    const version = new URL(req.url, 'http://localhost').searchParams.get('v');
    return version && version === fingerprint(file)?.hash ? IMMUTABLE : 'no-cache';
  }

  // Hash every script and stylesheet and stamp every page once at boot.
  for (const name of readdirSync(root, { recursive: true })) {
    const file = join(root, name), ext = extname(name).toLowerCase();
    if (HASHED.has(ext)) fingerprint(file);
    else if (ext === '.html' && statSync(file).isFile()) page(file, statSync(file));
  }

  function sendFile(req, res, pathname) {
    const target = pathname === '/' ? '/index.html'
      : PRETTY.has(pathname) ? `${pathname}/index.html` : pathname;
    let decoded;
    try { decoded = decodeURIComponent(target); } catch { res.writeHead(400).end(); return; }
    const file = resolve(root, '.' + decoded);
    if (!inside(file)) { res.writeHead(403).end(); return; }
    if (!existsSync(file)) { res.writeHead(404).end(); return; }
    const info = statSync(file);
    if (!info.isFile()) { res.writeHead(404).end(); return; }
    const ext = extname(file).toLowerCase();
    const stamped = ext === '.html' ? page(file, info) : null;
    const mtimeMs = stamped ? stamped.mtimeMs : info.mtimeMs;
    const etag = stamped ? stamped.etag : `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
    const headers = {
      'Content-Type': types[ext] || 'application/octet-stream', 'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl(req, file, ext),
      ETag: etag, 'Last-Modified': new Date(mtimeMs).toUTCString(),
      'X-Content-Type-Options': 'nosniff',
    };
    if (stamped) headers['Content-Security-Policy'] = PAGE_POLICY;
    const compressible = textTypes.has(ext);
    if (compressible) headers.Vary = 'Accept-Encoding';
    const matches = req.headers['if-none-match'];
    const fresh = matches !== undefined
      ? matches.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''))
      : req.headers['if-modified-since'] && Math.floor(mtimeMs / 1000) * 1000 <= Date.parse(req.headers['if-modified-since']);
    if (fresh) { res.writeHead(304, headers).end(); return; }

    let selected = file, body = stamped?.identity, size = body ? body.length : info.size;
    if (compressible && !req.headers.range) {
      const accepted = req.headers['accept-encoding'] || '';
      const encodings = ['br', 'gzip'].map(name => ({ name, quality: encodingQuality(accepted, name) }))
        .filter(value => value.quality > 0).sort((a, b) => b.quality - a.quality);
      for (const { name } of encodings) {
        if (stamped) {
          if (stamped[name].length >= stamped.identity.length) continue;
          body = stamped[name];
          size = body.length;
        } else {
          const candidate = file + (name === 'br' ? '.br' : '.gz');
          if (!existsSync(candidate)) continue;
          selected = candidate;
          size = statSync(candidate).size;
        }
        headers['Content-Encoding'] = name;
        break;
      }
    }
    // A weak entity tag cannot satisfy If-Range's strong comparison.
    const ifRange = req.headers['if-range'];
    const useRange = !ifRange || (!ifRange.includes('"') && Date.parse(ifRange) >= Math.floor(mtimeMs / 1000) * 1000);
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
    if (body) { res.end(body.subarray(start, end + 1)); return; }
    const stream = createReadStream(selected, { start, end });
    stream.on('error', error => res.destroy(error));
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
  // For HTML that lives outside public/ (the demo's pages): stamped the same way as a page.
  sendFile.stampHtml = html => stampHtml(html);
  // A page as it is served (brand filled in, assets stamped), so the service worker can list the shell.
  sendFile.pageHtml = path => {
    const file = resolve(root, '.' + path);
    if (!inside(file) || !existsSync(file)) return '';
    return page(file, statSync(file)).identity.toString('utf8');
  };
  return sendFile;
}
