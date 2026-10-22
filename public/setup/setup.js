// The setup wizard. Everything it shows comes from GET /api/setup/state, so a refresh (or another
// device, after signing in) lands on the same step. Steps 1 and 2 claim the install with the one-time
// code; every later step saves with the owner's normal session.
import { STEP_NAMES, addressNotes, badgeText, codeComplete, formatCode, initials, parentPassword } from './helpers.js';
import { renderKids } from './kids.js';
import { badgeImage, el, field, check, note, errorLine, setBusy } from './ui.js';
import { saveFamilyBadge } from '/js/badge/save.js';
import { createBadgeBuilder } from '/js/badge/builder.js';
import { INK } from '/js/badge/spec.js';

const DAY = 86400000;
const SESSION = 'kid-session';
const $ = id => document.getElementById(id);
const body = $('su-body');

let state = null;
let step = 1;
let code = '';
let account = {};
let firstPaint = true;
let cleanup = () => {};

function session() {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION) || 'null');
    return value?.email && value?.t && value.exp > Date.now() ? value : null;
  } catch { return null; }
}

function keepSession({ email, t, role }) {
  localStorage.setItem(SESSION, JSON.stringify({ email, t, role, exp: Date.now() + 7 * DAY }));
}

const auth = () => { const value = session(); return value ? { email: value.email, t: value.t } : null; };

export async function api(path, { method = 'GET', body: payload } = {}) {
  const headers = {};
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  const who = auth();
  if (who) { headers['X-Kid-Email'] = who.email; headers['X-Kid-Token'] = who.t; }
  let response;
  try {
    response = await fetch(path, { method, headers, credentials: 'same-origin', body: payload === undefined ? undefined : JSON.stringify(payload) });
  } catch {
    return { status: 0, data: { ok: false, error: "Can't reach the server. Check that it is still running, then try again." } };
  }
  const data = await response.json().catch(() => ({ ok: false, error: `The server answered ${response.status}. Try again.` }));
  return { status: response.status, data };
}

async function loadState() {
  const { data } = await api('/api/setup/state');
  if (!data.ok) throw new Error(data.error || 'Setup is not available.');
  state = data;
  return state;
}

/* ---------- frame: rail, count, progress ---------- */

function navigable(number) {
  if (!state || !['wizard', 'done'].includes(state.stage)) return false;
  return number >= 3 && number <= (state.stage === 'done' ? 7 : state.reached);
}

function paintFrame() {
  const list = $('su-steps');
  list.replaceChildren(...STEP_NAMES.map((name, index) => {
    const number = index + 1;
    const current = number === step;
    const done = number < step || (state?.stage === 'done') || (state?.reached > number && number >= 3) || (number <= 2 && state?.stage !== 'code');
    const inner = [el('span', { class: 'su-num' }, String(number)), name];
    const item = navigable(number) && !current
      ? el('a', { href: `#step-${number}` }, ...inner)
      : el('span', { class: 'su-step' }, ...inner);
    if (current) item.setAttribute('aria-current', 'step');
    return el('li', { class: done && !current ? 'su-done' : '' }, item);
  }));
  $('su-count').textContent = `Step ${step} of ${STEP_NAMES.length}`;
  $('su-bar').style.width = `${(step / STEP_NAMES.length) * 100}%`;
}

function show(number, view) {
  cleanup();
  cleanup = view.cleanup || (() => {});
  step = number;
  if (navigable(number) && location.hash !== `#step-${number}`) history.replaceState(null, '', `#step-${number}`);
  paintFrame();
  const title = el('h1', { class: 'kp-title', tabindex: '-1' }, view.title);
  body.replaceChildren(el('div', { class: 'su-intro' }, title, view.lead ? el('p', { class: 'kp-lead' }, view.lead) : null), ...view.content);
  document.title = `${view.title} · Set up ${state?.brand?.name || ''}`.trim();
  if (!firstPaint) { title.focus(); window.scrollTo(0, 0); }
  firstPaint = false;
}

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

/* ---------- step 1: the setup code ---------- */

function codeStep(message = '') {
  const input = el('input', {
    class: 'kp-input su-code-input', id: 'su-code', name: 'code', autocomplete: 'one-time-code', autocapitalize: 'characters',
    spellcheck: 'false', inputmode: 'text', placeholder: 'KT-XXXXX-XXXXX-XXXXX-XXXXX', value: code, 'aria-describedby': 'su-code-error',
  });
  input.addEventListener('input', () => {
    const at = input.selectionStart === input.value.length;
    input.value = formatCode(input.value);
    if (at) input.setSelectionRange(input.value.length, input.value.length);
    input.removeAttribute('aria-invalid');
  });
  const error = errorLine('su-code-error', message);
  const submit = primary('Continue');
  if (state.disabled) {
    input.disabled = true;
    submit.disabled = true;
    error.textContent = 'This setup code was turned off after too many wrong tries. Restart the app, then use the new code it prints.';
  }
  const where = el('ul', { class: 'su-where kp-list' },
    el('li', {}, 'In the terminal where you started it, on the line that starts with "Setup code".'),
    el('li', {}, 'With Docker, run ', el('code', {}, 'docker logs kidtube'), ' and look for the newest "Setup code" line.'),
    el('li', {}, 'In the file ', el('code', {}, state.tokenFile || 'data/setup-token'), ' on the server.'));
  const terminal = el('pre', { class: 'su-terminal', 'aria-hidden': 'true' },
    'Ready for setup.\nOpen ', `${location.origin}/setup`, '\nSetup code: ', el('mark', {}, 'KT-XXXXX-XXXXX-XXXXX-XXXXX'),
    '\nThe code works once and changes every restart until setup is done.');

  return {
    title: 'Enter your setup code',
    lead: 'The setup code proves you are the one who started this install. It works once.',
    content: [form(async () => {
      if (!codeComplete(input.value)) {
        input.setAttribute('aria-invalid', 'true');
        error.textContent = 'The code has four groups of five letters and numbers after KT.';
        input.focus();
        return;
      }
      const done = setBusy(submit, 'Checking');
      const { status, data } = await api('/api/setup/verify', { method: 'POST', body: { code: input.value } });
      done();
      if (data.ok) { code = input.value; go(2); return; }
      if (status === 410) { await refresh(); return; }
      if (status === 423) state.disabled = true;
      input.setAttribute('aria-invalid', 'true');
      error.textContent = data.error;
      if (status === 423) { input.disabled = true; submit.disabled = true; } else input.focus();
    },
    field('Setup code', input),
    error,
    el('details', { class: 'kp-stack-tight' },
      el('summary', { class: 'kp-small' }, 'Where do I find it?'),
      el('div', { class: 'kp-stack' }, where, terminal,
        el('p', { class: 'kp-small' }, 'The code changes every time the app restarts, so use the newest one.'))),
    el('div', { class: 'kp-actions kp-actions-end' }, submit))],
  };
}

/* ---------- step 2: the parent account ---------- */

function accountStep(message = '') {
  const first = el('input', { class: 'kp-input', name: 'first', autocomplete: 'given-name', value: account.first || '', required: '' });
  const last = el('input', { class: 'kp-input', name: 'last', autocomplete: 'family-name', value: account.last || '' });
  const email = el('input', { class: 'kp-input', name: 'email', type: 'email', autocomplete: 'email', inputmode: 'email', value: account.email || '', required: '' });
  const pass = el('input', { class: 'kp-input', name: 'pass', type: 'password', autocomplete: 'new-password', minlength: '12', value: account.pass || '', 'aria-describedby': 'su-pass-hint', required: '' });
  const reveal = secondary('Show', () => {
    const hidden = pass.type === 'password';
    pass.type = hidden ? 'text' : 'password';
    reveal.textContent = hidden ? 'Hide' : 'Show';
  }, { class: 'kp-btn kp-btn-small', 'aria-controls': 'su-pass' });
  pass.id = 'su-pass';
  const made = el('div', { class: 'su-secret', hidden: '' });
  const generate = secondary('Make one for me', () => {
    const value = parentPassword();
    pass.value = value;
    pass.type = 'text';
    reveal.textContent = 'Hide';
    const copy = secondary('Copy', async () => {
      try { await navigator.clipboard.writeText(value); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select it and copy'; }
    }, { class: 'kp-btn kp-btn-small' });
    made.replaceChildren(el('span', {}, value), copy);
    made.hidden = false;
  }, { class: 'kp-btn kp-btn-small' });
  const error = errorLine('su-account-error', message);
  const submit = primary('Continue');

  return {
    title: 'Your parent account',
    lead: 'You sign in with this to approve viewers, review uploads and change settings. A second parent can join later.',
    content: [form(async () => {
      account = { first: first.value.trim(), last: last.value.trim(), email: email.value.trim(), pass: pass.value };
      const problem = !account.first ? [first, 'Add your first name.']
        : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(account.email) ? [email, 'Use your email address.']
          : account.pass.length < 12 ? [pass, 'Use a password of at least 12 characters.'] : null;
      if (problem) { problem[0].setAttribute('aria-invalid', 'true'); problem[0].focus(); error.textContent = problem[1]; return; }
      const done = setBusy(submit, 'Creating your account');
      const { status, data } = await api('/api/setup/claim', { method: 'POST', body: { code, ...account } });
      done();
      if (data.ok) {
        keepSession(data);
        account = {};
        code = '';
        await refresh();
        return;
      }
      if (status === 403 || status === 423) { code = ''; show(1, codeStep(data.error)); return; }
      if (status === 409 || status === 410) { await refresh(); return; }
      error.textContent = data.error;
    },
    el('div', { class: 'kp-grid-2' }, field('First name', first), field('Last name', last)),
    field('Email', email, 'Used to sign in. Nothing is sent unless you turn email on later.'),
    el('div', { class: 'kp-field' },
      el('label', { for: 'su-pass' }, 'Password'),
      el('div', { class: 'kp-input-row' }, pass, reveal),
      el('span', { class: 'kp-hint', id: 'su-pass-hint' }, 'At least 12 characters. A password manager can keep it for you.')),
    el('div', { class: 'kp-actions' }, generate),
    made,
    error,
    el('div', { class: 'kp-actions' }, secondary('Back', () => go(1)), submit))],
  };
}

/* ---------- signed out after the claim ---------- */

function signinStep(message = '') {
  const email = el('input', { class: 'kp-input', type: 'email', autocomplete: 'username', inputmode: 'email', required: '' });
  const pass = el('input', { class: 'kp-input', type: 'password', autocomplete: 'current-password', required: '' });
  const error = errorLine('su-signin-error', message);
  const submit = primary('Sign in');
  return {
    title: 'Finish setting up',
    lead: 'Setup has started on this install. Sign in with the parent account to carry on where you left off.',
    content: [form(async () => {
      const done = setBusy(submit, 'Signing in');
      const { data } = await api('/api/login', { method: 'POST', body: { email: email.value, pass: pass.value } });
      done();
      if (!data.ok || data.status !== 'approved') { error.textContent = data.error || 'Wrong email or password.'; return; }
      if (data.role !== 'super') { error.textContent = 'This account cannot finish setup. Sign in with the parent account that started it.'; return; }
      keepSession(data);
      await refresh();
    }, field('Email', email), field('Password', pass), error, el('div', { class: 'kp-actions kp-actions-end' }, submit))],
  };
}

function finishedStep() {
  return {
    title: 'This install is set up',
    lead: 'Setup is finished. Parents sign in from the front door or the parent dashboard.',
    content: [el('div', { class: 'kp-actions' },
      el('a', { class: 'kp-btn', href: '/parents' }, 'Parent dashboard'),
      el('a', { class: 'kp-btn kp-btn-primary', href: '/' }, 'Go to the front door'))],
  };
}

/* ---------- step 3: family name, web address and badge ---------- */

const defaultFamilyBadge = (name, accent) => ({
  v: 1, shape: 'circle', bg: accent || '#FF5C2B',
  text: { value: badgeText(initials(name), 3) || 'TV', font: 'anton', color: INK },
  stickers: [], effects: { rgbSplit: false, outline: true, tilt: false, shadow: false },
});

function familyStep() {
  const family = state.family;
  const name = el('input', { class: 'kp-input', id: 'su-family', autocomplete: 'off', maxlength: '60', value: family.name || '', placeholder: 'The Okafor Tapes' });
  const tagline = el('input', { class: 'kp-input', maxlength: '120', value: family.tagline || '' });
  const url = el('input', { class: 'kp-input', type: 'url', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', value: family.siteUrl || location.origin });
  for (const [input, key] of [[name, 'name'], [tagline, 'tagline'], [url, 'siteUrl']]) {
    if (family.locked[key]) { input.readOnly = true; input.setAttribute('aria-describedby', `su-locked-${key}`); }
  }
  const lockedHint = key => family.locked[key] ? el('span', { class: 'kp-hint', id: `su-locked-${key}` }, 'Set in the server\'s settings file, so it can\'t be changed here.') : null;
  const notes = el('div', { class: 'kp-stack-tight', 'aria-live': 'polite' });
  const paintNotes = () => notes.replaceChildren(...addressNotes(url.value, { production: state.production, current: location.origin })
    .map(item => note(item.text, item.level)));
  url.addEventListener('input', paintNotes);
  paintNotes();

  // The family badge starts from the initials and follows the name until the parent edits it.
  let spec = family.badge || defaultFamilyBadge(family.name, family.accent);
  let edited = !!family.badge;
  let builder = null;
  const art = el('div', { class: 'su-badge-art' });
  const paintBadge = () => badgeImage(spec).then(image => art.replaceChildren(image));
  paintBadge();
  const builderHost = el('div', { class: 'su-builder', hidden: '' });
  const toggle = secondary('Edit badge', async () => {
    if (!builder) {
      builder = createBadgeBuilder(builderHost, {
        spec, names: [initials(name.value)], note: 'This becomes the app icon on phones',
        label: 'Family badge builder', onChange(next) { spec = next; edited = true; paintBadge(); },
      });
    }
    builderHost.hidden = !builderHost.hidden;
    toggle.textContent = builderHost.hidden ? 'Edit badge' : 'Hide badge builder';
    toggle.setAttribute('aria-expanded', String(!builderHost.hidden));
  }, { 'aria-expanded': 'false', class: 'kp-btn kp-btn-small' });
  name.addEventListener('input', () => {
    if (edited) return;
    spec = defaultFamilyBadge(name.value, family.accent);
    builder?.setSpec(spec);
    paintBadge();
  });

  const error = errorLine('su-family-error');
  const submit = primary('Continue');
  return {
    title: 'Your family',
    lead: 'This names the channel on every screen and on the phone home screen.',
    cleanup: () => builder?.destroy(),
    content: [form(async () => {
      if (!name.value.trim() && !family.locked.name) { name.setAttribute('aria-invalid', 'true'); name.focus(); error.textContent = 'Add a family name.'; return; }
      const blocking = addressNotes(url.value, { production: state.production }).find(item => item.level === 'bad');
      if (blocking && !family.locked.siteUrl) { url.setAttribute('aria-invalid', 'true'); url.focus(); error.textContent = blocking.text; return; }
      const done = setBusy(submit, 'Saving');
      const payload = { name: name.value, tagline: tagline.value };
      if (!family.locked.siteUrl) payload.siteUrl = url.value.trim();
      const { data } = await api('/api/setup/family', { method: 'POST', body: payload });
      if (!data.ok) { done(); error.textContent = data.error; return; }
      try {
        await saveFamilyBadge(spec, auth());
      } catch (problem) {
        done();
        error.textContent = `Saved the name, but not the badge: ${problem.message}`;
        return;
      }
      done();
      // The browser's origin check follows the saved address, so setup has to carry on there.
      if (data.siteUrl && data.siteUrl !== location.origin) { location.assign(`${data.siteUrl}/setup#step-4`); return; }
      await refresh(4);
    },
    field('Family name', name, 'For example, the name of your family channel.', lockedHint('name')),
    field('Tagline', tagline, 'One short line under the name.', lockedHint('tagline')),
    el('div', { class: 'kp-field' },
      el('label', { for: 'su-url' }, 'Web address'), Object.assign(url, { id: 'su-url' }),
      lockedHint('siteUrl') || el('span', { class: 'kp-hint' }, 'The address family members type to reach this. Links in emails use it too.')),
    notes,
    el('div', { class: 'su-section' },
      el('span', { class: 'su-section-label' }, 'Family badge'),
      el('div', { class: 'su-badge' }, art,
        el('div', { class: 'kp-stack-tight' },
          el('p', { class: 'kp-small' }, 'Made from your initials. It becomes the app icon when someone adds it to a phone.'),
          el('div', {}, toggle))),
      builderHost),
    error,
    el('div', { class: 'kp-actions kp-actions-end' }, submit))],
  };
}

/* ---------- step 5: who can watch ---------- */

function watchStep() {
  const watch = state.watch;
  const lock = key => watch.locked[key] ? { disabled: '' } : {};
  const front = check('Show kids\' names and badges on the front door', 'Visitors see who has a channel before signing in. Videos always need a sign-in.', { checked: watch.kidsPublic, ...lock('kidsPublic') });
  const radio = (group, value, label, hint, current, locked) => check(label, hint, { type: 'radio', name: group, value, checked: current === value, ...(locked ? { disabled: '' } : {}) });
  const viewers = el('fieldset', { class: 'kp-fieldset' }, el('legend', {}, 'New viewers'),
    radio('signup', 'approval', 'They ask, and you approve each one', 'Grandparents, friends and cousins ask from the front door. Nobody watches until you say yes.', watch.signupMode, watch.locked.signupMode),
    radio('signup', 'closed', 'No new viewers for now', 'Only accounts you already approved can sign in.', watch.signupMode, watch.locked.signupMode));
  const guests = check('Guest codes', 'Make a one-time code that lets someone watch for 24 hours without an account.', { checked: watch.guestPasses, ...lock('guestPasses') });
  const comments = el('fieldset', { class: 'kp-fieldset' }, el('legend', {}, 'Comments'),
    radio('comments', 'review', 'You read each comment first', 'Comments wait until you show them. Recommended.', watch.comments, watch.locked.comments),
    radio('comments', 'open', 'Comments show right away', 'You can still hide or delete any comment.', watch.comments, watch.locked.comments),
    radio('comments', 'off', 'No comments', 'Viewers can still leave a heart.', watch.comments, watch.locked.comments));
  const error = errorLine('su-watch-error');
  const submit = primary('Continue');
  const anyLocked = Object.values(watch.locked).some(Boolean);
  return {
    title: 'Who can watch',
    lead: 'You can change all of this later in the parent dashboard. Parents can see who watched what.',
    content: [form(async node => {
      const done = setBusy(submit, 'Saving');
      const { data } = await api('/api/setup/watch', {
        method: 'POST', body: {
          kidsPublic: front.querySelector('input').checked, guestPasses: guests.querySelector('input').checked,
          signupMode: node.querySelector('input[name="signup"]:checked')?.value, comments: node.querySelector('input[name="comments"]:checked')?.value,
        },
      });
      done();
      if (!data.ok) { error.textContent = data.error; return; }
      await refresh(6);
    }, front, viewers, guests, comments,
    anyLocked ? note('Some choices are set in the server\'s settings file, so they can\'t be changed here.', 'info') : null,
    error, el('div', { class: 'kp-actions' }, secondary('Back', () => go(4)), submit))],
  };
}

/* ---------- step 6: email ---------- */

function emailStep() {
  const mail = state.email;
  const off = check('No email for now', 'You check the parent dashboard for requests and uploads.', { type: 'radio', name: 'mode', value: 'disabled', checked: mail.mode !== 'brevo' });
  const on = check('Send email with Brevo', 'Tells you when someone asks to watch, and tells viewers about new videos. Brevo\'s free plan is enough.', { type: 'radio', name: 'mode', value: 'brevo', checked: mail.mode === 'brevo' });
  const key = el('input', { class: 'kp-input', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: mail.keySet ? 'Saved. Leave empty to keep it.' : '' });
  const sender = el('input', { class: 'kp-input', type: 'email', inputmode: 'email', value: mail.sender || '' });
  const notify = el('input', { class: 'kp-input', type: 'email', inputmode: 'email', value: mail.notify || state.owner.email });
  const details = el('div', { class: 'kp-stack' },
    field('Brevo API key', key, 'In Brevo: Settings, then SMTP and API, then API keys.'),
    field('Send from', sender, 'An address you verified as a sender in Brevo.'),
    field('Send parent notices to', notify));
  const status = el('p', { class: 'kp-small', 'aria-live': 'polite' });
  const testButton = secondary('Send a test email', async () => {
    const saved = await save();
    if (!saved) return;
    const done = setBusy(testButton, 'Sending');
    const { data } = await api('/api/setup/email/test', { method: 'POST', body: {} });
    done();
    status.className = data.ok ? 'kp-small kp-ok' : 'kp-error';
    status.textContent = data.ok ? `Sent to ${data.to}. Check that inbox (and its spam folder).` : data.error;
  });
  const sync = () => {
    const brevo = on.querySelector('input').checked;
    details.hidden = !brevo;
    testButton.hidden = !brevo;
  };
  for (const option of [off, on]) option.querySelector('input').addEventListener('change', sync);
  if (mail.locked) for (const input of [off, on].map(option => option.querySelector('input')).concat([key, sender, notify])) input.disabled = true;
  sync();
  const error = errorLine('su-email-error');
  async function save() {
    if (mail.locked) return true;
    const brevo = on.querySelector('input').checked;
    const { data } = await api('/api/setup/email', {
      method: 'POST', body: brevo ? { mode: 'brevo', key: key.value, sender: sender.value, notify: notify.value } : { mode: 'disabled' },
    });
    error.textContent = data.ok ? '' : data.error;
    if (data.ok && key.value) { key.value = ''; key.placeholder = 'Saved. Leave empty to keep it.'; state.email.keySet = true; }
    return data.ok;
  }
  const submit = primary('Continue');
  return {
    title: 'Email, if you want it',
    lead: 'Optional. Everything works without email; you can turn it on later.',
    content: [form(async () => {
      const done = setBusy(submit, 'Finishing setup');
      if (!await save()) { done(); return; }
      const { data } = await api('/api/setup/complete', { method: 'POST', body: {} });
      done();
      if (!data.ok) { error.textContent = data.error; return; }
      await refresh(7);
    }, el('fieldset', { class: 'kp-fieldset' }, el('legend', { class: 'tz-sr' }, 'Email'), off, on),
    mail.locked ? note('Email is set in the server\'s settings file, so it can\'t be changed here.', 'info') : null,
    details, el('div', {}, testButton), status, error,
    el('div', { class: 'kp-actions' }, secondary('Back', () => go(5)), submit))],
  };
}

/* ---------- step 7: done ---------- */

function doneStep() {
  const site = state.family.siteUrl || location.origin;
  const secure = site.startsWith('https:');
  const kids = state.kids.filter(kid => !kid.placeholder);
  const logins = kids.filter(kid => kid.login);
  const phone = (heading, steps) => el('section', {}, el('h2', { class: 'kp-heading' }, heading),
    el('ol', { class: 'kp-steps-list' }, ...steps.map(text => el('li', {}, text))));
  return {
    title: 'You\'re set up',
    lead: 'Put it on your phone so it opens like an app, then add the first video.',
    content: [
      el('div', { class: 'su-phones' },
        phone('iPhone or iPad', [`Open ${site} in Safari.`, 'Tap the Share button.', 'Tap Add to Home Screen, then Add.']),
        phone('Android', [`Open ${site} in Chrome.`, 'Tap the menu (three dots).', 'Tap Install app or Add to Home screen.'])),
      el('p', { class: 'kp-small' }, 'Or open ', el('a', { href: '/install' }, `${site}/install`),
        ' on the phone. It shows the steps for that phone, and an install button where the browser offers one.'),
      el('p', { class: 'kp-small' }, 'On iPhone and iPad the home-screen app keeps its own sign-in, so sign in once more the first time it opens.'),
      secure ? null : note('Phones only install it from an https:// address. Until then it works in the phone\'s browser. docs/INSTALL.md shows how to add HTTPS.', 'warn'),
      logins.length ? el('section', { class: 'kp-stack-tight' },
        el('h2', { class: 'kp-heading' }, 'Kid logins'),
        el('ul', { class: 'kp-list' }, ...logins.map(kid => el('li', {}, `${kid.name} signs in as `, el('code', {}, kid.login), '.'))),
        el('p', { class: 'kp-small' }, 'Kids type their login name and the password you set. Their uploads wait for you when review is on.')) : null,
      el('div', { class: 'kp-actions' },
        el('a', { class: 'kp-btn', href: '/' }, 'See the front door'),
        el('a', { class: 'kp-btn kp-btn-primary', href: '/parents' }, 'Upload the first video')),
      el('p', { class: 'kp-small' }, 'Uploads, approvals and guest codes live in the parent dashboard at /parents.'),
    ],
  };
}

/* ---------- routing ---------- */

function view(number) {
  switch (number) {
    case 3: return familyStep();
    case 4: return renderKids({ state, api, auth, refresh, go, primary, secondary, form });
    case 5: return watchStep();
    case 6: return emailStep();
    default: return doneStep();
  }
}

function go(number) {
  if (!state) return;
  if (state.stage === 'code') { show(number === 2 && code ? 2 : 1, number === 2 && code ? accountStep() : codeStep()); return; }
  if (state.stage === 'signin') { show(2, signinStep()); return; }
  if (state.stage === 'finished') { show(7, finishedStep()); return; }
  const target = navigable(number) ? number : state.stage === 'done' ? 7 : state.reached;
  show(target, view(target));
}

async function refresh(target) {
  try {
    await loadState();
  } catch (error) {
    body.replaceChildren(note(error.message, 'bad'));
    return;
  }
  const fromHash = Number(/^#step-(\d)$/.exec(location.hash)?.[1]);
  go(target || fromHash || (state.stage === 'done' ? 7 : state.reached || 1));
}

window.addEventListener('hashchange', () => {
  const number = Number(/^#step-(\d)$/.exec(location.hash)?.[1]);
  if (number && number !== step && navigable(number)) go(number);
});

refresh();
