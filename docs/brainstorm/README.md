# Brainstorm 2026-09-17 — fourteen lenses, one shortlist

Fourteen Opus agents each used or read the app (cache v20) through one lens and wrote ranked
proposals. Files 01–14 are the raw output (about 290 proposals, 11 confirmed bugs). This page is
the synthesis: what several lenses found independently, and a suggested order. Nothing here is
built yet; the owner picks.

| # | Lens | File | Proposals |
|---|---|---|---|
| 01 | First-time user | 01-first-time-user.md | 19 |
| 02 | Amigurumi power user | 02-amigurumi-power-user.md | 25 |
| 03 | Garment crocheter | 03-garment-crocheter.md | 20 |
| 04 | Cross-stitcher | 04-cross-stitcher.md | 18 |
| 05 | Sewist and quilter | 05-sewist-quilter.md | 18 |
| 06 | PDF import robustness | 06-pdf-import-robustness.md | 23 + fixture wish-list |
| 07 | Accessibility (measured WCAG failures) | 07-accessibility.md | 20 |
| 08 | Product, growth, monetisation | 08-product-growth.md | 23 + Free/Pro table + 90-day roadmap |
| 09 | Engineering health, data safety | 09-engineering-health.md | 23 |
| 10 | Delight and habit | 10-delight-habit.md | 20 |
| 11 | Knitting and next crafts | 11-knitting-next-crafts.md | knitting spec + 11 |
| 12 | Interoperability, data formats | 12-interoperability.md | 20 + `.thready` zip layout |
| 13 | Adversarial bug hunt | 13-bug-hunt.md | 11 bugs (4 data loss) + hardening |
| 14 | Pattern designers | 14-pattern-designers.md | authoring guide + 20 |
| 14a | Market research: Ribblr, platform fees, piracy norms, Pattern Keeper badge, OXS | 14a-pattern-distribution-research.md | supporting facts |

## Found by more than one lens (highest confidence)

1. **Imported parts never get a target row count** (01 #1, 02 #1, 10). Every PDF project has
   `targetRows: null`, so no progress bar, no part-done, no celebration is reachable from an import.
   Related: `allPartsDone` ignores parts without a target, so finishing two ears shelves the whole
   toy (02 #2). Effort S, impact 5. Fix: set `targetRows` from the section's `maxRow` at import.
2. **Saves can fail silently and tabs clobber each other** (13 #1–3, 09 #2–4, 12 #1). A second
   tab overwrites the first tab's work; `QuotaExceededError` is swallowed; one corrupt byte in
   localStorage wipes every project; nothing asks for persistent storage; the backup importer
   throws on any version other than 1 and overwrites same-id projects then clears undo.
   One "data safety" bundle: storage-event reload or last-writer check, visible save failure,
   corrupt-state quarantine + recovery, `navigator.storage.persist()`, tolerant backup versions
   with a written migration policy, import preview.
3. **The parser is most dangerous when confidently wrong, and the detector already exists**
   (06 #1, 14 #1, 01 #7). Every row has an explicit and a computed count; the app discards the
   disagreement. Show a ⚠ badge per row and a confidence line in the import picker; it doubles as
   a free tech-editing tool for designers.
4. **Pick the size once, on the project, at import** (03 #1, 11 #3). Nine-size cardigans import
   with every number unresolved.
5. **Suggested checklist items are broken fragments, all pre-ticked** (01 #3, 02 #11, 03 #8).
   "Stuff head and sew to", "join with sl st in first st". Sentence-complete them or drop them,
   default unticked when truncated.
6. **The ⤢ 3D button sits inside the tap surface** (02 #8, 07 #5/#7/#8, WCAG 1.4.11 fails in two
   themes at 1.81:1 and 2.53:1). Move it out, fix its tab order and contrast in one edit.
7. **Counting is silent to assistive tech and inconsistent across crafts** (07 #1–2, UX-sweep
   leftover). One count event → live region, `aria-valuenow`, optional speech and haptics.
8. **Colour-change lines reach nothing** (02 #3, 10 #1). "CC to main color in last stitch of R12"
   parses as a floating note; the yarn colour never reaches the counter or the 3D piece.
9. **Finished-object share card and session stories** (08 #3, 10 #8–9, 12 #9). Canvas → Web
   Share, data already in history. The cheapest marketing the app can have.
10. **Name collision and stale pitch** (08 #4–5). "Thready Or Not Embroidery" is a live shop and
    "Thready" a live iOS floss app; the manifest, meta description and README still say
    "crochet counter". Owner decision, cheap now, expensive after launch.
11. **Release plumbing** (09 #1, #7, #8). 13 of 30 asset-changing commits shipped without a
    `CACHE_VERSION` bump; no headless test runner; literal control bytes in xstitch.js and
    sewing.js make ripgrep treat them as binary so agent greps silently miss them.
12. **Parser as a craft slot unlocks knitting** (11 #1, #8, #9). `patternsApi()` hard-codes
    `window.Patterns`; knitting can reuse the crochet shell with a ~200-line vocabulary profile.

## Suggested order

**Wave 1 — fix before anyone new sees it (agents, ~2–3 days)**
- Data-safety bundle (theme 2) and the remaining bug-hunt items 4–11 (13).
- `targetRows` from import + `allPartsDone` (theme 1); checklist fragments (5); ⤢ button (6).
- Release plumbing: content-hash `CACHE_VERSION`, control bytes, `.gitattributes` (11).
- Cheap parser wins from 06: phantom rows from bare numbers (#2), UK/post-stitch vocabulary (#3),
  per-page "no text" detection (#4), file-size guard + cancel (#6).

**Wave 2 — make the core feel finished (agents, ~1–2 weeks)**
- Computed ≠ stated badge + import confidence line (3); size-once (4); colour changes to the
  counter (8); one count-announcement policy + name/role/value + root-relative type (7, 07 #5).
- Cross-stitch: rulers + position readout, remember zoom/pan/tool, keep PDF pages when the grid
  reader wins (04 #1–3). Sewing: split a step after import, numeric cutting chips, skip
  "pattern variations" pages (05 #1–3). Garment: de-wrap hyphenated columns, "until N rows"
  repeats, tap the row number to set it (03 #2, #5, #6).
- Share card + session stories + yarn colour as project identity (9, 10 #1).
- `.thready` zip backup with page images and one-project export (12 #4–5; HANDOFF product item).

**Wave 3 — owner decisions and growth**
- Name and registry search, pitch strings, privacy/changelog pages, real-phone day, demo clip
  (08 #1–5, #10). Free/Pro table and 90-day roadmap are in 08.
- Designer checker page + counting-error report + companion data in the PDF (14 #1, #9, #11).
- Knitting module per 11 Part 1 once the parser slot exists.
- Tesseract.js OCR for scanned patterns (06 #22): low ratio, high strategic value, schedule later.

## Things every lens agreed the app should NOT do
Recurring server costs, accounts, a public gallery of copyrighted template text, AI rewriting
or summarising a designer's pattern, gating export/backup behind Pro.
