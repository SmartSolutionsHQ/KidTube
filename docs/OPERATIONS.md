# Operations

## Health and logs

```sh
docker compose ps
docker compose logs --tail=100 kidtube
curl -fsS http://127.0.0.1:3000/api/health
```

Health confirms the HTTP process responds; it does not prove FFmpeg conversion, disk capacity, certificate renewal, or mail delivery. `npm run doctor` checks a direct Node installation. In Docker, FFmpeg/FFprobe are included in the image.

## Back up and restore

Everything KidTube keeps is in one data folder: in Docker, the `kidtube-data` volume mounted at `/data`
(`kidtube_kidtube-data` in `docker volume ls`); with
Node, `data/` next to the app (or `KIDTUBE_DATA=./data` with Docker). It holds:

| Path | What |
| --- | --- |
| `kidtube.sqlite` (plus `-wal`/`-shm` while running) | accounts, kids, videos' details, comments, settings, activity, watch history |
| `videos/` | converted videos and posters |
| `brand/` | the family badge, kids' badges and pictures, home-screen icons |
| `secret` | the signing key; without it everyone is signed out (unless `SIGN_SECRET` is set in `.env`) |
| `backups/` | snapshots, including the automatic one made before each upgrade |
| `incoming/` | uploads in progress; not needed in a backup |

A live database snapshot uses SQLite's backup API, so it is consistent even while the app runs:

```sh
npm run backup
# Or in Docker:
docker compose exec kidtube node scripts/backup.mjs
```

It prints the path of a timestamped snapshot in `backups/`. Copy that snapshot together with `videos/`, `brand/`,
`secret` and your `.env` (if you have one) to somewhere off the computer. For a matching set, avoid uploads and
moderation while you copy, or stop the app and copy the whole data folder.

With Docker, Compose names the volume after the install folder: `kidtube_kidtube-data` for a folder called
`kidtube` (`docker volume ls` lists it). One way to copy it out, from the install folder:

```sh
docker compose stop kidtube
docker run --rm -v kidtube_kidtube-data:/data -v "$PWD":/out alpine tar czf /out/kidtube-backup.tgz -C /data .
docker compose start kidtube
```

Protect backups like the original: they contain personal data and the means to sign in.

To restore: stop the app, move the current data aside (never delete it until the restore works), put the
snapshot at `kidtube.sqlite` with the matching `videos/`, `brand/` and `secret` next to it, make the files belong
to PUID:PGID (1000:1000 by default), and start again. Don't put a snapshot beside stale `-wal`/`-shm` files from a
different database. With Docker, restoring the archive above into an empty volume is
`docker run --rm -v kidtube_kidtube-data:/data -v "$PWD":/in alpine tar xzf /in/kidtube-backup.tgz -C /data`. Check
sign-ins, playback, comments and a test upload before discarding the old data.

## Updates

See [UPGRADING.md](UPGRADING.md): back up, pull, `docker compose up -d --build`. The app copies the database to
`backups/pre-migrate-v*` before changing it, and the guide shows how to roll back.

## Time capsules, reactions and the daily tape

**Time capsules.** A parent can seal any approved video until a date (an hour to 25 years away) with a short note, from the video's row in the dashboard, or tick "Seal as a time capsule" on the upload card. Until then the video stays in its kid's channel as a locked tape showing the opening date, the note and who sealed it. Its video, poster, comments, likes and reactions are refused to everyone but parents (`403 {"error":"sealed","opensAt":…}`), checked against the clock on every request. The server opens due capsules at boot and every minute: the clip moves to the top of its channel, the new-video email goes out with a capsule subject (when email is on), and each viewer's feed plays the theme's unlock the first time they see it. "Open now" in the dashboard does the same at once. A kid's sealed upload still waits for review; if its date passes first, approving it opens it. Activity log: `capsule.seal`, `capsule.unseal`, `capsule.open`.

**Reactions.** Signed-in viewers can add any of five stickers (wow, fire, star, party, cool) to a video, next to the heart. Guests cannot. Counts show under the caption and per video in the dashboard; nobody's name is attached.

**Daily tape.** A parent can give any viewer or kid account a daily watch limit (15 minutes to 3 hours) and add bonus minutes for today. Parents, Family accounts and guests are never limited. Days follow the family time zone (`family_timezone`, stored from the server's zone at first boot; override with `FAMILY_TIMEZONE`), and the tape resets at local midnight. The feed warns at 5 minutes and 1 minute, then shows the theme's "end of tape" screen with one button, "Done for today". The server also refuses video (not posters) once the tape is spent: `403 {"error":"end-of-tape","resetsAt":…}`. The limit relies on the feed reporting watched time every 15 seconds; a tampered browser that never reports is not stopped. Activity log: `budget.set`, `budget.bonus`, `budget.end` (once per account per day).

**The watch log.** Every video watched for 3 seconds or more is recorded: which clip, who (an account email, or `guest:` plus 12 characters naming the guest pass), when it started, how many seconds and whether it finished. No IP address or browser details are stored. Rows older than `views_retention_days` (default 90) are deleted at boot and daily. Parents read it at `GET /api/admin/views` (the dashboard's "Who watched").

| Endpoint | Who | What |
| --- | --- | --- |
| `POST /api/admin/clips/seal` `{id, opensAt, note}` | parents | Seal or reseal an approved clip |
| `POST /api/admin/clips/unseal` `{id}` | parents | Open a capsule now |
| `GET /api/admin/capsules?channel=&id=` | parents | Clips that have a date |
| `POST /api/admin/budget` `{target, minutes}` | parents | Set a daily tape (0 for none) |
| `POST /api/admin/budget/bonus` `{target, minutes}` | parents | Add 15 to 120 minutes for today |
| `GET /api/admin/budget?target=` or `?channel=` | parents | One account's tape, or a kid channel's logins |
| `GET`/`POST /api/admin/timezone` `{timezone}` | parents | Read or change the family time zone |
| `GET /api/admin/views?channel=&viewer=&before=&limit=` | parents | The watch log, newest first |

## Parent account recovery

An existing parent owner can change an account password and roles in the parent dashboard. Passwords must be 12–128 characters. A password change invalidates that account's existing tokens and media cookie. Denying or deleting an account also immediately blocks its media access.

If the only parent is locked out, stop the app and use local recovery from the project directory:

```sh
node --env-file-if-exists=.env scripts/reset-parent.mjs parent@example.com
# Docker (app stopped; mounts the same data and environment):
docker compose run --rm kidtube node scripts/reset-parent.mjs parent@example.com
```

The command only resets an existing owner account, prints a new generated password once, and never promotes a viewer. Save the password securely. Anyone who can read/write the host database already has administrative access; protect the server accordingly.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Setup asks for a code after an update | Compose started a new, empty volume: put `KIDTUBE_DATA=./data` in `.env` if your data is in a folder ([UPGRADING.md](UPGRADING.md)) |
| Permission denied writing SQLite/uploads | PUID/PGID must match the owner of `data/` |
| Login works but video is blocked | Use the exact web address from Settings (or SITE_URL); HTTPS cookies cannot be used on an HTTP URL |
| Kids on iPhone are signed out in the home-screen app | Expected once: iOS home-screen apps keep their own sign-in, separate from Safari |
| The app won't install on a phone | Phones install only from an `https://` address; see the HTTPS parts of [INSTALL.md](INSTALL.md) |
| Browser requests return 403 | The address in the browser must match the web address in Settings; do not mix localhost and 127.0.0.1 |
| No videos after login | A fresh channel is empty; upload from the parent dashboard |
| A kid sees "That's the tape for today" | Their daily tape is spent; add bonus minutes or change the limit in the dashboard |
| A video shows as a locked tape | It is a time capsule; parents can still play it, or open it now from the dashboard |
| The daily tape resets at the wrong hour | Check the family time zone in the dashboard (or `FAMILY_TIMEZONE`) |
| Upload fails converting | FFmpeg/FFprobe available, enough disk, valid video within size/duration limits |
| No email | Check MAIL_MODE and the email setup guide; disabled is the default |
| Too many login attempts | Wait ten minutes; verify proxy address configuration |
| Caddy cannot issue a certificate | Check public DNS, firewall, ports 80/443, CGNAT, and another service using those ports |

## Release packaging

`npm pack --dry-run` lists the distributable files. The `files` allowlist excludes `.env`, data and backups, and
maintainer folders (`docs/plan`, `docs/superpowers`, `scripts/dev`) never ship: CI fails if the package or the
Docker image carries them, and `test/package.test.mjs` checks the same list. Tests use only synthetic fixtures.

Images are built by `.github/workflows/release.yml` for amd64 and arm64 when a version tag matching
`package.json` (such as `v0.2.0`) is pushed, after the tests pass. Registry publishing is a maintainer action; no
npm or registry token is kept in the repository. [VERIFY.md](VERIFY.md) is the manual checklist before tagging.
