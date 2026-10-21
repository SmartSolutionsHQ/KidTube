// The page chrome every screen shares: the family's name, tagline and accent from one GET /api/site,
// and the header wordmark that slides in on entering a channel and folds back to the mark.
//
// Markup hooks:
//   [data-site="name"]     the family's site name, or the product name until the family sets one
//   [data-site="tagline"]  the family's tagline
//   body[data-title]       a page label for document.title ("About" → "About · <name>")
//   .tz-brand              the header brand: .tz-mark (holds an <img>) and .tz-word (the name)
//
// Importing this module in Node (the tests do) has no side effects; it only wires the page when a
// document exists.

const SNAPSHOT_KEY = 'kid-site';
const ACCENT = /^#[0-9a-f]{6}$/i;
// How long the channel name stays out after entering, before it folds back to the mark.
export const WORDMARK_HOLD_MS = 5000;

let pending = null;

// The name a page shows: the family's own name when they set one, otherwise the product's.
export function displayName(site) {
  const own = typeof site?.siteName === 'string' ? site.siteName.trim() : '';
  return own || (typeof site?.brand?.name === 'string' ? site.brand.name : '');
}

export function safeAccent(value) {
  return typeof value === 'string' && ACCENT.test(value) ? value.toUpperCase() : null;
}

// Badges are served by this site; anything else (another host, a data: or javascript: URL) is ignored.
export function safeLogo(value) {
  return typeof value === 'string' && /^\/(?!\/)[\w\-./?=&%]*$/.test(value) && !value.includes('..') ? value : null;
}

export function pageTitle({ name, tagline }, label = '') {
  if (label) return name ? `${label} · ${name}` : label;
  return [name, tagline].filter(Boolean).join(' — ');
}

// Only what the chrome needs is kept between pages, never the channel list.
export function snapshot(site) {
  return { siteName: displayName(site), tagline: site?.tagline || '', accent: safeAccent(site?.accent) };
}

function readSnapshot() {
  try { return JSON.parse(sessionStorage.getItem(SNAPSHOT_KEY) || 'null'); } catch { return null; }
}

function writeSnapshot(site) {
  try { sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot(site))); } catch {}
}

// One request per page load; every caller shares it. Resolves to null when the server can't be reached.
export function loadSite() {
  pending ||= fetch('/api/site', { credentials: 'same-origin', headers: { accept: 'application/json' } })
    .then(response => (response.ok ? response.json() : null))
    .then(site => (site?.ok ? site : null))
    .catch(() => null);
  return pending;
}

export function applySite(site, doc = document) {
  if (!site) return;
  const name = displayName(site);
  const tagline = typeof site.tagline === 'string' ? site.tagline : '';
  for (const slot of doc.querySelectorAll('[data-site="name"]')) if (name) slot.textContent = name;
  for (const slot of doc.querySelectorAll('[data-site="tagline"]')) if (tagline) slot.textContent = tagline;
  if (name) doc.title = pageTitle({ name, tagline }, doc.body?.dataset.title || '');
  const accent = safeAccent(site.accent);
  if (accent) doc.documentElement.style.setProperty('--tz-flare', accent);
}

// The header brand ---------------------------------------------------------

let holdTimer = 0;

function brand(doc = document) {
  return doc.querySelector('.tz-brand');
}

// Slide the channel name in, then fold it back to the mark after WORDMARK_HOLD_MS. With reduced motion
// the name simply stays, so nothing moves on its own.
export function playWordmark(doc = document) {
  const root = brand(doc);
  if (!root) return;
  clearTimeout(holdTimer);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.dataset.word = 'still';
    return;
  }
  root.dataset.word = 'hidden';
  void root.offsetWidth; // restart the entrance when a new channel replaces the old one
  root.dataset.word = 'in';
  holdTimer = setTimeout(() => { root.dataset.word = 'out'; }, WORDMARK_HOLD_MS);
}

// Show a channel in the header: its name, its badge (or the mark) and its accent, then play the wordmark.
// M6 calls this when a kid's channel opens; today the whole site is one channel named after the family.
export function showChannel({ name, logoUrl, accent } = {}, doc = document) {
  const root = brand(doc);
  if (root) {
    const word = root.querySelector('.tz-word');
    if (word && name) word.textContent = name;
    const img = root.querySelector('.tz-mark img');
    if (img) {
      img.dataset.mark ||= img.getAttribute('src') || '';
      img.src = safeLogo(logoUrl) || img.dataset.mark;
    }
  }
  const color = safeAccent(accent);
  if (color) doc.documentElement.style.setProperty('--tz-flare', color);
  playWordmark(doc);
}

function wire() {
  const saved = readSnapshot();
  if (saved) applySite(saved);
  loadSite().then(site => {
    if (!site) return;
    applySite(site);
    writeSnapshot(site);
  });
  document.addEventListener('tz:enter', () => playWordmark());
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') wire();
