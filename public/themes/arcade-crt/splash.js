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
