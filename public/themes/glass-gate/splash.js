// Glass Gate: two soft glows and a frosted card. CSS only, no sound. The fallback theme, so it
// stays small and never depends on anything a phone might lack.

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function initials(title) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const first = (words[0] || '?').replace(/[^\p{L}\p{N}]/gu, '');
  return (first.length <= 4 ? first : words.length > 1 ? words.slice(0, 2).map(word => word[0]).join('') : first.slice(0, 4)).toUpperCase() || '?';
}

function badge(ctx) {
  const { h } = ctx;
  if (ctx.logoUrl) return h('img', { class: 'gg-badge', src: ctx.logoUrl, alt: '', width: 88, height: 88, decoding: 'async' });
  const label = initials(ctx.title);
  return h('svg:svg', { class: 'gg-badge', viewBox: '0 0 100 100', width: 88, height: 88, 'aria-hidden': 'true' },
    h('svg:polygon', { points: '50,4 90,27 90,73 50,96 10,73 10,27', fill: ctx.accent }),
    h('svg:text', {
      x: 50, y: 61, 'text-anchor': 'middle', fill: ctx.accentInk, class: 'gg-badge-text',
      ...(label.length > 2 ? { textLength: 62, lengthAdjust: 'spacingAndGlyphs' } : {}),
    }, label));
}

export function mount(host, ctx) {
  const { h } = ctx;
  host.style.setProperty('--gg-accent', ctx.accent);
  host.style.setProperty('--gg-ink', ctx.accentInk);
  const enter = h('button', { class: 'gg-enter', type: 'button', 'data-kt-enter': true, onclick: () => ctx.onEnter() }, ctx.enterLabel || 'Enter');
  const root = h('div', { class: 'gg-root' },
    h('div', { class: 'gg-glow gg-glow-a', 'aria-hidden': 'true' }),
    h('div', { class: 'gg-glow gg-glow-b', 'aria-hidden': 'true' }),
    h('main', { class: 'gg-card' },
      badge(ctx),
      ctx.kicker ? h('p', { class: 'gg-kicker', text: ctx.kicker }) : null,
      h('h1', { class: 'gg-title', text: ctx.title }),
      ctx.subtitle ? h('p', { class: 'gg-line', text: ctx.subtitle }) : null,
      enter));
  host.replaceChildren(root);
  if (!ctx.preview) {
    document.addEventListener('keydown', event => { if (event.key === 'Escape') ctx.onSkip(); }, { signal: ctx.signal });
  }
  return {
    dismiss() {
      root.classList.add('gg-leaving');
      return wait(ctx.reducedMotion ? 0 : 320);
    },
  };
}
