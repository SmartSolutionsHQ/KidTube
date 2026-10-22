# Architecture

A map of the code for reviewers and contributors. KidTube is one Node 24 process with no runtime dependencies
and no build step: `node:http` serves everything, `node:sqlite` holds the data, FFmpeg converts uploads, and
the browser loads plain ES modules from `public/`. Each file opens with a comment saying what it is for; this
page tells you which file to open.

## A request, through `server/index.mjs`

At boot, in order: `config.mjs` makes the data folder and signing secret (`prepareInstall`), `db.mjs` opens
SQLite, `demo.mjs` refuses to run demo mode on a family's data, `schema.mjs` migrates, `settings.mjs` loads
settings, and every feature module is created with a shared `env` object (the database, the secret and live
getters for the web address and mail settings). Then each request goes through these steps, and the first
module that answers ends it:

1. Security headers on every response (`Referrer-Policy`, `nosniff`, `X-Frame-Options`).
2. Host check: once the web address is set, other names get 421 (`setup.hostAllowed`). `/api/health` always
   answers.
3. Origin check: anything but GET, HEAD and OPTIONS must come from the family's own address, or 403.
4. `demo.handle` (only with `DEMO_MODE=1`), then `/api/themes` (`themes.mjs`), then the home-screen app files
   (`pwa.mjs`).
5. `setup.handle`: until an owner exists, the wizard and its API answer, other APIs get 503 and pages redirect
   to `/setup`.
6. `monitor.handle`: the `/parents` gate and most of the dashboard's `/api/admin/*` routes.
7. A per-address limit on `/api/login`, `/api/signup` and `/api/guest/redeem` (20 tries in ten minutes).
8. `access.viewer` reads the signed `kid_access` cookie. The clip list, comments, likes, reactions, views, the
   list of kids and the media routes answer 401 without one.
9. `capsules`, `reactions` and `watch` handle their own routes; `brandfiles` serves `/brand/*` and saves badges
   and pictures; `uploads` handles `/api/upload/raw/*` and `/api/video/*`.
10. Any other `/api/*` goes to `api.js`, called as a Web `fetch` handler (`sendApi`, 1 MB body limit). Login and
    guest-code answers set the cookie here.
11. Any other GET is a page or a file from `public/` (`static.mjs`).

`api.js` is the oldest part: it began as a Cloudflare Worker, so it takes a `Request` and returns a `Response`,
and `db.mjs` gives it D1's `prepare().bind().run()` shape. Newer modules use `node:http` and
`node:sqlite` directly, with `jsonio.mjs` for JSON in and out.

## Server modules

| File | What it is for |
|---|---|
| `index.mjs` | Boot and the router above |
| `config.mjs` | First boot: data folder, signing secret, database path, plain errors a parent can act on |
| `db.mjs` | Opens SQLite (WAL, foreign keys) and the D1-style wrapper `api.js` uses |
| `schema.mjs` | Every table and the migration ladder |
| `settings.mjs` | Family settings: environment variable first (locks it), then the database, then the default |
| `brand.mjs` | The product name, wordmark, tagline and default accent |
| `static.mjs` | Pages and files from `public/`: brand tokens, cache-busting `?v=` hashes, the CSP header, compression |
| `setup.mjs` | Setup mode, the one-time code, `/api/setup/*`, Host and Origin rules, client address |
| `access.mjs` | Who is asking, from the signed cookie (account or guest pass) |
| `api.js` | Accounts, login, signup, guest codes, the clip list, likes, comments, older admin routes |
| `channels.mjs` | Reading channels and who may watch each one |
| `family.mjs` | Creating and editing kids, their channels and kid logins |
| `site.mjs` | `GET /api/site` (the front door) and `GET /api/channels` |
| `monitor.mjs` | The parent dashboard's API, the activity feed, last seen and the daily prune |
| `uploads.mjs` | Chunked uploads, the FFmpeg queue, posters, video streaming, the stale-upload sweep |
| `publish.mjs` | Publishing, approving and rejecting a clip in one transaction with its email outbox |
| `notifications.mjs` | The new-video email queue, retries and unsubscribe |
| `mail.mjs` | Sends one email through Brevo's API |
| `capsules.mjs` | Time capsules: sealing, the gate on sealed clips, opening on time |
| `reactions.mjs` | The five sticker reactions |
| `watch.mjs` | The watch log, daily watch limits and the family time zone |
| `badge.mjs` | Draws a badge from a checked spec with the shared renderer in `public/js/badge/` |
| `brandfiles.mjs` | Badges, pictures and home-screen icons in the data folder, and `/brand/*` |
| `images.mjs` | Checks and rebuilds uploaded PNG, JPEG and WebP files without their metadata |
| `themes.mjs` | Validates `public/themes/*` and lists them at `/api/themes` |
| `pwa.mjs`, `pwa-worker.js` | The manifest, the Apple icon and the service worker |
| `passwords.mjs` | scrypt password hashing |
| `jsonio.mjs` | JSON helpers and the staff check for the `node:http` routes |
| `demo.mjs`, `demo-sandbox.mjs`, `demo-make.html` | Demo mode only ([DEMO.md](DEMO.md)) |

## The front end (`public/`)

Pages: `index.html` (the front door and the feed), `parents/` (the dashboard), `setup/` (the wizard and its
scripts), `install/` (phone install steps), `about/`, and `offline.html`. Playgrounds for maintainers:
`themes/preview.html` and `badge/preview.html`.

| Folder | What it is for |
|---|---|
| `js/shell/` | The viewer: front door, kid picker, sign-in card, routing, splash loader and gallery, capsules, reactions, watch time, the service worker hook |
| `js/feed.js`, `js/player-media-v1.js`, `js/server-upload-v1.js`, `js/recovery.js` | The swipe feed, playback, uploading and stalled-video recovery, carried over from the starter |
| `js/parent/` | The dashboard: one module per tab, plus `api.js`, `dom.js`, `format.js` and the extension slots |
| `js/launch/` | Time capsule, daily limit and family clock controls that plug into the dashboard's slots |
| `js/badge/` | The badge spec, the renderer (also used by the server), the builder and saving |
| `js/demo/` | The demo's "make your own kid" page |
| `themes/<id>/` | One splash theme per folder |
| `badge/` | Sticker paths, font glyph tables and their licences, all generated by `scripts/dev/` |
| `css/`, `fonts/`, `assets/` | Styles, self-hosted fonts, the logo and default icons |

Newer code builds the page from elements and text nodes; the feed, carried over from the starter, still uses
template strings and escapes every value with `esc()`. There are no inline scripts: the CSP header forbids them.

## Data

Everything lives in one folder ([OPERATIONS.md](OPERATIONS.md#back-up-and-restore) lists it): the SQLite file,
`videos/`, `brand/`, `secret`, `backups/` and `incoming/`.

Tables, all created in `server/schema.mjs`:

| Table | Holds |
|---|---|
| `accounts` | Every person: parents, co-parents, viewers and kid logins, with role, status and daily watch limit |
| `channels` | One row per kid: name, lines, accent, theme, badge spec and upload review. Row 1 always exists |
| `clips` | Every video: title, file, poster, channel, order, review state, hidden flag and capsule dates |
| `likes`, `comments`, `reactions` | What viewers leave on a clip |
| `guest_codes` | Hashed guest codes, when they expire, and the kid they are limited to |
| `upload_jobs` | Uploads in progress and their conversion state |
| `video_announcements`, `video_notification_deliveries`, `video_email_preferences` | The new-video email outbox, each delivery and who unsubscribed |
| `settings` | Family settings saved from the wizard or the dashboard |
| `views`, `watch_bonus` | The watch log, and extra minutes a parent gave for one day |
| `activity` | The activity feed: who did what, when |
| `hits`, `chits`, `guest_code_attempts` | Recent signup, comment and guest-code tries, for rate limits (pruned within the hour) |
| `media`, `media_chunks` | Videos stored inside the database by the earliest starter, still served |

Migrations: `PRAGMA user_version` is the schema version (4 today). `migrate()` first copies an existing
database to `backups/pre-migrate-v<from>-<time>.sqlite`, then runs one step per version, each in its own
transaction, and refuses a database newer than the app. Every step is safe to rerun, so an old or half-known
database still lands cleanly. To change the schema, add a step to the end of `MIGRATIONS`; never edit a
shipped one. `test/schema.test.mjs` upgrades a frozen v0 database.

## Branding

- The product name, wordmark, tagline, "by Smart Solutions" and default accent live only in
  `server/brand.mjs`. Pages write `{{brand.name}}` and friends and `static.mjs` fills them in; scripts read
  the name from `GET /api/site`. `test/brand.test.mjs` fails if the name appears anywhere else in `server/` or
  `public/`. [RENAMING.md](RENAMING.md) lists the rest of a rename.
- A family's own name, line, accent and badge are settings (`site_name`, `site_tagline`, `family_accent`,
  `family_badge`). The badge and the home-screen icons drawn from it are files in the data folder's `brand/`.
  `pwa.mjs` builds the manifest from them.
- The default mark is `public/assets/logo.svg`; `scripts/dev/build-icons.mjs` draws the default icons from it.

## How themes and badges plug in

**Themes.** A theme is a folder in `public/themes/` with a manifest, CSS, a module and a preview image.
`server/themes.mjs` validates each folder and lists the good ones at `/api/themes`; there is no list to edit.
`public/js/shell/themes.js` loads one and mounts it, `theme-gallery.js` shows them all live, and `endings.js`
loads a theme's optional capsule unlock and end-of-tape screens. A kid's theme is `channels.theme_id`; the
front door's is the `gate_theme` setting. `test/themes.test.mjs` checks every folder against the rules in
[THEMES.md](THEMES.md).

**Badges.** A badge is saved only as a small JSON spec (`public/js/badge/spec.js`), never as an SVG from the
browser. The builder (`js/badge/builder.js`, used by the wizard and the dashboard) edits the spec and previews
it with `js/badge/render.js`. The server validates the spec and draws the SVG with the same renderer
(`server/badge.mjs`), then `brandfiles.mjs` stores it by content hash. A kid's spec is in `channels.badge`; the
family's is the `family_badge` setting. New stickers or fonts come from `scripts/dev/build-stickers.mjs` and
`build-glyphs.mjs`.

**Dashboard slots.** Features add controls to the dashboard without editing its tabs: a module with
`mount(host, ctx)` is registered for a slot in `public/js/parent/extensions.js`. The time capsule and daily
limit controls in `js/launch/` work this way.

## Tests

`npm test` runs `node --test test/*.test.mjs`: about 300 tests in under ten seconds, with FFmpeg on the PATH.
There is no test framework beyond `node:test`.

- One file per area, named after the module or feature (`capsules.test.mjs`, `themes.test.mjs`).
- `helpers.mjs` starts a real install in a temporary folder on a free port (`startInstall`).
  `family-fixture.mjs` adds two kids, clips and every kind of caller (`startFamily`), an in-memory database
  (`memoryDatabase`) and a way to call a route handler without a server (`drive`).
- Pure browser modules (`format.js`, `qr.js`, `route.mjs`, the badge renderer, the setup helpers) are
  imported straight into Node.
- Contract tests pin what other code relies on: `frontend-pages` (ids and hooks the scripts look up),
  `frontend-csp`, `frontend-fonts`, `brand`, `package` (what ships) and `security-review` (one test per finding
  in [plan/security-review.md](plan/security-review.md)).
- Tests use invented names and generated clips only.

The history behind these choices, milestone by milestone, is in [plan/](plan/README.md).
