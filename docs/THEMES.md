# Splash themes

Every channel opens with a splash: the kid's name, their badge and their colour, played like the start
of a tape. A splash theme is one folder under `public/themes/`. Drop a folder in, and the next update
shows it in the gallery for every family. Only first-party themes that ship with the app are listed;
nothing is downloaded from elsewhere.

Contract version: **1**.

## Try one

Start the app and open `/themes/preview.html`. Pick a theme, type a kid's name, a kicker and a line,
pick an accent (or a badge image), and toggle reduced motion, sound, low power, forcing heavy themes and
"always enter". The page shows the theme in a phone and a desktop frame, plays it full screen through the
real loader (**Play full screen**), has a feed slide with a test video for pause accents, and opens the
gallery. The event log shows `tz:hold`, `tz:enter` and what the loader did. Use invented names only.

`npm test` runs `test/themes.test.mjs`, which checks every folder against the rules below.

## The folder

```
public/themes/arcade-crt/
  manifest.json   name, tags, weight, sound, accents
  splash.css      every rule scoped to the theme
  splash.js       export mount(), and pause() if it has one
  preview.webp    gallery thumbnail, a finished still at 390 × 844 (312 × 675 is fine)
  fonts/          optional: OFL woff2 files plus OFL.txt
```

The folder name is the theme id: lowercase words joined by hyphens. The whole folder must stay under
300 KB.

## manifest.json

```json
{
  "contract": 1,
  "id": "arcade-crt",
  "name": "Arcade",
  "description": "An 8-bit attract screen on a curved CRT.",
  "author": "Smart Solutions",
  "version": "1.0.0",
  "tags": ["light", "press start 2p", "synth blip", "pixel pause"],
  "weight": "light",
  "modes": ["gate", "channel"],
  "sound": true,
  "defaultAccent": "#3DFFB0",
  "accents": { "pause": true },
  "feed": { "--tz-flare": "accent", "--tz-ink": "#04040A" }
}
```

| Field | Meaning |
|---|---|
| `contract` | Always `1` for now. |
| `id` | Same as the folder name. |
| `name`, `description` | Shown in the gallery. Up to 40 and 200 characters. |
| `author`, `version` | Who made it, and a semver version. |
| `tags` | Up to 8 short words; the gallery shows them under the description. |
| `weight` | `light`, or `heavy` for themes that need a capable device (WebGL, big canvases). Heavy themes fall back to Glass Gate on low-power devices unless a parent forces them. |
| `modes` | `gate` (the family's front door) and/or `channel` (a kid's channel). |
| `sound` | `true` if the theme can play a sound after the Enter tap. |
| `defaultAccent` | `#rrggbb` used when a channel has no accent. |
| `accents.pause` | `true` if `splash.js` exports `pause()`. |
| `feed` | Feed variables the theme restyles. Allowed: `--tz-flare`, `--tz-paper`, `--tz-ink`, `--tz-surface`, `--tz-dim`, `--tz-rad-frame`, `--tz-rad-sheet`. Values: `#rrggbb`, a px length, or `"accent"`. |

Unknown fields make the manifest invalid, and an invalid theme is left out of the list.

## splash.js

```js
export function mount(host, ctx) {
  // build the splash inside host with ctx.h(...)
  return { dismiss(reason) { /* play the exit, resolve within 600 ms */ } };
}

// optional, when accents.pause is true
export function pause(host, ctx) {
  return { show(seconds, total) {}, hide() {}, destroy() {} };
}
```

- `mount()` builds the splash inside `host` and returns `{ dismiss(reason) }`. `dismiss` may return a
  Promise and must finish within 600 ms; the loader stops waiting at 700 ms and removes the host anyway.
  `reason` is `enter` or `skip`.
- `pause()` draws an accent over a paused feed video. The host does not take pointer events, so a tap
  still reaches the feed's own play button. `show(seconds, total)` gets the video's current time and
  duration (`total` is 0 when unknown).
- Importing the file must do nothing: no DOM access, no timers, no globals. Everything starts in
  `mount()`. Nothing else may be exported.

### ctx

| Field | Meaning |
|---|---|
| `mode` | `gate` or `channel`. |
| `title` | The channel or family name, as typed (up to 60 characters). |
| `kicker` | Optional small line above the title. Use your own default when it is empty. |
| `subtitle` | Optional line under the title. |
| `number` | The channel number as two digits, `"01"`. |
| `slug` | A short lowercase id for labels such as `MILO-TAPES-T-01`. |
| `accent`, `accentInk` | The accent as `#RRGGBB`, and the text colour that reads best on it (ink `#0B0C10` for every brand accent). |
| `logoUrl` | The kid's badge image (a same-site path, `blob:` or `data:image/…`), or `null`: then draw initials. |
| `reducedMotion` | Show a finished still frame. The system setting always wins. |
| `lowPower` | The device looks low-powered; draw less. |
| `preview` | Mounted in a small gallery frame: no page-level listeners, no focus, no sound. The host is inert. |
| `sound.allowed()`, `sound.context()` | Whether sound may play right now, and a shared `AudioContext` (or `null`). Both are false/null until the viewer presses the Enter button (`data-kt-enter`), when the parent turned splash sound off, and in previews. |
| `enterLabel` | Optional override for the Enter button's text. |
| `onEnter()`, `onSkip()` | Call these when the viewer taps Enter or presses Esc. The loader then calls `dismiss()`. |
| `brand` | `{ name, endorsement }` from the server. Never write the product name into a theme. |
| `h(tag, props, ...children)` | Builds DOM without `innerHTML`. `svg:` tags (`h('svg:path', …)`) are made in the SVG namespace. `on*` props take functions and are removed with the splash; `text` sets text, `style` takes an object (custom properties too), `dataset` an object. |
| `url(rel)` | `/themes/<id>/<rel>`, for files in the theme folder; anything resolving outside the folder gives the folder itself. CSS can use plain relative URLs instead. |
| `signal` | An `AbortSignal` that fires when the splash goes. Pass it to every listener. |
| `loop(fn, { fps })` | Calls `fn(seconds, dt)` up to `fps` times a second (never above 30; 24 in previews), only while the host is on screen and the tab is visible. Return `false` to stop. It stops by itself when the splash goes. |
| `contract`, `id` | `1`, and the theme id. |

### Host attributes set by the loader

- `data-kt-theme="<id>"` on the host. Scope every rule under it.
- `data-kt-reduced` when motion is reduced: the loader turns off every animation and transition inside.
  Design the resting style as the finished frame and animate *from* the starting state
  (`animation: … both` with a `from {}` keyframe), so turning animations off leaves the final picture.
- `data-kt-paused` while the host is off screen or the tab is hidden: CSS animations pause, `ctx.loop`
  stops, and the host gets `kt:pause` / `kt:resume` events.

Put backgrounds on your own root element, not the host: the pause accent uses the same host attribute
and must stay see-through.

## Rules

These are hard rules for a kids' product. The tests check the ones that can be checked statically.

- **Scoped CSS.** Every selector starts with `[data-kt-theme="<id>"]`; keyframes are named
  `kt-<id>-…`; no `@import`.
- **No network, no HTML strings.** No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`,
  `eval`, `new Function`, `fetch`, XHR, WebSocket, `sendBeacon`, dynamic `import()`, storage, cookies or
  absolute URLs. Animate through `ctx.loop`, not `requestAnimationFrame` or `setInterval`.
- **Inside the host.** Lay out against the host (container units such as `cqw`, `cqh`, `cqmin` work:
  the host is a size container), never the window, so gallery thumbnails look like the real thing.
- **30 fps at most**, nothing running while hidden, and WebGL contexts released with
  `WEBGL_lose_context` when the splash goes.
- **Esc skips** (`ctx.onSkip()`), except in previews.
- **At most 3 flashes a second.** Blinks run at 1 Hz or slower; no full-screen white flashes; no strobing.
- **Reduced motion** shows a finished still frame with the Enter button. Nothing loops.
- **Sound only after the Enter tap**, only when `ctx.sound.context()` returns a context, and gentle (well
  under full volume, under a second).
- **Mark the Enter button** with `data-kt-enter` so the loader can focus it. Themes never render forms;
  the sign-in dialog belongs to the shell.
- **Spooky-silly, never scary.** No jump scares, nothing that chases, no sudden loud sounds.

## Fonts

Global families come from `/css/fonts.css`: `Anton`, `Inter Tight` (400 to 700), `DM Mono` (400, 500)
and `Creepster`. Always give a fallback stack; the theme must still look acceptable without them.
Any other face ships in the theme's `fonts/` folder as woff2 under the SIL Open Font License, with
`OFL.txt` beside it, declared with `@font-face` in `splash.css` using a relative URL.

## The loader (`public/js/shell/themes.js`)

```js
import { showSplash, attachPause, alwaysEnter } from '/js/shell/themes.js';

const result = await showSplash({
  themeId: channel.themeId, mode: 'channel', title: channel.name, kicker: channel.kicker,
  subtitle: channel.tagline, number: channel.position, accent: channel.accent, logoUrl: channel.logoUrl,
  channel: channel.slug, brand: site.brand, soundAllowed: site.splashSound,
});
// result: { shown, reason: 'enter' | 'skip' | 'param' | 'always', theme, picked }

const detach = attachPause({ themeId: channel.themeId, title: channel.name, channel: channel.slug, accent: channel.accent });
alwaysEnter(channel.slug, true); // skip this channel's intro next time
```

- Fetches `/api/themes` (4 s timeout; a failure is not cached), loads the theme's CSS and module
  together, and gives up after 4 s. A theme that fails or times out is replaced by Glass Gate (from its
  known paths even when `/api/themes` failed); if that fails too, a plain built-in card still lets the
  kid in. Esc skips from the first moment, also while a theme is still loading.
- One splash at a time: calling `showSplash()` again while one is up returns the same promise.
- Heavy themes fall back to Glass Gate when `navigator.connection.saveData` is on, `deviceMemory` is
  under 4, or motion is reduced, unless `force: true`.
- `window.__tzsplash` is set from the call until the splash is gone (recovery.js checks it).
  `tz:hold` fires when the splash starts and `tz:enter` when it is gone, also when it is skipped.
- `?splash=0` skips the intro; `?splash=1` shows it even when "always enter" is remembered. The
  always-enter choice is kept per channel in `localStorage` (`kt-always-enter`), and a blocked storage
  just means the intro shows.
- The full-screen host is `#tzs-splash`, a modal dialog labelled with the channel name, and focus
  returns where it was afterwards.
- `attachPause()` listens for `pause` and `play` in the capture phase on the document and draws the
  theme's pause accent inside the paused `.tz-slide video`'s parent, so `feed.js` needs no changes.
- Other exports: `loadRegistry`, `loadTheme`, `mountTheme(host, theme, opts)`, `pickTheme`,
  `feedVars(theme, accent)`, `splashParam`, `detectLowPower`, `accentInk`, `cleanAccent`.

## The gallery (`public/js/shell/theme-gallery.js`)

```js
import { createThemeGallery } from '/js/shell/theme-gallery.js';
const gallery = createThemeGallery(element, {
  ctx: { title: 'Milo Tapes', subtitle: 'The big build', accent: '#FF5C2B' },
  selected: 'ember-tape', mode: 'channel', onSelect: id => save(id),
});
gallery.update({ title: 'Milo' });   // re-renders the previews (debounced)
gallery.destroy();
```

Each theme is mounted live in a phone-sized frame (390 × 844, scaled to the card) with `ctx.preview`
set. Frames mount when they come near the screen. On low-power devices heavy themes show
`preview.webp` instead (`live: 'auto'`, the default; `'always'` and `'never'` force one way). The
cards are a radio group: arrow keys move, Enter or Space picks.

## GET /api/themes

```json
{ "ok": true, "contract": 1, "fallback": "glass-gate",
  "themes": [{ "id": "ember-tape", "name": "Ember Tape", "description": "…", "author": "Smart Solutions",
               "version": "1.0.0", "tags": ["heavy", "webgl"], "weight": "heavy", "modes": ["gate", "channel"],
               "sound": true, "defaultAccent": "#FF5C2B", "accents": { "pause": true }, "feed": { "--tz-flare": "accent" },
               "preview": "/themes/ember-tape/preview.webp?v=…", "css": "/themes/ember-tape/splash.css?v=…",
               "js": "/themes/ember-tape/splash.js?v=…" }] }
```

`?v=` is the same content hash the static server uses, so theme files are cached as immutable and a
changed file gets a new URL. The list is read from disk on each request (`Cache-Control: no-cache`).

## Launch themes

| Theme | Weight | Sound | Pause accent |
|---|---|---|---|
| Ember Tape | heavy (WebGL smoke, CSS fallback) | tape sting | VHS pause screen |
| Glass Gate | light, the fallback | none | none |
| Creature Feature | light (channel mode only) | theremin wobble | none |
| Blueprint Workshop | light | paper rip | none |
| Arcade | light | coin blip | pixel PAUSED |
| Comic Pow | light | pow | PAUSE! bubble |
