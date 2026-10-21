# Security model

KidTube is an early self-hosted family application. It is not a multi-tenant service and has not had an independent security audit. Do not use it as a public signup platform for unrelated households.

- Passwords are salted and derived on the server with scrypt. HTTPS protects passwords in transit.
- API account tokens expire after seven days and are tied to the current password hash. The UI stores these tokens in localStorage. Media uses a signed HttpOnly, SameSite=Strict cookie, with Secure enabled for HTTPS sites.
- Media requests and catalog access check account approval on the server. Denial, deletion, password reset, guest expiry, or changing SIGN_SECRET invalidates the corresponding access.
- Logout clears the browser's cookie and stored token; a copied token remains usable until expiry or password/secret change. Protect browsers and hosts accordingly.
- Guest codes are short and one-use. Redemption has rate limits; each guest session lasts 24 hours. Do not distribute codes publicly.
- Basic login/signup rate limits are per connecting IP and process. Configure a trusted reverse proxy correctly; additional edge rate limits are appropriate for a public hostname.
- Approval emails link to the authenticated parent dashboard. Opening an email link never approves an account by itself.
- Uploaded content stays in the data directory, outside publicly served static assets. Do not copy private videos into `public/` or configure a proxy to serve `data/` directly.
- Approved viewers can still record or save content they are allowed to watch. Account approval is access control, not DRM.
- New-video email recipients are sent individually. Brevo receives the recipient address and message contents, including clip title and link. Disable mail if that external processing is not appropriate for your family.
- Backups include personal data and credentials. Exclude them from public repositories and restrict host access.

Use supported software updates, TLS, unique secrets, separate data per channel, and tested backups. Review uploaded content and comments; this starter does not provide automated moderation.

Report vulnerabilities privately through GitHub's private vulnerability reporting if enabled on the repository, or contact the maintainers privately. Do not post exploit details, credentials, real children's data, or database files in public issues.
