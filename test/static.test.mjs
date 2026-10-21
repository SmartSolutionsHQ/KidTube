import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStatic, sendFile } from '../server/static.mjs';
import { compressAssets } from '../scripts/compress-assets.mjs';
import { BRAND_NAME, ENDORSEMENT } from '../server/brand.mjs';

test('static delivery compresses text, revalidates caches, and preserves video byte ranges', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'kidtube-static-'));
  const html = '<!doctype html><title>KidTube</title>' + '<p>Bring your Pocket Pizza.</p>'.repeat(300);
  writeFileSync(join(directory, 'index.html'), html);
  writeFileSync(join(directory, 'clip.mp4'), 'PAYLOAD');
  writeFileSync(join(directory, 'empty.txt'), '');
  const compression = await compressAssets(directory);
  assert.ok(compression.brotliBytes < compression.rawBytes / 4);
  const server = http.createServer((req, res) => sendFile(directory, req, res, new URL(req.url, 'http://localhost').pathname));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  await t.test('Brotli and gzip negotiation respects quality values and keeps MIME type', async () => {
    const br = await fetch(base, { headers: { 'accept-encoding': 'br, gzip' } });
    assert.equal(br.headers.get('content-encoding'), 'br');
    assert.equal(br.headers.get('vary'), 'Accept-Encoding');
    assert.match(br.headers.get('content-type'), /text\/html/);
    assert.ok(Number(br.headers.get('content-length')) < Buffer.byteLength(html) / 4);
    assert.equal(await br.text(), html);
    const gzip = await fetch(base, { headers: { 'accept-encoding': 'br;q=0.2, gzip;q=1' } });
    assert.equal(gzip.headers.get('content-encoding'), 'gzip');
    assert.equal(await gzip.text(), html);
    const identity = await fetch(base, { headers: { 'accept-encoding': 'br;q=0, gzip;q=0' } });
    assert.equal(identity.headers.get('content-encoding'), null);
    assert.equal(await identity.text(), html);
  });

  await t.test('ETag and Last-Modified return body-free 304s with correct precedence', async () => {
    const original = await fetch(base, { method: 'HEAD' });
    const etag = original.headers.get('etag');
    assert.ok(etag);
    const cached = await fetch(base, { headers: { 'if-none-match': '"other", ' + etag } });
    assert.equal(cached.status, 304);
    assert.equal(await cached.text(), '');
    assert.equal(cached.headers.get('etag'), etag);
    assert.equal(cached.headers.get('cache-control'), 'no-cache');
    const modified = original.headers.get('last-modified');
    assert.equal((await fetch(base, { headers: { 'if-modified-since': modified } })).status, 304);
    const changed = await fetch(base, { headers: { 'if-none-match': '"other"', 'if-modified-since': modified } });
    assert.equal(changed.status, 200);
    await changed.text();
  });

  await t.test('media stays uncompressed with valid HEAD, suffix and error responses', async () => {
    const range = await fetch(base + '/clip.mp4', { headers: { range: 'bytes=2-5', 'accept-encoding': 'br, gzip' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-encoding'), null);
    assert.equal(range.headers.get('content-range'), 'bytes 2-5/7');
    assert.equal(await range.text(), 'YLOA');
    const suffix = await fetch(base + '/clip.mp4', { headers: { range: 'bytes=-3' } });
    assert.equal(await suffix.text(), 'OAD');
    assert.equal((await fetch(base + '/clip.mp4', { headers: { range: 'bytes=90-' } })).status, 416);
    const head = await fetch(base + '/clip.mp4', { method: 'HEAD' });
    assert.equal(head.headers.get('content-length'), '7');
    assert.equal(await head.text(), '');
    const staleRange = await fetch(base + '/clip.mp4', { headers: { range: 'bytes=2-5', 'if-range': '"outdated"' } });
    assert.equal(staleRange.status, 200);
    assert.equal(await staleRange.text(), 'PAYLOAD');
    assert.equal((await fetch(base + '/%2e%2e%2fprivate')).status, 403);
    const empty = await fetch(base + '/empty.txt');
    assert.equal(empty.status, 200);
    assert.equal(await empty.text(), '');
  });
});

test('pages stamp content hashes onto scripts and stylesheets so they can be cached forever', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'kidtube-stamp-'));
  mkdirSync(join(directory, 'js'));
  mkdirSync(join(directory, 'parents'));
  const page = (body = '') => `<!doctype html><link rel="stylesheet" href="/site.css"><script type="module" src="/js/app.js"></script>
    <script src='/js/app.js'></script><script src="https://example.com/x.js"></script><script src="/missing.js"></script>${body}`;
  writeFileSync(join(directory, 'index.html'), page('<p>Pocket Pizza.</p>'.repeat(200)));
  writeFileSync(join(directory, 'parents/index.html'), '<title>{{brand.name}} parents</title><p>{{brand.endorsement}} {{brand.unknown}}</p><script src="/js/app.js"></script>');
  writeFileSync(join(directory, 'site.css'), 'body{color:red}');
  writeFileSync(join(directory, 'js/app.js'), 'console.log(1)');
  await compressAssets(directory);
  const send = createStatic(directory);
  const server = http.createServer((req, res) => send(req, res, new URL(req.url, 'http://localhost').pathname));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const versions = html => [...html.matchAll(/(?:src|href)=["'](\/[^"']+)["']/g)].map(match => match[1]);

  const html = await (await fetch(base, { headers: { 'accept-encoding': 'identity' } })).text();
  const [css, js, again, missing] = versions(html);
  assert.match(css, /^\/site\.css\?v=[0-9a-f]{12}$/);
  assert.match(js, /^\/js\/app\.js\?v=[0-9a-f]{12}$/);
  assert.equal(again, js, 'single-quoted references are stamped too');
  assert.equal(missing, '/missing.js', 'unknown files are left alone');
  assert.ok(html.includes('src="https://example.com/x.js"'));
  const parents = await (await fetch(base + '/parents')).text();
  assert.equal(versions(parents)[0], js, 'every page is stamped');
  assert.ok(parents.startsWith(`<title>${BRAND_NAME} parents</title><p>${ENDORSEMENT} {{brand.unknown}}</p>`), 'brand tokens are filled in');

  await t.test('compressed pages carry the stamped references', async () => {
    for (const encoding of ['br', 'gzip']) {
      const response = await fetch(base, { headers: { 'accept-encoding': encoding } });
      assert.equal(response.headers.get('content-encoding'), encoding);
      assert.ok(Number(response.headers.get('content-length')) < Buffer.byteLength(html) / 4);
      assert.equal(await response.text(), html);
    }
  });

  await t.test('only the current hash is immutable; bare or stale references revalidate', async () => {
    const current = await fetch(base + js, { headers: { 'accept-encoding': 'identity' } });
    assert.equal(current.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(await current.text(), 'console.log(1)');
    assert.equal((await fetch(base + css)).headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal((await fetch(base + '/js/app.js')).headers.get('cache-control'), 'no-cache');
    assert.equal((await fetch(base + '/js/app.js?v=000000000000')).headers.get('cache-control'), 'no-cache');
    const range = await fetch(base, { headers: { range: 'bytes=0-14' } });
    assert.equal(range.status, 206);
    assert.equal(await range.text(), '<!doctype html>');
  });

  await t.test('editing a script restamps the page and retires the old hash', async () => {
    const etag = (await fetch(base, { method: 'HEAD' })).headers.get('etag');
    writeFileSync(join(directory, 'js/app.js'), 'console.log("changed")');
    const response = await fetch(base, { headers: { 'if-none-match': etag } });
    assert.equal(response.status, 200);
    const next = versions(await response.text())[1];
    assert.notEqual(next, js);
    assert.equal((await fetch(base + next)).headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal((await fetch(base + js)).headers.get('cache-control'), 'no-cache');
  });
});
