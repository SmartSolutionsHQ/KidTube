import { listChannels, publicChannel } from './channels.mjs';
import { BRAND_NAME } from './brand.mjs';

export function createSite({ sqlite, settings }) {
  const owner = sqlite.prepare("SELECT 1 FROM accounts WHERE role='super' AND status='approved' LIMIT 1");

  // Public: enough to draw the front door. Kids appear only when the family allows it.
  function info() {
    const site = settings.all();
    return {
      ok: true, brand: BRAND_NAME, tagline: site.tagline, familyName: site.familyName,
      gateTheme: site.gateTheme, accent: site.accent, setup: owner.get() ? 'complete' : 'required',
      kidsPublic: site.kidsPublic,
      channels: site.kidsPublic ? listChannels(sqlite).map(row => publicChannel(row, site)) : [],
    };
  }

  // Signed in: every channel, whatever the front-door setting.
  function channels() {
    const site = settings.all();
    return {
      ok: true,
      channels: listChannels(sqlite).map(row => ({ ...publicChannel(row, site), tagline: row.tagline || site.tagline })),
    };
  }

  return { info, channels };
}
