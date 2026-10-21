# KidTube

**A little channel. A big imagination.**

KidTube is a self-hosted video channel for a family and its invited viewers. Parents manage accounts and choose who can upload. It starts empty: no sample children, family photos, videos, accounts, production credentials, or external analytics.

Built by SmartSolutionsHQ from a family project, with a reusable design and installation process. This is an early community release for one household per installation. Keep backups and review the [security model](SECURITY.md) before exposing it to the internet.

## What is included

- Scrollable video feed with playback recovery, shuffle, likes, and comments.
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

## Quick start with npm

Clone this repository, then run setup. There are no third-party Node runtime dependencies to install.

```sh
git clone https://github.com/SmartSolutionsHQ/KidTube.git
cd KidTube
npm run setup
npm run doctor
npm start
```

Setup asks for the parent's email and the site's full URL. For a local trial, accept `http://localhost:3000`. It creates a blank database, a unique signing secret in `.env`, and one approved parent owner. A generated parent password is printed once: save it in your password manager. Setup refuses to overwrite an existing `.env` or database.

Open the site, select **Enter the channel**, log in, and open the **Parent dashboard**. Upload the first video there. The channel remains empty until you upload something. If `doctor` reports missing FFmpeg/FFprobe, install them or use Docker before testing uploads.

### npm package / one-command generator

The repository includes a `create-kidtube` executable. You can use it from GitHub without a published npm registry package:

```sh
npx --package=github:SmartSolutionsHQ/KidTube create-kidtube my-family-tube
cd my-family-tube
npm run setup
```

For a reproducible installation, replace the GitHub package reference with `github:SmartSolutionsHQ/KidTube#<commit-sha>` from a version you reviewed. The generator copies only starter files and refuses an existing destination. It does not copy `.env`, databases, or uploads, and it does not start services or send mail.

The package is prepared for the npm registry but **is not published there as part of this release**. `npm pack` produces a distributable archive; publishing `@smartsolutionshq/kidtube` requires access to that npm scope. GitHub installation works without that extra account setup.

## Docker setup (no host Node or FFmpeg needed)

```sh
git clone https://github.com/SmartSolutionsHQ/KidTube.git
cd KidTube
docker build -t kidtube:local .
docker run --rm -it --user "$(id -u):$(id -g)" \
  -e DATABASE_PATH=/workspace/data/kidtube.sqlite \
  -v "$PWD:/workspace:Z" -w /workspace \
  kidtube:local node /app/scripts/setup.mjs
docker compose up -d --build
```

These setup commands are for a Linux/macOS shell. For PowerShell with Docker Desktop, use:

```powershell
docker build -t kidtube:local .
docker run --rm -it --user 1000:1000 -e DATABASE_PATH=/workspace/data/kidtube.sqlite -v "${PWD}:/workspace" -w /workspace kidtube:local node /app/scripts/setup.mjs
docker compose up -d --build
```

On Linux, set `PUID` and `PGID` in `.env` to your host user's `id -u` and `id -g` values before starting Compose. Those IDs must own `data/`. The default is 1000:1000. The app runs without root privileges, uses a read-only image, and writes only to its data mount and temporary filesystem. On systems without SELinux the `:Z` label is unnecessary and can be removed if unsupported.

Visit `http://localhost:3000` on the Docker host for a local trial. The default port binding accepts connections only from the host. It does not expose an unencrypted app port on your LAN or the internet.

## Deploy with a domain and HTTPS

1. Point a domain or subdomain, such as `videos.example.com`, to the server's reachable public IP. If hosting at home, forward ports 80 and 443 to the host. If your provider uses CGNAT, use a VPS or an HTTPS tunnel instead of port forwarding.
2. Set `SITE_URL=https://videos.example.com` in `.env`. This exact origin is used in email links, cookies, and browser request checks.
3. Start the included HTTPS proxy:

   ```sh
   docker compose -f compose.yaml -f compose.https.yaml up -d --build
   ```

4. Caddy obtains and renews certificates when DNS and inbound connectivity are correct. Open the HTTPS site, sign in, and upload a short test clip. Check it from another browser without signing in: `/api/clips` and the direct video URL should return 401.
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
