# Maintainer notes

This folder is the project's working history: the plan, design notes, reviews and one hand-over note per build
milestone. None of it ships: the npm package, the Docker image and `create-kidtube` all leave it out, and CI
checks that. For how the code works today, start with [../ARCHITECTURE.md](../ARCHITECTURE.md); where a note
here and the code disagree, the code wins.

The files keep their names because code comments link to some of them.

## Current

Read these in order. They still describe decisions in force or open questions.

| File | What it is |
|---|---|
| [2026-10-21-kidtube-app.md](2026-10-21-kidtube-app.md) | The plan: why the starter became an app, Eddie's product decisions, the brand direction and the milestones M0 to M8 |
| [2026-10-21-architecture-notes.md](2026-10-21-architecture-notes.md) | The contracts the milestones built on: schema rules, CSP, brand module, settings, media access. `test/frontend-csp.test.mjs` pins its CSP |
| [security-review.md](security-review.md) | The end-to-end security and privacy review: 17 findings, all fixed or decided, each with a regression test in `test/security-review.test.mjs` |
| [naming.md](naming.md) | The rename research: shortlist, checks and risks. The decision is still open |
| [2026-10-21-fun-features-brainstorm.md](2026-10-21-fun-features-brainstorm.md) | Feature ideas beyond the plan. Time capsules, reactions and end of tape shipped; the rest is undecided |

## History

Hand-over notes, one per milestone, in the order they were built. Each says what landed, what it left for the
next milestone and how it was checked. They name files and docs as they were then; some have since been renamed
or merged (`admin.js` and `entrance.js` became the dashboard and the shell, and `DEPLOYMENT.md` was folded into
`INSTALL.md`).

| File | Milestone |
|---|---|
| [M2-notes.md](M2-notes.md) | M1, the foundation, written for M2: the brand module, settings keys, schema v2 and the changed API responses |
| [M2-handover.md](M2-handover.md) | M2: self-hosted fonts, stylesheets, the brand layer in pages, the CSP header |
| [M3-notes.md](M3-notes.md) | M3: the splash theme system and the six launch themes |
| [M4-notes.md](M4-notes.md) | M4: the badge builder, stickers, glyph tables and brand files |
| [M5-notes.md](M5-notes.md) | M5: first boot with no `.env`, setup mode and the browser wizard |
| [M6-notes.md](M6-notes.md) | M6: the multi-kid viewer flow, kid logins and per-kid uploads |
| [../superpowers/specs/2026-10-21-launch-story-bundle-design.md](../superpowers/specs/2026-10-21-launch-story-bundle-design.md) | The approved design for the launch story (between M6 and M7) |
| [launch-story-notes.md](launch-story-notes.md) | The launch story: time capsules, reactions, the watch log and daily limits, schema v4 |
| [M7-notes.md](M7-notes.md) | M7: the parent dashboard, activity and the extension slots |
| [M8-notes.md](M8-notes.md) | M8: the home-screen app, the docs and release polish |
| [install-test-notes.md](install-test-notes.md) | The Docker and iPhone install test, and what it fixed |
| [demo-notes.md](demo-notes.md) | Demo mode |
| [demo-sandbox-notes.md](demo-sandbox-notes.md) | The demo's private sandbox for customizing kids |

`M2-notes.md` and `M2-handover.md` look alike by name but cover different milestones (M1's server contracts and
M2's front end), so both stay. The launch story spec lives in `docs/superpowers/specs/` because that folder's
path is checked by the packaging tests and named in `bin/create-kidtube.mjs`.
