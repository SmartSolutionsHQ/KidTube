# KidTube

**A little channel. A big imagination.**

KidTube is a self-hosted video channel for a family and its invited viewers. Parents manage accounts and choose who can upload. It starts empty: no sample children, family photos, videos, accounts, production credentials, or external analytics.

Built by SmartSolutionsHQ from a family project, with a reusable design and installation process. This is an early community release for one household per installation. Keep backups and review the [security model](SECURITY.md) before exposing it to the internet.

## What is included

- Scrollable video feed with playback recovery, shuffle, likes, and comments.
- Time capsules: seal a video until a birthday or any date, with a note; it waits in the channel as a locked tape and opens with the theme's own unlock.
- Sticker reactions from the people you approved, bursting over the video.
- An honest daily watch limit per account that ends in the theme's own "end of tape" screen, with bonus minutes a parent can add.
- Parent approval for new accounts; a dashboard at `/parents` to manage viewers and videos.
- Parent owner (`super`), uploader (`admin`), approved viewer, and temporary view-only guest roles.
- One-use guest codes, valid for 24 hours; redeemed guest access also expires after 24 hours.
- Chunked uploads up to 512 MB and approximately five minutes. FFmpeg converts video to H.264/AAC MP4, up to 480p, one job at a time.
- Server-side access checks for the catalog and video URLs. Copying a video URL into an unsigned-in browser does not grant access.
- Optional Brevo signup, approval, and new-video emails. New-video notifications have persistent retries and an unsubscribe link.
- SQLite storage, a Docker image definition, optional Caddy HTTPS proxy, setup wizard, backup command, and an npm-compatible starter generator.

No YouTube API, cloud database, paid video service, or separate database server is required. The software is MIT licensed. Hardware, storage, electricity, internet, and a domain can still cost money.

## Requirements

| Requirement | Why |
| --- | --- |
| An always-on Linux host, NAS, mini PC, or VPS | Stores the database and video files; runs the server |
| Docker Engine with Compose v2 | Recommended deployment; includes Node and FFmpeg in the image |
| Node 24.16+ within the 24.x line | Only needed on the host for the npm route; the Docker route includes it |
| FFmpeg and FFprobe on PATH | Required for uploads when running directly with Node; included in Docker |
| Persistent local disk | Allow room for final videos, incoming originals, and backups |
| A domain/subdomain and HTTPS | Required for an internet-facing installation |
| A parent email address | Identifies the first parent account; email delivery is optional |
| Optional Brevo account and verified sender | Sends transactional notifications |

A reasonable starting host has two CPU cores, 2 GB RAM, and at least 10 GB free disk. This is a planning suggestion, not a measured minimum; upload conversion and library size determine actual needs. Keep SQLite on local disk rather than a shared network filesystem. Run one app instance against each database.

## Install

### With Docker (recommended)

One command, then the rest happens in your browser. No `.env`, Node or FFmpeg needed on the host.

```sh
git clone https://github.com/SmartSolutionsHQ/KidTube.git
cd KidTube
docker compose up -d
docker logs kidtube
```

The log shows a link and a one-time setup code:

```text
Ready for setup.
Open http://localhost:3000/setup
Setup code: KT-7QMXR-4PD9H-ZKWN2-C8TV5
The code works once and changes every restart until setup is done.
```

Open the link on the same computer and follow the seven steps: the setup code, your parent account, your family's name and web address, your kids (each gets a channel with a badge, a splash screen and an accent color, plus an optional kid login), who can watch, optional email, and putting it on your phone. You can close the page at any step; signing in at `/setup` picks up where you left off.

The code stops anyone else from claiming a new install before you do. Five wrong tries from one device wait ten minutes, and after thirty wrong tries the code stops working until you restart (`docker compose restart`), which prints a new one. Inside the container the code is also in `/data/setup-token`.

What it creates, on first start: a database, a private signing secret (`/data/secret`) and the folders for videos and badges, all in the `kidtube-data` Docker volume. Back that volume up (see [operations](docs/OPERATIONS.md)). The app runs without root, from a read-only image, and listens only on `127.0.0.1` of the host by default. Set `HOST_PORT` in `.env` to use another port.

Installs that keep their data in a `./data` folder (from before the setup page) set `KIDTUBE_DATA=./data` in `.env` before `docker compose up -d`, so Compose keeps using that folder. On Linux, that folder must belong to `PUID`:`PGID` (default 1000:1000). If it doesn't, the log prints the exact `chown` command to fix it.

### With Node (npm)

Needs Node 24.16+ (24.x) and FFmpeg on the host. There are no Node dependencies to install.

```sh
git clone https://github.com/SmartSolutionsHQ/KidTube.git
cd KidTube
npm run doctor
npm start
```

`npm start` prints the same link and setup code; the code is also saved in `data/setup-token`. Everything lives in `data/` next to the app. `npm run doctor` checks Node, FFmpeg and the data folder without changing anything.

Prefer the terminal? Instead of the browser steps, run `npm run setup` **from the install folder** before the first start. It asks for the parent email and the site address, writes `.env` (with the signing secret) into the current folder, creates the parent account and prints a generated password once. It refuses to touch an existing install, including one the server already created on its first start (finish that one at `/setup`).

### Starter folder from GitHub

```sh
npx --package=github:SmartSolutionsHQ/KidTube create-kidtube my-family-tube
cd my-family-tube
docker compose up -d
```

For a reproducible install, use `github:SmartSolutionsHQ/KidTube#<commit-sha>` from a version you reviewed. The generator copies only starter files and refuses an existing folder. It copies no `.env`, database or videos, and starts nothing. The package is prepared for the npm registry but is not published there yet.

### On your home network, and HTTPS

The default setup is reachable only from the computer running it. To try it from phones on your Wi-Fi, put `HOST_BIND=0.0.0.0` in `.env` (or run `npm start` with `HOST=0.0.0.0`), restart, and enter the computer's network address (such as `http://192.168.1.20:3000`) as the web address in setup. The wizard warns about this: plain http works in a browser, but sign-ins aren't encrypted and phones only install the app from an `https://` address. For anything beyond a trial, use HTTPS as below.

## Deploy with a domain and HTTPS

1. Point a domain or subdomain, such as `videos.example.com`, to the server's reachable public IP. If hosting at home, forward ports 80 and 443 to the host. If your provider uses CGNAT, use a VPS or an HTTPS tunnel instead of port forwarding.
2. Create `.env` with `SITE_URL=https://videos.example.com`. Caddy needs it to get a certificate, and the app uses this exact origin in email links, cookies and browser request checks (the setup page then shows it as fixed).
3. Start the included HTTPS proxy:

   ```sh
   docker compose -f compose.yaml -f compose.https.yaml up -d --build
   ```

4. Caddy obtains and renews certificates when DNS and inbound connectivity are correct. Open `https://videos.example.com/setup`, enter the setup code from `docker logs kidtube`, and finish setup. Then upload a short test clip. Check it from another browser without signing in: `/api/clips` and the direct video URL should return 401.
5. Save a backup before adding real family videos.

Keep Caddy's volumes: they contain certificate state. Another service cannot already own host ports 80/443. See [deployment options](docs/DEPLOYMENT.md) for an existing reverse proxy, tunnels, and multiple family channels.

## Optional free-tier email

KidTube uses **Brevo's hosted transactional email API**, not a bundled mail server. It does not host a mailbox or require opening SMTP ports. Follow [the email setup guide](docs/EMAIL.md) to create a Brevo account, authenticate your sending domain, verify a sender, create an API key, and test delivery.

Email starts disabled. With `MAIL_MODE=disabled`, the parent checks pending requests in the dashboard and approves them manually; viewers return to log in after approval. No messages are sent or queued for videos published while email is disabled.

## Make it your own

Your family's name, tagline and accent color are settings, not code. Add them to `.env` and restart:

```
SITE_NAME=The Example Tapes
SITE_TAGLINE=A little channel. A big imagination.
FAMILY_ACCENT="#FF5C2B"
```

The name (up to 60 characters) and tagline (up to 120) show on the front door, in the header and in page titles. The accent is a `#rrggbb` color used for buttons, progress bars and highlights; keep the quotes, because `.env` reads an unquoted `#` as the start of a comment. Pick a color that reads well on near-black. Leave a line out to keep its default. A value set in `.env` locks that setting, so nothing else can change it while it is there.

For deeper changes, no build framework is needed:

- `public/css/base.css` holds the shared look: background and text colors, the default accent and the fonts. `feed.css` styles the video feed, `kid.css` the front door and sign-in card, and `page.css` the about and parent pages.
- `public/about/index.html` is the about page and `public/assets/logo.svg` the logo.
- The product name lives only in `server/brand.mjs`; see [renaming](docs/RENAMING.md).

Email copy lives in `server/mail.mjs`, `server/api.js`, and `server/notifications.mjs`; timestamps in video emails use UTC. Rebuild the Docker image after source changes so compressed assets are regenerated.

One installation is one channel. For siblings with different channels, create separate directories, secrets, databases, Compose project names, and host ports. See [deployment options](docs/DEPLOYMENT.md).

## Operating and contributing

- [Backups, restores, updates, account recovery, and troubleshooting](docs/OPERATIONS.md)
- [Security model and responsible reporting](SECURITY.md)
- Run `npm test` for automated checks. Upload integration tests need FFmpeg and FFprobe.
- Never attach a real `.env`, family database, backup, or video to a public issue.
- Keep new changes generic; test against a temporary empty installation, not a family's live site.

KidTube is a family project, not an unattended public social network. A parent remains responsible for inviting people, approving accounts, reviewing comments, and deciding what to share.
