# Running the public demo

The demo is a normal install started with `DEMO_MODE=1`. It shows an invented family, **The Demo Family**:
three kids (Juni, Otto and Mabel) with their own badges, splash screens and colours, a dozen short clips,
comments from invented relatives, a time capsule that opens half an hour after each reset, a daily tape on
Juni and a "Who watched" history. Anyone can look around in ten seconds and nobody can post anything that
another visitor sees.

The clips are made on your server by FFmpeg from moving colour, titles and stickers already in this project.
There are no real people in them and no footage from anywhere else, so there is nothing to license.

## What a visitor can do

The front door offers **Try it as: a kid / Grandma / a parent**. One tap signs in to that demo account; there
are no passwords. A small "Demo" pill on every page says when the next reset is and links to installing your
own.

| | In the demo |
|---|---|
| Watch every kid's channel, open the sealed time capsule's countdown, see the parent dashboard | Yes |
| Hearts and the five reaction stickers | Yes. They are fixed choices, limited per visitor, and reset every hour. Other visitors see the counts. |
| Sign up, log in with a password, redeem or make guest codes | No |
| Upload, comment, delete, rename, approve, seal, change budgets, settings, badges, pictures, people or kids | No: the server answers "Changes are off in the demo" and the screen says so |
| Email of any kind | No: email is locked off |
| Watching history | Shown as seeded. A visitor's own watching is never recorded, so it never shows to another visitor or spends Juni's tape |

All of this is enforced on the server, not only hidden in the page. Every request that is not a read is refused
unless it is one of the few above, so a route added later is refused too until someone decides otherwise.
`DEMO_MODE` is read from the server's environment only; nothing a browser sends can turn it on or off.

## What it needs

- A small Linux VPS: 1 vCPU and 1 GB of memory are plenty; the demo's files take about 10 MB.
- Docker with Compose, or Node 24.16+ (within 24.x) with FFmpeg and FFprobe on the PATH.
- A domain name pointed at the server, and HTTPS. The included Caddy setup gets a certificate for you.

**Never run the demo on a family's install.** The demo replaces its data every hour. It refuses to start if its
database or data folder holds anything that is not the demo (it looks for its own marker in both), so setting
`DEMO_MODE=1` on a real install by mistake stops the server instead of wiping it. Give the demo its own server,
or at least its own folder and its own Docker volume.

## With Docker

In a new, empty folder for the demo (not a family's folder):

```bash
git clone https://github.com/SmartSolutionsHQ/KidTube.git demo && cd demo
```

Create `.env` in that folder:

```
DEMO_MODE=1
SITE_URL=https://demo.example.com
FAMILY_TIMEZONE=America/New_York
```

`FAMILY_TIMEZONE` is the clock the demo family lives on (capsule dates, "today" for the daily tape); pick the
zone most of your visitors are in. Then make the demo family, once, and start it with HTTPS:

```bash
docker compose -p demo run --rm kidtube node scripts/demo-seed.mjs
```

```bash
docker compose -p demo -f compose.yaml -f compose.https.yaml up -d --build
```

The seed takes about a minute and writes `/data/demo-snapshot` in the demo's volume. On start the server prints
`Demo mode: restored the invented family`. The HTTPS override sets `NODE_ENV=production` and `TRUST_PROXY=1`,
which the demo needs (see below).

## With Node

```bash
git clone https://github.com/SmartSolutionsHQ/KidTube.git /srv/demo && cd /srv/demo
```

```bash
npm run demo:seed
```

Start it with `DEMO_MODE=1`, `NODE_ENV=production`, `SITE_URL=https://demo.example.com` and `TRUST_PROXY=1`
(a `.env` file in the folder works), under a service manager and an unprivileged user, behind a reverse proxy
that terminates HTTPS. A systemd unit, for example:

```ini
[Service]
User=demo
WorkingDirectory=/srv/demo
Environment=DEMO_MODE=1 NODE_ENV=production TRUST_PROXY=1 SITE_URL=https://demo.example.com
ExecStart=/usr/bin/node server/index.mjs
Restart=always
```

and for Caddy:

```
demo.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

## Settings

| Variable | What it does |
|---|---|
| `DEMO_MODE` | `1` runs the demo. Unset or `0` is a normal install. Any other value stops the server, so a typo never half-enables it. |
| `DEMO_RESET_MINUTES` | How often the family is put back, on the clock (60 resets on the hour). Default 60, from 1 to 1440. |
| `DEMO_SNAPSHOT_DIR` | Where the seed writes and the server reads the snapshot. Default `<data folder>/demo-snapshot`. |
| `DEMO_INSTALL_URL` | Where "Install your own" points. Default: the README's install section on GitHub. |
| `FAMILY_TIMEZONE` | The demo family's clock. Recommended, as above. |
| `TRUST_PROXY` | `1` behind a reverse proxy, so likes, reactions and one-tap sign-ins are limited per visitor rather than for everyone at once. |
| `FFMPEG_PATH` | The FFmpeg the seed uses, when it is not on the PATH. |

Email and sign-ups are locked off in demo mode whatever `.env` says.

## Resets

The server restores the snapshot when it starts and then every `DEMO_RESET_MINUTES`, on the clock. A reset is
one SQLite transaction on the live database, so the site never goes down and nobody ever sees half a reset. Every
date in the family moves forward by the time since the seed, so the newest clip is always "1 hour ago" and the
time capsule always opens 30 minutes after the reset. A page left open across a reset turns its pill into
"just reset · tap to reload".

- **Reset now**: `npm run demo:reset` (with `DEMO_MODE=1` set), or `docker compose -p demo exec kidtube node scripts/demo-reset.mjs`.
  It is safe while the demo runs.
- **After an upgrade**: the demo keeps working (the snapshot is brought up to the new database version at start).
  Run the seed again to pick up new demo content, then reset.
- **Changing the family**: edit `scripts/demo-seed.mjs` (the kids, clips, comments and relatives are plain lists
  at the top), seed, reset. The database it makes is the same on every run.

## Keeping it safe

- **Its own server, or at least its own folder and volume.** The guard refuses a family's install, but there is no
  reason to put the two next to each other.
- **HTTPS only.** Set `SITE_URL` to the `https://` address and `NODE_ENV=production`.
- **`TRUST_PROXY=1` behind the proxy, and only then.** Without it every visitor looks like the proxy and shares one
  limit; with it on a server reachable without the proxy, a visitor could choose their own address.
- **No visitor addresses are kept.** The demo writes no IP address anywhere: the per-visitor limits live in memory
  under a key that changes at every start, and the tables that would hold addresses stay empty. Keep it that way
  at the proxy: Caddy writes no access log unless you add a `log` directive; with nginx, set `access_log off;` for
  the demo's server block.
- **Nothing to back up.** Everything in the demo's data folder can be made again with the seed.
- **Keep it updated** like any install (`docs/UPGRADING.md`), and watch the disk now and then.

## Good to know

- Everyone who taps "Grandma" is the same Grandma, so a heart one visitor takes back is gone for the next
  visitor too, until the next reset. That is the one thing visitors share, by design.
- The kid's daily tape shows the seeded 12 of 30 minutes. Because visitors' watching is not recorded, the server
  never runs it out; the end-of-tape screen is easiest to see on your own install.
- The demo's accounts live on the reserved `.invalid` domain, so no address in it can receive mail.
