// The account card: a glass card over the kid's splash, the family splash or the front door, with
// Log in, Sign up and Code, plus the signed-in profile. Themes restyle it only through the --kt-auth-*
// variables in kid.css; nothing here knows about themes.
//
// The session lives in localStorage 'kid-session' (feed.js reads it for likes, comments and uploads):
//   { email, t, role, exp }                for an account (t is the 7-day session token)
//   { guest: true, guestToken, role: 'guest', exp, scope }   for a guest pass
// The server also sets the signed kid_access cookie, which is what /api/me and the videos check.

const DAY = 86400000;
const KEY = 'kid-session';
const HEADINGS = { login: 'Welcome back', signup: 'Ask to join', guest: 'Got a guest code?', profile: 'Your account' };
const INTROS = {
  login: 'Log in to enter the tube.',
  signup: 'A parent approves every new account before it can watch. Parents can see who watched what.',
  guest: 'A one-time code from the family gives you 24 hours of watching.',
};
// Kids sign in with the login name a parent gave them ("milo"); everyone else with their email.
const FIELDS = {
  login: [['email', 'Email or kid name', 'text', 'username'], ['pass', 'Password', 'password', 'current-password']],
  signup: [
    ['first', 'First name', 'text', 'given-name'], ['last', 'Last name', 'text', 'family-name'],
    ['email', 'Email', 'email', 'email'], ['pass', 'Password (12 or more characters)', 'password', 'new-password'],
  ],
  guest: [['code', 'Guest code', 'text', 'one-time-code']],
};
const SUBMITS = { login: 'Log in', signup: 'Ask to join', guest: 'Use guest code' };

export function readSession() {
  try {
    const session = JSON.parse(localStorage.getItem(KEY));
    return session?.exp > Date.now() ? session : null;
  } catch { return null; }
}

export function writeSession(session) {
  try { localStorage.setItem(KEY, JSON.stringify(session)); } catch {}
}

export function clearSession() {
  try { localStorage.removeItem(KEY); } catch {}
}

async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return response.json().catch(() => ({ ok: false, error: `Something went wrong (${response.status}).` }));
}

// Re-checks a stored session; the server answers with a fresh cookie when it is still good.
export async function revalidate(session) {
  try {
    if (session.guest) return !!(await post('/api/guest/validate', { token: session.guestToken })).ok;
    // The token rides in headers, never the URL, so proxy and server logs don't keep it.
    const check = await fetch('/api/check', { headers: { 'x-kid-email': session.email, 'x-kid-token': session.t || '' } }).then(r => r.json());
    return check.ok && check.status === 'approved' && !!check.t;
  } catch { return false; }
}

export async function logOut() {
  await post('/api/logout', {}).catch(() => {});
  clearSession();
  location.assign('/');
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const dialog = () => document.getElementById('account-dialog');
const content = () => document.getElementById('account-content');
let state = null;

// Opens the card for signing in. Resolves with the new session once the server says yes.
// opts: mode, message, site (for signup/guest availability), title (the kicker, e.g. the kid's channel),
// onBack (Esc and "All kids" go back to the front door instead of staying put).
export function openAuth(opts = {}) {
  if (state?.resolve) state.resolve = null;
  return new Promise(resolve => {
    state = { ...opts, resolve };
    render(opts.mode || 'login', opts.message || '');
  });
}

// The signed-in card: who you are, the intro switch, switching kids, the dashboard, log out.
// opts: session, title, introLabel + introSkipped + onIntro(skip), onSwitch, dashboard.
export function openProfile(opts = {}) {
  state = { ...opts, profile: true };
  render('profile', '');
}

function modes() {
  const list = [['login', 'Log in']];
  if (state.site?.signupMode !== 'closed') list.push(['signup', 'Sign up']);
  if (state.site?.guestPasses !== false) list.push(['guest', 'Code']);
  return list;
}

function modeSwitch(mode) {
  const nav = el('div', { className: 'account-modes', role: 'group' });
  nav.setAttribute('aria-label', 'How to get in');
  for (const [value, label] of modes()) {
    const tab = el('button', { type: 'button', textContent: label });
    tab.setAttribute('aria-pressed', String(value === mode));
    if (value === mode) tab.setAttribute('aria-current', 'true');
    else tab.addEventListener('click', () => render(value, ''));
    nav.append(tab);
  }
  return nav;
}

function accessForm(box, mode, message) {
  box.append(el('p', { textContent: INTROS[mode] }));
  const form = el('form', { className: 'join-form', noValidate: false });
  FIELDS[mode].forEach(([name, label, type, autocomplete], index) => {
    const input = el('input', { name, type, autocomplete, required: true });
    if (index === 0) input.autofocus = true;
    if (name === 'email' && mode === 'login') { input.autocapitalize = 'none'; input.spellcheck = false; }
    if (name === 'pass') { input.minLength = mode === 'signup' ? 12 : 1; input.maxLength = 128; }
    if (name === 'code') { input.maxLength = 6; input.pattern = '[a-zA-Z0-9]{4}([a-zA-Z0-9]{2})?'; input.autocapitalize = 'characters'; }
    form.append(el('label', { textContent: label }, input));
  });
  const status = el('p', { className: 'form-status', textContent: message });
  status.setAttribute('role', 'status');
  const submit = el('button', { type: 'submit', className: 'block-button', textContent: SUBMITS[mode] });
  form.append(status, submit);
  box.append(form);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = 'One moment…';
    try {
      const body = Object.fromEntries(new FormData(form));
      if (body.email) body.email = body.email.toLowerCase().trim();
      const reply = await post(mode === 'guest' ? '/api/guest/redeem' : mode === 'signup' ? '/api/signup' : '/api/login', body);
      if (!reply.ok) throw Error(reply.error === 'exists' ? 'That account already exists. Try logging in.' : reply.error || 'Could not connect. Try again.');
      if (mode === 'signup') { render('login', 'Request sent. Once a parent approves your account, log in here.'); return; }
      if (mode === 'guest') { finish({ guest: true, guestToken: reply.token, role: 'guest', exp: reply.expires, scope: reply.scope || null }); return; }
      if (reply.status !== 'approved') {
        status.textContent = reply.status === 'pending' ? 'Your account is waiting for a parent to approve it.' : 'This account has not been approved.';
        return;
      }
      // The server answers with the canonical email ("milo" becomes milo@kids.invalid); keep that.
      finish({ email: reply.email || body.email, t: reply.t, role: reply.role, exp: Date.now() + 7 * DAY });
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}

function finish(session) {
  writeSession(session);
  const resolve = state?.resolve;
  state = null;
  if (dialog().open) dialog().close();
  resolve?.(session);
}

function profile(box) {
  const session = state.session || readSession();
  box.append(el('p', { textContent: session?.guest ? 'You are watching with a view-only guest code.' : session?.email?.endsWith('@kids.invalid') ? `Signed in as ${session.email.split('@')[0]}` : session?.email || '' }));
  if (state.introLabel) {
    const toggle = el('input', { type: 'checkbox', checked: !!state.introSkipped });
    toggle.addEventListener('change', () => state.onIntro?.(toggle.checked));
    box.append(el('label', { className: 'account-check' }, toggle, el('span', { textContent: state.introLabel })));
  }
  if (state.onSwitch) {
    const pick = el('button', { type: 'button', className: 'block-button', textContent: 'Switch kid' });
    pick.addEventListener('click', () => { dialog().close(); state.onSwitch(); });
    box.append(pick);
  }
  if (state.dashboard) box.append(el('a', { href: '/parents', className: 'block-button', textContent: 'Open the parent dashboard' }));
  const out = el('button', { type: 'button', className: 'block-button', textContent: 'Log out' });
  out.addEventListener('click', logOut);
  box.append(out);
}

function render(mode, message) {
  const box = content();
  box.replaceChildren();
  if (state.title) box.append(el('p', { className: 'account-kicker', textContent: `${state.title} · ${mode === 'profile' ? 'account' : 'access'}` }));
  if (mode !== 'profile') box.append(modeSwitch(mode));
  box.append(el('h2', { id: 'account-title', textContent: HEADINGS[mode], tabIndex: -1 }));
  if (mode === 'profile') profile(box);
  else accessForm(box, mode, message);

  const footer = el('div', { className: 'account-choices' }, el('a', { href: '/about', textContent: 'About this channel' }));
  if (state.onBack) {
    const back = el('button', { type: 'button', className: 'text-button', textContent: state.backLabel || 'All kids' });
    back.addEventListener('click', goBack);
    footer.append(back);
  } else if (state.profile) {
    const close = el('button', { type: 'button', className: 'text-button', textContent: 'Back to videos' });
    close.addEventListener('click', () => dialog().close());
    footer.append(close);
  }
  box.append(footer);
  const d = dialog();
  if (!d.open) d.showModal();
  // showModal focuses the first control, which would be a mode tab; start at the first field instead.
  (box.querySelector('[autofocus]') || box.querySelector('h2')).focus();
}

function goBack() {
  const back = state?.onBack;
  state = null;
  if (dialog().open) dialog().close();
  back?.();
}

// Esc: the profile closes; a sign-in card goes back to the front door when there is one, and otherwise
// stays, because nothing behind it works without signing in.
export function wireAuthDialog() {
  dialog().addEventListener('cancel', event => {
    if (state?.profile) return;
    event.preventDefault();
    if (state?.onBack) goBack();
  });
}
