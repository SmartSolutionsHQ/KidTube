# Release checklist

Run this before tagging a release. Use a scratch install in a folder outside the repository, with invented
families and generated clips: never a family's real data. Record the results at the bottom, with what could not
be checked and why.

## Automated

- [ ] `npm test` passes on Node 24 with FFmpeg installed.
- [ ] `npm pack --dry-run` lists no `docs/plan`, `docs/superpowers`, `scripts/dev`, `.github`, `.env`, database or
      `data/` file (CI and `test/package.test.mjs` check this).
- [ ] `docker build .` succeeds, and the image has no `/app/docs`, `/app/test` or `/app/scripts/dev`.

## Manual, in a browser

1. **Fresh install.** In an empty folder, `docker compose up -d`; `docker logs kidtube` shows the setup link and
   code. (With Node: `npm start` from a clone with FFmpeg on the host.)
2. **Wizard.** Two invented kids, each with a different badge, colour and splash theme; one with a kid login.
3. **Front door, splash, sign-in and feed** for each kid. Signed out, the front door shows the kids' badges; a kid's
   splash plays, then the sign-in card; the kid login works with its short name.
4. **Kid upload → review → live.** As the kid, upload; the card reads "What's it called?" and "Record it to tape";
   "Sent to a parent" follows. The video waits in Review, and after Approve it appears with a poster.
5. **Viewer signup and approval.** Sign up from the front door; the parent approves under People; the viewer signs
   in, reacts with a sticker and comments. With comment review on, the comment waits and the commenter is told so;
   after "Show it" everyone sees it.
6. **Guest code limited to one kid**, with its QR and printable card. Redeemed, it shows only that kid; the other
   kid's clips answer 403. It expires after 24 hours (check the expiry time shown, or move the clock on a scratch
   database).
7. **Time capsule.** Seal a video for at least an hour away; it shows as a locked tape. Move its opening time a
   minute ahead in the scratch database; the server opens it on its next minute, puts it first and logs it; the
   feed plays the theme's unlock.
8. **Daily tape.** Give the kid login 15 minutes; use it up (or record usage in the scratch database). The feed
   shows "End of tape", the server refuses video (not posters) with `end-of-tape`, and `budget.end` is logged once.
9. **Who watched and Activity** list what happened above in plain sentences.
10. **Reduced motion.** Every theme shows a still frame and the enter button (the theme playground at
    `/themes/preview.html?reduced=1`, and the system setting on a real device).
11. **Widths.** 390 px and desktop: no horizontal scroll on the front door, feed, dashboard tabs and install page.
    On a short phone (360 × 580), the pause screen, sound pill, upload button and caption don't overlap.
12. **Home-screen app.** `/manifest.webmanifest` has the family's name, accent and badge icons; `/sw.js` is
    registered and controls the page; Cache Storage holds no `/api/`, `/brand/`, video or audio entries after
    browsing, playing and uploading. `/install` shows the right steps. On a real iPhone (or the iOS Simulator),
    Add to Home Screen from Safari over HTTPS, then sign in once more inside the app.
13. **Console.** No errors in a clean pass through the front door, a feed, every dashboard tab, About and Install.
14. **Upgrade.** Boot the new build on a copy of an older install's data; a `pre-migrate-v*` backup appears and
    everything still plays.

## Results

### 0.2.0 candidate, 2026-10-22

Run by: the M8 session (Claude), branch `claude/m8-pwa-docs-release-5cd14b`.
Setup: macOS, Node 24.18.0, FFmpeg 8 from Homebrew, Claude's built-in browser on `http://localhost:3311`. A
scratch install in a temporary folder outside the repository (its own `data/` and a symlinked copy of `public/`
plus four generated 6-second clips). Invented family "The Halloway Tapes": parent Mara, kids Wren (Ember Tape,
kid login `wren`) and Bo (Arcade, Volt), viewer Nana, guest Uncle Theo.

| Step | Result |
|---|---|
| Automated: `npm test` | 259 tests pass on Node 24.18. |
| Automated: package list | Pass (`test/package.test.mjs`). |
| Automated: Docker build | **Not run: Docker is not installed on this computer.** CI runs it. |
| 1 Fresh install | Node route: the log printed "Ready for setup", the link and the code, saved to `data/setup-token`. Docker route not run (no Docker). |
| 2 Wizard | Pass: two kids, different badges (shuffled shield with a sticker for Bo), themes and accents; Wren's login. Note: switching on a kid login pre-fills a suggested password; typing appends to it. |
| 3 Front door → feed | Pass for both kids, signed out and signed in, at 1280 px and 390 px. Kids no longer see a "Parents" link. |
| 4 Kid upload → review → live | Pass: new name card, "Sent to a parent", Review → Approve, poster in the running order. |
| 5 Viewer, reactions, comments | Pass after a fix: the held comment now says a parent reads it first. "Show it" published it. |
| 6 Guest code, one kid | Pass: Bo-only code with QR; redeemed, `/api/channels` listed only Bo and Wren's clips answered 403. Expiry not waited out. |
| 7 Time capsule | Pass: sealed, locked tape with note; opened on the server's tick (`capsule.open`, moved first); Ember's unlock played for Wren. |
| 8 Daily tape | Pass: "End of tape" at exactly 900 s, video 403 `end-of-tape`, poster 200, one `budget.end`. |
| 9 Who watched, Activity | Pass after a fix: capsule and daily-tape events now read as sentences. |
| 10 Reduced motion | Pass in the playground: all six themes mount with `data-kt-reduced`, no running animations and a still canvas; with it off, each runs animations. The pane can't emulate the system setting, so the feed's own CSS media queries were not seen live. |
| 11 Widths | Pass after two fixes: dashboard rows used a 120 px column on wide screens; on 360 × 580 Ember's pause readout hit the upload button and its label sat on the caption. No horizontal scroll anywhere checked. |
| 12 Home-screen app | Manifest, Apple icon and worker pass (family badge icons once saved; defaults before). Worker active and controlling; 34 cache entries, none under `/api/`, `/brand/` or media. `/install` showed the Android steps under a phone user agent; Chrome's install prompt did not fire in the pane. iOS Simulator not run. |
| 13 Console | Pass: no messages at all in a clean tab. The only errors in the long session were deliberate refusals (guest asking for another kid, a spent tape) and one malformed probe. |
| 14 Upgrade | Covered by the migration tests (v0 database with clips); not repeated by hand. |

Fixed during this run: the four items above, plus the duplicate play glyph under a theme's pause screen.
