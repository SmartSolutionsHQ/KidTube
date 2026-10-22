# Contributing

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the map of the code. Background on past decisions is in
[docs/plan/](docs/plan/README.md).

## Run it and test it

You need Node 24 (24.16 or later in the 24 line) and FFmpeg on the PATH. There is nothing to install.

```bash
npm test
npm start
```

`npm start` keeps its data in `data/` and prints a setup link and code. Test on a scratch install like this,
never on a family's real one.

## Rules

- **Never commit `.env`, `data/`, backups or real videos**, and never attach them to an issue. Tests and
  screenshots use invented names and generated clips only.
- **No runtime dependencies and no build step.** Use what Node 24 and the browser give you (`node:http`,
  `node:sqlite`, `node:test`, plain ES modules). FFmpeg is the one outside tool.
- **Match the code around you.** ES modules, two-space indentation, `SCREAMING_CASE` for constants. Each file
  starts with a comment saying what it is for; other comments explain why, not what.
- **Build the page from elements and text nodes**, not HTML strings (the dashboard's `dom.js` and the setup's
  `ui.js` show how). No inline scripts or event handlers: the CSP header blocks them.
- **The product name lives only in `server/brand.mjs`.** Pages use `{{brand.name}}`; `test/brand.test.mjs`
  enforces it.
- **Schema changes are a new step** at the end of `MIGRATIONS` in `server/schema.mjs`, safe to rerun. Never edit
  a shipped step.
- **Words for parents** are plain and short, in sentence case, without hype, exclamation marks or em dashes.
- **Add a test** for each fix or feature in the matching `test/<area>.test.mjs`.

## Add a splash theme

Copy a theme folder in `public/themes/`, rename it, and follow [docs/THEMES.md](docs/THEMES.md). Try it at
`/themes/preview.html` on a running install. `npm test` checks the folder against the rules; once it passes, the
theme shows up in every gallery with no list to edit.

## Before a release

Run [docs/VERIFY.md](docs/VERIFY.md) and record the results there. [docs/RENAMING.md](docs/RENAMING.md) lists what
the planned rename touches. Maintainer-only scripts live in `scripts/dev/` (icons, stickers, badge fonts) and
never ship.
