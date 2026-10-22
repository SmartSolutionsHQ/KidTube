// Comic Pow: a comic-book cover. Halftone dots, a speech bubble with the channel name and a POW
// burst. Entering pops the burst and wipes the cover away like turning to the first panel.

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const BURST = '110,4 128,52 176,22 160,72 216,70 170,104 210,140 156,132 160,186 122,148 96,188 88,140 34,166 58,120 6,104 56,84 26,36 82,58';

function playPow(audio) {
  const now = audio.currentTime + 0.02;
  const thump = audio.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(190, now);
  thump.frequency.exponentialRampToValueAtTime(55, now + 0.22);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.28, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
  thump.connect(gain).connect(audio.destination);
  thump.start(now);
  thump.stop(now + 0.32);
  const length = Math.floor(audio.sampleRate * 0.18);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
  const snap = audio.createBufferSource();
  snap.buffer = buffer;
  const low = audio.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 2400;
  const snapGain = audio.createGain();
  snapGain.gain.value = 0.16;
  snap.connect(low).connect(snapGain).connect(audio.destination);
  snap.start(now);
}

const shout = title => (/[!?]$/.test(title) ? title : `${title}!`);

export function mount(host, ctx) {
  const { h } = ctx;
  host.style.setProperty('--cp-accent', ctx.accent);
  host.style.setProperty('--cp-ink', ctx.accentInk);
  const enter = h('button', {
    class: 'cp-enter', type: 'button', 'data-kt-enter': true,
    onclick: () => {
      const audio = ctx.sound.context();
      if (audio) try { playPow(audio); } catch {}
      ctx.onEnter();
    },
  }, ctx.enterLabel || 'Tap to enter');
  const burst = h('svg:svg', { class: 'cp-burst', viewBox: '0 0 220 190', 'aria-hidden': 'true' },
    h('svg:polygon', { points: BURST, class: 'cp-burst-shape' }),
    h('svg:text', { x: 110, y: 112, 'text-anchor': 'middle', class: 'cp-burst-text' }, 'KA-POW!'));
  const root = h('div', { class: 'cp-root' },
    h('div', { class: 'cp-rays', 'aria-hidden': 'true' }),
    h('div', { class: 'cp-dots', 'aria-hidden': 'true' }),
    h('div', { class: 'cp-panel', 'aria-hidden': 'true' }),
    h('p', { class: 'cp-caption' }, h('b', { text: `Issue #${ctx.number}` }), ctx.kicker || 'A brand new adventure'),
    h('main', { class: 'cp-stage' },
      h('h1', { class: 'cp-bubble', text: shout(ctx.title) }),
      burst,
      ctx.subtitle ? h('p', { class: 'cp-line', text: ctx.subtitle }) : null,
      enter));
  host.replaceChildren(root);
  if (!ctx.preview) {
    document.addEventListener('keydown', event => { if (event.key === 'Escape') ctx.onSkip(); }, { signal: ctx.signal });
  }
  return {
    async dismiss() {
      if (ctx.reducedMotion) return;
      host.style.background = 'transparent';
      root.classList.add('cp-leaving');
      await wait(560);
    },
  };
}

// A "PAUSE!" speech bubble over a paused feed video.
export function pause(host, ctx) {
  const { h } = ctx;
  host.style.setProperty('--cp-accent', ctx.accent);
  const root = h('div', { class: 'cp-pause' },
    h('div', { class: 'cp-pause-dots' }),
    h('p', { class: 'cp-pause-bubble' }, 'PAUSE!'),
    h('p', { class: 'cp-pause-caption' }, 'To be continued…'));
  host.replaceChildren(root);
  return {
    show() { root.classList.add('cp-on'); },
    hide() { root.classList.remove('cp-on'); },
    destroy() { host.replaceChildren(); },
  };
}

// ---------- time capsule unlock and THE END ----------

const UNLOCK_MS = 2400;
const isReduced = (host, ctx) => ctx.reducedMotion || host.hasAttribute('data-kt-reduced');

// A soft mechanical KA-CHUNK: a low thud, then a short latch click.
function playChunk(audio) {
  const now = audio.currentTime + 0.02;
  const thud = audio.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(150, now);
  thud.frequency.exponentialRampToValueAtTime(48, now + 0.18);
  const thudGain = audio.createGain();
  thudGain.gain.setValueAtTime(0.0001, now);
  thudGain.gain.exponentialRampToValueAtTime(0.12, now + 0.008);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  thud.connect(thudGain).connect(audio.destination);
  thud.start(now);
  thud.stop(now + 0.26);
  const at = now + 0.14;
  const length = Math.floor(audio.sampleRate * 0.06);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  const click = audio.createBufferSource();
  click.buffer = buffer;
  const band = audio.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1800;
  const clickGain = audio.createGain();
  clickGain.gain.value = 0.1;
  click.connect(band).connect(clickGain).connect(audio.destination);
  click.start(at);
}

// A time capsule opens: a KA-CHUNK! burst slams in with a caption and the clip title in a speech
// bubble. Built here, shown by play().
export function unlock(host, ctx) {
  const { h } = ctx;
  host.style.setProperty('--cp-accent', ctx.accent);
  host.style.setProperty('--cp-ink', ctx.accentInk);
  const burst = h('svg:svg', { class: 'cp-unlock-burst', viewBox: '0 0 220 190' },
    h('svg:polygon', { points: BURST, class: 'cp-unlock-shape' }),
    h('svg:text', { x: 110, y: 110, 'text-anchor': 'middle', textLength: 176, lengthAdjust: 'spacingAndGlyphs', class: 'cp-unlock-text' }, 'KA-CHUNK!'));
  const root = h('div', { class: 'cp-unlock' },
    h('div', { class: 'cp-unlock-dots' }),
    h('p', { class: 'cp-unlock-caption' }, 'Meanwhile… a sealed tape opens!'),
    h('div', { class: 'cp-unlock-stage' },
      burst,
      h('p', { class: 'cp-unlock-bubble', text: String(ctx.title || '') }),
      ctx.note ? h('p', { class: 'cp-unlock-note', text: ctx.note }) : null));
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
        if (audio) try { playChunk(audio); } catch {}
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

// Out of tape for today: a halftone wipe sweeps across the cover and a THE END panel lands on it.
// Everything plays once and holds; the shell draws its words and button below the panel.
export function ending(host, ctx) {
  const { h } = ctx;
  host.style.setProperty('--cp-accent', ctx.accent);
  host.style.setProperty('--cp-ink', ctx.accentInk);
  const tag = h('p', { class: 'cp-end-tag' });
  const root = h('div', { class: 'cp-end', 'aria-hidden': 'true' },
    h('div', { class: 'cp-end-rays' }),
    h('div', { class: 'cp-end-wipe' }),
    h('div', { class: 'cp-end-frame' }),
    h('p', { class: 'cp-end-caption' }, h('b', { text: `Issue #${ctx.number}` }), 'And so our hero rests…'),
    h('div', { class: 'cp-end-stage' },
      h('p', { class: 'cp-end-panel' }, 'THE END'),
      tag));
  let shown = false;
  return {
    show({ used = 0 } = {}) {
      const minutes = Math.max(0, Math.round((Number(used) || 0) / 60));
      tag.textContent = minutes > 0 ? `${minutes} minute${minutes === 1 ? '' : 's'} of action!` : `${ctx.title} saves the day!`;
      if (shown) return;
      shown = true;
      host.replaceChildren(root);
    },
    destroy() { host.replaceChildren(); },
  };
}
