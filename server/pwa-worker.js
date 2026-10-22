/* The service worker. server/pwa.mjs serves it at /sw.js with SW_VERSION and SW_SHELL defined above
   this text. It keeps the app's shell (pages' styles, scripts, fonts and icons) so the home-screen app
   opens fast, and shows a calm offline page when the family's box can't be reached. It never stores
   anything private: no API answers, no videos, no posters, no kids' badges. */
const SHELL_CACHE = 'kt-shell-' + SW_VERSION;
const OFFLINE_PAGE = '/offline.html';
const MEDIA = /\.(?:mp4|m4v|webm|mov|mkv|mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;
const VERSIONED = /\.(?:css|js|mjs|json|svg|png|webp|woff2)$/i;

// What to do with a request: 'skip' (the browser handles it, nothing is stored), 'cache-first' or
// 'network-first'. Kept free of worker APIs so a test can run it on plain objects.
// request: { method, url, mode, destination, range } where range is the Range header or ''.
function swDecision(request, origin) {
  if (request.method !== 'GET') return 'skip';
  let url;
  try { url = new URL(request.url); } catch { return 'skip'; }
  if (url.origin !== origin) return 'skip';
  if (request.range) return 'skip';
  const path = url.pathname;
  if (path === '/api' || path.startsWith('/api/')) return 'skip';
  if (path.startsWith('/brand/') || path.startsWith('/uploads/') || path.startsWith('/media/')) return 'skip';
  if (path === '/sw.js' || path === '/manifest.webmanifest' || path === '/apple-touch-icon.png') return 'skip';
  if (['video', 'audio', 'track'].includes(request.destination) || MEDIA.test(path)) return 'skip';
  if (request.mode === 'navigate') return 'network-first';
  if (url.searchParams.has('v') && VERSIONED.test(path)) return 'cache-first';
  if (SW_SHELL.includes(path)) return 'cache-first';
  return 'skip';
}

function describe(request) {
  return {
    method: request.method, url: request.url, mode: request.mode, destination: request.destination,
    range: request.headers.get('range') || '',
  };
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  // Only whole, ordinary, same-origin answers are kept.
  if (response.status === 200 && response.type === 'basic') cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const offline = await caches.match(OFFLINE_PAGE);
    if (offline) return offline;
    throw error;
  }
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('install', event => {
    event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SW_SHELL_URLS)).then(() => self.skipWaiting()));
  });

  self.addEventListener('activate', event => {
    event.waitUntil(caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('kt-') && key !== SHELL_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()));
  });

  self.addEventListener('fetch', event => {
    const decision = swDecision(describe(event.request), self.location.origin);
    if (decision === 'cache-first') event.respondWith(cacheFirst(event.request));
    else if (decision === 'network-first') event.respondWith(networkFirst(event.request));
  });
}
