// Theme playground: pick a theme, type a name and line, pick an accent, toggle reduced motion and
// sound, then watch it in a phone and a desktop frame, play it full screen through the real loader,
// pause a feed video to see the pause accent, or open the gallery.
import { alwaysEnter, attachPause, loadRegistry, showSplash } from '/js/shell/themes.js';
import { createFrame, createThemeGallery, previewTheme } from '/js/shell/theme-gallery.js';

const ACCENTS = [
  ['Ember', '#FF5C2B'], ['Volt', '#C6FF3D'], ['Sky', '#4DB8FF'], ['Bubblegum', '#FF6FB5'],
  ['Grape', '#A98BFF'], ['Sunny', '#FFD23F'], ['Mint', '#3DFFB0'], ['Chalk', '#F7F4EC'],
];
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const form = $('controls');
const log = $('log');

function note(text) {
  const item = document.createElement('li');
  const time = new Date().toLocaleTimeString([], { hour12: false });
  item.textContent = `${time}  ${text}`;
  log.prepend(item);
  while (log.children.length > 30) log.lastElementChild.remove();
}
document.addEventListener('tz:hold', () => note(`tz:hold  (__tzsplash ${window.__tzsplash ? 'set' : 'not set'})`));
document.addEventListener('tz:enter', () => note(`tz:enter (__tzsplash ${window.__tzsplash ? 'set' : 'not set'})`));

function readCtx() {
  const mode = form.elements.mode.value;
  return {
    themeId: $('theme').value,
    mode,
    title: $('title').value.trim() || 'Milo Tapes',
    kicker: $('kicker').value.trim(),
    subtitle: $('subtitle').value.trim(),
    number: Number($('number').value) || 1,
    accent: $('accent').value,
    logoUrl: $('logo').checked ? '/assets/logo.svg' : null,
    channel: mode === 'gate' ? '' : ($('title').value.trim() || 'milo').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    reducedMotion: $('reduced').checked,
    soundAllowed: $('sound').checked,
    lowPower: $('lowpower').checked,
    force: $('force').checked,
    brand: { name: document.title.split('·').pop().trim(), endorsement: 'by Smart Solutions' },
  };
}

function fillFromParams() {
  for (const key of ['title', 'kicker', 'subtitle', 'number']) if (params.has(key)) $(key).value = params.get(key);
  if (params.has('accent')) $('accent').value = '#' + params.get('accent').replace(/^#/, '');
  // The system setting always applies; the box only adds reduced motion on top of it.
  if (params.get('reduced') === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches) $('reduced').checked = true;
  if (params.get('sound') === '0') $('sound').checked = false;
  if (params.get('logo') === '1') $('logo').checked = true;
  if (params.get('force') === '1') $('force').checked = true;
  if (params.get('lowpower') === '1') $('lowpower').checked = true;
  if (params.get('mode') === 'gate') form.elements.mode.value = 'gate';
}

function paintSwatches() {
  const box = $('swatches');
  box.replaceChildren(...ACCENTS.map(([name, hex]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pv-swatch';
    button.style.setProperty('--sw', hex);
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-label', `${name} ${hex}`);
    button.title = name;
    button.dataset.hex = hex.toLowerCase();
    button.addEventListener('click', () => { $('accent').value = hex.toLowerCase(); changed(); });
    return button;
  }));
}
function syncSwatches() {
  for (const button of $('swatches').children) button.setAttribute('aria-checked', String(button.dataset.hex === $('accent').value.toLowerCase()));
}

let registry = null;
let frames = [];
let mounted = [];
let gallery = null;
let detachPause = null;
let token = 0;

async function renderStage() {
  const mine = ++token;
  for (const handle of mounted) handle?.destroy();
  mounted = [];
  const ctx = readCtx();
  const theme = registry.themes.find(entry => entry.id === ctx.themeId) || registry.themes[0];
  if (!theme) return;
  const handles = await Promise.all(frames.map(frame => previewTheme(frame, theme, ctx)));
  if (mine !== token) { handles.forEach(handle => handle?.destroy()); return; }
  mounted = handles;
  detachPause?.();
  detachPause = attachPause({ ...ctx, registry });
  $('always').checked = ctx.channel ? alwaysEnter(ctx.channel) : false;
  $('always').disabled = !ctx.channel;
}

let timer = 0;
function changed() {
  syncSwatches();
  clearTimeout(timer);
  timer = setTimeout(() => {
    renderStage();
    gallery?.update(readCtx());
    const url = new URL(location.href);
    url.searchParams.set('theme', $('theme').value);
    history.replaceState(null, '', url);
  }, 200);
}

// The test video is a canvas stream, so pausing it fires real media events on a real <video>.
function startTestVideo() {
  const video = $('test-video');
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 640;
  const paint = canvas.getContext('2d');
  let frame = 0;
  const draw = () => {
    frame++;
    const hue = (frame * 0.6) % 360;
    const gradient = paint.createLinearGradient(0, 0, 360, 640);
    gradient.addColorStop(0, `hsl(${hue} 60% 38%)`);
    gradient.addColorStop(1, `hsl(${(hue + 80) % 360} 55% 18%)`);
    paint.fillStyle = gradient;
    paint.fillRect(0, 0, 360, 640);
    paint.fillStyle = 'rgba(247,244,236,0.9)';
    paint.font = '600 28px system-ui, sans-serif';
    paint.textAlign = 'center';
    paint.fillText('Test clip', 180, 300);
    paint.font = '400 18px ui-monospace, monospace';
    paint.fillText(`frame ${frame}`, 180, 340);
    paint.beginPath();
    paint.arc(180 + Math.sin(frame / 20) * 110, 460, 26, 0, Math.PI * 2);
    paint.fill();
  };
  draw();
  setInterval(() => { if (!video.paused) draw(); }, 1000 / 30);
  if (canvas.captureStream) video.srcObject = canvas.captureStream(30);
  const button = $('pause-toggle');
  const label = () => { button.textContent = video.paused ? 'Play the test video' : 'Pause the test video'; };
  button.addEventListener('click', () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
  video.addEventListener('play', label);
  video.addEventListener('pause', label);
  video.addEventListener('click', () => button.click());
}

function showTab(which) {
  const gallerySide = which === 'gallery';
  $('tab-stage').setAttribute('aria-selected', String(!gallerySide));
  $('tab-gallery').setAttribute('aria-selected', String(gallerySide));
  $('stage').hidden = gallerySide;
  $('gallery').hidden = !gallerySide;
  if (gallerySide && !gallery) {
    gallery = createThemeGallery($('gallery-root'), {
      registry, ctx: readCtx(), selected: $('theme').value, live: 'always',
      onSelect: id => { $('theme').value = id; note(`picked ${id}`); changed(); },
    });
  } else if (gallerySide) gallery.select($('theme').value);
}

async function boot() {
  fillFromParams();
  paintSwatches();
  registry = await loadRegistry();
  const select = $('theme');
  select.replaceChildren(...registry.themes.map(theme => {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = `${theme.name} (${theme.weight})`;
    return option;
  }));
  if (params.has('theme') && registry.themes.some(theme => theme.id === params.get('theme'))) select.value = params.get('theme');
  if (!params.has('accent')) $('accent').value = (registry.themes.find(theme => theme.id === select.value)?.defaultAccent || '#FF5C2B').toLowerCase();
  note(`${registry.themes.length} themes from /api/themes, fallback ${registry.fallback}`);
  frames = [createFrame($('frame-phone'), { width: 390, height: 844 }), createFrame($('frame-wide'), { width: 1280, height: 800 })];
  syncSwatches();
  renderStage();
  startTestVideo();
  form.addEventListener('input', event => {
    // Switching theme starts from that theme's own accent; the swatches change it from there.
    if (event.target === select) {
      const theme = registry.themes.find(entry => entry.id === select.value);
      if (theme) $('accent').value = theme.defaultAccent.toLowerCase();
    }
    changed();
  });
  form.addEventListener('submit', event => event.preventDefault());
  $('always').addEventListener('change', () => {
    const ctx = readCtx();
    if (ctx.channel) alwaysEnter(ctx.channel, $('always').checked);
    note(`always enter ${ctx.channel}: ${$('always').checked}`);
  });
  $('tab-stage').addEventListener('click', () => showTab('stage'));
  $('tab-gallery').addEventListener('click', () => showTab('gallery'));
  $('play').addEventListener('click', async () => {
    const ctx = readCtx();
    note(`showSplash(${ctx.themeId})`);
    const result = await showSplash({ ...ctx, registry });
    note(`done: ${JSON.stringify(result)}`);
  });
  if (params.get('view') === 'gallery') showTab('gallery');
  if (params.get('play') === '1') $('play').click();
}

boot();
