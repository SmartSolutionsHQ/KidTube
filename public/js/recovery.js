// Playback recovery for the feed, watching its slides from the outside: a clip that fails to load is
// retried quietly a few times (its error stays hidden meanwhile, see feed.css), only one video plays at
// a time, and nothing plays behind a splash until the viewer taps (tz:hold / tz:enter from themes.js).
(() => {
  if (!document.querySelector(".tz-reel")) return;
  const DELAYS = [700, 1500, 3e3];
  const journal = new WeakMap();
  const rec = (slide) => {
    let r = journal.get(slide);
    if (!r) {
      r = { presses: 0, timer: 0, released: false };
      journal.set(slide, r);
    }
    return r;
  };
  function paintStill(slide) {
    const v = slide.querySelector("video");
    const src = v ? v.getAttribute("poster") : null;
    if (!src) return;
    const amb = slide.querySelector(".tz-amb");
    if (amb && !amb.getAttribute("src")) amb.setAttribute("src", src);
  }
  function pressRetry(slide) {
    const btn = slide.querySelector('[data-act="retry"]');
    if (!btn) return false;
    btn.click();
    return true;
  }
  function softPlay(v) {
    try {
      const p = v.play();
      if (p && p.catch) p.catch(() => {
      });
    } catch (err) {
    }
  }
  function healed(slide) {
    const v = slide.querySelector("video");
    const alive = slide.dataset.state === "ready" && v && v.readyState >= 2;
    if (!alive) return false;
    const r = rec(slide);
    window.clearTimeout(r.timer);
    r.timer = 0;
    r.presses = 0;
    r.released = false;
    slide.removeAttribute("data-tz-rescue");
    if (slide.dataset.active === "1" && v.paused && v.currentTime === 0 && !touched && !holding && !document.hidden) softPlay(v);
    return true;
  }
  function attempt(slide) {
    const r = rec(slide);
    if (healed(slide)) return;
    if (slide.dataset.state !== "error") return;
    paintStill(slide);
    if (r.timer) return;
    if (r.released || r.presses >= DELAYS.length) {
      r.released = true;
      slide.removeAttribute("data-tz-rescue");
      return;
    }
    const wait = DELAYS[r.presses];
    r.presses++;
    slide.setAttribute("data-tz-rescue", "1");
    r.timer = window.setTimeout(() => {
      r.timer = 0;
      if (slide.dataset.active !== "1" || document.hidden) return;
      if (slide.dataset.state !== "error") {
        r.timer = window.setTimeout(() => {
          r.timer = 0;
          attempt(slide);
        }, 1500);
        return;
      }
      if (!pressRetry(slide)) {
        r.released = true;
        slide.removeAttribute("data-tz-rescue");
        return;
      }
      r.timer = window.setTimeout(() => {
        r.timer = 0;
        attempt(slide);
      }, 1500);
    }, wait);
  }
  function sync() {
    const slides = document.querySelectorAll(".tz-slide");
    let active = null;
    for (let i = 0; i < slides.length; i++) {
      if (slides[i].dataset.active === "1") active = slides[i];
    }
    for (let i = 0; i < slides.length; i++) {
      const s = slides[i];
      if (s.dataset.end === "1") continue;
      if (s === active && s.dataset.state === "error") attempt(s);
      else {
        const r = rec(s);
        if (s !== active) { window.clearTimeout(r.timer); r.timer = 0; }
        healed(s);
      }
    }
  }
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sync();
    });
  };
  try {
    new MutationObserver(schedule).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state", "data-active", "src"]
    });
  } catch (err) {
  }
  document.addEventListener("error", (e) => {
    const t = e.target;
    if (!t || t.tagName !== "VIDEO") return;
    const slide = t.closest ? t.closest(".tz-slide") : null;
    if (slide) {
      paintStill(slide);
      schedule();
    }
  }, true);
  let touched = false;
  let holding = false;
  function pauseAll() {
    document.querySelectorAll(".tz-slide video").forEach((v) => {
      if (!v.paused) v.pause();
    });
  }
  function holdAll() {
    holding = true;
    pauseAll();
    window.setTimeout(() => {
      if (holding) pauseAll();
    }, 900);
  }
  const markTouched = (e) => {
    const t = e.target;
    if (t && t.closest && t.closest("#tzs-splash")) return;
    touched = true;
    holding = false;
  };
  window.addEventListener("pointerdown", markTouched, true);
  window.addEventListener("keydown", markTouched, true);
  window.addEventListener("touchstart", markTouched, true);
  document.addEventListener("play", (e) => {
    const t = e.target;
    if (!t || t.tagName !== "VIDEO" || !t.closest || !t.closest(".tz-slide")) return;
    if (holding) {
      t.pause();
      return;
    }
    document.querySelectorAll(".tz-slide video").forEach((v) => {
      if (v !== t && !v.paused) v.pause();
    });
  }, true);
  function nudge() {
    if (touched) return;
    const slide = document.querySelector('.tz-slide[data-active="1"]') || document.querySelector('.tz-slide:not([data-end="1"])');
    if (!slide || slide.dataset.state === "error") return;
    const v = slide.querySelector("video");
    if (!v || !v.paused || v.currentTime > 0) return;
    softPlay(v);
  }
  document.addEventListener("tz:hold", holdAll);
  document.addEventListener("tz:enter", holdAll);
  if (!window.__tzsplash) window.setTimeout(nudge, 2600);
  sync();
})();
