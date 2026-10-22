# KidTube security and privacy review (2026-10-22)

Scope: the whole app on `foundation-clean` at `4a0b4a5` (`git diff main...HEAD` plus the code it builds on): every
route in `server/`, the viewer shell, the parent dashboard, the setup wizard, themes, the badge renderer, the
service worker, Docker, Compose, Caddy, the CI workflows and the install docs. This was a review only; no code
changed.

How: I read every server module and the front-end DOM sinks, then probed a scratch install outside the repo
(Node 24.18, FFmpeg 8.1, `127.0.0.1:3917`, invented family "Testfam", kids Juni and Max with logins, a viewer,
a co-parent, test clips made with `ffmpeg -f lavfi` and a fake GPS tag). The probe scripts and their output
stayed in the session scratchpad. No `.env` or `data/` was created in the repo.

Summary: **1 high, 4 medium, 12 low**. The core media gate holds: signed-out callers, viewers, kids and scoped
guests could not play anything they shouldn't, sealed capsules stayed shut, and uploaded video lost its GPS tag.
The real exposure is around that gate. Rate limits are the only thing standing between the internet and
4-character guest codes and 8-character kid passwords, and the documented nginx setup turns them off. Co-parents
can also see more than SECURITY.md promises.

Severity scale: **high** means a realistic path for an outsider to watch children's videos, or a broken promise
about children's data. **Medium** means a privacy promise not kept, or a weakness that needs one more mistake.
**Low** means hardening, small leaks and audit gaps.

---

## High

### H1. The documented nginx setup lets anyone bypass every rate limit, so guest codes and kid passwords can be brute-forced

- **Where:** `server/index.mjs:87` and `server/index.mjs:124` (the limiter key and `CF-Connecting-IP` are the
  whole `X-Forwarded-For` string); `server/api.js:254` (the guest-code limit keys on that header);
  `server/api.js:92` and `server/api.js:640` (signup and comment limits, same key); `docs/INSTALL.md:167` and
  `docs/INSTALL.md:176` (tells families to set `TRUST_PROXY=1` and use `proxy_set_header X-Forwarded-For
  $proxy_add_x_forwarded_for`).
- **Scenario:** nginx's `$proxy_add_x_forwarded_for` *appends* the real address to whatever the client sent.
  With `TRUST_PROXY=1`, an attacker sends `X-Forwarded-For: <random>` on every request. Each request gets a new
  limiter key, so the 20-per-10-minutes login limit and the 5-per-10-minutes guest-code limit never trigger.
  - **Guest codes** are 3 letters from 24 and 1 digit from 8 in one of 4 positions (`api.js:219`), so there are
    442,368 possibilities. With one unredeemed code waiting (they live 24 hours), an attacker expects to find it
    in about 221,000 requests, roughly an hour at 60 requests a second from one laptop. An unscoped pass then
    plays every kid's videos for 24 hours.
  - **Kid logins** are `<handle>@kids.invalid` with passwords of 8 or more characters (`family.mjs:12`). The
    handle is usually the kid's name, which the public front door shows by default (M4). A kid account counts as
    an approved account, so it watches every kid's videos and comments, not only its own channel
    (`channels.mjs:29-33`).
- **Confirmed:** I restarted the scratch install with `TRUST_PROXY=1`. Thirty wrong passwords for `juni` with a
  fixed `X-Forwarded-For` gave 20× 401, then 10× 429. Thirty with a changing first entry
  (`198.51.100.<n>, 203.0.113.7`) gave 30× 401, no 429, and the right password still worked afterwards. Thirty
  guest-code guesses with a changing first entry gave 30× 400, no 429 (the limit is 5). The shipped Caddy
  Compose file is not affected, because Caddy 2.5 and later replace `X-Forwarded-For` from untrusted clients
  (from Caddy's documentation; not tested here).
- **Fix:**
  1. Take the **last** `X-Forwarded-For` entry, as `setup.mjs:42-48` `clientIp()` already does, and use that one
     helper everywhere (index.mjs, api.js through `CF-Connecting-IP`).
  2. Make INSTALL.md and DEPLOYMENT.md agree: either recommend `proxy_set_header X-Forwarded-For $remote_addr;`
     or keep the append form and rely on the last-entry rule.
  3. Add limits per target, not only per address: per kid handle or account for login, and a global cap on
     guest-code failures per 10 minutes (as setup already has with `FAILS_TOTAL`). Lengthen guest codes (6 to 8
     characters, or 4 plus a check digit) and consider 10 characters as the kid password minimum.
  4. See M2 for the per-address weakness that remains without a proxy.

---

## Medium

### M1. Co-parents can read watch history and the people list, and change kids' tape budgets, badges and the family clock

- **Where:** `server/watch.mjs:248` (`GET /api/admin/views`), `watch.mjs:250-262` (budget, bonus and time-zone
  routes), all through `jsonio.mjs:34` `staffFor()` → `asStaff()`, which allows `admin`; `server/api.js:499-537`
  (`/api/admin/overview` returns every account's email, name, status and role to `admin`);
  `server/brandfiles.mjs:176-181` (badge and picture writes allow `admin`).
- **Promise broken:** SECURITY.md says co-parents can review, make guest codes and read activity, but "Kids,
  people, watch history and settings stay with the owner". It also says the watch log "is visible only to the
  owner". `/api/admin/people` and `/api/admin/settings` do enforce owner-only, but these side doors don't.
- **Scenario:** a family adds a grandparent or ex-partner as co-parent to help with review. They can read every
  viewer's and every kid's watch history (`viewer`, clip, time, seconds), list all accounts with emails, change
  a kid's daily tape, and move the family time zone, which shifts every kid's daily reset and every capsule
  countdown.
- **Confirmed:** as `coparent@example.test` (role `admin`): `/api/admin/people` → 403 and `/api/admin/settings`
  → 403, but `/api/admin/overview?e=&t=` → 200 with all five accounts; `/api/admin/views` → 200 with
  `max@kids.invalid watched Owner clip on Juni` and the viewer's row (also 200 using only the cookie);
  `POST /api/admin/budget` for Max → 200; `POST /api/admin/timezone` `Pacific/Kiritimati` → 200; `PUT
  /api/admin/channels/1/badge` → 200.
- **Fix:** add an owner check (`role === 'super'`) to `/api/admin/views`, the budget, bonus and time-zone POSTs,
  and kid badge and picture writes, or decide that co-parents may do these and update SECURITY.md, the About
  page and the signup notice. Trim `/api/admin/overview` for `admin`: drop `accounts`, or drop the route now
  that monitor.mjs covers the dashboard.

### M2. Without a proxy, login and guest codes are protected only per address

- **Where:** `server/index.mjs:122-128` (20 tries per address per 10 minutes, shared by login, signup and guest
  redeem); `server/api.js:255-260` (5 guest-code tries per address); no per-account, per-handle or global
  counter.
- **Scenario:** on an internet-facing install (Caddy or a tunnel), an attacker with an IPv6 /64 (common on
  rented servers) or a small botnet rotates addresses. Each address gets 20 login tries and 5 guest-code tries
  every 10 minutes. The search space is the same as in H1: guest codes have 442k possibilities, and kid
  passwords are 8 characters for a login name taken from the front door. The memory map in index.mjs also grows
  with every new address until its entries expire.
- **Confirmed:** in part. The per-address limit worked (20 then 429). Address rotation was shown only through
  the proxy header (H1); I did not test it with real IPv6 addresses.
- **Fix:** the same per-target and global limits as H1 point 3, plus grouping IPv6 addresses by /64 in the
  limiter.

### M3. Abandoned uploads stay on disk forever, unconverted and with their GPS, and can fill the disk

- **Where:** `server/uploads.mjs:274-295` (start), `uploads.mjs:288` (only 3 unfinished jobs per account per 24
  hours, counted by `created`); nothing ever sweeps `DATA_DIR/incoming/` or old `receiving` jobs (I checked all
  of `server/`).
- **Scenario:**
  1. **Privacy:** a kid starts an upload from a phone and closes the app halfway. The raw chunks keep the
     phone's GPS, device model and creation time (FFmpeg only strips them when it converts). They stay in
     `incoming/<id>/` with no end date, and backups include them. SECURITY.md says FFmpeg drops metadata so
     GPS doesn't reach viewers. That's true for viewers, but the server keeps the raw copy.
  2. **Disk:** any kid or parent account, or anyone with a stolen kid password (H1), can start 3 uploads of 512
     MB a day and never finish them. That's 1.5 GB a day, held forever. `hasRoom()` is checked only at start.
- **Confirmed:** I started an upload as `max`, sent chunk 0 and stopped. The 787 KB chunk is still in
  `incoming/2e40b583…/0`, and no code path removes it.
- **Fix:** sweep at boot and hourly: mark `receiving` jobs older than, say, 6 hours as failed and delete their
  `incoming/` folder (the boot-time `processing` → `failed` update at `uploads.mjs:142` is the place). Count
  reserved bytes across all unfinished jobs against free space at start.

### M4. By default, anyone on the internet sees the kids' names, channel lines, badges and photos, cached for a year

- **Where:** `server/settings.mjs:65` (`kids_public` defaults to `true`); `server/site.mjs:12`;
  `server/brandfiles.mjs:134-136` and `brandfiles.mjs:157-162` (`public, max-age=31536000, immutable` while
  `kids_public` is on).
- **Scenario:** a family puts KidTube on a domain. Any visitor, crawler or archive sees each child's first name,
  kicker line ("kid one", often a school year or a hobby), accent and theme in `/api/site`, plus their badge and
  any picture the parent uploaded at `/brand/channels/<id>/image-<hash>.png`. Because those files are marked
  `public, immutable` for a year, browsers, proxies and CDNs (Cloudflare tunnels are in DEPLOYMENT.md) may keep
  them after the parent turns `kids_public` off or removes the picture. The URL stays the same because it is
  named by content hash.
- **Confirmed:** signed out: `/api/site` listed `juni`/`max` with name and kicker; `/brand/juni.svg` → 200; the
  picture → 200 with `cache-control: public, max-age=31536000, immutable`.
- **Note:** showing kids before sign-in is Eddie's product decision (architecture notes). I'm flagging the
  default and the caching, not the feature.
- **Fix:** for launch, consider defaulting `kids_public` to `false`, or asking in the wizard with no
  preselection. Serve kids' pictures as `private` even when public, or at least `public, max-age=3600` without
  `immutable`. Keep `immutable` for the family badge and icons.

---

## Low

### L1. A guest pass for one kid can fetch the other kids' badges and pictures

- **Where:** `server/brandfiles.mjs:134-136`. With `kids_public` off, `kidsVisible()` accepts any viewer,
  including a scoped guest; it ignores `canViewChannel()`.
- **Confirmed:** a pass limited to `max`, with `kids_public` off: `/api/channels` → `["max"]` only, but
  `/brand/juni.svg` → 200 and Juni's picture → 200.
- **Fix:** for `channels/<id>/*` and `/<slug>.svg`, check `canViewChannel(viewer, channel)` when `kids_public`
  is off.

### L2. Likes and comments are accepted for clips the caller can't play, including pending and made-up ones

- **Where:** `server/api.js:600-611` (`likeSet`) and `server/api.js:629-655` (`commentAdd`) check the session but
  not `canPlayClip()` or even that the clip exists; `api.js:613-617` returns comments when the clip row is
  missing.
- **Confirmed:** as the viewer, on Juni's pending clip: `/api/comment` → `ok` (stored, held for review), `/api/like`
  → `ok, count: 1`; `/api/like` on `no-such-clip` → `ok`. (`/api/react` correctly → 404.) The like reply also
  shows a pending clip's like count to anyone who can guess its id.
- **Fix:** look the clip up with `CLIP_ACCESS_SQL` and refuse unless `canPlayClip()`, as `reactions.mjs:56` and
  `watch.mjs:111` already do. In `commentsList`, treat a missing clip as "no rows".

### L3. Seven-day session tokens travel in URL query strings

- **Where:** `public/js/shell/auth-dialog.js:55` and `public/js/feed.js:1177` (`/api/check?e=&t=`),
  `feed.js:478` (`/api/comments?…&t=`), `feed.js:1054` (`/api/likes?…`), `public/js/launch/common.js:28` (staff
  GETs), `server/api.js:500` (`/api/admin/overview?e=&t=`).
- **Scenario:** the token is a bearer credential valid for 7 days (a parent's opens the whole dashboard). Proxy
  access logs (nginx logs query strings by default), tunnel dashboards and server logs record it.
  `Referrer-Policy: no-referrer` prevents the Referer leak.
- **Fix:** send `X-Kid-Email`/`X-Kid-Token` headers on GETs, as monitor.mjs already does, or rely on the
  HttpOnly cookie for reads. Remove the `?e=&t=` branch from `staffFor()` once nothing uses it.

### L4. The session signature check is not constant-time

- **Where:** `server/api.js:177` (`sig!==await hmac(...)`). Cookie checks (`access.mjs:12`) and unsubscribe
  links (`notifications.mjs:97`) do use `timingSafeEqual`.
- **Scenario:** a remote timing attack against a 64-hex HMAC is impractical over a network, but it's the one
  inconsistent place. Found by reading the code.
- **Fix:** compare with `timingSafeEqual` on equal-length buffers after checking `/^[a-f0-9]{64}$/`.

### L5. Signup reveals which emails and kid login names exist, and re-emails the parent each time

- **Where:** `server/api.js:98-103`.
- **Confirmed:** signup with `juni@kids.invalid` → `409 {"error":"exists"}`; a new email → `200 pending`. The login
  route is careful (decoy hash, same message), but signup undoes that. A repeat signup for a pending email sends
  the parent another notice (5 per hour per address, or unlimited with H1).
- **Fix:** answer every signup with the same `200 {status:'pending'}`. Refuse `@kids.invalid` addresses at signup.
  Notify only on the first request for an email.

### L6. Deleting a person leaves their email and full name behind

- **Where:** `server/monitor.mjs:682-693` (`removePerson`); `server/family.mjs:126` and `family.mjs:128` (removing
  or renaming a kid login deletes the account row only); `upload_jobs` and sent `video_notification_deliveries`
  are never cleaned.
- **Confirmed:** after `POST /api/admin/people/delete` for the viewer, `activity` still held three rows with
  `"target":"viewer@example.test","name":"Vera Test"`: approved, password, and the delete itself. They are kept
  for `activity_retention_days` (365). When a kid login is removed through the kid form, that kid's likes,
  comments, reactions and watch rows stay (code reading).
- **Fix:** on delete, rewrite that person's activity rows to a neutral label ("a removed person") or drop them.
  Delete their `upload_jobs` rows and sent deliveries. Have `family.saveKid`/`removeKid` call the same cascade
  as `removePerson`.

### L7. IP addresses are stored, and pruned only when the next request of the same kind arrives

- **Where:** `hits` (signup, `api.js:92-95`), `chits` (comments, `api.js:640-643`) and `guest_code_attempts`
  (`api.js:255-260`) are each pruned only inside their own route. The setup claim logs `{ ip }` in `activity`
  for 365 days (`setup.mjs:227`).
- **Confirmed:** after the probes, `hits` held 4 rows and `chits` held `127.0.0.1`. They stay until the next
  signup or comment, which in a small family can be months. SECURITY.md describes the watch log as IP-free (true)
  but says nothing about these tables.
- **Fix:** prune all three in the daily `prune()` in monitor.mjs. Drop the IP from the claim activity, or keep a
  hash of it. Mention short-lived rate-limit addresses in SECURITY.md.

### L8. A co-parent can rename, reorder, delete or approve clips without an activity row

- **Where:** `server/api.js:35-38` (`/api/admin/clips/review`, `/api/clips/reorder`, `/api/clips/rename`,
  `/api/clips/delete`) are staff-callable directly. Only monitor.mjs's wrappers write activity.
- **Confirmed:** `POST /api/clips/rename` as the co-parent → 200, `changes: 1`, and 0 new `activity` rows.
- **Fix:** have these routes accept only `delegate()` calls (for example a private flag in `ctx`), or move the
  activity write into api.js.

### L9. New-video email links point at `http://localhost:3000` on a fresh install until a restart

- **Where:** `server/notifications.mjs:51` reads `env.SITE_URL` once at boot. A first boot has no site URL yet,
  because the wizard sets it later.
- **Scenario:** after the wizard, the "Watch" and unsubscribe links in every email point at
  `http://localhost:3000` until the app restarts. That's a broken unsubscribe (a privacy and anti-spam
  expectation) rather than a leak. Found by reading the code.
- **Fix:** read `env.SITE_URL` at send time in `drain()`/`unsubscribeLink()`.

### L10. No Host check; before setup, the state route reveals the data folder path

- **Where:** `server/setup.mjs:198` (`tokenFile`, `docker` in the anonymous `GET /api/setup/state`),
  `setup.mjs:382-387` (before the site URL is saved, the allowed origin is built from the request's own Host).
- **Scenario:** a DNS-rebinding page can read what a signed-out visitor can see (cookies and localStorage are
  bound to the real host name, so no session leaks). The setup code is still required to claim. The token path
  tells an attacker where the data folder is.
- **Fix:** omit `tokenFile` until the code is verified (the wizard can show the path after a wrong code). Once
  `site_url` is set, answer 421 to requests whose Host doesn't match it.

### L11. FFmpeg and ffprobe parse untrusted uploads with every demuxer enabled (unconfirmed)

- **Where:** `server/uploads.mjs:82-104` (`ffprobe … file`, `ffmpeg -i input` with no format whitelist).
- **What I tested:** a "video" that is really an HLS playlist naming local files. FFmpeg 8.1 refused it ("Not
  detecting m3u8/hls with non standard extension"), because the upload is saved as `source` with no extension.
  That closes the known local-file-read tricks on 8.1. **Not checked:** the Alpine `ffmpeg` in the Docker image
  (`Dockerfile:2`, unpinned), or other nested-demuxer tricks.
- **Fix:** add `-format_whitelist mov,mp4,m4a,3gp,3g2,mj2,matroska,webm` (and the same for ffprobe) plus
  `-protocol_whitelist file`. Pin the image's ffmpeg version.

### L12. Deployment and supply-chain hardening

- `compose.https.yaml` sets `TRUST_PROXY=1` while `compose.yaml:19` still publishes the app port on the host's
  loopback. Any local process that bypasses Caddy can then spoof `X-Forwarded-For`/`-Proto`. Drop the `ports:`
  mapping in the HTTPS override.
- `compose.yaml` has no `cap_drop: [ALL]` or `security_opt: [no-new-privileges:true]`. It already runs
  non-root, `read_only` and with tmpfs, which is good.
- `Dockerfile:1` pins `node:24.16.0-alpine` by tag, not digest. `apk add ffmpeg` is unpinned. The workflows
  use `actions/*@v4` and `docker/*@v3`–`v6` by tag, not by commit SHA. The release job does have
  `packages: write`, so a moved tag would run with push rights to `ghcr.io/smartsolutionshq/kidtube`. Pin
  actions to SHAs (Dependabot can bump them).

---

## Checked and found sound

**Access control (probed):**
- Signed out: `/api/clips`, video, comments, likes, reactions, channels and views → 401.
- Viewers: pending, hidden and rejected clips → 404 (video, poster, `clips/locate`, react); `/parents` → 302 to
  `/`.
- Kids: can't play another kid's pending clip (404); can play their own pending clip (200); can't upload to
  another channel; can't reach staff routes (`/api/admin/summary`, `/api/admin/overview`, upload status of
  others → 403/404).
- Guest pass scoped to Max: catalog is Max only, `?channel=juni` → 403, Juni's video → 404, Juni's comments →
  empty.
- `canPlayClip`/`canViewChannel` are the single gate for video, poster, legacy `/api/media/*`, views and
  reactions.
- Owner-only routes (`people`, `kids`, `settings`, `email-test`, setup steps) refuse co-parents.

**Time capsules:** comments, likes, legacy media, reactions, views, video and poster all go through
`sealedFor()`; `/api/likes` omits sealed ids; the feed gets title, date and note only.

**Sessions:**
- scrypt with per-user salt.
- A decoy hash makes unknown emails and wrong passwords take the same time and give the same message.
- Tokens are `<expiry>.<HMAC(secret, email|expiry|password hash)>`; more than 7 days ahead is refused.
- A password change ended the old token (`/api/check` → `none`) and the old cookie (`/api/me` → null) in the
  probe.
- Denied or deleted accounts fail both checks.
- The media cookie is HMAC-signed, `HttpOnly; SameSite=Strict`, `Secure` on `https:`, and re-checked against
  the account row (status and password version) or the guest-code row on every request.
- Logout clears the cookie.

**CSRF:**
- Every non-GET needs a matching `Origin` (a cross-origin POST → 403 in the probe).
- Mutations also need the token in the body or an `X-Kid-*` header; the cookie alone never authorizes a staff
  write. The only cookie-only writes, `/api/view` and `/api/view/beat`, are `SameSite=Strict` and Origin-checked.
- A POST with no `Origin` is accepted, but only non-browser clients can send that, and they still need a token.

**Setup claim:**
- About 100-bit code from `randomInt`, compared in constant time on SHA-256.
- 5 failures per address per 10 minutes, and 30 failures retire the code.
- `BEGIN IMMEDIATE` re-checks for an owner, so a second claimer gets 409, and later claims get 410
  (`verify` → 410 in the probe).
- The token file is 0600 and deleted on claim, and a restart makes a new code.
- Setup's own `clientIp()` uses the last `X-Forwarded-For` entry.

**SQL:** every value is bound. Dynamic SQL is limited to fixed fragments, `?` lists (`clipsReorder`), constant
table and column names (`ensureColumn`), and a column name read from `PRAGMA` (`prune`).

**Paths and uploads:**
- The static server resolves and rejects anything outside `public/`.
- Upload, brand and channel ids are anchored regexes; chunk count and size are checked against the job.
- Range parsing gives 416 for bad ranges on video, legacy media and static files.
- Converted video had `location`, `title` and `comment` stripped (ffprobe showed only encoder and handler
  tags). Posters use `-map_metadata -1`.
- One conversion runs at a time, with timeouts and a stall kill.

**Images:** chosen by magic bytes and rebuilt from a chunk or marker whitelist (EXIF, XMP, ICC, text chunks and
trailing data dropped; orientation kept as a fresh one-tag EXIF); 2 MB and 4096 px caps; animation refused.

**Badges:**
- Strict spec whitelist, 4 KB cap, printable Latin-1 text of up to 10 characters.
- The server re-renders the SVG and never stores client SVG; every attribute and text is XML-escaped.
- Badges are served with `default-src 'none'`, `nosniff` and `same-origin` CORP.

**XSS:**
- feed.js's `innerHTML` templates escape every server string (title, blurb, comment name and body, poster and
  src, capsule note, "sealed by").
- The dashboard and wizard build DOM with text nodes; the theme `h()` builder drops `javascript:` URLs, string
  `on*` handlers and `srcdoc`.
- Email bodies escape names, titles and blurbs.
- The CSP header is on every HTML page: `script-src 'self'` with no inline scripts. `style-src 'unsafe-inline'`
  only matters if markup injection exists, and I found none.

**Caching:**
- API answers are `no-store`; video and posters are `private, no-store`.
- The service worker skips `/api/*`, `/brand/*`, media, Range and non-GET requests, caches only versioned shell
  files, and drops old `kt-` caches on activate.

**Watch log and retention:** the watch log stores no IP or user agent; views and activity are pruned at boot and
daily; kid accounts are pre-unsubscribed from email.

**Email:** unsubscribe links are HMAC-signed and checked in constant time; a GET only shows a confirmation;
email is off by default.

**Secrets and files:** the secret is created 0600 with `wx` and tightened if loose; the database is 0600; data
folders are 0700; Docker runs as `node`, read-only.

**Licences:** OFL texts ship with every font and glyph table (the glyph fonts are renamed, as OFL requires);
the Fluent Emoji MIT notice ships with the stickers.

**CI:** `contents: read` by default, `packages: write` only in the tag-triggered image job, no
`pull_request_target`, no secrets in the test workflow, and leak checks for `.env`, `.sqlite` and maintainer
folders.

## Not covered

- A real reverse proxy (nginx, Caddy, a Cloudflare tunnel) in front of the app; IPv6 address rotation.
- The Docker image's own ffmpeg; long-running retention timers (I read their code instead).
- The Brevo email path (email stayed off).
- iOS/Android PWA cookie behaviour.
- The parallel sessions' current edits (install test, naming, demo mode): this review is of `4a0b4a5`.
