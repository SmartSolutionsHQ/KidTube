// Kids (owner only): each kid's channel. Name, channel line, accent (checked against the dark screens),
// badge (the M4 builder), splash screen (the M3 gallery), upload review and an optional login. Reorder
// the kids, add one, or remove one with their videos. The first kid keeps channel 1 and can't be removed.
import { ACCENTS, accentCheck, accentName, badgeText, handleFrom, kidPassword } from '/setup/helpers.js';
import { createBadgeBuilder } from '/js/badge/builder.js';
import { saveChannelBadge } from '/js/badge/save.js';
import { INK } from '/js/badge/spec.js';
import { createThemeGallery } from '/js/shell/theme-gallery.js';
import { loadRegistry } from '/js/shell/themes.js';
import { readSession } from './api.js';
import { el, button, primary, quiet, ask, field, check, errorLine, setBusy, badgeImage } from './dom.js';
import { plural } from './format.js';
import { mountSlot } from './slots.js';

const HANDLE = /^[a-z][a-z0-9-]{1,23}$/;
const DEFAULT_THEME = 'ember-tape';
let editor = null;

const defaultBadge = (name, accent) => ({
  v: 1, shape: 'circle', bg: accent, text: { value: badgeText(name) || '?', font: 'anton', color: INK },
  stickers: [], effects: { rgbSplit: false, outline: true, tilt: false, shadow: false },
});

function art(kid, size = 52) {
  const box = el('span', { class: 'kd-badge-art' });
  if (kid.logoUrl) box.append(el('img', { src: kid.logoUrl, alt: '', width: size, height: size }));
  else if (kid.badge) badgeImage(kid.badge, { size }).then(image => box.append(image));
  return box;
}

export async function render(main, ctx, { open = null, focus = null } = {}) {
  editor?.dispose();
  editor = null;
  const [{ kids, reviewDefault }, registry] = await Promise.all([ctx.api.get('/api/admin/kids'), loadRegistry().catch(() => ({ themes: [] }))]);
  const themeNames = new Map(registry.themes.map(theme => [theme.id, theme.name]));
  const listHost = el('ol', { class: 'kd-rows' });
  const editorHost = el('div', {});
  // Redraws the tab; focus goes to the kid named (their row), the editor when one opens, or the heading.
  const redraw = async (message, openId, focusId) => {
    if (message) ctx.say(message);
    await ctx.refresh().catch(() => {});
    await render(main, ctx, { open: openId, focus: focusId });
  };

  const summary = kid => [
    themeNames.get(kid.themeId) || kid.themeId || 'Family splash', accentName(kid.accent || ctx.family.accent),
    kid.login ? `logs in as ${kid.login}` : 'no login', kid.reviewUploads ? 'uploads reviewed' : 'uploads go live',
    plural(kid.videos, 'video'),
  ].join(' · ');

  async function move(index, step) {
    const order = kids.map(kid => kid.id);
    [order[index], order[index + step]] = [order[index + step], order[index]];
    try { await ctx.api.post('/api/admin/kids/order', { order }); await redraw('Order saved. The front door shows the kids in this order.', null, kids[index].id); }
    catch (problem) { ctx.say(problem.message, 'bad'); }
  }

  function paintList() {
    listHost.replaceChildren(...kids.map((kid, i) => {
      const nameId = `kd-kid-${kid.id}`;
      const described = { 'aria-describedby': nameId };
      const up = button('Move up', () => move(i, -1), described);
      const down = button('Move down', () => move(i, 1), described);
      up.disabled = i === 0;
      down.disabled = i === kids.length - 1;
      const edit = button('Edit', () => openEditor(kid), described);
      if (editor?.kid?.id === kid.id) edit.disabled = true;
      return el('li', { class: 'kd-item', 'aria-labelledby': nameId, 'data-kid': String(kid.id) }, art(kid),
        el('div', { class: 'kd-item-main' }, el('div', { class: 'kd-item-text' }, el('strong', { id: nameId }, kid.name), el('span', {}, summary(kid))),
          el('div', { class: 'kd-buttons' }, edit, up, down)));
    }));
  }

  function openEditor(kid) {
    editor?.dispose();
    const index = kid ? kids.indexOf(kid) : kids.length;
    const draft = {
      name: kid?.name || '', kicker: kid?.kicker || '', accent: kid?.accent || ACCENTS[index % ACCENTS.length].hex,
      themeId: kid?.themeId || DEFAULT_THEME, reviewUploads: kid ? kid.reviewUploads : reviewDefault !== 'none',
      handleEdited: !!kid?.login,
    };
    draft.badge = kid?.badge || defaultBadge(draft.name, draft.accent);
    let badgeEdited = !!kid?.badge;
    let builder = null, gallery = null, galleryTimer = 0;
    const disposeSlot = [];

    const name = el('input', { class: 'kp-input', maxlength: '40', autocomplete: 'off', value: draft.name });
    const kicker = el('input', { class: 'kp-input', maxlength: '80', autocomplete: 'off', value: draft.kicker });

    const contrast = el('p', { class: 'kd-contrast', 'aria-live': 'polite' });
    const custom = el('input', { type: 'color', value: draft.accent.toLowerCase(), 'aria-label': 'Any color' });
    const swatches = ACCENTS.map(color => {
      const swatch = el('button', { type: 'button', class: 'kp-swatch', 'aria-label': color.label, title: color.label, 'aria-pressed': 'false' });
      swatch.style.setProperty('--kp-swatch', color.hex);
      swatch.addEventListener('click', () => setAccent(color.hex));
      return swatch;
    });
    for (const type of ['input', 'change']) custom.addEventListener(type, () => setAccent(custom.value.toUpperCase()));
    function paintAccent() {
      swatches.forEach((swatch, i) => swatch.setAttribute('aria-pressed', String(ACCENTS[i].hex.toLowerCase() === draft.accent.toLowerCase())));
      const result = accentCheck(draft.accent);
      contrast.className = `kd-contrast ${result.ok ? 'kp-ok' : 'kp-error'}`;
      contrast.textContent = `${accentName(draft.accent)}. ${result.message}`;
    }
    function setAccent(hex) { draft.accent = hex; paintAccent(); follow(); gallery?.update({ accent: hex }); }

    const big = el('div', { class: 'kd-badge-big' });
    const paintBadge = () => badgeImage(draft.badge).then(image => big.replaceChildren(image));
    const builderHost = el('div', { class: 'kd-builder', hidden: true });
    const toggleBuilder = button('Open badge builder', () => {
      builder ||= createBadgeBuilder(builderHost, {
        spec: draft.badge, names: [badgeText(draft.name)], note: '', label: 'Badge builder',
        onChange(spec) { draft.badge = spec; badgeEdited = true; paintBadge(); },
      });
      builderHost.hidden = !builderHost.hidden;
      toggleBuilder.textContent = builderHost.hidden ? 'Open badge builder' : 'Close badge builder';
      toggleBuilder.setAttribute('aria-expanded', String(!builderHost.hidden));
    }, { 'aria-expanded': 'false' });

    const review = check('', 'You watch each upload first, then it goes live. Recommended.', { checked: draft.reviewUploads });
    const reviewLabel = review.querySelector('.kp-check-text > span');
    const loginBox = check('', 'Kids sign in with a short login name instead of an email.', { checked: !!kid?.login });
    const loginLabel = loginBox.querySelector('.kp-check-text > span');
    const handle = el('input', { class: 'kp-input kp-input-mono', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: '24', value: kid?.login || '' });
    handle.addEventListener('input', () => { draft.handleEdited = true; handle.value = handle.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); });
    const pass = el('input', { class: 'kp-input kp-input-mono', id: `kd-kid-pass-${kid?.id || 'new'}`, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: '128' });
    const suggest = button('Suggest one', () => { pass.value = kidPassword(); });
    const loginFields = el('div', { class: 'kd-login' },
      field('Login name', handle, 'Lowercase letters, numbers and dashes.'),
      el('div', { class: 'kp-field' }, el('label', { for: pass.id }, kid?.login ? 'New password' : 'Password'),
        el('div', { class: 'kp-input-row' }, pass, suggest),
        el('span', { class: 'kp-hint' }, kid?.login ? 'Leave empty to keep the current password. At least 8 characters.' : 'At least 8 characters. Write it down for your kid.')));
    const syncLogin = () => {
      const on = loginBox.querySelector('input').checked;
      loginFields.hidden = !on;
      if (on && !pass.value && !kid?.login) pass.value = kidPassword();
    };
    loginBox.querySelector('input').addEventListener('change', syncLogin);

    function follow() {
      if (!badgeEdited) { draft.badge = defaultBadge(draft.name, draft.accent); builder?.setSpec(draft.badge); paintBadge(); }
      if (!draft.handleEdited && !kid?.login) handle.value = draft.name ? handleFrom(draft.name) : '';
      const shown = draft.name.trim();
      loginLabel.textContent = `${shown || 'This kid'} can sign in and post videos`;
      reviewLabel.textContent = `Review ${shown ? `${shown}'s` : 'their'} uploads before they go live`;
    }

    const galleryHost = el('div', { class: 'kd-gallery' });
    const chosen = el('p', { class: 'kp-small', 'aria-live': 'polite' }, `${themeNames.get(draft.themeId) || draft.themeId} selected. Each preview plays this kid's intro.`);
    const galleryCtx = () => ({ title: draft.name.trim() || 'Your kid', kicker: draft.kicker, accent: draft.accent, number: index + 1, mode: 'channel' });
    gallery = createThemeGallery(galleryHost, {
      ctx: galleryCtx(), selected: draft.themeId, mode: 'channel', label: 'Splash screens',
      onSelect(id) { draft.themeId = id; chosen.textContent = `${themeNames.get(id) || id} selected.`; },
    });
    for (const input of [name, kicker]) input.addEventListener('input', () => {
      draft.name = name.value; draft.kicker = kicker.value; follow();
      clearTimeout(galleryTimer); galleryTimer = setTimeout(() => gallery?.update(galleryCtx()), 300);
    });

    const error = errorLine(`kd-kid-error-${kid?.id || 'new'}`);
    const save = primary(kid ? 'Save changes' : `Add this kid`, () => submit());
    const cancel = quiet('Cancel', () => { editor?.dispose(); editor = null; editorHost.replaceChildren(); paintList(); listHost.querySelector('button')?.focus(); });
    const remove = kid && kid.id !== 1 ? button(`Remove ${kid.name}`, async () => {
      const sure = await ask({ title: `Remove ${kid.name}?`, danger: true, confirm: 'Remove',
        body: `${kid.name}'s channel${kid.videos ? `, ${plural(kid.videos, 'video')} with their hearts and comments` : ''}${kid.login ? ', their login' : ''} and guest codes made just for them are deleted. This can't be undone.` });
      if (!sure) return;
      try { await ctx.api.post('/api/admin/kids/delete', { id: kid.id }); await redraw(`Removed ${kid.name}.`); }
      catch (problem) { error.textContent = problem.message; }
    }, { class: 'kp-btn kp-btn-small kd-btn-danger' }) : null;
    const slot = el('div', {});

    async function submit() {
      error.textContent = '';
      const kidName = name.value.trim();
      if (!kidName) { name.setAttribute('aria-invalid', 'true'); name.focus(); error.textContent = 'Add the kid\'s name.'; return; }
      if (!accentCheck(draft.accent).ok) { error.textContent = 'That accent is hard to read on the dark screens. Pick a lighter color.'; return; }
      const loginOn = loginBox.querySelector('input').checked;
      if (loginOn) {
        if (!HANDLE.test(handle.value)) { handle.setAttribute('aria-invalid', 'true'); handle.focus(); error.textContent = 'Login names use 2 to 24 lowercase letters, numbers or dashes, starting with a letter.'; return; }
        const needsPass = !kid?.login || kid.login !== handle.value;
        if ((needsPass || pass.value) && pass.value.length < 8) { pass.setAttribute('aria-invalid', 'true'); pass.focus(); error.textContent = 'Kid passwords need at least 8 characters.'; return; }
      }
      const done = setBusy(save, 'Saving');
      try {
        const { kid: saved } = await ctx.api.post('/api/admin/kids', {
          id: kid?.id, name: kidName, kicker: kicker.value, accent: draft.accent, themeId: draft.themeId,
          reviewUploads: review.querySelector('input').checked,
          login: loginOn ? { handle: handle.value, ...(pass.value ? { pass: pass.value } : {}) } : null,
        });
        if (badgeEdited || !kid?.logoUrl) {
          try { await saveChannelBadge(saved.id, draft.badge, readSession()); }
          catch (problem) { done(); error.textContent = `Saved ${kidName}, but not the badge: ${problem.message}`; return; }
        }
        done();
        await redraw(kid ? `Saved ${kidName}.` : `Added ${kidName}.`, null, saved.id);
      } catch (problem) { done(); error.textContent = problem.message; }
    }

    const root = el('section', { class: 'kp-box kd-editor', 'aria-labelledby': 'kd-editor-title' },
      el('div', { class: 'kd-editor-head' }, el('h2', { class: 'kp-heading', id: 'kd-editor-title', tabindex: '-1' }, kid ? `Edit ${kid.name}` : 'Add a kid'), cancel),
      el('div', { class: 'kp-grid-2' }, field('Name', name), field('Channel line', kicker, 'Shown under the name on the splash screen.')),
      el('fieldset', { class: 'kp-fieldset kd-field-group' }, el('legend', {}, 'Accent color'),
        el('div', { class: 'kp-swatches' }, ...swatches, el('span', { class: 'kp-swatch kp-swatch-custom', title: 'Any color' }, custom)), contrast),
      el('div', { class: 'kd-field-group' }, el('span', { class: 'kd-field-label' }, 'Badge'),
        el('div', { class: 'kd-badge' }, big, el('div', { class: 'kp-stack-tight' },
          el('p', { class: 'kp-small' }, 'Shown on the front door and on this kid\'s splash.'), el('div', {}, toggleBuilder))), builderHost),
      el('div', { class: 'kd-field-group' }, el('span', { class: 'kd-field-label' }, 'Splash screen'), chosen, galleryHost),
      el('div', { class: 'kd-field-group' }, review, loginBox, loginFields),
      slot, error,
      el('div', { class: 'kp-actions' }, remove || el('span'), save));
    editorHost.replaceChildren(root);
    if (kid) disposeSlot.push(mountSlot(slot, 'kid-settings', { kid, api: ctx.api, say: ctx.say, refresh: () => redraw('', kid.id), role: ctx.role }));
    paintAccent();
    follow();
    syncLogin();
    paintBadge();
    editor = {
      kid,
      dispose() { clearTimeout(galleryTimer); gallery?.destroy(); builder?.destroy(); for (const d of disposeSlot.splice(0)) d(); },
    };
    paintList();
    root.querySelector('h2').focus();
  }

  main.replaceChildren(
    el('div', { class: 'kd-head' }, el('h1', { class: 'kp-title', tabindex: '-1' }, 'Kids'),
      el('p', { class: 'kp-lead' }, 'Each kid has a channel with its own badge, splash screen and color. The front door lists them in this order.')),
    listHost,
    el('div', {}, button('Add a kid', () => openEditor(null))),
    editorHost);
  paintList();
  const opening = open && kids.find(entry => entry.id === open);
  if (opening) openEditor(opening);
  else if (focus != null) (listHost.querySelector(`[data-kid="${focus}"] button:not(:disabled)`) || main.querySelector('h1')).focus();
  else if (editor === null && main.contains(document.activeElement) === false && document.activeElement === document.body) main.querySelector('h1').focus();
  return () => { editor?.dispose(); editor = null; };
}
