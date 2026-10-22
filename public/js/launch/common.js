// Shared pieces for the launch-story parent modules (capsule-actions, tape-budget, kid-tape,
// family-clock). Each module is mounted by the dashboard into a slot: mount(host, ctx) builds calm
// parent UI with the kp- classes from /css/parent.css and returns { update(ctx), destroy() }.
//
// ctx.staff is the signed-in parent's session { email, t }; without it the stored dashboard session
// (localStorage "kid-session") is used. Changes are announced with a bubbling "kt:launch-change" event
// on the host ({ detail: { kind, ... } }) so the dashboard can refresh its own rows.

export function staffSession(ctx) {
  if (ctx?.staff?.email && ctx.staff.t) return ctx.staff;
  try {
    const stored = JSON.parse(localStorage.getItem('kid-session') || 'null');
    return stored?.email && stored.t ? stored : null;
  } catch { return null; }
}

// GET with the session in X-Kid-* headers (never the URL), POST with { email, t } in the body.
export async function api(path, { staff, body } = {}) {
  const init = { credentials: 'same-origin', headers: { accept: 'application/json' } };
  if (body) {
    init.method = 'POST';
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify({ ...body, email: staff?.email, t: staff?.t });
  } else if (staff) {
    Object.assign(init.headers, { 'x-kid-email': staff.email, 'x-kid-token': staff.t });
  }
  try {
    const response = await fetch(path, init);
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) return { ok: false, error: result?.error || 'Something went wrong. Try again.' };
    return result;
  } catch {
    return { ok: false, error: 'Could not reach the server. Check the connection and try again.' };
  }
}

// h('div', { class: 'kp-row', text: 'Hi', onclick }, ...children): DOM without HTML strings.
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child);
  return node;
}

// Every module's root: the kp- palette and type without the full-page .kp layout.
export function root(host, label) {
  const node = h('section', { class: 'kp kp-stack-tight', 'aria-label': label });
  node.style.minHeight = '0';
  node.style.background = 'transparent';
  host.replaceChildren(node);
  return node;
}

export const announce = (host, detail) => host.dispatchEvent(new CustomEvent('kt:launch-change', { bubbles: true, detail }));

export function formatDate(ms, timezone) {
  const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };
  try { return new Intl.DateTimeFormat(undefined, { ...options, timeZone: timezone || undefined }).format(ms); }
  catch { return new Intl.DateTimeFormat(undefined, options).format(ms); }
}

export const minutes = seconds => Math.round((Number(seconds) || 0) / 60);

// A datetime-local value for a moment, in this device's time zone.
export const localInput = ms => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
