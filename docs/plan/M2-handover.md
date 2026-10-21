# M2 hand-over: front-end tidy and brand layer

Branch `claude/m2-frontend-52b096`, cut from `foundation-clean`. M2 changed only `public/` (pages, CSS, fonts,
assets, `entrance.js`, `shell/site.js`, listed `feed.js` edits, `admin.js` colour literals), the CSP header in
`server/static.mjs`, `test/brand.test.mjs` and new `test/frontend-*.test.mjs`. 72 tests pass.

## Fonts

Self-hosted, Latin subset, SIL OFL 1.1, `font-display: swap`, declared in `/css/fonts.css`. Theme stylesheets may
rely on these family names and paths; `test/frontend-fonts.test.mjs` pins them.

| Family | Files |
|---|---|
| `'Anton'` 400 | `/fonts/anton/anton-400.woff2` |
| `'Inter Tight'` 400, 500, 600, 700 | `/fonts/inter-tight/inter-tight-<weight>.woff2` |
| `'DM Mono'` 400, 500 | `/fonts/dm-mono/dm-mono-<weight>.woff2` |
| `'Creepster'` 400 | `/fonts/creepster/creepster-400.woff2` |

Source: the `@fontsource` npm packages, version 5.3.0 (`anton`, `inter-tight`, `dm-mono`, `creepster`), downloaded
with `npm pack` on 2026-10-21. Each tarball's SHA-512 matched the registry's `dist.integrity`. The files are the
packages' `files/<slug>-latin-<weight>-normal.woff2`, renamed; each family folder has the package `LICENSE` as
`OFL.txt` (Creepster's names "Creepster" as a Reserved Font Name; the font itself is unmodified).

## Stylesheets

The hashed names are gone; static.mjs stamps `?v=<hash>` anyway.

| File | What it holds |
|---|---|
| `reset.css` | the old reset, unchanged |
| `fonts.css` | the `@font-face` rules above |
| `base.css` | tokens on `:root`, body, focus ring, `.tz-sr`, global reduced motion |
| `feed.css` | the feed: top bar, reel, slot, caption, rail, sheets, running order, desktop stage |
| `kid.css` | front door, account card, header nav, wordmark slide, upload-button position |
| `page.css` | calm about page and the frame around the parent dashboard |

Tokens: `--tz-void #05060A`, `--tz-ink #0B0C10`, `--tz-surface #141419`, `--tz-surface-2 #1E1E25`,
`--tz-paper #F7F4EC`, `--tz-dim #A6A0AE`, `--tz-flare` (accent, default `#FF5C2B`), `--tz-flare-ink #0B0C10`,
`--tz-cyan #4DF6FF`, `--tz-hot #FF3D55`, `--tz-line`, `--tz-line-soft`, fonts `--tz-display`, `--tz-ui`,
`--tz-mono`, `--tz-horror`, motion `--tz-ease`, `--tz-t1..3`. Use `color-mix(in srgb, var(--tz-flare) N%, transparent)`
for tints rather than a derived token, so a channel accent set lower in the tree still applies.

The blue blueprint look is retired from `kid.css`; a test fails on the old blues anywhere in `public/` outside
`themes/` and `badge/`. M3 ports that look into Blueprint Workshop from `main`'s `kid.css`.

## `/js/shell/site.js`

- `loadSite()`: one `GET /api/site` per page, shared by every caller; resolves to `null` on failure.
- On load it fills `[data-site="name"]` (site name, or the brand name until the family sets one) and
  `[data-site="tagline"]`, sets `document.title` (`<name> — <tagline>`, or `<body data-title> · <name>`) and
  `--tz-flare` from `accent` (only `#rrggbb` is accepted). A `sessionStorage` snapshot (`kid-site`: name, tagline,
  accent; never the channel list) paints the next page at once.
- `showChannel({ name, logoUrl, accent })`: puts a channel in the header (badge image only from a same-site path)
  and replays the wordmark. **M6:** call it when a kid's channel opens.
- `playWordmark()`: runs on `tz:enter`. The name slides in, holds `WORDMARK_HOLD_MS` (5 s), then folds back to the
  mark (`.tz-brand[data-word="in|out"]`); hover or focus shows it again. With reduced motion the name just stays.
- Importing it in Node has no side effects (the tests import the pure helpers).
- Load it before `entrance.js`. `entrance.js` reads the name from the `data-site` slot instead of importing
  site.js, because the stamped `<script src>` and an unstamped `import` would be two module instances.

## Account card hooks for themes (M3)

The shell owns `#account-dialog`. Themes restyle it only through these variables, each with a default:
`--kt-auth-bg`, `--kt-auth-fg`, `--kt-auth-dim`, `--kt-auth-border`, `--kt-auth-radius`, `--kt-auth-shadow`,
`--kt-auth-backdrop`, `--kt-auth-blur`, `--kt-auth-field-bg`, `--kt-auth-field-border`, `--kt-auth-accent`,
`--kt-auth-accent-ink`, `--kt-auth-font`, `--kt-auth-heading-font`.

## Security header

`server/static.mjs` exports `PAGE_POLICY` (the architecture-notes CSP) and sends it on every HTML response,
including 304s; assets don't get it. There are no `<meta>` policies, inline scripts or inline event handlers
(tested). `style-src 'unsafe-inline'` stays for feed.js's injected `<style>` blocks and `style=""`.

## Feed edits (feed.js)

- `applyPreloads()` gives the active clip and the clips one and two swipes away their `poster` (from
  `clip.poster`), and the next clip keeps `preload="metadata"`. Posters further out wait because they are
  private and `no-store`; a long channel would otherwise fetch every poster at sign-in. Checked in the browser: a
  swipe lands on a frame at once. The slot's empty colour is `--tz-surface`, not black, for clips without a poster.
- Colour literals now read the tokens (ember fallbacks); the guest prompt uses the tokens.
- `sessToken()` no longer calls `/api/check` without a token (that never returned one, per M1's notes).
- `seedRole()` only checks the role with a token and only stores a role from an approved check, so a
  tokenless or expired check no longer wipes the stored role.
- `setMode()` no longer throws when the viewport crosses 900px before the reel is built (it scrolled to a
  slide that didn't exist yet).
- Nothing else changed. The VHS pause overlay is M3's (Ember Tape pause accent).

## Browser check (local install, synthetic ffmpeg clips, invented names)

390px and 375px phones and 1440px desktop: front door, sign-in card, feed (top bar, rail, "■ LATEST" line),
swipe, running order and stage, about, parents. Fonts load from `/fonts`, no outside requests, no CSP errors.
`/api/clips`, `/api/video/<id>` and `/api/video/<id>/poster` answer 401 signed out (also tested). A family
`site_name` and `family_accent` change the front door, header, title and accent.

## Left for later

- **M6:** "Sent to a parent for review",
  per-channel `?channel=`, the deep-link regex and the upload target are still M6's.
- **M6:** the front door is a still of Ember Tape (`#tzs-splash`, `#enter-tube`); the kid picker and theme loader
  replace it. The parent upload button is moved under the top bar by `kid.css` so it clears the caption.
- **M7:** `admin.js` still sets DM Mono everywhere in its injected styles; the calm Inter Tight restyle is M7's.
  The About page does not yet say parents can see watch history, because nothing records views until M7.
- `README.md` "Make it your own" now points at `SITE_NAME`, `SITE_TAGLINE`, `FAMILY_ACCENT` and `base.css`. The
  accent must be quoted in `.env` (`FAMILY_ACCENT="#FF5C2B"`): Node's `--env-file` reads an unquoted `#` as a
  comment, so the setting silently fell back to its default. `.env.example` doesn't list these keys yet, and
  `docs/RENAMING.md` still says M2 will replace the name in `public/` (done).
- The plan's M2 row mentions mail copy; M1 already moved it to the brand module, and server files other than
  `static.mjs` were out of M2's scope.
