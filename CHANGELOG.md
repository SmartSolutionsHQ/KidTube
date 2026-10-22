# Changelog

All notable changes to KidTube. Versions follow [semantic versioning](https://semver.org/); before 1.0, a minor
version may change how an install is set up, and [docs/UPGRADING.md](docs/UPGRADING.md) says what to do.

## 0.2.0 (unreleased)

The first release built as an app families can install: one command, a setup page in the browser, a channel
for each kid, and a calm dashboard for parents.

### For kids

- A channel per kid, with their own name, kicker line, accent colour, badge and splash screen.
- A badge builder: seven shapes, colours, the kid's name or initials, 61 stickers, effects and Shuffle. Badges
  are drawn on the server from a checked spec; no picture of a child is needed.
- Six splash themes: Ember Tape (the VHS original), Glass Gate, Creature Feature, Blueprint Workshop, Arcade
  and Comic Pow. Each one honours reduced motion, Esc to skip and "skip my intro next time".
- The VHS pause screen, the wordmark slide and posters for every video, loaded ahead of the swipe.
- Time capsules: seal a video until a birthday or any date, with a note. It waits as a locked tape and opens
  with the theme's own unlock.
- Sticker reactions from the people a parent approved.
- An end-of-tape screen when a daily watch limit runs out.
- Kid logins with a short name instead of an email address. A kid's uploads wait for a parent by default.
- The upload card from the design: "What's it called?", "Record it to tape", "Sent to a parent".

### For parents

- `docker compose up -d`, then a link and a one-time setup code in the logs. No `.env` needed.
- A seven-step setup wizard: the code, the parent account, the family name and address, the kids, who can
  watch, optional email, and putting it on a phone.
- The parent dashboard at `/parents`: review queue, videos, comments (approve, hide, delete), people and
  co-parents, guest codes with a printable QR card (a code can be limited to one kid), the activity feed,
  who watched what, daily watch limits with bonus minutes, time capsules and settings.
- A front door that shows the kids' badges, or only the family name when the family prefers.
- Add to Home Screen: a manifest built from the family's name, accent and badge; a service worker that keeps
  only the app's shell and never videos or private answers; a calm offline page; and an install page at
  `/install` with Android's install button or the iPhone steps.

### Under the hood

- One migration ladder (`PRAGMA user_version`, schema v4) with a backup before every upgrade.
- Settings in the database (environment variables still win and lock a setting).
- The product name in one module (`server/brand.mjs`), so the planned rename is one change.
- A strict Content Security Policy sent as an HTTP header; fonts and stickers are self-hosted.
- Server-side checks on every clip, video, poster, badge and comment read: channel access, review state,
  sealed capsules and spent daily tapes.
- FFmpeg posters, a conversion timeout, metadata stripping (no phone GPS in published videos).
- CI checks that the npm package and Docker image ship no maintainer folders. A release workflow builds the
  image for amd64 and arm64 on a version tag.
- 259 automated tests on Node 24.

### Docs

- A README for parents, with screenshots of an invented family.
- `docs/INSTALL.md` in plain words: a mini PC or NAS, phones on the home Wi-Fi, Tailscale for private HTTPS
  without a domain, your own domain, an existing reverse proxy, phones, and a tour of the dashboard.
- `docs/UPGRADING.md`: the automatic backup before each upgrade, rolling back, and moving an older family site
  onto KidTube.
- `docs/VERIFY.md`: the release checklist and the results of the last run.
- `SECURITY.md` covers the setup claim, badges and pictures, themes, reactions and watch history.

### Fixed

- The dashboard tab read "Parent dashboard · Parent dashboard" when the family had no name.
- People and comment rows were squeezed into a narrow column on wide screens.
- Activity showed raw names for time capsule and daily tape events.
- A comment waiting for a parent disappeared without a word.
- On short phones the pause screen ran into the upload button and the caption, with two play marks.
- Kids, viewers and guests no longer see a "Parents" link they can't use.
- `npm run email:test` and the parent reset script work without a `.env`.

## 0.1.0 (2026-10-21)

The starter: one family channel extracted from a family project, with private media, parent approval, guest
codes, chunked uploads, optional Brevo email, Docker and Caddy files, and a starter generator.
