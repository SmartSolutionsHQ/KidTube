# Installing KidTube

This guide is for parents who have never run a server. Each part says what you need, what to type and what you
should see. You can stop after any part and come back later.

1. [What you need](#what-you-need)
2. [Install it](#install-it)
3. [The setup page](#the-setup-page)
4. [Phones on your home Wi-Fi](#phones-on-your-home-wi-fi)
5. [Private HTTPS with Tailscale, no domain needed](#private-https-with-tailscale-no-domain-needed)
6. [Your own domain](#your-own-domain)
7. [An existing reverse proxy or tunnel](#an-existing-reverse-proxy-or-tunnel)
8. [Put it on phones](#put-it-on-phones)
9. [Without Docker](#without-docker)
10. [A second family on the same computer](#a-second-family-on-the-same-computer)

Once it runs, [OPERATIONS.md](OPERATIONS.md) tours the parent dashboard and covers backups.

## What you need

- **A computer that stays on.** A mini PC, a NAS, an old laptop with the lid open, or a Raspberry Pi 4 or 5 with
  4 GB of memory. Two processor cores and 2 GB of memory are a comfortable start. KidTube runs on Linux, macOS
  and Windows through Docker.
- **Disk space for videos.** Each video is converted to 480p and is usually 5 to 30 MB. Start with 10 GB free.
- **Docker.** On a NAS this is often an app called Container Manager, Docker or Container Station. On a computer,
  install [Docker Desktop](https://docs.docker.com/get-docker/) or Docker Engine with Compose. Compose must be
  version 2.24 or later (`docker compose version` shows it); older versions stop at the optional `.env` line.
- **On a Mac without Docker Desktop**, the free [Colima](https://github.com/abiosoft/colima) works. With
  [Homebrew](https://brew.sh):

  ```bash
  brew install colima docker docker-compose
  ```

  Then tell Docker where Compose lives, or `docker compose` answers "unknown command". Create
  `~/.docker/config.json` with exactly this (or add the line if the file already exists):

  ```json
  { "cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"] }
  ```

  Start it with `colima start` (again after each restart, or `brew services start colima` to start it at
  login). Colima only shares your home folder, so keep the `kidtube` folder inside it.
- **About fifteen minutes**, and a parent email address. Sending email is optional.

Nothing else is needed: no database to set up, no cloud account, no domain to start with.

## Install it

Open a terminal on that computer (on a NAS, connect with SSH, or use its Compose "project" screen). Then:

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

The code proves you are the one who started this install, so nobody else on your network can claim it first.
Five wrong tries from one device wait ten minutes; thirty wrong tries turn the code off until you restart
(`docker compose restart`), which prints a new one.

Everything KidTube keeps lives in a Docker volume called `kidtube-data` (Docker lists it as
`kidtube_kidtube-data`, after the folder). That is the one thing to back up;
[OPERATIONS.md](OPERATIONS.md#back-up-and-restore) shows how.

### On a NAS

- **Synology:** in Container Manager, create a Project, point it at the `kidtube` folder you cloned, and start
  it. The log is under the container's Details.
- **Unraid, TrueNAS SCALE, QNAP and others:** use their Docker Compose support with the same `compose.yaml`.
- **If your NAS wants files in a shared folder** instead of a Docker volume, put `KIDTUBE_DATA=./data` in a file
  called `.env` next to `compose.yaml`. The folder must belong to the user the app runs as, 1000:1000 unless
  you set `PUID` and `PGID` in `.env`. If it doesn't, the log prints the exact command to fix it (for example
  `sudo chown -R 1000:1000 "./data"`). Run it next to `compose.yaml`; KidTube keeps retrying and starts on its
  own once the folder is fixed.

## The setup page

Open the link from the log **on the same computer** (it says `localhost`) and enter the code. Seven steps follow:

1. **The setup code.**
2. **Your parent account.** Use a password manager, or let the page make a password for you.
3. **Your family.** A name like "The Okafor Tapes", a short line under it, and the web address people will use
   (it fills in what you opened; you can change it later in Settings).
4. **Your kids.** For each kid: a name, a line about them, a colour, a badge and the intro that plays when
   someone opens their channel. Each kid can have their own login (a short name like `wren` and a password of 8
   or more characters) so they can post from a phone.
5. **Who can watch.** Whether the front door shows the kids' names, whether new viewers can ask to join, guest
   codes, and whether you read comments before they show (recommended).
6. **Email**, if you want it. See [EMAIL.md](EMAIL.md). Everything works without it.
7. **Put it on your phone**, then add the first video.

You can close the page at any step. Signing in at `/setup` picks up where you left off.

<p align="center">
  <img src="images/setup-done.jpg" alt="The last setup step: instructions for adding the app to an iPhone and an Android phone, and each kid's login" width="640">
</p>

## Phones on your home Wi-Fi

Out of the box, KidTube only answers the computer it runs on. To try it from phones at home:

1. Find the computer's address on your network (for example `192.168.1.20`). Your router's device list shows it.
2. Put `HOST_BIND=0.0.0.0` in `.env` next to `compose.yaml`, then run `docker compose up -d` again.
3. On a phone on the same Wi-Fi, open `http://192.168.1.20:3000`.
4. In the parent dashboard, under Settings, set the web address to that same `http://192.168.1.20:3000`.

Use the number, as above. Once the web address is set, other names such as `kidbox.local` get "This is not the
web address this family uses" unless you list them in `.env` as `ALLOWED_HOSTS=kidbox.local`.

This is fine for a trial. Two things to know: sign-ins on plain `http://` are not encrypted on your Wi-Fi, and
phones only install the app from an `https://` address. The next two parts fix both.

## Private HTTPS with Tailscale, no domain needed

[Tailscale](https://tailscale.com) is a free private network for your own devices. It gives the KidTube computer
an `https://` address that only devices in your Tailscale network can open. Nothing is opened to the internet,
and you don't need a domain or router settings.

The trade-off: everyone who watches needs the Tailscale app and an invite to your network. That suits a
household and close family; for a wider circle, use [your own domain](#your-own-domain).

1. Install Tailscale on the KidTube computer and sign in. In the Tailscale admin console, under DNS, check that
   **MagicDNS** and **HTTPS Certificates** are on (they are for new accounts).
2. On the KidTube computer, run:

   ```bash
   tailscale serve --bg 3000
   ```

   It prints the address, something like `https://kidbox.tail1234.ts.net`, and keeps running after reboots.
   `tailscale serve off` stops it.
3. Set that address as the web address: during setup, or in the dashboard's Settings afterwards.
4. Install Tailscale on each phone, sign in or accept your invite, and open the address.

Keep `HOST_BIND` at its default: Tailscale reaches the app on the computer itself.

## Your own domain

For family outside your home who shouldn't need Tailscale, use a domain or subdomain you own, such as
`videos.example.com`. KidTube includes Caddy, which gets and renews HTTPS certificates from Let's Encrypt on its
own.

What you supply first:

- **A domain or subdomain you control**, from any registrar.
- **A DNS record** at your registrar: an `A` record from that name to your home's public IP address (and an
  `AAAA` record if you use IPv6). If your home address changes now and then, use your router's or registrar's
  dynamic DNS.
- **Ports 80 and 443 forwarded** on your router to the KidTube computer, and nothing else on that computer using
  them. If your internet provider doesn't give you a public address (CGNAT), use Tailscale or a small cloud
  server instead.

Then:

1. Check the DNS record has arrived: `nslookup videos.example.com` should answer with your public IP address.
   New records can take an hour.
2. Create `.env` next to `compose.yaml` with:

   ```text
   SITE_URL=https://videos.example.com
   COMPOSE_FILE=compose.yaml:compose.https.yaml
   ```

   The second line makes every `docker compose` command include Caddy, so the commands in these guides work as
   written.
3. Start KidTube with Caddy:

   ```bash
   docker compose up -d
   ```

4. Watch Caddy fetch the certificate (Ctrl+C stops watching):

   ```bash
   docker compose logs -f caddy
   ```

   "certificate obtained successfully" means it worked. "could not get certificate" means Let's Encrypt couldn't
   reach this computer by that name: check the DNS record and the port forwarding. Caddy keeps retrying.
5. Open `https://videos.example.com/setup` and enter the code from `docker logs kidtube`.
6. Check it from a browser that isn't signed in: the front door opens, and videos ask you to sign in.

Keep Caddy's volumes; they hold its certificates. `SITE_URL` in `.env` overrides the web address in Settings.

## An existing reverse proxy or tunnel

If you already run Nginx Proxy Manager, Caddy, Traefik or nginx, point it at KidTube instead of starting a second
Caddy:

- **Where to send traffic:** `http://127.0.0.1:3000` when the proxy runs on the same computer outside Docker. A
  proxy in another container reaches `http://kidtube:3000` once both share a Docker network (add the network in
  your own Compose override file).
- **In `.env`:** `SITE_URL=https://videos.example.com` (exactly what people type), and `TRUST_PROXY=1` only if
  every request reaches KidTube through that proxy. Otherwise every visitor shares one rate limit, or a visitor
  who bypasses the proxy can pick their own address.
- **In the proxy:** pass the original host and scheme, allow request bodies of at least 8 MB (uploads come in
  4 MB pieces), give uploads a generous read timeout, and don't cache anything under `/api/`.

For nginx, the important lines are:

```nginx
client_max_body_size 8m;
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_read_timeout 300s;
```

**A tunnel** (when you can't open ports) works the same way: forward its hostname to `127.0.0.1:3000` and set
that hostname as `SITE_URL`. Keep KidTube's own sign-in even if the tunnel has a login of its own, and check the
tunnel's rules on video and bandwidth first.

## Put it on phones

On any phone, open the family's address followed by `/install` (for example
`https://kidbox.tail1234.ts.net/install`). The page shows the steps for that phone:

- **Android (Chrome):** an "Install the app" button when Chrome offers one; otherwise the menu (three dots), then
  Install app or Add to Home screen.
- **iPhone and iPad (Safari):** the Share button, then Add to Home Screen, then Add. On newer iPhones the Share
  button sits in the menu beside the address bar, and Add to Home Screen may be under View More. Leave "Open as
  Web App" switched on.

The icon is the family badge you made in setup, and the app opens full screen.

**On iPhone and iPad, the home-screen app keeps its own sign-in**, separate from Safari. Kids and family sign in
once more the first time they open it. That is how iOS works for every home-screen app.

Phones only install from an `https://` address. On plain `http://` the site still works in the browser.

## Without Docker

You need Node 24 (24.16 or later in the 24 line) and FFmpeg. There is nothing to `npm install`.

```bash
git clone https://github.com/SmartSolutionsHQ/KidTube.git kidtube && cd kidtube
npm run doctor
npm start
```

`npm run doctor` checks Node, FFmpeg and the data folder without changing anything. `npm start` prints the same
setup link and code, and keeps everything in `data/` next to the app. It listens only on `127.0.0.1` unless you
set `HOST`.

For scripted installs, `npm run setup` makes the parent account and a `.env` from the terminal before the first
start, instead of the setup page. You then add the kids in the dashboard; the settings it writes to `.env` are
locked there until you remove them.

To keep it running, use a service manager (systemd, launchd, NSSM on Windows) that starts it at boot, restarts
it after a failure, runs it as its own unprivileged user and uses the project folder as its working directory.
For anything beyond your own computer, put a reverse proxy with HTTPS in front, set `NODE_ENV=production` and
an `https://` `SITE_URL` in `.env`, and never open port 3000 to the internet.

## A second family on the same computer

One install holds every kid in a family. A second family needs its own install: its own folder, its own setup,
and never a copy of the first family's `.env` or data.

1. Clone KidTube into a second folder (say `kidtube-two`). Compose names the project and its volume after the
   folder, so the data stays apart.
2. In that folder, put `HOST_PORT=3001` in `.env`, and give the container its own name in a file called
   `compose.override.yaml`:

   ```yaml
   services:
     kidtube:
       container_name: kidtube-two
   ```

3. `docker compose up -d`, then `docker logs kidtube-two` for the setup code.

For public addresses, use one reverse proxy for both domains rather than two copies of Caddy fighting over ports
80 and 443. Never point two installs at the same data.

## If something goes wrong

[OPERATIONS.md](OPERATIONS.md#troubleshooting) has a troubleshooting table, how to read the logs and how to get
back into a parent account. If you are stuck, open an issue on GitHub, and never attach a real `.env`, database,
backup or video.
