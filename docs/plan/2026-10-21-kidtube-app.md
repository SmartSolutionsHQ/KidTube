# KidTube: from family starter to a real app parents can install

## Context
Kevin Garcia (Smart Solutions co-founder) built TanzenTube, a private video channel for his kid, then extracted it into a starter, SmartSolutionsHQ/KidTube (2 commits, 2026-10-21). His ask: make it an app other parents can download, with a setup wizard, little logos for each kid, and a selection of splash screens Smart Solutions can keep adding to, under a new name, with TanzenTube's vibe. Eddie's framing: a fun kids app with personality and customization that parents can monitor, under the Smart Solutions brand.

What exploration found:
- KidTube is TanzenTube's player with the soul stripped out (WebGL smoke splash, glitch/scramble, tape sound, VHS pause screen, fonts) and recolored blue. One install = one channel. No migrations, no templating, branding hard-coded in ~30 places, CLI-only setup, no thumbnails.
- The live TanzenTube still runs older code than this repo. Moving it onto KidTube's server is part of the upgrade path (M8).
- Mobile feed (from Eddie's recording): ~1 in 3 swipes shows black/static for seconds because no posters exist.

## Decisions (Eddie, 2026-10-21)
- Self-hosted, open source, made easy: one command → browser setup wizard → "Add to Home Screen" app. No hosted tier.
- Working name **KidTube**; rename before public launch (Tube/YouTube trademark risk). Brand name lives in one module so the rename is one change.
- **Many kids per install**: a channel per kid with its own name, badge, splash theme, accent, videos.
- **Built-in badge builder** (SVG, offline, no AI).
- Smart Solutions appears as a small "by Smart Solutions" endorsement (official logo, unmodified). KidTube has its own loud identity; the Smart Solutions design system's calm rules apply to the parent-facing voice, not the kid side.

## Brand direction: "two voices"
- **Kid side (loud):** TanzenTube's language. Void #05060A, ink #0B0C10, paper #F7F4EC, ember #FF5C2B, glitch cyan #4DF6FF / hot #FF3D55. Anton display with RGB split, DM Mono labels, tape language (Side A, SP, REC, "> enter_the_tube <"). Each kid's channel swaps the accent and theme.
- **Parent side (calm):** wizard and dashboard in Inter Tight on dark ink, plain sentence-case copy, no glitch. Same palette, effects off.
- Fonts self-hosted (all OFL): Anton, Inter Tight, DM Mono, Creepster (Creature theme only).
- Tagline kept from Kevin's README: "A little channel. A big imagination."

## Step 1: Claude Design sheets (first, before code)
One **Design** artifact, "KidTube: app + brand sheets", with boards:
1. **Branding sheet**: name lockup + wordmark, mark, palette with kid accent set, type specimens, two-voice copy examples, Smart Solutions endorsement rules, do/don't.
2. **App sheet**: product one-liner, who it's for, the flow (gate → kid picker → kid splash → feed), key screens as phone + desktop mockups: gate/login, kid picker, feed, pause, upload, parent dashboard, setup wizard steps.
3. **Splash gallery**: the 6 launch themes, each as a phone frame.
4. **Badge builder**: builder UI + a dozen example kid badges.
Placeholder kids only (invented names, no real photos). Smart Solutions design system not applied to the kid look (only its logo for the endorsement). Eddie and Kevin review before the theme/UI build starts; backend foundation can run in parallel.

## Step 2: Build (in `~/Code/kidtube`, cloned from SmartSolutionsHQ/KidTube)
Branch per milestone, PRs to SmartSolutionsHQ/KidTube for Kevin to review. **Ask Eddie before the first push/PR.** Match the clean module style of `server/uploads.mjs` / `notifications.mjs` (2-space, SCREAMING_CASE consts, sparse why-comments), zero runtime deps, `node:test`.

### Data model: `PRAGMA user_version` migration ladder in `server/schema.mjs`
All scattered `CREATE TABLE`s (api.js, uploads.mjs, notifications.mjs) move into one ladder so old installs (and a future TanzenTube move) upgrade in place.
- **v1**: today's tables exactly, made idempotent (adds `accounts.role` if missing).
- **v2**:
  - `settings(key PK, value JSON, updated)`. Precedence: env > DB > defaults. Holds family name, gate theme, accent, kidsPublic, moderation toggles, SITE_URL once confirmed, mail settings.
  - `channels(id, slug UNIQUE, name, kicker, tagline, accent, theme_id, badge JSON, logo_rev, review_uploads, position, created)`. Migration creates one default channel and assigns every existing clip to it.
  - `clips` gains `channel_id`, `poster`, `review` ('live' | 'pending' | 'rejected'). Wire up the existing `hidden` column.
  - `upload_jobs` gains `channel_id`.
  - `accounts` gains `channel_id` and a `kid` role: a creator who can only upload to their own channel.
  - `comments` gains `hidden`. Clip delete cascades likes and comments.
  - `views(clip_id, viewer, ts)`: recorded after 3s of play, deduped per viewer per clip per hour.
  - `activity(id, ts, actor, kind, subject, detail JSON)`: signups, approvals, uploads, reviews, comments, guest redemptions, settings changes.

### New and changed endpoints
- Public:
  - `GET /api/site`: brand, family name, gate theme, accent, setup state. Kid channels only if `kidsPublic`.
  - `GET /api/themes`
  - `GET /manifest.webmanifest`
  - `/sw.js`
- Signed in:
  - `GET /api/channels`
  - `GET /brand/<slug>.svg` and `/brand/<slug>-<size>.png`, served from `/data/brand`. Cookie-gated unless `kidsPublic`.
  - `POST /api/view`
- Staff:
  - `/api/admin/channels` (create, update, reorder, delete)
  - `/api/admin/badge` (spec in, server-rendered SVG out)
  - `/api/admin/icon` (PNG upload with magic-byte check)
  - `/api/admin/settings`
  - `/api/admin/clips/review` and `/api/admin/clips/hide`
  - `/api/admin/comments/hide` and `/api/admin/comments/delete`
  - `GET /api/admin/activity` and `GET /api/admin/views`
- Setup mode only: `POST /api/setup/claim` and `/api/setup/*`.

### Milestones (each a branch + PR with tests)
| # | Milestone | Owns (files) | Depends on |
|---|---|---|---|
| M0 | Clone to `~/Code/kidtube`; baseline `npm test` green | none | none |
| M1 | **Foundation**: migration ladder; `server/settings.mjs` (brand name lives here); channels and default channel; poster generation at upload (ffmpeg frame grab); ffmpeg timeout; delete dead code (PARENT_PIN admin, D1 upload fns); log swallowed errors; close `/api/check` account enumeration; cache-busting (static.mjs stamps an asset hash into HTML at boot) | `server/*`, `scripts/*`, `test/*` | M0 |
| M2 | **Front-end tidy + brand layer**: split index.html's two giant lines into readable markup; self-host the 4 fonts; `public/js/site.js` reads `/api/site`; replace hard-coded brand strings in HTML, JS and emails; restore TanzenTube's VHS pause overlay and header wordmark slide as reusable modules; preload next clip and show its poster | `public/index.html`, `about/`, `parents/index.html`, `public/css/*`, `public/fonts/*`, `public/js/entrance.js`, `public/js/site.js`, mail copy | M1 |
| M3 | **Theme system + 6 splash themes** built against a standalone preview page. Contract: `public/themes/<id>/{manifest.json, splash.css, splash.js, preview.webp}`, `export function mount(host, ctx) → {dismiss}`; ctx = name, kicker, subtitle, accent, logoUrl, reducedMotion, soundAllowed, onEnter. Themes: **Ember Tape** (TanzenTube's WebGL smoke, glitch, scramble, tape sting, accent-driven), **Glass Gate** (light fallback), **Creature Feature**, **Blueprint Workshop** (KidTube's current bright look), **Arcade** (8-bit CRT), **Comic Pow** (halftone). All honor reduced motion, Esc to skip, and "always enter". | `public/themes/**`, `public/js/splash-host.js`, `server/themes.mjs` | M1 (parallel with M2, M4) |
| M4 | **Badge builder** built against a standalone preview page. One renderer, `public/js/badge-render.mjs`, imported by both browser and server; the server validates the spec against a whitelist and renders the SVG itself, never trusting client SVG. Shapes: circle, shield, star, cassette, TV, blob, hex. Fonts, colors, name or initials, stickers, RGB-split/outline/tilt effects, shuffle. Stickers: an MIT-licensed flat emoji subset (Microsoft Fluent Emoji flat; license verified before vendoring, NOTICE file added). PWA icon PNGs rasterized in the browser. | `public/js/badge-*.{js,mjs,css}`, `public/stickers/**`, `server/badge.mjs` | M1 (parallel with M2, M3) |
| M5 | **Browser setup wizard**. First boot auto-creates the DB and `data/secret`, so no `.env` is needed. Setup mode serves `/setup`, and every other API returns 503. A one-time code is printed to the logs and written to `data/setup-token`; guesses are rate-limited; the owner claim is atomic (`BEGIN IMMEDIATE` + insert only if no owner exists). Steps: code, parent account, family name + confirm site URL, add kids (badge + splash + accent, repeatable), who can watch (approvals, guest codes, comment and upload review), optional email, done (install on phone, upload first video). The `scripts/setup.mjs` CLI path keeps working for tests and power users. | `server/setup-mode.mjs`, `server/index.mjs` boot, `public/setup/**`, `scripts/doctor.mjs`, `bin/create-kidtube.mjs` | M2, M3, M4 |
| M6 | **Multi-kid viewer flow**: front door shows the kids' badges (or the family splash when private) → pick a kid → that kid's splash → glass sign-in card over it (skipped when already signed in) → that kid's feed. With one kid, their splash plays straight away, exactly like TanzenTube. Deep links `#/<slug>/v/<id>`. Uploads go to a channel; kid accounts can only upload to their own. Kid uploads land in review when the channel says so. | `public/js/feed.js`, `public/js/entrance.js`, `server/api.js` clip routes, `server/uploads.mjs`, `server/publish.mjs` | M5 |
| M7 | **Parent dashboard + monitoring**: calm restyle; channel editor (badge, theme, accent, name); review queue; comment hide/delete; clip hide; who watched what; activity feed; last-seen per viewer; settings. | `public/js/admin.js`, `public/parents/**`, `server/api.js` admin routes | M6 |
| M8 | **PWA + install + docs**: per-install manifest from settings and badges; service worker caches the app shell only and never API responses or videos; install prompts. `docker compose up`, then the logs print the setup link and code. README rebrand, `docs/INSTALL.md` for non-technical parents, upgrade notes for existing installs (TanzenTube). | `public/sw.js`, manifest route, `docs/**`, `README.md`, `compose*.yaml` | M7 |

**Parallel sessions:**
- The Claude Design sheets (Step 1, here) run alongside M0–M1 in their own session.
- After M1 merges, M2, M3 and M4 each get their own session. File ownership above keeps them apart. M3 and M4 build standalone preview pages and are wired in during M5–M6.
- M5 through M8 run in order, because they share `api.js`, `feed.js` and `admin.js`.

### Privacy and safety defaults (Eddie's picks, 2026-10-21)
- **Front door shows kids' names and badges** (like TanzenTube). `kidsPublic` defaults on, so `/api/site` lists channel names, kickers, accents and themes, and `/brand/*` is public. Parents can switch it off in the wizard or settings, which falls back to the family name only.
- **Kid uploads go to parent review first**: `channels.review_uploads` defaults on, with a per-kid toggle.
- **Parents see who watched what**: views log plus activity feed.
- Videos, clip titles, likes, comments and viewer lists are always cookie-gated, whatever the front-door setting. Tests assert 401s when signed out for `/api/clips`, `/api/video/*`, `/api/likes`, `/api/comments`, and `/brand/*` when private.
- No analytics and no third-party requests (strict CSP stays `default-src 'self'`).
- Uploaded images: PNG, JPEG or WebP only, magic-byte checked, size-capped. No user SVG ever.
- The views log stays on the family's box and is visible only to parents.

## Right after approval
1. Clone to `~/Code/kidtube`. Save this plan as `docs/plan/2026-10-21-kidtube-app.md` in the repo.
2. Here: build the Claude Design sheets (quickstart with intent "design", our own look, not the Smart Solutions system), with boards for branding, app, splash gallery and badges.
3. In parallel, a separate session runs M0–M1 on branch `foundation`.
4. Commit per milestone on local branches. Ask Eddie before any push or PR to SmartSolutionsHQ/KidTube.

## Verification
- `npm test` in node:test style. Each milestone adds tests:
  - migration from a v0 DB (current KidTube with clips) lands every clip in the default channel
  - setup-mode claim race (two claims, one wins), wrong-code lockout, 503s before setup
  - badge spec whitelist rejects unknown shapes and stickers
  - kid accounts can't upload to a sibling's channel
  - review queue keeps pending clips out of `/api/clips`
  - signed-out 401s for clips, video, brand and channels
  - service worker never caches `/api/*`
- Manual end-to-end, driven in the built-in browser on localhost:
  1. Fresh `docker compose up`; the setup link and code appear in the logs.
  2. Wizard with two invented kids, each with a different badge and theme.
  3. Upload as a kid → review queue → approve → appears with a poster.
  4. Viewer signs up → parent approves → kid picker → splash → feed.
  5. Guest code redeemed and then expires.
  6. Activity and views populate.
  7. Reduced motion turns every theme into a still frame.
  8. Phone-width layout; PWA installs from Safari on the iOS Simulator.
- Upgrade test: boot the new build on a copy of an old KidTube DB.
- The npm route (`npx create-kidtube`, `npm start`) is also run once with FFmpeg on the host.
