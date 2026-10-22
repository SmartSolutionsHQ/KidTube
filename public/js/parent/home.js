// Home: what needs a parent (counts), the first videos waiting, recent activity, the last few views and
// who can watch, as on the design board.
import { el } from './dom.js';
import { ago, bytes, countLine } from './format.js';
import { reviewItem } from './review.js';
import { feedItem } from './activity.js';
import { watchState, watchTable } from './watched.js';

const card = (n, line, href, due) => {
  const body = [el('strong', {}, String(n)), el('span', {}, line)];
  return href ? el('a', { class: 'kd-card', href, 'data-due': String(due) }, ...body) : el('div', { class: 'kd-card', 'data-due': String(due) }, ...body);
};

export function whoCanWatch(family) {
  const rows = [
    ['Kids\' names and badges on the front door', family.kidsPublic ? 'On' : 'Off', !family.kidsPublic],
    ['New viewers', family.signupMode === 'closed' ? 'Not taking new ones' : 'Need your approval', family.signupMode === 'closed'],
    ['Guest codes', family.guestPasses ? 'On, 24 hours' : 'Off', !family.guestPasses],
    ['Comments', { review: 'You review first', open: 'Show right away', off: 'Off' }[family.comments] || family.comments, family.comments !== 'open'],
  ];
  return el('ul', { class: 'kd-settings-list' }, ...rows.map(([label, value, off]) => el('li', {}, el('span', {}, label), el('b', { 'data-off': String(off) }, value))));
}

export async function render(main, ctx) {
  const owner = ctx.role === 'super';
  const [queue, feed, storage, views] = await Promise.all([
    ctx.api.get('/api/admin/review'),
    ctx.api.get('/api/admin/activity?limit=10'),
    ctx.api.get('/api/admin/storage').catch(() => null),
    owner && ctx.summary.features?.views ? ctx.api.maybe('/api/admin/views?limit=5').then(data => watchState(data)).catch(() => null) : null,
  ]);
  const cards = el('div', { class: 'kd-cards' });
  const paintCards = ({ counts }) => cards.replaceChildren(
    card(counts.review, countLine('review', counts.review), '#/review', counts.review > 0),
    card(counts.comments, countLine('comments', counts.comments), '#/comments', counts.comments > 0),
    owner ? card(counts.people, countLine('people', counts.people), '#/people', counts.people > 0) : '',
    storage ? card(bytes(storage.free), 'free for videos', null, false) : '');
  paintCards(await ctx.refresh());
  const done = () => ctx.refresh().then(paintCards).catch(() => {});

  const waiting = queue.clips.slice(0, 3);
  const left = el('div', { class: 'kd-section' },
    el('h2', {}, 'Waiting for review'),
    waiting.length
      ? el('ul', { class: 'kd-rows' }, ...waiting.map((clip, i) => reviewItem(clip, ctx, { lead: i === 0, onDone: done })))
      : el('p', { class: 'kp-small' }, 'Nothing waiting. New uploads from kids show up here.'),
    queue.clips.length > waiting.length ? el('p', {}, el('a', { href: '#/review' }, `See all ${queue.clips.length} waiting`)) : null,
    el('h2', {}, 'Recent activity'),
    feed.rows.length ? el('ul', { class: 'kd-feed' }, ...feed.rows.map(row => feedItem(row, ago))) : el('p', { class: 'kp-small' }, 'Nothing has happened yet.'),
    el('p', {}, el('a', { href: '#/activity' }, 'All activity')));

  const right = el('div', { class: 'kd-section' });
  if (owner) {
    right.append(el('h2', {}, 'Who watched'));
    if (views?.kind === 'rows') right.append(watchTable(views.rows, ctx), el('p', {}, el('a', { href: '#/watched' }, 'All watch history')));
    else right.append(el('p', { class: 'kp-small' }, views?.kind === 'empty' ? 'No one has watched anything yet.' : 'Watch history shows here once this install records views.'));
    right.append(el('p', { class: 'kp-small' }, `Kept on your server for ${ctx.family.viewsDays} days. Viewers are told parents can see what they watch. No IP addresses or device details are stored.`));
  }
  right.append(el('h2', {}, 'Who can watch'), whoCanWatch(ctx.family), owner ? el('p', {}, el('a', { href: '#/settings' }, 'Change who can watch')) : null);

  main.replaceChildren(
    el('div', { class: 'kd-head' }, el('h1', { class: 'kp-title', tabindex: '-1' }, `Hi ${ctx.me.first || 'there'}`),
      el('p', { class: 'kp-lead' }, 'Here is what needs you, and what happened lately.')),
    cards, el('div', { class: 'kd-split' }, left, right));
}
