# Email with Brevo

Email is optional, and off until you turn it on. Without it you approve people in the parent dashboard and
nothing leaves your computer. With it, KidTube sends through [Brevo](https://www.brevo.com):

- you get an email when someone asks to watch, and they get one when you let them in;
- approved people get one email per new video, with an unsubscribe link.

Brevo's free plan has a daily sending limit; check [its current plans](https://www.brevo.com/pricing/).

## Set up a Brevo sender

1. Create a Brevo account and finish its sign-up checks.
2. In Brevo's sender and domain settings, add a domain you control and add the DNS records Brevo shows for it
   (verification, DKIM and its DMARC advice). Copy the exact values from your account.
3. When Brevo says the domain is authenticated, add a sender address on it, such as `videos@example.com`. It
   should be a real mailbox you can read: Brevo only sends, it doesn't create the mailbox.
4. Create an **API key** in Brevo's SMTP and API settings. KidTube uses the API, so an SMTP password won't work.
   Keep the key private.

## Turn it on in KidTube

The easiest way is the Email step of the setup page, or Settings in the parent dashboard afterwards: pick Brevo,
paste the API key, and fill in the sender address and the address that should get sign-up requests. Settings
has a "Send a test email" button.

Or put the same values in `.env` next to `compose.yaml`, which locks them in the dashboard:

```dotenv
MAIL_MODE=brevo
BREVO_API_KEY=your-private-api-key
SENDER_EMAIL=videos@example.com
NOTIFY_EMAIL=parent@example.com
```

`SENDER_EMAIL` must be a sender Brevo has approved. `NOTIFY_EMAIL` gets sign-up requests and can differ from the
parent's login. Links in emails use the family's web address, so set that to the `https://` address people
really open. After editing `.env`, run `docker compose up -d` so the container picks it up.

To send a test from the terminal:

```bash
docker compose exec kidtube node scripts/test-email.mjs
```

(`npm run email:test` without Docker.) It uses the same settings as the app.

Then check the parent's inbox and Brevo's logs. Make a throwaway viewer account, approve it and check its email;
publish a short test video and check that each approved account gets one email; unsubscribe one and check that
it stops.

## How sending works

- Each new video sends one email to each approved account that hasn't unsubscribed, parents included. Ten
  viewers and three videos is thirty emails, plus sign-up and approval messages. Plan for your daily allowance.
- New-video emails wait in a queue in the database and are retried up to eight times if Brevo is unreachable.
  A very long outage can still send a duplicate. Sign-up and approval emails are sent once; if one fails, the
  request still waits in the dashboard.
- Videos waiting for review aren't announced until you approve them, and old videos are never announced again.
- Unsubscribe links show a confirmation page first, so email scanners can't unsubscribe someone by opening the
  link. Opening an email link never approves anyone.
- Turning email off stops sending. Emails queued while it is off may be dropped, so don't use it as a pause.

If nothing arrives, check the API key, that your Brevo account is active, the sender and domain checks, your
daily limit, and Brevo's delivery and bounce logs. Don't change your domain's MX records; sending doesn't need
it. There is no SMTP option in this version.
