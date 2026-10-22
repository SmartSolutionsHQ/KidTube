# M7 hand-over: the parent dashboard and monitoring

Branch `claude/m7-parent-dashboard-8bda6c`, cut from `foundation-clean` after M6. `/parents` is now a calm,
phone-first dashboard built on M5's `kp-` kit, with its own server module. `npm test`: 211 pass (190 before M7).

## What landed

| Path | What |
|---|---|
| `server/monitor.mjs` | Every new staff route (below), activity rows for every change, last seen, the daily retention prune, and the `/parents` gate for kid and viewer accounts. Where `api.js` already did the work (rename, reorder, delete, approvals, roles, passwords, guest codes) it calls `api.fetch` as the parent and adds the activity row, so each rule lives in one place. |
| `server/index.mjs` | Two lines: `const monitor = (await import('./monitor.mjs')).createMonitor(...)` after `createSetup`, and `if(monitor.handle(req,res,pathname))return;` right after `setup.handle`. The cookie guard list is untouched. |
| `server/api.js` | `adminPassword` takes 8 characters for a kid account (`roleOf === 'kid'`), 12 for everyone else. Nothing else changed. |
| `public/parents/index.html` | Skeleton: top bar with Menu (phone), left nav (900 px and up), `main#kd-main`, a polite status line, the "{{brand.name}} by Smart Solutions" credit. Keeps `id="tza-root"` for `frontend-pages.test.mjs`. |
| `public/js/parent/` | `app.js` (sign-in, nav by role, `#/tab` routing, focus), `api.js` (session + `X-Kid-*` headers), `dom.js` (re-exports `/setup/ui.js`, plus buttons and an accessible `<dialog>` confirm), one module per tab (`home`, `review`, `kids`, `videos`, `comments`, `people`, `guests`, `activity`, `watched`, `settings`), pure `format.js`, `qr.js`, `watch-model.js`, and `extensions.js` + `slots.js`. |
| `public/css/parent.css` | A `kd-` section on top of the `kp-` kit: nav, summary cards, rows, feed, filters, stacked tables under 600 px, dialog, status line, print rules for the guest card. |
| `public/js/admin.js` | Deleted. Everything it did is in the new tabs (its "top fans" list is not carried over; per-video hearts and comments show on Videos). |
| Tests | `test/monitor.test.mjs` (13), `test/dashboard-qr.test.mjs` (3), `test/dashboard-watched.test.mjs` (2), `test/dashboard-parts.test.mjs` (3). |

## Routes (`server/monitor.mjs`)

All JSON, `Cache-Control: no-store`, session in `X-Kid-Email` / `X-Kid-Token` (the cookie alone is refused,
which is the CSRF guard). Staff = `super` or `admin`; Owner = `super`. Kid, viewer and signed-out callers get
`403`. Errors are `{ok:false, error}` in plain words.

| Route | Who | Answer / body |
|---|---|---|
| `GET /api/admin/summary` | staff | `{me, family, counts:{review, comments, people|null}, kids:[{id,slug,name,accent,logoUrl}], features:{views}}` |
| `GET /api/admin/storage` | staff | `{free, total, videos:{count, bytes}}` (bytes; `statfs` of DATA_DIR, files in `videos/`) |
| `GET /api/admin/activity?kind=&channel=&before=&limit=` | staff | `{rows:[{at, kind, channel, actor, text}], next}`; kinds `review upload comment people guest kids videos settings` |
| `GET /api/admin/review` / `POST {id, decision}` | staff | pending clips with poster, kid, uploader; `approveClip()` / `rejectClip()` |
| `GET /api/admin/clips?channel=` | staff | every clip of a kid with review, hidden, likes, comments |
| `POST /api/admin/clips/hide {id, hidden}` · `/rename {id,title}` · `/order {channel, order}` · `/delete {id}` | staff | delete cascades (trigger) and removes the file |
| `GET /api/admin/comments?status=waiting|showing|hidden|all` | staff | `{comments, mode}` |
| `POST /api/admin/comments/moderate {id, action: approve|hide|delete}` | staff | |
| `GET /api/admin/people` | owner | accounts with `lastSeen` |
| `POST /api/admin/people/status|role|password|delete {target, ...}` | owner | role is `''` or `'admin'` only; delete removes hearts, comments, watch history, queued emails, unused guest codes |
| `GET /api/admin/kids` · `POST /api/admin/kids` (`family.saveKid`) · `/kids/order {order:[ids]}` · `/kids/delete {id}` | owner | delete takes the kid's videos (files too), login and scoped passes; channel 1 and the last kid stay; `family` stays reserved |
| `GET /api/admin/guests` · `POST /api/admin/guests {channel, note}` · `/guests/end {id}` | staff | codes are listed by `id` = first 12 hex of `code_hash`; states `waiting active ended expired cancelled`; `viewer` = `guest:<12 hex of token_hash>` |
| `GET /api/admin/settings` · `POST {values:{...}}` · `POST /api/admin/settings/email-test` | owner | locked (environment) keys are skipped and named in `skipped`; only changed values are written |

`GET /parents` with a kid or viewer cookie answers `302 /`. Signed out, the page shows its sign-in card.

## How things are recorded

- **Activity**: every dashboard change writes a row (`clip`, `comment`, `person`, `guest`, `email`; `channel`
  from `family.mjs`, `review` from `publish.mjs`, `setting` from `settings.mjs`). The feed also reads uploads
  from `upload_jobs`, sign-up requests from `accounts`, comments from `comments` and code redemptions from
  `guest_codes`, so nothing needed hooks in files M7 doesn't own. The server writes the sentences
  (`describeActivity`, tested).
- **Last seen**, with no schema change: one `activity` row per person, `kind='seen'`, refreshed at most every
  5 minutes when the shell calls `/api/me` or the feed calls `/api/clips`. Guests are `guest:<12 hex of
  token_hash>`, the same id the views spec uses. The feed never shows these rows.
- **Comment states**: `hidden=1` is "waiting" unless the latest comment activity row says a parent hid it.
- **Retention**: activity older than `activity_retention_days` and views older than `views_retention_days`
  are pruned at boot and daily (works on the v2 `ts` and the v4 `started` column).

## Extension slots (for launch-story and later)

`public/js/parent/extensions.js` default-exports an array, empty in M7:

```js
import * as watchBudget from './watch-budget.js';
export default [{ slot: 'person-settings', module: watchBudget }];
```

The dashboard calls `module.mount(host, ctx)` once per slot it draws, inside a `div.kd-slot[data-slot]`.
`mount` may return a cleanup function or `{destroy()}`; it runs when that part of the page is redrawn or left.
A throwing `mount` is logged and its box removed. Every `ctx` has `api` (`get`, `post`, `maybe` with the
parent's headers), `say(text, level)`, `refresh()` (redraws that part) and `role`.

| Slot | Where | Extra ctx |
|---|---|---|
| `clip-actions` | each video row on Videos | `clip` (the `/api/admin/clips` row), `kid` |
| `person-settings` | each account on People (owner only) | `person` (the `/api/admin/people` row) |
| `kid-settings` | the kid editor on Kids (owner only), existing kids | `kid` (the `/api/admin/kids` row) |

Use the `kp-`/`kd-` classes (`kp-btn kp-btn-small`, `kp-field`, `kp-check`); never a second ember button.

## Roles as built

- Owner (`super`): all ten tabs.
- Co-parent (`admin`): Home (no "asking to watch" card, no watch history), Review, Videos, Comments, Guest codes,
  Activity. Kids, People, Who watched and Settings are hidden; the Kids, People and Settings routes answer 403.
  Checked in the browser.
- Kid and viewer accounts: `/parents` redirects to `/`; every route 403.

## Copy for pages outside M7's files

- Sign-up card (`public/js/shell/auth-dialog.js`): already says "A parent approves every new account before it
  can watch. Parents can see who watched what." No change needed.
- About page (`public/about/index.html`), add to "Who can watch", after the guest-code sentence:
  "Parents can see who watched which video and for how long. That history stays on the family's own server,
  is deleted after 90 days, and never includes IP addresses or device details."

## Checked in the browser (built-in browser, localhost, scratch install, invented names)

Fresh boot with no `.env` → wizard: parent Ines Okonkwo, "The Okonkwo Tapes", Tavi (Sky, Ember Tape, login
`tavi`, review on) and Odette (Grape, Arcade, no login). Four parent uploads (ffmpeg test clips) through the
upload routes; Tavi signed in at the front door (his feed with the upload button) and uploaded one (same
routes as the feed's button; his try at Odette's channel was refused). Then, at 390 px and 1440 px:

- Kid at `/parents` → sent to `/`; the dashboard API answers him 403.
- Home: cards (1 video, 0 comments, 1 person, free space), Watch first plays the pending clip, Approve → it
  leads Tavi's feed (checked in the feed page) and the nav count clears.
- People: approved Pell; reset Tavi's password to 8 characters and signed in with it; made Pell a co-parent and
  signed in as Pell (six tabs; `#/settings` falls back to Home).
- Comments: two held comments; one shown, one deleted through the confirm dialog (focus starts on Cancel).
- Videos: upload through the form to Odette, rename, move down, hide (viewer feed loses it, its file 404s for
  the viewer), show again (back, 200).
- Guest codes: Odette-only code for "Grandpa Femi", redeemed (scoped, refused on Tavi's channel), listed as in
  use with last use; an all-kids code cancelled. Chrome's `BarcodeDetector` reads the on-screen QR codes and
  encoder output for versions 2 to 10 at L and M.
- Kids: added Bram, moved him up (front door order follows), removed him; edited Odette's line and accent;
  badge builder and splash gallery open in the editor; Tavi (channel 1) has no Remove.
- Activity: filters by kind and kid. Settings: saved the tagline; the web-address change showed the warning and
  the new link before saving, then the old address refused changes and the new one signed in fine.
- Who watched: calm empty state; rendered in the page with a stubbed views answer (table on desktop, stacked
  rows at 390 px).
- No horizontal scroll at 390 px; no console errors and no failed requests across all ten tabs.

Fixed along the way: form buttons that didn't submit, focus lost after redraws, Home cards not updating,
the QR losing its colours when printed or copied, noisy settings rows, raw timestamps in the feed.

Not checked: a real print dialog (print CSS only), a real Brevo test send, the feed's own upload button (the file
picker can't be driven from the pane), real phones, reduced motion.

## Deferred

- **Listed / hidden kids**: needs a `channels.listed` column and a filter in `site.mjs`; both are outside M7
  (no schema changes here). Suggest `ALTER TABLE channels ADD COLUMN listed INTEGER NOT NULL DEFAULT 1` in the
  next migration, `publicChannel` skipping unlisted kids on the front door only, and a check in the Kids editor.
- The guest card's QR opens the site; the code is typed. A shell route like `#/code/K7Q2` that opens the Code
  card filled in would let the QR carry it (codes are one-use, so that is safe once redeemed).
- `public/css/page.css` still has the old `.tza-*` frame styles (M2's file); nothing uses them now.
- The shell header shows "Parents" to kid accounts; the server sends them back, but the link could hide.

## For launch-story

- Build `GET /api/admin/views` as the brief says; the dashboard asks for it only when
  `summary.features.views` is true, which is when the `views` table has a `started` column (your v4 shape).
  It sends `?channel=&viewer=&before=&limit=` and reads `{rows, next?}`; without `next` it pages from the
  last row's `started`. Guests show as "Guest (note)" by matching `viewer` to the guest list's `viewer`.
- Use the slots above for the daily-tape controls (`person-settings`) and "Seal…" (`clip-actions`).
- M7 prunes views daily by `views_retention_days`; your boot prune can stay.

## For M8 (PWA and docs)

- The dashboard is `/parents` plus ES modules under `/js/parent/` and `/setup/ui.js`, `/setup/helpers.js`; only
  `app.js` and the CSS are hash-stamped, the imports revalidate (`no-cache`). The service worker should cache
  that shell at most, never `/api/admin/*`, `/api/video/*` or `/brand/*`.
- Docs: a parent's tour of the dashboard (Review, Kids, Guest codes and the printable card, Who watched and
  how long it is kept); co-parents and what they can't see; moving the web address (sign in again at the new
  one); `ACTIVITY_RETENTION_DAYS` / `VIEWS_RETENTION_DAYS`.
