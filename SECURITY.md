# Security

KidTube is self-hosted: one install serves one family, run by a parent on a computer they control. It is not a
service for many households, and it has not had an independent security audit. Our own end-to-end review, with
every finding and its fix, is in the repository at `docs/plan/security-review.md`.

## Reporting a problem

Report vulnerabilities privately, through GitHub's private vulnerability reporting on
[SmartSolutionsHQ/KidTube](https://github.com/SmartSolutionsHQ/KidTube/security) or by contacting the
maintainers privately. Say which version you ran and how to reproduce it, with invented data. Never post exploit
details, credentials, real children's data or database files in a public issue.

## The security model

**Nobody watches without a parent's yes.** Every request for videos, posters, comments, likes, reactions and the
list of kids is checked on the server. Signed out, people see only the front door: the family's name, and the
kids' names and badges unless the parent switches that off.

- **Viewers** are approved by the parent and see every kid. A **guest code** is six characters, must be used
  within a day, then works for 24 hours, for one kid or all of them. Guests can't comment or react.
- **Kids** sign in with a short login name, can upload only to their own channel, and their uploads wait for a
  parent unless the parent turns review off.
- **Co-parents** can review videos and comments, make guest codes and read activity. Kids' settings (badges,
  pictures, daily limits), people, watch history, the family clock and settings stay with the parent who set
  KidTube up.
- **Time capsules** are closed to everyone but parents until their date, checked against the clock on every
  request. A **daily watch limit** stops video on the server once it is spent, but relies on the feed reporting
  watch time: it is a family agreement, not a lock.

**Sign-in.** Passwords are hashed with scrypt and need 12 characters (8 for kid logins). Sessions last seven days
and end when the password changes. The page sends its token in headers, never in a URL; media uses an HttpOnly,
SameSite=Strict cookie, Secure on `https://`. Tries are limited per address (an IPv6 /64 counts as one), per
account (10 wrong passwords in 15 minutes or 50 in a day) and for guest codes (30 wrong in ten minutes pause
redeeming for everyone). Sign-up answers the same whether or not an account exists.

**Setup.** Until a parent claims a new install, it serves only the setup page, and the claim needs a one-time
code of about 100 bits that the app prints to its own log. The default Compose file only listens on the computer
itself, so keep it that way until setup is done.

**Requests.** Anything that changes data must come from the family's own web address. Once that address is set,
other host names get 421, which stops DNS rebinding (`ALLOWED_HOSTS` adds names). Every page has a strict Content
Security Policy: scripts, styles, fonts and media only from the install, no inline scripts, no analytics and no
outside requests. Set `TRUST_PROXY=1` only when every request passes through a proxy that writes
`X-Forwarded-For`; KidTube trusts only the last entry.

**Uploads and pictures.** FFmpeg converts every video and drops its metadata, so phone GPS and device details
don't reach viewers. It opens uploads only as local files in the formats phones make. Uploads nobody finishes are
deleted after a day. Badges are never uploaded as SVG: the browser sends a small checked spec and the server
draws the badge. Pictures must be PNG, JPEG or WebP by their bytes, at most 2 MB, and are rebuilt without
metadata. Private files are served only through access-checked routes, never from `public/`.

**What is kept.** The watch log records who watched which video, when and for how long, with no IP address or
device details. Only the parent who set KidTube up sees it, viewers are told at sign-up, and it is deleted after
90 days. Activity is kept 365 days, and the addresses used for rate limits about an hour. Removing a person
deletes their hearts, comments, reactions, watch history, uploads and queued emails. Email is off by default;
with Brevo on, Brevo receives each recipient's address and the message.

**The container** runs as uid 1000 with a read-only root, no Linux capabilities and `no-new-privileges`. With the
HTTPS overlay only Caddy can reach it. The base image is pinned by digest and the CI actions by commit.

**The public demo** (`DEMO_MODE=1`, [docs/DEMO.md](docs/DEMO.md)) refuses to start on a family's data, refuses
every change except likes, reactions and each visitor's private in-memory sandbox, and stores no visitor
addresses.

## In scope

The server, the pages and service worker, themes and the badge renderer, the setup claim, demo mode, the
Dockerfile, the Compose and Caddy files, the scripts, and the setups the docs recommend. For example: watching or
reading something a parent didn't allow, getting around review, a time capsule or the setup code, signing in as
someone else, script injection, or children's data leaving the computer.

## Out of scope

- Approved viewers recording or saving what they are allowed to watch. Approval is access control, not DRM.
- A tampered browser getting around a daily watch limit.
- Anyone who can already read the computer's data folder, backups or `.env`: they control the install.
- A copied session token working until it expires or the password changes. Logging out clears only that browser.
- Setups the docs warn against: port 3000 open to the internet, sign-ins over plain `http://` outside the home,
  or `TRUST_PROXY=1` without a proxy in front.
- Bugs in Docker, Node, FFmpeg, Caddy, Brevo or Tailscale themselves; report those upstream.
- Moderation. KidTube doesn't scan videos or comments; the parent decides who is invited and what is shared.
