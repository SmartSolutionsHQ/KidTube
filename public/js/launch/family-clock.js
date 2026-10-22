// The family's time zone, shown with the current local time as a check. Days for the daily tape,
// capsule countdowns and the midnight reset all follow it. No dashboard slot exists for family-wide
// settings yet; mount it on the settings screen (ctx { staff }).
//   GET /api/admin/timezone     POST /api/admin/timezone { timezone }
import { announce, api, h, root, staffSession } from './common.js';

const zones = () => { try { return ['UTC', ...Intl.supportedValuesOf('timeZone')]; } catch { return ['UTC']; } };
const localTime = zone => { try { return new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(Date.now()); } catch { return ''; } };

export function mount(host, ctx) {
  let current = ctx, alive = true, timer = 0;

  async function load() {
    const node = root(host, 'Family time zone');
    const staff = staffSession(current);
    const state = await api('/api/admin/timezone', { staff });
    if (!alive) return;
    if (!state.ok) { node.append(h('p', { class: 'kp-error', role: 'alert', text: state.error })); return; }
    const list = zones();
    if (!list.includes(state.timezone)) list.unshift(state.timezone);
    const select = h('select', { class: 'kp-input', id: 'kl-timezone', disabled: state.locked },
      list.map(zone => h('option', { value: zone, selected: zone === state.timezone }, zone.replace(/_/g, ' '))));
    const check = h('p', { class: 'kp-small', role: 'status' });
    const status = h('p', { class: 'kp-error', role: 'alert' });
    const paint = () => { check.textContent = `It is ${localTime(select.value)} there now.`; };
    select.addEventListener('change', async () => {
      paint();
      select.disabled = true;
      const result = await api('/api/admin/timezone', { staff, body: { timezone: select.value } });
      select.disabled = false;
      status.textContent = result.ok ? '' : result.error;
      if (result.ok) announce(host, { kind: 'timezone', timezone: result.timezone });
    });
    node.append(h('label', { class: 'kp-field', for: select.id }, 'Family time zone', select), check,
      h('p', { class: 'kp-hint', text: state.locked ? 'Set by FAMILY_TIMEZONE on the server.' : 'The daily tape resets at midnight here, and time capsule dates count in it.' }), status);
    paint();
    clearInterval(timer);
    timer = setInterval(paint, 30000);
  }

  load();
  return {
    update(next) { current = next; load(); },
    destroy() { alive = false; clearInterval(timer); host.replaceChildren(); },
  };
}
