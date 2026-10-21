// Creature Feature: a monster-movie field file about the kid. A slowly turning ring holds their
// badge under a scratch-off cover; fireflies drift and googly eyes blink in the dark. Spooky-silly,
// never scary: no jump scares, no sudden sounds, nothing that chases.

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Small seeded random, so the fireflies sit in the same places every time for the same name.
function seeded(text) {
  let a = 2166136261;
  for (const char of text) a = Math.imul(a ^ char.codePointAt(0), 16777619);
  return () => {
    a = Math.imul(a ^ (a >>> 15), 2246822507);
    a = Math.imul(a ^ (a >>> 13), 3266489909);
    return ((a ^= a >>> 16) >>> 0) / 4294967296;
  };
}

function initials(title) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const first = (words[0] || '?').replace(/[^\p{L}\p{N}]/gu, '');
  return (first.length <= 4 ? first : words.length > 1 ? words.slice(0, 2).map(word => word[0]).join('') : first.slice(0, 4)).toUpperCase() || '?';
}

// A friendly wobbly "ooo-eee", like a theremin in an old film.
function playWobble(audio) {
  const now = audio.currentTime + 0.02;
  const tone = audio.createOscillator();
  tone.type = 'sine';
  tone.frequency.setValueAtTime(420, now);
  tone.frequency.exponentialRampToValueAtTime(760, now + 0.35);
  tone.frequency.exponentialRampToValueAtTime(520, now + 0.8);
  const vibrato = audio.createOscillator();
  vibrato.frequency.value = 7;
  const depth = audio.createGain();
  depth.gain.value = 18;
  vibrato.connect(depth).connect(tone.frequency);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.13, now + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
  tone.connect(gain).connect(audio.destination);
  tone.start(now);
  vibrato.start(now);
  tone.stop(now + 0.95);
  vibrato.stop(now + 0.95);
}

// The scratch-off cover over the badge. Clearing about half of it reveals the rest. Strokes are
// read from the whole ring, so a finger that starts on the rim still scratches.
function scratchCover(canvas, well, ring, ctx, onReveal) {
  const paint = canvas.getContext('2d', { willReadFrequently: true });
  if (!paint) { onReveal(); return () => {}; }
  let size = 0, scratched = false, revealed = false, strokes = 0, last = null;
  const draw = () => {
    const css = well.clientWidth;
    if (!css) return;
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    size = Math.round(css * ratio);
    canvas.width = size;
    canvas.height = size;
    paint.globalCompositeOperation = 'source-over';
    paint.fillStyle = '#1C2A1A';
    paint.fillRect(0, 0, size, size);
    paint.strokeStyle = '#253522';
    paint.lineWidth = size / 18;
    for (let x = -size; x < size * 2; x += size / 9) {
      paint.beginPath();
      paint.moveTo(x, 0);
      paint.lineTo(x + size, size);
      paint.stroke();
    }
    paint.fillStyle = ctx.accent;
    paint.textAlign = 'center';
    paint.textBaseline = 'middle';
    paint.font = `500 ${Math.round(size * 0.075)}px 'DM Mono', ui-monospace, Menlo, monospace`;
    paint.fillText('SCRATCH', size / 2, size * 0.45);
    paint.fillText('TO REVEAL', size / 2, size * 0.56);
  };
  const cleared = () => {
    const data = paint.getImageData(0, 0, size, size).data;
    let clear = 0, total = 0;
    for (let i = 3; i < data.length; i += 4 * 9) { total++; if (data[i] < 40) clear++; }
    return total ? clear / total : 0;
  };
  const point = event => {
    const rect = canvas.getBoundingClientRect();
    return [((event.clientX - rect.left) / rect.width) * size, ((event.clientY - rect.top) / rect.height) * size];
  };
  const scratch = (from, to) => {
    paint.globalCompositeOperation = 'destination-out';
    paint.lineCap = 'round';
    paint.lineJoin = 'round';
    paint.lineWidth = size * 0.17;
    paint.beginPath();
    paint.moveTo(...from);
    paint.lineTo(...to);
    paint.stroke();
    scratched = true;
    if (++strokes % 8 === 0) check();
  };
  const check = () => { if (!revealed && cleared() > 0.5) { revealed = true; onReveal(); } };
  ring.addEventListener('pointerdown', event => {
    if (revealed) return;
    ring.setPointerCapture?.(event.pointerId);
    last = point(event);
    scratch(last, [last[0] + 0.1, last[1]]);
    event.preventDefault();
  }, { signal: ctx.signal });
  ring.addEventListener('pointermove', event => {
    if (!last || revealed) return;
    const next = point(event);
    scratch(last, next);
    last = next;
  }, { signal: ctx.signal });
  const end = () => { if (last) { last = null; check(); } };
  ring.addEventListener('pointerup', end, { signal: ctx.signal });
  ring.addEventListener('pointercancel', end, { signal: ctx.signal });
  let observer = null;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => { if (!scratched) draw(); });
    observer.observe(well);
  }
  draw();
  return () => observer?.disconnect();
}

export function mount(host, ctx) {
  const { h } = ctx;
  host.style.setProperty('--cf-accent', ctx.accent);
  host.style.setProperty('--cf-ink', ctx.accentInk);
  const random = seeded(ctx.title);
  const flies = Array.from({ length: 12 }, () => h('i', {
    style: {
      left: `${(random() * 92 + 4).toFixed(1)}%`, top: `${(random() * 88 + 6).toFixed(1)}%`,
      '--cf-d': `${(random() * -9).toFixed(2)}s`, '--cf-t': `${(7 + random() * 6).toFixed(2)}s`,
      '--cf-x': `${(random() * 60 - 30).toFixed(0)}px`, '--cf-y': `${(random() * -70 - 20).toFixed(0)}px`,
    },
  }));
  const eyes = [['8%', '14%', '0s'], ['78%', '9%', '-2.2s'], ['12%', '82%', '-4.1s'], ['82%', '76%', '-1.3s']]
    .map(([left, top, delay]) => h('div', { class: 'cf-eyes', style: { left, top, '--cf-d': delay } }, h('i'), h('i')));
  const badge = ctx.logoUrl
    ? h('img', { class: 'cf-badge-img', src: ctx.logoUrl, alt: '', decoding: 'async' })
    : h('span', { class: 'cf-badge-text', text: initials(ctx.title) });
  const canvas = h('canvas', { class: 'cf-cover', 'aria-hidden': 'true' });
  const well = h('div', { class: 'cf-well' }, h('div', { class: 'cf-badge' }, badge), canvas);
  const ring = h('div', { class: 'cf-ring', 'aria-hidden': 'true' }, well);
  const enter = h('button', {
    class: 'cf-enter', type: 'button', 'data-kt-enter': true,
    onclick: () => {
      const audio = ctx.sound.context();
      if (audio) try { playWobble(audio); } catch {}
      ctx.onEnter();
    },
  }, ctx.enterLabel || 'Open the file');
  const root = h('div', { class: 'cf-root' },
    h('div', { class: 'cf-fog', 'aria-hidden': 'true' }, h('i'), h('i')),
    h('div', { class: 'cf-flies', 'aria-hidden': 'true' }, flies),
    h('div', { class: 'cf-eyeset', 'aria-hidden': 'true' }, eyes),
    h('main', { class: 'cf-stage' },
      h('p', { class: 'cf-kicker', text: ctx.kicker || `Field file ${ctx.number.padStart(3, '0')} · Species: ${ctx.title}` }),
      h('h1', { class: 'cf-title', text: `What is a ${ctx.title}?` }),
      ring,
      h('p', { class: 'cf-line', text: ctx.subtitle || 'Survival guide inside. Do not feed after midnight.' }),
      enter));
  host.replaceChildren(root);
  const stopCover = scratchCover(canvas, well, ring, ctx, () => root.classList.add('cf-revealed'));
  ctx.signal.addEventListener('abort', stopCover, { once: true });
  if (!ctx.preview) {
    document.addEventListener('keydown', event => { if (event.key === 'Escape') ctx.onSkip(); }, { signal: ctx.signal });
  }
  return {
    dismiss() {
      root.classList.add('cf-leaving');
      return wait(ctx.reducedMotion ? 0 : 480);
    },
  };
}
