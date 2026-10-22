// Guest codes: a four-character code for one person, for every kid or just one. It works once within
// 24 hours and then gives 24 hours of watching. The new code is shown once, with a QR code that opens the
// site and a card to print.
import { el, button, primary, field, errorLine, setBusy, svg } from './dom.js';
import { agoLong, until } from './format.js';
import { encodeQr, qrPath } from './qr.js';

export function qrImage(text, label) {
  const qr = encodeQr(text);
  const span = qr.size + 8;
  return svg('svg', { class: 'kd-qr', viewBox: `0 0 ${span} ${span}`, role: 'img', 'aria-label': label, 'shape-rendering': 'crispEdges' },
    svg('rect', { width: span, height: span }), svg('path', { d: qrPath(qr) }));
}

function badgeFor(kid) {
  const box = el('span', { class: 'kd-badge-art' });
  const image = el('img', { src: kid?.logoUrl || '/brand/family.svg', alt: '', width: 72, height: 72 });
  image.addEventListener('error', () => image.remove());
  box.append(image);
  return box;
}

function describe(code) {
  const scope = code.scopeName ? `${code.scopeName} only` : 'All kids';
  const made = `made ${agoLong(code.created)}${code.creatorName ? ` by ${code.creatorName}` : ''}`;
  const state = {
    waiting: `Not used yet. Works until ${until(code.expires)}.`,
    active: `In use. Watching ends ${until(code.sessionExpires)}.${code.lastUsed ? ` Last used ${agoLong(code.lastUsed)}.` : ''}`,
    ended: `Ended${code.lastUsed ? `. Last used ${agoLong(code.lastUsed)}` : ''}.`,
    expired: 'Never used. It has run out.',
  }[code.state];
  return { title: code.note ? `For ${code.note}` : 'Guest code', line: `${scope} · ${made}`, state };
}

export async function render(main, ctx) {
  const data = await ctx.api.get('/api/admin/guests');
  const site = ctx.family.siteUrl || location.origin;
  const printable = el('div', { class: 'kd-printable kd-section' });
  const list = el('div', { class: 'kd-section' });

  const note = el('input', { class: 'kp-input', type: 'text', maxlength: '40', autocomplete: 'off', placeholder: 'Grandpa Joe' });
  const kid = el('select', { class: 'kp-input kd-select' }, el('option', { value: '' }, 'All kids'),
    ...ctx.kids.map(entry => el('option', { value: entry.slug }, `${entry.name} only`)));
  const error = errorLine('kd-guest-error');
  const make = primary('Make a code');
  const form = el('form', { class: 'kd-upload', novalidate: true },
    el('h2', { class: 'kp-heading' }, 'New guest code'),
    el('div', { class: 'kp-grid-2' }, field('Who is it for?', note, 'Only you see this. Optional.'), field('Which kids can they watch?', kid)),
    error, el('div', {}, make));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    const done = setBusy(make, 'Making');
    try {
      const made = await ctx.api.post('/api/admin/guests', { note: note.value.trim(), channel: kid.value });
      done();
      showCode(made);
      form.reset();
      await loadList();
    } catch (problem) { done(); error.textContent = problem.message; }
  });

  function showCode(made) {
    const entry = ctx.kids.find(k => k.slug === made.scope);
    const who = entry ? entry.name : ctx.family.name || 'the family';
    const copy = button('Copy code', async () => {
      try { await navigator.clipboard.writeText(made.code); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select the code to copy it'; }
    });
    const print = button('Print a card', () => {
      document.body.classList.add('kd-printing');
      addEventListener('afterprint', () => document.body.classList.remove('kd-printing'), { once: true });
      print.blur();
      window.print();
    });
    const heading = el('h2', { tabindex: '-1' }, made.note ? `Code for ${made.note}` : 'Your new guest code');
    printable.replaceChildren(
      heading,
      el('div', { class: 'kd-new-code kd-upload' },
        el('div', { class: 'kp-stack-tight' },
          el('p', { class: 'kd-code', 'aria-label': `Code ${made.code.split('').join(' ')}` }, made.code),
          el('p', { class: 'kp-small' }, `${entry ? `${entry.name} only` : 'All kids'}. Type it once by ${until(made.expires)}; then they can watch for 24 hours. Shown only now.`),
          el('div', { class: 'kd-buttons' }, copy, print)),
        qrImage(site, `QR code that opens ${site}`)),
      el('div', { class: 'kd-print-card' },
        badgeFor(entry),
        el('div', { class: 'kp-stack-tight' }, el('strong', {}, `Watch ${who}`), el('p', { class: 'kd-code' }, made.code)),
        qrImage(site, `QR code that opens ${site}`),
        el('p', {}, `Scan or open ${site.replace(/^https?:\/\//, '')}, tap "Code" on the sign-in card and type the code. It works once, for 24 hours.`)));
    heading.focus();
    ctx.say(`New guest code ${made.code.split('').join(' ')}.`);
  }

  async function loadList() {
    const { codes } = await ctx.api.get('/api/admin/guests');
    list.replaceChildren(el('h2', {}, 'Codes from the last while'), codes.length ? el('ul', { class: 'kd-rows' }, ...codes.map(code => {
      const text = describe(code);
      const titleId = `kd-guest-${code.id}`;
      const end = ['waiting', 'active'].includes(code.state) ? button(code.state === 'active' ? 'End it now' : 'Cancel the code', async () => {
        try { await ctx.api.post('/api/admin/guests/end', { id: code.id }); ctx.say(code.state === 'active' ? 'Ended. That guest can\'t watch any more.' : 'Cancelled. The code no longer works.'); await loadList(); }
        catch (problem) { ctx.say(problem.message, 'bad'); }
      }, { 'aria-describedby': titleId }) : null;
      return el('li', { class: 'kd-item kd-item-plain', 'aria-labelledby': titleId }, el('div', { class: 'kd-item-main' },
        el('div', { class: 'kd-item-text' }, el('strong', { id: titleId }, text.title), el('span', {}, text.line)),
        el('p', { class: 'kd-item-body' }, text.state), end ? el('div', { class: 'kd-buttons' }, end) : null));
    })) : el('p', { class: 'kp-small' }, 'No guest codes yet.'));
  }

  main.replaceChildren(
    el('div', { class: 'kd-head' }, el('h1', { class: 'kp-title', tabindex: '-1' }, 'Guest codes'),
      el('p', { class: 'kp-lead' }, 'For grandparents and friends without an account. A code works once, then they can watch for 24 hours, without hearts or comments.')),
    data.enabled ? form : el('p', { class: 'kp-note kp-note-warn' }, ctx.role === 'super'
      ? el('span', {}, 'Guest codes are turned off. ', el('a', { href: '#/settings' }, 'Turn them on in Settings.'))
      : 'Guest codes are turned off. The owner can turn them on in Settings.'),
    printable, list);
  await loadList();
}
