# Fun features, design and marketability brainstorm (2026-10-21)

Context: M1 (foundation) is on `foundation-clean`. M2 (VHS front end, self-hosted fonts, brand layer),
M3 (six splash themes, playground, loader) and M4 (badge builder, 61 Fluent stickers, PWA icons) are
finished in worktrees. M5 to M8 (wizard, multi-kid flow, parent dashboard, PWA) are planned. This file
lists what could make the app unique, fun and star-worthy on top of that plan. Nothing here is decided.

## The positioning gap

Open-source "self-hosted video" projects (Fireshare, HomeBrewPlex, PeerTube, MediaGoblin) are upload
and share tools built for adults. Commercial kids apps (YouTube Kids, WatchSafe, SafeStream,
ClockwiseTV, Meevee) are about consuming curated content with time limits. None of them treats the
kid as the creator with a hand-picked audience. That is the lane:

> Your kid's first YouTube channel. The audience is exactly who you choose.

Every feature below is scored against that sentence. If it does not make the kid feel like a creator,
the family feel like an audience, or the parent feel in control, it is cut.

## Tier 1: signature features (pick two or three for the launch)

### 1. Premieres and watch parties
A parent (or the review queue) schedules a clip: "Episode 12 premieres Saturday 10:00." Viewers see a
countdown card on the front door and in the feed; a Brevo email goes out. At premiere time the feed
opens on that clip with a LIVE PREMIERE banner and a live reaction strip. Reactions and comments made
in the first ten minutes are marked "watched the premiere". Server-Sent Events carry the reaction
stream, so no WebSocket library is needed. Kids understand premieres from YouTube, and grandparents
get an appointment to keep.

### 2. Time capsules
A clip (from a kid, or from a grandparent to a kid) can be sealed until a date: "Open on your 10th
birthday." The feed shows a locked tape with the date; the parent dashboard lists capsules. On the day,
the splash theme plays an unlock sequence and a notification goes out. This is the most emotional
feature on the list, it is cheap (one column plus a filter), and it is the one people will post about.

### 3. Reactions and video replies
Beyond the heart: a small reaction set drawn from the Fluent stickers already vendored (clap, laugh,
wow, fire, star). Reactions burst on the slide and are counted per clip. Viewers can also record a
ten-second video reply from the browser (MediaRecorder, same upload pipeline, same review queue).
A kid seeing Grandma's face reacting to their video is the whole product in one moment.

### 4. The Studio: record in the browser
A REC button in the feed opens a studio: camera preview, a 3-2-1 countdown, a script box that scrolls
as a teleprompter, the five-minute limit shown as a tape counter, retake, then name and publish. The
upload pipeline, review queue and posters already exist. Without this the app is an uploader; with it,
it is a studio.

### 5. Thumbnail studio
Posters are frame grabs today. Let the kid scrub to a frame, add one sticker and one word in a badge
font, and save it. Reuses the badge renderer's fonts and stickers. The running order and emails get
real YouTube-style thumbnails made by the kid.

### 6. "End of tape": screen-time limits that actually end
Per kid, per viewer device: a daily watch budget. Each theme owns the ending (Ember: the tape runs out
and the VHS snow rolls; Arcade: GAME OVER, insert coin tomorrow; Comic: THE END panel). The parent
sets it in the dashboard; the feed honours it without a nag loop. Parents in reviews praise this above
everything else in kids apps, and most apps get it wrong.

### 7. Milestones and plaques
Honest numbers only: clips published, hearts, episodes watched by the whole family. Plaques at 10, 50
and 100 clips (bronze, silver, gold tape) drawn in the badge style; a confetti burst in the theme's
language when one is earned; a plaque shelf on the channel page. No streaks, no daily pressure.

## Tier 2: audience and family delight

- **TV mode** at `/tv`: lean-back layout, autoplay through a channel, arrow-key and remote friendly,
  big captions. Self-hosted projects with a TV view get shared in living rooms.
- **Guest pass as a QR code**: the dashboard renders the code as a QR (pure SVG, no dependency) so a
  grandparent at the table scans it. Also a printable "fridge poster": badge, channel name, QR.
- **Weekly digest email**: "This week on Milo's channel" with thumbnails and the premiere calendar.
- **One year ago today**: a memory card on the front door and in the feed.
- **Episodes and series**: a clip can belong to a series with an episode number. Series rails on the
  channel page, "next episode" at the end of a clip.
- **Channel trailer**: one pinned clip that plays on the kid's channel page before the feed.
- **Export the channel**: one button makes a folder of MP4s plus an HTML index, for the family
  archive. Pairs with the backup script.

## Tier 3: design and UI texture

- **Theme-aware feed**: the whitelisted `--tz-*` variables exist. Give each theme a like animation
  (Comic: POW; Arcade: pixel heart; Creature: drip; Ember: RGB split), a swipe sound (tape click,
  arcade blip) and a loading state. Opt-in sound per the existing `splash_sound` setting.
- **Haptics** on like and on reaching the end of the reel (`navigator.vibrate`, short).
- **The video shelf as cassette spines**: the running order drawn as tapes on a shelf, each spine in
  the clip's thumbnail colours, episode numbers on the labels.
- **Front door as a channel lineup**: the kid picker drawn like a TV guide or a tape shelf, badges as
  channel idents, each with its theme preview behind it.
- **Empty states with a job**: "No tapes yet" with a big REC button, not a sentence.
- **Hover previews**: a two-second animated WebP made at upload (`-vf fps=4`, 160 px), shown on hover
  in the shelf and on long-press on mobile.
- **Easter eggs**: Konami code swaps the theme to Arcade for the session; shake to shuffle on phones;
  the tape counter in the header counts in tape time.

## Tier 4: what gets stars (the meta work)

- **A public demo** with invented kids and Creative Commons clips, reset every hour. Projects without
  a demo and a ten-second GIF do not get shared.
- **README rebuild**: hero GIF (splash, swipe, heart burst, premiere), one screenshot per theme, a
  "zero runtime dependencies" badge, a three-line install, a "why not YouTube Kids" section.
- **App-store listings**: Unraid Community Apps, CasaOS, Umbrel, TrueNAS, Runtipi, plus
  awesome-selfhosted. This is how Immich and Jellyfin reached families who never open GitHub.
- **Theme and sticker packs as the community on-ramp**: `docs/THEMES.md` already defines the contract.
  A theme is a folder with no build step; run a "make a splash theme" call for contributions and show
  community themes in a gallery page.
- **The name**: the plan already flags the YouTube trademark risk. The rename should happen before the
  demo goes public so the stars land on the final name. Candidates in the VHS voice: Tapedeck,
  Hometape, Kidreel, Showreel.
- **Launch sequence**: rename, demo, README, then Hacker News "Show HN", r/selfhosted, r/daddit and
  r/Parenting, with the time-capsule or premiere feature as the story.

## Suggested sequencing

Tier 1 items 2 (time capsules), 3 (reactions) and 6 (end of tape) are small enough to fit between M6
and M7 and give the launch a story. Item 1 (premieres) and 4 (studio) are each a milestone of their
own. Thumbnail studio (5) is a natural M7 dashboard add-on. Tier 4 runs alongside M8.

## Sources consulted

- Self-hosted video landscape: https://opensource.builders/capabilities/self-hosted-video-platform,
  https://openalternative.co/categories/photo-video-management/using/github,
  https://awesome.ecosyste.ms/projects/github.com%2Fleonleerl%2Flets-video
- Stars versus installs, Immich growth: https://findstack.com/resources/self-hosting-statistics,
  https://immich.app/blog/2024-year-in-review, https://linuxiac.com/?p=127536
- Kids apps and what parents praise: https://www.ypulse.com/newsfeed/2026/04/02/a-new-video-streaming-app-is-aiming-to-lower-kids-screentime-yes-the-irony/,
  https://www.advanced-television.com/?p=291213,
  https://www.commonsensemedia.org/app-reviews/kidjo-1-educational-app-for-kids,
  https://mwm.ai/apps/watchsafe/6758132744, https://apps.apple.com/us/app/safe-stream-app/id6757622774
