// Slot "clip-actions" (one per video row), ctx { clip, staff }. Seals an approved video as a time
// capsule with an opening date and a note, shows "Sealed until …" on a sealed one with "Open now",
// and nothing for videos still waiting for review.
//   POST /api/admin/clips/seal { id, opensAt, note }   POST /api/admin/clips/unseal { id }
//   GET  /api/admin/capsules?id=   when the row does not carry opensAt (adminOverview rows do)
import { announce, api, formatDate, h, localInput, root, staffSession } from './common.js';

const HOUR = 3600000;

export function mount(host, ctx) {
  let current = ctx;
  let state = null;
  let editing = false;
  let busy = false;
  let error = '';
  let alive = true;

  async function load() {
    const clip = current.clip || {};
    if ('opensAt' in clip) {
      state = { id: clip.id, review: clip.review || 'approved', opensAt: Number(clip.opensAt) || 0, openedAt: Number(clip.openedAt) || 0, capsuleNote: clip.capsuleNote || '' };
    } else {
      const result = await api(`/api/admin/capsules?id=${encodeURIComponent(clip.id || '')}`, { staff: staffSession(current) });
      const found = result.ok && result.capsules[0];
      state = found ? { ...found } : { id: clip.id, review: clip.review || 'approved', opensAt: 0, openedAt: 0, capsuleNote: '' };
    }
    if (alive) render();
  }

  async function act(path, body, kind) {
    busy = true; error = ''; render();
    const result = await api(path, { staff: staffSession(current), body });
    busy = false;
    if (!result.ok) { error = result.error; render(); return; }
    state = { ...state, ...result.clip };
    editing = false;
    render();
    announce(host, { kind, clip: result.clip });
  }

  function form(node) {
    const opens = h('input', { class: 'kp-input', type: 'datetime-local', id: `kl-opens-${state.id}`, min: localInput(Date.now() + HOUR + 60000), required: true });
    if (state.opensAt > Date.now()) opens.value = localInput(state.opensAt);
    const note = h('input', { class: 'kp-input', type: 'text', id: `kl-note-${state.id}`, maxlength: '140', value: state.capsuleNote, placeholder: 'From Grandma. Open on your 10th birthday.' });
    const submit = event => {
      event.preventDefault();
      const opensAt = Math.round(new Date(opens.value).getTime() / 60000) * 60000;
      if (!opens.value || !Number.isFinite(opensAt)) { error = 'Pick the date and time it opens.'; render(); return; }
      act('/api/admin/clips/seal', { id: state.id, opensAt, note: note.value }, 'capsule.seal');
    };
    node.append(h('form', { class: 'kp-stack-tight', onsubmit: submit },
      h('label', { class: 'kp-field', for: opens.id }, 'Opens on', opens),
      h('label', { class: 'kp-field', for: note.id }, 'Note for when it opens (optional, up to 140 characters)', note),
      h('p', { class: 'kp-hint', text: 'Until then the video stays on the channel as a locked tape. Nobody but parents can watch it, and it opens by itself on the day.' }),
      h('div', { class: 'kp-actions kp-actions-end' },
        h('button', { class: 'kp-btn kp-btn-small kp-btn-quiet', type: 'button', disabled: busy, onclick: () => { editing = false; error = ''; render(); } }, 'Cancel'),
        h('button', { class: 'kp-btn kp-btn-small', type: 'submit', disabled: busy }, busy ? 'Sealing…' : 'Seal'))));
    queueMicrotask(() => opens.focus());
  }

  function render() {
    if (!alive) return;
    const node = root(host, 'Time capsule');
    if (!state) { node.append(h('p', { class: 'kp-small', text: 'Loading…' })); return; }
    const sealed = state.opensAt > Date.now();
    if (sealed && !editing) {
      node.append(h('p', { class: 'kp-small' }, h('strong', { text: 'Sealed until ' }), formatDate(state.opensAt)));
      if (state.capsuleNote) node.append(h('p', { class: 'kp-small', text: `Note: ${state.capsuleNote}` }));
      node.append(h('div', { class: 'kp-actions' },
        h('button', { class: 'kp-btn kp-btn-small', type: 'button', disabled: busy, onclick: () => { editing = true; render(); } }, 'Change date'),
        h('button', { class: 'kp-btn kp-btn-small', type: 'button', disabled: busy,
          onclick: () => { if (confirm('Open this time capsule now? Everyone who can watch the channel will see it straight away.')) act('/api/admin/clips/unseal', { id: state.id }, 'capsule.unseal'); } },
        busy ? 'Opening…' : 'Open now')));
    } else if (editing) {
      form(node);
    } else if (state.review !== 'approved') {
      node.append(h('p', { class: 'kp-hint', text: 'Approve this video first to seal it as a time capsule.' }));
    } else {
      if (state.openedAt) node.append(h('p', { class: 'kp-small', text: `Time capsule, opened ${formatDate(state.openedAt)}` }));
      node.append(h('div', { class: 'kp-actions' },
        h('button', { class: 'kp-btn kp-btn-small', type: 'button', onclick: () => { editing = true; error = ''; render(); } }, 'Seal as a time capsule…')));
    }
    node.append(h('p', { class: 'kp-error', role: 'alert', text: error }));
  }

  render();
  load();
  return {
    update(next) { current = next; state = null; editing = false; error = ''; render(); load(); },
    destroy() { alive = false; host.replaceChildren(); },
  };
}
