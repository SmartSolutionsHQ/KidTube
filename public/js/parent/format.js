// Words and numbers for the parent dashboard. Pure: no DOM, no fetch, so the tests import it in Node.
// Times show in the parent's own time zone through Intl; `now` and `locale` are only passed in by tests.

const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

// "just now", "12 min", "2 h", "Tue", "Oct 3": short, for the right edge of a feed row.
export function ago(at, { now = Date.now(), locale, timeZone } = {}) {
  const gap = now - at;
  if (gap < MINUTE) return 'just now';
  if (gap < HOUR) return `${Math.floor(gap / MINUTE)} min`;
  if (gap < DAY) return `${Math.floor(gap / HOUR)} h`;
  if (gap < 6 * DAY) return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone }).format(at);
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone }).format(at);
}

// "12 minutes ago", "1 hour ago", "yesterday", "3 days ago": for sentences.
export function agoLong(at, { now = Date.now() } = {}) {
  const gap = Math.max(0, now - at);
  if (gap < MINUTE) return 'just now';
  if (gap < HOUR) return plural(Math.floor(gap / MINUTE), 'minute') + ' ago';
  if (gap < DAY) return plural(Math.floor(gap / HOUR), 'hour') + ' ago';
  if (gap < 2 * DAY) return 'yesterday';
  return plural(Math.floor(gap / DAY), 'day') + ' ago';
}

// "Tue 6:14 PM" this week, "Oct 3, 6:14 PM" before that.
export function when(at, { now = Date.now(), locale, timeZone } = {}) {
  const recent = Math.abs(now - at) < 6 * DAY;
  return new Intl.DateTimeFormat(locale, recent
    ? { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }).format(at).replace(',', recent ? '' : ',');
}

// "tomorrow at 5:01 PM", "today at 9:00 AM", "Oct 30 at 5:01 PM".
export function until(at, { now = Date.now(), locale, timeZone } = {}) {
  const day = value => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(at);
  if (day(at) === day(now)) return `today at ${time}`;
  if (day(at) === day(now + DAY)) return `tomorrow at ${time}`;
  return `${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone }).format(at)} at ${time}`;
}

// 89 → "1:29", 3725 → "1:02:05".
export function clock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// 18.4 GB, 640 MB, 12 KB.
export function bytes(n) {
  const value = Math.max(0, Number(n) || 0);
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let unit = 0, size = value;
  while (size >= 1000 && unit < units.length - 1) { size /= 1000; unit++; }
  if (unit === 0) return `${value} bytes`;
  return `${size >= 100 ? Math.round(size) : size.toFixed(1).replace(/\.0$/, '')} ${units[unit]}`;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The summary cards on Home: "2 videos to review", "1 comment to review", "1 person asking to watch".
export function countLine(kind, n) {
  return {
    review: n === 1 ? 'video to review' : 'videos to review',
    comments: n === 1 ? 'comment to review' : 'comments to review',
    people: n === 1 ? 'person asking to watch' : 'people asking to watch',
  }[kind];
}

// The tab title names the family, or the product while the family has no name yet.
export const dashboardTitle = (family, brand) => `Parent dashboard · ${String(family || '').trim() || brand}`;

export const ROLE_NAMES = { super: 'Owner', admin: 'Co-parent', kid: 'Kid login', '': 'Viewer' };
export const STATUS_NAMES = { approved: 'Can watch', pending: 'Asking to watch', denied: 'Turned down' };
