// The parent dashboard at /parents. Signs the parent in, draws the nav for their role and shows one tab
// at a time from the address (#/review). Each tab module exports render(main, ctx) and may return a
// cleanup function. The owner ('super') sees everything; a co-parent ('admin') sees videos, review,
// comments, guest codes and activity. Kid and viewer accounts are sent back to the videos by the server.
import { api, readSession, signIn, signOut, clearSession } from './api.js';
import { el, field, errorLine, setBusy } from './dom.js';
import * as home from './home.js';
import * as review from './review.js';
import * as kids from './kids.js';
import * as videos from './videos.js';
import * as comments from './comments.js';
import * as people from './people.js';
import * as guests from './guests.js';
import * as activity from './activity.js';
import * as watched from './watched.js';
import * as settings from './settings.js';
import { dashboardTitle } from './format.js';

export const TABS = [
  { id: 'home', label: 'Home', module: home },
  { id: 'review', label: 'Review', count: 'review', module: review },
  { id: 'kids', label: 'Kids', owner: true, module: kids },
  { id: 'videos', label: 'Videos', module: videos },
  { id: 'comments', label: 'Comments', count: 'comments', module: comments },
  { id: 'people', label: 'People', count: 'people', owner: true, module: people },
  { id: 'guests', label: 'Guest codes', module: guests },
  { id: 'activity', label: 'Activity', module: activity },
  { id: 'watched', label: 'Who watched', owner: true, module: watched },
  { id: 'settings', label: 'Settings', owner: true, module: settings },
];
export const tabsFor = role => TABS.filter(tab => !tab.owner || role === 'super');

const $ = selector => document.querySelector(selector);
const app = $('#tza-root');
const main = $('#kd-main');
const nav = $('#kd-nav');
const menu = $('.kd-menu');
const status = $('#kd-status');
let summary = null;
let cleanup = null;
let current = null;
let statusTimer = 0;

function say(text, level = 'good') {
  clearTimeout(statusTimer);
  status.dataset.level = level;
  status.textContent = text;
  statusTimer = setTimeout(() => { status.textContent = ''; }, level === 'bad' ? 9000 : 6000);
}

function setFamily(name) {
  for (const node of document.querySelectorAll('[data-family-name]')) node.textContent = name || 'Parent dashboard';
  document.title = dashboardTitle(name, document.body.dataset.brand);
}

/* ---------- signing in ---------- */
function showSignIn(message = '') {
  cleanup?.(); cleanup = null;
  app.dataset.state = 'signin';
  menu.hidden = true;
  const email = el('input', { class: 'kp-input', type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
  const pass = el('input', { class: 'kp-input', type: 'password', autocomplete: 'current-password', required: true });
  const error = errorLine('kd-signin-error', message);
  const submit = el('button', { class: 'kp-btn kp-btn-primary', type: 'submit' }, 'Sign in');
  const form = el('form', { novalidate: true }, field('Email', email), field('Password', pass), error, submit);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    if (!email.value.trim() || !pass.value) { error.textContent = 'Enter your email and password.'; return; }
    const done = setBusy(submit, 'Signing in');
    try {
      const session = await signIn(email.value.trim().toLowerCase(), pass.value);
      if (session.role !== 'admin' && session.role !== 'super') {
        await signOut();
        done();
        error.textContent = 'This page is for parents. Kid and viewer accounts watch on the main page.';
        return;
      }
      done();
      await start();
    } catch (problem) { done(); error.textContent = problem.message; }
  });
  main.replaceChildren(el('section', { class: 'kp-panel kd-signin kp-stack', 'aria-labelledby': 'kd-signin-title' },
    el('div', { class: 'kd-head' }, el('h1', { class: 'kp-title', id: 'kd-signin-title', tabindex: '-1' }, 'Parent dashboard'),
      el('p', { class: 'kp-lead' }, 'Sign in as a parent to review uploads, manage the kids and see who watched what.')),
    form, el('p', { class: 'kp-small' }, el('a', { href: '/' }, 'Back to the videos'))));
  email.focus();
}

/* ---------- the nav ---------- */
function paintNav() {
  const list = $('#kd-nav-list');
  list.replaceChildren(...tabsFor(summary.me.role).map(tab => {
    const n = tab.count ? summary.counts[tab.count] : 0;
    const link = el('a', { href: `#/${tab.id}`, 'aria-current': tab.id === current ? 'page' : null }, el('span', {}, tab.label),
      n ? el('span', { class: 'kd-count' }, String(n), el('span', { class: 'kd-sr' }, ' waiting')) : null);
    return el('li', {}, link);
  }));
  $('#kd-who').textContent = `Signed in as ${summary.me.name} (${summary.me.role === 'super' ? 'owner' : 'co-parent'}).`;
}

function setMenu(open) {
  nav.dataset.open = String(open);
  menu.setAttribute('aria-expanded', String(open));
}
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  setMenu(open);
  if (open) nav.querySelector('a')?.focus();
});
nav.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true' && getComputedStyle(menu).display !== 'none') {
    setMenu(false);
    menu.focus();
  }
});
nav.addEventListener('click', event => { if (event.target.closest('a[href^="#/"]')) setMenu(false); });

$('#kd-signout').addEventListener('click', async () => {
  await signOut();
  location.assign('/');
});

/* ---------- tabs ---------- */
async function refresh() {
  summary = await api.get('/api/admin/summary');
  setFamily(summary.family.name);
  paintNav();
  return summary;
}

// Read through getters, so a tab sees the latest summary after ctx.refresh().
const context = () => ({
  api, say, refresh,
  get summary() { return summary; }, get role() { return summary.me.role; }, get me() { return summary.me; },
  get kids() { return summary.kids; }, get family() { return summary.family; },
  go: id => { location.hash = `#/${id}`; },
  kidName: slug => summary.kids.find(kid => kid.slug === slug)?.name || '',
});

async function show(focus) {
  const wanted = (/^#\/([a-z]+)/.exec(location.hash) || [])[1];
  const tab = tabsFor(summary.me.role).find(entry => entry.id === wanted) || TABS[0];
  if (wanted && wanted !== tab.id) history.replaceState(null, '', '#/home');
  cleanup?.(); cleanup = null;
  current = tab.id;
  paintNav();
  main.replaceChildren(el('p', { class: 'kp-lead' }, `Loading ${tab.label.toLowerCase()}.`));
  try {
    const result = await tab.module.render(main, context());
    if (current !== tab.id) { result?.(); return; }
    cleanup = typeof result === 'function' ? result : null;
  } catch (problem) {
    if (current !== tab.id) return;
    if (problem.status === 403 && /sign in/i.test(problem.message)) return;
    main.replaceChildren(el('div', { class: 'kd-head' }, el('h1', { class: 'kp-title', tabindex: '-1' }, tab.label)),
      el('p', { class: 'kp-note kp-note-bad' }, problem.message || 'Something went wrong. Reload the page.'));
  }
  if (focus) (main.querySelector('h1') || main).focus();
}

let started = false;
async function start() {
  try { await refresh(); } catch (problem) {
    if (problem.status === 403) { clearSession(); showSignIn(); return; }
    main.replaceChildren(el('p', { class: 'kp-note kp-note-bad' }, problem.message));
    return;
  }
  app.dataset.state = 'ready';
  menu.hidden = false;
  $('#kd-signout').hidden = false;
  if (!started) { started = true; addEventListener('hashchange', () => show(true)); }
  await show(false);
  (main.querySelector('h1') || main).focus();
}

api.onSignedOut = () => { clearSession(); showSignIn('Your session ended. Sign in again.'); };

const session = readSession();
if (!session) showSignIn();
else if (session.role !== 'admin' && session.role !== 'super') showSignIn('This page is for parents. Kid and viewer accounts watch on the main page.');
else start();
