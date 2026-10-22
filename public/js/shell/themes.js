// Splash theme loader. Lists themes from /api/themes, loads one theme's CSS and module, mounts it
// into a host with a ctx object, and takes it down again. The contract is in docs/THEMES.md.
// Importing this file has no side effects, so the pure helpers can be tested in Node.

export const CONTRACT = 1;
export const FALLBACK_ID = 'glass-gate';
export const IMPORT_TIMEOUT_MS = 4000;
// Themes promise dismiss() within 600 ms; the loader stops waiting a little after that.
export const DISMISS_LIMIT_MS = 700;
export const DEFAULT_ACCENT = '#FF5C2B';
const INK = '#0B0C10', PAPER = '#F7F4EC';
const STORE_KEY = 'kt-always-enter';
const SVG_NS = 'http://www.w3.org/2000/svg';
const HEX = /^#[0-9a-f]{6}$/i;

// ---------- pure helpers ----------

export function cleanAccent(value, fallback = DEFAULT_ACCENT) {
  return typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toUpperCase() : fallback;
}

function luminance(hex) {
  const channel = i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// Text colour for an accent button: ink, unless paper reads clearly better on a dark accent.
export function accentInk(accent) {
  const l = luminance(cleanAccent(accent));
  return contrast(l, luminance(INK)) >= contrast(l, luminance(PAPER)) ? INK : PAPER;
}

// ?splash=0 skips the intro, ?splash=1 shows it even when "always enter" is remembered.
export function splashParam(search = '') {
  try {
    const value = new URLSearchParams(search).get('splash');
    return value === '0' || value === '1' ? value : null;
  } catch { return null; }
}

export function detectLowPower({ navigator: nav, reducedMotion = false } = {}) {
  if (reducedMotion) return true;
  if (!nav) return false;
  if (nav.connection && nav.connection.saveData === true) return true;
  return typeof nav.deviceMemory === 'number' && nav.deviceMemory < 4;
}

// Chooses the theme to mount and says why when it is not the one asked for.
export function pickTheme(registry, wanted, { lowPower = false, force = false, mode } = {}) {
  const themes = registry?.themes || [];
  const fallbackId = registry?.fallback || FALLBACK_ID;
  const fallback = themes.find(theme => theme.id === fallbackId) || null;
  const theme = themes.find(entry => entry.id === wanted);
  if (!theme) return { theme: fallback, reason: wanted ? 'missing' : 'default' };
  if (mode && Array.isArray(theme.modes) && !theme.modes.includes(mode)) return { theme: fallback, reason: 'mode' };
  if (theme.weight === 'heavy' && lowPower && !force && fallback) return { theme: fallback, reason: 'low-power' };
  return { theme, reason: 'chosen' };
}

// The feed variables a theme asks for, with "accent" filled in. app.js applies them to the feed.
export function feedVars(theme, accent) {
  const out = {};
  for (const [name, value] of Object.entries(theme?.feed || {})) {
    if (!/^--tz-[a-z-]+$/.test(name)) continue;
    out[name] = value === 'accent' ? cleanAccent(accent, theme.defaultAccent || DEFAULT_ACCENT) : value;
  }
  return out;
}

export const pad2 = value => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? String(Math.min(n, 99)).padStart(2, '0') : '01';
};

// The kid's choice to skip their intro next time, kept per channel. Storage can be missing or
// blocked (private windows, previews), which just means the intro shows.
export function alwaysEnter(slug, value, storage) {
  let store = storage;
  try { if (store === undefined) store = globalThis.localStorage; } catch { store = null; }
  if (!slug || !store) return false;
  let map = {};
  try { map = JSON.parse(store.getItem(STORE_KEY) || '{}') || {}; } catch { map = {}; }
  if (value === undefined) return map[slug] === true;
  if (value) map[slug] = true; else delete map[slug];
  try { store.setItem(STORE_KEY, JSON.stringify(map)); } catch { return false; }
  return Boolean(value);
}

// A small DOM builder for themes, so no theme needs innerHTML. "svg:" tags are made in the SVG
// namespace; on* props must be functions and are removed when the splash is dismissed.
export function createH(doc, signal) {
  return function h(tag, props, ...kids) {
    const svg = tag.startsWith('svg:');
    const el = svg ? doc.createElementNS(SVG_NS, tag.slice(4)) : doc.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith('on')) {
        if (typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value, { signal });
        continue;
      }
      if (key === 'text') el.textContent = String(value);
      else if (key === 'style' && typeof value === 'object') {
        for (const [prop, v] of Object.entries(value)) if (v !== null && v !== undefined) el.style.setProperty(prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), String(v));
      } else if (key === 'dataset' && typeof value === 'object') Object.assign(el.dataset, value);
      else if ((key === 'href' || key === 'src') && /^\s*javascript:/i.test(String(value))) continue;
      else if (key === 'srcdoc') continue;
      else el.setAttribute(key === 'className' ? 'class' : key, value === true ? '' : String(value));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(typeof kid === 'object' ? kid : String(kid));
    }
    return el;
  };
}

// ---------- browser side ----------

let registryPromise = null;
// A registry that fails or stalls past the import timeout reads as empty (so the splash falls back)
// and is not remembered, so the next call tries again.
export function loadRegistry({ refresh = false, url = '/api/themes', timeout = IMPORT_TIMEOUT_MS } = {}) {
  if (!registryPromise || refresh) {
    const empty = { contract: CONTRACT, fallback: FALLBACK_ID, themes: [], failed: true };
    const promise = fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(timeout) })
      .then(response => (response.ok ? response.json() : null))
      .then(json => (json && json.contract === CONTRACT && Array.isArray(json.themes) ? json : empty))
      .catch(() => empty);
    promise.then(json => { if (json.failed && registryPromise === promise) registryPromise = null; });
    registryPromise = promise;
  }
  return registryPromise;
}

export const prefersReducedMotion = () => {
  try { return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; } catch { return false; }
};

// The viewer's system setting always wins: a caller can ask for reduced motion, never turn it off.
const wantsReducedMotion = opts => opts.reducedMotion === true || prefersReducedMotion();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); })])
    .finally(() => clearTimeout(timer));
}

const cssLoads = new Map();
function loadCss(href, id) {
  if (cssLoads.has(href)) return cssLoads.get(href);
  const promise = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.ktThemeCss = id;
    link.onload = () => resolve();
    link.onerror = () => { cssLoads.delete(href); link.remove(); reject(new Error(`${id} stylesheet failed`)); };
    document.head.append(link);
  });
  cssLoads.set(href, promise);
  return promise;
}

const modules = new Map();
// Loads a theme's stylesheet and module together, within the import timeout.
export function loadTheme(theme, { timeout = IMPORT_TIMEOUT_MS } = {}) {
  if (!theme) return Promise.reject(new Error('no theme'));
  if (!modules.has(theme.js)) {
    const promise = withTimeout(Promise.all([loadCss(theme.css, theme.id), import(theme.js)]), timeout, theme.id)
      .then(([, mod]) => {
        if (typeof mod.mount !== 'function') throw new Error(`${theme.id} has no mount()`);
        return mod;
      });
    promise.catch(() => { modules.delete(theme.js); cssLoads.delete(theme.css); });
    modules.set(theme.js, promise);
  }
  return modules.get(theme.js);
}

let audio = null;
function audioContext() {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) return null;
  try {
    if (!audio || audio.state === 'closed') audio = new Context();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    return audio;
  } catch { return null; }
}

let baseStyle = false;
function ensureBaseStyle() {
  if (baseStyle) return;
  baseStyle = true;
  const style = document.createElement('style');
  style.dataset.ktShell = 'themes';
  style.textContent = `
/* Host rules sit in :where() so a theme's own [data-kt-theme] rules always win. */
:where(.kt-splash-host){position:fixed;inset:0;z-index:2000;overflow:hidden;background:#05060A;color:#F7F4EC;container-type:size;overscroll-behavior:contain;touch-action:manipulation;-webkit-tap-highlight-color:transparent;outline:none}
:where(.kt-frame-host){position:absolute;inset:0;overflow:hidden;container-type:size;background:#05060A;color:#F7F4EC}
:where(.kt-pause-host){position:absolute;inset:0;z-index:3;overflow:hidden;pointer-events:none;container-type:size}
[data-kt-paused],[data-kt-paused]::before,[data-kt-paused]::after,[data-kt-paused] *,[data-kt-paused] *::before,[data-kt-paused] *::after{animation-play-state:paused!important}
[data-kt-reduced],[data-kt-reduced]::before,[data-kt-reduced]::after,[data-kt-reduced] *,[data-kt-reduced] *::before,[data-kt-reduced] *::after{animation:none!important;transition:none!important}
.kt-builtin{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:20px;padding:24px;text-align:center;font-family:'Inter Tight',system-ui,sans-serif}
.kt-builtin h1{margin:0;font-size:clamp(28px,8cqmin,64px);line-height:1}
.kt-builtin button{min-height:48px;padding:0 28px;border:0;border-radius:12px;font:700 16px 'Inter Tight',system-ui,sans-serif;cursor:pointer}
`;
  document.head.append(style);
}

// Pauses CSS animations and ctx.loop() frames while a host is off screen or the tab is hidden.
function watchVisibility(host, signal) {
  let onScreen = true;
  const sync = () => {
    const paused = !onScreen || document.hidden;
    if (paused === host.hasAttribute('data-kt-paused')) return;
    host.toggleAttribute('data-kt-paused', paused);
    host.dispatchEvent(new CustomEvent(paused ? 'kt:pause' : 'kt:resume'));
  };
  document.addEventListener('visibilitychange', sync, { signal });
  if (typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(entries => { onScreen = entries[entries.length - 1].isIntersecting; sync(); });
    observer.observe(host);
    signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  }
  sync();
}

// ctx.loop(fn, {fps}): calls fn(seconds, dt) at most fps times a second (never above 30), only
// while the host is on screen, and stops for good when the splash goes. Return false to stop.
function makeLoop(host, signal, cap) {
  return (fn, { fps = cap } = {}) => {
    const frame = 1000 / Math.max(1, Math.min(fps, cap));
    let raf = 0, last = 0, time = 0, stopped = false;
    // Each loop owns its listeners, so a loop stopped early (a pause overlay hidden) leaves none behind.
    const own = new AbortController();
    const paused = () => document.hidden || host.hasAttribute('data-kt-paused') || !host.isConnected;
    const stop = () => { stopped = true; if (raf) cancelAnimationFrame(raf); raf = 0; own.abort(); };
    const tick = now => {
      raf = 0;
      if (stopped || signal.aborted || paused()) return;
      raf = requestAnimationFrame(tick);
      if (last && now - last < frame - 2) return;
      const dt = last ? Math.min(now - last, 100) : frame;
      last = now;
      time += dt;
      let result;
      try { result = fn(time / 1000, dt / 1000); } catch (error) { stop(); console.error(error); return; }
      if (result === false) stop();
    };
    const resume = () => { if (!raf && !stopped && !signal.aborted && !paused()) { last = 0; raf = requestAnimationFrame(tick); } };
    host.addEventListener('kt:resume', resume, { signal: own.signal });
    document.addEventListener('visibilitychange', resume, { signal: own.signal });
    signal.addEventListener('abort', stop, { once: true, signal: own.signal });
    resume();
    return stop;
  };
}

// Badges come from this site only: a root-relative path, or a blob/data image made in the page.
export function sameOriginImage(value) {
  if (typeof value !== 'string' || !value) return null;
  if (/^\/(?!\/)/.test(value) || /^blob:/.test(value) || /^data:image\/(?:png|jpeg|webp|gif|svg\+xml)[;,]/.test(value)) return value;
  return null;
}

// A file inside the theme's own folder; anything that resolves outside it falls back to the folder.
export function themeUrl(id, rel) {
  const base = `/themes/${id}/`;
  try {
    const url = new URL(String(rel), `http://theme.invalid${base}`);
    return url.origin === 'http://theme.invalid' && url.pathname.startsWith(base) ? url.pathname + url.search : base;
  } catch { return base; }
}

// Builds the ctx a theme's mount() or pause() receives.
export function buildCtx(host, theme, opts, hooks) {
  const accent = cleanAccent(opts.accent, theme?.defaultAccent || DEFAULT_ACCENT);
  const preview = opts.preview === true;
  const reducedMotion = wantsReducedMotion(opts);
  // Sound unlocks only when the viewer presses the Enter button itself.
  let tapped = false;
  const markTap = event => { if (event.target?.closest?.('[data-kt-enter]')) tapped = true; };
  for (const name of ['pointerdown', 'keydown', 'click']) host.addEventListener(name, markTap, { capture: true, signal: hooks.signal });
  const soundAllowed = () => !preview && opts.soundAllowed === true && theme?.sound !== false && tapped;
  const title = String(opts.title || opts.brand?.name || 'Our channel').trim().slice(0, 60);
  return Object.freeze({
    contract: CONTRACT,
    id: theme?.id || 'builtin',
    mode: opts.mode === 'gate' ? 'gate' : 'channel',
    title,
    kicker: String(opts.kicker || '').trim().slice(0, 60),
    subtitle: String(opts.subtitle || '').trim().slice(0, 120),
    number: pad2(opts.number ?? 1),
    slug: String(opts.channel || title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'tape',
    accent,
    accentInk: accentInk(accent),
    logoUrl: sameOriginImage(opts.logoUrl),
    reducedMotion,
    lowPower: opts.lowPower === true,
    preview,
    sound: Object.freeze({ allowed: soundAllowed, context: () => (soundAllowed() ? audioContext() : null) }),
    enterLabel: String(opts.enterLabel || '').trim().slice(0, 40),
    onEnter: hooks.onEnter,
    onSkip: hooks.onSkip,
    brand: Object.freeze({ name: opts.brand?.name || '', endorsement: opts.brand?.endorsement || '' }),
    h: createH(document, hooks.signal),
    url: rel => themeUrl(theme?.id, rel),
    signal: hooks.signal,
    loop: makeLoop(host, hooks.signal, preview ? 24 : 30),
  });
}

// Which mount currently owns a host, so a stale mount never clears a newer one's DOM.
const owners = new WeakMap();

// Mounts a theme into an existing host element. Rejects when the theme cannot load or mount, or
// when opts.signal aborts before it is ready (then the host is left untouched).
export async function mountTheme(host, theme, opts = {}, hooks = {}) {
  const mod = await loadTheme(theme, opts);
  if (opts.signal?.aborted) throw new DOMException('Mount cancelled', 'AbortError');
  const owner = {};
  owners.get(host)?.destroy();
  ensureBaseStyle();
  const controller = new AbortController();
  const signal = controller.signal;
  host.setAttribute('data-kt-theme', theme.id);
  host.toggleAttribute('data-kt-reduced', wantsReducedMotion(opts));
  host.inert = opts.preview === true;
  watchVisibility(host, signal);
  let gone = false;
  const ctx = buildCtx(host, theme, opts, {
    signal,
    onEnter: () => { if (!gone) hooks.onEnter?.(); },
    onSkip: () => { if (!gone) hooks.onSkip?.(); },
  });
  // Aborting the signal is what frees a theme's loops, listeners and WebGL context. The host is
  // then reset, so a frame can take another theme.
  const finish = () => {
    gone = true;
    controller.abort();
    if (owners.get(host) !== owner) return;
    owners.delete(host);
    host.replaceChildren();
    for (const name of ['style', 'data-kt-paused', 'data-kt-reduced', 'data-kt-theme']) host.removeAttribute(name);
    host.inert = false;
  };
  owner.destroy = finish;
  owners.set(host, owner);
  let handle;
  try { handle = mod.mount(host, ctx) || {}; } catch (error) { finish(); throw error; }
  return {
    theme, ctx, module: mod,
    async dismiss(reason = 'enter') {
      if (gone) return;
      gone = true;
      try { await Promise.race([Promise.resolve(handle.dismiss?.(reason)), sleep(DISMISS_LIMIT_MS)]); } catch {}
      finish();
    },
    destroy() { finish(); },
  };
}

// Last resort when no theme loads: a plain card that still lets the kid in.
function mountBuiltin(host, opts, hooks) {
  ensureBaseStyle();
  const controller = new AbortController();
  const accent = cleanAccent(opts.accent);
  const h = createH(document, controller.signal);
  host.setAttribute('data-kt-theme', 'builtin');
  const button = h('button', { type: 'button', 'data-kt-enter': true, style: { background: accent, color: accentInk(accent) }, onclick: () => hooks.onEnter() }, opts.enterLabel || 'Enter');
  host.replaceChildren(h('div', { class: 'kt-builtin' }, h('h1', { text: opts.title || 'Welcome' }), button));
  return { theme: null, dismiss: async () => { controller.abort(); host.replaceChildren(); }, destroy: () => { controller.abort(); host.replaceChildren(); } };
}

const fire = name => document.dispatchEvent(new Event(name));

// Used only when /api/themes itself failed: Glass Gate's files are always at these paths.
const BUILTIN_FALLBACK = Object.freeze({
  id: FALLBACK_ID, name: 'Glass Gate', weight: 'light', modes: ['gate', 'channel'], sound: false,
  defaultAccent: '#A98BFF', accents: { pause: false }, feed: {},
  css: `/themes/${FALLBACK_ID}/splash.css`, js: `/themes/${FALLBACK_ID}/splash.js`, preview: `/themes/${FALLBACK_ID}/preview.webp`,
});

// Shows a full-screen splash and resolves once the viewer is in: {shown, reason, theme, picked}.
// opts: themeId, mode, title, kicker, subtitle, number, accent, logoUrl, channel (slug), brand,
// soundAllowed, force, reducedMotion, lowPower, enterLabel, registry, search.
// Only one splash runs at a time; calling again while one is up returns the same promise.
let active = null;
export function showSplash(opts = {}) {
  if (active) return active;
  const search = opts.search ?? globalThis.location?.search ?? '';
  const param = splashParam(search);
  if (param === '0') { fire('tz:enter'); return Promise.resolve({ shown: false, reason: 'param', theme: null }); }
  if (param !== '1' && opts.channel && alwaysEnter(opts.channel)) { fire('tz:enter'); return Promise.resolve({ shown: false, reason: 'always', theme: null }); }
  active = runSplash(opts).finally(() => { active = null; });
  return active;
}

function runSplash(opts) {
  // Set before anything awaits: recovery.js checks it when it boots.
  globalThis.__tzsplash = { theme: opts.themeId || null, state: 'loading' };
  fire('tz:hold');
  ensureBaseStyle();
  const host = document.createElement('div');
  host.className = 'kt-splash-host';
  // recovery.js ignores touches inside #tzs-splash, so tapping Enter does not count as a feed touch.
  host.id = 'tzs-splash';
  host.tabIndex = -1;
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', `${opts.title || 'Channel'} intro`);
  const before = document.activeElement;
  const overflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  document.body.append(host);
  host.focus({ preventScroll: true });

  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  let mounted = null, leaving = false, picked = { reason: 'pending' };
  // Aborted when the viewer leaves, so a theme still loading never mounts into a removed host.
  const life = new AbortController();
  const leave = async reason => {
    if (leaving) return;
    leaving = true;
    life.abort();
    await mounted?.dismiss(reason);
    host.remove();
    document.documentElement.style.overflow = overflow;
    delete globalThis.__tzsplash;
    try { before?.focus?.({ preventScroll: true }); } catch {}
    fire('tz:enter');
    resolveDone({ shown: true, reason, theme: mounted?.theme?.id || null, picked: picked.reason });
  };
  const hooks = { onEnter: () => leave('enter'), onSkip: () => leave('skip') };
  // Safety net: Esc always skips, from the first moment, even while the theme loads.
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hooks.onSkip(); }, { signal: life.signal });

  const settle = handle => {
    if (leaving) { handle.destroy(); return; }
    mounted = handle;
    globalThis.__tzsplash = { theme: handle.theme?.id || 'builtin', state: 'mounted' };
    const enter = host.querySelector('[data-kt-enter]');
    (enter || host).focus({ preventScroll: true });
  };

  (async () => {
    const reducedMotion = wantsReducedMotion(opts);
    const lowPower = opts.lowPower ?? detectLowPower({ navigator: globalThis.navigator, reducedMotion });
    const registry = opts.registry || await loadRegistry();
    if (leaving) return;
    picked = pickTheme(registry, opts.themeId, { lowPower, force: opts.force === true, mode: opts.mode });
    const ctxOpts = { ...opts, reducedMotion, lowPower, preview: false, signal: life.signal };
    const fallback = registry.themes.find(theme => theme.id === (registry.fallback || FALLBACK_ID)) || (registry.themes.length ? null : BUILTIN_FALLBACK);
    let handle;
    try {
      handle = await mountTheme(host, picked.theme, ctxOpts, hooks);
    } catch (error) {
      if (leaving) return;
      if (picked.theme) console.warn('Splash theme failed, using the fallback', error);
      try {
        if (!fallback || fallback === picked.theme) throw error;
        handle = await mountTheme(host, fallback, ctxOpts, hooks);
      } catch {
        if (leaving) return;
        handle = mountBuiltin(host, opts, hooks);
      }
    }
    settle(handle);
  })();
  return done;
}

// Mounts a theme's pause() accent over feed videos when a viewer pauses one. Listens in the capture
// phase on the document, so feed.js needs no changes. Returns a function that detaches it.
export function attachPause(opts = {}) {
  const controller = new AbortController();
  const { signal } = controller;
  // Videos are held weakly; the live overlays are also kept in a set so detach can remove them.
  const overlays = new WeakMap();
  const pending = new WeakMap();
  const live = new Set();
  const ready = (async () => {
    const registry = opts.registry || await loadRegistry();
    const theme = registry.themes.find(entry => entry.id === opts.themeId);
    if (!theme || !theme.accents?.pause) return null;
    const mod = await loadTheme(theme).catch(() => null);
    return mod && typeof mod.pause === 'function' ? { mod, theme } : null;
  })();
  const drop = entry => {
    live.delete(entry);
    entry.local.abort();
    try { entry.api?.destroy?.(); } catch {}
    entry.host.remove();
  };
  const reducedMotion = wantsReducedMotion(opts);

  const isMain = video => {
    const slide = video.closest('.tz-slide');
    if (!slide || video.ended) return false;
    if (slide.dataset.active === '0') return false;
    // The slide on screen: it covers the middle of the viewport, or most of it is visible.
    const rect = slide.getBoundingClientRect();
    const height = globalThis.innerHeight || 0;
    const visible = Math.min(rect.bottom, height) - Math.max(rect.top, 0);
    return (rect.top <= height / 2 && rect.bottom >= height / 2) || (rect.height > 0 && visible / rect.height >= 0.6);
  };

  function overlayFor(video) {
    const found = overlays.get(video);
    if (found && found.host.isConnected && found.host.parentElement === video.parentElement) return Promise.resolve(found);
    if (!pending.has(video)) {
      pending.set(video, create(video, found).finally(() => pending.delete(video)));
    }
    return pending.get(video);
  }

  async function create(video, stale) {
    if (stale) drop(stale);
    // Overlays whose slides the feed has since thrown away go too.
    for (const entry of live) if (!entry.host.isConnected) drop(entry);
    const loaded = await ready;
    if (!loaded || signal.aborted) return null;
    ensureBaseStyle();
    const host = document.createElement('div');
    host.className = 'kt-pause-host';
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('data-kt-theme', loaded.theme.id);
    host.toggleAttribute('data-kt-reduced', reducedMotion);
    (video.parentElement || video.closest('.tz-slide')).append(host);
    const local = new AbortController();
    const entry = { host, api: null, local };
    watchVisibility(host, local.signal);
    const ctx = buildCtx(host, loaded.theme, { ...opts, reducedMotion, preview: false, soundAllowed: false }, { signal: local.signal, onEnter() {}, onSkip() {} });
    try { entry.api = loaded.mod.pause(host, ctx) || {}; } catch (error) { console.warn(error); local.abort(); host.remove(); return null; }
    live.add(entry);
    overlays.set(video, entry);
    return entry;
  }

  const timers = new WeakMap();
  document.addEventListener('pause', event => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || !video.closest('.tz-slide')) return;
    clearTimeout(timers.get(video));
    // A short wait skips the pauses the feed makes while swapping or scrolling slides.
    timers.set(video, setTimeout(async () => {
      if (signal.aborted || !video.paused || !isMain(video)) return;
      const entry = await overlayFor(video);
      if (entry && video.paused && !signal.aborted) {
        entry.api.show?.(video.currentTime || 0, Number.isFinite(video.duration) ? video.duration : 0);
        // The feed hides its own play glyph while a theme's pause screen is up (shell.css).
        entry.host.toggleAttribute('data-kt-shown', true);
      }
    }, 160));
  }, { capture: true, signal });
  const hide = event => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement)) return;
    clearTimeout(timers.get(video));
    const entry = overlays.get(video);
    entry?.api.hide?.();
    entry?.host.removeAttribute('data-kt-shown');
  };
  for (const name of ['play', 'playing', 'ended', 'emptied']) document.addEventListener(name, hide, { capture: true, signal });

  return () => {
    controller.abort();
    for (const entry of [...live]) drop(entry);
  };
}
