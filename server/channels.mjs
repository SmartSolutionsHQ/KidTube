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
