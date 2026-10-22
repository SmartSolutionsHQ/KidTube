# Security model

KidTube is a self-hosted family application: one install serves one family, run by a parent on their own
computer. It is not a multi-tenant service and has not had an independent security audit. Don't use it as a
public signup platform for unrelated households.

## Reporting a problem

Report vulnerabilities privately through GitHub's private vulnerability reporting on the repository, or contact
the maintainers privately. Don't post exploit details, credentials, real children's data or database files in
public issues.

## Accounts and sessions

- Passwords are salted and derived on the server with scrypt. Parents and viewers need 12 or more characters;
  kid logins need 8. HTTPS protects passwords in transit.
- API tokens expire after seven days and are tied to the current password hash, so changing a password signs
  that account out everywhere. The page keeps the token in localStorage and sends it in request headers, never
  in a URL, so proxy logs don't keep it. Media uses a signed HttpOnly, SameSite=Strict cookie, marked Secure on
  an `https://` address.
- Every request for the catalog, videos, posters, comments, likes, reactions and channel lists checks approval on
  the server. Denying, deleting or resetting an account, a guest code expiring, or a new signing secret ends the
  matching access.
- Logging out clears the browser's cookie and stored token. A copied token keeps working until it expires or the
  password or secret changes; protect the devices people use.
- The signing secret lives in `DATA_DIR/secret` (created once, mode 0600) unless `SIGN_SECRET` is set. Anyone
  with it can mint sessions: keep it out of backups you share and out of Git.
- Login, signup and guest-code tries are rate limited per connecting address; an IPv6 /64 counts as one
  address. Ten wrong passwords for one account in 15 minutes, or 50 in a day, pause that login from every
  address (a parent setting a new password lifts it), and 30 wrong
  guest codes in ten minutes pause redeeming for everyone. Signup answers the same whether or not an email
  already has an account.
- Behind a reverse proxy, set `TRUST_PROXY=1` only when every request passes through a proxy that adds or
  overwrites `X-Forwarded-For`. KidTube believes only the last entry, the one your proxy wrote.
- Requests that change anything must come from the family's own web address (an Origin check).
- Once the web address is set, requests must use it, an IP address or `localhost`; other names get 421, which
  stops DNS rebinding. Add any other name you open KidTube by to `ALLOWED_HOSTS`. The health check always
  answers.

## Setup claim

A new install has no parent until someone claims it at `/setup`.

- At boot without an owner, the app makes a one-time code of about 100 bits, prints it to its own log, writes it
  to `DATA_DIR/setup-token` (0600) and keeps only a SHA-256 of it in memory. A restart makes a new code.
- Until the claim, every API except health, site info, themes and setup answers `503`, and pages redirect to
  `/setup`.
- Codes are compared in constant time. Five wrong tries from one address wait ten minutes; thirty wrong tries
  retire the code until a restart.
- The claim runs in one `BEGIN IMMEDIATE` transaction that re-checks for an owner, so two people racing get one
  owner and one refusal. The token file is deleted afterwards.
- The code is the gate. Before setup, keep the install reachable only from your own network or the computer
  itself, as the default Compose file does.

## Kids, guests and viewers

- Kid logins are ordinary accounts with an address on the reserved `.invalid` domain, so they can never receive
  email. A kid can upload only to their own channel, and their uploads wait for a parent unless the parent turns
  review off for that kid.
- Viewers see every kid. A guest code can be limited to one kid; the server enforces that on every catalog,
  video, badge and picture request. Codes are six characters, must be redeemed within a day and then last 24
  hours. Guests can't comment or react.
- Co-parents can review videos and comments, make guest codes and read activity. Kids (their badges, pictures
  and daily tapes), people, watch history, the family clock and settings stay with the owner. Clip changes are
  recorded in the activity log whichever route makes them.
- Likes and comments are accepted only on videos the account may watch.
- Time capsules are enforced by the server: until the opening time, a sealed video, its poster, comments, likes
  and reactions are refused to everyone but parents.
- A daily watch limit relies on the feed reporting watched time. The server refuses video once the day's tape is
  spent and never credits more than real time, but a tampered browser that stops reporting is not stopped. It is
  a family agreement, not a lock.

## Uploads, badges and pictures

- Uploaded videos stay in the data folder, outside the served files, and only play through the access-checked
  video route. Don't copy private videos into `public/` or let a proxy serve the data folder.
- FFmpeg converts every video and drops its metadata and chapters, so phone GPS and device details don't reach
  viewers. Conversion runs one job at a time with a time limit. An upload that isn't finished within a day is
  deleted with its raw pieces.
- FFmpeg opens an upload only as a local file in a container phones make (MP4, MOV, M4V, 3GP, WebM, MKV), so
  playlists, concat lists and other protocols or formats are refused before anything inside them is followed.
- Badges are never uploaded as SVG. The browser sends a small JSON spec (4 KB at most) of whitelisted shapes,
  colours, fonts, stickers and effects; the server validates it and draws the SVG itself with the same renderer.
  A test checks that the output only ever contains whitelisted elements and attributes.
- Pictures and home-screen icons must be PNG, JPEG or WebP by their magic bytes, at most 2 MB and 4096 pixels a
  side. They are rebuilt without EXIF, XMP, colour profiles or unknown chunks.
- Badge and picture files are served with their own `default-src 'none'` policy and `nosniff`. Kids' files are
  private when the front door hides the kids, and are never kept by shared caches: browsers may keep them for an
  hour.

## Themes and pages

- Splash themes are first-party folders shipped with the app. There is no way to install a theme from the
  dashboard. Tests check that themes use no `innerHTML`, `eval` or outside URLs, and stay within size and flash
  limits.
- Every page gets one Content Security Policy header: scripts, styles, fonts, images, media and connections only
  from the install itself (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`). There are no
  analytics and no outside requests from the browser.
- The service worker keeps only the app's shell (styles, scripts, fonts, icons and an offline page). It never
  stores or answers API requests, videos, posters, badges, Range requests or anything but plain GETs.

## Reactions, comments and watch history

- Reactions come from signed-in viewers only; counts are shown, never who reacted.
- Comments show the commenter's name to everyone who can watch that kid. By default a parent reads each comment
  before it shows.
- The watch log records which video, which account (or `guest:` and part of the guest code's hash), when, for
  how long and whether it finished. It stores no IP address or device details, is visible only to the owner,
  and is deleted after `views_retention_days` (90 by default). Viewers are told at signup that parents can see
  what they watch. Activity is kept for `activity_retention_days` (365 by default).
- Rate limits keep the addresses of signups, comments and guest-code tries for an hour at most.
- Removing a person deletes their hearts, comments, reactions, watch history, uploads and email queue, and the
  activity log then calls them "someone".

## Email

Email is off by default. With Brevo on, Brevo receives each recipient's address and the message: signup and
approval notices to parents, and new-video notices (title and link) to viewers who haven't unsubscribed. Opening
an email link never approves anyone by itself. Turn email off if that outside processing doesn't suit your
family.

## What KidTube can't do

- Approved viewers can record or save what they are allowed to watch. Approval is access control, not DRM.
- Backups contain personal data and the means to sign in. Keep them private and off public repositories.
- KidTube has no automatic moderation. A parent stays responsible for who is invited and what is shared.

## The container

The Compose file runs the app as uid 1000 with a read-only root, no Linux capabilities and `no-new-privileges`.
Behind the HTTPS overlay only Caddy can reach it. The base image is pinned by digest and the CI actions by
commit; Dependabot proposes updates to both.

Use supported updates, HTTPS, separate data per family and tested backups.
