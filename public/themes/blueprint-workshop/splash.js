// Blueprint Workshop: the original bright starter look kept as a theme. Blue graph paper, a chunky
// offset title, a rubber stamp with the kid's name and a block button. Entering tears the sheet.

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// "Ruby's Workshop" is made by Ruby.
const maker = title => (title.trim().split(/\s+/)[0] || title).replace(/['’]s$/i, '');

// A jagged line down the middle of the sheet, shared by both torn halves so they fit together.
function tearLine() {
  const points = [];
  for (let y = 0; y <= 100; y += 4) points.push([50 + (y % 8 ? 2.6 : -2.6) + Math.sin(y * 1.7) * 1.4, y]);
  const edge = points.map(([x, y]) => `${x.toFixed(2)}% ${y}%`);
  return {
    left: `polygon(0 0, ${edge.join(', ')}, 0 100%)`,
    right: `polygon(${edge.join(', ')}, 100% 100%, 100% 0)`,
  };
}

// A short paper rip: filtered noise with a quick crackle.
function playRip(audio) {
  const now = audio.currentTime + 0.02;
  const length = Math.floor(audio.sampleRate * 0.42);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const crackle = Math.random() < 0.02 ? 3 : 1;
    data[i] = (Math.random() * 2 - 1) * crackle * (1 - i / length);
  }
  const source = audio.createBufferSource();
  source.buffer = buffer;
  const band = audio.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(1800, now);
  band.frequency.exponentialRampToValueAtTime(4200, now + 0.35);
  band.Q.value = 0.9;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
  source.connect(band).connect(gain).connect(audio.destination);
  source.start(now);
}

export function mount(host, ctx) {
  const { h } = ctx;
  host.style.setProperty('--bw-accent', ctx.accent);
  host.style.setProperty('--bw-ink', ctx.accentInk);
  const enter = h('button', {
    class: 'bw-enter', type: 'button', 'data-kt-enter': true,
    onclick: () => {
      const audio = ctx.sound.context();
      if (audio) try { playRip(audio); } catch {}
      ctx.onEnter();
    },
  }, h('span', { text: ctx.enterLabel || 'Enter the channel' }), h('span', { class: 'bw-arrow', 'aria-hidden': 'true' }, '→'));
  const sheet = h('div', { class: 'bw-sheet' },
    h('div', { class: 'bw-ruler bw-ruler-top', 'aria-hidden': 'true' }),
    h('div', { class: 'bw-ruler bw-ruler-left', 'aria-hidden': 'true' }),
    h('p', { class: 'bw-corner', 'aria-hidden': 'true' }, `SHEET ${ctx.number} · SCALE 1:1`),
    h('main', { class: 'bw-stage' },
      h('p', { class: 'bw-eyebrow', text: ctx.kicker || 'A family space to create' }),
      h('h1', { class: 'bw-title', text: ctx.title }),
      h('svg:svg', { class: 'bw-pencil', viewBox: '0 0 300 16', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
        h('svg:path', { d: 'M2 10 C 60 3, 120 14, 180 8 S 270 4, 298 9', pathLength: 1 })),
      ctx.subtitle ? h('p', { class: 'bw-line', text: ctx.subtitle }) : null,
      h('p', { class: 'bw-stamp', text: `Made by ${maker(ctx.title)}` }),
      enter),
    h('p', { class: 'bw-fig', 'aria-hidden': 'true' }, `FIG. ${ctx.number} · DRAW · BUILD · PLAY`));
  const root = h('div', { class: 'bw-root' }, sheet);
  host.replaceChildren(root);
  if (!ctx.preview) {
    document.addEventListener('keydown', event => { if (event.key === 'Escape') ctx.onSkip(); }, { signal: ctx.signal });
  }
  return {
    async dismiss() {
      if (ctx.reducedMotion) return;
      // Two copies of the sheet, cut along the same line, pull apart to show what is underneath.
      const cut = tearLine();
      const halves = ['left', 'right'].map(side => {
        const half = sheet.cloneNode(true);
        half.classList.add('bw-half', `bw-half-${side}`);
        half.setAttribute('aria-hidden', 'true');
        half.style.clipPath = cut[side];
        return half;
      });
      host.style.background = 'transparent';
      root.classList.add('bw-tearing');
      root.append(...halves);
      sheet.style.visibility = 'hidden';
      await wait(520);
    },
  };
}
