// Small DOM helpers for the setup wizard. Text always goes in as text nodes, never as markup.
import { createBadgeData } from '/js/badge/data.js';
import { renderBadge } from '/js/badge/render.js';

let ids = 0;
export const uid = prefix => `${prefix}-${++ids}`;

// el('input', { type: 'checkbox', checked: true }, ...children). false, null and undefined attributes
// are left off; true becomes an empty attribute.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === 'checked' || key === 'value') { node[key] = value === true ? true : value; if (key === 'value') continue; }
    node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...children.flat().filter(child => child != null && child !== false));
  return node;
}

// A labelled field: the label points at the control, the hint is read with it.
export function field(label, control, hint = '', extra = null) {
  if (!control.id) control.id = uid('su-field');
  const parts = [el('label', { for: control.id }, label), control];
  if (hint) {
    const hintId = uid('su-hint');
    control.setAttribute('aria-describedby', [control.getAttribute('aria-describedby'), hintId].filter(Boolean).join(' '));
    parts.push(el('span', { class: 'kp-hint', id: hintId }, hint));
  }
  if (extra) parts.push(extra);
  return el('div', { class: 'kp-field' }, ...parts);
}

// A checkbox (or radio) row with a main line and an optional hint under it.
export function check(label, hint, attrs = {}) {
  const input = el('input', { type: 'checkbox', ...attrs });
  return el('label', { class: 'kp-check' }, input,
    el('span', { class: 'kp-check-text' }, el('span', {}, label), hint ? el('span', { class: 'kp-hint' }, hint) : null));
}

export const note = (text, level = 'info') => el('p', { class: `kp-note${level === 'info' ? '' : ` kp-note-${level}`}` }, text);
export const errorLine = (id, message = '') => el('p', { class: 'kp-error', id, role: 'alert' }, message);

// Disables a button and says what is happening; returns the function that puts it back.
export function setBusy(button, text) {
  const before = button.textContent;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = `${text}…`;
  return () => { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = before; };
}

// Draws a badge spec with the same renderer the server uses, as an <img> (no markup is inserted).
const badgeData = createBadgeData('/badge/');
export async function badgeImage(spec, { size = 84, alt = '' } = {}) {
  const image = el('img', { width: size, height: size, alt, decoding: 'async' });
  try {
    const svg = renderBadge(spec, await badgeData.forSpec(spec));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch {
    image.alt = alt || 'Badge';
  }
  return image;
}
