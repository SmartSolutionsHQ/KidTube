// Theme moments outside the splash: the unlock that plays when a time capsule opens, and the
// end-of-tape screen when a kid's daily watch time runs out. Each theme may export unlock() and
// ending() (docs/THEMES.md); this file loads them with a time limit and falls back to the shell's own
// calm versions, so a missing or broken theme never blocks the viewer.
//
//   playUnlock({ slot, channel, clip })     resolves when the unlock is done (at most 3 s)
//   showEnding({ channel, budget, onDone })  the modal "End of tape" dialog; resolves with its element
//
// channel is window.__ktChannel: { slug, name, accent, number, themeId, splashSound, timezone }.
// Sound follows the pause-accent rule: only when the family allows splash sound and the viewer has
// tapped something in this session. Reduced motion shows finished frames and plays no sound.
import { buildCtx, loadRegistry, loadTheme, prefersReducedMotion } from './themes.js';

export const UNLOCK_LIMIT_MS = 3000;
const THEME_LOAD_MS = 2500;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const within = (promise, ms) => Promise.race([promise, sleep(ms).then(() => { throw new Error('timeout'); })]);

let gestured = false;
for (const name of ['pointerdown', 'keydown']) globalThis.document?.addEventListener(name, () => { gestured = true; }, { capture: true, passive: true });
const hasGesture = () => gestured || navigator.userActivation?.hasBeenActive === true;

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

// The kid's theme module when it has the export, else null.
async function themeHook(themeId, name) {
  try {
    const registry = await within(loadRegistry(), THEME_LOAD_MS);
    const theme = registry.themes.find(entry => entry.id === themeId);
    if (!theme?.accents?.[name]) return null;
    const mod = await within(loadTheme(theme), THEME_LOAD_MS);
    return typeof mod[name] === 'function' ? { theme, run: mod[name] } : null;
  } catch { return null; }
}

function makeCtx(host, theme, channel, extra, signal, reducedMotion) {
  const base = buildCtx(host, theme, {
    title: extra.title, channel: channel.slug, number: channel.number || 1, accent: channel.accent,
    reducedMotion, soundAllowed: false, brand: {},
  }, { signal, onEnter() {}, onSkip() {} });
  const allowed = () => !reducedMotion && channel.splashSound === true && theme?.sound !== false && hasGesture();
  return Object.freeze({ ...base, ...extra, title: String(extra.title || base.title).slice(0, 80),
    sound: Object.freeze({ allowed, context: () => (allowed() ? audioContext() : null) }) });
}

// One soft two-note chime for the shell's own defaults; a no-op when sound is not allowed.
function chime(ctx, notes) {
  const context = ctx.sound.context();
  if (!context) return;
  const start = context.currentTime + 0.02;
  notes.forEach((frequency, i) => {
    const osc = context.createOscillator(), gain = context.createGain();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + i * 0.12);
    gain.gain.exponentialRampToValueAtTime(0.08, start + i * 0.12 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + i * 0.12 + 0.3);
    osc.connect(gain).connect(context.destination);
    osc.start(start + i * 0.12);
    osc.stop(start + i * 0.12 + 0.32);
  });
}

// The shell's unlock: a paper seal splits down the middle and the tape label slides up.
function defaultUnlock(host, ctx) {
  const { h } = ctx;
  const root = h('div', { class: 'kt-unlock-default' },
    h('div', { class: 'kt-unlock-seal kt-unlock-seal-l' }), h('div', { class: 'kt-unlock-seal kt-unlock-seal-r' }),
    h('div', { class: 'kt-unlock-label' }, h('span', { class: 'kt-unlock-kicker', text: 'Time capsule opened' }), h('span', { class: 'kt-unlock-title', text: ctx.title })));
  host.replaceChildren(root);
  return {
    play() { chime(ctx, [523.25, 783.99]); return sleep(ctx.reducedMotion ? 0 : 1900); },
    destroy() { host.replaceChildren(); },
  };
}

export async function playUnlock({ slot, channel, clip }) {
  const reducedMotion = prefersReducedMotion();
  const host = document.createElement('div');
  host.className = 'kt-unlock-host';
  host.setAttribute('aria-hidden', 'true');
  slot.append(host);
  // Reduced motion: no ceremony, an "Opened" label fades in over the clip as it starts.
  if (reducedMotion) {
    host.classList.add('kt-unlock-quiet');
    host.append(Object.assign(document.createElement('span'), { className: 'kt-unlock-opened', textContent: 'Opened' }));
    setTimeout(() => host.remove(), 2600);
    return;
  }
  const controller = new AbortController();
  let api = null;
  try {
    const hook = await themeHook(channel.themeId, 'unlock');
    const extra = { title: clip.title, openedAt: Number(clip.openedAt) || 0, note: String(clip.capsuleNote || '').slice(0, 140) };
    if (hook) {
      try {
        host.dataset.ktTheme = hook.theme.id;
        api = hook.run(host, makeCtx(host, hook.theme, channel, extra, controller.signal, false)) || {};
        await within(Promise.resolve(api.play?.()), UNLOCK_LIMIT_MS);
        return;
      } catch (error) {
        console.warn('Theme unlock failed; using the shell unlock.', error);
        try { api?.destroy?.(); } catch {}
        delete host.dataset.ktTheme;
      }
    }
    api = defaultUnlock(host, makeCtx(host, null, channel, extra, controller.signal, false));
    await within(api.play(), UNLOCK_LIMIT_MS).catch(() => {});
  } finally {
    controller.abort();
    try { api?.destroy?.(); } catch {}
    host.remove();
  }
}

const clock = (resetsAt, timezone) => {
  try { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: timezone || undefined }).format(resetsAt); } catch { return '00:00'; }
};
const mmss = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// The shell's ending: the tape counter runs down to zero on ink and stops.
function defaultEnding(host, ctx) {
  const { h } = ctx;
  const counter = h('span', { class: 'kt-end-counter', text: '00:00' });
  const root = h('div', { class: 'kt-end-default' },
    h('div', { class: 'kt-end-reel' }, h('i'), h('i')),
    h('p', { class: 'kt-end-osd' }, h('span', { text: 'TAPE ' }), counter));
  host.replaceChildren(root);
  let stop = null;
  return {
    show({ limit = 0 } = {}) {
      const from = Math.min(limit, 90);
      if (ctx.reducedMotion || !from) { counter.textContent = '00:00'; return; }
      counter.textContent = mmss(from);
      // A short run-down, once, then it rests at zero.
      stop = ctx.loop(seconds => {
        const left = Math.max(0, from - seconds * from / 1.6);
        counter.textContent = mmss(Math.ceil(left));
        return left > 0;
      }, { fps: 20 });
    },
    destroy() { stop?.(); host.replaceChildren(); },
  };
}

export async function showEnding({ channel, budget = {}, onDone }) {
  const existing = document.querySelector('.kt-ending-host');
  if (existing) return existing;
  const reducedMotion = prefersReducedMotion();
  const host = document.createElement('dialog');
  host.className = 'kt-ending-host';
  host.setAttribute('aria-label', 'End of tape');
  host.toggleAttribute('data-kt-reduced', reducedMotion);
  // There is nothing behind the dialog to go back to, so Esc does not close it; "Done for today" does.
  host.addEventListener('cancel', event => event.preventDefault());
  document.body.append(host);
  host.showModal();
  const controller = new AbortController();
  const info = { resetsAt: Number(budget.resetsAt) || 0, used: Number(budget.used) || 0, limit: Number(budget.limit) || 0 };
  const extra = { title: channel.name || '', number: String(channel.number || 1).padStart(2, '0'), slug: channel.slug || 'tape' };
  let api = null;
  const hook = await themeHook(channel.themeId, 'ending');
  if (hook) {
    try {
      host.dataset.ktTheme = hook.theme.id;
      api = hook.run(host, makeCtx(host, hook.theme, channel, extra, controller.signal, reducedMotion)) || {};
      api.show?.(info);
    } catch (error) {
      console.warn('Theme ending failed; using the shell ending.', error);
      try { api?.destroy?.(); } catch {}
      api = null;
      delete host.dataset.ktTheme;
    }
  }
  if (!api) {
    api = defaultEnding(host, makeCtx(host, null, channel, extra, controller.signal, reducedMotion));
    api.show(info);
  }
  const panel = document.createElement('div');
  panel.className = 'kt-ending-panel';
  const title = Object.assign(document.createElement('h2'), { className: 'kt-ending-title', textContent: "That's the tape for today" });
  const line = Object.assign(document.createElement('p'), { className: 'kt-ending-line', textContent: `More tomorrow at ${clock(info.resetsAt, channel.timezone)}` });
  const done = Object.assign(document.createElement('button'), { type: 'button', className: 'kt-ending-done', textContent: 'Done for today' });
  done.dataset.ktDone = '';
  done.addEventListener('click', () => {
    controller.abort();
    try { api?.destroy?.(); } catch {}
    onDone ? onDone() : location.assign('/');
  });
  panel.append(title, line, done);
  host.append(panel);
  done.focus();
  return host;
}
