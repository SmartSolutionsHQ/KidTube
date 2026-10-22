// The watch log and the daily tape, on the feed's side. It listens to the feed's videos in the capture
// phase (like the pause accent), so feed.js only calls attachWatch() once after boot.
//
// Each clip played for 3 s starts a view (POST /api/view); watched seconds go to POST /api/view/beat
// every 15 s and when the video pauses or ends, the viewer swipes away or the tab hides. For a
// budgeted kid the remaining tape counts down locally between answers; there is a pill at 5 minutes and
// at 1 minute (in the theme's words when it has them), and at zero the video stops, the reel goes inert
// and the theme's end-of-tape screen opens. No "ask for more" button and no repeating nags: one pill per
// threshold, one ending. The server refuses the video once the tape is spent, as a backstop.
import { showEnding } from './endings.js';
import { loadRegistry } from './themes.js';

export const START_AFTER_S = 3;
export const BEAT_MS = 15000;
export const WARNINGS = [{ at: 300, key: 'warn5', text: '5 minutes of tape left' }, { at: 60, key: 'warn1', text: '1 minute of tape left' }];

const post = (path, body, { keepalive = false } = {}) => fetch(path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive, credentials: 'same-origin',
}).then(async response => ({ status: response.status, body: await response.json().catch(() => null) })).catch(() => null);

// Words for the warnings: the theme's endingCopy when it has them.
async function warningWords(themeId) {
  try {
    const registry = await loadRegistry();
    return registry.themes.find(theme => theme.id === themeId)?.endingCopy || {};
  } catch { return {}; }
}

export function attachWatch({ budget = null, channel = window.__ktChannel || {}, clipOf, onEnd } = {}) {
  const views = new WeakMap();
  let tape = null, ended = false, words = {};
  const warned = new Set();
  warningWords(channel.themeId).then(found => { words = found; });

  // Seconds of tape left now: the last answer minus what has played since.
  const remaining = () => (tape ? tape.remaining - (tape.spent || 0) : Infinity);
  // A pill only for a threshold the tape crosses while playing; ones already behind it stay quiet.
  const arm = left => { warned.clear(); for (const warning of WARNINGS) if (left <= warning.at) warned.add(warning.key); };
  const syncBudget = next => {
    if (!next) return;
    // More tape than before (a parent's bonus) re-arms the warnings still ahead of it.
    if (!tape || next.remaining > remaining() + 30) arm(next.remaining);
    tape = { ...next, at: performance.now(), spent: 0 };
  };
  if (budget) { arm(budget.remaining); tape = { ...budget, at: performance.now(), spent: 0 }; }

  function state(video) {
    let entry = views.get(video);
    const slide = video.closest('.tz-slide');
    const clip = slide && clipOf(slide);
    if (!clip || clip.sealed) return null;
    if (!entry || entry.clipId !== clip.id) {
      entry = { clipId: clip.id, viewId: 0, starting: false, played: 0, unsent: 0, last: video.currentTime || 0, completed: false };
      views.set(video, entry);
    }
    return entry;
  }

  function pill(text) {
    let node = document.querySelector('.tz-tape-pill');
    if (!node) {
      node = document.createElement('div');
      node.className = 'tz-tape-pill';
      node.setAttribute('role', 'status');
      document.querySelector('.tz-app')?.append(node);
    }
    node.textContent = text;
    node.hidden = false;
    clearTimeout(node._t);
    node._t = setTimeout(() => { node.hidden = true; }, 5000);
  }

  function warn() {
    const left = remaining();
    for (const warning of WARNINGS) {
      if (left <= warning.at && left > 0 && !warned.has(warning.key)) {
        warned.add(warning.key);
        pill(words[warning.key] || warning.text);
      }
    }
  }

  async function start(entry, video) {
    entry.starting = true;
    const answer = await post('/api/view', { clipId: entry.clipId, seconds: Math.floor(entry.played) });
    entry.starting = false;
    if (answer?.body?.ok) {
      entry.viewId = answer.body.viewId;
      entry.unsent = 0;
      syncBudget(answer.body.budget);
    } else if (answer?.body?.error === 'end-of-tape') {
      syncBudget(answer.body.budget || { ...tape, remaining: 0 });
      end();
    } else {
      entry.viewId = -1;
    }
    if (video.paused) flush(video, { keepalive: true });
  }

  // Sends what this video has played since its last report.
  async function flush(video, { keepalive = false, beacon = false } = {}) {
    const entry = views.get(video);
    if (!entry || entry.viewId <= 0) return null;
    const seconds = Math.floor(entry.unsent);
    if (seconds < 1 && !entry.completed) return null;
    entry.unsent -= seconds;
    const body = { viewId: entry.viewId, seconds, completed: entry.completed };
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/view/beat', JSON.stringify(body)); return null; }
    const answer = await post('/api/view/beat', body, { keepalive });
    if (answer?.body?.ok) syncBudget(answer.body.budget);
    return answer;
  }

  async function reachZero(video) {
    video.pause();
    const answer = await flush(video);
    // A parent may have added minutes; only a confirmed zero (or no answer at all) ends the tape.
    if (answer?.body?.budget && answer.body.budget.remaining > 0) { video.play().catch(() => {}); return; }
    end();
  }

  function end() {
    if (ended) return;
    ended = true;
    // Stop and let go of every file, so no neighbour keeps asking for video the server now refuses.
    for (const video of document.querySelectorAll('.tz-slide video')) { video.pause(); video.removeAttribute('src'); video.removeAttribute('poster'); video.load(); }
    for (const selector of ['.tz-app', '.tz-head']) { const node = document.querySelector(selector); if (node) node.inert = true; }
    document.querySelector('.tz-tape-pill')?.remove();
    const show = () => {
      showEnding({ channel, budget: { ...tape, remaining: 0 }, onDone: () => location.assign('/') });
      onEnd?.(tape);
    };
    // Wait for the splash to lift, so the ending is what the kid sees next.
    if (window.__tzsplash) document.addEventListener('tz:enter', show, { once: true });
    else show();
  }

  const isFeedVideo = target => target instanceof HTMLVideoElement && target.closest('.tz-slide');
  document.addEventListener('timeupdate', event => {
    const video = event.target;
    if (!isFeedVideo(video) || ended) return;
    const entry = state(video);
    if (!entry) return;
    const delta = video.currentTime - entry.last;
    entry.last = video.currentTime;
    // A short clip looping back to its start has been watched through.
    if (video.loop && delta < -1 && entry.played > 1) entry.completed = true;
    // Seeks and loops jump; only steady playback counts.
    if (video.paused || video.seeking || delta <= 0 || delta > 1.5) return;
    entry.played += delta;
    entry.unsent += delta;
    if (tape) { tape.spent = (tape.spent || 0) + delta; warn(); if (remaining() <= 0) { reachZero(video); return; } }
    if (!entry.viewId && !entry.starting && entry.played >= START_AFTER_S) start(entry, video);
  }, true);
  document.addEventListener('play', event => {
    const video = event.target;
    if (!isFeedVideo(video)) return;
    if (ended || (tape && remaining() <= 0)) { video.pause(); end(); return; }
    const entry = state(video);
    if (entry) entry.last = video.currentTime;
  }, true);
  document.addEventListener('pause', event => { if (isFeedVideo(event.target)) flush(event.target, { keepalive: true }); }, true);
  document.addEventListener('ended', event => {
    const video = event.target;
    if (!isFeedVideo(video)) return;
    const entry = views.get(video);
    if (entry) entry.completed = true;
    flush(video, { keepalive: true });
  }, true);
  const playing = () => [...document.querySelectorAll('.tz-slide video')].filter(video => !video.paused);
  setInterval(() => { if (!document.hidden) playing().forEach(video => flush(video)); }, BEAT_MS);
  const leave = () => document.querySelectorAll('.tz-slide video').forEach(video => flush(video, { beacon: true }));
  document.addEventListener('visibilitychange', () => { if (document.hidden) leave(); });
  window.addEventListener('pagehide', leave);

  if (tape && tape.remaining <= 0) end();
  return { remaining, end, get ended() { return ended; } };
}
