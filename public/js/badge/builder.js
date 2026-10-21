// The badge builder: a self-contained component any page can mount (the setup wizard, the parent
// dashboard, the preview playground). It edits a spec, shows the live badge drawn by the same renderer
// the server uses, and reports every change through onChange. It never saves; see save.js for that.
//
//   const builder = createBadgeBuilder(host, { spec, onChange(spec) {}, names: ['MILO'] });
//   await builder.ready; builder.getSpec(); builder.getSvg(); builder.setSpec(spec); builder.destroy();
import { CHALK, DEFAULT_SPEC, EFFECTS, FONTS, INK, MAX_STICKERS, MAX_TEXT, PALETTE, SHAPES, STICKER_RANGE, STICKER_SPOTS,
  TEXT_COLORS, allowedChar, normalizeSpec } from './spec.js';
import { badgeLabel, renderBadge, textPath } from './render.js';
import { createBadgeData } from './data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TILT = -8 * Math.PI / 180;
let ids = 0;

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter(child => child !== null && child !== undefined && child !== false));
  return node;
}

function svgNode(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined) node.setAttribute(key, value);
  return node;
}

function stickerIcon(art) {
  const icon = svgNode('svg', { viewBox: art.viewBox, 'aria-hidden': 'true', focusable: 'false', class: 'kb-sticker-art' });
  for (const path of art.paths) icon.append(svgNode('path', { d: path.d, fill: path.fill, 'fill-rule': path.rule }));
  return icon;
}

function ensureStylesheet() {
  const href = new URL('./builder.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href.split('?')[0] === href)) return;
  document.head.append(h('link', { rel: 'stylesheet', href }));
}

const pick = list => list[Math.floor(Math.random() * list.length)];
const clone = value => JSON.parse(JSON.stringify(value));

// Kids type names in capitals on the board; a letter with no single capital in Latin-1 stays as typed.
function cleanName(value, uppercase) {
  let out = '', dropped = false;
  for (const char of value) {
    const up = uppercase ? char.toUpperCase() : char;
    const next = up.length === 1 && allowedChar(up.charCodeAt(0)) ? up : char;
    if (next.length === 1 && allowedChar(next.charCodeAt(0))) out += next; else dropped = true;
  }
  if ([...out].length > MAX_TEXT) { out = [...out].slice(0, MAX_TEXT).join(''); }
  return { value: out, dropped };
}

export function createBadgeBuilder(host, options = {}) {
  const { onChange = () => {}, assetBase = '/badge/', names = [], uppercase = true, stylesheet = true,
    note = 'Saves as a logo and home-screen icons', label = 'Badge builder' } = options;
  if (stylesheet) ensureStylesheet();
  const data = createBadgeData(assetBase);
  const uid = `kb${++ids}`;
  let spec = normalizeSpec({ ...clone(DEFAULT_SPEC), ...(options.spec || {}) });
  let selected = 0;
  let svgText = '';
  let destroyed = false;
  let renderToken = 0;
  const controls = { shape: [], bg: [], color: [], font: [], effect: [], sticker: new Map() };

  /* ---------- preview ---------- */
  const preview = h('div', { class: 'kb-preview', 'data-kb-preview': '' });
  const live = h('p', { class: 'kb-visually-hidden', 'aria-live': 'polite' });
  const shuffleButton = h('button', { type: 'button', class: 'kb-shuffle', onclick: () => shuffle() },
    h('span', { 'aria-hidden': 'true' }, '> '), 'Shuffle', h('span', { 'aria-hidden': 'true' }, ' <'));
  const stage = h('div', { class: 'kb-stage' },
    h('span', { class: 'kb-eyebrow', 'aria-hidden': 'true' }, 'Preview'),
    preview, h('div', { class: 'kb-stage-actions' }, shuffleButton, note ? h('span', { class: 'kb-note' }, note) : null), live);

  /* ---------- controls ---------- */
  const nameInput = h('input', {
    id: `${uid}-name`, class: 'kb-input', type: 'text', maxlength: String(MAX_TEXT), autocomplete: 'off',
    autocapitalize: uppercase ? 'characters' : 'words', spellcheck: 'false', 'aria-describedby': `${uid}-name-hint`,
  });
  const nameHint = h('span', { id: `${uid}-name-hint`, class: 'kb-hint', role: 'status' }, `Up to ${MAX_TEXT} letters.`);
  nameInput.addEventListener('input', () => {
    const { value, dropped } = cleanName(nameInput.value, uppercase);
    if (value !== nameInput.value) {
      const caret = nameInput.selectionStart;
      nameInput.value = value;
      if (caret !== null) nameInput.setSelectionRange(Math.min(caret, value.length), Math.min(caret, value.length));
    }
    nameHint.textContent = dropped ? "Some letters can't go on a badge, so they were left out." : `Up to ${MAX_TEXT} letters.`;
    update(next => { next.text.value = value.trim(); });
  });

  const chip = (text, onclick, extra = {}) => h('button', { type: 'button', class: 'kb-chip', 'aria-pressed': 'false', onclick, ...extra }, text);
  const group = (title, body, extra = {}) => h('fieldset', { class: 'kb-group', ...extra }, h('legend', { class: 'kb-label' }, title), body);
  const swatch = (color, onclick, small) => {
    const button = h('button', { type: 'button', class: small ? 'kb-swatch kb-swatch-small' : 'kb-swatch', 'aria-pressed': 'false', 'aria-label': color.label, title: color.label, onclick });
    button.style.setProperty('--kb-swatch', color.hex);
    button.dataset.value = color.hex;
    return button;
  };

  const shapeRow = h('div', { class: 'kb-row' }, SHAPES.map(shape => {
    const button = chip(shape.label, () => update(next => { next.shape = shape.id; }));
    button.dataset.value = shape.id;
    controls.shape.push(button);
    return button;
  }));
  const bgRow = h('div', { class: 'kb-row kb-swatches' }, PALETTE.map(color => {
    const button = swatch(color, () => update(next => { next.bg = color.hex; }));
    controls.bg.push(button);
    return button;
  }));
  const colorRow = h('div', { class: 'kb-row kb-swatches' }, TEXT_COLORS.map(color => {
    const button = swatch(color, () => update(next => { next.text.color = color.hex; }), true);
    controls.color.push(button);
    return button;
  }));
  const fontRow = h('div', { class: 'kb-row' }, FONTS.map(font => {
    const button = chip(h('span', { class: 'kb-font-label' }, font.label), () => {
      update(next => { next.text.font = font.id; });
    }, { 'aria-label': font.label });
    button.dataset.value = font.id;
    if (font.id === 'system') button.classList.add('kb-font-system');
    controls.font.push(button);
    return button;
  }));
  const effectRow = h('div', { class: 'kb-row' }, EFFECTS.map(effect => {
    const button = chip(effect.label, () => update(next => { next.effects[effect.id] = !next.effects[effect.id]; }));
    button.dataset.value = effect.id;
    controls.effect.push(button);
    return button;
  }));

  // Stickers: one tab stop for the whole grid, arrow keys move between stickers.
  const stickerCount = h('span', { class: 'kb-count' });
  const stickerGrid = h('div', { class: 'kb-sticker-grid', role: 'group', 'aria-label': 'Sticker choices' });
  stickerGrid.addEventListener('keydown', event => {
    const buttons = [...stickerGrid.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    const columns = Math.max(1, Math.round(stickerGrid.clientWidth / (buttons[0].offsetWidth || 48)));
    const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns, Home: -index, End: buttons.length - 1 - index };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const target = buttons[Math.max(0, Math.min(buttons.length - 1, index + moves[event.key]))];
    for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
    target.focus();
  });

  const placedRow = h('div', { class: 'kb-row kb-placed', role: 'group', 'aria-label': 'Stickers on the badge' });
  const slider = (key, text, [min, max], step) => {
    const input = h('input', { type: 'range', class: 'kb-range', min: String(min), max: String(max), step: String(step), id: `${uid}-${key}` });
    input.addEventListener('input', () => update(next => {
      const placed = next.stickers[selected];
      if (placed) placed[key] = Number(input.value);
    }, { quiet: true }));
    return { input, field: h('label', { class: 'kb-slider', for: `${uid}-${key}` }, h('span', { class: 'kb-slider-label' }, text), input) };
  };
  const sliders = {
    scale: slider('scale', 'Size', STICKER_RANGE.scale, 0.05),
    rotate: slider('rotate', 'Turn', STICKER_RANGE.rotate, 1),
    x: slider('x', 'Left / right', STICKER_RANGE.x, 1),
    y: slider('y', 'Up / down', STICKER_RANGE.y, 1),
  };
  const removeButton = h('button', { type: 'button', class: 'kb-chip kb-remove', onclick: () => removeSticker(selected) }, 'Remove sticker');
  const placedEditor = h('div', { class: 'kb-placed-editor' },
    h('p', { class: 'kb-hint' }, 'Drag a sticker on the badge, or use the sliders.'),
    h('div', { class: 'kb-sliders' }, Object.values(sliders).map(item => item.field)), removeButton);

  const controlsColumn = h('div', { class: 'kb-controls' },
    h('div', { class: 'kb-group' }, h('label', { class: 'kb-label', for: nameInput.id }, 'Name or initials'), nameInput, nameHint),
    group('Shape', shapeRow),
    group('Color', bgRow),
    group('Letters', colorRow),
    group('Font', fontRow),
    group(h('span', {}, 'Stickers ', stickerCount), h('div', {}, stickerGrid, placedRow, placedEditor)),
    group('Effects', effectRow));

  const root = h('section', { class: 'kb', 'aria-label': label }, h('div', { class: 'kb-layout' }, stage, controlsColumn));
  host.replaceChildren(root);

  /* ---------- state ---------- */
  function update(change, { quiet = false } = {}) {
    const next = clone(spec);
    change(next);
    spec = normalizeSpec(next, { stickerIds: data.stickers ? new Set(Object.keys(data.stickers)) : undefined });
    sync();
    render();
    if (!quiet) live.textContent = '';
    onChange(clone(spec));
  }

  function press(buttons, value) {
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.value === value));
  }

  function sync() {
    if (document.activeElement !== nameInput) nameInput.value = spec.text.value;
    press(controls.shape, spec.shape);
    press(controls.bg, spec.bg);
    press(controls.color, spec.text.color);
    press(controls.font, spec.text.font);
    for (const button of controls.effect) button.setAttribute('aria-pressed', String(Boolean(spec.effects[button.dataset.value])));
    const onBadge = new Set(spec.stickers.map(item => item.id));
    for (const [id, button] of controls.sticker) button.setAttribute('aria-pressed', String(onBadge.has(id)));
    stickerCount.textContent = `${spec.stickers.length} of ${MAX_STICKERS}`;
    selected = Math.min(selected, Math.max(0, spec.stickers.length - 1));
    placedRow.replaceChildren(...spec.stickers.map((placed, index) => {
      const art = data.stickers?.[placed.id];
      const entry = data.catalog?.stickers.find(item => item.id === placed.id);
      const name = entry?.label || placed.id;
      const button = h('button', { type: 'button', class: 'kb-chip kb-placed-chip', 'aria-pressed': String(index === selected),
        'aria-label': `Edit ${name}`, onclick: () => { selected = index; sync(); } }, art ? stickerIcon(art) : null, name);
      return button;
    }));
    placedEditor.hidden = spec.stickers.length === 0;
    const current = spec.stickers[selected];
    if (current) {
      for (const [key, { input }] of Object.entries(sliders)) {
        input.value = String(current[key]);
        input.setAttribute('aria-valuetext', key === 'rotate' ? `${current[key]} degrees` : key === 'scale' ? `${Math.round(current[key] * 100)} percent` : String(current[key]));
      }
      removeButton.textContent = `Remove ${data.catalog?.stickers.find(item => item.id === current.id)?.label || 'sticker'}`;
    }
    stage.style.setProperty('--kb-glow', spec.bg);
  }

  async function render() {
    if (!data.stickers) return;
    const token = ++renderToken;
    const font = spec.text.font;
    if (!data.glyphs[font] && FONTS.find(item => item.id === font)?.file) {
      preview.setAttribute('aria-busy', 'true');
      try { await data.loadFont(font); } catch (error) { console.error(error); return; }
      if (token !== renderToken || destroyed) return;
    }
    preview.removeAttribute('aria-busy');
    svgText = renderBadge(spec, { glyphs: data.glyphs, stickers: data.stickers });
    // Our own renderer's output: whitelisted elements only, so parsing it as SVG is safe.
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    preview.replaceChildren(document.importNode(doc.documentElement, true));
  }

  function toggleSticker(id) {
    const at = spec.stickers.findIndex(item => item.id === id);
    if (at >= 0) return removeSticker(at);
    update(next => {
      if (next.stickers.length >= MAX_STICKERS) {
        // Full: the new sticker takes the selected one's place.
        next.stickers[selected] = { ...next.stickers[selected], id };
      } else {
        const free = STICKER_SPOTS.find(spot => !next.stickers.some(item => Math.abs(item.x - spot.x) < 20 && Math.abs(item.y - spot.y) < 20)) || STICKER_SPOTS[0];
        next.stickers.push({ id, x: free.x, y: free.y, scale: 1, rotate: 0 });
        selected = next.stickers.length - 1;
      }
    });
  }

  function removeSticker(index) {
    update(next => { next.stickers.splice(index, 1); });
    selected = Math.max(0, Math.min(selected, spec.stickers.length - 1));
    sync();
  }

  function shuffle() {
    const bg = pick(PALETTE).hex;
    const dark = ['#FF5C2B', '#A98BFF', '#4DB8FF'].includes(bg);
    const font = pick(FONTS.filter(item => item.file)).id;
    const ids = data.catalog ? data.catalog.stickers.map(item => item.id) : [];
    update(next => {
      next.shape = pick(SHAPES).id;
      next.bg = bg;
      next.text.color = dark && Math.random() < 0.4 ? CHALK : INK;
      next.text.font = font;
      if (!next.text.value && names.length) next.text.value = cleanName(pick(names), uppercase).value;
      const count = Math.max(1, next.stickers.length);
      next.stickers = ids.length ? Array.from({ length: count }, (_, index) => ({
        id: pick(ids), ...STICKER_SPOTS[index], scale: 1, rotate: Math.round(Math.random() * 30 - 15),
      })) : [];
      next.effects = { rgbSplit: Math.random() < 0.5, outline: Math.random() < 0.6, tilt: Math.random() < 0.3, shadow: Math.random() < 0.4 };
    });
    live.textContent = `Shuffled: ${badgeLabel(spec)}.`;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      preview.classList.remove('kb-pop');
      void preview.offsetWidth;
      preview.classList.add('kb-pop');
    }
  }

  /* ---------- dragging stickers on the preview ---------- */
  let drag = null;
  function canvasPoint(event) {
    const box = preview.getBoundingClientRect();
    let x = (event.clientX - box.left) / box.width * 200, y = (event.clientY - box.top) / box.height * 200;
    if (spec.effects.tilt) {
      // Undo the badge's tilt so the sticker follows the finger.
      const dx = x - 100, dy = y - 100;
      x = 100 + dx * Math.cos(-TILT) - dy * Math.sin(-TILT);
      y = 100 + dx * Math.sin(-TILT) + dy * Math.cos(-TILT);
    }
    return { x, y };
  }
  preview.addEventListener('pointerdown', event => {
    if (!spec.stickers.length) return;
    const point = canvasPoint(event);
    let best = -1, bestDistance = Infinity;
    spec.stickers.forEach((placed, index) => {
      const distance = Math.hypot(placed.x - point.x, placed.y - point.y);
      if (distance < 32 * placed.scale + 12 && distance < bestDistance) { best = index; bestDistance = distance; }
    });
    if (best < 0) return;
    event.preventDefault();
    selected = best;
    const placed = spec.stickers[best];
    drag = { id: event.pointerId, dx: placed.x - point.x, dy: placed.y - point.y };
    preview.setPointerCapture(event.pointerId);
    preview.classList.add('kb-dragging');
    sync();
  });
  preview.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const point = canvasPoint(event);
    update(next => {
      const placed = next.stickers[selected];
      if (!placed) return;
      placed.x = Math.round(point.x + drag.dx);
      placed.y = Math.round(point.y + drag.dy);
    }, { quiet: true });
  });
  const endDrag = event => {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null;
    preview.classList.remove('kb-dragging');
  };
  preview.addEventListener('pointerup', endDrag);
  preview.addEventListener('pointercancel', endDrag);

  /* ---------- start ---------- */
  sync();
  const ready = (async () => {
    const catalog = await data.loadStickers();
    if (destroyed) return;
    stickerGrid.replaceChildren(...catalog.stickers.map((sticker, index) => {
      const button = h('button', { type: 'button', class: 'kb-sticker', 'aria-pressed': 'false', 'aria-label': sticker.label,
        title: sticker.label, tabindex: index === 0 ? '0' : '-1', onclick: () => toggleSticker(sticker.id) }, stickerIcon(sticker));
      controls.sticker.set(sticker.id, button);
      return button;
    }));
    spec = normalizeSpec(spec, { stickerIds: new Set(catalog.stickers.map(item => item.id)) });
    sync();
    await render();
    // Font chips show their own letters once each table arrives; the preview never waits on these.
    for (const font of FONTS.filter(item => item.file)) {
      data.loadFont(font.id).then(table => {
        if (destroyed || !table) return;
        const button = controls.font.find(item => item.dataset.value === font.id);
        const { d, width } = textPath(font.label, table);
        const cap = table.capHeight;
        const art = svgNode('svg', { viewBox: `0 ${-Math.round(cap * 1.15)} ${Math.ceil(width)} ${Math.round(cap * 1.35)}`, 'aria-hidden': 'true', focusable: 'false', class: 'kb-font-art' });
        art.append(svgNode('path', { d, transform: 'scale(1 -1)', fill: 'currentColor' }));
        button.querySelector('.kb-font-label').replaceChildren(art);
      }).catch(() => {});
    }
  })();

  return {
    ready,
    getSpec: () => clone(spec),
    getSvg: () => svgText,
    setSpec(next) {
      spec = normalizeSpec(next, { stickerIds: data.stickers ? new Set(Object.keys(data.stickers)) : undefined });
      selected = 0;
      nameInput.value = spec.text.value;
      sync();
      return render();
    },
    shuffle,
    destroy() { destroyed = true; root.remove(); },
  };
}
