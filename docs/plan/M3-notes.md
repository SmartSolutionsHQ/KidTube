# Notes from M3 (themes) for M5, M6 and later

M3 built the splash theme system against a standalone page. Nothing in the viewer uses it yet; M6 wires
it in. The theme contract for theme makers is `docs/THEMES.md`.

## What landed

| Path | What |
|---|---|
| `server/themes.mjs` | Registry: validates `public/themes/*/manifest.json`, lists themes in launch order with content-hashed URLs; `GET /api/themes`. |
| `server/index.mjs` | Exactly the three agreed lines (import, `createThemes(publicDir)`, the `/api/themes` route right after `pathname` is decoded, before any auth). |
| `public/js/shell/themes.js` | Loader: `showSplash`, `attachPause`, `alwaysEnter`, `mountTheme`, `loadRegistry`, `pickTheme`, `feedVars` and small pure helpers. No side effects on import. |
| `public/js/shell/theme-gallery.js` | `createThemeGallery(element, opts)` and `createFrame` / `previewTheme` for single previews. |
| `public/themes/<id>/` | ember-tape, glass-gate, creature-feature, blueprint-workshop, arcade-crt, comic-pow. |
| `public/themes/preview.{html,js,css}` | The playground at `/themes/preview.html`. |
| `test/themes.test.mjs` | 67 tests (the whole suite is 124, all passing on Node 24.18). |

## Wiring the loader (M6)

1. Call `showSplash()` from the shell **before `recovery.js` runs**, or set
   `window.__tzsplash = { state: 'pending' }` in the first module that runs. `recovery.js` reads
   `__tzsplash` once at boot to decide whether to nudge the first video; `showSplash()` sets it
   synchronously when called and clears it when the splash is gone.
2. Remove today's static `#tzs-splash` and `entrance.js`'s splash handling at the same time. The
   loader's full-screen host uses the id `tzs-splash` on purpose (`recovery.js` ignores touches inside
   it), so the two must not exist together.
3. Pass the channel from `/api/site`: `themeId: channel.themeId, title: channel.name,
   kicker: channel.kicker, number: <channel position>, accent: channel.accent, logoUrl: channel.logoUrl,
   channel: channel.slug, brand: site.brand, soundAllowed: site.splashSound`. For the family front
   door use `mode: 'gate'`, `themeId: site.gateTheme`, `accent: site.accent`, `title: site.siteName`.
4. `showSplash()` resolves once the viewer is in; open the auth dialog after it. It fires `tz:enter`
   in every case, including `?splash=0` and a remembered "always enter", so the feed never waits.
5. After the feed boots, call `attachPause({ themeId, title, channel, accent, number })` for the
   channel's theme, and the returned function when leaving the channel.
6. Apply `feedVars(theme, accent)` (theme from `loadRegistry()`) as inline custom properties on the
   feed root to let the theme restyle the feed. Only whitelisted `--tz-*` names and safe values pass
   the manifest validator.
7. "Always enter" has storage and URL handling but no button: themes never render controls beyond
   Enter. M6 should add a small "Skip my intro next time" toggle (a channel menu or the end of the
   splash) that calls `alwaysEnter(slug, true|false)`.

## The gallery in the wizard and dashboard (M5)

- `createThemeGallery(el, { ctx, selected, onSelect, mode })`; call `update({ title, accent, … })` as
  the parent types (debounced 250 ms). `mode: 'gate'` filters to themes that support the family gate
  (Creature Feature is channel-only, and `pickTheme` falls back to Glass Gate if it is asked to be a
  gate).
- It injects its own small stylesheet (`.kt-gallery …`, dark parent-side look, no glitch). Override
  `--kt-gal-min` (card min width) and `--kt-gal-gap` on the container to fit a layout.
- The live preview of one theme for a "your kid's splash" panel: `createFrame(parent)` then
  `previewTheme(frame, theme, ctx)`; `handle.destroy()` when done. Preview hosts are inert, silent and
  never take focus.
- On low-power devices heavy themes show their `preview.webp` instead of a live WebGL mount.

## Contract additions and choices (all backwards-compatible with the architecture notes)

- `ctx` also has `contract`, `id`, `slug` (for labels like `MILO-TAPES-T-01`) and `loop(fn, {fps})`,
  the only way themes animate (30 fps cap, 24 in previews, paused off screen and in hidden tabs).
- `pause().show(seconds, total)` takes the duration as a second argument for the `mm:ss / mm:ss` OSD.
- The OS reduced-motion setting always wins: callers can add reduced motion but never turn it off.
  Reduced motion also counts as low power, so Ember Tape shows Glass Gate unless forced (then it shows
  its own still frame).
- `ctx.sound.context()` returns a context only after a pointer or key press inside the splash, when
  `soundAllowed` is true, the manifest says `sound: true` and it is not a preview. Esc never plays sound.
- `/api/themes` also returns `ok`, `description`, `author`, `version`, `tags`, `sound`, `defaultAccent`,
  `accents` and `feed`, and answers 405 to anything but GET/HEAD.
- Manifests reject unknown fields, so a typo cannot silently pass.
- An empty kicker is allowed: Glass Gate then shows none, and the other themes use their own default.

## After review

An independent review of the branch found races and leaks the tests could not see; all are fixed and
re-checked in headless Chrome: Esc while a theme or the registry is still loading (the late theme is
destroyed, `__tzsplash` cleared, nothing left mounted), a second `showSplash()` call (shares the first),
a stalled `/api/themes` (4 s timeout, then Glass Gate from its known paths, failure not cached),
concurrent mounts into one frame (abortable mounts plus host ownership), `ctx.loop` listeners released
on `stop()`, pause overlays deduplicated per video and cleaned up when the feed re-renders, the
registry skipping unreadable folders instead of throwing into the request handler, sound unlocking only
on the Enter button, `ctx.url` and `logoUrl` confined to the site, Ember releasing WebGL when its
shader fails to build, and a stricter CSS walker in the tests (strings, nesting, `:is()` lists,
sibling combinators, protocol-relative URLs, keyframe stops counted toward the flash limit).

## For M8 (PWA)

Theme CSS, JS and previews are fingerprinted (`?v=`), so the service worker can cache them
cache-first. Fonts in `themes/*/fonts/` are not fingerprinted (`max-age=86400`, like `/fonts/`).
`/themes/preview.html` is a public playground page with `noindex`; it touches no data. Leave it out of
the precache list, and decide whether production should serve it.

## Fonts

- Global families: the themes use M2's `Anton`, `Inter Tight` (up to 700), `DM Mono` and `Creepster`
  from `/css/fonts.css`, always with fallbacks. Checked both ways: with M2's fonts served read-only
  from its worktree, and without `/css/fonts.css` at all (Impact, system sans, Papyrus/fantasy stand in
  and the layouts hold).
- Theme-local, downloaded fresh on 2026-10-21 into an empty scratch folder and treated as data:
  - Press Start 2P (`arcade-crt/fonts/`) and Bangers (`comic-pow/fonts/`): latin and latin-ext woff2
    subsets from the Google Fonts CSS2 API (`fonts.gstatic.com`, Press Start 2P v16, Bangers v25),
    with the `unicode-range` values Google serves.
  - `OFL.txt` for each from `github.com/google/fonts` (`ofl/pressstart2p/OFL.txt`, `ofl/bangers/OFL.txt`).
  - SHA-256: `press-start-2p-latin.woff2` 42144b97…ae6e, `press-start-2p-latin-ext.woff2`
    3e1ea894…c372, `bangers-latin.woff2` d37507cc…a4b, `bangers-latin-ext.woff2` 532d54b2…df93.

## Checked in a browser

Headless Chrome (driven over DevTools, because the app's browser pane was hidden and throttled its
frames), serving the real `server/static.mjs` and `server/themes.mjs` with the architecture notes'
CSP as an HTTP header. No CSP violations or console errors.

- Every theme at 390 × 844 and 1440 × 900, with and without M2's fonts; with reduced motion (finished
  still, Enter button, zero running animations); in the gallery at 1280 and 390 wide (no horizontal
  scroll).
- Per theme through `showSplash`: Enter is focused on mount; Enter dismisses in 320–570 ms; `tz:hold`
  then `tz:enter`; `__tzsplash` set while mounted and cleared after; host removed and page scroll
  restored; Esc skips.
- Sound: no audio nodes before the tap, none with sound off or on Esc; each sounding theme makes its
  sound after the tap; Glass Gate never.
- Ember Tape: WebGL context reports lost after dismiss; the CSS smoke takes over without WebGL.
- Fallbacks: low power → Glass Gate, forced → Ember; a 404 module → Glass Gate; a module that never
  answers → Glass Gate after 4.08 s with `__tzsplash` set throughout; every module broken → built-in
  card; `?splash=0`, remembered always-enter, and `?splash=1` overriding it.
- Pause accents (Ember, Arcade, Comic) appear when the test video is paused and hide on play.
- Creature Feature's scratch-off reveals the badge once about half is cleared.
- Gallery: arrow keys move the selection, preview hosts are inert, frames reset fully between themes.

## Not done here

- No "always enter" button (see wiring step 7).
- No UI to force a heavy theme on a low-power device: `showSplash({ force: true })` exists; the setting
  that drives it belongs to M5/M6 (e.g. a per-channel "always use this intro" switch).
- Sound was verified by counting Web Audio nodes in headless Chrome, not by listening. Levels are
  conservative (peak gains 0.07–0.32 before a limiter or fade); worth one listen on a phone.
- Real-device performance of the smoke shader on older phones is untested; it renders at about
  120 000 pixels (70 000 in low power, 40 000 in previews) and the browser scales it up.
