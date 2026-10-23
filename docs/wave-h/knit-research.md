# knit-research — report (wave H, contract §6)

Owner of `docs/research/knitting.md` (ground truth for every knitting fixture). No code edited;
no files downloaded; nothing copied out of `tmp-pdf/` (text read through `PdfText.extract` on
the dump page and `pdftotext` to stdout; pages rendered in the browser pane for charts and scans).

## What the ground-truth file contains
- §1 Bernat top-down raglan, §2 all 8 Interweave socks, §3 magic-loop socks, §4 all 10 lace-book
  patterns, §5 Rico shawl, §6 Sandnes 0216, §7 APL Nicoll (Plain Socks transcribed from the scan).
- Per pattern: construction, sizes and how they are written, gauge and needles as printed,
  section table with row counts and stitch counts, markers with `at` positions, short rows,
  charts (size, vector/glyph/missing), and a table of verbatim hard lines with the expected
  `row / side / count / delta / markers / until / shortRow / chart`.
- Every printed count was re-derived from the stitch instructions. Pattern errors are flagged
  "PATTERN ERROR — keep as printed".
- A cross-fixture summary and §8 "What the fixtures do not cover" (with candidate URLs and terms).

## Findings that change what other workers assumed
1. **Sandnes 0216 has no instructions.** It is a lookbook. Each model has only an info box
   (yarn, needle, sts per 10 cm, ages); the PDF says instructions are sold with the yarn.
   Model 11 is crochet. Use it only as an "import produces nothing" negative test.
2. **No fixture has a glyph-font chart.** Every chart is vector paths or missing (the Arrowhead
   charts are not in the lace PDF). The Icelandic shawl chart (lace p15) has 2 glyph symbols
   (`#`, `2`) mixed with path symbols. `KnitChart` can only be asserted to return null or partial
   cells on these fixtures.
3. **APL Nicoll is scan-only.** It has no text layer after p2. The book page number equals the
   PDF page number in the sock section.
4. **Pattern errors in the fixtures:**
   - Bernat XL divide vector (258 vs 260).
   - Flying Trapeze toe for 68 sts (36 vs printed 34).
   - Genome cable Rnd 4 is missing `p2` (9 of 11 sts).
   - Spectrum gauge reads `112 sts`.
   - Magic-loop socks has typo'd vectors, and its toe does not divide evenly.

## For the owner of `js/pdftext.js`
- Three-column pages are interleaved line by line: socks p15 and p20, lace p31.
- Socks p4 and p8–9 carry an overlay of duplicate text.
- An advert is injected inside a row on socks p5.
- Sandnes `½` and the p17 age range are missing from the text layer. The `½` is a separate
  glyph, so the extract shows needle "5" for 5½.
- The Albus Argyle chart label `45` is not emitted.

## For the owner of `test/knits.fixtures.html`
Use the hard-line IDs (B1…, S1…, T1…, F1…, O1…, D1…, G1…, A1…, H1…, M1…, SO1…, OR1…, HE1…,
IC1…, SP1…, TS1…, PE1…, LF1…, AR1…, GL1…, R1…) as assertion names.

Lines marked "printed order" sit on pages where the extract interleaves columns: F-lines
(Flying Trapeze), O7–O9 (On-Your-Toes), GL-lines (gloves) and T20. Assert those against the
extract as it is, or skip them until the PdfText fix lands.

## Left / not done
- On-Your-Toes and Genome short-row counts are not printed (the heel works "until …"). A derived
  count is given only for On-Your-Toes, and it is marked as derived.
- Only one Nicoll pattern (Plain Socks) is transcribed.
- DROPS terms could not be verified because garnstudio.com returned 403 to the fetch.
