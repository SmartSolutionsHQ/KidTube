// The public demo's banner. server/demo.mjs adds this script (and /css/demo.css) to every page only when
// the server runs with DEMO_MODE=1, so a family's install never loads it.
//
//   - a small pill on every page: "Demo · resets in 42 min"; it opens a card that says what the demo
//     is, offers the three one-tap roles and links to installing your own;
//   - "Try it as: a kid / Grandma / a parent" on the front door, on the sign-in card and on the
//     dashboard's sign-in, each signing in through POST /api/demo/enter;
//   - "Make your own kid's page" (/demo/make) and "Customize Juni's page" (the dashboard's Kids tab) on
//     the front door and in the card, with "Reset my changes" once the visitor has any. Those changes
//     live in the visitor's private sandbox on the server (server/demo-sandbox.mjs), never anyone else's;
//   - the feed's upload button and comment box explain that they are off here. The server refuses
//     those writes itself; this only says why before anyone types.
import { keepSession, readSession } from './auth-dialog.js';

const UPLOAD_NOTE = 'On your own install, kids record here and a parent can check each video before anyone sees it.';
const COMMENT_NOTE = 'Comments are read-only in the demo, so nothing you write reaches other visitors. On your own install, a parent can read new comments first.';
const SANDBOX_NOTE = 'Your changes are only on this device and disappear at the next reset.';
const MAKE_PAGE = '/demo/make';

document.documentElement.dataset.ktDemo = '';

let info = null;
let sandbox = null;
let kids = [];
let skew = 0;
let panel = null;
let pill = null;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(child => child != null));
  return node;
}

const currentRole = () => info?.roles.find(role => role.email && role.email === readSession()?.email) || null;
const now = () => Date.now() + skew;

// "resets in 42 min", or "42m" for the phone pill.
function untilReset(short = false) {
  const minutes = Math.ceil((info.nextReset - now()) / 60000);
  if (minutes <= 0) return short ? 'now' : 'resetting now';
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (short) return hours ? `${hours}h${rest ? ` ${rest}m` : ''}` : `${minutes}m`;
  if (minutes < 60) return `resets in ${minutes} min`;
  return `resets in ${hours} h${rest ? ` ${rest} min` : ''}`;
}

// Same-page navigation with only a new hash does not reload, and the shell keeps its state in memory.
function go(path) {
  const target = new URL(path, location.href);
  if (target.pathname === location.pathname && target.search === location.search) {
    history.replaceState(null, '', target);
    location.reload();
  } else location.assign(target);
}

async function enter(role, button, target = '') {
  const buttons = document.querySelectorAll('[data-ktd-role], [data-ktd-go]');
  buttons.forEach(node => { node.disabled = true; });
  button.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/demo/enter', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }), credentials: 'same-origin',
    });
    const reply = await response.json().catch(() => null);
    if (!response.ok || !reply?.ok) throw new Error(reply?.error || 'That did not work. Try again.');
    keepSession(reply);
    go(target || reply.go || '/');
  } catch (error) {
    buttons.forEach(node => { node.disabled = false; });
    button.removeAttribute('aria-busy');
    say(button.closest('.ktd-try, .ktd-mine'), error.message);
  }
}

// ---------- making it yours ----------

// The kid a "Customize" button names: the one on screen, else the first on the front door, as this
// visitor sees them (their own name for Juni if they renamed her).
function kidToCustomize() {
  const here = window.__ktChannel?.slug;
  return kids.find(kid => kid.slug === here) || kids[0] || null;
}

async function customize(button) {
  const kid = kidToCustomize();
  const target = `/parents#/kids/${encodeURIComponent(kid?.slug || '')}`;
  if (currentRole()?.id === 'parent') { go(target); return; }
  await enter('parent', button, target);
}

async function resetMine(button) {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/demo/sandbox/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', credentials: 'same-origin' });
    if (!response.ok) throw new Error('That did not work. Try again.');
    location.reload();
  } catch (error) {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    say(button.closest('.ktd-mine'), error.message);
  }
}

// "Make your own kid's page", "Customize Juni's page" and, once there are changes, "Reset my changes".
function mineBlock({ compact = false } = {}) {
  const kid = kidToCustomize();
  const make = el('a', { className: 'ktd-role ktd-go', href: MAKE_PAGE },
    el('span', { className: 'ktd-role-name' }, 'Make your own kid\'s page'),
    el('span', { className: 'ktd-role-who' }, 'name, badge and splash'));
  const change = kid ? el('button', { type: 'button', className: 'ktd-role ktd-go' },
    el('span', { className: 'ktd-role-name' }, `Customize ${kid.name}'s page`),
    el('span', { className: 'ktd-role-who' }, 'in the parent dashboard')) : null;
  if (change) {
    change.dataset.ktdGo = 'customize';
    change.addEventListener('click', () => customize(change));
  }
  let reset = null;
  if (sandbox?.active) {
    reset = el('button', { type: 'button', className: 'ktd-reset' }, 'Reset my changes');
    reset.addEventListener('click', () => resetMine(reset));
  }
  return el('div', { className: 'ktd-mine' + (compact ? ' ktd-try-compact' : '') },
    el('p', { className: 'ktd-try-head' }, 'Or make it yours'),
    el('div', { className: 'ktd-gos' }, make, change),
    // The card already says where changes live, so there it carries only the reset.
    compact && !reset ? null : el('p', { className: 'ktd-try-note' }, compact ? null : SANDBOX_NOTE, !compact && reset ? ' ' : null, reset),
    el('p', { className: 'ktd-error', role: 'alert' }));
}

function say(box, message) {
  const line = box?.querySelector('.ktd-error');
  if (line) line.textContent = message;
}

// The three roles as buttons. `compact` drops the explanation, for the sign-in card.
function tryBlock({ compact = false, heading = 'Try it as' } = {}) {
  const mine = currentRole();
  const roles = (info?.roles || []).map(role => {
    const label = role.id === 'grandma' ? 'Grandma' : role.label.replace(/^a /, 'A ');
    const button = el('button', { type: 'button', className: 'ktd-role', disabled: role.id === mine?.id },
      el('span', { className: 'ktd-role-name' }, label),
      el('span', { className: 'ktd-role-who' }, role.id === 'kid' ? role.name : role.id === 'parent' ? 'the dashboard' : 'family watching'));
    button.dataset.ktdRole = role.id;
    if (role.id === mine?.id) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => enter(role.id, button));
    return button;
  });
  return el('div', { className: 'ktd-try' + (compact ? ' ktd-try-compact' : '') },
    el('p', { className: 'ktd-try-head' }, heading),
    el('div', { className: 'ktd-roles' }, ...roles),
    compact ? null : el('p', { className: 'ktd-try-note' }, 'An invented family. No passwords, and it resets every hour.'),
    el('p', { className: 'ktd-error', role: 'alert' }));
}

// ---------- the pill and its card ----------

function paintPill() {
  if (!pill || !info) return;
  const role = currentRole();
  const as = role ? `as ${role.id === 'kid' ? role.name : role.label}` : '';
  pill.querySelector('.ktd-pill-time').textContent = untilReset();
  pill.querySelector('.ktd-pill-short').textContent = untilReset(true);
  pill.querySelector('.ktd-pill-as').textContent = as;
  pill.setAttribute('aria-label', `Demo${as ? `, ${as}` : ''}, ${untilReset()}. About this demo`);
  if (panel && !panel.hidden) panel.querySelector('.ktd-when').textContent = `Next reset: ${untilReset(true) === 'now' ? 'now' : `in ${untilReset().replace('resets in ', '')}`}.`;
}

function openPanel(open = true) {
  if (!panel) return;
  panel.hidden = !open;
  pill.setAttribute('aria-expanded', String(open));
  if (open) {
    panel.querySelector('.ktd-panel-body .ktd-try')?.replaceWith(tryBlock({ compact: true, heading: currentRole() ? 'Switch to' : 'Try it as' }));
    panel.querySelector('.ktd-panel-body .ktd-mine')?.replaceWith(mineBlock({ compact: true }));
    paintPill();
    panel.querySelector('.ktd-close').focus();
  }
}

function mountBanner() {
  pill = el('button', { type: 'button', className: 'ktd-pill' },
    el('span', { className: 'ktd-pill-tag' }, 'Demo'),
    el('span', { className: 'ktd-pill-as' }),
    el('span', { className: 'ktd-pill-time' }),
    el('span', { className: 'ktd-pill-short', ariaHidden: 'true' }));
  pill.setAttribute('aria-controls', 'ktd-panel');
  pill.setAttribute('aria-expanded', 'false');
  pill.addEventListener('click', () => (stale ? location.reload() : openPanel(panel.hidden)));

  const install = el('a', { className: 'ktd-install', href: info.installUrl, target: '_blank', rel: 'noopener' }, `Install ${info.brand} for your family`);
  panel = el('section', { className: 'ktd-panel', id: 'ktd-panel', hidden: true },
    el('div', { className: 'ktd-panel-head' },
      el('h2', { className: 'ktd-title', id: 'ktd-title' }, 'This is a demo'),
      el('button', { type: 'button', className: 'ktd-close', ariaLabel: 'Close' }, '×')),
    el('div', { className: 'ktd-panel-body' },
      el('p', {}, `${info.family || 'This family'} is invented: the kids, the relatives and every video. Look around as anyone you like.`),
      el('p', {}, 'Likes and reactions work, and you can customize a kid or make your own kid\'s page. Everything else is read-only, so nothing you do reaches another visitor, and the whole family is put back every hour.'),
      el('p', { className: 'ktd-sandbox' }, SANDBOX_NOTE),
      el('p', { className: 'ktd-when' }),
      tryBlock({ compact: true }),
      mineBlock({ compact: true }),
      install));
  panel.setAttribute('aria-labelledby', 'ktd-title');
  panel.querySelector('.ktd-close').addEventListener('click', () => { openPanel(false); pill.focus(); });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); openPanel(false); pill.focus(); } });
  document.addEventListener('click', event => {
    if (!panel.hidden && !panel.contains(event.target) && !pill.contains(event.target)) openPanel(false);
  });
  const root = el('div', { className: 'ktd' }, pill, panel);
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'About this demo');
  document.body.append(root);
  paintPill();
  setInterval(tick, 15000);
}

// A page that was open through a reset shows the family as it was, so the pill offers a reload from then on.
let stale = false;
function tick() {
  if (!info || stale) return;
  if (now() < info.nextReset) { paintPill(); return; }
  stale = true;
  openPanel(false);
  pill.classList.add('ktd-pill-fresh');
  pill.querySelector('.ktd-pill-time').textContent = 'just reset · tap to reload';
  pill.querySelector('.ktd-pill-short').textContent = 'reload';
  pill.setAttribute('aria-label', 'The demo was just reset. Reload the page');
}

// ---------- the places a visitor would sign in ----------

// The front door: under the kids' badges, while nobody is signed in.
function watchDoor() {
  const door = document.getElementById('kt-door');
  if (!door) return;
  // "Try it as" while nobody is signed in; "make it yours" whenever the kids are on the door.
  const place = () => {
    const inner = door.querySelector('.kt-door-in');
    const kidsList = inner?.querySelector('[data-door="kids"]');
    const open = door.dataset.mode === 'door' && kidsList;
    const block = door.querySelector('.ktd-try'), mine = door.querySelector('.ktd-mine');
    if (open && !readSession() && !block) kidsList.after(tryBlock());
    else if ((!open || readSession()) && block) block.remove();
    if (open && !mine) (door.querySelector('.ktd-try') || kidsList).after(mineBlock());
    else if (!open && mine) mine.remove();
  };
  new MutationObserver(place).observe(door, { attributes: true, attributeFilter: ['data-mode'] });
  place();
}

// The sign-in card (a modal, so the pill behind it cannot be reached) and the dashboard's sign-in.
function watchSignIn() {
  const spots = [document.getElementById('account-content'), document.getElementById('kd-main')].filter(Boolean);
  for (const spot of spots) {
    const place = () => {
      if (readSession() || spot.querySelector('.ktd-try')) return;
      const form = spot.querySelector('form');
      if (form && form.querySelector('input[type="password"], input[autocomplete="one-time-code"]')) form.before(tryBlock({ compact: true, heading: 'No account needed. Try it as' }));
    };
    new MutationObserver(place).observe(spot, { childList: true, subtree: true });
    place();
  }
}

// ---------- uploads and comments ----------

let notice = null;
function explain(title, text) {
  if (!notice) {
    notice = el('dialog', { className: 'ktd-notice' },
      el('h2', { className: 'ktd-title', id: 'ktd-notice-title' }),
      el('p', { className: 'ktd-notice-text' }),
      el('div', { className: 'ktd-notice-acts' },
        el('a', { className: 'ktd-install', href: info?.installUrl || '#', target: '_blank', rel: 'noopener' }, 'Install your own'),
        el('button', { type: 'button', className: 'ktd-ok' }, 'OK')));
    notice.setAttribute('aria-labelledby', 'ktd-notice-title');
    notice.querySelector('.ktd-ok').addEventListener('click', () => notice.close());
    document.body.append(notice);
  }
  notice.querySelector('.ktd-title').textContent = title;
  notice.querySelector('.ktd-notice-text').textContent = text;
  notice.showModal();
  notice.querySelector('.ktd-ok').focus();
}

// Before the feed's own handlers (they sit on the button itself), so no file picker opens.
document.addEventListener('click', event => {
  if (!event.target.closest?.('.tz-upload-fab, [data-kt-record]')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  explain('Uploads are off in the demo', UPLOAD_NOTE);
}, true);

function commentNote() {
  const composer = document.querySelector('[data-bind="composer"]');
  if (!composer || composer.previousElementSibling?.classList.contains('ktd-readonly')) return;
  composer.before(el('p', { className: 'ktd-readonly' }, COMMENT_NOTE));
}

// The dashboard says what the server said, in its status line or under a form; the demo's refusals get
// the calm colour instead of the error one.
function calmStatus() {
  const root = document.getElementById('tza-root');
  if (!root) return;
  const mark = () => {
    for (const node of document.querySelectorAll('#kd-status, .kp-error')) node.toggleAttribute('data-ktd-calm', /\bin the demo\b/i.test(node.textContent));
  };
  new MutationObserver(mark).observe(document.body, { childList: true, characterData: true, subtree: true });
}

// ---------- boot ----------

async function load() {
  try {
    const started = Date.now();
    const response = await fetch('/api/demo', { credentials: 'same-origin', headers: { accept: 'application/json' } });
    const next = await response.json();
    if (!next?.ok) return;
    skew = next.now - Math.round((started + Date.now()) / 2);
    info = next;
  } catch {}
  // This visitor's own changes, and the kids as they see them, for the "make it yours" buttons.
  const read = path => fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } }).then(response => response.json()).catch(() => null);
  const [mine, site] = await Promise.all([read('/api/demo/sandbox'), read('/api/site')]);
  sandbox = mine?.ok ? mine : null;
  kids = Array.isArray(site?.channels) ? site.channels.filter(kid => kid && typeof kid.slug === 'string' && typeof kid.name === 'string') : [];
}

async function boot() {
  commentNote();
  calmStatus();
  await load();
  if (!info) return;
  mountBanner();
  watchDoor();
  watchSignIn();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
