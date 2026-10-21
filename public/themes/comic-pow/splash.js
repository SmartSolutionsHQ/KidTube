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
