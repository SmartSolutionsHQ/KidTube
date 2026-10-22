// "Who watched": turning GET /api/admin/views into table rows. Pure, so the tests feed it stubbed answers.
//
// Its rows, newest first:
//   { clipId, clipTitle, channel, viewer, viewerName, started, seconds, duration, completed }
// viewer is an account email or "guest:<12 hex>"; paging is ?channel=&viewer=&before=<started>.
import { clock, when } from './format.js';

// null (the route is not there yet, a 404) → 'unavailable'; no rows → 'empty'; otherwise 'rows'.
export function watchState(data) {
  if (!data) return { kind: 'unavailable', rows: [], next: null };
  const rows = Array.isArray(data.rows) ? data.rows.filter(row => row && typeof row === 'object') : [];
  if (!rows.length) return { kind: 'empty', rows: [], next: null };
  const next = data.next ?? (rows.length ? rows.at(-1).started : null);
  return { kind: 'rows', rows, next: Number.isFinite(next) ? next : null };
}

// guests: Map of "guest:<12 hex>" → the note the parent gave the code ("Grandpa"), when known.
export function viewerLabel(row, guests = new Map()) {
  const id = String(row.viewer || '');
  if (id.startsWith('guest:')) {
    const note = guests.get(id);
    return note ? `Guest (${note})` : `Guest ${id.slice(6, 10).toUpperCase()}`;
  }
  return String(row.viewerName || '').trim() || id || 'Someone';
}

// "1:29 of 1:29", "2:10 of 3:21"; without a known length, just the time watched.
export function watchedLabel(row) {
  const duration = Math.max(0, Number(row.duration) || 0);
  const seconds = Math.max(0, Number(row.seconds) || 0);
  if (!duration) return clock(seconds);
  return `${clock(row.completed ? duration : Math.min(seconds, duration))} of ${clock(duration)}`;
}

export function watchCells(row, { guests, kidName = () => '', now, timeZone, locale } = {}) {
  const kid = kidName(row.channel);
  return {
    viewer: viewerLabel(row, guests),
    video: String(row.clipTitle || 'A deleted video') + (kid ? ` (${kid})` : ''),
    watched: watchedLabel(row),
    when: Number.isFinite(row.started) ? when(row.started, { now, timeZone, locale }) : '',
    completed: !!row.completed,
  };
}

export function viewsQuery({ channel = '', viewer = '', before = null, limit = 50 } = {}) {
  const params = new URLSearchParams();
  if (channel) params.set('channel', channel);
  if (viewer) params.set('viewer', viewer);
  if (before != null) params.set('before', String(before));
  if (limit) params.set('limit', String(limit));
  const text = params.toString();
  return `/api/admin/views${text ? `?${text}` : ''}`;
}
