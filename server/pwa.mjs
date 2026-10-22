// The home-screen app: GET /manifest.webmanifest from the family's settings and badge, the Apple touch
// icon, and GET /sw.js, a service worker built once at boot around the current shell files.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { BRAND_NAME, DEFAULT_ACCENT, TAGLINE } from './brand.mjs';

const BACKGROUND = '#05060A';
const SHORT_NAME = 12;
const DEFAULT_ICONS = {
  192: '/assets/icons/icon-192.png',
  512: '/assets/icons/icon-512.png',
  'maskable-512': '/assets/icons/icon-maskable-512.png',
  'apple-180': '/assets/icons/apple-touch-icon.png',
};
// The pages whose styles, scripts and preloaded fonts make up the shell the worker keeps.
const SHELL_PAGES = ['/index.html', '/offline.html'];
const SHELL_FILE = /\.(?:css|js|mjs|woff2|svg|png|webp)$/i;
const REFERENCE = /\b(?:src|href)="(\/[^"#]*)"/g;
const WORKER = resolve(import.meta.dirname, 'pwa-worker.js');

const sha = value => createHash('sha256').update(value).digest('hex');

// Home screens cut long names off, so a long family name keeps its leading words that fit.
export function shortName(name) {
  const words = String(name).replace(/\s+/g, ' ').trim().split(' ');
  let short = '';
  for (const word of words) {
    const next = short ? `${short} ${word}` : word;
    if ([...next].length > SHORT_NAME) break;
    short = next;
  }
  return short || [...words[0]].slice(0, SHORT_NAME).join('');
}

// family: what createBrandFiles().family() returns; its icons are null until a parent saves a badge.
export function buildManifest(site, family) {
  const name = site.site_name?.trim() || BRAND_NAME;
  const own = family?.icons || {};
  const icons = own[192] && own[512]
    ? [
      { src: own[192], sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: own[512], sizes: '512x512', type: 'image/png', purpose: 'any' },
      ...own['maskable-512'] ? [{ src: own['maskable-512'], sizes: '512x512', type: 'image/png', purpose: 'maskable' }] : [],
    ]
    : [
      { src: DEFAULT_ICONS[192], sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: DEFAULT_ICONS[512], sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: DEFAULT_ICONS['maskable-512'], sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ];
  return {
    id: '/',
    name,
    short_name: shortName(name),
    description: site.site_tagline || TAGLINE,
    lang: 'en',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    background_color: BACKGROUND,
    theme_color: /^#[0-9a-f]{6}$/i.test(site.family_accent || '') ? site.family_accent : DEFAULT_ACCENT,
    icons,
  };
}

// The worker's text: the shell list and a version that changes whenever any shell file does.
export function buildWorker({ publicDir, pageHtml }) {
  const root = resolve(publicDir);
  const urls = new Set(['/offline.html']);
  for (const page of SHELL_PAGES) {
    for (const [, reference] of pageHtml(page).matchAll(REFERENCE)) {
      const path = reference.split('?')[0];
      if (SHELL_FILE.test(path) && existsSync(join(root, path))) urls.add(reference);
    }
  }
  for (const icon of [DEFAULT_ICONS[192], DEFAULT_ICONS[512]]) if (existsSync(join(root, icon))) urls.add(icon);
  const list = [...urls].sort();
  // Files without a ?v= stamp (fonts, icons, the offline page) are matched by path.
  const paths = list.filter(url => !url.includes('?'));
  const template = readFileSync(WORKER, 'utf8');
  // Versioned URLs carry their content hash already; the rest are hashed here.
  const contents = list.map(url => url.includes('?v=') ? url
    : url.endsWith('.html') ? sha(pageHtml(url)) : sha(readFileSync(join(root, url))));
  const version = sha(template + JSON.stringify(contents)).slice(0, 12);
  const source = [
    `const SW_VERSION = ${JSON.stringify(version)};`,
    `const SW_SHELL = ${JSON.stringify(paths)};`,
    `const SW_SHELL_URLS = ${JSON.stringify(list)};`,
    template,
  ].join('\n');
  return { version, urls: list, source };
}

export function createPwa({ settings, brandFiles, dataDir, publicDir, pageHtml }) {
  const worker = buildWorker({ publicDir, pageHtml });

  function send(req, res, type, body) {
    res.writeHead(200, {
      'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Length': String(body.length),
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  async function manifest() {
    return buildManifest(settings.all(), await brandFiles.family());
  }

  // iOS asks for /apple-touch-icon.png on its own as well as through the <link>.
  async function appleIcon() {
    const own = (await brandFiles.family()).icons['apple-180'];
    if (own) {
      const bytes = await readFile(join(dataDir, 'brand', 'family', basename(own))).catch(() => null);
      if (bytes) return bytes;
    }
    return readFile(join(resolve(publicDir), DEFAULT_ICONS['apple-180']));
  }

  // Answers and returns true for the routes this module owns.
  function handle(req, res, pathname) {
    const route = pathname === '/manifest.webmanifest' ? 'manifest'
      : pathname === '/sw.js' ? 'worker'
        : ['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'].includes(pathname) ? 'apple' : null;
    if (!route) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return true; }
    if (route === 'worker') {
      res.setHeader('Content-Security-Policy', "default-src 'self'");
      send(req, res, 'text/javascript; charset=utf-8', Buffer.from(worker.source));
      return true;
    }
    const task = route === 'manifest'
      ? manifest().then(value => send(req, res, 'application/manifest+json; charset=utf-8', Buffer.from(JSON.stringify(value))))
      : appleIcon().then(bytes => send(req, res, 'image/png', bytes));
    task.catch(error => {
      console.error('Home-screen file failed', error);
      if (!res.headersSent) res.writeHead(500).end(); else res.destroy(error);
    });
    return true;
  }

  return { handle, manifest, worker };
}
