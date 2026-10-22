// People (owner only): who is asking to watch, who can, co-parents, kid logins and when each was last seen.
// Approve or turn down, change a viewer to a co-parent, set a password, or remove someone with everything
// they added.
import { el, button, primary, ask, field, errorLine } from './dom.js';
import { agoLong, ROLE_NAMES } from './format.js';
import { mountSlot } from './slots.js';

// Extension slots mounted by the latest draw; a redraw ends them first.
const disposers = [];

export async function render(main, ctx) {
  for (const d of disposers.splice(0)) d();
  const { people } = await ctx.api.get('/api/admin/people');
  const reload = async message => { if (message) ctx.say(message); ctx.refresh().catch(() => {}); await render(main, ctx); };
  let leadUsed = false;

  function person(p) {
    const me = p.email === ctx.me.email;
    const kid = p.role === 'kid';
    const nameId = `kd-person-${p.email.replace(/[^a-z0-9]/gi, '-')}`;
    const detail = [kid ? `logs in as ${p.email.split('@')[0]}` : p.email, ROLE_NAMES[p.role] || p.role,
      p.lastSeen ? `last seen ${agoLong(p.lastSeen)}` : 'not seen yet'];
    const buttons = el('div', { class: 'kd-buttons' });
    const panel = el('div', { class: 'kd-item-main', hidden: true });
    const item = el('li', { class: 'kd-item kd-item-plain', 'aria-labelledby': nameId },
      el('div', { class: 'kd-item-main' },
        el('div', { class: 'kd-item-text' }, el('strong', { id: nameId }, p.name, me ? ' (you)' : ''), el('span', {}, detail.join(' · '))),
        buttons, panel));
    const post = async (path, body, message) => {
      try { await ctx.api.post(path, { target: p.email, ...body }); await reload(message); } catch (problem) { ctx.say(problem.message, 'bad'); }
    };
    if (p.status === 'pending') {
      const make = leadUsed ? button : primary;
      leadUsed = true;
      buttons.append(make('Let them watch', () => post('/api/admin/people/status', { status: 'approved' }, `${p.name} can watch now.`), { 'aria-describedby': nameId }),
        button('Turn down', () => post('/api/admin/people/status', { status: 'denied' }, `Turned down ${p.name}.`), { 'aria-describedby': nameId }));
    } else if (p.status === 'denied') {
      buttons.append(button('Let them watch', () => post('/api/admin/people/status', { status: 'approved' }, `${p.name} can watch now.`), { 'aria-describedby': nameId }));
    }
    if (!me && p.status === 'approved' && !kid && p.role !== 'super') {
      const role = el('select', { class: 'kp-input kd-select', 'aria-label': `Role for ${p.name}` },
        el('option', { value: '' }, 'Viewer'), el('option', { value: 'admin' }, 'Co-parent'));
      role.value = p.role;
      role.addEventListener('change', () => post('/api/admin/people/role', { role: role.value },
        role.value === 'admin' ? `${p.name} is a co-parent now. They can review videos, comments and guest codes.` : `${p.name} is a viewer now.`));
      buttons.append(role);
    }
    if (!me) {
      const min = kid ? 8 : 12;
      buttons.append(button('Set a password', () => {
        if (!panel.hidden) { panel.hidden = true; return; }
        const pass = el('input', { class: 'kp-input kp-input-mono', type: 'text', autocomplete: 'new-password', autocapitalize: 'none', spellcheck: 'false', minlength: String(min), maxlength: '128' });
        const error = errorLine(`${nameId}-err`);
        const save = button('Save password', async () => {
          if (pass.value.length < min) { error.textContent = `Use at least ${min} characters.`; pass.focus(); return; }
          try { await ctx.api.post('/api/admin/people/password', { target: p.email, pass: pass.value }); panel.hidden = true; ctx.say(`New password saved for ${p.name}. Their other sign-ins end.`); }
          catch (problem) { error.textContent = problem.message; }
        });
        panel.replaceChildren(field(`New password for ${p.name}`, pass, `At least ${min} characters.${kid ? ' Write it down for your kid.' : ''}`), error, el('div', { class: 'kd-buttons' }, save));
        panel.hidden = false;
        pass.focus();
      }, { 'aria-describedby': nameId }));
      buttons.append(button('Remove', async () => {
        const sure = await ask({ title: `Remove ${p.name}?`, body: `Their account, hearts, comments and watch history are deleted${kid ? '. The kid\'s channel and videos stay' : ''}. This can't be undone.`, confirm: 'Remove', danger: true });
        if (sure) await post('/api/admin/people/delete', {}, `Removed ${p.name}.`);
      }, { class: 'kp-btn kp-btn-small kd-btn-danger', 'aria-describedby': nameId }));
    }
    const slot = el('div', {});
    item.querySelector('.kd-item-main').append(slot);
    disposers.push(mountSlot(slot, 'person-settings', { person: p, api: ctx.api, say: ctx.say, refresh: () => reload(), role: ctx.role }));
    return item;
  }

  const groups = [
    ['Asking to watch', people.filter(p => p.status === 'pending')],
    ['Parents', people.filter(p => p.status === 'approved' && (p.role === 'super' || p.role === 'admin'))],
    ['Viewers', people.filter(p => p.status === 'approved' && p.role === '')],
    ['Kid logins', people.filter(p => p.role === 'kid')],
    ['Turned down', people.filter(p => p.status === 'denied' && p.role !== 'kid')],
  ];
  main.replaceChildren(
    el('div', { class: 'kd-head' }, el('h1', { class: 'kp-title', tabindex: '-1' }, 'People'),
      el('p', { class: 'kp-lead' }, 'Everyone with an account. Viewers see every kid; co-parents also review videos, comments and guest codes.')),
    ...groups.filter(([title, list]) => list.length || title === 'Asking to watch').map(([title, list]) => el('section', { class: 'kd-section' },
      el('h2', {}, `${title} (${list.length})`),
      list.length ? el('ul', { class: 'kd-rows' }, ...list.map(person)) : el('p', { class: 'kp-small' }, 'Nobody is waiting. New sign-ups show up here.'))),
    el('p', { class: 'kp-small' }, 'Kid logins are made and changed on the Kids tab.'));
  return () => { for (const d of disposers.splice(0)) d(); };
}
