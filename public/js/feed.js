// src/scripts/kidtube-feed.js
import { publishVideo } from '/js/server-upload-v1.js';
import { playClip, retryClip } from '/js/player-media-v1.js';
// Launch story: time capsules (locked tapes, unlocks), reactions and the daily tape (js/shell/*).
import { lockedSlideMarkup, lockedThumbMarkup, runUnlock, wantsUnlock, watchSealed, wobble } from '/js/shell/capsules.js';
import { attachReactions, chipsMarkup, railButtonMarkup } from '/js/shell/reactions.js';
import { attachWatch } from '/js/shell/watch.js';
var familyZone = () => window.__ktChannel?.timezone || undefined;
var serverBudget = null;
// A spent daily tape: the slides carry no video at all, so nothing asks for a file the server will refuse.
var tapeSpent = () => !!serverBudget && serverBudget.remaining <= 0;
var reactionsUi = null;
var CATALOG = [];
// The shell (js/shell/app.js) names the kid's channel in window.__ktChannel before it unlocks the feed.
var channelSlug = () => window.__ktChannel?.slug || "";
var clipHash = (id) => (channelSlug() ? "#/c/" + channelSlug() : "#") + "/v/" + id;
var serverClipsReady = new Promise(resolve => { if(window.kidUnlocked) resolve(); else document.addEventListener("kid:unlocked",resolve,{once:true}); }).then(() => fetch("/api/clips" + (channelSlug() ? "?channel=" + encodeURIComponent(channelSlug()) : ""))).then((r) => r.json()).then((j) => {
  if (j && j.ok && Array.isArray(j.clips) ) {
    CATALOG.length = 0;
    for (const row of j.clips) CATALOG.push(row);
    serverBudget = j.budget || null;
  }
}).catch(() => {
});
var clips = [...CATALOG].sort((a, b) => {
  const sa = Number.isFinite(a.seq) ? a.seq : Infinity;
  const sb = Number.isFinite(b.seq) ? b.seq : Infinity;
  if (sa !== sb) return sa - sb;
  return b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id);
});
var order = clips.map((c, i) => i);
var rank = (i) => {
  const n = order.indexOf(i);
  return n < 0 ? 0 : n;
};
function syncDomOrder() {
  if (!reel || order.length !== slides.length) return;
  let dirty = false;
  for (let n = 0; n < order.length; n++) {
    if (reel.children[n] !== slides[order[n]]) {
      dirty = true;
      break;
    }
  }
  if (!dirty) return;
  order.forEach((i) => reel.appendChild(slides[i]));
  if (document.body.dataset.mode === "immersive") {
    slides[state.index].scrollIntoView({ behavior: "auto", block: "start" });
  }
}
var MAX_SECONDS = 300;
var REENCODE_MAX = 48 * 1024 * 1024;
var LOOP_UNDER = 60;
var FIT_TOLERANCE = 0.06;
var DESKTOP = window.matchMedia("(min-width: 900px)");
var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
var $ = (s, r = document) => r.querySelector(s);
var queryAll = (s, r = document) => [...r.querySelectorAll(s)];
var body = document.body;
var state = {
  index: 0,
  soundOn: false,
  // session only. Never persisted: every visit starts silent.
  shuffle: false,
  // session only, like sound: every visit starts in date order.
  sheet: null,
  // 'index' | 'comments' | null
  returnFocus: null
};
var MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function fmtDate(iso) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${String(d).padStart(2, "0")} ${y}`;
}
function fmtDur(s) {
  if (!s) return "";
  const rounded = Math.round(s);
  const m = Math.floor(rounded / 60), r = rounded % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
function fmtAgo(ts) {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 6e4));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}
var esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var reel = $("#tz-reel");
function slideMarkup(c, i) {
  if (c.sealed) return lockedSlideMarkup(c, i, clips.length, familyZone());
  const media = `<video playsinline preload="none" muted
              ${c.duration && c.duration < LOOP_UNDER ? "loop" : ""}
              ${c.src && !tapeSpent() ? `src="${esc(c.src)}"` : ""}></video>`;
  return `
  <section class="tz-slide" data-i="${i}" data-id="${esc(c.id)}" data-state="loading"
           tabindex="-1" aria-label="Clip ${i + 1} of ${clips.length}">
    <div class="tz-slot" data-fit="cover" data-orient="portrait">
      <img class="tz-amb" alt="" aria-hidden="true">
      ${media}
    </div>
    <div class="tz-scrimb" aria-hidden="true"></div>

    <button class="tz-tap" type="button" data-act="toggle"
            aria-label="Play or pause"><span class="tz-sr">Play or pause</span></button>
    <span class="tz-glyph" aria-hidden="true"><span class="tz-ico" data-ico="play"></span></span>

    <div class="tz-cap">
      <p class="tz-cap-eyebrow">
        ${i === 0 ? '<span class="tz-rec" aria-hidden="true"></span><span class="tz-label">Latest</span>' : ""}
        <span class="tz-meta">${fmtDate(c.publishedAt)}${c.duration ? " \xB7 " + fmtDur(c.duration) : ""}</span>
      </p>
      <h2 class="tz-cap-title">${esc(c.title)}</h2>
      <p class="tz-cap-blurb">${esc(c.blurb)}</p>
      ${chipsMarkup()}
    </div>

    <div class="tz-rail">
      <button type="button" data-act="newer" aria-label="Newer clip">
        <span class="tz-ico" data-ico="up" aria-hidden="true"></span></button>
      <button type="button" data-act="like" aria-pressed="false" aria-label="Like. 0 likes.">
        <span class="tz-ico" data-ico="heart" aria-hidden="true"></span>
        <span class="tz-likes" data-bind="likes" aria-hidden="true">0</span></button>
      ${railButtonMarkup()}
      <button type="button" data-act="comments" aria-label="Comments">
        <span class="tz-ico" data-ico="chat" aria-hidden="true"></span></button>
      <button type="button" data-act="index" aria-label="Open the channel index">
        <span class="tz-ico" data-ico="list" aria-hidden="true"></span></button>
      <button type="button" data-act="older" aria-label="Older clip">
        <span class="tz-ico" data-ico="down" aria-hidden="true"></span></button>
    </div>

    <div class="tz-err" role="alert">
      <span class="tz-label">Won't play</span>
      <p>This video couldn't load. Try again or check the older clip.</p>
      <div class="tz-err-acts">
        <button class="tz-btn" data-variant="primary" type="button" data-act="retry">Try again</button>
        <button class="tz-btn" type="button" data-act="older">Older clip</button>
      </div>
    </div>

    <span class="tz-buf" aria-hidden="true"></span>
    <button class="tz-bar" type="button" data-act="seek" aria-label="Seek">
      <span class="tz-bar-track"><span class="tz-bar-fill"></span></span>
      <span class="tz-bar-tip" aria-hidden="true">0:00</span>
    </button>
    <span class="tz-failnote" hidden></span>
  </section>`;
}
var slides = [];
function buildReel() {
  if (window.__tzReelBuilt) return;
  window.__tzReelBuilt = true;
  const sorted = [...CATALOG].sort((a, b) => {
    const sa = Number.isFinite(a.seq) ? a.seq : Infinity;
    const sb = Number.isFinite(b.seq) ? b.seq : Infinity;
    if (sa !== sb) return sa - sb;
    return (b.publishedAt || "").localeCompare(a.publishedAt || "") || (a.id || "").localeCompare(b.id || "");
  });
  clips.length = 0;
  for (const c of sorted) clips.push(c);
  order = clips.map((c, i) => i);
  reel.innerHTML = clips.length ? clips.map(slideMarkup).join("") : '<section class="tz-slide" data-end="1">' + (window.__ktShell?.emptyMarkup?.() || "<p>The channel is waiting for its first videos.</p>") + "</section>";
  slides = queryAll(".tz-slide", reel);
  $('[data-bind="total"]').textContent = String(clips.length).padStart(2, "0");
  $('[data-bind="log"]').innerHTML = logMarkup();
  $('[data-bind="log2"]').innerHTML = logMarkup();
  $('[data-bind="logend"]').innerHTML = endplateMarkup();
  $('[data-bind="logend2"]').innerHTML = endplateMarkup();
  for (const s of slides) io.observe(s);
  for (const slide of slides) wireSlide(slide);
  if (window.kidUnlocked) bootFeed(); else document.addEventListener("kid:unlocked", bootFeed, {once:true});
}
serverClipsReady.then(buildReel);
function logMarkup() {
  return clips.map((c, i) => `
    <li><button class="tz-log-row" type="button" data-goto="${i}">
      <span class="tz-log-thumb">
        ${c.sealed ? lockedThumbMarkup() : c.poster ? `<img src="${esc(c.poster)}" alt="" loading="lazy">` : ""}
        <span class="tz-log-n">${String(i + 1).padStart(2, "0")}</span>
      </span>
      <span>
        <span class="tz-log-t">${esc(c.title)}</span>
        <span class="tz-meta">${fmtDate(c.publishedAt)}${c.duration ? " \xB7 " + fmtDur(c.duration) : ""}</span>
      </span>
    </button></li>`).join("");
}
function endplateMarkup() {
  return `<span class="tz-label">The end</span>
    <p class="tz-meta">${clips.length} ${clips.length === 1 ? "CLIP" : "CLIPS"}${clips.length ? " \xB7 SINCE " + fmtDate(clips[clips.length - 1].publishedAt) : ""}</p>
    <button class="tz-btn" type="button" data-act="top">BACK TO LATEST</button>`;
}
function applyFit(slide) {
  const slot = $(".tz-slot", slide);
  const el = $("video", slide) || $("img.tz-still", slide);
  if (!el) return;
  const w = el.videoWidth || el.naturalWidth;
  const h = el.videoHeight || el.naturalHeight;
  if (!w || !h) return;
  const r = w / h;
  const s = slot.clientWidth / slot.clientHeight || 9 / 16;
  slot.dataset.orient = r < 0.95 ? "portrait" : r > 1.05 ? "landscape" : "square";
  slot.dataset.fit = Math.abs(r - s) / s <= FIT_TOLERANCE ? "cover" : "contain";
  if (slot.dataset.fit === "contain") ambient(slide, el);
}
function ambient(slide, el) {
  const amb = $(".tz-amb", slide);
  if (!amb || amb.src) return;
  const poster = clips[Number(slide.dataset.i)]?.poster;
  if (poster) {
    amb.src = poster;
    return;
  }
  if (el.tagName === "IMG") {
    amb.src = el.src;
    return;
  }
  try {
    const cv = document.createElement("canvas");
    cv.width = 160;
    cv.height = Math.round(160 * el.videoHeight / el.videoWidth);
    cv.getContext("2d").drawImage(el, 0, 0, cv.width, cv.height);
    amb.src = cv.toDataURL("image/jpeg", 0.6);
  } catch {
  }
}
function videos() {
  return queryAll("video", reel);
}
function pauseAllExcept(keep) {
  for (const v of videos()) if (v !== keep && !v.paused) v.pause();
}
function applyPreloads() {
  if (!slides.length) return;
  const active = state.index;
  const position = rank(active);
  const neighbors = new Set([order[(position + 1) % order.length], order[(position - 1 + order.length) % order.length]]);
  const ahead = order[(position + 2) % order.length];
  for (let i = 0; i < slides.length; i++) {
    const v = $("video", slides[i]);
    if (!v) continue;
    const want = i === active ? "auto" : neighbors.has(i) ? "metadata" : "none";
    if (v.preload !== want) v.preload = want;
    // The clip on screen and every clip one or two swipes away carry their poster, so a swipe never lands
    // on black; posters further out wait, because they are private and never cached.
    const poster = clips[i]?.poster;
    if (poster && (i === active || neighbors.has(i) || i === ahead) && !v.getAttribute("poster")) v.setAttribute("poster", poster);
  }
}
function playActive() {
  if (!window.kidUnlocked) return;
  const slide = slides[state.index];
  if (!slide || slide.dataset.end) {
    pauseAllExcept(null);
    return;
  }
  const v = $("video", slide);
  pauseAllExcept(v);
  if (!v || slide.dataset.unlocking) return;
  // A capsule opened this week plays its theme's unlock first, once, after the splash has lifted.
  const c = clips[state.index];
  if (wantsUnlock(c)) {
    if (window.__tzsplash) document.addEventListener("tz:enter", () => playActive(), { once: true });
    else runUnlock(slide, c, window.__ktChannel || {}, () => { if (slides[state.index] === slide) playActive(); });
    return;
  }
  playClip(slide, { muted: !state.soundOn });
}
var io = new IntersectionObserver((entries) => {
  if (state.sheet) return;
  for (const e of entries) {
    if (e.intersectionRatio < 0.6) continue;
    const i = slides.indexOf(e.target);
    if (i !== state.index) setActive(i, { scroll: false });
  }
}, { root: reel, threshold: [0, 0.6, 1] });
slides.forEach((s) => io.observe(s));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseAllExcept(null);
  else if (!state.sheet) playActive();
});
function setActive(i, { scroll = true } = {}) {
  const prevIndex = state.index;
  state.index = Math.max(0, Math.min(slides.length - 1, i));
  slides.forEach((s, n) => {
    if (n === state.index) s.setAttribute("data-active", "1");
    else s.removeAttribute("data-active");
  });
  applyPreloads();
  if (scroll && body.dataset.mode === "immersive") {
    slides[state.index].scrollIntoView({
      behavior: REDUCED.matches ? "auto" : "smooth",
      block: "start"
    });
  }
  const c = clips[state.index];
  body.toggleAttribute("data-end", !c);
  $('[data-bind="pos"]').textContent = c ? String(rank(state.index) + 1).padStart(2, "0") : "END";
  queryAll(".tz-log-row").forEach((r) => r.setAttribute("aria-current", String(Number(r.dataset.goto) === state.index)));
  slides.forEach((s, n) => {
    const up = $('[data-act="newer"]', s), dn = $('[data-act="older"]', s);
    if (up) up.disabled = false;
    if (dn) dn.disabled = false;
  });
  const glow = $(".tz-glow");
  const poster = clips[state.index]?.poster;
  if (glow) glow.style.backgroundImage = poster ? `url("${poster}")` : "none";
  reactionsUi?.close();
  if (c) {
    hydrateReactions(state.index);
    $('[data-bind="live"]').textContent = `${state.shuffle ? "Shuffled. " : ""}Clip ${rank(state.index) + 1} of ${clips.length}. ${c.title}.`;
    history.replaceState(null, "", clipHash(c.id));
  } else {
    $('[data-bind="live"]').textContent = "End of the channel.";
  }
  if (state.index !== prevIndex) {
    const nv = $("video", slides[state.index]);
    if (nv) {
      try {
        nv.currentTime = 0;
      } catch (err) {
      }
    }
  }
  playActive();
}
function jumpTo(i, delta) {
  setActive(i, { scroll: false });
  if (body.dataset.mode === "immersive" && reel) {
    reel.scrollTop = delta > 0 ? 0 : reel.scrollHeight - reel.clientHeight;
  }
}
function step(delta) {
  const n = order.length;
  if (!n) return;
  const r = rank(state.index);
  const next = order[((r + delta) % n + n) % n];
  const wrapped = delta > 0 ? r === n - 1 : r === 0;
  if (wrapped) jumpTo(next, delta);
  else setActive(next);
  slides[next].focus({ preventScroll: true });
}
function setShuffle(on) {
  state.shuffle = !!on;
  if (state.shuffle) {
    const head = state.index;
    const rest = order.filter((i) => i !== head);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = rest[i];
      rest[i] = rest[j];
      rest[j] = t;
    }
    order = [head].concat(rest);
  } else {
    order = clips.map((c, i) => i);
  }
  body.toggleAttribute("data-shuffle", state.shuffle);
  const btn = $('[data-act="shuffle"]');
  if (btn) {
    btn.setAttribute("aria-pressed", String(state.shuffle));
    btn.setAttribute("aria-label", state.shuffle ? "Shuffle on. Clips play in random order. Turn shuffle off." : "Shuffle off. Clips play newest first. Turn shuffle on.");
  }
  syncDomOrder();
  setActive(state.index, { scroll: false });
}
function atEdge(delta) {
  const n = order.length;
  if (n < 2) return false;
  return delta > 0 ? rank(state.index) === n - 1 : rank(state.index) === 0;
}
var lastScrollAt = 0;
if (reel) reel.addEventListener("scroll", () => {
  lastScrollAt = Date.now();
}, { passive: true });
function canLeaveEdge(delta) {
  if (body.dataset.mode !== "immersive" || !atEdge(delta) || !reel) return false;
  if (Date.now() - lastScrollAt < 180) return false;
  return delta > 0 ? reel.scrollTop + reel.clientHeight >= reel.scrollHeight - 4 : reel.scrollTop <= 4;
}
var rotatedAt = 0;
function rotateEdge(delta) {
  const now = Date.now();
  if (now - rotatedAt < 500 || !canLeaveEdge(delta)) return;
  rotatedAt = now;
  step(delta);
}
reel.addEventListener("wheel", (e) => {
  if (Math.abs(e.deltaY) < 2) return;
  rotateEdge(e.deltaY > 0 ? 1 : -1);
}, { passive: true });
var touchY = null;
reel.addEventListener("touchstart", (e) => {
  touchY = e.touches && e.touches[0] ? e.touches[0].clientY : null;
}, { passive: true });
reel.addEventListener("touchend", (e) => {
  if (touchY === null) return;
  const t = e.changedTouches && e.changedTouches[0];
  const dy = t ? t.clientY - touchY : 0;
  touchY = null;
  if (Math.abs(dy) < 40) return;
  rotateEdge(dy < 0 ? 1 : -1);
}, { passive: true });
function setSound(on) {
  state.soundOn = on;
  body.dataset.sound = on ? "on" : "off";
  for (const v of videos()) v.muted = !on;
  const btn = $(".tz-sound");
  btn.setAttribute("aria-pressed", String(on));
  $(".tz-ico", btn).dataset.ico = on ? "sound" : "muted";
  $('[data-bind="soundlabel"]').textContent = on ? "Turn sound off" : "Turn sound on";
}
function paintLike(like, liked, count) {
  like.setAttribute("aria-pressed", String(liked));
  $(".tz-ico", like).dataset.ico = liked ? "heart-on" : "heart";
  $('[data-bind="likes"]', like).textContent = String(count || 0);
  like.setAttribute(
    "aria-label",
    (liked ? "Unlike. " : "Like. ") + (count || 0) + (count === 1 ? " like." : " likes.")
  );
}
function hydrateReactions(i) {
  const slide = slides[i], c = clips[i];
  if (!slide || !c || c.sealed) return;
  reactionsUi?.paint(slide);
  const st = likeState.get(c.id) || { count: 0, liked: false };
  paintLike($('[data-act="like"]', slide), st.liked, st.count);
}
async function toggleLike(i, forceOn) {
  const slide = slides[i], c = clips[i];
  if (!slide || !c || c.sealed) return;
  if (guestSession()) { guestPrompt(); return; }
  const like = $('[data-act="like"]', slide);
  if (like.disabled) return;
  const s = await sessToken();
  if (!s || !s.t) {
    failNote(slide, "Log in to like.");
    return;
  }
  const st = likeState.get(c.id) || { count: 0, liked: false };
  if (forceOn && st.liked) return;
  like.disabled = true;
  const on = forceOn ? true : !st.liked;
  paintLike(like, on, Math.max(0, st.count + (on ? 1 : -1)));
  try {
    const j = await apiPost("/api/like", { clipId: c.id, email: s.email, t: s.t, on });
    if (!j || !j.ok) throw new Error("save");
    likeState.set(c.id, { count: j.count, liked: j.liked });
    paintLike(like, j.liked, j.count);
  } catch {
    paintLike(like, st.liked, st.count);
    failNote(slide);
  } finally {
    like.disabled = false;
  }
}
function failNote(slide, msg) {
  const n = $(".tz-failnote", slide);
  n.textContent = msg || "Couldn't save.";
  n.hidden = false;
  clearTimeout(n._t);
  n._t = setTimeout(() => {
    n.hidden = true;
  }, 3e3);
}
var cSheet = $('[data-sheet="comments"]');
var cBody = $('[data-bind="comments"]');
var cForm = $('[data-bind="composer"]');
var nameF = $("#tz-name");
var bodyF = $("#tz-body");
var postBtn = $(".tz-post");
async function renderComments() {
  const c = clips[state.index];
  if (!c) return;
  const s = sessRead();
  let j;
  try {
    j = await fetch("/api/comments?c=" + encodeURIComponent(c.id) + (s && s.t ? "&e=" + b64uParam(s.email) + "&t=" + encodeURIComponent(s.t) : "")).then((r) => r.json());
  } catch {
    cBody.textContent = "Couldn't load comments.";
    return;
  }
  if (clips[state.index]?.id !== c.id) return;
  if (!j || !j.ok) {
    cBody.textContent = "Couldn't load comments.";
    return;
  }
  const list = j.rows || [];
  cBody.innerHTML = list.length ? list.map((m) => `
    <article class="tz-cmt" data-cid="${esc(m.id)}">
      <div class="tz-cmt-head">
        <span class="tz-cmt-who">${esc(m.name)}</span>
        <span class="tz-meta">${fmtAgo(m.at)}</span>
      </div>
      <p class="tz-cmt-body">${esc(m.body)}</p>
      ${m.mine ? `<div class="tz-cmt-acts">
        <button type="button" data-act="delete" data-cid="${esc(m.id)}">Delete</button>
      </div>` : ""}
    </article>`).join("") : `<div class="tz-empty">
         <span class="tz-label">No comments yet</span>
         <p class="tz-cmt-body">Be the first to say something.</p>
       </div>`;
  cBody.scrollTop = cBody.scrollHeight;
}
function syncPost() {
  postBtn.disabled = posting || pendingDrafts.has(clips[state.index]?.id) || !bodyF.value.trim();
  const n = bodyF.value.length;
  $('[data-bind="chars"]').textContent = n > 400 ? `${n}/500` : "";
  bodyF.style.height = "auto";
  bodyF.style.height = Math.min(132, bodyF.scrollHeight) + "px";
}
bodyF.addEventListener("input", syncPost);
var posting = false;
var pendingDrafts = /* @__PURE__ */ new Map();
var postStatus = document.createElement("div");
postStatus.className = "tz-cmt";
postStatus.setAttribute("role", "status");
cForm.before(postStatus);
function showDraft() {
  const draft = pendingDrafts.get(clips[state.index]?.id);
  postStatus.innerHTML = !draft ? "" : `<p class="tz-cmt-body">${esc(draft.body)}</p><p>${draft.failed ? "Couldn't save. Try again." : "Saving..."}</p>${draft.failed ? '<button class="tz-btn" type="button" data-post="retry">Try again</button> <button class="tz-btn" type="button" data-post="edit">Edit comment</button>' : ""}`;
  postStatus.style.opacity = draft?.failed ? ".6" : "1";
}
async function saveDraft(id, draft) {
  if (posting) return;
  posting = true;
  draft.failed = false;
  pendingDrafts.set(id, draft);
  syncPost();
  showDraft();
  try {
    const s = sessRead();
    const j = await apiPost("/api/comment", { clipId: id, email: s.email, t: s.t, body: draft.body });
    if (!j || !j.ok) throw new Error("save");
    pendingDrafts.delete(id);
    if (clips[state.index]?.id === id) await renderComments();
  } catch {
    draft.failed = true;
  } finally {
    posting = false;
    syncPost();
    showDraft();
  }
}
cForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (guestSession()) { guestPrompt(); return; }
  const c = clips[state.index];
  const text = bodyF.value.trim();
  if (!c || posting || !text || pendingDrafts.has(c.id)) return;
  const s = await sessToken();
  if (!s || !s.t) {
    postStatus.innerHTML = '<p class="tz-cmt-body">Log in to comment. Your name shows above what you write.</p>';
    postStatus.style.opacity = "1";
    return;
  }
  bodyF.value = "";
  syncPost();
  await saveDraft(c.id, { body: text });
});
postStatus.addEventListener("click", (e) => {
  const action = e.target.closest("[data-post]")?.dataset.post;
  const id = clips[state.index]?.id, draft = pendingDrafts.get(id);
  if (!draft || posting) return;
  if (action === "retry") saveDraft(id, draft);
  if (action === "edit") {
    bodyF.value = draft.body;
    pendingDrafts.delete(id);
    showDraft();
    syncPost();
    bodyF.focus();
  }
});
cBody.addEventListener("click", async (e) => {
  const button = e.target.closest("button[data-act]");
  if (!button) return;
  const row = button.closest(".tz-cmt"), id = clips[state.index]?.id;
  if (!row || !id) return;
  if (button.dataset.act === "delete") {
    row.querySelector(".tz-cmt-acts").innerHTML = '<span>Delete this comment?</span> <button type="button" data-act="confirm-delete">DELETE</button> <button type="button" data-act="keep">KEEP</button>';
    row.querySelector('[data-act="keep"]').focus();
  } else if (button.dataset.act === "keep") {
    await renderComments();
  } else if (button.dataset.act === "confirm-delete") {
    button.disabled = true;
    try {
      await serverDeleteComment(id, row.dataset.cid);
      if (clips[state.index]?.id === id) await renderComments();
      $('[data-bind="live"]').textContent = "Comment deleted.";
    } catch {
      postStatus.textContent = "Couldn't save.";
      button.disabled = false;
    }
  }
});
if (window.visualViewport) {
  const vv = window.visualViewport;
  const sync = () => {
    const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--tz-kb", overlap + "px");
  };
  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync);
}
function openSheet(kind) {
  closeSheet({ silent: true });
  state.sheet = kind;
  state.returnFocus = document.activeElement;
  body.dataset.sheetOpen = "1";
  $(".tz-app").inert = true;
  $(".tz-head").inert = true;
  $(".tz-scrimlayer").hidden = false;
  const sheet = $(`[data-sheet="${kind}"]`);
  sheet.hidden = false;
  sheet.setAttribute("data-enter", "1");
  requestAnimationFrame(() => sheet.removeAttribute("data-enter"));
  if (kind === "comments") {
    renderComments();
    showDraft();
    syncPost();
    $(".tz-x", sheet).focus();
  } else {
    $(".tz-x", sheet).focus();
  }
}
function closeSheet({ silent = false } = {}) {
  queryAll(".tz-sheet").forEach((s) => {
    s.hidden = true;
  });
  $(".tz-scrimlayer").hidden = true;
  delete body.dataset.sheetOpen;
  $(".tz-app").inert = false;
  $(".tz-head").inert = false;
  state.sheet = null;
  if (!silent && state.returnFocus) state.returnFocus.focus({ preventScroll: true });
  if (!silent) playActive();
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || !state.sheet) return;
  const sheet = $(`[data-sheet="${state.sheet}"]`);
  const f = queryAll('button,input,textarea,[href],[tabindex]:not([tabindex="-1"])', sheet).filter((el) => !el.disabled && el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});
document.addEventListener("click", (e) => {
  const goto = e.target.closest("[data-goto]");
  if (goto) {
    closeSheet({ silent: true });
    setActive(Number(goto.dataset.goto));
    if (DESKTOP.matches) setMode("immersive");
    return;
  }
  const act = e.target.closest("[data-act]");
  if (!act) return;
  const slide = act.closest(".tz-slide");
  const i = slide ? Number(slide.dataset.i) : state.index;
  switch (act.dataset.act) {
    case "sound":
      setSound(!state.soundOn);
      break;
    case "shuffle":
      setShuffle(!state.shuffle);
      break;
    case "toggle":
      toggleTap(slide, e);
      break;
    case "newer":
      step(-1);
      break;
    case "older":
      step(1);
      break;
    case "like":
      toggleLike(i);
      break;
    case "wobble":
      wobble(slide);
      break;
    case "comments":
      if (clips[i]?.sealed) break;
      if (guestSession()) guestPrompt();
      else openSheet("comments");
      break;
    case "index":
      openSheet("index");
      break;
    case "closesheet":
      closeSheet();
      break;
    case "top":
      closeSheet({ silent: true });
      setActive(0);
      break;
    case "retry":
      retry(slide);
      break;
    case "exit":
      setMode("stage");
      break;
    case "seek":
      seek(slide, e);
      break;
  }
});
function togglePlay(slide) {
  const v = slide && $("video", slide);
  if (!v || slide.dataset.invalid === "1") return;
  if (DESKTOP.matches && body.dataset.mode === "stage") {
    setMode("immersive");
    return;
  }
  if (v.paused) {
    playClip(slide, { muted: !state.soundOn });
  } else {
    v.pause();
    slide.dataset.paused = "1";
  }
  $(".tz-glyph .tz-ico", slide).dataset.ico = v.paused ? "play" : "pause";
}
function seek(slide, e) {
  const v = $("video", slide);
  const d = durOf(slide, v);
  if (!v || !d || !e.clientX) return;
  const r = $(".tz-bar", slide).getBoundingClientRect();
  v.currentTime = (e.clientX - r.left) / r.width * d;
}
function scrubPaint(slide, bar, v, clientX) {
  const r = bar.getBoundingClientRect();
  const d = durOf(slide, v);
  if (!r.width || !d) return;
  const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  const t = ratio * d;
  v.currentTime = t;
  $(".tz-bar-fill", slide).style.width = ratio * 100 + "%";
  const tip = $(".tz-bar-tip", slide);
  if (tip) {
    tip.style.left = Math.max(16, Math.min(r.width - 16, ratio * r.width)) + "px";
    tip.textContent = fmtDur(t);
  }
}
document.addEventListener("pointerdown", (e) => {
  if (state.sheet) return;
  const bar = e.target && e.target.closest ? e.target.closest('[data-act="seek"]') : null;
  if (!bar) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const slide = bar.closest(".tz-slide");
  const v = slide && $("video", slide);
  if (!v || !durOf(slide, v) || slide.dataset.invalid === "1" || slide.dataset.state === "error") return;
  if (slide.dataset.scrub) return;
  let raf = 0, x = e.clientX;
  const flush = () => {
    raf = 0;
    scrubPaint(slide, bar, v, x);
  };
  const move = (ev) => {
    x = ev.clientX;
    if (!raf) raf = requestAnimationFrame(flush);
  };
  const end = (ev) => {
    bar.removeEventListener("pointermove", move);
    bar.removeEventListener("pointerup", end);
    bar.removeEventListener("pointercancel", end);
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (ev && ev.clientX) x = ev.clientX;
    flush();
    delete slide.dataset.scrub;
  };
  slide.dataset.scrub = "1";
  try {
    bar.setPointerCapture(e.pointerId);
  } catch (err) {
  }
  bar.addEventListener("pointermove", move);
  bar.addEventListener("pointerup", end);
  bar.addEventListener("pointercancel", end);
  flush();
});
(() => {
  const st = document.createElement("style");
  st.id = "tz-scrub-style";
  st.textContent = `
.tz-bar{touch-action:none;-webkit-tap-highlight-color:transparent;user-select:none}
.tz-bar-fill::after{content:'';position:absolute;right:-6px;top:50%;width:11px;height:11px;
  border-radius:50%;background:var(--tz-paper,#F7F4EC);
  box-shadow:0 0 0 1px rgba(5,6,10,.55),0 1px 5px rgba(5,6,10,.45);
  transform:translateY(-50%);opacity:.85;pointer-events:none;
  transition:transform 140ms cubic-bezier(.2,0,0,1),opacity 140ms linear}
.tz-slide[data-scrub='1'] .tz-bar-fill::after{transform:translateY(-50%) scale(1.6);opacity:1}
.tz-slide[data-state='loading'] .tz-bar-fill::after,
.tz-slide[data-state='error'] .tz-bar-fill::after{opacity:0}
.tz-bar-tip{position:absolute;bottom:14px;left:16px;transform:translateX(-50%);
  padding:5px 8px;border-radius:2px;background:rgba(5,6,10,.82);color:var(--tz-paper,#F7F4EC);
  font:500 11px/1 var(--tz-mono,'DM Mono',monospace);letter-spacing:.1em;
  opacity:0;pointer-events:none;white-space:nowrap;transition:opacity 120ms linear}
.tz-slide[data-scrub='1'] .tz-bar-tip{opacity:1}`;
  document.head.appendChild(st);
})();
(() => {
  const st = document.createElement("style");
  st.id = "tz-upload-style";
  st.textContent = `
.tz-upload-fab{position:absolute;right:12px;z-index:20;bottom:calc(var(--tz-safe-b,0px) + var(--tz-kb,0px) + 52px);
  display:flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid rgba(247,244,236,.35);
  background:rgba(5,6,10,.72);color:var(--tz-paper,#F7F4EC);font:500 11px/1 var(--tz-mono,'DM Mono',monospace);
  letter-spacing:.12em;text-transform:uppercase;border-radius:999px;cursor:pointer}
.tz-upload-fab:hover{border-color:var(--tz-flare,#FF5C2B);color:var(--tz-flare,#FF5C2B)}
.tz-upload-pill{position:absolute;left:50%;transform:translateX(-50%);top:14px;z-index:40;
  padding:8px 12px;border-radius:2px;background:rgba(5,6,10,.85);color:var(--tz-paper,#F7F4EC);
  font:500 11px/1.3 var(--tz-mono,'DM Mono',monospace);letter-spacing:.08em;max-width:80%;text-align:center}`;
  document.head.appendChild(st);
})();
(() => {
  const st = document.createElement("style");
  st.id = "tz-namecard-style";
  st.textContent = `
.tz-namecard{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;
  padding:20px;background:rgba(5,6,10,.72);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.tz-namecard-in{width:100%;max-width:360px;background:var(--tz-ink,#0B0C10);border:1px solid rgba(247,244,236,.28);
  border-radius:4px;padding:18px 18px 14px;color:var(--tz-paper,#F7F4EC);
  font:500 12px/1.5 var(--tz-mono,'DM Mono',monospace);box-shadow:0 18px 60px rgba(5,6,10,.7)}
.tz-namecard-kicker{margin:0 0 10px;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--tz-flare,#FF5C2B)}
.tz-namecard-lbl{display:block;margin:0 0 6px;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:rgba(247,244,236,.6)}
.tz-namecard-input{width:100%;box-sizing:border-box;background:rgba(247,244,236,.07);
  border:1px solid rgba(247,244,236,.3);border-radius:2px;color:var(--tz-paper,#F7F4EC);
  font:500 14px/1 var(--tz-mono,'DM Mono',monospace);padding:11px 10px}
.tz-namecard-input:focus{outline:none;border-color:var(--tz-flare,#FF5C2B)}
.tz-namecard-meta{margin:8px 0 14px;font-size:10px;letter-spacing:.1em;color:rgba(247,244,236,.5)}
.tz-namecard-acts{display:flex;gap:8px;justify-content:flex-end}
.tz-namecard-btn{appearance:none;background:none;border:1px solid rgba(247,244,236,.3);color:var(--tz-paper,#F7F4EC);
  font:500 10px/1 var(--tz-mono,'DM Mono',monospace);letter-spacing:.14em;text-transform:uppercase;
  padding:10px 13px;border-radius:2px;cursor:pointer}
.tz-namecard-btn:hover{border-color:var(--tz-flare,#FF5C2B);color:var(--tz-flare,#FF5C2B)}
.tz-namecard-go{border-color:var(--tz-flare,#FF5C2B);color:var(--tz-flare,#FF5C2B)}
.tz-namecard-go:hover{background:var(--tz-flare,#FF5C2B);color:var(--tz-flare-ink,#0B0C10)}`;
  document.head.appendChild(st);
})();
(() => {
  const st = document.createElement("style");
  st.id = "tz-social-style";
  st.textContent = `
.tz-heartburst{position:absolute;z-index:12;width:0;height:0;pointer-events:none}
.tz-heartburst .tz-ico{position:absolute;left:-26px;top:-26px;width:52px;height:52px;color:var(--tz-flare,#FF5C2B);
  filter:drop-shadow(0 2px 10px rgba(5,6,10,.6));
  animation:tz-heartpop 700ms cubic-bezier(.2,0,0,1) forwards}
@keyframes tz-heartpop{
  0%{transform:scale(.2) rotate(-8deg);opacity:0}
  18%{transform:scale(1.18) rotate(3deg);opacity:1}
  38%{transform:scale(1) rotate(0)}
  70%{transform:scale(1.02) translateY(-8px);opacity:1}
  100%{transform:scale(.9) translateY(-46px);opacity:0}}
#tz-name,label[for="tz-name"]{display:none}`;
  document.head.appendChild(st);
})();
function retry(slide) {
  retryClip(slide, {
    play: slide?.dataset.active === "1" && !document.hidden && !state.sheet,
    muted: !state.soundOn
  });
}
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
  if (state.sheet && e.key === "Escape") {
    closeSheet();
    return;
  }
  if (typing || state.sheet || /^(BUTTON|A)$/.test(document.activeElement?.tagName || "") && [" ", "Enter"].includes(e.key)) return;
  switch (e.key) {
    case "ArrowUp":
      e.preventDefault();
      step(-1);
      break;
    case "ArrowDown":
      e.preventDefault();
      step(1);
      break;
    case " ":
    case "k":
      e.preventDefault();
      togglePlay(slides[state.index]);
      break;
    case "ArrowLeft":
      nudge(-5);
      break;
    case "ArrowRight":
      nudge(5);
      break;
    case "m":
      setSound(!state.soundOn);
      break;
    case "l":
      toggleLike(state.index);
      break;
    case "s":
      setShuffle(!state.shuffle);
      break;
    case "c":
      if (!clips[state.index]?.sealed) openSheet("comments");
      break;
    case "i":
      openSheet("index");
      break;
    case "Escape":
      if (state.sheet) closeSheet();
      else if (body.dataset.mode === "immersive" && DESKTOP.matches) setMode("stage");
      break;
  }
});
function nudge(sec) {
  const slide = slides[state.index];
  const v = $("video", slide);
  const d = durOf(slide, v);
  if (v && d) v.currentTime = Math.max(0, Math.min(d, v.currentTime + sec));
}
function durOf(slide, v) {
  if (v && Number.isFinite(v.duration) && v.duration > 0) return v.duration;
  const c = clips[Number(slide && slide.dataset.i)];
  const d = c ? Number(c.duration) : 0;
  return Number.isFinite(d) && d > 0 ? d : 0;
}
function wireSlide(slide) {
  const v = $("video", slide);
  const img = $("img.tz-still", slide);
  if (img) {
    img.addEventListener("load", () => {
      slide.dataset.state = "ready";
      applyFit(slide);
    });
    return;
  }
  if (!v) {
    slide.dataset.state = "ready";
    return;
  }
  if (!clips[Number(slide.dataset.i)].src) {
    slide.dataset.state = "error";
    return;
  }
  v.addEventListener("loadedmetadata", () => {
    const d = durOf(slide, v);
    if (!d || d > MAX_SECONDS) {
      v.pause();
      slide.dataset.invalid = "1";
      slide.dataset.state = "error";
      $(".tz-err p", slide).textContent = d ? "This video is over the 5-minute limit and cannot be played on this channel." : "This clip's length could not be read, so it cannot be played here.";
      return;
    }
    slide.dataset.state = "ready";
    applyFit(slide);
  });
  v.addEventListener("loadeddata", () => applyFit(slide));
  v.addEventListener("waiting", () => {
    if (slide.dataset.state === "ready") slide.dataset.state = "buffering";
  });
  v.addEventListener("playing", () => {
    if (slide.dataset.invalid === "1") {
      v.pause();
      return;
    }
    slide.dataset.state = "ready";
    slide.dataset.paused = "0";
  });
  v.addEventListener("pause", () => {
    slide.dataset.paused = "1";
  });
  v.addEventListener("error", () => {
    slide.dataset.state = "error";
  });
  v.addEventListener("timeupdate", () => {
    const d = durOf(slide, v);
    if (!d) return;
    $(".tz-bar-fill", slide).style.width = v.currentTime / d * 100 + "%";
  });
  v.addEventListener("ended", () => {
    slide.dataset.paused = "1";
  });
}
function setMode(mode) {
  body.dataset.mode = mode;
  if (mode === "immersive") {
    requestAnimationFrame(() => slides[state.index]?.scrollIntoView({ behavior: "auto", block: "start" }));
  }
  if (slides[state.index]) applyFit(slides[state.index]);
}
function syncMode() {
  setMode(DESKTOP.matches ? "stage" : "immersive");
}
DESKTOP.addEventListener("change", syncMode);
let fitFrame = 0;
window.addEventListener("resize", () => {
  if (fitFrame) return;
  fitFrame = requestAnimationFrame(() => {
    fitFrame = 0;
    if (slides[state.index]) applyFit(slides[state.index]);
  });
}, { passive: true });
var likeState = /* @__PURE__ */ new Map();
function sessRead() {
  try {
    const s = JSON.parse(localStorage.getItem("kid-session") || "null");
    return s && s.exp && s.exp > Date.now() && (s.guest ? s.guestToken : s.email) ? s : null;
  } catch (err) {
    return null;
  }
}
function guestSession() {
  return !!sessRead()?.guest;
}
function guestPrompt() {
  if (document.getElementById("tz-guest-prompt")) return;
  const wrap = document.createElement("div");
  wrap.id = "tz-guest-prompt";
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.setAttribute("aria-label", "Register to participate");
  wrap.style.cssText = "position:fixed;inset:0;z-index:500;display:grid;place-items:center;padding:20px;background:rgba(5,6,10,.82);backdrop-filter:blur(7px)";
  wrap.innerHTML = `<div style="width:min(100%,380px);padding:24px;border:1px solid var(--tz-line);border-radius:16px;background:var(--tz-surface);color:var(--tz-paper);font:15px/1.5 var(--tz-ui);box-shadow:0 18px 60px rgba(5,6,10,.6)">
    <h2 style="margin:0 0 10px;color:var(--tz-flare);font:400 26px/1 var(--tz-display);text-transform:uppercase">Guest access is view-only</h2>
    <p>To like or comment, you need to register for an account.</p>
    <p><a href="/?register=1" style="color:var(--tz-paper);text-decoration:underline;text-underline-offset:4px">Ask for an account</a></p>
    <button type="button" data-guest-close style="min-height:44px;padding:0 16px;border:1px solid var(--tz-line);background:transparent;color:var(--tz-paper);font:500 12px/1 var(--tz-mono);letter-spacing:.14em;text-transform:uppercase;cursor:pointer">Keep watching</button>
  </div>`;
  const close = () => { wrap.remove(); document.removeEventListener("keydown", escape); };
  const escape = (event) => { if (event.key === "Escape") close(); };
  wrap.querySelector("[data-guest-close]").addEventListener("click", close);
  wrap.addEventListener("click", event => { if (event.target === wrap) close(); });
  document.addEventListener("keydown", escape);
  document.body.appendChild(wrap);
  wrap.querySelector("[data-guest-close]").focus();
}
function sessWrite(s) {
  try {
    localStorage.setItem("kid-session", JSON.stringify(s));
  } catch (err) {
  }
}
var b64uParam = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// The signed-in session, or null for guests and visitors. /api/check never hands out a token without one,
// so there is nothing to fetch here; callers already treat a session without `t` as signed out.
async function sessToken() {
  const s = sessRead();
  return s && !s.guest ? s : null;
}
async function apiPost(path, body2) {
  try {
    return await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body2) }).then((r) => r.json());
  } catch (err) {
    return null;
  }
}
function paintAllLikes() {
  slides.forEach((sl) => {
    const c = clips[Number(sl.dataset.i)];
    const like = $('[data-act="like"]', sl);
    if (!c || !like || like.disabled) return;
    const st = likeState.get(c.id) || { count: 0, liked: false };
    paintLike(like, st.liked, st.count);
  });
}
async function seedLikes() {
  const s = await sessToken();
  try {
    const q = s && s.t ? "?e=" + b64uParam(s.email) + "&t=" + encodeURIComponent(s.t) : "";
    const j = await fetch("/api/likes" + q).then((r) => r.json());
    if (!j || !j.ok) return;
    likeState.clear();
    for (const k in j.counts) likeState.set(k, { count: j.counts[k] || 0, liked: !!(j.liked && j.liked[k]) });
    if (s && s.t) {
      for (const c of clips) {
        let v = null;
        try {
          v = JSON.parse(localStorage.getItem("tz-r-" + c.id) || "null");
        } catch (err) {
        }
        if (v && v.liked && !(likeState.get(c.id) || { liked: false }).liked) {
          const r = await apiPost("/api/like", { clipId: c.id, email: s.email, t: s.t, on: true });
          if (r && r.ok) {
            likeState.set(c.id, { count: r.count, liked: true });
            try {
              localStorage.setItem("tz-r-" + c.id, JSON.stringify({ liked: false, comments: v.comments || [] }));
            } catch (err) {
            }
          }
        }
      }
    }
    paintAllLikes();
  } catch (err) {
  }
}
async function serverDeleteComment(id, cid) {
  const s = sessRead();
  if (!s || !s.t) throw new Error("log in");
  const j = await apiPost("/api/comment/delete", { id: cid, email: s.email, t: s.t });
  if (!j || !j.ok) throw new Error("delete");
}
var DBL_MS = 280;
var lastTap = { i: -1, at: 0, timer: 0 };
function toggleTap(slide, e) {
  const i = slide ? Number(slide.dataset.i) : state.index;
  const now = Date.now();
  const dbl = e.clientX && lastTap.i === i && now - lastTap.at < DBL_MS;
  if (lastTap.timer) {
    clearTimeout(lastTap.timer);
    lastTap.timer = 0;
  }
  if (dbl) {
    lastTap.i = -1;
    lastTap.at = 0;
    heartBurst(slide, e.clientX, e.clientY);
    toggleLike(i, true);
    return;
  }
  lastTap.i = i;
  lastTap.at = now;
  if (!e.clientX) {
    togglePlay(slide);
    return;
  }
  lastTap.timer = setTimeout(() => {
    lastTap.timer = 0;
    togglePlay(slide);
  }, DBL_MS);
}
function heartBurst(slide, x, y) {
  const r = slide.getBoundingClientRect();
  if (!r.width) return;
  const burst = document.createElement("span");
  burst.className = "tz-heartburst";
  burst.style.left = x - r.left + "px";
  burst.style.top = y - r.top + "px";
  burst.innerHTML = '<span class="tz-ico" data-ico="heart-on" aria-hidden="true"></span>';
  slide.appendChild(burst);
  setTimeout(() => burst.remove(), 750);
}
// Reactions, the daily tape, and capsules whose date arrives while the feed is open (js/shell/*).
function bootLaunchStory() {
  const clipOf = (slide) => clips[Number(slide.dataset.i)];
  reactionsUi = attachReactions({ session: () => { const s = sessRead(); return s && !s.guest ? s : null; }, isGuest: guestSession, guestPrompt, failNote, clipOf });
  attachWatch({ budget: serverBudget, channel: window.__ktChannel || {}, clipOf });
  watchSealed(() => clips, familyZone(), openSealed);
}
// Swaps a locked tape for the real clip once the server has opened it; its unlock plays when it is on screen.
async function openSealed(id, tries = 0) {
  let row = null;
  try {
    const j = await fetch("/api/clips" + (channelSlug() ? "?channel=" + encodeURIComponent(channelSlug()) : "")).then((r) => r.json());
    row = (j.clips || []).find((c) => c.id === id && !c.sealed && c.src) || null;
  } catch {
  }
  // The server opens capsules on a one-minute tick, so the first look can be early.
  if (!row) {
    if (tries < 18) setTimeout(() => openSealed(id, tries + 1), 1e4);
    return;
  }
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0) return;
  clips[i] = row;
  const holder = document.createElement("template");
  holder.innerHTML = slideMarkup(row, i).trim();
  const fresh = holder.content.firstElementChild;
  io.unobserve(slides[i]);
  slides[i].replaceWith(fresh);
  slides[i] = fresh;
  io.observe(fresh);
  wireSlide(fresh);
  $('[data-bind="log"]').innerHTML = logMarkup();
  $('[data-bind="log2"]').innerHTML = logMarkup();
  if (i === state.index) setActive(i, { scroll: false });
  else applyPreloads();
}
function bootFeed() {
  const deep = location.hash.match(/^#\/(?:c\/[^/]+\/)?v\/(.+)$/);
  const start = deep ? clips.findIndex((c) => c.id === deep[1]) : 0;
  syncMode();
  setSound(false);
  async function seedRole() {
    const s = sessRead();
    if (!s) return null;
    if (s.guest) return s;
    if (s.role === "admin" || s.role === "super") return s;
    // Without a token /api/check answers "none" with an empty role, which says nothing about this
    // account, so only a confirmed check may change the stored role.
    if (!s.t) return s;
    try {
      const j = await fetch("/api/check?e=" + b64uParam(s.email) + "&t=" + encodeURIComponent(s.t)).then((r) => r.json());
      if (j && j.ok && j.status === "approved") {
        s.role = j.role || "";
        sessWrite(s);
      }
    } catch (err) {
    }
    return sessRead();
  }
  function mountUploadFab() {
    if ($(".tz-upload-fab")) return;
    const fab = document.createElement("button");
    fab.type = "button";
    fab.className = "tz-upload-fab";
    fab.setAttribute("aria-label", "Upload a video");
    fab.textContent = "+ Upload";
    fab.addEventListener("click", (e) => {
      e.stopPropagation();
      pickAndUpload();
    });
    $(".tz-app").appendChild(fab);
  }
  let fabHideTimer = 0;
  function fabSay(msg, ttl) {
    let pill = $(".tz-upload-pill");
    if (!pill) {
      pill = document.createElement("div");
      pill.className = "tz-upload-pill";
      pill.setAttribute("role", "status");
      $(".tz-app").appendChild(pill);
    }
    pill.hidden = false;
    pill.textContent = msg;
    clearTimeout(fabHideTimer);
    fabHideTimer = ttl ? setTimeout(() => {
      pill.hidden = true;
    }, ttl) : 0;
    return pill;
  }
  function titleFromName(name) {
    const base = String(name || "").replace(/\.[^.]+$/, "").trim();
    return (base || "New clip").slice(0, 80);
  }
  function askName(file, secs) {
    return new Promise((resolve) => {
      const card = document.createElement("div");
      card.className = "tz-namecard";
      card.innerHTML = `
      <div class="tz-namecard-in" role="dialog" aria-modal="true" aria-label="Name this clip">
        <p class="tz-namecard-kicker">Ready to publish</p>
        <label class="tz-namecard-lbl" for="tz-clipname">Name this clip</label>
        <input class="tz-namecard-input" id="tz-clipname" type="text" maxlength="80" autocomplete="off" spellcheck="false">
        <p class="tz-namecard-meta"></p>
        <label class="tz-namecard-seal"><input type="checkbox" data-seal> Seal as a time capsule</label>
        <div class="tz-namecard-capsule" hidden>
          <label class="tz-namecard-lbl" for="tz-opens">Opens on</label>
          <input class="tz-namecard-input" id="tz-opens" type="datetime-local">
          <label class="tz-namecard-lbl" for="tz-capnote">A note for when it opens (optional)</label>
          <input class="tz-namecard-input" id="tz-capnote" type="text" maxlength="140" autocomplete="off" placeholder="Open on your 10th birthday">
          <p class="tz-namecard-err" role="alert"></p>
        </div>
        <div class="tz-namecard-acts">
          <button class="tz-namecard-btn" type="button" data-name="cancel">Cancel</button>
          <button class="tz-namecard-btn tz-namecard-go" type="button" data-name="go">Publish</button>
        </div>
      </div>`;
      const input = $(".tz-namecard-input", card);
      const fallback = titleFromName(file && file.name);
      input.value = fallback;
      $(".tz-namecard-meta", card).textContent = [
        fmtDur(secs),
        file && file.size ? (file.size / 1048576).toFixed(1) + " MB" : "",
        "converted to 480p on the server"
      ].filter(Boolean).join(" \xB7 ");
      document.body.appendChild(card);
      // A capsule opens at least an hour from now; the date is read in this device's time zone.
      const sealBox = $("[data-seal]", card), capsule = $(".tz-namecard-capsule", card), opens = $("#tz-opens", card);
      const localInput = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
      opens.min = localInput(Date.now() + 36e5 + 6e4);
      sealBox.addEventListener("change", () => {
        capsule.hidden = !sealBox.checked;
        $(".tz-namecard-go", card).textContent = sealBox.checked ? "Seal and publish" : "Publish";
        if (sealBox.checked) opens.focus();
      });
      const done = (val) => {
        card.remove();
        document.removeEventListener("keydown", onKey, true);
        resolve(val);
      };
      const go = () => {
        const title = input.value.trim() || fallback;
        if (!sealBox.checked) return done({ title });
        const opensAt = Math.round(new Date(opens.value).getTime() / 6e4) * 6e4;
        if (!opens.value || !Number.isFinite(opensAt) || opensAt < Date.now() + 36e5) {
          $(".tz-namecard-err", card).textContent = "Pick a date at least an hour away.";
          opens.focus();
          return;
        }
        done({ title, seal: { opensAt, capsuleNote: $("#tz-capnote", card).value.trim().slice(0, 140) } });
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          done(null);
        } else if (e.key === "Enter" && e.target.type !== "checkbox") {
          e.preventDefault();
          go();
        }
      };
      card.addEventListener("click", (e) => {
        const act = e.target.closest("[data-name]");
        if (!act) return;
        if (act.dataset.name === "cancel") done(null);
        else go();
      });
      document.addEventListener("keydown", onKey, true);
      input.focus();
      input.select();
    });
  }
  function pickAndUpload() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files && input.files[0];
      input.remove();
      if (file) uploadPicked(file);
    };
    input.click();
  }
  async function uploadPicked(file, forcedName) {
    try {
      const secs = await readDuration(file);
      if (secs > MAX_SECONDS) {
        fabSay("Over the 5-minute limit (" + Math.round(secs) + "s). Trim it first.", 7e3);
        return;
      }
      if (file.size > 512 * 1024 * 1024) {
        fabSay("Over 512 MB. Trim it first.", 7e3);
        return;
      }
      const picked = forcedName === void 0 ? await askName(file, secs) : { title: forcedName };
      if (picked == null) {
        fabSay("Nothing was uploaded.", 2600);
        return;
      }
      await uploadClip(file, picked.title, picked.seal);
    } catch (err) {
      fabSay(err && err.message ? err.message : "Couldn't upload.", 8e3);
    }
  }
  function parseMp4Duration(u8) {
    for (let i = 4; i <= u8.length - 24; i++) {
      if (u8[i] === 109 && u8[i + 1] === 118 && u8[i + 2] === 104 && u8[i + 3] === 100) {
        const dv = new DataView(u8.buffer, u8.byteOffset + i + 4);
        const ver = u8[i + 4];
        let ts, dur;
        if (ver === 1) {
          ts = dv.getUint32(20);
          dur = Number(dv.getBigUint64(24));
        } else {
          ts = dv.getUint32(12);
          dur = dv.getUint32(16);
        }
        if (ts > 0 && dur > 0) return dur / ts;
        return 0;
      }
    }
    return 0;
  }
  function parseWebmDuration(u8) {
    for (let i = 0; i <= u8.length - 11; i++) {
      if (u8[i] === 68 && u8[i + 1] === 137 && (u8[i + 2] === 132 || u8[i + 2] === 136)) {
        const dv = new DataView(u8.buffer, u8.byteOffset + i + 3);
        const d = u8[i + 2] === 132 ? dv.getFloat32(0) : dv.getFloat64(0);
        if (d > 0 && Number.isFinite(d)) return d / 1e3;
      }
    }
    return webmClusterSeconds(u8);
  }
  function ebmlVintLen(b) {
    for (let i = 0; i < 8; i++) {
      if (b & 128 >> i) return i + 1;
    }
    return 0;
  }
  function ebmlTimecode(u8, at) {
    const n = ebmlVintLen(u8[at + 1]);
    if (!n) return -1;
    let size = u8[at + 1] & (1 << 8 - n) - 1;
    for (let k = 1; k < n; k++) size = size * 256 + u8[at + 1 + k];
    if (size < 1 || size > 8 || at + 1 + n + size > u8.length) return -1;
    let v = 0;
    for (let k = 0; k < size; k++) v = v * 256 + u8[at + 1 + n + k];
    return v;
  }
  function webmClusterSeconds(u8) {
    let last = 0;
    for (let i = 0; i <= u8.length - 5; i++) {
      if (u8[i] !== 31 || u8[i + 1] !== 67 || u8[i + 2] !== 182 || u8[i + 3] !== 117) continue;
      const at = i + 4 + ebmlVintLen(u8[i + 4]);
      if (at < u8.length && u8[at] === 231) {
        const tc = ebmlTimecode(u8, at);
        if (tc > last) last = tc;
      }
    }
    return last / 1e3;
  }
  function readDuration(file) {
    return new Promise((resolve) => {
      const head = file.slice(0, 4 * 1024 * 1024);
      const tailSize = Math.min(4 * 1024 * 1024, Math.max(0, file.size - 4 * 1024 * 1024));
      const tail = tailSize ? file.slice(file.size - tailSize) : null;
      let got = 0, pending = tail ? 2 : 1;
      const take = (buf) => {
        if (buf) {
          try {
            const u8 = new Uint8Array(buf);
            const d = parseMp4Duration(u8) || parseWebmDuration(u8);
            if (d > got && d <= 60 * 60 * 6) got = d;
          } catch (err) {
          }
        }
        pending -= 1;
        if (!pending) resolve(got);
      };
      const fr = new FileReader();
      fr.onload = () => take(fr.result);
      fr.onerror = () => take(null);
      fr.readAsArrayBuffer(head);
      if (tail) {
        const fr2 = new FileReader();
        fr2.onload = () => take(fr2.result);
        fr2.onerror = () => take(null);
        fr2.readAsArrayBuffer(tail);
      }
    });
  }
  function ebmlId(u8, at) {
    if (at >= u8.length) return null;
    const n = ebmlVintLen(u8[at]);
    if (!n || at + n > u8.length) return null;
    let v = 0;
    for (let k = 0; k < n; k++) v = v * 256 + u8[at + k];
    return { id: v, len: n };
  }
  function ebmlSize(u8, at) {
    if (at >= u8.length) return null;
    const n = ebmlVintLen(u8[at]);
    if (!n || at + n > u8.length) return null;
    let v = u8[at] & (1 << 8 - n) - 1, unknown = v === (1 << 8 - n) - 1;
    for (let k = 1; k < n; k++) {
      v = v * 256 + u8[at + k];
      if (u8[at + k] !== 255) unknown = false;
    }
    return { size: v, len: n, unknown };
  }
  function ebmlUint(u8, at, n) {
    let v = 0;
    for (let k = 0; k < n; k++) v = v * 256 + u8[at + k];
    return v;
  }
  function eachEbml(u8, start2, end, cb) {
    let i = start2;
    while (i < end) {
      const id = ebmlId(u8, i);
      if (!id) return;
      const sz = ebmlSize(u8, i + id.len);
      if (!sz) return;
      const body2 = i + id.len + sz.len;
      cb(id.id, body2, sz.unknown ? end : Math.min(end, body2 + sz.size));
      const next = sz.unknown ? end : body2 + sz.size;
      i = next > i ? next : i + 1;
    }
  }
  function webmPicture(u8) {
    const head = ebmlId(u8, 0);
    if (!head || head.id !== 440786851) return null;
    const hs = ebmlSize(u8, head.len);
    if (!hs) return null;
    const segAt = head.len + hs.len + hs.size;
    const seg = ebmlId(u8, segAt);
    if (!seg || seg.id !== 408125543) return null;
    const ss = ebmlSize(u8, segAt + seg.len);
    if (!ss) return null;
    const segBody = segAt + seg.len + ss.len;
    const segEnd = ss.unknown ? u8.length : Math.min(u8.length, segBody + ss.size);
    const tracks = [];
    eachEbml(u8, segBody, segEnd, (id, b, e) => {
      if (id !== 374648427) return;
      eachEbml(u8, b, e, (tid, tb, te) => {
        if (tid !== 174) return;
        let num = 0, type = 0;
        eachEbml(u8, tb, te, (cid, cb, ce) => {
          if (cid === 215) num = ebmlUint(u8, cb, Math.min(ce - cb, 8));
          else if (cid === 131) type = ebmlUint(u8, cb, Math.min(ce - cb, 8));
        });
        if (type === 1 && num) tracks.push(num);
      });
    });
    if (!tracks.length) return false;
    let clusters = 0, blocks = 0;
    for (let i = 0; i <= u8.length - 5; i++) {
      if (u8[i] !== 31 || u8[i + 1] !== 67 || u8[i + 2] !== 182 || u8[i + 3] !== 117) continue;
      const cs = ebmlSize(u8, i + 4);
      if (!cs) continue;
      clusters += 1;
      const cb = i + 4 + cs.len;
      const ce = cs.unknown ? u8.length : Math.min(u8.length, cb + cs.size);
      eachEbml(u8, cb, ce, (bid, bb, be) => {
        if (bid !== 160 && bid !== 163 && bid !== 161) return;
        const blockNum = (at) => {
          const tt = ebmlVintLen(u8[at]);
          if (!tt || at + tt > u8.length) return 0;
          return (u8[at] & (1 << 8 - tt) - 1) * Math.pow(256, tt - 1) + (tt > 1 ? ebmlUint(u8, at + 1, tt - 1) : 0);
        };
        if (bid === 160) {
          eachEbml(u8, bb, be, (gid, gb) => {
            if (gid === 161 && tracks.indexOf(blockNum(gb)) !== -1) blocks += 1;
          });
          return;
        }
        if (tracks.indexOf(blockNum(bb)) !== -1) blocks += 1;
      });
      if (blocks) return true;
    }
    return clusters ? false : null;
  }
  function eachBox(u8, start2, end, cb) {
    let i = start2;
    while (i + 8 <= end) {
      let size = u8[i] * 16777216 + u8[i + 1] * 65536 + u8[i + 2] * 256 + u8[i + 3], hdr = 8;
      if (size === 1) {
        size = 0;
        for (let k = 0; k < 8; k++) size = size * 256 + u8[i + 8 + k];
        hdr = 16;
      } else if (size === 0) size = end - i;
      if (size < hdr || i + size > end + 1) return;
      cb(String.fromCharCode(u8[i + 4], u8[i + 5], u8[i + 6], u8[i + 7]), i + hdr, Math.min(end, i + size));
      i += size;
    }
  }
  function findBox(u8, start2, end, want, depth) {
    if (depth > 6) return null;
    let hit = null;
    eachBox(u8, start2, end, (type, b, e) => {
      if (hit) return;
      if (type === want) {
        hit = { body: b, end: e };
        return;
      }
      if (type === "moov" || type === "trak" || type === "mdia" || type === "minf" || type === "stbl" || type === "edts" || type === "udta") hit = findBox(u8, b, e, want, depth + 1);
    });
    return hit;
  }
  function hasFourcc(u8, tag) {
    const a = tag.charCodeAt(0), b = tag.charCodeAt(1), c = tag.charCodeAt(2), d = tag.charCodeAt(3);
    for (let i = 0; i <= u8.length - 4; i++) {
      if (u8[i] === a && u8[i + 1] === b && u8[i + 2] === c && u8[i + 3] === d) return true;
    }
    return false;
  }
  function mp4Picture(u8) {
    if (hasFourcc(u8, "moof") || hasFourcc(u8, "mvex")) return null;
    for (let i = 4; i <= u8.length - 8; i++) {
      if (!(u8[i] === 109 && u8[i + 1] === 111 && u8[i + 2] === 111 && u8[i + 3] === 118)) continue;
      let samples = 0, sawVideo = false, blind = false;
      eachBox(u8, i + 4, u8.length, (type, b, e) => {
        if (type !== "trak") return;
        const h = findBox(u8, b, e, "hdlr", 0);
        if (!h) return;
        if (String.fromCharCode(u8[h.body + 8], u8[h.body + 9], u8[h.body + 10], u8[h.body + 11]) !== "vide") return;
        sawVideo = true;
        const sz = findBox(u8, b, e, "stsz", 0);
        if (!sz) {
          blind = true;
          return;
        }
        samples += ebmlUint(u8, sz.body + 8, 4);
      });
      if (blind) return null;
      return sawVideo ? samples > 0 : false;
    }
    return null;
  }
  function pictureVerdict(file) {
    return new Promise((resolve) => {
      const CAP = 8 * 1024 * 1024;
      const slices = [file.slice(0, Math.min(file.size, CAP))];
      if (file.size > CAP) slices.push(file.slice(file.size - CAP));
      Promise.all(slices.map((s) => new Promise((res) => {
        const fr = new FileReader();
        fr.onerror = () => res(null);
        fr.onload = () => res(new Uint8Array(fr.result));
        fr.readAsArrayBuffer(s);
      }))).then((bufs) => {
        for (const u8 of bufs) {
          if (!u8 || u8.length < 16) continue;
          const webm = webmPicture(u8);
          if (webm !== null) {
            resolve(webm ? "yes" : "no");
            return;
          }
          const mp4 = mp4Picture(u8);
          if (mp4 !== null) {
            resolve(mp4 ? "yes" : "no");
            return;
          }
        }
        resolve("unknown");
      });
    });
  }
  async function uploadClip(file, name, seal) {
    const s = await sessToken();
    if (!s || !s.t) {
      fabSay("Log in to upload.", 7e3);
      return;
    }
    const title = (String(name || "").trim() || "New clip").slice(0, 80);
    const clip = await publishVideo(file, title, s, message => fabSay(message), channelSlug(), seal || {});
    if (clip && clip.review === "pending") {
      fabSay("", 1);
      window.__ktShell?.sentToParent?.(clip, title);
      return;
    }
    fabSay(seal ? "Sealed! It waits on the shelf until its day." : "Published! Taking you to it...", 3200);
    try {
      insertClipTop(seal ? { ...clip, sealed: true, opensAt: seal.opensAt, capsuleNote: seal.capsuleNote, sealedBy: s.first || "" } : clip);
    } catch (err) {
      location.reload();
    }
  }
  function insertClipTop(clip) {
    if (!clip || !clip.id || !clip.src) {
      location.reload();
      return;
    }
    const row = {
      id: clip.id,
      title: clip.title || "New clip",
      blurb: clip.blurb || "",
      kind: clip.kind || "video",
      poster: clip.sealed ? "" : clip.poster || "",
      src: clip.src,
      publishedAt: clip.publishedAt || (/* @__PURE__ */ new Date()).toISOString(),
      duration: clip.sealed ? 0 : Number(clip.duration) || 0,
      ...clip.sealed ? { sealed: true, opensAt: clip.opensAt, capsuleNote: clip.capsuleNote || "", sealedBy: clip.sealedBy || "" } : {}
    };
    clips.unshift(row);
    order = clips.map((c, i) => i);
    reel.innerHTML = clips.map(slideMarkup).join("");
    slides = queryAll(".tz-slide", reel);
    $('[data-bind="total"]').textContent = String(clips.length).padStart(2, "0");
    $('[data-bind="log"]').innerHTML = logMarkup();
    $('[data-bind="log2"]').innerHTML = logMarkup();
    $('[data-bind="logend"]').innerHTML = endplateMarkup();
    $('[data-bind="logend2"]').innerHTML = endplateMarkup();
    io.disconnect();
    for (const s of slides) io.observe(s);
    for (const slide of slides) wireSlide(slide);
    paintAllLikes();
    reactionsUi?.paintAll();
    setActive(0, { scroll: false });
    if (reel) reel.scrollTop = 0;
    requestAnimationFrame(() => {
      if (slides[0]) slides[0].scrollIntoView({ behavior: "auto", block: "start" });
    });
    history.replaceState(null, "", clipHash(row.id));
  }
  setActive(start > -1 ? start : 0, { scroll: false });
  if (start > 0 && body.dataset.mode === "immersive") requestAnimationFrame(() => slides[start]?.scrollIntoView({ behavior: "auto", block: "start" }));
  seedLikes();
  bootLaunchStory();
  seedRole().then((s) => {
    if (window.__ktChannel ? window.__ktChannel.canUpload : s && (s.role === "admin" || s.role === "super")) mountUploadFab();
  });
  window.__tzfeed = {
    mounted: true,
    clips: () => clips.map((c) => c.id),
    order: () => order.slice(),
    rank: (i) => rank(typeof i === "number" ? i : state.index),
    active: () => state.index,
    shuffle: () => state.shuffle,
    setShuffle,
    step,
    durOf: (i) => durOf(slides[i], $("video", slides[i])),
    pictureVerdict: (file) => pictureVerdict(file),
    uploadFile: (file, name) => uploadPicked(file, name),
    pick: () => pickAndUpload()
  };
}
