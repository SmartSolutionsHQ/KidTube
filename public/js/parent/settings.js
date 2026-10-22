// Settings (owner only): the family, who can watch, how long history is kept, email, and the web address.
// One Save for the page. A setting fixed in the server's environment shows its value and can't change here.
// Changing the web address is its own step: it shows what will happen and the new link before saving.
import { ACCENTS, accentCheck, accentName, addressNotes } from '/setup/helpers.js';
import { loadRegistry } from '/js/shell/themes.js';
import { el, button, primary, field, check, errorLine, setBusy, uid } from './dom.js';
import { mountSlot } from './slots.js';

// The family-settings slot mounted by the latest draw; a redraw ends it first.
let disposeFamily = () => {};

const LOCKED_HINT = 'Set on the server, so it can\'t be changed here.';

function radios(name, legend, options, value, locked) {
  const set = el('fieldset', { class: 'kp-fieldset' }, el('legend', {}, legend));
  for (const [option, label, hint] of options) {
    const input = el('input', { type: 'radio', name, value: option, checked: option === value, disabled: locked });
    set.append(el('label', { class: 'kp-check' }, input, el('span', { class: 'kp-check-text' }, el('span', {}, label), hint ? el('span', { class: 'kp-hint' }, hint) : null)));
  }
  if (locked) set.append(el('p', { class: 'kp-hint' }, LOCKED_HINT));
  return { node: set, value: () => set.querySelector('input:checked')?.value };
}

export async function render(main, ctx) {
  disposeFamily();
  const [data, registry] = await Promise.all([ctx.api.get('/api/admin/settings'), loadRegistry().catch(() => ({ themes: [] }))]);
  const entry = key => data.settings.find(item => item.key === key) || { value: '', locked: false };
  const value = key => entry(key).value;
  const locked = key => entry(key).locked;
  const controls = {};
  const lockNote = key => (locked(key) ? LOCKED_HINT : '');

  const text = (key, attrs = {}) => {
    const input = el('input', { class: 'kp-input', type: 'text', value: value(key) ?? '', disabled: locked(key), ...attrs });
    controls[key] = () => input.value.trim();
    return input;
  };
  const toggle = (key, label, hint) => {
    const row = check(label, locked(key) ? `${hint} ${LOCKED_HINT}` : hint, { checked: !!value(key), disabled: locked(key) });
    controls[key] = () => row.querySelector('input').checked;
    return row;
  };
  const number = key => {
    const input = el('input', { class: 'kp-input', type: 'number', min: '1', max: '3650', step: '1', inputmode: 'numeric', value: String(value(key)), disabled: locked(key) });
    controls[key] = () => Number(input.value);
    return input;
  };

  /* family */
  let accent = value('family_accent');
  const contrast = el('p', { class: 'kd-contrast', 'aria-live': 'polite' });
  const custom = el('input', { type: 'color', value: accent.toLowerCase(), 'aria-label': 'Any color', disabled: locked('family_accent') });
  const swatches = ACCENTS.map(color => {
    const swatch = el('button', { type: 'button', class: 'kp-swatch', 'aria-label': color.label, title: color.label, disabled: locked('family_accent') });
    swatch.style.setProperty('--kp-swatch', color.hex);
    swatch.addEventListener('click', () => setAccent(color.hex));
    return swatch;
  });
  function setAccent(hex) {
    accent = hex;
    swatches.forEach((swatch, i) => swatch.setAttribute('aria-pressed', String(ACCENTS[i].hex.toLowerCase() === hex.toLowerCase())));
    const result = accentCheck(hex);
    contrast.className = `kd-contrast ${result.ok ? 'kp-ok' : 'kp-error'}`;
    contrast.textContent = `${accentName(hex)}. ${result.message}`;
  }
  for (const type of ['input', 'change']) custom.addEventListener(type, () => setAccent(custom.value.toUpperCase()));
  setAccent(accent);
  controls.family_accent = () => accent;

  const gate = el('select', { class: 'kp-input kd-select', disabled: locked('gate_theme') },
    ...registry.themes.filter(theme => (theme.modes || ['gate']).includes('gate')).map(theme => el('option', { value: theme.id }, theme.name)));
  gate.value = value('gate_theme');
  controls.gate_theme = () => gate.value;

  const signup = radios('signup_mode', 'New viewers', [
    ['approval', 'Can ask to join', 'You approve each one before they can watch.'],
    ['closed', 'Not taking new ones', 'The sign-up form is closed. Guest codes still work if they are on.'],
  ], value('signup_mode'), locked('signup_mode'));
  controls.signup_mode = signup.value;
  const comments = radios('comments_default', 'Comments', [
    ['review', 'You review first', 'New comments wait on the Comments tab.'],
    ['open', 'Show right away', 'You can still hide or delete any comment.'],
    ['off', 'Off', 'No new comments.'],
  ], value('comments_default'), locked('comments_default'));
  controls.comments_default = comments.value;
  const reviewDefault = radios('review_uploads_default', 'New kids\' uploads', [
    ['creators', 'Wait for review', 'Each kid added from now on starts with review turned on.'],
    ['none', 'Go live right away', 'You can turn review on per kid on the Kids tab.'],
  ], value('review_uploads_default'), locked('review_uploads_default'));
  controls.review_uploads_default = reviewDefault.value;

  /* email */
  const mail = radios('mail_mode', 'Email', [
    ['disabled', 'No email', 'Everything still works; you check the dashboard yourself.'],
    ['brevo', 'Send email through Brevo', 'Sign-up requests come to you, and new videos go to viewers who want them.'],
  ], value('mail_mode'), locked('mail_mode'));
  controls.mail_mode = mail.value;
  const key = el('input', { class: 'kp-input kp-input-mono', type: 'password', autocomplete: 'off', placeholder: value('brevo_api_key') ? 'Saved. Paste a new key to replace it.' : '', disabled: locked('brevo_api_key') });
  controls.brevo_api_key = () => key.value.trim();
  const testResult = el('p', { class: 'kp-small', 'aria-live': 'polite' });
  const test = button('Send a test email', async () => {
    const done = setBusy(test, 'Sending');
    try { const result = await ctx.api.post('/api/admin/settings/email-test'); testResult.textContent = `Sent a test to ${result.to}. Check that inbox.`; }
    catch (problem) { testResult.textContent = problem.message; }
    done();
  });

  const mailFields = el('div', { class: 'kp-grid-2' },
    field('Brevo API key', key, lockNote('brevo_api_key')),
    field('Send from', text('sender_email', { type: 'email', autocomplete: 'off' }), lockNote('sender_email') || 'An address you verified in Brevo.'),
    field('Send notices to', text('notify_email', { type: 'email', autocomplete: 'email' }), lockNote('notify_email') || 'Where sign-up requests go.'),
    el('div', { class: 'kp-stack-tight' }, el('p', { class: 'kp-small' }, 'Save first, then send a test to the notice address.'), el('div', { class: 'kd-buttons' }, test), testResult));
  const syncMail = () => { mailFields.hidden = mail.value() !== 'brevo'; };
  mail.node.addEventListener('change', syncMail);
  syncMail();
  /* save */
  const error = errorLine('kd-settings-error');
  const save = primary('Save changes', null, { type: 'submit' });
  const form = el('form', { class: 'kp-stack', novalidate: true });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    if (!accentCheck(accent).ok) { error.textContent = 'That family color is hard to read on the dark screens. Pick a lighter one.'; return; }
    const values = {};
    for (const [name, read] of Object.entries(controls)) if (!locked(name)) values[name] = read();
    if (!values.brevo_api_key) delete values.brevo_api_key;
    const done = setBusy(save, 'Saving');
    try {
      const result = await ctx.api.post('/api/admin/settings', { values });
      done();
      key.value = '';
      await ctx.refresh();
      ctx.say(result.skipped.length ? `Saved. Some settings are fixed on the server and stayed as they were.` : 'Saved.');
    } catch (problem) { done(); error.textContent = problem.message; }
  });

  const section = (title, ...children) => el('section', { class: 'kd-section kp-panel kd-upload' }, el('h2', { class: 'kp-heading' }, title), ...children);
  form.append(
    section('Family',
      el('div', { class: 'kp-grid-2' }, field('Family name', text('site_name', { maxlength: '60', required: true }), lockNote('site_name')),
        field('Tagline', text('site_tagline', { maxlength: '120' }), lockNote('site_tagline'))),
      el('fieldset', { class: 'kp-fieldset kd-field-group' }, el('legend', {}, 'Family color'),
        el('div', { class: 'kp-swatches' }, ...swatches, el('span', { class: 'kp-swatch kp-swatch-custom', title: 'Any color' }, custom)), contrast),
      field('Front door splash', gate, lockNote('gate_theme') || 'What visitors see before they pick a kid.'),
      toggle('splash_sound', 'Play the splash sound', 'Only after someone taps the splash, never on its own.')),
    section('Who can watch',
      toggle('kids_public', 'Show kids\' names and badges on the front door', 'Off: visitors see the family splash until they sign in.'),
      signup.node,
      toggle('guest_passes', 'Allow guest codes', 'One-time codes for people without an account.'),
      comments.node, reviewDefault.node),
    section('History',
      el('p', { class: 'kp-small' }, 'Parents can see who watched what. Viewers are told so when they sign up. Older records are deleted on their own.'),
      el('div', { class: 'kp-grid-2' },
        field('Keep watch history for (days)', number('views_retention_days'), lockNote('views_retention_days')),
        field('Keep activity for (days)', number('activity_retention_days'), lockNote('activity_retention_days')))),
    section('Email', mail.node, mailFields),
    error, el('div', {}, save));

  /* the web address: its own step, because the dashboard moves with it */
  const current = value('site_url') || location.origin;
  const address = el('input', { class: 'kp-input kp-input-mono', type: 'url', autocomplete: 'off', value: current, disabled: locked('site_url') });
  const notes = el('div', { class: 'kp-stack-tight', 'aria-live': 'polite' });
  const moveError = errorLine('kd-address-error');
  const checkAddress = button('Check the new address', () => {
    moveError.textContent = '';
    const raw = address.value.trim();
    const found = addressNotes(raw, { production: data.production, current });
    const bad = found.find(item => item.level === 'bad');
    notes.replaceChildren(...found.filter(item => !/setup carries on/.test(item.text)).map(item => el('p', { class: `kp-note${item.level === 'info' ? '' : ` kp-note-${item.level}`}` }, item.text)));
    if (bad) return;
    const origin = new URL(raw).origin;
    if (origin === current) { notes.append(el('p', { class: 'kp-small' }, 'That is the address already in use.')); return; }
    const link = `${origin}/parents`;
    const confirmId = uid('kd-move');
    const confirm = button(`Move to ${origin}`, async () => {
      const done = setBusy(confirm, 'Saving');
      try {
        await ctx.api.post('/api/admin/settings', { values: { site_url: origin } });
        done();
        notes.replaceChildren(el('p', { class: 'kp-note kp-note-good', tabindex: '-1' }, 'Saved. Changes now only work from the new address. ',
          el('a', { href: link }, `Open ${link}`), ' and sign in there once.'));
        notes.querySelector('p').focus();
      } catch (problem) { done(); moveError.textContent = problem.message; }
    }, { class: 'kp-btn kp-btn-small kd-btn-danger', id: confirmId });
    notes.append(el('p', { class: 'kp-note kp-note-warn' },
      `Links in emails, guest-code cards and phones' home-screen icons will use the new address. After you move, this page stops saving changes until you open the dashboard at the new link, ${link}, and sign in there. Make sure that address reaches this server first.`),
    el('div', { class: 'kd-buttons' }, confirm));
  });

  const familySlot = el('div', { class: 'kd-section' });
  main.replaceChildren(
    el('div', { class: 'kd-head' }, el('h1', { class: 'kp-title', tabindex: '-1' }, 'Settings'),
      el('p', { class: 'kp-lead' }, 'How the family\'s site looks and who can use it.')),
    form,
    el('section', { class: 'kd-section kp-panel kd-upload' }, el('h2', { class: 'kp-heading' }, 'Web address'),
      el('p', { class: 'kp-small' }, `Now: ${current}`),
      locked('site_url') ? el('p', { class: 'kp-note' }, `${LOCKED_HINT} Change SITE_URL where the app is installed.`)
        : el('div', { class: 'kp-stack-tight' }, field('New address', address, 'The full address people type, like https://videos.example.com.'), el('div', {}, checkAddress), notes, moveError)),
    familySlot);
  disposeFamily = mountSlot(familySlot, 'family-settings', { api: ctx.api, say: ctx.say, refresh: () => render(main, ctx), role: ctx.role });
}
