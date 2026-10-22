// Review: kid uploads waiting for a parent. Watch first, then Approve (it goes to the top of the kid's
// channel and the new-video email goes out) or Keep private (only parents and the kid can see it, and the
// parent can delete the file as well).
import { el, button, primary, ask } from './dom.js';
import { agoLong, clock } from './format.js';

export function thumb(clip) {
  const box = el('span', { class: 'kd-thumb' });
  if (clip.poster) {
    const image = el('img', { src: clip.poster, alt: '', loading: 'lazy', decoding: 'async' });
    image.addEventListener('error', () => image.remove());
    box.append(image);
  }
  if (clip.duration) box.append(el('span', {}, clock(clip.duration)));
  return box;
}

// One waiting video. `lead` makes its Approve the screen's ember button.
export function reviewItem(clip, ctx, { lead = false, onDone = () => {} } = {}) {
  const kid = clip.kid || ctx.kidName(clip.channel) || 'A kid';
  const who = clip.uploaderName && clip.uploaderName !== kid ? `${clip.uploaderName} for ${kid}` : kid;
  const titleId = `kd-review-${clip.id}`;
  const item = el('li', { class: 'kd-item', 'aria-labelledby': titleId });
  const text = el('div', { class: 'kd-item-text' }, el('strong', { id: titleId }, clip.title),
    el('span', {}, `${who} · posted ${agoLong(clip.created)}`));
  const player = el('div', { class: 'kd-item-video', hidden: true });

  const approve = (lead ? primary : button)('Approve', async () => {
    approve.disabled = true;
    try {
      const result = await ctx.api.post('/api/admin/review', { id: clip.id, decision: 'approve' });
      finish(`Approved. "${clip.title}" is at the top of ${kid}'s channel.`,
        el('a', { href: `/#/c/${encodeURIComponent(result.channel)}/v/${encodeURIComponent(clip.id)}` }, `Open ${kid}'s channel`));
      ctx.say(`Approved "${clip.title}".`);
    } catch (problem) { approve.disabled = false; ctx.say(problem.message, 'bad'); }
  }, { 'aria-describedby': titleId });

  const watch = button('Watch first', () => {
    const open = player.hidden;
    if (open && !player.firstChild) {
      player.append(el('video', { src: clip.src, controls: true, playsinline: true, preload: 'metadata', 'aria-label': `${clip.title}, from ${kid}` }));
    }
    player.hidden = !open;
    watch.textContent = open ? 'Close video' : 'Watch first';
    watch.setAttribute('aria-expanded', String(open));
    if (open) player.querySelector('video')?.focus();
    else player.querySelector('video')?.pause();
  }, { 'aria-expanded': 'false', 'aria-describedby': titleId });

  const keep = button('Keep private', async () => {
    keep.disabled = true;
    try {
      await ctx.api.post('/api/admin/review', { id: clip.id, decision: 'reject' });
      const remove = button('Delete the file too', async () => {
        const sure = await ask({ title: `Delete "${clip.title}"?`, body: 'The video file is removed from this server. This can\'t be undone.', confirm: 'Delete it', danger: true });
        if (!sure) return;
        try {
          await ctx.api.post('/api/admin/clips/delete', { id: clip.id });
          ctx.say(`Deleted "${clip.title}".`);
          item.remove();
          onDone();
        } catch (problem) { ctx.say(problem.message, 'bad'); }
      }, { class: 'kp-btn kp-btn-small kd-btn-danger' });
      finish(`Kept private. Only parents and ${kid} can see "${clip.title}".`, remove);
      ctx.say(`Kept "${clip.title}" private.`);
    } catch (problem) { keep.disabled = false; ctx.say(problem.message, 'bad'); }
  }, { 'aria-describedby': titleId });

  function finish(message, action) {
    player.querySelector('video')?.pause();
    item.className = 'kd-item kd-item-plain';
    item.replaceChildren(el('div', { class: 'kd-item-main' }, el('p', { class: 'kd-item-body', tabindex: '-1' }, message), el('div', { class: 'kd-buttons' }, action)));
    item.querySelector('p').focus();
    onDone();
  }

  item.append(thumb(clip), el('div', { class: 'kd-item-main' }, text, el('div', { class: 'kd-buttons' }, approve, watch, keep)), player);
  return item;
}

export async function render(main, ctx) {
  const { clips } = await ctx.api.get('/api/admin/review');
  const list = el('ul', { class: 'kd-rows' }, ...clips.map((clip, i) => reviewItem(clip, ctx, { lead: i === 0, onDone: () => ctx.refresh().catch(() => {}) })));
  main.replaceChildren(
    el('div', { class: 'kd-head' }, el('h1', { class: 'kp-title', tabindex: '-1' }, 'Review'),
      el('p', { class: 'kp-lead' }, 'Kids\' uploads wait here until a parent says yes. Watch first, then approve or keep private.')),
    clips.length ? list : el('p', { class: 'kd-empty' }, el('strong', {}, 'Nothing waiting.'),
      'When a kid posts a video and their channel has review turned on, it shows up here.'));
}
