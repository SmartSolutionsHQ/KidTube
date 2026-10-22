// DOM helpers for the dashboard: the setup wizard's (text always goes in as text nodes) plus buttons, an
// accessible confirm dialog and SVG. Nothing here builds markup from strings.
export { el, field, check, note, errorLine, setBusy, badgeImage, uid } from '/setup/ui.js';
import { el } from '/setup/ui.js';

export function button(label, onClick, attrs = {}) {
  const node = el('button', { type: 'button', class: 'kp-btn kp-btn-small', ...attrs }, label);
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

export const primary = (label, onClick, attrs = {}) => button(label, onClick, { class: 'kp-btn kp-btn-primary', ...attrs });
export const quiet = (label, onClick, attrs = {}) => button(label, onClick, { class: 'kp-btn kp-btn-quiet', ...attrs });

const SVG = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  node.append(...children);
  return node;
}

// A modal question with a native <dialog>: focus moves in, Esc cancels, focus returns where it was.
// Resolves true for the confirm button, false otherwise.
export function ask({ title, body = '', confirm = 'OK', cancel = 'Cancel', danger = false, extra = null }) {
  return new Promise(resolve => {
    const back = document.activeElement;
    const heading = el('h2', { class: 'kp-heading', id: 'kd-ask-title' }, title);
    const yes = el('button', { type: 'button', class: danger ? 'kp-btn kd-btn-danger' : 'kp-btn kp-btn-primary', value: 'yes' }, confirm);
    const no = el('button', { type: 'button', class: 'kp-btn', value: 'no' }, cancel);
    const dialog = el('dialog', { class: 'kd-dialog', 'aria-labelledby': 'kd-ask-title' },
      el('div', { class: 'kp-stack-tight' }, heading, body ? el('p', { class: 'kp-small' }, body) : null, extra),
      el('div', { class: 'kp-actions kp-actions-end' }, no, yes));
    let answer = false;
    const close = value => { answer = value; dialog.close(); };
    yes.addEventListener('click', () => close(true));
    no.addEventListener('click', () => close(false));
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (back && back.isConnected) back.focus();
      resolve(answer);
    });
    document.body.append(dialog);
    dialog.showModal();
    (danger ? no : yes).focus();
  });
}
