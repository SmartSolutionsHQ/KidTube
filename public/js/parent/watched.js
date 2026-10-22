// Who watched: the watch history the launch-story milestone records, filtered by kid and viewer.
// Until GET /api/admin/views exists this says so calmly instead of failing.
import { el, button, field } from './dom.js';
import { watchCells, watchState, viewsQuery } from './watch-model.js';

export { watchState };

export function watchTable(rows, ctx, guests = new Map()) {
  const head = ['Viewer', 'Video', 'Watched', 'When'];
  const body = el('tbody', {}, ...rows.map(row => {
    const cells = watchCells(row, { guests, kidName: ctx.kidName });
    return el('tr', {},
      el('td', { 'data-label': 'Viewer' }, cells.viewer),
      el('td', { 'data-label': 'Video' }, cells.video),
      el('td', { 'data-label': 'Watched', class: 'kd-num' }, cells.watched),
      el('td', { 'data-label': 'When', class: 'kd-dim' }, cells.when));
  }));
  return el('table', { class: 'kd-table' }, el('caption', { class: 'kd-sr' }, 'Who watched which video, newest first'),
    el('thead', {}, el('tr', {}, ...head.map(label => el('th', { scope: 'col' }, label)))), body);
}

export async function render(main, ctx) {
  const [people, codes] = await Promise.all([ctx.api.get('/api/admin/people'), ctx.api.get('/api/admin/guests')]);
  const guests = new Map(codes.codes.filter(code => code.viewer).map(code => [code.viewer, code.note || code.scopeName || '']));
  const kid = el('select', { class: 'kp-input kd-select' }, el('option', { value: '' }, 'All kids'),
    ...ctx.kids.map(entry => el('option', { value: entry.slug }, entry.name)));
  const viewer = el('select', { class: 'kp-input kd-select' }, el('option', { value: '' }, 'Everyone'),
    ...people.people.filter(person => person.status === 'approved').map(person => el('option', { value: person.email }, person.name)),
    ...codes.codes.filter(code => code.viewer).map(code => el('option', { value: code.viewer }, `Guest${code.note ? ` (${code.note})` : ''}`)));
  const results = el('div', { class: 'kd-section', 'aria-live': 'polite' });
  const more = button('Show older', () => load(true));
  let next = null, rows = [];

  async function load(older) {
    more.disabled = true;
    const data = await ctx.api.maybe(viewsQuery({ channel: kid.value, viewer: viewer.value, before: older ? next : null }));
    const state = watchState(data);
    rows = older ? rows.concat(state.rows) : state.rows;
    next = state.next;
    if (!data) {
      results.replaceChildren(el('p', { class: 'kd-empty' }, el('strong', {}, 'Nothing recorded yet.'),
        'Watch history appears here once this install starts recording what each viewer plays.'));
    } else if (!rows.length) {
      results.replaceChildren(el('p', { class: 'kd-empty' }, el('strong', {}, 'No one has watched anything yet.'),
        kid.value || viewer.value ? 'Try another kid or viewer.' : 'Views show up here a few seconds after someone starts a video.'));
    } else {
      results.replaceChildren(watchTable(rows, ctx, guests), state.next != null && state.rows.length ? more : null);
    }
    more.disabled = false;
  }
  for (const select of [kid, viewer]) select.addEventListener('change', () => load(false).catch(problem => ctx.say(problem.message, 'bad')));

  main.replaceChildren(
    el('div', { class: 'kd-head' }, el('h1', { class: 'kp-title', tabindex: '-1' }, 'Who watched'),
      el('p', { class: 'kp-lead' }, 'Every video each person played, and how much of it.')),
    el('div', { class: 'kd-filters' }, field('Kid', kid), field('Viewer', viewer)),
    results,
    el('p', { class: 'kp-small' }, `Kept on your server for ${ctx.family.viewsDays} days, then deleted. Viewers are told parents can see what they watch. No IP addresses or device details are stored.`));
  await load(false);
}
