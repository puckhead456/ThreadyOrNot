# Knitting fixtures — ground truth (wave H)

Owner: `knit-research`. Every other wave-H worker reads this. It is written fixture by fixture;
a fixture whose heading says **(pending)** is not yet verified. Status of the file is in the
"Progress" line below; re-read it when it changes.

**Progress:** §1–§7 done (all seven fixtures); §8 "What the fixtures do not cover" pending.

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
