# Demo mode hand-over (2026-10-22)

Branch `claude/demo-mode-7e70b8`, cut from `foundation-clean` (M8 merged). Not pushed, no PR.
`npm test`: 272 pass on Node 24.18 (259 before, 13 new in `test/demo.test.mjs`).

## What shipped

| Piece | Files |
|---|---|
| Demo mode on the server | `server/demo.mjs` (new): the guard, snapshot reading, the reset, `/api/demo`, `/api/demo/enter`, the write gate, view no-ops, in-memory limits, the page wrapper |
| Hooks | `server/index.mjs`: 11 lines (import; `openDemo` before `migrate`; `demo.restore()` after it; settings created with `demo.environment(process.env)`; `pages` wrapper for setup and the static branch; `demo.start(env)`; `demo.handle` first in the router; `demo.quiet` skips the monitor's last-seen touch for `/api/me` and `/api/clips`) |
| The family | `scripts/demo-seed.mjs` (new): data, badges via `renderSpec`, FFmpeg clips, the snapshot writer. `npm run demo:seed` |
| Reset now | `scripts/demo-reset.mjs` (new). `npm run demo:reset` |
| Banner | `public/js/shell/demo-banner.js`, `public/css/demo.css` (new). Injected by the server in demo mode only |
| Docs | `docs/DEMO.md` (ships in the package), this file |

No edits to `settings.mjs`, the dashboard or the feed were needed: the demo's settings are locked through the
environment object `createSettings` already takes, the dashboard shows the server's refusal messages as they are,
and the banner script handles the feed's upload button and comment box from outside (capture-phase click,
CSS plus a note).

## How it works

- **Switch**: `DEMO_MODE` from the environment only (`1/true/yes/on`; empty or `0` off; anything else stops the
  server). `openDemo()` returns null when off, so a normal install runs exactly as before; the only always-on
  change is the `?.` hook calls.
- **Guard**: the database must carry `settings.demo_marker = "kidtube-demo-v1"` (a key `settings.mjs` does not
  know, so no screen lists it) or be empty (no accounts, clips or comments), and the data folder must carry
  `demo-mode.json` or be empty (no videos, uploads, backups or brand indexes). Checked before `migrate()` and before
  every reset, by the server and by `demo-reset.mjs`. The seed refuses a family's folder too, and replaces only a
  folder whose `demo.json` says it is a snapshot.
- **Snapshot**: `DATA_DIR/demo-snapshot/` = `demo.json` (marker, `seededAt`, schema version, sha256 of every file),
  `demo.sqlite`, `files/videos/*`, `files/brand/*`. At start it is copied to `DATA_DIR/demo-base.sqlite` and
  migrated, so an upgrade does not break an old snapshot.
- **Reset**: files are copied only when missing or different (temp + rename; never deletes). The database is
  replaced on the live connection: `ATTACH` the base, `BEGIN IMMEDIATE`, defer foreign keys, drop the triggers
  (the channel-1 trigger refuses a delete), delete every table, insert from the base, shift every column in
  `TIME_COLUMNS` by `now - seededAt` (whole minutes; `0`/NULL stay unset; ISO `published` too), recreate the
  triggers, commit. Synchronous, so no request sees a half state. A schema test fails when a new column is neither
  in `TIME_COLUMNS` nor named as not-a-time.
- **Writes**: everything that is not GET/HEAD/OPTIONS is refused with `403 {ok:false, demo:true, error}` unless it
  is `/api/logout`, `/api/guest/validate`, `/api/like`, `/api/react` (allow-list, so new routes are refused by
  default). `/api/view` and `/api/view/beat` answer `{ok, viewId:0, budget}` / `{ok, added:0, budget}` and log
  nothing. `GET /api/notifications/unsubscribe` is refused (a GET that writes). No message says "sign in" (the
  dashboard signs the parent out on a 403 that does).
- **Limits**: likes and reactions 40/min, one-tap sign-ins 12/min, per visitor, in memory, keyed by an HMAC of
  the address with a per-boot random key. Nothing writes an address; `hits`, `chits`, `guest_code_attempts` stay
  empty because the routes that fill them are refused.
- **Locked settings**: `MAIL_MODE=disabled` and `SIGNUP_MODE=closed` through the environment object, so the
  dashboard shows them as "set on the server" and the sign-in card shows no sign-up tab.
- **Roles**: `DEMO_ROLES` in `demo.mjs` (kid = `juni@kids.invalid` → `/#/c/juni`, Grandma =
  `grandma@demo.invalid` → `/`, parent = `parent@demo.invalid` (owner) → `/parents`). Demo accounts have the hash
  `demo:no-password`, which `passwordMatches` can never accept; `/api/login` is refused anyway.
- **Banner**: the wrapper adds `<link href="/css/demo.css?v=…">` and `<script src="/js/shell/demo-banner.js?v=…">`
  to every page it serves (stamps follow the files like `static.mjs`), under the same CSP header. Pill top left on
  the kids' page (under the header; above the front door, under a splash), bottom right elsewhere; short ("43m") on
  phones. "Try it as" goes on the front door, into the sign-in card (a modal, so the pill behind it is inert) and
  above the dashboard's sign-in form, only while signed out. After the reset time the pill says "just reset · tap to
  reload".

## The family

The Demo Family (accent Sunny, Ember Tape gate, `America/New_York` stored, `FAMILY_TIMEZONE` recommended in the
docs). Juni (Ember Tape, orange, circle badge, login, 30-minute daily tape with 12 used), Otto (Arcade, sky, hexagon
pixel badge, login, a clip waiting for review), Mabel (Comic Pow, pink, burst badge, no login). Parent Sam Demo
(owner); viewers Grandma Rosa, Uncle Teo, Auntie Bea; Cousin Ivy asking to join. 12 clips of 8 s at 540×960:
lavfi backgrounds (gradients, mandelbrot, a slow Life grid), a Fluent sticker that moves, titles rasterised from the
badge glyph tables by a small path filler in the seed (Homebrew's FFmpeg has no `drawtext`), a quiet music-box tune
from `aevalsrc`. One sealed capsule (opens 30 minutes after each reset), one held comment, one used guest code
("the babysitter"), likes, reactions, Who-watched rows, activity and last-seen rows. The database is byte-identical
on every run; on this Mac the clips were too (a second seed copied 0 files).

## Checked in the browser (built-in browser, localhost, scratch folder outside the repo)

Seed, `DEMO_MODE=1` boot, and all three roles at 390×844 and 1280×800: the door's Try-it row; kid → Juni's splash →
sealed capsule ("in 30 minutes", "Sealed by Sam") → feed; Grandma → picker → Mabel (Comic Pow) and Otto (Arcade);
parent → dashboard (home, review, kids, guests, settings, who watched). The sign-in card and the dashboard's sign-in
offer the roles; a password login says "The demo has no passwords…". As the kid: upload button → "Uploads are off
in the demo" dialog (no file picker), comments sheet read-only with its note, heart and a reaction saved. As the
parent: Approve, Make a code and Save changes each show the calm yellow note. From the page, all 56 write routes
answered 403 `demo` as the parent, 34 as Grandma and as the kid; likes still worked; `/api/view` answered with
Juni's budget. With `DEMO_RESET_MINUTES=1`: Grandma's removed heart and added reaction were back after the reset at
the minute (18 likes, 12 reactions), and an open page's pill switched to "just reset · tap to reload". Console in a
clean tab: nothing from the demo. The only errors are the pane refusing service workers ("An unknown error occurred
when fetching the script"), which a plain non-demo install shows the same way, and the 403 of the deliberate
password login.

## Not done, and for the other sessions

- **Docker path not run** (no Docker on this Mac). The seed needs FFmpeg with libx264 and the built-in lavfi
  sources (`gradients`, `mandelbrot`, `life`, `aevalsrc`); Alpine's `ffmpeg` package should have them. Worth one
  `docker compose -p demo run --rm kidtube node scripts/demo-seed.mjs` before the demo goes live.
- **README** (owner: README session): one line under "Install in three lines" or "A look around": "Try the demo at
  https://demo… (an invented family, resets every hour)" once hosted, and a link to `docs/DEMO.md` for running one.
  The banner's "Install your own" points at `<repository url>#install-in-three-lines` (from `package.json`); if that
  heading changes, set `DEMO_INSTALL_URL` or change the anchor in `server/demo.mjs`.
- **INSTALL.md** (owner: install-test session): a warning box: "`DEMO_MODE` is for the public demo only; on a family's
  install the server refuses to start." Nothing else needed.
- **Dockerfile / compose** (owners elsewhere): nothing required. Optional: a `compose.demo.yaml` override with
  `DEMO_MODE: "1"` and a different container name, so a demo and a family install on one machine never share
  `container_name: kidtube`.
- **Naming**: no product name is spelled outside `server/brand.mjs` (the brand test checks it). Demo-only strings
  that carry the old name: the database marker value `kidtube-demo-v1` (internal; changing it means re-seeding) and
  the GitHub URLs in `docs/DEMO.md`.
- **Security review**: the surface is `server/demo.mjs`'s `handle()`; the allow-list is `OPEN_WRITES`. Visitors
  share the demo accounts, so a heart one visitor removes is gone for the next until the reset (documented).
- **Not built**: per-visitor watch time, so the kid's tape never runs out on the server (documented); a family-time-
  zone per visitor; a "make a splash theme" call on the demo.
- Seen in passing, not touched: the seeded watch rows show "0:08 of 0:08" because the dashboard caps seconds at the
  clip length (Juni's 12 minutes are made of rewatches); "39.2 GB free for videos" on the dashboard shows the
  server's real disk.
