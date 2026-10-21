# Email setup with Brevo

Mail is optional. You can operate the entire channel with `MAIL_MODE=disabled` and approve accounts in the parent dashboard.

## Create a sender

1. Create a Brevo account and complete its account verification/onboarding. Choose the free tier if its current sending allowance suits your family. Check [current plans](https://www.brevo.com/pricing/) in your region/account; free-tier limits and eligibility can change.
2. In Brevo's sender/domain settings, add a domain you control. Follow the DNS records Brevo shows for that domain, including its verification and DKIM records and its DMARC guidance. Copy the exact record names/values from your account; do not invent or reuse another family's records.
3. Wait until Brevo reports the domain authenticated. Add a sender address on that domain, such as `videos@example.com`, and complete any sender verification. Use a real address whose verification you can receive. Brevo is an outgoing delivery service; it does not create that mailbox for you.
4. Create a Brevo **API key** in its SMTP/API settings. KidTube uses HTTPS API requests, so an SMTP password/key is not interchangeable with this API key. Keep the API key private.

Primary references: [Brevo transactional email setup](https://developers.brevo.com/docs/send-a-transactional-email) and [API authentication](https://developers.brevo.com/docs/authentication).

## Configure KidTube

Edit the private `.env` file on the host:

```dotenv
SITE_URL=https://videos.example.com
MAIL_MODE=brevo
BREVO_API_KEY=your-private-api-key
SENDER_EMAIL=videos@example.com
NOTIFY_EMAIL=parent@example.com
```

`SENDER_EMAIL` must match a sender authorized in Brevo. `NOTIFY_EMAIL` receives signup requests; it can differ from the parent login email. `SITE_URL` must be the HTTPS origin users actually visit. Never put API keys in browser JavaScript or commit `.env`.

Restart the app after editing configuration. For Compose use `docker compose up -d --force-recreate` (include both `-f` options if using the bundled HTTPS deployment), because a plain restart does not reload the env file into the container.

Send one explicit test message:

```sh
# Direct Node installation
npm run email:test

# Docker: uses the running container's environment
docker compose exec kidtube node scripts/test-email.mjs
```

Check the parent's inbox and Brevo transactional logs. API acceptance is not proof of inbox delivery. Then create a disposable viewer account, approve it in `/parents`, and verify its approval email. Publishing a short test video should notify approved accounts once each; unsubscribe from one test account and verify that it stops receiving new-video emails.

## Limits and delivery behavior

One publication sends one email per approved, subscribed account, including staff. Ten viewers and three uploads use thirty messages, in addition to signup and approval mail. Budget against your account's current daily allowance. No email is sent to pending/denied accounts for a publication, and existing clips are not announced at startup.

New-video messages use a durable SQLite queue, retry transient failures up to eight times, and preserve their provider idempotency key on retries. Long outages can still produce duplicates beyond the provider's deduplication window. Permanent errors and exhausted retries are recorded as failed. Signup and approval messages are immediate best-effort sends; if one fails, the account can still be reviewed in the dashboard.

Unsubscribe links show a confirmation page before changing preferences, so email scanners do not unsubscribe someone just by opening the link. Disabling mail suppresses sends; previously queued messages may be marked processed while disabled, so do not use disabled mode as a queue pause.

If sending fails, check API key validity, transactional account activation, sender verification, DNS authentication, quota, and delivery/bounce logs. Do not change your domain's existing MX records just to send through the API. There is no SMTP server bundled and no generic SMTP provider adapter in this release.
