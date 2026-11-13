# API: the data layer (wave K, shell-data worker)

Status: BUILT (batch 1, all suites green). Owner of `js/store.js`, `js/blobstore.js`, `js/zip.js`.
Adoption steps for the craft workers are in `docs/wave-k/shell-data.md` §"Adopting it".
Every name below is new in wave K unless marked "(exists)". Feature-detect before calling
(`typeof Store.counted === 'function'`) and degrade quietly. Nothing here changes what a
crochet-only install stores unless a feature is used: every new project / settings field is
present only once it has something in it.

---------------------------------------------------------------------------------------------------
## 1. Craft hooks on `Store.registerCraft` (all optional)

```js
Store.registerCraft({
  id, normalize, summary, templates,                         // (exists)
  template: {                                                // §2
    fromProject(project) → { craftData, checklist?, emoji? } | null,   // progress dropped
    blank?() → craftData                                     // seed for "＋ New template"
  },
  settings: {                                                // §3
    defaults?: { … },                                        // merged under the stored bag
    normalize?(raw) → object                                 // repair a stored / imported bag
  },
  heavy: {                                                   // §4
    fields: ['chart.cells', 'progress.done'],                // dotted paths inside craftData
    minBytes?: 32768                                         // a field moves off localStorage at this size
  }
})
Store.setCraftHooks(id, { template?, settings?, heavy? })    // the same hooks, for an App-side def
                                                             // (shell-ui forwards def.template here)
```
A hook that throws is ignored (the store falls back to today's behaviour).

---------------------------------------------------------------------------------------------------
## 2. Templates for every craft

- `Store.templateFromProject(projectId, opts)` (exists) now fills `craftData`, `checklist` and
  `emoji` from the craft's `template.fromProject(project)` (a deep copy of the project is passed;
  heavy fields are present). `opts.fromProject` overrides the registered hook. No hook → `craftData:
  null` as before. Crochet / knitting drafts are unchanged.
- `Store.templateDraft(craftId)` → an unsaved template `{ id:'', name:'', craft, craftData:
  blank() | null, parts:[{name:'Main', makeCount:1}], checklist:[] … }` for "＋ New template".
- `Store.saveTemplate(tpl)` (exists) keeps `tpl.craft` and `tpl.craftData`. A template whose
  craftData is over `Store.TEMPLATE_CRAFTDATA_MAX` (256 KB of JSON) is refused with
  `Error('That chart is too big to keep as a template …')` (templates live in localStorage).
- `Store.createProject({ templateId })` (exists) deep-copies `craftData` and runs the craft's
  `normalize` (unchanged). Templates travel in backups exactly as before.

---------------------------------------------------------------------------------------------------
## 3. Settings, per craft, and the user's profile

```js
Store.craftSettings(id) → object                 // (exists) the live bag, defaults merged in
Store.setCraftSetting(id, key, value)            // (exists)
Store.setCraftSettings(id, obj)                  // replace the whole bag (normalised)

Store.profile() → Profile                        // the live object; never null
Store.setProfile(patch)                          // shallow merge of { units, measurements, floss, fabric }, normalised
Profile = {
  units: { length: 'cm' | 'in' },                // the maker's preferred unit (default from the locale)
  measurements: { [key]: { value: number, unit: 'cm'|'in', at: ms } },   // 'bust', 'waist', 'hip',
                                                 // 'backWaist', 'sleeve', 'inseam', 'height', … any key [a-zA-Z0-9_-]{1,40}
  floss: { [brand]: { [code]: { owned: number, note?: string, at: ms } } }, // brand 'dmc', 'anchor', …
  fabric: [ { id, kind: 'aida'|'linen'|'evenweave'|'cotton'|…, count?: number, color?: string,
              w?: number, h?: number, unit: 'cm'|'in', qty: number, note?: string, at: ms } ]
}
Store.setMeasurement(key, value, unit) / Store.measurement(key, unit?) → number|null (converted)
Store.removeMeasurement(key)
Store.convertLength(value, from, to) → number   // cm ↔ in (mm accepted as a from/to)
Store.flossOwned(brand, code) → number
Store.setFlossOwned(brand, code, owned, note?)  // owned 0 removes the row
Store.adjustFloss(brand, code, delta) → number  // never below 0
Store.flossStash() → [{ brand, code, owned, note, at }]
Store.flossAllocation([{ projectId, needs: { [brand]: { [code]: skeins } } }])   // in priority order
  → { [projectId]: { [brand]: { [code]: { need, allocated, short } } } }        // computed, never stored
Store.addFabric(piece) → piece / Store.updateFabric(id, patch) / Store.removeFabric(id) / Store.fabricStash()
```
Settings are never in an undo snapshot (unchanged rule). Profile writes are saved at once.

**Backups restore settings now.** `Store.previewImport(text, pages)` returns `settings`:
`{ present: bool, changes: [{ key, label, from, to }], count }` (`present: false` for a
one-project file). `Store.importJSON(text, { …, settings: 'merge' | 'replace' | 'skip' })`:
- `'merge'` (the default): theme, haptics, sounds, keepAwake, autoAdvance, liveDiagram, each
  craft's bag (the file's bag wins, key by key), the profile (measurements and floss rows by key,
  the newer `at` wins; fabric pieces by id), toursSeen (union) and welcomed (either).
- `'replace'`: every restorable key is taken from the file (profile and craft bags whole).
- `'skip'`: today's behaviour.
- Never restored (this device's): focusProjects, persistGranted, lastBackupAt (the max is kept),
  backupNagSnoozedUntil, touchDays (union).
`Store.undoImport()` (exists) puts the settings back too (the pre-import snapshot is the whole state).

---------------------------------------------------------------------------------------------------
## 4. Heavy craft data off localStorage (IndexedDB), with diff undo

A craft opts in with `heavy.fields`. Until then nothing changes for it.

**What the store does.**
- In memory a project's craftData is always WHOLE once it is *ready* (the craft reads and writes it
  exactly as today, through `updateCraftData`).
- On save, a heavy field whose JSON is at least `minBytes` is written to BlobStore under
  `p:<projectId>:heavy:<path>:<rev>` (one IndexedDB transaction for all of a project's changed
  fields), and only after that transaction commits does localStorage get the project with the field
  left out and a side table `Project.heavy = { v: 1, fields: { '<path>': { key, rev, bytes, t } },
  summary }` pointing at it. Until then localStorage keeps the project's last fully committed copy
  (light and heavy always agree on disk). The previous rev of each field is kept; older ones are
  deleted.
- On load, a project with a side table is *not ready*: its craftData lacks those fields and the
  craft's `normalize` has not run on it. `Store.whenReady(id)` reads the blobs, puts the fields back,
  runs `normalize`, and resolves. The shell calls it before `renderProject`.
- Heavy values are treated as **immutable**: replace them (`cd.progress.done = newB64`), never
  mutate a heavy object in place. (Strings are immutable anyway; this is what makes undo cheap.)

```js
Store.heavyState(id) → 'none' | 'ready' | 'unloaded' | 'loading' | 'missing'
     // none: not opted in. unloaded: has a side table, nobody asked for it yet.
     // missing: a blob is gone (the side table is kept, so restoring the blob or a backup fixes it).
Store.whenReady(id) → Promise<state>          // loads on demand; resolves at once when ready / none
Store.hydrateAll() → Promise                  // every project (exportThready calls it)
Store.heavyIdle() → Promise                   // every pending IndexedDB write has landed (or failed)
Store.heavyInfo(id) → { state, pending: bool, fields: [{ path, where: 'inline'|'idb', bytes, key }] }
Store.onHeavy(fn) → unsubscribe               // { projectId, type: 'ready'|'missing'|'committed'|'failed'|'inlined' }
Store.discardMissingHeavy(id)                 // the user accepted the loss: drop the side table,
                                              // run normalize on what is left (one undo step)
```
- `updateCraftData` on a project that is not ready returns `null` and changes nothing.
- `Store.summaryFor(p)` on a project that is not ready returns `p.heavy.summary` (the last summary
  written while it was ready).
- **Failures are loud.** A failed IndexedDB write of a field that already lives there tries to put
  it back inline in localStorage ("inlined"); if that cannot fit either, `onStorageError` fires
  with `{ kind: 'quota'|'unknown', where: 'indexeddb' }` and `saveFailed()` is true, exactly like
  a localStorage failure. A field that was still inline simply stays inline (its first move
  failed) and `onHeavy` reports `failed`. A localStorage quota failure first tries to move opted-in
  inline fields to IndexedDB, then retries the write.
- Backups: `exportThready` waits for `hydrateAll()` and writes every heavy value **inline** in
  `backup.json` (no side tables), so a `.thready` and a one-project file are complete on their
  own and readable by older builds; the `p:<id>:heavy:` blobs are not duplicated in `pages/`.
  The synchronous `exportJSON()` inlines every ready project and keeps the side table of any
  project that is not ready.
- Undo: for an opted-in craft, an undo entry holds the light part of the project as a copy and each
  heavy field as either the shared (immutable) value or a diff (`{p, s, mid}` against the next
  state, checked by length and hash before it is applied). A diff that no longer applies refuses
  that undo step rather than restoring a wrong chart.

---------------------------------------------------------------------------------------------------
## 5. Count events and work sessions

```js
Store.counted({ projectId, n, total?, unit, part?, at? }) → event | null
   // n: units done by this action (negative for an undo / unmark); unit: 'stitch'|'row'|'step'|
   // 'cut'|'unit'|… ; part: a part name, colour key ('DMC 310') or step group, optional.
   // Records the work in the project's activity (no undo step of its own; it rides in the
   // snapshot the craft's own write already took) and emits the event.
Store.onCount(fn) → unsubscribe      // fn(event); event = { projectId, n, total, unit, part, at,
                                     //   origin: 'craft'|'counter', session: { s, e, c } }
```
The crochet / knitting counter (`tapStitch`, `untapStitch`, `tapRow`, `untapRow`) records its own
work and emits with `origin: 'counter'`; the shell's announcement helper should ignore
`origin: 'counter'` (app.js already announces those). A craft calls `Store.counted` once per user
action, after its `updateCraftData`, with the units that action really moved (a whole-colour mark
of 1,204 stitches is one event, n 1204).

```js
Project.activity = {                 // present once something was counted
  sessions: [ { s, e, c: { [unit]: n }, by: { [part]: { [unit]: n } } } ],  // newest last, ≤ 200
  days: { 'YYYY-MM-DD': { [unit]: n } },                                    // rollup, ≤ 800 days
  total: { [unit]: n }
}
Store.SESSION_IDLE_MS = 600000      // a count more than 10 minutes after the last one opens a session
Store.activity(id) → the object above (empty shape when none)
Store.pace(id, { unit, remaining? }) → {
  sessions, perHour: number|null,          // trimmed mean over the last 20 sessions of ≥ 2 min
  perDay: number|null,                     // mean over the days worked in the last 28
  today, streak, lastAt, daysSinceLast,
  finish: { low: ms, high: ms } | null     // ≈ only, only with remaining > 0 and ≥ 5 sessions
}
```
Goals (02 #21): `Project.goals = [{ id, kind: 'perDay'|'byDate', unit, n?, until?, label }]`;
`Store.setGoal(id, goal) → goal`, `Store.removeGoal(id, goalId)`, `Store.goalStatus(id, { remaining })
→ [{ goal, done, target, met, perDayNeeded? }]` (one undo step each write).

Mark log (04 X3, for the time-lapse): `Store.logMarks(id, [[cellIndex, 1|0], …])` buffers in
memory (cheap on the tap path); `Store.flushMarks(id) → Promise` writes one chunk
`p:<id>:marks:<seq>` (varint deltas) and runs by itself 60 s after the first buffered mark, on a
new session and when the page hides. `Store.readMarks(id) → Promise<[{ at, marks: [[i, done], …] }]>`
in order. The chunks travel in `.thready` files like page images; a project from before the log
has none (no invented history).

---------------------------------------------------------------------------------------------------
## 6. Step edits and notes (steps crafts)

```js
Store.stepKey(text) → 's<hash>'               // normalised text (case, spaces, punctuation) → id
Store.stepKeys(texts) → keys                  // the same, with '~2', '~3' on repeated texts
Project.overlay = { steps: { [key]: { text?: string, note?: string, at } } }   // present once used
Store.setStepEdit(id, key, text | null)       // null / '' clears the edit (one undo step)
Store.setStepNote(id, key, note | null)       // (one undo step)
Store.stepOverlay(id) → { [key]: { text?, note?, at } }
Store.applyStepOverlay(id, texts) → { rows: [{ key, text, printed, edited, note }], orphans: [{ key, text?, note? }] }
```
The key is a hash of the imported (printed) text, so a re-import of the same PDF finds the same
keys and the sewist's edits and notes come back; an overlay whose step is gone is an orphan (shown,
never dropped silently).

---------------------------------------------------------------------------------------------------
## 7. Storage report

`Store.storageUsage() → Promise<{ localBytes, blobCount, blobBytes, heavyBytes, quota, usage,
persisted }>` (`quota` / `usage` / `persisted` null where the browser does not say).

---------------------------------------------------------------------------------------------------
## 8. BlobStore additions (`js/blobstore.js`)

`BlobStore.putManyResult([{ key, value }]) → Promise<{ ok, count, error: 'QuotaExceededError'|… | null }>`
(one transaction, all or nothing, with the reason when it fails). `BlobStore.getText(key) →
Promise<string|null>`.
