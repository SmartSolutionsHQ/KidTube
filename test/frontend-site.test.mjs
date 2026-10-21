import test from 'node:test';
import assert from 'node:assert/strict';
import { applySite, displayName, pageTitle, safeAccent, safeLogo, snapshot, WORDMARK_HOLD_MS } from '../public/js/shell/site.js';

const SITE = {
  ok: true, brand: { name: 'Brandname', endorsement: 'by Someone' }, siteName: '', tagline: 'A small tagline.',
  accent: '#3dffb0', channels: [{ slug: 'main', name: 'Main channel' }],
};

test('the page name is the family name when set, otherwise the product name', () => {
  assert.equal(displayName(SITE), 'Brandname');
  assert.equal(displayName({ ...SITE, siteName: '  The Example Tapes ' }), 'The Example Tapes');
  assert.equal(displayName(null), '');
  assert.equal(pageTitle({ name: 'The Example Tapes', tagline: 'A small tagline.' }), 'The Example Tapes — A small tagline.');
  assert.equal(pageTitle({ name: 'The Example Tapes', tagline: '' }, 'About'), 'About · The Example Tapes');
});

test('only a six-digit hex accent and a same-site badge path are accepted', () => {
  assert.equal(safeAccent('#3dffb0'), '#3DFFB0');
  for (const bad of ['red', '#fff', 'url(x)', '#12345g', '#123456;color:red', null]) assert.equal(safeAccent(bad), null, String(bad));
  assert.equal(safeLogo('/brand/milo.svg?v=abc'), '/brand/milo.svg?v=abc');
  for (const bad of ['//evil.example/x.svg', 'https://evil.example/x.svg', 'javascript:alert(1)', 'data:image/svg+xml,x', '/a/../b', null]) {
    assert.equal(safeLogo(bad), null, String(bad));
  }
});

test('the saved snapshot keeps only what the chrome needs, never the kids', () => {
  assert.deepEqual(snapshot(SITE), { siteName: 'Brandname', tagline: 'A small tagline.', accent: '#3DFFB0' });
  assert.ok(!JSON.stringify(snapshot(SITE)).includes('Main channel'));
});

test('applySite fills the name and tagline slots, the title and the accent', () => {
  const slots = { name: [{ textContent: 'x' }, { textContent: 'y' }], tagline: [{ textContent: 'z' }] };
  const properties = new Map();
  const doc = {
    title: '', body: { dataset: { title: 'Parent dashboard' } },
    documentElement: { style: { setProperty: (key, value) => properties.set(key, value) } },
    querySelectorAll: selector => slots[/data-site="(\w+)"/.exec(selector)[1]],
  };
  applySite({ ...SITE, siteName: 'The Example Tapes', accent: 'javascript:bad' }, doc);
  assert.deepEqual(slots.name.map(slot => slot.textContent), ['The Example Tapes', 'The Example Tapes']);
  assert.equal(slots.tagline[0].textContent, 'A small tagline.');
  assert.equal(doc.title, 'Parent dashboard · The Example Tapes');
  assert.equal(properties.size, 0, 'a bad accent is ignored');
  applySite(SITE, doc);
  assert.equal(properties.get('--tz-flare'), '#3DFFB0');
});

test('the channel name holds for five seconds before folding back to the mark', () => {
  assert.equal(WORDMARK_HOLD_MS, 5000);
});
