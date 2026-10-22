import { canViewChannel, listChannels, publicChannel } from './channels.mjs';
import { BRAND_NAME, ENDORSEMENT } from './brand.mjs';

export function createSite({ sqlite, settings }) {
  // Public: enough to draw the front door. Kids appear only when the family allows it.
  function info() {
    const site = settings.all();
    return {
      ok: true, brand: { name: BRAND_NAME, endorsement: ENDORSEMENT },
      siteName: site.site_name, tagline: site.site_tagline, accent: site.family_accent, gateTheme: site.gate_theme,
      badge: site.family_badge, splashSound: site.splash_sound, signupMode: site.signup_mode, guestPasses: site.guest_passes,
      setup: site.setup_complete ? 'complete' : 'required', kidsPublic: site.kids_public, timezone: site.family_timezone,
      channels: site.kids_public ? listChannels(sqlite).map(row => publicChannel(row, site)) : [],
    };
  }

  // Signed in: every channel the viewer may watch (a guest pass can be limited to one), whatever the
  // front-door setting.
  function channels(viewer) {
    const site = settings.all();
    return {
      ok: true,
      channels: listChannels(sqlite).filter(row => canViewChannel(viewer, row))
        .map(row => ({ ...publicChannel(row, site), tagline: row.tagline || site.site_tagline })),
    };
  }

  return { info, channels };
}
