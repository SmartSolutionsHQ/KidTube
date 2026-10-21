// The static front door and the account card. M6 replaces the front door with the kid picker and each
// kid's splash; the card stays the shell's (themes only restyle it through --kt-auth-* variables).
//
// Contract with the rest of the page:
//   - Everything except the splash and the card is inert until a session is confirmed.
//   - Unlocking sets window.kidUnlocked, stores the session in localStorage 'kid-session', and fires
//     'kid:unlocked' (feed.js loads clips) then 'tz:enter' (site.js plays the wordmark, recovery.js holds).
const $ = selector => document.querySelector(selector);
const splash = $('#tzs-splash');
const dialog = $('#account-dialog');
const appParts = [...document.body.children].filter(el => el !== splash && el !== dialog && el.tagName !== 'SCRIPT');
appParts.forEach(el => { el.inert = true; });

const DAY = 86400000;
const MODES = [['login', 'Log in'], ['signup', 'Sign up'], ['guest', 'Guest code']];
const HEADINGS = { login: 'Welcome back', signup: 'Ask to join', guest: 'Got a guest code?', profile: 'Your account' };
const INTROS = {
  login: 'Log in to watch, leave a heart and join the conversation.',
  signup: 'A parent approves every new account before it can watch.',
  guest: 'A one-time code from the family gives you 24 hours of watching.',
};
const FIELDS = {
  login: [['email', 'Email', 'email', 'username'], ['pass', 'Password', 'password', 'current-password']],
  signup: [
    ['first', 'First name', 'text', 'given-name'], ['last', 'Last name', 'text', 'family-name'],
    ['email', 'Email', 'email', 'email'], ['pass', 'Password (12 or more characters)', 'password', 'new-password'],
  ],
  guest: [['code', 'Guest code', 'text', 'one-time-code']],
};
const SUBMITS = { login: 'Log in', signup: 'Ask to join', guest: 'Use guest code' };

// site.js fills the page's name slots from /api/site; the card reads the name from there.
const siteName = () => document.querySelector('[data-site="name"]')?.textContent.trim() || '';

function read() {
  try {
    const session = JSON.parse(localStorage.getItem('kid-session'));
    return session?.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

const b64 = text => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function unlock(session) {
  localStorage.setItem('kid-session', JSON.stringify(session));
  window.kidUnlocked = true;
  document.body.removeAttribute('data-locked');
  appParts.forEach(part => { part.inert = false; });
  if (dialog.open) dialog.close();
  document.dispatchEvent(new Event('kid:unlocked'));
  document.dispatchEvent(new Event('tz:enter'));
  $('#account-button').textContent = session.guest ? 'Guest' : 'Account';
  $('#tz-reel').focus();
}

async function finishIntro() {
  splash.remove();
  const session = read();
  if (session) {
    try {
      const check = session.guest
        ? await post('/api/guest/validate', { token: session.guestToken })
        : await fetch('/api/check?e=' + b64(session.email) + '&t=' + encodeURIComponent(session.t || '')).then(r => r.json());
      if (check.ok && (session.guest || (check.status === 'approved' && check.t))) {
        unlock({ ...session, email: check.email || session.email, role: check.role || session.role });
        return;
      }
    } catch {}
  }
  showAccount(new URLSearchParams(location.search).has('register') ? 'signup' : 'login');
}

$('#enter-tube').addEventListener('click', finishIntro);
dialog.addEventListener('cancel', event => { if (!window.kidUnlocked) event.preventDefault(); });
$('#account-button').addEventListener('click', () => showAccount('profile'));

function profile(content, session) {
  content.append(el('p', { textContent: session.guest ? 'You are watching with a view-only guest code.' : session.email }));
  if (session.role === 'super' || session.role === 'admin') {
    content.append(el('a', { href: '/parents', className: 'block-button', textContent: 'Open the parent dashboard' }));
  }
  const logout = el('button', { type: 'button', className: 'block-button', textContent: 'Log out' });
  logout.addEventListener('click', async () => {
    await post('/api/logout', {}).catch(() => {});
    localStorage.removeItem('kid-session');
    location.reload();
  });
  content.append(logout);
  if (session.guest) {
    const join = el('button', { type: 'button', className: 'text-button', textContent: 'Ask for an account' });
    join.addEventListener('click', () => showAccount('signup'));
    content.append(join);
  }
}

function modeSwitch(mode) {
  const modes = el('div', { className: 'account-modes' });
  for (const [value, label] of MODES) {
    const tab = el('button', { type: 'button', textContent: label });
    if (value === mode) tab.setAttribute('aria-current', 'true');
    else tab.addEventListener('click', () => showAccount(value));
    modes.append(tab);
  }
  return modes;
}

function accessForm(content, mode, message) {
  content.append(el('p', { textContent: INTROS[mode] }));

  const form = el('form', { className: 'join-form' });
  for (const [name, label, type, autocomplete] of FIELDS[mode]) {
    const input = el('input', { name, type, autocomplete, required: true });
    if (name === 'pass') { input.minLength = mode === 'signup' ? 12 : 1; input.maxLength = 128; }
    if (name === 'code') { input.maxLength = 4; input.pattern = '[a-zA-Z0-9]{4}'; input.autocapitalize = 'characters'; }
    form.append(el('label', { textContent: label }, input));
  }
  const status = el('p', { className: 'form-status', textContent: message });
  status.setAttribute('role', 'status');
  const submit = el('button', { type: 'submit', className: 'block-button', textContent: SUBMITS[mode] });
  form.append(status, submit);
  content.append(form);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = 'One moment…';
    try {
      const body = Object.fromEntries(new FormData(form));
      if (body.email) body.email = body.email.toLowerCase().trim();
      const reply = await post(mode === 'guest' ? '/api/guest/redeem' : mode === 'signup' ? '/api/signup' : '/api/login', body);
      if (!reply.ok) throw Error(reply.error === 'exists' ? 'That account already exists. Try logging in.' : reply.error || 'Could not connect. Try again.');
      if (mode === 'signup') { showAccount('login', 'Request sent. Once a parent approves your account, log in here.'); return; }
      if (mode === 'guest') { unlock({ guest: true, guestToken: reply.token, role: 'guest', exp: reply.expires }); return; }
      if (reply.status !== 'approved') {
        status.textContent = reply.status === 'pending' ? 'Your account is waiting for a parent to approve it.' : 'This account has not been approved.';
        return;
      }
      // The server answers with the canonical email; keep that, not what was typed.
      unlock({ email: reply.email || body.email, t: reply.t, role: reply.role, exp: Date.now() + 7 * DAY });
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}

function showAccount(mode = 'login', message = '') {
  const session = read();
  const content = $('#account-content');
  content.replaceChildren();
  const view = mode === 'profile' && !session ? 'login' : mode;
  const name = siteName();
  if (name) content.append(el('p', { className: 'account-kicker', textContent: `${name} · ${view === 'profile' ? 'account' : 'access'}` }));
  if (view !== 'profile') content.append(modeSwitch(view));
  content.append(el('h2', { id: 'account-title', textContent: HEADINGS[view] }));
  if (view === 'profile') profile(content, session);
  else accessForm(content, view, message);

  const footer = el('div', { className: 'account-choices' }, el('a', { href: '/about', textContent: 'About this channel' }));
  if (window.kidUnlocked) {
    const close = el('button', { type: 'button', className: 'text-button', textContent: 'Back to videos' });
    close.addEventListener('click', () => dialog.close());
    footer.append(close);
  }
  content.append(footer);
  if (!dialog.open) dialog.showModal();
}
