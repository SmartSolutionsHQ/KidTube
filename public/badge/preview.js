// Standalone playground for the badge builder: build, shuffle, load the board's examples, and save
// to this server to check that the SVG it draws is byte-for-byte the preview.
import { createBadgeBuilder } from '/js/badge/builder.js';
import { createBadgeData } from '/js/badge/data.js';
import { renderBadge } from '/js/badge/render.js';
import { ICONS, removeChannelImage, saveChannelBadge, saveFamilyBadge, uploadChannelImage } from '/js/badge/save.js';
import { accountSession } from '/js/shell/auth-dialog.js';

// The design board's twelve examples, with invented names.
const EXAMPLES = [
  { text: 'MILO', shape: 'circle', bg: '#FF5C2B', font: 'anton', sticker: 'bolt', rgbSplit: true, outline: true },
  { text: 'JUNI', shape: 'hexagon', bg: '#A98BFF', font: 'anton', sticker: 'star' },
  { text: 'DAX', shape: 'shield', bg: '#C6FF3D', font: 'creepster', sticker: 'ghost', rgbSplit: true, tilt: true },
  { text: 'RUBY', shape: 'star', bg: '#FF6FB5', font: 'bangers', sticker: 'crown', outline: true },
  { text: 'PIP', shape: 'tv', bg: '#3DFFB0', font: 'pixel', shadow: true },
  { text: 'THEO', shape: 'burst', bg: '#FFD23F', font: 'bangers', sticker: 'flame', outline: true, tilt: true },
  { text: 'NOVA', shape: 'blob', bg: '#4DB8FF', font: 'anton', sticker: 'planet', rgbSplit: true },
  { text: 'KAI', shape: 'ticket', bg: '#F7F4EC', font: 'anton', sticker: 'rocket', rgbSplit: true },
  { text: 'BEA', shape: 'circle', bg: '#FF6FB5', font: 'creepster', sticker: 'heart', outline: true },
  { text: 'OZ', shape: 'rounded', bg: '#FFD23F', font: 'pixel', sticker: 'game', tilt: true, shadow: true },
  { text: 'LUNA', shape: 'blob', bg: '#A98BFF', font: 'bangers', sticker: 'moon' },
  { text: 'ZO', shape: 'shield', bg: '#FF5C2B', font: 'anton', sticker: 'unicorn', rgbSplit: true, outline: true },
].map(example => ({
  v: 1, shape: example.shape, bg: example.bg,
  text: { value: example.text, font: example.font, color: '#0B0C10' },
  stickers: example.sticker ? [{ id: example.sticker, x: 154, y: 46, scale: 1, rotate: 10 }] : [],
  effects: { rgbSplit: Boolean(example.rgbSplit), outline: Boolean(example.outline), tilt: Boolean(example.tilt), shadow: Boolean(example.shadow) },
}));

const $ = id => document.getElementById(id);
const specOut = $('pg-spec');
const result = $('pg-result');
const builder = createBadgeBuilder($('builder'), {
  spec: EXAMPLES[0],
  names: EXAMPLES.map(example => example.text.value),
  onChange: spec => { specOut.textContent = JSON.stringify(spec, null, 2); result.textContent = ''; },
});
specOut.textContent = JSON.stringify(builder.getSpec(), null, 2);

// Examples are drawn by the same renderer, once their fonts arrive.
const data = createBadgeData('/badge/');
const gallery = $('pg-examples');
for (const spec of EXAMPLES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pg-example';
  button.setAttribute('aria-label', `Load the ${spec.text.value} example`);
  const caption = document.createElement('span');
  caption.textContent = spec.text.value;
  button.append(caption);
  button.addEventListener('click', () => { builder.setSpec(spec); $('builder').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  gallery.append(button);
  data.forSpec(spec).then(loaded => {
    const svg = new DOMParser().parseFromString(renderBadge(spec, loaded), 'image/svg+xml').documentElement;
    svg.setAttribute('aria-hidden', 'true');
    button.prepend(document.importNode(svg, true));
  }).catch(error => console.error(error));
}

/* ---------- saving to this server ---------- */
const session = accountSession();
if (session) $('pg-session').textContent = `Signed in as ${session.email}. Saving sends only the choices; the server draws the SVG and this page compares it with the preview.`;
else for (const id of ['pg-save-channel', 'pg-save-family', 'pg-picture', 'pg-remove-picture']) $(id).disabled = true;

function report(serverSvg) {
  const same = serverSvg === builder.getSvg();
  result.dataset.state = same ? 'match' : 'error';
  result.textContent = same ? `Server SVG matches the preview exactly (${serverSvg.length} bytes).` : 'The server drew something different from the preview.';
  return same;
}

async function run(button, task) {
  button.disabled = true;
  result.dataset.state = '';
  result.textContent = 'Saving…';
  try { await task(); }
  catch (error) { result.dataset.state = 'error'; result.textContent = error.message; }
  finally { button.disabled = false; }
}

$('pg-save-channel').addEventListener('click', event => run(event.currentTarget, async () => {
  const saved = await saveChannelBadge($('pg-channel').value, builder.getSpec());
  // Fetch the stored file too, so the check covers what viewers will actually load.
  const stored = await (await fetch(saved.url)).text();
  if (report(saved.svg) && stored !== saved.svg) { result.dataset.state = 'error'; result.textContent = 'The stored file differs from the response.'; }
}));

$('pg-save-family').addEventListener('click', event => run(event.currentTarget, async () => {
  const saved = await saveFamilyBadge(builder.getSpec());
  report(saved.svg);
  $('pg-icons').replaceChildren(...ICONS.map(({ variant, size }) => {
    const figure = document.createElement('figure');
    const image = new Image(size, size);
    image.src = saved.icons[variant];
    image.alt = `${variant} icon`;
    const caption = document.createElement('figcaption');
    caption.textContent = `${variant} · ${size}px`;
    figure.append(image, caption);
    return figure;
  }));
}));

function showPicture(url, label) {
  const figure = document.createElement('figure');
  const image = new Image();
  image.src = url;
  image.alt = label;
  const caption = document.createElement('figcaption');
  caption.textContent = label;
  figure.append(image, caption);
  $('pg-icons').replaceChildren(figure);
}

$('pg-picture').addEventListener('change', event => {
  const [file] = event.currentTarget.files;
  if (!file) return;
  run(event.currentTarget, async () => {
    const saved = await uploadChannelImage($('pg-channel').value, file);
    result.dataset.state = 'match';
    result.textContent = `Picture saved without its metadata (${saved.width} x ${saved.height}).`;
    showPicture(saved.url, 'Channel picture');
  });
});

$('pg-remove-picture').addEventListener('click', event => run(event.currentTarget, async () => {
  await removeChannelImage($('pg-channel').value);
  result.dataset.state = '';
  result.textContent = 'Picture removed.';
  $('pg-icons').replaceChildren();
}));
