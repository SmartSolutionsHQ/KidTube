# Install test hand-over: Docker and the iPhone home-screen app (2026-10-22)

Branch `claude/install-test-88e3b0`, cut from `foundation-clean`. Not pushed, tagged or published.
`npm test`: 260 pass on Node 24.18 (259 before, plus one for the ownership fix). Full results are in
`docs/VERIFY.md` under "Install paths".

## What was installed on this Mac

- Homebrew: `colima` 0.10.3 (with `lima` 2.2.1), `docker` CLI 29.9.2, `docker-compose` 5.6.1. Docker Desktop was
  not installed (licence decision left with Eddie).
- `~/.docker/config.json` created with `cliPluginsExtraDirs` so `docker compose` works. Without it Homebrew's
  Compose plugin isn't found.
- Colima's default VM (arm64, 2 CPUs, 2 GB, 100 GB disk) exists and is **stopped**. `colima start` brings it back;
  `colima delete` removes it. No images, containers, volumes or build cache are left in it.
- The test simulator ("KidTube Install Test") was created and then deleted. Other simulators were not touched.

## What changed

| Area | Files |
|---|---|
| Ownership fix names the host folder | `server/config.mjs` (`ownershipFix(dir, env)` reads `HOST_DATA`), `compose.yaml` passes `HOST_DATA: "${KIDTUBE_DATA:-kidtube-data}"`, test in `test/setup.test.mjs`. The name avoids the product name on purpose (`test/brand.test.mjs`). `scripts/doctor.mjs` calls it unchanged. |
| HTTPS overlay | `compose.https.yaml` passes `SITE_URL` to the app as well as Caddy |
| CI | `test.yml` now boots `compose.yaml` with no `.env` (`up -d --wait`), checks the setup code in the log, uid 1000 and a read-only root, then `down -v`. Checked locally with Colima. |
| Docs | `INSTALL.md`: Compose 2.24+, the Colima route and its config line, the ownership message, what a parent supplies for their own domain (registrar, A/AAAA record, ports 80/443), `COMPOSE_FILE` in `.env`, watching Caddy's log; newer iPhone menus. `VERIFY.md`: a CI line and the dated results. |

## Rules worth keeping

- In Docker the server only sees `/data`. Anything that tells a parent about a folder must use `HOST_DATA` (set by
  `compose.yaml`), or it names a path that doesn't exist on their computer.
- `.env` reaches the app through `env_file`, but a variable exported in the shell reaches only what
  `compose*.yaml` passes explicitly. Pass anything both Caddy and the app need in both places.
- Colima only shares `$HOME` with its VM. Bind mounts (`./data`, `./Caddyfile`) from `/tmp` or other places
  outside home silently mount an empty folder.

## For other sessions (outside this session's files)

- **README (naming session):** nothing in it is wrong after this test. It names neither Docker Desktop nor the
  HTTPS overlay. Optionally, one line telling Mac owners that INSTALL.md covers a free Docker (Colima).
  `UPGRADING.md` line 26 still says to add both `-f` flags for Caddy; that still works, and `COMPOSE_FILE` in
  `.env` makes it unnecessary.
- **Kid login autocorrect, worth fixing before launch:** `public/js/shell/auth-dialog.js:120` sets
  `autocapitalize` and `spellcheck` on the login field but not `autocorrect="off"`. On iOS, typing `ivy` and
  pressing Return turned it into "I'm". A kid will hit this on day one.
- **Raw error code:** a failed sign-in showed "creds" under the form (the API's 400 code), not a sentence.
- **iPhone steps in the app:** `public/install/index.html:49-50` and `public/setup/setup.js:468` say "Tap the Share
  button". On iOS 26+ Safari, Share is inside the menu next to the address bar and Add to Home Screen can be
  under View More.
- **Home-screen label:** `short_name` cut "The Pellwick Tapes" to "The Pellwick". Dropping a leading "The" or
  trailing "Tapes" might read better than cutting at a word boundary.
- **Portrait video is 270×480:** `server/uploads.mjs` scales to fit 854×480, so a phone's vertical video loses
  its width. For a vertical feed, capping the short side at 480 (480×854) would look sharper.
- **Launch screen:** the home-screen app showed plain white for a few seconds before the dark front door (iOS
  ignores `background_color`; an `apple-touch-startup-image` or a dark `<body>` background earlier would help).
- **Narrow Safari header:** at about 380 px the kid's name truncated to "I…" and "SWITCH KID" wrapped (M8 noted
  the wrap).

## Not covered, with reasons

- **A real domain and Let's Encrypt certificate:** none to hand. The chain was proven with Caddy's internal
  authority on `kidtube.localhost`, and the failure mode with a domain not pointed here.
- **A real iPhone, and installing from a LAN `http://` or real `https://` address:** only the Simulator over
  `http://localhost` (a secure context). On a LAN `http://` address there is no service worker; whether iOS still
  opens it standalone was not checked.
- **Older Compose (before 2.24) on NAS boxes:** not tried; INSTALL.md now states the minimum.
- **Reduced motion on themes other than Arcade on the device:** the kid account only reaches its own channel;
  the playground check from M8 covers all six.
- **Windows and Linux hosts, amd64:** only arm64 macOS via Colima.
