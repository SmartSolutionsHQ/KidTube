# Renaming the product

"KidTube" is a working name. The server spells it in exactly one place, `server/brand.mjs`
(`BRAND_NAME`, `WORDMARK`, `TAGLINE`, `ENDORSEMENT`, `DEFAULT_ACCENT`), and `test/brand.test.mjs`
fails if any other file under `server/` or `public/` mentions it. Pages say `{{brand.name}}`,
`{{brand.wordmark}}`, `{{brand.tagline}}`, `{{brand.endorsement}}` or `{{brand.accent}}` and the server
fills them in; scripts read the name from `GET /api/site` (`public/js/shell/site.js`).

## Change for the rename

- `server/brand.mjs`
- Packaging and project names: `package.json` (`name`, `description`, the `create-kidtube` bin),
  `bin/create-kidtube.mjs`, the `kidtube` service in `compose.yaml` and `compose.https.yaml`, the
  `kidtube:check` image tag and workflow name in `.github/workflows/test.yml`
- `README.md`, `SECURITY.md` and `docs/`
- The mark in `public/assets/logo.svg`, if the new name gets a new mark

## Keep: internal identifiers

These are stored in browsers, databases, backups and deployment files. Renaming them would sign
everyone out or break existing installs, so they stay as they are:

| Identifier | Where it lives |
|---|---|
| `kid_access` | session cookie |
| `kid-session` | browser localStorage key |
| `X-Kid-Email`, `X-Kid-Token` | upload request headers |
| `data/kidtube.sqlite`, `DATABASE_PATH=/data/kidtube.sqlite` | database file |
| `backups/kidtube-*.sqlite`, `backups/pre-migrate-v*-*.sqlite` | backup files |
| `KIDTUBE_ADMIN_EMAIL`, `KIDTUBE_ADMIN_PASSWORD` | `scripts/setup.mjs` environment |
| `kid-site` | browser sessionStorage key (the page-chrome snapshot) |
| `kid:unlocked`, `tz:enter`, `tz:hold` | page events between the shell, feed and themes |
| `--tz-*`, `--kt-auth-*` | CSS variables that themes depend on |
