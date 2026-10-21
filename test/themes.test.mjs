import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTRACT, FALLBACK, LAUNCH_ORDER, MAX_FOLDER_BYTES, REQUIRED_FILES, createThemes, folderBytes, validateManifest } from '../server/themes.mjs';
import { ROOT, startInstall } from './helpers.mjs';

const PUBLIC = join(ROOT, 'public');
const THEMES = join(PUBLIC, 'themes');
const ids = readdirSync(THEMES, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
const read = (id, file) => readFileSync(join(THEMES, id, file), 'utf8');
const manifest = id => JSON.parse(read(id, 'manifest.json'));
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
// Splits on commas outside parentheses, so cubic-bezier(a, b, c, d) stays in one piece.
const topLevel = value => {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')') depth--;
    else if (value[i] === ',' && depth === 0) { parts.push(value.slice(start, i)); start = i + 1; }
  }
  return [...parts, value.slice(start)].map(part => part.trim());
};
const stripJsComments = js => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// A small CSS walker: yields every qualified rule's selector list and every at-rule, with nesting.
function walkCss(css) {
  const rules = [];
  const keyframes = [];
  const animations = [];
  let i = 0;
  const source = stripComments(css);
  function block(context) {
    while (i < source.length) {
      const open = source.indexOf('{', i);
      const close = source.indexOf('}', i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }
      if (open === -1) return;
      const prelude = source.slice(i, open).trim();
      i = open + 1;
      if (prelude.startsWith('@keyframes')) {
        keyframes.push(prelude.replace('@keyframes', '').trim());
        skip();
      } else if (prelude.startsWith('@font-face')) {
        skip();
      } else if (prelude.startsWith('@media') || prelude.startsWith('@supports') || prelude.startsWith('@container')) {
        block(prelude);
      } else if (prelude.startsWith('@')) {
        rules.push({ selector: prelude, context, bad: true });
        skip();
      } else {
        const body = source.slice(i, source.indexOf('}', i));
        rules.push({ selector: prelude, context, body });
        for (const match of body.matchAll(/animation(?:-name)?\s*:\s*([^;]+)/g)) animations.push(match[1].trim());
        skip();
      }
    }
  }
  function skip() {
    let depth = 1;
    while (i < source.length && depth) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
  }
  block(null);
  return { rules, keyframes, animations };
}

test('the launch set is exactly the six first-party themes', () => {
  assert.deepEqual([...ids].sort(), [...LAUNCH_ORDER].sort());
});

for (const id of ids) {
  test(`theme ${id}`, async t => {
    const dir = join(THEMES, id);
    const data = manifest(id);

    await t.test('manifest is valid and matches its folder', () => {
      assert.deepEqual(validateManifest(data, id), []);
      assert.equal(data.contract, CONTRACT);
    });

    await t.test('required files are present and the preview is a real WebP', () => {
      for (const file of REQUIRED_FILES) assert.ok(existsSync(join(dir, file)), `${id}/${file} is missing`);
      const webp = readFileSync(join(dir, 'preview.webp'));
      assert.equal(webp.subarray(0, 4).toString('latin1'), 'RIFF');
      assert.equal(webp.subarray(8, 12).toString('latin1'), 'WEBP');
    });

    await t.test('theme-local fonts are woff2 with their OFL notice', () => {
      const fonts = join(dir, 'fonts');
      if (!existsSync(fonts)) return;
      const files = readdirSync(fonts);
      assert.ok(files.includes('OFL.txt'), `${id}/fonts needs OFL.txt`);
      assert.match(readFileSync(join(fonts, 'OFL.txt'), 'utf8'), /SIL Open Font License/);
      for (const file of files) assert.match(file, /^(OFL\.txt|[a-z0-9-]+\.woff2)$/);
      for (const file of files.filter(name => name.endsWith('.woff2'))) {
        assert.equal(readFileSync(join(fonts, file)).subarray(0, 4).toString('latin1'), 'wOF2', `${file} is not woff2`);
        assert.ok(read(id, 'splash.css').includes(`fonts/${file}`), `${file} is not used by splash.css`);
      }
    });

    await t.test(`folder stays under ${MAX_FOLDER_BYTES / 1024} KB`, () => {
      assert.ok(folderBytes(dir) <= MAX_FOLDER_BYTES, `${id} is ${folderBytes(dir)} bytes`);
    });

    await t.test('every CSS rule is scoped to the theme and keyframes carry its prefix', () => {
      const { rules, keyframes, animations } = walkCss(read(id, 'splash.css'));
      const scope = `[data-kt-theme="${id}"]`;
      assert.ok(rules.length > 0);
      for (const rule of rules) {
        assert.ok(!rule.bad, `unexpected at-rule ${rule.selector}`);
        for (const selector of rule.selector.split(',')) assert.ok(selector.trim().startsWith(scope), `unscoped selector: ${selector.trim()}`);
      }
      for (const name of keyframes) assert.ok(name.startsWith(`kt-${id}-`), `keyframes ${name} needs the kt-${id}- prefix`);
      // Every animation a rule names is one this theme defines.
      for (const value of animations) {
        if (value === 'none') continue;
        for (const name of topLevel(value).map(part => part.split(/\s+/).find(token => token.startsWith('kt-')))) {
          assert.ok(name && keyframes.includes(name), `animation "${value}" uses keyframes this theme does not define`);
        }
      }
    });

    await t.test('blinking (stepped, looping) animations stay well under 3 flashes a second', () => {
      const { animations } = walkCss(read(id, 'splash.css'));
      for (const value of animations.filter(text => /steps\(/.test(text) && /infinite/.test(text))) {
        const seconds = Number(/(\d*\.?\d+)s/.exec(value)?.[1]);
        assert.ok(seconds >= 0.67, `"${value}" cycles faster than 1.5 times a second`);
      }
    });

    await t.test('no banned APIs, network calls or absolute URLs', () => {
      const js = stripJsComments(read(id, 'splash.js'));
      const css = stripComments(read(id, 'splash.css'));
      const banned = [
        /\binnerHTML\b/, /\bouterHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /\bnew\s+Function\b/, /\bFunction\s*\(/,
        /\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /\bEventSource\b/, /sendBeacon/, /\bimport\s*\(/, /^\s*import\s/m, /importScripts/,
        /localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/, /:\/\//, /javascript:/i, /\bsetInterval\s*\(/,
      ];
      for (const pattern of banned) assert.doesNotMatch(js, pattern, `${id}/splash.js matches ${pattern}`);
      for (const pattern of [/@import/, /:\/\//, /javascript:/i, /expression\(/]) assert.doesNotMatch(css, pattern, `${id}/splash.css matches ${pattern}`);
    });

    await t.test('importing splash.js in Node has no side effects', async () => {
      const before = new Set(Object.getOwnPropertyNames(globalThis));
      const mod = await import(pathToFileURL(join(dir, 'splash.js')).href + `?probe=${Date.now()}`);
      assert.deepEqual(Object.getOwnPropertyNames(globalThis).filter(name => !before.has(name)), []);
      assert.equal(typeof mod.mount, 'function');
      assert.equal(mod.mount.length, 2);
      assert.equal(typeof mod.pause === 'function', data.accents.pause, 'pause() export must match accents.pause');
      for (const name of Object.keys(mod)) assert.ok(['mount', 'pause'].includes(name), `unexpected export ${name}`);
    });

    await t.test('honours Esc, reduced motion, the Enter marker and the sound rules', () => {
      const js = stripJsComments(read(id, 'splash.js'));
      assert.match(js, /'Escape'/);
      assert.match(js, /ctx\.onSkip\(\)/);
      assert.match(js, /ctx\.preview/, 'Esc and other page-level listeners stay off in gallery previews');
      assert.match(js, /ctx\.onEnter\(\)/);
      assert.match(js, /'data-kt-enter'/);
      assert.match(js, /ctx\.reducedMotion/);
      assert.match(js, /signal: ctx\.signal/, 'listeners are removed with the splash');
      if (data.sound) assert.match(js, /ctx\.sound\.context\(\)/);
      else assert.doesNotMatch(js, /ctx\.sound|AudioContext/);
      assert.doesNotMatch(js, /new (?:webkit)?AudioContext/, 'themes get their audio context from ctx.sound');
      if (/getContext\('webgl/.test(js)) assert.match(js, /WEBGL_lose_context'\)\?\.loseContext\(\)/);
      if (/requestAnimationFrame/.test(js)) assert.fail('themes animate through ctx.loop, which caps fps and pauses when hidden');
    });
  });
}

test('the registry lists the launch themes with versioned URLs', async t => {
  const themes = createThemes(PUBLIC);
  const list = themes.list();
  assert.deepEqual(list.map(theme => theme.id), LAUNCH_ORDER);
  for (const theme of list) {
    for (const key of ['css', 'js', 'preview']) {
      const match = /^\/themes\/([a-z0-9-]+)\/([a-z.]+)\?v=([0-9a-f]{12})$/.exec(theme[key]);
      assert.ok(match, `${theme.id} ${key} URL ${theme[key]}`);
      const hash = createHash('sha256').update(readFileSync(join(THEMES, match[1], match[2]))).digest('hex').slice(0, 12);
      assert.equal(match[3], hash, `${theme[key]} carries the file's content hash`);
    }
  }
  const fallback = list.find(theme => theme.id === FALLBACK);
  assert.equal(fallback.weight, 'light');
  assert.equal(fallback.sound, false);
  assert.deepEqual(fallback.modes.sort(), ['channel', 'gate']);
  assert.equal(list.find(theme => theme.id === 'ember-tape').weight, 'heavy');

  await t.test('GET answers JSON, other methods 405', () => {
    const response = (method) => {
      const res = { status: 0, headers: {}, body: '', writeHead(status, headers) { this.status = status; this.headers = headers; return this; }, end(body) { this.body = body || ''; } };
      themes.handle({ method }, res);
      return res;
    };
    const get = response('GET');
    assert.equal(get.status, 200);
    assert.match(get.headers['Content-Type'], /application\/json/);
    const json = JSON.parse(get.body);
    assert.equal(json.contract, CONTRACT);
    assert.equal(json.fallback, FALLBACK);
    assert.equal(json.themes.length, LAUNCH_ORDER.length);
    assert.equal(response('HEAD').body, '');
    assert.equal(response('POST').status, 405);
  });
});

test('the registry skips folders that break the contract', () => {
  const dir = mkdtempSync(join(tmpdir(), 'themes-registry-'));
  try {
    const add = (id, data, files = REQUIRED_FILES) => {
      mkdirSync(join(dir, 'themes', id), { recursive: true });
      for (const file of files) writeFileSync(join(dir, 'themes', id, file), file === 'manifest.json' ? JSON.stringify(data) : 'x');
    };
    const good = manifest('glass-gate');
    add('glass-gate', good);
    add('wrong-id', { ...good, id: 'other' });
    add('no-preview', { ...good, id: 'no-preview' }, REQUIRED_FILES.filter(file => file !== 'preview.webp'));
    add('bad-feed', { ...good, id: 'bad-feed', feed: { '--tz-flare': 'url(x)' } });
    add('Bad_Name', { ...good, id: 'Bad_Name' });
    mkdirSync(join(dir, 'themes', 'broken-json'));
    for (const file of REQUIRED_FILES) writeFileSync(join(dir, 'themes', 'broken-json', file), '{');
    assert.deepEqual(createThemes(dir).list().map(theme => theme.id), ['glass-gate']);
    assert.deepEqual(createThemes(join(dir, 'nowhere')).list(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateManifest names each problem', () => {
  const good = manifest('ember-tape');
  assert.deepEqual(validateManifest(good, 'ember-tape'), []);
  const cases = [
    [{ ...good, contract: 2 }, /contract/],
    [{ ...good, weight: 'medium' }, /weight/],
    [{ ...good, modes: [] }, /modes/],
    [{ ...good, modes: ['gate', 'gate'] }, /modes/],
    [{ ...good, defaultAccent: 'red' }, /defaultAccent/],
    [{ ...good, accents: { pause: 'yes' } }, /accents/],
    [{ ...good, feed: { '--evil': '#000000' } }, /not allowed/],
    [{ ...good, feed: { '--tz-flare': 'red;background:url(x)' } }, /must be/],
    [{ ...good, version: 'one' }, /version/],
    [{ ...good, script: 'x' }, /unknown field/],
    [{ ...good, tags: 'heavy' }, /tags/],
  ];
  for (const [data, pattern] of cases) assert.match(validateManifest(data, 'ember-tape').join('; '), pattern);
  assert.match(validateManifest(good, 'glass-gate').join('; '), /does not match folder/);
  assert.deepEqual(validateManifest(null), ['manifest must be a JSON object']);
});

test('the loader and gallery import cleanly in Node and their helpers behave', async () => {
  const before = new Set(Object.getOwnPropertyNames(globalThis));
  const loader = await import(pathToFileURL(join(PUBLIC, 'js/shell/themes.js')).href);
  await import(pathToFileURL(join(PUBLIC, 'js/shell/theme-gallery.js')).href);
  assert.deepEqual(Object.getOwnPropertyNames(globalThis).filter(name => !before.has(name)), []);

  const registry = { contract: 1, fallback: 'glass-gate', themes: createThemes(PUBLIC).list() };
  const pick = (id, opts) => { const { theme, reason } = loader.pickTheme(registry, id, opts); return [theme?.id, reason]; };
  assert.deepEqual(pick('ember-tape'), ['ember-tape', 'chosen']);
  assert.deepEqual(pick('ember-tape', { lowPower: true }), ['glass-gate', 'low-power']);
  assert.deepEqual(pick('ember-tape', { lowPower: true, force: true }), ['ember-tape', 'chosen']);
  assert.deepEqual(pick('arcade-crt', { lowPower: true }), ['arcade-crt', 'chosen'], 'light themes never fall back for low power');
  assert.deepEqual(pick('creature-feature', { mode: 'gate' }), ['glass-gate', 'mode']);
  assert.deepEqual(pick('no-such-theme'), ['glass-gate', 'missing']);
  assert.deepEqual(pick(undefined), ['glass-gate', 'default']);
  assert.equal(loader.pickTheme({ themes: [] }, 'ember-tape').theme, null);

  assert.equal(loader.splashParam('?splash=0'), '0');
  assert.equal(loader.splashParam('?a=1&splash=1'), '1');
  assert.equal(loader.splashParam('?splash=maybe'), null);
  assert.equal(loader.splashParam(''), null);

  assert.equal(loader.detectLowPower({ navigator: { deviceMemory: 2 } }), true);
  assert.equal(loader.detectLowPower({ navigator: { deviceMemory: 8 } }), false);
  assert.equal(loader.detectLowPower({ navigator: { connection: { saveData: true } } }), true);
  assert.equal(loader.detectLowPower({ navigator: {} }), false, 'Safari reports no deviceMemory');
  assert.equal(loader.detectLowPower({ navigator: {}, reducedMotion: true }), true);

  assert.equal(loader.cleanAccent('#ff5c2b'), '#FF5C2B');
  assert.equal(loader.cleanAccent('red'), loader.DEFAULT_ACCENT);
  assert.equal(loader.cleanAccent('#12345'), loader.DEFAULT_ACCENT);
  assert.equal(loader.accentInk('#FF5C2B'), '#0B0C10');
  assert.equal(loader.accentInk('#C6FF3D'), '#0B0C10');
  assert.equal(loader.accentInk('#1A237E'), '#F7F4EC');
  assert.equal(loader.pad2(3), '03');
  assert.equal(loader.pad2('12'), '12');
  assert.equal(loader.pad2('x'), '01');

  const ember = registry.themes.find(theme => theme.id === 'ember-tape');
  assert.deepEqual(loader.feedVars(ember, '#3dffb0')['--tz-flare'], '#3DFFB0');
  assert.equal(loader.feedVars(ember, 'nonsense')['--tz-flare'], ember.defaultAccent);

  const store = new Map();
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) };
  assert.equal(loader.alwaysEnter('milo', undefined, storage), false);
  assert.equal(loader.alwaysEnter('milo', true, storage), true);
  assert.equal(loader.alwaysEnter('milo', undefined, storage), true);
  assert.equal(loader.alwaysEnter('juni', undefined, storage), false, 'remembered per channel');
  loader.alwaysEnter('milo', false, storage);
  assert.equal(loader.alwaysEnter('milo', undefined, storage), false);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(loader.alwaysEnter('milo', undefined, blocked), false);
  assert.equal(loader.alwaysEnter('milo', true, blocked), false);
  store.set('kt-always-enter', '{not json');
  assert.equal(loader.alwaysEnter('milo', undefined, storage), false);
  assert.equal(loader.alwaysEnter('milo', undefined, null), false);
});

test('GET /api/themes on a running install, with immutable theme assets', async t => {
  const install = await startInstall(t);
  const response = await install.call('/api/themes');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  const json = await response.json();
  assert.equal(json.contract, CONTRACT);
  assert.equal(json.fallback, FALLBACK);
  assert.deepEqual(json.themes.map(theme => theme.id), LAUNCH_ORDER);
  const ember = json.themes.find(theme => theme.id === 'ember-tape');
  for (const url of [ember.js, ember.css]) {
    const asset = await install.call(url);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable', `${url} matches the static server's hash`);
  }
  assert.equal((await install.call('/api/themes', { method: 'POST', body: {} })).status, 405);
  const page = await install.call('/themes/preview.html');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /src="\/themes\/preview\.js\?v=[0-9a-f]{12}"/);
});
