// Splash gallery: every theme mounted live in a small phone-shaped frame (ctx.preview = true), so a
// parent or kid can pick one. The setup wizard and the dashboard reuse it. No side effects on import.
import { cleanAccent, createH, detectLowPower, loadRegistry, mountTheme } from './themes.js';

export const PHONE = { width: 390, height: 844 };

const STYLE = `
.kt-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--kt-gal-min,168px),1fr));gap:var(--kt-gal-gap,22px 18px);margin:0;padding:0;font-family:'Inter Tight',system-ui,sans-serif;color:#F7F4EC}
.kt-gal-card{display:flex;flex-direction:column;gap:10px;min-width:0;padding:0;border:0;background:none;color:inherit;text-align:left;cursor:pointer;border-radius:22px;outline:none}
.kt-gal-screen{position:relative;border-radius:22px;padding:5px;background:#1E1E25;transition:box-shadow .2s ease,transform .2s ease}
.kt-gal-card:hover .kt-gal-screen{transform:translateY(-2px)}
.kt-gal-card[aria-checked="true"] .kt-gal-screen{box-shadow:0 0 0 3px var(--kt-gal-accent,#FF5C2B)}
.kt-gal-card:focus-visible .kt-gal-screen{box-shadow:0 0 0 3px #F7F4EC}
.kt-gal-card[aria-checked="true"]:focus-visible .kt-gal-screen{box-shadow:0 0 0 3px var(--kt-gal-accent,#FF5C2B),0 0 0 6px #F7F4EC}
.kt-frame{position:relative;width:100%;overflow:hidden;border-radius:17px;background:#05060A;isolation:isolate}
.kt-frame>.kt-frame-host{width:var(--kt-frame-w);height:var(--kt-frame-h);transform-origin:0 0;transform:scale(var(--kt-frame-s,0.4))}
.kt-frame>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.kt-gal-note{position:absolute;inset:0;display:grid;place-items:center;padding:12px;text-align:center;font:500 11px/1.4 'DM Mono',ui-monospace,monospace;letter-spacing:.08em;color:#A6A0AE}
.kt-gal-meta{display:flex;flex-direction:column;gap:4px;padding:0 4px}
.kt-gal-name{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;line-height:1.2}
.kt-gal-check{display:none;width:18px;height:18px;border-radius:50%;background:var(--kt-gal-accent,#FF5C2B);color:var(--kt-gal-accent-ink,#0B0C10);font-size:12px;line-height:18px;text-align:center}
.kt-gal-card[aria-checked="true"] .kt-gal-check{display:inline-block}
.kt-gal-desc{font-size:13px;line-height:1.4;color:#D9D4CB}
.kt-gal-tags{font:500 10px/1.5 'DM Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#A6A0AE}
`;

let styled = false;
function ensureStyle() {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.dataset.ktShell = 'gallery';
  style.textContent = STYLE;
  document.head.append(style);
}

// A frame that renders a host at a fixed virtual size (a phone by default) scaled to fit its width.
export function createFrame(parent, { width = PHONE.width, height = PHONE.height } = {}) {
  ensureStyle();
  const outer = document.createElement('div');
  outer.className = 'kt-frame';
  outer.style.aspectRatio = `${width} / ${height}`;
  outer.style.setProperty('--kt-frame-w', `${width}px`);
  outer.style.setProperty('--kt-frame-h', `${height}px`);
  const host = document.createElement('div');
  host.className = 'kt-frame-host';
  outer.append(host);
  parent.append(outer);
  const fit = () => outer.style.setProperty('--kt-frame-s', String((outer.clientWidth || width) / width));
  let observer = null;
  if (typeof ResizeObserver === 'function') { observer = new ResizeObserver(fit); observer.observe(outer); }
  fit();
  return { outer, host, fit, destroy() { observer?.disconnect(); outer.remove(); } };
}

// Mounts one theme into a frame in preview mode. Returns the mounted handle, or null on failure.
export async function previewTheme(frame, theme, ctx = {}) {
  try {
    return await mountTheme(frame.host, theme, { ...ctx, preview: true, soundAllowed: false });
  } catch (error) {
    console.warn('Theme preview failed', theme?.id, error);
    frame.host.replaceChildren();
    const note = document.createElement('p');
    note.className = 'kt-gal-note';
    note.textContent = 'Preview unavailable';
    frame.outer.append(note);
    return null;
  }
}

// opts: registry, ctx (title, kicker, subtitle, number, accent, logoUrl, mode, reducedMotion, brand),
// selected (theme id), onSelect(id), label, live ('auto' | 'always' | 'never'), mode filter.
// Returns { update(ctx), select(id), destroy() }.
export function createThemeGallery(container, opts = {}) {
  ensureStyle();
  const controller = new AbortController();
  const h = createH(document, controller.signal);
  const root = h('div', { class: 'kt-gallery', role: 'radiogroup', 'aria-label': opts.label || 'Splash themes' });
  container.append(root);
  let ctx = { ...(opts.ctx || {}) };
  let selected = opts.selected || null;
  let cards = [];
  let timer = 0;
  const lowPower = detectLowPower({ navigator: globalThis.navigator, reducedMotion: false });

  const paintAccent = () => {
    const accent = cleanAccent(ctx.accent);
    root.style.setProperty('--kt-gal-accent', accent);
  };

  const live = theme => {
    if (opts.live === 'always') return true;
    if (opts.live === 'never') return false;
    return !(theme.weight === 'heavy' && lowPower);
  };

  async function mountCard(card) {
    card.handle?.destroy();
    card.handle = null;
    card.frame.outer.querySelector('.kt-gal-note')?.remove();
    card.frame.outer.querySelector('img')?.remove();
    if (!live(card.theme)) {
      card.frame.outer.append(h('img', { src: card.theme.preview, alt: '', loading: 'lazy', decoding: 'async' }));
      return;
    }
    const token = (card.token = {});
    const handle = await previewTheme(card.frame, card.theme, ctx);
    if (card.token !== token || controller.signal.aborted) { handle?.destroy(); return; }
    card.handle = handle;
  }

  function sync() {
    for (const card of cards) {
      const on = card.theme.id === selected;
      card.el.setAttribute('aria-checked', String(on));
      card.el.tabIndex = on || (!selected && card === cards[0]) ? 0 : -1;
    }
  }

  function choose(id, focus) {
    selected = id;
    sync();
    const card = cards.find(entry => entry.theme.id === id);
    if (focus) card?.el.focus();
    opts.onSelect?.(id, card?.theme);
  }

  function onKey(event, index) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step) {
      event.preventDefault();
      choose(cards[(index + step + cards.length) % cards.length].theme.id, true);
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      choose(cards[index].theme.id, false);
    }
  }

  // Frames mount once they come near the screen, so a long gallery stays cheap.
  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const card = cards.find(c => c.el === entry.target);
        if (card && !card.started) { card.started = true; mountCard(card); }
      }
    }, { rootMargin: '200px' })
    : null;

  async function build() {
    const registry = opts.registry || await loadRegistry();
    if (controller.signal.aborted) return;
    const themes = registry.themes.filter(theme => !opts.mode || theme.modes.includes(opts.mode));
    cards = themes.map((theme, index) => {
      const screen = h('div', { class: 'kt-gal-screen' });
      const el = h('div', {
        class: 'kt-gal-card', role: 'radio', 'aria-checked': 'false', tabindex: -1,
        'aria-label': theme.name, 'data-theme-id': theme.id,
        onclick: () => choose(theme.id, false),
        onkeydown: event => onKey(event, index),
      },
      screen,
      h('div', { class: 'kt-gal-meta' },
        h('span', { class: 'kt-gal-name' }, theme.name, h('span', { class: 'kt-gal-check', 'aria-hidden': 'true' }, '✓')),
        h('span', { class: 'kt-gal-desc', text: theme.description }),
        h('span', { class: 'kt-gal-tags', text: theme.tags.join(' · ') })));
      root.append(el);
      const frame = createFrame(screen);
      return { theme, el, frame, handle: null, started: false, token: null };
    });
    paintAccent();
    sync();
    for (const card of cards) {
      if (observer) observer.observe(card.el);
      else { card.started = true; mountCard(card); }
    }
  }
  const built = build();

  return {
    ready: built,
    update(patch = {}) {
      ctx = { ...ctx, ...patch };
      paintAccent();
      clearTimeout(timer);
      timer = setTimeout(() => { for (const card of cards) if (card.started) mountCard(card); }, 250);
    },
    select(id) { selected = id; sync(); },
    get selected() { return selected; },
    destroy() {
      clearTimeout(timer);
      controller.abort();
      observer?.disconnect();
      for (const card of cards) { card.handle?.destroy(); card.frame.destroy(); }
      root.remove();
    },
  };
}
