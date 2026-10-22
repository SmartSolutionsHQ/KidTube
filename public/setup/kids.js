// Step 4: add your kids. Each kid is a channel with a name, a channel line, an accent, a badge (the badge
// builder), a splash screen (the theme gallery), upload review and an optional login. Saving creates the
// channel first, then saves the badge against it; the first kid takes over the install's channel 1.
// The public demo reuses this step with `basic` (no upload review or login, which a visitor can't keep)
// and `maxKids` (the visitor's limit); the wizard passes neither.
import { ACCENTS, accentCheck, accentName, badgeText, handleFrom, kidPassword } from './helpers.js';
import { badgeImage, check, el, errorLine, field, setBusy } from './ui.js';
import { createBadgeBuilder } from '/js/badge/builder.js';
import { saveChannelBadge } from '/js/badge/save.js';
import { INK } from '/js/badge/spec.js';
import { createThemeGallery } from '/js/shell/theme-gallery.js';
import { loadRegistry } from '/js/shell/themes.js';

const HANDLE = /^[a-z][a-z0-9-]{1,23}$/;
const DEFAULT_THEME = 'ember-tape';
// Set when "Add another kid" saves one kid, so the redrawn step opens a blank form for the next.
let openBlank = false;

const defaultBadge = (name, accent) => ({
  v: 1, shape: 'circle', bg: accent, text: { value: badgeText(name), font: 'anton', color: INK },
  stickers: [], effects: { rgbSplit: false, outline: true, tilt: false, shadow: false },
});

export function renderKids({ state, api, auth, refresh, go, primary, secondary, form, basic = false, maxKids = Infinity }) {
  const kids = state.kids.filter(kid => !kid.placeholder);
  const disposers = new Set();
  const themeNames = new Map();
  const listHost = el('div', { class: 'su-kids' });
  const editorHost = el('div', {});
  const stepError = errorLine('su-kids-error');
  let editor = null;

  loadRegistry().then(registry => {
    for (const theme of registry.themes) themeNames.set(theme.id, theme.name);
    paintList();
  });

  function summary(kid) {
    return [
      themeNames.get(kid.themeId) || kid.themeId || 'Family splash',
      accentName(kid.accent || state.family.accent),
      kid.login ? `logs in as ${kid.login}` : 'no login',
      kid.reviewUploads ? 'uploads reviewed' : 'uploads go live',
    ].join(' · ');
  }

  function paintList() {
    listHost.replaceChildren(...kids.map(kid => {
      const art = el('span', { class: 'su-kid-badge' });
      if (kid.logoUrl) art.append(el('img', { src: kid.logoUrl, alt: '', width: 52, height: 52 }));
      else if (kid.badge) badgeImage(kid.badge, { size: 52 }).then(image => art.append(image));
      const edit = secondary('Edit', () => openEditor(kid), { class: 'kp-btn kp-btn-small', 'aria-label': `Edit ${kid.name}` });
      if (editor?.kid?.id === kid.id) edit.disabled = true;
      return el('div', { class: 'kp-row' }, art,
        el('div', { class: 'kp-row-main' }, el('strong', {}, kid.name), el('span', {}, summary(kid))), edit);
    }));
  }

  function closeEditor() {
    editor?.dispose();
    editor = null;
    editorHost.replaceChildren();
    paintList();
  }

  // The form for one kid; `kid` is null for a new one.
  function openEditor(kid) {
    editor?.dispose();
    const index = kid ? kids.indexOf(kid) : kids.length;
    const draft = {
      name: kid?.name || '', kicker: kid?.kicker || '',
      accent: kid?.accent || ACCENTS[index % ACCENTS.length].hex,
      themeId: kid?.themeId || DEFAULT_THEME, reviewUploads: kid ? kid.reviewUploads : true,
      login: kid ? !!kid.login : false, handle: kid?.login || '', handleEdited: !!kid?.login, pass: '',
    };
    draft.badge = kid?.badge || defaultBadge(draft.name, draft.accent);
    let badgeEdited = !!kid?.badge;
    let builder = null;
    let gallery = null;

    const name = el('input', { class: 'kp-input', maxlength: '40', autocomplete: 'off', value: draft.name, placeholder: 'Juni' });
    const kicker = el('input', { class: 'kp-input', maxlength: '80', autocomplete: 'off', value: draft.kicker, placeholder: 'Science, slime and space facts' });

    // Accent: the palette plus any color, with a readability check against the dark screens.
    const contrast = el('p', { class: 'su-contrast', 'aria-live': 'polite' });
    const custom = el('input', { type: 'color', value: draft.accent.toLowerCase(), 'aria-label': 'Any color' });
    const swatches = ACCENTS.map(color => {
      const button = el('button', { type: 'button', class: 'kp-swatch', 'aria-label': color.label, title: color.label, 'aria-pressed': 'false' });
      button.style.setProperty('--kp-swatch', color.hex);
      button.addEventListener('click', () => setAccent(color.hex));
      return button;
    });
    const customSwatch = el('span', { class: 'kp-swatch kp-swatch-custom', title: 'Any color' }, custom);
    for (const type of ['input', 'change']) custom.addEventListener(type, () => setAccent(custom.value.toUpperCase()));
    function paintAccent() {
      for (const [i, button] of swatches.entries()) button.setAttribute('aria-pressed', String(ACCENTS[i].hex.toLowerCase() === draft.accent.toLowerCase()));
      const result = accentCheck(draft.accent);
      contrast.className = `su-contrast ${result.ok ? 'kp-ok' : 'kp-error'}`;
      contrast.textContent = `${accentName(draft.accent)}. ${result.message}`;
    }
    function setAccent(hex) {
      draft.accent = hex;
      paintAccent();
      followDefaults();
      gallery?.update({ accent: hex });
    }

    // Badge: follows the name and accent until someone opens the builder and changes it.
    const art = el('div', { class: 'su-badge-art' });
    const paintBadge = () => badgeImage(draft.badge).then(image => art.replaceChildren(image));
    const builderHost = el('div', { class: 'su-builder', hidden: '' });
    const toggleBuilder = secondary('Open badge builder', () => {
      if (!builder) {
        builder = createBadgeBuilder(builderHost, {
          spec: draft.badge, names: [badgeText(draft.name)], note: '', label: 'Badge builder',
          onChange(spec) { draft.badge = spec; badgeEdited = true; paintBadge(); },
        });
      }
      builderHost.hidden = !builderHost.hidden;
      toggleBuilder.textContent = builderHost.hidden ? 'Open badge builder' : 'Close badge builder';
      toggleBuilder.setAttribute('aria-expanded', String(!builderHost.hidden));
    }, { class: 'kp-btn kp-btn-small', 'aria-expanded': 'false' });
    function followDefaults() {
      if (!badgeEdited) {
        draft.badge = defaultBadge(draft.name, draft.accent);
        builder?.setSpec(draft.badge);
        paintBadge();
      }
      if (!draft.handleEdited && !kid?.login) { handle.value = draft.name ? handleFrom(draft.name) : ''; }
      loginLabel.textContent = `${draft.name.trim() || 'This kid'} can sign in and post videos`;
      reviewLabel.textContent = `Review ${draft.name.trim() ? `${draft.name.trim()}'s` : 'their'} uploads before they go live`;
    }

    // Splash: the gallery previews each theme with this kid's name, line and accent.
    const galleryHost = el('div', { class: 'su-gallery' });
    let galleryTimer = 0;
    const galleryCtx = () => ({ title: draft.name.trim() || 'Your kid', kicker: draft.kicker, accent: draft.accent, number: index + 1, mode: 'channel' });
    gallery = createThemeGallery(galleryHost, {
      ctx: galleryCtx(), selected: draft.themeId, mode: 'channel', label: 'Splash screens',
      onSelect(id) { draft.themeId = id; chosen.textContent = `${themeNames.get(id) || id} selected.`; },
    });
    const chosen = el('p', { class: 'kp-small', 'aria-live': 'polite' }, `${themeNames.get(draft.themeId) || 'Ember Tape'} selected. Each preview plays this kid's intro.`);

    for (const input of [name, kicker]) {
      input.addEventListener('input', () => {
        draft.name = name.value;
        draft.kicker = kicker.value;
        followDefaults();
        clearTimeout(galleryTimer);
        galleryTimer = setTimeout(() => gallery?.update(galleryCtx()), 300);
      });
    }

    const review = check('', 'You watch each upload first, then it goes live. Recommended.', { checked: draft.reviewUploads });
    const reviewLabel = review.querySelector('.kp-check-text > span');

    // Optional login: a handle such as "juni" and a password of 8 or more characters.
    const loginBox = check('', 'Kids sign in with a short login name instead of an email.', { checked: draft.login });
    const loginLabel = loginBox.querySelector('.kp-check-text > span');
    const handle = el('input', { class: 'kp-input kp-input-mono', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: '24', value: draft.handle });
    handle.addEventListener('input', () => { draft.handleEdited = true; handle.value = handle.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); });
    const pass = el('input', { class: 'kp-input kp-input-mono', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: '128' });
    const suggest = secondary('Suggest one', () => { pass.value = kidPassword(); }, { class: 'kp-btn kp-btn-small' });
    const loginFields = el('div', { class: 'su-login' },
      field('Login name', handle, 'Lowercase letters, numbers and dashes.'),
      el('div', { class: 'kp-field' },
        el('label', { for: 'su-kid-pass' }, 'Password'),
        el('div', { class: 'kp-input-row' }, Object.assign(pass, { id: 'su-kid-pass' }), suggest),
        el('span', { class: 'kp-hint' }, kid?.login ? 'Leave empty to keep the current password.' : 'At least 8 characters. Write it down for your kid.')));
    const syncLogin = () => {
      const on = loginBox.querySelector('input').checked;
      loginFields.hidden = !on;
      if (on && !pass.value && !kid?.login) pass.value = kidPassword();
    };
    loginBox.querySelector('input').addEventListener('change', syncLogin);
    syncLogin();

    const error = errorLine('su-kid-error');
    const remove = kid && kid.id !== 1 ? secondary(`Remove ${kid.name}`, async () => {
      if (!confirm(`Remove ${kid.name}'s channel? This can't be undone.`)) return;
      const { data } = await api(`/api/setup/kids/${kid.id}`, { method: 'DELETE' });
      if (!data.ok) { error.textContent = data.error; return; }
      await refresh(4);
    }, { class: 'kp-btn kp-btn-quiet' }) : null;
    const saveButton = kid ? secondary('Save changes', async () => { if (await save()) await refresh(4); }) : null;
    const cancel = kids.length ? secondary('Cancel', closeEditor, { class: 'kp-btn kp-btn-quiet' }) : null;

    const root = el('section', { class: 'kp-box su-editor', 'aria-label': kid ? `Edit ${kid.name}` : 'New kid' },
      el('div', { class: 'su-editor-head' }, el('h2', { class: 'kp-heading' }, kid ? `Edit ${kid.name}` : kids.length ? 'Another kid' : 'Your first kid'), cancel),
      el('div', { class: 'kp-grid-2' }, field('Name', name), field('Channel line', kicker, 'Shown under the name on the splash screen.')),
      el('fieldset', { class: 'kp-fieldset su-section' }, el('legend', {}, 'Accent color'),
        el('div', { class: 'kp-swatches' }, ...swatches, customSwatch), contrast),
      el('div', { class: 'su-section' },
        el('span', { class: 'su-section-label' }, 'Badge'),
        el('div', { class: 'su-badge' }, art, el('div', { class: 'kp-stack-tight' },
          el('p', { class: 'kp-small' }, 'Shown on the front door and on this kid\'s splash.'), el('div', {}, toggleBuilder))),
        builderHost),
      el('div', { class: 'su-section' },
        el('span', { class: 'su-section-label', id: 'su-splash-label' }, 'Splash screen'), chosen, galleryHost),
      basic ? null : el('div', { class: 'su-section' }, review, loginBox, loginFields),
      error,
      saveButton || remove ? el('div', { class: 'kp-actions' }, remove || el('span'), saveButton) : null);
    editorHost.replaceChildren(root);
    paintAccent();
    followDefaults();
    paintBadge();

    async function save() {
      error.textContent = '';
      const kidName = name.value.trim();
      if (!kidName) { name.setAttribute('aria-invalid', 'true'); name.focus(); error.textContent = 'Add the kid\'s name.'; return false; }
      if (!accentCheck(draft.accent).ok) { error.textContent = 'That accent is hard to read on the dark screens. Pick a lighter color.'; return false; }
      const loginOn = !basic && loginBox.querySelector('input').checked;
      if (loginOn) {
        if (!HANDLE.test(handle.value)) { handle.setAttribute('aria-invalid', 'true'); handle.focus(); error.textContent = 'Login names use 2 to 24 lowercase letters, numbers or dashes, starting with a letter.'; return false; }
        const needsPass = !kid?.login || kid.login !== handle.value;
        if ((needsPass || pass.value) && pass.value.length < 8) { pass.setAttribute('aria-invalid', 'true'); pass.focus(); error.textContent = 'Kid passwords need at least 8 characters.'; return false; }
      }
      const payload = {
        id: kid?.id, name: kidName, kicker: kicker.value, accent: draft.accent, themeId: draft.themeId,
        reviewUploads: review.querySelector('input').checked,
        login: loginOn ? { handle: handle.value, ...(pass.value ? { pass: pass.value } : {}) } : null,
      };
      const { data } = await api('/api/setup/kids', { method: 'POST', body: payload });
      if (!data.ok) { error.textContent = data.error; return false; }
      try {
        await saveChannelBadge(data.kid.id, draft.badge, auth());
      } catch (problem) {
        error.textContent = `Saved ${kidName}, but not the badge: ${problem.message}`;
        return false;
      }
      return true;
    }

    editor = {
      kid, save, hasInput: () => !!name.value.trim(),
      dispose() {
        clearTimeout(galleryTimer);
        gallery?.destroy();
        builder?.destroy();
      },
    };
    disposers.add(() => editor?.dispose());
    paintList();
    if (kid || kids.length) name.focus({ preventScroll: false });
  }

  const addAnother = secondary('Add another kid', async () => {
    stepError.textContent = '';
    if (editor && !editor.hasInput()) { editorHost.querySelector('input')?.focus(); return; }
    if (editor) {
      const done = setBusy(addAnother, 'Saving');
      const saved = await editor.save();
      done();
      if (!saved) return;
      openBlank = true;
      await refresh(4);
      return;
    }
    openEditor(null);
  });

  if (kids.length >= maxKids) addAnother.hidden = true;
  const submit = primary('Continue');
  if (!kids.length || openBlank) openEditor(null);
  openBlank = false;
  paintList();

  return {
    title: 'Add your kids',
    lead: 'Each kid gets their own channel. You can add more or change any of this later.',
    cleanup: () => { for (const dispose of disposers) dispose(); },
    content: [form(async () => {
      stepError.textContent = '';
      const done = setBusy(submit, 'Saving');
      if (editor?.hasInput()) {
        if (!await editor.save()) { done(); return; }
      } else if (!kids.length) {
        done();
        stepError.textContent = 'Add at least one kid to continue.';
        editorHost.querySelector('input')?.focus();
        return;
      }
      const { data } = await api('/api/setup/kids/done', { method: 'POST', body: {} });
      done();
      if (!data.ok) { stepError.textContent = data.error; return; }
      await refresh(5);
    }, listHost, editorHost, stepError,
    el('div', { class: 'kp-actions' }, el('div', { class: 'kp-actions' }, secondary('Back', () => go(3)), addAnother), submit))],
  };
}
