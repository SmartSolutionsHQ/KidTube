# KidTube architecture notes (2026-10-21)

Companion to `2026-10-21-kidtube-app.md`. These are the contracts later milestones build on. Where this file and the plan differ, Eddie's product decisions in the plan win (notably: kids are shown before sign-in by default).

Design reference: Claude Design canvas "KidTube: app + brand sheets" (https://claude.ai/artifact/VyUqtB7eMjfdFHU3eHWZ9e). Boards: Branding, App, Splash gallery, Badge builder, Parent side.

## Repo facts that shape the work
- SQLite will not `ADD COLUMN ... REFERENCES` with a non-NULL default while `foreign_keys=ON`. New link columns are `INTEGER NOT NULL DEFAULT 1` with no FK; channel 1 always exists; the app enforces links.
- `clips.position` was global. Ordering, publish and reorder are per channel.
- ffmpeg copies container metadata (phone GPS). Transcode with `-map_metadata -1 -map_chapters -1`.
- `/api/media/*` + `media_chunks` stay: a migrated TanzenTube DB may still use them.
- CSP is a `<meta>` today. Move to one HTTP header for every HTML page:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
- First Docker run traps: `env_file: .env` fails when missing (use `required: false`, Compose 2.24+); a bind-mounted `./data` is created root-owned (Dockerfile: `mkdir -p /data && chown node:node /data`; prefer a named volume in docs).
- KidTube has no VHS pause overlay or wordmark animation today; port them from code we own, not TanzenTube's minified bundles.

## Brand module
`server/brand.mjs` is the only place the product name, tagline, endorsement ("by Smart Solutions") and default accent (#FF5C2B) live. HTML gets `{{brand.*}}` tokens filled by the server; client JS reads `/api/site`. A test greps `server/` and `public/` for `KidTube|KIDTUBE` outside the brand module. Lowercase internal ids stay (`kid-session`, `kid_access`, `X-Kid-*`, `kidtube.sqlite`) and are listed in `docs/RENAMING.md`.

## Settings
`server/settings.mjs`: schema of `{key, env, default, validate, public, secret}`; `get()` = non-empty env (locked) > DB > default; `describe()` masks secrets; `set()` validates and writes activity. Keys: site_name, site_tagline, site_url, family_accent, gate_theme, family_badge, kids_public (default **true**), signup_mode, guest_passes, comments_default ('review'), review_uploads_default ('creators'), mail_mode, brevo_api_key (secret), notify_email, sender_email, splash_sound, views_retention_days (90), activity_retention_days (365), setup_complete. HOST, PORT, TRUST_PROXY stay env-only.

## Setup mode (M5)
- Boot: data dir from env or `dirname(DATABASE_PATH)`; secret from `SIGN_SECRET` or `DATA_DIR/secret` (created 0600 with flag `wx`); DB auto-created and migrated (backup first).
- While no `super` account exists: generate `KT-XXXXX-XXXXX-XXXXX-XXXXX` (base32, ~100 bits), print it with the `/setup` URL, write `DATA_DIR/setup-token` (0600), keep only a SHA-256 in memory, new code each restart. `/`, `/parents`, `/about` redirect to `/setup`; APIs return `503 {setup:true}` except `/api/health`, `/api/site`, `/api/themes`, `/api/setup/*`.
- `POST /api/setup/claim {code, first, last, email, pass}`: constant-time compare; 5 failures per IP per 10 min, 30 total kills the code until restart; `BEGIN IMMEDIATE`, re-check no owner, insert, log; delete token file; set cookie; return `{t, email, role}`. Concurrent second claim 409, later 410.
- Before `site_url` is known, the allowed origin is the request's own `proto://host` (proto from socket, or `X-Forwarded-Proto` with TRUST_PROXY=1). The setup code is the real gate.
- Wizard steps: code; parent account; family name, tagline, site URL (prefilled from `location.origin`, HTTPS required in production); add kids (name, kicker, accent with contrast check, badge builder, splash gallery with live preview; first kid renames channel 1); who can watch; optional email with test send; done (install on phone, upload first video, kid logins).
- `scripts/setup.mjs` keeps working (migrate, create owner, write `.env`, set `setup_complete`).

## Themes (M3)
- Folder: `public/themes/<id>/{manifest.json, splash.css, splash.js, preview.webp}` plus optional `fonts/` (with OFL.txt) and `sounds/`.
- Manifest: `{contract:1, id, name, description, author, version, tags, weight:'light'|'heavy', modes:['gate','channel'], sound, defaultAccent, accents:{pause:bool}, feed:{whitelisted --tz-* vars}}`.
- `export function mount(host, ctx) → { dismiss(reason) → Promise (≤600ms) }`; optional `export function pause(host, ctx) → { show(seconds), hide(), destroy() }`.
- ctx: `mode, title, kicker, subtitle, number, accent, accentInk, logoUrl, reducedMotion, lowPower, preview, sound:{allowed(), context()}, enterLabel, onEnter(), onSkip(), brand:{name, endorsement}, h(tag, props, ...kids), url(rel), signal`.
- Rules (tested where static): no side effects on import; no `innerHTML`, `insertAdjacentHTML`, `eval`, `new Function`, absolute URLs; selectors scoped under `[data-kt-theme="<id>"]`, keyframes prefixed `kt-<id>-`; ≤300 KB per folder; render inside host bounds (gallery preview); 30fps cap, stop when hidden, `loseContext()` on dismiss; Esc → `onSkip()`; ≤3 flashes per second; reduced motion = still frame; sound only after the Enter tap and only if `splash_sound`.
- Registry `server/themes.mjs` → `GET /api/themes` `{contract:1, fallback:'glass-gate', themes:[{id, name, weight, modes, preview, css, js}]}`. First-party themes only.
- Loader `public/js/shell/themes.js`: 4s import timeout then Glass Gate; heavy themes fall back on low-power devices unless the parent forces them; keeps `window.__tzsplash` (recovery.js checks it), fires `tz:hold` / `tz:enter`, honours `?splash=0/1`; attaches `pause()` via capture-phase listeners on `.tz-slide video` (no feed.js edits).
- The shell owns the auth `<dialog>`; themes never render forms, only restyle the card through `--kt-auth-*` variables.
- Launch set: ember-tape (heavy, Anton + DM Mono, accent-driven smoke shader, scramble, synthesized tape sting, VHS pause accent), glass-gate (light fallback), creature-feature (Creepster), blueprint-workshop (today's kid.css look), arcade-crt (Press Start 2P), comic-pow (Bangers).

## Viewer flow (M6)
- Shell router `public/js/shell/app.js` + pure `route.mjs`. Routes `#/c/<slug>` and `#/c/<slug>/v/<id>`; legacy `#/v/<id>` resolves via `GET /api/clips/locate?id=`.
- `/api/site` (setup → `/setup`), then `/api/me`. Signed out: front door shows kids' badges when `kids_public` (default), else the family splash. Pick a kid → that kid's splash → auth dialog → feed. One kid: their splash straight away.
- feed.js changes stay small (~30 lines): `?channel=`, deep-link regex `^#\/(?:c\/[^/]+\/)?v\/(.+)$`, upload target, "Sent to a parent for review", empty-state copy, accent colour via `var(--tz-flare)`.
- Kid logins: role `creator`, `email = <handle>@kids.invalid` (reserved TLD, never mailed); login maps a bare handle and returns the canonical email; minimum 8 characters, protected by upload review.

## Badges (M4)
- Spec v1, strict whitelist, ≤4 KB: `{v:1, shape, bg, bg2, pattern, border:{color,width}, text:{value, font, color, outline, size}, stickers:[{id,x,y,scale,rotate}], effects:{shadow, shine}}`.
- One pure renderer `public/js/badge/render.mjs` used by browser and server. Text becomes paths from committed glyph tables (`public/badge/glyphs/<font>.json`, built by a maintainer script from OFL fonts; keep OFL notices, neutral file names); `system` font falls back to escaped `<text>`.
- Stickers: ~60 Microsoft Fluent Emoji Flat icons (MIT, confirmed), pre-extracted to `{viewBox, paths:[{d, fill}]}` with the notice.
- Server never accepts client SVG; a test tokenizes output (plus 500 fuzzed specs) and allows only whitelisted elements and attributes.
- PWA icons: browser rasterizes the family badge to 192, 512, maskable 512, Apple 180; server checks PNG magic and IHDR size. Optional parent image: PNG/JPEG/WebP by magic bytes, ≤2 MB, ≤4096 px, metadata stripped.
- Files under `/data/brand/family/*` and `/data/brand/channels/<id>/*` with content-hash names; `immutable` caching; SVGs get their own `default-src 'none'` CSP. PWA icons always come from the family badge.

## Monitoring (M7)
- `views(id, clip_id, channel_id, viewer, started, updated, seconds, completed)`; viewer is an email or `guest:<12 hex>`; no IP or user agent. `public/js/views.js` sends after 3s, heartbeats every 15s, `sendBeacon` on pause or hide.
- `activity(id, at, actor, action, channel_id, target, detail)` append-only. `accounts.last_seen` and `guest_codes.last_seen` throttled to 5 minutes. Retention prune at boot and daily.
- `server/monitor.mjs`: comment approve/hide/delete, clip hide/unhide, review queue (`approveClip()` queues the new-video email), delete person with cascade.
- Roles: `super` everything; `admin` co-parent (videos, review, comments, guest passes, activity); `creator` own channel uploads only, no `/parents`.
- Signup screen and About say parents can see watch history.

## PWA (M8)
- `GET /manifest.webmanifest` from settings (name, short_name ≤12, `start_url:'/?source=pwa'`, `display:'standalone'`, `background_color:'#05060A'`, theme colour = family accent, icons from the family badge or defaults).
- `GET /sw.js` generated at boot with a version and the shell asset list: precache shell, cache-first for versioned assets, network-first navigations with offline fallback; never touch `/api/*`, `/brand/channels/*`, non-GET, `Range`, or video/audio. Decision function tested via `node:vm`.
- HTTPS is required for install and secure cookies; document Tailscale for private HTTPS without a domain. iOS home-screen apps keep separate cookies.

## Open questions for Eddie and Kevin
- Kid logins via the `.invalid` handle trick (recommended) or a real `username` column.
- Default for comments on new kid channels: parent reviews first (recommended) or open.
- LAN trials bind `0.0.0.0` over plain HTTP; the wizard must warn.
- Confirm the TanzenTube and Instatic-export CSS and shader code can be open-sourced under MIT.
