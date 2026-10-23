# Knitting fixtures — ground truth (wave H)

Owner: `knit-research`. Every other wave-H worker reads this. It is written fixture by fixture;
a fixture whose heading says **(pending)** is not yet verified. Status of the file is in the
"Progress" line below; re-read it when it changes.

**Progress:** §1–§7 done (all seven fixtures); §8 "What the fixtures do not cover" pending.
Batch 2 (`knit-research-2`, appended after §8): §9–§17 done (4 Patons cable PDFs, Sandnes raglan, 4 Gutenberg books) + "Batch 2 summary" at the end of the file.

## How to read this file

- **Source of every quote**: the app's own text layer, i.e. `PdfText.extract` as shown by
  `test/pdftext.dump.html?f=<file>`. Quotes are verbatim except that a line the PDF wraps is
  joined with one space; where the wrap falls *inside a number list* it is shown as `⏎` because
  that is exactly what the parser sees (e.g. `(256-260-⏎272)`).
- **Sizes**: counts are given as the full per-size vector in the pattern's own size order, e.g.
  `36,38,38,40,44,46`. `—` in a vector = that size does not do this line (size-conditional).
- **Hard-line table columns** (contract §2 `Line` fields):
  `row` (number, or list for enumerations, `—` = no row number), `side` (`rs`/`ws`/`null` = in
  the round; "parity" = not printed, derive from neighbours), `count` (stitch total after the
  row; *explicit* = printed, *computed* = arithmetic from the previous row; `null` = must stay
  null, never guess), `delta`, `markers` (`at` = stitch index from row start), `until`,
  `shortRow`, `chart`.
- **Arithmetic**: every printed count below was re-derived from the previous count. Where the
  pattern's own numbers do not add up it is called out as **PATTERN ERROR** — the parser must
  report the printed number as printed and must not "fix" it; a deviation hint is correct.

---

## 1. `knit-bernat-topdown-pullover.pdf` — Bernat "Knit Top Down Pullover" (BRK0129-027155M)

4 pages; p2–3 are two columns (the extractor reads them in order), `garbled false`, 5706
chars. No charts, no images that carry instructions.

**Garment / construction.** Raglan pullover worked in one piece **top-down** from the neck.
Neck shaping is worked **flat in rows** (Rows 1–8, RS/WS), then 16 sts are cast on for the centre
front and the work is **joined in the round**; yoke increases in rounds; divide for sleeves and
body; body in the round; sleeves picked up and worked in the round on DPNs (both sleeves the
same — "SLEEVES" heading, no make-count printed, no two-at-a-time); neckband picked up last.

**Sizes.** 6 sizes, written `XS/S (M-L-XL-2/3XL-4/5XL)` — **hyphen-separated inside the
parentheses**, not commas. Printed: "The instructions are written for XS/S. If changes are
necessary for larger size(s) the instructions will be written XS/S (M-L- XL-2/3XL-4/5XL)."
Size labels contain `/` (`XS/S`, `2/3XL`, `4/5XL`) — the size detector must keep `2/3XL` as one
label, not split on `/`. Size-conditional blocks list only the sizes they apply to:
`Sizes XL, 2/3XL and 4/5XL only:` followed by `(256-260-272)` = 3 values for sizes 4–6 (no
leading XS/S value, parentheses around the whole list). `Sizes L, XL, 2/3XL and 4/5XL only:` →
4 values `(46-52-30-36)` for sizes 3–6. `All sizes:` ends a conditional block.
Chest ranges on p1 (`XS/S 28-34" [71-86.5 cm]`) also use hyphens — they are measurements, not
size vectors.

**Gauge / needles (as printed).**
- `12 sts and 17 rows = 4" [10 cm] in stocking st with larger needle.` (under heading `GAUGE`)
  → `Project.gauge = {sts:12, rows:17, over:4, unit:'in'}` (10 cm also printed), needle = the
  larger = 6 mm / US 10.
- `Sizes U.S. 8 (5 mm) and U.S. 10 (6 mm) Susan Bates® circular knitting needle 24" [61 cm]
  long. Set of 4 sizes U.S. 9 (5.5 mm) and U.S. 10 (6 mm) Susan Bates® double-pointed knitting
  needles or size needed to obtain gauge.` Note "Sizes U.S. 8" is a **needle** line that
  starts with the word "Sizes" — it must not be read as the garment size line. The smaller DPN
  (US 9 / 5.5 mm) is not the same as the smaller circular (US 8 / 5 mm).
- Yarn lines `Sizes XS/S M L` / `Terracotta Rose (32017) 2 2 3 balls` / `Sizes XL 2/3XL 4/5XL` /
  `Terracotta Rose (32017) 3 4 4 balls` are a yarn-quantity table, not instructions and not a
  size line with counts.

**Abbreviations block** (p2, two columns interleaved by the extractor — `Alt = Alternate P =
Purl` arrives as one line): Alt, Beg, Cont, Inc, K, K1tbl, K2tog, M1, P, Pat, PM, Rep, Rnd(s),
RS, SM, Ssk, St(s), WS. Format `ABBR = Meaning`; multi-line meanings (`K1tbl = Knit next stitch`
/ `through back loop`). `Knits.glossary` should mark these `fromPattern:true`.

**Notation traps.** Row labels are ordinals: `1st row:`, `2nd and alt rows:`, `3rd row:`,
`8th row:`, `1st rnd:`, `2nd rnd:`. Side is written **after** the colon with a period:
`1st row:(RS).` (no space) and `8th row: (WS).`. Sentences are separated by periods, not commas
(`K1. PM. K2. PM.`). Repeats use `*` … `**` with `Rep from * to ** once more` and
`Rep from * twice more, then from * to ** once` (the `*…**` part is worked 4 times in total,
the "Knit to next marker" after `**` only 3 times). Numbering restarts: Rows 1–8 flat, then
`1st rnd` again. Inline part headers with a colon: `Divide for Sleeves and Body: Next rnd: …`,
`Neckband: With RS facing …`. Headers on their own line: `INSTRUCTIONS`, `BODY`, `SLEEVES`.
"Cast off" (not "bind off") ends Body, Sleeves and Neckband — it must not become a part header.

### Sections (Bernat)

| Section | Rows/rounds | Stitch counts (XS/S, M, L, XL, 2/3XL, 4/5XL) |
|---|---|---|
| Neck (flat) | CO, then Rows 1–8. RS = odd, WS = even. Inc rows 3, 5, 7 (+8 each). Row 8 (WS) casts on 16 (18-18-20-20-22) for centre front and joins | CO 36,38,38,40,44,46 → R1 same → R3 44,46,46,48,52,54 → R5 52,54,54,56,60,62 → R7 60,62,62,64,68,70 → R8 76,80,80,84,88,92 |
| Yoke (rounds) | Rnd 1 knit, Rnd 2 +8; "Rep last 2 rnds … 15 (16-19-20-20-21) times more" → 32,34,40,42,42,44 rnds | Rnd 2: 84,88,88,92,96,100 → after reps 204,216,240,252,256,268 |
| Yoke, XL / 2-3XL / 4-5XL only | 1st rnd knit, 2nd rnd +4 (body only), rep (1-6-10) more → 4, 14, 22 more rnds | 2nd rnd —,—,—,256,260,272 → —,—,—,260,284,312 |
| Yoke, all sizes | work even until 8½ (9-10-11-12-13)" [21.5 (23-25.5-28-30.5-33) cm] from front neck | 204,216,240,260,284,312 |
| Divide | 1 rnd: each sleeve's sts to scrap yarn, CO 2 at each underarm, new BOR marker | 120,128,140,156,176,200 |
| Body | even until 12 (12-12-13-13-13)" [30.5 (30.5-30.5-33-33-33) cm] from divide; then K1tbl, P1 rib for a further 2" [5 cm]; cast off | 120,128,140,156,176,200 throughout |
| Sleeves (each) | slip sleeve sts + pick up 2; even until 3 (3-2½-2½-1-1)"; dec rnd (−2) + 5 (5-5-5-3-3) even, "Rep last 6 (6-6-6-4-4) rnds 8 (8-2-0-12-10) times more" → 54,54,18,6,52,44 rnds; L+ only: dec rnd + (3-3-1-1) even, rep (4-4-2-2) rnds (8-11-0-3) more → —,—,36,48,2,8 rnds; rib 2" [5 cm]; cast off | 46,48,54,56,58,60 → 44,46,52,54,56,58 → 28,30,48,54,32,38 → L+: —,—,46,52,30,36 → —,—,30,30,30,30 |
| Neckband | pick up 36 (38-38-40-44-46) + 8 + 16 (18-18-20-20-22) + 8, PM, join; rib Rnd 1 + "6 times more" = **7 rnds**; cast off | 68,72,72,76,80,84 |

**Markers.** Row 1 places **8 markers**, no BOR marker. Segments (XS/S):
`1 | 2 | 4 | 2 | 18 | 2 | 4 | 2 | 1` = front-left | raglan | left sleeve | raglan | back |
raglan | right sleeve | raglan | front-right. `at` per size:
XS/S `1,3,7,9,27,29,33,35`; M `1,3,7,9,29,31,35,37`; L same as M; XL `1,3,7,9,31,33,37,39`;
2/3XL `1,3,9,11,33,35,41,43`; 4/5XL `1,3,9,11,35,37,43,45`. Each inc row adds 1 st on the
outside of each 2-st raglan "seam" (front, sleeve, sleeve, back, back, sleeve, sleeve, front) —
after Row 3 (XS/S): `2 | 2 | 6 | 2 | 20 | 2 | 6 | 2 | 2` = 44. The XL+ extra rounds increase
the **body only** (front and back beside each raglan → +4). After the join the round no longer
starts at the front-left edge (BOR is not marked until the divide; Rnd 2 starts "Knit to next
marker"). At the divide the raglan markers are removed ("Remove marker", "(removing marker)")
and the only marker after it is the new BOR "between last 2 cast on sts" (underarm). Sleeves:
one marker (BOR) "between last 2 picked up sts". Neckband: one BOR marker.

**Short rows:** none. **Charts:** none. **Cables:** none. **Two-at-a-time:** no.

**PATTERN ERROR (keep as printed).** Divide round, size XL: "Slip next 44 (46-52-**54**-56-58)"
then "Slip next 44 (46-52-**52**-56-58)" — with K76 ×2 this gives 76+76+54+52 = 258 sts, but
the yoke total is 260 and the printed result is 156 (= 76+76+4). The second sleeve should be 54
(the Sleeves section slips 54 for XL). Every other size adds up.

Stray text: `until work from front neck measures 8½ (9-10-11-12-13)" [21.5 (23-25.5-28-30.5-33)
cm] sts.` — the trailing `sts.` is printed; it must not produce a count.

### Hard lines (Bernat)

| # | Line (verbatim, wraps joined) | row | side | count | delta | markers | until | shortRow | notes |
|---|---|---|---|---|---|---|---|---|---|
| B1 | `With larger circular needle, cast on 36 (38-38-40-44-46) sts.` | — (CO) | — | 36,38,38,40,44,46 | — | — | — | no | Cast-on line (`co` 36). In-segment sizes with hyphens. Not a part header. |
| B2 | `1st row:(RS). K1. PM. K2. PM. K4 (4-4-4-6-6). PM. K2. PM. K18 (20-20-22-22-24). PM. K2. PM. K4 (4-4-4-6-6). PM. K2. PM. K1.` | 1 | rs | computed 36,38,38,40,44,46 (no printed total) | 0 | 8 markers (above) | — | no | `PM` = zero-st token; in-segment sizes `K4 (4-4-4-6-6)`. |
| B3 | `2nd and alt rows: Purl.` | 2, 4, 6 (8 is given separately) | ws | = prev | 0 | — | — | no | "alt rows" = every even row of the flat section. |
| B4 | `3rd row: K1. *M1. SM. K2. SM. M1. K4 (4-4-4-6-6). M1. SM. K2. SM. M1.** Knit to next marker. Rep from * to ** once more. K1. 44 (46-46-48-52-54) sts.` | 3 | rs (parity) | explicit 44,46,46,48,52,54 | +8 | sm | — | no | `*…**` twice; "Knit to next marker" is marker-relative but the total is still prev+8. |
| B5 | `5th row: Knit to first marker. *M1. SM. K2. SM. M1. Knit to next marker. M1. SM. K2. SM. M1.** Knit to next marker. Rep from * to ** once more. Knit to end of row. 52 (54-54-56-60-62) sts.` | 5 | rs (parity) | explicit 52,54,54,56,60,62 | +8 | sm | — | no | |
| B6 | `7th row: As 5th row. 60 (62-62-64-68-70) sts.` | 7 | rs (parity) | explicit 60,62,62,64,68,70 | +8 | — | — | no | "As 5th row" = copy of row 5. |
| B7 | `8th row: (WS). Cast on 16 (18-18-20-20-22) st (center front). Join to beg working in rnds. 76 (80-80-84-88-92) sts.` | 8 | ws | explicit 76,80,80,84,88,92 | +16,18,18,20,20,22 | — | — | no | Flat → in the round after this row. Singular `st`. |
| B8 | `1st rnd: Knit.` | 1 (restart) | null | = prev | 0 | — | — | no | Numbering restarts in rounds. |
| B9 | `2nd rnd: Knit to next marker. *M1. SM. K2. SM. M1.** Knit to next marker. Rep from * twice more, then from * to ** once. Knit to end of rnd. 84 (88-88-92-96-100) sts.` | 2 | null | explicit 84,88,88,92,96,100 | +8 | — | — | no | `*…**` worked 4×. |
| B10 | `Rep last 2 rnds, inc 8 sts every other rnd 15 (16-19-20-20-21) times more. 204 (216-240-252-256-268) sts.` | — (repeat) | null | explicit 204,216,240,252,256,268 | +8 per 2 rnds | — | — | no | `kind:'repeat'`, rnds 1–2, times 15,16,19,20,20,21. |
| B11 | `Sizes XL, 2/3XL and 4/5XL only: 1st rnd: Knit.` | 1 | null | = prev | 0 | — | — | no | Size-conditional (sizes 4–6); dropped for XS/S, M, L. |
| B12 | `2nd rnd: (Knit to next marker. M1. SM. K2. SM. Knit to next marker. SM. K2. SM. M1) twice. Knit to end of rnd. (256-260-⏎272) sts.` | 2 | null | explicit —,—,—,256,260,272 | +4 | — | — | no | Parenthesised group × `twice`; count list = 3 values for the last 3 sizes, wraps mid-list. |
| B13 | `Rep last 2 rnds, inc 4 sts every other rnd (1-6-10) time(s) more. (260-284-312) sts.` | — (repeat) | null | explicit —,—,—,260,284,312 | +4 per 2 rnds | — | — | no | `time(s)`. |
| B14 | `All sizes: Cont even in rnds on 204 (216-240-260-284-312) sts until work from front neck measures 8½ (9-10-11-12-13)" [21.5 (23-25.5-28-30.5-33) cm] sts.` | — | null | 204,216,240,260,284,312 ("on … sts") | 0 | — | `{kind:'length', value:8.5/9/10/11/12/13, unit:'in'}` (cm alt 21.5…33) | no | Must NOT become a targetRows suggestion. Ends the conditional block. |
| B15 | `Divide for Sleeves and Body: Next rnd: Knit to next marker. Remove marker. K1. Slip next 44 (46-52-54-56-58) sts onto scrap yarn (removing marker). Cast on 2 sts. K58 (62-68-76-⏎86-98). Slip next 44 (46-52-52-56-58) sts onto scrap yarn (removing marker). Cast on 2 sts. K58 (62-68-76-86-98). PM between last 2 cast on sts for beg of rnd. 120 (128-140-⏎156-176-200) sts` | next | null | explicit 120,128,140,156,176,200 (no final period) | −84,−88,−100,−104,−108,−112 | rm; new BOR | — | no | Inline part header. XL vector error above. "Slip … onto scrap yarn" = held, not decreased. |
| B16 | `Knit even in rnds on these 120 (128-140-156-176-200) sts until Body from Sleeve divide measures 12 (12-12-13-13-13)" [30.5 (30.5-30.5-33-33-33) cm].` | — | null | 120… | 0 | — | length 12,12,12,13,13,13 in | no | Under `BODY`. |
| B17 | `Next rnd: *K1tbl. P1. Rep from * around.` | next | null | = prev | 0 | — | — | no | `Rep from * around` = to end. |
| B18 | `Rep last rnd (K1tbl. P1) ribbing for a further 2" [5 cm]. Cast off loosely in pat.` | — | null | prev | 0 | — | length 2 in (5 cm), *relative* ("a further") | no | Then `bo` all. |
| B19 | `Slip 44 (46-52-54-56-58) sts from scrap yarn onto larger double-pointed needles. Pick up and knit 2 sts along armhole divide. PM between last 2 picked up sts. Divide sts among 3 needles to beg working in rnds. 46 (48-54-56-58-60) sts.` | — (setup) | null | explicit 46,48,54,56,58,60 | — | BOR | — | no | Under `SLEEVES`. |
| B20 | `Knit even in rnds until work from sleeve divide measures 3 (3-2½-2½-1-1)" [7.5 (7.5-6.5-6.5-2.5-2.5) cm].` | — | null | prev | 0 | — | length 3,3,2.5,2.5,1,1 in | no | `2½` inside a hyphen list. |
| B21 | `Next rnd: K2tog. Knit to last 2 sts. ssk. 44 (46-52-54-⏎56-58) sts.` | next | null | explicit 44,46,52,54,56,58 | −2 | — | — | no | |
| B22 | `Knit 5 (5-5-5-3-3) rnds even.` | 5,5,5,5,3,3 rnds | null | prev | 0 | — | `{kind:'rows', value:5…}` | no | |
| B23 | `Rep last 6 (6-6-6-4-4) rnds 8 (8-2-0-12-10) times more. 28 (30-48-54-32-38) sts.` | — (repeat) | null | explicit 28,30,48,54,32,38 | −2 per block | — | — | no | Block length AND times are size vectors; times may be **0**. |
| B24 | `Sizes L, XL, 2/3XL and 4/5XL only: Next rnd: K2tog. Knit to last 2 sts. ssk. (46-52-30-36) sts.` | next | null | explicit —,—,46,52,30,36 | −2 | — | — | no | 4-value list for sizes 3–6. |
| B25 | `Knit (3-3-1-1) rnd(s) even.` | 3,3,1,1 | null | prev | 0 | — | rows | no | Bare parenthesised vector, no leading value. |
| B26 | `Rep last (4-4-2-2) rnds (8-11-0-3) times more. 30 sts.` | — (repeat) | null | explicit 30 | −2 per block | — | — | no | |
| B27 | `All sizes: Next rnd: *K1tbl. P1. Rep from * around.` | next | null | prev (28,30,30,30,30,30) | 0 | — | — | no | XS/S has 28 sts here. |
| B28 | `Rep last rnd of (K1tbl. P1) ribbing until ribbing measures 2" [5 cm].` | — | null | prev | 0 | — | length 2 in | no | Then `Cast off in pat.` |
| B29 | `Neckband: With RS facing and smaller circular needle, pick up and knit 36 (38-38-40-44-46) sts along back neck edge. Pick up and knit 8 sts down left front neck edge. Pick up and knit 16 (18-18-20-20-22) sts along front neck edge. Pick up and knit 8 sts up right front neck edge. PM. Join to beg working in rnds. 68 (72-72-76-80-84) sts.` | — (setup) | null | explicit 68,72,72,76,80,84 | — | BOR | — | no | Inline part header. "With RS facing" is not a row side tag. |
| B30 | `Rep last rnd (K1tbl. P1) ribbing 6 times more. Cast off in pat.` | — (repeat rnd 1 ×6) | null | prev | 0 | — | — | no | Neckband = 7 rounds. |

---

## 2. `knit-interweave-8-socks.pdf` — "Knitting Socks with Knitting Daily: 8 Free Sock Knitting Patterns"

34 pages, `garbled false`, 64256 chars. Contents (printed page = PDF page): Time Traveler p3,
Speed Bump p10, Flying Trapeze p14, On-Your-Toes p18, Border p21, Genome p24, Albus Argyle p27,
Stranded Boot Stockings p32. Each pattern starts with a full-page photo page carrying only the
title, designer and "Originally published in …".

**Text-layer warning for the whole book.** Some pages carry the same text **twice** (an overlay
layer offset from the body), so the extract interleaves duplicate lines (p4: every materials
line appears twice). p8–9 repeat glossary and Leg text from p6 word for word. A parser must
not double-count rows from duplicated text; fixture assertions should key on the first
occurrence.

**Charts in this book are vector drawings.** On chart pages the only text items are row numbers
(monospace font), the key words (`knit`, `yo`, `k2tog`, `ssk`), captions (`Foot`,
`Leg, size 7"`) and widths (`32 sts`, `51 sts` — sometimes not emitted by the extractor,
sometimes rotated). The chart cells are thousands of path operations and **no glyphs** —
`KnitChart` must return `null` cells for these charts (image-only for our purposes).

### 2b. Speed Bump Socks (Deb Barnhill) — PDF p10–13

**Garment / construction.** Top-down (cuff-down) sock in the round, **heel flap + short-row heel
turn + picked-up gussets**, wedge toe, Kitchener. Needles: Magic Loop, 2 circulars or DPNs (no
two-at-a-time instruction). Stripes come from self-striping yarn; the "speed bumps" (St st vs
k1, p1 rib) switch by colour, not by row number — **Leg and Foot have no numbered rounds**, only
length targets.

**Sizes.** 3, by foot circumference: `About 6 (7¼, 7¾)" (15 [18.5, 19.5] cm) foot
circumference` — comma-separated in parentheses, metric in `[ ]` inside `( )`.

**Gauge / needles (as printed).** `GauGe 34 sts and 48 rnds = 4" (10 cm) in St st.` The text
layer is small caps folded oddly: `GauGe`, `needLes`, `notIons`, `FInIshed sIze`, `fOOT`,
`fINISHING` — heading matching must be case-insensitive. `needLes Size 1 (2.25 mm): 32" (80 cm)
circular (cir) for Magic Loop, two 20-24" (50–60 cm) cir for 2-cir method, or set of 4 or 5
double-pointed (dpn).` Notions `2 markers (m)`.

| Section | Rows/rounds | Stitch counts (S, M, L) |
|---|---|---|
| Cuff | CO, k1 p1 rib for about 1½ (1½, 2)" (3.8 [3.8, 5] cm) | 56, 64, 72 |
| Leg | speed-bump patt until 5¾ (6½, 8½)" (14.5 [16.5, 21.5] cm) from CO, + 1 rnd | 56, 64, 72 |
| Heel flap (flat) | Rows 1 (RS) & 2 (WS), "Rep last 2 rows 15 (17, 19) more times" → **32, 36, 40 rows** | 28, 32, 36 on the flap (other 28, 32, 36 held for instep) |
| Turn heel (short rows) | Short-rows 1–4, "Rep last 2 short-rows 3 (4, 5) more times" → **10, 12, 14 short rows**, −1 each | SR1 27,31,35; SR2 26,30,34; … → **18, 20, 22** heel sts |
| Gusset pick-up | 1 + 16 (18, 20) + k18 (20, 22) + 16 (18, 20) + 1 | 80, 90, 100 (28, 32, 36 instep + 52, 58, 64 sole) |
| Gusset dec | Rnd 1 (−2), Rnd 2 even; "Rep last 2 rnds 11 (12, 13) more times" → **24, 26, 28 rnds** | 56, 64, 72 |
| Foot | until 5½ (6½, 7¾)" (14 [16.5, 19.5] cm) from back of heel, + 1 rnd solid | 56, 64, 72 |
| Toe | Rnd 1 (−4), Rnd 2 knit; "Rep last 2 rnds 7 (8, 10) more times, then work Rnd 1 once more" → **17, 19, 23 rnds** (9, 10, 12 dec rnds) | 20, 24, 24 (10, 12, 12 each instep/sole) |

**Markers.** "Place marker (pm) to indicate end of instep" (round starts at the instep, so
`at` = 28/32/36) and "Pm and rejoin" = BOR at the end of the sole. Toe uses the same two
(`*K1, ssk, knit to 3 sts before m, k2tog, k1; rep from * once more`).

**Short rows.** Turn Heel: 10 (12, 14) short rows ending `turn` / `turn work` (no w&t),
alternating RS/WS, each −1. Gap-relative rows ("knit to 1 st before gap") have no countable
total on their own — the count is only known from the stated end total 18 (20, 22).

### Hard lines (Speed Bump)

| # | Line (verbatim) | row | side | count | delta | markers | until | shortRow |
|---|---|---|---|---|---|---|---|---|
| S1 | `At beg of a ragg stripe, CO 56 (64, 72) sts.` | — (CO) | — | 56, 64, 72 | — | — | — | no |
| S2 | `Work in k1, p1 rib for about 1½ (1½, 2)" (3.8 [3.8, 5] cm), or desired cuff length, ending after completing a ragg stripe.` | — | null | prev | 0 | — | length 1.5,1.5,2 in | no |
| S3 | `Place last 28 (32, 36) sts worked onto holder for top of foot. Heel flap will be worked back and forth over rem 28 (32, 36) sts.` | — | — | 28, 32, 36 on the needle | held, not decreased | — | — | no |
| S4 | `Row 1: (RS) *Sl 1 purlwise (pwise) with yarn in back (wyb), k1; rep from * to end.` | 1 | rs | = prev (28…) | 0 | — | — | no |
| S5 | `Row 2: (WS) Sl 1 pwise with yarn in front (wyf), purl to end.` | 2 | ws | = prev | 0 | — | — | no |
| S6 | `Rep last 2 rows 15 (17, 19) more times—heel flap measures about 1¾ (2, 2¼)" (4.5 [5, 5.5] cm).` | repeat rows 1–2 | — | prev | 0 | — | none (length is a result, not a target) | no |
| S7 | `Short-row 1: (RS) Sl 1 pwise wyb, k16 (18, 20), ssk, k1, turn work.` | short row 1 | rs | 27,31,35 if computed (−1); no printed total | −1 | — | — | **yes** |
| S8 | `Short-row 2: (WS) Sl 1 pwise wyf, p7, p2tog, p1, turn.` | short row 2 | ws | −1 | −1 | — | — | yes |
| S9 | `Short-row 3: (RS) Sl 1 pwise wyb, knit to 1 st before gap formed by previous row, ssk (1 st each side of gap), k1, turn.` | short row 3 | rs | **null** (gap-relative) | −1 | — | — | yes |
| S10 | `Short-row 4: (WS) Sl 1 pwise wyf, purl to 1 st before gap formed by previous row, p2tog (1 st each side of gap), p1, turn.` | short row 4 | ws | **null** | −1 | — | — | yes |
| S11 | `Rep last 2 short-rows 3 (4, 5) more times, ending with a WS row—18 (20, 22) heel sts rem.` | repeat SR 3–4 | ends ws | explicit 18, 20, 22 | — | — | — | yes |
| S12 | `With working yarn and RS facing, pick up and knit (see Glossary) 1 st between heel flap and leg, then 16 (18, 20) sts along edge of heel flap, k18 (20, 22) heel flap sts, pick up and knit 16 (18, 20) sts along edge of heel flap, then 1 st between heel flap and leg—80 (90, 100) sts total; 28 (32, 36) sts for instep and 52 (58, 64) sts for sole.` | — (setup) | null | explicit 80, 90, 100 | — | end-of-instep m + BOR | — | no |
| S13 | `Rnd 1: (dec rnd) Work in speed bumps patt for gussets and foot (see Stitch Guide) to m, ssk, knit to last 2 sts, k2tog—2 sts dec'd.` | 1 | null | prev − 2 | **−2** | sm | — | no |
| S14 | `Rnd 2: Work in speed bumps patt for gussets and foot to m, knit to end of rnd.` | 2 | null | prev | 0 | — | — | no |
| S15 | `Rep last 2 rnds 11 (12, 13) more times—56 (64, 72) sts rem; 28 (32, 36) sts each for instep and sole.` | repeat 1–2 | null | explicit 56, 64, 72 | — | — | — | no |
| S16 | `Cont in patt as established until foot measures about 5½ (6½, 7¾)" (14 [16.5, 19.5] cm) from back of heel, or 1½ (1½, 2)" (3.8 [3.8, 5] cm) less than desired finished length, ending at the end a ragg stripe, then working a full rnd in the next solid stripe.` | — | null | prev | 0 | — | length 5.5,6.5,7.75 in | no |
| S17 | `Rnd 1: (dec rnd) *K1, ssk, knit to 3 sts before m, k2tog, k1; rep from * once more—4 sts dec'd.` | 1 (TOE) | null | prev − 4 | **−4** | m-relative | — | no |
| S18 | `Rep last 2 rnds 7 (8, 10) more times, then work Rnd 1 once more—20 (24, 24) sts rem; 10 (12, 12) sts each for instep and sole.` | repeat + 1 extra Rnd 1 | null | explicit 20, 24, 24 | — | — | — | no |

Section headers (verbatim in the text layer): `Cuff`, `LEG`, `HEEL`, `Heel flap`, `Turn Heel`,
`Shape Gussets`, `fOOT`, `TOE`, `fINISHING`; also `stitch guide`, `notes`, `glossary`, which
are not parts. "Speed Bumps for Leg" / "Speed Bumps for Gussets and Foot" are stitch-guide
definitions, not parts. `Rnd 1: (dec rnd)` — the parenthesis after the colon is a label, not a
side tag and not a size list.

### 2a. Time Traveler Socks (Jennifer Raymond) — PDF p3–9

**Garment / construction.** **Toe-up** sock in the round: Turkish cast-on, increase toe, lace
foot from a chart, **gusset increases on the sole, short-row heel turn with wraps (w&t), then a
"heel flap" worked back and forth that eats the gusset sts**, lace leg from a chart (one chart
per size), folded picot-eyelet cuff whipstitched down (no bind-off). No two-at-a-time.

**Sizes.** 3: `FINISHED SIZE 7 (8½, 9½)" (18 [21.5, 24] cm) foot circumference and 8½ (9¾,
10¾)" (21.5 [25, 27.5] cm) long`. Size-conditional: `Size 7" (18 cm) only:` then `All sizes:`
(sizes are named by their measurement, not a letter).

**Gauge / needles.** `GAUGE 32 sts and 46 rnds = 4" (10 cm) in St st.` `NEEDLES U.S. size 0
(2 mm).` Text-layer: p4 (materials) is printed twice by an overlay layer, so every materials /
gauge line appears **twice** in the extract; p8–9 repeat p5–6 glossary + Leg text.

| Section | Rows/rounds | Stitch counts (7", 8½", 9½") |
|---|---|---|
| Toe | Turkish CO; set-up rnd places 4 markers; Inc rnd (+4) then "every other rnd 7 (9, 10) more times" → 16, 20, 22 rnds after the set-up rnd | CO 24, 28, 32 → 56, 68, 76 (28, 34, 38 each sole/instep) |
| Re-centre | size 7" only: BOR moved back 2 sts; all sizes 1 rnd re-marking instep | 56, 68, 76 = 32, 34, 38 instep + 24, 34, 38 sole |
| Foot | Foot chart (32 sts × 12 rnds) over the instep, centred with k0 (1, 3) each side; until 6½ (7¼, 8)" from tip of toe | 56, 68, 76 |
| Gusset (in the round) | inc rnd (+2 sole) + even rnd; "Rep last 2 rnds 4 (5, 6) more times" → 10, 12, 14 rnds | 66, 80, 90 (sole 34, 46, 52) |
| Turn heel (short rows, w&t) | Short-rows 1–4 + "Rep last 2 short-rows 5 (6, 7) more times" → **14, 16, 18 short rows** | unchanged (wraps only); result "4 (4, 6) unwrapped sts in center; 7 (8, 9) wrapped sts each side" |
| Heel flap (back and forth over the sole, each row ends `turn`) | Rows 1–4 + "Rep last 2 rows 6 (7, 6) more times" → **16, 18, 16 rows**, −1 per row | 50, 62, 74 (sole 18, 28, 36) |
| Leg | 1 rnd +1 (sole M1) → 51, 63, 75; even through Row 11 of Foot chart; BOR moved; Leg chart for your size Rows 1–12 **5 times** = 60 rnds (Rows 6 and 10 move the BOR) | 51, 63, 75 |
| Cuff | Knit 8 rnds; eyelet rnd (+1); knit 7 rnds; fold and whipstitch | 52, 64, 76 |

**Markers.** BOR + 4 toe markers. Set-up rnd `*K1, pm, k10 (12, 14), pm, k1; rep from * once
more` → at 1, 11, 13, 23 (24 sts) / 1, 13, 15, 27 / 1, 15, 17, 31. After the toe the two instep
markers are removed and an end-of-instep marker placed; the 2 remaining "sole m" bound the
gusset increases and are removed on the last gusset rnd. Heel flap Rows 1–2 each `pm` →
2 heel markers delimiting the centre 16 (18, 22) sts (`sl m, k16 (18, 22), sl m`), removed after
the flap. Leg: BOR is moved three times (before the chart, and on chart Rows 6 and 10 of every
repeat) — these are `*` rows on the chart, "Work as given in directions".

**Charts (vector, no glyphs).** `Foot` 32 sts × 12 rnds (odd rows labelled 1–11 at right, even
rows plain knit), p6. `Leg, size 7"` 51 sts × 12 rnds (p6), `Leg, size 8½"` 63 sts and
`Leg, size 9½"` 75 sts (p7, width labels emitted rotated / not at all). Key: knit, yo, k2tog,
ssk. Rows 6 and 10 of the leg charts carry `*` = "Work as given in directions". No written-out
version. In-the-round: every row read right to left.

| # | Line (verbatim) | row | side | count | delta | markers | until | shortRow | chart |
|---|---|---|---|---|---|---|---|---|---|
| T1 | `Using the Turkish method (see Glossary), CO 24 (28, 32) sts—12 (14, 16) sts on each needle. Place marker (pm) and join in the rnd.` | — (CO) | null | 24, 28, 32 | — | BOR | — | no | — |
| T2 | `Next rnd *K1, pm, k10 (12, 14), pm, k1; rep from * once more.` | next | null | computed = prev | 0 | 4 (above) | — | no | — |
| T3 | `Inc rnd *Knit to m, M1 (see Glossary), sl m, knit to m, sl m, M1; rep from * once more, knit to end—4 sts inc'd.` | next | null | prev + 4 | **+4** | sm | — | no | — |
| T4 | `Cont in St st, rep Inc rnd every other rnd 7 (9, 10) more times—56 (68, 76) sts: 28 (34, 38) sts each for sole and instep.` | repeat | null | explicit 56, 68, 76 | +4 per 2 rnds | — | — | no | — |
| T5 | `Size 7" (18 cm) only: Remove beg-of-rnd m, unknit 2 sts, pm for new beg of rnd.` | — | null | prev | 0 | BOR moved −2 | — | no | size-conditional (size 1) |
| T6 | `Next rnd K11 (11, 12), remove m, k10 (12, 14), remove m, k11 (11, 12), pm for end of instep, knit to end—32 (34, 38) instep sts, 24 (34, 38) sole sts.` | next | null | 56, 68, 76 (split printed) | 0 | rm ×2, pm | — | no | — |
| T7 | `Next rnd K0 (1, 3), work Row 1 of Foot chart over 32 sts, k0 (1, 3), sl m, knit to end.` | next | null | prev | 0 | — | — | no | `{name:'Foot', row:1}` |
| T8 | `Cont in patt until piece measures 6½ (7¼, 8)" (16.5 [18.5, 20.5] cm) from tip of toe, or 2 (2½, 2¾)" (5 [6.5, 7] cm) less than desired foot length.` | — | null | prev | 0 | — | length 6.5, 7.25, 8 in | no | chart continues |
| T9 | `Next rnd Work in patt to m, sl m, knit to m, M1, sl m, knit to m, sl m, M1, knit to end—2 sole sts inc'd.` | next | null | prev + 2 | +2 | — | — | no | — |
| T10 | `Rep last 2 rnds 4 (5, 6) more times, removing 2 sole m on last rnd—66 (80, 90) sts: 32 (34, 38) instep sts, 34 (46, 52) sole sts.` | repeat | null | explicit 66, 80, 90 | — | rm ×2 | — | no | — |
| T11 | `Short-row 1 (RS) K25 (32, 37), wrap next st, turn.` | short row 1 | rs | null on the row (total unchanged) | 0 | — | — | **yes** (wrap + turn) | — |
| T12 | `Short-row 2 (WS) P16 (18, 22), wrap next st, turn.` | short row 2 | ws | unchanged | 0 | — | — | yes | — |
| T13 | `Short-row 3 Knit to 1 st before wrapped st, wrap next st, turn.` | short row 3 | rs (parity) | unchanged | 0 | — | — | yes | — |
| T14 | `Rep last 2 short-rows 5 (6, 7) more times—4 (4, 6) unwrapped sts in center; 7 (8, 9) wrapped sts each side.` | repeat SR 3–4 | — | unchanged | 0 | — | — | yes | — |
| T15 | `Row 1 (RS) Knit to wrapped st, [work wrap tog with wrapped st] 6 (7, 8) times, pm, insert right needle into wrap then kwise into wrapped st and sl both to right needle, sl next st kwise, work wrap and 2 sl sts tog as for sssk (see Glossary), turn—1 heel st dec'd.` | 1 | rs | prev − 1 | −1 | pm | — | contains `turn` | — |
| T16 | `Row 3 Sl 1 kwise with yarn in back (wyb), sl m, k16 (18, 22), sl m, ssk, turn—1 st dec'd.` | 3 | rs (parity) | prev − 1 | −1 | sm ×2 | — | contains `turn` | — |
| T17 | `Rep last 2 rows 6 (7, 6) more times—50 (62, 74) sts rem: 32 (34, 38) instep sts, 18 (28, 36) sole sts.` | repeat rows 3–4 | — | explicit 50, 62, 74 | — | — | — | — | — |
| T18 | `Next rnd Work instep sts in patt, sl m, k9 (14, 18), M1, k9 (14, 18)—51 (63, 75) sts: 32 (34, 38) instep sts, 19 (29, 37) sole sts.` | next | null | explicit 51, 63, 75 | +1 | — | — | no | Foot chart continues |
| T19 | `Removing old beg-of-rnd m when you come to it, work Rows 1–12 of Leg chart for your size 5 times, working marked rows as foll:` | rows 1–12 ×5 | null | prev | 0 | BOR | — | no | `{name:'Leg, size …', row:1..12}` |
| T20 | `Row 6 Work to last st, sl 1 pwise, remove m, transfer sl st to left needle, pm for new beg of rnd.` | 6 (of chart) | null | prev | 0 | BOR moved | — | no | chart row 6 |
| T21 | `Eyelet rnd K1, *yo, p2tog; rep from * to end, yo—52 (64, 76) sts.` | next | null | explicit 52, 64, 76 | +1 | — | — | no | — |

Text-layer notes for this pattern: in the extract, **an advert is injected inside T15** (`…pm,
insert right needle into wrap⏎K NITS⏎I nterweave Knits IS A MUSTHAVE⏎FOR THOSE WHO LOVE TO
KNIT!⏎interweaveknits.com⏎then kwise into wrapped st…`) — the parser must not end the row at
the ad or turn "K NITS" into a part; and on p6 the Leg text is interleaved line by line with the
SSSK glossary column (`Row 6 Work to last st, sl 1 pwise, rethree slipped stitches and knit them
to- move m, …`), so T20 is not recoverable from the extract as printed. Line wraps after an em
dash (`turn—⏎1 st dec'd.`) are common in this book.

Note T15–T17: the flap rows are labelled `Row N` but end in `turn` and each works only the
centre + 1 gusset st. Per contract they are `shortRow:true` lines; the counter should still
**count them as rows** (they are numbered rows of the flap, unlike T11–T14 which are numbered
`Short-row N`). Label style in this book: bold label followed by text with **no colon**
(`Next rnd K11…`, `Inc rnd *Knit…`, `Short-row 1 (RS) K25…`, `Row 6 Work…`, `Eyelet rnd K1…`).

### 2c. Flying Trapeze Socks (Chrissy Gardiner) — PDF p14–17

**Garment / construction.** Top-down cabled lace sock on **two circular needles** (Needle 1 =
heel/sole sts, Needle 2 = instep), heel flap (linen-stitch OR traditional heel-stitch variant —
the knitter picks one), short-row heel turn, picked-up gusset, wedge toe, Kitchener.

**Sizes — the trap of this fixture.** Six finished sizes `5 (6, 7, 8, 9, 10)" foot
circumference` (toddler, child, woman's S, woman's M, man's S, man's M), but the instructions
carry **only two numbers**: "the first number is for sizes toddler, woman's small, and man's
small (worked over 60 sts); the second number, in parentheses, is for sizes child's, woman's
medium, and man's medium (worked over 68 sts)". Yarn weight and needle change the size, not the
stitch count. So `detectSizes` on the Finished-size line gives 6, but every instruction vector
has 2 entries: size index 0, 2, 4 → column 0; 1, 3, 5 → column 1. Plus `Toddler size only:` /
`all other sizes:` conditionals. Do not show a count for size 3 by reading column 3 (there is
none).

**Gauge (three, by yarn).** `Gauge Toddler/child's—10 sts and 13 rows = 1" in St st;
woman's—8 sts and 11 rows = 1" in St st; man's—6 sts and 8 rows = 1" in St st.` — note
**over 1 inch**. Needles: size 0 (2 mm) / size 2 (2.75 mm) / size 4 (3.5 mm), 2 cir.

**Text-layer warning.** p15 is three columns at the bottom and `PdfText.extract` interleaves
the Leg column and the Heel column **line by line** (e.g. extract line `join in the rnd. Work Rnds
1–44 of chart Rows 2 and 4: (WS) Sl 1, purl to end.`). The lines below are quoted from the
printed page (column order). This is a column-detection bug for the PdfText owner, not a parser
problem; until fixed, a fixture assertion on these lines must use the extract as it is.

| Section | Rows/rounds | Stitch counts (60-st sizes, 68-st sizes) |
|---|---|---|
| Leg | CO, join; chart Rnds 1–44 once; then (not toddler) Rnds 5–24 once → 44 or 64 rnds | 60, 68 |
| Heel flap | over 30 (34) sts of Needle 1. Linen: Rows 1–4 + "Rep Rows 1–4 five more times" = 24 rows. Heel-st: Rows 1–2 + "eleven more times" = 24 rows. "12 chain sts each side" | 30, 34 on the flap |
| Turn heel | Rows 1–4, "Rep Rows 3 and 4 until 1 st rem unworked each side", 2 × `Next row` → **14 short rows** both sizes (derived; the repeat is conditional) | 16, 20 |
| Gusset set-up rnd | knit heel sts, pick up 12, Needle 2 chart Rnd 5 (toddler) / Rnd 25 (others), pick up 12, k2tog | 39 (43) on Needle 1 |
| Shape gusset | Rnd 1 (−1), Rnd 2 (−1); "Rep Rnds 1 and 2 three more times, then Rnd 1 once more" → 9 rnds | 30 (34) on Needle 1; 60 (68) total |
| Foot | Needle 2 in patt until 2 reps (toddler) / 3 reps (others) of Rows 5–44 | 60, 68 |
| Toe | Rnd 1 (−4), Rnd 2 knit, "Rep Rnds 1–2 seven more times" → 16 rnds; "Rep Rnd 1 only 4 times" → 20 rnds | 28 (34) → 12 (18) |

**PATTERN ERROR.** Toe, 68-st sizes: 68 − 8 × 4 = **36**, printed `28 (34)`; and 36 − 16 = 20,
printed `12 (18)`. The 60-st column is right. Keep the printed numbers; a deviation hint is
correct here.

**Markers.** One: `Place marker (pm) and join in the rnd` (BOR). Everything else is
needle-relative (`Needle 1: k1, ssk, knit to end; Needle 2: cont in patt.`).

**Chart (vector, no glyphs).** "Cable Pattern", 30 sts (60-st socks) / 34 sts (68-st socks),
44 rnds (odd labels 1–43 and 44 at the right), with "Set-up rows; work once for all sizes,
working sts as marked for your size" (Rnds 1–4) and two "Pattern repeat" boxes (one per size).
Key: knit, purl, yo, k2tog, ssk, 2/2 cables (`sl 2 sts to cn, hold in back k2, k2 from cn` /
front), and three cable-with-decrease symbols spelled out in the key. No written-out version.

| # | Line (printed) | row | side | count | delta | until | shortRow |
|---|---|---|---|---|---|---|---|
| F1 | `CO 60 (68) sts and distribute evenly over 2 cir needles.` | — | — | 60, 68 (2-column vector) | — | — | no |
| F2 | `Work Rnds 1–44 of chart once.` | rnds 1–44 | null | prev | 0 | — | no — chart `{name:'chart', row:1..44}` |
| F3 | `Toddler size only: Proceed to heel flap.` / `all other sizes: Work Rnds 5–24 once.` | — | — | — | — | — | size-conditional |
| F4 | `Row 1: (RS) Sl 1, *k1, sl 1 with yarn in front (wyf); rep from * to last st, k1.` | 1 | rs | 30 (34) | 0 | — | no |
| F5 | `Rows 2 and 4: (WS) Sl 1, purl to end.` | **2 and 4** | ws | prev | 0 | — | no |
| F6 | `Rep Rows 1–4 five more times—12 chain sts each side of heel flap.` | repeat 1–4 ×5 | — | prev | 0 | — | no |
| F7 | `Rep Rows 1 and 2 eleven more times—12 chain sts each side of heel flap.` | repeat 1–2 ×**11** (word number) | — | prev | 0 | — | no |
| F8 | `Row 1: (RS) K16 (20), ssk, k1, turn.` | 1 | rs | −1 | −1 | — | yes |
| F9 | `Rep Rows 3 and 4 until 1 st rem unworked each side.` | repeat (conditional, no count) | — | null | — | — | yes |
| F10 | `Next row: (WS) Sl 1, purl to last 2 sts, p2tog, turn—16 (20) sts rem on Needle 1.` | next | ws | explicit 16, 20 | −1 | — | yes |
| F11 | `knit to last 3 sts on Needle 1, k2tog, k1—39 (43) sts on Needle 1.` | (gusset set-up) | null | explicit 39, 43 **on Needle 1 only** | — | — | no |
| F12 | `Rep Rnds 1 and 2 three more times, then Rnd 1 once more—30 (34) sts on Needle 1; 60 (68) sts total.` | repeat | null | explicit 60, 68 total | — | — | no |
| F13 | `Rep Rnds 1–2 seven more times—28 (34) sts rem. Rep Rnd 1 only 4 times—12 (18) sts rem.` | repeat ×2 | null | explicit 28 (34) then 12 (18) | — | — | no |

### 2d. On-Your-Toes Socks (Ann Budd) — PDF p18–20, 23

**Garment / construction.** **Toe-up**, 2×2 rib, Eastern cast-on, **yo short-row heel**
(Gibson-Roberts) with two halves, crew or knee length (knee: calf increases), sewn bind-off.
DPN, 3 needles (Needle 1 & 3 = sole halves, Needle 2 = instep); round starts at centre of sole.

**Sizes.** 5: `About 6 1/2 (7 1/2, 8, 9, 9 3/4)" foot circumference` (the extract writes
`6 1/2`, pdftotext writes `61/2` — superscript fractions). Two length variants chosen by the
knitter: `crew SockS:` and `kNee SockS:` (small-caps headings).

**Gauge.** `Gauge 14 sts and 21 rows = 2" in St st worked in the rnd on smaller needles.` (over
**2 inches**). Needles size 1 (2.25 mm) set of 4 dpn, optional size 2 (2.5 mm).

**Text-layer warning.** p20 is three columns and the extract interleaves the 2nd and 3rd columns
line by line (`sts on each needle: 11 (13, 14, 16, 17) sts then use the M1 method to inc 1 st at
end`). Knee-sock lines below are quoted in column order from the printed page.

| Section | Rows/rounds | Stitch counts (5 sizes) |
|---|---|---|
| Toe | CO 8 (8, 8, 8, 12); `Next rnd` +4; Inc rnd +4 every rnd 1 (2, 3, 4, 4) more time(s) → 20, 24, 28, 32, 36; every other rnd 6 (7, 7, 8, 8) times | 44, 52, 56, 64, 68 (11, 13, 14, 16, 17 on N1 and N3; 22, 26, 28, 32, 34 instep) |
| Foot | N2 in rib `p2 (2, 1, 1, 2), [k2, p2] 4 (5, 6, 7, 7) times, k2, p2 (2, 1, 1, 2)` until 5 1/2 (6 1/2, 7 1/2, 8, 8 3/4)" from CO | same |
| Heel, first half | yo short rows on 22 (26, 28, 32, 34) sts: Rows 1–4, "Rep Rows 3 and 4 until there are 6 (8, 10, 12, 12) sts between paired sts, ending with a RS Row 3" | heel count unchanged (yos are temporary) |
| Heel, second half | Rows 1–4 (Row 1 RS), "Rep Rows 3 and 4 until all yos of the first half have been consumed, ending with Row 4"; rejoin | 22 (26, 28, 32, 34) heel + same instep = 44 … 68 |
| Leg | 9 (10, 11, 13, 14) rnds; crew: rib until 7 (8, 9, 10, 11)"; knee: rib until 4 (4½, 5, 5½, 6)", then Rnds 1–16 (+1 on Rnd 1 and Rnd 9) and "Rep the last 16 rnds 3 (3, 3, 5, 5) more times" → 64, 64, 64, 96, 96 rnds | knee: 52, 60, 64, 76, 80 |

Short-row counts are **not printed** (both halves repeat "until"); derived from the stitch
geometry the first half is 15 (17, 17, 19, 21) short rows — treat as derived, not ground truth
for a parser. Each heel row is labelled `Row N: (RS)` / `(WS)` and ends in `turn`.

| # | Line | row | side | count | delta | until | shortRow |
|---|---|---|---|---|---|---|---|
| O1 | `With smaller needles and using the Eastern method (see page 23), CO 8 (8, 8, 8, 12) sts on two needles.` | — | — | 8, 8, 8, 8, 12 | — | — | no |
| O2 | `Rep Inc rnd every rnd 1 (2, 3, 4, 4) more time(s)—20 (24, 28, 32, 36) sts.` | repeat | null | explicit | +4/rnd | — | no |
| O3 | `Rep Inc rnd every other rnd 6 (7, 7, 8, 8) times—44 (52, 56, 64, 68) sts; 11 (13, 14, 16, 17) sts each on Needle 1 and Needle 3; 22 (26, 28, 32, 34) instep sts on Needle 2.` | repeat (note: "times", not "more times") | null | explicit 44 … 68 | +4/2 rnds | — | no |
| O4 | `Row 1: (RS) With Needle 3, knit to the last st on Needle 1—1 heel st unworked at end of Needle 1; 21 (25, 27, 31, 33) heel sts worked onto Needle 3. Turn so WS is facing.` | 1 | rs | null — the `21 (25…)` is "sts worked", **not** a row total | 0 | — | yes |
| O5 | `Row 2: (WS) Yo backward (see page 23), purl to the last st (do not work the last st), turn.` | 2 | ws | null | 0 | — | yes |
| O6 | `Rep Rows 3 and 4 until there are 6 (8, 10, 12, 12) sts between paired sts, ending with a RS Row 3, but do not turn the work.` | repeat (conditional) | ends rs | null | — | — | yes |
| O7 | `Rnds 2–8: Working new st into established patt, work 7 rnds even.` | **range 2–8** (= 7 rnds) | null | prev | 0 | — | no |
| O8 | `Rep the last 16 rnds 3 (3, 3, 5, 5) more times—8 (8, 8, 12, 12) sts inc'd; 52 (60, 64, 76, 80) sts total.` | repeat 1–16 | null | explicit (two vectors: inc'd and total — the **total** is the count) | +2 per 16 | — | no |
| O9 | `Cont even in rib until leg measures 7 (8, 9, 10, 11)" from base of heel, or desired total length.` | — | null | prev | 0 | length 7…11 in | no |

### 2e. Border Socks (Mary Jane Mucklestone) — PDF p21–23

**Garment / construction.** Top-down Fair Isle (stranded, 3 colours) leg from Chart A, wide-wale
rib, heel flap (slip-stitch), short-row heel turn, gusset, Chart B band on the foot, wedge toe,
Kitchener. 4 dpn + 1 working (Needles 1–3 in the round after the heel).

**Sizes.** `Finished Size 7 1/2 (9, 10 1/2)" foot circumference … To fit men's small (medium,
large).` — 3 sizes. `Size Medium only:` / `All sizes:` conditional.

**Gauge (two).** `Gauge 32 sts and 28 rnds = 4" in charted Fair Isle patt on larger needles; 32
sts and 36 rnds = 4" in wide wale rib on smaller needles.` Needles sizes 2 (2.75 mm) and 3
(3.25 mm) dpn.

Stitch Guide: `Wide Wale Rib (multiple of 6 sts)` / `Rnd 1: *P1, k5; rep from * to end.` /
`Rep Rnd 1 for patt.` — a one-round stitch pattern definition, **not** row 1 of the sock.

| Section | Rows/rounds | Stitch counts (S, M, L) |
|---|---|---|
| Cuff | CO, k1 p1 rib 1 3/4" | 60, 72, 84 (15, 18, 21 per needle) |
| Leg | Chart A Rnds 1–21; knit 2 rnds; wide wale rib until 7 1/2" from CO | 60, 72, 84 |
| Heel flap | `Next row: K15 (18, 21), turn.` `Next row: P30 (36, 42) for heel flap, turn.` then Rows 1–2 + "Rep last 2 rows 14 (16, 18) more times for a total of 30 (34, 38) rows" | 30, 36, 42 |
| Turn heel | Rows 1–4 + "Rep last 2 rows 4 (5, 7) more times" → 12, 14, 18 short rows; Medium only +2 rows → 16 | 18, 22, 24 → Medium 20 |
| Gusset | pick-up "Rnd 1" → 78, 92, 108; dec "Rnd 1" (−2) + Rnd 2; "Rep last 2 rnds 8 (9, 11) more times" → 18, 20, 24 rnds | 60, 72, 84 |
| Foot | until 6 (7, 7 3/4)" from back of heel; Chart B Rnds 1–5; knit 1 rnd | same |
| Toe | Rnd 1 (−4) + Rnd 2; "Rep last 2 rnds 5 (8, 11) more times—36 sts rem. Rep Rnd 1 only 5 more times—16 sts rem." | 36 → 16 (all sizes) |

**Two consecutive `Rnd 1:` lines** under `Shape gusset:` — the first is the pick-up round
(`Rnd 1: Needle 1: k18 (20, 24) heel sts and with same needle, pick up and knit 15 (18, 21)
sts … —78 (92, 108) sts total. Pm and resume working in the rnd.`), the second is the first
decrease round. A parser must not merge them or treat the second as a repeat of the first.
(The pick-up total 78 = 9 + 15 + 30 + 15 + 9: Needle 1's "k18 (20, 24)" is followed by Needle
3's "k9 (10, 12) heel sts", i.e. half the heel is knitted twice in that setup round as written.)

**Charts (vector colourwork).** `Chart A` 21 rnds, `6 st repeat`, colours MC/CC1/CC2;
`Chart B` 5 rnds, `6 st repeat`. No symbol cells — colour fills only.

| # | Line | row | side | count | delta | until | shortRow |
|---|---|---|---|---|---|---|---|
| D1 | `cuff: With MC and smaller needles, CO 60 (72, 84) sts—15 (18, 21) sts on each needle.` | — | — | 60, 72, 84 (the second vector is per needle) | — | — | no |
| D2 | `Work wide wale rib (see Stitch Guide) until piece measures 7 1/2" from CO.` | — | null | prev | 0 | length 7.5 in | no |
| D3 | `Row 2: (WS) Sl 1, p29 (35, 41).` | 2 | ws | 30, 36, 42 | 0 | — | no |
| D4 | `Rep last 2 rows 14 (16, 18) more times for a total of 30 (34, 38) rows and 15 (17, 19) chain sts at edge of heel flap.` | repeat | — | prev | 0 | — | no (two non-count vectors: rows, chain sts) |
| D5 | `Row 1: (RS) Sl 1, k16 (19, 22), ssk, k1, turn.` | 1 | rs | −1 | −1 | — | yes |
| D6 | `Rep last 2 rows 4 (5, 7) more times, ending with a WS row—18 (22, 24) sts rem.` | repeat | ws | explicit 18, 22, 24 | — | — | yes |
| D7 | `Next row: Sl 1, p18, p2tog, turn—20 sts rem.` | next | ws (parity) | explicit 20 (Medium only) | −1 | — | yes |
| D8 | `Rep last 2 rnds 8 (9, 11) more times—60 (72, 84) sts rem; 15 (18, 21) sts on Needles 1 and 3, and 30 (36, 42) sts on Needle 2.` | repeat | null | explicit 60, 72, 84 | — | — | no |
| D9 | `Rep last 2 rnds 5 (8, 11) more times—36 sts rem. Rep Rnd 1 only 5 more times—16 sts rem.` | two repeats in one line | null | 36 then 16 | — | — | no |

### 2f. Genome Socks (Meema Spadola) — PDF p24–26

**Garment / construction.** **Toe-up**, one size, Eastern CO (refers to "page 20" = On-Your-
Toes glossary), yo short-row heel, a single DNA cable panel (11 sts) up the instep and leg,
picot bind-off. DPN.

**Size / gauge.** `Finished Size: 7½" foot circumference, 10" long …` — single size.
`Gauge: 24 sts and 35 rows = 4" in St st in the rnd.` `Needles: Size 5 (3.75 mm)`.

**Cable written out (no chart graphic).** Stitch Guide: `2/1 RC: Sl 1 st to cn and hold in back,
k2, p1 from cn.` / `2/1 LC: Sl 2 sts to cn and hold in front, p1, k2 from cn.` / `DNA Cable:
(worked over 11 sts)` Rnds 1–12. Crossing rounds: **2, 4, 6, 10, 12** (Rnd 2 is a 5-st
k2/p1/k2 cross; 4, 6, 10, 12 use 2/1 RC + 2/1 LC). 12-round repeat. `cable` cadence is not a
single "every N rnds" — the counter's cable ring must take the crossing set from the panel.

**PATTERN ERROR.** `Rnd 4: P2, 2/1 RC (see Stitch Guide), p1, 2/1 LC (see Stitch Guide).` = 2 +
3 + 1 + 3 = **9 sts**, the panel is 11: the closing `p2` is missing (compare Rnd 12 `P2, 2/1 LC,
p1, 2/1 RC, p2.`). Also `Rnds 2:` (plural label, single number) — must parse as round 2.

| Section | Rounds/rows | Count |
|---|---|---|
| Toe | CO 8, knit 1 rnd, Rnd 1 (+4), Rnd 2 (+4), "Rep Rnd 2 eight more times" | 48 |
| Foot | `Needle 1: K10; Needle 2: k8, work DNA cable … over 11 sts, k9; Needle 3: k10.` until 7½" | 48 |
| Heel | yo short rows over 20 sts; first half "until there are 8 sts between yos"; second half `Row 1: (WS)` … `Row 4: (RS)`, "Rep Rows 3 and 4 until all yos have been consumed, ending with Row 3" | 20 heel, 48 total |
| Leg | patt until about 7½", ending with Row 8 of cable panel; picot BO | 48 |

Second-half heel rows restart at `Row 1: (WS)` — **Row 1 is a WS row** here; side must come from
the tag, not from odd = RS.

| # | Line | row | side | count | delta | shortRow |
|---|---|---|---|---|---|---|
| G1 | `Rnd 1: Needle 1: K1, M1, k1; Needle 2: k1, M1, k2, M1, k1; Needle 3: k1, M1, k1—4 sts inc'd.` | 1 | null | 12 | +4 | no |
| G2 | `Rep Rnd 2 eight more times—48 sts.` | repeat rnd 2 ×8 | null | explicit 48 | +4/rnd | no |
| G3 | `Rnd 4: P2, 2/1 RC (see Stitch Guide), p1, 2/1 LC (see Stitch Guide).` | 4 (of panel) | null | 11-st panel; as printed sums to 9 | — | no — `cable` on this round |
| G4 | `Row 1: (RS) K19, turn, leaving last st unworked.` | 1 | rs | null (20 heel sts unchanged) | 0 | yes |
| G5 | `Row 1: (WS) Yo backward, purl to the paired sts made by the yo of the previous row, p1 (first st of the pair), ssp; i.e., the yo with the first st of the next pair), leaving a yo as the first st on the left needle, turn.` | 1 (second half) | **ws** | null | 0 | yes |
| G6 | `… and work the last instep st tog with the yo at the beg of the heel sts as ssk—20 heel sts, 48 sts total.` | (rejoin) | null | explicit 48 | — | no |
| G7 | `Picot Bind-Off: BO 2 sts, *sl rem st on right needle back to left needle, use the knitted method to CO 2 sts, BO 4 sts; rep from * to end.` | — (stitch-guide definition) | — | — | — | no — must not become a part header ("Bind-Off") |

### 2g. Albus Argyle Socks (Anne Berk) — PDF p27–31

**Garment / construction.** Top-down argyle, **intarsia in the round worked back and forth**:
after the cuff the tube is worked in **turned rows** (RS/WS) with yarn butterflies, linking at a
moving "turning point". Heel flap, heel turn, gusset decreases every RS row, then foot and toe
in rounds with MC only. Accent lines added afterwards in duplicate stitch.

**Sizes.** `Finished Size 8 (9 1/4 , 11 1/4)" foot circumference` (note the space before the
comma, `9 1/4 ,`). 3 sizes. **Gauge** `32 sts and 44 rows = 4" in patt.` Needles size 2 (2.75 mm).

**RS/WS trap.** The leg chart has an odd number of rows (31, 37, 45), it is worked twice with
colours reversed, and "**Row 1 on second rep of chart will be a WS row.**" Side parity flips
between repeats; a counter deriving side from row parity would be wrong for the whole second
repeat. Also `Row 1: RS (Set-up row)` — RS **without** parentheses.

| Section | Rows | Count (S, M, L) |
|---|---|---|
| Cuff | CO, k1 p1 rib 2 1/2 (3, 3)"; `Next rnd Knit, dec 0 (4, 4) sts evenly around` | 64, 78, 94 → 64, 74, 90 |
| Leg | Rows 1–3 written out, then chart 31 (37, 45) rows, reversed and repeated → 62, 74, 90 rows | 64, 74, 90 |
| Heel flap | over 32 (36, 44); Row 1 (WS), Row 2 (RS); "Rep Rows 1 and 2: 15 (17, 21) more times, and then work Row 1 once more" → 33, 37, 45 rows | 32, 36, 44 (instep 32, 38, 46 on holder) |
| Turn heel | Rows 1–4, "Work Rows 3 and 4 until all sts have been worked" → no count printed (derived 18, 20, 24 from the gusset totals) | — |
| Gusset (rows, intarsia) | pick up 16 (18, 22) each side; Dec row every RS row 9 (10, 12) times total | → 64, 74, 90 |
| Foot (rounds) | until 7 1/2 (8 1/2 , 9)" from heel | 64, 74, 90 |
| Toe | Dec rnd (−4) + knit rnd, "Rep last 2 rnds 7 (9, 11) more times" → 32, 34, 42; "Then rep Dec rnd every rnd 4 (4, 5) times" | 16, 18, 22 |

**Charts (vector colourwork).** Three charts, one per size: `Small, size 8"` 64 sts × 31 rows,
`Medium, size 9 1/4"` 74 sts × 37 rows, `Large, size 11 1/4"` 90 sts × 45 rows (the `45`
label is in the text layer but not emitted by the extractor). Key MC, CC1, CC2, AC1, AC2,
"turning point". Colour fills, no glyphs.

| # | Line | row | side | count | until | notes |
|---|---|---|---|---|---|---|
| A1 | `Next rnd Knit, dec 0 (4, 4) sts evenly around—64 (74, 90) sts rem.` | next | null | explicit 64, 74, 90 | — | delta 0, −4, −4 |
| A2 | `Row 1: RS (Set-up row) Join CC1, leaving a 4" tail. With CC1, k1, drop CC1, cross MC over CC1, with CC1, k1 (0, 0), with MC, k30 (36, 44), join CC2 leaving a 4" tail, k2 (1, 1), cross MC over CC2, with MC, k30 (36, 44), turn.` | 1 | **rs** (no parens) | computed 64, 74, 90 | — | `turn` here is a full-row turn (intarsia in the round), not a short row; `k1 (0, 0)` = zero for sizes 2–3 |
| A3 | `Work 31 (37, 45) rows of chart once, then reverse CC1 and CC2 and work chart again. Row 1 on second rep of chart will be a WS row.` | chart rows ×2 | flips | prev | — | — |
| A4 | `Rep Rows 1 and 2: 15 (17, 21) more times, and then work Row 1 once more.` | repeat + 1 | — | prev | — | colon after "2" |
| A5 | `Work Rows 3 and 4 until all sts have been worked.` | repeat (conditional) | — | **null** (not printed) | — | shortRow yes |
| A6 | `Dec row (RS) Knit to m, sl m, k1, ssk, work in patt to 3 sts before m, k2tog, k1—2 sts dec'd.` | next | rs | prev − 2 | — | delta −2 |
| A7 | `rep Dec row every RS row 8 (9, 11) more times—64 (74, 90) sts rem.` | repeat every RS row | — | explicit | — | — |
| A8 | `Cont working even in St st until the foot covers the little toe, or 7 1/2 (8 1/2 , 9)" from heel.` | — | null | prev | length 7.5, 8.5, 9 in | — |
| A9 | `Then rep Dec rnd every rnd 4 (4, 5) times—16 (18, 22) sts rem.` | repeat | null | explicit | — | — |

### 2h. Stranded Boot Stockings (Kari Anderson) — PDF p32–34

**Garment / construction.** Top-down over-the-knee stocking, stranded 2-colour, corrugated rib
cuff, leg chart with **decreases inside the chart** (84 → 60 sts), 3×3 checker heel flap,
heel turn written out row by row, gusset, instep chart, toe. 5 dpn.

**Size / gauge.** Single size: `13" cuff circumference, 9" foot circumference, and 9" from back
of heel to tip of toe.` `Gauge 26 sts and 28 rnds = 4" in two-color stranded St st.` Needles
size 5 (3.75 mm).

| Section | Rows/rounds | Count |
|---|---|---|
| Cuff | CO 84, corrugated rib until 3" | 84 (28 per needle) |
| Leg | Leg chart through Rnd 84 | 60 (20 per needle) |
| Heel flap | 29 sts; checker Rows 1–6 + "Rep Rows 1–6 three more times—24 rows total" | 29 |
| Turn heel | Rows 1–12 each written out, −1 each: 28, 27, …, 17 | 17 |
| Gusset | set-up (pick up 12 + 12) → 72; Rnd 1 (−2) + Rnd 2; "Rep last 2 rnds 5 more times" | 60 (29 sole + 31 instep) |
| Foot | until 7" from back of heel, ending with chart Rnd 10 | 60 |
| Toe | 3 × (Dec rnd −4 + even) → 48; Dec rnd → 44 (21 sole, 23 instep); even; instep-only Dec rnd (−2) → 42; Dec rnd (−4) → 38; Dec rnd (−4) → 34; "Rep last 2 rnds 2 more times" → 18 | 18 (9 + 9) |

**Charts (vector colourwork).** `Leg` 84 rnds (odd labels 1–83; Rnd 84 unlabelled), `28 st rep`,
narrowing 84 → 60 with k2tog / sl 1-k1-psso symbols in the chart; `Instep` **31 sts × 26 rnds**
(odd labels 1–25). Key: With MC knit / With CC knit / With MC k2tog / With MC sl 1, k1, psso /
pattern repeat.

| # | Line | row | side | count | delta | shortRow |
|---|---|---|---|---|---|---|
| H1 | `Leg: Work through Rnd 84 of Leg chart—60 sts rem; 20 sts each needle.` | rnds 1–84 | null | explicit 60 (decreases come from the chart; no per-round counts in text) | −24 over the chart | no |
| H2 | `Heel: Place first 15 and last 14 sts of rnd on one needle—29 sts for heel.` | — | — | 29 on the heel needle | — | no |
| H3 | `Row 1: (RS) Sl 1, [k3 with CC, k3 with MC] 4 times, k3 with CC, k1 with MC.` | 1 | rs | computed 29 | 0 | no |
| H4 | `Row 3: Rep Row 1.` | 3 | rs (parity) | 29 | 0 | no |
| H5 | `Row 4: Sl 1, [p3 with MC, p3 with CC] 4 times, p4 with MC.` | 4 | ws (parity) | computed 29 | 0 | no |
| H6 | `Rep Rows 1–6 three more times—24 rows total.` | repeat | — | 29 | 0 | no |
| H7 | `Row 1: (RS) With MC, k17, sl 1, k1, psso, k1, turn.` | 1 | rs | 28 (computed: −1 per row) | −1 | yes |
| H8 | `Row 12: Sl 1, p15, p2tog, turn—17 sts rem for heel.` | 12 | ws (parity) | explicit 17 | −1 | yes |
| H9 | `… then work across first 8 heel sts as foll: [k1 with CC, k1 with MC] 4 times—72 sts total; 20 sts on Needle 4.` | (set-up rnd) | null | explicit 72 | — | no |
| H10 | `Rep last 2 rnds 5 more times—60 sts rem: 29 sole sts and 31 instep sts.` | repeat | null | explicit 60 | — | no |
| H11 | `Rep last 2 rnds 2 more times—18 sts rem.` | repeat | null | explicit 18 | — | no |

Corrugated Rib in the Stitch Guide (`Rnd 1: *K1 with CC; bring MC to front of work and p1 with
MC, bring MC to back of work; rep from * around.`) is a definition, not the sock's round 1.

---

## 3. `knit-fromtheheart-magicloop-socks.pdf` — "Magic Loop 36 (40, 48) Stitch Adult Socks" (Lois Moore)

3 pages, single column, `garbled false`, 6132 chars, no images that matter, **no gauge printed**
("Use 29" or longer circular needle, size to fit your yarn") → `Project.gauge` stays empty; no
needle size either. A hand-typed charity pattern: the most typo-ridden fixture we have and the
best test of "never guess".

**Garment / construction.** Top-down sock, **magic loop**, heel flap + heel turn (written row by
row) + picked-up gusset, star toe gathered closed. One sock at a time (no two-at-a-time
instructions). **Every round is called "Row"** (gusset decreases `Row 1–3`, toe `Row 1–4`
are rounds) — side must be `null` there because the work is in the round, even though the
label says Row. Heel flap and heel turn rows are flat but carry **no RS/WS tags**.

**Sizes.** Named by stitch count: `36 (40, 48) Stitch Adult Socks`. Size-conditional lines name
the size by stitch count: `****Row 7: 40 stitch sock only:`, `****Row 7: 36 and 48 stitch
socks only:`, `####Row 9: 48 stitch only:` (literal `****` / `####` prefixes — **not** repeat
asterisks). Note the 2-value vector `0 (2)` on the "36 and 48" line maps to sizes 1 and 3.

**Typos inside size vectors (verbatim — the parser must not invent values):**
`purl 3 (3 3)` (missing comma), `leaving 5 (6, 08 stitches` (`0` for `)`), `purl 5 (5 5)`,
`leaving 3 (4 06) stitches`, `purl 8 (09)`, `purl 0(2) leaving 0 (2)`, `leaving 0 ()`,
`With 5 (6, 07 stitches`, `after 10th (11, 0) picked up stitch` (third value should be 12),
`Knit the first 9 (10, 012) instep stitches`, `10 (12, 14 ) stitches`, `5 (6 ,7 ) stitches`,
`leaving3 (4, 6)`. Where a vector cannot be read (`(6, 08`, `0 ()`), the line's count for
the affected sizes must be `null`, not a guess.

| Section | Rows | Count (36, 40, 48) |
|---|---|---|
| Cuff | CO; k2 p2 or k1 p1 rib "until cuff measures desired length" (no length given) | 36, 40, 48 |
| Heel flap | Row 1 `*sl 1, k1*`, Row 2 `sl 1, purl 17 (19, 23)`; "until you have completed a total of 16 (20, 22) rows. End with a purl row." | 18, 20, 24 on the flap |
| Turning heel | Rows 1–6 all sizes; Row 7–8 (40 only) / Row 7–8 (36 and 48) / Rows 9–10 (48 only); Row 11 knit the heel sts, do not turn → **8, 8, 10 short rows** | after Row 1: 17, 19, 23; R2 16, 18, 22; R3 15, 17, 21; R4 14, 16, 20; R5 13, 15, 19; R6 12, 14, 18; R7 11, 13, 17; R8 10, 12, 16; R9 —, —, 15; R10 —, —, 14 → **10, 12, 14** |
| Gusset pick-up | 9 (10, 11) + 1 each side | 48, 54, 62 (24, 27, 31 per needle point) |
| Gusset decreases | Row 1 (k tbl, no dec), Row 2 (−2), Row 3 even; "Repeat rows 2 and 3 until … 18 (20, 24) for a total of 36 (40, 48)" → 6, 7, 7 dec rounds (derived) | 36, 40, 48 |
| Foot | until approximately `7 (8 or 9) inches` from back of heel | 36, 40, 48 |
| Toe | Row 1 `Knit 6 (10, 6), knit 2 together. Repeat to end of row.`, Row 2 knit, Row 3 `Knit 5 (9, 5)…`; "until … 12 stitches left on each half (total 24 stitches)", then every row "until only 4 stitches remain on each half" | see note |

**Toe arithmetic does not close.** `Knit 6, knit 2 together. Repeat to end` divides 48 (→ 42)
but not 36 (4 left over) or 40 (`Knit 10, k2tog` → 4 left over). And from 24 sts, decreasing
every row by the same 6 groups gives 18, 12, 6 — never the stated 8 ("4 stitches remain on each
half"). Expected parser output: 48-st size Row 1 → 42 computed; 36- and 40-st sizes → `null`
(remainder does not fit the repeat); the "every row" phase → `null`. Do not round.

**Markers.** Two, "Make 2 markers from contrasting yarn": placed at the gusset/instep
boundaries during the gusset pick-up (`Place marker on right needle point after 10th (11, 0)
picked up stitch` and `place a marker` after the instep sts). No BOR marker (magic loop: the
needle points define the halves).

**Short rows.** Turning Heel Rows 1–10 (sizes vary) end `turn work` / `TURN`; Row 11 explicitly
"do not turn". Every heel-turn row also states the sts **left unworked** (`…leaving 5 (6, 8)
stitches unworked…turn work`) — that vector is *not* a stitch count for the row.

| # | Line (verbatim) | row | side | count | delta | until | shortRow |
|---|---|---|---|---|---|---|---|
| M1 | `Cuff: Cast on 36 (40, 48) stitches.` | — | — | 36, 40, 48 | — | — | no (inline part header "Cuff:") |
| M2 | `Work all stitches until cuff measures desired length.` | — | null | prev | 0 | **none** (no value — must not become an `until`) | no |
| M3 | `Row 2: Slip 1 stitch as to purl to right hand needle point, purl remaining 17 (19, 23) stitches.` | 2 | parity → ws | 18, 20, 24 | 0 | — | no |
| M4 | `Work these two rows until you have completed a total of 16 (20, 22) rows. End with a purl row.` | repeat | ends ws | prev | 0 | `{kind:'rows', value:16/20/22}` total rows (not "more times") | no |
| M5 | `Row 1: Slip 1 stitch to right hand needle point as if to purl, knit 9 (10, 12) stitches, knit 2 together, knit 1…leaving 5 (6, 8) stitches unworked…turn work` | 1 | parity → rs | 17, 19, 23 (computed; `5 (6, 8)` is unworked sts, not count) | −1 | — | yes |
| M6 | `Row 2: Slip 1 stitch to right hand needle point as if to purl, purl 3 (3 3) stitches, purl 2 together, purl 1…leaving 5 (6, 08 stitches unworked…turn work.` | 2 | ws | 16, 18, 22 | −1 | — | yes |
| M7 | `****Row 7: 40 stitch sock only: Slip 1, knit 8, knit 2 together, knit 1…leaving (2) stitches unworked…turn work.` | 7 | rs | —, 13, — | −1 | — | yes (size-conditional: size 2) |
| M8 | `****Row 7: 36 and 48 stitch socks only: Slip1, knit 8, knit 2 together, knit 0 (2) leaving 0 () unworked…turn work.` | 7 | rs | 11, —, 17 | −1 | — | yes (sizes 1 and 3; 2-value vector) |
| M9 | `####Row 9: 48 stitch only: Slip 1, knit 10, knit 2 together, knit 1…TURN` | 9 | rs | —, —, 15 | −1 | — | yes |
| M10 | `Row 11: Knit 10 (12, 14) stitches of heel, do not turn` | 11 | rs | 10, 12, 14 | 0 | — | **no** ("do not turn" must not set shortRow) |
| M11 | `You have 24 (27, 31) stitches on each needle point…a total of 48 (54, 62) stitches in all.` | — | null | explicit 48, 54, 62 (the first vector is per needle) | — | — | no |
| M12 | `Row 2: Knit stitches until 2 stitches before the marker, knit 2 together, slip marker, work instep stitches. Turn work, position needle point and work next instep stitches, slip marker, knit 2 together, knit rest of stitches on this needle point.` | 2 | **null** (in the round; "Turn work" here is turning the magic loop, not a short row) | prev − 2 | −2 | — | **no** |
| M13 | `Repeat rows 2 and 3 until you have decreased enough stitches to bring your total stitches on each side to 18 (20, 24) for a total of 36 (40, 48) stitches…the original number of cast on stitches.` | repeat (conditional) | null | explicit 36, 40, 48 | — | — | no |
| M14 | `Work all stitches on both sides of your sock until foot measures approximately 7 (8 or 9) inches from back of heel, …` | — | null | prev | 0 | length 7, 8, 9 in (`(8 or 9)` — "or" as separator) | no |
| M15 | `Row 1: Knit 6 (10, 6), knit 2 together. Repeat to end of row.` | 1 (toe) | null | null, null, 42 | — | — | no |

**Trap:** M12 and the gusset Row 1 contain `Turn` / `Turn work` while knitting **in the round**
on magic loop. The short-row detector must not fire on "Turn, slip out rear needle point" /
"Turn work, position needle point" — a rule of thumb: `turn` at the *end* of a row segment in a
flat section is a short row; `Turn` followed by repositioning the needle in a round section is
not.

---

## 4. `knit-interweave-lace.pdf` — "Knitting Lace: 10 Free Knitted Lace Patterns" (Knitting Daily)

36 pages, `garbled false`, 80728 chars, 25 column regions. Contents (PDF page = printed page):
Sophia Lace Shrug p3, Oriel Lace Blouse p5, Henley Perfected p8, Icelandic Lace Shawl p12,
Spectrum Scarf p16, Tailored Scallops Cardigan p18, Penobscot Silk Lace Scarf p24, Lace
Fountain Hat p26, Arrowhead Shawl p28, Guanaco and Vicuña Lace Fingerless Gloves p30, Glossary
p34–36 (abbreviation format `ppso—pass purled stitch over`, em dash).

**Charts in this book.** All charts are **vector drawings** (symbols are paths; only row
numbers, captions, size begin/end labels and the key are text), **except the Icelandic shawl
p15**, where two symbols are **glyphs** in a monospace font: `#` = "p1, k2, ppso" and `2` =
"[k1,p1,k1] in next st" (44 glyph items); every other symbol on that page is a path. So
`KnitChart` will see a chart with only a few glyph cells; it must report it as
partial/unreadable (cells `null`), not as a chart of plain knit stitches with a few `#`s.
Fractions in chart titles arrive split (`32 ¦ 1 ¦ ⁄ ¦ 2`) and sometimes garbled
(`Left-Front Lace, sizes 32/2 (39, 51)"`, `/" 46 1/2"`, `461 2`). The Arrowhead Shawl's two
charts are **not in this PDF at all** (text refers to them; no drawing on p28–29).

Quotes OR2 (p5→6) and HE1 (p9→10) **span a page break** in the extract, and HE1's page break
falls between `rep from` and `* across.` — a row continued on the next page.

### 4a. Sophia Lace Shrug (Betty Monroe) — p3–4

Flat, **worked side to side** in one piece (cuff to cuff), three sections per row (lace collar |
garter upper body | lace lower body), then folded and seamed. Sizes `26 (27 1/2 , 28 3/4)"
wide`; `Gauge 15 sts and 28 rows = 4" in garter st.`; needles size 8 (5 mm) 24" cir. No side
tags at all; no chart; 10-row repeat.

| # | Line | row | count | notes |
|---|---|---|---|---|
| SO1 | `With crochet hook and the chain edge method (see Glossary), CO 108 (112, 128) sts. Do not join.` | — | 108, 112, 128 | "Do not join" = flat |
| SO2 | `Set-Up Rows 1 and 2: Sl 1, k27 (27, 33), place marker (pm), knit to last st, p1.` | setup rows **1 and 2** | = prev | each row places 1 marker from its own edge → 2 markers, at 28 and 80 (28, 84; 34, 94) |
| SO3 | `Rows 3–5: Sl 1, knit to 3 sts before m, p1, k1, p1, sl m, knit to next m, sl m, [yo, ssk] 2 times, knit to last st, p1.` | range 3–5 | = prev | |
| SO4 | `Row 6: Sl 1, [yo 2 times, k1] 24 (24, 30) times, p1, k1, p1, sl m, knit to next m, sl m, [yo, ssk] 2 times, knit to last st, p1.` | 6 | see note | `[yo 2 times, k1]` = 2 wraps per st |
| SO5 | `Row 7: … *[drop both yo, sl 1] 6 times, cross these 6 sts as foll: … k6; rep from * to end, purling last st instead of knitting it—4 (4, 5) sets of crossed sts.` | 7 | see note | `4 (4, 5) sets` is **not** a stitch count |
| SO6 | `Rep Rows 1–10 only 17 (18, 19) more times. BO all sts.` | repeat 1–10 ×17/18/19 → 180, 190, 200 rows + 2 set-up | = 108… | "only" before the count |

Count note: no row prints a stitch total. True live-loop counts are 108 → Row 6 156 (yo-twice
adds 2 loops × 24) → Row 7 156 (adds 48 at one end, drops 48 at the other) → Row 8 108. A parser
that cannot model `drop both yo` must give `null` for Rows 6–8, never 108 + 48 carried forward.

### 4b. Oriel Lace Blouse (Shirley Paden) — p5–7

Flat pieces, bottom-up: Front, Back (split for a back placket), Sleeves (set-in, belled — lace
worked on 4 needle sizes), neckband worked on held sts. Sizes `36 (40 1/2 , 44 1/2 , 49)" bust`.
`Gauge 22 sts and 32 rows = 4" in patt on size 5 needles after blocking; 1 patt rep = 2 3/16 "
wide and 3 1/2 " high on size 5 needles after blocking.` (a pattern-repeat gauge too). Needles
sizes 8, 7, 6, 5, 3, 2. Notes: "Row counts are given throughout the instructions because the
neckband is a continuation of the front and back". Garter selvedge st at each edge.

Chart `Oriel` (vector; the title is drawn mirrored and extracts as `OriellireO`): **28 rows**
(odd labels 1–27 on the right), 12-st pattern repeat, begin/end lines per size for front and
for sleeve ("beg front 36"…", "sleeve (all sizes)"). Key: k on RS; p on WS / p on RS; k on WS /
k2tog / ssk / yo / pattern repeat. Flat: RS rows right→left, WS rows left→right. The text says
"(page 82)" — a magazine page reference, not a PDF page.

| Section | Count (S, M, L, XL) |
|---|---|
| Front CO / Row 1 | 99, 111, 123, 135 (K1, chart 97 (109, 121, 133), k1) |
| Waist (dec each end every 8th row 6 times, ending chart Row 20) | 87, 99, 111, 123 |
| Bust (Inc row + every 7th row 5 more times, ending chart Row 12) | 99, 111, 123, 135 |
| Armholes (sloped BO 4 ×2 / 3 ×2 (4, 4, 6) / 2 ×2 (6, 6, 8) / 1 ×6 (4, 6, 6)) | 75, 75, 85, 87 |
| Front: 44 (44, 46, 46) rows even, ending chart Row 28 (4, 8, 12) | held |
| Back placket: right back 38 (38, 43, 44) held; left back 37 (37, 42, 43) → k1f&b 38 → k1f&b 39 (39, 44, 45) | |
| Sleeve CO 63 (63, 75, 75); 54 rows on 4 needle sizes; inc to 73 (77, 85, 89); cap to 17 (17, 19, 19) | |
| Neckband 24 (24, 25, 25) + 3 (3, 1, 1) + 45 (45, 47, 47) + 3 (3, 1, 1) + 24 (24, 25, 25) | **99 all sizes** |

| # | Line | row | side | count | notes |
|---|---|---|---|---|---|
| OR1 | `With largest needles, CO 99 (111, 123, 135) sts. Change to size 5 needles and purl 1 WS row.` | — / 1 WS row | ws | 99… | "purl 1 WS row" is a row without a number |
| OR2 | `Next row: (RS) K1 (selvedge st; work in garter st), work 97 (109, 121, 133) sts according to Row 1 of Oriel chart (page 82), beg and ending as indicated for your size, k1 (selvedge st; work in garter st).` | next | rs | computed 99… | `(selvedge st; work in garter st)` is a note, not a size vector; chart `{name:'Oriel', row:1}` |
| OR3 | `Shape waist: Cont in charted patt, dec 1 st inside selvedge sts each end of needle every 8th row 6 times, ending with chart Row 20—87 (99, 111, 123) sts rem;` | — | — | explicit 87… | ends on a chart row |
| OR4 | `Shape bust: Inc row: (RS) Inc 1 st inside selvedge st each end of needle—2 sts inc'd.` | next | rs | prev + 2 | delta +2; "Inc row:" label then "(RS)" |
| OR5 | `Shape armholes: Use the sloped BO (see Stitch Guide) to BO 4 sts at beg of next 2 rows, then 3 sts at beg of foll 2 (4, 4, 6) rows, then 2 sts at beg of foll 2 (6, 6, 8) rows, then 1 st at beg of foll 6 (4, 6, 6) rows—75 (75, 85, 87) sts rem.` | 12, 16, 18, 22 rows | — | explicit 75, 75, 85, 87 | |
| OR6 | `Work 44 (44, 46, 46) rows even in patt after last BO row, ending with chart Row 28 (4, 8, 12)—armholes measure about 7 (7 1/2, 8, 8 1/2)".` | `{kind:'rows'}` 44… | — | prev | chart row is a **per-size vector** |
| OR7 | `Inc 1 st each end of needle on next row, then every foll 14th (9th, 14th, 9th) row 4 times, then every foll 0 (10th, 0, 10th) row 0 (2, 0, 2) times, ending with chart Row 27—73 (77, 85, 89) sts.` | — | — | explicit | **ordinal size vector** `14th (9th, 14th, 9th)`; a `0` interval with `0` times = skip |
| OR8 | `… then 1 st at beg of foll 14 (18, 18, 22) rows, then 3 sts at beg of next 4 rows—17 (17, 19, 19) sts rem. BO all sts.` | cap | — | explicit | |
| OR9 | `work 24 (24, 25, 25) held right-back sts in patt as established—99 sts.` | neckband setup | — | explicit 99 | single value after a vector line |

### 4c. Henley Perfected (Connie Chang Chinchio) — p8–11

Flat pieces bottom-up with turned hems, a 6-row "division pattern" (elongated slipped sts),
lace upper body from charts, set-in sleeves, front placket, I-cord bind-off bands, neckband with
markers and a turning ridge. Sizes `32 1/2 (35, 39, 42 1/2 , 46 1/2 , 51)" bust` — 6 sizes.
`Gauge 24 sts and 32 rows = 4" in St st on larger needle; 22 1/2 sts and 34 rows = 4" in lace
patt on larger needle.` Needles size 4 (3.5 mm) body, size 3 (3.25 mm) bands.

Charts (vector): `Back and Sleeve Lace`, `Left-Front Lace` (one for 35/42½/46½, one for
32½/39/51), `Right-Front Lace` (same two) — 20 rows each (odd labels 1–19), many per-size
beg/end lines ("end sleeve 39"", "beg back 32 1/2"" …). Key: k on RS; p on WS / p on RS; k on
WS / yo / k2tog / ssk / sl 1, k2tog, psso / pattern repeat.

**Division Pattern** (Stitch Guide): `Row 1: (WS) K1, *sl 1 pwise with yarn in front (wyf),
yo; rep from * to last st, k1.` doubles the count (95 → 1 + 93×2 + 1 = **188**), `Row 2: (RS)
K1, *k2tog tbl (slipped st and yo); rep from * to last st, k1.` brings it back (95). Stitch-
guide rows 1–6 are a definition used three times ("Work 6 rows of division patt").

| Section | Count (6 sizes) |
|---|---|
| Back CO | 97, 105, 115, 127, 139, 153 |
| Waist: dec next row + every 8 (8, 8, 8, 10, 10)th row 3 (3, 3, 3, 2, 2) more times | 89, 97, 107, 119, 133, 147 |
| Bust: inc next row + every 10 (10, 8, 8, 12, 12)th row 2 (2, 2, 2, 1, 1) more time(s) | 95, 103, 113, 125, 137, 151 |
| Division patt 6 rows; adjust (dec 4 (4, 4, 6, 6, 8)) | 91, 99, 109, 119, 131, 143 (lace over n − 4) |
| Armholes BO 4 (5, 6, 6, 8, 9) ×2 | 83, 89, 97, 107, 115, 125 |
| dec every RS row 4 (5, 6, 7, 8, 10) times | 75, 79, 85, 93, 99, 105 = shoulder 20 (21, 24, 27, 30, 31) ×2 + neck 35 (37, 37, 39, 39, 43) |
| Front at 9" | 91, 99, 109, 121, 135, 149 → placket `P44 (48, 53, 59, 66, 73), BO 3 sts, purl to end` |
| Each front: finish bust → 46, 50, 55, 61, 67, 74; adjust → 44, 48, 53, 58, 64, 70; BO → 40, 43, 47, 52, 56, 61; armhole dec → 36, 38, 41, 45, 48, 51; neck → 20, 21, 24, 27, 30, 31 | |
| Sleeve CO 62 (63, 69, 77, 81, 87) → adjust 59, 61, 65, 73, 77, 83 → inc 69, 71, 77, 83, 87, 93 → BO 61, 61, 65, 71, 71, 75 → cap decs → **27** → BO 3 ×4 → **15** | |
| Bands: pick up 67 (69, 73, 75, 79, 85) | |
| Neckband: 10 + 17 + 35 + 17 + 10 → 89 (93, 93, 101, 101, 111); Rows 2–17 | 89 → R5 87 → R7 83 → R9 79 → R11 77 → R13 79 → R15 83 → R17 87 (size 1) |

| # | Line | row | side | count | notes |
|---|---|---|---|---|---|
| HE1 | `Turning ridge: (WS) *K1 through back loop (tbl); rep from * across.` | — | ws | prev | label "Turning ridge:" is not a part |
| HE2 | `every 8 (8, 8, 8, 10, 10)th row 3 (3, 3, 3, 2, 2) more times—89 (97, 107, 119, 133, 147) sts rem.` | — | — | explicit | ordinal suffix **after** the vector: `8 (…, 10)th` |
| HE3 | `Adjust st count: (WS) K1, purl to last st and at the same time, dec 4 (4, 4, 6, 6, 8) sts evenly spaced, k1—91 (99, 109, 119, 131, 143) sts rem.` | next | ws | explicit | "evenly spaced" dec — count only from the printed total |
| HE4 | `Placket opening: (WS) P44 (48, 53, 59, 66, 73), BO 3 sts, purl to end of row.` | next | ws | 88 (96, 106, 118, 132, 146) on needle | next line holds 44 (…) for the right front |
| HE5 | `Dec 1 st each end of needle every row 5 (5, 5, 7, 7, 7) times, then every other row 4 (4, 4, 5, 5, 5) times, then every 4th row 3 (3, 3, 2, 3, 3) times, then every other row 4 (4, 5, 4, 4, 7) times, then every row 1 (1, 2, 4, 3, 2) time(s)—27 sts rem.` | cap | — | explicit 27 (all sizes) | five-phase rate line |
| HE6 | `Buttonhole row: (RS) K4 (5, 4, 5, 4, 4), work 2-st one row buttonhole (see Glossary), *k7 (7, 8, 8, 9, 10), work 2-st one row buttonhole; rep from * 5 more times, k7 (8, 7, 8, 7, 7)—7 buttonholes.` | next | rs | 67… (neutral) | `—7 buttonholes` is not a count |
| HE7 | (neckband pick-up, unnumbered = Row 1) `…and k10 (11, 11, 12, 12, 13) held left-front sts—89 (93, 93, 101, 101, 111) sts total.` then `Row 2: Purl.` | 1 (implicit) | rs | explicit 89… | numbering starts at Row 2 |
| HE8 | `Row 3: K27 (28, 28, 31, 31, 34), place marker (pm), k35 (37, 37, 39, 39, 43), pm, k27 (28, 28, 31, 31, 34).` | 3 | rs (parity) | computed 89… | 2 markers at 27, 62 (size 1) |
| HE9 | `Row 7: K1, ssk, knit to first m, ssk, knit to 2 sts before second m, k2tog, knit to last 3 sts, k2tog, k1—4 sts dec'd.` | 7 | rs | prev − 4 | delta −4 |
| HE10 | `Row 12: (turning ridge) *K1tbl; rep from * across.` | 12 | ws (parity) | prev | `(turning ridge)` sits where a side tag goes — not a side |
| HE11 | `Row 17: Rep Row 15—87 (91, 91, 99, 99, 109) sts.` | 17 | rs | explicit | |

### 4d. Icelandic Lace Shawl "Thórdís" (Halldórsdóttir / Noble) — p12–15

Flat triangle **worked from the long lower edges up to the neck point**: CO 339 along the
lower edges, double decreases at the centre-back line and single decreases at both row ends,
finishing at 3 sts; lace border picked up along the CO edge and worked outward with large
increases; optional top border picked up along the row-end edges; crochet loop edging. One size
(76" × 37"), **no gauge printed**, needles Size 4 (3.5 mm) 32" circular. Colour changes on named
rows ("Change to gray-beige, …").

**RS/WS trap.** Main body: `Rows 1, 3, and 5: (Wrong side facing) Knit.` → **odd rows are WS,
even rows are RS**; "(Wrong side facing)" is a side tag. Border: picked-up row "counts as Row 1"
and `Row 2 and every following even-numbered row: K1, purl to last st, k1.` → in the border
**odd rows are RS**.

**Charts.** A (Rows 2–12), B (Rows 14–36), C (Rows 38–56), D (Rows 58–64 + "Repeat"), E
(border Rows 1–15), F (border Rows 17–31); B, D, F are **half charts** read right-to-left then
mirrored left-to-right with ssk/k2tog swapped (k3tog not swapped); D and F have a single centre
st. Charts show RS rows only (even labels on A–D; odd on E–F). Every chart row is also **written
out** in the text (the text is authoritative; "Chart key updated 7/23/07"). Symbols: k, p,
k2tog, ssk, yo, k3tog, `2` = [k1,p1,k1] in next st (glyph), `#` = p1, k2, ppso (glyph), center
back, no stitch.

| Row | Count (explicit) | delta |
|---|---|---|
| CO | 339 | |
| 13 `K168, k2tog, place marker to mark center back, k169—338 sts.` | 338 | −1, marker at 169 |
| 14 | 334 | −4 |
| 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36 | 330, 326, 322, 318, 314, 310, 306, 302, 298, 294, 290 | −4 each |
| 38 and 40 | 286 "after Row 40" | −2 each |
| 42, 44, 46 | 284, 282, 280 | −2 |
| 48 and 50 | 276 after Row 50 | −2 each |
| 52, 54, 56 | 274, 272, 270 | −2 |
| 57 `K134, k2tog, k134—269 sts.` | 269 | −1 |
| 58 | 267 | −2 |
| 60 | 261 | −6 |
| 62, 64 … 122 ("Rows 65-122: Repeat Rows 63 and 64 twenty-nine more times—13 sts.") | 253, 245 … **13** | −8 each (31 dec rows) |
| 124 `Ssk, k3tog 3 times, k2tog—5 sts.` / 126 `K1, k3tog, k1—3 sts.` | 5, 3 | |
| Border: pick up 339 (= Row 1); 15 → 338; 17 → 307; 19 → 309; 21 → 373; 23 → 437; 25 → 501; 27 → 565; 29 → 691; 31 knit | | |

All re-derived from the stitch instructions and agree (e.g. Row 14 consumes 1 + 15×11 + 3 +
15×11 + 3 + 1 = 338, produces 334; Row 29 consumes 13 + 30×18 + 12 = 565, produces 691).

| # | Line | row | side | count | notes |
|---|---|---|---|---|---|
| IC1 | `Rows 1, 3, and 5: (Wrong side facing) Knit. See Chart A for Rows 2-12 .` | **1, 3, 5** (Oxford comma) | **ws** | 339 | the chart reference is for other rows |
| IC2 | `Row 6: Change to gray-beige, k3, *p1, k2, ppso (see Abbreviations in Glossary), yo; rep from * until 3 sts rem, k3.` | 6 | rs (parity) | computed 339 | `ppso` = pass purled st over the 2 → 3 in, 2 out; + yo → neutral; colour change prefix |
| IC3 | `Row 14: Change to dark gray, k1, * k3tog, k3, yo, k2, yo, k3*; rep from * to * 14 times more, k3tog; rep from * to * 15 times, k3tog, k1—334 sts. See Chart B for Rows 14-36.` | 14 | rs | explicit 334 | `* … *` pair; "14 times more" (=15) then "15 times" (=15, not 16) |
| IC4 | `Row 15 and all following odd-numbered rows through Row 35: K1, purl to last st, k1.` | 15, 17, …, 35 | ws | = prev | enumeration by rule |
| IC5 | `Rows 38 and 40: K1, k2tog, purl to last 3 sts, ssk, k1—286 sts after Row 40. See Chart C for Rows 38-56.` | 38, 40 | rs (parity; purled on the RS on purpose) | 288 after 38, **286 after 40** | "after Row 40" — the count belongs to the last row of the enumeration |
| IC6 | `Row 62: Ssk, k3tog, *[k1, p1, k1] into next st, k3tog*; rep from * to * to 3 center back sts, k3tog twice; rep from * to * until 2 sts rem, k2tog—8 sts dec'd.` | 62 | rs | prev − 8 | delta only; "to 3 center back sts" is fill-to |
| IC7 | `Rows 65-122: Repeat Rows 63 and 64 twenty-nine more times—13 sts.` | range 65–122 = repeat 63–64 ×29 | — | explicit 13 | word number; hyphen, not en dash |
| IC8 | `With right side facing and white yarn, pick up and knit 339 sts along the cast-on edge of the shawl. This counts as Row 1 of Chart E. See Chart E for Rows 3-15.` | 1 (border) | rs | 339 | new part "Lace Border" |
| IC9 | `Row 21: Change to medium brown, k3, [yo, k1] twice, *yo, k1, yo, ssk, yo, k3tog, yo, k2tog, [yo, k1] twice; rep from * until 4 sts rem, yo, k1, yo, k3—373 sts.` | 21 | rs | explicit 373 | +64 |
| IC10 | `With right side facing and beige, pick up and knit about 362 sts along top edge of shawl (about 8 sts for every 7 rows).` | — | rs | **null** ("about", "not critical") | must not become an exact count |

### 4e. Spectrum Scarf (Eunny Jang) — p16–17

Flat, 27 sts, garter edges + "One-Row Lace: *P1, yo, k2tog; rep from * to end." (neutral).
`Finished Size: 8" wide and 64" long`. Colour blending: 4 strands held together, swap one
strand "every 28th row" through a 12-line list (`2 strands A` / `2 strands B` / … / `4 strands
C`) — **each pair of list lines is one combination** and none of them is a row or a part.

**PATTERN ERROR (gauge).** `Gauge: 112 sts and 16 rows = 4" in lace patt, after blocking.` —
27 sts make an 8"-wide scarf (≈ 13.5 sts per 4"); "112" cannot be right (likely "12"). The
gauge card must show it as printed; length→rows conversions for this pattern are untrustworthy.

| # | Line | row | count |
|---|---|---|---|
| SP1 | `With 4 strands of A held tog, use the knitted method (see below) to CO 27 sts. Knit 6 rows.` | 6 rows | 27 |
| SP2 | `Next row: K3, work in one-row lace (see Stitch Guide) to last 3 sts, k3.` | next | 27 (computed: 3 + 7×3 + 3) |
| SP3 | `Work 13 more rows in lace patt, keeping first and last 3 sts in garter st.` | 13 rows | 27 |
| SP4 | `Cont in patt and swap one strand every 28th row as foll:` | colour cadence every 28 rows (shape of a cable cadence) | 27 |

### 4f. Tailored Scallops Cardigan (Pam Allen) — p18–23

Flat pieces bottom-up, feather-and-fan (25-st rep) with partial repeats at the edges, garter
ridge every 4th row, armhole shaping drops the partial repeats, **short-row shoulders (wrap &
turn)** on back and fronts, collar = extension of the fronts with short-row shaping, three-
needle BO. **No chart** — everything written. Sizes `33 (36, 39, 45½, 48½)" (84 [91.5, 99,
115.5, 123] cm)` — 5 sizes, `½` glyphs here (not "1/2"). `Gauge: 14½ stitches and 19 rows = 4"
(10 cm) in stockinette stitch with garter ridges using larger needles; 25 stitches (1 pattern
repeat) = 6¼" (16 cm) and 19 rows = 4" (10 cm) in feather and fan pattern`. Needles size 10½
(6.5 mm) and size 10 (6 mm) straight.

**Size-vector traps.** `CO 66 (72 (78, 91, 97) sts` — a **nested open paren typo**; must read
as 66, 72, 78, 91, 97. `Sizes (45½, 48½)" only:` → 2-value vectors `(19, 22)`, `[yo, k1] (2,
3) times`, **`k(0, 4)`** (no space), `[k2tog] (2, 0) times` (0 = skip). `every 8 (6, 6, 0,
0)⏎th row 2 (5, 2, 0, 0) times` — the ordinal `th` is split from the vector by a line wrap.
`k5 (center front sts)`, `K2 (center front sts)`, `k2 (edge sts at side seam)` are notes.

| Piece | Rows | Count (5 sizes) |
|---|---|---|
| Back | CO, knit 4 rows; Rows 1–4 ×20 = 80 rows; BO 4 (4, 5, 5, 7) ×2; dec each end every RS row 3 times; to 8 (8½, 9, 9, 9½)"; short-row shoulders | 66, 72, 78, 91, 97 → 58, 64, 68, 81, 83 → 52, 58, 62, 75, 77 → shoulders 13 (16, 18, 24, 25) + neck BO 26 (26, 26, 27, 27) + 13 (…) |
| Right / Left Front | CO 35 (38, 41, 48, 51); Rows 1–4 ×14 = 56 rows; collar +1 twice… → 38 (41, 44, 51, 54); right front to 79 rows, left front to 80; BO 4 (4, 5, 5, 7); dec 3; shoulder: 18 (18, 18, 19, 19) held for collar, short rows | 34, 37, 39, 46, 47 → 31, 34, 36, 43, 44 → 13, 16, 18, 24, 25 |
| Sleeves | CO 36 (38, 40, 42, 44); Rows 1–4 ×12 = 48 rows; inc to 48 (52, 58, 62, 66); cap BO → 40 (44, 48, 52, 52); decs → **24** | |
| Collars | 18 (18, 18, 19, 19) sts, short-row Rows 1–4 | |

Markers: back Row 3 places a marker before the main pattern and after each full 25-st repeat
(`pm; rep from *`) → 3 (3, 3, 4, 4) markers, at 8 (11, 14, 8, 11) then +25 each. Fronts: 2 (3 for
the two largest sizes). Sleeves: 2 (at 6 and 30 for size 1).

| # | Line | row | side | count | notes |
|---|---|---|---|---|---|
| TS1 | `With smaller needles and using the long-tail method (see Glossary), CO 66 (72 (78, 91, 97) sts. Knit 4 rows.` | — | — | 66, 72, 78, 91, 97 | nested-paren typo |
| TS2 | `Row 3: K2, [k2tog] 2 (3, 4, 2, 3) times, [yo, k1] 2 (3, 4, 2, 3) times, place marker (pm), work center 50 (50, 50, 75, 75) sts for feather and fan patt as *[yo, k1] 4 times, [ssk] 4 times, k1, [k2tog] 4 times, [yo, k1] 4 times, pm; rep from * 1 (1, 1, 2, 2) more time(s), [yo, k1] 2 (3, 4, 2, 3) times, [ssk] 2 (3, 4, 2, 3) times, k2—2 (2, 2, 3, 3) marked full 25-st reps of feather and fan patt at center, 6 (9, 12, 6, 9) sts for partial patt rep on each side of main patt, 2 edge sts at each end of needle.` | 3 | rs (parity) | computed 66… (neutral) | the trailing vectors are **not** stitch counts; `pm` inside the repeat |
| TS3 | `Cont in patt until Rows 1–4 have been worked a total of 20 times, ending with Row 4—80 patt rows total;` | repeat to 20 total | — | prev | `until` = repeat count, not a length |
| TS4 | `Short-row 1: (RS) K13 (16, 18, 24, 25), BO center 26 (26, 26, 27, 27) sts, k7 (8, 9, 12, 13), wrap next st, turn.` | SR 1 | rs | prev − 26 | shortRow; BO inside a short row |
| TS5 | `Short-row 3: K13 (16, 18, 24, 25) to end, working the wrapped st tog with its wrap.` | SR 3 | rs | = prev | shortRow line without `turn` (works to end) |
| TS6 | `Short-row 1: (RS) Place first 18 (18, 18, 19, 19) sts on holder for collar, rejoin yarn with RS facing, knit to last 7 (8, 9, 12, 13) sts, wrap next st, turn—13 (16, 18, 24, 25) sts rem.` | SR 1 | rs | explicit 13… (on needle after holding) | |
| TS7 | `Next row: (RS, Row 1 of patt) K2, yo, slip marker (sl m), work Row 1 of patt as established to end—3 sts in marked center front garter st section.` | next | **rs** (tag carries extra text) | prev + 1 | `—3 sts in …` is a section count, not the row total |
| TS8 | `Sizes (45½, 48½)" only: Work (13, 14) sts for partial patt as k(0, 4), [k1, yo] (2, 0) times, [ssk] (2, 0) times, k1, [k2tog] (2, 3) times, [yo, k1] (2, 3) times, …` | — | — | — | 2-value vectors for sizes 4–5; `k(0, 4)` |
| TS9 | `Cont in patt, inc 1 st each end of needle in this manner every 8 (6, 6, 0, 0)⏎th row 2 (5, 2, 0, 0) times, then every 6 (4, 4, 4, 4)th row 3 (1, 6, 9, 10) time(s)—48 (52, 58, 62, 66) sts.` | — | — | explicit | |
| TS10 | `Row 1: (WS) Knit to last 6 (6, 6, 7, 7) sts, wrap next st, turn.` | 1 (collar) | ws | = prev | shortRow; collar Row 1 is WS on the left collar, RS on the right collar |

### 4g. Penobscot Silk Lace Scarf (Cyrene Slegona) — p24–25

Flat, 33 sts, garter edge sts, centre 25 sts of "Little Arrowhead Lace: (multiple of 6 sts +1)"
(Stitch Guide `Row 1: (RS) …`, `Rows 2 and 4: (WS) Purl.`, `Row 3: …`, `Repeat Rows 1–4 for
pattern.`). `Gauge: 22 sts and 29 rows = 4" in St st.` One size `5¾" wide and 41" long`.
Structure: 8 St st rows, then (28 lace rows + 8 St st rows) × 8 → **296 rows total** (printed).
Markers: 2, at 4 and 29.

| # | Line | count | notes |
|---|---|---|---|
| PE1 | `Next row: (WS) K1 (edge st), p3, place marker (pm), purl to last 4 sts, pm, p3, k1 (edge st)—8 St st rows completed.` | 33 | `—8 St st rows completed` is a row tally, not a count |
| PE2 | `Next row: (RS) K4, slip marker (sl m), work Row 1 of Little Arrowhead Lace patt (see Stitch Guide) over center 25 sts, sl m, k4.` | 33 | stitch-guide row referenced by name |
| PE3 | `Rep the last 36 rows (28 lace rows followed by 8 St st rows) 7 more times—296 rows total from CO edge; eight 28-row lace panels; nine 8-row St st panels.` | 33 | repeat of 36 rows ×7; `296 rows total` is a row total (could feed targetRows) |
| PE4 | `Row 3: K2, *yo, sl 2 kwise as if to k2tog, k1, p2sso, yo, k3; rep from * to last 5 sts, yo, sl 2 kwise as if to k2tog, k1, p2sso, yo, k2.` | 25 (2 + 3×6 + 5) | `rep from * to last 5 sts` remainder; centred double dec spelled out |

### 4h. Lace Fountain Hat (Katie Himmelberg) — p26–27

In the round, bottom-up. `Gauge: 25 sts and 33 rnds = 4" in St st in the rnd.` One size (20"
band). CO 124, 2×2 rib 3/4", inc rnd +20 → 144, 5 rnds, chart Rows 1–61 ("placing m between
each rep") → 84, gather. Markers: 1 contrasting BOR + 11 repeat markers (12 reps of 12 sts).
**Chart `Lace`** (vector): 12 sts × **61 rows** (odd labels 1–61; in the round so all rows are
RS), decreasing to 7 sts (staircase "no stitch" area), key knit / yo / k2tog / pattern repeat.
No written-out version.

| # | Line | row | count | notes |
|---|---|---|---|---|
| LF1 | `CO 124 sts. Place contrasting marker (m) and join for working in the rnd.` | — | 124 | BOR |
| LF2 | `Inc. Rnd: Work in St st (knit all sts) inc 20 sts evenly spaced—144 sts.` | next | explicit 144 | label `Inc. Rnd:` with a period |
| LF3 | `Work Rows 1–61 of Lace chart, placing m between each rep—84 sts rem.` | chart rows 1–61 (called Rows, worked in rnds → side null) | explicit 84 at the end | chart `{name:'Lace', row:1..61}` |

### 4i. Arrowhead Shawl (Pam Allen) — p28–29

Flat triangle **top-down from the centre of the top edge**: CO 7, 4 increases every RS row (1
each side of the centre st, 1 inside each 2-st garter border). `Gauge: 18 sts and 21 rows = 4"
in charted lace pattern, after blocking.` One size. Markers "as indicated by green lines on the
charts" (centre st and garter edges) plus optional repeat markers. **Charts 1 (20 rows, Rows
9–20 repeated) and 2 (8 rows) are not in this PDF.**

| # | Line | row | count | notes |
|---|---|---|---|---|
| AR1 | `CO 7 sts. Work Rows 1–20 according to Chart 1, placing markers (pm) as indicated by green lines on Row 1, …` | 1–20 | 7 → 47 (derived: +4 per RS row) | |
| AR2 | `Rep Rows 9–20 six more times, pm between new patt reps as they become established, if desired—191 sts; 92 rows completed from Chart 1.` | repeat 9–20 ×6 | explicit **191** | `92 rows completed` is a row tally |
| AR3 | `Change to Chart 2, and work Rows 1–8 once—207 sts. BO all sts very loosely on next WS row.` | 1–8 | explicit 207 | |

### 4j. Guanaco and Vicuña Lace Fingerless Gloves (Kaye D. Collins) — p30–33

In the round, cuff up, thumb gusset, picot crochet bind-off, crochet blossom trim. One size
(`Woman's medium to fit a 7–8" hand`). `Gauge: 8 sts and 11 rows = 1" in lace pattern.`
(**per inch**, printed twice). The handspun "Project Notes" block (`Ratio (singles/plying): 17:1
(both).`, `Singles twists per inch: 14.`, `Total yardage: 200.`) is not pattern text and must not
produce rows or counts. `CO 70 sts and divide over 4 dpn needles as follows: 20-20-20-10` — a
**needle distribution**, not a size vector.

**`dbl yo` counts as 2 sts** in this pattern and `k1f&b (in double yo)` turns those 2 loops into
2 sts; with that model every printed count closes (cuff 70 throughout; `Rnd 4 (dec): … p2tog …
(63 sts)`; `Rnd 12 (dec): … k2tog … (56 sts)`). Counts are printed **in parentheses at the end**
`(63 sts)`, not after an em dash.

**Text-layer warning.** p31 is three columns; the extract repeats `around (7 times).` three
times and splits `Rnds 2 and 4: *K3, k1f&b (in double yo), k3, p2; rep from *` from its
`around (7 times).` — the cuff rounds arrive out of order. Quotes below are in printed order.

| # | Line (printed) | row | count | notes |
|---|---|---|---|---|
| GL1 | `Rnds 1 and 3: *K2, k2tog, dbl yo, ssk, k2, p2; rep from * around (7 times).` | 1, 3 | 70 | `(7 times)` = repeat count of `*`, not a size |
| GL2 | `Rep Rounds 1–8 three more times—cuff measures 3".` | repeat 1–8 ×3 | 70 | "Rounds" spelled out |
| GL3 | `Rnd 4 (dec): *K3, k1f&b, k3, p2tog; rep from * around (63 sts).` | 4 | explicit 63 | `(dec)` between number and colon |
| GL4 | `Rnd 1: M1, *k2, k2tog, dbl yo, ssk, k2; rep from * around to last st; pm, M1.` | 1 (hand) | 58 (from Rnd 2) | "to last st" contradicts 7 × 8 = 56 |
| GL5 | `Rnd 7 (inc): As for Rnd 5 to marker; end: sm, yo, k4, yo.` | 7 | prev + 2 | thumb inc on Rnds 4, 7, 10, 13, 16, 19, 22 |
| GL6 | `Rnds 13–20: As for Rnds 5–12, increasing for thumb gusset on Rnds 13, 16, and 19.` | 13–20 | — | |
| GL7 | `Rnds 21–24: As for Rnds 5–8, increasing on Rnd 22. After completing Rnd 24, place 16 thumb gusset sts on a holder.` | 21–24 | 56 on needles | 16 held |
| GL8 | `Rep Rnds 1–4, five more times, for a total of 24 rnds.` | repeat ×5 (comma before "five") | 56 | "Each rep moves the beginning marker 1 st to the left." |
| GL9 | `Knit in the round on 19 thumb sts for 1¼"; do not BO.` | — | 19 | "do not BO" must not trigger a bind-off |

---

## 5. `knit-rico-triangular-shawl.pdf` — Rico "Triangular shawl (Wool Dégradé Super 6)"

2 pages, one column, `garbled false`, 1602 chars, no images or paths. **UK house style.**

**Garment / construction.** Flat, **side-to-side asymmetric triangle**: CO 6, increase 1 st
before the last st on every RS row until half the yarn is used, then decrease the same way to
6 sts, cast off. One size: `Width x Length (approx): 170 x 65 cm // 75 x 25½ in`.

**Gauge / needles.** `TENSION` heading (UK word for gauge): `20 sts and 33 rows to 10 cm (4 in)
over rows of pattern on 3,5 mm needles or the size required to give the correct tension.` —
"to 10 cm" instead of "=", **decimal comma** `3,5 mm`. `NEEDLES 1 pair of 3.5 mm (UK 9 – USA 4)
Rico knitting needles` (UK and US sizes both printed; en dash between them).

**Notation traps.** Row labels end with a **period**: `Row 1. P6.` (no colon). Counts follow the
row as a separate sentence **without a dash**: `Row 3. P5, m1p, p1. 7 sts.` No RS/WS tags;
the text says "inc … in every rs row" and the increases fall on odd rows → **odd = RS** (Row 1,
a purl row, is RS). Numbering **restarts** at the pattern section (`Row 1.`–`Row 8.` after
`Row 16.`). `m1k/m1p according to patt` — slash alternative, either way +1. `patt1`,
`patt2tog` = work 1 / 2 together in pattern.

| Row | Text | Count |
|---|---|---|
| CO | `cast on 6 sts` | 6 |
| 1, 2 | `P6.` / `K6.` | 6 |
| 3 | `P5, m1p, p1. 7 sts.` | 7 |
| 4 | `K7.` | 7 |
| 5 | `K6, m1k, k1. 8 sts.` | 8 |
| 6 / 7 / 8 | `P8.` / `K7, m1k, k1. 9 sts.` / `P9.` | 8, 9, 9 |
| 9 / 10 | `P7, k1, m1k, k1. 10 sts.` / `P3, k7.` | 10, 10 |
| 11 / 12 | `P7, k2, m1p, p1. 11 sts.` / `K2, p2, k7.` | 11, 11 |
| 13–16 | `K10, m1k, k1. 12 sts.` / `P12.` / `K11, m1k, k1. 13 sts.` / `P13.` | 12, 12, 13, 13 |
| pattern 1–8 | odd rows +1 (`… rep from * to last st, m1k/m1p according to patt, patt1.` / `Knit to last st, m1k, k1.`), even rows even | 14, 14, 15, 15, 16, 16, 17, 17 the first time; +4 per 8 rows |

| # | Line | row | side | count | delta | until |
|---|---|---|---|---|---|---|
| R1 | `Weigh ball before starting. Using 3.5 mm needles, and thumb method cast on 6 sts.` | — | — | 6 | — | — |
| R2 | `Row 3. P5, m1p, p1. 7 sts.` | 3 | rs (parity) | explicit 7 | +1 | — |
| R3 | `Row 10. P3, k7.` | 10 | ws | computed 10 | 0 | — |
| R4 | `Now cont in patt as follows and inc 1 st (m1k or m1p, according to patt, before last st) in every rs row:` | — | — | — | +1 per RS row | — (a rule, not a row) |
| R5 | `Row 1. *P7, k2; rep from * to last st, m1k/m1p according to patt, patt1.` | 1 (restart) | rs | prev + 1 (14 first time) | +1 | — |
| R6 | `Row 2. *P2, K7; rep from * to end.` | 2 | ws | = prev | 0 | — |
| R7 | `The last 8 rows set pattern.` | — | — | — | — | repeat of rows 1–8 (open-ended) |
| R8 | `Cont in patt with inc sts as set until half the yarn has been used up, then reverse shaping, i.e. patt to last 3 sts, patt2tog, patt1 in every rs row until 6 sts remain.` | — | — | **null** | +1 then −1 per RS row | **no length/rows `until`** — "half the yarn" is a weight condition, and "until 6 sts remain" is a stitch-count target. Neither may become a `targetRows` or a length. |
| R9 | `Next row. Purl.` then `Cast off knitwise.` | next | ws | 6 | — | — |

Note the 9-st repeat `*P7, k2*` does not divide the growing count — the increases are absorbed
"according to patt"; the parser must keep the count at prev + 1 and not try to fit whole
repeats. `MEASUREMENTS`, `MATERIAL`, `NEEDLES`, `TENSION`, `INSTRUCTION`, `TO MAKE UP` are
headings, not parts.

---

## 6. `knit-sandnes-0216.pdf` — Sandnes Garn booklet 0216EN "Babies & Children" (lookbook only)

23 pages (landscape spreads 1190 × 842), `garbled false`, **2804 chars**, `emptyPages [14]`.
**This file contains no knitting instructions at all.** It is the photo catalogue for booklet
0216; p23 says `Instructions sold with yarn from Sandnes Garn only`. Each model carries a small
info box (needle icon + size, a stitch-gauge icon `N | 10` = N sts per 10 cm, "Booklet 0216EN",
model number with difficulty dots, age range). The CONTRACT's description ("several garments,
numeric sizes") does not match the file; treat it as an **import negative test**: importing it
must produce no rows, no phantom parts from "Model 1" … "Model 23", and no gauge with rows.

**Text-layer traps.** The `½` in needle sizes is **not in the text layer** (needle 5½ arrives as
`5`, 3½ as `3`, 4½ as `4`, 2½-3 as `2 -3`); difficulty dots `••` arrive as `--`; on p17 the age
range `1-12` arrives as control characters (` YEARS, ONE SIZE`) and the needle values of
Models 15 & 16 are missing. Model 11 is **crochet** (hook icon, `7 Puffm | 10` = 7 puff
stitches per 10 cm). Two-model spreads interleave both boxes in one extracted block.

| Model | Name (where printed) | Yarn | Needle printed / in text layer | Gauge (sts/10 cm) | Ages |
|---|---|---|---|---|---|
| 1 | FRESKO | Duo, Tynn Merinoull | 5½ / `5` | 15 | 2-12 years |
| 2 | FLOWER CARDIGAN | Duo | 3½ / `3` | 22 | 2-12 years |
| 3 | — | Merinoull | 4 | 20 | 1-8 years |
| 4 | — | Duo | 4 | 20 | 1-8 years |
| 5 | — | Duo | 3½ / `3` | 22 | 2-12 years |
| 6 | — | Alpakka Silke | 3 | 27 | 0-4 years |
| 7, 8 | — | Alpakka Silke | 3 | 27 | 3 months-4 years |
| 9, 10 | — | Babyull Lanett | 3 | 27 | 3 months-4 years |
| 11 (crochet) | — | Merinoull | hook 4½ / `4` | 7 puff | one size |
| 12 A,C | NANCY | Babyull Lanett | 2½-3 / `2 -3` | 30-27 | 3 months-4 years |
| 13 | — | Babyull Lanett | 2½-3 / `2 -3` | 30-27 | 3 months-4 years |
| 14 | — | Smart, Tweed | 7 | 12 | 2-12 years |
| 15 & 16 | JOSHUA / ANGUS | Smart, Tweed | 4-5 + hook 5½ / (missing) | — | 1-12 years, one size |
| 17 | EMMA | Smart, Tweed | 8 | 11 | 2-12 years |
| 18 | — | Smart | 4 | 20 | 2-12 years |
| 19, 20 | — | Mini Alpakka | 3 | 27 | 2-12 years |
| 21 | — | Alpakka, Silk Mohair | 7 | 14 | 2-12 years |
| 22 | — | Mini Alpakka | 3 | 27 | 2-12 years |
| 23 | BABY BLANKET | Babyull Lanett | 3 | 27 | one size |

Age ranges (`2-12 years`, `3 months-4 years`) are the only "sizes" and they are ranges, not a
size list; `detectSizes` must not turn `2-12` into sizes 2 and 12.

---

## 7. `knit-apl-nicoll.pdf` — Maud Churchill Nicoll, *Knitting and Sewing: How to Make Seventy Useful Articles for Men in the Army and Navy* (George H. Doran, New York, 1918)

207 pages, **scanned images, no text layer** (`chars 3824` all from p1–2: the APL cover sheet
"This scan was contributed by On-Line Digital Archive of Documents on Weaving and Related Topics"
and `www.antiquepatternlibrary.org`; `emptyPages` 3–207). Public domain. Anything the app reads
from it comes from OCR. Book page numbers equal PDF page numbers in the knitting section
(PDF p125 = "[125]", p140 = "[140]"); roman front matter, contents on PDF p9–11.

Knitting contents (book pages): Preliminary Instructions 17, Simple Helmet 20, Balaclava Helmet
23, Peary Helmet 26, Sleeping Helmet 30, Skull Cap 32, Cap and Muffler Combined 33, Muffler in
Basket Stitch 35, Muffler in Plain Stitch 37, Five Fancy Stitches for Mufflers 38, Scarf 44,
Chest Protector 46, Singlet 49, Plain Armlet 52, Ribbed Armlet 54, Gloves 56, Fingerless Gloves
61, Mittens 63, Rifle Mittens 67, Steering Mittens 70, Heavy Steering Mittens 73, Thumbless
Half-Mittens 77, Doddies 79, Hand Protectors 84, Wristlets 86, Mine-Sweeper's Gloves 87,
"Mellor" Mine-Sweeper's Gloves 93, Plain Jersey 97, Naval Jersey 100, Coat Sweater 105, Coat
Sweater in Lighter Weight 108, Knitted Waistcoat in Block Stitch 112, Three Fancy Stitches for
Waistcoats 114, Body Belt (Shaped) 117, (Circular) 119, (Ribbed) 121, Knee Caps 123, **Plain
Socks 125**, Heavier Socks in 6-ply Fingering 136, Heavier Socks in 3-ply Wheeling 138, Ribbed
Socks 142, Trench Stockings 144, then shooting/bed socks, crochet and sewing items to p207.

**Style.** 1918 prose: no abbreviations, no RS/WS, rounds counted in words ("Knit 90 plain
rounds"), heel rows as `1st row.` … `16th and last row.` with hanging indents, narrowing
described per needle ("1st needle. … 2nd needle. … 3rd needle."), "narrow" = decrease round.
Single size; gauge by rounds only: "11-12 rounds of plain knitting to the inch" on "size 14"
steel needles (old British wire gauge).

### 7a. Plain Socks — PDF p125–132 (ground truth for the OCR route)

Top-down sock on 4 needles (5th for gusset pick-up), k2 p2 rib, flap heel with a **centre-split
heel turn that decreases 2 in Row 1 and 3 in the last row**, gussets, wedge toe, grafted
("darning in the weave"). Materials: `5 steel knitting needles, size 14. 5 ounces of 4 or 5-ply
fingering`.

| Section | Rounds/rows | Count |
|---|---|---|
| The Set | `Cast on 80 stitches loosely on 3 needles, 28 stitches on the 1st needle, 24 stitches on the 2nd needle, and 28 stitches on the 3rd needle.` | 80 (28 + 24 + 28) |
| Rib | knit 2, purl 2 for 45 rounds = 4 inches | 80 |
| First plain round | `Knit every 7th and 8th stitches together in the front loops of the stitches; do this 9 times; then knit the succeeding 3rd and 4th stitches together; do this twice.` → "decreased 11 stitches, leaving 69" | **69** (72 → 63, 8 → 6) |
| Leg | `Knit 90 plain rounds, which will equal 8 inches` | 69 |
| Back of the heel (flap) | 17 + 18 = 35 sts; 2nd row purl 34, 3rd row knit 34, "Repeat 3rd and 4th rows of heel until you have knitted 29 rows and have 15 slipped stitches on each side"; turn on the 30th (purling) row | 35 (instep 34 left on 2 needles) |
| Turn the heel | 1st row `Slip 1, purl 14, purl the next 2 stitches together, purl 3, purl the next 2 stitches together. Stop right here` (−2); 2nd–15th rows −1 each (`slip 1, knit 4, knit 2 stitches together in the back loops` … `slip 1, purl 16, purl the last 2 stitches together`); `16th and last row. Slip 1, knit 5, knit the next 2 stitches together in the back loops of the stitches, knit 1, knit the next 2 stitches together in the front loops of the stitches, knit 6, knit the last 2 stitches together in the back loops of the stitches.` (−3) | 33, 32, 31 … 19 → **16** ("reduced to 16 stitches") |
| Gussets | pick up 15 each side; "You now have 80 stitches for the round, divided as follows: 23 stitches on needle No. 1, 34 stitches on needle No. 2, 23 stitches on needle No. 3" | 80 |
| Narrow for the gussets | needle 1 −1 at end, needle 3 −1 at start; 2 plain rounds; "Repeat the above narrowing 5 times … You will have 6 narrowings, all told, having decreased 12 stitches, which leaves 68" | 68 |
| Foot | `Knit 55 plain rounds for the foot, which will equal 5 inches.` | 68 |
| Narrow for the toe | −4 per narrowing; Narrow, 2 plain ×3 rounds… (N,2,N,2,N,2,N,2,N,1,N,1,N,1,N,1, then "Narrow 5 rounds in succession") → "decreased 52 stitches in 25 rounds and have reduced your sock to 16 stitches"; 1 plain round = the 26th | 68 → **16** |
| Finish | darning in the weave (Kitchener) | — |

Expected parser output on OCR'd text: rows only where a row number is printed (`1st row.` …
`16th and last row.` in the heel), counts only where printed (`leaving 69`, `35 stitches on one
needle`, `reduced to 16 stitches`, `80 stitches for the round`, `leaves 68`, `16 stitches`),
`until` none (all lengths are given as round counts **and** inches: "45 rounds = 4 inches" — the
round count is the target, the inches are a note). Every printed count re-derives correctly.

---

## Cross-fixture summary (read this if you read nothing else)

**Size vectors come in at least nine shapes**: `36 (38-38-40-44-46)` (hyphens, Bernat);
`(256-260-⏎272)` (bare, partial, wrapped); `56 (64, 72)` (commas); `6 1/2 (7 1/2, 8, 9, 9 3/4)`
and `9 1/4 ,` (spaced fractions, space before comma); `33 (36, 39, 45½, 48½)` (½ glyphs); `66
(72 (78, 91, 97)` (nested typo); `k(0, 4)` (no space); `14th (9th, 14th, 9th)` and `8 (8, 8,
8, 10, 10)th` (ordinals); `7 (8 or 9)` ("or"); and the typo'd magic-loop vectors (`3 (3 3)`,
`5 (6, 08`, `0 ()`). Two-column instruction vectors on a six-size garment (Flying Trapeze).
Size-conditionals: `Sizes XL, 2/3XL and 4/5XL only:`, `Size 7" (18 cm) only:`, `Toddler size
only:` / `all other sizes:`, `Size Medium only:`, `Sizes (45½, 48½)" only:`, `****Row 7: 40
stitch sock only:`.

**Side tags**: `(RS)`/`(WS)` after the colon (`Row 1: (RS)`), before it (`Short-row 1 (RS)`),
with a period (`1st row:(RS).`), without parentheses (`Row 1: RS (Set-up row)`), with extra
text (`(RS, Row 1 of patt)`), spelled out (`(Wrong side facing)`), and impostors in the same
slot (`(dec rnd)`, `(turning ridge)`, `(dec)`, `(inc)`, `(thumb inc)`). Parity is **not** a safe
default: Icelandic shawl body has even = RS, Albus Argyle flips parity between chart repeats,
Genome's second-half heel starts with `Row 1: (WS)`.

**Counts**: after an em dash (`—56 (64, 72) sts rem`), as a sentence (`44 (46-46-48-52-54)
sts.`, `7 sts.`), in parentheses (`(63 sts)`), "after Row 40", per needle (`39 (43) sts on
Needle 1`, `24 (27, 31) stitches on each needle point…a total of 48 (54, 62)` — the total is
the count), and many **non-count** numbers after a dash (`—4 (4, 5) sets of crossed sts`, `—7
buttonholes`, `—8 St st rows completed`, `—3 sts in marked center front garter st section`,
`leaving 5 (6, 8) stitches unworked`, `21 (25…) heel sts worked`).

**Short rows**: `turn`, `turn work`, `TURN`, `wrap next st, turn`, `w&t` (none use the
abbreviation `w&t` literally in these fixtures!), yo short rows (`Yo backward`), and false
positives in the round (`Turn work, position needle point` on magic loop; Albus Argyle's
intarsia-in-the-round `turn` is a full row; `do not turn`).

**Charts**: every chart in the seven fixtures is a **vector drawing or absent** — no fixture has
a full glyph-font chart. Only the Icelandic shawl (lace p15) has two glyph symbols (`#`, `2`)
mixed with path symbols. `KnitChart` cannot be asserted cell-by-cell against any fixture on
hand; it can be asserted to return `null` cells (or `[]`) on all of them. A glyph-font chart
fixture is gap #1 below.

**Extractor bugs found (owner of `js/pdftext.js`)**: three-column pages interleave columns line
by line — socks p15 (Flying Trapeze), socks p20 (On-Your-Toes), lace p31 (gloves); overlay
duplicate text on socks p4, p8–9; Sandnes `½` and age-range glyphs missing from the text layer;
Albus Argyle chart label `45` not emitted.

---

## 8. What the fixtures do not cover

Free / openly published patterns that would fill each gap. "Free" ≠ open licence: most are free
to read for personal use with all rights reserved — fine as local, gitignored fixtures under the
same rule as the rest of `tmp-pdf/`, never committed. Nothing here was downloaded; verify the
terms on the page before fetching.

| Gap | Why it matters | Candidate (URL) | Terms (as far as verified) |
|---|---|---|---|
| **Glyph-font chart** (symbols as text in a knitting font, e.g. Stitchmastery / Knit Visualizer / Aire River fonts) | `KnitChart` is untestable on real data without one; every chart we have is vector | Any Stitchmastery-exported PDF; Yarnspirations Patons cable patterns below may qualify — check with `fontsOf` on the dump page (a symbol font with many single-char items) before adopting | per pattern |
| **Cabled sweater** (`C6F`/`C4B` family, "cable every 8th row", charted + written cables) | cable cadence, `cable:{every}`, cable widths, 3D cable twist | Patons "Mock Neck Cable Pullover" https://www.yarnspirations.com/products/patons-cable-knit-mock-neck-pullover (XS/S–4/5XL, 3 cable panels); Patons "My Boyfriend's Cable Knit Pullover" https://www.yarnspirations.com/products/patons-my-boyfriends-cable-knit-pullover (XS/S–4/5XL); Patons "Boxy Cabled Crew Pullover" https://www.yarnspirations.com/products/patons-boxy-cabled-crew-knit-pullover | Yarnspirations free patterns, Spinrite copyright, no sign-up (same provenance as the Bernat fixture) |
| **Cabled yoke / colourwork yoke** (round yoke with charted decreases) | yoke dec rounds inside a chart, BOR handling | Patons "Cabled Yoke Pullover" https://www.yarnspirations.com/products/patons-cabled-yoke-pullover | as above (listing says a yarn is discontinued; pattern still free) |
| **DROPS-style terse, translated pattern** (numeric sizes S–XXXL in parallel columns, "work A.1", cm only, "repeat from *-*") | DROPS house style is the most common free pattern source in Europe | garnstudio.com free pattern catalogue (e.g. DROPS top-down raglan sweaters such as "Lilla Camilla", listed by knittingpatternsgalore.com SKU 13564) — https://www.garnstudio.com | free online, © DROPS Design, all rights reserved; garnstudio.com refused automated fetch (HTTP 403) so terms are **unverified** here |
| **Top-down raglan with back-neck short rows (German short rows)**, PetiteKnit/Sandnes style, metric, numeric child sizes | short-row sub-counter at the back neck, Scandinavian phrasing, real Sandnes instructions (our Sandnes file has none) | Sandnes Garn free pattern "Sweater w/raglan worked from neck down" (2–12 years) via sandnesgarn.de pattern downloads (the search hit was a direct file link `sandnesgarn.de/mpattachment/file/download/id/738`; not opened). Adult paid equivalent for comparison only: Purline Sweater https://www.ravelry.com/patterns/library/purline-sweater (€5.50, do not use) | free from Sandnes Garn, licence not stated; PetiteKnit raglans are all paid |
| **Beginner top-down raglan, very wide size range** (0–6 mo to 6XL, garter panel) | 10+ sizes in one vector | Tin Can Knits "Flax" (free; Flax Light and Flax DK variants) — https://tincanknits.com and https://www.ravelry.com/patterns/library/flax-dk | free, © Tin Can Knits, licence not stated |
| **Explicit two-at-a-time socks** (instructions written for both socks on one magic loop) | `Part.linked` UI is unexercised by any fixture | KnitFreedom free toe-up magic-loop socks https://www.knitfreedom.com/free-patterns/socks/ (sign-up gated — do not create an account); Very Pink tutorial https://verypink.com/2014/06/04/two-socks-at-a-time-toe-up-magic-loop/ (video/blog, PDF paid) | sign-up / paid — weak; no clean free fixture found |
| **Public-domain text-layer knitting** (needs no OCR; 19th–20th c. phrasing) | Nicoll is scan-only; a PD text corpus allows assertions without OCR | Project Gutenberg: *The Stocking-Knitter's Manual* (Cupples) https://www.gutenberg.org/ebooks/57273; *The Lady's Knitting-Book* (Corbould) https://www.gutenberg.org/ebooks/62646; *Handbook of Wool Knitting and Crochet* https://www.gutenberg.org/files/26113/26113-h/26113-h.htm; *Begin to Knit* (American Thread Co.) https://www.gutenberg.org/files/61105/61105-h/61105-h.htm | Project Gutenberg licence; public domain in the USA (Begin to Knit's status not confirmed) |
| **Knitspeak / plain-text lace with a formal grammar** | validates the twelve-line acceptance list in the brainstorm doc | stitch-maps.com knitspeak grammar https://stitch-maps.com/about/knitspeak/ | grammar documentation; individual stitch patterns © their authors |
| **Not covered and no candidate chosen**: brioche (`brk`, `brp`, two-colour), double knitting, entrelac, steeks, flat intarsia with a picture chart, a hat with a written crown-decrease sequence in the round (the lace hat is chart-only), a cardigan knitted in one piece with picked-up button bands worked sideways | each has its own counting rules | search Yarnspirations / Gutenberg first (provenance already accepted) | — |

---

# Batch 2 (2026-10-22, owner `knit-research-2`)

Nine fixtures added to `tmp-pdf/` on 2026-10-22 (provenance in `tmp-pdf/SOURCES.md`). Same
conventions as "How to read this file" above. For the PDFs the quotes are the app's text layer
(`pdftext.dump.html`); for the four Gutenberg `.txt` books the quotes are the file itself
(UTF-8, hard-wrapped at ~70 columns — wraps are joined with one space here; `⏎` marks a wrap
inside a number list as above). Cable notation below: `w` = stitches the crossing spans,
`cross` = `f` (held in front: C4F, C6F, T3F, Tw4L …) or `b` (held in back: C4B, C6B, T3B,
Tw4R …).

## 9. `knit-patons-mockneck-cable.pdf` — Patons "Cable Knit Mock Neck Pullover" (PAK0129-035656M, March 5, 2024; designer Gayle Bunn)

4 pages, landscape 792×612, 4 columns per text page, `garbled false`, 9340 chars. Text layer is
clean and in reading order. Not emitted (correctly): running header/footer, "SHOP KIT",
"Gayle Bunn / Designer". p4 = end of Sleeves, Finishing, the three charts, schematics, photo.

**Garment / construction.** Aran-style drop-shoulder pullover (square armholes) worked **flat
in pieces**: Back, Front (left and right neck worked separately after a centre holder), Sleeves
(one "SLEEVES" heading, no make-count printed, nothing about two-at-a-time), neckband picked up
flat after the right shoulder seam and folded in half to WS ("mock neck"). Every row has a
RS/WS; nothing is in the round. Three cable panels (A, B, C) are written out row by row on p2
**and** charted on p4.

**Sizes.** 6 sizes, `XS/S (M-L-XL-2/3XL-4/5XL)` exactly as Bernat (hyphens inside the
parentheses, `/` inside labels). Printed: "The instructions are written for XS/S size. If
changes are necessary for larger sizes the instructions will be written XS/S
(M-L-XL-2/3XL-4/5XL). Numbers for each size are shown in the same color throughout the
pattern. When only one number is given in black, it applies to all sizes." (colour is lost in
the text layer — irrelevant to parsing). Single values apply to all sizes (`81 sts.`,
`15½" [39.5 cm]`, `22 sts`). Chest table lines (`XS/S 28-34" [71-86.5 cm]`) are measurements.

**Gauge / needles (verbatim).**
- `20 sts and 26 rows = 4" [10 cm] in stocking st with larger needles.` (heading `GAUGE`) →
  `{sts:20, rows:26, over:4, unit:'in'}`, needle = larger = 4.5 mm / US 7.
- `Sizes U.S. 6 (4 mm) and U.S. 7 (4.5 mm) Susan Bates® Silvalume® knitting needles or size
  needed to obtain gauge.` — needle line starting with "Sizes" (same trap as Bernat).
- `2 Susan Bates® stitch holders. Susan Bates® cable needle. Susan Bates® yarn needle.`
- Yarn table `Sizes XS/S M L` / `Blue Fog 8 9 10 balls` / `(77770) 1400/1274 1620/1474
  1880/1710 yds/m` / `Sizes XL 2/3XL 4/5XL` / `Blue Fog 11 13 15 balls` — not a size line, not
  instructions. Stray icon text `MEDIUM` / `KNIT I` / `4` (yarn-weight and skill icons) and
  `SKILL LEVEL: INTERMEDIATE` arrive in the middle of the abbreviation list.

**Abbreviations** (p1, `ABBR = Meaning`, meanings wrap over many lines): Alt, Approx (`Approx =`
then `Approximately` on the next line), Beg, **C4F, C4B, C6F, C6B, T3F, T3B, Tw4R, Tw4L** (each
a 4–6 line definition containing `K2, then K2 from cable needle.` — glossary text, never rows),
Cont, Dec, Inc, K, M1, P, Pat, Rem, Rep, RS, St(s), WS.

| Abbr | Definition (printed) | `w` | `cross` | produces |
|---|---|---|---|---|
| C4F | sl 2 to cn, front; K2, K2 from cn | 4 | f | 4 knit |
| C4B | sl 2 to cn, back; K2, K2 from cn | 4 | b | 4 knit |
| C6F | sl 3 to cn, front; K3, K3 from cn | 6 | f | 6 knit |
| C6B | sl 3 to cn, back; K3, K3 from cn | 6 | b | 6 knit |
| T3F | sl **2** to cn, front; **P1**, K2 from cn | 3 | f | p1 + k2 (knit travels left) |
| T3B | sl **1** to cn, back; K2, P1 from cn | 3 | b | k2 + p1 (knit travels right) |
| Tw4R | sl 2 to cn, back; K2, (P1. K1) from cn | 4 | b | not in the contract list — a 4-st twist with a p1 k1 tail |
| Tw4L | sl 2 to cn, front; (K1. P1), K2 from cn | 4 | f | ditto |

**Notation.** Row labels are ordinals with the side after the colon: `1st row: (RS).` (space,
then period). Impostor before the side tag: `Next row (inc row): (WS).` Sentences end with
periods (`P2. K3. P2.`). Repeats: `*…*` + `Rep from * to * once more` (single asterisks on both
ends, worked twice in total), `(P2. K3) 0 (1-2-3-5-6) time(s)` (a group repeated **0 times**
for XS/S — it contributes nothing), `(K1. P1) 5 times`, `(T3B. P2. T3F) 3 times`. Copies:
`4th row: As 2nd row.`, `7th to 12th rows: As 1st to 6th rows.` (a **range** copied from a
range), `24th to 27th rows: Rep last 4 rows once more.`, `Work from ** to ** as given for
Back.` — the Back's `**` marks are glued to text: `**With smaller needles, cast on …` and
`… 136 (140-150-156-166-176) sts.**`. Inline sub-headers with a colon inside a part:
`Armhole shaping:`, `Shoulder shaping:`, `Left Neck shaping:`, `Right Neck shaping:`,
`Neckband:` (only the last is a new part). Own-line headers: `BACK`, `FRONT`, `SLEEVES`,
`FINISHING`. "Cast off" (never "bind off").

### Cable panels (written on p2, charted on p4)

All rows re-derived: every written row of every panel adds up to its panel width.

| Panel | Width | Rows | Crossing rows (RS only; WS rows never cross) | Row copies |
|---|---|---|---|---|
| Panel Pat A | 24 | 24 | every RS row: 1 T3F,T3B ×3; **3 C4F ×3**; 5 T3B,T3F ×3; 7–11 = 1–5; 13 T3B,T3F ×3; **15 C4B ×2**; 17 T3B,T3F ×2; 19 T3F,T3B ×2; **21 = 15 (C4B ×2)**; 23 T3F,T3B ×3. C4 crossings every 6 rows (3, 9, 15, 21) | 4=2, 7–12=1–6, 16=14, 20=14, 21=15, 22=14, 24=6 |
| Panel Pat B | 17 | 28 | 1 Tw4R,Tw4L; 3, 5, 7, 9 T3B,T3F; 11, 13, 15, 17 T3F,T3B; **19 C4F,C4B**; **21 C4B,C4F**; 23 none; **25 (=21) C4B,C4F**; 27 (=23) none | 12=8, 14=6, 16=4, 18=2, 22=20, 24–27 = 20–23, 28=20 |
| Panel Pat C | 9 | 12 | **3 C6F** (`C6F. K3.`), **9 C6B** (`K3. C6B.`) — a 6-row cadence alternating front/back | `2nd and every alt row: Purl.` + a redundant `12th row: Purl.` |

No line states a cadence ("cable every N rows"), so `Line.cable` stays **null** on every line;
the counter's cable ring must take crossing rows from the panel definitions. The three panels
run together: on garment row *n* (counting the set-up `1st row` as 1) panel A is on row
((n−1) mod 24)+1, B on ((n−1) mod 28)+1, C on ((n−1) mod 12)+1; the combination repeats every
168 rows (longer than any piece), so "Cont in pat" lines carry no panel row — the app has to
count it.

### Charts (p4)

| Chart (title in text layer) | Size | Numbering | Written twin | Cells |
|---|---|---|---|---|
| `PANEL PAT A` | 24 sts × 24 rows | odd 1–23 at right, even 2–24 at left, `Start Here` bottom right | Panel Pat A, p2 | vector |
| `PANEL PAT B` (also `Panel Pat B` — the title is in the text layer twice) | 17 × 28 | odd right 1–27, even left 2–28 | Panel Pat B, p2 | vector |
| `PANEL PAT C` | 9 × 12 | odd right 1–11, even left 2–12 | Panel Pat C, p2 | vector |

The grid, knit/purl cells and cable strokes are **vector paths**. The **only glyphs inside the
charts are the cable-width digits** printed on each cable symbol (`3` on T3F/T3B, `4` on C4F/C4B/
Tw4R/Tw4L, `6` on C6F/C6B, 5–10 pt, on the cable's row) plus the row numbers. So a reader can
locate *which rows carry a cable of which width* from glyphs, but not its direction or the
knit/purl cells. **The key is not in the text layer** (`Key`, `= Knit on RS rows. Purl on WS
rows`, `= C6B` … are outlined vector text). Expect `KnitChart.fromHandle` → three charts with
`null` cells (or `[]`), never invented cells. The extract interleaves the digits with the row
numbers and with column-1 text (`4 4 25`, `3 3 17`, `6 9`, `PANEL PAT B Panel Pat B`); the p4
extract after `Sew side and Sleeve seams.` is chart and schematic debris (`BODY`, `6 9`, `8`,
`7`, … `Start Here`, `SLEEVE`) — none of it may become rows.

### Sections (Mock Neck)

| Section | Rows | Stitch counts (XS/S, M, L, XL, 2/3XL, 4/5XL) |
|---|---|---|
| Back — rib | CO; rib Rows 1 (RS) & 2 (WS), "Rep last 2 rows for 2" [5 cm], ending on a 1st row" | 130,138,146,154,174,186 (all 4n+2 ✓) |
| Back — inc row | 1 WS row, M1 ×14,16,18,20,20,18 | **144,154,164,174,194,204** ✓ |
| Back — pattern | Rows 1 (RS) & 2 (WS) set the panels (layout C·B·C·A·C·B·C with (K3. P2) edge rib), "Cont in pat … until work from beg measures 15½" [39.5 cm], ending on a WS row" | 144 + 10×(0,1,2,3,5,6) ✓ |
| Back — armholes | cast off 4,7,7,9,14,14 at beg of next 2 rows | **136,140,150,156,166,176** ✓ |
| Back — even | until armholes 9½ (10-10½-10½-11-11)" [24 (25.5-26.5-26.5-28-28) cm], ending WS | same |
| Back — shoulders | cast off 15,15,17,18,19,20 at beg of next 4 rows, then 16,16,17,17,18,21 at beg of next 2 rows (6 rows); rem to holder | printed **44,46,48,50,54,54** — M computes **48** (PATTERN ERROR) |
| Front | `Work from ** to ** as given for Back` (= rib … armholes), then even until armholes 6 (6½-7-7-7½-7½)" [15 (16.5-18-18-19-19) cm], ending WS | 136,140,150,156,166,176 |
| Left neck | Next row (RS): pat across 55,56,60,62,65,70, **Turn**, rest on spare needle; dec 1 at neck edge on next 9 rows | 55,56,60,62,65,70 → **46,47,51,53,56,61** ✓ |
| Left shoulder | even to Back's shoulder row, ending WS; cast off 15,15,17,18,19,20 beg next (RS) and following alt row, 1 row even, cast off rem 16,16,17,17,18,21 → 5 rows | 46 = 15+15+16 ✓; **M: 47 − 30 = 17 ≠ 16**; L, XL, 2/3XL, 4/5XL ✓ |
| Right neck | slip centre 26,28,30,32,36,36 to holder, rejoin, pat to end (RS); dec 1 at neck edge on next 9 rows; even ending **RS**; shoulder as left, starting on a WS row | 55… → 46,47,51,53,56,61 (55+26+55 = 136 ✓ … 70+36+70 = 176 ✓) |
| Sleeves (each) — rib | CO; 2" [5 cm] (K2. P2) rib "as given for Back ending on a 1st row" | 58,58,62,62,66,66 |
| Sleeves — inc row | WS, M1 ×23,23,19,19,15,15 | **81** all sizes ✓ |
| Sleeves — pattern + incs | Rows 1–2 set panels B·C·B with (K3. P2) edges; +2 on next (row 3) and every RS row to 89,103,103,107,119,119 (4,11,11,13,19,19 inc rows), then every 4th row to 133,137,143,143,147,147 (22,17,20,18,14,14 inc rows); last inc on pattern row 97,91,103,99,95,95 | 81 → 89… → **133,137,143,143,147,147** ✓ |
| Sleeves — even | until 18½ (19-20-20-19-19)" [47 (48-51-51-48-48) cm], ending WS; cast off | same |
| Neckband | pick up 22 + K26…(dec 3) + 22 + K44…(dec 5) | **106,110,114,118,126,126** ✓ (22+23+22+39 = 106 …; all 4n+2); 3½" [9 cm] (K2. P2) rib beginning and ending on a 2nd row (WS); cast off loosely; fold to WS |

**PATTERN ERROR — size M (keep as printed).** After the armholes M has 140 sts; the shoulders
cast off 4×15 + 2×16 = 92 → **48** remain, printed `Leave rem 44 (46-…)`. Front M: 56 − 9 = 47
(printed 47 ✓) but the shoulder casts off 15 + 15 + 16 = 46, leaving 1 st. Every other size adds
up on both pieces, and the neckband total (110 = 22 + 25 + 22 + 41) agrees with the printed 46 on
the holder. Likely intended: armhole cast-off 8 for M (154 − 16 = 138). The parser reports 140 /
46 / 47 as printed; a deviation hint on the back-shoulder line for M is correct.

**Measurement error (not a count).** `Finished chest XS/S 41" [96.5 cm]` and `M 44" [101.5 cm]`:
41" = 104 cm, 44" = 112 cm (the schematic half-chest 20½ (22-…) confirms the inches). L–4/5XL
convert correctly.

**Markers.** No stitch markers anywhere (`markers` null on every line). `Place markers on side
edges of Sleeves ¾ (1-1-1½-2-2)" [2 (2.5-2.5-3-5-5) cm] down from cast off edge.` is a seaming
marker on the fabric edge, not a stitch marker.

**Short rows: none.** `Left Neck shaping: Next row: (RS). Pat across 55 (…) sts (neck edge).
Turn.` contains `Turn.` but it **divides the work** (the other sts wait on a spare needle and
are worked later) — `shortRow` must be **false**. Same for every "Pat across N sts. Turn." neck
split in the other Patons files.

### Hard lines (Mock Neck)

| # | Line (verbatim, wraps joined) | row | side | count | delta | until | shortRow | chart / cable | notes |
|---|---|---|---|---|---|---|---|---|---|
| M1 | `**With smaller needles, cast on 130 (138-146-154-174-186) sts.` | — (CO) | — | 130,138,146,154,174,186 | — | — | no | — | Part Back. Leading `**` is a repeat marker. |
| M2 | `1st row: (RS). K2. *P2. K2. Rep from * to end of row.` | 1 | rs | = prev | 0 | — | no | — | |
| M3 | `2nd row: P2. *K2. P2. Rep from * to end of row.` | 2 | ws (parity) | = prev | 0 | — | no | — | |
| M4 | `Rep last 2 rows for 2" [5 cm], ending on a 1st row.` | repeat 1–2 | — | prev | 0 | `{length, 2, in, endOn:'rs'}` (5 cm) | no | — | "ending on a 1st row" = RS. |
| M5 | `Next row (inc row): (WS). *Rib across 8 (8-7-7-8-9) sts. M1. Rep from * 13 (15-17-19-19-17) times more. Rib to end of row. 144 (154-⏎164-174-194-204) sts.` | next | **ws** (not "inc row") | explicit 144,154,164,174,194,204 | +14,16,18,20,20,18 | — | no | — | "times more" → 14…18 reps. |
| M6 | `1st row: (RS). K2. (P2. K3) 0 (1-2-3-⏎5-6) time(s). P2. *Work 1st row of Panel Pat C. P2. K3. P2. Work 1st row of Panel Pat B. P2. K3. P2. Work 1st row of Panel Pat C. P2.* K3. P2. Work 1st row of Panel Pat A. P2. K3. P2. Rep from * to * once more. (K3. P2) 0 (1-2-3-5-6) time(s). K2.` | 1 (restart) | rs | computed 144… (no printed total) | 0 | — | no | panels C,B,C,A,C,B,C row 1 | `*…*` ×2; group ×0 for XS/S. 144 + 10n. |
| M7 | `2nd row: P2. (K2. P3) 0 (1-2-3-5-⏎6) time(s). K2. *Work 2nd row of Panel Pat C. K2. P3. K2. Work 2nd row of Panel Pat B. K2. P3. K2. Work 2nd row of Panel Pat C. K2.* P3. K2. Work 2nd row of Panel Pat A. K2. P3. K2. Rep from * to * once more. (P3. K2) 0 (1-2-3-5-6) time(s). P2.` | 2 | ws | = prev | 0 | — | no | panels row 2 | |
| M8 | `Cont in pat, keeping cont of Panel Pats and (K3. P2) ribbing at side edges as placed in last 2 rows, until work from beg measures 15½" [39.5 cm], ending on a WS row.` | — | — | prev | 0 | `{length, 15.5, in, endOn:'ws'}` — **one value for all sizes** | no | — | |
| M9 | `Armhole shaping: Keeping cont of pat, cast off 4 (7-7-9-14-14) sts beg next 2 rows. 136 (140-150-⏎156-166-176) sts.**` | 2 rows | rs, ws | explicit 136,140,150,156,166,176 | −8,−14,−14,−18,−28,−28 | — | no | — | Trailing `**` must not break the count. Sub-header, not a new part. |
| M10 | `Cont even in pat until armholes measures 9½ (10-10½-10½-11-⏎11)" [24 (25.5-26.5-26.5-28-28) cm], ending on a WS row.` | — | — | prev | 0 | length 9.5,10,10.5,10.5,11,11 in, endOn ws | no | — | |
| M11 | `Shoulder shaping: Cast off 15 (15-17-18-19-20) sts beg next 4 rows, then 16 (16-17-17-18-21) sts beg following 2 rows. Leave rem 44 (46-⏎48-50-54-54) sts on a st holder.` | 6 rows | — | explicit 44,**46**,48,50,54,54 (M computes 48) | −92,−92,−102,−106,−112,−122 | — | no | — | Held sts; Back ends. |
| M12 | `Work from ** to ** as given for Back.` | copy | — | 136,140,150,156,166,176 after | — | — | no | — | Part Front. Expands to M1–M9. |
| M13 | `Cont even in pat until armholes measure 6 (6½-7-7-7½-7½)" [15 (16.5-18-18-19-19) cm], ending on a WS row.` | — | — | prev | 0 | length 6,6.5,7,7,7.5,7.5 in, ws | no | — | |
| M14 | `Left Neck shaping: Next row: (RS). Pat across 55 (56-60-62-65-70) sts (neck edge). Turn. Leave rem sts on a spare needle.` | next | rs | 55,56,60,62,65,70 in work | (held, not decreased) | — | **no** (`Turn` divides) | — | "(neck edge)" is not a side tag. |
| M15 | `Dec 1 st at neck edge on next 9 rows. 46 (47-51-53-56-61) sts.` | 9 rows | alternating | explicit 46,47,51,53,56,61 | −1/row (−9) | `{rows, 9}` | no | — | |
| M16 | `Cont even in pat until left armhole measures same length as Back to beg of shoulder shaping, ending on a WS row.` | — | — | prev | 0 | relative, no number (no row target); endOn ws | no | — | |
| M17 | `Shoulder shaping: Cast off 15 (15-17-18-19-20) sts beg next and following alt row. Work 1 row even. Cast off rem 16 (16-17-17-⏎18-21) sts.` | 5 rows | rs first | 0 at the end | — | — | no | — | M has 17 before the last row, prints 16. |
| M18 | `Right Neck shaping: With RS facing slip next 26 (28-30-32-36-⏎36) sts from spare needle onto a st holder. Join yarn to rem sts and pat to end of row.` | next | rs (implied by "With RS facing"; not a tag) | computed 55,56,60,62,65,70 | — | — | no | — | |
| M19 | `Cont even in pat until right armhole measures same length as Back to beg of shoulder shaping, ending on a RS row.` | — | — | prev | 0 | relative; endOn **rs** | no | — | Right shoulder casts off on WS rows. |
| M20 | `With smaller needles cast on 58 (58-62-62-66-66) sts.` | CO | — | 58,58,62,62,66,66 | — | — | no | — | Part Sleeves. |
| M21 | `Work 2" [5 cm] in (K2. P2) ribbing as given for Back ending on a 1st row.` | — | — | prev | 0 | length 2 in, endOn rs | no | — | Cross-part reference. |
| M22 | `Next row (inc row): (WS). *Rib across 2 (2-3-3-4-4) sts. M1. Rep from * 22 (22-18-18-14-14) times more. Rib to end of row. 81 sts.` | next | ws | explicit **81** (single value = all sizes) | +23,23,19,19,15,15 | — | no | — | |
| M23 | `1st row: (RS). P2. (K3. P2) twice. Work 1st row of Panel Pat B. P2. K3. P2. Work 1st row of Panel Pat C. P2. K3. P2. Work 1st row of Panel Pat B. (P2. K3) twice. P2.` | 1 | rs | computed 81 | 0 | — | no | panels B,C,B row 1 | 2+10+17+7+9+7+17+10+2 = 81. |
| M24 | `Cont in pat, keeping cont of Panel Pats and (K3. P2) ribbing at side edges as placed in last 2 rows, inc 1 st each end of needle on next and every RS row to 89 (103-103-107-⏎119-119) sts, then every following 4th row until there are 133 (137-⏎143-143-147-147) sts, taking inc sts into (K3. P2) ribbing at sides.` | — (two-stage shaping) | — | explicit end 133,137,143,143,147,147 (intermediate 89,103,103,107,119,119) | +2 per inc row; 26,28,31,31,33,33 inc rows | none (count target, not length) | no | — | `to N sts` / `until there are N sts` are count targets. |
| M25 | `Cont even in pat until Sleeve from beg measures 18½ (19-20-20-19-⏎19)" [47 (48-51-51-48-48) cm], ending on a WS row. Cast off.` | — | — | prev | 0 | length 18.5,19,20,20,19,19 in, ws | no | — | |
| M26 | `Neckband: Sew right shoulder seam. With RS facing and smaller needles, pick up and knit 22 sts down left front neck edge. K26 (28-⏎30-32-36-36) from front st holder, dec 3 sts evenly across. Pick up and knit 22 sts up right front neck edge. K44 (46-48-50-54-54) from back st holder, dec 5 sts evenly across. 106 (110-114-118-126-126) sts.` | — (setup) | — | explicit 106,110,114,118,126,126 | — | — | no | — | Inline part header after `FINISHING` and the blocking sentence. |
| M27 | `Beg and ending on a 2nd row work 3½" [9 cm] in (K2. P2) ribbing as given for Back. Cast off loosely in ribbing.` | — | ws first | prev | 0 | length 3.5 in, endOn ws | no | — | Then `bo` all. |
| MA1 | `1st row: (RS). P1. (T3F. T3B. P2) twice. T3F. T3B. P1.` | 1 of Panel A | rs | 24 (panel) | 0 | — | no | T3F,T3B ×3 (w3) | Under `Panel Pat A (worked over 24 sts)` — a stitch-pattern definition, not a garment part. |
| MA2 | `7th to 12th rows: As 1st to 6th rows.` | 7–12 | rs/ws | 24 | 0 | — | no | — | Range copy. |
| MA3 | `13th row: (T3B. P2. T3F) 3 times.` | 13 | rs | 24 | 0 | — | no | T3B,T3F ×3 | |
| MB1 | `1st row: (RS). P4. Tw4R. P1. Tw4L. P4.` | 1 of Panel B | rs | 17 | 0 | — | no | Tw4R (w4,b), Tw4L (w4,f) | |
| MB2 | `24th to 27th rows: Rep last 4 rows once more.` | 24–27 (= 20–23) | ws,rs,ws,rs | 17 | 0 | — | no | row 25 crosses | |
| MC1 | `2nd and every alt row: Purl.` | 2,4,6,8,10,12 | ws | 9 | 0 | — | no | — | Then `12th row: Purl.` restates row 12. |
| MC2 | `3rd row: C6F. K3.` | 3 of Panel C | rs | 9 | 0 | — | no | C6F (w6,f) | Also `9th row: K3. C6B.` |

Note for `knits-parser`: one row works three panels at once (`Work 1st row of Panel Pat C …
Panel Pat B … Panel Pat A`); `Line.chart` as specified holds one `{name,row}`. Either make it a
list or keep the first; in both cases the panel names must resolve to the `Panel Pat X`
definition blocks (glossary / stitch guide), and those blocks must **not** become garment parts.

## 10. `knit-patons-boyfriend-cable.pdf` — Patons "My Boyfriend's Cable Knit Pullover" (PAK0129-029645M, March 16, 2023; designer Gayle Bunn)

5 pages, landscape, 4 columns, `garbled false`, 12059 chars. p5 = schematics, charts, key.

**Garment / construction.** Raglan pullover worked **flat in pieces**, bottom-up: Back (box
stitch), Front (box stitch at the sides + 5 cable panels), Sleeves (box stitch + Panel A), raglan
seams sewn, then a long twisted-rib neckband (6", folded in half to WS) picked up from the two
sleeve holders, front neck and back holder, flat (left back raglan left open, sewn after).
No stitch markers, no short rows, no charts-only instructions.

**Sizes.** 6 sizes XS/S, M, L, XL, 2/3XL, 4/5XL. **No size line spells the order out**: "The
instructions are written for smallest size. If changes are necessary for larger sizes the
instructions will be written thus ( )." — the labels come only from the `SIZES` table
(`XS/S 28-34" [71-86.5 cm]` … `4/5XL 56-62 [142-157.5 cm]` (no `"`)) and the yarn table
`Sizes XS/S M L XL 2/3XL 4/5XL`. Vectors use hyphens as in the other Patons files.
Size-conditional blocks: `Size 4/5XL only:` (one size, single values `74 sts rem.`),
`Sizes XS/S, M, L and XL only:` (4 values `18 (14-14-6)`), `Sizes 2/3XL and 4/5XL only:`
(2 values `(2-11)`, `(95-71)`), `Sizes XS/S, M and L only:` (3 values `11 (7-7)`,
`41 (41-43)`), **`Sizes L, 2/3XL and 4/5XL only:` — three NON-ADJACENT sizes (3, 5, 6) with a
bare 3-value vector `(61-63-65)`** — and `All sizes:` (ends a block; also prefixes a row label:
`All sizes: 1st row: K2. ssk. …`).

**Gauge / needles (verbatim).** `15 sts and 20 rows = 4" [10 cm] in stocking st with larger
needles.` → `{sts:15, rows:20, over:4, unit:'in'}`, larger = 6 mm / US 10. `Sizes U.S. 8 (5 mm)
and U.S. 10 (6 mm) Susan Bates® Silvalume® knitting needles or size needed to obtain gauge.
Susan Bates® Cable needle. Susan Bates® 4 st holders. Yarn needle.` Two alternative yarns:
`Pewter Tweed (67044) 8 9 10 11 13 15 balls` then `OR Patons® Shetland Chunky™ …` /
`7 8 9 10 12 14 balls` (a bare number row — not a size vector, not a row). Icon text `BULKY`,
`5`, `KNIT I`, `BULKY`, `ABULTADO` precedes the abbreviations.

**Abbreviations** (p1): Alt, Beg, **C4B, Cr4F, Cr4B**, Cont, Dec, Inc, K, K1tbl, K2tog, P,
P1tbl, P2tog, P2togtbl, Pat, Psso, Rem, Rep, RS, Ssk, St(s), **T2F, T2B, T3F**, Tog, WS, Yo
(Psso and Yo are listed but never used). Some definitions end without a period
(`K2, then K2 from cable needle` / `K1, then K3 from cable needle`).

| Abbr | Definition (printed) | `w` | `cross` | note |
|---|---|---|---|---|
| C4B | sl 2 to cn, back; K2, K2 from cn | 4 | b | |
| Cr4F | sl **1** to cn, front; K3, K1 from cn | 4 | f | 1-over-3 |
| Cr4B | sl **3** to cn, back; K1, K3 from cn | 4 | b | 3-over-1 |
| T2F | sl 1 to cn, front; P1, K1tbl from cn | 2 | f | twisted travelling st |
| T2B | sl 1 to cn, back; K1tbl, P1 from cn | 2 | b | |
| T3F | sl 1 to cn, front; **K1tbl, P1, then K1tbl from cn** | 3 | f | **not the mock-neck T3F** (there: sl 2, P1, K2 from cn). `Knits.glossary` must prefer the pattern's own definition. |

### Cable panels (p2; all rows re-derived, every row adds up)

| Panel | Width | Rows | Crossing rows | Copies |
|---|---|---|---|---|
| CABLE PANEL A (`(worked over⏎15 sts).` — the width is on the next line) | 15 | 22 | 1 T3F; 3, 5, 7, 9, 11 T2B + T2F (travelling out); 13, 15, 17, 19, 21 T2F + T2B (travelling in) — every RS row crosses | 14=10, 16=8, 18=6, 20=4, 22=2 |
| CABLE PANEL B | 13 | 4 | 1 (Cr4F + Cr4B) — every 4 rows | 4=2 |
| CABLE PANEL C | 6 | 6 | 3 (C4B) — every 6 rows | 4=2, `5th and 6th rows: As 1st and 2nd rows.` |

No "every N rows" line is printed; `Line.cable` stays null; the cadence comes from the panels
(Front works A, B ×2, C ×2 together: LCM(22, 4, 6) = 132 rows).

### Charts (p5)

| Chart | Size | Numbering | In text layer | Written twin |
|---|---|---|---|---|
| Cable Panel A | 15 × 22 | **odd rows only** (1–21) at the right; WS rows and the top row 22 unnumbered; `Start Here` | title, row numbers, the width digit `2`/`3` on each cable, `Start Here` | Panel A p2 |
| Cable Panel B | 13 × 4 | 1, 3 at right | **nothing** (title, numbers, cells all vector) | Panel B p2 |
| Cable Panel C | 6 × 6 | 1, 3, 5 at right | **nothing** | Panel C p2 |

Cells and key are vector (the key `= T2B`, `= P1tbl` … is not in the text layer). Expect
`KnitChart` → `null` cells for A and nothing found (or `null`) for B and C.

### Sections (Boyfriend)

| Section | Rows | Counts (XS/S, M, L, XL, 2/3XL, 4/5XL) |
|---|---|---|
| Back — twisted rib | CO; Rows 1–2 (`*P1. K1tbl.` / `*K1. P1tbl.`, odd counts ✓); 4" [10 cm] ending on a 2nd row, +3 evenly on the last row | 73,77,85,93,105,117 → **76,80,88,96,108,120** ✓ |
| Back — Box St Pat | 4-row pattern (all counts multiples of 4 ✓) until 17 (17-16½-16½-16-16)" [43 (43-42-42-40.5-40.5) cm], ending WS | same |
| Back — raglan cast-off | 2 rows, −2 each | **72,76,84,92,104,116** ✓ |
| Back — 4/5XL only | rows 1–2 (−2 each) ×10, then row 1 once, then a WS row → 22 rows | —,—,—,—,—,**74** ✓ (116 − 40 − 2) |
| Back — all sizes | 4-row block (−2, −2, −2, 0) ×1,3,4,8,12,7 | **66,58,60,44,32,32** ✓ |
| Back — XS/S–XL only | 2-row block (−2, 0) ×19,15,15,7 | 28,28,30,30,—,— ✓ |
| Back — end | rem to holder | **28,28,30,30,32,32** ✓ (raglan rows: 44,44,48,48,50,52) |
| Front — rib | `Work from ** to **` (CO + rib rows 1–2), then 4" ending on a 2nd row, +8 evenly | **81,85,93,101,113,125** ✓ |
| Front — pattern | Rows 1–4 set Box St at the sides and panels C·B·A·B·C (73 sts of panels + borders) | 73 + 8×(1,1,2,3,5,6) + 2×(0,2,2,2,0,2) ✓ |
| Front — even | until same length as Back to raglans, ending WS | same |
| Front — raglan cast-off | 2 rows | **77,81,89,97,109,121** ✓ |
| Front — 2/3XL, 4/5XL only | rows 1–2 ×3, ×12, then row 1 once, then a WS row | —,—,—,—,**95,71** ✓ |
| Front — all sizes | 4-row block ×2,4,5,9,7,3 | **65,57,59,43,53,53** ✓ |
| Front — XS/S, M, L only | 2-row block ×12,8,8 | **41,41,43**,—,—,— ✓ (XL stays 43) |
| Front neck XS/S–XL | row 1: K2, ssk, pat 7, **Turn** → 10 on the left; neck −1 on next 4 rows + raglan −1 on alt rows (rows 3, 5) → 4; then 6 rows (`Next row:` ×6) → 1, fasten off. Centre 19,19,21,21 to holder; right side mirrors (11 → 10 → 4 → 1) | 11 + 19 + 11 = 41 ✓, 11 + 21 + 11 = 43 ✓ |
| Front neck 2/3XL, 4/5XL | row 1: K2, ssk, pat 12, **Turn** → 15; rows 2–13 → 13, 11, 10, 8, 6, 5, 5, **4** (row 9 prints `4 sts rem.`), 3, 2, 2, 1; centre 21; right side rows 1–13 → 15, 13, 11, 10, 8, 6, 5, 5, **4**, 3, 2, 2, 1 | 16 + 21 + 16 = 53 ✓ |
| Sleeves — rib | CO; 2½" [6 cm] twisted rib ending on a 2nd row, +2 (2-2-4-4-4) | 35,35,35,37,37,37 → **37,37,37,41,41,41** ✓ |
| Sleeves — pattern | Rows 1–4: Box St · P2 border · K1tbl · Panel A · K1tbl · P2 border · Box St | 37 + 2×(0,0,0,2,2,2) ✓ |
| Sleeves — incs 1 | +2 on next row and every following 6th (6th-4th-6th-4th-4th) row → 11,11,4,10,3,4 inc rows | **59,59,45,61,47,49** ✓ |
| Sleeves — incs 2 (L, 2/3XL, 4/5XL) | +2 every following 6th row → 8 inc rows each | —,—,**61**,—,**63,65** ✓ |
| Sleeves — even | until 18 (18-17½-17½-17-16½)" [45.5 (45.5-44.5-44.5-43-42) cm], ending WS | 59,59,61,61,63,65 |
| Sleeves — raglan cast-off | 2 rows | **55,55,57,57,59,61** ✓ |
| Sleeves — XS/S–XL only | 4-row block ×2,2,1,1 | **43,43,51,51**,—,— ✓ |
| Sleeves — all sizes | 2-row block (−2, 0) ×17,17,21,21,24,**23** | printed **9,9,9,9,11,11**; 4/5XL computes **15** (PATTERN ERROR) |
| Neckband | K9 + 11 + K19 (−2) + 11 + K9 + K28 (per size) | **85,85,89,89,95,95** ✓ (all odd for twisted rib ✓); 6" [15 cm] beginning on a 2nd row; cast off |

**PATTERN ERROR — Sleeves 4/5XL (keep as printed).** `Rep last 2 rows 16 (16-20-20-23-22)
times more. Leave rem 9 (9-9-9-11-11) sts`: 4/5XL has 61 after the raglan cast-off; 23 × (−2)
= −46 → **15**, not 11. The raglan row counts confirm it: Back 4/5XL = 2 + 22 + 28 = 52 rows,
Sleeve = 2 + 46 = 48 rows; every other size matches Back exactly (44, 44, 48, 48, 50). The
intended number is 24 (→ 11 sts, 52 rows).

**PATTERN ERROR — Sleeves 3rd row (typo in a vector).** `3rd row: K0 (0-0-2-2-22). (P2. K2)
twice. …` — the 4/5XL value prints `22`; rows 1, 2, 4 and the closing `K0 (0-0-2-2-2)` of the
same row all say 2. The sleeve has 41 sts; reading 22 would give 61. Report as printed, flag.
Same row spells `K1tBL` (mixed case) — must still be K1tbl.

**Extractor bug — printed rows missing from the text layer (owner of `js/pdftext.js`).** Three
identical printed lines `2nd row: P2. P2tog. Pat to last 4 sts. P2togtbl. P2.` are **dropped**
by `PdfText.extract`:
1. p2 col 4, Back `Size 4/5XL only:` 2nd row (listed under "not emitted" on the dump page),
2. p3 col 3, Front `All sizes:` 2nd row (not listed as lost because the same words are emitted
   in col 1),
3. p4 col 3, Sleeves `Sizes XS/S, M, L and XL only:` 2nd row (same).
The extract therefore reads `1st row … 3rd row: As 1st row. 4th row: …` with no 2nd row. The
same 2-line run occurs on p2, p3 (twice) and p4, which looks like the cross-page / overlay
duplicate filter (`crossPageSuspects` and friends) treating a repeated pattern line as hidden
duplicate text. Until fixed, the parser sees a missing row 2 in three blocks: it must **not**
renumber, and every "Rep last 4 rows" block will be one decrease short per repeat if it
assumes the missing row is a plain row — fixture assertions should use the printed counts
(66…, 65…, 43…), which are all correct.

**Text-layer details.** `Rep last 2 rows Twisted Ribbing.` / `Pat for 4" [10 cm], …` (Back)
has a printed period that splits the sentence across a column break; the Front has the same
sentence without the period. `**With smaller needles, cast on 73` / `(77-85-93-105-117) sts.`
wraps **before** the parenthesis. `CABLE PANEL A (worked over` / `15 sts).` / `(See chart on
page 5).` — panel headers in caps. Ordinal vector `every following 6th (6th-4th-6th-4th- 4th)
row` (a space inside before the last item).

**Short rows: none.** `Turn.` in both `Shape neck: 1st row:` lines divides the work →
`shortRow:false`. **Markers: none.**

### Hard lines (Boyfriend)

| # | Line (verbatim, wraps joined) | row | side | count | delta | until | shortRow | chart / cable | notes |
|---|---|---|---|---|---|---|---|---|---|
| F1 | `**With smaller needles, cast on 73 (77-85-93-105-117) sts.` | CO | — | 73,77,85,93,105,117 | — | — | no | — | Wrap before `(`. Part Back. |
| F2 | `1st row: (RS). *P1. K1tbl. Rep from * to last st. P1.` | 1 | rs | = prev | 0 | — | no | — | |
| F3 | `2nd row: *K1. P1tbl. Rep from * to last st. K1.**` | 2 | ws | = prev | 0 | — | no | — | Closing `**`. |
| F4 | `Rep last 2 rows Twisted Ribbing. Pat for 4" [10 cm], ending on a 2nd row and inc 3 sts evenly across last row. 76 (80-88-96-108-120) sts.` | repeat 1–2 | — | explicit 76,80,88,96,108,120 | +3 on the last row | length 4 in (10 cm), endOn ws | no | — | "Twisted Ribbing Pat" is the stitch name split by a printed period. |
| F5 | `1st row: (RS). *K2. P2. Rep from * to end of row.` | 1 (restart) | rs | = prev | 0 | — | no | — | Box St Pat rows 1–4, `These 4 rows form Box St Pat.` |
| F6 | `Cont in Box St Pat until work from beg measures 17 (17-16½-16½-⏎16-16)" [43 (43-42-42-40.5-40.5) cm], ending on a WS row.` | — | — | prev | 0 | length 17,17,16.5,16.5,16,16 in, ws | no | — | |
| F7 | `Shape raglans: Keeping cont of pat, cast off 2 sts beg next 2 rows. 72 (76-84-92-104-116) sts rem.` | 2 rows | rs, ws | explicit 72,76,84,92,104,116 | −4 | — | no | — | Sub-header. |
| F8 | `Size 4/5XL only: 1st row: (RS). K2. ssk. Pat to last 4 sts. K2tog. K2.` | 1 | rs | (116 → 114) | −2 | — | no | — | Only size 6; dropped for the others. |
| F9 | `2nd row: P2. P2tog. Pat to last 4 sts. P2togtbl. P2.` | 2 | ws | 112 | −2 | — | no | — | **Printed, missing from the text layer.** |
| F10 | `Rep last 2 rows 9 times more, then 1st row once. 74 sts rem.` | repeat 1–2 ×9 + row 1 | — | explicit 74 (size 6 only) | −2/row | — | no | — | "then 1st row once" tail. |
| F11 | `Next row: (WS). P3. Pat to last 3 sts. P3.` | next | ws | = prev | 0 | — | no | — | |
| F12 | `All sizes: 1st row: K2. ssk. Pat to last 4 sts. K2tog. K2.` | 1 | rs (parity, no tag) | −2 | −2 | — | no | — | `All sizes:` before the row label ends the conditional. |
| F13 | `Rep last 4 rows 0 (2-3-7-11-6) times more. 66 (58-60-44-32-32) sts rem.` | repeat 1–4 | — | explicit 66,58,60,44,32,32 | −6/block | — | no | — | `times` = **0** for XS/S. |
| F14 | `Sizes XS/S, M, L and XL only: 1st row: K2. ssk. Pat to last 4 sts. K2tog. K2.` + `2nd row: P3. Pat to last 3 sts. P3.` + `Rep last 2 rows 18 (14-14-6) times more.` | 1, 2, repeat | rs, ws | none printed (computed 28,28,30,30) | −2/block | — | no | — | 4-value vector inside a 4-size block. |
| F15 | `All sizes: Leave rem 28 (28-30-30-⏎32-32) sts on a st holder.` | — | — | explicit 28,28,30,30,32,32 | — | — | no | — | |
| F16 | `Rep last 2 rows Twisted Ribbing Pat for 4" [10 cm], ending on a 2nd row and inc 8 sts evenly across last row. 81 (85-93-101-113-125) sts.` | repeat | — | explicit 81,85,93,101,113,125 | +8 | length 4 in, ws | no | — | Front, after `Work from ** to ** as given for Back.` |
| F17 | `1st row: (RS). P0 (2-2-2-0-2). (K2. P2) 1 (1-2-3-5-6) time(s). Work 1st row Cable Panel C. P2. K2. P4. K1tbl. Work 1st row Cable Panel B. K1tbl. Work 1st row Cable Panel A. K1tbl. Work 1st row Cable Panel B. K1tbl. P4. K2. P2. Work 1st row Cable Panel C. (P2. K2) 1 (1-⏎2-3-5-6) time(s). P0 (2-2-2-0-2).` | 1 | rs | computed 81… | 0 | — | no | panels C,B,A,B,C row 1 | `P0` = zero sts for some sizes. |
| F18 | `3rd row: K0 (2-2-2-0-2). (P2. K2) 1 (1-2-3-5-6) time(s). Work 3rd row Cable Panel C. (K2. P2) twice. K1tbl. Work 3rd row Cable Panel B. K1tbl. Work 3rd row Cable Panel A. K1tbl. Work 3rd row Cable Panel B across next 13 sts. K1tbl. (P2. K2) twice. Work 3rd row Cable Panel C. (K2. P2) 1 (1-2-3-5-6) time(s). K0 (2-2-2-0-2).` | 3 | rs (parity) | = prev | 0 | — | no | panels row 3 (C crosses) | "across next 13 sts" variant. |
| F19 | `Sizes 2/3XL and 4/5XL only: 1st row: (RS). K2. ssk. Pat to last 4 sts. K2tog. K2.` … `Rep last 2 rows (2-11) times more, then 1st row once. (95-71) sts rem.` | 1, 2, repeat | rs, ws | explicit —,—,—,—,95,71 | −2/row | — | no | — | Bare 2-value vectors. |
| F20 | `Rep last 4 rows 1 (3-4-8-6-2) time(s) more. 65 (57-59-43-53-53) sts rem.` | repeat 1–4 | — | explicit 65,57,59,43,53,53 | −6/block | — | no | — | Front block whose 2nd row is missing from the text layer. |
| F21 | `Sizes XS/S, M and L only: 1st row: K2. ssk. Pat to last 4 sts. K2tog. K2.` … `Rep last 2 rows 11 (7-7) times more. 41 (41-43) sts rem.` | 1, 2, repeat | — | explicit 41,41,43,—,—,— | −2/block | — | no | — | 3-value vectors. |
| F22 | `Sizes XS/S, M, L and XL only: Shape neck: 1st row: (RS). K2. ssk. Pat across next 7 sts (neck edge). Turn. Leave rem sts on a st holder.` | 1 | rs | computed 10 (left side) | −1 | — | **no** | — | Conditional + sub-header + row label on one line. |
| F23 | `Dec 1 st at neck edge on next 4 rows, AT SAME TIME, dec 1 st at raglan edge (as before) on every following alt row until 4 sts rem.` | 4 rows | — | explicit target 4 | −1 per row + −1 on rows 3, 5 | — | no | — | `AT SAME TIME`: two shapings in one line. |
| F24 | `Next row: (WS). P4.` / `Next row: K2. ssk.` / `Next row: P3.` / `Next row: K1. ssk.` / `Next row: P2.` / `Next row: ssk. Fasten off.` | 6 × next | ws, rs, ws, rs, ws, rs | computed 4, 3, 3, 2, 2, 1 | | — | no | — | Six consecutive `Next row:` labels. |
| F25 | `With RS facing, slip center 19 (19-⏎21-21) sts onto a st holder. Join yarn to rem sts. Pat to last 4 sts. K2tog. K2.` | next | rs (implied) | computed 10 | −1 | — | no | — | 4-value vector (block XS/S–XL). |
| F26 | `Sizes 2/3XL and 4/5XL only: Shape neck: 1st row: (RS). K2. ssk. Pat across next 12 sts (neck edge). Turn. Leave rem sts on a st holder.` | 1 | rs | computed 15 | −1 | — | **no** | — | |
| F27 | `9th row: As 7th row. 4 sts rem.` | 9 | rs (parity) | explicit 4 | −1 | — | no | — | |
| F28 | `1st row: Pat to last 4 sts. K2tog. K2.` (right side after `With RS facing, slip center 21 sts onto a st holder. Join yarn to rem sts.`) | 1 (restart) | rs (untagged) | computed 15 | −1 | — | no | — | Numbering restarts for the second side. |
| F29 | `With smaller needles, cast on 35 (35-35-37-37-37) sts.` | CO | — | 35,35,35,37,37,37 | — | — | no | — | Part Sleeves. |
| F30 | `Work 2½" [6 cm] in Twisted Ribbing Pat as given for Back, ending on a 2nd row and inc 2 (2-2-4-4-4) sts evenly across last row. 37 (37-37-⏎41-41-41) sts.` | — | — | explicit 37,37,37,41,41,41 | +2,2,2,4,4,4 | length 2.5 in (6 cm), ws | no | — | |
| F31 | `3rd row: K0 (0-0-2-2-22). (P2. K2) twice. P2. K1tbl. Work 3rd row Cable Panel A. K1tBL. P2. (K2. P2) twice. K0 (0-0-2-2-2).` | 3 | rs (parity) | = prev (37/41) | 0 | — | no | Panel A row 3 | Typo `22` for 4/5XL; `K1tBL`. |
| F32 | `Cont in pat, inc 1 st each end of next row and every following 6th (6th-4th-6th-4th- 4th) row until there are 59 (59-45-61-47-49) sts, taking inc sts into Box St Pat.` | — | — | explicit target 59,59,45,61,47,49 | +2 per inc row | none (count target); interval vector of ordinals 6,6,4,6,4,4 | no | — | |
| F33 | `Sizes L, 2/3XL and 4/5XL only: Inc 1 st each end of every following 6th row until there are (61-63-⏎65) sts, taking inc sts into Box St Pat.` | — | — | explicit —,—,61,—,63,65 | +2 | — | no | — | **Non-adjacent sizes**: the 3 values map to sizes 3, 5, 6. |
| F34 | `All sizes: Cont even in pat until work from beg measures 18 (18-⏎17½-17½-17-16½)" [45.5 (45.5-⏎44.5-44.5-43-42) cm], ending on a WS row.` | — | — | prev | 0 | length 18,18,17.5,17.5,17,16.5 in, ws | no | — | |
| F35 | `Sizes XS/S, M, L and XL only: 1st row: (RS). K2. ssk. …` … `Rep last 4 rows 1 (1-0-0) time more. 43 (43-51-51) sts rem.` | 1–4, repeat | — | explicit 43,43,51,51,—,— | −6/block | — | no | — | Block whose 2nd row is missing from the text layer. |
| F36 | `Rep last 2 rows 16 (16-20-20-⏎23-22) times more. Leave rem 9 (9-⏎9-9-11-11) sts on a st holder.` | repeat 1–2 | — | explicit 9,9,9,9,11,**11** (4/5XL computes 15) | −2/block | — | no | — | PATTERN ERROR above. |
| F37 | `Neckband: Sew raglan seams, leaving left back raglan seam open. With RS facing and smaller needles, K9 (9-9-9-11-11) from left sleeve st holder. Pick up and knit 11 sts down left front neck edge. K19 (19-⏎21-21-21-21) from front st holder, dec 2 sts evenly across. Pick up and knit 11 sts up right front neck edge. K9 (9-9-9-11-11) from right sleeve st holder. K28 (28-30-30-32-32) from back st holder. 85 (85-89-89-⏎95-95) sts.` | setup | — | explicit 85,85,89,89,95,95 | — | — | no | — | |
| F38 | `Beg on a 2nd row, work 6" [15 cm] in Twisted Ribbing Pat as given for Back. Cast off loosely in ribbing.` | — | ws first | prev | 0 | length 6 in | no | — | |
| FA1 | `1st row: (RS). P6. T3F. P6.` | 1 of Panel A | rs | 15 | 0 | — | no | T3F (w3, f, twisted) | |
| FA2 | `3rd row: P5. T2B. K1. T2F. P5.` | 3 | rs | 15 | 0 | — | no | T2B (w2,b), T2F (w2,f) | |
| FB1 | `1st row: (RS). P2. Cr4F. K1. Cr4B. P2.` | 1 of Panel B | rs | 13 | 0 | — | no | Cr4F (w4,f), Cr4B (w4,b) | |
| FC1 | `3rd row: P1. C4B. P1.` | 3 of Panel C | rs | 6 | 0 | — | no | C4B (w4,b) | |
| FC2 | `5th and 6th rows: As 1st and 2nd rows.` | 5, 6 | rs, ws | 6 | 0 | — | no | — | Pair copied from a pair. |

## 11. `knit-patons-boxy-cable.pdf` — Patons "Boxy Cabled Crew Knit Pullover" (PAK0129-002641M; designer Gayle Bunn)

6 pages, landscape, up to 4 columns, `garbled false`, 10524 chars. p1 abbreviations/materials/
sizes, p2–p4 instructions, p5 charts + key, p6 schematic (numbers only — never rows).

**Garment / construction.** Boxy crew-neck pullover worked **flat in pieces, Front first**
(the `**…**` block is in FRONT; `BACK: Work from ** to ** as given for Front.`). Ribbing, 2
garter rows, Box St Pat (8-row, 3×3 blocks) on the lower body; a garter ridge + M1 increase row
switches to the yoke: side texture `(P1. K1tbl)` + cable/lace panels B·A·B·C·B·A·B. Square
armholes (cast off, sleeves sewn in above markers). Sleeves: deep 7" rib cuff (turned back —
"reversing cuff seam at markers"), Box St, then panels B·A·B·A·B with side texture. Neckband
picked up flat after the right shoulder seam, 2 knit rows + 9 rib rows. No stitch markers on
the needle, no short rows.

**Sizes.** 6, spelled out in a two-column table on p1: `SIZES: To fit bust measurement Finished
bust` / `X-Small/Small 28-34" [71-86.5 cm] X-Small/Small 39" [99 cm]` / `Medium …` / `Large …`
/ `X-Large …` / `2/3 X-Large 48-54" … 2/3 X-Large 57" [145 cm]` / `4/5 X-Large …` — labels
with spaces (`2/3 X-Large`), and each line carries the label **twice**. The yarn table says
`Sizes XS/S M L XL 2/3XL 4/5XL`. Instruction text: "written for smallest size … written thus
( )" (no explicit order). Vectors with hyphens, 6 values; no size-conditional blocks.

**Gauge / needles (verbatim).** `GAUGE: 19 sts and 25 rows = 4" [10 cm] in stocking st with
larger needles.` (label and value on one line) → `{sts:19, rows:25, over:4, unit:'in'}`,
needle 5 mm / US 8. `Sizes U.S. 6 (4 mm) and U.S. 8 (5 mm) knitting needles or size needed to
obtain gauge. Cable needle. 2 st holders. Stitch markers.`

**Abbreviations** (p1, after `ABBREVIATIONS: yarnspirations.com/abbreviations`): Approx, Beg,
**C3BK, C3FK, C3BP, C3FP, Cr5B, Cr7B, Cr7F**, Cont, Dec, Inc, K, K1tbl, K2tog, M1, P, Pat,
Psso, Rem, Rep, RS, Sl1, St(s), WS, Yo. In the rows they are lowercase: `yo. Sl1. K2tog. psso.`

| Abbr | Definition (printed) | `w` | `cross` |
|---|---|---|---|
| C3BK | sl 1 to cn, back; K2, K1 from cn | 3 | b |
| C3FK | sl 2 to cn, front; K1, K2 from cn | 3 | f |
| C3BP | sl 1 to cn, back; K2, P1 from cn | 3 | b |
| C3FP | sl 2 to cn, front; P1, K2 from cn | 3 | f |
| Cr5B | sl 3 to cn, back; K2, then K1 (last st on cn), then K2 (rem 2 on cn) | 5 | b |
| Cr7B | sl 4 to cn, back; K3, then P1 (last st on cn), then K3 | 7 | b |
| Cr7F | sl 4 to cn, front; K3, then P1 (last st on cn), then K3 | 7 | f |

### Panels (p2; every row re-derived and adds up)

| Panel | Width | Rows | Crossing / lace rows | Copies |
|---|---|---|---|---|
| Cable Panel A | 7 | 16 | **1 Cr5B**; **3 C3BK + C3FK**; 5, 7, 9, 11, 13 lace (`K2. yo. Sl1. K2tog. psso. yo. K2.` — 7 → 7); **15 C3FP + C3BP** | `7th to 14th rows: Rep 5th and 6th rows 4 times more.` |
| Cable Panel B | 7 | 16 | 1, 3, 5 lace; **7 C3FP + C3BP**; **9 Cr5B**; **11 C3BK + C3FK**; 13, 15 lace | `3rd to 6th rows: Rep 1st and 2nd rows twice more.`, `10th row: As 8th row.`, `13th row: As 1st row.`, `14th and 15th rows: As 12th and 13th rows.` |
| Cable Panel C | 23 | 28 | **5 Cr7B**; **9 Cr7F ×2**; **13 Cr7B ×3**; **17 (=9) Cr7F ×2**; **21 (=5) Cr7B**; **27 (=5) Cr7B** — every 4 rows from 5 to 21, then 27 | `2nd and all WS rows: (P3. K1) 5 times. P3.`, `23rd and 25th rows: As 1st row.`, `28th row: As 2nd row.` |

No cadence sentence; `Line.cable` null everywhere. A and B are both 16 rows; C is 28 —
LCM 112.

### Charts (p5)

| Chart | Size | Numbering | Cells | Written twin |
|---|---|---|---|---|
| Cable Panel A | 7 × 16 | odd 1–15 at right; WS rows unnumbered; `Start Here` | vector (yo `o`, `Sl1. K2tog. psso` and cable strokes are paths) | Panel A p2 |
| Cable Panel B | 7 × 16 | odd 1–15 | vector | Panel B p2 |
| Cable Panel C | 23 × 28 | odd 1–27 | vector | Panel C p2 |

Text layer on p5: row numbers, the cable-width digits (`3`, `5`, `7`) and **the key as text**:
`Key` / `= Knit on RS rows. Purl on WS rows` / `= Purl on RS rows. Knit on WS rows` /
`3 = C3BK` / `3 = C3FK` / `3 = C3BP` / `3 = C3FP` / `5 = Cr5B` / `= Sl1. K2tog. psso` / `= yo` /
`7` / `= Cr7B` / `7 = Cr7F` (the symbol glyphs themselves are vector; only the width digit
precedes `=`). This is the first chart key in the fixtures that is readable — `KnitChart` can
build a legend `{sym:'3'…}` but the digits are ambiguous (four different 3-st cables share `3`),
so cells must still be `null`. The parser must not read `= Sl1. K2tog. psso` as a row.

### Sections (Boxy)

| Section | Rows | Counts (XS/S, M, L, XL, 2/3XL, 4/5XL) |
|---|---|---|
| Front — rib | CO; (K2. P2) rows 1–2 for 3" [7.5 cm] ending on a 2nd row, + 1,3,7,5,5,7 evenly | 98,102,110,118,142,158 (4n+2 ✓) → **99,105,117,123,147,165** ✓ |
| Front — garter | `Next 2 rows: Knit.` | same |
| Front — Box St Pat | 8 rows (6n+3 ✓ all sizes) until approx 11 (11-11½-12-12 12½)" [28 (28-29-30.5-30.5-32) cm], ending on a 4th or 8th row | same |
| Front — garter + inc | `Next 2 rows: Knit.`; RS inc row M1 ×16,22,26,36,48,62 | **115,127,143,159,195,227** ✓ (99 − 20 − 19 = 60 = 15×4, +1 …) |
| Front — set-up WS row | K19 (25-33-41-59-75), panel purls, K19… | 77 + 2×side ✓ |
| Front — yoke pattern | Rows 1–2 (side texture + panels B,A,B,C,B,A,B) until 15" [38 cm], ending WS | 16+3+7+2+7+2+7+2+23+2+7+2+7+2+7+3+16 = 115 ✓ (side ×8,11,15,19,28,36) |
| Front — armholes | cast off 10,14,16,18,20,24 at beg of next 2 rows | **95,99,111,123,155,179** ✓ (`**` closes here) |
| Front — even | until approx 20 (20-20½-21-21-21½)" [51(51-52-53.5-53.5-54.5) cm], **ending on a 24th row of Cable Panel C** | same |
| Left neck | Next row (RS) pat across 33,35,40,46,61,73, **Turn**; dec 1 at neck edge on next 8 rows, then on RS rows only 3 times more (−11) | **22,24,29,35,50,62** ✓ |
| Left shoulder | until armhole 8 (8-8½-9-9-9½)" [20.5 (20.5-21.5-23-23-24) cm] ending WS; cast off 11,12,14,17,25,31; 1 row even; cast off rem 11,12,15,18,25,31 | 22 = 11 + 11 ✓ … 62 = 31 + 31 ✓ |
| Right neck | centre 29,29,31,31,33,33 to holder (33 + 29 + 33 = 95 ✓ … 73 + 33 + 73 = 179 ✓); rejoin, pat to end; same decs; armhole ending **RS**; shoulder | 22,24,29,35,50,62 ✓ |
| Back | `Work from ** to ** as given for Front.` (CO … armholes) → even to Front's length, ending WS; shoulders cast off 11,12,14,17,25,31 ×2 rows then 11,12,15,18,25,31 ×2 rows | 95 … → rem **51,51,53,53,55,55** ✓ |
| Sleeves — cuff | CO; (K2. P2) 7" [18 cm] ending on a 2nd row, + 5,5,1,1,1,3; **edge markers 3½" [9 cm] from CO** (cuff turn-back) | 46,46,50,50,50,54 → **51,51,51,51,51,57** ✓ |
| Sleeves — Box St | 2 knit rows; Box St 8 rows; +2 on next and following 6th rows twice more (3 inc rows) | **57,57,57,57,57,63** ✓ |
| Sleeves — Box St even | until approx 8" [20.5 cm] **from markers**, ending on a 4th or 8th row | same |
| Sleeves — garter + inc | 2 knit rows; RS inc row; WS set-up row | printed **69,69,73,77,77,81** — XS/S and M do not divide (PATTERN ERROR); L–4/5XL ✓ |
| Sleeves — yoke pattern | Rows 1–2 (side texture + B,A,B,A,B); +2 on next and following 6th rows (5 inc rows) until 79,79,83,87,87,91; even until 18" [47.5 cm] from markers, ending WS | **79,79,83,87,87,91** ✓ (from the printed 69…) |
| Sleeves — top | cast off 8,8,9,9,9,10 at beg of next 8 rows; cast off rem | rem **15,15,11,15,15,11** ✓ |
| Neckband | pick up 20 + K29 (−6) + 20 + K51 (−12) | **102,102,106,106,110,110** ✓; `Knit 2 rows.` then 9 rows (K2. P2) rib beginning on a 2nd row; cast off |

**PATTERN ERROR — Sleeve inc row, XS/S and M.** `Next row: (RS). K3 (3-5-9-9-5). *M1. K4
(4-3-2-2-3). Rep from * to last 0 ( 0-4-8-8-4) sts. K0 (0-4-8-8-4). 69 (69-73-77-77-81) sts.`
XS/S: 57 − 3 − 0 = 54 sts for the `*M1. K4*` repeat — 54 / 4 = 13.5; the printed 69 needs 12
increases. L 48/3 = 16 → 73 ✓, XL and 2/3XL 40/2 = 20 → 77 ✓, 4/5XL 54/3 = 18 → 81 ✓.

**PATTERN ERROR — Sleeve 1st row, XL and 2/3XL.** `1st row: (RS). (P1. K1tbl) 5 (5-6-7-7-8)
times. P3. (… ) twice. Work 1st row Cable Panel B over 7 sts. P3. (K1tbl. P1) 5 (5-6-6-6-8)
times.` The closing vector has 6 for XL and 2/3XL where the opening one has 7: 14 + 49 + 12 =
**75**, not 77. The WS rows (`K13 (13-15-17-17-19)` both ends) and every other size are
symmetric; the closing group should read 7 for XL and 2/3XL.

**Measurement errors (not counts).** `Medium 42" [101.5 cm]` (42" = 106.5 cm). Sleeve `from
markers measures 18" [47.5 cm]` (18" = 45.5 cm).

**Typos in vectors.** `11 (11-11½-12-12 12½)"` — a space instead of a hyphen between the last
two values (still 6 values). `[51(51-52-` — no space before `(`. `cast off 11 (12-14-17-25⏎-31)`
— the hyphen starts the next line. `0 ( 0-4-8-8-4)` — space after `(`.

**Extractor bug — p4 column order (owner of `js/pdftext.js`).** p4 has 2 text columns. Column 1
is `Cont in pat inc …` … `Place markers on side edges of sleeves 12 (16-20-22-26-30) rows down
from first cast off edges.` then `FINISHING` … `Neckband: … 102 (102-106-106-110-110) sts.
Knit 2 rows.`; column 2 is `Beg on a 2nd row, work 9 rows in (K2. P2) ribbing …` … `side
seams.` The extract emits col 1 up to the markers sentence, **then column 2, then** `FINISHING`
… `Knit 2 rows.` — so the neckband ribbing arrives **before** the neckband pick-up. Assertions
that depend on order (Neckband part rows) must expect the true order; until fixed the parser
will attach `Beg on a 2nd row, work 9 rows …` to Sleeves.

**Other text-layer notes.** p1 starts with `Gayle Bunn` / `Designer`. The sizes table is two
columns on one line (`X-Small/Small 28-34" [71-86.5 cm] X-Small/Small 39" [99 cm]`). p6 is all
schematic numbers (`19½ - 21 - 23 - 24½ - 28½ - 32` with spaced hyphens, `14 - 14 - 14½ - 15 -
15 - 16`, `BODY`, `SLEEVE`) — no rows, and the spaced-hyphen lists are not size vectors of any
instruction.

**Markers.** No stitch markers on the needle. Two edge-marker lines: `Place markers on side
edges 3½" [9 cm] from cast on edge.` (cuff) and `Place markers on side edges of sleeves 12
(16-20-22-26-30) rows down from first cast off edges.` (a per-size **row** vector that is not a
row count to work). `markers` null on both. **Short rows: none** (`Turn.` at the neck divides).

### Hard lines (Boxy)

| # | Line (verbatim, wraps joined) | row | side | count | delta | until | shortRow | chart / cable | notes |
|---|---|---|---|---|---|---|---|---|---|
| X1 | `**With smaller needles cast on 98 (102-110-118-142-158) sts.` | CO | — | 98,102,110,118,142,158 | — | — | no | — | Part Front (first). |
| X2 | `Rep last 2 rows (K2. P2) ribbing for 3" [7.5 cm], ending on a 2nd row and inc 1 (3-7-5-5-7) st(s) evenly across last row. 99 (105-117-123-⏎147-165) sts.` | repeat 1–2 | — | explicit 99,105,117,123,147,165 | +1,3,7,5,5,7 | length 3 in, ws | no | — | `st(s)`. |
| X3 | `Next 2 rows: Knit.` | 2 rows | rs, ws | = prev | 0 | `{rows,2}` | no | — | "Next 2 rows" label (count of rows, not a row number). Appears 4×. |
| X4 | `1st row: (RS). *P3. K3. Rep from * to last 3 sts. P3.` | 1 | rs | = prev | 0 | — | no | — | Box St Pat rows 1–8; `4th row: Purl.`, `8th row: Purl.` |
| X5 | `Cont in pat until work from beg measures approx 11 (11-11½-⏎12-12 12½)" [28 (28-29-30.5-⏎30.5-32) cm], ending on a 4th or 8th row of pat.` | — | — | prev | 0 | length 11,11,11.5,12,12,12.5 in; endOn = row 4 or 8 of the pattern (ws) | no | — | "approx"; "a 4th or 8th row". |
| X6 | `Next row: (RS). K20 (10-8-9-3-22). *M1. K4 (4-4-3-3-2). Rep from * to last 19 (11-9-9-3-21) sts. M1. K19 (11-9-9-3-21). 115 (127-143-⏎159-195-227) sts.` | next | rs | explicit 115,127,143,159,195,227 | +16,22,26,36,48,62 | — | no | — | Arithmetic ✓ for every size. |
| X7 | `Next row: (WS). K19 (25-33-41-⏎59-75). P7. K3. P5. K3. P7. K2. (P3. K1) 5 times. P3. K2. P7. K3. P5. K3. P7. K19 (25-33-41-59-75).` | next | ws | computed 115… | 0 | — | no | — | Set-up row. |
| X8 | `1st row: (RS). (P1. K1tbl) 8 (11-15-⏎19-28-36) times. P3. Work 1st row Cable Panel B over 7 sts. P2. Work 1st row Cable Panel A over 7 sts. P2. Work 1st row Cable Panel B over 7 sts. P2. Work 1st row Cable Panel C over 23 sts. P2. Work 1st row Cable Panel B over 7 sts. P2. Work 1st row Cable Panel A over 7 sts. P2. Work 1st row Cable Panel B over 7 sts. P3. (K1tbl. P1) 8 (11-⏎15-19-28-36) times.` | 1 (restart) | rs | computed 115… | 0 | — | no | panels B,A,B,C,B,A,B row 1 | "over 7 sts" states each panel width. |
| X9 | `Cont in pat until work from beg measures 15" [38 cm], ending on a WS row.` | — | — | prev | 0 | length 15 in (one value), ws | no | — | |
| X10 | `Shape armholes: Keeping cont of pat, cast off 10 (14-16-18-20-24) sts at beg of next 2 rows. 95 (99-111-⏎123-155-179) sts.**` | 2 rows | — | explicit 95,99,111,123,155,179 | −20,−28,−32,−36,−40,−48 | — | no | — | Closing `**`. |
| X11 | `Cont even in pat until work from beg measures approx 20 (20-⏎20½-21-21-21½)" [51(51-52-⏎53.5-53.5-54.5) cm], ending on a 24th row of Cable Panel C.` | — | — | prev | 0 | length 20,20,20.5,21,21,21.5 in; **endOn = row 24 of Panel C** (a ws row) | no | Panel C row 24 | endOn names a panel row, not RS/WS. |
| X12 | `Shape neck: Next row: (RS). Pat across 33 (35-40-46-61-73) sts (neck edge). Turn. Leave rem sts on a spare needle.` | next | rs | 33,35,40,46,61,73 in work | (held) | — | **no** | — | |
| X13 | `Dec 1 st at neck edge on next 8 rows, then on RS rows only 3 times more. 22 (24-29-35-50-62) sts rem.` | 8 + 6 rows | — | explicit 22,24,29,35,50,62 | −11 | — | no | — | Two cadences in one line. |
| X14 | `Shape shoulder: Keeping cont of pat, cast off 11 (12-14-17-25-⏎31) sts at beg of next row. Work 1 row even in pat. Cast off rem 11 (12-15-18-25-31) sts.` | 3 rows | rs, ws, rs | 0 at end | — | — | no | — | |
| X15 | `With RS facing, slip next 29 (29-⏎31-31-33-33) sts onto a st holder. Join yarn to rem sts and pat to end of row.` | next | rs (implied) | computed 33,35,40,46,61,73 | — | — | no | — | |
| X16 | `Work from ** to ** as given for Front.` | copy | — | 95,99,111,123,155,179 after | — | — | no | — | Part Back. |
| X17 | `Shape shoulders: Keeping cont of pat, cast off 11 (12-14-17-25-⏎31) sts at beg of next 2 rows, then 11 (12-15-18-25-31) sts at beg of following 2 rows. Leave rem 51 (51-⏎53-53-55-55) sts on a st holder.` | 4 rows | — | explicit 51,51,53,53,55,55 | −44,−48,−58,−70,−100,−124 | — | no | — | |
| X18 | `With smaller needles, cast on 46 (46-50-50-50-54) sts.` | CO | — | 46,46,50,50,50,54 | — | — | no | — | Part Sleeves. |
| X19 | `Work 7" [18 cm] in (K2. P2) ribbing as given for Front, ending on a 2nd row and inc 5 (5-1-1-1-3) st(s) evenly across last row. 51 (51-51-51-51-⏎57) sts. Place markers on side edges 3½" [9 cm] from cast on edge.` | — | — | explicit 51,51,51,51,51,57 | +5,5,1,1,1,3 | length 7 in, ws | no | — | Edge markers (not stitch markers). |
| X20 | `Proceed in Box St Pat as given for Front for 8 rows.` | 8 rows | — | prev | 0 | `{rows, 8}` | no | — | Cross-part pattern reference. |
| X21 | `Inc 1 st each end of needle on next and following 6th rows twice more, taking inc sts into pat. 57 (57-57-⏎57-57-63) sts.` | 13 rows (1 + 6 + 6) | — | explicit 57,57,57,57,57,63 | +6 | — | no | — | |
| X22 | `Cont even in pat until work from markers measures approx 8" [20.5 cm], ending on a 4th or 8th row of pat.` | — | — | prev | 0 | length 8 in **from markers**, endOn row 4/8 | no | — | |
| X23 | `Next row: (RS). K3 (3-5-9-9-5). *M1. K4 (4-3-2-2-3). Rep from * to last 0 ( 0-4-8-8-4) sts. K0 (0-4-8-8-4). 69 (69-73-77-77-81) sts.` | next | rs | explicit 69,69,73,77,77,81 (XS/S, M do not divide) | +12,12,16,20,20,18 | — | no | — | `K0` = zero sts. |
| X24 | `1st row: (RS). (P1. K1tbl) 5 (5-6-⏎7-7-8) times. P3. (Work 1st row Cable Panel B over 7 sts. P2. Work 1st row Cable Panel A over 7 sts. P2) twice. Work 1st row Cable Panel B over 7 sts. P3. (K1tbl. P1) 5 (5-6-6-6-8) times.` | 1 | rs | computed 69,69,73,**75**,**75**,81 (printed counts 77 for XL, 2/3XL) | 0 | — | no | panels B,A,B,A,B row 1 | PATTERN ERROR above. A group containing two panel references, ×2. |
| X25 | `Cont in pat inc 1 st each end of next and following 6th rows until there are 79 (79-83-87-87-91) sts, taking inc sts into side texture pat.` | — | — | explicit target 79,79,83,87,87,91 | +2 × 5 | none | no | — | |
| X26 | `Cont even in pat until work from markers measures 18" [47.5 cm], ending on a WS row.` | — | — | prev | 0 | length 18 in from markers, ws | no | — | |
| X27 | `Shape top: Keeping cont of pat, cast off 8 (8-9-9-9-10) sts at beg of next 8 rows. Cast off rem 15 (15-⏎11-15-15-11) sts.` | 8 rows + 1 | — | 15,15,11,15,15,11 before the last cast-off | −64,−64,−72,−72,−72,−80 | — | no | — | |
| X28 | `Neckband: Sew right shoulder seam. With RS facing and smaller needles, pick up and knit 20 sts down left front neck edge. K29 (29-⏎31-31-33-33) from Front st holder, dec 6 sts evenly across. Pick up and knit 20 sts up right front neck edge. K51 (51-53-53-55-55) from Back st holder, dec 12 sts evenly across. 102 (102-106-106-110-110) sts. Knit 2 rows.` | setup + 2 rows | — | explicit 102,102,106,106,110,110 | — | `{rows,2}` | no | — | |
| X29 | `Beg on a 2nd row, work 9 rows in (K2. P2) ribbing as given for Back. Cast off in ribbing.` | 9 rows | ws first | prev | 0 | `{rows, 9}` | no | — | Emitted **before** X28 by the extractor (bug). "as given for Back" — the rib is defined in Front. |
| XA1 | `5th row: K2. yo. Sl1. K2tog. psso. yo. K2.` | 5 of Panel A | rs | 7 | 0 (2 yo, −2 in the double dec) | — | no | lace | `Sl1. K2tog. psso.` = one centred-ish double decrease (`cdd`-like, 3 → 1). |
| XA2 | `7th to 14th rows: Rep 5th and 6th rows 4 times more.` | 7–14 | — | 7 | 0 | — | no | — | |
| XB1 | `14th and 15th rows: As 12th and 13th rows.` | 14, 15 | ws, rs | 7 | 0 | — | no | — | |
| XC1 | `2nd and all WS rows: (P3. K1) 5 times. P3.` | all even | ws | 23 | 0 | — | no | — | "all WS rows" (cf. "every alt row"). |
| XC2 | `13th row: (Cr7B. P1) twice. Cr7B.` | 13 | rs | 23 | 0 | — | no | Cr7B ×3 (w7,b) | |
| XC3 | `23rd and 25th rows: As 1st row.` | 23, 25 | rs | 23 | 0 | — | no | — | Enumeration of two odd rows. |

## 12. `knit-patons-cabled-yoke.pdf` — Patons "Cabled Yoke Pullover" (PAK0129-005514M)

4 pages, landscape, 3–4 columns, `garbled false`, 8489 chars. p1 materials/abbreviations/sizes/
Panel Pat A/Yoke Cable start; p2 Bottom Yoke, Body, Sleeves, Top Yoke start; p3 Top Yoke end +
chart; p4 schematic (`Size Xl-5Xl`, `Size XS-l`, `body`, `10`, `11`, `11 1/2` — no rows).
**This file has the worst text layer of the batch — read the extractor notes before asserting
anything on it.**

**Garment / construction — "middle-out" yoke.** (1) **Yoke Cable**: a 30-st band worked
**flat in rows** (RS/WS) with Panel Pat A, approx 43 (44-45-46-47.5-49)" long, cast off and sewn
into a ring. (2) **Bottom Yoke**: stitches picked up along the band's bottom edge, worked
**downward in rounds** with increases beside 4 marked stitches (raglan-like: 2 sleeve and 2
body sections), then a dividing round (sleeves to spare yarn, underarm cast-on). (3) **Body**
in rounds down to a cabled hem (`*P2. K4.` / `*P2. C4B.`). (4) **Sleeves** in rounds on DPNs,
tapered, same cabled cuff. (5) **Top Yoke**: stitches picked up along the band's top edge,
worked **upward in rounds**, decreasing (P2tog) into a cabled funnel collar. So one garment
mixes a flat part with three in-the-round parts, and two parts grow away from the same band in
opposite directions.

**Sizes.** 6, spelled out (`Extra-Small/Small`, `Medium`, `Large`, `Extra-Large`, `2 Extra-Large/3
Extra-Large`, `4 Extra-Large/5 Extra-Large`; finished-bust table `X-Small/Small 37" [94 cm]` …
`4/5X Large 66" [167.5 cm]`). Instructions "written thus ( )". Vectors with hyphens; **spaces
after the opening parenthesis are common** (`224 ( 228-…`, `0 ( 1-3-0-2-1)`, `10th ( 8th-6th-…`).
Conditionals: `Size XS/S only:`, `Size 4/5XL only:`, `Sizes XS/S, M and L only:` (3-value
vector `164 (184-204)`), `All sizes:`. Finished bust re-checked: all six inch/cm pairs convert ✓.

**Gauge / needles (as printed).** `20 sts and 26 rows = 4" [10 cm] with larger needles in
stocking st.` → `{sts:20, rows:26, over:4, unit:'in'}`, needle 4.5 mm / US 7. `Size 4.5 mm (U.S.
7) knitting needles. Size 4.5 mm (U.S. 7) circular knitting needle 24" [60 cm] long. Set of four 4
mm (U.S. 6) and 4.5 mm (U.S. 7) double pointed knitting needles or size needed to obtain gauge.
Cable needle.` — metric first, US in parentheses (the other Patons files are the reverse).

**Abbreviations** (p1, 3 columns): Approx, Beg, C4B, C4F, Cont, Dec, K, K2tog, M1, P, P2tog,
Pat, Psso, Rem, Rep, Rnd(s), RS, Sl1, St(s), T3B, T3F, T4B, T4F, Tog. T3B/T3F are defined as in
the mock neck (T3F = sl 2, front, P1, K2 from cn). **T4B** = sl 2 to cn, back; K2, P2 from cn
(`w` 4, b). **T4F** = sl 2 to cn, front; P2, K2 from cn (`w` 4, f). C4B/C4F as usual.

### Panel Pat A (p1; every row re-derived = 28 sts)

| Rows | Content | Crossings |
|---|---|---|
| 1 (RS) | `(P4. C4B) 3 times. P4.` | C4B ×3 |
| 2 | `(K4. P4) 3 times. K4.` | — |
| 3 | `P3. T3B. (T4F. T4B) twice. T3F. P3.` | T3B, T4F, T4B, T4F, T4B, T3F |
| 4, 14 | `K3. P2. K3. P4. K4. P4. K3. P2. K3.` | — |
| 5 | `P2. T3B. P3. C4F. P4. C4F. P3. T3F. P2.` | T3B, C4F ×2, T3F |
| 6, 12 | `K2. P2. (K4. P4) twice. K4. P2. K2.` | — |
| 7 | `P2. K2. P2. (T4B. T4F) twice. P2. K2. P2.` | T4B, T4F ×2 |
| 8, 10 | `(K2. P2) twice. K4. P4. K4. (P2. K2) twice.` | — |
| 9 | `(P2. K2) twice. P4. C4B. P4. (K2. P2) twice.` | C4B ×1 |
| 11 | `P2. K2. P2. (T4F. T4B) twice. P2. K2. P2.` | T4F, T4B ×2 |
| 13 | `P2. T3F. P3. C4F. P4. C4F. P3. T3B. P2.` | T3F, C4F ×2, T3B |
| 15 | `P3. T3F. (T4B. T4F) twice. T3B. P3.` | T3F, T4B, T4F ×2, T3B |
| 16 | `As 2nd row.` | — |

`These 3rd to 16th rows form Panel Pat A.` — **rows 1–2 are a set-up worked once; the repeat
is rows 3–16 (14 rows)**, and the Yoke Cable says `work 3rd to 16th rows of panel pat only`.
After row 16 the next row is **3**, not 1. Every RS row crosses.

**Chart (p3).** `Panel Pat A`, 28 sts × 16 rows, odd row numbers 1–15 at the right, `Key`
legend (`= Knit on RS and purl on WS`, `= T3F` … `= T4B`). Text layer: the title twice (large
`Panel Pat A` and small `panel pat a`) and the row numbers **only** — the key and the cells are
vector, and unlike the other three Patons files there are **no cable-width digits**. Expect
`KnitChart` → one chart, `null` cells. Written twin: Panel Pat A on p1.

### Sections (Cabled Yoke)

| Section | Rows / rounds | Counts (XS/S, M, L, XL, 2/3XL, 4/5XL) |
|---|---|---|
| Yoke Cable (flat) | CO 30; rows 1 (RS), 2 (WS) set Panel A between P1/K1 edges; then rows 3–16 repeated until approx 43 (44-45-46-47.5-49)" [109 (112-114.5-117-120.5-124.5) cm], **ending with 16th row**; cast off; sew ends | 30 throughout (single value) |
| Bottom Yoke — pick-up | pick up around the bottom edge, join, `Mark first st as beg of rnd.` | 216,220,228,236,252,260 |
| Bottom Yoke — rnds 1–2 | rnd 1 knit; rnd 2 +8 (`K1 (first marked st). M1. K39 … M1. K1. Place marker on last st. M1. K67 … M1.` ×2) | **224,228,236,244,260,268** ✓ (2 × (1 + 39 + 1 + 67) = 216 …) |
| XS/S only | rnds 3 (knit) & 4 (+8), ×3 | —: **248** ✓ |
| All sizes — pair | body-only rnd (+4) + all-sections rnd (+8), ×1,2,4,1,3,2 | **260,252,284,256,296,292** ✓ |
| All sizes — +8 rnds | +8 every rnd, ×3,8,7,13,12,5 | **284,316,340,360,392,332** ✓ |
| 4/5XL only | +12 every rnd (sleeves +2, body +4 each), ×10 | —,—,—,—,—,**452** ✓ |
| Dividing rnd | sleeve 56,62,66,74,80,86 to spare yarn ×2; front/back 86,96,104,106,116,140; cast on 6,6,8,16,20,26 at each underarm | 2×(56+86) = 284 ✓ … 2×(86+140) = 452 ✓ → **184,204,224,244,272,332** ✓ |
| Body XS/S, M, L | 2" [5 cm] even; `**`dec rnd (−4) + 1½" [4 cm]`**` ×5 | **164,184,204**,—,—,— ✓ |
| Body all | even until 8½ (8½-8½-12-14-15)" [21.5 (21.5-21.5-30.5-35.5-38) cm] from dividing rnd, +10,8,12,20,22,22 evenly on the last rnd | **174,192,216,264,294,354** ✓ (all multiples of 6 ✓) |
| Body hem | rnds 1–5 (`*P2. K4.`; rnd 2 `*P2. C4B.`; 3–5 `*P2. K4.`) for 6 (6-6-3-3-3)" [15 (15-15-7.5-7.5-7.5) cm]; cast off in pat | same |
| Sleeves | 56… from spare yarn + cast on 6,6,8,16,20,26, BOR after the 3rd,3rd,4th,8th,10th,13th CO st | **62,68,74,90,100,112** ✓ |
| Sleeve shaping | 2" [5 cm] even; dec rnd (−2); then −2 every 10th,8th,6th,4th,4th,4th rnd to 54,54,46,46,72,98 (3,6,13,21,13,6 dec rnds), then every 8th,6th,4th,2nd,2nd,2nd rnd to 40,40,40,44,46,46 (7,7,3,1,13,26 dec rnds) | 62 → 60 → 54… → **40,40,40,44,46,46** ✓ (all steps even) |
| Sleeve even + inc | until 14½ (15-15-15½-14-13)" [37 (38-38-39.5-35.5-33) cm] from dividing rnd, +8,8,8,10,14,14 on the last rnd | **48,48,48,54,60,60** ✓ |
| Cuff | smaller DPN, rnds 1–5 as hem, 3" [7.5 cm]; cast off in pat | same |
| Top Yoke | pick up around the top edge, join, mark first st as BOR; rnds 1–24 (12 dec rnds, C4B on rnds 4, 9, 14, 19, 24), then rnds 25–29 (`25th to 28th rnds: *P1. K4.`, `29th rnd: *P1. C4B.`) repeated for 3" [7.5 cm]; cast off in pat | 198,198,220,220,242,242 → … → **90,90,100,100,110,110** (computed; the Top Yoke prints **no** counts) |

**Top Yoke round counts (all computed — nothing is printed; `count` must be null on these
lines unless computed by `expand`).** Repeat widths: rnd 1 = 11 (`*P7. K4.`), rnds 2–3 = 22 → 21,
rnd 4 21 → 20, rnd 5 = 10, … i.e. the repeat alternates single/double units so that each dec
round removes one stitch per 2 cable columns. After rnd 2: 189,189,210,210,231,231 · 4: 180,
180,200,200,220,220 · 6: 171,171,190,190,209,209 · 8: 162,162,180,180,198,198 · 10: 153,153,170,
170,187,187 · 12: 144,144,160,160,176,176 · 14: 135,135,150,150,165,165 · 16: 126,126,140,140,
154,154 · 18: 117,117,130,130,143,143 · 20: 108,108,120,120,132,132 · 22: 99,99,110,110,121,121
· 24 and after: **90,90,100,100,110,110**. Every `*…*` repeat divides the round exactly ✓.

**Cable cadence.** Body hem and cuffs: C4B on rnd 2 of a 5-rnd repeat → every 5 rnds. Top
Yoke: C4B on rnds 4, 9, 14, 19, 24, 29, 34 … → every 5 rnds. Neither is stated as "every 5th
rnd"; `Line.cable` stays null.

**Markers.** Bottom Yoke uses **marked stitches**, not markers between stitches: `Mark first
st as beg of rnd.` (BOR = that stitch, `at` 0) and `Place marker on last st.` (the K1 after each
sleeve section). Intended 4 marked sts after rnd 2: `at` = XS/S `0, 42, 112, 154`; M `0, 42,
114, 156`; L `0, 44, 118, 162`; XL `0, 46, 122, 168`; 2/3XL `0, 50, 130, 180`; 4/5XL `0, 52,
134, 186` (sleeve 41,41,43,45,49,51 sts and body 69,71,73,75,79,81 sts between them). Each
marked st travels with the section after it at the divide (56 = 1 + 55 etc. ✓). Body: two
side markers in the underarm cast-on (BOR implied at one of them; the dec round "K1. K2tog.
Knit to 3 sts before marker" assumes the round starts at a marker). Sleeves: BOR marker after
the 3rd (3rd-4th-8th-10th-13th) cast-on st = the middle of the underarm cast-on. Top Yoke:
`Mark first st as beg of rnd.` (BOR on a stitch).

**PATTERN ERROR — marker omission.** In Bottom Yoke rnd 2 the repeat `*K1 (first marked st)…
Place marker on last st…* Rep from * once more` marks only 2 stitches beyond the BOR stitch,
but on the second pass the `K1 (first marked st)` is not a marked st (nothing marked it); later
rounds (`*Knit to marked st. M1. K1. M1. Rep from * twice more.`) need **3** marked sts after the
BOR. The 4-marked-st layout above is the intended one.

**PATTERN ERROR — short size vector.** Body dividing round: `Place marker after 3rd (3rd-4th)
cast on st.` (twice) — **3 values for 6 sizes**. The Sleeves give the full vector `3rd (3rd-
4th-8th-10th-13th)` (= half the underarm cast-on 6,6,8,16,20,26). The parser must not spread 3
values over 6 sizes; null for XL+ (or flag the mismatch) is correct.

**Note (not a count error).** At the stated 26 rows/4" the XS/S–L sleeve decreases need ≈100–
104 rounds after the divide, ~1" more than the printed 14½ (15-15)" — the length target wins in
practice; nothing to flag in the parser.

**Short rows: none.** **Two-at-a-time: no.**

### Extractor problems on this file (owner of `js/pdftext.js`)

1. **Case mapping** — one display font maps capitals to lowercase glyph codes: `MaTerIalS`,
   `abbrevIaTIoNS: www.yarnspirations.com/abbreviations`, `SIZe`, `GauGe`, `INSTruCTIoNS`,
   `patons ® decor™`, `extra-Small/Small`, `large`, `extra-large`, `2 extra-large/3 extra-large`,
   `boTToM Yoke`, `body:`, `all sizes:`, `Top Yoke`, and in the abbreviation keys `C4b`, `T3b`,
   `T4b`, `k`, `k2tog`, `p`, `p2tog`, `rS`, `rnd(s)`, `rem`, `rep`, `dec`, `beg`, `approx`, `pat`,
   `psso`. **Size labels come out lowercase**: raw `Sizes XS/S M l Xl 2/3Xl 4/5Xl`, and in the
   instructions `Size 4/5Xl only:`, `Sizes XS/S, M and l only:` — `l` is size L. The body font
   (instructions) is correct (`C4B`, `T3B`, `K2tog`, `(RS)`).
2. **Columns interleaved line by line** — p1 cols 3 and 4 (size table, finished bust, GAUGE,
   INSTRUCTIONS vs Panel Pat A rows 1–16 and the Yoke Cable start): the extract reads `SIZe 1st
   row: (RS). (P4. C4B) 3 times. P4.`, `To fit bust measurement 2nd row: …`, `Medium 4th row:
   …`, `GauGe 15th row: P3. T3F. (T4B. T4F) twice.` / `20 sts and 26 rows = 4" [10 cm] with T3B.
   P3.` / `larger needles in stocking st. 16th row: As 2nd row.` — the **gauge sentence is split
   and has row 15's tail glued into it**. The p1 abbreviation columns interleave too (`approx =
   Approximately M1 = Make one stitch by St(s) = Stitch(es)`). p2 cols 2 and 3 interleave over
   their whole height (`Rep last rnd 2 ( 7-6-12-11-4) times sts evenly around last rnd. 174 (
   192-` / `more. 284 (316-340-360-392-332) sts. 216-264-294-354) sts.` …), which mixes the Bottom
   Yoke end, the dividing round, Body and Sleeves.
3. **Yarn table lost** — raw `Sizes XS/S M l Xl 2/3Xl 4/5Xl` / `Aran (87602) 6 6 7 7 8 10
   balls`; the extract has only `Sizes XS/S` / `Aran (87602) 6`.
Fixture assertions on this file should be written against the true text below and marked
"blocked by extractor" until (2) is fixed; an import of the current extract cannot get Panel
Pat A rows, the gauge, the Body or the Sleeves right.

### Hard lines (Cabled Yoke) — true text (image-verified), not the current extract

| # | Line (verbatim, wraps joined) | row | side | count | delta | until | shortRow | markers / chart | notes |
|---|---|---|---|---|---|---|---|---|---|
| Y1 | `Panel Pat A (worked over 28 sts). (see page 3).` | — | — | — | — | — | no | — | Stitch-pattern header (not a part). |
| Y2 | `1st row: (RS). (P4. C4B) 3 times. P4.` | 1 of Panel A | rs | 28 | 0 | — | no | C4B ×3 | Set-up row (not repeated). |
| Y3 | `These 3rd to 16th rows form Panel Pat A.` | repeat 3–16 | — | — | — | — | no | — | Repeat range starts at row 3. |
| Y4 | `Yoke Cable` / `With larger needles, cast on 30 sts.` | CO | — | 30 | — | — | no | — | Part header `Yoke Cable` (text layer `Yoke Cable`). |
| Y5 | `1st row: (RS). P1. Work 1st row of Panel Pat A. P1.` | 1 | rs | computed 30 | 0 | — | no | Panel A row 1 | |
| Y6 | `Cont in pat (work 3rd to 16th rows of panel pat only) until work measures approx 43 ( 44-45-46-47.5-49)" [109 ( 112-114.5-117-120.5-124.5) cm], ending with 16th row of pat. Cast off.` | — | — | 30 | 0 | length 43,44,45,46,47.5,49 in; endOn = Panel A row 16 (ws) | no | — | `( 44` space. |
| Y7 | `Beg at side seam of Cable Yoke, with larger circular needle pick up and knit 216 (220-228-236-252-260) sts evenly around bottom edge of Cable Yoke. Join in rnd. Mark first st as beg of rnd.` | setup | null | explicit 216,220,228,236,252,260 | — | — | no | BOR on st 0 | Part `Bottom Yoke` (`boTToM Yoke` in the text layer). |
| Y8 | `2nd rnd: *K1 (first marked st). M1. K39 (39-41-43-47-49). M1. K1. Place marker on last st. M1. K67 ( 69-71-73-77-79). M1. Rep from * once more. 224 ( 228-236-244-260-268) sts.` | 2 | null | explicit 224,228,236,244,260,268 | +8 | — | no | marked sts (above) | |
| Y9 | `Size XS/S only: 3rd rnd: Knit.` / `4th rnd: K1. M1. *Knit to marked st. M1. K1. M1. Rep from * twice more. Knit to end of rnd. M1.` / `Rep last 2 rnds twice more. 248 sts.` | 3, 4, repeat | null | explicit 248 (XS/S) | +8 / 2 rnds | — | no | — | |
| Y10 | `All sizes: Next rnd: K1 (first marked st). *Knit to next marked st. K1. M1. Knit to next marked st. M1.* K1. Rep from * to * once more.` | next | null | +4 | +4 (body only) | — | no | — | `*…*` + "Rep from * to * once more". |
| Y11 | `Rep last 2 rnds 0 ( 1-3-0-2-1) time(s) more. 260 (252-284-256-296-292) sts.` | repeat | null | explicit 260,252,284,256,296,292 | +12 / 2 rnds | — | no | — | times 0 for XS/S and XL. Totals not monotonic across sizes (M < XS/S) — legitimate. |
| Y12 | `Rep last rnd 2 ( 7-6-12-11-4) times more. 284 (316-340-360-392-332) sts.` | repeat 1 rnd | null | explicit 284,316,340,360,392,332 | +8/rnd | — | no | — | |
| Y13 | `Size 4/5XL only: Next rnd: K1 (first marked st). *M1. Knit to next marked st. M1. (K1. M1) twice. Knit to 1 st before marked st.* (M1. K1) twice. Rep from * to * once more. M1. K1. M1.` / `Rep last rnd 9 times more. 452 sts.` | next, repeat | null | explicit 452 | +12/rnd | — | no | — | |
| Y14 | `All sizes: Next rnd: (Dividing rnd). Slip first 56 ( 62-66-74-80-86) sts (Left Sleeve) onto length of spare yarn. Join yarn to next st and K86 (96-104-106-116-140) (Front). Cast on 6 ( 6-8-16-20-26) sts. Place marker after 3rd (3rd-4th) cast on st. Slip next 56 ( 62-66-74-80-86) sts (Right Sleeve) onto length of spare yarn. Knit rem 86 ( 96-104-106-116-140) sts (Back). Cast on 6 (6-8-16-20-26) sts. Place marker after 3rd (3rd-4th) cast on st. Join in rnd. 184 (204-224-244-272-332) sts.` | next | null | explicit 184,204,224,244,272,332 | −100,−112,−116,−116,−120,−120 (held) | — | no | 2 side markers; vector `3rd (3rd-4th)` short | `(Dividing rnd)` is an impostor in the side slot. `(Left Sleeve)`, `(Front)`, `(Right Sleeve)`, `(Back)` are labels, not sizes. |
| Y15 | `Body: Sizes XS/S, M and L only: Knit in rnds for 2" [5 cm].` | — | null | prev | 0 | length 2 in | no | — | Part header `Body` + conditional on one line. |
| Y16 | `**Next rnd: *K1. K2tog. Knit to 3 sts before marker. Sl1. K1. psso. K1. Rep from * once more.` / `Knit in rnds for 1½" [4 cm].**` / `Rep from ** to ** 4 times more. 164 (184-204) sts.` | next + length, ×5 | null | explicit 164,184,204 | −4 per block | length 1.5 in inside the block | no | — | A `**…**` repeat whose body contains a length; `Sl1. K1. psso.` = skp. |
| Y17 | `All sizes: Knit even in rnds until work from dividing rnd measures 8½ (8½-8½-12-14-15)" [21.5 (21.5-21.5-30.5-35.5-38) cm], inc 10 (8-12-20-22-22) sts evenly around last rnd. 174 (192-216-264-294-354) sts.` | — | null | explicit 174,192,216,264,294,354 | +10,8,12,20,22,22 on the last rnd | length 8.5,8.5,8.5,12,14,15 in | no | — | Length target **and** an inc on its last round. |
| Y18 | `2nd rnd: *P2. C4B. Rep from * around.` | 2 | null | = prev | 0 | — | no | C4B (w4,b) | `3rd to 5th rnds: *P2. K4. Rep from * around.` = range of rounds. |
| Y19 | `Rep 1st to 5th rnds for 6 (6-6-3-3-3)" [15 (15-15-7.5-7.5-7.5) cm]. Cast off in pat.` | repeat 1–5 | null | prev | 0 | length 6,6,6,3,3,3 in | no | — | |
| Y20 | `Sleeves: With RS of work facing slip 56 (62-66-74-80-86) sts from spare yarn onto three larger double pointed needles. Cast on 6 (6-8-16-20-26) sts. Join in rnd. Place marker after 3rd (3rd-4th-8th-10th-13th) cast on st for beg of rnd. 62 (68-74-90-100-112) sts.` | setup | null | explicit 62,68,74,90,100,112 | — | — | no | BOR (ordinal vector) | Inline part header. "With RS of work facing" ≠ side tag. |
| Y21 | `Next rnd: *K1. K2tog. Knit to 3 sts before marker. Sl1. K1. psso. K1.` | next | null | computed 60,66,72,88,98,110 | −2 | — | no | — | Stray `*` with no "Rep from *". |
| Y22 | `Cont knitting in rnds, dec 1 st at beg and end of rnd as before on every following 10th ( 8th-6th-4th-4th-4th) rnd from previous dec to 54 ( 54-46-46-72-98) sts, then on every following 8th ( 6th-4th-2nd-2nd-2nd) rnd to 40 (40-40-44-46-46) sts.` | — (two-stage shaping) | null | explicit end 40,40,40,44,46,46 (intermediate 54,54,46,46,72,98) | −2 per dec rnd | none (count targets) | no | — | Ordinal interval vectors. |
| Y23 | `Cont even until work from dividing rnd measures 14½ ( 15-15-15½-14-13)" [37 (38-38-39.5-35.5-33) cm], inc 8 ( 8-8-10-14-14) sts evenly around last rnd. 48 (48-48-54-60-60) sts.` | — | null | explicit 48,48,48,54,60,60 | +8,8,8,10,14,14 | length 14.5,15,15,15.5,14,13 in | no | — | |
| Y24 | `Top Yoke` / `With RS of work facing and larger circular needle, starting at side seam, pick up and knit 198 ( 198-220-220-242-242) sts around top edge of Cable Yoke. Join in rnd. Mark first st as beg of rnd.` | setup | null | explicit 198,198,220,220,242,242 | — | — | no | BOR on st 0 | Part. |
| Y25 | `2nd rnd: *P2tog. P5. K4. P7. K4. Rep from * around.` | 2 | null | **null printed**; computed 189,189,210,210,231,231 | −9,−9,−10,−10,−11,−11 | — | no | — | |
| Y26 | `4th rnd: *P6. C4B. P2tog. P5. C4B. Rep from * around.` | 4 | null | null printed; computed 180,180,200,200,220,220 | −9… | — | no | C4B ×2 per repeat | |
| Y27 | `24th rnd: *P1. C4B. P2tog. C4B. Rep from * around.` | 24 | null | null printed; computed 90,90,100,100,110,110 | −9,−9,−10,−10,−11,−11 | — | no | C4B | |
| Y28 | `25th to 28th rnds: *P1. K4. Rep from * around.` | 25–28 | null | = prev | 0 | — | no | — | |
| Y29 | `Rep 25th to 29th rnds for 3" [7.5 cm]. Cast off in pat.` | repeat 25–29 | null | prev | 0 | length 3 in | no | — | |

## 13. `knit-sandnes-raglan-child.pdf` — Sandnes Garn single pattern no. 133 "Raglan sweater worked from neck down" (Limited Edition, free pattern April 2020; instruction Olaug Beate Bjelland)

3 portrait pages (595×842), 2 text columns on p2–p3, `garbled false`, 8161 chars, `emptyPages`
none but **p1 is a cover** (`monthly` / `free pattern`; the rotated `APRIL 2020` is not emitted).
**Two size groups in one PDF**: p2 = children (6 sizes, header `LIMITED EDITION CHILDREN`), p3 =
ladies (5 sizes, `LIMITED EDITION LADIES`). The two pages are the same pattern with different
numbers and a few wording differences; each is complete on its own (own SIZES, MEASUREMENTS,
YARN, NEEDLES, TENSION, YOKE, BACK AND FRONT, SLEEVES, FINISHING). Text layer clean; the
group label arrives as `Limited edition` at the top of the page and `children` / `ladies` on
its own line **after** `TENSION` (display font), then `SINGLE PATTERN NO 133 / RAGLAN SWEATER
WORKED FROM NECK DOWN` / `INSTRUCTION: OLAUG BEATE BJELLAND`. Letter-spaced headings split:
`MEA SUREMENTS`, `WORK INC FOR R AGL AN IN A` / `MIRROR IMAGE OF EACH OTHER`.

**Garment / construction.** Top-down raglan **entirely in the round**: neck ribbing (folded to
WS at the end), one increase round, **German short rows across the back neck** (extra height at
the back), 4 marked raglan stitches, raglan increases every other round, divide (sleeves to
spare needle, underarm cast-on), body in the round, sleeves in the round on DPNs ("Work other
sleeve in the same manner" — 2 sleeves, no two-at-a-time). **No row or round is numbered
anywhere**: every target is a length in cm, a number of increase repeats or a stitch count.

**Sizes — alternating parentheses (the main trap).** `(2) 4 (6) 8 (10) 12 yrs` and `(S) M (L) XL
(XXL)`: the sizes are written in one line with **every other size in parentheses** (a visual
aid, not a "base (others)" vector). Every instruction vector follows the same shape: children
`(48) 52 (56) 56 (60) 60` = **[48, 52, 56, 56, 60, 60]**; ladies `(64) 64 (68) 68 (72)` = **[64,
64, 68, 68, 72]**. Reading it the Patons way (first number = smallest size, parenthesised list =
the rest) gives garbage (`52` for size 2, and only 3 of 6 values). A bare number with no
partner applies to all sizes (`6 sts (= sleeve)`, `4 new underarm sts`, `7 cm`, `3 cm`, `45
cm`). Parentheses that are **not** size values sit in the same lines: `(= ½ back)`, `(=
sleeve)`, `(= front)`, `(as explained)`, `(48 % alpaca, 36% wool, 16 % polyamide, 100 g = 250
m)`. The first value can be glued to a stitch: `k(5) 6 (7) 8 (8) 9 sts`, `p(9) 11 (13) 15 (15)
17 sts`. Vectors wrap mid-list: `(42)⏎46 (50) 52 (56) 58 sts`, `count (10) 11⏎(12) 12 (13) 13
sts`, `work (21) 23 (25) 26 (28)⏎29 sts`, `= (34) 36 (38) 40⏎(42) 44 sts`, `(4) 3 (3) 3 (2½)
cm`, `(3½) 4 (4½) 4 (4) 3½ cm` (fractions inside).

**Gauge / needles (verbatim).** `TENSION` / `14 sts St-st with 6 mm ndls = 10 cm` → `{sts:14,
rows:null, over:10, unit:'cm', needle:'6 mm'}` — **no row gauge** (so a gauge card cannot turn
the cm targets into rows without the knitter's own swatch). `SUGGESTED KNITTING NEEDLES` /
`Circular and double pointed 5 mm and 6 mm`. Yarn `Pink print #4500: (2) 2 (2) 2 (3) 3 balls`
(children), `Blue/purple print #7500: (3) 3 (4) 4 (5) balls` (ladies) — yarn table, not counts.

**Vocabulary** (no abbreviation block): `k`, `p`, `sts`, `rnd(s)`, `ndl(s)`, `St-st`, `k-wise`,
`p-wise`, `k tbl`, `k2tog tbl` (left-leaning dec, = ssk), `k2tog`, `inc`, `dec`, `meas`,
`beg`, `cont`, `rep`, `alt rnds`, `tog`, `WS`. Lifted raglan increases are defined in prose
(`Inc to the right before marked st as follows: Pick up yarn between 2 sts before marked st,
transfer st k-wise to left ndl, then k the st.` / `… after marked st … and k tbl the st.`) —
an `m1`-type +1 each.

### Children (p2): (2) 4 (6) 8 (10) 12 yrs

| Section | Work | Counts (2, 4, 6, 8, 10, 12 yrs) |
|---|---|---|
| Neck rib | 5 mm circ, CO loosely, join, 7 cm k1 p1 rib in rnds | 48,52,56,56,60,60 |
| Inc rnd | 6 mm, k 1 rnd inc 8 evenly | **56,60,64,64,68,68** ✓ |
| BOR | `Insert marker at beg of rnd = middle back.` | — |
| Back-neck short rows (German) | 3 turns each side = **6 short rows** (see below) | unchanged |
| Raglan markers | `at` (from BOR): 10,17,38,45 · 11,18,41,48 · 12,19,44,51 · 12,19,44,51 · 13,20,47,54 · 13,20,47,54 (½ back 10,11,12,12,13,13 · sleeve 6 · front 20,22,24,24,26,26) | sums 56,60,64,64,68,68 ✓ |
| Raglan incs | +8 per inc rnd, on alt rnds, **a total of** 11,12,13,14,15,16 times | **144,156,168,176,188,196** ✓ |
| Divide | ½ back 21,23,25,26,28,29 · sleeve 30,32,34,36,38,40 (incl. both marked sts) to spare ndl · CO 4 underarm · front 42,46,50,52,56,58 · sleeve · CO 4 · ½ back | 21+30+42+30+21 = 144 ✓ … 29+40+58+40+29 = 196 ✓ |
| Back and front | `= (92) 100 (108) 112 (120) 124 sts.`; St-st in rnds until 32,36,40,44,48,48 cm from after the ribbing at middle back; 5 mm, 4 cm k1 p1 rib; cast off | **92,100,108,112,120,124** ✓ |
| Sleeves (each) | spare-ndl sts + knit up 1 in each of the 4 underarm sts; marker at middle underarm (BOR); at 3 cm dec 2 (`k2tog tbl after marker, and k2tog before marker`), rep every 3½,4,4½,4,4,3½ cm until 24,26,28,28,30,30 (5,5,5,6,6,7 dec rnds); until 21,25,28,31,34,36 cm; 4 cm rib; cast off | **34,36,38,40,42,44** → **24,26,28,28,30,30** ✓ |
| Finishing | fold neckband to WS, sew | — |

### Ladies (p3): (S) M (L) XL (XXL)

| Section | Work | Counts (S, M, L, XL, XXL) |
|---|---|---|
| Neck rib | 5 mm circ, CO loosely, 9 cm k1 p1 rib | 64,64,68,68,72 |
| Inc rnd | k 1 rnd inc 16 evenly | **80,80,84,84,88** ✓ |
| Back-neck short rows | 6 short rows (3 each side), 3 sts past the previous turn | unchanged |
| Raglan markers | `at`: 13,25,53,65 · 13,25,53,65 · 14,26,56,68 · 14,26,56,68 · 15,27,59,71 (½ back 13,13,14,14,15 then 14,14,15,15,16 — the two halves differ by 1 · sleeve 11 · front 27,27,29,29,31) | 80,80,84,84,88 ✓ |
| Raglan incs | +8 on alt rnds, `(17) 20 (21) 22 (23) times` (**total**, not "more" — the counts only work as totals) | **216,240,252,260,272** ✓ |
| Divide | ½ back 30,33,35,36,38 · sleeve 47,53,55,57,59 · CO 5,5,5,7,7 underarm · front 61,67,71,73,77 · sleeve · CO · ½ back 31,34,36,37,39 | 216 ✓ … 272 ✓ |
| Back and front | `= (132) 144 (152) 160 (168) sts.`; until 50,52,53,54,55 cm; 5 cm rib; cast off | **132,144,152,160,168** ✓ |
| Sleeves (each) | + knit up 5,5,5,7,7 underarm sts; dec 2 at 3 cm, then every 4,3,3,3,2½ cm until 32,34,34,36,36 (10,12,13,14,15 dec rnds); until 45 cm (all sizes); 5 cm rib | **52,58,60,64,66** → **32,34,34,36,36** ✓ |

Measurement check (14 sts = 10 cm): children chest 92/1.4 = 65.7 → printed 66 ✓ … 124 → 89 ✓;
ladies bust 132 → 94 ✓ … 168 → 120 ✓. Length = body target + rib (32+4 = 36 … ✓, 50+5 = 55 …
✓); sleeve = target + rib ✓. Every printed count re-derives.

### The German short rows at the back neck

Children, verbatim (one paragraph, after `Insert marker at beg of rnd = middle back.`):
`Work extra height at back with ''German Short Rows'' as follows:` /
`k(5) 6 (7) 8 (8) 9 sts, turn, sl 1 p-wise with yarn in front of work, lead yarn over right ndl,
pull yarn firmly at the back until 2 loops on right ndl, p(9) 11 (13) 15 (15) 17 sts, turn, sl 1
p-wise with yarn in front of work, lead yarn over right ndl, pull yarn firmly at the back until 2
loops on right ndl.` /
`Work and turn 2 sts pass previous turning until a total of 3 times at each side, work loops
tog on next row.`

Reading: short row 1 (RS, knit) from the BOR at the middle back k5 to the left and turn; the
turned st becomes a double stitch (DS); short row 2 (WS, purl) p9 = 4 back to the BOR + 5 past
it, turn, DS. Each later short row goes **2 sts past the previous turning point**; "a total of 3
times at each side" = 3 RS + 3 WS = **6 short rows**; then the next full round knits the DS
loops together ("work loops tog on next row") and the round continues. Turning points from the
BOR: 2 yrs ±5, ±7, ±9 · 4 yrs ±6, ±8, ±10 · 6 yrs ±7, ±9, ±11 · 8 yrs ±8, ±10, ±12 · 10 yrs
±8, ±10, ±12 · 12 yrs ±9, ±11, ±13 — all inside the ½-back sections (10–13 sts) ✓
(`p` count = 2×`k` − 1 ✓ every size). Stitch count never changes.

Ladies: `k(9) 9 (10) 10 (11) sts, sl 1 p-wise with yarn in front of work, …, p(17) 17 (19) 19
(21) sts, turn, sl 1 p-wise …, pull yarn firmly at the back until 2 loops on right ndl,.` /
`Work and turn in this manner but 3 sts pass previous turning until a total of 3 times at each
side, work loops tog on next row.` → 6 short rows, turning points ±9, ±12, ±15 (S, M), ±10, ±13,
±16 (L, XL), ±11, ±14, ±17 (XXL) — the third turn lies **past** the ½-back raglan st (13–15) in
the sleeve, which is fine (markers are placed after the short rows).

For the counter: these lines are the **only flat rows** in the pattern. `shortRow:true`; side
`rs` for the `k…, turn` part and `ws` for the `p…, turn` part (one sentence holds both); the
short-row sub-counter should be "short row n of 6" and must **not** advance the round count;
`Part.shortRows = {active, n, of: 6}`. The words used: `turn`, `German Short Rows`, `2 loops on
right ndl`, `loops tog` — no `w&t`, no "wrap".

**PATTERN ERRORs / wording slips (keep as printed).**
- Children: `Insert markers around 4 sts for raglan dec as follows:` — these are raglan
  **increases** (ladies says `raglan inc`).
- Children: `Rep inc every (3½) 4 (4½) 4 (4) 3½ cm until (24) 26 (28) 28 (30) 30 sts rem.` —
  it is a **decrease** (count goes down; ladies says `Rep dec every`). The parser must take the
  direction from the counts / preceding dec, not from the word `inc`.
- Children: `Cont until seeve meas …` (typo).
- Ladies: `k(9) 9 (10) 10 (11) sts, sl 1 p-wise …` — the **`turn` after the first knit run is
  missing** (children has it); a short-row detector keyed on `turn` must still mark the line
  (the second half has `turn`). Also `Inc to to the left` and `on right ndl,.`.
- `Rep inc on alt rnds a total of (11) … times` (children) vs `Rep inc on alt rnds (17) … times`
  (ladies): both are **totals** (the first inc round included) — the counts prove it.

**Markers.** BOR at middle back (body), BOR at middle underarm (each sleeve). Four raglan
markers are placed **around** a stitch (`insert marker around next st`) — marked stitches, not
gaps; `at` = that stitch's index (table above). Increases go before and after each marked st
(raglan +8 per round). At the divide the marked sts go with the sleeves (`included marked sts at
each side`).

### Hard lines (Sandnes raglan)

| # | Line (verbatim, wraps joined) | group | row | side | count | delta | until | shortRow | markers / notes |
|---|---|---|---|---|---|---|---|---|---|
| R1 | `(2) 4 (6) 8 (10) 12 yrs` (under `SIZES`) | children | — | — | — | — | — | no | `detectSizes` → 6 sizes `2, 4, 6, 8, 10, 12` (yrs). Not "2 + (4…)". |
| R2 | `(S) M (L) XL (XXL)` (under `SIZES`) | ladies | — | — | — | — | — | no | 5 sizes `S, M, L, XL, XXL`. |
| R3 | `With small 5 mm circular ndl cast on loosely (48) 52 (56) 56 (60) 60 sts. Join and work 7 cm ribbing k1, p1 in rnds.` | children | CO | null | 48,52,56,56,60,60 | — | length 7 cm (all sizes) | no | Part `Yoke`. "5 mm" is a needle, not a count. |
| R4 | `Change to 6 mm circular ndl, k 1 rnd, while inc 8 sts evenly spaced = (56) 60 (64) 64 (68) 68 sts.` | children | 1 rnd | null | explicit 56,60,64,64,68,68 | +8 | — | no | Count after `=`; wraps `(68)⏎68`. |
| R5 | `Insert marker at beg of rnd = middle back.` | both | — | — | — | — | — | no | `markers:[{name:'BOR', at:0}]`. |
| R6 | `k(5) 6 (7) 8 (8) 9 sts, turn, sl 1 p-wise with yarn in front of work, lead yarn over right ndl, pull yarn firmly at the back until 2 loops on right ndl, p(9) 11 (13) 15 (15) 17 sts, turn, sl 1 p-wise with yarn in front of work, lead yarn over right ndl, pull yarn firmly at the back until 2 loops on right ndl.` | children | short rows 1–2 | rs then ws | = prev (56…) | 0 | — | **yes** | `k(5)` glued. |
| R7 | `Work and turn 2 sts pass previous turning until a total of 3 times at each side, work loops tog on next row.` | children | short rows 3–6 + closing rnd | rs/ws | = prev | 0 | `{rows: 3 per side}` | **yes** | Total 6 short rows. |
| R8 | `Count (10) 11 (12) 12 (13) 13 sts (= ½ back), insert marker around next st, count 6 sts (= sleeve), insert marker around next st, count (20) 22 (24) 24 (26) 26 sts, (= front), insert marker around next st, count 6 sts (= sleeve), insert marker around next st, count (10) 11 (12) 12 (13) 13 sts (= ½ back).` | children | — | — | 56,60,64,64,68,68 (sum) | 0 | — | no | 4 marked sts, `at` above; `(= …)` are labels. |
| R9 | `Cont St-st in rnds and inc 1 st at each side of marked sts for raglan (as explained) = 8 sts inc.` | children | next rnd | null | +8 | +8 | — | no | `= 8 sts inc` is a **delta**, not a count. |
| R10 | `Rep inc on alt rnds a total of (11) 12 (13) 14 (15) 16 times = (144) 156 (168) 176 (188) 196 sts.` | children | repeat (2 rnds) | null | explicit 144,156,168,176,188,196 | +8 per 2 rnds | — | no | times = **total** 11…16. |
| R11 | `Work (21) 23 (25) 26 (28) 29 sts (= ½ back), transfer (30) 32 (34) 36 (38) 40 sts to spare ndl for sleeve, included marked sts at each side, cast on 4 new underarm sts, work (42) 46 (50) 52 (56) 58 sts (= front), transfer (30) 32 (34) 36 (38) 40 sts to spare ndl for sleeve, included marked st at each side, cast on 4 new underarm sts, work (21) 23 (25) 26 (28) 29 sts (= ½ back).` | children | divide rnd | null | computed 92,100,…(printed on the next line) | −52,−56,−60,−64,−68,−72 (held) | — | no | |
| R12 | `= (92) 100 (108) 112 (120) 124 sts.` | children | — | — | explicit 92,100,108,112,120,124 | — | — | no | Under `BACK AND FRONT`: a line that **starts** with `=`. |
| R13 | `Cont St-st in rnds until garment meas (32) 36 (40) 44 (48) 48 cm, meas from after ribbing at middle back and straight down, or 4 cm before suitable length.` | children | — | null | prev | 0 | length 32,36,40,44,48,48 cm | no | "or 4 cm before suitable length" is an alternative, not a second target. |
| R14 | `Transfer sleeve sts from spare ndl to 6 mm double pointed ndls and knit up 1 st in each of the new underarm sts = (34) 36 (38) 40 (42) 44 sts.` | children | setup | null | explicit 34,36,38,40,42,44 | — | — | no | Part `Sleeves`; then `Insert marker at middle underarm.` (BOR). |
| R15 | `Cont St-st in rnds, at the same time when sleeve meas 3 cm, dec 1 st at each side of marker as follows: k2tog tbl after marker, and k2tog before marker.` | children | — | null | −2 | −2 | at 3 cm | no | "at the same time". |
| R16 | `Rep inc every (3½) 4 (4½) 4 (4) 3½ cm until (24) 26 (28) 28 (30) 30 sts rem.` | children | — | null | explicit target 24,26,28,28,30,30 | **−2** per step (printed "inc") | interval cm vector | no | PATTERN ERROR wording. |
| R17 | `Cont until seeve meas (21) 25 (28) 31 (34) 36 cm, or 4 cm before suitable length.` | children | — | null | prev | 0 | length 21,25,28,31,34,36 cm | no | `seeve`. |
| R18 | `Work other sleeve in the same manner.` | both | — | — | — | — | — | no | Sleeves ×2. |
| R19 | `With 5 mm circular ndl cast on loosely (64) 64 (68) 68 (72) sts. Join and work 9 cm ribbing k1, p1 in rnds.` | ladies | CO | null | 64,64,68,68,72 | — | length 9 cm | no | 5-value alternating vector. |
| R20 | `Change to 6 mm circular ndl, k 1 rnd, while inc 16 sts evenly spaced = (80) 80 (84) 84 (88) sts.` | ladies | 1 rnd | null | explicit 80,80,84,84,88 | +16 | — | no | |
| R21 | `k(9) 9 (10) 10 (11) sts, sl 1 p-wise with yarn in front of work, lead yarn over right ndl, pull yarn firmly at the back until 2 loops on right ndl, p(17) 17 (19) 19 (21) sts, turn, sl 1 p-wise with yarn in front of work, lead yarn over right ndl, pull yarn firmly at the back until 2 loops on right ndl,.` | ladies | short rows 1–2 | rs then ws | = prev | 0 | — | **yes** | First `turn` missing in print. |
| R22 | `Work and turn in this manner but 3 sts pass previous turning until a total of 3 times at each side, work loops tog on next row.` | ladies | short rows 3–6 | — | = prev | 0 | — | **yes** | 3 sts (children: 2). |
| R23 | `Count (13) 13 (14) 14 (15) sts (= ½ back), insert marker around next st, count 11 sts (= sleeve), insert marker around next st, count (27) 27 (29) 29 (31) sts, (= front), insert marker around next st, count 11 sts (= sleeve), insert marker around next st, count (14) 14 (15) 15 (16) sts (= ½ back).` | ladies | — | — | 80,80,84,84,88 (sum) | 0 | — | no | Asymmetric ½ backs. |
| R24 | `Rep inc on alt rnds (17) 20 (21) 22 (23) times = (216) 240 (252) 260 (272) sts on ndl.` | ladies | repeat | null | explicit 216,240,252,260,272 | +8 per 2 rnds | — | no | times = total. |
| R25 | `= (132) 144 (152) 160 (168) sts.` | ladies | — | — | explicit 132,144,152,160,168 | — | — | no | |
| R26 | `Rep dec every (4) 3 (3) 3 (2½) cm until (32) 34 (34) 36 (36) sts rem.` | ladies | — | null | explicit target 32,34,34,36,36 | −2 per step | interval cm | no | |
| R27 | `Cont until sleeve meas 45 cm, or 5 cm before suitable length.` | ladies | — | null | prev | 0 | length 45 cm (all sizes) | no | |

**Size groups (wave G).** Importing this PDF should give **two groups**: `children` with 6 sizes
(p2) and `ladies` with 5 sizes (p3). The sections repeat with identical names in both groups
(`YOKE`, `BACK AND FRONT`, `SLEEVES`, `FINISHING`); a group-unaware import would merge 11 sizes or
double every part. The group boundary is the second `Limited edition` / `SIZES` block at the top
of p3. Nothing in the text says "children" before the children SIZES line — the group label
arrives later on the page (after `TENSION`).

## Gutenberg plain-text books (§14–§17) — common notes

- **Input is the `.txt` file itself** (no PDF, no text layer, no OCR): UTF-8, CRLF, hard-wrapped
  at ~70 columns, paragraphs separated by a blank line. A parser fed line by line splits every
  instruction mid-sentence and sometimes mid-number (`or 1½--inches`, `2⏎inches`); join each
  paragraph first. The Gutenberg header (up to `*** START OF THE PROJECT GUTENBERG EBOOK … ***`)
  and the licence after `*** END OF …` are boilerplate, never instructions.
- Transcriber markup: `=Bold=` and `_italic_` (stated in the transcriber's note of 57273;
  62646 uses `_Title._` for every pattern heading). `[Illustration: …]` lines are not text.
- **Single size** everywhere except *Begin to Knit* (§17). "Sizes" in the old books are
  separate patterns ("For a Child from 2 to 3 Years", "Lady's Ordinary Size") — each is its own
  pattern, not a size vector.
- **Gauge**: none of the 19th-century patterns gives a stitch gauge — only yarn + needle number
  in old wire gauge (`Needles, No. 18`, `Pins, No. 17`; higher = finer) and rounds-per-inch
  implied by "Knit 63 rounds plain, or 3 inches". The round count is the target; the inches
  are a note (same rule as Nicoll §7). `Project.gauge` must stay empty (or needle only); a
  "48 rounds, or 4 inches" pair may be used to *derive* rounds/inch but nothing is printed as
  a gauge line.
- **Old vocabulary** (all four books mix these; per-book specifics below): *plain* = knit,
  *pearl* / *purl* / *seam* = purl, *seam-stitch* = a purl (or alternately purled) column at the
  centre back of a stocking, *narrow* / *take in* / *intake* / *decrease* = a decrease (k2tog or
  sl1 k1 psso — the books say which), *widen* / *increase* / *make 1* = an increase, *slip and
  bind* = sl1 k1 psso, *slip, narrow and bind* = sl1 k2tog psso, *over* / *put over the thread* /
  *bring the thread forward* / *wool over the needle* = yo, *cast off* / *bind off*, *pins* =
  needles, *top-band* = cuff ribbing, *flap* = heel flap, *the top (of the heel)* = heel turn,
  *rib* = a garter ridge in some books (§16) but ribbing in others, *row* used for rounds in
  stockings ("decrease every 5th row").
- **"Repeat … N times" is not consistent** — sometimes N *more*, sometimes N in total, even
  inside one book. Each case below is decided by the book's own counts; the parser cannot
  know without a printed count, and when there is none it must not invent one.

## 14. `knit-pg-57273-stocking-knitters-manual.txt` — Mrs. George Cupples, *The Stocking-Knitter's Manual: A Handy Book for the Work-Table* (Johnstone, Hunter & Co., Edinburgh; undated — the adverts quote 1867 reviews; PG #57273)

1584 lines. Structure: Preface; `Directions for Working the different parts of a Stocking`
(Leg, Heel, French / Dutch / Common Heel, Preparations for the Foot, Gusset, Toe, How to
increase); `STOCKINGS.` (19 patterns: infant to gentleman, each in 1–3 yarns); `SOCKS.` (13
patterns, most say `Knit the foot same as page 11`); `OPEN-WORK PATTERNS` (7 lace stitch
patterns with their own letter code).

**Construction (every stocking).** Top-down in the round on 4 needles: cast on, *top-band* (k2
p2 or k2 p1 rib, counted in rounds), plain leg with a seam-stitch, an optional increase,
**intake table** (pairs of decreases either side of the seam-stitch), ankle, divide for the
heel (half the stitches with the seam-stitch in the centre, the other half on two needles —
which the book calls the **"short rows"**), heel flap in rows (`plain and pearl alternately`,
first st slipped), heel top (turn) "according to directions (see page 6)", pick up + gusset
intakes, foot, toe intakes at four corners with a plain round between, cast off ("Place the
needles together, and work the front and the back rows off at the same time" — a three-needle
bind-off).

**Vocabulary specific to Cupples.**
- `intake` = one decrease each side of the seam on one round (−2). On the right: "slipping off
  the 3d stitch … knit the next stitch, and take the slipped stitch over"; on the left "knit
  the 1st, slip the 2d, knit the 3d, and take the slipped stitch over". **"The round with the
  intakes on it is not to be counted"**: `N intakes with R rounds between each` = N × (R + 1)
  rounds.
- **`short rows` means the two instep needles** ("These two short rows are left till the heel
  is done") and `long row` the heel needle — **not short-row knitting**. `shortRow` must be
  false for every line of this book.
- `pearl` = purl; `plain` = knit; `top-band`; `the top` of the heel = heel turn; `3d`, `2d`
  ordinals; ditto marks `"` in intake tables (`3     "       "         with  9 rounds between.`
  = "3 intakes on each side, with 9 rounds between").
- **Open-work code (p29): `O` = yo, `T` = k2tog, `A` = sl1 k2tog psso, `Ts` = sl1 k1 psso,
  `P` = "plain 1" (= KNIT 1), `B` = "pearl" (purl).** So `P8, T, B3` = k8, k2tog, p3 — `P` is
  **knit** here, the opposite of the modern abbreviation. Rows are labelled `1st round--`,
  `2d    "    `, `1st row--`, `8th  "   plain all but the pearl stripes.`
- Cross-references to the book's own page numbers (`see page 6`, `Knit the foot same as page
  11`) — the app cannot resolve them; they must not become rows or counts.
- Pattern heading format: `=For an Infant.=--Knitted with merino wool--Needles, No. 18. Cast on
  80 stitches. …` — bold title, materials and the first instruction in **one paragraph**.

### 14a. Stocking "For an Infant" (merino, needles No. 18) — child's item (lines 366–386)

| Section | Work (as printed) | Count |
|---|---|---|
| Cast on | `Cast on 80 stitches.` | 80 |
| Top-band | `Knit 24 rounds, 2 pearl and 2 plain stitches alternately.` | 80 (20 × 4 ✓) |
| Leg | `Knit 43 plain rounds, or 2 inches in length, with a seam-stitch.` | 80 |
| Increase | `Increase three stitches on second round (see page 9).` | **83** |
| Intakes | `2 intakes with 6 rounds between each.` / `3 intakes with 7 rounds between each.` / `2 intakes with 8 rounds between each.` → 7 intake rounds, 2×7 + 3×8 + 2×9 = **56 rounds** | 83 − 14 = **69** ✓ ("reduces the stocking to 69") |
| Ankle | `Knit 1¼ inches plain for length of ankle.` (no round count — the only inch-only target) | 69 |
| Heel | `placing 17 on each side of seam-stitch, and leaving 34 for front of the foot` → heel 35; `Knit 23 rows for the heel, plain and pearl alternately, or 1 inch` | 17 + 1 + 17 + 34 = 69 ✓ |
| Foot | pick up "till there are 24 on each side of the seam, 7 being for the gusset" (24 − 7 = 17 ✓); gusset intakes 7 each side → **69** ✓; `Knit 2 together at back of the foot, to reduce it to an even number.` → 68; `Knit 33 rounds plain, or 1½ inches` | 68 |
| Toe | −4 every other round, `cast off with 10 stitches on each side the foot` | 68 → 20: 12 intake rounds ✓ (34 → 10 per side ✓) |

### 14b. Stocking "For a Child 9 to 12 Months" (merino, No. 18) (lines 411–431)

CO 92 · 24 rounds k2 p2 · `Knit 63 rounds plain, or 3 inches in length, with a seam-stitch.
Increase one stitch on the 1st round.` → 93 · intakes `3 … with 7 rounds between`, `3 … 9`,
`3 … 10`, `1 … 11` = 10 per side (rounds 3×8 + 3×10 + 3×11 + 12 = 99) → **73** ✓ (`reduces the
stocking to 73 stitches`) · ankle 33 rounds (1½") · heel 18 + 1 + 18 = 37, front 36 (= 73 ✓), 28
rows (1¼") · pick up to 27 each side, 9 for the gusset (27 − 9 = 18 ✓) → 73 ✓ · `Knit 2 stitches
together to make an even number.` → 72 · 43 rounds (2") · toe, `cast off with 12 stitches.` (no
"on each side": 72 → 12 or 24 both divide — leave the toe count as printed, `null` side split).

### 14c. "Lady's Ordinary Size" stocking (merino, No. 18) — stocking + lady's item (lines 661–683)

| Section | Work | Count |
|---|---|---|
| Cast on / top-band | `Cast on 148 stitches. Knit 30 rounds, 2 plain and 2 pearl stitches alternately.` | 148 (37 × 4 ✓) |
| Leg | `Knit 148 rounds plain, or 7¼ inches in length; increase 1 stitch.` | **149** |
| Intakes | `3 intakes with  6 rounds between each.` / `3 … 7` / `4 … 8` / `5 … 9` / `3 … 10` → 18 per side; rounds 3×7 + 3×8 + 4×9 + 5×10 + 3×11 = **164** | 149 − 36 = **113** ✓ |
| Ankle | `Knit 63 rounds for the ankle, or 3 inches in length.` | 113 |
| Heel | `placing 28 on each side of the seam, and leaving 56 for front of the foot` (57 + 56 = 113 ✓); `Knit 48 rows, plain and pearl alternately, or 2¾ inches` | heel 57 |
| Gusset | pick up "till there are 44 on each side of the seam, 16 being for the gusset" (44 − 16 = 28 ✓) → 145 before the gusset, 16 intakes each side | **113** ✓ |
| Foot | `Knit 2 together, and knit 88 rounds for the foot, or 4¼ inches.` | 112 |
| Toe | `cast off, with 18 on each side` | 112 → 36: 19 intake rounds ✓ (56 → 18 per side ✓) |

### 14d. "Socks for Gentlemen" (fingering worsted) — plain sock (lines 901–912)

CO 92 · 24 rounds k2 p2 · `Knit 111 rounds, or 7 inches in length. Increase 2 stitches on first
round.` → 94 · no intakes (socks are not shaped in the leg) · `placing 23 on each side of the
seam, leaving 47 for front of the foot` (47 + 47 = 94 ✓) · 43 rows (2¾") · pick up to 33 each
side, 10 for the gusset (33 − 10 = 23 ✓) → 94 · `knit 62 rounds, or 5 inches, for the foot` ·
toe `cast off with 16 stitches on each side`.

**PATTERN ERROR (toe parity).** Front 47 and back 47 lose 2 per intake round, so they pass 17 and
15, never 16 (94 − 32 = 62 is not a multiple of 4). Every pattern that works (14a–c) first
knits 2 together to an even/4-divisible total; this one does not. Same problem in `=For the
same.=` infant fingering stocking (front 21 → "8 stitches on each side"). Also inconsistent
rounds-per-inch: 111 rounds = 7" (15.9/in) but 62 rounds = 5" (12.4/in).

**PATTERN ERROR (Gentlemen's Knickerbocker, or Kilt Hose, lines 776–817).** Each kilt-hose
intake takes in **3** stitches per side ("slipping the 5th stitch from it. Knit together the
4th, 3d, and 2d, then take the slipped stitch over"): 8 intakes per side → 156 − 48 = **108**,
but the book prints `reduces the stocking to 96 stitches` (that would need 7½ sts per round).

**PATTERN ERRORs in the open-work code (stitch patterns, p29–31).**
- `LEAF PATTERN.` ("Calculate 9 stitches for each pattern, and 3 for pearl stripe" = 12): every
  odd round must consume 12 and make 13, every even round consume 13 and make 12. Rounds 3, 5,
  7, 9 do (`P2, O, P, O, P4, T, B3` = 2+1+4+2+3 = 12 → 13 ✓). **Round 1 `P, O, P, O, P, T, B3`
  consumes only 8** (a `P5` reads as `P`), and **round 11 `P6, O, P, T, B3` has one `O`** (12 → 12),
  so round 12 `P8, T, B3` (needs 13) cannot be worked.
- `PATTERN DIAMOND OF FOUR HOLES.` ("6 stitches for each pattern"): `1st row--P3, T, O, P2.`
  consumes 7; rows 3, 5, 7 consume 6 ✓.
- `SIMPLE PATTERN.` (`Pearl 3, O, T, P` = 6 ✓) and the others were not needed for the
  fixture; check before asserting them.

### Hard lines (Cupples)

| # | Line (verbatim, paragraph-joined) | row | side | count | delta | until | shortRow | notes |
|---|---|---|---|---|---|---|---|---|
| C1 | `=For an Infant.=--Knitted with merino wool--Needles, No. 18. Cast on 80 stitches.` | CO | — | 80 | — | — | no | Title + materials + CO in one paragraph; `No. 18` is a needle, never a count or size. |
| C2 | `Knit 24 rounds, 2 pearl and 2 plain stitches alternately.` | 24 rnds | null | = prev | 0 | `{rows: 24}` | no | Rib in words: "2 pearl and 2 plain … alternately" = p2 k2. |
| C3 | `Knit 43 plain rounds, or 2 inches in length, with a seam-stitch.` | 43 rnds | null | = prev | 0 | `{rows: 43}` (the inches are a note) | no | |
| C4 | `Increase three stitches on second round (see page 9).` | rnd 2 of the leg | null | 83 (computed) | **+3** (word number) | — | no | "(see page 9)" = book page, not a count. |
| C5 | `2 intakes with 6 rounds between each.` | 14 rnds | null | −4 | −2 per intake rnd | `{rows: 14}` | no | First line of an intake table; N × (R + 1) rounds. |
| C6 | `This makes 14 intakes altogether--7 on each side of seam, and reduces the stocking to 69.` | — | — | explicit 69 | — | — | no | `--` is an em dash; "14 intakes" is a decrease count, not a stitch count. |
| C7 | `Divide the stitches, placing 17 on each side of seam-stitch, and leaving 34 for front of the foot.` | — | — | 35 heel + 34 held | — | — | no | |
| C8 | `Knit 23 rows for the heel, plain and pearl alternately, or 1 inch;` | 23 rows | rs/ws alternating | 35 | 0 | `{rows: 23}` | **no** | Flat rows. |
| C9 | `pick up the stitches for the foot till there are 24 on each side of the seam, 7 being for the gusset.` | — | null | 24 per side | — | — | no | Per-side count. |
| C10 | `When the gusset is done, there ought to be 69 stitches on.` | — | null | explicit 69 | — | — | no | "ought to be" = a count. |
| C11 | `Knit the toe (see page 8), and cast off with 10 stitches on each side the foot.` | — | null | 20 (10 per side) | — | — | no | |
| C12 | `These two short rows are left till the heel is done.` (Directions, The Heel) | — | — | — | — | — | **no** | "short rows" = the two instep needles. |
| C13 | `3     "       "         with  9 rounds between.` (child 9–12 months) | 30 rnds | null | −6 | −2 | `{rows: 30}` | no | Ditto marks stand for "intakes on each side". |
| C14 | `Knit 148 rounds plain, or 7¼ inches in length; increase 1 stitch.` (Lady's) | 148 rnds | null | 149 | +1 | `{rows: 148}` | no | |
| C15 | `This makes 36 altogether--18 on each side of seam, and reduces the stocking to 113.` | — | — | explicit 113 | — | — | no | |
| C16 | `Knit 2 together, and knit 88 rounds for the foot, or 4¼ inches.` | 88 rnds | null | 112 (computed) | −1 | `{rows: 88}` | no | |
| C17 | `Knit 111 rounds, or 7 inches in length. Increase 2 stitches on first round.` (Gentlemen's socks) | 111 rnds | null | 94 | +2 | `{rows: 111}` | no | |
| C18 | `Knit the toe; and cast off with 16 stitches on each side.` (Gentlemen's socks) | — | null | printed 32 (unreachable from 94 — parity) | — | — | no | PATTERN ERROR above. |
| C19 | `   2d    "    P8, T, B3.` (Leaf Pattern) | 2 | null | 12 per repeat | −1 | — | no | `P` = knit, `B` = purl, `"` = "round". |

## 15. `knit-pg-62646-ladys-knitting-book.txt` — E. M. C. (Elvina Mary Corbould), *The Lady's Knitting-Book* (Hatchards, Piccadilly, London; printed by John Strangeways; undated, 19th century; PG #62646)

2602 lines; "eighty clear and easy patterns". Contents with page numbers (ditto marks `”` for
repeated words). `EXPLANATIONS.`, `_Stockings and Socks._`, `_General Remarks on Socks and
Stockings._`, `_Heel of a Stocking or Sock._` (page 11), `_To Decrease for the Toe of a Sock or
Stocking._` (page 12), `_Decreasing for Instep._`, then ~20 stocking/sock patterns, baby's
boots, double knitting, waistcoats, muffatees, purses, vest, shawl, antimacassars, quilts,
petticoats, fancy stitches, bodice, baby's jacket, gaiter, knee-cap, baby's hood.

**The book's own glossary** (`EXPLANATIONS.`): "'To purl or pearl' and 'to seam' mean the same
thing"; "'To decrease' is simply to knit two stitches together. Another way is to slip a
stitch, knit one, pass the slipped stitch over it."; "'To take two together' means to knit two
together."; "'To increase,' you must knit both into the lower part of the stitch, and also into
the stitch itself." (a lifted/bar increase). `Knits.glossary` should take these as
`fromPattern:true` (purl ≡ pearl ≡ seam; decrease = k2tog or skp; take two together = k2tog;
increase = knit into the stitch below and the stitch). Also: `pins` = needles (`Pins, No. 17`),
`put/pass the wool over the needle` / `bring the thread forward` = yo, `seam-stitch` ("made by
knitting a certain stitch in two rounds and pearling it in the third"), `flap`, `rows` for
rounds, `the side-stitches`. Row labels are **spelled-out ordinals with an em dash**:
`First row—knit plain.`, `Twenty-first row—slip the 1st, knit 2 together; …`. Counts
mostly in inches ("When 12 inches are done decrease … until you have 92 stitches").
Cross-references by page: `Proceed as on page 10`, `Turn the heel as on page 11`, `decrease
(see page 12)`, `as page 16` (→ Gentleman's Knickerbocker), `as with Girl's Stocking, page 19`.

**"Repeat … N times" = N MORE in this book** — proven twice in the Baby's Boot: "Repeat these
four rows three times, so as to have four rows of ornamental holes" (1 + 3 = 4) and "Repeat
these 4 rows 4 times. You ought now to have 5 rows of ornamental holes" (1 + 4 = 5). Also "Do *
7 more rows and increase. Repeat from * twice more."

### 15a. "Lady's Striped Silk Stocking. (MEDIUM SIZE.)" — stocking + lady's item (lines 319–343)

`2 oz. black and 2 oz. rose-coloured Imperial knitting-silk. Pins, No. 17.` Top-down in the
round, stripes changed at the seam-stitch.

| Step | As printed | Count |
|---|---|---|
| CO + rib | `Cast on 128 stitches in black, do 12 rounds of 2 plain, 2 pearl.` | 128 (32 × 4 ✓) |
| Plain leg | `Now make the first stitch the seam-stitch, and do plain knitting until 4 inches are done, making the stripes come quite evenly, one inch broad.` | 128 |
| Rib 3 + 1 | `Now do 3 plain and 1 pearl alternately.` | 128 |
| Calf | `When 5½ inches are done decrease on each side of the seam-stitch. Do * 7 more rows and increase. Repeat from * twice more.` → 1 decrease round, 3 increase rounds 8 rounds apart | not printed: 132 if every decrease/increase is a pair at the seam (the decrease is explicitly "on each side"), 130 if each increase is a single stitch — **leave null** |
| Ankle | `When 12 inches are done decrease for the ankle every five rows until you have 92 stitches.` | explicit **92** |
| Leg end | `Knit until the stocking is 20 inches long, and then divide for the heel. Proceed as on page 10;` | 92 |
| Instep | `pick up the side-stitches, and decrease over the instep until you have 90 stitches:` | explicit **90** |
| Foot / toe | `When the foot is 7 inches long discontinue ribbing. Knit 9 rounds plain, and then decrease (see page 12). The foot must be 9¼ inches long. Cast off and sew up carefully on the wrong side.` | — |

### 15b. "Sock for a Child of Two Years Old." — child's item (lines 429–441)

| Step | As printed | Count |
|---|---|---|
| CO | `Cast on 23 on the first pin, 22 on the second, and 20 on the third.` | **65** (per-needle counts only; the total is never printed) |
| Rib | `Knit a plain round, keeping the first stitch as the seam-stitch. Do ten rounds in ribs of 2 plain, 2 pearl.` | 65 = seam + 64 (16 × 4 ✓); **"ten" in words** |
| Leg | `Now do plain knitting, and decrease twice in every fourth round for 12 rounds.` | 3 decrease rounds × 2 → **59** (computed) |
| Ankle | `Knit 10 rounds.` | 59 |
| Heel | `Take 14 on each side of the seam-stitch for the heel, knit backwards and forwards for 20 rows; turn (see page 11).` | heel 29, instep 30; 20 rows → 10 slipped edge sts per side |
| Foot | `Take up 10 side-stitches, and reduce until you have 56 for the foot.` | explicit **56** (10 ✓ matches the 20-row flap) |
| Toe | `Do 26 rounds, decrease, and cast off.` | — |

### 15c. "Gentleman's Ribbed Sock. (SMALL SIZE.)" — plain sock (lines 582–607)

| Step | As printed | Count |
|---|---|---|
| CO | `Cast on 80. One plain round; make the first stitch the seam-stitch.` | 80 |
| Top | `Knit in ribs of 1 plain, 1 pearl, for 2½ inches.` | 80 |
| Leg | `Now begin to rib in threes; 3 plain stitches, 1 pearl. Continue thus for 8 inches,` | 80 |
| Heel | `and then divide for the heel by taking 20 stitches on each side of the seam-stitch. Knit these 21 backwards and forwards, remembering to keep the seam-stitch and ribs even: you must, in coming back, of course pearl 3 and knit 1. When 3 inches or 34 rows are done you discontinue ribbing, and turn the heel as on page 11.` | heel **41** (20 + 1 + 20), instep 39 — **printed "21"** |
| Foot | `Pick up 18 stitches from the side, and knit the sole plain, but continue the 10 ribs on the 2 front pins. When 2 rounds are done, decrease every round until you have only 70 stitches;` | explicit **70** |
| Toe | `then knit until the foot is 7½ inches long. You now discontinue ribbing. Do 8 rounds plain, and then decrease for the toe as on page 12. This takes up 2 more inches, and your sock ought now to be 10 inches long. Cast off and sew up.` | — |

**PATTERN ERROR.** `Knit these 21 backwards and forwards` — 20 on each side of the seam-stitch is
**41** heel stitches (the book's own heel example: "take 12 on each side of the seam-stitch,
and knit these 25"). Keep as printed; the count after it must be 41 if computed, never 21.
"When 3 inches or 34 rows are done" — rows **and** inches; the rows are the target.

### 15d. "Baby's Boot." (the "very pretty" one, two pins, flat) — row labels in words (lines 611–749)

Flat, `Cast on 50 stitches with the pink.` Rows are numbered **in words**, and the numbering
**restarts and repeats inconsistently** — exactly what a word-number parser must survive:

- `First row—knit plain.` · `Second row—knit the 3 first stitches; * pearl 2, knit 2. Repeat from *
  until you come to the last 3 stitches, which must be knitted.` (3 + 44 + 3 = 50 ✓) · `Repeat
  this row twice.` (rows 3–4) · `Fifth row—plain.` · `Sixth row—pearl.` · `Seventh row—slip the
  first stitch, * take 2 together. Repeat from *; knit the last stitch.` (1 + 24 + 1 = **26**) ·
  `Eighth row—slip the first stitch, * put the wool over the needle to increase; knit 1; repeat
  from *. In this way you ought to have 50 stitches on your needles.` (explicit **50**: 1 + 24
  × 2 + 1) · `Ninth`–`Fourteenth row` (11th = 7th → 26, 12th "the same as eighth" → 50).
- White section: `Do 9 rows of ribbed knitting, …` then **`Tenth row—plain knitting.`**,
  `Eleventh row—pearl.`, `Twelfth row—…take 2 together…`, `Thirteenth row—… You ought now to have
  50 stitches.`, `Fourteenth row—plain knitting.`, `Fifteenth row—pearl.`, `Repeat these four rows
  three times, so as to have four rows of ornamental holes.` — the numbering **continues from
  the 9 rib rows** (10–15) though these are rows 15–20 of the boot.
- Pink again: **`Sixteenth row—slip 1, take 2 together; knit 10, take 2 together; knit 20, take 2
  together; knit 10, take 2 together.`** (49 of the 50 sts named; −4 → **46**), then
  **`Second row—knit plain.`** (numbering restarts at 2), `Third row—slip one, take 2 together;
  … until you come to the 3rd and 2nd from the end, which must be knitted together.` (→ **44**),
  `Fourth row—plain knitting.`, `Fifth row—knit 14. Join the white, knit 16; turn round and work
  on those 16 stitches in white, leaving the pink on the needle without working them.` (14 + 16
  + 14 = 44 ✓ — **`turn` here is not a short row; it starts the instep flap**).
- Instep flap: `The next row slip 1, and increase before every stitch …: you ought now to have 16
  stitches.` (explicit 16), `Repeat these 4 rows 4 times. You ought now to have 5 rows of
  ornamental holes.`
- Foot: `Knit 14 rows.` then `Fifteenth row—*, slip the 1st stitch, take 2 together. This ought
  to be at the toe.` … `Twenty-eighth row—plain, cast off.`, a toe gusset ("increase at the toe
  until you have 18 stitches … Decrease every other time at the toe, until you have only 11
  stitches"), and `Go back to * at the 15th row, and end at the 28th row.` (a jump back to a
  `*` placed inside a row label).

Expected parser behaviour: `First`…`Twenty-eighth` → 1…28 (`Twenty-first` hyphenated);
counts only where printed (`ought to have 50`, `16`, `18`, `11`); restarts (`Tenth` after 9
unnumbered rows, `Second` after `Sixteenth`) produce new row runs, never a negative jump; `side`
by parity is **unsafe** (the boot alternates plain/pearl rows but "Repeat this row twice" and
the restarts break parity) — leave `side` null unless a row says "pearl"/"knit" for a whole
stocking-stitch row.

### Hard lines (Corbould)

| # | Line (verbatim, paragraph-joined) | row | side | count | delta | until | shortRow | notes |
|---|---|---|---|---|---|---|---|---|
| E1 | `Cast on 128 stitches in black, do 12 rounds of 2 plain, 2 pearl.` | CO + 12 rnds | null | 128 | — | `{rows: 12}` | no | Colour word "in black". |
| E2 | `When 5½ inches are done decrease on each side of the seam-stitch. Do * 7 more rows and increase. Repeat from * twice more.` | — | null | **null** | −2 then +(1 or 2) ×3 | at 5.5 in | no | `*` inside the sentence; "twice more" = 2 more. |
| E3 | `When 12 inches are done decrease for the ankle every five rows until you have 92 stitches.` | — | null | explicit target 92 | −2 every 5 rnds | none (count target; "every five rows" in words) | no | "rows" = rounds. |
| E4 | `pick up the side-stitches, and decrease over the instep until you have 90 stitches:` | — | null | explicit 90 | — | — | no | |
| E5 | `Cast on 23 on the first pin, 22 on the second, and 20 on the third.` | CO | — | **65** (sum of per-needle counts) | — | — | no | Total not printed. |
| E6 | `Do ten rounds in ribs of 2 plain, 2 pearl.` | 10 rnds | null | = prev | 0 | `{rows: 10}` ("ten") | no | Word number. |
| E7 | `Now do plain knitting, and decrease twice in every fourth round for 12 rounds.` | 12 rnds | null | computed 59 | −2 on rnds 4, 8, 12 | `{rows: 12}` | no | "twice" = 2 decreases, not 2 repeats. |
| E8 | `Take up 10 side-stitches, and reduce until you have 56 for the foot.` | — | null | explicit 56 | — | — | no | |
| E9 | `… Knit these 21 backwards and forwards, …` (Gentleman's Ribbed Sock) | — | rs/ws | printed 21, true 41 | — | — | no | PATTERN ERROR. |
| E10 | `When 3 inches or 34 rows are done you discontinue ribbing, and turn the heel as on page 11.` | 34 rows | alternating | 41 | 0 | `{rows: 34}` | no | "as on page 11" = book page. |
| E11 | `When 2 rounds are done, decrease every round until you have only 70 stitches;` | — | null | explicit 70 | −1 or −2 per rnd | — | no | |
| E12 | `Seventh row—slip the first stitch, * take 2 together. Repeat from *; knit the last stitch.` | 7 | (flat) | computed 26 | −24 | — | no | Word ordinal + em dash. |
| E13 | `Eighth row—slip the first stitch, * put the wool over the needle to increase; knit 1; repeat from *. In this way you ought to have 50 stitches on your needles.` | 8 | — | explicit 50 | +24 | — | no | |
| E14 | `Tenth row—plain knitting.` (after `Do 9 rows of ribbed knitting`) | 10 (restart within the white section) | — | 50 | 0 | — | no | Numbering continues from an unnumbered 9-row block. |
| E15 | `Sixteenth row—slip 1, take 2 together; knit 10, take 2 together; knit 20, take 2 together; knit 10, take 2 together.` → `Second row—knit plain.` | 16, then 2 | — | computed 46 | −4 | — | no | Restart to `Second`. |
| E16 | `Fifth row—knit 14. Join the white, knit 16; turn round and work on those 16 stitches in white, leaving the pink on the needle without working them.` | 5 | — | 16 in work (14 + 16 + 14 = 44) | — | — | **no** | `turn` starts an instep flap. |
| E17 | `Twenty-first row—slip the 1st, knit 2 together; knit 2 together again; continue plain knitting to within 5 of the heel, when you knit the 5th and 4th together; knit the 3rd and 2nd together, and the last stitch plain.` | 21 | — | −4 | −4 | — | no | Hyphenated word ordinal. |
| E18 | `Go back to * at the 15th row, and end at the 28th row.` | — | — | — | — | — | no | A repeat whose start is a `*` written before a row label (`Fifteenth row—*, slip …`). |

## 16. `knit-pg-26113-handbook-wool-knitting-crochet.txt` — *Handbook of Wool Knitting and Crochet* (anonymous; Needlecraft Publishing Company, Augusta, Maine, 1918; PG #26113)

3269 lines. Knitting half: `A Lesson in Knitting` (techniques), garments (Sleeveless Sweater,
Winter-Girl costume, Children's Knitted Sets, Serviceable Sweater, **Ladies' Sweater**, **Ladies'
Knitted Gloves with Fancy Backs**, slippers, Babies' Long Bootees, **Child's Knitted Mittens**,
knee-cap, wristers, scarves), `Knitting for the Red Cross` (Sleeveless Sweater, Washcloth,
**Service Sock**, helmets, muffler, mitts, bed-sock), child's leggings, doll's hood; from line
~1579 the book is **crochet** (`A Lesson in Crochet` … to the end) — a knitting import must stop
there or treat it as crochet. No stocking pattern in this book (only socks).

**Vocabulary (from `A Lesson in Knitting`).** `knit plain`, `purl` / `seam-stitch`, `garter-stitch`
(= "ridge-stitch"), **`rib`** used two ways: `single rib` (k1 p1), `double rib` (k2 p2), `triple
rib` (k3 p3) are ribbing, but in garment instructions **`ribs` are garter ridges** — the book says
so: `knit 48 ribs, or 96 rows`, `knit 6 rows back and forth, or 3 ribs`. `over` = yo; `narrow` =
k2tog; `purl-narrow` = p2tog; `slip and bind` = sl1 k1 psso; `slip, narrow and bind` = sl1 k2tog
psso; `widen` = increase ("pick up a stitch between needles and knit it"); `bind off` / `cast
off`; `Fagot` (named as an abbreviation for the purl-narrow). Rows are **numbered `1.`, `2.`**
(digit + period) and enumerated `2, 3, 4. Knit 2, purl 1.`; elsewhere counts in words ("knit two
inches", "two and one-half inches", "three times", "seven patterns in length"). Needles: `No. 5
amber needles`, `No. 11 steel needles`, `Red Cross needles No. 2`. Some patterns give a stitch
gauge in prose (`11 stitches should measure two inches`, `Nine stitches measure one inch`).

**"Repeat … N times" means N more AND N in total in the same book:** `Repeat these two rows
twice, making 6 rows in all` (Sleeveless Sweater: N more) vs. the Service Sock's `Repeat,
narrowing as directed every 6th round, 4 times.` (N in total — only that reading gives the
printed `30 left on the needle for front of foot`).

### 16a. Service Sock (Red Cross, 1918) — plain sock (lines 1276–1325)

| Step | As printed | Count |
|---|---|---|
| CO | `Cast on 24 stitches on each of 2 needles, and 20 on the 3d.` | **68** (sum) |
| Cuff | `Knit 2 and purl 2 for 3½ inches.` | 68 (17 × 4 ✓) |
| Seam-stitch | `Knit 10, or halfway across the 3d needle, pick up an extra stitch and purl it, keeping this always for the seam-stitch at back of leg, knit plain to end of round.` | **69** (+1) |
| Leg | `Continue knitting plain and purling the seam stitch for four inches.` | 69 |
| Leg shaping | `Knit to within 3 stitches of the seam-stitch, narrow, knit 1, purl the seam-stitch, knit 1, slip 1, knit 1, draw the slipped stitch over, and knit plain to end of round. Repeat, narrowing as directed every 6th round, 4 times. Now knit without decreasing for one inch.` | **4 narrowing rounds in total** → **61** (computed; 5 would give 59 and a 28-st instep) |
| Heel flap | `Place 15 stitches each side of the middle or seam-stitch, and knit back and forth, 1 row plain and 1 purl, alternately, for 25 rows, always slipping the 1st stitch.` | heel 31, instep 30 ✓ |
| Heel turn | 15 rows written out: `slip the 1st stitch, knit 15, narrow, knit 1, turn work; slip 1, purl 2, purl 2 together, purl 1, turn, slip 1, knit 3, narrow, knit 1, turn; … slip 1, purl 14, purl 2 together, purl 1, turn; slip 1, knit 14, narrow.` | 31 → 17 after the 14th turn row (12 outer sts each side consumed 2 per row), **16** after the last `slip 1, knit 14, narrow` (computed; never printed) |
| Gusset pick-up | `pick up 17 stitches down side of heel …; knit the 30 left on the needle for front of foot, and pick up 17 down other side of heel; then knit on with these half the stitches left at top of heel.` | 8 + 17 + 30 + 17 + 8 = **80** (computed) |
| Instep | `Decrease in this manner every 2d round until there are 15 stitches on each side needle, reducing them to correspond with the front needle, and making 10 narrowings for the instep.` | 25 → 15 per side = **10 narrowings ✓** → **60** |
| Foot | `Knit five inches without narrowing,` | 60 |
| Toe | −4 (`… Knit 2 rounds plain, and repeat last 3 rounds three times more;` → 4 dec rounds → 44), `then decrease with 1 row plain between three times,` (→ 32), `and after that decrease every row until there are but 4 stitches on the front needle.` (front 16 → 4: 6 rounds → 8) | **60 → 44 → 32 → 8**, front 4 ✓ (printed target) |

Every number the sock prints (30, 15, 10 narrowings, 4) is consistent with the 4-total reading
and a 16-st heel. Note "repeat last 3 rounds three times more" (3 more, 4 in all) two sentences
after "Repeat … 4 times" (4 in all).

### 16b. Ladies' Knitted Gloves with Fancy Backs — lady's item with a stated cable cadence (lines 862–928)

`Use No. 16 steel needles, with Spanish knitting-yarn or worsted. Cast on 57 stitches.` (in the
round). Numbered pattern rows (19-st repeat, ×3 = 57 ✓):

- `1. Purl 2, slip and bind, (over, knit 1) 5 times, over, narrow, purl 2, knit 6; repeat twice.`
  — consumes 19, makes 23 (6 overs, 2 decreases) → **69**; "repeat twice" = 2 more (57 / 19 = 3).
- `2. Purl 2, knit 13, purl 2, knit 6; repeat.` — 23 ✓.
- `3. Purl 2, slip and bind, knit 9, narrow, purl 2, knit 6; repeat.` — 23 → 21 (**63**).
- `4. Purl 2, slip and bind, knit 7, narrow, purl 2, knit 6; repeat.` — 21 → 19 (**57**).
- `5. Same as 4th row.` — **PATTERN ERROR**: row 4 needs 21 sts per repeat but only 19 remain
  after row 4 (and it would remove 2 more per repeat). Row 6 again consumes exactly 19, so row 5
  must be a plain round of 19 (`purl 2, knit 9, purl 2, knit 6`); as printed it cannot be worked.
- `6. Purl 2, slip and bind, (over, knit 1) 5 times, over, narrow, purl 2, take 3 of the 6
  stitches off on a separate needle, hold this at back of work, knit next 3 stitches, then knit
  the 3 on separate needle; repeat.` — the cable is a **C6B** (w 6, back) written out, no
  abbreviation.
- **`Continue in pattern, twisting the "cable" as directed every 6th row, until the wrist is
  seven patterns in length.`** — the only line in all the fixtures that states a cable cadence
  in words: `Line.cable = {every: 6, name: 'cable'}`; the wrist is 7 × 6 = 42 rounds. "rows" are
  rounds here.
- Thumb: `Begin thumb with widen, knit 1, widen; knit 3 rows as usual, then widen, knit 3, widen;
  continue in this way until you have widened the thumb to 17 stitches.` (1 → 3 → 5 … 17: 8
  widening rounds, every 4th round); `on a 3d needle cast on 7 stitches … in each of next 3
  rounds narrow 1 of the 7 stitches` (17 + 7 = 24 → 21), fingers each `cast on 6 stitches`, `knit
  two and one-half inches` (inches in words).

### 16c. Ladies' Sweater (garter "ribs") — lady's item (lines 800–860)

`With the knitting-worsted and No. 5 needles, cast on 119 stitches for the back, which will
measure about twenty-four inches, and knit 48 ribs, or 96 rows.` (119 / 24" ≈ 5 sts/in).
`Next row, * narrow, knit 4; repeat from *.` (119 = 19 × 6 + 5; with the last group `narrow,
knit 3` → **99**; not printed) · belt `20 rows in triple rib (knit 3, purl 3)` (99 = 16 × 6 + 3 ✓)
· `knit 20 ribs` · `decrease 1 stitch at end of needle every other row five times` · `Knit 29
ribs plain` · `knit 34 stitches, slip them on to a spare needle, bind off 21 stitches for neck,
and on the remaining 34 stitches …` (34 + 21 + 34 = **89** = 99 − 10 ✓, so "at end of needle"
means **both ends**, 5 times) · fronts worked **downward from the shoulder**: `knit 4 ribs; then
cast on 30 stitches at the neck, knit 29 ribs, increase 1 stitch at armhole every other row five
times, and knit 22 ribs plain` (34 + 30 + 5 = **69**) · belt · `* knit 4, increase 1 stitch,
repeat from *` · `knit 48 ribs and bind off on the wrong side.` · sleeve `pick up 1 stitch on each
rib around the armhole, 72 stitches in all; knit 8 ribs, then decrease 1 stitch at each end of
needle every 8th rib, eight times.` (72 − 16 = **56**).

`ribs` here are **ridges = 2 rows** (`48 ribs, or 96 rows`); `triple rib` is ribbing. The counter
must convert "knit 20 ribs" into 40 rows, and the 3D must draw garter.

### 16d. Child's Knitted Mittens — child's item (lines 1028–1080)

`No. 17 is a good average size. Cast 18 stitches on each of three needles.` (**54**) · `Knit 2,
purl 1; repeat, until the wrist is of length desired, say two inches.` · pattern:

`1. Purl.` / `2, 3, 4. Knit 2, purl 1.` / `These 4 rows are repeated throughout.` — rounds called
rows; the label `2, 3, 4.` is a **row enumeration** (rows 2, 3 and 4 identical).

Thumb gusset: `to widen pick up a stitch between needles and knit it, knit 1, widen` (3 sts
across the thumb), `Knit 2 rows, in pattern, and again widen, knit 3, widen` … `adding 2 stitches
between the widenings every 3d row … until you have 21 stitches across the thumb.` (3 → 21: 10
widening rounds, +20 → 74) · thumb sts to a thread (−21 → 53) · `cast on 7 stitches, or one third
the number widened for the thumb` (21 / 3 = 7 ✓ → **60**) · top: `narrow every 5th stitch, and knit
5 times around; then narrow every 4th stitch and knit 4 times around; every 3d stitch and knit 3
times around; every 2d stitch and knit twice around; then narrow, knit 1, repeat around, knit once
around, narrow every stitch` → 60 → 48 → 36 → 24 → 12 → 8 → 4 (every step divides ✓; none
printed). Thumb: 21 + 7 picked up, `narrow once each end of the picked-up stitches` → 26.

### Hard lines (Handbook)

| # | Line (verbatim, paragraph-joined) | row | side | count | delta | until | shortRow | cable / notes |
|---|---|---|---|---|---|---|---|---|
| H1 | `Cast on 24 stitches on each of 2 needles, and 20 on the 3d.` | CO | — | **68** (sum) | — | — | no | Per-needle counts. |
| H2 | `Knit 2 and purl 2 for 3½ inches.` | — | null | = prev | 0 | length 3.5 in | no | |
| H3 | `Knit 10, or halfway across the 3d needle, pick up an extra stitch and purl it, keeping this always for the seam-stitch at back of leg, knit plain to end of round.` | 1 rnd | null | computed 69 | +1 | — | no | "3d needle" is a needle, not a row. |
| H4 | `Repeat, narrowing as directed every 6th round, 4 times.` | — | null | computed 61 | −2 per narrowing rnd | — | no | "4 times" = total here. |
| H5 | `Place 15 stitches each side of the middle or seam-stitch, and knit back and forth, 1 row plain and 1 purl, alternately, for 25 rows, always slipping the 1st stitch.` | 25 rows | alternating | 31 | 0 | `{rows: 25}` | no | |
| H6 | `To turn the heel, slip the 1st stitch, knit 15, narrow, knit 1, turn work; slip 1, purl 2, purl 2 together, purl 1, turn, …; slip 1, knit 14, narrow.` | 15 turning rows in one sentence | rs/ws | computed 16 at the end | −1 per row | — | **no** (a heel turn written as rows — `turn` but not a short-row section; if the detector marks it, the sub-counter must count 15) | One paragraph = 15 rows; the parser should split at `turn`. |
| H7 | `… and making 10 narrowings for the instep.` | — | null | 60 (computed: 15 + 30 + 15) | — | — | no | "10 narrowings" is a decrease count, not a stitch count. |
| H8 | `Knit 2 rounds plain, and repeat last 3 rounds three times more;` | — | null | 44 (computed) | −4 per 3 rnds | — | no | "three times more" = 3 more. |
| H9 | `… and after that decrease every row until there are but 4 stitches on the front needle.` | — | null | 4 on the front needle (8 total) | −4/rnd | — | no | Per-needle target. |
| H10 | `1. Purl 2, slip and bind, (over, knit 1) 5 times, over, narrow, purl 2, knit 6; repeat twice.` | 1 | null | computed 69 | +12 | — | no | `1.` = row label. |
| H11 | `5. Same as 4th row.` | 5 | null | (cannot be worked) | — | — | no | PATTERN ERROR. |
| H12 | `Continue in pattern, twisting the "cable" as directed every 6th row, until the wrist is seven patterns in length.` | — | null | prev | 0 | `{rows: 42}` ("seven patterns" × 6) | no | **`cable: {every: 6}`**. |
| H13 | `With the knitting-worsted and No. 5 needles, cast on 119 stitches for the back, which will measure about twenty-four inches, and knit 48 ribs, or 96 rows.` | CO + 96 rows | alternating | 119 | 0 | `{rows: 96}` | no | "ribs" = ridges; "twenty-four inches" is a width. |
| H14 | `Next row, * narrow, knit 4; repeat from *.` | next | — | null printed (99 computed) | −20 | — | no | Remainder 5 not addressed. |
| H15 | `Change to No. 5 needles and knit 20 ribs; then decrease 1 stitch at end of needle every other row five times.` | 40 rows + 10 rows | — | 89 (computed, confirmed by 34 + 21 + 34) | −2 × 5 | `{rows: 40}` | no | |
| H16 | `Cast 18 stitches on each of three needles.` | CO | — | **54** | — | — | no | "three" in words. |
| H17 | `2, 3, 4. Knit 2, purl 1.` | 2, 3, 4 | null | 54 | 0 | — | no | Enumeration label without the word "rows". |
| H18 | `Continue in this way, adding 2 stitches between the widenings every 3d row, and keeping as closely as possible to the pattern, until you have 21 stitches across the thumb.` | — | null | thumb 21 (74 total, computed) | +2 per widening rnd | count target | no | |

## 17. `knit-pg-61105-begin-to-knit.txt` — American Thread Co., *Begin to Knit* (Star Book No. 201; undated — the New York 10016 ZIP code puts it after 1963; PG #61105)

1703 lines. A mid-20th-century beginner booklet: modern abbreviations, size vectors in
parentheses, CAPS section labels. Contents (page numbers), `ABBREVIATIONS`, techniques, `KNITTED
AFGHAN`, `FIVE FANCY STITCHES` (Pattern No. 1–5), **`PLAIN SOCKS FOR A GO-GO GUY`**, `MEN'S SHORT
SOCKS`, **`DOLLS AND GUYS TWO NEEDLE MITTENS`**, **`FOR THE YEARLING ... the sweater`** + booties,
mittens, hat, `HIS SLIPOVER`, **`HER RAGLAN`**, crochet basics, `CLAM DIGGERS SHELL`, `POM PON
PONCHO`, `PRETEEN SLIPOVER`.

**The book's own abbreviation table** (`Knits.glossary` → `fromPattern:true`): `K` Knit · `P`
Purl · `St(s)` · `YO` Yarn Over · `Dec.` · `Inc.` · `Tog.` · `Rnd.` Round · `P.s.s.o.` Pass slip
st over st · `dpn` · **`K-O` "Do not work st, row or round"** (a per-size "nothing" placeholder
inside a size vector) · `Beg.` · `Bet.` · `*` (repeat). In the text they appear spaced and mixed
case: `K 2 tog`, `sl 1, K 1, p.s.s.o.`, `Y O`, `d p n`, `s c`. Also: "A ROW is once across the
needle. A RIDGE is 2 rows, back and forth." and **"Parentheses in our instructions are used for an
explanation of a st, a certain section of a garment, or change of sts for change of size."** —
the book itself warns that parentheses are not always sizes (`(cable twist)`, `(seed st)`, `(the
6 sts are front borders)`, `(57 sts on needle)`, `(1st needle)`, `(all sizes)`).

**Row labels.** `1st ROW:`, `2nd ROW:`, `1st and 2nd ROWS:`, `9th, 10th, 11th and 12th ROWS:`,
`1st and 3rd ROWS:`, `NEXT ROW:`, `NEXT 8 ROWS:`, `NEXT 2 ROWS:`, `NEXT ROUND:`; inline caps
headers with a colon: `HEEL:`, `START TO TURN HEEL: 1st ROW:`, `Decrease for Toe:`, `SHAPE RAGLAN:`,
`SHAPE SHOULDERS:`, `SHAPE CAP:`, `RIGHT FRONT:`, `THUMB:`, `NECK EDGE:`. **Gauge** lines:
`GAUGE: 8 sts = 1 inch.`, `GAUGE for No. 7 Needles: 5 sts = 1 inch; 7 rows = 1 inch.`, `GAUGE:
9 sts = 2 inches;` / `6 rows = 1 inch` (split over two lines). Needles `1 Set Double Pointed
Knitting Needles No. 1`, `1 Pr. Knitting Needles No. 5 and No. 7`.

### 17a. Plain Socks for a Go-Go Guy — plain sock (lines 826–868), single size

| Step | As printed | Count |
|---|---|---|
| CO | `Cast on 72 sts, divide sts on 3 needles (24 sts on each needle), join. Place a marker at beginning of round.` | 72; BOR marker |
| Cuff / leg | `Work in ribbing of K 2, P 2 for 2½ inches. Change to stockinette st (K each round), work even until sock measures 8 inches from beg.` | 72 |
| Heel flap | `HEEL: At beg of round divide sts as follows: K and sl next 18 sts on a needle, K and sl next 18 sts on another needle. Working on remaining sts only K 1 row, P 1 row for 2½ inches ending with a P row.` | heel 36, instep 36 |
| Heel turn | `START TO TURN HEEL: 1st ROW: K 20, sl 1, K 1, pass sl st over K st (p.s.s.o.), K 1, turn. 2nd ROW: Sl 1, P 5, P 2 tog, P 1, turn. 3rd ROW: Sl 1, K 6, sl 1, K 1, p.s.s.o., K 1, turn. 4th ROW: Sl 1, P 7, P 2 tog, P 1, turn. Continue in the above manner until all sts have been worked ending with a P row.` | 36 → **20** (16 turning rows; 13 outer sts each side) — confirmed by `Divide these sts on 2 needles. K 10 sts on needle` |
| Gusset | `pick up and K 17 sts on right side of heel (1st needle), work across 36 sts of instep (2nd needle), pick up and K 17 sts on left side of heel, K remaining sts of heel to this needle (3rd needle).` | 10 + 17 + 36 + 17 + 10 = **90** |
| Gusset decs | `NEXT ROUND: Work even, then dec every other round as follows: … Dec in same manner until there are 72 sts on needles.` | 90 → **72** (9 dec rounds ✓) |
| Foot | `Work even until foot measures 7½ inches or 2 inches less than desired length from center back of heel.` | 72 |
| Toe | `Decrease for Toe: … K 1 round even. Repeat these 2 rounds until 16 sts remain (8 sts on instep needle and 4 sts on each back needle).` | 72 → **16** (14 dec rounds ✓; instep 36 → 8 ✓, sides 18 → 4 ✓) |
| Finish | `Sl sts of back needles to one needle. Weave sts together following directions on page 13.` | — |

Every count re-derives. The heel turn is written as `1st ROW:`…`4th ROW:` + "Continue in the above
manner" (rows 5–16 implied; the counter may count 16 but nothing prints it). `turn` appears on
every turning row: these are **heel-turn rows, not a short-row section** (`shortRow` may be true
by the detector's rule, but the RS/WS chip must alternate and the round count must not advance).
`MEN'S SHORT SOCKS: Follow directions for plain socks working only 2 inches of ribbing and 4 inches
of stockinette st before starting heel.` — a cross-pattern reference.

### 17b. Dolls and Guys Two Needle Mittens — two size groups in ONE vector (lines 880–942)

**`Directions are given for ladies small size. Changes for medium and large sizes are given in
parentheses. Men's sizes given in bold face type.`** The plain-text file has no bold, so every
vector reads `28 (32, 36) 32 (36, 40)` = **ladies S (M, L) followed by men's S (M, L)** — 6 values,
two groups, the group split visible only as "a second base value after the parentheses". A
parser that takes "first number + parenthesised list" gets ladies only and then sees a stray
`32 (36, 40)`. Two-value vectors with a comma: `for 1¾, 2 inches` = ladies 1¾", men's 2".

| Step | As printed | Ladies S, M, L · Men's S, M, L |
|---|---|---|
| CO + rib | `With No. 5 needles cast on 28 (32, 36) 32 (36, 40) sts and work in ribbing of K 2, P 2 for 1¾, 2 inches increasing 2 sts for men's small size only in last row of ribbing.` | 28, 32, 36 · 32→**34**, 36, 40 |
| Stocking st | `… for 6 (6, 8) 8 (8, 10) rows.` | same |
| Gusset start | `K 13 (15, 17) 16 (17, 19) sts, inc 1 st in each of the next 2 sts, K next 13 (15,17) 16 (17, 19) sts.` | 13+2+13 = 28 ✓ … 16+2+16 = 34 ✓, 17+2+17 = 36 ✓, 19+2+19 = 40 ✓ |
| Gusset | inc every other row `until there are 40 (44, 50) 46 (50, 54) sts on needle ending with a K row.` | 6, 6, 7 · 6, 7, 7 inc rows (+2 each) ✓ |
| Divide | `P 14 (16, 18) 16 (18, 19) sts and place on st holder, work next 12 (12, 14) 14 (14, 16) sts for thumb, place remaining sts on 2nd st holder.` | 14+12+14 = 40 ✓, 16+12+16 = 44 ✓, 18+14+18 = 50 ✓ · 16+14+16 = 46 ✓, 18+14+18 = 50 ✓, 19+16+19 = 54 ✓ |
| Hand | `NEXT ROW: K across all sts including sts sts from 1st st holder. There are 28 (32, 36) 32 (36, 38) sts on needle.` | explicit **28, 32, 36 · 32, 36, 38** ✓ (men's L 38 ≠ its CO 40 — correct, 19 + 19) |
| Thumb top | `NEXT ROW: K 2 tog, K 2, repeat from across row ending with K-O (K O, K 2 tog) K 2 tog (K 2 tog, K-O).` | per size: 12 → 9, 12 → 9, 14 → 10 · 14 → 10, 14 → 10, 16 → 12 |
| Thumb top 2 | `NEXT ROW: * K 2 tog, K 1, repeat from * across row ending with K-O (K O, K 2) K 2 (K 2, K-O).` | 9 → 6 ✓, 9 → 6 ✓, 10 → ✗ · 10 → ✗, 10 → ✗, 12 → 8 ✓ |
| Hand top | `* K 2 tog, K 3, … ending with K 1 (K 2 tog, K 4) K 2 tog (K 4, K 1).` / `* K 2 tog, K 2, … ending with K 2 tog (K 3, K 3) K 3 (K 3, K 2 tog).` / `* K 2 tog, K 1, … ending with K 2 (all sizes).` | no counts printed |

**How the per-size endings are written.** `ending with K-O (K O, K 2 tog) K 2 tog (K 2 tog, K-O)`
is itself a 6-value vector whose values are **instructions**, comma-separated inside the
parentheses: ladies S `K-O`, M `K O` (typo for `K-O`), L `K 2 tog` · men's S `K 2 tog`, M `K 2
tog`, L `K-O`. `K-O` = "do nothing for this size". The comma inside `(K 2 tog, K 4)` is a **size
separator**, not a list of two stitches for one size.

**PATTERN ERRORs (keep as printed).**
- Thumb top 2 for the 10-st thumbs (ladies L, men's S and M): `*K 2 tog, K 1*` ending with `K 2`
  needs 10 − 2 = 8 = a multiple of 3 — it is not. Only the 9- and 12-st thumbs divide.
- Hand-top endings mostly do not divide: e.g. ladies L 36 = 7 × 5 + 1 but the ending is `K 4`;
  only the two 32-st hands (`K 2 tog` ending, 32 = 6 × 5 + 2) work. No counts are printed, so
  nothing to assert beyond parsing the vectors.
- `repeat from across row` — the `*` is missing in the first thumb row; `sts sts` (doubled word).

### 17c. "For the Yearling ... the sweater" (6 months to 1 year) — child's item (lines 945–1015)

Single size, flat, `GAUGE: 7 sts = 1 inch`. `Working Back and Fronts at one time cast on 155 sts.`
· seed `1st ROW: K 1, * P 1, K 1, repeat from * across.` (odd ✓) · `Repeat last 2 rows 3 times.`
(→ rows 1–8; the next label is `9th ROW`, so **"3 times" = 3 more**) · `9th ROW: K 1, P 1 across 6
sts, K to within 6 sts, P 1, K 1 across last 6 sts (the 6 sts are front borders).` · `Repeat last 2
rows 3 times.` (rows 9–16) · `Repeat from 1st row twice.` (rows 1–16 ×2 more = 48 rows) · `NEXT 8
ROWS: Work in seed st.` · `NEXT 2 ROWS: Repeat 9th and 10th rows.` · divide: `RIGHT FRONT: Work 6 sts
in seed st, K 33, place these sts on st holder, bind off 3 sts for Armhole, K across 74 sts for BACK
(this includes 1 st left on needle from armhole bind off), place remaining 39 sts on stitch holder
for LEFT FRONT.` (39 + 3 + 74 + 39 = **155** ✓).

| Part | Work | Count |
|---|---|---|
| Back | bind off 3 at beg of next row (→ 71); dec 1 each side every other row twice (→ **67**); even to 4" armhole; `Bind off 11 sts at beg of next 4 rows; bind off remaining sts.` | 67 − 44 = **23** back neck (computed) |
| Left front | 39, bind off 3 (→ 36), dec 2 (→ 34), at 3" `Bind off 10 sts at beg of next row; then dec 1 st at neck edge every other row twice.` (→ **22**), shoulder "same as back" = 11 + 11 ✓ | 22 ✓ |
| Right front | "complete to correspond to left front reversing shaping" — it must also bind off its own 3 armhole sts (39 → 36); the 3 bound off in the divide row belong to the back | 22 ✓ |
| Sleeves | `Cast on 41 sts. Work 8 rows in seed st.` · `inc 1 st at beg and end of next row. Then inc 1 st each side every inch 5 times.` (→ **53**) · `SHAPE CAP: Bind off 3 sts at beg of next 2 rows; then bind off 2 sts at beg of every row until 31 sts remain.` (47 → 31 = 8 rows ✓) | 31 then bind off |
| Neck | `starting at right front pick up 69 sts all around neck.` · seed ¾", K1 P1 rib ¾" | 69 |

Booties in the same set: `Cast on 37 sts. … NEXT ROW: K 24, sl remaining 13 sts to st holder,
turn, P 11, sl remaining 13 sts to st holder.` (13 + 11 + 13 = 37 ✓ — `turn` again starts an
instep, not a short row) · `… P across 13 sts from st holder (57 sts on needle).` (13 + 10 + 11 +
10 + 13 = **57** ✓ — the count is in parentheses).

### 17d. Her Raglan (Sizes: Small, Medium and Large) — lady's item (lines 1107–1140)

`Directions are given for small size. Changes for medium and large sizes given in parentheses.`
`GAUGE: 9 sts = 2 inches;` / `6 rows = 1 inch` → `{sts: 9, rows: 12, over: 2, unit: 'in'}` (or
4.5 sts / 6 rows per inch). Pattern: `1st and 2nd ROWS: K 2, P 2 across each row. 3rd and 4th
ROWS: P 2, K 2 across each row.` (double seed / moss rib).

| Part | Work | Count (S, M, L) |
|---|---|---|
| Back | `Cast on 76 (80, 84) sts.` · pattern `for 12 (12½, 13) inches or length desired to underarm.` · **`SHAPE RAGLAN: Dec 1 st at beg of each row until 24 sts remain (all sizes), slip 24 sts to st holder.`** | 76, 80, 84 → **24** (52, 56, 60 dec rows) |
| Front | `Work same as back.` | 24 |
| Sleeves | `Cast on 32 (36, 40) sts. Work in pattern for 3 inches inc 1 st each side every inch 13 times working inc sts into established pattern, 58 (62, 66) sts.` | 32 + 26 = **58** ✓, 62 ✓, 66 ✓ |
| Sleeve raglan | `Work same as back until 8 sts remain. Work 1 row even (all sizes). Sl 8 sts to st holder.` | 58 → 8: 50, 54, 58 dec rows + 1 even = 51, 55, 59 rows vs the body's 52, 56, 60 (one row short — harmless, not flagged) |
| Neck | `Dividing sts evenly, sl all sts from stitch holders to 3 double pointed needles and work in pattern for 2 inches; then K each row for 2 inches for neck facing.` | 24 + 8 + 24 + 8 = **64** (computed; "each row" = each round) |

`(all sizes)` inside an instruction means "one value for every size" and must not be read as a
size label. The size line is `Sizes: Small, Medium and Large` (words, comma + "and").

### Five Fancy Stitches — Pattern No. 4 (a cable with an implied cadence)

`Cast on 35 sts. 1st ROW: K 3, P 3, K 6, P 3, K 5, P 3, K 6, P 3, K 3.` (= 35 ✓) `… Repeat last 2 rows
3 times. 9th ROW: K 3, P 3, sl next 3 sts on d p n and hold in front of work, K next 3 sts, K 3 sts
from d p n (cable twist), P 3, K 5, P 3, cable twist, P 3, K 3. 10th ROW: Repeat 2nd row. NEXT 8
ROWS: Repeat 1st and 2nd rows 4 times. Repeat from 9th row for pattern.` → a **C6F** (w 6, front,
written out and then called "cable twist") on rows 9, 19, 29 … = **every 10 rows**, never stated
as a number; "Repeat last 2 rows 3 times" = 3 more (rows 1–8, then `9th ROW`); "Repeat 1st and 2nd
rows 4 times" = 4 in total (`NEXT 8 ROWS`).

### Hard lines (Begin to Knit)

| # | Line (verbatim, paragraph-joined) | row | side | count | delta | until | shortRow | notes |
|---|---|---|---|---|---|---|---|---|
| K1 | `Cast on 72 sts, divide sts on 3 needles (24 sts on each needle), join. Place a marker at beginning of round.` | CO | null | 72 | — | — | no | `(24 sts on each needle)` is per needle, not a size; BOR marker. |
| K2 | `Work in ribbing of K 2, P 2 for 2½ inches.` | — | null | = prev | 0 | length 2.5 in | no | |
| K3 | `START TO TURN HEEL: 1st ROW: K 20, sl 1, K 1, pass sl st over K st (p.s.s.o.), K 1, turn.` | 1 | rs | 35 (computed) | −1 | — | heel turn (see 17a) | Caps header + row label on one line; `(p.s.s.o.)` is an explanation in parentheses. |
| K4 | `Continue in the above manner until all sts have been worked ending with a P row. Divide these sts on 2 needles. K 10 sts on needle,` | 5–16 | — | 20 (computed; "K 10" per needle) | −1/row | — | — | |
| K5 | `Dec in same manner until there are 72 sts on needles.` | — | null | explicit 72 | −2 every other rnd | count target | no | |
| K6 | `K 1 round even. Repeat these 2 rounds until 16 sts remain (8 sts on instep needle and 4 sts on each back needle).` | — | null | explicit 16 | −4 per 2 rnds | count target | no | Per-needle split in parentheses. |
| K7 | `LEFT MITTEN: With No. 5 needles cast on 28 (32, 36) 32 (36, 40) sts and work in ribbing of K 2, P 2 for 1¾, 2 inches increasing 2 sts for men's small size only in last row of ribbing.` | CO | — | 28,32,36,32,36,40 → 28,32,36,**34**,36,40 | +0,0,0,2,0,0 | length 1.75 (ladies) / 2 (men) in | no | **6-value vector, 2 groups**; comma vector `1¾, 2`; "men's small size only". |
| K8 | `NEXT ROW: K 13 (15, 17) 16 (17, 19) sts, inc 1 st in each of the next 2 sts, K next 13 (15,17) 16 (17, 19) sts.` | next | rs | computed 30,34,38,36,38,42 | +2 | — | no | `(15,17)` without a space. |
| K9 | `Continue in stockinette st increasing at Gusset every other row until there are 40 (44, 50) 46 (50, 54) sts on needle ending with a K row.` | — | — | explicit target 40,44,50,46,50,54 | +2 per 2 rows | count target; endOn rs ("a K row") | no | |
| K10 | `NEXT ROW: K across all sts including sts sts from 1st st holder. There are 28 (32, 36) 32 (36, 38) sts on needle.` | next | rs | explicit 28,32,36,32,36,38 | — | — | no | |
| K11 | `NEXT ROW: K 2 tog, K 2, repeat from across row ending with K-O (K O, K 2 tog) K 2 tog (K 2 tog, K-O).` | next | rs | computed 9,9,10,10,10,12 | — | — | no | Instruction-valued size vector; `K-O`. |
| K12 | `Working Back and Fronts at one time cast on 155 sts.` | CO | — | 155 | — | — | no | Yearling sweater. |
| K13 | `Repeat last 2 rows 3 times. 9th ROW: K 1, P 1 across 6 sts, K to within 6 sts, P 1, K 1 across last 6 sts (the 6 sts are front borders).` | repeat, then 9 | — | 155 | 0 | — | no | "3 times" = 3 more (the next row is the 9th). |
| K14 | `RIGHT FRONT: Work 6 sts in seed st, K 33, place these sts on st holder, bind off 3 sts for Armhole, K across 74 sts for BACK (this includes 1 st left on needle from armhole bind off), place remaining 39 sts on stitch holder for LEFT FRONT.` | divide row | rs | 74 in work | — | — | no | `RIGHT FRONT:`, `BACK`, `LEFT FRONT` inside one row are not part headers here. |
| K15 | `SHAPE CAP: Bind off 3 sts at beg of next 2 rows; then bind off 2 sts at beg of every row until 31 sts remain. Bind off remaining sts.` | 2 + 8 rows | — | explicit target 31 | −6, then −2/row | count target | no | |
| K16 | `NEXT ROW: K 24, sl remaining 13 sts to st holder, turn, P 11, sl remaining 13 sts to st holder.` | next | rs then ws | 11 in work | — | — | **no** | Instep split. |
| K17 | `P across all sts picking up 10 sts on opposite side of instep, P across 13 sts from st holder (57 sts on needle).` | — | ws | explicit 57 (in parentheses) | — | — | no | |
| K18 | `SHAPE RAGLAN: Dec 1 st at beg of each row until 24 sts remain (all sizes), slip 24 sts to st holder.` | — | — | explicit 24 (all sizes) | −1/row | count target | no | `(all sizes)` ≠ a size label. |
| K19 | `Cast on 32 (36, 40) sts. Work in pattern for 3 inches inc 1 st each side every inch 13 times working inc sts into established pattern, 58 (62, 66) sts.` | CO … | — | 32,36,40 → explicit 58,62,66 | +26 | — | no | Count after a comma, no "=". |
| K20 | `9th ROW: K 3, P 3, sl next 3 sts on d p n and hold in front of work, K next 3 sts, K 3 sts from d p n (cable twist), P 3, K 5, P 3, cable twist, P 3, K 3.` | 9 | rs (parity) | 35 | 0 | — | no | Written-out C6F named "cable twist"; cadence every 10 rows (implied). |

---

## Batch 2 summary (§9–§17) — read this if you read nothing else of batch 2

**New traps the parser must handle (none of them occur in §1–§7).**
- **Alternating-parenthesis size vectors** (Sandnes §13): `(2) 4 (6) 8 (10) 12 yrs`, `(48) 52
  (56) 56 (60) 60`, `(S) M (L) XL (XXL)` — every other size in parentheses; all values are
  sizes in order. Not "base (rest)". Non-size parentheses on the same lines: `(= ½ back)`,
  `(= front)`, `(as explained)`. Glued: `k(5) 6 (7) …`.
- **Two size groups in one vector, separated only by bold** (Begin to Knit mittens §17b):
  `28 (32, 36) 32 (36, 40)` = ladies S, M, L + men's S, M, L. Instruction-valued vectors
  `ending with K-O (K O, K 2 tog) K 2 tog (K 2 tog, K-O)`; `K-O` = "nothing for this size".
- **Two size groups on two pages** (Sandnes §13: children 6 sizes p2, ladies 5 sizes p3).
- **Non-adjacent size conditionals** with bare vectors (Boyfriend §10: `Sizes L, 2/3XL and
  4/5XL only: … (61-63-65)` → sizes 3, 5, 6). **Short vectors** (Cabled Yoke §12: `3rd
  (3rd-4th)` for 6 sizes).
- **Lowercase size labels from a broken font** (Cabled Yoke §12: `Sizes XS/S, M and l only:`,
  `Size 4/5Xl only:`).
- **`Turn.` that is not a short row** — every Patons neck split (`Pat across N sts (neck edge).
  Turn.`), instep splits (Corbould boot, Begin to Knit booties), heel turns written row by row.
  **"short rows" that are needles** (Cupples: "These two short rows are left till the heel is
  done").
- **Real short rows**: only the Sandnes German short rows (§13): 6 per neck, `turn` + `2 loops
  on right ndl` + `work loops tog on next row`; the ladies' version omits the first `turn`.
- **Panels**: a row working 2–3 named panels at once (`Work 1st row of Panel Pat C … B … A`);
  panel definitions are stitch guides, not parts; a panel whose repeat starts at row 3 (Cabled
  Yoke `These 3rd to 16th rows form Panel Pat A.`); `endOn` a panel row (`ending on a 24th row of
  Cable Panel C`, `ending with 16th row of pat`).
- **Cable abbreviations, per pattern**: C4F/C4B/C6F/C6B/T3F/T3B/Tw4R/Tw4L (mock neck),
  C4B/Cr4F/Cr4B/T2F/T2B/T3F (boyfriend — **T3F means something else here**), C3BK/C3FK/C3BP/
  C3FP/Cr5B/Cr7B/Cr7F (boxy), C4B/C4F/T3B/T3F/T4B/T4F (cabled yoke). No T4 without a direction;
  no C3FK/C3BK outside the boxy file. The **only stated cadence** is the Handbook gloves'
  `twisting the "cable" as directed every 6th row` (§16b → `cable:{every:6}`); every Patons
  cadence must come from the panel rows.
- **Old-book vocabulary**: `P` = **knit** and `B` = purl in Cupples' open-work code; `ribs` =
  garter ridges in the Handbook (`48 ribs, or 96 rows`); `rows` for rounds; row labels in
  words (`Twenty-first row—`), with restarts; `1.`/`2, 3, 4.` numeric labels; intake tables
  (`3 intakes with 7 rounds between each` = 3 × 8 rounds); counts as "ought to be N",
  "reduces the stocking to N", "(57 sts on needle)", per needle/per side.
- **"Repeat … N times"** is N more in Corbould and Begin to Knit's sweater, N total in the
  Service Sock, Sandnes and Begin to Knit Pattern No. 4 — decided only by printed counts.

**PATTERN ERRORs in batch 2 (report as printed; deviation hints are correct).** Mock neck M:
back neck 48 not 46, left shoulder 1 st over (§9). Boyfriend 4/5XL sleeve 15 not 11; sleeve row 3
`K0 (0-0-2-2-22)` (§10). Boxy sleeve inc row XS/S, M does not divide; sleeve row 1 XL, 2/3XL = 75
not 77 (§11). Cabled Yoke: marker omission in Bottom Yoke rnd 2; `3rd (3rd-4th)` short vector
(§12). Sandnes: "raglan dec" / "Rep inc" wording for increases / decreases; missing `turn` (§13).
Cupples: kilt hose 108 not 96; toe parity (gentlemen's socks, infant fingering); Leaf Pattern
rounds 1 and 11; Diamond row 1 (§14). Corbould: heel "these 21" = 41 (§15). Handbook gloves row 5
(§16). Begin to Knit mitten thumb/hand endings (§17). Measurement-only errors: mock neck and boxy
chest cm, boxy sleeve 18" [47.5 cm].

**Extractor bugs found in batch 2 (owner of `js/pdftext.js`).** (1) Boyfriend: three printed
`2nd row: P2. P2tog. Pat to last 4 sts. P2togtbl. P2.` lines dropped (p2 col 4, p3 col 3, p4 col
3) — looks like the cross-page/overlay duplicate filter removing a legitimately repeated line.
(2) Boxy p4: column 2 emitted between the two halves of column 1 (neckband ribbing before the
neckband pick-up). (3) Cabled Yoke: p1 cols 3/4 and p2 cols 2/3 interleaved line by line (gauge
sentence split with a pattern row glued in); display-font case mapping (`MaTerIalS`, `l` for L);
yarn table truncated. Mock neck, Sandnes: clean.

**Charts in batch 2.** All Patons charts are vector cells. Mock neck and boyfriend Panel A and
boxy carry cable-width digits as glyphs (`3`/`4`/`6`, `2`/`3`, `3`/`5`/`7`); boxy's key is text
(`3 = C3BK` …); mock neck, boyfriend B/C and cabled yoke keys are not in the text layer. Still
no glyph-font chart — `KnitChart` gets `null` cells on every batch-2 chart. Charts number RS
rows only (boyfriend, boxy, cabled yoke) or both sides (mock neck).
