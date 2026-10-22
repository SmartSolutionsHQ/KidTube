// Videos: one kid at a time. Upload to that kid, rename, change the order, hide or show, delete.
// Hidden videos leave the feed and their file stops playing for viewers; parents can still watch them.
import { publishVideo } from '/js/server-upload-v1.js';
import { readSession } from './api.js';
import { el, button, primary, ask, field, errorLine, setBusy } from './dom.js';
import { agoLong } from './format.js';
import { thumb } from './review.js';
import { mountSlot } from './slots.js';

const disposers = [];
let chosen = '';

const STATE = clip => clip.review === 'pending' ? ['Waiting for review', 'kd-tag-warn']
  : clip.review === 'rejected' ? ['Kept private', 'kd-tag'] : clip.hidden ? ['Hidden', 'kd-tag-warn'] : ['Live', 'kd-tag-good'];

export async function render(main, ctx) {
  for (const d of disposers.splice(0)) d();
  if (!ctx.kids.some(kid => kid.slug === chosen)) chosen = ctx.kids[0]?.slug || '';
  const kidSelect = el('select', { class: 'kp-input kd-select' }, ...ctx.kids.map(kid => el('option', { value: kid.slug }, kid.name)));
  kidSelect.value = chosen;
  const list = el('div', { class: 'kd-section', 'aria-live': 'polite' });
  const kidName = () => ctx.kidName(chosen) || 'this kid';

  /* upload */
  const file = el('input', { class: 'kp-input', type: 'file', accept: 'video/*' });
  const title = el('input', { class: 'kp-input', type: 'text', maxlength: '80', autocomplete: 'off' });
  const progress = el('p', { class: 'kd-progress', 'aria-live': 'polite' });
  const error = errorLine('kd-upload-error');
  const send = primary(`Upload to ${kidName()}`, null, { type: 'submit' });
  file.addEventListener('change', () => {
    if (file.files[0] && !title.value.trim()) title.value = file.files[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 80);
  });
  const form = el('form', { class: 'kd-upload', novalidate: true },
    el('h2', { class: 'kp-heading' }, 'Add a video'),
    el('div', { class: 'kp-grid-2' }, field('Video file', file, 'Up to 5 minutes and 512 MB. The server makes a 480p copy.'), field('Name', title)),
    error, progress, el('div', {}, send));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    if (!file.files[0]) { error.textContent = 'Choose a video file.'; file.focus(); return; }
    if (!title.value.trim()) { error.textContent = 'Give the video a name.'; title.focus(); return; }
    const done = setBusy(send, 'Uploading');
    try {
      const clip = await publishVideo(file.files[0], title.value.trim(), readSession(), text => { progress.textContent = text; }, chosen);
      progress.textContent = '';
      form.reset();
      ctx.say(`"${clip.title || title.value}" is on ${kidName()}'s channel.`);
      await load();
    } catch (problem) { progress.textContent = ''; error.textContent = problem.message; }
    done();
    send.textContent = `Upload to ${kidName()}`;
  });

  /* the list */
  async function load(focusId, act = '') {
    for (const d of disposers.splice(0)) d();
    const { clips } = await ctx.api.get(`/api/admin/clips?channel=${encodeURIComponent(chosen)}`);
    if (!clips.length) {
      list.replaceChildren(el('h2', {}, `${kidName()}'s videos`), el('p', { class: 'kd-empty' }, el('strong', {}, 'No videos yet.'), `Upload one above, or ${kidName()} can post from their own login.`));
      return;
    }
    const order = clips.map(clip => clip.id);
    const move = async (id, step) => {
      const at = order.indexOf(id);
      const next = order.slice();
      [next[at], next[at + step]] = [next[at + step], next[at]];
      try { await ctx.api.post('/api/admin/clips/order', { channel: chosen, order: next }); await load(id, step < 0 ? 'up' : 'down'); ctx.say('Order saved.'); }
      catch (problem) { ctx.say(problem.message, 'bad'); }
    };
    list.replaceChildren(el('h2', {}, `${kidName()}'s videos (${clips.length})`),
      el('ol', { class: 'kd-rows' }, ...clips.map((clip, i) => {
        const titleId = `kd-clip-${clip.id}`;
        const [state, tone] = STATE(clip);
        const name = el('strong', { id: titleId }, clip.title);
        const meta = el('span', {}, `${i + 1} of ${clips.length} · ${clip.likes} ${clip.likes === 1 ? 'heart' : 'hearts'} · ${clip.comments} ${clip.comments === 1 ? 'comment' : 'comments'} · added ${agoLong(clip.created)}`);
        const buttons = el('div', { class: 'kd-buttons' });
        const editor = el('div', { hidden: true });
        const slot = el('div', {});
        const described = { 'aria-describedby': titleId };
        const up = button('Move up', () => move(clip.id, -1), { ...described, 'data-act': 'up' });
        const down = button('Move down', () => move(clip.id, 1), { ...described, 'data-act': 'down' });
        up.disabled = i === 0;
        down.disabled = i === clips.length - 1;
        const rename = button('Rename', () => {
          const input = el('input', { class: 'kp-input', type: 'text', maxlength: '80', value: clip.title });
          const save = button('Save name', async () => {
            if (!input.value.trim()) { input.focus(); return; }
            try { await ctx.api.post('/api/admin/clips/rename', { id: clip.id, title: input.value.trim() }); ctx.say('Renamed.'); await load(clip.id, 'rename'); }
            catch (problem) { ctx.say(problem.message, 'bad'); }
          });
          const cancel = button('Cancel', () => { editor.hidden = true; rename.focus(); }, { class: 'kp-btn kp-btn-quiet' });
          input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); save.click(); } if (event.key === 'Escape') cancel.click(); });
          editor.replaceChildren(field(`New name for "${clip.title}"`, input), el('div', { class: 'kd-buttons' }, save, cancel));
          editor.hidden = false;
          input.focus();
          input.select();
        }, { ...described, 'data-act': 'rename' });
        const hide = clip.review === 'approved' ? button(clip.hidden ? 'Show again' : 'Hide', async () => {
          try {
            await ctx.api.post('/api/admin/clips/hide', { id: clip.id, hidden: !clip.hidden });
            ctx.say(clip.hidden ? `"${clip.title}" is back in the feed.` : `"${clip.title}" is hidden. Viewers can't see or play it.`);
            await load(clip.id, 'hide');
          } catch (problem) { ctx.say(problem.message, 'bad'); }
        }, { ...described, 'data-act': 'hide' }) : null;
        const remove = button('Delete', async () => {
          const sure = await ask({ title: `Delete "${clip.title}"?`, body: 'The video, its hearts and comments, and its watch history are deleted. This can\'t be undone.', confirm: 'Delete it', danger: true });
          if (!sure) return;
          try { await ctx.api.post('/api/admin/clips/delete', { id: clip.id }); ctx.say(`Deleted "${clip.title}".`); await load(); }
          catch (problem) { ctx.say(problem.message, 'bad'); }
        }, { ...described, class: 'kp-btn kp-btn-small kd-btn-danger' });
        buttons.append(up, down, rename, hide || '', remove);
        if (clip.review === 'pending') buttons.prepend(el('a', { class: 'kp-btn kp-btn-small', href: '#/review' }, 'Review it'));
        disposers.push(mountSlot(slot, 'clip-actions', { clip, kid: ctx.kids.find(kid => kid.slug === chosen), api: ctx.api, say: ctx.say, refresh: () => load(clip.id), role: ctx.role }));
        return el('li', { class: 'kd-item', 'data-clip': clip.id, 'aria-labelledby': titleId }, thumb(clip),
          el('div', { class: 'kd-item-main' },
            el('div', { class: 'kd-item-text' }, name, meta),
            el('div', {}, el('span', { class: `kd-tag ${tone}` }, state)),
            buttons, editor, slot));
      })));
    if (focusId) {
      const row = list.querySelector(`[data-clip="${CSS.escape(focusId)}"]`);
      (row?.querySelector(`[data-act="${act}"]:not(:disabled)`) || row?.querySelector('.kd-buttons button:not(:disabled)'))?.focus();
    }
  }

  kidSelect.addEventListener('change', () => {
    chosen = kidSelect.value;
    send.textContent = `Upload to ${kidName()}`;
    load().catch(problem => ctx.say(problem.message, 'bad'));
  });

  main.replaceChildren(
    el('div', { class: 'kd-head' }, el('h1', { class: 'kp-title', tabindex: '-1' }, 'Videos'),
      el('p', { class: 'kp-lead' }, 'Each kid\'s channel, top to bottom in the order viewers see it.')),
    el('div', { class: 'kd-filters' }, field('Kid', kidSelect)),
    form, list);
  await load();
  return () => { for (const d of disposers.splice(0)) d(); };
}
