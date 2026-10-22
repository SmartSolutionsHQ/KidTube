# M5 hand-over: first boot, setup mode and the browser wizard

Branch `claude/m5-setup-wizard-7f9153`, cut from `foundation-clean`. A family can now run
`docker compose up -d` (or `npm start`) with no `.env`, open the printed link, enter the printed code
and finish everything in the browser.

## What landed

| Path | What |
|---|---|
| `server/config.mjs` | First boot: `installPaths()` (DATABASE_PATH, DATA_DIR or the database's folder), `ensureDataDir()` (0700; prints the exact `sudo chown -R uid:gid "<dir>"` and exits when it can't write), `loadSecret()` (SIGN_SECRET, else `DATA_DIR/secret` made once with flag `wx`, 0600, tightened to 0600 if loosened), `checkSiteUrl()` (production needs https for env and saved values). |
| `server/setup.mjs` | Setup mode, the one-time code, `/api/setup/*`, the origin rule, `/setup` and the "still being set up" notice. |
| `server/family.mjs` | Kids as channels plus optional kid logins: `createFamily({sqlite, themeIds, removeChannelFiles})` → `listKids()`, `saveKid(input, actor)`, `removeKid(id, actor)`; `slugFrom`, `kidEmail`, `handleOf`, `RESERVED_SLUGS`. M7 should reuse it for the channel editor. |
| `server/index.mjs` | Boot via `prepareInstall()`; `openDatabase(..., {allowEmpty: true})`; `setup.originAllowed(req)` replaces the SITE_URL compare; `setup.handle()` runs right after `/api/themes`; `setup.announce(port)` after listen. |
| `server/db.mjs` | A newly created database is chmod 0600; its folder is made 0700. |
| `server/api.js` | Two small edits: login maps a bare handle (`juni`) to `juni@kids.invalid`; `sessToken` is exported (setup's claim returns a normal session). |
| `server/passwords.mjs` | `passwordRecord(password, { min })`; kid logins use 8, everyone else still 12. |
| `public/css/parent.css` | The calm parent kit (`kp-*`): panels, rows, buttons (one `kp-btn-primary` per screen), fields, checks and radios, swatches, notes. Square corners, Inter Tight, base.css tokens. **M7: build the dashboard on these classes.** |
| `public/setup/` | `index.html` (rail + card + credit), `setup.css`, `setup.js` (steps 1–3, 5–7, routing, resume), `kids.js` (step 4), `ui.js` (DOM helpers, badge `<img>` from a spec), `helpers.js` (pure: code formatting, initials, contrast, password suggestions, address notes), `waiting.html`. |
| `public/assets/smart-solutions-logo-white-transparent.png` | The official logo, copied unchanged (SHA-256 7f384b19…afd2). |
| `scripts/setup.mjs`, `scripts/doctor.mjs`, `bin/create-kidtube.mjs` | CLI path kept; doctor works without `.env`; starter prints the compose/npm next steps. |
| `Dockerfile`, `compose.yaml`, `compose.https.yaml`, `.env.example`, `README.md` (install) | One-command Docker install; see "Install" below. |
| `test/setup.test.mjs`, `test/starter.test.mjs` | 10 new tests plus doctor/generator checks. |

## Setup mode

- Active only in a process that **booted** without an owner (`role='super'`), until the claim. It never comes
  back mid-run (if the only owner were demoted, the app keeps running normally; a restart would print a code).
- Code: `KT-XXXXX-XXXXX-XXXXX-XXXXX`, 20 symbols of Crockford base32 (no I, L, O, U) = 100 bits. Input is
  upper-cased, spaces and dashes dropped, `O`→`0`, `I`/`L`→`1`. Only a SHA-256 is kept in memory;
  `DATA_DIR/setup-token` (0600) holds the code for people without the log, and is deleted on claim or when the
  code is turned off. A new code each restart until claimed.
- Guesses: a wrong code is `403`; 5 wrong per address per 10 minutes then `429` (even for the right code);
  30 wrong in all turns the code off (`423`, token file removed) until a restart. Address = socket, or the
  last `X-Forwarded-For` entry with `TRUST_PROXY=1`.
- While unclaimed: `/`, `/parents`, `/about` → `302 /setup`; every `/api/*` except `/api/health`, `/api/site`,
  `/api/themes`, `/api/setup/*` → `503 {ok:false, setup:true, error}` with `Retry-After: 60`.
- Claimed but `setup_complete` false: APIs work; `/`, `/about`, `/parents` show `public/setup/waiting.html`
  to everyone except a viewer whose cookie is the owner's.
- Origin check (all non-GET requests with an `Origin`): before `site_url` is set, the request's own
  `proto://host` (proto from the socket, or `X-Forwarded-Proto` with `TRUST_PROXY=1`); afterwards only
  `site_url`. The wizard moves to the new address (`<site>/setup#step-4`) when the parent saves a different
  one; the parent signs in there once (localStorage is per origin).

## `/api/setup/*`

All JSON, `Cache-Control: no-store`. Owner auth is the normal session in `X-Kid-Email` / `X-Kid-Token`
headers (as M4's routes); a kid or viewer session gets `401`.

| Route | Body | Result |
|---|---|---|
| `GET /api/setup/state` | | `{stage: 'code'|'signin'|'wizard'|'done'|'finished', steps:7, production, origin, tokenFile, disabled?}`; with owner auth also `owner, reached, family{name,tagline,siteUrl,accent,badge,locked}, kids[], watch{kidsPublic,signupMode,guestPasses,comments,locked}, email{mode,keySet,sender,notify,locked}` |
| `POST /api/setup/verify` | `{code}` | `200` if right (does not use it up); same 403/429/423 rules; `410` once claimed |
| `POST /api/setup/claim` | `{code, first, last, email, pass}` | `200 {ok, t, email, role:'super'}` + `Set-Cookie`; `400` bad fields (code not burned); `409` lost a race; `410` afterwards |
| `POST /api/setup/family` | `{name, tagline, siteUrl}` | saves unlocked settings; `{siteUrl}` |
| `POST /api/setup/kids` | `{id?, name, kicker, accent, themeId, reviewUploads, slug?, login: {handle, pass?} \| null}` | `{kid, kids}` |
| `DELETE /api/setup/kids/<id>` | | removes a kid added by mistake (not channel 1, not one with clips) |
| `POST /api/setup/kids/done` | | `400` until at least one real kid |
| `POST /api/setup/watch` | `{kidsPublic, signupMode, guestPasses, comments}` | |
| `POST /api/setup/email` | `{mode:'disabled'}` or `{mode:'brevo', key?, sender, notify}` | key may be blank to keep the saved one |
| `POST /api/setup/email/test` | | sends to `notify_email`; `502` with Brevo's status on failure |
| `POST /api/setup/complete` | | sets `setup_complete` |

Locked (environment) settings are skipped, never written. Progress is `activity` rows
(`kind='setup', subject='step', detail {step}`), so `reached` survives a refresh or another device.
The claim writes `kind='setup', subject='claim'` with the IP.

## Kids

- The first kid saved takes over channel 1 while it is untouched (`main`, "Main channel", no kicker, badge or
  login); its slug becomes the kid's. Later kids get new channels at the end.
- Slugs come from the name (`Zoë Ann` → `zoe-ann`), unique with `-2`, `-3`. `family` is reserved
  (`/brand/family.svg`): an explicit `slug: 'family'` is `400`, a kid named Family gets `family-kid`.
  The wizard never shows or edits the slug; editing a kid keeps it.
- Kid login: `<handle>@kids.invalid`, role `kid`, `channel_id` set, status approved, first name = kid's name,
  password 8–128. The handle must be 2–24 of `[a-z0-9-]` starting with a letter, and unique. Kid addresses get
  a `video_email_preferences` row (unsubscribed) so new-video mail never tries `.invalid`.
- Login maps a bare handle (`/^[a-z][a-z0-9-]{1,23}$/`, case-folded) to the kid address and returns the
  canonical email. **M6:** `entrance.js`'s login field is `type="email"`, so a browser refuses `juni` there;
  make it `type="text"` with the label "Email or login name".
- Badges: the wizard saves the channel, then calls M4's `saveChannelBadge(id, spec)`; the family badge goes
  through `saveFamilyBadge(spec)` at step 3, so the four PWA icons exist before "put it on your phone".

## Install

- Docker: `docker compose up -d`, then `docker logs kidtube` (the service has `container_name: kidtube`).
  `env_file` is `.env` with `required: false` (Compose 2.24+). Data lives in the named volume `kidtube-data`
  by default; the Dockerfile creates `/data` owned by `node`, so a new volume is writable.
  `KIDTUBE_DATA=./data` keeps an existing bind-mounted folder. `HOST_PORT` (also passed in so the log prints
  the right link) and `HOST_BIND` (default `127.0.0.1`) set the published port.
- `compose.https.yaml` now fails early with a clear message when `SITE_URL` is missing (Caddy needs it).
- npm: `npm start` from the install folder; `data/` next to the app.
- `scripts/setup.mjs` still migrates, creates the owner, writes `.env` (with `SIGN_SECRET`), sets
  `setup_complete`. It refuses when `.env`, the database or `data/secret` exists; for a server-made install it
  says to finish at `/setup`. **It writes `.env` into the current folder: run it from the install folder.**
- `npm run doctor` creates nothing and no longer needs `.env`.

## Checked in a browser

Built-in browser against `server/index.mjs` started in an empty scratch folder (no `.env`, no data), invented
names only. Nothing was left in the repo.

- Fresh boot: `data/`, `secret`, `setup-token` and the database created (0700/0600); `/` redirected to `/setup`;
  the code read from the log.
- Six wrong codes at 390 px: five "doesn't match", the sixth "Too many wrong codes from this device"; the
  right code was also held back, then accepted once the ten minutes had passed.
- Parent "Marisol Brandt" with a generated password; a reload resumed at step 3.
- Family "Brandt Family Videos": the LAN warning and the moved-address note appeared for
  `http://192.168.1.20:3000`; the initials badge (B) edited to a mint shield; badge and four icons saved.
- Kids at 390 px: Wren (Sky, star badge with an owl sticker, Arcade, login `wren` with a suggested two-word
  password, uploads reviewed) took over channel 1; Tobias (a dark custom color first, flagged by the contrast
  check, then Bubblegum; burst badge in the Comic font; Comic Pow; no login). Live previews followed name,
  line and accent.
- Who can watch, email (Brevo without a key gives "Paste your Brevo API key."; then no email) and done at
  1024 px, plus steps 1–4 at 1024 px on a second scratch install. Step 7 at 390 px, no horizontal scroll.
- Afterwards: `/api/site` lists `wren` and `tobias` with accents, themes and `logoUrl`s that serve their
  SVGs; `/brand/family.svg` serves; `wren` signs in with the bare handle (`wren@kids.invalid`, role `kid`);
  `/parents` opens signed in. Console: only the expected 403/429/400 responses, no CSP reports.
- Fixed along the way: link buttons inherited the ember link colour; on phones M4's builder clipped its
  Shuffle button below ~350 px of host width (the editor now gives it the box's full width) and the kid
  password was cut off next to "Suggest one" (the fields stack).
- Not checked: Docker (Docker Desktop is not installed on this Mac; the CLI symlink is dangling), a real
  Brevo test send, and real phones (install to home screen).

## For M6

- Front door: `/api/site` already lists both kids with `logoUrl`, accent and theme; nothing visual shows them
  yet. While setup is unclaimed `/` redirects to `/setup`; while it's claimed but unfinished visitors get
  `waiting.html`, so the shell only needs `site.setup === 'required'` handling for the owner.
- Kid sign-in with a bare handle (see Kids). Upload review defaults on per kid (`channels.review_uploads`).
- The front door still shows M2's static Ember Tape door; the kids appear only in `/api/site` until the
  picker lands.

## For M7

- Reuse `public/css/parent.css` and `server/family.mjs`. `removeKid` already calls M4's
  `brandFiles.removeChannel`. `/api/setup/*` routes stay available to the owner after setup and can back the
  dashboard's settings and kids pages until M7 has its own.
- `/api/admin/password` still demands 12 characters, so a parent can't reset a kid's 8-character password
  there yet; use `passwordRecord(pass, {min: 8})` for kid accounts.
- The wizard's "Who can watch" copy says parents can see who watched what (the plan's decision); views are
  recorded from M7.

## For M4's builder

- Below about 350 px of host width the stage's Shuffle button overflows (`.kb-stage` keeps a 156 px preview
  column and `white-space: nowrap` on the button). The wizard works around it; a container query in
  `builder.css` would fix it for every host.

## For M8 and docs

- Backups must now include `data/secret` (or `/data/secret` in the volume) unless `SIGN_SECRET` is set in
  `.env`; losing it signs everyone out. `docs/OPERATIONS.md` still says "copy `.env`", and its Docker restore
  steps assume `./data`.
- `scripts/reset-parent.mjs` and `npm run email:test` use `--env-file=.env`, which fails without a `.env`;
  switch them to `--env-file-if-exists` and `installPaths()`/`loadSecret()`.
- Upgrade notes for TanzenTube-style installs: set `KIDTUBE_DATA=./data` before pulling the new compose file,
  or Compose starts a fresh volume and the app boots into setup mode.
