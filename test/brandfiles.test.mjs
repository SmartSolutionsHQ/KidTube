import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { ImageError, cleanIcon, cleanImage, pngSize, sniff } from '../server/images.mjs';
import { renderSpec } from '../server/badge.mjs';
import { startInstall, PARENT } from './helpers.mjs';

/* ---------- tiny image makers ---------- */
function chunk(type, data = Buffer.alloc(0)) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}
function png(width, height, { before = [], after = [], tail = Buffer.alloc(0) } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc(Math.min(height, 512) * (1 + Math.min(width, 512) * 4), 0x7f);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...before,
    chunk('IDAT', deflateSync(rows)), ...after, chunk('IEND'), tail]);
}
const text = (keyword, value) => chunk('tEXt', Buffer.from(`${keyword}\0${value}`, 'latin1'));

function segment(marker, payload) {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}
// EXIF with the orientation, a description and a GPS pointer, in Intel byte order.
function exif(orientation) {
  const tiff = Buffer.alloc(8 + 2 + 12 * 3 + 4 + 32);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(3, 8);
  const entry = (i, tag, type, count, value) => {
    const at = 10 + i * 12;
    tiff.writeUInt16LE(tag, at); tiff.writeUInt16LE(type, at + 2); tiff.writeUInt32LE(count, at + 4); tiff.writeUInt32LE(value, at + 8);
  };
  entry(0, 0x010e, 2, 24, 50);
  entry(1, 0x0112, 3, 1, orientation);
  entry(2, 0x8825, 4, 1, 0);
  tiff.write('Secret Lane, Springfield\0', 50, 'latin1');
  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
}
function jpeg({ orientation = 6, width = 20, height = 10 } = {}) {
  const sof = Buffer.from([8, 0, 0, 0, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  const scan = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x02\0\0\x01\0\x01\0\0', 'latin1')),
    segment(0xe1, exif(orientation)),
    segment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>secret-xmp</x:xmpmeta>', 'latin1')),
    segment(0xe2, Buffer.from('ICC_PROFILE\0\x01\x01profile-bytes', 'latin1')),
    segment(0xfe, Buffer.from('secret comment', 'latin1')),
    segment(0xee, Buffer.from('Adobe\0\x64\0\0\0\0\x01', 'latin1')),
    segment(0xdb, Buffer.alloc(65, 1)),
    segment(0xc0, sof),
    segment(0xc4, Buffer.alloc(29, 2)),
    segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    scan,
    Buffer.from([0xff, 0xd9]),
    Buffer.from('<script>appended</script>', 'latin1'),
  ]);
}
// A real 1 x 1 lossless WebP, then the same picture in an extended file with ICC, EXIF and XMP.
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
function riffChunk(type, data) {
  const head = Buffer.alloc(8);
  head.write(type, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}
function webpExtended({ flags = 0x20 | 0x08 | 0x04, extra = [] } = {}) {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = flags;
  const body = Buffer.concat([riffChunk('VP8X', vp8x), riffChunk('ICCP', Buffer.from('icc-secret')), WEBP.subarray(12),
    riffChunk('EXIF', exif(1)), riffChunk('XMP ', Buffer.from('<x:xmpmeta>secret-xmp</x:xmpmeta>')), ...extra]);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}
const has = (bytes, value) => bytes.includes(Buffer.from(value, 'latin1'));

test('pictures are picked by their bytes and lose their metadata', async t => {
  await t.test('PNG: magic, IHDR size, CRCs, and only drawing chunks survive', () => {
    const dirty = png(3, 2, { before: [text('GPS', 'Secret Lane'), chunk('eXIf', exif(6)), chunk('iCCP', Buffer.from('icc\0\0x'))],
      after: [text('Comment', 'secret')], tail: Buffer.from('<script>appended</script>') });
    assert.equal(sniff(dirty), 'png');
    const clean = cleanImage(dirty);
    assert.deepEqual([clean.kind, clean.type, clean.width, clean.height], ['png', 'image/png', 3, 2]);
    for (const secret of ['Secret Lane', 'secret', 'eXIf', 'tEXt', 'iCCP', '<script>']) assert.ok(!has(clean.bytes, secret), secret);
    assert.deepEqual(pngSize(clean.bytes), { width: 3, height: 2 });
    assert.deepEqual(cleanImage(clean.bytes).bytes, clean.bytes, 'cleaning is idempotent');
    const broken = Buffer.from(dirty);
    broken[40] ^= 0xff;
    assert.throws(() => cleanImage(broken), ImageError);
    assert.throws(() => cleanImage(png(5000, 10)), /4096 pixels/);
    assert.throws(() => cleanImage(png(4, 4, { before: [chunk('acTL', Buffer.alloc(8))] })), /still picture/);
    assert.throws(() => cleanImage(png(4, 4).subarray(0, 40)), ImageError);
  });

  await t.test('JPEG: EXIF, XMP, ICC and comments go, orientation and the picture stay', () => {
    const dirty = jpeg();
    assert.equal(sniff(dirty), 'jpeg');
    const clean = cleanImage(dirty);
    assert.deepEqual([clean.kind, clean.width, clean.height], ['jpeg', 20, 10]);
    for (const secret of ['Secret Lane', 'secret-xmp', 'xmpmeta', 'ICC_PROFILE', 'secret comment', 'JFIF', '<script>']) assert.ok(!has(clean.bytes, secret), secret);
    assert.ok(has(clean.bytes, 'Adobe'), 'the Adobe colour marker stays');
    // The rebuilt EXIF holds only orientation 6 (big-endian SHORT).
    assert.ok(clean.bytes.includes(Buffer.from([0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06])));
    // Tables, frame and scan data, including stuffed bytes and restart markers, are copied exactly.
    assert.ok(clean.bytes.includes(Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78, 0xff, 0xd9])));
    assert.deepEqual([...clean.bytes.subarray(-2)], [0xff, 0xd9]);
    assert.ok(!cleanImage(jpeg({ orientation: 1 })).bytes.includes(Buffer.from('Exif', 'latin1')), 'no EXIF at all when upright');
    assert.throws(() => cleanImage(jpeg({ width: 5000 })), /4096 pixels/);
    assert.throws(() => cleanImage(dirty.subarray(0, 120)), ImageError);
  });

  await t.test('WebP: ICC, EXIF and XMP chunks and flags go, the picture stays', () => {
    assert.deepEqual(cleanImage(WEBP).bytes, WEBP);
    const dirty = webpExtended();
    const clean = cleanImage(dirty);
    assert.deepEqual([clean.kind, clean.width, clean.height], ['webp', 1, 1]);
    for (const secret of ['icc-secret', 'ICCP', 'EXIF', 'XMP ', 'secret-xmp']) assert.ok(!has(clean.bytes, secret), secret);
    assert.equal(clean.bytes.readUInt32LE(4), clean.bytes.length - 8, 'RIFF size matches');
    assert.equal(clean.bytes[20] & (0x20 | 0x08 | 0x04), 0, 'metadata flags cleared');
    assert.ok(clean.bytes.includes(WEBP.subarray(12)), 'the VP8L picture is untouched');
    assert.throws(() => cleanImage(webpExtended({ flags: 0x02 })), /still picture/);
    assert.throws(() => cleanImage(webpExtended({ flags: 0, extra: [riffChunk('ANIM', Buffer.alloc(6))] })), /still picture/);
  });

  await t.test('anything else is refused, whatever it claims to be', () => {
    for (const bytes of [Buffer.from('GIF89a........'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from('BM....'), Buffer.alloc(0)]) {
      assert.throws(() => cleanImage(bytes), /PNG, JPEG or WebP/);
    }
    assert.throws(() => cleanImage(Buffer.concat([png(2, 2), Buffer.alloc(2 * 1024 * 1024)])), /under 2 MB/);
  });

  await t.test('icons must be PNGs of the exact size', () => {
    assert.ok(cleanIcon(png(192, 192, { before: [text('Author', 'x')] }), 192).length > 0);
    assert.ok(!has(cleanIcon(png(192, 192, { before: [text('Author', 'x')] }), 192), 'Author'));
    assert.throws(() => cleanIcon(png(191, 192), 192), /192 x 192/);
    assert.throws(() => cleanIcon(jpeg(), 192), /PNG/);
  });
});

const SPEC = { v: 1, shape: 'star', bg: '#FF6FB5', text: { value: 'RUBY', font: 'bangers' }, stickers: [{ id: 'crown' }], effects: { outline: true } };

test('badge, picture and icon routes: staff-only writes, content-hash files, gated reads', { timeout: 30000 }, async t => {
  const install = await startInstall(t);
  const parent = await install.login(PARENT);
  const auth = { 'x-kid-email': parent.email, 'x-kid-token': parent.t };
  const brandDir = join(install.dir, 'data/brand');
  const put = (path, body, headers = auth, method = 'PUT') => fetch(install.origin + path, {
    method, headers: { ...headers, ...(Buffer.isBuffer(body) ? { 'content-type': 'application/octet-stream' } : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  const settingPublic = value => install.db.prepare(`INSERT INTO settings (key,value,updated) VALUES ('kids_public',?,0)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(value));
  let badgeUrl;

  await t.test('only staff can write', async () => {
    const writes = [
      ['/api/admin/channels/1/badge', { spec: SPEC }], ['/api/admin/brand/badge', { spec: SPEC }],
      ['/api/admin/channels/1/image', png(4, 4)], ['/api/admin/brand/icons/192', png(192, 192)],
    ];
    for (const [path, body] of writes) {
      assert.equal((await put(path, body, {})).status, 403, `${path} signed out`);
      assert.equal((await put(path, body, { 'x-kid-email': parent.email, 'x-kid-token': '1.bad' })).status, 403, `${path} bad token`);
    }
    // A kid account (a creator, not staff) is refused too, even with a valid session.
    install.db.prepare("UPDATE accounts SET role='kid' WHERE email=?").run(parent.email);
    for (const [path, body] of writes) assert.equal((await put(path, body)).status, 403, `${path} as a kid`);
    assert.equal((await put('/api/admin/channels/1/image', undefined, auth, 'DELETE')).status, 403);
    assert.equal((await fetch(install.origin + '/api/admin/channels/1/badge', { headers: auth })).status, 403);
    install.db.prepare("UPDATE accounts SET role='super' WHERE email=?").run(parent.email);
    assert.deepEqual(readdirSync(join(brandDir, 'channels')), [], 'nothing was written');
  });

  await t.test('a badge is saved as its spec and drawn by the server, never from client SVG', async () => {
    const response = await put('/api/admin/channels/1/badge', { spec: SPEC, svg: '<svg onload="alert(1)"/>' });
    assert.equal(response.status, 200);
    const saved = await response.json();
    const expected = renderSpec(SPEC);
    assert.equal(saved.svg, expected.svg);
    assert.deepEqual(saved.spec, expected.spec);
    assert.match(saved.url, /^\/brand\/channels\/1\/badge-[a-f0-9]{16}\.svg$/);
    const row = install.db.prepare('SELECT badge, logo_rev FROM channels WHERE id=1').get();
    assert.deepEqual(JSON.parse(row.badge), expected.spec);
    assert.equal(row.logo_rev, 1);
    assert.equal(saved.logoUrl, '/brand/main.svg?v=1');
    const file = await fetch(install.origin + saved.url);
    assert.equal(file.status, 200);
    assert.equal(await file.text(), expected.svg);
    assert.equal(file.headers.get('content-type'), 'image/svg+xml');
    assert.equal(file.headers.get('content-security-policy'), "default-src 'none'");
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(file.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal((await fetch(install.origin + saved.url, { headers: { 'if-none-match': file.headers.get('etag') } })).status, 304);
    const alias = await fetch(install.origin + saved.logoUrl);
    assert.equal(await alias.text(), expected.svg);
    assert.equal(alias.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal((await fetch(install.origin + '/brand/main.svg')).headers.get('cache-control'), 'public, no-cache');
    const info = await (await fetch(install.origin + '/api/admin/channels/1/badge', { headers: auth })).json();
    assert.deepEqual([info.spec, info.url, info.imageUrl], [expected.spec, saved.url, null]);
    const logged = install.db.prepare("SELECT actor, kind, subject FROM activity WHERE kind='badge'").get();
    assert.deepEqual({ ...logged }, { actor: parent.email, kind: 'badge', subject: 'channel:1' });
    badgeUrl = saved.url;
  });

  await t.test('bad specs and unknown channels are refused', async () => {
    for (const spec of [{ v: 1, shape: 'cassette' }, { v: 1, text: { value: '<script>alert(1)</script>' } }, { v: 1, onload: 'x' }, '<svg/>', null]) {
      const response = await put('/api/admin/channels/1/badge', { spec });
      assert.equal(response.status, 400, JSON.stringify(spec));
      assert.equal((await response.json()).ok, false);
    }
    assert.equal((await put('/api/admin/channels/99/badge', { spec: SPEC })).status, 404);
    assert.equal((await put('/api/admin/channels/0/badge', { spec: SPEC })).status, 404);
    assert.equal((await put('/api/admin/channels/1/badge', Buffer.from('{not json'))).status, 400);
    assert.equal((await put('/api/admin/channels/1/badge', { spec: SPEC, pad: 'x'.repeat(20000) })).status, 413);
  });

  await t.test('a replaced badge removes the old revision', async () => {
    const saved = await (await put('/api/admin/channels/1/badge', { spec: { ...SPEC, bg: '#4DB8FF' } })).json();
    assert.notEqual(saved.url, badgeUrl);
    assert.equal(saved.logoUrl, '/brand/main.svg?v=2');
    assert.deepEqual(readdirSync(join(brandDir, 'channels/1')).sort(), ['index.json', saved.url.split('/').pop()].sort());
    assert.equal((await fetch(install.origin + badgeUrl)).status, 404);
    // The old logo URL still answers, but only the current revision may be cached forever.
    assert.equal((await fetch(install.origin + '/brand/main.svg?v=1')).headers.get('cache-control'), 'public, no-cache');
    badgeUrl = saved.url;
  });

  await t.test('pictures are cleaned, stored by hash, replaced and deleted', async () => {
    const first = await (await put('/api/admin/channels/1/image', png(6, 4, { before: [text('GPS', 'Secret Lane')] }))).json();
    assert.equal(first.ok, true);
    assert.match(first.url, /^\/brand\/channels\/1\/image-[a-f0-9]{16}\.png$/);
    const stored = Buffer.from(await (await fetch(install.origin + first.url)).arrayBuffer());
    assert.ok(!has(stored, 'Secret Lane'));
    assert.deepEqual(pngSize(stored), { width: 6, height: 4 });
    const second = await (await put('/api/admin/channels/1/image', jpeg())).json();
    assert.match(second.url, /\.jpg$/);
    const photo = await fetch(install.origin + second.url);
    assert.equal(photo.headers.get('content-type'), 'image/jpeg');
    assert.ok(!has(Buffer.from(await photo.arrayBuffer()), 'Secret Lane'));
    assert.equal((await fetch(install.origin + first.url)).status, 404, 'old revision removed');
    assert.equal((await put('/api/admin/channels/1/image', Buffer.from('GIF89a......'))).status, 400);
    assert.equal((await put('/api/admin/channels/1/image', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).status, 400);
    assert.equal((await put('/api/admin/channels/1/image', Buffer.alloc(2 * 1024 * 1024 + 1))).status, 413);
    assert.equal((await put('/api/admin/channels/1/image', undefined, auth, 'DELETE')).status, 200);
    assert.equal((await fetch(install.origin + second.url)).status, 404);
    assert.deepEqual(readdirSync(join(brandDir, 'channels/1')).filter(name => name.startsWith('image-')), []);
  });

  await t.test('the family badge and home-screen icons', async () => {
    const saved = await (await put('/api/admin/brand/badge', { spec: SPEC })).json();
    assert.match(saved.url, /^\/brand\/family\/badge-[a-f0-9]{16}\.svg$/);
    assert.deepEqual((await (await fetch(install.origin + '/api/site')).json()).badge, saved.spec, 'the spec reaches /api/site');
    for (const [variant, side] of [['192', 192], ['512', 512], ['maskable-512', 512], ['apple-180', 180]]) {
      const response = await put(`/api/admin/brand/icons/${variant}`, png(side, side, { before: [text('Software', 'x')] }));
      const icon = await response.json();
      assert.equal(response.status, 200, variant);
      assert.match(icon.url, new RegExp(`^/brand/family/icon-${variant}-[a-f0-9]{16}\\.png$`));
      const file = Buffer.from(await (await fetch(install.origin + icon.url)).arrayBuffer());
      assert.deepEqual(pngSize(file), { width: side, height: side });
      assert.ok(!has(file, 'Software'));
    }
    assert.equal((await put('/api/admin/brand/icons/512', png(192, 192))).status, 400);
    assert.equal((await put('/api/admin/brand/icons/1024', png(1024, 1024))).status, 404);
    assert.equal((await put('/api/admin/brand/icons/192', jpeg())).status, 400);
    const family = await (await fetch(install.origin + '/api/admin/brand', { headers: auth })).json();
    assert.equal(family.badge, saved.url);
    assert.deepEqual(Object.keys(family.icons), ['192', '512', 'maskable-512', 'apple-180']);
    assert.ok(Object.values(family.icons).every(Boolean));
    assert.equal(await (await fetch(install.origin + '/brand/family.svg')).text(), saved.svg);
  });

  await t.test('kids_public on: kid badges are public; off: they need the viewer cookie, the family badge stays public', async () => {
    settingPublic(true);
    assert.equal((await fetch(install.origin + badgeUrl)).status, 200);
    assert.equal((await fetch(install.origin + '/brand/main.svg')).status, 200);
    settingPublic(false);
    for (const path of [badgeUrl, '/brand/main.svg', '/brand/main.svg?v=2', '/brand/channels/1/nothing.svg', '/brand/nobody.svg']) {
      const response = await fetch(install.origin + path);
      assert.equal(response.status, 401, path);
      assert.ok(!(await response.text()).includes('<svg'), path);
    }
    const signedIn = await fetch(install.origin + badgeUrl, { headers: { cookie: parent.cookie } });
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.headers.get('cache-control'), 'private, max-age=31536000, immutable');
    assert.equal((await fetch(install.origin + '/brand/main.svg', { headers: { cookie: parent.cookie } })).status, 200);
    const family = await (await fetch(install.origin + '/api/admin/brand', { headers: auth })).json();
    assert.equal((await fetch(install.origin + family.badge)).status, 200);
    assert.equal((await fetch(install.origin + family.icons['192'])).status, 200);
    assert.equal((await fetch(install.origin + '/brand/family.svg')).status, 200);
    settingPublic(true);
  });

  await t.test('path traversal and unknown names are refused', async () => {
    const name = badgeUrl.split('/').pop();
    for (const path of [
      '/brand/channels/1/index.json', '/brand/family/index.json', '/brand/channels/1/..%2F..%2Fkidtube.sqlite',
      '/brand/channels/..%2F..%2Fkidtube.sqlite/x', '/brand/family/..%2F..%2Fsecret', '/brand/%2e%2e/%2e%2e/server/index.mjs',
      `/brand/channels/01/${name}`, `/brand/channels/1/${name}%00.png`, `/brand/channels/1/${name.toUpperCase()}`,
      `/brand/channels/1/x/${name}`, '/brand/channels/1', '/brand/..%2Fkidtube.sqlite', '/brand/main', '/brand/family',
    ]) {
      const response = await fetch(install.origin + path);
      assert.ok([400, 404].includes(response.status), `${path} → ${response.status}`);
      const body = await response.text();
      assert.ok(!body.includes('SQLite') && !body.includes('import '), path);
    }
    for (const path of ['/api/admin/channels/..%2F1/badge', '/api/admin/channels/1%2F..%2F2/badge', '/api/admin/channels/-1/badge', '/api/admin/brand/icons/..%2F192']) {
      assert.equal((await put(path, { spec: SPEC })).status, 404, path);
    }
    assert.equal((await fetch(install.origin + badgeUrl, { method: 'POST' })).status, 405);
  });
});
