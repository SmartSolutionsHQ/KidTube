// Ember Tape: living smoke in the kid's accent, played like the first seconds of a VHS tape.
// The smoke is our own WebGL shader (value-noise fbm with domain warping); without WebGL a CSS
// version takes over. Everything waits for ctx: importing this file does nothing.

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=?';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const mmss = value => {
  const s = Math.max(0, Math.floor(Number(value) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Smoke: two passes of domain warping over a five-octave value-noise fbm, sampled three times
// with a small horizontal offset per colour channel for the chromatic split. The tape warp, the
// rolling head bar and the occasional tear move the sampling position before the smoke is read.
const FRAGMENT = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uFade;
uniform vec3 uAccent;
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = turn * p;
    amp *= 0.5;
  }
  return v;
}
float smoke(vec2 p, float t) {
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.11)), fbm(p + vec2(5.2, 1.3) - vec2(t * 0.07, 0.0)));
  vec2 r = vec2(fbm(p + 3.2 * q + vec2(1.7, 9.2) + t * 0.13), fbm(p + 3.2 * q + vec2(8.3, 2.8) - t * 0.09));
  return fbm(p + 2.4 * r);
}
vec3 palette(float d) {
  vec3 deep = vec3(0.012, 0.014, 0.03) + vec3(0.30, 0.36, 1.0) * 0.05;
  vec3 body = uAccent * 0.62;
  vec3 hot = mix(uAccent, vec3(1.0, 0.93, 0.82), 0.45);
  vec3 c = mix(deep, body, smoothstep(0.32, 0.66, d));
  return mix(c, hot, smoothstep(0.66, 0.92, d));
}
void main() {
  float t = uTime;
  vec2 uv = vUv;
  float wobble = sin(uv.y * 9.0 + t * 1.3) * 0.0025 + sin(uv.y * 31.0 - t * 2.1) * 0.0012;
  float tracking = smoothstep(0.14, 0.0, uv.y) * sin(t * 3.0 + uv.y * 80.0) * 0.012;
  float barY = 1.0 - fract(t * 0.065);
  float bar = smoothstep(0.045, 0.0, abs(uv.y - barY));
  float slot = floor(t / 6.5);
  float tearOn = step(0.955, fract(t / 6.5));
  float tearY = 0.2 + 0.6 * hash(vec2(slot, 3.1));
  float tear = tearOn * step(abs(uv.y - tearY), 0.03);
  uv.x += wobble + tracking + bar * 0.006 + tear * 0.035;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 1.7 + vec2(0.0, -t * 0.02);
  float split = 0.012 + bar * 0.02 + tear * 0.03;
  vec3 col = vec3(
    palette(smoke(p + vec2(split, 0.0), t)).r,
    palette(smoke(p, t)).g,
    palette(smoke(p - vec2(split, 0.0), t)).b
  );
  col += bar * 0.05 * (hash(vec2(floor(uv.y * uRes.y), floor(t * 30.0))) - 0.3);
  col += (hash(gl_FragCoord.xy + fract(t * 7.0) * 91.0) - 0.5) * 0.07;
  vec2 v = (vUv - 0.5) * vec2(1.05, 0.95);
  float centre = exp(-dot(v * vec2(1.6, 2.4), v * vec2(1.6, 2.4)) * 4.0);
  col += uAccent * 0.22 * centre;
  col *= smoothstep(0.95, 0.25, length(v) * 1.15);
  gl_FragColor = vec4(max(col, 0.0) * uFade, 1.0);
}
`;

// Starts the WebGL smoke on a canvas. Returns null when WebGL is missing or fails, so the CSS smoke
// can take over.
function startSmoke(canvas, host, ctx, onLost) {
  let gl = null;
  try {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'low-power' });
  } catch { gl = null; }
  if (!gl) return null;
  const release = () => { gl.getExtension('WEBGL_lose_context')?.loseContext(); return null; };
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX), fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vs || !fs) return release();
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return release();
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const u = name => gl.getUniformLocation(program, name);
  const uRes = u('uRes'), uTime = u('uTime'), uFade = u('uFade'), uAccent = u('uAccent');
  gl.uniform3fv(uAccent, rgb(ctx.accent));

  // Smoke is soft, so it renders at a fraction of the screen and the browser scales it up.
  const budget = ctx.preview ? 40000 : ctx.lowPower ? 70000 : 120000;
  let width = 0, height = 0, lost = false;
  const size = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    const scale = Math.min(1, Math.sqrt(budget / (w * h)));
    width = Math.max(2, Math.round(w * scale));
    height = Math.max(2, Math.round(h * scale));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
    gl.uniform2f(uRes, width, height);
  };
  const draw = (time, fade) => {
    if (lost || gl.isContextLost()) return;
    gl.uniform1f(uTime, time);
    gl.uniform1f(uFade, fade);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost = true; onLost(); }, { signal: ctx.signal });
  size();
  let observer = null;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => { size(); if (ctx.reducedMotion) draw(14, 1); });
    observer.observe(host);
  }
  let stop = () => {};
  if (ctx.reducedMotion) draw(14, 1);
  else stop = ctx.loop(time => draw(time + 4, Math.min(1, time / 1.2)), { fps: 30 });
  return {
    free() {
      stop();
      observer?.disconnect();
      if (!gl.isContextLost()) {
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

// A short synthesized tape sting: the motor spinning up, a soft clunk, hiss, and two rising notes.
function playSting(audio) {
  const now = audio.currentTime + 0.02;
  const master = audio.createGain();
  master.gain.value = 0.5;
  const limiter = audio.createDynamicsCompressor();
  master.connect(limiter).connect(audio.destination);
  const env = (node, peak, attack, release, start = now) => {
    const g = audio.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + attack + release);
    node.connect(g).connect(master);
    return g;
  };
  const motor = audio.createOscillator();
  motor.type = 'sawtooth';
  motor.frequency.setValueAtTime(55, now);
  motor.frequency.exponentialRampToValueAtTime(240, now + 0.38);
  const lowpass = audio.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 900;
  motor.connect(lowpass);
  env(lowpass, 0.12, 0.08, 0.42);
  motor.start(now);
  motor.stop(now + 0.6);

  const clunk = audio.createOscillator();
  clunk.type = 'sine';
  clunk.frequency.setValueAtTime(120, now);
  clunk.frequency.exponentialRampToValueAtTime(42, now + 0.2);
  env(clunk, 0.32, 0.005, 0.22);
  clunk.start(now);
  clunk.stop(now + 0.3);

  const length = Math.floor(audio.sampleRate * 0.8);
  const noise = audio.createBuffer(1, length, audio.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  const hiss = audio.createBufferSource();
  hiss.buffer = noise;
  const band = audio.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 3200;
  band.Q.value = 0.8;
  hiss.connect(band);
  env(band, 0.05, 0.05, 0.7);
  hiss.start(now);

  [[659.25, 0.34], [987.77, 0.46]].forEach(([frequency, at]) => {
    const tone = audio.createOscillator();
    tone.type = 'triangle';
    tone.frequency.value = frequency;
    env(tone, 0.09, 0.02, 0.5, now + at);
    tone.start(now + at);
    tone.stop(now + at + 0.6);
  });
}

// Settles the wordmark letter by letter from random glyphs.
function scramble(ctx, node, text, after) {
  const chars = [...text];
  const settleAt = chars.map((_, i) => 0.25 + i * Math.min(0.07, 1 / Math.max(chars.length, 1)));
  const show = value => { node.textContent = value; node.parentElement?.setAttribute('data-text', value); };
  if (ctx.reducedMotion) { show(text); after(); return; }
  ctx.loop(time => {
    let done = true;
    const out = chars.map((char, i) => {
      if (char === ' ' || time >= settleAt[i]) return char;
      done = false;
      return time < settleAt[i] - 0.9 ? ' ' : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    }).join('');
    show(out);
    if (done) { after(); return false; }
    return true;
  }, { fps: 20 });
}

export function mount(host, ctx) {
  const { h } = ctx;
  host.style.setProperty('--et-accent', ctx.accent);
  host.style.setProperty('--et-ink', ctx.accentInk);
  const title = ctx.title.toUpperCase();
  const canvas = h('canvas', { class: 'et-smoke', 'aria-hidden': 'true' });
  const cssSmoke = h('div', { class: 'et-smoke-css', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
  const wordText = h('span', { class: 'et-word-text', 'aria-hidden': 'true' }, ctx.reducedMotion ? title : '');
  const word = h('h1', { class: 'et-word', 'aria-label': ctx.title, 'data-text': ctx.reducedMotion ? title : '' }, wordText);
  const side = ['Side A:', ctx.title, ctx.number].join(' ') + (ctx.subtitle ? ` · ${ctx.subtitle}` : '');
  const enter = h('button', {
    class: 'et-enter', type: 'button', 'data-kt-enter': true,
    onclick: () => {
      const audio = ctx.sound.context();
      if (audio) try { playSting(audio); } catch {}
      ctx.onEnter();
    },
  }, h('span', { 'aria-hidden': 'true' }, '> '), ctx.enterLabel || 'Enter_the_tube', h('span', { 'aria-hidden': 'true' }, ' <'));
  const root = h('div', { class: 'et-root' },
    canvas, cssSmoke,
    h('div', { class: 'et-headbar', 'aria-hidden': 'true' }),
    h('div', { class: 'et-scan', 'aria-hidden': 'true' }),
    h('div', { class: 'et-topline', 'aria-hidden': 'true' }),
    h('p', { class: 'et-osd', 'aria-hidden': 'true' }, '▶ PLAY'),
    h('main', { class: 'et-stage' },
      h('p', { class: 'et-kicker', text: ctx.kicker || 'You are now entering' }),
      word,
      h('p', { class: 'et-side' }, h('span', { 'aria-hidden': 'true' }, '> '), side, h('span', { 'aria-hidden': 'true' }, ' <')),
      enter),
    h('p', { class: 'et-corner et-corner-l', 'aria-hidden': 'true' }, h('span', { class: 'et-rec' }, '■'), ' S-VHS ET'),
    h('p', { class: 'et-corner et-corner-r', 'aria-hidden': 'true' }, `TAPE ${ctx.number} · SP`));
  host.replaceChildren(root);

  let smoke = null;
  const useCss = () => { smoke?.free(); smoke = null; root.classList.add('et-no-gl'); };
  smoke = startSmoke(canvas, host, ctx, useCss);
  if (!smoke) useCss();

  scramble(ctx, wordText, title, () => root.classList.add('et-settled'));
  if (!ctx.preview) {
    document.addEventListener('keydown', event => { if (event.key === 'Escape') ctx.onSkip(); }, { signal: ctx.signal });
  }
  ctx.signal.addEventListener('abort', () => { smoke?.free(); smoke = null; }, { once: true });

  return {
    async dismiss() {
      root.classList.add('et-leaving');
      await wait(ctx.reducedMotion ? 0 : 420);
      smoke?.free();
      smoke = null;
    },
  };
}

// The VHS pause screen over a paused feed video: static, rolling bands, the OSD and an ember play
// square. The host does not take pointer events, so a tap still reaches the feed's play button.
export function pause(host, ctx) {
  const { h } = ctx;
  host.style.setProperty('--et-accent', ctx.accent);
  host.style.setProperty('--et-ink', ctx.accentInk);
  const canvas = h('canvas', { class: 'et-static', width: 160, height: 90 });
  const time = h('p', { class: 'et-pause-time' }, '00:00');
  const root = h('div', { class: 'et-pause' },
    canvas,
    h('div', { class: 'et-bands' }, h('i'), h('i')),
    h('p', { class: 'et-pause-osd' }, h('span', { class: 'et-pause-mark' }, '■'), ' PAUSED'),
    time,
    h('p', { class: 'et-pause-label', text: `${ctx.slug.toUpperCase()}-T-${ctx.number}` }),
    h('div', { class: 'et-play' }, h('i')));
  host.replaceChildren(root);
  const paint = canvas.getContext('2d');
  const image = paint ? paint.createImageData(160, 90) : null;
  const frame = () => {
    if (!image) return;
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const v = Math.random() * 255;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
    paint.putImageData(image, 0, 0);
  };
  let stop = null;
  return {
    show(seconds = 0, total = 0) {
      time.textContent = total > 0 ? `${mmss(seconds)} / ${mmss(total)}` : mmss(seconds);
      root.classList.add('et-on');
      frame();
      if (!ctx.reducedMotion && !stop) stop = ctx.loop(() => frame(), { fps: 12 });
    },
    hide() {
      root.classList.remove('et-on');
      stop?.();
      stop = null;
    },
    destroy() {
      stop?.();
      stop = null;
      host.replaceChildren();
    },
  };
}
