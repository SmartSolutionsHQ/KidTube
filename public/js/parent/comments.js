// Comments: the queue a parent works through when comments wait for review, plus every comment that is
// showing or hidden. Show, hide or delete any of them.
import { el, button, primary, ask } from './dom.js';
import { ago } from './format.js';

const FILTERS = [['waiting', 'Waiting'], ['showing', 'Showing'], ['hidden', 'Hidden'], ['all', 'All']];
const MODES = {
  review: 'Comments wait here until a parent lets them show.',
  open: 'Comments show right away. Hide or delete any of them here.',
  off: 'Comments are turned off. Earlier ones are still here.',
};
const STATES = { waiting: 'Waiting', showing: 'Showing', hidden: 'Hidden by a parent' };

export async function render(main, ctx) {
  let filter = 'waiting';
  const segments = el('div', { class: 'kd-segments', role: 'group', 'aria-label': 'Which comments' });
  const results = el('div', { class: 'kd-section' });
  const lead = el('p', { class: 'kp-lead' });

  function row(comment, first) {
    const titleId = `kd-comment-${comment.id}`;
    const item = el('li', { class: 'kd-item kd-item-plain', 'aria-labelledby': titleId });
    const act = (action, label) => async () => {
      if (action === 'delete' && !await ask({ title: 'Delete this comment?', body: `"${comment.body.slice(0, 120)}" by ${comment.name}. This can't be undone.`, confirm: 'Delete it', danger: true })) return;
      try {
        await ctx.api.post('/api/admin/comments/moderate', { id: comment.id, action });
        ctx.say(label);
        ctx.refresh().catch(() => {});
        if (filter === 'all' && action !== 'delete') { await load(); return; }
        const next = item.nextElementSibling || item.previousElementSibling;
        item.remove();
        (next?.querySelector('button') || results.querySelector('h2, p') || main.querySelector('h1')).focus?.();
        if (!results.querySelector('li')) await load();
      } catch (problem) { ctx.say(problem.message, 'bad'); }
    };
    const buttons = [];
    if (comment.status !== 'showing') buttons.push((first && comment.status === 'waiting' ? primary : button)('Show it', act('approve', `${comment.name}'s comment is showing.`), { 'aria-describedby': titleId }));
    if (comment.status === 'showing') buttons.push(button('Hide', act('hide', `${comment.name}'s comment is hidden.`), { 'aria-describedby': titleId }));
    buttons.push(button('Delete', act('delete', 'Comment deleted.'), { class: 'kp-btn kp-btn-small kd-btn-danger', 'aria-describedby': titleId }));
    item.append(el('div', { class: 'kd-item-main' },
      el('div', { class: 'kd-item-text' }, el('strong', { id: titleId }, `${comment.name} on "${comment.clipTitle}"`),
        el('span', {}, [comment.kid, ago(comment.created), filter === 'all' ? STATES[comment.status] : ''].filter(Boolean).join(' · '))),
      el('p', { class: 'kd-item-body' }, comment.body),
      el('div', { class: 'kd-buttons' }, ...buttons)));
    return item;
  }

  async function load() {
    const data = await ctx.api.get(`/api/admin/comments?status=${filter}`);
    lead.textContent = MODES[data.mode] || '';
    segments.replaceChildren(...FILTERS.map(([value, label]) => button(label, () => { filter = value; load().catch(problem => ctx.say(problem.message, 'bad')); },
      { 'aria-pressed': String(value === filter) })));
    results.replaceChildren(data.comments.length
      ? el('ul', { class: 'kd-rows' }, ...data.comments.map((comment, i) => row(comment, i === 0)))
      : el('p', { class: 'kd-empty' }, el('strong', {}, { waiting: 'Nothing waiting.', showing: 'No comments showing.', hidden: 'No hidden comments.', all: 'No comments yet.' }[filter]),
        filter === 'waiting' ? 'New comments land here when comments wait for review.' : ''));
  }

  main.replaceChildren(el('div', { class: 'kd-head' }, el('h1', { class: 'kp-title', tabindex: '-1' }, 'Comments'), lead), segments, results);
  await load();
}
