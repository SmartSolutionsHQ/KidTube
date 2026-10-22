// Slot "kid-settings" (one per kid's channel), ctx { channel, staff }. The daily tape for each kid
// login on this channel, and the channel's time capsules with when each opens.
//   GET /api/admin/budget?channel=<slug>     GET /api/admin/capsules?channel=<slug>
import { budgetControls } from './tape-budget.js';
import { api, formatDate, h, root, staffSession } from './common.js';

export function mount(host, ctx) {
  let current = ctx, alive = true;

  async function load() {
    const channel = current.channel || {};
    const node = root(host, `${channel.name || 'Kid'}: daily tape and time capsules`);
    node.append(h('p', { class: 'kp-small', text: 'Loading…' }));
    const staff = staffSession(current);
    const slug = encodeURIComponent(channel.slug || '');
    const [kids, capsules] = await Promise.all([api(`/api/admin/budget?channel=${slug}`, { staff }), api(`/api/admin/capsules?channel=${slug}`, { staff })]);
    if (!alive) return;
    node.replaceChildren();

    node.append(h('h3', { class: 'kp-heading', text: 'Daily tape' }));
    if (!kids.ok) node.append(h('p', { class: 'kp-error', role: 'alert', text: kids.error }));
    else if (!kids.accounts.length) node.append(h('p', { class: 'kp-hint', text: `${channel.name || 'This kid'} has no login of their own yet. Viewers who watch as a guest or a grown-up are never limited here; set a daily tape on any viewer's account under People.` }));
    else for (const state of kids.accounts) budgetControls(node, state, { staff, host });

    node.append(h('h3', { class: 'kp-heading', text: 'Time capsules' }));
    if (!capsules.ok) { node.append(h('p', { class: 'kp-error', role: 'alert', text: capsules.error })); return; }
    const sealed = capsules.capsules.filter(capsule => capsule.sealed);
    const opened = capsules.capsules.filter(capsule => !capsule.sealed).slice(-3).reverse();
    if (!sealed.length && !opened.length) {
      node.append(h('p', { class: 'kp-hint', text: 'None yet. Seal a video from its row under Videos, or tick "Seal as a time capsule" when uploading.' }));
      return;
    }
    node.append(h('ul', { class: 'kp-list' },
      sealed.map(capsule => h('li', {}, h('div', { class: 'kp-row-main' },
        h('strong', { text: capsule.title }),
        h('span', { text: `Opens ${formatDate(capsule.opensAt)}${capsule.sealedBy ? ` · sealed by ${capsule.sealedBy}` : ''}${capsule.review !== 'approved' ? ' · waiting for review' : ''}` })))),
      opened.map(capsule => h('li', {}, h('div', { class: 'kp-row-main' },
        h('strong', { text: capsule.title }),
        h('span', { text: capsule.openedAt ? `Opened ${formatDate(capsule.openedAt)}` : 'Opens when approved' }))))));
  }

  load();
  return {
    update(next) { current = next; load(); },
    destroy() { alive = false; host.replaceChildren(); },
  };
}
