# 06 — PDF import robustness: what breaks next

Brainstorm, 2026-09-17. Lens: QA lead on the import path. Scope is
`js/pdftext.js` (geometry), `js/patterns.js` §3–7b (rules), `pdfDropZone` /
`importPicker` in `js/app.js` (UI), and how we get more fixtures without
breaking copyright. Nothing here is a decision; nothing here was implemented.

## Summary

Nine real crochet PDFs taught us geometry (letter-spaced glyphs, two-column
bleed, rotated photo captions, running heads) and typography (`Name: (Make 2)`,
`Body/Head`, glossary pages, assembly pages). Those nine are all **English,
all born-digital, all single-pattern, all amigurumi-or-garment, all under
5 MB**. Every one of the next classes of failure sits outside that box.

Three structural observations shape the ranking:

1. **The parser's most dangerous state is "confidently wrong", and we already
   have a free detector for it that we throw away.** Every row can produce
   *both* an explicit count and a computed one; `Line.count` is
   `stitches ?? computed` and the disagreement is discarded. The fixtures page
   measures it (≥ 90 % agreement target) and the app never does. A mismatch is
   a canary for column bleed, OCR noise, wrapped-row merges and vocabulary
   gaps all at once. Surfacing it is the single cheapest robustness win in the
   codebase.
2. **The geometry layer fails silently and the text layer fails loudly.** A
   password-protected or image-only PDF produces a clear, friendly error. A
   three-column page, a table of rows, or a subset font with no ToUnicode map
   produces *plausible-looking text* that quietly becomes wrong rounds. We
   have good error copy for the easy half and no signal at all for the hard
   half. Most of the S-effort proposals below are about moving silent failures
   into the loud half.
3. **Effort ratio ranks OCR low; strategy ranks it high.** Tesseract.js
   (#22) scores badly on likelihood × impact ÷ effort because it is an L. It
   is still the only way to serve scanned vintage patterns, magazine rips and
   the garbled-font class, and it is the one big capability that costs nothing
   per user. Treat its low rank as "not first", not "not worth it".

Ranking below is `likelihood (1–5) × impact (1–5) ÷ effort (S=1, M=2, L=4)`,
rounded. Likelihood is "share of the next 1000 imports that hit this".

---

## 1. Surface the explicit-vs-computed disagreement · score 20

**Failure mode.** Any upstream error that changes a number — a column bleed
merging two lines, a wrapped-row merge taking the wrong bracket, an OCR `8`
read as `B` — produces a row whose printed count and whose arithmetic
disagree. The user counts to a wrong target and finds out four rounds later.

```
Rnd 7: (sc 2, inc) x6 (24)        ← printed 24, arithmetic says 24 ✓
Rnd 8: (sc 3, inc) x6 (36)        ← printed 36, arithmetic says 30 ✗ (bleed from the other column)
```

**Today.** `findExplicit` wins, `evaluate`'s answer is dropped on the floor,
`countSource: 'explicit'`, no trace. The fixtures page computes the
disagreement rate; the app never sees it.

**Proposal.** In `Patterns.parse`, when a row has both an explicit and a
computed count and they differ, keep `Line.computed` (already there) and add
`Line.mismatch: true`. Render a small ⚠ in the pattern sheet and in the
counter's stitch readout (`24 ⚠`), tap → "The pattern says 24; the stitches in
this round add up to 30. Tap to use 30." Feed the per-section mismatch rate
into the confidence banner (#8). Zero new parsing; it is one comparison and
one badge.

**Effort** S · **Impact** 4 · **Risks** Noise where our vocabulary is simply
incomplete (lace, post stitches) — gate the badge on the section having
≥ 70 % agreement overall, so a part we cannot read at all stays quiet instead
of shouting on every row.

---

## 2. Phantom rows from bare numbers (TOC, timestamps, materials lists) · score 16

**Failure mode.** `BARE_RE` accepts any line-initial number followed by `.`,
`:` or `)` with **no check that the rest looks like crochet** (the keyword
path has `ROW_REST_OK_RE`; the bare path has nothing). Video-companion
patterns, tables of contents and numbered supply lists all detonate.

```
3:40 Attaching the head          → row 3
5. Assembly ................ 12  → row 5
1. 4 mm hook                     → row 1, and "4 mm hook" is not evaluable
2) Safety eyes, 8 mm             → row 2
```

On a PDF with a contents page this opens a whole phantom section at the front
of the import, and because those rows start at 1 the expected-next-row matcher
in §7b happily hands real page-4 rounds to it.

**Today.** Silently wrong. The user sees a part called "" with rows 1–8 that
are the table of contents.

**Proposal.** In `detectMarker`, apply a rest-check to the `BARE_RE` branch
too: reject when the remainder fails `ROW_REST_OK_RE` *and* the line matches
any of (a) `^\d{1,2}:\d{2}\b` (a timestamp), (b) `\.{3,}` or `[ .]\d{1,3}$`
with no stitch token (dot-leader TOC), (c) a measurement/materials shape
(`\d+\s*(mm|cm|mtr|m|yd|g|oz|inch|")`). Additionally: a bare-number run that
appears **before** the first `FRONT_MATTER_RE` heading is front matter, not
rounds — the front-matter guard already exists for headers, extend it to bare
markers.

**Effort** S · **Impact** 4 · **Risks** Some real amigurumi rows are
genuinely `1. 6 sc in MR` — those pass `ROW_REST_OK_RE`, so keep that as the
primary allow and make the new rules rejections of last resort. Re-run
`test/patterns.fixtures.html`; the bee fixture leans hard on bare markers.

---

## 3. Stitch vocabulary gaps: UK terms and post stitches · score 16

**Failure mode.** `VOCAB` has no `htr` (UK half treble — used in *every* UK
pattern), no `miss` (UK for skip), no post stitches at all
(`fpdc`/`bpdc`/`fptr`/`bptr`/`fphdc`/`bphdc`), no `sc3tog`/`dc3tog`/`hdc3tog`,
no `picot`, `V-st`, `ch-sp`, `x-st`, `spike`, `ttr`. Post stitches are the
backbone of ribbing, baskets, textured blankets and cuffs — a whole product
category.

```
Rnd 12: *fpdc in next 2 sts, bpdc in next 2 sts; rep from * around (48)   → computed null
Row 4: 1 htr in each st to end, turn (32)                                 → computed null
Row 7: miss 1 ch, 2 tr in next ch                                         → computed null
```

The good news UK-wise: `sc`/`dc`/`tr` are all 1-produced-1-consumed, so US/UK
term collisions **do not** corrupt the arithmetic — only the missing words do.
That makes this a pure table edit, not a dialect problem.

**Today.** `computed` is null for the whole row (correct — we never guess) so
the counter shows no target. Graceful but the pattern is useless as a counter,
which is the entire product.

**Proposal.** Extend `VOCAB` (longest-first, the table is already ordered):
`(?:fp|bp)(?:sc|hdc|dc|tr)` → (1,1); `htr` → (1,1) placed *before* `tr`;
`miss` → (0,1); `(?:sc|hdc|dc|tr)3tog` → (1,3); `picot` → (0,0);
`v[- ]?st` → (2,1); `x[- ]?st|crossed\s+(?:dc|tr)` → (2,2); `spike\s*(?:sc)?`
→ (1,1); `ttr|trtr` → (1,1). Add a UK/US hint to the import review: when
`htr`/`miss`/`dtr` appear, show a chip "Looks like UK terms" (informational —
the maths is identical, but it earns trust and sets up #16's language work).

**Effort** S · **Impact** 4 · **Risks** `tr` must stay matched *after* `htr`
or `htr` never fires; `sk`/`miss` ordering vs `skip`. Add unit rows to
`test/patterns.test.html` for each new token, both alone and inside a
`(...)x6` group.

---

## 4. Per-page "no text on this page" detection · score 16

**Failure mode.** Mixed PDFs are extremely common: a 24-page Etsy pattern
where pages 1–3 are a designed cover exported as an image, pages 4–20 are
real text, and pages 21–24 are photo tutorials rendered as JPEGs with the
captions burned in.

**Today.** `extract` only checks that the *whole document* produced some
non-whitespace body. A document that is 80 % image pages passes, reports
"Read 24 pages · 1,240 characters", and the user has no idea that the rounds
for the Legs live in a picture.

**Proposal.** `pageLines` already returns per-page lines; accumulate
`charsPerPage` in `extract` and return `emptyPages: number[]` alongside
`pages`/`chars`/`columnsDetected`. `pdfDropZone.showResult` gains a second
line when `emptyPages.length`: "Pages 1–3, 21–24 had no readable text (they
are probably images)." — with, once #22 exists, a "Read them with OCR" button
that OCRs *only* those pages. This also gives the confidence banner (#8) its
strongest single signal.

**Effort** S · **Impact** 4 · **Risks** Legitimately blank pages and
image-only photo-gallery pages will be listed; wording must be "no readable
text", not "failed".

---

## 5. Garbled text from subset fonts with no ToUnicode map · score 15

**Failure mode.** PDFs exported from Canva, Affinity Publisher, some InDesign
presets and a lot of phone apps embed subset fonts with no `ToUnicode` CMap.
pdf.js then returns the raw glyph codes. The stream *looks* like text to every
check we have.

```
=== PAGE 4 ===
 6 * 0 ) < ) ! " # $ % & ' ( ) * + ,
 - . / 0 1 2 3 4 5 6 7 8 9 : ; < = >
```

**Today.** `body.length` is non-zero, so extraction "succeeds". The import
picker shows zero sections, the drop zone cheerfully says "Read 12 pages ·
9,400 characters", and the user concludes the app is broken. **This is our
worst silent failure** — it looks like a parser bug to the user and gives us
no diagnosis.

**Proposal.** A `looksLikeProse(text)` check in `PdfText.extract`, run on the
assembled body: share of characters in `[A-Za-z0-9 .,()\-:]`, share of tokens
that are 2–12 letters, and a hit count for a tiny stop-word list (`the, and,
in, of, st, sts, row, rnd, ch, sc, stitch, next, each, repeat` — dialect-safe).
Below threshold, throw a *distinct* friendly error: "This PDF's text came out
as symbols — its fonts don't carry a text mapping. The pages themselves are
fine, so reading them as pictures (OCR) will work." That message is the
natural entry point to #22, and the page images render correctly even when
the text does not.

**Effort** S · **Impact** 5 · **Risks** A non-Latin pattern (Japanese,
Cyrillic) would trip the same check — so key the stop-word test on "no
recognisable words in *any* shipped alphabet", and always offer the OCR route
rather than refusing.

---

## 6. File-size guard, page cap and a Cancel button · score 15

**Failure mode.** A 100 MB tiled-pattern PDF (sewing PDFs routinely are; big
crochet ebooks with full-bleed photos reach 60 MB) on a 3 GB Android phone.
`readArrayBuffer` materialises the whole file, then `new Uint8Array(buf)`
copies it again — 200 MB before pdf.js allocates anything — and pages are
processed in an unbounded sequential chain with no way out.

**Today.** No size check anywhere (`isPdfFile` looks at type and extension
only). The tab is killed by the OS. From the user's side the app simply
vanished mid-import: the worst possible failure, because there is no error to
read and PWAs get uninstalled over this.

**Proposal.** Three small independent guards in `pdfDropZone.takeFile` /
`PdfText.extract`:
- Over ~25 MB: a confirm sheet — "That's a 61 MB file. Reading it may take a
  while or run out of memory on this phone. Read the first 20 pages?" with
  page-range entry (#12).
- Pass the `ArrayBuffer` straight to `getDocument({ data: buf })` instead of
  wrapping in a second `Uint8Array` (pdf.js accepts an ArrayBuffer; halves
  peak memory for free).
- A **Cancel** button in the busy state of the drop zone: a `cancelled` flag
  checked at the head of each `makeStep`, plus `doc.destroy()`. There is no
  way to abort an import today at all.

**Effort** S · **Impact** 5 · **Risks** The threshold is a guess without real
low-end-phone telemetry we cannot collect; make it a constant and pick
conservatively. Cancel must leave the textarea untouched, not half-filled.

---

## 7. Unicode hygiene: soft hyphens, zero-width, fullwidth digits, exotic bullets · score 12

**Failure mode.** Text pasted from a web page, a Google Doc or a
justified-typeset PDF carries characters `trimLine` does not know about. It
normalises dashes and NBSP and stops there.

```
Rnd 5: in­crease in each st (24)      → "in­crease" never matches `increase`
​Rnd 6: sc around (24)                 → zero-width space kills the ^ anchor
▪ Rnd 7: sc around                          → ▪ is not in [-*•]
Rnd ７: sc around                           → fullwidth digit, num() → NaN
in-
crease in each st                           → hyphenated line break, two lines
```

**Today.** Silently wrong: the line falls through to `note`, so a round
disappears from the count and the user's targets shift by one for the rest of
the part.

**Proposal.** In `trimLine`: strip `­​-‍﻿⁠`,
`String.prototype.normalize('NFKC')` when available (folds fullwidth digits
and ligature codepoints), and widen the bullet class in `BARE_RE`/`KEYWORD_RE`
to `[-*•▪●◦‣·⁃∙]`. In
`prepareLines`, join a line ending in `-` or `­` to the next when the
next starts lowercase and the joined pair makes a word (cheap heuristic: the
tail before the hyphen is ≥ 2 letters).

**Effort** S · **Impact** 3 · **Risks** NFKC also folds `½` → `1⁄2` and some
superscripts; harmless here. The hyphen-join must not fire on
`Rnd 5 - 8` (already normalised to `-` by `normDashes`) — require the hyphen
to be word-final with no space before it.

---

## 8. A crochet import confidence banner + "show me what the app read" · score 10

**Failure mode.** Every proposal above produces a signal that nothing
currently displays. The user's only feedback is a section list; when the
section list is empty or absurd they have no idea whether to blame the PDF,
the app, or themselves.

**Today.** Cross-stitch has `xs-confidence` (`js/app-xstitch.js:3130`) with
good/ok/none levels. Crochet import has nothing — just "Read 9 pages · 2
columns untangled · 4,120 characters", which is about the *extraction*, never
the *understanding*.

**Proposal.** A `Patterns.confidence(lines, summary) → { score, reasons[] }`
returning 0–1 from signals we already compute: share of non-furniture lines
classified as rows; share of rows with any count; explicit-vs-computed
agreement (#1); sections with zero rows; `emptyPages` share (#4); chars per
page. Render the existing `.xs-confidence` style above the section list with
the single strongest reason ("Only 4 of 180 lines look like rounds — this may
be a chart or a scan") and two buttons: **Fix the text yourself** (expands the
raw textarea, scrolled to the first unparsed block) and **Show what the app
read** (a collapsible `<pre>` of the extracted text with page markers). The
second is also our entire support channel: "screenshot this" beats twenty
questions.

**Effort** M · **Impact** 4 · **Risks** A confidence number invites arguments
about calibration; show a reason and a colour, never a percentage.

---

## 9. `buildRows` degrades to O(items × rows) on dense pages · score 10

**Failure mode.** For each text item, `buildRows` scans the existing rows
*backwards* to find a matching baseline. That is fast when items arrive in
reading order and catastrophic when they do not — symbol charts, vector art
with per-glyph placement, and tiled sewing pattern sheets emit tens of
thousands of items in near-random Y order. 200 k items × 3 k rows ≈ 600 M
comparisons on the main thread of a phone.

**Today.** The UI freezes for tens of seconds with the progress bar stuck on
one page, no cancel (#6), and Android's "page unresponsive" dialog appears.
Indistinguishable from a crash.

**Proposal.** Replace the backward scan with a hash bucket keyed on
`Math.round(y / Y_TOLERANCE)`, checking that bucket and its two neighbours —
O(1) per item, identical grouping. Add an item-count guard: over ~40 k items
on one page, skip `columnize`/`labelRows` for that page (their per-row loops
are the other quadratic risk) and note it in `emptyPages`-style reporting.

**Effort** S · **Impact** 5 · **Risks** Bucket boundaries can split a row
whose items straddle the rounding edge — checking neighbouring buckets fixes
it; add a synthetic fixture (#11) with baselines at exactly `k * Y_TOLERANCE`.

---

## 10. Tables of rows, and `columnize` firing on them · score 10

**Failure mode.** Brand patterns (Yarnspirations, Lion Brand) and most
sizing/shaping instructions use tables:

```
Row   Sts   Instruction
1     24    sc in each st around
2     30    (sc 3, inc) x6
```

Two things go wrong. First, a table's column gutters look exactly like a page
gutter to `findGap`: if the "Sts" column's gutter lands between 30 % and 70 %
of the page width and few lines bridge it, `columnize` splits the table and
emits **every row number, then every count, then every instruction** as three
separate blocks. Second, even unsplit, the header row `Row Sts Instruction`
and any multi-line cell fragment the parser cannot place.

**Today.** Silently, spectacularly wrong — and the more carefully typeset the
pattern is, the worse it gets. This is the failure I would bet on appearing in
the first ten brand-pattern imports.

**Proposal.** Before `columnize`, a `looksTabular(rows)` test: cluster item
left edges across the page; if ≥ 3 clusters each carry an item on ≥ 60 % of
lines, and the median items-per-line is ≥ 3, treat the page as a table —
**skip `columnize` entirely** and join each row's cells with ` | `, which the
existing pipe rule in `findExplicit` already reads as a count separator (`| 18
sts` → 18). Drop a leading header row whose cells are all in
`{row, rnd, round, sts, st, stitches, count, instruction, size, colour, color}`.

**Effort** M · **Impact** 5 · **Risks** Real two-column prose pages with
hanging indents could read as tabular; require ≥ 3 clusters (a two-column page
gives 2) and a low median line length.

---

## 11. Synthetic geometry fixtures (committable, no copyright) · score 10

**Failure mode.** Not a user failure — a *development* failure. Every geometry
rule in `pdftext.js` (letter-spacing, rotated callouts, caption blocks,
columns, running heads, margins) is verified only against nine gitignored
copyrighted PDFs on one machine. Nobody else can run them, CI can never run
them, and a regression in `labelRows` is invisible until a fixture happens to
cover it.

**Today.** `test/patterns.fixtures.html` skips gracefully when `tmp-pdf/` is
absent — which on any machine but the owner's means the geometry layer has
**zero** test coverage.

**Proposal.** `PdfText._pageLines(items, width, height)` is already exported
and takes exactly the shape pdf.js hands it. So commit **JSON pages**, not
PDFs: `test/fixtures/geometry/*.json`, each an array of
`{ str, transform:[a,b,c,d,e,f], width, height }`, plus the expected line
array. A tiny generator page (`test/geometry.build.html`) lays plain pattern
text out into those item arrays under a chosen stressor — two columns, a
narrow sidebar, letter-spaced glyphs, rotated callouts, a caption block in a
gap, a running head, a table, baselines on the tolerance boundary. The text is
ours, the geometry is the hard part, and the whole thing is a few hundred
lines with no dependency and no build step. `test/pdftext.test.html` then runs
them in milliseconds on any machine.

**Effort** M · **Impact** 4 · **Risks** Synthetic geometry can drift from what
pdf.js really emits — keep one "capture" button on the fixtures page that
dumps a real page's item array (owner-side, gitignored) so a synthetic case
can be calibrated against reality once, then committed.

---

## 12. Page-range picker before parsing · score 8

**Failure mode.** Multi-project ebooks, patterns with 10 pages of photo
tutorial, bundles where pages 1–6 are the shop's terms and conditions. All of
it becomes sections, notes and checklist suggestions.

**Today.** All-or-nothing. The user's only lever is editing 40 000 characters
of extracted text in a phone textarea.

**Proposal.** After extraction, a compact "Pages" row in the import picker:
page-number chips (or a `4–19` range input) defaulting to all, with a live
"12 rounds in 3 sections" recount. Implementation is trivial because `extract`
already emits `=== PAGE n ===` markers — filter the text by marker before
handing it to `Store.splitSections`. Pair with #6: on a huge file, ask for the
range *before* reading.

**Effort** M · **Impact** 4 · **Risks** Page numbers in the PDF rarely match
the printed page numbers; show the first line of each page as a hint next to
its chip.

---

## 13. Off-centre columns and narrow sidebars · score 6

**Failure mode.** `findGap` only accepts a gutter whose midpoint sits between
30 % and 70 % of the region width (`BAND_LO`/`BAND_HI`). A materials sidebar
at 22 %, an asymmetric two-column layout (wide text + narrow notes), or a
three-column brand leaflet with the first gutter at 28 % is never found.

```
MATERIALS      Rnd 1: 6 sc in MR (6)
4 mm hook      Rnd 2: inc x6 (12)
Worsted        Rnd 3: (sc, inc) x6 (18)
```
→ `4 mm hook Rnd 2: inc x6 (12)` — the marker is no longer line-initial, so
every round in the pattern disappears.

**Today.** Silently wrong, and the symptom ("import found nothing") points at
the parser, not at geometry.

**Proposal.** Replace the band constraint with a validity test on the
*result*: accept any gap ≥ `MIN_GAP_WIDTH` where both sides clear
`MIN_COLUMN_LINES`/`MIN_COLUMN_SHARE` (those checks already exist in
`columnize` and already reject bad splits), and prefer the widest. Keep a
weaker positional prior (5 %–95 %) only to avoid splitting off the margin.
Raise `MAX_COLUMNS` handling to allow the recursion to find a 1 + 2 layout.

**Effort** M · **Impact** 4 · **Risks** More aggressive splitting is exactly
what the 30–70 band was protecting against; this must be gated behind the
synthetic geometry fixtures (#11) and a full re-run of all nine crochet plus
eleven cross-stitch fixtures, because cross-stitch key pages reuse the same
extractor.

---

## 14. Non-PDF sources: .txt, .html, Google Docs, .docx · score 6

**Failure mode.** A large share of free patterns are blog posts, Google Docs
links or Word files. Ravelry indie designers hand out `.docx` regularly.

**Today.** The drop zone's `accept` defaults to `['.pdf']`; anything else gets
"That isn't a PDF" and the user has to find the paste disclosure. Pasting from
a web page also drags in `​`, soft hyphens and exotic bullets (#7).

**Proposal.** Widen the crochet zone's `accept` to
`['.pdf','.txt','.md','.rtf','.html','.htm','.docx']` and route non-PDFs
through `onFile`: `.txt`/`.md` straight in; `.html` via
`new DOMParser().parseFromString(...)` + `innerText` on `body` (with
`<script>`/`<style>` removed); `.rtf` with a crude control-word strip;
`.docx` by unzipping on-device — a `.docx` is a zip whose `word/document.xml`
holds the paragraphs, and `DecompressionStream('deflate-raw')` is available on
every browser this PWA targets, so a ~60-line reader gets `<w:p>` boundaries
as newlines with no library and no build step. Everything stays offline and
free.

**Effort** M · **Impact** 3 · **Risks** The zip central-directory parse is
fiddly (store vs deflate entries); fall back to "Open it and paste the text"
on any error rather than half-reading. RTF is genuinely nasty — consider
dropping it from v1.

---

## 15. Multi-pattern ebooks · score 6

**Failure mode.** A 90-page "12 Amigurumi Animals" ebook. The row-restart rule
opens a new section per piece per animal; header groups hand out names
plausibly for a while and then drift.

**Today.** The import picker renders 60+ rows (and re-renders the whole list
per tick), the user ticks the wrong ones, and a project ends up with a
Dinosaur's Tail on a Bunny.

**Proposal.** A grouping pass in `Store.splitSections` (or a wrapper): detect
pattern boundaries from repeated structure — a page whose first line is Title
Case and is followed within 15 lines by `FRONT_MATTER_RE`, or a page that
restarts at a "Materials"/"You will need" heading. When ≥ 2 boundaries are
found, the import sheet shows a **first** step: "This PDF looks like 12
patterns — which one?" listing title + page range, then filters to that range
via the page markers (shares all of #12's plumbing).

**Effort** M · **Impact** 4 · **Risks** False boundaries inside one long
pattern; always offer "It's one pattern, import all of it" as the first option.

---

## 16. Password-protected PDFs · score 6

**Failure mode.** Some shops apply an open password or an
owner/permissions password to paid PDFs.

**Today.** Handled *gracefully*: `friendlyError` maps `PasswordException` to
"That PDF is password protected." — but it is a dead end, with no way to
supply the password the user legitimately has.

**Proposal.** pdf.js exposes an `onPassword(callback, reason)` hook on the
loading task. Wire it in `PdfText.extract`/`open` to a promise the drop zone
can resolve from a password field ("This PDF needs its password — it stays on
this device"), with one retry on `INCORRECT_PASSWORD`. Never stored, never
logged, cleared on sheet close. Owner-password-only files often open with an
empty string — try `''` once automatically before asking.

**Effort** S · **Impact** 3 · **Risks** Must be visibly transient and clearly
about *the document*, not an account; put the reassurance in the field hint.

---

## 17. Crochet page images for charts and diagram-driven patterns · score 6

**Failure mode.** Crochet symbol charts (doilies, lace, most Japanese
patterns), "work chart A.1" references, and photo-tutorial steps carry
information that has no text form at all.

**Today.** Cross-stitch and sewing both rasterise pages into `BlobStore`;
crochet does not. A crochet import of a charted pattern ends with an empty
project and the PDF still sitting in the user's downloads.

**Proposal.** Reuse the existing machinery: `ctx.pdfDropZone` with `onPages`,
`BlobStore` keys `p:<id>:patternpage:<n>`, the sewing pinch-zoom viewer, and a
per-part "chart page" link. Offer it whenever confidence (#8) is low or
`emptyPages` (#4) is non-empty: "Keep the pages as pictures so you can read
the chart while you count." Note the documented caveat in `docs/CRAFTS.md`:
`onPages` + `onText` skips the running-head pass — see #21.

**Effort** M · **Impact** 4 · **Risks** Storage (the 40-page cap and the
oversize guard cross-stitch already learned); backups still do not include
BlobStore, so the "stored on this device only" copy has to appear here too.

---

## 18. A shape-only fixture contribution flow · score 6

**Failure mode.** We can only fix what we can reproduce, and we can never ask
users to send us copyrighted PDFs.

**Today.** Nothing. A failed import is a silent loss; the owner learns about
classes of PDF only by buying them.

**Proposal.** A "This didn't come out right" button in the import sheet that
produces a **redacted shape report** — per line: its classification
(row/header/note/repeat/setup), the marker form, the count form
(`bracket`/`pipe`/`tail`/`none`), the multi-size shape, length bucket, and the
*non-word* characters only; every word replaced by `W`, every number kept
(numbers are facts, not expression). Plus `pages`, `columnsDetected`,
`emptyPages`, confidence and its reasons.

```
p4 L12  row     marker=bare("N.")   rest=W W W W        count=bracket(18)
p4 L13  note    len=40-80           starts=W
p4 L14  row     marker=kw("Rnd N:") rest=W N W W W W    count=none      MISMATCH
```

That is a schema, not a work — it reproduces structure without reproducing
expression, it is a few KB, and it is safe to email. Ship it as a downloaded
`.json` plus a copy-to-clipboard (no backend, no per-user cost). A separate,
explicitly ticked "I have the right to share this pattern" option attaches the
full text for designers sending their own PDFs.

**Effort** M · **Impact** 4 · **Risks** Users will not read the explanation —
show a preview of exactly what will be sent before the download, and default
to shape-only. Do not promise a reply.

---

## 19. Language packs: German, Spanish, French, Dutch, Portuguese, Italian · score 5

**Failure mode.** Two of our own nine fixtures are *translations* of German
patterns; the untranslated originals are everywhere, and Etsy sellers publish
both.

```
Reihe 5: 6 fM in den Magischen Ring (6)      → no marker (kein "R"/"Rnd"), no vocab
Runde 7: 2 fM in jede Masche (24)            → no marker
Vuelta 3: (pb, aum) x6 (18)                  → no marker, "pb"/"aum" unknown
Rang 4 : 6 ms, 1 aug (13)                    → no marker
```

German `Rd`/`R` accidentally hits `KEYWORD_RE`, so German patterns *half*
work: some rows found, counts always null, sections named from German
headings. Half-working is worse than not working, because the user trusts it.

**Today.** Silently wrong for the half that parses.

**Proposal.** A `LANGS` table in `patterns.js`: per language, the row keywords
(`Reihe|Runde|Rd|R`, `Vuelta|Ronda|Hilera`, `Rang|Tour`, `Toer|Naald`,
`Carreira|Volta`, `Giro|Ferro`), the stitch vocabulary with produce/consume
(`fM`=sc, `Stb`=dc, `hStb`=hdc, `Lm`=ch, `Zun`=inc, `Abn`=dec; `pb`/`mp`,
`aum`/`dism`; `ms`/`br`, `aug`/`dim`; `v`/`stk`, `meerderen`/`minderen`), and
the "in each"/"around" phrases. Detect by scoring keyword hits across the
whole text, pick the winner, expose it as a chip in the import review
("Language: German — change") so the user can override. `KEYWORD_RE`,
`STITCH_ALT` and `OPEN_FILL_RE` get rebuilt per language rather than being
module constants — the one real refactor here.

**Effort** L · **Impact** 5 · **Risks** The regex constants are built once at
module load today; making them per-parse costs a rebuild per call (cache by
language id). Decimal commas (`2,5 mm`) must not read as multi-size lists.
Start with German and Spanish only — they are most of the non-English volume
in this market.

---

## 20. A per-row "fix it yourself" editor · score 5

**Failure mode.** The long tail. Whatever we do, some pattern will parse 90 %
right and the user needs to fix six rows.

**Today.** The only repair surface is the raw textarea before import, and
after import the part's pattern text. Nothing lets you say "round 14 is 42,
not 24" without hunting through 40 000 characters on a phone.

**Proposal.** After import (and from the part editor), a scrollable list of
parsed rows: row number, the instruction text, the count as an editable number
field, an "in/out" toggle to demote a phantom row to a note or promote a note
to a row, and drag-free ▲▼ to move a row between parts. Writes back by
rewriting `patternText` with a normalised `Rnd N: <text> (count)` form, so
everything downstream stays text and nothing new enters the data model.
Sort rows flagged by #1 to the top and the review takes thirty seconds.

**Effort** L · **Impact** 4 · **Risks** Rewriting `patternText` loses the
user's original formatting — keep the raw text in `Part.rawPatternText` (or
just do not rewrite unless edited). The existing picker already re-renders the
whole list per edit (HANDOFF "what's left" #7); do not repeat that here.

---

## 21. Restore the running-head pass for `onPages` + `onText` · score 4

**Failure mode.** The documented gap (`docs/CRAFTS.md`, HANDOFF #6): when a
craft asks for both page images and text, the text is assembled per page from
`textOf(n)`, which skips `dropRunningFurniture` and reports
`columnsDetected: 0`. Both current craft importers dodge it — but #17 would
put crochet straight into it, and crochet is the craft whose parser is most
confused by running heads (they read as section headers; `findRunningHeads` is
a second line of defence precisely because this one is imperfect).

**Today.** Latent, not user-visible yet. It becomes visible the day crochet
keeps page images.

**Proposal.** Expose `PdfText.extractFrom(handle, opts)` that runs the exact
`extract` tail — per-page `pageLines` keeping the `margin` flags,
`dropRunningFurniture`, page markers, `columnsDetected` — against an already
open document. `gatherText` in `pdfDropZone` calls it instead of joining
`textOf` output. Deletes the caveat from `docs/CRAFTS.md`.

**Effort** S · **Impact** 2 · **Risks** None beyond re-running the cross-stitch
and sewing fixture pages, which go through this path.

---

## 22. On-device OCR with Tesseract.js · score 3.75

**Failure mode.** Scanned books and magazines, Antique Pattern Library
downloads, phone photos of a printed pattern saved as PDF, image-only exports,
and the garbled-font class from #5 — where OCR is the *only* route, because
the page renders perfectly and only the text mapping is broken.

**Today.** "Couldn't read that PDF (it may be scanned images)" — accurate,
friendly, and a dead end.

**Proposal.** Opt-in, lazy, per-page. Vendor `tesseract.js` + the
`eng.traineddata` language data under `js/vendor/`, load only when the user
taps "Read the pages as pictures", rasterise with the existing
`PdfText.open().renderPage(n, { scale: 2 })`, run in Tesseract's worker, feed
the recognised words back through `pageLines` as synthetic items (OCR gives
per-word bounding boxes, so the *entire* geometry layer — columns, captions,
letter-spacing repair — keeps working unchanged; this is the key design
point). Only OCR the pages in `emptyPages` (#4). Show it as slow and
approximate, force the confidence banner to "check every round", and route
straight into the per-row editor (#20). No network at run time, no per-user
cost, which is exactly why this is allowed.

**Effort** L · **Impact** 5 · **Risks** Size: the traineddata is ~10–15 MB, so
it cannot join the service worker precache without hurting first load —
download on first use and cache then, with an honest "this adds ~12 MB, once".
Speed: 3–10 s per page on a phone; needs the Cancel button from #6 and a wake
lock. Accuracy on stitch abbreviations is poor (`sc`/`sc.`/`5c`), so #1's
mismatch flag and #20's editor are hard prerequisites, not nice-to-haves.

---

## 23. DROPS-style: one PDF, many languages, diagram references · score 2

**Failure mode.** DROPS/Garnstudio publish the same pattern in a dozen
languages, sometimes in one file, with house abbreviations and instructions
that delegate to lettered diagrams ("work A.1 over the next 8 sts").

**Today.** The text of every language concatenates into one soup; row numbers
restart per language, so the section logic opens a new section per language
and names them from whatever heading is nearest.

**Proposal.** Detect repetition: when the same *numeric* row skeleton (the
sequence of row numbers and counts) recurs 2+ times with different words, treat
each occurrence as a language variant and offer a picker (reuses #15's
boundary UI). Separately, recognise diagram references (`\bA\.\d\b`, "diagram",
"chart") and mark those rows `kind: 'row'` with `count: null` and a note "chart
row — see the diagram", rather than letting `evaluate` return null silently;
pair with page images (#17) so the diagram is one tap away.

**Effort** L · **Impact** 4 · **Risks** Narrow: one publisher's house style.
Worth doing only after #19 exists, since the language picker is the same
machinery.

---

## Fixture wish-list

Ten sources worth adding, chosen for legality first and for the failure mode
each one exercises. Rule stays: `tmp-pdf/` is gitignored, nothing copyrighted
is ever committed, `tmp-pdf/SOURCES.md` records provenance.

1. **DROPS / Garnstudio free patterns** (garnstudio.com/patterns) — free, no
   account, and the *same pattern* is downloadable in EN/DE/ES/FR/NO. Download
   one amigurumi and one garment in English **plus** German and Spanish: the
   English version is free ground truth for #19's language packs, which is the
   single hardest thing to test otherwise. Also the canonical diagram-reference
   case (#23).
2. **Yarnspirations free crochet** (Red Heart / Bernat / Caron) — no account,
   direct PDFs, brand house style. Pick a **garment with a shaping table** and
   a blanket with post stitches: exercises #10 (tables) and #3 (fpdc/bpdc) in
   one download.
3. **Lion Brand free patterns** — different house style, heavy multi-size lists
   and "Notes" sidebars set narrow on the left: the sidebar case for #13.
4. **Hobbii free patterns** — Danish designer, English exports; their PDF
   generator is a known letter-spacing offender, so a second, independent
   fixture for the `pageLooksSpaced` repair beyond the one we have.
5. **Antique Pattern Library** (antiquepatternlibrary.org) — explicitly free
   to copy and use, scanned from public-domain books. Grab one crochet booklet
   with a **symbol chart** and one with dense text. These are our OCR (#22)
   and charted-only (#17) fixtures, and being public domain they are the only
   real-world text we could ever commit verbatim.
6. **Archive.org / Project Gutenberg pre-1929 crochet manuals** (e.g. Weldon's
   Practical Needlework, Priscilla crochet books) — public domain, tables of
   rows in period typesetting, "miss 1 chain" UK phrasing throughout. The UK
   vocabulary fixture for #3, committable.
7. **Pierrot Yarns / Gosyo free patterns** (gosyo.co.jp) — free, English
   translations alongside Japanese originals with symbol charts. Fullwidth
   digits, `段` markers and chart-only pieces: #7 and #17.
8. **Purl Soho free patterns** — clean, well-typeset, and published as a web
   page *and* a print PDF. Take both: the web page tests the paste path and the
   `.html` route in #14, the PDF tests the print-to-PDF shape, and they are the
   same pattern so any divergence is ours.
9. **Owner-made Canva export** — write a 20-round pattern (the owner's own
   words, owned outright, so it is committable), lay it out in Canva with a
   two-column page, a rotated photo caption and a table, export to PDF. Canva's
   exporter is a reliable producer of the subset-font/garbled-text case (#5)
   and of column layouts. This is the highest-value fixture on the list because
   we own every word of it.
10. **Owner-made Google Docs → .docx, .txt and print-PDF of that same pattern**
    — three files, one source, owned outright, committable. Exercises #14 end
    to end and gives the geometry generator (#11) a real item array to
    calibrate against.

**Collecting at scale, legally.** (a) Public domain (pre-1929 US publication)
is the only category that can be *committed*; mine it first, it is also where
the hardest scans live. (b) Owner-authored patterns typeset through several
exporters (Canva, Word, Google Docs, InDesign, Affinity, Print Friendly) buy
most of the geometry coverage with zero rights questions — one pattern, eight
PDFs. (c) Free-but-copyrighted downloads stay in `tmp-pdf/` with a `SOURCES.md`
line each, exactly as today. (d) For anything a user hits in the wild, take the
shape report (#18), never the file. (e) For designers who *want* to be
supported, a short permission note — "may I keep your PDF as a private test
fixture, never redistributed, never published, in exchange for a free
lifetime Pro code?" — with the answer recorded in `SOURCES.md`; indie
designers on Ravelry say yes to this surprisingly often, and it is the only
clean route to a paid-pattern corpus. (f) Synthetic item-array fixtures (#11)
are unlimited, free and committable, and cover the geometry half completely —
the real PDFs then only have to cover the *typography* half.
