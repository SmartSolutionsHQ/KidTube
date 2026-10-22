// The kids as big badge buttons: the front door draws them signed out, the picker signed in, and the
// "Switch kid" sheet from inside a feed. Each badge sits in a ring of that kid's accent.
import { channelHash } from './route.mjs';

const SVG = 'http://www.w3.org/2000/svg';
const ACCENT = /^#[0-9a-f]{6}$/i;
const LOGO = /^\/brand\/[a-z0-9-]+\.svg(?:\?v=\d+)?$/;

export const accentOf = channel => (ACCENT.test(channel?.accent || '') ? channel.accent : '#FF5C2B');

// A kid without a saved badge still gets one: their initial on their accent.
function initialBadge(channel) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  const circle = document.createElementNS(SVG, 'circle');
  for (const [key, value] of [['cx', 50], ['cy', 50], ['r', 46], ['fill', accentOf(channel)]]) circle.setAttribute(key, value);
  const text = document.createElementNS(SVG, 'text');
  for (const [key, value] of [['x', 50], ['y', 67], ['text-anchor', 'middle'], ['font-size', 48], ['fill', '#0B0C10']]) text.setAttribute(key, value);
  text.setAttribute('font-family', 'Anton, Impact, sans-serif');
  text.textContent = (Array.from(channel.name || '?')[0] || '?').toUpperCase();
  svg.append(circle, text);
  return svg;
}

export function badgeFor(channel) {
  if (LOGO.test(channel.logoUrl || '')) {
    const img = new Image();
    img.src = channel.logoUrl;
    img.alt = '';
    img.decoding = 'async';
    // A badge that fails to load falls back to the initial, never a broken image.
    img.addEventListener('error', () => img.replaceWith(initialBadge(channel)), { once: true });
    return img;
  }
  return initialBadge(channel);
}

function kidButton(channel, { current, onPick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'kt-kid';
  button.style.setProperty('--kid', accentOf(channel));
  button.dataset.slug = channel.slug;
  const ring = document.createElement('span');
  ring.className = 'kt-kid-badge';
  ring.append(badgeFor(channel));
  const name = document.createElement('span');
  name.className = 'kt-kid-name';
  name.textContent = channel.name;
  button.append(ring, name);
  if (channel.kicker) {
    const kicker = document.createElement('span');
    kicker.className = 'kt-kid-kicker';
    kicker.textContent = channel.kicker;
    button.append(kicker);
  }
  if (current === channel.slug) {
    button.setAttribute('aria-current', 'true');
    const now = document.createElement('span');
    now.className = 'tz-sr';
    now.textContent = ' (watching now)';
    button.append(now);
  }
  button.addEventListener('click', () => onPick(channel));
  return button;
}

// Fills a list with one button per kid.
export function renderKids(list, channels, { current = '', onPick }) {
  list.replaceChildren(...channels.map(channel => {
    const item = document.createElement('li');
    item.append(kidButton(channel, { current, onPick }));
    return item;
  }));
  list.dataset.count = String(Math.min(channels.length, 6));
}

// Switching kids goes through a full reload on the new channel's address, so the feed starts clean.
// pushState keeps Back working (the shell reloads on hashchange) without firing a hashchange now.
export function switchTo(channel) {
  history.pushState(null, '', channelHash(channel.slug));
  location.reload();
}

let sheet = null;

// The "Switch kid" sheet over a feed. Esc or the close button leaves it.
export function openSwitcher(channels, current) {
  if (!sheet) {
    sheet = document.createElement('dialog');
    sheet.className = 'kt-switch';
    sheet.setAttribute('aria-labelledby', 'kt-switch-title');
    const head = document.createElement('div');
    head.className = 'kt-switch-head';
    const title = Object.assign(document.createElement('h2'), { id: 'kt-switch-title', textContent: "Who's on tape?" });
    const close = Object.assign(document.createElement('button'), { type: 'button', className: 'kt-switch-x', textContent: 'Close' });
    close.addEventListener('click', () => sheet.close());
    head.append(title, close);
    const list = document.createElement('ul');
    list.className = 'kt-kids';
    sheet.append(head, list);
    sheet.addEventListener('click', event => { if (event.target === sheet) sheet.close(); });
    document.body.append(sheet);
  }
  renderKids(sheet.querySelector('.kt-kids'), channels, {
    current,
    onPick: channel => { if (channel.slug === current) sheet.close(); else switchTo(channel); },
  });
  sheet.showModal();
  (sheet.querySelector('[aria-current="true"]') || sheet.querySelector('.kt-kid'))?.focus();
}
