// Reactions in the feed: a sparkle button on the rail opens a pill of five stickers (the vendored
// Fluent Emoji the badge builder uses). Tapping one bursts copies of it up from the button and turns it
// on for this viewer; tapping an "on" sticker bursts again; a long press turns it off. Counts show as
// sticker chips under the caption. Guests get the guest prompt. Keys: r opens, 1-5 pick, Esc closes.
//
//   attachReactions({ session, isGuest, guestPrompt, failNote, clipOf })
//     session()      the signed-in { email, t } or null      isGuest()   true for a guest pass
//     guestPrompt()  the feed's "Guest access is view-only"  failNote(slide, text)
//     clipOf(slide)  the clip a slide shows (sealed clips have no reaction button)
import { prefersReducedMotion } from './endings.js';

export const KINDS = ['wow', 'flame', 'star', 'party', 'cool'];
const NAMES = { wow: 'Wow', flame: 'Fire', star: 'Star', party: 'Party', cool: 'Cool' };
const LONG_PRESS_MS = 500;
const SVG = 'http://www.w3.org/2000/svg';

export const railButtonMarkup = () => `<button type="button" data-act="react" aria-haspopup="true" aria-expanded="false" aria-label="React">
        <span class="tz-ico" data-ico="sparkle" aria-hidden="true"></span><span class="tz-react-dot" aria-hidden="true" hidden></span></button>`;
export const chipsMarkup = () => '<p class="tz-react-chips" data-bind="reactions" hidden></p>';

export const reactionLabel = (kind, count, on) => `${NAMES[kind]}. ${count} ${count === 1 ? 'person' : 'people'}.${on ? ' You reacted.' : ''}`;

let art = null;
function loadArt() {
  art ??= fetch('/badge/stickers.json').then(response => response.json())
    .then(catalog => Object.fromEntries(catalog.stickers.filter(sticker => KINDS.includes(sticker.id)).map(sticker => [sticker.id, sticker])))
    .catch(() => ({}));
  return art;
}

// One sticker as inline SVG, drawn from the same paths the badge renderer uses.
function sticker(stickers, kind, className = 'tz-sticker') {
  const data = stickers[kind];
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', data?.viewBox || '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');
  for (const path of data?.paths || []) {
    const node = document.createElementNS(SVG, 'path');
    for (const [name, value] of Object.entries(path)) if (/^(d|fill|fill-rule|clip-rule|opacity|stroke|stroke-width)$/.test(name)) node.setAttribute(name, value);
    svg.append(node);
  }
  return svg;
}

export function attachReactions({ session, isGuest, guestPrompt, failNote, clipOf }) {
  const counts = new Map(), mine = new Map();
  let stickers = {}, pill = null;

  const countsOf = id => counts.get(id) || {};
  const mineOf = id => mine.get(id) || new Set();

  function paint(slide) {
    const clip = clipOf(slide);
    if (!clip) return;
    const chips = slide.querySelector('[data-bind="reactions"]');
    const all = countsOf(clip.id), own = mineOf(clip.id);
    if (chips) {
      chips.replaceChildren();
      for (const kind of KINDS) {
        if (!all[kind]) continue;
        const chip = document.createElement('span');
        chip.className = 'tz-react-chip';
        chip.toggleAttribute('data-mine', own.has(kind));
        chip.setAttribute('role', 'img');
        chip.setAttribute('aria-label', reactionLabel(kind, all[kind], own.has(kind)));
        chip.append(sticker(stickers, kind), Object.assign(document.createElement('span'), { textContent: String(all[kind]) }));
        chips.append(chip);
      }
      chips.hidden = !chips.childElementCount;
    }
    const dot = slide.querySelector('.tz-react-dot');
    if (dot) dot.hidden = !own.size;
    if (pill?.slide === slide) paintPill();
  }
  const paintAll = () => document.querySelectorAll('.tz-slide[data-id]').forEach(paint);

  async function seed() {
    stickers = await loadArt();
    try {
      const result = await fetch('/api/reactions', { headers: { accept: 'application/json' } }).then(response => response.json());
      if (!result?.ok) return;
      counts.clear(); mine.clear();
      for (const [id, value] of Object.entries(result.counts || {})) counts.set(id, value);
      for (const [id, kinds] of Object.entries(result.mine || {})) mine.set(id, new Set(kinds));
    } catch {}
    paintAll();
  }

  function burst(slide, kind) {
    const button = slide.querySelector('[data-act="react"]');
    if (!button) return;
    const box = slide.getBoundingClientRect(), from = button.getBoundingClientRect();
    const layer = document.createElement('span');
    layer.className = 'tz-react-burst';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.left = `${from.left - box.left + from.width / 2}px`;
    layer.style.top = `${from.top - box.top}px`;
    const copies = prefersReducedMotion() ? 1 : 6 + Math.floor(Math.random() * 5);
    layer.toggleAttribute('data-quiet', copies === 1);
    layer.append(Object.assign(document.createElement('span'), { className: 'tz-react-wash' }));
    for (let i = 0; i < copies; i++) {
      const piece = sticker(stickers, kind, 'tz-sticker tz-react-piece');
      piece.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 120)}px`);
      piece.style.setProperty('--dy', `${-120 - Math.round(Math.random() * 110)}px`);
      piece.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 50)}deg`);
      piece.style.animationDelay = `${i * 40}ms`;
      layer.append(piece);
    }
    slide.append(layer);
    setTimeout(() => layer.remove(), 1400);
  }

  async function setKind(slide, kind, on) {
    const clip = clipOf(slide);
    const s = session();
    if (!clip || !s?.t) { failNote(slide, 'Log in to react.'); return; }
    const before = { ...countsOf(clip.id) }, ownBefore = new Set(mineOf(clip.id));
    const next = { ...before, [kind]: Math.max(0, (before[kind] || 0) + (on ? 1 : -1)) };
    const own = new Set(ownBefore);
    if (on) own.add(kind); else own.delete(kind);
    counts.set(clip.id, next); mine.set(clip.id, own);
    paint(slide);
    try {
      const response = await fetch('/api/react', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clipId: clip.id, kind, on, email: s.email, t: s.t }) });
      const result = await response.json().catch(() => null);
      if (response.status === 401 && isGuest()) { guestPrompt(); throw new Error('guest'); }
      if (!result?.ok) throw new Error(result?.error || 'save');
      counts.set(clip.id, result.counts || {});
      paint(slide);
    } catch (error) {
      counts.set(clip.id, before); mine.set(clip.id, ownBefore);
      paint(slide);
      if (error.message !== 'guest') failNote(slide, error.message === 'Slow down a little.' ? error.message : "Couldn't save.");
    }
  }

  function pick(kind) {
    if (!pill) return;
    const { slide } = pill;
    const clip = clipOf(slide);
    burst(slide, kind);
    if (clip && !mineOf(clip.id).has(kind)) setKind(slide, kind, true);
  }

  function paintPill() {
    const clip = clipOf(pill.slide);
    const all = countsOf(clip?.id), own = mineOf(clip?.id);
    for (const button of pill.node.querySelectorAll('[data-react]')) {
      const kind = button.dataset.react;
      button.setAttribute('aria-pressed', String(own.has(kind)));
      button.setAttribute('aria-label', reactionLabel(kind, all[kind] || 0, own.has(kind)));
    }
  }

  function close({ focus = false } = {}) {
    if (!pill) return;
    const { node, slide, controller } = pill;
    pill = null;
    controller.abort();
    node.remove();
    const button = slide.querySelector('[data-act="react"]');
    button?.setAttribute('aria-expanded', 'false');
    if (focus) button?.focus({ preventScroll: true });
  }

  function open(slide, { focusFirst = false } = {}) {
    if (isGuest() || !session()?.t) { if (isGuest()) guestPrompt(); else failNote(slide, 'Log in to react.'); return; }
    const button = slide.querySelector('[data-act="react"]');
    if (!button) return;
    if (pill?.slide === slide) { close({ focus: true }); return; }
    close();
    const controller = new AbortController();
    const node = document.createElement('div');
    node.className = 'tz-react-pill';
    node.setAttribute('role', 'group');
    node.setAttribute('aria-label', 'Reactions');
    KINDS.forEach((kind, i) => {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.dataset.react = kind;
      choice.title = `${NAMES[kind]} (${i + 1})`;
      choice.append(sticker(stickers, kind));
      node.append(choice);
      // A long press turns an "on" sticker off; a short tap bursts (and turns it on).
      let timer = 0, long = false;
      const clear = () => { clearTimeout(timer); timer = 0; };
      choice.addEventListener('pointerdown', () => {
        long = false;
        timer = setTimeout(() => { long = true; const clip = clipOf(slide); if (clip && mineOf(clip.id).has(kind)) setKind(slide, kind, false); }, LONG_PRESS_MS);
      }, { signal: controller.signal });
      for (const name of ['pointerup', 'pointerleave', 'pointercancel']) choice.addEventListener(name, clear, { signal: controller.signal });
      choice.addEventListener('contextmenu', event => event.preventDefault(), { signal: controller.signal });
      choice.addEventListener('click', event => { event.stopPropagation(); if (long) { long = false; return; } pick(kind); }, { signal: controller.signal });
    });
    slide.append(node);
    const box = slide.getBoundingClientRect(), at = button.getBoundingClientRect();
    node.style.top = `${at.top - box.top + at.height / 2}px`;
    node.style.right = `${box.right - at.left + 6}px`;
    pill = { node, slide, controller };
    button.setAttribute('aria-expanded', 'true');
    paintPill();
    if (focusFirst) node.querySelector('button').focus({ preventScroll: true });
    document.addEventListener('pointerdown', event => { if (!node.contains(event.target) && !button.contains(event.target)) close(); }, { capture: true, signal: controller.signal });
    document.querySelector('#tz-reel')?.addEventListener('scroll', () => close(), { passive: true, signal: controller.signal });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-act="react"]');
    if (!button) return;
    const slide = button.closest('.tz-slide');
    if (slide) open(slide);
  });

  const typing = target => target?.closest?.('input, textarea, select, [contenteditable="true"], dialog[open]');
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
    if (document.body.dataset.sheetOpen || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape' && pill) { event.preventDefault(); event.stopPropagation(); close({ focus: true }); return; }
    if (pill && /^[1-5]$/.test(event.key)) { event.preventDefault(); pick(KINDS[Number(event.key) - 1]); return; }
    if (event.key === 'r' || event.key === 'R') {
      const slide = document.querySelector('.tz-slide[data-active="1"]');
      if (slide?.querySelector('[data-act="react"]')) { event.preventDefault(); open(slide, { focusFirst: true }); }
    }
  }, true);

  seed();
  return { paint, paintAll, close, seed };
}
