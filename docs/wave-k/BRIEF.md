# Wave K — brainstorm brief: make every non-crochet craft as rich as crochet

The owner's request (2026-11-12): "make everything that's not crochet as resource rich as the
crochet", with a free hand on effort, but **ideas first**: this wave's first phase produces
proposals only. The owner signs off on a shortlist, and only then is anything built.

**This phase writes documents. It changes no code, no tests, no existing docs.**

## What "as rich as crochet" means here
Crochet is the original craft and has had ten waves of work. Its richness, roughly: a PDF import
that turns a messy pattern into parts with counted rows; a parser with computed counts, a
confidence signal and hundreds of real-fixture assertions; multi-size handling; a live 3D model of
the piece that follows every tap; yarn colours from the pattern; repeats, targets, alerts, placing
notes; templates; checklists; a focus / working mode; guided tours and FAQs; celebrations; an
accuracy audit against page-by-page ground truth; a large real fixture set. The other crafts
(knitting, cross-stitch, sewing) each have a subset. Your job is to find, for your lens, what would
close that gap and what would go beyond parity into the things only that craft needs.

## Ground rules
- Work in `C:\Users\mitch\CrochetBs-wave1` (branch `wave-1`). Write ONLY your own file under
  `docs/wave-k/brainstorm/`. Edit nothing else. Do not commit.
- Read `HANDOFF.md` first (what is live, what is left, per craft), then the docs it points to for
  your lens (`docs/CRAFTS.md`, `docs/research/*.md`, `docs/wave-*/`, `docs/brainstorm/` for the
  2026-09-17 brainstorm so you do not repeat it: say which of its items are done, and build on
  what is still open). Read the code for your area enough to cite it.
- **Use the app.** Dev server http://localhost:8766 (`preview_start {name: "wave1"}`), your OWN
  tab via `tabs_create`, `Store.__setKeyForTests('stitchkeeper-wavek-<lens>')` for private state.
  Import real fixtures from `tmp-pdf/` (see `tmp-pdf/SOURCES.md`) the way a user would and note
  what happens. Evidence beats opinion: cite the fixture, the screen, the file and function.
  Clean up your projects and BlobStore `p:<id>:` entries afterwards.
- `tmp-pdf/` is copyrighted and gitignored: never copy its content into your document beyond a
  short phrase needed to identify a line. Do not download anything.
- Owner constraints that bind every proposal: **no per-user running cost** (everything on the
  device; no LLM or server inference; if you believe something truly needs it, list it separately
  as "needs a paid service" with the cost, never as a default); plain HTML/CSS/JS, no build step;
  the app must stay fast on a phone; accuracy over reach (an honest "could not read this" beats a
  confident wrong answer); the code is proprietary (vendored third-party code needs a compatible
  licence and a note).
- If something needs an owner decision, a new fixture the owner must supply, or a download that
  needs approval, say so explicitly on that proposal.

## What to hand in: `docs/wave-k/brainstorm/<nn>-<lens>.md`
1. **Parity table** for your lens: each relevant crochet capability, and its state in your craft
   (has it / partial / missing), one line of evidence each.
2. **Proposals**, ranked, 12 to 25 of them. For each: a name; what the user sees (two or three
   sentences, concrete); why it matters (evidence); how it would work on the device; effort
   (S = hours, M = a day, L = several days, XL = a wave of its own, in agent-work terms);
   dependencies and risks; how we would know it is right (the test or fixture that proves it).
3. **Your top 8** with a one-line pitch each, and the **one thing** you would build first.
4. **Do not build**: ideas you considered and rejected, with the reason (so nobody proposes them
   again).
5. **Asks for the owner**: fixtures, decisions, approvals.
Keep it under about 450 lines. Plain language. No filler.

Finish with a short final message: the file you wrote, your top 8, the one thing, and the asks.
