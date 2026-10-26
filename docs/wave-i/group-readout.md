# Wave I — group-readout

## What the user sees

The readout under the stitch button now counts a round that is worked in repeats **in its repeats**:

| Row | Before | Now |
|---|---|---|
| bee Medium Body rnd 4 "Inc, 2sc, repeat around" (18 → ≈ 24), 0 done | Group 1 of ≈ 3 · stitch 0 of 10 | **Group 1 of 6 · stitch 0 of 4** |
| same, 5 done | Group 1 of ≈ 3 · stitch 5 of 10 | Group 2 of 6 · stitch 1 of 4 |
| rnd 3 "Inc, sc, repeat around" (12 → 18) | Group 1 of ≈ 2 · stitch 0 of 10 | Group 1 of 6 · stitch 0 of 3 |
| rnd 15 "Dec, 2sc, repeat around" (24 → 18) | … | Group 1 of 6 · stitch 0 of 3 |
| rnd 16 "Dec, 1sc, repeat around" (18 → 12) | … | Group 1 of 6 · stitch 0 of 2 |
| rnd 17 "Dec all around", rnd 5 "Sc in each st" | chunks of 10 | unchanged (chunks of 10) |
| panda Body rnd 6 "Sc in next 2 sts, 2 sc in next st, (sc in next 4 sts, 2 sc in next st) 5 times, sc in next 2 sts" | chunks | Before group 1 · stitch 3 of 4 … Group 5 of 5 · stitch 6 of 6 … After group 5 · stitch 1 of 2 |
| knit "*K2, p2; rep from * to end" on 80 | Group 1 of 8 · stitch 0 of 10 | Group 1 of 20 · stitch 0 of 4 |

The total keeps its "≈" when it was computed (the stitch target still reads "0 / ≈ 24"). The repeat count gets no "≈", because the count comes from the round's own words, as the owner asked.

The buzz (`tapStitch` → `event: 'group'`) now fires at the end of each repeat (stitch 4, 8, … on rnd 4) and not on every 10th stitch. Rows with no repeat keep the 10-stitch buzz. Group size 0 still turns grouping off ("stitch N", no buzz).

## Why it said "≈ 3 … of 10"

This was not a repeat model dividing the wrong way. There was no repeat model at all. `groupReadout()` in js/app.js cuts every row into the project's `groupSize` (10 by default). So ceil(24 / 10) = 3 groups, and the first group holds 10 stitches. It ignored the pattern's "(inc, 2sc)". "(2sc, inc) x6" had the same problem: 24 read as "Group 1 of 3 · stitch 0 of 10". It did not already work.

## The contract

### `Patterns.repeatGroups(lines, rowNumber, prevCount)` (also on `Knits`, from the shared engine)
- Returns `{ groups, total, runs: [{ group, size }] }` or `null`.
  - `group` is 1-based and runs across the whole row. A run with `group: 0` is a set of stitches before, between or after the groups.
  - `size` and `total` count stitches MADE. Chains and bound-off stitches are left out. The second stitch of an increase is counted.
- The groups are read off the row's own `expand()` (`api.expand`, which is `knitExpand` for Knits). That means they are exactly the stitches the 3D view draws.
- During that one call, `TAG_REPS` (patterns.js) is on, and every repeat loop tags each copy of its unit `rp: {s, k}`:
  - **crochet:** bracket `(…) xN` / `[…] N times` / `(…)*N`, starred `* … ; rep from * around / N times more`, `X, Y, repeat around` / `rep around` / `(…) around` / `*…* around`, and the fill path.
  - **knits:** `exec` groups `(…) N times` / `(…) to end`, and `rep from * to end / to last N / N times more`. The block's first working, already done before the "rep", is tagged after the fact as group 1.
  - A repeat inside a repeat takes the outer tag.
- Every other `expand()` call is byte-identical to before. The tests assert this.
- Returns `null` when:
  - there are fewer than 2 groups;
  - every group is a single instruction ("Dec all around", "Inc in each st", "K2tog to end");
  - the round's printed total disagrees with its words (`res.deviation`);
  - the row was padded or cut to fit a total (`res.fitted`, set only while tagging).
- `E.tagReps()` is a new profile-hook helper (true only while repeatGroups runs).

### Store (inside the counter/group functions only)
- `Store.rowGroups(prt)` calls `repeatGroups` for the row being worked:
  - `prev` is the previous row's target; when a user repeat starts over, it is the block's `endRow`.
  - The result is used **only when `total === currentTarget(prt)`**.
  - It is cached on the part's line-cache entry (`entry.groups[row|prev|target]`), so it goes away whenever the text or parse changes.
  - Short rows (no target) give `null`.
- `Store.groupAt(info, stitch)` returns `{ group, of, within, size, before, boundary }`. Past the row's total, the last group's size carries on ("Group 7 of 6 · stitch 1 of 4"), the same way the old over-count did.
- `Store.groupReadout(prt, stitch, g, target, approx)` returns the full readout string:
  - "Group k of n · stitch w of s", "Before group k · …", or "After group n · …";
  - otherwise it falls back to the old chunk readout, copied exactly from app.js's `groupReadout`;
  - `g <= 0` gives "stitch N".
- `tapStitch`: if the project has a group size (`groupSize > 0`) and the row has repeat groups, `event: 'group'` fires on a group's last stitch with `group: k`. The app's existing "Stitch N, group k done" announcement reads it as before.

No new settings keys or stored fields. Nothing is persisted.

## For the owner of js/app.js

The screen only changes once app.js calls the Store helper. In `renderCounter` (around the `// Stitches` block), change:

```js
readout = groupReadout(prt.stitch, g, target, approx);
```
to
```js
readout = Store.groupReadout(prt, prt.stitch, g, target, approx);
```

After that, the local `groupReadout()` (app.js ~2070) is dead code and can be removed, since the Store copy's fallback is identical. Optionally, the settings help text near app.js:9295 ("“Group 2 of 3 · stitch 4 of 10”…") could add that a round worked in repeats is counted in its repeats.

## Verified

The checks were run in my own pane tabs on localhost:8766:

| Suite | Before | After |
|---|---|---|
| patterns | 1067 | **1112** (+45) |
| patterns.fixtures | 895 | **905** (+10) |
| patterns.fixtures ?heavy=1 | 910 | **920** |
| knits | 373 | **385** (+11 mine, +1 from the existing "Knits has every Patterns key" loop picking up `repeatGroups`) |
| knits.fixtures | 530 / 533 heavy, 11 known | unchanged |
| knit-counter | 317 | unchanged |
| knit-chart | 151 | unchanged |
| templates | 147 | unchanged |
| crafts | 124 | unchanged |
| store-safety | 307 | unchanged |
| backup | 205 | unchanged |
| diagram-model | 529 | unchanged |

- The fixture assertions exercise `Store.groupReadout` through `Store.currentTargetInfo` on the real PDFs: bee Medium Body rnds 3/4/5/15/16/17, bee Big Body rnd 6, panda Body rnds 4/6 and Leg 5, Baphomet Ears R3/R4, Body/Head R11, Feet R3.
- test/patterns.test.html, test/knits.test.html and test/patterns.fixtures.html now load js/store.js. Their Store tests create scratch projects and delete them again.
- I did not check this in the app UI, because the app still calls its own `groupReadout` until the one-line change above lands.

## Left / for the coordinator
- **The one-line app.js swap above** (not mine to make).
- When a repeat count would not divide the stitches below it evenly, the leftover stitches show as "After group n" ("Inc, 2sc, repeat around" over 19 → six groups and 1 after).
- Rows whose expansion does not make exactly the counter's target (e.g. "ch 3 (counts as dc), dc in same st, *…; rep from * around" where the expansion and the parse disagree) keep the 10-stitch chunks. This is deliberate: the readout must never contradict the target.
- Possible later setting: let the maker prefer plain chunks even on repeat rows. Today, group size 0 turns all grouping off, and any other size uses the repeats when there are any.
