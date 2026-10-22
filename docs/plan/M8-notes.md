# M8 hand-over: PWA, docs and release (2026-10-22)

Branch `claude/m8-pwa-docs-release-5cd14b`, cut from `foundation-clean`. Not pushed, tagged or published.
`npm test`: 259 pass on Node 24.18 (251 before).

## What changed

| Area | Files |
|---|---|
| Manifest, Apple icon, service worker | `server/pwa.mjs` (`buildManifest`, `shortName`, `buildWorker`, `createPwa`), `server/pwa-worker.js` (the worker text and `swDecision`), one route line and one creation line in `server/index.mjs`, `sendFile.pageHtml()` and `/install` in `server/static.mjs` |
| Page side | `public/js/shell/pwa.js` (registers only in a secure context; `mountInstall`), `public/install/`, `public/offline.html`, manifest and Apple tags on index, parents, about; `app.js` imports `pwa.js` |
| Default icons | `public/assets/icons/*.png`, drawn by `scripts/dev/build-icons.mjs` (pure Node, deterministic) |
| Polish | dashboard title fallback (`dashboardTitle` in `format.js`), name card restyle (feed.css only; the injected copy in feed.js is gone), Parents link hidden from non-parents, `.tza-*` removed, builder Shuffle under 350 px, `reset-parent`/`email:test` without `.env` |
| Walkthrough fixes | `.kd-item-plain` columns from 600 px, activity sentences for `capsule.*`/`budget.*` (and `icon` rows hidden), held-comment note in feed.js, Ember pause readouts stacked on phones, `data-kt-shown` on a shown pause host hides the feed glyph |
| Release | `package.json` 0.2.0, `CHANGELOG.md`, `test.yml` package and image checks, `release.yml` (amd64 + arm64 to `ghcr.io/smartsolutionshq/kidtube` on `v*` tags that match package.json) |
| Docs | README, INSTALL, UPGRADING, VERIFY, SECURITY, RENAMING, OPERATIONS, DEPLOYMENT, EMAIL; `docs/images/` |

## Service worker rules

`swDecision(request, origin)` returns `skip`, `cache-first` or `network-first`. Skip: non-GET, other origins,
any Range header, `/api*`, `/brand/*`, `/uploads/*`, `/media/*`, `/sw.js`, the manifest, the Apple icon, video,
audio and track destinations and media file extensions. Navigations are network-first with `/offline.html` as
the fallback (pages are never cached). `?v=` stamped assets and the shell's unstamped files (fonts, icons, logo,
offline page) are cache-first. The version is a hash of the worker text and the shell list with its hashes, so a
deploy that changes any shell file replaces the cache. Stamped assets fetched later in the same version (theme
files, the dashboard's app.js) join the cache; old ones go when the version changes.

## Not done, with reasons

- **Docker path not run**: Docker isn't installed on this Mac. CI builds the image and checks its contents.
- **iOS Simulator install** not run; the pane can't emulate `prefers-reduced-motion` either (checked through
  the theme playground instead).
- **Listed / hidden kids** needs a `channels.listed` column (schema v5); a feature, not polish.
- **Guest QR carrying the code** (`#/code/K7Q2`): a small shell route; left for a follow-up.
- **`/themes/preview.html` in production**: harmless (no data), but a decision for Eddie and Kevin.
- **Ember's end-of-tape snow** (grey noise, 1.2 s): within the flash rule; cut to a still if you want stricter.
- **Re-announcing a capsule announced before sealing**, demo content and the README GIF (launch-story leftovers).
- Small things seen in passing: the sign-in card uses the family accent rather than the kid's; on a 390 px phone
  the header's "Switch kid" wraps to two lines while the name slides in; `/install`'s tab title says the product
  name, not the family's; in the wizard, turning on a kid login pre-fills a suggested password and typing appends.
