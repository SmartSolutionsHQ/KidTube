# Operations

## Health and logs

```sh
docker compose ps
docker compose logs --tail=100 kidtube
curl -fsS http://127.0.0.1:3000/api/health
```

Health confirms the HTTP process responds; it does not prove FFmpeg conversion, disk capacity, certificate renewal, or mail delivery. `npm run doctor` checks a direct Node installation. In Docker, FFmpeg/FFprobe are included in the image.

## Back up and restore

The live snapshot command uses Node's SQLite backup API, so it includes committed data even when WAL journaling is active:

```sh
npm run backup
# Or in Docker:
docker compose exec kidtube node scripts/backup.mjs
```

It prints a timestamped database snapshot in `data/backups/`. Copy that snapshot, `data/videos/`, and `.env` to your backup destination. For a matching restore set, stop uploads and moderation while creating the snapshot and copying videos, or stop the app and copy the entire `data/` directory (including any SQLite WAL/SHM files) plus `.env` as a unit. Protect backups like the original private data.

To restore a live snapshot: stop the app; move the current data directory to a separate recovery location; create a new `data/` directory; place the snapshot at `data/kidtube.sqlite` and matching videos at `data/videos/`; restore the matching `.env`; set ownership to PUID/PGID; restart. Do not put a snapshot beside stale `-wal`/`-shm` files from a different database. Verify logins, playback, comments, and a test upload before discarding recovery files.

## Updates

Back up first. Pull the desired repository revision, review its changes, and run `npm test`. Rebuild with `docker compose up -d --build` (include the HTTPS override if used). For Node installs, restart the process after updating files. Keep `.env` and `data/`; never rerun setup as an update. Test changes on a copy before applying them to family data.

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
node --env-file=.env scripts/reset-parent.mjs parent@example.com
# Docker (app stopped; mounts the same data and environment):
docker compose run --rm kidtube node scripts/reset-parent.mjs parent@example.com
```

The command only resets an existing owner account, prints a new generated password once, and never promotes a viewer. Save the password securely. Anyone who can read/write the host database already has administrative access; protect the server accordingly.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Database missing at startup | Run setup once in the project directory; verify the data mount |
| Permission denied writing SQLite/uploads | PUID/PGID must match the owner of `data/` |
| Login works but video is blocked | Use the exact SITE_URL origin; HTTPS cookies cannot be used on an HTTP URL |
| Browser requests return 403 | Origin must match SITE_URL; do not mix localhost and 127.0.0.1 |
| No videos after login | A fresh channel is empty; upload from the parent dashboard |
| A kid sees "That's the tape for today" | Their daily tape is spent; add bonus minutes or change the limit in the dashboard |
| A video shows as a locked tape | It is a time capsule; parents can still play it, or open it now from the dashboard |
| The daily tape resets at the wrong hour | Check the family time zone in the dashboard (or `FAMILY_TIMEZONE`) |
| Upload fails converting | FFmpeg/FFprobe available, enough disk, valid video within size/duration limits |
| No email | Check MAIL_MODE and the email setup guide; disabled is the default |
| Too many login attempts | Wait ten minutes; verify proxy address configuration |
| Caddy cannot issue a certificate | Check public DNS, firewall, ports 80/443, CGNAT, and another service using those ports |

## Release packaging

`npm pack --dry-run` lists the distributable files. The `files` allowlist excludes `.env`, data, and backups; tests use only synthetic fixtures. `npm pack` creates a versioned archive. The CLI can create a second blank project from that archive without copying the current installation's state. Registry publishing is a separate maintainer action; no npm access token is included in the repository.
