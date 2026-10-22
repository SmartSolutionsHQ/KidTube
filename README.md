<p align="center">
  <img src="docs/images/splash-ember-tape.jpg" alt="A kid's splash screen: the name WREN in big glitchy letters over orange smoke, with an Enter the tube button" width="800">
</p>

# KidTube

**Your kid's first video channel, with an audience you choose.**

KidTube gives each kid in your family their own little video channel. They design the badge, pick the intro and
post the videos. You run it on a computer at home, decide who can watch, and see every upload before it goes
live. No ads, no recommendation feed, no strangers.

<p align="center">
  <img src="docs/images/phone-front-door.jpg" alt="The front door on a phone: Who's on tape today? with two kids' badges, Wren and Bo" width="260">
  &nbsp;
  <img src="docs/images/phone-feed.jpg" alt="A kid's feed on a phone: a video called Volcano part 2 with one star sticker" width="260">
</p>

The families in these pictures are made up, and so are their videos. KidTube is not affiliated with YouTube or
Google.

## Install in three lines

On a computer that stays on, with [Docker](https://docs.docker.com/get-docker/):

```bash
git clone https://github.com/SmartSolutionsHQ/KidTube.git kidtube && cd kidtube
docker compose up -d
docker logs kidtube
```

The last command shows a setup link and a one-time code. Open the link, type the code, and seven short steps set
up your parent account, your family, each kid's channel, who can watch, optional email, and the app on your
phone. [docs/INSTALL.md](docs/INSTALL.md) covers NAS boxes, phones on your Wi-Fi, HTTPS with or without a domain,
and running it without Docker.

## What everyone gets

**Kids**

- A channel of their own: their name, a line about them, a colour, and a badge they design with shapes and
  stickers. No photo of your child is needed anywhere.
- An intro that plays when someone opens their channel, from six: a VHS tape, an arcade cabinet, a comic cover,
  a creature file, a blueprint and a calm glass one.
- Posting from a phone with their own kid login. If you review uploads, they see "Sent to a parent" and the
  video goes live when you approve it.
- Time capsules: a video sealed until a birthday, with a note, that opens on the day.

**Parents**

- One dashboard at `/parents`: videos waiting for review, comments, who asked to watch, who watched what, guest
  codes, activity and settings.
- Nobody watches until you approve them. Kids' uploads and new comments wait for you by default.
- A daily watch limit for anyone you choose. When it runs out the channel shows "End of tape" and stops.

**Family**

- Grandparents, cousins and friends ask to watch from the front door, and you let them in by name.
- Or give someone a guest code that works for 24 hours, for one kid or all of them, with a card to print.
- Hearts, sticker reactions and comments, and the app on their home screen like any other.

## Privacy at a glance

- **It runs on your computer.** Videos, accounts, comments and watch history stay in one folder there. No
  analytics and no outside requests: fonts and stickers ship with the app.
- **You choose the audience.** Every viewer is approved by you or holds a guest code you made. Videos, titles and
  comments always need a sign-in. The front door shows the kids' names and badges unless you switch that off.
- **You see what was watched.** Who watched which video is kept for 90 days, only you can see it, and viewers are
  told when they sign up. No IP addresses or device details are stored.
- **Phone details are stripped.** Uploads are converted on your computer, and the location and device details
  phones put in videos are removed.
- **Email is optional.** With it on, Brevo sends approval and new-video emails. With it off, nothing leaves.

[SECURITY.md](SECURITY.md) has the security model and how to report a problem.

## A look around

<p align="center">
  <img src="docs/images/time-capsule.jpg" alt="A sealed time capsule in the feed: a cassette stamped SEALED, For Wren at 10, opens today at 9:05 AM, Open on your 10th birthday" width="400">
  <img src="docs/images/end-of-tape.jpg" alt="End of tape: That's the tape for today, more tomorrow at 12:00 AM, Done for today" width="400">
</p>
<p align="center">
  <img src="docs/images/parent-dashboard.jpg" alt="The parent dashboard home: videos to review, comments to review, people asking to watch, recent activity and who watched" width="400">
  <img src="docs/images/guest-code.jpg" alt="A guest code for Uncle Theo, Bo only, with a QR code and a print button" width="400">
</p>

## Docs

| To | Read |
|---|---|
| Install it, add HTTPS, put it on phones | [docs/INSTALL.md](docs/INSTALL.md) |
| Use the dashboard, back up, recover a password, fix a problem | [docs/OPERATIONS.md](docs/OPERATIONS.md) |
| Update, roll back, or move an older family site onto KidTube | [docs/UPGRADING.md](docs/UPGRADING.md) |
| Turn on email | [docs/EMAIL.md](docs/EMAIL.md) |
| Run the public demo | [docs/DEMO.md](docs/DEMO.md) |
| Make a splash theme | [docs/THEMES.md](docs/THEMES.md) |
| Rename the product | [docs/RENAMING.md](docs/RENAMING.md) |
| Check a release before tagging it | [docs/VERIFY.md](docs/VERIFY.md) |
| Understand the security model, or report a problem | [SECURITY.md](SECURITY.md) |
| See what changed | [CHANGELOG.md](CHANGELOG.md) |
| Find your way around the code | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [CONTRIBUTING.md](CONTRIBUTING.md) |

## By Smart Solutions

KidTube is made by [Smart Solutions](https://smartsolutions.fyi). It started as one family's channel and grew into
something any family can run.

![Smart Solutions](public/assets/smart-solutions-logo-white-transparent.png#gh-dark-mode-only)

MIT licensed. Hardware, storage, power and a domain, if you want one, are yours to provide.
