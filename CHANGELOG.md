# Changelog

All notable changes to KidTube. Versions follow [semantic versioning](https://semver.org/); before 1.0, a minor
version may change how an install is set up, and [docs/UPGRADING.md](docs/UPGRADING.md) says what to do.

## 0.2.0 (unreleased)

The first release built as an app families can install: one command, a setup page in the browser, a channel for
each kid, and a dashboard for parents.

### Upgrading from 0.1.0

- Data now lives in a Docker volume by default. An older install that keeps its data in `./data` must add
  `KIDTUBE_DATA=./data` to `.env` before the first start, or it starts empty and asks for setup.
- The database is upgraded on the first start, after an automatic backup in `backups/`. Accounts, videos,
  comments and unexpired guest codes carry over, and the site's videos become the first kid's channel.

[docs/UPGRADING.md](docs/UPGRADING.md) has the steps.

### For kids

- A channel per kid, with their own name, line, colour, badge and splash screen.
- A badge builder: nine shapes, fonts, colours, the kid's name or initials, 61 stickers, effects and Shuffle. No
  photo of a child is needed.
- Six splash themes: Ember Tape, Glass Gate, Creature Feature, Blueprint Workshop, Arcade and Comic Pow. Each
  honours reduced motion, Esc to skip and "skip my intro next time".
- Kid logins with a short name instead of an email address, and posting from a phone: "What's it called?",
  "Record it to tape", "Sent to a parent".
- Time capsules: a video sealed until a birthday or any date, with a note, that opens with the theme's unlock.
- Sticker reactions, and an "end of tape" screen when a daily watch limit runs out.
- Posters for every video, loaded ahead of the swipe, and the VHS pause screen.

### For parents

- `docker compose up -d`, then a link and a one-time setup code in the log. No `.env` needed.
- A seven-step setup page: the code, the parent account, the family, the kids, who can watch, optional email,
  and putting it on a phone.
- The parent dashboard at `/parents`: review, kids, videos, comments, people and co-parents, guest codes with a
  printable QR card (optionally for one kid), activity, who watched what, daily watch limits with bonus minutes,
  time capsules, storage and settings.
- A front door that shows the kids' badges, or only the family name.
- Add to Home Screen: a manifest from the family's name, colour and badge, a service worker that keeps only the
  app's look, an offline page, and install steps at `/install`.
- A public demo mode with an invented family that resets every hour, where visitors can customize kids in a
  private sandbox ([docs/DEMO.md](docs/DEMO.md)).

### Security and privacy

From an end-to-end review; each fix has a regression test.

- Rate limits that can't be bypassed through `X-Forwarded-For`, a per-account pause after wrong passwords, and
  six-character guest codes.
- Co-parents no longer see watch history or people, or change kids' settings.
- Uploads nobody finished are deleted after a day; FFmpeg opens only local files in the formats phones make, and
  every video loses its metadata, including phone GPS.
- Kids' badges and pictures are never kept by shared caches, and a guest code for one kid can't fetch another
  kid's files.
- Session tokens never travel in URLs; signup no longer reveals which accounts exist; removing a person removes
  their data; rate-limit addresses are deleted within about an hour.
- Other host names get 421 once the web address is set (`ALLOWED_HOSTS` adds names).
- A strict Content Security Policy header on every page, self-hosted fonts and stickers, and no outside
  requests.
- The container runs read-only as uid 1000 with no capabilities; the base image and CI actions are pinned.

### Under the hood

- One migration ladder (`PRAGMA user_version`, schema v4) with a backup before every upgrade.
- Settings in the database; an environment variable still wins and locks the setting.
- The product name in one module (`server/brand.mjs`), so the planned rename is one change.
- CI checks that the npm package and the Docker image ship no maintainer folders, and that a first install
  starts healthy. A release workflow builds the image for amd64 and arm64 on a version tag.
- 305 automated tests on Node 24.

### Docs

- A README for parents, with screenshots of an invented family.
- `docs/INSTALL.md` in plain words, including NAS boxes, Colima on a Mac, Tailscale, a domain with Caddy, an
  existing reverse proxy and running without Docker.
- `docs/OPERATIONS.md` for the dashboard, backups, recovery and troubleshooting; `docs/UPGRADING.md`;
  `docs/EMAIL.md`; `docs/DEMO.md`; `docs/THEMES.md` for theme makers.
- `docs/ARCHITECTURE.md` and `CONTRIBUTING.md` for contributors; `docs/VERIFY.md`, the release checklist with
  the results of the last run.

### Fixed

- The dashboard tab read "Parent dashboard · Parent dashboard" when the family had no name.
- People and comment rows were squeezed into a narrow column on wide screens.
- Activity showed raw names for time capsule and daily limit events.
- A comment waiting for a parent disappeared without a word.
- On short phones the pause screen ran into the upload button and the caption, with two play marks.
- Kids, viewers and guests saw a "Parents" link they couldn't use.
- `npm run email:test` and the parent reset script failed without a `.env`.
- A data folder the app couldn't write printed a fix for the path inside the container instead of the folder
  on the computer.
- With `SITE_URL` set only in the shell, the HTTPS overlay restarted the app forever.
- New-video email links pointed at `http://localhost:3000` on a fresh install until a restart.

## 0.1.0 (2026-10-21)

The starter: one family channel extracted from a family project, with private media, parent approval, guest
codes, chunked uploads, optional Brevo email, Docker and Caddy files, and a starter generator.
