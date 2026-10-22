// Kids' channels and who may watch them: the lookups, what viewers may see about a channel, and the
// rule for playing a clip that api.js, uploads, reactions and the watch log all follow.
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function listChannels(sqlite) {
  return sqlite.prepare('SELECT * FROM channels ORDER BY position, id').all();
}

export function channelBySlug(sqlite, slug) {
  return SLUG.test(String(slug)) ? sqlite.prepare('SELECT * FROM channels WHERE slug=?').get(slug) : undefined;
}

export function channelById(sqlite, id) {
  return id == null ? undefined : sqlite.prepare('SELECT * FROM channels WHERE id=?').get(id);
}

// The migration seeds channel 1 and a trigger keeps it, so anything without a channel can land there.
export const DEFAULT_CHANNEL_ID = 1;

// What viewers may see about a channel; empty choices fall back to the family's.
export function publicChannel(row, site) {
  return {
    slug: row.slug, name: row.name, kicker: row.kicker,
    accent: row.accent || site.family_accent, themeId: row.theme_id || site.gate_theme,
    logoUrl: row.logo_rev ? `/brand/${row.slug}.svg?v=${row.logo_rev}` : null,
  };
}

// Who may watch a channel. viewer comes from access.mjs: an approved account sees every kid in the
// family; a guest pass may be limited to one channel.
export function canViewChannel(viewer, channel) {
  if (!viewer || !channel) return false;
  if (viewer.role === 'guest') return viewer.channelId == null || Number(viewer.channelId) === Number(channel.id);
  return true;
}

// Parents: 'super' is the owner, 'admin' a co-parent. Takes anything with a role (a viewer, an account row).
const STAFF = new Set(['admin', 'super']);
export const isStaff = viewer => STAFF.has(viewer?.role);

// Clip ids: UUIDs for uploads, short names for older and seeded clips.
const CLIP_ID = /^[A-Za-z0-9_-]{1,80}$/;
export const isClipId = id => CLIP_ID.test(String(id || ''));

// Who may play a clip: clip carries channel_id, review, hidden and uploader (the upload job's email).
// A clip waiting for review, rejected or hidden is for parents and the kid who posted it, nobody else.
export function canPlayClip(viewer, clip) {
  if (!viewer || !clip) return false;
  if (clip.review === 'approved' && !clip.hidden) return canViewChannel(viewer, { id: clip.channel_id });
  return isStaff(viewer) || (!!viewer.email && viewer.email === clip.uploader);
}

// The columns canPlayClip needs, for a clip found by id or by its media path.
export const CLIP_ACCESS_SQL = `SELECT c.id, c.channel_id, c.review, c.hidden, ch.slug AS channel,
  (SELECT j.email FROM upload_jobs j WHERE j.clip_id=c.id LIMIT 1) AS uploader
  FROM clips c LEFT JOIN channels ch ON ch.id=c.channel_id`;
