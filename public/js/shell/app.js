// The viewer shell: decides what a visitor sees before the feed, and which kid's feed it is.
//
//   GET /api/site   setup unfinished → /setup; family name, accent, and the kids when kids_public is on
//   GET /api/me     who the cookie names (account, kid account, guest pass and its channel), or nobody
//
// Signed out, kids listed: the front door shows every kid's badge; picking one plays that kid's splash,
// then the sign-in card. One kid: their splash straight away. Kids hidden: the family splash instead.
// Signed in: the picker (skipped with one kid or a one-kid guest pass), then the kid's splash, then
// their feed. Old #/v/<id> links and stale kid names are found through /api/clips/locate.
//
// feed.js stays the feed. It reads window.__ktChannel (slug, upload rights) and window.__ktShell (the
// empty channel and "Sent to a parent"), loads on 'kid:unlocked' and the page wakes on 'tz:enter'.
// Switching kids sets the address and reloads, so no feed state crosses from one kid to the next.
import { displayName, loadSite, showChannel } from './site.js';
import { alwaysEnter, attachPause, feedVars, loadRegistry, showSplash } from './themes.js';
import { channelHash, parseRoute, routeClip } from './route.mjs';
import { clearSession, logOut, openAuth, openProfile, readSession, revalidate, wireAuthDialog, writeSession } from './auth-dialog.js';
import { closeDoor, openDoor, openLobby, openNote } from './gate.js';
import { badgeFor, openSwitcher } from './picker.js';
// Registers the service worker for the home-screen app (secure contexts only).
import './pwa.js';

// recovery.js reads this once when it boots to know a splash is coming; showSplash() replaces it.
window.__tzsplash ??= { state: 'pending' };

const STAFF = new Set(['admin', 'super']);
const $ = selector => document.querySelector(selector);
// Everything but the front door, the sign-in card and scripts waits until a kid's feed opens.
const appParts = [...document.body.children].filter(node => !['kt-door', 'account-dialog'].includes(node.id) && node.tagName !== 'SCRIPT');
appParts.forEach(node => { node.inert = true; });

const getJSON = path => fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } })
  .then(response => response.json().catch(() => null)).catch(() => null);

let site = null;
let route = parseRoute(location.hash);

// Who is here. A stored session whose cookie lapsed is re-checked once (the server re-issues the
// cookie). An account cookie without its stored token can't like, comment or upload, so it signs in again.
async function whoAmI() {
  let me = await getJSON('/api/me');
  const local = readSession();
  if (!me?.viewer && local) {
    if (await revalidate(local)) me = await getJSON('/api/me');
    else clearSession();
  }
  const viewer = me?.viewer || null;
  if (viewer && viewer.role !== 'guest') {
    if (!local || local.guest || local.email !== viewer.email) return null;
    if (local.role !== viewer.role) writeSession({ ...local, role: viewer.role });
  }
  return viewer;
}

function splashOptions(channel, number) {
  return {
    themeId: channel.themeId, title: channel.name, kicker: channel.kicker, number, accent: channel.accent,
    logoUrl: channel.logoUrl, channel: channel.slug, brand: site.brand, soundAllowed: site.splashSound,
  };
}

const familySplash = () => showSplash({
  mode: 'gate', themeId: site.gateTheme, accent: site.accent, title: displayName(site), brand: site.brand, soundAllowed: site.splashSound,
});

// ---------- signed out ----------

async function signedOut() {
  const kids = site.kidsPublic ? site.channels || [] : [];
  const wanted = kids.find(kid => kid.slug === route.slug);
  if (!kids.length) {
    openLobby({ title: displayName(site), kicker: site.tagline });
    await familySplash();
    await signIn({ title: displayName(site) });
    return signedIn(null, false);
  }
  if (wanted || kids.length === 1) return kidThenSignIn(wanted || kids[0], kids);
  return frontDoor(kids);
}

async function frontDoor(kids) {
  const choice = await openDoor({ kicker: displayName(site), channels: kids, parentLink: true });
  if (choice.parent) {
    openLobby({ title: displayName(site), kicker: site.tagline });
    const session = await signIn({ title: displayName(site), onBack: () => frontDoor(kids), backLabel: 'Back' });
    if (session) return signedIn(null, false);
    return;
  }
  return kidThenSignIn(choice.channel, kids);
}

async function kidThenSignIn(kid, kids) {
  openLobby({ title: kid.name, kicker: kid.kicker || displayName(site), channel: kid });
  await showSplash(splashOptions(kid, kids.indexOf(kid) + 1));
  const session = await signIn({ title: kid.name, onBack: kids.length > 1 ? () => frontDoor(kids) : null });
  if (!session) return;
  // Picking another kid than a link named drops the link; an old #/v/ link is still looked up after.
  if (route.name !== 'legacy' && route.slug !== kid.slug) route = { name: 'channel', slug: kid.slug };
  return signedIn(kid.slug, true);
}

// Resolves with the session, or null when the visitor went back to the door (onBack took over).
function signIn({ title, onBack = null, backLabel }) {
  let left = false;
  const back = onBack && (() => { left = true; onBack(); });
  return openAuth({ site, title, onBack: back, backLabel }).then(session => (left ? null : session));
}

// ---------- signed in ----------

async function signedIn(preferred, splashPlayed) {
  const viewer = await whoAmI();
  if (!viewer) return signedOut();
  const channels = (await getJSON('/api/channels'))?.channels || [];
  if (!channels.length) {
    return openNote({
      title: 'Nothing to watch yet', text: 'The family has not set up a channel for you. Ask a parent.',
      action: 'Log out', onAction: logOut,
    });
  }
  const bySlug = slug => channels.find(channel => channel.slug === slug);
  let channel = bySlug(preferred) || bySlug(route.slug);
  let clipId = routeClip(route);
  let located = false;
  // An old #/v/<id> link, or a kid name that no longer exists: ask where the clip lives.
  if (clipId && (!bySlug(route.slug) || route.name === 'legacy')) {
    const found = await getJSON(`/api/clips/locate?id=${encodeURIComponent(clipId)}`);
    located = !!(found?.ok && bySlug(found.channel));
    if (located) channel = bySlug(found.channel);
    else clipId = null;
  }
  // A clip link for one kid doesn't follow the viewer to another kid they picked.
  if (!located && channel && route.slug !== channel.slug) clipId = null;
  if (!channel && channels.length === 1) channel = channels[0];
  while (!channel) {
    const choice = await openDoor({ kicker: displayName(site), channels, accountLink: true });
    if (choice.account) profile(viewer, channels, null);
    channel = choice.channel;
  }
  // A splash that already played counts only for the kid it played for (a one-kid guest pass may differ).
  return enterChannel(channel, { viewer, channels, clipId, splashPlayed: splashPlayed && channel.slug === preferred });
}

function canUpload(viewer, channel) {
  return STAFF.has(viewer.role) || (viewer.role === 'kid' && viewer.channel === channel.slug);
}

async function enterChannel(channel, { viewer, channels, clipId, splashPlayed }) {
  const number = channels.indexOf(channel) + 1;
  const creator = canUpload(viewer, channel);
  window.__ktChannel = { slug: channel.slug, name: channel.name, accent: channel.accent, logoUrl: channel.logoUrl, canUpload: creator, number,
    themeId: channel.themeId, splashSound: site.splashSound === true, timezone: site.timezone };
  window.__ktShell = { emptyMarkup: () => emptyMarkup(channel, creator), sentToParent: (clip, title) => sentToParent(channel, clip, title) };
  history.replaceState(null, '', channelHash(channel.slug, clipId));
  route = parseRoute(location.hash);

  // The header shows the kid, in their accent, before the splash lifts, so the wordmark slides in on Enter.
  showChannel({ name: channel.name, logoUrl: channel.logoUrl, accent: channel.accent });
  const registry = await loadRegistry();
  const theme = registry.themes.find(entry => entry.id === channel.themeId);
  for (const [name, value] of Object.entries(feedVars(theme, channel.accent))) document.body.style.setProperty(name, value);

  const splash = splashPlayed ? null : showSplash(splashOptions(channel, number));
  // The feed loads behind the splash; recovery.js holds playback until the viewer taps.
  closeDoor();
  unlock(viewer);
  if (splash) await splash;
  else document.dispatchEvent(new Event('tz:enter'));
  if (window.__tzsplash?.state === 'pending') delete window.__tzsplash;

  // The VHS pause screen: the kid's theme when it has one, Ember Tape's otherwise. It waits for the first
  // clip to really play, so the clip held still until the first tap doesn't open on "PAUSED".
  const pauseTheme = theme?.accents?.pause ? theme.id : 'ember-tape';
  const startPause = event => {
    if (!event.target.closest?.('.tz-slide')) return;
    document.removeEventListener('playing', startPause, true);
    attachPause({ themeId: pauseTheme, title: channel.name, channel: channel.slug, accent: channel.accent, number, registry });
  };
  document.addEventListener('playing', startPause, true);
  wireHeader(viewer, channels, channel);
  $('#tz-reel')?.focus({ preventScroll: true });
}

function unlock(viewer) {
  window.kidUnlocked = true;
  document.body.removeAttribute('data-locked');
  appParts.forEach(node => { node.inert = false; });
  $('#account-button').textContent = viewer.role === 'guest' ? 'Guest' : 'Account';
  // Only parents have a dashboard; kids, viewers and guests would be sent straight back.
  const parentsLink = document.querySelector('.kid-nav a[href="/parents"]');
  if (parentsLink) parentsLink.hidden = !STAFF.has(viewer.role);
  document.dispatchEvent(new Event('kid:unlocked'));
}

function profile(viewer, channels, channel) {
  openProfile({
    session: readSession(),
    title: channel?.name || displayName(site),
    dashboard: STAFF.has(viewer.role),
    introLabel: channel ? `Skip ${channel.name}'s intro next time` : '',
    introSkipped: channel ? alwaysEnter(channel.slug) : false,
    onIntro: skip => alwaysEnter(channel.slug, skip),
    onSwitch: channel && channels.length > 1 ? () => openSwitcher(channels, channel.slug) : null,
  });
}

function wireHeader(viewer, channels, channel) {
  $('#account-button').onclick = () => profile(viewer, channels, channel);
  const switcher = $('#switch-kid');
  switcher.hidden = channels.length < 2;
  switcher.onclick = () => openSwitcher(channels, channel.slug);
}

// ---------- inside the feed ----------

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The channel with no clips yet: the kid's name and, for whoever may post here, a big record button.
function emptyMarkup(channel, creator) {
  return `<div class="kt-empty">
      <span class="kt-empty-badge" data-kt-badge></span>
      <p class="kt-empty-kicker">${esc(channel.name)}</p>
      <h2 class="kt-empty-title">No tapes yet</h2>
      <p class="kt-empty-line">${creator ? 'Record the very first one.' : `${esc(channel.name)}'s first video will show up here.`}</p>
      ${creator ? '<button class="kt-record" type="button" data-kt-record><span class="kt-record-dot" aria-hidden="true"></span>Record your first tape</button>' : ''}
    </div>`;
}

document.addEventListener('click', event => {
  if (event.target.closest('[data-kt-record]')) window.__tzfeed?.pick?.();
});
// The empty slide's badge is an element, not markup, so a badge URL never passes through innerHTML.
new MutationObserver(() => {
  const slot = document.querySelector('[data-kt-badge]:empty');
  if (slot && window.__ktChannel) slot.append(badgeFor(window.__ktChannel));
}).observe(document.getElementById('tz-reel'), { childList: true });

// A kid's upload waiting for review: the canvas's "Sent to a parent" screen.
function sentToParent(channel, clip, title) {
  let box = document.getElementById('kt-sent');
  if (!box) {
    box = document.createElement('dialog');
    box.id = 'kt-sent';
    box.className = 'kt-sent';
    box.setAttribute('aria-labelledby', 'kt-sent-title');
    box.innerHTML = `<p class="kt-sent-rec"><span aria-hidden="true">●</span> REC · Tracking 100%</p>
      <h2 class="kt-sent-title" id="kt-sent-title">Sent to a parent</h2>
      <p class="kt-sent-line" data-sent="line"></p>
      <div class="kt-sent-bar" aria-hidden="true"><span></span></div>
      <button class="block-button" type="button" data-sent="close">Back to the tape</button>`;
    box.querySelector('[data-sent="close"]').addEventListener('click', () => box.close());
    document.body.append(box);
  }
  const name = (clip?.title || title || 'Your video').trim();
  box.querySelector('[data-sent="line"]').textContent = `${name} shows up on ${channel.name} once a parent says yes.`;
  box.showModal();
  box.querySelector('[data-sent="close"]').focus();
}

// ---------- boot ----------

// A hand-edited address or Back after switching kids: start again on the new address.
window.addEventListener('hashchange', () => {
  const next = parseRoute(location.hash);
  if (next.slug !== route.slug || routeClip(next) !== routeClip(route)) location.reload();
});

async function boot() {
  wireAuthDialog();
  site = await loadSite();
  if (!site) {
    return openNote({ title: "Can't reach the tube", text: "The family's video box isn't answering. Check the connection and try again.", action: 'Try again', onAction: () => location.reload() });
  }
  if (site.setup === 'required') { location.replace('/setup'); return; }
  const viewer = await whoAmI();
  if (viewer) return signedIn(null, false);
  return signedOut();
}

boot().catch(error => {
  console.error('The viewer shell failed to start', error);
  openNote({ title: 'Something went wrong', text: 'Reload the page to try again.', action: 'Reload', onAction: () => location.reload() });
});
