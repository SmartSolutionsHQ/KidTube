# Installing KidTube

This guide is for parents who have never run a server. Each part says what you need, what to type, and what you
should see. You can stop after any part and come back later.

1. [What you need](#what-you-need)
2. [Install it](#install-it)
3. [The setup page](#the-setup-page)
4. [Phones on your home Wi-Fi](#phones-on-your-home-wi-fi)
5. [Private HTTPS with Tailscale, no domain needed](#private-https-with-tailscale-no-domain-needed)
6. [Your own domain](#your-own-domain)
7. [An existing reverse proxy](#an-existing-reverse-proxy)
8. [Put it on phones](#put-it-on-phones)
9. [A tour of the parent dashboard](#a-tour-of-the-parent-dashboard)
10. [Without Docker](#without-docker)

## What you need

- **A computer that stays on.** A mini PC, a NAS, an old laptop with the lid open, or a Raspberry Pi 4 or 5 with
  4 GB of memory. Two processor cores and 2 GB of memory are a comfortable start. KidTube runs on Linux, macOS
  and Windows through Docker.
- **Disk space for videos.** Each kid video is converted to 480p and is usually 5 to 30 MB. Start with 10 GB free
  and keep an eye on the dashboard's storage card.
- **Docker.** On a NAS this is often an app called Container Manager, Docker or Container Station. On a computer,
  install [Docker Desktop](https://docs.docker.com/get-docker/) or Docker Engine with Compose. Compose must be
  version 2.24 or later (`docker compose version` shows it); older versions stop at the optional `.env` line.
- **On a Mac without Docker Desktop**, the free [Colima](https://github.com/abiosoft/colima) works. With
  [Homebrew](https://brew.sh):

  ```bash
  brew install colima docker docker-compose
  ```

  Homebrew then asks you to tell Docker where Compose lives. Create `~/.docker/config.json` with exactly this
  (or add the line to the file if it already exists), or `docker compose` answers "unknown command":

  ```json
  { "cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"] }
  ```

  Then start it with `colima start` (again after each restart of the Mac, or `brew services start colima` to
  start it at login). Colima only shares your home folder, so keep the `kidtube` folder inside it.
- **About fifteen minutes**, and a parent email address. Email delivery itself is optional.

Nothing else is needed: no database to set up, no cloud account, no domain to start with.

## Install it

Open a terminal on that computer (on a NAS, connect with SSH, or use its Compose "project" screen and paste
`compose.yaml`). Then:

```bash
git clone https://github.com/SmartSolutionsHQ/KidTube.git kidtube && cd kidtube
```

```bash
docker compose up -d
```

```bash
docker logs kidtube
```

The first start builds the app, which takes a few minutes. The log then ends like this:

```text
Ready for setup.
Open http://localhost:3000/setup
Setup code: KT-7QMXR-4PD9H-ZKWN2-C8TV5
The code works once and changes every restart until setup is done.
```

Keep that code handy. It proves you are the one who started this install, so nobody else on your network can
claim it first. Five wrong tries from one device wait ten minutes; thirty wrong tries turn the code off until you
restart (`docker compose restart`), which prints a new one.

Everything KidTube keeps (the database, the videos, the kids' badges and a private signing key) lives in a Docker
volume called `kidtube-data` (Docker lists it as `kidtube_kidtube-data`, after the folder). That is the one thing
to back up; [OPERATIONS.md](OPERATIONS.md) shows how.

### On a NAS

- **Synology:** in Container Manager, create a Project, point it at the `kidtube` folder you cloned (or paste
  `compose.yaml`), and start it. The log is under the container's Details.
- **Unraid, TrueNAS SCALE, QNAP and others:** use their Docker Compose support with the same `compose.yaml`.
- **If your NAS wants files in a shared folder** instead of a Docker volume, put `KIDTUBE_DATA=./data` in a file
  called `.env` next to `compose.yaml`. That folder must belong to the user the app runs as, which is 1000:1000
  unless you set `PUID` and `PGID` in `.env`. If it doesn't, the log prints the exact command to fix it, naming
  your folder (for example `sudo chown -R 1000:1000 "./data"`). Run it next to `compose.yaml`; KidTube keeps
  retrying and starts on its own once the folder is fixed.

## The setup page

Open the link from the log **on the same computer** (it says `localhost`) and enter the code. Seven steps follow:

1. **The setup code.**
2. **Your parent account.** Use a password manager, or let the page make a password for you.
3. **Your family.** A name like "The Okafor Tapes", a short line under it, and the web address people will use
   (it fills in what you opened; you can change it later in Settings).
4. **Your kids.** For each kid: a name, a line about them, a colour, a badge from the builder, and the intro that
   plays when someone opens their channel. Each kid can have their own login (a short name like `wren` and a
   password of 8 or more characters) so they can post videos from a phone.
5. **Who can watch.** Whether the front door shows the kids' names, whether new viewers can ask to join, guest
   codes, and whether you read comments before they show (recommended).
6. **Email**, if you want it. See [EMAIL.md](EMAIL.md). Everything works without it.
7. **Put it on your phone**, then add the first video.

You can close the page at any step. Signing in at `/setup` picks up where you left off.

## Phones on your home Wi-Fi

Out of the box, KidTube only answers the computer it runs on. To try it from phones at home:

1. Find the computer's address on your network (for example `192.168.1.20`). Your router's device list shows it.
2. Put `HOST_BIND=0.0.0.0` in `.env` next to `compose.yaml`, then run `docker compose up -d` again.
3. On a phone on the same Wi-Fi, open `http://192.168.1.20:3000`.
4. In the parent dashboard, under Settings, set the web address to that same `http://192.168.1.20:3000`.

This is fine for a trial. Two things to know: sign-ins on plain `http://` are not encrypted on your Wi-Fi, and
phones only install the app from an `https://` address. The next two parts fix both.

## Private HTTPS with Tailscale, no domain needed

[Tailscale](https://tailscale.com) is a free private network for your own devices. It gives the KidTube computer
an `https://` address that only devices in your Tailscale network can open. Nothing is opened to the internet,
and you don't need a domain or router settings.

The trade-off: everyone who watches needs the Tailscale app on their phone and an invite to your network.
That suits a household and close family; for a wider circle, use [your own domain](#your-own-domain).

1. Install Tailscale on the KidTube computer and sign in. In the Tailscale admin console, under DNS, check that
   **MagicDNS** and **HTTPS Certificates** are on (they are for new accounts).
2. On the KidTube computer, run:

   ```bash
   tailscale serve --bg 3000
   ```

   It prints the address, something like `https://kidbox.tail1234.ts.net`. It keeps running after reboots;
   `tailscale serve off` stops it.
3. Put that address in `.env` next to `compose.yaml`, then run `docker compose up -d` again:

   ```text
   SITE_URL=https://kidbox.tail1234.ts.net
   ```

   If you already finished setup, change the web address in the dashboard's Settings instead.
4. Install Tailscale on each phone, sign in or accept your invite, and open the address.

Keep `HOST_BIND` at its default: Tailscale reaches the app on the computer itself.

## Your own domain

For family outside your home who shouldn't need Tailscale, use a domain or subdomain you own, such as
`videos.example.com`. KidTube includes Caddy, which gets and renews HTTPS certificates from Let's Encrypt on its
own.

What you supply, before step 3:

- **A domain or subdomain you control**, bought from any registrar. Nothing else is needed from a certificate
  company.
- **A DNS record** at your registrar: an `A` record from that name to your home's public IP address (and an
  `AAAA` record if you use IPv6). If your home address changes now and then, use your router's or registrar's
  dynamic DNS.
- **Ports 80 and 443 forwarded** on your router to the KidTube computer, and nothing else on that computer using
  them. Let's Encrypt checks the name over those ports from the internet. If your internet provider doesn't give
  you a public address (CGNAT), use a small cloud server or Tailscale instead.

Then:

1. Check the DNS record has arrived: `nslookup videos.example.com` should answer with your public IP address
   (a "what is my IP" website shows it). New records can take an hour.
2. Create `.env` next to `compose.yaml` with:

   ```text
   SITE_URL=https://videos.example.com
   COMPOSE_FILE=compose.yaml:compose.https.yaml
   ```

   The second line makes every `docker compose` command include Caddy, so `up`, `logs`, `pull` and `down` work
   as written everywhere in these guides.
3. Start KidTube with Caddy:

   ```bash
   docker compose up -d
   ```

4. Watch Caddy fetch the certificate (Ctrl+C stops watching):

   ```bash
   docker compose logs -f caddy
   ```

   "certificate obtained successfully" means it worked. "could not get certificate" means Let's Encrypt couldn't
   reach this computer as that name: check the DNS record and the port forwarding. Caddy keeps retrying on its
   own.
5. Open `https://videos.example.com/setup` and enter the code from `docker logs kidtube`.
6. Check it from a browser that isn't signed in: the front door opens, and videos ask you to sign in.

Keep Caddy's volumes; they hold its certificates. If you already finished setup on another address, `SITE_URL`
in `.env` takes over the web address in Settings.

## An existing reverse proxy

If you already run Nginx Proxy Manager, Caddy, Traefik or nginx, point it at KidTube instead of starting a second
Caddy:

- **Where to send traffic:** `http://127.0.0.1:3000` when the proxy runs on the same computer outside Docker. A
  proxy in another container reaches `http://kidtube:3000` once both share a Docker network (add the network in
  your own Compose override).
- **Settings for KidTube** in `.env`: `SITE_URL=https://videos.example.com` (exactly what people type), and
  `TRUST_PROXY=1` only if every request reaches KidTube through that proxy.
- **Settings for the proxy:** pass the original host and scheme, allow request bodies of at least 8 MB (uploads
  come in 4 MB pieces), give uploads a generous read timeout, and don't cache anything under `/api/`.

For nginx, the important lines are:

```nginx
client_max_body_size 8m;
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_read_timeout 300s;
```

[DEPLOYMENT.md](DEPLOYMENT.md) covers tunnels and running more than one family on one computer.

## Put it on phones

On any phone, open the family's address followed by `/install` (for example
`https://kidbox.tail1234.ts.net/install`). The page shows the steps for that phone:

- **Android (Chrome):** an "Install the app" button when Chrome offers one; otherwise the menu (three dots), then
  Install app or Add to Home screen.
- **iPhone and iPad (Safari):** the Share button, then Add to Home Screen, then Add. On newer iPhones the Share
  button sits in the menu button beside the address bar, and Add to Home Screen may be under View More. Leave
  "Open as Web App" switched on.

The icon is the family badge you made in setup, and the app opens full screen. iPhone suggests a short name
under the icon; you can change it in the same sheet before tapping Add.

**On iPhone and iPad, the home-screen app keeps its own sign-in**, separate from Safari. Kids and family sign in
once more the first time they open it from the home screen. That is how iOS works for every home-screen app.

Phones only install from an `https://` address. On plain `http://` the site still works in the browser.

## A tour of the parent dashboard

Sign in at `/parents` with the parent account. The menu has ten parts:

- **Home:** what needs you now (videos to review, comments to read, people asking to watch), recent activity and
  the latest watching.
- **Review:** each kid's upload waits here when review is on. Watch it first, then Approve or Keep private.
- **Kids:** add, rename, reorder or remove a kid; change their colour, badge, intro and login; turn upload review
  on or off; set a daily watch limit for their login.
- **Videos:** hide, rename, reorder or delete any video, and seal one as a time capsule until a date, with a note.
- **Comments:** comments waiting to show, plus ones already showing or hidden. Show it, hide it, or delete it.
- **People:** who asked to watch (Let them watch or Turn down), viewers, co-parents and kid logins. Set a
  password for anyone, make a viewer a co-parent, or give someone a daily watch limit and bonus minutes.
- **Guest codes:** make a one-time code for someone without an account, for all kids or one. It must be used
  within a day and then works for 24 hours. Print a card with a QR, or copy the code.
- **Activity:** uploads, reviews, comments, sign-ups, guest codes and changes, newest first, filtered by kind
  and kid.
- **Who watched:** each video each person played and how much of it. It is kept for 90 days, then deleted
  (`VIEWS_RETENTION_DAYS` in `.env` changes that; activity uses `ACTIVITY_RETENTION_DAYS`, 365 by default).
- **Settings:** family name, line, colour and badge, the web address, who can watch, email, splash sound and the
  family time zone.

**Co-parents** (a viewer you promoted under People) can review videos, read comments, make guest codes and see
activity. Kids, People, Who watched and Settings stay with the parent who set KidTube up.

**Moving to a new address** (say, from your Wi-Fi address to a Tailscale or domain one): change the web address
under Settings. The page shows the new link before you save. After saving, the old address stops accepting
changes; open the new one and sign in again. Everyone else signs in once at the new address too.

The **Add to a home screen** link at the bottom of the menu opens the install page.

## Without Docker

You need Node 24 (24.16 or later in the 24 line) and FFmpeg on the computer. There is nothing to `npm install`.

```bash
git clone https://github.com/SmartSolutionsHQ/KidTube.git kidtube && cd kidtube
npm run doctor
npm start
```

`npm run doctor` checks Node, FFmpeg and the data folder without changing anything. `npm start` prints the same
setup link and code; everything is kept in `data/` next to the app. Use a service manager (systemd, launchd, NSSM
on Windows) to start it at boot, and a reverse proxy for HTTPS.

## If something goes wrong

[OPERATIONS.md](OPERATIONS.md) has a troubleshooting table, how to read the logs, and how to get back into a
parent account. If you are stuck, open an issue on GitHub, and never attach a real `.env`, database, backup or
video.
