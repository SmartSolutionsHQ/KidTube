# Running KidTube

Day to day: the parent dashboard, backups, getting back into an account, and what to check when something
looks wrong. Installing is in [INSTALL.md](INSTALL.md) and updating in [UPGRADING.md](UPGRADING.md).

## The parent dashboard

Sign in at `/parents` with the parent account. The menu has ten parts:

- **Home:** what needs you now (videos to review, comments to read, people asking to watch), recent activity,
  the latest watching and how much disk is left.
- **Review:** each kid's upload waits here when review is on. Watch it, then Approve or Keep private.
- **Kids:** add, rename, reorder or remove a kid; change their colour, badge, intro and login; turn upload review
  on or off; set a daily watch limit for their login.
- **Videos:** upload, hide, rename, reorder or delete any video, and seal one as a time capsule.
- **Comments:** comments waiting to show, plus ones already showing or hidden. Show, hide or delete each one.
- **People:** who asked to watch (Let them watch or Turn down), viewers, co-parents and kid logins. Set a
  password, make a viewer a co-parent, give someone a daily watch limit, or remove them.
- **Guest codes:** a one-time code for someone without an account, for all kids or one. It must be used within
  a day and then works for 24 hours. Print a card with a QR, or copy the code.
- **Activity:** uploads, reviews, comments, sign-ups, guest codes and changes, newest first.
- **Who watched:** which video each person played and how much of it, kept for 90 days.
- **Settings:** the family's name, line, colour and badge, the web address, who can watch, how long history is
  kept, email, splash sound and the family time zone.

**Co-parents** (a viewer you promoted under People) see Home, Review, Videos, Comments, Guest codes and
Activity. Kids, People, Who watched and Settings stay with the parent who set KidTube up.

**A setting shown as locked** comes from `.env`. To change it in the dashboard again, remove the line from
`.env` and run `docker compose up -d` (or restart `npm start`).

**Moving to a new address** (say, from your Wi-Fi address to a Tailscale or domain one): change the web address
under Settings. After saving, the old address stops accepting changes; open the new one and sign in again.
Everyone else signs in once at the new address too.

### Time capsules, reactions and daily limits

- **Time capsules.** Seal an approved video until a date, from an hour to 25 years away, with a short note. It
  stays in its kid's channel as a locked tape showing the date and the note; only parents can play it before
  then. On the day it moves to the top of the channel, the new-video email goes out (when email is on), and each
  viewer sees the theme's unlock the first time. "Open now" opens it at once.
- **Reactions.** Signed-in viewers can add five stickers (wow, fire, star, party, cool) next to the heart. Guests
  can't. Everyone sees the counts, never who reacted.
- **Daily limits.** Give a viewer or a kid login from 15 minutes to 3 hours of video a day, and add 15 to 120
  bonus minutes for today. Parents, co-parents and guests are never limited. The day follows the family time
  zone. The feed warns at 5 minutes and 1 minute left, then shows the theme's "end of tape" screen, and the
  server refuses more video until midnight. It relies on the feed reporting watch time, so a tampered browser
  isn't stopped: it is a family agreement, not a lock.
- **Who watched.** A video played for 3 seconds or more is recorded: who, which video, when, how long and whether
  they finished. No IP address or device details are kept. `VIEWS_RETENTION_DAYS` (90 by default) and
  `ACTIVITY_RETENTION_DAYS` (365) change how long history and activity are kept, as does Settings.

## Back up and restore

Everything KidTube keeps is in one data folder: in Docker, the `kidtube-data` volume (`kidtube_kidtube-data` in
`docker volume ls`); without Docker, `data/` next to the app; or the folder named by `KIDTUBE_DATA` in `.env`.

| Path | What |
| --- | --- |
| `kidtube.sqlite` (plus `-wal` and `-shm` while running) | Accounts, kids, video details, comments, settings, activity, watch history, the email queue |
| `videos/` | Converted videos and posters |
| `brand/` | The family badge, kids' badges and pictures, home-screen icons |
| `secret` | The signing key. Without it everyone is signed out (unless `SIGN_SECRET` is set in `.env`) |
| `backups/` | Snapshots, including the automatic one before each upgrade |
| `incoming/` | Uploads in progress; not needed in a backup |

Your `.env`, if you have one, holds any locked settings and the email key. Back it up too.

**A database snapshot** is safe while the app runs:

```bash
docker compose exec kidtube node scripts/backup.mjs
```

(`npm run backup` without Docker.) It prints the path of a timestamped copy in `backups/`. Copy that file with
`videos/`, `brand/`, `secret` and `.env` to somewhere off this computer. For a matching set, avoid uploads and
reviews while you copy.

**The whole volume**, from the install folder:

```bash
docker compose stop kidtube
docker run --rm -v kidtube_kidtube-data:/data -v "$PWD":/out alpine tar czf /out/kidtube-backup.tgz -C /data .
docker compose start kidtube
```

Protect backups like the original: they hold personal data and the means to sign in.

**To restore:** stop the app and move the current data aside (don't delete it until the restore works). Put the
snapshot back as `kidtube.sqlite`, with the matching `videos/`, `brand/` and `secret` beside it and no leftover
`-wal` or `-shm` files from another database. The files must belong to 1000:1000 (or your `PUID`:`PGID`). To
restore the archive above into an empty volume:

```bash
docker run --rm -v kidtube_kidtube-data:/data -v "$PWD":/in alpine tar xzf /in/kidtube-backup.tgz -C /data
```

Then start the app and check sign-in, playback, comments and a test upload.

**Disk space.** Videos fill the disk over time; Home in the dashboard shows what is left. Keep backups on another
disk. Uploads nobody finished are deleted after a day, and an upload cut off by a restart is marked failed, so
the kid can send it again.

## Getting back into a parent account

The parent who set KidTube up can set a new password for anyone under People. Passwords need 12 to 128
characters (8 for kid logins), and a new password signs that account out everywhere.

If the only parent is locked out, stop the app and run this from the install folder, with that parent's email:

```bash
docker compose run --rm kidtube node scripts/reset-parent.mjs parent@example.com
```

(Without Docker: `node --env-file-if-exists=.env scripts/reset-parent.mjs parent@example.com`.) It prints a new
password once. It only works for the parent who set KidTube up, and never turns a viewer into a parent. Anyone
who can read the data folder already controls the install, so protect the computer.

## Health and logs

```bash
docker compose ps
docker compose logs --tail=100 kidtube
curl -fsS http://127.0.0.1:3000/api/health
```

The health check says the app answers. It doesn't check video conversion, disk space, certificates or email.
Without Docker, `npm run doctor` checks Node, FFmpeg and the data folder.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| Setup asks for a code after an update | Compose started a new, empty volume. If your data is in a folder, put `KIDTUBE_DATA=./data` in `.env` ([UPGRADING.md](UPGRADING.md)) |
| The log prints a `chown` command | The data folder belongs to the wrong user; run the command it prints |
| "This is not the web address this family uses" | Open the address from Settings, or add the name to `ALLOWED_HOSTS` in `.env` |
| Sign-in works but videos don't play, or changes fail | Use exactly the web address from Settings. Don't mix `localhost` and `127.0.0.1`, or `http` and `https` |
| Kids on iPhone are signed out in the home-screen app | Expected once: iOS home-screen apps keep their own sign-in |
| The app won't install on a phone | Phones install only from `https://`; see the HTTPS parts of [INSTALL.md](INSTALL.md) |
| No videos after signing in | A new channel is empty; upload from the dashboard's Videos |
| A kid sees "That's the tape for today" | Their daily limit is spent; add bonus minutes or change the limit |
| A video shows as a locked tape | It is a time capsule; parents can play it or open it now |
| The daily limit resets at the wrong hour | Check the family time zone in Settings (or `FAMILY_TIMEZONE`) |
| An upload fails converting | Videos must be under five minutes and 512 MB; check free disk. Without Docker, check FFmpeg |
| No email | Email is off by default; see [EMAIL.md](EMAIL.md) |
| "Too many attempts" or "too many wrong passwords" | Wait ten to fifteen minutes, or set a new password under People. Behind a proxy, check `TRUST_PROXY` |
| Caddy can't get a certificate | Check public DNS, ports 80 and 443, CGNAT, and anything else using those ports |
