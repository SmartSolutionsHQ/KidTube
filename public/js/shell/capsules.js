// Time capsules in the feed. A sealed clip arrives from /api/clips without media and shows as a locked
// tape: a cassette with a SEALED label, the title, when it opens (counted in the family's time zone),
// the note and who sealed it. Swiping and the running order work as usual; there is nothing to play,
// like, comment on or react to. When an opened capsule comes on screen for the first time in a week,
// the theme's unlock plays over it before the clip starts (endings.js), once per device.
import { playUnlock } from './endings.js';
import { prefersReducedMotion } from './themes.js';

export const UNLOCK_WINDOW_MS = 7 * 86400000;
const STORE = id => `kt-opened-${id}`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function parts(ms, timezone) {
  try {
    const list = new Intl.DateTimeFormat('en-US', { timeZone: timezone || undefined, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(ms);
    const get = type => Number(list.find(part => part.type === type)?.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'));
  } catch { const date = new Date(ms); return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()); }
}
const format = (ms, options, timezone) => {
  try { return new Intl.DateTimeFormat(undefined, { ...options, timeZone: timezone || undefined }).format(ms); }
  catch { return new Intl.DateTimeFormat(undefined, options).format(ms); }
};

// "Opens Sat, Mar 13, 2027"
export const opensLabel = (opensAt, timezone) => `Opens ${format(opensAt, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }, timezone)}`;

// How long until it opens, in words: "in 212 days", "tomorrow", "today at 9:00 AM", "in 12 minutes".
export function countdown(opensAt, now = Date.now(), timezone) {
  const left = opensAt - now;
  if (left <= 0) return 'opening now';
  if (left < 60000) return 'any second now';
  if (left < 3600000) { const minutes = Math.ceil(left / 60000); return `in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`; }
  const days = Math.round((parts(opensAt, timezone) - parts(now, timezone)) / 86400000);
  if (days <= 0) return `today at ${format(opensAt, { hour: 'numeric', minute: '2-digit' }, timezone)}`;
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

// The slide feed.js renders for a sealed clip: the rail keeps only the running-order controls.
export function lockedSlideMarkup(clip, i, total, timezone) {
  return `
  <section class="tz-slide tz-locked" data-i="${i}" data-id="${esc(clip.id)}" data-state="ready" data-sealed="1"
           tabindex="-1" aria-label="Clip ${i + 1} of ${total}. Time capsule, sealed. ${esc(clip.title)}. ${esc(opensLabel(clip.opensAt, timezone))}.">
    <div class="tz-slot tz-capsule" data-act="wobble">
      <div class="tz-cassette" aria-hidden="true">
        <span class="tz-cassette-label"><span class="tz-cassette-seal">Sealed</span></span>
        <span class="tz-cassette-reels"><i></i><i></i></span>
        <span class="tz-cassette-tape"></span>
      </div>
      <div class="tz-capsule-text">
        <p class="tz-capsule-kicker"><span class="tz-capsule-lock" aria-hidden="true"></span>Time capsule</p>
        <h2 class="tz-capsule-title">${esc(clip.title)}</h2>
        <p class="tz-capsule-when"><span>${esc(opensLabel(clip.opensAt, timezone))}</span>
          <span class="tz-capsule-count" data-opens="${Number(clip.opensAt)}">${esc(countdown(clip.opensAt, Date.now(), timezone))}</span></p>
        ${clip.capsuleNote ? `<p class="tz-capsule-note">“${esc(clip.capsuleNote)}”</p>` : ''}
        ${clip.sealedBy ? `<p class="tz-capsule-by">Sealed by ${esc(clip.sealedBy)}</p>` : ''}
      </div>
    </div>
    <div class="tz-rail">
      <button type="button" data-act="newer" aria-label="Newer clip"><span class="tz-ico" data-ico="up" aria-hidden="true"></span></button>
      <button type="button" data-act="index" aria-label="Open the channel index"><span class="tz-ico" data-ico="list" aria-hidden="true"></span></button>
      <button type="button" data-act="older" aria-label="Older clip"><span class="tz-ico" data-ico="down" aria-hidden="true"></span></button>
    </div>
  </section>`;
}

// The running order shows a lock where the thumbnail would be.
export const lockedThumbMarkup = () => '<span class="tz-log-lock" aria-hidden="true"></span>';

// A tap on the locked tape gives it a little shake (none with reduced motion).
export function wobble(slide) {
  if (prefersReducedMotion()) return;
  const tape = slide.querySelector('.tz-cassette');
  if (!tape) return;
  tape.classList.remove('tz-wobble');
  void tape.offsetWidth;
  tape.classList.add('tz-wobble');
  tape.addEventListener('animationend', () => tape.classList.remove('tz-wobble'), { once: true });
}

// Keeps the countdown words fresh, and calls onDue(clipId) once each sealed clip's date passes.
export function watchSealed(clips, timezone, onDue) {
  const due = new Set();
  const refresh = () => {
    const now = Date.now();
    for (const node of document.querySelectorAll('.tz-capsule-count[data-opens]')) node.textContent = countdown(Number(node.dataset.opens), now, timezone);
    for (const clip of clips()) {
      if (clip.sealed && clip.opensAt <= now && !due.has(clip.id)) { due.add(clip.id); onDue(clip.id); }
    }
  };
  const timer = setInterval(refresh, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  return () => clearInterval(timer);
}

const seen = id => { try { return localStorage.getItem(STORE(id)) === '1'; } catch { return false; } };
const remember = id => { try { localStorage.setItem(STORE(id), '1'); } catch {} };
const running = new WeakSet();

// Whether this clip's unlock should play when it comes on screen.
export const wantsUnlock = clip => !!clip?.openedAt && !clip.sealed && Date.now() - clip.openedAt < UNLOCK_WINDOW_MS && !seen(clip.id);

// Plays the unlock over the slide's slot while the clip waits, then calls play(). The feed holds the
// video while slide.dataset.unlocking is set. A blocked storage replays it each visit that week.
export async function runUnlock(slide, clip, channel, play) {
  if (running.has(slide)) return;
  running.add(slide);
  slide.dataset.unlocking = '1';
  slide.querySelector('video')?.pause();
  try {
    await playUnlock({ slot: slide.querySelector('.tz-slot') || slide, channel, clip });
  } catch (error) {
    console.warn('Unlock failed', error);
  } finally {
    remember(clip.id);
    delete slide.dataset.unlocking;
    running.delete(slide);
    play();
  }
}

// Holds any play() that sneaks in (the media rescue, a tap) while an unlock is on screen.
globalThis.document?.addEventListener('play', event => {
  const slide = event.target?.closest?.('.tz-slide');
  if (slide?.dataset.unlocking) event.target.pause();
}, true);
