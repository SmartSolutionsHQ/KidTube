import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PARENT, ROOT, startInstall } from './helpers.mjs';

// The policy from docs/plan/2026-10-21-architecture-notes.md, spelled out so a change is deliberate.
const POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
  + "media-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; "
  + "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

test('no page carries its own policy or inline script', () => {
  const pages = readdirSync(join(ROOT, 'public'), { recursive: true }).filter(name => name.endsWith('.html'));
  assert.ok(pages.length >= 3);
  for (const page of pages) {
    const html = readFileSync(join(ROOT, 'public', page), 'utf8');
    assert.doesNotMatch(html, /http-equiv=["']?content-security-policy/i, page);
    for (const [tag] of html.matchAll(/<script\b[^>]*>/g)) assert.match(tag, /\ssrc="\/[^"]+"/, `${page}: ${tag} loads a file`);
    assert.doesNotMatch(html, /\son[a-z]+=/i, `${page} has no inline event handlers`);
  }
});

test('every page is served with the policy header, assets are not, and signed-out media stays locked', async t => {
  const install = await startInstall(t);
  for (const path of ['/', '/about', '/about/', '/parents', '/index.html']) {
    const response = await install.call(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('content-security-policy'), POLICY, path);
    const html = await response.text();
    assert.doesNotMatch(html, /\{\{brand\./, `${path} has every brand token filled`);
    assert.match(html, /href="\/css\/base\.css\?v=[0-9a-f]{12}"/, `${path} stylesheets are hash-stamped`);
  }
  const page = await install.call('/');
  const cached = await install.call('/', { headers: { 'if-none-match': page.headers.get('etag') } });
  assert.equal(cached.status, 304);
  assert.equal(cached.headers.get('content-security-policy'), POLICY, 'a revalidated page keeps its policy');

  const css = await install.call('/css/base.css');
  assert.equal(css.status, 200);
  assert.equal(css.headers.get('content-security-policy'), null);
  const font = await install.call('/fonts/anton/anton-400.woff2');
  assert.equal(font.headers.get('content-type'), 'font/woff2');

  for (const path of ['/api/clips', '/api/video/anything', '/api/video/anything/poster']) {
    assert.equal((await install.call(path)).status, 401, `${path} needs a sign-in`);
  }
  const { cookie } = await install.login(PARENT);
  assert.equal((await install.call('/api/clips', { cookie })).status, 200);
});
