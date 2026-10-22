# Demo sandbox hand-over (2026-10-22)

Branch `claude/demo-sandbox-10aa0c`, cut from `foundation-clean` at `1ce28d2`. Not pushed, no PR.
`npm test`: 305 pass on Node 24.18 (298 before, 7 new in `test/demo-sandbox.test.mjs`; one existing demo test
adjusted, see below).

## What shipped

| Piece | Files |
|---|---|
| The sandbox | `server/demo-sandbox.mjs` (new): store, limits, validation, the read overlays, the routes |
| Hooks | `server/demo.mjs`: creates it in `start()`, routes it first in `handle()`, overlays GETs, clears it in `reset()`, writes `demo-last-reset.json` on every reset, serves `/demo/make`, two new refusal messages. `server/index.mjs`: `demo.start(env, { themeIds })` (one line) |
| Make page | `server/demo-make.html` (template, outside `public/` so a family's install has no such page), `public/js/demo/make.js` |
| Wizard step reuse | `public/setup/kids.js`: `basic` (no login or upload review) and `maxKids` options; the wizard passes neither, so it is unchanged |
| Kids tab | `public/js/parent/kids.js`: reads `sandbox` from `GET /api/admin/kids`; `#/kids/<slug>` and `#/kids/new` open an editor (works on a family's install too) |
| Banner | `public/js/shell/demo-banner.js`, `public/css/demo.css`: the sandbox sentence, "Or make it yours" on the door and in the card, "Reset my changes" |
| Picker | `public/js/shell/picker.js`: `LOGO` also accepts `/api/demo/sandbox/badge/<slug>.svg?v=n` |
| Docs | `docs/DEMO.md` ("Each visitor's sandbox"), `SECURITY.md` ("The public demo", new section), this file |

## How it works

- **Identity**: cookie `kt_sandbox` = 16 random bytes, base64url (22 chars), `HttpOnly; SameSite=Strict; Path=/;
  Max-Age=<until the next reset>`, `Secure` when `SITE_URL` is https. Set on the first change only; reads never
  create a sandbox. Nothing else is stored with it (no IP, no account). It belongs to the browser, so switching
  roles keeps it.
- **Store**: a `Map` in memory, `id -> { kids: Map<channelId, override>, created: [{n, name, kicker, accent,
  themeId, badge, rev}], rev, writes }`. Map order is the eviction order (a touched sandbox moves to the back).
  Each change runs on a copy and is committed only if the JSON stays under the byte cap.
- **Writes** (demo parent only, `X-Kid-*` headers, owner role, like the real routes; anyone else gets the demo's
  usual 403 `demo:true`): `POST /api/admin/kids` (id of a family kid = override, a made kid's id = update, no id
  = make one), `POST /api/admin/kids/delete` (made kid = remove, family kid = undo), `GET/PUT
  /api/admin/channels/<id>/badge`. `login`, `reviewUploads` and `slug` in the body are ignored. Order and
  pictures stay refused with their own messages.
- **Own routes** (no role needed): `GET /api/demo/sandbox` (`{active, note, created, createdMax, kids, nextReset}`),
  `POST /api/demo/sandbox/reset` (forgets it, expires the cookie), `GET /api/demo/sandbox/badge/<slug>.svg`.
- **Reads**: `demo.handle()` patches `res.writeHead/write/end` for the GETs below and lets the family's route
  answer as usual; a 200 JSON body is then rewritten for that visitor. Visitors without a sandbox get the
  untouched answer. `/api/site` (only when kids are public), `/api/channels`, `/api/admin/summary` (kids),
  `/api/admin/kids` (always: adds `sandbox`, the tab's switch), and `/api/clips?channel=my-kid-N` (the URL is
  rewritten to all clips the viewer may see; four unsealed ones are picked round-robin by kid and given the
  made kid's slug and a "Borrowed from Juni's channel…" blurb, plus `borrowed: true`).
- **Made kids**: id `900000000 + n`, slug `my-kid-n` (n = 1..9, reused after a removal). No free text in URLs.
- **Badges**: `renderSpec()` (server/badge.mjs) on save and again on every serve; only the spec is kept.
  `private, no-store`, `default-src 'none'`, nosniff, CORP same-origin. 404 for any other visitor.
- **Limits** (`SANDBOX_LIMITS`): 2000 sandboxes, 24 KB each, 2 made kids, name 40 / line 80 (plus no C0/C1
  controls, line separators, bidi marks or BOM), 30 writes a minute per sandbox, 6 new sandboxes a minute per
  address (demo.mjs's existing in-memory HMAC limiter, key `sandbox:new`). The byte cap is a backstop: a full
  sandbox of valid input is about 4 KB.
- **Resets**: `demo.reset()` calls `clearAll()`. `resetDemo()` (shared with `scripts/demo-reset.mjs`) writes
  `DATA_DIR/demo-last-reset.json`; the sandbox store compares its mtime before using or making a sandbox and
  drops everything when it is newer. A restart empties memory anyway.

## Tests (`test/demo-sandbox.test.mjs`)

Without DEMO_MODE: the three sandbox routes and `/demo/make` 404, no cookie, the Kids tab has no `sandbox`, a
parent's `POST /api/admin/kids` makes a real kid. Isolation: visitor A customizes Juni and makes Ava with badges;
A sees it in site, channels, summary, Kids tab and borrowed clips; B (parent too) and a signed-out stranger get
the same answers as before, B gets 404 for A's badge URLs, the whole database dump and the brand folder
hash are unchanged, and "Reset my changes" brings A back. Caps and rules: text lengths, control and bidi
characters, accent, splash, unknown id, the third made kid (409), kid and Grandma refused, nine other writes
still 403 `demo`, 30 writes a minute, new sandboxes per address. Badge specs: ten bad specs give the same 400
message as `renderSpec`, a system-font badge with markup comes back escaped and equal to `renderSpec`, names
stay data in JSON, and `make.js`/`demo-banner.js` contain no `innerHTML`-style sinks. Resets: the reset script
empties a running server's sandboxes. In-process: eviction of the oldest, `Secure` on https, the byte cap
refusing a change without applying it.

`test/demo.test.mjs`: the "every write refused for every role" test now skips the parent's three sandboxed
routes (still checks the database dump is unchanged after them).

## Checked in the browser (built-in browser, localhost, scratch folder outside the repo)

`demo-seed.mjs` in the session scratchpad, `DEMO_MODE=1` on port 3627. Visitor A on `http://localhost:3627` at
375 px, visitor B on `http://127.0.0.1:3627` (a separate cookie and storage context) at 1024 px.

- A: front door shows "Or make it yours" → `/demo/make` signs in as the parent → made "Ava <b>Star</b>" (mint,
  shuffled badge, Arcade) → "page is ready" → Arcade splash with the name as text, "LEVEL 04" → feed with Ava's
  badge in the header, 4 borrowed clips (Juni, Otto, Mabel, Juni) with the borrowed note; Upload → "Uploads are
  off in the demo"; the card offers "Customize Ava…'s page" → Kids tab opens Ava's editor; "Reset my changes"
  brought the family back for A only.
- B: front door showed only the family; A's badge URL 404; "Customize Juni's page" → Juni's editor → "Juniper B"
  with Glass Gate saved "on this device"; Otto's badge shuffled and saved; B's front door showed both from
  sandbox URLs while A's `/api/site`, summary and Kids tab still showed Juni. Made two kids, the third got 409 and
  the tab disabled "Make your own kid" with the reason.
- A second server with `DEMO_RESET_MINUTES=1`: a sandbox was active before the scheduled reset and gone after.
- No horizontal scroll at 375 or 1024. Console: only the pane's service-worker refusals ("An unknown error
  occurred when fetching the script") and the deliberate 404 for A's badge from B.
- Fixed along the way: the pill covered the make page's Continue button on phones (page padding), the "ready"
  rows were cramped at 375 px (button under the name), kids made without a badge showed an empty slot (the
  picker's initial badge now), the card said the sandbox sentence twice, and a deep link to an editor left it
  off screen (it now takes focus after the dashboard's heading).

## Not done, and for other sessions

- **Names in history**: activity sentences, Review, Videos, Comments and Who watched rows still name the family's
  kids as the family named them. Only the lists of kids (door, picker, header, splash, summary, Kids tab) follow
  the sandbox. A visitor who renames Juni sees "Juni" in Activity; that reads as history and was left alone.
- **PWA name**: the manifest is the family's (site name), so nothing changes there.
- **Docker path not run** (no Docker on this Mac); nothing Docker-specific was added. `server/demo-make.html` is
  under `server/`, which the package `files` and `.dockerignore` already include.
- **CHANGELOG**: demo mode and the sandbox are not in `CHANGELOG.md` yet (demo mode wasn't either); one line
  under 0.2.0 when the demo is announced.
- **Memory**: the worst case (2000 full sandboxes) stays under 50 MB; `SANDBOX_LIMITS` is a constant, not an env
  setting. Make it configurable only if a host needs it.
- The made kid's splash number is its place in the visitor's list (Ava was "LEVEL 04"), as for a family's kids.
