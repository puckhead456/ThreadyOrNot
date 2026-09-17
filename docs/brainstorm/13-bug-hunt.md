# 13 · Adversarial bug hunt (exploratory QA)

**11 bugs: 4 data loss · 1 crash (unresponsive UI) · 4 wrong count · 2 visual.**
Session: 2026-09-17, cache v20, Browser pane at 375×812 (and 320×640), service worker + caches cleared first. Console was watched via `window.onerror` / `unhandledrejection` / a `console.error` wrapper for every action below — **not one of these bugs logs anything**. That silence is the theme of the whole report.

Areas probed that held up well and produced no bug: backup JSON that is truncated / wrong version / `null` / array / number (all rejected with a sensible message); a project with `craft:'unknown'` (renders a clean "needs the unknown module" screen); rapid double-taps on the stitch button (4 taps = 4 stitches, no double count); a 0-byte PDF, a `.txt`, a `%PDF-` header with garbage after it, and an extension-less file into the drop zone (all four toast correctly, none throw); Escape on three stacked sheets (unstacks one per press, cleanly); `Store.undo()` past the start (returns `false`); undo after `deleteProject` (restores it); `jumpToRow` with `0 / -5 / 1e9 / NaN / '7' / null / 1.9`; `groupSize` with `0 / -5 / 999 / 'abc' / null / 1.5`; a whitespace-only project name and a whitespace-only part name (both fall back); `XStitchPhoto.convert` on a 1×1 canvas, a 0×0 canvas and a 6000×6000 canvas (clamped, 37 ms, never threw); theme switch mid-celebration.

---

## 1. A second tab silently deletes whatever the first tab did

**Severity: data loss**

Steps (run in the app's console; it is exactly what two open tabs do):

```js
const p = Store.createProject({name:'tabA'});
Store.flush();
// --- simulate what the OTHER tab writes ---
const raw = JSON.parse(localStorage.getItem(Store.KEY));
const clone = JSON.parse(JSON.stringify(raw.projects[raw.projects.length-1]));
clone.id = 'tabB'; clone.name = 'tabB'; raw.projects.push(clone);
localStorage.setItem(Store.KEY, JSON.stringify(raw));
// --- back in tab A, the user taps one row ---
Store.tapRow(p.id, p.parts[0].id); Store.flush();
!!JSON.parse(localStorage.getItem(Store.KEY)).projects.find(x => x.id === 'tabB');
```

**Observed:** `false` — tab B's whole project is gone. Every `writeNow()` serialises tab A's in-memory `state` over the entire key; there is no `window.addEventListener('storage', …)` anywhere in the codebase, so a tab never learns another tab wrote.
**Expected:** at minimum, notice the foreign write and reload/merge before overwriting; at least warn.

This is not theoretical: it bit me live during this session. I created `ZQA_big` and `Store.flush()`ed it; two calls later `Store.projects().find(x=>x.name==='ZQA_big')` was `undefined` and the list held another agent's projects instead. A PWA that people leave open on a tablet *and* pin to the phone home screen hits this the first time they use both.

**Console:** nothing.
**Suspect:** `writeNow` / `save` / `load` in `js/store.js` (~L813–840).

---

## 2. A save that fails is swallowed; the user keeps counting into the void

**Severity: data loss**

```js
const orig = localStorage.setItem.bind(localStorage);
localStorage.setItem = function (k, v) {
  if (k === Store.KEY) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
  return orig(k, v);
};
const p = Store.projects()[0];
for (let i = 0; i < 5; i++) Store.tapRow(p.id, p.parts[0].id);
Store.flush();
localStorage.setItem = orig;
```

**Observed:** `memory row=5`, `stored row=0`. No toast, no console error, no visual difference — the counter happily shows 5. Reload and the five rows are gone.
**Expected:** one sticky, non-dismissable banner ("Not saving — storage is full") the moment a write fails, and stop pretending.

The whole handler is:

```js
try { window.localStorage.setItem(KEY, JSON.stringify(state)); }
catch (e) { /* quota / private mode — nothing useful to do */ }
```

The comment is wrong: telling the user is useful. This also covers Safari private mode, where *every* write fails and the app looks completely normal for an entire session. Same class as #3, and both get much likelier once BlobStore page images and 1 MB cross-stitch charts are in play.

**Console:** nothing.
**Suspect:** `writeNow` in `js/store.js` (~L814–821).

---

## 3. One corrupt byte in localStorage wipes every project, silently

**Severity: data loss**

```js
const good = localStorage.getItem(Store.KEY);
localStorage.setItem(Store.KEY, good.slice(0, Math.floor(good.length * 0.6))); // truncated write
Store.load().projects.length;
```

**Observed:** `0`. Six projects became zero. `load()` catches the `JSON.parse` failure, sets `raw = null`, and `normalizeState(null)` hands back a pristine empty state. The app boots to the empty-home illustration as though it were a fresh install, and the *next* save overwrites the damaged-but-possibly-recoverable blob with the empty one — so the bad data is destroyed too.
**Expected:** keep the unparseable text under a `…:corrupt:<timestamp>` key, refuse to write over it, and tell the user their data could not be read and where the copy is.

A truncated write is the realistic cause (quota mid-write, or a phone killed while saving), and it is the exact failure a solo-owner app with no backend cannot recover from.

**Console:** nothing.
**Suspect:** `load()` in `js/store.js` (~L799–812).

---

## 4. "Back a row" cannot cross a piece boundary, and eats the session history instead

**Severity: data loss**

```js
const p = Store.createProject({name:'x'}); const pt = p.parts[0];
Store.updatePart(p.id, pt.id, {makeCount:3, targetRows:2});
Store.tapRow(p.id, pt.id);          // row 1
Store.tapRow(p.id, pt.id);          // piece 1 done → row resets to 0, piecesDone 1
Store.untapRow(p.id, pt.id);        // user realises they mis-tapped
Store.untapRow(p.id, pt.id);
```

**Observed:** after every `untapRow`, `row=0 piecesDone=1/3` — unchanged. The back button is dead. The user's only route back to "row 2 of piece 1" is the row editor, and only if they remember the number.
**Expected:** stepping back off row 0 with `piecesDone > 0` should go to `piecesDone -= 1; row = targetRows`.

Worse, `untapRow` still runs `if (last && last.partId === prt.id) proj.history.pop()` on each call even though nothing moved, so every dead press permanently destroys one genuine history entry for that part. Three panicked taps on a dead button = three rows of session history gone, and the history is also what the live diagram and any future stats read.

**Console:** nothing.
**Suspect:** `untapRow` in `js/store.js` (~L1399–1411) — it is not the inverse of `completeRow`.

---

## 5. Long pattern → the counter freezes for a fifth of a second on every single tap

**Severity: crash (unresponsive UI)**

```js
function bench(rows){
  const proj = Store.createProject({name:'b'+rows}); const pt = proj.parts[0];
  let txt=''; for (let i=1;i<=rows;i++) txt += 'Row '+i+': sc in each st around ('+(6*i)+')\n';
  Store.updatePart(proj.id, pt.id, {patternText:txt});
  Store.setActiveProject(proj.id);
  let t0=performance.now(); App.render(); const first=performance.now()-t0;
  t0=performance.now(); for (let k=0;k<10;k++){ Store.tapStitch(proj.id,pt.id); App.render(); }
  return [rows, first.toFixed(0)+'ms first render', ((performance.now()-t0)/10).toFixed(0)+'ms per tap'];
}
[50,200,500,1500].map(bench);
```

**Observed** (desktop Chrome in the Browser pane — a mid phone is several times slower):

| pattern rows | first render | per stitch tap |
|---|---|---|
| 50 | 22 ms | 1 ms |
| 200 | 128 ms | 6 ms |
| 500 | 363 ms | **24 ms** |
| 1500 | 1031 ms | **101 ms** |
| 5204 (200 KB of text) | 2396 ms | **200 ms** |

**Expected:** per-tap cost independent of pattern length. The tap is the one interaction that must never stutter.

The cost is specifically in the tap→render pair: 20 renders with no tap between them take 46 ms total, and 20 taps with no render take 31 ms total, but 20 tap+render pairs take 4027 ms. So a tap invalidates something that is then rebuilt over the whole pattern (the diagram model and/or `lineForRow` scan), rather than being updated incrementally. 500 rows is an ordinary blanket or a multi-size garment, not a stress test; the 200 KB paste in the brief is simply the extreme end of the same curve.

**Console:** nothing (it is just slow).
**Suspect:** `renderProject` / the live-diagram remount path in `js/app.js` (`render()` ~L824) combined with `Store.diagramModel` / `Store.lineForRow` in `js/store.js`.

---

## 6. The row counter runs past the target forever, replaying the finale each time

**Severity: wrong count**

```js
const p = Store.createProject({name:'over'}); const pt = p.parts[0];
Store.updatePart(p.id, pt.id, {makeCount:1, targetRows:3});
for (let i=0;i<8;i++) Store.tapRow(p.id, pt.id);
```
Then in the UI press the "Complete row" (`+`) button four more times.

**Observed:** the counter reads **`8 / 3`**, then `12 / 3`; the progress bar is pinned full and overflows; `piecesDone` stays `1/1`. Every one of those four presses returned `{event:'projectDone'}` — I hooked `Celebrate.play` and counted **4 full project-finished celebrations for 4 taps**, and `proj.finishedAt` was rewritten each time. Screenshot at 320×640 shows `8 / 3` under the row dial.
**Expected:** at the target, either stop counting (with a "target reached" state), or count on but fire the celebration exactly once and leave `finishedAt` alone.

**Console:** nothing.
**Suspect:** `completeRow` in `js/store.js` (~L1310–1335): the `prt.row >= prt.targetRows` branch has no "already finished" guard, so it re-enters on every call.

---

## 7. Re-importing the same PDF duplicates every unnamed section

**Severity: wrong count**

```js
const blob = await (await fetch('/tmp-pdf/cardigan.pdf')).blob();
const mk = () => { const dt = new DataTransfer();
  dt.items.add(new File([blob],'c.pdf',{type:'application/pdf'})); return dt.files; };
const proj = Store.createProject({name:'twice'});
Store.setActiveProject(proj.id); App.render(); App.openImportSheet(proj.id);
// wait for the sheet, then:
const inp = document.querySelector('dialog[open] input[type=file]');
inp.files = mk(); inp.dispatchEvent(new Event('change',{bubbles:true}));
// wait for "Read 22 pages", press "Create parts", then repeat the whole import once more
```

**Observed:**
- import 1 → toast `Created 9 parts · + 3 checklist items`, parts `Swatch | First Section | Center Back | Part 5 | Second Section | Part 7 | Sleeves | Sleeve Cuff | Front Trim`
- import 2, same file → toast `Created 2 parts · updated 7`, parts now end `… | Front Trim | Part 10 | Part 11`

The seven sections the PDF actually names match and update correctly. The two the parser could not name were given the *positional* fallback `'Part ' + (proj.parts.length + 1)` on the first pass, so on the second pass they match nothing and are appended again — two duplicate parts holding the same pattern text. (Checklist items dedupe properly and stayed at 3, so the machinery exists; it is only the name that is unstable.) Do it three times and you get `Part 12`, `Part 13`.
**Expected:** an unnamed section should match on its position/content so a re-import updates it, or the import should say "this looks like a PDF you already imported".

The realistic trigger is the designer emailing a corrected PDF — exactly when a re-import is the right thing to do.

**Console:** nothing.
**Suspect:** `importPatternSections` in `js/store.js` (~L1741–1770) — the `existing`-by-name lookup vs. the `'Part ' + (parts.length + 1)` fallback name.

---

## 8. The timer is raw wall-clock: a backward clock change erases the session, a forward one invents a month

**Severity: wrong count**

```js
const realNow = Date.now; let offset = 0; Date.now = () => realNow() + offset;
const p = Store.createProject({name:'timer'});
Store.toggleTimer(p.id);
offset = 3600e3;   Store.elapsedMs(p);   // clock jumps +1h while running
offset = -7200e3;  Store.elapsedMs(p);   // clock jumps back
Store.toggleTimer(p.id); p.timer.totalMs;
offset = 0; Store.toggleTimer(p.id); offset = 30*864e5; Store.toggleTimer(p.id); p.timer.totalMs;
Date.now = realNow;
```

**Observed:**
- `+1h` while running → elapsed jumps straight to `3600s`
- clock moves back → elapsed reads `0s`, and stopping the timer banks **`totalMs = 0`**: an hour of tracked work, deleted
- `+30 days` across one session → `totalMs = 30.0 days`

**Expected:** accumulate from a monotonic source (`performance.now()`), and sanity-cap a single session (a crochet session is not 30 days).

Both directions are everyday events: DST fall-back at 02:00 with the timer left running overnight, flying across a timezone, or the phone's NTP correcting a drifted clock. The backward case is the bad one — it destroys recorded time with no trace.

**Console:** nothing.
**Suspect:** `toggleTimer` / `elapsedMs` in `js/store.js` (~L1975–1992); the `Math.max(0, now() - runningSince)` clamp turns a backward jump into a silent zero rather than an error.

---

## 9. Lowering the make-count throws away completed pieces with no warning

**Severity: wrong count**

```js
const p = Store.createProject({name:'mc'}); const pt = p.parts[0];
Store.updatePart(p.id, pt.id, {makeCount:99, targetRows:1});
for (let i=0;i<50;i++) Store.tapRow(p.id, pt.id);   // 50 pieces done
Store.updatePart(p.id, pt.id, {makeCount:2});
```

**Observed:** `piecesDone` goes `50 → 2/2`, the part flips to done, `row` resets to 0. Fifty pieces of recorded progress vanish on a single number edit, with no confirmation and nothing in the undo-facing UI to suggest what just happened. (`Store.undo()` does restore it, but the user has no reason to know they need to.)
**Expected:** confirm ("this part has 50 pieces done — drop to 2?") before clamping.

**Console:** nothing.
**Suspect:** `updatePart` in `js/store.js` (~L1613–1616).

---

## 10. A long part name eats the entire part strip

**Severity: visual**

```js
const p = Store.createProject({name:'names'});
Store.addPart(p.id, {name:'L'.repeat(2000)});
Store.setActiveProject(p.id); App.render();
```

**Observed at 320×640:** the part tab renders all 200+ characters, wrapping into a solid block that fills the whole strip and pushes the `＋ part` button out of reach; at 2000 characters the strip is unusable. `document.documentElement.scrollWidth` stays at 320 (it wraps rather than overflowing horizontally), so it is contained but useless. `Store` accepts the name at full length — `makePart` trims but does not cap. Emoji (`🧶🇯🇵`) and RTL-with-override (`مرحبا ‮evil‬`) names are stored verbatim; the bidi override characters are rendered as-is, which will reverse surrounding UI text in the part strip.
**Expected:** cap the stored name (say 120 chars), strip bidi control characters, and `text-overflow: ellipsis` with a `title` on the chip.

**Console:** nothing.
**Suspect:** `makePart` / `updatePart` name handling in `js/store.js` (~L521–527, L1612) and the part-strip CSS in `css/app.css`.

---

## 11. Deleting the active project leaves its editor sheet open over the home screen

**Severity: visual**

```js
const proj = Store.createProject({name:'del'});
Store.setActiveProject(proj.id); App.render();
App.openProjectEditor(proj.id);
Store.deleteProject(proj.id); App.render();
```

**Observed:** the app correctly falls back to `screen-home`, but the "Edit project" dialog is still open on top of it, fully interactive, editing a project that no longer exists. Pressing its Save does nothing at all — no toast, no error, and the project is not resurrected. The user's edit simply evaporates.
**Expected:** closing the last screen that owns a sheet should close the sheet; a sheet whose subject disappeared should close itself and say so.

**Console:** nothing.
**Suspect:** `deleteProject` in `js/store.js` and `openProjectEditor` / `closeAllSheets` in `js/app.js` — no sheet holds a subscription to "my subject still exists".

---

## Hardening proposals

These are ordered by how many of the eleven they would have prevented.

**1. Make persistence a thing that can fail loudly.** Replace the two empty `catch` blocks in `js/store.js` with one `onStorageError(kind, err)` hook that the shell renders as a persistent banner. Kill #2 and #3 outright, and give every future storage path (BlobStore, a zip export) somewhere to report. Pair it with a `…:corrupt:<ts>` quarantine copy on an unparseable read and a refusal to write over unread-but-present data. Nothing about a no-backend app is safe if "did the save work?" is unanswerable.

**2. Own the multi-tab story explicitly.** A `storage` listener plus a per-write `revision` counter: on a foreign bump, either reload state (nothing local in flight) or show "this project is open in another tab" and stop auto-saving. Kills #1. Cheap, and the alternative is a bug that only ever shows up as "my project disappeared".

**3. Every mutator gets an inverse, and the inverse is tested.** `untapRow` should be the literal inverse of `completeRow` (#4), including the piece boundary and the history entry. A table-driven test — for each (tapRow, tapStitch, jumpToRow, importPatternSections) apply-then-invert and assert deep equality of the project — would have caught #4 and pressured #6 into existence as a design question rather than an accident.

**4. Terminal states must be idempotent.** `completeRow` re-enters its "finished" branch on every tap (#6). A single `if (prt.piecesDone >= prt.makeCount && prt.targetRows) return {event:'alreadyDone'}` guard fixes the count, the repeated celebration and the rewritten `finishedAt` together. Generalise: any state transition that fires a celebration, a toast or a timestamp should be written as "transition to X" and be a no-op when already X.

**5. Stable identity for imported sections.** Give each parsed section a content-derived key (a hash of its first instruction line) stored on the part, and match on that before falling back to the name (#7). The positional `'Part ' + (n+1)` fallback is a name that changes meaning between runs, which is the whole bug.

**6. Never trust `Date.now()` for durations.** One `Elapsed` helper that accumulates from `performance.now()`, persists only completed spans, and refuses a single span longer than, say, 18 hours (#8). Every future feature that measures a duration — session stats, "time per row", a Pro analytics view — inherits the fix.

**7. Clamp at the door, and confirm before you destroy.** `clampInt` is used consistently and well, which is why the numeric fuzzing found so little. The gap is that a clamp that *discards recorded progress* (#9) is treated the same as one that rejects a typo. Split them: a clamp that would lower a `piecesDone`/`row`/`doneBits` count returns a "would discard N" result the caller must confirm. Same door for string length and bidi-control stripping (#10), so no free-text field can ever reach the DOM unbounded.

**8. Sheets need a lifecycle tied to their subject.** `openSheet` should take the subject id and self-close (with a toast) when `Store.project(id)` stops resolving (#11). This also covers the not-yet-tested cases of the same shape: a part editor over a deleted part, a chart viewer over a deleted cross-stitch project.

**9. Budget the per-tap render.** Add a test-page assertion that a tap+render on a 1000-row pattern stays under ~16 ms, and make the diagram/pattern rebuild incremental rather than whole-pattern (#5). A performance regression here is invisible on a desktop and fatal on the phone the app is actually for — it needs a number in CI, not a feel-test.

**10. Assert an empty console in the test pages.** Every bug above ran without a single console message. A shared harness that fails a fixture if `window.onerror`, `unhandledrejection` or `console.error` fired during it costs almost nothing and turns the next silent failure into a red test.

---

*Test data created during this session (`ZQA_*` / `QA*` projects) was removed from localStorage afterwards; the viewport was reset to desktop.*
