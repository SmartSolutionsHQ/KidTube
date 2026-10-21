import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const PUBLIC = join(ROOT, 'public');
const read = path => readFileSync(join(PUBLIC, path), 'utf8');
const PAGES = ['index.html', 'about/index.html', 'parents/index.html'];

// Every id, class and data-* hook the page scripts look up. Renaming one breaks the feed silently.
const INDEX_HOOKS = [
  'id="tz-reel"', 'id="tzs-splash"', 'id="enter-tube"', 'id="account-dialog"', 'id="account-content"',
  'id="account-button"', 'id="tz-name"', 'id="tz-body"', 'class="tz-head"', 'class="tz-brand"', 'class="tz-mark"',
  'class="tz-word"', 'class="tz-app"', 'class="tz-glow"', 'class="tz-scrimlayer"', 'class="tz-sound"', 'class="tz-shuffle"',
  'class="tz-pos"', 'class="tz-log"', 'class="tz-post"', 'class="tz-x"', 'class="tz-exit"', 'class="tz-soundpill"',
  'data-sheet="index"', 'data-sheet="comments"', 'data-locked="1"', 'data-site="name"', 'data-site="tagline"',
  ...['pos', 'total', 'soundlabel', 'log', 'log2', 'logend', 'logend2', 'comments', 'composer', 'chars', 'live']
    .map(name => `data-bind="${name}"`),
  ...['shuffle', 'index', 'sound', 'exit', 'closesheet'].map(name => `data-act="${name}"`),
];

test('the channel page keeps every hook feed.js, entrance.js and recovery.js rely on', () => {
  const html = read('index.html');
  for (const hook of INDEX_HOOKS) assert.ok(html.includes(hook), `index.html has ${hook}`);
  for (const script of ['/js/shell/site.js', '/js/entrance.js', '/js/feed.js', '/js/recovery.js']) {
    assert.ok(html.includes(`<script type="module" src="${script}"></script>`), `index.html loads ${script}`);
  }
  // site.js must run first so the name and accent are in place before the front door unlocks.
  assert.ok(html.indexOf('/js/shell/site.js') < html.indexOf('/js/entrance.js'));
  assert.ok(read('parents/index.html').includes('id="tza-root"'));
});

test('pages are readable markup, free of builder leftovers and first-person copy', () => {
  for (const page of PAGES) {
    const html = read(page);
    const long = html.split('\n').filter(line => line.length > 200);
    assert.deepEqual(long, [], `${page} has no giant lines`);
    assert.ok(html.split('\n').length > 20, `${page} is indented markup, not one line`);
    assert.doesNotMatch(html, /data-instatic|target="_self"/, `${page} has no builder attributes`);
    assert.doesNotMatch(html, /\b(?:my|our|I'm|I am)\b/i, `${page} speaks about the family, not as one person`);
    assert.match(html, /\{\{brand\.name\}\}/, `${page} names the product through a brand token`);
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<meta name="viewport"/);
    for (const [, path] of html.matchAll(/(?:src|href)="(\/[^"?#]+)"/g)) {
      if (path === '/' || path === '/about' || path === '/parents') continue;
      assert.ok(existsSync(join(PUBLIC, path)), `${page} points at ${path}, which exists`);
    }
  }
});

test('stylesheets use the shared tokens, not the retired blueprint blues', () => {
  const files = readdirSync(PUBLIC, { recursive: true })
    .filter(name => /\.(?:css|js|html)$/.test(name) && !/^(?:themes|badge)\//.test(name) && !name.startsWith('js/badge/'));
  for (const name of files) {
    const text = read(name);
    assert.doesNotMatch(text, /#(?:3265ff|2458ff|8daaff|8ba8ff|7c9bff|648aff|547bff|1637a5|001ab4)\b/i, `${name} has no retired blue`);
    assert.doesNotMatch(text, /TanzenTube/, `${name} carries no old product name`);
  }
  const base = read('css/base.css');
  assert.match(base, /--tz-flare:\s*#FF5C2B;/, 'ember is the default accent');
  for (const token of ['--tz-void', '--tz-ink', '--tz-surface', '--tz-surface-2', '--tz-paper', '--tz-dim', '--tz-flare-ink', '--tz-cyan', '--tz-hot']) {
    assert.match(base, new RegExp(`${token}:`), `base.css defines ${token}`);
  }
  // The account card is the shell's; themes restyle it only through these variables.
  const kid = read('css/kid.css');
  for (const variable of ['bg', 'fg', 'dim', 'border', 'radius', 'shadow', 'backdrop', 'blur', 'field-bg', 'field-border', 'accent', 'accent-ink', 'font', 'heading-font']) {
    assert.match(kid, new RegExp(`var\\(--kt-auth-${variable},`), `kid.css reads --kt-auth-${variable}`);
  }
});

test('the wordmark animation respects reduced motion', () => {
  const kid = read('css/kid.css');
  const reduced = kid.slice(kid.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.tz-brand\[data-word\] \.tz-word/);
  assert.match(reduced, /animation: none/);
});

test('pages load fonts and styles only from this server', () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.ok(html.includes('href="/css/fonts.css"'), `${page} links fonts.css`);
    assert.doesNotMatch(html, /https?:\/\//, `${page} names no outside host`);
  }
  for (const name of readdirSync(join(PUBLIC, 'css'))) {
    const css = read(join('css', name));
    assert.doesNotMatch(css, /@import|url\((['"]?)https?:/, `${name} pulls nothing from outside`);
    for (const [, , path] of css.matchAll(/url\((['"]?)(\/[^'")]+)\1\)/g)) {
      assert.ok(existsSync(join(PUBLIC, path)), `${name} points at ${path}, which exists`);
    }
  }
});
