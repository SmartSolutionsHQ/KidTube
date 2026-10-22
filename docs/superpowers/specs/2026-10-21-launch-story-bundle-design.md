# M6.5 "Launch story": time capsules, reactions and end of tape

Status: approved design, 2026-10-21. Branch `launch-story`, cut after M6 merges.

## Why

The app's lane is "your kid's first YouTube channel, with an audience you choose". These three features
give the launch a story: a clip sealed until a birthday, Grandma's reaction bursting over the video, and a
daily watch limit that ends honestly in the theme's own language. Each is small enough to ship between M6
and M7, and all three show up in the demo, the README GIF and the Show HN post.

Out of scope here: video replies (needs browser recording; Studio milestone), premieres, milestones.

## What exists that this builds on

- `foundation-clean` with M2 (VHS front end, `public/js/shell/site.js`), M3 (theme kit, `public/js/shell/themes.js`,
  `docs/THEMES.md`, `pause()` accent contract) and M4 (badge builder, `public/badge/stickers.json` with 61 Fluent
  Emoji Flat stickers) merged.
- M5 (setup wizard) and M6 (shell router, per-channel feed via `?channel=`, kid `creator` accounts, `/api/me`),
  assumed merged before this branch starts. If M6 ships without `/api/me`, the budget block goes on `/api/clips`
  only (see End of tape).
- Schema v2: `clips(review, hidden, channel_id, position…)`, `views(clip_id, viewer, ts)` (never written),
  `activity`, `settings`. `publishClip()` in `server/publish.mjs`, `notifications.enqueue()` for new-video email.
- The cookie guard in `server/index.mjs` (the `['/api/clips', '/api/likes', …]` list plus `/api/video/`).
- Likes: `GET /api/likes` (counts for every clip plus the caller's), `POST /api/like {clipId, on}`.

## Ownership

| New | Edited (line-level) |
|---|---|
| `server/capsules.mjs`, `server/reactions.mjs`, `server/watch.mjs` | `server/schema.mjs` (v3), `server/api.js` (route lines, `clipsList`, `adminOverview`), `server/index.mjs` (guard list, three mount lines), `server/uploads.mjs` (`opensAt` on start), `server/settings.mjs` (`family_timezone`), `server/publish.mjs` (seal fields) |
| `public/js/shell/capsules.js`, `reactions.js`, `watch.js`, `endings.js` | `public/js/feed.js` (locked slide, rail button, hooks), `public/css/feed.css`, `public/js/admin.js` (seal, budget, bonus controls), `docs/THEMES.md`, `docs/OPERATIONS.md` |
| `public/themes/{ember-tape,arcade-crt,comic-pow}/` gain `unlock()` and `ending()` | `test/themes.test.mjs` (new exports), `test/schema.test.mjs` |
| `test/capsules.test.mjs`, `test/reactions.test.mjs`, `test/watch.test.mjs` | |

Module style: 2-space, SCREAMING_CASE constants, sparse why-comments, zero runtime dependencies, `node:test`.

## Schema v3

```sql
ALTER TABLE clips ADD COLUMN opens_at INTEGER NOT NULL DEFAULT 0;      -- ms epoch; 0 = not sealed
ALTER TABLE clips ADD COLUMN opened_at INTEGER NOT NULL DEFAULT 0;     -- set once by the capsule tick
ALTER TABLE clips ADD COLUMN sealed_by TEXT NOT NULL DEFAULT '';       -- account email
ALTER TABLE clips ADD COLUMN capsule_note TEXT NOT NULL DEFAULT '';    -- ≤140 chars
CREATE TABLE reactions (clip_id TEXT NOT NULL, email TEXT NOT NULL, kind TEXT NOT NULL,
  created INTEGER NOT NULL, PRIMARY KEY (clip_id, email, kind));
ALTER TABLE accounts ADD COLUMN watch_budget_minutes INTEGER NOT NULL DEFAULT 0;   -- 0 = no limit
DROP TABLE views;   -- v2 shape, never written
CREATE TABLE views (id INTEGER PRIMARY KEY, clip_id TEXT NOT NULL, channel_id INTEGER NOT NULL,
  viewer TEXT NOT NULL, started INTEGER NOT NULL, updated INTEGER NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0);
CREATE INDEX views_by_viewer_day ON views(viewer, started);
CREATE INDEX views_by_clip ON views(clip_id, started);
CREATE TABLE watch_bonus (email TEXT NOT NULL, day TEXT NOT NULL, minutes INTEGER NOT NULL,
  actor TEXT NOT NULL, created INTEGER NOT NULL);
CREATE INDEX watch_bonus_by_day ON watch_bonus(email, day);
```

The `clips_delete_cascade` trigger is recreated to also delete `reactions`. The `views` shape is M7's design
pulled forward; M7 builds "who watched what" on it without another migration. The migration keeps the v2
backup behaviour.

A clip is **sealed** when `opens_at > now`. Nothing stores "sealed" as a flag, so a clock-based read can
never serve a capsule early, whatever the tick does.

## Time capsules

### Sealing

- Who: any account that can upload (`super`, `admin`, and the kid role for its own channel: `kid` in
  M1's `/api/admin/role`, `creator` in the architecture notes; use whichever name M6 settled on). Viewers cannot
  upload yet, so a grandparent's capsule is uploaded by a parent on their behalf; the Studio milestone lifts
  that.
- When: at upload (`POST /api/upload/raw/start` accepts `opensAt` and `capsuleNote`; the feed's name card gets
  a "Seal as a time capsule" toggle revealing a date input and a note field) or later from the dashboard on any
  approved clip (`POST /api/admin/clips/seal {id, opensAt, note}`; `POST /api/admin/clips/unseal {id}` opens
  it now).
- Validation (`server/capsules.mjs`, `validateSeal(opensAt, note, now)`): `opensAt` between now + 1 hour and
  now + 25 years, whole minutes; note ≤140 printable characters, trimmed. Errors are readable
  (`{ok:false, error:"Pick a date at least an hour away."}`).
- A kid's sealed upload still goes through review. `sealed_by` is the uploader; `opened_at` stays 0.
- Activity rows: `capsule.seal`, `capsule.unseal` (actor, clip id, opensAt).

### Reading while sealed

`clipsList` keeps sealed clips in their channel order and returns, for each sealed clip:

```json
{ "id", "title", "channel", "publishedAt", "seq", "sealed": true, "opensAt": 1800000000000,
  "capsuleNote": "From Grandma. Open on your 10th birthday.", "sealedBy": "Grandma" }
```

and **no** `src`, `poster`, `duration`, `blurb` or `kind`. `sealedBy` is the account's first name. Opened clips
carry `openedAt` so the feed can play the unlock once.

Every other read of a sealed clip refuses unless the caller is staff (`super`/`admin`): `/api/video/<id>` and
`/poster` answer `403 {ok:false, error:"sealed", opensAt}`; `/api/comments?c=`, `POST /api/comment`,
`POST /api/like`, `POST /api/react` answer the same 403. `/api/likes` and `/api/reactions` omit sealed clips.
Staff bypass keeps the review queue and the dashboard preview working. A helper `sealedFor(sqlite, clipId,
session, now)` in `capsules.mjs` is the single place this rule lives.

### Opening

`capsules.tick(now)` runs at boot and every 60 s (`setInterval(...).unref()`):

1. Select clips with `opens_at > 0 AND opens_at <= now AND opened_at = 0 AND review = 'approved' AND hidden = 0`.
2. In one `BEGIN IMMEDIATE` per clip: set `opened_at = now`, re-lead its channel (`position + 1` on the
   channel's other clips, this clip to 1), `notifications.enqueue()` the clip with `capsule: true`, log
   `capsule.open`.
3. `notifications.kick()`.

The new-video email gets a capsule subject ("A time capsule just opened on Milo's channel") and the note; the
existing retry and unsubscribe paths are unchanged. A clip that is unsealed from the dashboard is opened
through the same function, so it also re-leads and announces. A clip still pending review when its date
passes is opened when a parent approves it (the approval path calls `tick` for that clip).

### In the feed (`public/js/shell/capsules.js`, `feed.js`)

- `slideMarkup()` renders a sealed clip as a **locked tape** slide: no `<video>`, a cassette drawn in CSS with a
  "SEALED" label, the title, "Opens <date>" with a day count (`in 212 days`, `tomorrow`, `today at 09:00`),
  the note, "Sealed by <name>". Swiping and the running order work as usual; the shelf row shows a lock
  instead of a thumbnail. Tapping the slide plays a 300 ms wobble (none with reduced motion). Likes,
  comments and reactions are hidden on the slide.
- Deep links to a sealed clip land on the locked slide.
- When the feed boots and the active clip has `openedAt` within the last 7 days and `localStorage`
  `kt-opened-<id>` is unset, the feed waits for the slide to be on screen, then runs the theme's `unlock()`
  (or the shell default) over the slot, sets the key, then plays. Reduced motion: an "Opened" label fades in
  and the clip plays. A blocked storage means the unlock plays each visit for that week, which is fine.
- Countdown text is computed in the family timezone sent by `/api/site` (`timezone` field, public).

### Theme hook: `unlock()`

```js
// optional, when manifest accents.unlock is true
export function unlock(host, ctx) {
  return { play() { /* ≤2500 ms, resolves when done */ }, destroy() {} };
}
```

`ctx` is the pause ctx plus `{ title, openedAt, note }`. The host sits over the slot, takes no pointer
events, and is removed after `play()` resolves or at 3000 ms. Ember Tape: the seal strip tears with an RGB
split and tape hiss. Arcade: "NEW TAPE UNLOCKED" with a chest sprite and the coin blip. Comic Pow: a
"KA-CHUNK!" burst panel. Shell default (`endings.js`): a paper seal splits and the tape label slides up.
Sound follows the pause-accent rule (only if `splash_sound` and after a gesture in this session).

## Reactions

### Kinds

`server/reactions.mjs` pins `KINDS = ['wow', 'flame', 'star', 'party', 'cool']`, each the id of a vendored
sticker in `public/badge/stickers.json`; a test asserts all five exist there. The feed draws them with the
badge renderer's sticker paths (same MIT source, already shipped). The heart stays as it is.

### API

- `GET /api/reactions` (cookie-gated, same guard list as `/api/likes`): `{ok, counts: {<clipId>: {wow: 3,
  flame: 1}}, mine: {<clipId>: ["wow"]}}`. Sealed and hidden clips are omitted.
- `POST /api/react {clipId, kind, on}` with the session headers likes use: validates `kind`, refuses guests
  (`401 "log in to react"` so the feed shows the guest prompt), refuses sealed clips (403), then
  `INSERT OR IGNORE` / `DELETE`. Returns `{ok, kind, on, counts: {<kind>: n}}` for that clip. Idempotent.
- Rate limit: 60 reaction writes per account per minute, in memory, 429 beyond.
- `adminOverview` adds `reactions: {wow: n, …}` per clip. No emails, no activity rows.

### In the feed (`public/js/shell/reactions.js`)

- The rail gets a reaction button (sparkle icon) between the heart and comments. Tap opens a horizontal
  pill of the five stickers anchored to the rail; tap outside, Esc, or a swipe closes it.
- Tapping a sticker: 6 to 10 copies burst from the button and float up over 900 ms (CSS keyframes, colour
  wash from `--tz-flare`, none with reduced motion: a single sticker fades), and the kind toggles on through
  the API with optimistic paint and rollback, like `toggleLike()`. Tapping an already-on sticker bursts
  again without toggling; a long press (500 ms) toggles it off.
- Counts appear as sticker chips under the caption: `[wow] 3  [flame] 1`, hidden when all zero. The
  rail button shows a dot when the viewer has reacted.
- Keyboard: `r` opens the pill, `1`–`5` pick, Esc closes. Screen readers: the pill is a `group` of toggle
  buttons with `aria-pressed` and labels like "Wow. 3 people."
- Guests get the existing guest prompt. Sealed slides have no reaction button.

## End of tape

### Settings and data

- `family_timezone` setting: IANA name, validated with `Intl.supportedValuesOf('timeZone')`, env
  `FAMILY_TIMEZONE`, default `Intl.DateTimeFormat().resolvedOptions().timeZone` at first boot (stored by
  setup/wizard so a server move does not shift days). Public in `/api/site` as `timezone`.
- `accounts.watch_budget_minutes` per account, set by `super`/`admin` with `POST /api/admin/budget {email,
  minutes}` (`0` or one of 15, 30, 45, 60, 90, 120, 180). Never applies to `super`, `admin` or guests, even
  if set.
- `POST /api/admin/budget/bonus {email, minutes}` (15 to 120) adds a `watch_bonus` row for today. Activity
  rows: `budget.set`, `budget.bonus`, and `budget.end` when a viewer hits zero (once per day per account).

### The ledger (`server/watch.mjs`)

- `dayKey(now, timezone)` → `YYYY-MM-DD` in the family zone; `resetsAt(now, timezone)` → next local midnight
  in ms. Both pure and tested across a zone change and a DST day.
- `POST /api/view {clipId}` after 3 s of play: inserts a `views` row (`viewer` = email, or `guest:<12 hex>`
  from the guest token hash; staff are recorded too, for M7), returns `{ok, viewId, budget}`.
- `POST /api/view/beat {viewId, seconds, completed}` every 15 s while playing, and via `sendBeacon` on
  pause, end, swipe away and `visibilitychange`. The server adds `min(seconds, elapsedSinceLastBeat + 2)`
  to the row, so a client cannot bank time; `completed` sets the flag.
- `budgetFor(email, now)` → `null` for unbudgeted accounts, else `{limit, used, remaining, resetsAt}` in
  seconds, `limit = watch_budget_minutes*60 + today's bonus*60`, `used = SUM(seconds)` of today's views.
- `/api/clips` and (when it exists) `/api/me` include `budget` for budgeted accounts; every `/api/view*`
  response does too.

### Enforcement

When `remaining <= 0` for a budgeted account, `/api/video/<id>` (not posters) answers `403 {ok:false,
error:"end-of-tape", resetsAt}`. The check runs before the Range handling, inside `uploads.handle` via a
`canWatch(session, now)` callback the server passes in, so `uploads.mjs` stays free of budget logic. The
client ends the session cleanly on the heartbeat response first; the 403 is the backstop for a tampered or
stale client.

### In the feed (`public/js/shell/watch.js`, `endings.js`)

- `watch.js` owns the view start, heartbeats and beacons by listening in the capture phase on `.tz-slide
  video` events (`play`, `pause`, `ended`, `timeupdate`), the same pattern as `attachPause()`, so `feed.js`
  only calls `attachWatch({ budget, timezone, onEnd })` after boot.
- Pills at 5 min and 1 min remaining, in the theme's voice when the theme provides `endingCopy` in its
  manifest (optional, `{warn5, warn1}` strings ≤40 chars), else "5 minutes of tape left".
- At zero: pause the active video, set the reel `inert`, and show the theme's `ending()` (or the shell
  default) full-screen in a modal dialog labelled "End of tape". Copy: title "That's the tape for today",
  line "More tomorrow at 00:00" (local reset time), and one button "Done for today" that closes the feed
  and returns to the front door. No "ask for more time" control. Reduced motion shows the finished frame.
- If the viewer already has zero remaining at boot, the ending shows instead of the feed.

### Theme hook: `ending()`

```js
// optional, when manifest accents.ending is true
export function ending(host, ctx) {
  return { show({ resetsAt, used, limit }) {}, destroy() {} };
}
```

`ctx` is the pause ctx plus `{ title, number, slug }`. The host covers the viewport, is a `dialog`, and the
shell renders the "Done for today" button inside it after `show()` (marked `data-kt-done`, focused by the
shell). Ember Tape: the picture tears, snow rolls, "END OF TAPE" in the OSD font. Arcade: "GAME OVER /
INSERT COIN TOMORROW" with the CRT curve. Comic Pow: a "THE END" panel with a halftone wipe. Shell default:
the tape counter runs to zero on ink.

### Dashboard (minimal; M7 restyles)

- People tab: a "Daily tape" select per approved non-staff account, today's used minutes, a "+15 min today"
  button. Staff rows show "Parents are never limited".
- Videos tab: a "Seal…" action (date, note) on approved clips; sealed rows show "Sealed until <date>" and an
  "Open now" action.
- Settings: the timezone, shown with the current local time as a check.

## Security and privacy

- Sealed media is refused server-side for everyone but staff; a test copies a sealed clip's URL into a
  signed-in viewer session and asserts 403.
- The ledger stores no IP or user agent. Views keep the existing `views_retention_days` prune (M7 schedules
  it; this branch prunes at boot).
- Reaction and view writes go through the same origin check and session headers as likes. No new cookies.
- Themes' new exports obey the existing static rules (no network, no HTML strings, scoped CSS). The shell
  defaults live in `endings.js` so a missing or broken theme export never blocks the viewer.
- Nothing here changes CSP or adds third-party requests.

## Tests

`node:test`, with the existing helpers (`test/helpers.mjs` boots an app on a temp DB):

- **schema**: v2 → v3 on a DB with clips, likes and accounts; new columns and tables present; cascade
  deletes reactions; backup written.
- **capsules**: `validateSeal` bounds; sealed clip appears in `/api/clips` without media fields and with
  the capsule fields; 403 for video, poster, comments, like, react as a viewer; 200 for staff; `tick` opens
  once, re-leads, enqueues one announcement, logs; unseal opens now; pending-then-approved opens on approval;
  a clip sealed with a past date is refused.
- **reactions**: five kinds exist in stickers.json; toggle on/off idempotent; counts; guest 401; unknown
  kind 400; sealed 403; rate limit 429; overview carries counts.
- **watch**: `dayKey`/`resetsAt` across `America/Los_Angeles` DST and a zone change; beat clamp (a 600 s
  claim after 15 s wall time adds 17); unbudgeted accounts get `budget: null`; a 30-minute budget reaches
  zero and video answers 403 while poster still serves; staff and guests never budgeted; bonus extends
  today only; reset after local midnight (clock injected); `budget.end` logged once per day.
- **themes**: manifests with `accents.unlock` / `accents.ending` must export those functions and vice
  versa; new exports pass the static rules; `endingCopy` length.
- **browser pass** (built-in browser, localhost, invented names, synthetic clips): seal at upload, see the
  locked tape, set `opens_at` to a past time directly in the test database, restart, and watch the
  unlock in Ember and Glass Gate; react and see counts; a 1-minute budget ending in Ember, Arcade and Glass
  Gate at 390 px and 1440 px; reduced motion for all three.

## Rollout notes

- Existing installs upgrade through the migration; nothing is sealed or budgeted until a parent acts.
- `docs/OPERATIONS.md` gains a "time capsules and daily tape" section; the README feature list gains the
  three lines; `docs/THEMES.md` documents `unlock()`, `ending()` and `endingCopy`.
- Demo content for the public demo (later): one capsule opening at the top of each hour, a 20-minute budget
  on the demo viewer account.
