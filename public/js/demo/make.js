// "Make your own kid's page": the public demo's short guided flow at /demo/make, which server/demo.mjs
// serves only with DEMO_MODE=1. It is the setup wizard's add-kid step (setup/kids.js) in its basic form
// (name, line, accent, badge, splash), sent to the visitor's private sandbox: in demo mode the dashboard's
// kid routes answer from it, so nothing reaches the family or another visitor. The visitor becomes the
// demo's parent first, the one role that edits kids.
import { renderKids } from '/setup/kids.js';
import { el, note, setBusy } from '/setup/ui.js';
import { badgeFor } from '/js/shell/picker.js';

const KEY = 'kid-session';
const DAY = 86400000;
const NOTE = 'Your changes are only on this device and disappear at the next reset.';
const STEPS = ["Make your kid's page", 'Watch it'];
const $ = id => document.getElementById(id);
const body = $('su-body');
let cleanup = () => {};
let firstPaint = true;
let sandbox = null;
let brand = '';
const family = { accent: '#FF5C2B' };

function session() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null');
    return value?.email && value?.t && value.exp > Date.now() ? value : null;
  } catch { return null; }
}
const auth = () => { const value = session(); return value ? { email: value.email, t: value.t } : null; };

async function asParent() {
  if (session()?.role === 'super') return;
  const response = await fetch('/api/demo/enter', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'parent' }), credentials: 'same-origin',
  });
  const reply = await response.json().catch(() => null);
  if (!response.ok || !reply?.ok) throw new Error(reply?.error || 'The demo is busy. Try again in a moment.');
  try { localStorage.setItem(KEY, JSON.stringify({ email: reply.email, t: reply.t, role: reply.role, exp: Date.now() + 7 * DAY })); } catch {}
}

async function call(path, { method = 'GET', body: payload } = {}) {
  const headers = { accept: 'application/json' };
  const who = auth();
  if (who) Object.assign(headers, { 'X-Kid-Email': who.email, 'X-Kid-Token': who.t });
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(path, { method, headers, credentials: 'same-origin', cache: 'no-store', body: payload === undefined ? undefined : JSON.stringify(payload) });
    const data = await response.json().catch(() => ({ ok: false, error: `Something went wrong (${response.status}). Try again.` }));
    return { status: response.status, data };
  } catch {
    return { status: 0, data: { ok: false, error: 'Could not reach the demo. Check the connection and try again.' } };
  }
}

// The wizard's step talks to /api/setup/kids; here its requests go to the sandboxed kid routes.
function api(path, options = {}) {
  if (path === '/api/setup/kids') return call('/api/admin/kids', options);
  if (path === '/api/setup/kids/done') return Promise.resolve({ status: 200, data: { ok: true } });
  const removed = /^\/api\/setup\/kids\/(\d+)$/.exec(path);
  if (removed) return call('/api/admin/kids/delete', { method: 'POST', body: { id: Number(removed[1]) } });
  return call(path, options);
}

// The wizard's own small builders, so the step looks and behaves as it does there.
function form(onSubmit, ...children) {
  const node = el('form', { class: 'kp-stack', novalidate: '' }, ...children);
  node.addEventListener('submit', event => { event.preventDefault(); onSubmit(node); });
  return node;
}
const primary = (text, extra = {}) => el('button', { type: 'submit', class: 'kp-btn kp-btn-primary', ...extra }, text);
const secondary = (text, onclick, extra = {}) => {
  const button = el('button', { type: 'button', class: 'kp-btn', ...extra }, text);
  if (onclick) button.addEventListener('click', onclick);
  return button;
};

function paintRail(current) {
  $('su-steps').replaceChildren(...STEPS.map((name, index) => {
    const item = el('span', { class: 'su-step' }, el('span', { class: 'su-num' }, String(index + 1)), name);
    if (index + 1 === current) item.setAttribute('aria-current', 'step');
    return el('li', { class: index + 1 < current ? 'su-done' : '' }, item);
  }));
  $('su-bar').style.width = `${(current / STEPS.length) * 100}%`;
}

function show(number, view) {
  cleanup();
  cleanup = view.cleanup || (() => {});
  paintRail(number);
  const title = el('h1', { class: 'kp-title', tabindex: '-1' }, view.title);
  body.replaceChildren(el('div', { class: 'su-intro' }, title, view.lead ? el('p', { class: 'kp-lead' }, view.lead) : null), ...view.content);
  document.title = `${view.title} · ${brand ? `${brand} demo` : 'Demo'}`;
  if (!firstPaint) { title.focus(); window.scrollTo(0, 0); }
  firstPaint = false;
}

// The visitor's own kids (the step lists only those) and the family's accent for new ones.
async function load() {
  const [{ data }, site] = await Promise.all([
    call('/api/admin/kids'),
    fetch('/api/site', { credentials: 'same-origin', headers: { accept: 'application/json' } }).then(response => response.json()).catch(() => null),
  ]);
  if (!data?.ok || !data.sandbox) throw new Error(data?.error || 'This page works only in the demo.');
  sandbox = data.sandbox;
  if (site?.accent) family.accent = site.accent;
  if (site?.brand?.name) brand = site.brand.name;
  return data.kids.filter(kid => kid.sandbox === 'created');
}

async function resetMine(button) {
  const done = setBusy(button, 'Resetting');
  await call('/api/demo/sandbox/reset', { method: 'POST', body: {} });
  done();
  await refresh(4);
}

function makeView(kids) {
  const view = renderKids({
    state: { kids, family }, api, auth, refresh, go: () => location.assign('/'), primary, secondary, form,
    basic: true, maxKids: sandbox.createdMax,
  });
  return {
    ...view,
    title: kids.length ? 'Your kids\' pages' : 'Make your own kid\'s page',
    lead: `Pick a name, a channel line, a color, a badge and a splash screen, like a parent does when they set up. You can make up to ${sandbox.createdMax}.`,
    content: [note(NOTE), ...view.content],
  };
}

function doneView(kids) {
  const rows = kids.map((kid, index) => {
    // The badge as the front door draws it: the saved one, or the kid's initial on their accent.
    const art = el('span', { class: 'su-kid-badge' }, badgeFor(kid));
    return el('div', { class: 'kp-stack-tight' },
      el('div', { class: 'kp-row' }, art, el('div', { class: 'kp-row-main' }, el('strong', {}, kid.name), kid.kicker ? el('span', {}, kid.kicker) : null)),
      el('div', {}, el('a', { class: `kp-btn${index === 0 ? ' kp-btn-primary' : ''}`, href: `/#/c/${encodeURIComponent(kid.slug)}` }, `Open ${kid.name}'s page`)));
  });
  const reset = secondary('Reset my changes', () => resetMine(reset), { class: 'kp-btn kp-btn-quiet' });
  return {
    title: kids.length === 1 ? `${kids[0].name}'s page is ready` : 'Your kids\' pages are ready',
    lead: 'Open a page to see the splash screen, the badge and the colors. It is on the front door now too, for you alone.',
    content: [
      el('div', { class: 'su-kids' }, ...rows),
      note(`Their pages borrow a few of the demo family's clips, so there is something to watch. Uploads are off in the demo. ${NOTE}`),
      el('div', { class: 'kp-actions' },
        el('div', { class: 'kp-actions' }, secondary(kids.length < sandbox.createdMax ? 'Make another kid' : 'Change them', () => refresh(4)), reset),
        el('a', { class: 'kp-btn', href: '/parents#/kids' }, 'Customize the demo kids')),
    ],
  };
}

// The step calls refresh(4) after a change and refresh(5) when the visitor continues.
async function refresh(step = 4) {
  let kids;
  try { kids = await load(); }
  catch (error) {
    body.replaceChildren(note(error.message, 'bad'), el('div', {}, secondary('Try again', () => refresh(step))));
    return;
  }
  if (step === 5 && kids.length) show(2, doneView(kids));
  else show(1, makeView(kids));
}

async function boot() {
  try { await asParent(); }
  catch (error) {
    body.replaceChildren(note(error.message, 'bad'), el('div', {}, secondary('Try again', () => location.reload())));
    return;
  }
  // A visitor coming back sees the pages they made; a new one gets the form.
  await refresh(5);
}

boot();
