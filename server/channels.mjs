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

// Clips that arrive without a channel go to the first one; an install with no kids yet gets one.
export function defaultChannel(sqlite) {
  const first = sqlite.prepare('SELECT * FROM channels ORDER BY position, id LIMIT 1').get();
  if (first) return first;
  sqlite.prepare("INSERT OR IGNORE INTO channels (slug,name,created) VALUES ('main','Main channel',?)").run(Date.now());
  return channelBySlug(sqlite, 'main');
}

// What viewers may see about a channel; empty choices fall back to the family's.
export function publicChannel(row, site) {
  return {
    slug: row.slug, name: row.name, kicker: row.kicker,
    accent: row.accent || site.accent, themeId: row.theme_id || site.gateTheme,
    logoUrl: row.logo_rev ? `/brand/${row.slug}.svg?v=${row.logo_rev}` : null,
  };
}
