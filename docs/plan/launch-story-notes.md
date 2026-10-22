# Launch story hand-over: time capsules, reactions and end of tape

Branch `claude/launch-story-14f38a`, cut from `foundation-clean` after M6. Built from the approved spec
`docs/superpowers/specs/2026-10-21-launch-story-bundle-design.md`, with the two adjustments from the brief: the
migration is **v4**, and the parent controls are standalone modules for M7's extension slots instead of edits to
`admin.js`. `npm test`: 230 pass (190 before).

## Slot wiring for M7 (`public/js/parent/extensions.js`)

Every module exports `mount(host, ctx)` and returns `{ update(ctx), destroy() }`. They build calm parent UI with the
`kp-` classes from `/css/parent.css` (each root carries `.kp` with `min-height: 0` and a transparent background, so
it works inside or outside a `.kp` page). `ctx.staff` is the signed-in parent's `{ email, t }`; without it a module
falls back to the stored `kid-session`. After a change a module dispatches a bubbling `kt:launch-change` event on its
host, `detail.kind` one of `capsule.seal`, `capsule.unseal`, `budget.set`, `budget.bonus`, `timezone`, so the dashboard
can refresh its rows.

| Slot | Module | ctx it reads |
|---|---|---|
| `clip-actions` (per video row) | `/js/launch/capsule-actions.js` | `{ clip, staff }`: `clip.id`, `clip.review`, and `opensAt`/`openedAt`/`capsuleNote` when present (adminOverview rows now carry them; otherwise it asks `GET /api/admin/capsules?id=`) |
| `person-settings` (per account) | `/js/launch/tape-budget.js` | `{ account, staff }`: `account.email`, `account.role` (parents get "Parents are never limited.") |
| `kid-settings` (per channel) | `/js/launch/kid-tape.js` | `{ channel, staff }`: `channel.slug`, `channel.name`. Shows each kid login's daily tape and the channel's capsules |
| none yet (settings screen) | `/js/launch/family-clock.js` | `{ staff }`. The family time zone with the local time as a check. There is no family-wide settings slot; mount it on the Settings screen, or add a `family-settings` slot |

`tape-budget.js` also exports `budgetControls(node, state, { staff, host })`, which `kid-tape.js` reuses.

Not done in the dashboard itself (M7 owns it): the overview's new per-clip fields (`reactions`, `sealed`, `opensAt`,
`openedAt`, `capsuleNote`) are there to show; a "Who watched" screen over `GET /api/admin/views`.

## Endpoints

Admin POSTs carry the parent's session in the body like every other admin route, so the account being changed is
`target` (the spec's `{email, minutes}` would have clashed with the session's `email`). Admin GETs accept
`?e=<base64url email>&t=` (adminOverview's form) or a parent's cookie.

| Route | Who | Notes |
|---|---|---|
| `POST /api/admin/clips/seal {email, t, id, opensAt, note}` | parents | approved clips; reseal changes the date or note |
| `POST /api/admin/clips/unseal {email, t, id}` | parents | opens now through the same path as the tick |
| `GET /api/admin/capsules?channel=&id=` | parents | every clip with a date, with `sealed`, `opensAt`, `openedAt`, `sealedBy` |
| `POST /api/admin/budget {email, t, target, minutes}` | parents | 0, 15, 30, 45, 60, 90, 120 or 180; parents refused |
| `POST /api/admin/budget/bonus {email, t, target, minutes}` | parents | 15 to 120, today only; accounts without a limit refused (409) |
| `GET /api/admin/budget?target=<email>` / `?channel=<slug>` | parents | one account's tape and today's use, or the kid logins on a channel |
| `GET`/`POST /api/admin/timezone {email, t, timezone}` | parents | 409 when `FAMILY_TIMEZONE` locks it |
| `GET /api/admin/views?channel=&viewer=&before=&limit=` | parents | rows `{clipId, clipTitle, channel, viewer, viewerName, started, seconds, duration, completed}`, newest first, `next` = the `before` for the next page (limit 100, max 500) |
| `GET /api/reactions` | cookie | `{counts, mine}`, sealed, hidden and out-of-pass clips left out |
| `POST /api/react {email, t, clipId, kind, on}` | signed-in accounts | guests 401 "log in to react", sealed 403, 60 writes a minute |
| `POST /api/view {clipId, seconds}` | cookie (guests too) | after 3 s of play; `seconds` credits up to 5 of them; 403 `end-of-tape` when spent |
| `POST /api/view/beat {viewId, seconds, completed}` | cookie | adds at most wall time since the last beat + 2 s; also posted as `sendBeacon` text |
| `POST /api/upload/raw/start` | creators | now takes `opensAt`, `capsuleNote` |
| `GET /api/clips` | cookie | sealed clips without media plus `sealed`, `opensAt`, `capsuleNote`, `sealedBy`; opened ones carry `openedAt`; `budget` (null when unlimited) |
| `GET /api/site` | public | `timezone` |

Media: `/api/video/<id>` and `/poster` answer `403 {error: 'sealed', opensAt}` for a sealed clip to anyone but
parents, and `/api/video/<id>` (not posters) `403 {error: 'end-of-tape', resetsAt}` for a spent tape. Both go through
one `canWatch(viewer, now, {clipId, poster})` hook that `index.mjs` hands to `uploads.mjs`, checked before any byte.
Comments, likes and legacy `/api/media/` of a sealed clip are refused by one route line at the top of `api.js`
(`env.capsules.guard`), and `/api/likes` drops sealed clips.

## Files

New: `server/capsules.mjs`, `reactions.mjs`, `watch.mjs`, `jsonio.mjs` (shared JSON and staff helpers);
`public/js/shell/capsules.js`, `reactions.js`, `watch.js`, `endings.js`; `public/js/launch/*.js`;
`test/capsules.test.mjs`, `reactions.test.mjs`, `watch.test.mjs`, `launch-frontend.test.mjs`, `family-fixture.mjs`.

Line-level edits, for the merge:

- `server/index.mjs`: three imports; a creation block after `env.notifications = notifications;` (capsules, reactions,
  watch, their timers, `canWatch` for uploads); `/api/reactions`, `/api/view`, `/api/view/beat` on the cookie-guard
  list; one mount line right before `if(pathname.startsWith('/brand/')`. Nothing near the setup module's lines.
- `server/api.js`: the sealed guard at the top of the router, the `/api/likes` route line, `clipsList` (capsule
  fields, `budget`), `adminOverview` (reactions and capsule fields). `me()` is untouched, so `/api/me` does not carry
  the budget; the feed reads it from `/api/clips`.
- `server/schema.mjs` v4: clip seal columns, `upload_jobs.opens_at/capsule_note`, `video_announcements.capsule_note`,
  `accounts.watch_budget_minutes`, `reactions`, `watch_bonus`, the real `views` table (the v2 one is dropped), the
  delete cascade recreated with reactions. Backed up first like every migration.
- `server/publish.mjs`: seal fields in `publishClip` (a sealed clip is announced when it opens, not when published);
  `approveClip` opens a capsule whose date passed while it waited and does not announce one still sealed.
- `server/uploads.mjs`: `opensAt`/`capsuleNote` validated at upload start, carried on the job; the `canWatch` option.
- `server/notifications.mjs`: the capsule subject ("A time capsule just opened on <kid>'s channel") and note,
  HTML-escaped.
- `server/settings.mjs` (`family_timezone`, `SERVER_TIMEZONE`), `server/site.mjs` (`timezone`),
  `server/access.mjs` (a guest viewer carries `guestId`, 12 hex of its token hash),
  `server/themes.mjs` (`accents.unlock/ending`, `endingCopy`).
- `public/js/feed.js`: imports, the locked slide, the rail button and chips, the running-order lock, the unlock hold in
  `playActive`, guards so likes and comments skip sealed clips, `openSealed()` (swaps a locked tape for the real clip
  once the server opens it), `bootLaunchStory()`, and the seal option on the upload name card (which had no CSS at
  all; it has basic styles in `feed.css` now).
- `public/js/shell/app.js`: `window.__ktChannel` gains `themeId`, `splashSound`, `timezone`.
- `public/js/server-upload-v1.js`: `publishVideo(..., channel, seal)`, a sixth optional argument.
- Themes: `unlock()` and `ending()` for Ember Tape, Arcade and Comic Pow, with `endingCopy`.
- `test/channels`, `settings`, `schema`, `themes` tests updated for the new fields.

## Choices worth knowing

- **Sealed is a clock read, never a flag.** `sealedFor()` in `capsules.mjs` is the one place the rule lives. The
  60 s tick only does the opening: re-lead, email, `capsule.open`. In the walkthrough a capsule opened 22 s after its time.
- **Opening re-leads the channel** on the server. A feed that is open at that moment swaps the locked tape for the
  clip where it is (no reorder mid-session) and plays the unlock when that slide is on screen. The unlock plays the
  first time an opened clip becomes active in its first week, not only at boot, once per device (`kt-opened-<id>`).
- **Sealing a clip that was already announced** does not announce it again when it opens: the outbox keys on the clip.
  Uploads sealed at upload time, and kid uploads approved after their date, get the capsule email.
- **A view's first seconds count.** A view starts after 3 s of play, and the client sends those seconds with the start
  (credited up to 5), so swiping through short clips cannot stretch a tape.
- **Warnings only on crossing.** The 5- and 1-minute pills show when the tape crosses them while playing, never for a
  threshold already behind the kid at boot or after a bonus. One pill each, one ending, no "ask for more" control.
- **Esc does not close the ending**: there is nothing behind it to go back to. "Done for today" goes to `/`.
- **A spent tape loads no video.** The slides carry no `src`, and the ending drops every file, so the end of tape logs
  no refused requests.
- **Budget enforcement trusts the feed's reports.** The 403 stops a stale client that keeps playing after zero; a
  tampered client that never reports watched time is not stopped. Fine for kids, worth saying in the docs (it is in
  OPERATIONS.md).

## Checked in the browser (built-in browser, localhost, scratch install outside the repo, invented names)

Fresh boot with no `.env` → the M5 wizard: parent Ines Varga, "The Varga Tapes", Pip (Ember Tape, login `pip`,
review on) and Lumi (Grape, Arcade, no login). Five ffmpeg test clips uploaded through the real upload API; viewer
Marta Kovacs signed up and was approved through the API.

- **Seal at upload**: upload card, "Seal as a time capsule", a time 30 minutes away refused with "Pick a date at least
  an hour away.", then sealed for three hours with a note. The feed showed the locked cassette, "Opens Thu, Oct 22,
  2026 / today at 9:17 AM", the note, "Sealed by Ines", and a lock in the running order. On the real routes the video
  and poster answered 403 `sealed` for Pip and 206/200 for the parent.
- **Unlock**: `opens_at` moved to a minute ahead directly in the scratch database (the seal rule needs an hour). The
  countdown went "in 2 minutes" → "any second now" → "opening now"; the server opened it on its tick (`capsule.open`,
  position 1); the feed played Ember Tape's unlock (the SEALED strip over the slot), removed it, set `kt-opened-<id>`
  and handed over to the clip.
- **Reactions**: Marta reacted Wow from the pill, then Star with the `3` key: chips "Wow. 1 person. You reacted.",
  the rail dot, `/api/reactions` agreed; Esc closed the pill with focus back on the button. A guest pass got 401 "log
  in to react" and counts only. At 390 px Pip reacted Fire from the keyboard; the pill fit (x 80–328).
- **Parent modules**, mounted by hand on `/parents` with `parent.css`: Pip's daily tape set to 15 minutes from the
  module's select ("Watched today: 0 of 15 minutes. Resets at 12:00 AM.", a `kt:launch-change` event); the parent row
  says "Parents are never limited."; kid-tape and capsule-actions and family-clock rendered with real data.
- **End of tape**: 13 minutes of use recorded in the scratch database, leaving 2. As Pip on Ember Tape: the pill
  "1:00 OF TAPE LEFT" (the theme's words), then the modal "End of tape" dialog: END OF TAPE, PIP-T-01, CTR 0:15:00,
  "That's the tape for today", "More tomorrow at 12:00 AM", "Done for today" focused, reel inert, videos paused. The
  server credited exactly 120 s, logged `budget.end` once, answered 403 `end-of-tape` for video and 200 for the
  poster. "Done for today" went to the front door. Lumi's channel showed Arcade's GAME OVER / INSERT COIN TOMORROW
  straight after the splash (zero at boot); with Lumi switched to Comic Pow in the database, THE END panel at 390 px.
- **Bonus**: "+15 min today" in the module → "15 of 30 minutes (including 15 bonus)" and Pip's feed opened again.
- **Who watched**: `GET /api/admin/views` returned the rows newest first with filters and paging; Pip got 403.
- 1440 and 390 px, no horizontal scroll. Console: no errors in the normal flows after the fixes; the 401/403 seen
  during the walkthrough came from a tab that lost its cookie (below) and from the pre-fix spent-tape preloads.

Fixed along the way: a 5-minute pill shown with only 2 minutes left; refused video preloads on a spent tape; the
ending's words unreadable on Comic Pow's ink; a freshly sealed upload showing a length.

## Not checked, deferred, or worth a look

- **Motion in a visible pane.** The browser pane was in the background (the session was not on screen), so CSS
  animations and `ctx.loop` froze at their first frame in screenshots: the burst, the unlock's tear, Arcade's score
  count-up, Comic Pow's slam-in. The theme work was played frame by frame in a scratch page by the agent that built it,
  including reduced motion. Worth one look with the pane visible before the demo GIF.
- **Reduced motion and sound in a real browser**: the pane cannot emulate `prefers-reduced-motion`; the code paths
  (shell skips the theme unlock, `data-kt-reduced` on the ending, the quiet single-sticker burst) are in place. Sound
  was not listened to; every new sound goes through `ctx.sound` and stays at gain ≤ 0.12.
- **Ember's ending snow** is grey noise at 15 fps for about 1.2 s at 30% opacity. Its average brightness is steady, so
  it is not a flash, but it is the closest thing to the rule; cut it to one still frame if you want to be stricter.
- **The browser tab lost its cookie once** mid-walkthrough (`/api/me` said nobody, the stored session was intact; a
  reload re-issued it). Nothing in this branch touches cookies; it looked like the pane's own state. If it shows up
  elsewhere, look at the shell's revalidate path.
- **Ember's pause label** (`PIP-T-01`, M3's pause accent) sits near the new reaction chips at the bottom left on phones.
- Spec items left for later: demo content (a capsule opening hourly, a 20-minute demo budget), the README GIF,
  re-announcing a capsule that was announced before it was sealed, a family-settings slot for `family-clock.js`.
