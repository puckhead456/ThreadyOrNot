# 14 — The Pattern Designer

*Brainstorm lens: an indie designer who sells crochet / cross-stitch / sewing PDFs on Etsy,
Ravelry, Payhip and her own shop. Some of her buyers already paste her patterns into Thready
or Not. Written 2026-09-17 against cache v20 / parser v2.4.*

---

## Summary

Thready or Not has quietly become a **reader of other people's copyrighted work**. Parser v2.4
now pulls section names, make-counts, computed counts, colour-change notes, assembly prose and
checklist items out of a designer's PDF and rebuilds her pattern as an app screen. From the
designer's chair that is either the best free marketing she has ever had, or a machine that
mangles her counts in front of her customers and then gets blamed for it. Which one it is comes
down to three things she cannot currently get: **visibility** (what does the app actually do to
my file?), **control** (can I make it come out right without changing how I write?), and
**assurance** (is my text being uploaded, rewritten, hosted, resold?).

The good news is that almost everything needed already exists in the repo and costs nothing to
run. `PdfText` + `Patterns.parse` + `Patterns.splitSections` + `Store.suggestChecklist` +
`importPicker` are exactly a pattern checker. `test/patterns.fixtures.html` already computes
"explicit vs computed agreement" per row — that is a **tech-editing tool** hiding in a test
harness. The vendored pdf.js build already exposes `getAttachments()` and `getMetadata()`
(verified in `js/vendor/pdf.min.js`), which means a designer can ship a perfect machine-readable
companion **inside her existing PDF**, as one file, through any shop, with no extra Etsy file
slot and nothing new for the buyer to open. That is the single highest-leverage idea here.

The strategic frame is the anti-Ribblr one. Ribblr's interactive patterns are excellent UX and a
custody arrangement: the pattern is authored in their studio (Ribbuild), lives on their platform
as an "ePattern", is sold through their shop, and its headline anti-piracy feature is that it
"can't be downloaded or re-shared" — which only works because they hold it. Our pitch is the
inverse — **keep your shop,
keep your PDF, keep your price, keep your customer list; the interactivity rides along in a file
you own.** For that pitch to be credible the app must publish, and keep, three promises: it never
uploads a pattern, it never rewrites or summarises one with AI, and it never hosts or lists
anybody's pattern text. A public "template gallery" would be a lawsuit magnet and would burn the
designer relationship on day one; it must be ruled out in writing, in `SPEC.md`, before someone
builds it as a "nice sharing feature".

Two honest weak points to fix before courting designers. First, the app does **not** currently
show a pattern verbatim: header names are Title-cased and stripped (`BODY EYES` → `Body`,
`Legs G` → `Legs`), and `(PHOTO A)` / `(4 rounds total)` fragments are removed from the line text
(SPEC "v2.1 additions"). A designer who sees her own wording altered will not care that the
alteration was helpful. Second, there is no way to import anything but a full backup —
`Store.importJSON` demands `version` + `projects[]` and **overwrites templates by id**, so a
designer-distributed file in that shape could clobber a buyer's saved template. A designer
companion file needs its own front door with its own validation.

---

## The "Thready-ready" authoring guide — outline

Published as a plain page in the repo (`for-designers.html`), linked from the checker, versioned
(`Guide v1 · parser v2.4`) with a changelog, and written for someone who has never thought about
machine readability. Tone: *you already write like this; here is how to not accidentally stop.*

**Headings**

1. **Why this page exists** — your buyers are pasting your PDF into counter apps already. Ten
   minutes of formatting means they never email you asking why the app says 29 and you said 30.
2. **The 60-second version** — a nine-line checklist; if you do nothing else, do these.
3. **Export your PDF as text, not pictures** — real text layer, no flattened screenshots of
   instructions, no letter-spacing tricks, embed the fonts. (Scanned or image-only pages fall
   back to page images and lose every count.)
4. **One column beats two** — two-column pages are untangled automatically, but only when there
   is a clean ≥14pt gutter between 30% and 70% of the page width. Side-notes in floating boxes
   inside a column are the thing that breaks.
5. **Part headers and make-counts** — short (≤40 chars), on their own line, ALL CAPS or Title
   Case, no sentence punctuation, make-count in the header itself.
6. **Row and round markers** — put the marker first, always the same way, all the way through.
   Ranges, "Next Row", setup/foundation rows.
7. **Stitch counts: put them last, in brackets** — one count per row, at the end, in `( )`;
   what happens when you don't (the app computes one and labels it `≈`).
8. **Colour changes, and notes that belong to a round** — a one-line note before the row it
   affects.
9. **Assembly, finishing and placement** — a clearly headed block; placement sentences
   ("between Rnd 8 and Rnd 9") are lifted into the buyer's Placing notes for that part.
10. **Sizes** — the `XS (S, M, L)` convention, kept in the same order everywhere, including in
    counts.
11. **Photos, photo labels and captions** — why `A  B  C` on their own line is fine and
    `(PHOTO C)` mid-line is fine, but a count printed *inside* a caption is lost.
12. **Cross-stitch: what makes a chart readable** — text-based key, one colour per key row with
    the code in its own column; the beta grid reader recovers charts drawn as per-cell coloured
    rectangles (KG-Chart style) and gives up fast on flattened ones. **Ship an `.oxs` alongside
    the PDF** — it is an open XML format and it makes every cell exact.
13. **Sewing: numbered steps, a real cutting table, one seam-allowance sentence** — and the
    standard wording that is already recognised.
14. **Bundle the companion data** (see proposals 9, 10 and 12) — optional, five minutes, and your buyer
    skips parsing entirely.
15. **Run the checker before you publish** — and what the badge does and does not claim.
16. **What we will never do with your pattern** — links to the promise page.
17. **Changelog / guide version** — so a file that passed last year still passes.

**Eight example lines** (the guide shows each as a ✅ / ❌ pair with the reason)

| # | Write this ✅ | Not this ❌ | Why |
|---|---|---|---|
| 1 | `WINGS (make 2)` | `Now make two wings — see photo on page 4` | A header is short, has no sentence punctuation, and carries its own make-count. This becomes a part named *Wings* with a 0/2 piece counter. |
| 2 | `Rnd 1: 6 sc in magic ring (6)` | `Round one: work six single crochet into a magic ring` | Marker first, digits not words, count last in brackets. |
| 3 | `Rnd 2: inc x6 (12)` | `Rnd 2: increase in every stitch — you should now have twelve` | A bracketed number at the end is read as the stitch count; a spelled-out number is not. |
| 4 | `Rnds 6–10: sc around (30)` | `Rnds 6-10 sc around, 30 sts each round` | Ranges are expanded to every round in them, so rounds 6, 7, 8, 9 and 10 all get a target of 30. |
| 5 | `Rnd 11: (sc 3, dec) x6 (30)` | `Rnd 11: *sc 3, dec* around — 30` *(count with no brackets, after a dash)* | Both are read, but the bracketed form is what the guide guarantees; groups in `( )`, `[ ]` or `* *` with `x6` / `6 times` / `repeat around` all evaluate. |
| 6 | `Rnd 12: sc around (30) Fasten off Almond.` | `Fasten off Almond. Rnd 12: sc around (30)` | Put the count before any trailing instruction; the trailing sentence becomes a note attached to that round. Put it first and round 12 loses its count. |
| 7 | `Change to Black before Rnd 13.` | `(remember the colour changes here)` | A short line starting with a change/colour keyword attaches to the **next** round, so it appears exactly when the buyer starts it. |
| 8 | `Attach safety eyes between Rnd 8 and Rnd 9, 6 sts apart.` | `Eyes go roughly where the photo shows.` | Placement sentences are copied into the buyer's Placing notes for that part and into her assembly checklist. Vague prose is kept as a note but placed nowhere. |

---

## Proposals, ranked by (impact ÷ effort)

Effort S ≈ under half a day, M ≈ one to three days, L ≈ a week or more.
Ranked highest ratio first; ties broken by impact.

---

### 1. The counting-error report — "computed ≠ stated"
**Why** · A tech editor's entire job is finding the round where the instruction makes 29 stitches
and the pattern prints `(30)`. `test/patterns.fixtures.html` **already computes this** (it
asserts ≥ 90% agreement between explicit and computed counts across bear + cato and lists the
rest) — it is a designer-grade tool trapped in a test page. Designers pay tech editors real money
for this pass; this is the cheapest possible thing to give away.
**Proposal** · A `Patterns.conflicts(lines) → [{ section, row, stated, computed, text }]` helper
that returns every row where `stitches != null && computed != null && stitches !== computed`, plus
every row where `computed === null` (the parser could not follow the instruction — usually a typo
or an unusual abbreviation). Surface it (a) on the checker page as the headline result —
*"37 rounds read · 2 rounds where the printed count and the written stitches disagree · 1 round
we couldn't follow"* with the offending lines quoted and the arithmetic shown — and (b) in the
app behind a quiet "Check this pattern" item so a **tester** finds the same thing on her phone.
Never auto-correct, never prefer computed over printed; show both and let a human decide.
**Effort** S (logic exists; needs extraction into `js/patterns.js` and a render).
**Impact** 5.
**Risks** · False positives on legitimately unusual stitches make a designer distrust the whole
app — so the report must separate "these disagree" from "we couldn't read this" and lead with a
line saying our arithmetic is a second opinion, not an authority. No IP risk: nothing leaves the
device.

### 2. "What Thready or Not will never do with your pattern" — a published promise
**Why** · The designer's first question about any pattern app in 2026 is *is it training on my
work / rewriting it / hosting it?* The cross-stitch and sewing research both already land on
"everything stays on-device" as the key trust line, and the hard product constraint (no per-user
LLM cost, offline-first) means we can promise something competitors cannot.
**Proposal** · A short, dated, plainly-worded page, linked from the import sheet, the checker and
the README, committing to: (1) your PDF is read **on your buyer's device** by pdf.js and never
uploaded; (2) we will never rewrite, paraphrase, translate or summarise your pattern with AI —
the app extracts structure and shows your words; (3) we never host, store, index or list your PDF
or its text on any server; (4) there is no public library or gallery of imported patterns and
there never will be (see #4); (5) we never sell, share or resell pattern content; (6) if you ask
us to stop supporting a specific file, here is the address. Mirror it as a short section in
`SPEC.md` so it is a build constraint, not marketing copy.
**Effort** S. **Impact** 4.
**Risks** · A promise in writing is a promise you must keep — it forecloses future server-side
parsing, cloud sync of pattern text, and any LLM "tidy up my import" feature. That is the right
trade (it matches the no-token-cost rule), but the business plan should note the door is shut.

### 3. The Thready-ready authoring guide (`for-designers.html`)
**Why** · Pattern Keeper's own designer page concedes *"the complexity of the PDF format makes it
so that it is impossible to set any strict guidelines"* — and yet "Pattern Keeper compatible"
became a selling point designers advertise in their own listings. The gap between "no guidelines"
and "designers want to comply" is the opportunity: be the app that actually publishes the rules.
**Proposal** · Ship the outline above as a static page in the repo (no app changes, no cache
churn beyond one precache entry), versioned against the parser, with a changelog. Written for a
non-technical designer, with the ✅/❌ table, downloadable as a one-page PDF she can keep.
**Effort** S. **Impact** 4.
**Risks** · A published guide creates an expectation that following it guarantees a clean import;
version it and say "guide v1, parser v2.4 — files that pass are kept passing by our fixture
suite" (see #18). Do not let the guide describe rules the parser does not actually have.

### 4. No public template gallery, ever — write the rule down
**Why** · The obvious next feature after "templates carry pattern text" is "share your template".
A template now contains the designer's instructions verbatim. A public gallery of those is a
distribution service for infringing copies, and being the host changes our legal position
entirely (notice-and-takedown obligations, a designated agent, repeat-infringer policy, the whole
DMCA apparatus) for a solo owner with no legal budget. Facebook pattern-sharing groups are
already the thing designers complain most loudly about.
**Proposal** · A hard rule in `SPEC.md` alongside the offline-first and no-token-cost rules:
*templates that carry pattern text are buyer-side only; the app never uploads, hosts, indexes,
lists or transmits a template to another user, and there is no in-app sharing, gallery, search or
"popular patterns" of imported content.* Designer-authored companion files (#9, #10) are
distributed **by the designer, through her own shop** — we never touch them. Any future
cloud-sync feature syncs a user's own data to her own account only, and even then pattern text is
opt-in.
**Effort** S (it is a written constraint plus a "do not build this" note).
**Impact** 4.
**Risks** · Gives up the one viral growth loop a pattern app has. Accept it: the designer
relationship is worth more than the loop, and the loop is what would get us sued.

### 5. Verbatim: never rewrite a line, never invent a count
**Why** · Today the app alters what the designer wrote. Header names are Title-cased and have
trailing capitals and "known non-part words" stripped (`BODY EYES` → `Body`, `Legs G` → `Legs`);
`(PHOTO A)` and `(4 rounds total)` fragments are removed from a row's displayed `text`. These are
good parsing decisions and bad publishing decisions. A designer looking over a buyer's shoulder
sees her own words edited.
**Proposal** · Keep the cleaned text for matching and display, but keep `Line.raw` (the source
line, untouched) and `Section.rawName` through `parse` / `splitSections`; add a **"Show as
printed"** toggle on the pattern sheet that renders `raw` instead, and make the checker always
show both columns side by side so a designer can see exactly what was changed and why. Restate,
in the guide and on the checker, that a **printed count always wins** over a computed one, that a
computed count is always labelled `≈`, and that the app never edits a number.
**Effort** S–M (carrying `raw` is mechanical; the toggle and the checker column are small).
**Impact** 4.
**Risks** · Doubles the stored text of a heavy pattern in `localStorage` — store `raw` only where
it differs from `text` and drop it when identical, which is the common case.

### 6. Cross-stitch: "bundle an OXS" campaign + a grid-readability page
**Why** · Cross-stitch is where compatibility badges already sell. Pattern Keeper maintains an
empirical **whitelist of supported designers** and designers advertise being on it; Cross Stitch
Saga's reviews are dominated by *"99% of sellers don't give you the file"*. Meanwhile OXS is an
open, documented, plain-XML format that `XStitch.parseOXS` already reads in full (cells,
backstitch, knots, fractionals) and `XStitch.toOXS` already writes — and WinStitch/MacStitch,
CSP Platinum, KXStitch and FlossCross all export it one click away.
**Proposal** · A cross-stitch section of the guide that says, bluntly: *the most valuable five
seconds of your publishing workflow is clicking "export OXS" and dropping it in the zip.* Explain
what it buys the buyer (exact cells, real backstitch, per-colour tallies, no parsing risk),
confirm we do not care which software made it, and document what makes a **PDF** grid-readable
for the beta reader (per-cell coloured rectangles in the content stream, as KG-Chart emits;
flattened chart images are unreadable and fail fast). Pair it with a key-layout section: code in
its own column, one colour per line, declared colour count somewhere on the page (the parser
sanity-checks against it).
**Effort** S (writing; the code already exists). **Impact** 4.
**Risks** · Low. Be careful not to imply DMC endorsement; keep the existing "screen colours are
approximate" line.

### 7. Designer badge + listing snippet, self-served from the checker
**Why** · "Pattern Keeper compatible" and "projector ready" are both self-asserted badges that
designers put in their own Etsy listings, and both measurably move sales. The badge is what makes
a designer bother running the checker at all.
**Proposal** · At the end of a check, offer a small SVG/PNG badge plus a copy-paste listing line
("**Thready-ready** — imports into the free Thready or Not counter app with parts, counts and
placement notes already set up") and a link back to the checker. Tiers, honestly named: **Reads
cleanly** (sections + rows + counts all found, no conflicts), **Reads with notes** (works, some
rows computed), **Companion included** (the PDF carries embedded data — #9 — so nothing is
parsed at all). Self-served, not policed: we grant no certification and audit nobody.
**Effort** S. **Impact** 3.
**Risks** · Legal — a badge that looks like a certification mark implies we verified the product.
Publish badge terms: self-assessment, revocable, no endorsement of the pattern's quality or
correctness, must link to the checker, must not be altered. Keep the wording "reads cleanly",
never "approved" or "certified". Also: someone will badge a file that no longer passes; the terms
should say the badge describes a file, not a shop.

### 8. Parser fixture pact and a versioned guide changelog
**Why** · A designer's reasonable fear about complying with a guide is that the next release
silently breaks her file. The project already has the right machinery — `tmp-pdf/` fixtures with
shape assertions, gitignored and never committed.
**Proposal** · A written pact in the guide: send us your PDF (or just the badge-check result) and
we add it to the regression fixtures; it is never committed, never redistributed, never shown to
anyone, and it is deleted on request. Every parser release runs it. Publish the guide version and
a changelog entry for any rule change, and a "we broke this, here is what to do" note when a
change is unavoidable. Keep `tmp-pdf/SOURCES.md` as the provenance record it already is.
**Effort** S. **Impact** 3.
**Risks** · Holding other people's copyrighted files is a real obligation: they stay off git, off
any backup that leaves the machine, and get a written deletion process. Do not accept files
without an email trail granting the narrow permission.

### 9. Companion data embedded in the designer's own PDF ⭐
**Why** · Every "ship a second file" plan runs into the same wall: an Etsy digital listing caps
at **five files of 20 MB each**
([Etsy help](https://help.etsy.com/hc/en-us/articles/115015628347-How-to-Manage-Your-Digital-Listings)),
buyers on phones cannot reliably open a custom file type, and sewing designers
already ship four variants (A4, Letter, A0, projector) and will not happily add a fifth. The way
around it is to put the data **inside the file the designer already sells**. Verified in this
repo: the vendored pdf.js 3.11 build exposes both `getAttachments()` and `getMetadata()`, so a
JSON payload attached to the PDF is readable today with no new dependency and no format guessing.
**Proposal** · Define a tiny embedded record — `thready.json` as a PDF file attachment (fall back
to a custom Info/XMP key, and as a last resort a `THREADY-DATA` base64 block in 1pt white text on
the last page for tools that cannot attach). Contents: format version, craft, pattern name,
designer, copyright line, pattern version, parts (`name`, `makeCount`, `targetRows`,
`placementNotes`, per-row `{ row, text, count }`), checklist, colour legend, and for cross-stitch
either the OXS or a reference to it. `PdfText.open` already holds the `PDFDocumentProxy` (`doc`) it builds at
`js/pdftext.js:731`, so exposing `attachments()` alongside `textOf` / `renderPage` is a
one-line wrapper over `doc.getAttachments()`. The import
flow checks for the record **first** and, when present, skips parsing entirely and shows
*"This pattern came with its own setup — by <designer>"*. One file. Every shop. Nothing new for
the buyer to open. Works on iOS because the buyer is opening the same PDF she already opens.
**Effort** M. **Impact** 5.
**Risks** · (a) Some PDF tools strip attachments on re-save — hence the layered fallback, and the
checker must report which channel survived. (b) Embedding structured pattern text makes the PDF
*easier* to extract from, which a nervous designer will notice; the honest answer is that a text
PDF is already trivially extractable and the record adds convenience, not exposure. (c) Verify
`getAttachments()` behaviour against real designer-tool output (InDesign, Affinity, Canva,
Word/LibreOffice) before promising it — Canva in particular is likely to strip everything, and a
lot of indie designers use Canva.

### 10. `.thready.json` companion template file + a real import route
**Why** · The fallback for designers whose tools cannot embed anything (Canva) and for shops that
happily take extra files (Payhip, Ravelry, Gumroad). Today there is **no** route for this at all:
`Store.importJSON` requires `version` + `projects[]` and merges templates by id with *imported
wins*, so a designer file shaped like a backup could silently overwrite a buyer's own template.
**Proposal** · A distinct top-level shape that can never be confused with a backup —
`{ "threadyTemplate": 1, "craft": "crochet", "name": …, "designer": …, "copyright": …,
"patternVersion": …, "template": { …normalizeTemplate shape… } }` — plus
`Store.importTemplateFile(text)` which validates the marker, **always assigns a fresh id** (never
overwrites), runs `normalizeTemplate`, and returns the template for a preview sheet: *"Cotton
Bunny, by <designer> — 7 parts, 34 rows, 8 checklist items. Add it?"* Extension `.thready.json`
so iOS and Android both treat it as JSON and the existing `accept="application/json,.json"`
picker already takes it; a **"paste the file contents"** fallback for the iOS case where a buyer
cannot get the file out of Files and into the PWA. Size: a full amigurumi pattern is tens of KB
of text, a rounding error against Etsy's 20 MB per file — so it costs the designer one of her five
slots and nothing else. A `.zip` of PDF + companion is the alternative when the slots are full,
at the cost of asking a phone buyer to unzip.
**Effort** M. **Impact** 5.
**Risks** · Import of a third-party JSON blob is an input-validation surface — validate strictly,
cap lengths, never `eval`, treat every string as untrusted text and render as text nodes. Never
let an imported file overwrite an existing template or project by id. Legal: the file contains
the designer's own text, distributed by the designer, so we are not a party to it — but the
import preview should surface the copyright line so a buyer who got it from a sharing group sees
whose work it is.

### 11. The free online pattern checker (`check.html`) ⭐
**Why** · The one page that makes every other proposal here reachable. It is the designer's
answer to "what does your app do to my file?", the funnel into the badge and the guide, the
delivery vehicle for the counting-error report, and it costs exactly nothing to run because
`pdf.js` and the parser are already on-device. Nothing comparable exists: Pattern Keeper's answer
to designers is a support-ticket whitelist.
**Proposal** · A single static page, no account, no upload, works offline once cached, with a
line at the top in plain English: *your PDF is read in your browser and never leaves this device.*
Drop a PDF → show, in order: (1) the extraction facts (pages, columns untangled, characters, or
"no text layer — this is an image-only PDF"); (2) parts detected, with make-counts, row counts and
target rows; (3) counts found vs computed, and the **conflict report** (#1); (4) placement notes
and checklist items extracted; (5) **lines we could not place**, quoted, which is the most
actionable output on the page; (6) the ✅/❌ guide rules this file breaks, each linking to the
relevant guide heading; (7) a phone-sized preview of what the buyer's counter screen will look
like; (8) the badge and the companion-file download. Same page serves cross-stitch (key + grid
reader + declared-colour check) and sewing (steps, cutting list, seam allowance, sizes).
**Effort** M. **Impact** 5.
**Risks** · Reputational: the checker is the app's public face for designers, so a wrong verdict
is worse than no verdict — it must degrade to "we couldn't read this, here is why" rather than
scoring low. Privacy claim must be literally true: no analytics on the page that could carry a
filename, no error reporting that ships text.

### 12. The Designer Studio — author a companion file without writing JSON
**Why** · #9 and #10 are worthless if producing the file means hand-editing JSON. The designer
needs a five-minute flow.
**Proposal** · Fold it into the checker page (#11): after a check, the parse result is shown as
an **editable** review — fix a section name, correct a make-count, move a row, paste a placement
note, tick the checklist items — then **Download companion file** (`.thready.json`) and/or
**Download the attach-me snippet** with instructions for attaching it to the PDF in Acrobat /
Affinity / LibreOffice. Reuses `importPicker` (which is already exactly this list, with editable
names, make-counts and tick boxes) and `Patterns.splitSections`. Everything client-side.
**Effort** M–L. **Impact** 4.
**Risks** · Scope creep into a full pattern editor. Draw the line hard: it edits *structure*
(names, counts, grouping), never the designer's prose. If it starts editing wording it becomes a
writing tool and inherits an authorship problem.

### 13. Photo tutorial steps that cite the buyer's PDF instead of copying it
**Why** · "Photos inline with the step" is the single most requested thing from a designer's
side — her assembly photos are half the value of the pattern and they are the part a text parser
throws away. But a template that *embeds* photos is both enormous (multi-MB, past what
`localStorage` will take) and the most dangerous possible artefact to have floating around.
**Proposal** · A step/row can carry a **reference**, not an image: `{ pdfPage: 12, crop: [x,y,w,h] }`.
The buyer's own copy of the PDF — which she already dropped in, and whose pages the cross-stitch
module already rasterises into `BlobStore` — supplies the pixels, rendered on demand via
`PdfText.open().renderPage()` and cached under the existing `p:<projectId>:` key convention.
A designer authoring a companion file draws the crop boxes in the Studio. No copyrighted image
is ever inside a shareable file; a companion file without the PDF simply shows no photo.
**Effort** M. **Impact** 4.
**Risks** · Page numbers drift when a designer revises the PDF — tie the reference to the pattern
version (#14) and show "photo unavailable for this edition" rather than a wrong crop. Storage:
rasterised pages are already capped at 40 in cross-stitch; apply the same cap and the existing
"stored on this device only" wording.

### 14. Pattern version + errata re-import that keeps progress
**Why** · Errata are a constant of this business — Closet Core publishes a standing errata page,
and every indie designer has pushed a v1.1 with a corrected count. Today a buyer's only option is
to re-import and lose her place, which she will not do, so she keeps stitching the wrong number
and blames the app.
**Proposal** · `patternVersion` (a plain string) in the companion record and template. When a
buyer imports a file whose name/designer matches an existing project at a lower version, offer
**"Update pattern text, keep my progress"**: replace `patternText` / `placementNotes` per part by
name, leave `row`, `stitch`, `piecesDone`, `history` and the checklist tick state alone, and show
a diff summary — *"Rnd 14 changed: (30) → (32). You are on Rnd 9."* — with a warning when a
changed row is one the buyer has already passed.
**Effort** M. **Impact** 4.
**Risks** · A silent, wrong merge destroys someone's project. Make it explicit, confirmable, and
undoable (`Store.undo` snapshots already cover this if it goes through the normal mutators).
Match on part name only; never reorder or delete a part the new file lacks.

### 15. Buyer-side attribution that is always visible and never stripped
**Why** · The reasonable middle between "no DRM" (correct — indie designers and their buyers both
loathe it, and CSTX-style encrypted formats have gone nowhere) and "we help piracy". The
cross-stitch module already captures `copyrightLines` from the PDF and stores
`design.copyright`; crochet captures nothing equivalent.
**Proposal** · Extract the designer/copyright line on crochet and sewing imports too (the sewing
research already notes the per-page `© Designer Name` footer is the most reliable meta signal),
store it on the project and on any template drafted from it, and render it as a small permanent
footer on the pattern sheet and on any printed output. A companion file (#9/#10) may carry an
optional `licensedTo` string that the designer's shop stamps at download time, the way Payhip
stamps PDFs — displayed, never hidden, never enforced. Plus: no "export pattern text" button, and
the backup export stays what it is (a personal backup) rather than growing a share affordance.
**Effort** S–M. **Impact** 3.
**Risks** · Do not oversell this to designers as anti-piracy; it is attribution and mild social
friction, nothing more. A `licensedTo` field containing a buyer's name is personal data riding in
a file — keep it optional, never transmit it, and say so.

### 16. Tester and tech-editor report, containing no pattern text
**Why** · Every indie designer runs a tester round, and the feedback comes back as a Facebook
comment thread. A tester using the app already has structured evidence: which rows conflicted,
where she stalled, how long each part took, which placement notes she never found.
**Proposal** · An opt-in **"Send the designer a test report"** export: part names, row counts,
time per part, the conflict rows (row numbers and both numbers, **not** the instruction text),
rows the tester flagged with a tap-and-hold note, and free-text comments. Plain text to the
clipboard or a `.txt` share — no server, no account, the tester sends it herself however she
likes. Because it carries numbers and her own words but not the pattern, it is safe to paste
anywhere.
**Effort** M. **Impact** 3.
**Risks** · Low, provided the export genuinely omits pattern text — assert it in a test. Make the
opt-in per-report, not a setting, so a tester never emails a report by accident.

### 17. Designer directory that links out and hosts nothing
**Why** · Designers ask "will you promote me?" and buyers ask "which patterns work well?".
Ribblr's real asset is discovery; ours cannot be, because we host nothing — but a list of shops
whose files come Thready-ready is a fair, cheap trade for the designers who did the work.
**Proposal** · A static, hand-curated JSON in the repo rendered as a page and a Settings entry:
designer name, craft(s), shop URL, badge tier, "companion files included" flag. Opt-in only,
removable on a one-line email, no ranking, no reviews, no affiliate links at launch, no pattern
images or text — just a name and a link. Ordering alphabetical or by date added, never by
anything that looks like a paid placement.
**Effort** M (mostly editorial, and the editorial work never stops). **Impact** 3.
**Risks** · Trademark use of shop names is nominative fair use and fine, but a directory implies
vetting: state plainly that inclusion means a file passed the checker, not that we endorse the
designer or her patterns. Removal must be fast. Once money is involved (sponsorship, affiliate)
this becomes advertising and needs disclosure — keep it out of v1.

### 18. Share target / file handler so a companion file opens straight into the app
**Why** · The weakest link in #10 is the buyer on a phone with a downloaded file and no idea what
to do with it. Android Chrome supports `share_target` with files and Chromium desktop supports
`file_handlers`; the manifest currently declares neither.
**Proposal** · Add `share_target` (POST, `multipart/form-data`, accepting `application/json` and
`application/pdf`) and `file_handlers` to `manifest.webmanifest`, with a `sw.js` fetch handler
that parks the incoming file and routes to the import flow. Document the iOS reality honestly in
the guide: Safari supports neither, so an iPhone buyer opens the app and uses the file picker, or
pastes the file contents — which is exactly why #9 (data inside the PDF she already has) matters
more than #10.
**Effort** M. **Impact** 3.
**Risks** · A `share_target` POST handler is a new entry point into the service worker and the
only place the app accepts data from outside — validate before storing, and make sure a malformed
share cannot wedge the SW or leave junk in the cache. Verify it does not disturb the existing
cache-first strategy.

### 19. Borrow Ribblr's interactivity; refuse its custody
**Why** · Ribblr is the closest competitor and the sharpest contrast. Their own designer page
([ribblr.com/fordesigners](https://ribblr.com/fordesigners)) describes the **ePattern** — "similar
to an eBook", with progress tracking, smart sizing, translation and embedded video — authored in
**Ribbuild**, their in-browser design software, with zero listing or shop fees and a single
per-sale transaction fee. It also says patterns "are not exclusive and always remains yours", and
sells the anti-piracy story as ePatterns that "can't be downloaded or re-shared — only paying
customers ever get access". That last sentence is the whole model in miniature: **their answer to
piracy requires custody of the pattern.** We cannot offer that and should not pretend to. What
designers like: row-by-row interactivity, checkable steps, inline photos, buyers who finish
projects, translation. What they are uneasy about: authoring inside someone else's studio, a
pattern that is only interactive on that platform, discovery controlled by the platform, and a
second storefront to maintain alongside Etsy and Ravelry.
**Proposal** · Make the contrast an explicit product stance, stated on the designer page and
enforced in the spec: (a) borrow — row tracking, checkable assembly steps, inline photos, part
progress, a genuinely good phone experience; (b) refuse — hosting patterns, selling patterns,
taking a cut, a proprietary studio, a platform-only format, any lock-in. The tagline writes
itself: *sell wherever you already sell; the interactive version is a file you own.* Concretely
this means the companion format (#9/#10) is **documented publicly** so another app could read it,
which is the strongest possible signal that the designer is not being captured.
**Effort** S (positioning + one documented format spec). **Impact** 3.
**Risks** · Publishing the format helps competitors. Accept it — the format's value is adoption,
and a proprietary one adopted by nobody is worth less. Do not make comparative claims about
Ribblr's terms or fees on a public page without verifying them first; describe our own stance
instead.

### 20. Designer partnership: a small, slow, hand-run programme
**Why** · Ten designers who genuinely use the checker are worth more than a directory of a
hundred names, and they are the source of the fixtures, the guide's blind spots, and the first
real touch-hardware testing.
**Proposal** · Pick 5–10 designers across the three crafts, offer: early access to the checker
and Studio, their PDFs added as private regression fixtures (#8), a named line in the guide's
credits, first refusal on directory placement, and a direct line for "this file broke". Ask for:
one honest run through the checker, one companion file shipped with a real product, and
permission to keep the fixture. No money either way, no exclusivity, no contract beyond an email.
**Effort** M (ongoing relationship work, which is the owner's time and does not parallelise).
**Impact** 3.
**Risks** · Solo-owner bandwidth is the binding constraint; over-promising support to designers
who then evangelise the app is worse than not starting. Also keep the fixture permission in
writing, narrowly scoped, and honour deletions immediately.

---

## Things the app must never do (designer's red lines)

Collected here because they are as important as the proposals, and cheaper:

1. **Never rewrite, paraphrase, translate or summarise a pattern with an LLM.** It would break the
   no-token-cost rule anyway, but the real reason is that the moment the app produces text a
   designer did not write, it is a derivative work with her name on it and her buyer's trust
   behind it.
2. **Never host a designer's PDF**, or its text, on any server. On-device only.
3. **Never build a public gallery, library or search of imported pattern content** (#4).
4. **Never silently correct a printed count.** Show `≈` for computed, show the conflict, let a
   human decide (#1, #5).
5. **Never commit a fixture.** `tmp-pdf/` stays gitignored; free ≠ redistributable.
6. **Never add an "export pattern as text" or "share this pattern" button.** Backups are personal
   backups.
7. **Never imply certification.** The badge describes a file's readability, not a pattern's
   quality or a designer's standing (#7).

---

## What I would build first

**#1 (conflict report)** — because the logic exists, it takes an afternoon, and it is the one
thing that makes a designer say "wait, do that again with my other pattern".
**#11 (checker page)** — the container everything else plugs into, and the only free,
no-account, nothing-uploaded tool of its kind in any of the three crafts.
**#9 (companion data inside the PDF)** — the structural bet: one file, any shop, iOS included,
zero parsing, and it makes the app useful to a designer's customer without ever taking custody of
the designer's work.
