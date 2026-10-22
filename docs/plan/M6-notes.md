# M6 hand-over: the multi-kid viewer flow

Branch `claude/m6-viewer-flow-65a55b`, cut from `foundation-clean` after M5. Families now pick a kid at the front
door, watch that kid's splash, sign in on the glass card and land in that kid's feed. Kids post to their own channel
and their uploads wait for a parent. `npm test`: 190 pass (175 before M6).

## What landed

| Path | What |
|---|---|
| `public/js/shell/route.mjs` | Pure router: `parseRoute(hash)` → `home`, `channel {slug}`, `clip {slug, id}`, `legacy {id}`; `channelHash(slug, id)`; `DEEP_LINK` (the regex feed.js carries inline; a test keeps them equal). |
| `public/js/shell/app.js` | The shell: `/api/site` → `/api/me` → door, splash, sign-in, picker, feed. Sets `window.__ktChannel` and `window.__ktShell` for feed.js. |
| `public/js/shell/gate.js` | `#kt-door` faces: `door` (badges), `lobby` (still backdrop behind the card), `note` (errors). |
| `public/js/shell/picker.js` | Kid badge buttons in accent rings, the "Switch kid" sheet, `switchTo()` (pushState + reload). |
| `public/js/shell/auth-dialog.js` | The account card (Log in / Sign up / Code, kid handles), the profile (intro skip, switch kid, dashboard, log out), session helpers. Replaces `entrance.js` (deleted). |
| `public/css/shell.css` | Door, kid grid, lobby, switch sheet, empty channel, "Sent to a parent". `kid.css` lost the old static door. |
| `public/js/feed.js` | 27 changed lines: `?channel=`, both deep-link forms, channel-aware `replaceState`, shell empty state, "1 CLIP", upload button rule, pending upload → `sentToParent`, `__tzfeed.pick()`. |
| `public/js/server-upload-v1.js` | `publishVideo(..., channel)` sends the slug. |
| `server/channels.mjs` | `canViewChannel(viewer, channel)`, `canPlayClip(viewer, clip)`, `isStaff`, `CLIP_ACCESS_SQL`. |
| `server/api.js` | `GET /api/me`, `GET /api/clips/locate?id=`, `POST /api/admin/clips/review`, channel checks in clips/likes/comments/legacy media, scoped guest codes. |
| `server/publish.mjs` | `approveClip(sqlite, notifications, id, actor)` → channel slug or null; `rejectClip(sqlite, id, actor)`. |
| `server/uploads.mjs` | `/api/video/<id>` and `/poster` play only through a clip the viewer may play. |
| `server/notifications.mjs` | `watchLink()`: emails link `#/c/<slug>/v/<id>`. |
| Tests | `test/route.test.mjs`, `test/viewer-flow.test.mjs`, additions to `uploads`, `notifications`, `frontend-pages`. |

Small edits outside the listed files, each needed for the above: `server/index.mjs` (computes the cookie viewer once
for `/api/*`, passes it to `api.fetch(..., { viewer })` and `uploads.handle(..., viewer)`, guards `/api/clips/locate`,
exposes `env.sqlite`/`env.notifications` for the review route), `server/access.mjs` (guest viewer carries
`channelId`), `server/site.mjs` (`channels(viewer)` filters), `server/schema.mjs` (v3), `server/static.mjs` and
`scripts/compress-assets.mjs` (`.mjs` served and fingerprinted as JavaScript, so `route.mjs` loads in the browser).

## Rules the server enforces

- Approved accounts (viewers, kids, parents) see every kid. A guest pass may carry one channel
  (`guest_codes.channel_id`, schema **v3**); `NULL` is the whole family.
- `/api/clips` lists approved, unhidden clips on channels the viewer may see. `?channel=` outside a guest pass is
  `403`; an unknown slug is an empty list.
- `/api/channels` lists only what the viewer may see.
- `/api/video/<id>`, its poster and legacy `/api/media/<id>` need a clip row that `canPlayClip` allows. Pending,
  rejected and hidden clips play for staff and their uploader (the upload job's email) only. Refusals are `404`, same
  as a missing file. A file without a clip row (still processing) is `404` for everyone.
- `/api/comments?c=` on a clip the viewer can't play answers an empty list; `/api/likes` counts for a scoped guest
  cover only that channel.
- `/api/clips/locate?id=` answers `{ok, id, channel, review}` or `404` (unknown and refused look the same).
- Uploads: staff anywhere (default channel when none is sent); a kid only to their own channel (`403` otherwise,
  M1's rule). Review applies when the channel has `review_uploads` and the uploader isn't staff.
- `POST /api/admin/clips/review {email, t, id, decision: 'approve'|'reject'}`, staff only. Approve moves the clip
  to the top of its channel (positions may have gaps; only order matters), queues the new-video email and logs
  `activity(kind='review')`. Approving an already live clip or an unknown id is `404`.
- `POST /api/guest/generate {..., channel: '<slug>'}` makes a scoped pass; `redeem` and `validate` return `scope`.
- `GET /api/me` → `{viewer: null}` or `{role, email, first, channel}` (channel = a kid account's own slug) or
  `{role: 'guest', scope}`. Never `401`.

## The shell's flow

1. `/api/site`; `setup: 'required'` → `/setup`. `whoAmI()`: `/api/me`; a stored session whose cookie lapsed is
   re-checked once; an account cookie without its stored token counts as signed out (it can't like or upload).
2. Signed out, kids listed: door → pick → `lobby` + the kid's splash → card (Esc or "All kids" returns to the door).
   A link naming a listed kid, or a family with one kid, skips the door. "Parent? Sign in" opens the card over the
   family lobby. Kids hidden (`kids_public` off): family splash (`gate_theme`) → card; no kid names anywhere.
3. Signed in: channel from the link, a located clip, the only channel, or the picker. Then `enterChannel()`:
   address, header (`showChannel`), theme feed variables on `body`, the kid's splash (unless it just played at the
   door), `kid:unlocked` right away so clips load behind it, `tz:enter` on dismiss, then the pause accent and header.
4. Switching kids: the sheet or the profile → `history.pushState` + reload; Back reloads on `hashchange`.

Focus: door title → kid buttons; splash Enter (the loader's); card's first field; feed reel. Esc: door nothing,
splash skips, card back to the door (stays when there is no door), profile/switch/sent close. Targets are 44 px or
more; badge hover tilt, the REC blink and the bar fill stop under reduced motion. Feed video starts muted and
recovery.js holds it until the first tap; splash sound is the loader's rule (only after a tap inside the splash).

## Choices worth knowing

- **Schema v3 is M6's** (guest scope). The launch-story spec's "Schema v3" becomes **v4**.
- The kid role is **`kid`** (M1/M5), not `creator`. `/api/me` exists, so the launch-story budget block can go there.
- `feedVars(theme, accent)` goes on `body`, as M3 asked. Themes that pin `--tz-flare` (Comic Pow yellow, Blueprint
  blue) therefore win over the kid's accent inside the feed; the door, splash and header use the kid's accent.
- The pause accent attaches after the first `playing` event, so a clip held until the first tap doesn't open on
  "PAUSED". On phones the pause host starts below the top bar and sound pill (shell.css), without theme changes.
- The splash `number` is the kid's place in the list the viewer sees (a one-kid pass shows "01").
- "Skip <name>'s intro next time" lives in the account card (M3's `alwaysEnter`). Themes still render only Enter.

## Checked in the browser (built-in browser, localhost, scratch install, invented names)

Fresh boot with no `.env` → M5 wizard: parent Noor Halvorsen, "The Halvorsen Tapes", Ezra (ember, Ember Tape,
login `ezra`, review on) and Marisa (grape, Arcade, no login), badges from the builder's shuffle. Then:

- Signed-out door at 1440 and 390: family kicker, "Who's on tape today?", both badges in accent rings, "Parent? Sign
  in"; no horizontal scroll. Ezra → Ember Tape splash → glass card with focus in the first field; Esc back to the
  door with focus on the title.
- Parent signs in from Ezra's card → Ezra's empty channel ("No tapes yet", "Record your first tape") → two uploads
  (ffmpeg test clips) appear with `#/c/ezra/v/<id>`; picker → Marisa's Arcade splash ("LEVEL 02") → two uploads.
- Ezra signs in with `ezra` at 390 → his feed with the upload button; his upload shows "Sent to a parent … shows up on
  Ezra once a parent says yes" and stays out of the feed; on Marisa's channel he has no upload button.
- Parent approves through `POST /api/admin/clips/review` → `#/v/<id>` (old form) resolves to `#/c/ezra/v/<id>`
  with the clip on top.
- A Marisa-only guest code redeemed from Ezra's card lands in Marisa's channel (her splash, no "Switch kid");
  `#/c/ezra/...` falls back to Marisa; Ezra's clips list is 403 and locate 404.
- VHS pause: Ember Tape's static, "■ PAUSED", `EZRA-T-01`; Arcade's pixel pause for Marisa.
- Laptop: stage plus "Running order", end plate "THE END · 2 CLIPS · SINCE OCT 22 2026".
- `kids_public` off: family splash, no kid names in the page or `/api/site`; after sign-in the picker shows both.
- Console: no errors in normal flows; only the expected 403/404 when probing refused URLs.

Fixed along the way: dialogs pinned top-left (the reset zeroes dialog margins), the stage clipping the empty
channel, a pass scoped to another kid inheriting the door kid's "already played" splash, a stale-slug link losing
its clip.

Not checked: reduced motion in a real browser setting (the pane can't emulate it; the CSS rules are in place), the
file picker behind "Record your first tape" (uploads were driven through the feed's own `uploadFile`), real phones.

## For M7 (dashboard)

- The review queue: list `adminOverview` clips with `review='pending'`, play them (staff pass `canPlayClip`), and call
  `POST /api/admin/clips/review` or `approveClip()`/`rejectClip()` from `server/monitor.mjs`.
- Guest passes: add a kid select that sends `channel` to `/api/guest/generate`; show `scope` on the code.
- `admin.js` uploads through `publishVideo(file, name, staff(), prog)` with no channel, so dashboard uploads land on
  channel 1; pass the chosen kid's slug as the fifth argument.
- Reuse `canViewChannel`/`canPlayClip` for "who watched what" and comment moderation.
- `/api/admin/password` still needs 12 characters, so kid passwords (8) can't be reset there yet (M5 note).

## For the launch-story milestone

- Migration numbers: take **v4**. `views` is still the v2 shape (never written), as the spec assumes.
- Sealed clips: `canPlayClip()` in `server/channels.mjs` is where a `sealedFor()` check plugs in for media;
  `clipsList` already maps rows in one place for the capsule fields; feed deep links go through `DEEP_LINK`.
- Budget: `/api/me` exists; add `budget` there and in `/api/clips`. `uploads.handle(req, res, pathname, viewer)` now
  receives the viewer, so `canWatch(session, now)` can take it from there.
- "Done for today" returning to the front door: call `location.assign('/')`; the shell shows the door or picker.
- Reactions and unlocks attach like the pause accent: after `enterChannel()` in app.js, with `window.__ktChannel`.

## Follow-ups (not done here)

- The upload name card is still feed.js's mono card; the canvas's "What's it called? / Record it to tape" restyle is
  copy and CSS (`.tz-namecard-*`), left for a polish pass to keep feed.js edits small.
- The "Sound off" pill and the Ember pause OSD can still touch on very short phones.
