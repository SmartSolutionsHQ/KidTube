# Notes for M2 (and later milestones) from M1, branch `foundation`

M1 changed only `server/`, `scripts/` and `test/`. The current `public/` keeps working unchanged
(checked in a browser: splash, login, feed with posters, parent dashboard). These are the front-end
changes M1 made possible or needs, roughly in priority order.

## New endpoints

`GET /api/site` (public, `Cache-Control: no-store`):

```json
{ "ok": true, "brand": "KidTube", "tagline": "A little channel. A big imagination.",
  "familyName": "", "gateTheme": "ember-tape", "accent": "#ff5c2b",
  "setup": "complete", "kidsPublic": true,
  "channels": [{ "slug": "ana", "name": "Ana", "kicker": "Side A", "accent": "#4df6ff",
                 "themeId": "arcade", "logoUrl": "/brand/ana.svg?v=3" }] }
```

- `channels` is `[]` whenever `kidsPublic` is false. Never read kid names from anywhere else before sign-in.
- A channel's empty `accent`/`themeId` is already filled from the family's `accent`/`gateTheme`.
- `logoUrl` is `null` until the channel has a badge (`channels.logo_rev > 0`). The `/brand/<slug>.svg`
  route itself is not built yet (M4/M5), so show the name or initials when it is null.
- `setup` is `"complete"` once an approved owner (`super`) exists, otherwise `"required"` (M5 will use it).
- `brand` comes from `BRAND_NAME` in `server/settings.mjs`, the one place the product name lives.
  Front-end copy should read it from here instead of hard-coding "KidTube".

`GET /api/channels` (needs the `kid_access` cookie, 401 otherwise): `{ ok, channels: [...] }` with the same
fields plus `tagline`, listed even when `kidsPublic` is off.

## Changed responses

- `/api/clips` now has only `review='live'` and `hidden=0` clips. Each clip gains `channel` (slug).
  `poster` is now filled for new uploads: `/api/video/<uploadId>.jpg`, cookie-gated and `no-store` like the
  video. Clips uploaded before M1 have `poster: ""`.
- Login failures are always `401 { ok: false, error: "Wrong email or password." }`. The old
  `404 "no account"` and `401 "wrong password"` are gone. `entrance.js` and `admin.js` already show
  `j.error`, so no change is needed, but any copy that branched on the old strings must not.
- `/api/check` without a valid `t` always answers `200 { ok: true, status: "none", role: "" }`, whatever the
  email. With a valid token: `{ ok: true, status: "approved", role, t }`. `feed.js` `sessToken()` calls
  `/api/check` without `t` hoping to get one back; that never worked and still doesn't, so M2 can delete
  that branch.
- `/api/signup` 409 is now `{ ok: false, error: "exists" }` without the other account's `status`, and the
  success response no longer includes `notifyErr` (it is logged on the server instead).
- New 403s with a readable `error`: `/api/signup` when `signups` is off; `/api/guest/generate` and
  `/api/guest/redeem` when `guestCodes` is off. `entrance.js` shows `j.error`, which is fine.
- `POST /api/comment` returns `row.hidden: true` when `reviewComments` is on. The comment is saved but stays
  out of `/api/comments` until a parent unhides it (M7). The feed should show "Waiting for a parent" on that
  row instead of rendering it like a normal comment.
- `/api/admin/overview` clips gain `review`, `hidden` and `channel`; `recent` comments gain `hidden`.

## Uploads (mostly M6, listed here so nobody is surprised)

- `POST /api/upload/raw/start` accepts an optional `channel` slug. Parents without one land in the default
  (first) channel. `server-upload-v1.js` `publishVideo()` has no way to pass it yet.
- `role: "kid"` accounts can upload, only to their own channel (403 otherwise). `feed.js` shows the upload
  button only for `admin`/`super` (the `mountUploadFab()` call), so kids can't reach it from the UI yet.
- The upload status `clip` gains `channel` and `review`. A kid's upload to a channel with
  `review_uploads=1` finishes as `review: "pending"`. `feed.js` inserts the finished clip into the reel
  right away (`insertClipTop()`); it should instead say "Sent to a parent for review" when
  `review === "pending"`.
- `/api/admin/role` accepts `{ role: "kid", channel: "<slug>" }`; `admin.js`'s role select only offers
  `''` and `admin`.

## Cache busting

- At boot `server/static.mjs` hashes every `.js`/`.css` under `public/` and adds `?v=<12 hex>` to
  root-relative references like `src="/js/feed.js"` and `href="/css/kid.css"` in served HTML. Those URLs
  are served `max-age=31536000, immutable`. Bare or stale URLs get `no-cache`.
- Only HTML attributes are stamped. ES module `import` specifiers inside JS (`feed.js` imports
  `/js/server-upload-v1.js` and `/js/player-media-v1.js`) are not, so they revalidate on every load. That
  is correct but slower; M2 could keep them as is or fold them into the page's module graph.
- The hand-hashed CSS names (`style-4a90ad5ed053.css` and friends) are no longer needed, and all but
  `reset-…` no longer match their content anyway. M2 can rename them to plain names.
- Pages are stamped in memory and Brotli/gzip-compressed there, so a `.html.br` from
  `scripts/compress-assets.mjs` is now ignored. JS/CSS/SVG/JSON still use their precompressed files.

## Settings (`server/settings.mjs`)

Precedence is environment > `settings` table > default. An empty variable counts as unset; a bad value
stops startup.

| Key | Env | Default |
|---|---|---|
| `familyName` | `FAMILY_NAME` | `''` |
| `tagline` | `TAGLINE` | `A little channel. A big imagination.` |
| `gateTheme` | `GATE_THEME` | `ember-tape` |
| `accent` | `ACCENT` | `#ff5c2b` |
| `kidsPublic` | `KIDS_PUBLIC` | `true` |
| `signups` | `SIGNUPS` | `true` |
| `guestCodes` | `GUEST_CODES` | `true` |
| `reviewComments` | `REVIEW_COMMENTS` | `false` |

Theme ids are assumed to be `ember-tape, glass-gate, creature-feature, blueprint-workshop, arcade, comic-pow`
(the architecture notes say `arcade-crt`). M3 owns the ids; if they differ, change the `gateTheme`
default.

## Schema v2 at a glance

`settings`, `channels`, `views(clip_id, viewer, ts)` and `activity(id, ts, actor, kind, subject, detail)`
exist. Nothing writes `views` or `activity` yet (`POST /api/view` and activity recording belong to M6/M7).
`clips` has `channel_id`, `poster` and `review`; `upload_jobs` and `accounts` have `channel_id`; `comments`
has `hidden`. Deleting a clip deletes its likes, comments and views (trigger). An existing database with
clips gets one channel, `main` / "Main channel", holding all of them. A fresh install has no channel until
the first upload or the M5 wizard creates one. Where this differs from
`2026-10-21-architecture-notes.md`, the branch follows the plan; see the shared session notes.

## Rename checklist (brand-bearing identifiers left alone on purpose)

Changing these would break existing installs or clients, so they stay until the real rename:
`X-KidTube-Origin` header, `kid_access` cookie, `kid-session` localStorage key, `X-Kid-Email`/`X-Kid-Token`
headers, `data/kidtube.sqlite`, `kidtube-*.sqlite` backups, `KIDTUBE_ADMIN_EMAIL`/`KIDTUBE_ADMIN_PASSWORD`
(setup), the npm package and `create-kidtube` bin names, and the email copy (M2 owns the wording).
