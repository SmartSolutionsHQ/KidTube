import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { BRAND_NAME, DEFAULT_ACCENT } from '../server/brand.mjs';
import { buildManifest, buildWorker, shortName } from '../server/pwa.mjs';
import { startInstall, ROOT } from './helpers.mjs';
import { join } from 'node:path';

const ORIGIN = 'https://tapes.example.com';
const NO_ICONS = { badge: null, icons: { 192: null, 512: null, 'maskable-512': null, 'apple-180': null } };

// Runs the served worker text in a sandbox with a pretend worker global, so the test exercises the
// exact file a browser gets.
function loadWorker(source, origin = ORIGIN) {
  const handlers = {};
  const context = vm.createContext({
    URL, Headers, console,
    // Answers handed to respondWith() are never awaited here; these keep them quiet.
    caches: { open: async () => ({ match: async () => null, put: async () => {} }), match: async () => null },
    fetch: async () => ({ status: 200, type: 'basic', clone() { return this; } }),
    self: { addEventListener: (type, fn) => { handlers[type] = fn; }, location: { origin } },
  });
  vm.runInContext(source, context);
  const fetchEvent = (path, init = {}) => {
    let responded = false;
    const headers = new Headers(init.headers || {});
    handlers.fetch({
      request: { method: init.method || 'GET', url: new URL(path, origin).href, mode: init.mode || 'no-cors', destination: init.destination || '', headers },
      respondWith: () => { responded = true; },
    });
    return responded;
  };
  return { decide: (request) => context.swDecision({ method: 'GET', mode: 'no-cors', destination: '', range: '', ...request }, origin), fetchEvent, context };
}

test('a long family name keeps the leading words that fit in 12 characters', () => {
  assert.equal(shortName('Okafor'), 'Okafor');
  assert.equal(shortName('The Rivera Family Tapes'), 'The Rivera');
  assert.equal(shortName('  Juni   and  Bram '), 'Juni and');
  assert.equal(shortName('Supercalifragilistic Tapes'), 'Supercalifra');
  for (const name of ['Okafor', 'The Rivera Family Tapes', 'Ünïcödé Fämïly Tåpes 🎞️', BRAND_NAME]) {
    assert.ok([...shortName(name)].length <= 12, name);
  }
});

test('the manifest comes from the family settings, with the default icons until a badge is saved', () => {
  const manifest = buildManifest({ site_name: 'The Okafor Family Tapes', site_tagline: 'Tobi and Ada make things.', family_accent: '#4DB8FF' }, NO_ICONS);
  assert.equal(manifest.name, 'The Okafor Family Tapes');
  assert.equal(manifest.short_name, 'The Okafor');
  assert.equal(manifest.description, 'Tobi and Ada make things.');
  assert.equal(manifest.start_url, '/?source=pwa');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#05060A');
  assert.equal(manifest.theme_color, '#4DB8FF');
  assert.deepEqual(manifest.icons.map(icon => [icon.src, icon.sizes, icon.purpose]), [
    ['/assets/icons/icon-192.png', '192x192', 'any'],
    ['/assets/icons/icon-512.png', '512x512', 'any'],
    ['/assets/icons/icon-maskable-512.png', '512x512', 'maskable'],
  ]);

  const unnamed = buildManifest({ site_name: '', family_accent: 'not a colour' }, NO_ICONS);
  assert.equal(unnamed.name, BRAND_NAME, 'an unnamed family falls back to the product name');
  assert.equal(unnamed.theme_color, DEFAULT_ACCENT);

  const badged = buildManifest({ site_name: 'Okafor' }, {
    badge: '/brand/family/badge-0123456789abcdef.svg',
    icons: { 192: '/brand/family/icon-192-aaaaaaaaaaaaaaaa.png', 512: '/brand/family/icon-512-bbbbbbbbbbbbbbbb.png', 'maskable-512': '/brand/family/icon-maskable-512-cccccccccccccccc.png', 'apple-180': null },
  });
  assert.deepEqual(badged.icons.map(icon => icon.src), [
    '/brand/family/icon-192-aaaaaaaaaaaaaaaa.png', '/brand/family/icon-512-bbbbbbbbbbbbbbbb.png', '/brand/family/icon-maskable-512-cccccccccccccccc.png',
  ]);
});

test('the service worker leaves the API, kids\' badges, ranges and media alone', () => {
  const pageHtml = () => '<link href="/css/base.css?v=0123456789ab"><script src="/js/shell/app.js?v=ba9876543210"></script>'
    + '<link rel="preload" href="/fonts/anton/anton-400.woff2"><link rel="manifest" href="/manifest.webmanifest">';
  const { source } = buildWorker({ publicDir: join(ROOT, 'public'), pageHtml });
  const { decide } = loadWorker(source);

  for (const path of ['/api/clips', '/api/clips?channel=tobi', '/api/video/abc', '/api/video/abc/poster', '/api/me', '/api/admin/summary', '/api']) {
    assert.equal(decide({ url: ORIGIN + path }), 'skip', path);
    assert.equal(decide({ url: ORIGIN + path, mode: 'navigate' }), 'skip', `${path} opened as a page`);
  }
  assert.equal(decide({ url: ORIGIN + '/brand/channels/2/badge-0123456789abcdef.svg' }), 'skip');
  assert.equal(decide({ url: ORIGIN + '/brand/tobi.svg?v=3' }), 'skip');
  assert.equal(decide({ url: ORIGIN + '/css/base.css?v=0123456789ab', range: 'bytes=0-' }), 'skip', 'a Range request');
  assert.equal(decide({ url: ORIGIN + '/somewhere', destination: 'video' }), 'skip', 'a video element');
  assert.equal(decide({ url: ORIGIN + '/somewhere', destination: 'audio' }), 'skip', 'an audio element');
  for (const path of ['/clip.mp4', '/clip.webm', '/clip.MOV', '/themes/ember-tape/sounds/sting.mp3']) assert.equal(decide({ url: ORIGIN + path }), 'skip', path);
  assert.equal(decide({ url: ORIGIN + '/', method: 'POST', mode: 'navigate' }), 'skip', 'not a GET');
  assert.equal(decide({ url: ORIGIN + '/', method: 'HEAD' }), 'skip');
  assert.equal(decide({ url: 'https://elsewhere.example/css/base.css?v=0123456789ab' }), 'skip', 'another site');
  assert.equal(decide({ url: ORIGIN + '/sw.js' }), 'skip');
  assert.equal(decide({ url: ORIGIN + '/manifest.webmanifest' }), 'skip');

  assert.equal(decide({ url: ORIGIN + '/', mode: 'navigate' }), 'network-first');
  assert.equal(decide({ url: ORIGIN + '/parents', mode: 'navigate' }), 'network-first');
  assert.equal(decide({ url: ORIGIN + '/css/base.css?v=0123456789ab' }), 'cache-first');
  assert.equal(decide({ url: ORIGIN + '/themes/arcade-crt/splash.js?v=0123456789ab' }), 'cache-first');
  assert.equal(decide({ url: ORIGIN + '/fonts/anton/anton-400.woff2' }), 'cache-first', 'a shell font');
  assert.equal(decide({ url: ORIGIN + '/js/parent/home.js' }), 'skip', 'an unversioned module revalidates on its own');
});

test('the worker\'s fetch handler never answers for the API, video or a Range request', () => {
  const { source } = buildWorker({ publicDir: join(ROOT, 'public'), pageHtml: () => '<link href="/css/base.css?v=0123456789ab">' });
  const { fetchEvent } = loadWorker(source);
  assert.equal(fetchEvent('/api/clips', { mode: 'cors' }), false);
  assert.equal(fetchEvent('/api/video/abc', { destination: 'video', headers: { range: 'bytes=0-' } }), false);
  assert.equal(fetchEvent('/css/base.css?v=0123456789ab', { headers: { range: 'bytes=10-20' } }), false);
  assert.equal(fetchEvent('/api/clips', { method: 'POST' }), false);
  assert.equal(fetchEvent('/css/base.css?v=0123456789ab'), true);
  assert.equal(fetchEvent('/', { mode: 'navigate' }), true);
});

test('the worker\'s version follows the shell files', () => {
  const publicDir = join(ROOT, 'public');
  const one = buildWorker({ publicDir, pageHtml: () => '<link href="/css/base.css?v=0123456789ab">' });
  const same = buildWorker({ publicDir, pageHtml: () => '<link href="/css/base.css?v=0123456789ab">' });
  const changed = buildWorker({ publicDir, pageHtml: () => '<link href="/css/base.css?v=fedcba987654">' });
  assert.equal(one.version, same.version);
  assert.notEqual(one.version, changed.version);
  assert.match(one.version, /^[0-9a-f]{12}$/);
});

test('the served manifest, Apple icon and worker', async t => {
  const app = await startInstall(t, { SITE_NAME: 'The Okafor Family Tapes', FAMILY_ACCENT: '#4DB8FF' });

  const manifestResponse = await app.call('/manifest.webmanifest');
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers.get('content-type'), /^application\/manifest\+json/);
  assert.equal(manifestResponse.headers.get('cache-control'), 'no-cache');
  const manifest = await manifestResponse.json();
  assert.equal(manifest.name, 'The Okafor Family Tapes');
  assert.equal(manifest.short_name, 'The Okafor');
  assert.equal(manifest.theme_color, '#4DB8FF');
  for (const icon of manifest.icons) {
    const response = await app.call(icon.src);
    assert.equal(response.status, 200, icon.src);
    assert.equal(response.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.readUInt32BE(16), Number(icon.sizes.split('x')[0]), `${icon.src} is ${icon.sizes}`);
  }

  const apple = await app.call('/apple-touch-icon.png');
  assert.equal(apple.status, 200);
  assert.equal(Buffer.from(await apple.arrayBuffer()).readUInt32BE(16), 180);

  const worker = await app.call('/sw.js');
  assert.equal(worker.status, 200);
  assert.match(worker.headers.get('content-type'), /^text\/javascript/);
  assert.equal(worker.headers.get('cache-control'), 'no-cache');
  const source = await worker.text();
  const { context, decide } = loadWorker(source, app.origin);
  const shell = [...vm.runInContext('SW_SHELL_URLS', context)];
  assert.ok(shell.includes('/offline.html'));
  assert.ok(shell.some(url => /^\/css\/base\.css\?v=[0-9a-f]{12}$/.test(url)), 'stylesheets are listed by their stamped URL');
  assert.ok(shell.some(url => /^\/js\/shell\/app\.js\?v=[0-9a-f]{12}$/.test(url)));
  for (const url of shell) {
    assert.doesNotMatch(url, /^\/(?:api|brand|uploads)\b|\.(?:mp4|webm|mov|mp3)$/i, `${url} is shell, not private`);
    assert.equal(decide({ url: app.origin + url }), 'cache-first', `${url} is served from the cache`);
    assert.equal((await app.call(url)).status, 200, `${url} exists`);
  }
  assert.equal((await app.call('/sw.js', { method: 'POST', body: {} })).status, 405);

  // Pages point at the manifest and the Apple icon; the install page is served at /install.
  for (const path of ['/', '/parents', '/about', '/install']) {
    const html = await (await app.call(path)).text();
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/, path);
    assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/, path);
  }
  const offline = await app.call('/offline.html');
  assert.equal(offline.status, 200);
  assert.match(await offline.text(), /You're offline/);
});

