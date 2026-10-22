// Activity: everything that happened, newest first, filtered by kind and by kid. The server writes the
// sentences, so this tab only lays them out.
import { el, button, field } from './dom.js';
import { ago, when } from './format.js';

export const KINDS = [['', 'Everything'], ['review', 'Reviews'], ['upload', 'Uploads'], ['comment', 'Comments'], ['people', 'People'],
  ['guest', 'Guest codes'], ['kids', 'Kids'], ['videos', 'Videos'], ['settings', 'Settings']];

export function feedItem(row, format = when) {
  return el('li', {}, el('span', {}, row.text),
    el('time', { datetime: new Date(row.at).toISOString(), title: new Date(row.at).toLocaleString() }, format(row.at)));
}

export async function render(main, ctx) {
  const kind = el('select', { class: 'kp-input kd-select' }, ...KINDS.map(([value, label]) => el('option', { value }, label)));
  const kid = el('select', { class: 'kp-input kd-select' }, el('option', { value: '' }, 'All kids'),
    ...ctx.kids.map(entry => el('option', { value: entry.slug }, entry.name)));
  const list = el('ul', { class: 'kd-feed' });
  const empty = el('p', { class: 'kd-empty', hidden: true }, 'Nothing here yet.');
  const more = button('Show older', () => load(true).catch(problem => ctx.say(problem.message, 'bad')));
  let next = null;

  async function load(older) {
    more.disabled = true;
    const params = new URLSearchParams({ limit: '30' });
    if (kind.value) params.set('kind', kind.value);
    if (kid.value) params.set('channel', kid.value);
    if (older && next) params.set('before', String(next));
    const page = await ctx.api.get(`/api/admin/activity?${params}`);
    const items = page.rows.map(row => feedItem(row, at => (Date.now() - at < 86400000 ? ago(at) : when(at))));
    if (older) list.append(...items); else list.replaceChildren(...items);
    next = page.next;
    empty.hidden = list.children.length > 0;
    more.hidden = !next;
    more.disabled = false;
    if (older) items[0]?.setAttribute('tabindex', '-1'), items[0]?.focus();
  }
  for (const select of [kind, kid]) select.addEventListener('change', () => load(false).catch(problem => ctx.say(problem.message, 'bad')));

  main.replaceChildren(
    el('div', { class: 'kd-head' }, el('h1', { class: 'kp-title', tabindex: '-1' }, 'Activity'),
      el('p', { class: 'kp-lead' }, 'Uploads, reviews, comments, sign-ups, guest codes and changes, newest first.')),
    el('div', { class: 'kd-filters' }, field('Show', kind), field('Kid', kid)),
    el('div', { class: 'kd-section', 'aria-live': 'polite' }, list, empty),
    el('div', {}, more),
    el('p', { class: 'kp-small' }, `Activity is kept for the number of days set in Settings, then deleted.`));
  await load(false);
}
