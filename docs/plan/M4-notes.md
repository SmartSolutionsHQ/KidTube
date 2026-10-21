# M4 hand-over: badge builder

Branch `claude/m4-badges-aad9da`, cut from `foundation-clean`. Everything here runs offline: no fonts,
images or scripts are fetched at runtime, and nothing leaves the family's box.

## What's in it

| File | What it does |
|---|---|
| `public/js/badge/spec.js` | Spec v1: shapes, fonts, palette, effects, limits, `normalizeSpec()` / `validateSpec()`. Pure. |
| `public/js/badge/render.js` | `renderBadge(spec, {glyphs, stickers})` → SVG string. Pure and deterministic; validates again itself. |
| `public/js/badge/data.js` | Browser loader: `createBadgeData('/badge/')` fetches `stickers.json` and each font's glyph table on first use. |
| `public/js/badge/builder.js` + `builder.css` | The builder component (below). Injects its own stylesheet. |
| `public/js/badge/save.js` | Save helpers: channel badge, family badge + PWA icons (canvas rasterizing), channel picture upload/remove. |
| `public/badge/glyphs/{tall,spooky,pixel,comic}.json` | Latin-1 glyph outlines for anton, creepster, pixel (Press Start 2P), bangers. |
| `public/badge/stickers.json` | 61 Fluent Emoji Flat stickers as `{id, label, viewBox, paths:[{d, fill, rule?}]}`. |
| `public/badge/licenses/` | `OFL-*.txt` per font (with a note that the tables are converted outlines) and `fluent-emoji-MIT.txt`. |
| `public/badge/preview.{html,js,css}` | Standalone playground at `/badge/preview.html`: build, shuffle, the board's 12 examples, save and compare with the server. |
| `scripts/dev/build-glyphs.mjs`, `truetype.mjs` | Maintainer only: zero-dependency TrueType (glyf) reader → glyph tables. |
| `scripts/dev/build-stickers.mjs` | Maintainer only: Fluent Flat SVG → path data, strict element/attribute whitelist, license check. |
| `server/badge.mjs` | Loads the committed data once; `renderSpec(input)` → `{spec, svg}` or throws `BadgeSpecError`. |
| `server/images.mjs` | PNG/JPEG/WebP by magic bytes, size/dimension caps, metadata stripped by rebuilding the file. |
| `server/brandfiles.mjs` | `/brand/*` serving and the `/api/admin/...` badge, picture and icon routes. |
| `server/index.mjs` | Exactly three lines: import, `createBrandFiles(...)`, one routing line before `/uploads/`. |

## One deviation from the plan: `.js`, not `.mjs`

The renderer is `public/js/badge/render.js` (and `spec.js`), not `render.mjs`. `server/static.mjs` has no
`.mjs` MIME type, so it serves `.mjs` as `application/octet-stream` with `nosniff`, and browsers refuse to
run that as a module. `package.json` has `"type": "module"`, so Node imports the same `.js` files as ESM;
browser and server really do share one file. If someone adds `'.mjs': 'text/javascript'` to static.mjs
later, renaming is fine, but nothing needs it.

## Spec v1

```js
{
  v: 1,                                   // required
  shape: 'circle'|'rounded'|'shield'|'star'|'hexagon'|'burst'|'blob'|'ticket'|'tv',
  bg: '#RRGGBB',                          // shape fill, stored uppercase
  text: { value: '≤10 chars', font: 'anton'|'creepster'|'pixel'|'bangers'|'system', color: '#RRGGBB' },
  stickers: [{ id, x: 0..200, y: 0..200, scale: 0.4..2.5, rotate: -180..180 }],   // up to 3
  effects: { rgbSplit, outline, tilt, shadow },                                  // booleans
}
```

- Strict: unknown keys anywhere are refused, as are wrong types, non-plain objects and anything over 4 KB.
  Missing fields take defaults (`DEFAULT_SPEC`). Out-of-range sticker numbers are clamped and rounded.
- `text.value` is trimmed, printable Latin-1 only (no controls, no soft hyphen, no emoji or bidi marks).
  The builder upper-cases as kids type, like the board; the spec itself keeps case.
- Stickers must exist in `stickers.json`. Positions are on the 200 x 200 canvas; scale 1 is 64 units.
- Compared with the architecture notes: the M4 brief's shape list and effects win; `bg2`, `pattern`,
  `border`, `text.outline`, `text.size` and `effects.shine` are not in v1 (text auto-fits each shape,
  outline colour is chosen for contrast). Adding fields later means `v: 2` and a migration in `normalizeSpec`.

## Renderer

- Output elements: `svg`, `title`, `g`, `path`, and `text` only for the `system` font. Attributes are a
  fixed list (see the whitelist in `test/badge.test.mjs`); every value is escaped. No `style`, `href`,
  `use`, filters, gradients or external references, so the SVG is safe as `<img>`, inline, or a file.
- Names are paths: each glyph's outline is concatenated into one path in font units and placed with a
  `matrix()`; text is centred and scaled to fit a per-shape box. No kerning (fonts are display faces;
  it looks fine at badge sizes).
- Determinism: shape paths are literals, numbers go through `toFixed` (exactly specified), and no
  trigonometry runs at render time, so the browser preview and the server's SVG are byte-identical.
  Verified in Chrome for every font: the saved file equals `builder.getSvg()`.
- `test/badge.test.mjs` pins a snapshot hash. If you change the renderer, glyphs or stickers on purpose,
  look at the badge in the playground and update `SNAPSHOT`.

## Server routes and files

All writes need a staff session (`admin` or `super`), sent as `X-Kid-Email` / `X-Kid-Token` headers (or
`email` / `t` in a JSON body), like the upload routes. The global Origin check in index.mjs runs first.

| Route | Body | Result |
|---|---|---|
| `GET /api/admin/channels/<id>/badge` | | `{spec, url, imageUrl}` for the editor |
| `PUT /api/admin/channels/<id>/badge` | `{spec}` (JSON ≤16 KB) | validates, renders, stores; `channels.badge` = clean spec, `logo_rev + 1`; returns `{spec, svg, url, logoUrl}` |
| `PUT /api/admin/channels/<id>/image` | raw PNG/JPEG/WebP ≤2 MB, ≤4096 px | cleaned and stored; `{url, width, height}` |
| `DELETE /api/admin/channels/<id>/image` | | removes it |
| `GET /api/admin/brand` | | `{spec, badge, icons}` |
| `PUT /api/admin/brand/badge` | `{spec}` | stores the family badge, sets `family_badge` (so `/api/site` has the spec); `{spec, svg, url}` |
| `PUT /api/admin/brand/icons/<192\|512\|maskable-512\|apple-180>` | raw PNG of exactly that size | `{url}` |

Every write logs to `activity` (`badge`, `image`, `icon`, or the settings log for `family_badge`).

Files: `DATA_DIR/brand/family/*` and `DATA_DIR/brand/channels/<id>/*`, named `<kind>-<sha256:16>.<ext>`,
with `index.json` naming the current revision of each kind. A replace writes the new file, then the index,
then removes older revisions of that kind; changes to one folder are serialized.

Serving (`GET`/`HEAD` only; every response has `Content-Security-Policy: default-src 'none'`, `nosniff`,
`Cross-Origin-Resource-Policy: same-origin` and an ETag):

- `/brand/family/<file>`: public, `immutable`.
- `/brand/family.svg`: the current family badge, `no-cache`.
- `/brand/channels/<id>/<file>`: `immutable`; needs the viewer cookie unless `kids_public` (then `public`, else `private`).
- `/brand/<slug>.svg`: the channel's current badge, the URL `publicChannel()` already advertises as
  `logoUrl` (`?v=<logo_rev>`). Same gating; `immutable` only when `v` is the current revision.
- Names must match `^(badge|image|icon-…)-[a-f0-9]{16}\.(svg|png|jpg|webp)$` and ids `^[1-9]\d{0,8}$`, so
  `index.json`, dot segments and encoded slashes never reach the disk (tested).

Pictures: the file type comes from magic bytes only. PNGs keep only IHDR/PLTE/tRNS/gAMA/cHRM/sRGB/IDAT/IEND
(CRCs checked, APNG refused, bytes after IEND dropped). JPEGs drop every APPn and COM segment except Adobe
APP14, keep tables, frames and scan data byte for byte (real files decode pixel-identical), and get a fresh
EXIF holding only the orientation so phone photos stay upright. WebP drops ICCP/EXIF/XMP chunks and flags;
animations are refused.

## Reusing the builder (M5 wizard, M7 dashboard)

```js
import { createBadgeBuilder } from '/js/badge/builder.js';
import { saveChannelBadge, saveFamilyBadge } from '/js/badge/save.js';

const builder = createBadgeBuilder(host, {
  spec,                       // optional starting spec, e.g. from GET /api/admin/channels/<id>/badge
  onChange(spec) {},          // every change; nothing is saved by the builder itself
  names: [kidName],           // shuffle only fills the name when it is empty
  note: 'Saves as a logo and home-screen icons',   // or '' to hide
});
await builder.ready;          // stickers loaded and first render done
const { logoUrl } = await saveChannelBadge(channelId, builder.getSpec());   // auth from localStorage 'kid-session', or pass {email, t}
await saveFamilyBadge(builder.getSpec());   // also rasterizes and uploads the four PWA icons
builder.destroy();
```

- The component is self-contained: scoped `.kb-*` classes, theming via `--kb-*` custom properties, its
  own stylesheet link, and a container query (two columns from 720 px of host width; below that the
  preview sticks to the top and focused controls scroll in below it).
- Accessibility: real buttons with `aria-pressed`, fieldsets with legends, labelled inputs and sliders
  (with `aria-valuetext`), a polite live region on shuffle, one tab stop for the sticker grid with arrow
  keys / Home / End, 44 px targets, visible focus, reduced-motion respected. Stickers can be dragged on
  the preview or moved with the sliders.
- **M5**: for "add kids", mount one builder per kid and save after the channel exists. Save the family
  badge at the end of setup so the PWA icons exist before "install on phone".
- **M6**: `logoUrl` (`/brand/<slug>.svg?v=…`) now resolves. The front door could also draw badges from
  specs client-side with `data.js` + `render.js`, but `/api/site` only carries the family spec, so use
  `logoUrl` for kids.
- **M7**: when deleting a channel, also call `brandFiles.removeChannel(id)` (exported from
  `createBrandFiles`; index.mjs would need one more line such as `env.removeChannelBrand = brandFiles.removeChannel`).
  Decide whether a channel picture replaces the badge anywhere; today it is stored and served, nothing shows it.
- **M8**: `brandFiles.family()` returns `{badge, icons: {192, 512, 'maskable-512', 'apple-180'}}` URLs (or
  nulls) for the manifest. Maskable and Apple icons are drawn on `#05060A`, matching `background_color`.

## Data and licenses

- Fonts: Anton, Creepster, Press Start 2P and Bangers from `github.com/google/fonts` (`ofl/`), SIL OFL 1.1.
  The tables use neutral file names because Creepster and Press Start 2P reserve their names; the UI
  labels are Tall, Creepy, Pixel, Comic, Plain. Each table records the source font's SHA-256.
- Stickers: Microsoft Fluent Emoji Flat, MIT. License verified at commit
  `1ffb34c752ecf5d402f04cfb4b392c77f57c54bc` (the extractor pins it and refuses to run if the license text
  stops being MIT). Curated: animals, nature, food, toys, a few faces; no weapons, nothing gross or scary
  (no T-rex, alien or skull; the friendly ghost stays because the board uses it).
- Rebuild with `node scripts/dev/build-glyphs.mjs` / `node scripts/dev/build-stickers.mjs`; downloads are
  cached in `scripts/dev/.cache/` (ignored by its own `.gitignore`). Output is deterministic.

## Tests

`test/badge.test.mjs` (spec table, snapshot, tokenizer whitelist over 500 seeded fuzzed specs, sticker and
glyph data shapes, system-font escaping) and `test/brandfiles.test.mjs` (PNG/JPEG/WebP cleaning, icon
sizes, staff-only writes including a kid account, client SVG ignored, replace prunes, `kids_public` on and
off, path traversal). `npm test`: 83 pass (57 before M4).

## Follow-ups (not done here)

- `scripts/` ships in the npm package, the Docker context and `create-kidtube` copies; `scripts/dev/`
  (and a maintainer's `.cache/`) should be excluded there (package.json `files`, `.dockerignore`, the
  starter's copy filter).
- A kid channel with the slug `family` would be shadowed by `/brand/family.svg`; M7's slug validation
  could reserve it.
- `spooky.json` (Creepster) is 154 KB raw; it loads only when picked, and `compress-assets` makes `.br`/`.gz`.
- The HTML CSP header move (architecture notes) is not M4's; `preview.html` carries its own strict meta CSP.
