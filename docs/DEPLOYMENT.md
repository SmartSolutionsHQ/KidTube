# Deployment choices

## Direct Node

Use Node 24.16+ within 24.x, with FFmpeg and FFprobe on PATH. Run `npm run setup`, `npm run doctor`, then `npm start` from the project directory. The server binds to loopback by default. Use a service manager to start it on boot and restart after failures. Set its working directory to the project, load `.env`, and run under a dedicated unprivileged user.

For public hosting set `SITE_URL` to the real HTTPS origin and `NODE_ENV=production`. Terminate HTTPS at a reverse proxy. Direct Node installation does not bundle TLS certificates or a service manager. Do not expose the HTTP port directly to the internet.

## Existing reverse proxy

The base Compose file binds `127.0.0.1:3000` on the host. A host-based proxy can forward to it. For a proxy in another Docker container, put both services on a shared Docker network and forward to `kidtube:3000`; localhost inside the proxy container refers to that proxy container, not this app. Add the shared network in your own Compose override.

Keep the original host and HTTPS scheme in proxy headers, allow 4 MB upload chunks (an 8 MB request limit is sufficient), and use reasonable read timeouts for uploads. Do not cache `/api/*`, especially media. HTTPS termination is mandatory for public use. Set `TRUST_PROXY=1` only when all app traffic must pass through a trusted proxy which overwrites `X-Forwarded-For`. Otherwise keep it at 0: rate limiting will group clients by the directly connected address.

The included Caddy configuration supplies TLS and forwards traffic on a private Compose network. Its Compose override enables production HTTPS validation and trusted proxy handling. It does not manage DNS or router port forwarding.

## Tunnel or private network

An HTTPS tunnel can forward a hostname to the app's loopback port when inbound ports cannot be opened. Configure the public origin as `SITE_URL`; retain KidTube login and parent approval even if your tunnel has its own access gate. Tunnel services may impose upload, bandwidth, or media usage limits. Confirm your provider's rules before using it for video.

For family-only VPN access, use the VPN's supported HTTPS hostname/certificate setup and allow only intended devices. Do not assume a private IP address alone provides HTTPS.

## More than one family on one computer

One install already holds every kid in a family, each with their own channel. A second family needs its own install: its own project folder and its own run of setup. Never copy `.env` or data between families. Use unique `HOST_PORT` values in each `.env` and unique Compose project names:

```sh
docker compose -p family-one up -d --build
# In a separate initialized folder with HOST_PORT=3001:
docker compose -p family-two up -d --build
```

Use one shared reverse proxy for multiple public domains instead of starting multiple Caddy containers that all bind ports 80/443. Point each domain at the corresponding app service. Do not run replicas against the same SQLite file: the conversion queue is designed for one app process. Each folder gets its own volume (`family-one_kidtube-data` and so on).

## Persistent state

Everything lives in the data folder (the `kidtube-data` volume in Docker, `data/` with Node): `kidtube.sqlite`
holds accounts, kids, the catalog, comments, reactions, settings, activity, watch history, upload jobs and the
email queue; `videos/` the converted videos and posters; `brand/` the badges, pictures and home-screen icons;
`secret` the signing key (unless `SIGN_SECRET` is set); `backups/` snapshots; `incoming/` uploads in progress.
`.env`, when you have one, holds settings you want locked and the optional mail key. These stay local and must
remain outside Git and image layers. [OPERATIONS.md](OPERATIONS.md) shows how to back them up.

Disk use grows with uploads. Watch the storage card on the dashboard's home page, remove abandoned incoming
uploads only while the app is stopped, and keep backups somewhere other than the same disk. Interrupted
conversions are marked failed at startup; the uploader can send the video again.
