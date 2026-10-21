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
| Upload fails converting | FFmpeg/FFprobe available, enough disk, valid video within size/duration limits |
| No email | Check MAIL_MODE and the email setup guide; disabled is the default |
| Too many login attempts | Wait ten minutes; verify proxy address configuration |
| Caddy cannot issue a certificate | Check public DNS, firewall, ports 80/443, CGNAT, and another service using those ports |

## Release packaging

`npm pack --dry-run` lists the distributable files. The `files` allowlist excludes `.env`, data, and backups; tests use only synthetic fixtures. `npm pack` creates a versioned archive. The CLI can create a second blank project from that archive without copying the current installation's state. Registry publishing is a separate maintainer action; no npm access token is included in the repository.
