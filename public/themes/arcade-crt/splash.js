// Arcade: an 8-bit attract screen on a curved CRT. A scrolling starfield, 1UP and HI scores, the
// kid's name as a pixel title and a slow PRESS START. A coin blip plays after the tap.

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const STAR_COLOURS = ['#FFFFFF', '#FFFFFF', '#FFFFFF', '#3DFFB0', '#FF6FB5', '#4DB8FF'];
const mmss = value => {
  const s = Math.max(0, Math.floor(Number(value) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function playCoin(audio) {
  const now = audio.currentTime + 0.02;
  const tone = audio.createOscillator();
  tone.type = 'square';
  tone.frequency.setValueAtTime(987.77, now);
  tone.frequency.setValueAtTime(1318.51, now + 0.08);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.07, now + 0.01);
  gain.gain.setValueAtTime(0.07, now + 0.2);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
  tone.connect(gain).connect(audio.destination);
  tone.start(now);
  tone.stop(now + 0.45);
}

// Stars scroll down past the screen in three layers, drawn as chunky pixels.
function starfield(canvas, host, ctx) {
  const paint = canvas.getContext('2d');
  if (!paint) return () => {};
  const pixel = 3;
  let width = 0, height = 0, stars = [];
  const size = () => {
    width = Math.max(1, Math.ceil(host.clientWidth / pixel));
    height = Math.max(1, Math.ceil(host.clientHeight / pixel));
    canvas.width = width;
    canvas.height = height;
    const count = Math.round((width * height) / 90);
    stars = Array.from({ length: count }, (_, i) => ({
      x: Math.random() * width, y: Math.random() * height,
      layer: i % 3, colour: STAR_COLOURS[i % STAR_COLOURS.length],
    }));
  };
  const draw = dt => {
    paint.fillStyle = '#04040A';
    paint.fillRect(0, 0, width, height);
    for (const star of stars) {
      star.y += dt * (6 + star.layer * 9);
      if (star.y >= height) { star.y -= height; star.x = Math.random() * width; }
      paint.fillStyle = star.colour;
      paint.globalAlpha = 0.45 + star.layer * 0.25;
      paint.fillRect(Math.floor(star.x), Math.floor(star.y), 1, star.layer === 2 ? 2 : 1);
    }
    paint.globalAlpha = 1;
  };
  size();
  draw(0);
  let observer = null;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => { size(); draw(0); });
    observer.observe(host);
  }
  const stop = ctx.reducedMotion ? () => {} : ctx.loop((time, dt) => draw(dt), { fps: 30 });
  return () => { stop(); observer?.disconnect(); };
}

export function mount(host, ctx) {
  const { h } = ctx;
  host.style.setProperty('--ac-accent', ctx.accent);
  host.style.setProperty('--ac-ink', ctx.accentInk);
  const canvas = h('canvas', { class: 'ac-stars', 'aria-hidden': 'true' });
  const score = h('span', { text: '1UP 000000' });
  const words = ctx.title.toUpperCase().split(/\s+/).filter(Boolean);
  const level = [`LEVEL ${ctx.number}`, ctx.subtitle ? ctx.subtitle.toUpperCase() : null].filter(Boolean).join(' · ');
  const start = h('button', {
    class: 'ac-start', type: 'button', 'data-kt-enter': true,
    onclick: () => {
      const audio = ctx.sound.context();
      if (audio) try { playCoin(audio); } catch {}
      ctx.onEnter();
    },
  }, ctx.enterLabel || 'PRESS START');
  const root = h('div', { class: 'ac-root' },
    canvas,
    h('div', { class: 'ac-screen' },
      h('p', { class: 'ac-hud', 'aria-hidden': 'true' }, score, h('span', { class: 'ac-hi' }, 'HI 999999')),
      h('main', { class: 'ac-stage' },
        ctx.kicker ? h('p', { class: 'ac-kicker', text: ctx.kicker.toUpperCase() }) : null,
        h('h1', { class: 'ac-title', 'aria-label': ctx.title }, words.map(word => h('span', { 'aria-hidden': 'true' }, word))),
        h('p', { class: 'ac-level', text: level }),
        start),
      h('p', { class: 'ac-coin', 'aria-hidden': 'true' }, 'INSERT COIN · ESC TO SKIP')),
    h('div', { class: 'ac-crt', 'aria-hidden': 'true' }));
  host.replaceChildren(root);
  const stopStars = starfield(canvas, host, ctx);
  ctx.signal.addEventListener('abort', stopStars, { once: true });

  // The 1UP score counts up once, like a demo run, then holds.
  if (!ctx.reducedMotion) {
    ctx.loop(time => {
      const points = Math.min(2500, Math.floor(time * 1600 / 50) * 50);
      score.textContent = `1UP ${String(points).padStart(6, '0')}`;
      return points < 2500;
    }, { fps: 12 });
  } else score.textContent = '1UP 002500';

  if (!ctx.preview) {
    document.addEventListener('keydown', event => { if (event.key === 'Escape') ctx.onSkip(); }, { signal: ctx.signal });
  }
  return {
    async dismiss() {
      root.classList.add('ac-leaving');
      await wait(ctx.reducedMotion ? 0 : 460);
      stopStars();
    },
  };
}

// Pixel PAUSED box over a paused feed video.
export function pause(host, ctx) {
  const { h } = ctx;
  host.style.setProperty('--ac-accent', ctx.accent);
  const time = h('span', { text: 'TIME 00:00' });
  const root = h('div', { class: 'ac-pause' },
    h('p', { class: 'ac-pause-hud' }, time, h('span', { class: 'ac-hi' }, 'HI 999999')),
    h('div', { class: 'ac-pause-box' },
      h('div', { class: 'ac-pause-bars' }, h('i'), h('i')),
      h('p', { class: 'ac-pause-word' }, 'PAUSED'),
      h('p', { class: 'ac-pause-hint' }, 'TAP TO CONTINUE')));
  host.replaceChildren(root);
  return {
    show(seconds = 0) {
      time.textContent = `TIME ${mmss(seconds)}`;
      root.classList.add('ac-on');
    },
    hide() { root.classList.remove('ac-on'); },
    destroy() { host.replaceChildren(); },
  };
}

// ---------- time capsule unlock and game over ----------

const UNLOCK_MS = 2400;
const isReduced = (host, ctx) => ctx.reducedMotion || host.hasAttribute('data-kt-reduced');

// A 16 × 14 pixel treasure chest. The lid and the coins are their own groups so CSS can pop them.
function chest(h) {
  const px = (x, y, width, height, fill, cls) => h('svg:rect', { x, y, width, height, fill, class: cls });
  return h('svg:svg', { class: 'ac-unlock-chest', viewBox: '0 -9 16 23', 'shape-rendering': 'crispEdges' },
    h('svg:g', { class: 'ac-unlock-coins' },
      px(3, -6, 2, 2, '#FFD23F'), px(7, -8, 2, 2, '#FFD23F'), px(11, -5, 2, 2, '#FFD23F'),
      px(7, -8, 1, 1, '#FFF6D8'), px(3, -6, 1, 1, '#FFF6D8'), px(11, -5, 1, 1, '#FFF6D8')),
    px(1, 5, 14, 2, null, 'ac-unlock-glow'),
    h('svg:g', { class: 'ac-unlock-body' },
      px(0, 6, 16, 8, '#2A1608'), px(1, 7, 14, 6, '#8A4F24'), px(1, 7, 14, 1, '#A8652F'),
      px(3, 7, 2, 6, '#FFD23F'), px(11, 7, 2, 6, '#FFD23F'),
      px(6, 6, 4, 4, '#FFD23F'), px(7, 7, 2, 2, '#2A1608')),
    h('svg:g', { class: 'ac-unlock-lid' },
      px(0, 0, 16, 6, '#2A1608'), px(1, 1, 14, 4, '#A0612E'), px(1, 1, 14, 1, '#C98245'),
      px(3, 1, 2, 4, '#FFD23F'), px(11, 1, 2, 4, '#FFD23F')));
}

// A time capsule opens: a pixel chest pops its lid, coins jump out and NEW TAPE UNLOCKED drops in
// over the clip title, with a coin blip. Built here, shown by play().
export function unlock(host, ctx) {
  const { h } = ctx;
  host.style.setProperty('--ac-accent', ctx.accent);
  host.style.setProperty('--ac-ink', ctx.accentInk);
  const root = h('div', { class: 'ac-unlock' },
    h('div', { class: 'ac-unlock-stage' },
      chest(h),
      h('p', { class: 'ac-unlock-word' }, h('span', { text: 'NEW TAPE' }), h('span', { text: 'UNLOCKED!' })),
      h('p', { class: 'ac-unlock-title', text: String(ctx.title || '').toUpperCase() }),
      ctx.note ? h('p', { class: 'ac-unlock-note', text: ctx.note }) : null),
    h('div', { class: 'ac-unlock-crt' }));
  let running = null, timer = 0, finish = () => {};
  const stop = () => { clearTimeout(timer); timer = 0; finish(); };
  ctx.signal.addEventListener('abort', stop, { once: true });
  return {
    play() {
      if (running) return running;
      host.replaceChildren(root);
      const reduced = isReduced(host, ctx);
      if (!reduced) {
        const audio = ctx.sound.context();
        if (audio) try { playCoin(audio); } catch {}
      }
      running = new Promise(resolve => {
        finish = resolve;
        if (ctx.signal.aborted) resolve();
        else timer = setTimeout(resolve, reduced ? 30 : UNLOCK_MS);
      });
      return running;
    },
    destroy() {
      stop();
      host.replaceChildren();
    },
  };
}

// Out of tape for today: the CRT switches on to GAME OVER, INSERT COIN TOMORROW types in and the
// SCORE counts up to the minutes watched, then everything holds still. No blinking.
export function ending(host, ctx) {
  const { h } = ctx;
  host.style.setProperty('--ac-accent', ctx.accent);
  host.style.setProperty('--ac-ink', ctx.accentInk);
  const score = h('span', { text: '000' });
  const root = h('div', { class: 'ac-end', 'aria-hidden': 'true' },
    h('div', { class: 'ac-end-screen' },
      h('div', { class: 'ac-end-stars' }),
      h('p', { class: 'ac-end-hud' }, h('span', { text: 'CREDIT 0' }), h('span', { class: 'ac-hi', text: `LEVEL ${ctx.number}` })),
      h('div', { class: 'ac-end-stage' },
        h('p', { class: 'ac-end-over' }, h('span', { text: 'GAME' }), h('span', { text: 'OVER' })),
        h('p', { class: 'ac-end-coin' }, 'INSERT COIN TOMORROW'),
        h('p', { class: 'ac-end-score' }, 'SCORE ', score, ' MIN'))),
    h('div', { class: 'ac-end-crt' }));
  const stops = [];
  const halt = () => { while (stops.length) stops.pop()(); };
  ctx.signal.addEventListener('abort', halt, { once: true });
  const digits = value => String(Math.max(0, Math.floor(value))).padStart(3, '0');
  let shown = false;
  return {
    show({ used = 0 } = {}) {
      const minutes = Math.max(0, Math.round((Number(used) || 0) / 60));
      score.textContent = digits(minutes);
      if (shown) return;
      shown = true;
      host.replaceChildren(root);
      if (isReduced(host, ctx)) return;
      score.textContent = digits(0);
      stops.push(ctx.loop(time => {
        const p = Math.min(1, Math.max(0, (time - 1.4) / 0.8));
        score.textContent = digits(minutes * p);
        return p < 1;
      }, { fps: 12 }));
    },
    destroy() {
      halt();
      host.replaceChildren();
    },
  };
}
