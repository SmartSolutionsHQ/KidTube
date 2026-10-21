# Notes for M2 (and later milestones) from M1, branch `foundation`

M1 changed only `server/`, `scripts/`, `test/` and docs. The current `public/` still works unchanged
(checked in a browser on the final branch: splash, login, feed with posters, video playback, parent
dashboard). The contracts below follow `2026-10-21-architecture-notes.md` for the brand module
and setting keys; the plan's decisions win where the two differ (`kids_public` defaults to true).

## Brand

- `server/brand.mjs` is the only server file that spells the product name: `BRAND_NAME`, `WORDMARK`,
  `TAGLINE`, `ENDORSEMENT` ("by Smart Solutions"), `DEFAULT_ACCENT` (#FF5C2B). `test/brand.test.mjs`
  fails on `KidTube|KIDTUBE` anywhere else in `server/`. M2 should extend that test to `public/`.
- Served HTML gets `{{brand.name}}`, `{{brand.wordmark}}`, `{{brand.tagline}}`, `{{brand.endorsement}}`
  and `{{brand.accent}}` filled in (HTML-escaped) by `server/static.mjs`. Unknown tokens are left as they
  are, so a typo shows up on the page. Scripts read the name from `/api/site`.
- `docs/RENAMING.md` lists what changes in the rename and the internal ids that stay.

## New endpoints

`GET /api/site` (public, `Cache-Control: no-store`):

```json
{ "ok": true, "brand": { "name": "KidTube", "endorsement": "by Smart Solutions" },
  "siteName": "", "tagline": "A little channel. A big imagination.", "accent": "#FF5C2B",
  "gateTheme": "ember-tape", "badge": null, "splashSound": true, "signupMode": "approval",
  "guestPasses": true, "setup": "complete", "kidsPublic": true,
  "channels": [{ "slug": "main", "name": "Main channel", "kicker": "", "accent": "#FF5C2B",
                 "themeId": "ember-tape", "logoUrl": null }] }
```

- `channels` is `[]` whenever `kidsPublic` is false. Never read kid names from anywhere else before sign-in.
- A channel's empty `accent`/`themeId` is already filled from the family's `accent`/`gateTheme`.
- `logoUrl` is `null` until the channel has a badge (`channels.logo_rev > 0`). The `/brand/<slug>.svg`
  route is not built yet (M4/M5), so show the name or initials when it is null.
- `setup` is `"complete"` when the `setup_complete` setting is true (existing installs and
  `scripts/setup.mjs` set it), otherwise `"required"` for M5's wizard.
- Channel 1 (`main`, "Main channel") always exists: the migration seeds it and a trigger refuses to delete
  it. The first kid takes it over by renaming it (M5).

`GET /api/channels` (needs the `kid_access` cookie, 401 otherwise): `{ ok, channels: [...] }` with the same
fields plus `tagline`, listed even when `kidsPublic` is off.

## Changed responses

- `/api/clips` has only `review='approved'` and `hidden=0` clips, ordered channel by channel (channel
  `position`, then clip `position` within the channel). `?channel=<slug>` returns one channel. Each clip
  gains `channel` (slug), and `seq` is now its place in the returned list, which `feed.js` already sorts by.
- `poster` is filled for new uploads: `/api/video/<uploadId>/poster`, cookie-gated and `no-store` like the
  video. Clips uploaded before M1 have `poster: ""`.
- Review states are `pending`, `approved` and `rejected`. `hidden` is a separate flag, so unhiding a clip
  never skips review.
- Login failures are always `401 { ok: false, error: "Wrong email or password." }`; the old
  `404 "no account"` and `401 "wrong password"` are gone. `entrance.js` and `admin.js` already show
  `j.error`.
- Login success and a valid `/api/check` now include the canonical `email`; the server sets the cookie
  from it. Store that `email` in `kid-session` rather than what the user typed.
- `/api/check` without a valid `t` always answers `200 { ok: true, status: "none", role: "" }`, whatever the
  email. `feed.js` `sessToken()` calls it without `t` hoping to get one back; that never worked, so M2
  can delete that branch.
- `/api/signup` 409 is now `{ ok: false, error: "exists" }` without the other account's `status`, and the
  success response no longer includes `notifyErr` (the server logs it).
- New 403s with a readable `error`: `/api/signup` when `signup_mode` is `closed`; `/api/guest/generate` and
  `/api/guest/redeem` when `guest_passes` is off; `/api/comment` when `comments_default` is `off`.
- `POST /api/comment` returns `row.hidden: true` while `comments_default` is `review`, which is the default
  for new installs (installs upgraded from before M1 are set to `open`). The comment is saved but stays out
  of `/api/comments` until a parent unhides it, and there is no unhide UI until M7. The feed should show
  "Waiting for a parent" on that row instead of rendering it like a normal comment.
- `/api/admin/overview` clips gain `review`, `hidden` and `channel`, with `position` counted per channel;
  `recent` comments gain `hidden`.

## Uploads (mostly M6, listed here so nobody is surprised)

- `POST /api/upload/raw/start` accepts an optional `channel` slug; parents without one land in channel 1.
  `server-upload-v1.js` `publishVideo()` has no way to pass it yet.
- It now answers `507` with a readable `error` when the data disk has less than twice the upload plus 1 GB
  free.
- `role: "kid"` accounts can upload, only to their own channel (403 otherwise). `feed.js` shows the upload
  button only for `admin`/`super` (the `mountUploadFab()` call), so kids can't reach it from the UI yet.
- The upload status `clip` gains `channel` and `review`. A kid's upload to a channel with
  `review_uploads=1` finishes as `review: "pending"` and is not announced by email. `feed.js` inserts the
  finished clip into the reel right away (`insertClipTop()`); it should instead say "Sent to a parent for
  review" when `review === "pending"`.
- `/api/admin/role` accepts `{ role: "kid", channel: "<slug>" }`; `admin.js`'s role select only offers
  `''` and `admin`.
- Transcodes strip container metadata, so phone GPS and location tags never reach viewers.

## Cache busting

- At boot `server/static.mjs` hashes every `.js`/`.css` under `public/` and adds `?v=<12 hex>` to
  root-relative references like `src="/js/feed.js"` and `href="/css/kid.css"` in served HTML. Those URLs
  are served `max-age=31536000, immutable`. Bare or stale URLs get `no-cache`.
- Only HTML attributes are stamped. ES module `import` specifiers inside JS (`feed.js` imports
  `/js/server-upload-v1.js` and `/js/player-media-v1.js`) are not, so they revalidate on every load. That
  is correct, just not free; M2 can leave them or fold them into the page's module graph.
- The hand-hashed CSS names (`style-4a90ad5ed053.css` and friends) are no longer needed, and all but
  `reset-…` no longer match their content anyway. M2 can rename them to plain names.
- Pages are stamped and Brotli/gzip-compressed in memory, so a `.html.br` from
  `scripts/compress-assets.mjs` is ignored. JS/CSS/SVG/JSON still use their precompressed files.

## Settings (`server/settings.mjs`)

`get()` returns a non-empty environment variable (which locks the setting), then the `settings` table,
then the default. A bad environment value stops startup. `set(key, value, actor)` validates and records an
`activity` row (`kind: 'setting'`; secret values logged as `(hidden)`). `describe()` lists every setting
with its `source` (`env`, `db`, `default`), `locked`, `public` and `secret`, secrets masked.

| Key | Env | Default | Values |
|---|---|---|---|
| `site_name` | `SITE_NAME` | `''` | text, 60 |
| `site_tagline` | `SITE_TAGLINE` | brand tagline | text, 120 |
| `site_url` | `SITE_URL` | `''` (required to boot) | HTTP(S) origin |
| `family_accent` | `FAMILY_ACCENT` | `#FF5C2B` | `#rrggbb` |
| `gate_theme` | `GATE_THEME` | `ember-tape` | theme id |
| `family_badge` | none | `null` | JSON object under 4 KB (M4 validates the spec) |
| `kids_public` | `KIDS_PUBLIC` | `true` | boolean |
| `signup_mode` | `SIGNUP_MODE` | `approval` | `approval`, `closed` |
| `guest_passes` | `GUEST_PASSES` | `true` | boolean |
| `comments_default` | `COMMENTS_DEFAULT` | `review` | `review`, `open`, `off` |
| `review_uploads_default` | `REVIEW_UPLOADS_DEFAULT` | `creators` | `creators`, `none` (default for new channels; nothing creates channels yet) |
| `mail_mode` | `MAIL_MODE` | `disabled` | `disabled`, `brevo` |
| `brevo_api_key` | `BREVO_API_KEY` | `''` | secret |
| `notify_email` | `NOTIFY_EMAIL` | `''` | email |
| `sender_email` | `SENDER_EMAIL` | `''` | email |
| `splash_sound` | `SPLASH_SOUND` | `true` | boolean |
| `views_retention_days` | `VIEWS_RETENTION_DAYS` | `90` | 1 to 3650 |
| `activity_retention_days` | `ACTIVITY_RETENTION_DAYS` | `365` | 1 to 3650 |
| `setup_complete` | none | `false` | boolean |

`HOST`, `PORT`, `TRUST_PROXY`, `SIGN_SECRET`, `DATABASE_PATH`, `DATA_DIR` and `PUBLIC_DIR` stay
environment-only. The server reads site and mail settings live, so a saved change applies without a
restart (the "email needs a key" check still only runs at boot). The theme ids are assumed to match M3's
`ember-tape, glass-gate, creature-feature, blueprint-workshop, arcade-crt, comic-pow`.

## Schema v2 at a glance

- Tables: `settings`, `channels`, `views(clip_id, viewer, ts)` and
  `activity(id, ts, actor, kind, subject, detail)`. Nothing writes `views` yet, and only settings changes
  write `activity` (`POST /api/view` and the rest of the activity feed belong to M6/M7).
- Link columns: `clips`, `upload_jobs` and `video_announcements` have `channel_id NOT NULL DEFAULT 1`
  without a foreign key; `accounts.channel_id` is nullable (set only for kid accounts). Code that writes
  them checks that the channel exists.
- New columns: `clips.review`; `comments.hidden`.
- Deleting a clip deletes its likes, comments and views (trigger).
- `migrate(sqlite, { dataDir })` copies an existing install to
  `<dataDir>/backups/pre-migrate-v<from>-<time>.sqlite` before upgrading it, and refuses a database newer
  than the app.
- Kept on purpose: `/api/media/*` and `media_chunks`, for TanzenTube or Worker-era clips stored as chunks.
