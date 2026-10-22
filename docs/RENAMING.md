# Renaming the product

"KidTube" is a working name. The app spells it in exactly one place, `server/brand.mjs` (`BRAND_NAME`,
`WORDMARK`, `TAGLINE`, `ENDORSEMENT`, `DEFAULT_ACCENT`), and `test/brand.test.mjs` fails if any other file under
`server/` or `public/` mentions it. Pages say `{{brand.name}}`, `{{brand.wordmark}}`, `{{brand.tagline}}`,
`{{brand.endorsement}}` or `{{brand.accent}}` and the server fills them in; scripts read the name from
`GET /api/site` (`public/js/shell/site.js`). The home-screen app's name comes from the family's own name in
settings, and falls back to `BRAND_NAME`.

## Change for the rename

- `server/brand.mjs`.
- Packaging: `package.json` (`name`, `description`, the `create-kidtube` bin and its file name),
  `bin/create-kidtube.mjs` (usage text and the next-steps lines).
- Docker: the `kidtube` service and `container_name` in `compose.yaml` and `compose.https.yaml`, and the matching
  `reverse_proxy kidtube:3000` in `Caddyfile`. Changing the service name changes the command families type
  (`docker logs kidtube`), which the setup page (`public/setup/setup.js`), the ownership hint in
  `server/config.mjs`, `bin/create-kidtube.mjs` and the docs all print.
- CI and releases: the workflow names and the `kidtube:check` tag in `.github/workflows/test.yml`; the `IMAGE`
  (`ghcr.io/smartsolutionshq/kidtube`) and the `org.opencontainers.image.title` and description labels in
  `.github/workflows/release.yml`.
- Words: `README.md` (including the "not affiliated with YouTube or Google" line, which can go with the
  rename), `SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md` and `docs/`. The README's screenshots under `docs/images/` show the old name in the setup header
  and the dashboard footer; retake them on a scratch install.
- The mark: `public/assets/logo.svg`, then run `node scripts/dev/build-icons.mjs` to redraw the default
  home-screen icons in `public/assets/icons/`.
- The repository URL in `package.json`, `README.md` and `docs/INSTALL.md`, if the repository moves.

## Keep: internal identifiers

These are stored in browsers, databases, backups and deployment files. Renaming them would sign everyone out,
orphan a family's data or break existing installs, so they stay as they are:

| Identifier | Where it lives |
|---|---|
| `kid_access` | session cookie |
| `kid-session` | browser localStorage key |
| `X-Kid-Email`, `X-Kid-Token` | upload and dashboard request headers |
| `data/kidtube.sqlite`, `DATABASE_PATH=/data/kidtube.sqlite` | database file |
| `kidtube-data` | the Docker volume holding a family's data (`<folder>_kidtube-data`); a new name would start an empty install |
| `KIDTUBE_DATA` | `.env` switch that keeps data in a folder |
| `backups/kidtube-*.sqlite`, `backups/pre-migrate-v*-*.sqlite` | backup files |
| `KIDTUBE_ADMIN_EMAIL`, `KIDTUBE_ADMIN_PASSWORD` | `scripts/setup.mjs` environment |
| `<handle>@kids.invalid` | kid login addresses in the accounts table |
| `kid-site` | browser sessionStorage key (the page-chrome snapshot) |
| `kid:unlocked`, `tz:enter`, `tz:hold`, `kt:launch-change` | page events between the shell, feed, themes and dashboard |
| `--tz-*`, `--kt-auth-*`, `kt-*`, `kp-*`, `kd-*` | CSS variables and classes that themes and the dashboard depend on |
| `data-kt-theme` and `kt-<theme id>-` keyframes | the theme contract in `docs/THEMES.md` |
| `kt-shell-<version>` | the service worker's cache name (a rename would only re-download the shell) |
| `kt-opened-<id>` | browser localStorage key for capsules a viewer has seen open |
| `kt-always-enter` | browser localStorage key for "skip my intro next time" |
| `kt_sandbox`, `kidtube-demo-v1` | the demo's sandbox cookie, and the marker that tells a demo's data from a family's |

Lowercase identifiers like these are not the product name; the brand test ignores them.
