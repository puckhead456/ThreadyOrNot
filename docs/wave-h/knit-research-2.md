# knit-research-2 — report (wave H, contract §6, batch 2)

I own only the new sections of `docs/research/knitting.md` (§9–§17 and the "Batch 2 summary" at
the end of the file) plus this report. I wrote no code. I downloaded nothing. Nothing from
`tmp-pdf/` was copied into the repo.

- **PDFs**: the text was read through `PdfText.extract` on `test/pdftext.dump.html` in my own
  browser tab. The `?all=1&sink=` route posted the extract and raw text to a scratch listener
  outside the repo. Pages were rendered with `?render=1` and checked by eye against every count
  and every chart.
- **Gutenberg `.txt` books**: read directly from the files.

Sections §1–§8 of the research file were left untouched. The only other line I changed is the
Progress line: I added one new line under it.

## What the file now contains (batch 2)

| § | Fixture | One line |
|---|---|---|
| 9 | `knit-patons-mockneck-cable.pdf` | Flat Aran pullover in 6 sizes `XS/S (M-L-XL-2/3XL-4/5XL)`. Three written+charted panels (A 24×24, B 17×28, C 9×12) using C4F/C4B/C6F/C6B/T3F/T3B/Tw4R/Tw4L. Clean text layer. One error for size M (back neck 48, printed 46). |
| 10 | `knit-patons-boyfriend-cable.pdf` | Flat raglan in 6 sizes, with non-adjacent size conditionals. Panels A 15×22, B 13×4, C 6×6 use T2F/T2B/T3F (a different T3F from the mock neck), Cr4F/Cr4B and C4B. **The extractor drops 3 printed rows.** 4/5XL sleeve leaves 15 sts (printed 11); typo `K0 (0-0-2-2-22)`. |
| 11 | `knit-patons-boxy-cable.pdf` | Front-first flat pullover. Box stitch, then cable+lace panels with C3BK/C3FK/C3BP/C3FP/Cr5B/Cr7B/Cr7F. The chart key is in the text layer. **p4 columns come out in the wrong order.** The sleeve has two arithmetic errors. |
| 12 | `knit-patons-cabled-yoke.pdf` | Middle-out construction: a flat cable band, then a bottom yoke worked down and a top yoke worked up, both in rounds. Uses marked stitches. **Worst text layer**: broken capitals, so size L arrives as `l`, and interleaved columns split the gauge line. Top Yoke prints no counts; all were computed. |
| 13 | `knit-sandnes-raglan-child.pdf` | Top-down raglan in the round with 6 German short rows. Two size groups: children `(2) 4 (6) 8 (10) 12` on p2 and ladies `(S) M (L) XL (XXL)` on p3. Sizes are written as **alternating parentheses**. No row gauge. Every count checks out; there are wording slips. |
| 14 | `knit-pg-57273-…` Cupples | Victorian stockings worked with "intake" tables. I wrote up the infant, 9–12 months, lady's ordinary and gentlemen's socks. "Short rows" here means the instep needles. In the open-work code, `P` means *knit*. Several errors. |
| 15 | `knit-pg-62646-…` Corbould | I wrote up the lady's striped silk stocking, the child's sock, the gentleman's ribbed sock (heel "21" should be 41) and the baby's boot. The boot's rows are numbered in words and the numbering restarts. "N times" means N more. |
| 16 | `knit-pg-26113-…` Handbook | I wrote up the Red Cross service sock (every count checks), the ladies' gloves, the ladies' sweater and the child's mittens. The gloves give **the only stated cable cadence** in all fixtures, "every 6th row"; their row 5 is a pattern error. In the sweater, "ribs" means garter ridges. |
| 17 | `knit-pg-61105-…` Begin to Knit | I wrote up the plain sock (every count checks), the mittens, the yearling sweater, the raglan and Pattern No. 4. In the mittens, ladies' and men's sizes share one vector and were told apart only by bold type. The book has its own abbreviation `K-O`. |

## Things a worker must not get wrong

1. **Sandnes size vectors use alternating parentheses.** `(48) 52 (56) 56 (60) 60` means
   [48,52,56,56,60,60]. The Patons "first value (others)" reading gives wrong numbers here.
2. **Begin to Knit mitten vectors hold 6 values in 2 groups:** `28 (32, 36) 32 (36, 40)`. Inside
   the parentheses, the comma separates sizes, even when the values are instructions:
   `(K 2 tog, K 4)`.
3. **`Turn` is often not a short row.** Patons neck splits, instep splits and Cupples' "short
   rows" (which means needles) all use the word. The only real short-row sections in batch 2
   are the Sandnes back-neck rows (6 short rows).
4. **Panel rows do not equal garment rows.** One row can work 2–3 panels at once. Cabled Yoke
   Panel A repeats rows 3–16. Some `until` lines end on a panel row (`ending on a 24th row of
   Cable Panel C`).
5. **Cable abbreviations are defined per pattern.** T3F means different things in the mock
   neck and in the boyfriend. Take each pattern's glossary first.
6. **Old books.** In Cupples' code `P` means knit. In the Handbook, `ribs` means 2-row ridges.
   "rows" often means rounds. Row labels in words restart. "Repeat N times" means N more or N in
   total depending on the book; only the printed counts decide which.
7. **Report pattern errors as printed.** Every one is listed in the "Batch 2 summary". Never fix
   a count to make the arithmetic work.

## For the owner of `js/pdftext.js`

- **Boyfriend**: three printed lines `2nd row: P2. P2tog. Pat to last 4 sts. P2togtbl. P2.`
  are missing from the extract (p2 col 4, p3 col 3, p4 col 3). The same lines are repeated
  across pages, so I suspect the cross-page/overlay duplicate filter. Only the p2 copy appears
  under "not emitted" on the dump page. The other two are hidden because the same words appear
  elsewhere on their pages.
- **Boxy p4**: column 2 is emitted between the two halves of column 1, so the neckband ribbing
  comes out before the neckband pick-up.
- **Cabled Yoke**:
  - p1 cols 3/4 and p2 cols 2/3 are interleaved line by line. The `GAUGE` sentence is split and
    has `T3B. P3.` glued into it.
  - The display font maps capitals to lowercase: `MaTerIalS`, `l` for size L, `C4b`.
  - The yarn table is cut down to `Sizes XS/S` / `Aran (87602) 6`.

## For the owner of `test/knits.fixtures.html`

- Assert the Cabled Yoke and the Boyfriend blocks against the true text in the research file.
  Mark them "blocked by extractor" until the bugs above are fixed.
- Fixtures for the Gutenberg `.txt` books need the paragraph-joined text. Hard wraps split
  numbers (`1½--inches`).
- `Line.chart` cannot hold the multi-panel rows (§9 note). Decide between a list and the first
  panel.

## Contract notes (no changes made; for the coordinator)

- `Line.cable = {every, name}` has exactly one real-data case (Handbook gloves, every 6th row).
  Every Patons cadence is implicit in the panel rows, and the cadence differs per panel.
- `until.endOn` sometimes names a panel row or "a 4th or 8th row of pat", not RS/WS.
- Size groups can share one vector (Begin to Knit mittens). Wave G size groups only cover
  groups printed on separate pages, which is the Sandnes case.
