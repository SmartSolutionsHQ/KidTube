# Naming: shortlist and screen

"KidTube" is a working name. A video app ending in "Tube" sits close to YouTube, and closer still to YouTube Kids,
so the name changes before any public demo. This page is the research for that choice. Eddie and Kevin pick the
name; nothing here renames anything.

**This is a screen, not legal advice.** It is what public searches showed on 2026-10-22: domain registries, GitHub,
npm, the App Store, Google Play, the web and the USPTO's trademark search. It does not cover common-law use,
state registrations, other countries' registers or anything filed after that date. Before money goes into a name,
have a trademark attorney run a full clearance search on the one or two finalists.

## 1. The README, done now

The README no longer leans on YouTube, whatever name is picked:

- The hero is now "Your kid's first video channel, with an audience you choose.", the same line as
  `package.json`.
- "Why not YouTube Kids?" is now "Why not a big video app?". The table compares by category (big video apps vs.
  this one: whose videos, who picks what plays, who can watch your kid, ads, where it runs) and names no brand.
- One line still names YouTube: "KidTube is not affiliated with YouTube or Google." It stays while the working
  name ends in "Tube", and can go with the rename.

### Other "Tube" and "YouTube" copy still in the repo

Only the README was edited. These are left for the rename (or sooner, by whoever owns the file):

| Where | Text | What it is |
|---|---|---|
| `README.md:2` | alt text "...with an Enter the tube button" | Describes the splash screenshot accurately; changes when the label and screenshot change |
| `README.md:83` | "KidTube is not affiliated with YouTube or Google." | Kept on purpose until the rename |
| `public/themes/ember-tape/splash.js:268` | `'Enter_the_tube'` | Default enter label on the Ember Tape splash, the one in the README hero image |
| `public/js/shell/auth-dialog.js:14` | "Log in to enter the tube." | Login dialog copy |
| `public/js/shell/app.js:272` | "Can't reach the tube" | Offline note title |
| `server/api.js:132` | "Enter the tube" | Button in the email sent to viewers |
| `public/setup/helpers.js:18` | `'tube'` in `SMALL_WORDS` | Not copy: words skipped when making a family's initials. Harmless; can stay |
| `public/setup/setup.js:130` | `docker logs kidtube` | The container name; moves with the Docker service rename |
| `docs/RENAMING.md:21` | "the 'Why not YouTube Kids?' section" | Now "Why not a big video app?"; the doc should say so |
| `docs/plan/2026-10-21-fun-features-brainstorm.md:15`, `docs/superpowers/specs/2026-10-21-launch-story-bundle-design.md:7` | "Your kid's first YouTube channel" | Internal plans, not shipped. Fine as history; don't copy the line into anything public |
| `docs/images/splash-ember-tape.jpg` | "Enter_the_tube" on the button | Retake after the label changes |

"The tube" is old slang for TV and on its own isn't the problem, but next to a "-Tube" product name it reads as
the same joke. "Press play" or "Enter the channel" (the Blueprint theme already says that) carry the same idea.

## 2. How each name was checked

| Check | How | Notes |
|---|---|---|
| `.com`, `.tv` | RDAP at the registry (`rdap.verisign.com/com/v1`, `rdap.nic.tv`), then a registrar availability and price check (Vercel Domains) | Prices are first-year registration. "Taken" says nothing about whether it is for sale |
| `.app` | RDAP at Google Registry (`pubapi.registry.google/rdap`), then the same registrar check | `.app` needs HTTPS, which the app already supports |
| GitHub | `gh api users/<name>` for the account or org, and repo search `<name> in:name` | The project lives at `SmartSolutionsHQ/KidTube`, so a free org name is nice, not needed |
| npm | `registry.npmjs.org/<name>`, `create-<name>` and `@smartsolutionshq/<name>` | The package is scoped; the bare and `create-` names matter for `npx create-<name>` |
| App Store | iTunes Search API, US store, software | Matches on the name with spaces removed |
| Google Play | Play store search, US | |
| Similar products | Web search for the name with "app", "kids", "video" | |
| Trademarks | [USPTO Trademark Search](https://tmsearch.uspto.gov/), wordmark search, live and dead, read for classes 9 (software), 38 (streaming), 41 (entertainment, online video) and 42 (SaaS) | Status links go to TSDR |

## 3. The long list

Twenty names, all tape and VHS, none ending in "-tube". Struck ones were cut in the first pass.

| Name | Cut? | Why |
|---|---|---|
| Home Tapes | shortlist | |
| Hometape | merged into Home Tapes | A new "Hometape" video editor app on both stores (see below) |
| Side A | shortlist | |
| Rewind Club | shortlist | |
| ~~Tapedeck~~ | cut | Zedge filed TAPEDECK in classes 9, 38, 41 and 42 for its music app; npm name taken |
| ~~Kidreel~~ | cut | "Reels" swaps one big-platform echo for another; KidReels app on iOS |
| ~~Showreel~~ | cut | Generic, crowded, `showreel.tv` taken, npm taken |
| ~~Tape Club~~ | cut | Live TAPE CLUB application in class 41 for online videos (serial [50167443](https://tsdr.uspto.gov/#caseNumber=50167443&caseType=SERIAL_NO&searchType=statusSearch)); `tapeclub.com` is Hype Machine |
| Little Tapes | shortlist | |
| ~~Tinytape~~ | cut | Search results are swamped by Tiny Tapeout, a well-known chip project |
| Taperoo | shortlist | |
| Tapetown | shortlist | |
| ~~Playtape~~ | cut | PLAYTAPE is a registered kids' toy mark (InRoad Toys, class 28); npm taken |
| ~~Tapehouse~~ | cut | Reads as "taphouse"; several GitHub projects use it |
| Cassette Club | shortlist | |
| Kidtapes | shortlist | |
| ~~Tapeling~~ | cut | npm taken; harder to say |
| ~~Tapeyard~~ | cut | Clean, but "yard" says nothing |
| ~~Rewindy~~ | cut | `.app` taken, GitHub user taken, sounds like a typo |
| ~~Tapenest~~ | cut | Clean, but flat |

## 4. The shortlist

Domain columns: **free** with the first-year price, or **taken**. Trademark column covers classes 9, 38, 41 and 42.

| Name | .com | .app | .tv | GitHub | npm (`name`, `create-`) | App Store / Play | Similar products | USPTO 9/38/41/42 | Screen |
|---|---|---|---|---|---|---|---|---|---|
| **Tapetown** | taken (Tapetown Studio, online mixing for musicians) | free $9.99 | free $35 | user `tapetown` taken (1 repo); a few small repos | both free | none | Tap Tap Town (kids' city game, different name) | none; TAPER TOWN (marathon coaching, 41) is unrelated | **Clear** |
| **Rewind Club** | taken (registered Dec 2025, no site) | free $9.99 | free $35 | free, no repos | both free | none; a bar's app shows up in Play search | Rewinder (Apple TV archive app) | no REWIND CLUB; the REWIND field is crowded (below) | **Clear, crowded root** |
| **Kidtapes** | **free $11.25** | free $9.99 | free $35 | free, no repos | both free | none | Children's Tape (German kids' song app) | no KID + TAPE marks at all | **Clear, descriptive** |
| Home Tapes | taken (since 2018, parked at NameBright) | taken | free $35 | free; 2 tiny repos | both free | **Hometape: simple video editor**, iOS and Play, launched 2026-10-13 | homie (home movies as "tapes"), VHS Studio, Cassette | none | **Caution** |
| Taperoo | taken (since 2016, parked at NameBright) | free $9.99 | free $35 | user `taperoo` taken (empty) | both free | none | none; it is a suburb of Adelaide | none | **Caution** |
| Little Tapes | taken (German shop, "opening soon", registered May 2026) | free $9.99 | free $35 | free, no repos | both free | none | LittleTube (curated kids' video app) | LITTLE TAPE, live, 9 and 41, includes recording software | **Caution** |
| Cassette Club | taken (a band) | free $9.99 | free $35 | free, no repos | both free | none | **Cassette**, an iOS app that plays your videos as VHS tapes | none | **Caution** |
| Side A | taken | taken | free $35 | user `sidea` taken; 373 repos match | both free | Side A: Cassette Player (iOS) | many cassette apps | **SIDE A, live, UMG Recordings, in 9, 38 and 41** | **Blocked** |

### Notes per name, with links

**Tapetown.** No trademark, app or package collisions. `tapetown.com` belongs to
[Tapetown Studio](https://tapetown.com), an online mixing and mastering service for indie musicians: same word,
different trade (audio services for adults), but it means we'd live on `tapetown.app` and never own the `.com`.
The only USPTO hit with both words is TAPER TOWN (serial
[99472957](https://tsdr.uspto.gov/#caseNumber=99472957&caseType=SERIAL_NO&searchType=statusSearch)), a running
club's marathon coaching. Web search found no kids' or video product called Tapetown.

**Rewind Club.** No exact mark, app, repo or package. The root word is busy, though. Live REWIND marks in the four
classes include Rewind Co. (9, 38, 41, 42,
[88791003](https://tsdr.uspto.gov/#caseNumber=88791003&caseType=SERIAL_NO&searchType=statusSearch)), Tinder
(9, [86607872](https://tsdr.uspto.gov/#caseNumber=86607872&caseType=SERIAL_NO&searchType=statusSearch)), Rewind
Software (41, 42, [98577047](https://tsdr.uspto.gov/#caseNumber=98577047&caseType=SERIAL_NO&searchType=statusSearch)),
The New York Times (41) and Nexstar's REWIND TV (38, 41). Sixty-one live marks with REWIND in them sit in these
classes. In a crowded field each owner gets narrow protection, which cuts both ways: "Rewind Club" is unlikely to
be confused with any one of them, and we'd get a narrow mark too. `rewindclub.com` was registered in December
2025 and shows nothing. Web search showed [Rewinder](https://www.cultofmac.com/406365/free-apple-tv-app-lets-you-mainline-weird-video/),
an Apple TV app of old films, and reverse-video camera apps; nothing kids-and-channels.

**Kidtapes.** The only shortlisted name with the `.com` free, and every other check came back empty, including
any USPTO mark that pairs KID and TAPE. The catch is that it describes the product ("kids' tapes"), and the USPTO
can refuse a merely descriptive mark on the main register, so it would be harder to protect and easier for
someone else to use something close. It keeps "Kid" from KidTube, which helps families who already know the old
name. Web search found [Children's Tape](https://apps.apple.com/app/id455033215), a German kids' song app with a
cassette look.

**Home Tapes.** The best fit in meaning, and USPTO shows no HOME TAPES mark. But
[Hometape: simple video editor](https://apps.apple.com/us/app/hometape-simple-video-editor/id6819825190) (CrowFoundry
SIA) launched on the App Store on 2026-10-13 and is also on
[Google Play](https://play.google.com/store/apps/details?id=com.crowfoundry.hometape). Same field (video apps), one
letter apart, and they were first. `hometapes.com` (parked since 2018) and `hometapes.app` are both taken. The
VHS-home-video idea is getting busy: [homie](https://apps.apple.com/us/app/studio-the-group-camcorder/id1582843261)
calls its shared albums "tapes", [VHS Studio](https://apps.apple.com/bt/app/vhs-studio/id6753301889) records to
virtual tapes, and [Cassette](https://petapixel.com/2025/08/14/cassette-app-lets-you-play-iphone-videos-like-old-school-vhs-tapes)
plays your phone's videos as tapes.

**Taperoo.** Clean on every register and store. It is also the name of a
[suburb of Adelaide](https://en.wikipedia.org/wiki/Taperoo,_South_Australia), and the usual story is that it comes
from an Aboriginal word; a [2018 place-name study](https://digital.library.adelaide.edu.au/dspace/handle/2440/113970)
disputes that it is Kaurna, but the origin is unsettled. A kids' brand built on a word that may be borrowed from an
Aboriginal language, and that Australian families read as a suburb, is a risk worth avoiding. `taperoo.com` has
been parked since 2016 at NameBright, whose parent company runs HugeDomains, so it may be for sale.

**Little Tapes.** Tape Brands Limited (UK) has a live application for LITTLE TAPE in classes 9, 33, 35, 41 and 43,
covering music recording software among other things (serial
[99362629](https://tsdr.uspto.gov/#caseNumber=99362629&caseType=SERIAL_NO&searchType=statusSearch), currently
suspended). Singular vs. plural doesn't separate them. `littletapes.com` is a German shop marked "opening soon",
registered May 2026.

**Cassette Club.** No mark, app or package, but [Cassette](https://techcrunch.com/?p=3036101), an iPhone app that
turns your videos into VHS tapes, is the nearest thing to us in spirit and in the press. "Cassette" also leans
audio, and the wordmark is long. `cassetteclub.com` is a band.

**Side A.** UMG Recordings has live SIDE A applications in class 9 (music videos and recordings,
[99604310](https://tsdr.uspto.gov/#caseNumber=99604310&caseType=SERIAL_NO&searchType=statusSearch)), 38
([99604332](https://tsdr.uspto.gov/#caseNumber=99604332&caseType=SERIAL_NO&searchType=statusSearch)) and 41
([99604369](https://tsdr.uspto.gov/#caseNumber=99604369&caseType=SERIAL_NO&searchType=statusSearch)), plus 25 and
35. A major label in our classes is a hard no for the product name. "Side A" stays great as lore inside the app.

### How each one sounds in the product

The app already says "Who's on tape today?", "Record it to tape" and "End of tape". The wordmark is set in Anton:
tall, condensed capitals, so a single word of seven or eight letters sits well on a phone splash, and two words
stack.

| Name | "<Kid> Tapes" | Side A style lines | Enter button | Wordmark in Anton |
|---|---|---|---|---|
| Tapetown | "Wren's Tapes" on the front door of Tapetown | "Side A: Wren. Side B: Bo." / "Now showing in Tapetown" | "Enter Tapetown" | TAPETOWN: 8 letters, one word, the T at each end frames it; fits one line at phone width |
| Rewind Club | "Wren's Tapes, at the Rewind Club" | "Members only: the people you let in." / "Be kind, rewind." | "Enter the club" | REWIND / CLUB stacks well; CLUB is short enough to set larger under REWIND |
| Kidtapes | "Wren's Tapes" works; "Wren's Kidtapes" doesn't, so the brand stays in the frame | "Side A: Wren" | "Press play" | KIDTAPES: 8 letters, one line; same length and shape as KIDTUBE, so the logo barely moves |
| Home Tapes | "Wren's Home Tapes", the most natural of all | "Recorded at home. Played for family." | "Press play" | HOME / TAPES stacks into two even lines |
| Taperoo | "Wren's Taperoo" reads oddly; "Wren's Tapes" fine | "Side A: hop in" | "Hop in" | TAPEROO: the double O could be drawn as two tape spools |
| Little Tapes | "Wren's Little Tapes" | "Side A: Wren" | "Press play" | LITTLE / TAPES, two lines; LITTLE has many thin uprights in Anton |
| Cassette Club | "Wren's Tapes at Cassette Club" | "Side A: Wren" | "Enter the club" | CASSETTE / CLUB; CASSETTE is the longest word here and crowds a phone |
| Side A | "Wren's Side A" | Clashes with using Side A / Side B inside the app | "Press play" | SIDE A, short and strong |

## 5. Top three

1. **Tapetown.** The cleanest coined name: no trademarks, apps or packages in the way, `.app` and `.tv` at normal
   prices. "Every kid has a channel in our town" matches how the app works, it is easy for a six-year-old to say,
   and the wordmark is one tidy line. The cost: no `.com` (an indie music studio has it), and the GitHub username
   is taken, which doesn't matter while the repo lives under SmartSolutionsHQ.
2. **Rewind Club.** The strongest story: a club that you, the parent, let people into, with "Be kind, rewind"
   tape lore built in. Clean on every exact-match check. The cost: REWIND is a crowded root in our classes, so the
   mark would be narrow, and the `.com` was registered last December.
3. **Kidtapes.** The practical pick: the only finalist with `.com`, `.app` and `.tv` all free at normal prices,
   clean everywhere, and the smallest change for families who know KidTube. The cost: it is descriptive, so it
   would be the hardest of the three to register and defend.

Home Tapes would be the first choice on meaning alone. A brand-new "Hometape" video editor on both stores puts it
behind these three.

## 6. Risks

- **The retro-tape video space is filling up.** Hometape launched nine days before this screen, Cassette in 2025,
  and VHS Studio and homie both talk about "tapes". Whatever name wins, register the domains, the npm names and
  the GitHub org the same day, and file the trademark soon after.
- **Big owners in our classes.** UMG (SIDE A) and Zedge (TAPEDECK) both have live filings in classes 9, 38 and
  41. Both names are out.
- **"Tapes" has adult neighbours.** Several live USPTO marks in class 41 use "Tapes" for adult content. Not a
  reason to drop the word, but run a search with SafeSearch off for the final name plus "tapes" before printing
  anything.
- **Descriptive names are weak.** Kidtapes, Home Tapes and Little Tapes describe what the product is, which makes
  them harder to register and protect.
- **The Docker data volume.** A rename must not change `kidtube-data` in `compose.yaml`; a new name starts an
  empty install. Compose also prefixes the volume with the folder name (`<folder>_kidtube-data`), and there is no
  top-level `name:` in `compose.yaml`. If the README's clone line changes to a new folder name, existing families
  who re-clone into that folder would see an empty install. Pin `name: kidtube` at the top of `compose.yaml`
  during the rename, or tell families to keep their folder.
- **This screen is a snapshot.** Applications filed after 2026-10-22, common-law use and foreign registers are not
  covered. Get an attorney's clearance search on the finalists.

## 7. What a rename touches

[docs/RENAMING.md](../RENAMING.md) is the full list. In short:

- `server/brand.mjs` holds the name, wordmark and tagline; pages and scripts read from it, and
  `test/brand.test.mjs` fails if the old name appears elsewhere under `server/` or `public/`.
- Packaging (`package.json`, `bin/create-kidtube.mjs`), Docker service and container names (`compose.yaml`,
  `compose.https.yaml`, `Caddyfile`), CI and release workflows, the image name on GHCR.
- Words in `README.md`, `SECURITY.md`, `CHANGELOG.md` and `docs/`, the screenshots in `docs/images/`, the logo and
  icons.
- The "tube" copy listed in section 1.
- **Keep** every internal identifier RENAMING.md lists, above all the `kidtube-data` volume, the
  `data/kidtube.sqlite` path, the `KIDTUBE_*` variables and the cookie and storage keys. Renaming them signs
  everyone out or orphans a family's data.
