// Slot "person-settings" (one per account), ctx { account, staff }. The account's daily tape: how
// many minutes of video a day, how much is used today, and a "+15 min today" button. Parents and
// Family are never limited. Days follow the family's time zone; the tape resets at local midnight.
//   GET  /api/admin/budget?target=<email>
//   POST /api/admin/budget { target, minutes }   (0, 15, 30, 45, 60, 90, 120 or 180)
//   POST /api/admin/budget/bonus { target, minutes }   (15 to 120, today only)
import { announce, api, formatDate, h, minutes, root, staffSession } from './common.js';

export const CHOICES = [[0, 'No daily limit'], [15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'],
  [90, '1 hour 30 minutes'], [120, '2 hours'], [180, '3 hours']];
const BONUS = 15;

// Renders one account's controls into node; used by kid-tape.js for each kid login too.
export function budgetControls(node, state, { staff, host, onChange }) {
  let busy = false, error = '', saved = '';
  const box = h('div', { class: 'kp-stack-tight' });
  node.append(box);

  async function send(path, body, kind) {
    busy = true; error = ''; saved = ''; draw();
    const result = await api(path, { staff, body: { target: state.target, ...body } });
    busy = false;
    if (!result.ok) { error = result.error; draw(); return; }
    Object.assign(state, result);
    saved = kind === 'budget.bonus' ? `Added ${BONUS} minutes for today.` : 'Saved.';
    draw();
    announce(host, { kind, account: state.target, minutes: state.minutes, budget: state.budget });
    onChange?.(state);
  }

  function draw() {
    box.replaceChildren();
    if (state.staff) {
      box.append(h('p', { class: 'kp-small', text: 'Parents are never limited.' }));
      return;
    }
    const id = `kl-tape-${state.target.replace(/[^a-z0-9]/gi, '-')}`;
    const select = h('select', { class: 'kp-input', id, disabled: busy, onchange: () => send('/api/admin/budget', { minutes: Number(select.value) }, 'budget.set') },
      CHOICES.map(([value, label]) => h('option', { value: String(value), selected: value === state.minutes }, label)));
    box.append(h('label', { class: 'kp-field', for: id }, `Daily tape${state.first ? ` for ${state.first}` : ''}`, select));
    const used = minutes(state.usedToday);
    if (state.minutes) {
      const limit = state.minutes + (state.bonusToday || 0);
      box.append(h('p', { class: 'kp-small', text: `Watched today: ${used} of ${limit} minutes${state.bonusToday ? ` (including ${state.bonusToday} bonus)` : ''}. Resets at ${formatDate(state.resetsAt, state.timezone).split(', ').pop()}.` }));
      box.append(h('div', { class: 'kp-actions' },
        h('button', { class: 'kp-btn kp-btn-small', type: 'button', disabled: busy, onclick: () => send('/api/admin/budget/bonus', { minutes: BONUS }, 'budget.bonus') }, `+${BONUS} min today`)));
    } else {
      box.append(h('p', { class: 'kp-small', text: `Watched today: ${used} minutes. No limit set.` }));
    }
    box.append(h('p', { class: 'kp-error', role: 'alert', text: error }));
    if (saved) box.append(h('p', { class: 'kp-small kp-ok', role: 'status', text: saved }));
  }
  draw();
}

export function mount(host, ctx) {
  let current = ctx, alive = true;

  async function load() {
    const node = root(host, 'Daily tape');
    const account = current.account || {};
    if (account.role === 'admin' || account.role === 'super') { node.append(h('p', { class: 'kp-small', text: 'Parents are never limited.' })); return; }
    node.append(h('p', { class: 'kp-small', text: 'Loading…' }));
    const staff = staffSession(current);
    const state = await api(`/api/admin/budget?target=${encodeURIComponent(account.email || '')}`, { staff });
    if (!alive) return;
    node.replaceChildren();
    if (!state.ok) { node.append(h('p', { class: 'kp-error', role: 'alert', text: state.error })); return; }
    budgetControls(node, state, { staff, host });
  }

  load();
  return {
    update(next) { current = next; load(); },
    destroy() { alive = false; host.replaceChildren(); },
  };
}
