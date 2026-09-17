# 12 — Interoperability, data formats and "my data is mine"

Brainstorm, 2026-09-17. Lens: what leaves the app, what comes in, and whether a user could
walk away with everything tomorrow. Nothing here is a commitment; each item is sized so the
owner can pick a line and stop.

## Where we stand today

**What the backup is.** `App.exportBackup` (js/app.js §19) writes `Store.exportJSON()` —
`JSON.stringify(getState(), null, 2)`, i.e. the *entire* localStorage state — into one
`thready-or-not-backup-YYYY-MM-DD.json` via Blob + `<a download>`, with a `navigator.share({files})`
path behind `canShareBackup()` on mobile. Import is a file input → `Store.importJSON`.

**What is good about it.** It is plain JSON, pretty-printed, readable in any text editor, and it
already carries `craft`, `craftData`, templates with their pattern text, history and timers. A
cross-stitch chart survives it (RLE cells + base64 progress bitmaps live inside `craftData`). The
share-sheet path means an iPhone user can put it in Files, Mail or iCloud Drive without a cable.

**What is not.**

1. **Version is a hard equality check.** `js/store.js:2010` — `if (raw.version !== VERSION) throw
   new Error('Unsupported backup version: ' + raw.version)`. `VERSION` is `1`. The day anything
   forces a bump, every backup a user has ever taken becomes unreadable *by our own app*, and every
   file written by a newer install is rejected by an older one with a scary message instead of
   "update the app". This is the single highest-leverage fix in this document.
2. **Import is all-or-nothing and "imported wins", silently.** A user who restores last month's
   backup to recover one frogged project overwrites this month's progress on every other project
   with no preview and no undo (`importJSON` calls `clearUndo()`).
3. **Page images do not travel** (HANDOFF "What's left" #10). BlobStore holds rasterised chart pages
   and sewing booklet pages keyed `p:<projectId>:<kind>:<n>`; the JSON has no idea they exist. The UI
   says "stored on this device only", which is honest and unsatisfying.
4. **There is no per-project export.** You cannot send one project, or one template, to a friend or
   to your own tablet. The unit of sharing is "my whole life in this app".
5. **The file contains settings that import ignores** — theme, haptics, tours seen, `activeProjectId`.
   Dead weight going out, and a small privacy leak when a backup is shared with someone else.
6. **No documented format.** Nothing in SPEC.md tells a user (or a future us) what the file *is*,
   so nothing stops it drifting.
7. **Nothing is printable except the cross-stitch chart**, and that chart deliberately prints
   without progress (HANDOFF #4).
8. **The app is not a share target, a file handler or a protocol handler**, so a PDF in Mail or
   Files cannot open into New project — even though the New project sheet is now built around
   dropping a PDF.

**The risk nobody has priced.** All state is localStorage. Safari evicts all script-writable
storage after **7 days without use** for sites that are not installed to the Home Screen, and both
iOS and Android will reclaim storage under pressure. A crocheter who counts a blanket for a fortnight,
takes a holiday, and comes back to an empty app will not file a bug — they will uninstall. We ask
for no persistence and we never nudge a backup. Items 1 and 2 below exist because of this.

**Competitor evidence worth holding onto.**

- **Pattern Keeper** (category leader on Android) has *no cloud sync at all*: "to transfer your
  progress you have to export it from one device and then import it on the other", and its backup is
  a **PDF** ([help](https://patternkeeper.app/help/export-a-backup-of-your-progress/),
  [FAQ](https://patternkeeper.app/faq/)). Manual, file-based handoff is normal in this category, not
  a compromise. Doing it *well* is a differentiator.
- **knitCompanion** syncs via Dropbox and integrates with Ravelry, and its project file is a
  proprietary `.kcp` ([knitcompanion.com](https://www.knitcompanion.com/),
  [fileinfo](https://fileinfo.com/extension/kcp)). That is the bar for "my data moves"; it is also a
  lock-in format.
- **Cross Stitch Saga**'s reviews are dominated by one complaint: it cannot open PDFs, only chart
  formats — *"99% of sellers don't give you the file types this app offers"*
  ([App Store](https://apps.apple.com/us/app/cross-stitch-saga/id1440279996), via
  `docs/research/cross-stitch.md` A1.4). Import breadth is what gets forgiven; export breadth is what
  gets praised.
- **OXS** is the only open, documented, text interchange format in the needlework world
  ([spec](https://www.ursasoftware.com/OXSFormat/)) and we already read and write it. Every other
  chart format is proprietary binary and several are deliberately encrypted (CSTX). There is no
  equivalent for crochet or sewing at all — which is an opening, not a gap.

**The design rule this lens suggests:** *every screen that shows something should be able to hand it
to you as a file you could open without us.* That is achievable inside the constraints — zip, deflate,
print-to-PDF, ICS, CSV and QR are all in the browser already; none of them needs a server, a token or
a build step.

---

## Proposals, ranked by impact ÷ effort

### 1. Ask for persistent storage, and nag for a backup before the browser eats it
**Why** · All state is localStorage; Safari clears script storage after 7 days of non-use for
non-installed sites. "The app lost my blanket" is the one review that kills a counter app, and it is
currently possible through no fault of the code.
**Proposal** · On boot, once, `navigator.storage.persist()` (Chromium grants it silently to installed
PWAs; Safari ignores it harmlessly). A tiny `lastBackupAt` in settings; when a project has been
touched on 5+ separate days since the last backup, show a one-line dismissible bar on Home: "Your
work lives only on this phone. Save a backup →" opening the existing share/download. Plus an "Add to
Home Screen keeps your projects safe" line in the iOS-Safari-not-installed case (detect via
`display-mode: standalone`).
**Effort** S · **Impact** 5
**Risks** · Nag fatigue — cap it, make "not now" last 14 days. `persist()` can show a prompt on some
Chromium builds; call it after a user gesture, not on cold boot.

### 2. Make the backup version tolerant, and write down the migration policy
**Why** · `raw.version !== VERSION` → throw. Today that is invisible; the first bump makes every
existing backup a brick, and we are about to have reasons to bump (zip container, per-craft data).
**Proposal** · Replace with: `version > CURRENT` → "This backup was made by a newer version of
Thready or Not. Update the app, then try again." `version < CURRENT` → run an ordered
`MIGRATIONS[n]` chain (each a pure `state → state`), identical to the one `load()` already implies
with its normalise-on-load behaviour, then import. Unknown top-level keys and unknown keys inside
`craftData` are preserved verbatim (already true for `craftData`; make it explicit and tested). Add
`test/backup.test.html` with a frozen v1 fixture that must keep importing forever.
**Effort** S · **Impact** 4
**Risks** · Migrations must be pure and idempotent, or a double-import corrupts. Keep a frozen copy of
each historic fixture in `test/`, never regenerate them.

### 3. Import preview: choose what comes back
**Why** · Restoring an old backup to rescue one project silently rewinds every other project, and
undo is cleared. This is the most likely way a user loses real work *using a feature meant to protect
them*.
**Proposal** · Import shows a sheet before writing: a row per project in the file — name, craft,
"last worked 3 Sept", and the state of the copy on this device — with **Skip / Replace mine / Keep
both** (keep-both clones with a fresh id and " (from backup)" appended). Header line: "12 projects ·
9 new · 3 you already have". Default: new = import, existing = keep mine when the local copy is
*newer* by `updatedAt`, replace when older. Same treatment for templates.
**Effort** M · **Impact** 5
**Risks** · `updatedAt` skew across devices with wrong clocks; show the dates and let the human decide
rather than trusting the heuristic.

### 4. `.thready` — one zip with everything, and a documented spec
**Why** · Users expect "export" to mean *everything*, including the chart pages they can see on
screen. Ours drops them. A zip also gives us a place for a README, so the file explains itself in 20
years.
**Proposal** · New `js/zipfile.js` (`window.ZipFile`, ~200 lines, no dependency): writer and reader
over local headers + central directory + EOCD, method 0 (STORED) for already-compressed images and
method 8 via `CompressionStream('deflate-raw')` for text — Compression Streams are supported in every
browser, Safari since 16.4 ([web.dev](https://web.dev/blog/compressionstreams)). CRC-32 is a 20-line
table. Layout in the section below. Export writes `.thready`; import accepts `.thready` **and** bare
`.json` forever. Filename `thready-or-not-2026-09-17.thready`; share sheet path unchanged (a zip is
fine for `navigator.share({files})` on iOS).
**Effort** M · **Impact** 5
**Risks** · A custom extension is an unknown file type on iOS — Files will still hold it and our own
import picker must therefore accept `*/*` and sniff the magic bytes (`PK\x03\x04`), not rely on the
MIME type. Memory: build the zip from Blob parts, never one giant ArrayBuffer, or a 40-page chart
project OOMs a low-end phone.

### 5. Export one project (and import one project) — "send this to my tablet"
**Why** · Every sharing story people actually want is per-project: the same person on a phone and a
tablet, or "here's the sheep I made, load it and see the pattern". Pattern Keeper's whole sync story
is export-one/import-one, and it is enough.
**Proposal** · Project ⋯ menu → **Share this project**: writes a one-project `.thready` (same layout,
one folder under `projects/`), share sheet on mobile, download on desktop. Import routes a
one-project file through the same preview as #3. Also a **Share this template** on the template
editor (tiny file, usually < 4 KB).
**Effort** S once #4 exists · **Impact** 4
**Risks** · Project ids collide only with themselves, so re-importing your own project onto the same
device must land on "Replace mine", not silently duplicate.

### 6. Human-readable, diffable, self-describing contents
**Why** · "My data is mine" is a promise about *legibility*, not just possession. A file you can read
in Notepad, diff in a folder-sync history and reconstruct by hand is a much stronger promise than a
JSON blob — and it costs almost nothing.
**Proposal** · Inside the zip: stable key order (write through a fixed key list, not `JSON.stringify`
insertion order) so two exports of unchanged data are byte-identical and Dropbox/git diffs are
meaningful; ISO strings alongside every epoch ms (`updatedAtISO`); each part's pattern text *also*
written as `pattern/01-body.txt`; project notes as `notes.md`; a `README.txt` in plain English
explaining the layout and stating that the JSON is the authoritative copy and the `.txt`/`.md` files
are convenience copies ignored on import. Stop exporting `activeProjectId`; put settings in their own
member that import only reads when the user ticks "also restore my settings".
**Effort** S · **Impact** 3
**Risks** · Two sources of truth for pattern text — the README and the import code must both say the
`.txt` is a copy; never read it back.

### 7. Print anything: a row-by-row pattern sheet and a progress-marked chart
**Why** · Print is the universal export: the browser makes the PDF, so there is no library, no cost,
no platform gap, and it works on iOS. We already prove it with `XStitch.printableHTML`. Crochet and
sewing have no printable at all, and the chart deliberately prints without progress (HANDOFF #4) —
but "print my chart *with what I've done*" is exactly what someone takes to a stitching group.
**Proposal** · (a) `Patterns` → a printable project sheet: cover (name, hook/yarn from notes, time
logged, checklist), then each part as a numbered row list with counts, `≈` for computed, placement
notes at the end, and a tick box per row for people who count on paper. Same `openPrintable` plumbing
and blob-URL fallback. (b) A **Show my progress** toggle on the cross-stitch print sheet: done
stitches printed at 45% tint (colour) or hollow (B&W), plus "4,210 of 12,908 stitches" on the cover.
(c) A sewing printable: cutting list + step checklist.
**Effort** M · **Impact** 4
**Risks** · Ink. Default the progress toggle off and say what it costs. Large charts already have the
1 MB sheet guard — reuse it.

### 8. Ravelry without a server: links, a paste-ready notes block, and an honest "no"
**Why** · Ravelry is the gravity well of this hobby and the first thing a knitter asks for. But the
API needs an OAuth client secret (or basic-auth personal keys) and is not designed for browser
callers; there is no documented CORS support, so a static GitHub Pages app cannot call it at all
([developer portal](https://www.ravelry.com/pro/developer) — verify the CORS headers before
believing any of this). Building a relay to hold the secret contradicts "no backend", and per-user
OAuth tokens are a support burden even though they cost no tokens.
**Proposal** · Do the 90% that needs nothing: a `ravelryUrl` field on a project (paste the pattern
link; it renders as a tappable chip and survives export), and a **Copy for Ravelry** item that puts a
formatted project-notes block on the clipboard — name, hook, yarn, dates, hours from the timer, rows
counted, checklist state, "counted with Thready or Not" — ready to paste into a Ravelry project page.
Write the reasoning into the FAQ so "why no Ravelry sync?" has a real answer.
**Effort** S · **Impact** 3
**Risks** · None technical. The risk is the *expectation*: word the FAQ so it reads as a considered
position, not a missing feature.

### 9. Share a template or a finished-object card as a URL
**Why** · The lightest possible sharing: a link in a Discord/WhatsApp group that opens the app with a
template already loaded. No account, no upload, no server — the fragment never leaves the device that
opens it, and GitHub Pages never sees it.
**Proposal** · `…/#t=<base64url(deflate-raw(JSON))>` handled on boot: decode, show a preview sheet
("Sheep, 5 parts, 3 checklist items — Add to my templates?"), never auto-save. `CompressionStream`
gets a typical template to ~35% of its JSON; a 5-part template with pattern text lands around
1.5–3 KB encoded. Hard-cap the generated link at **8,000 characters** and, above that, say "this one
is too big to send as a link — send the file instead" (#5). Same mechanism for a finished-object card
(name, emoji, hours, rows, finished date, theme) that renders as a shareable page.
**Effort** M · **Impact** 4
**Risks** · Link rot by truncation — messaging apps mangle long URLs; the cap is the mitigation and
the decoder must fail politely ("that link looks incomplete"). Never put anything from a fragment
into the DOM as HTML. Treat decoded content as untrusted data: validate through `normalizeTemplate`
before it touches state.

### 10. QR handoff between phone and tablet
**Why** · Two devices, no cable, no cloud, no typing. And on iOS the *native camera* opens a scanned
URL, so we need a QR **encoder** only — no scanner, no permissions, no `BarcodeDetector` (which
Safari does not have).
**Proposal** · A **Show QR** button next to any share-as-link action (#9): render the same
`#t=…` URL as a QR into an SVG with a hand-rolled or vendored MIT encoder (~8 KB). Device B points its
camera at it and the link opens. QR version 40-L holds ~2,953 bytes, so the practical ceiling is a
template of roughly 2 KB compressed — enough for templates, checklists, a settings/theme transfer and
a finished-object card; not for charts, and the UI should say so rather than render an unscannable
monster. Pair it with an explicit "this is a one-time handoff, not sync".
**Effort** M · **Impact** 3
**Risks** · A vendored encoder must be MIT/BSD — the repo ships a proprietary LICENSE, so no GPL
(same trap as KXStitch in the cross-stitch research). Low-contrast themes: render the QR on forced
white with a quiet zone, never on `--surface`.

### 11. Be a Share Target and a file handler, so a pattern PDF opens into New project
**Why** · The New project sheet is now built around dropping a PDF, but the PDF lives in Mail or
Files and there is no route from there to us except download-then-find-then-drop.
**Proposal** · `share_target` in the manifest (`method: POST`, `enctype: multipart/form-data`,
`files: [{name:'pattern', accept:['application/pdf','.oxs','.thready']}]`) with the service worker
catching the POST, stashing the file in BlobStore under a one-shot key and redirecting to
`./?shared=1`, which opens New project with the file already in the drop zone. Plus `file_handlers`
for `.thready` and `.oxs` with `launchQueue.setConsumer`.
**Effort** M · **Impact** 3
**Risks** · **Platform reality: Android/Chromium installed PWAs only.** iOS Safari does not implement
Share Target ([WebKit standards position](https://github.com/WebKit/standards-positions/issues/11),
[magicbell 2026 roundup](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)),
and File Handling is Chromium **desktop** only
([MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/file_handlers)).
So this helps Android and desktop and does nothing for iPhone — keep the drop zone and the file
picker as the universal path and treat this as a shortcut, never the documented route. The SW POST
handler is also the one piece of service-worker logic that can break the app if it throws; guard it.

### 12. A "your data" screen: what is stored, how big, and one button to get it all
**Why** · Trust is a screen, not a paragraph. It also gives the backup nag (#1) somewhere to point,
and surfaces the BlobStore usage that is currently invisible until the phone complains.
**Proposal** · Settings → **Your data**: `navigator.storage.estimate()` and `BlobStore.usage()`
rendered as "Projects 240 KB · Chart pages 38 MB · 61 MB free", the persistence state from #1, "Export
everything" (#4), "Import" (#3), a per-project "Remove page images from this device" (they re-import
from the PDF), and a plain-English line that nothing is ever uploaded and there is no account.
**Effort** S · **Impact** 3
**Risks** · `estimate()` numbers are approximate and Safari's are misleading; label them "about".

### 13. CSV of sessions, and an ICS for a deadline
**Why** · Two tiny exports that plug into tools people already live in. The history sheet holds one
row per completed row (cap 500) and the timer holds real hours; today both die with the app. And
"finish by Christmas" is a real crochet deadline.
**Proposal** · (a) History sheet → **Export CSV**: `date,project,part,row,elapsed_minutes`, UTF-8 with
BOM so Excel behaves, downloaded or shared. Also a per-project summary row for people who sell their
work. (b) An optional `dueDate` on a project → **Add to calendar** writing a hand-built `.ics`
(`VEVENT` + a `VALARM` a week before, `DTSTART;VALUE=DATE`, CRLF line endings, `PRODID:-//Thready or
Not//EN`). `.ics` opens natively on iOS, Android and desktop with no library.
**Effort** S · **Impact** 2
**Risks** · CRLF and the 75-octet line folding rule are the only two ways to get `.ics` wrong; a
10-line fixture test settles it. Raise the 500-row history cap before people rely on the CSV.

### 14. Take `.oxs` (and `.thready`) at the front door, not just inside cross-stitch
**Why** · The OXS drop zone only exists once you are already inside a cross-stitch project, which is
backwards: the file *is* the project. Cross Stitch Saga's reviews show how much import friction costs.
**Proposal** · The Home screen and New project accept `.oxs` / `.xml` / `.thready` on the same drop
zone that takes PDFs: an OXS creates a cross-stitch project named from `charttitle` with the craft
preselected; a `.thready` goes to the import preview (#3). Sniff content, not extension (`<chart`
vs `PK\x03\x04` vs `%PDF`), because iOS hands us `public.data` for unknown types.
**Effort** S · **Impact** 3
**Risks** · The existing OXS fast path for huge `<fullstitches>` blocks must stay on this route; do
not re-implement the read.

### 15. Export the chart as an image, and the pattern as Markdown
**Why** · The most common "share" is a screenshot. Give people a good one. Markdown covers the user
who keeps a notes app or a blog.
**Proposal** · Cross-stitch: **Save chart as PNG** (render the existing tile SVG to a canvas at a
chosen scale, `toBlob`, share/download) with an optional progress overlay — the natural companion to
#7b. Crochet/sewing: **Copy as Markdown** (`## Body` / `1. Rnd 1: 6 sc in MR (6)`), which pastes
cleanly into Ravelry, Notion, Discord and email.
**Effort** S · **Impact** 2
**Risks** · A big chart PNG can exceed a phone's canvas limits — cap the pixel dimension and say so.
Copyright: an imported commercial chart re-exported as a clean PNG is a redistribution vector. Print
and image exports of *imported* charts should carry the designer/copyright line the OXS or PDF
declared, and the FAQ should say the file is for the person who bought it.

### 16. Meet Pattern Keeper / Markup R-XP files halfway, and be honest about the rest
**Why** · "Can I bring my progress from Pattern Keeper?" will be asked. The truthful answer is
mostly no — its backup is a PDF whose progress encoding is undocumented, and reverse-engineering a
competitor's file is both fragile and legally uncomfortable.
**Proposal** · Detect the generator when a PDF is dropped (producer string / structure) and say
something useful instead of failing: "This looks like a Pattern Keeper export. I can read the chart
from it, but not the stitches you've already marked — you'd start fresh." Then run the existing
key parser + grid reader. Route people who *do* have a chart file (WinStitch, MacStitch, KXStitch,
FlossCross, Cross Stitch Saga, DP) to OXS with a short "how to export OXS from your app" FAQ — the
same move Pattern Keeper makes with its export guides.
**Effort** S (messaging + FAQ) · **Impact** 2
**Risks** · Never promise progress import. If a future experiment reads PK marks, it is a beta flag
with a "this may break whenever they ship an update" banner.

### 17. A tolerant "paste anything" project importer
**Why** · Row-counter apps (the dozens of free Android ones) export nothing, or a text blob. Users
arrive with a screenshot, a notes-app list, or a spreadsheet of parts and rows.
**Proposal** · Import pattern sheet gains a second tab: paste a CSV/TSV/list and get parts and row
targets — `Body,40` / `Wings,20,x2` — with a preview table, plus our own JSON pasted as text (for
people who cannot get a file where they want it). One parser, very forgiving, reusing the sections
preview UI.
**Effort** M · **Impact** 2
**Risks** · Ambiguity — always preview, never import blind. Do not let it compete with the PDF path
in the UI; it is the escape hatch, not the front door.

### 18. A linked backup file on desktop (File System Access)
**Why** · The owner and power users work on a laptop; "Save backup" that overwrites the same file in
a synced folder turns manual backup into near-continuous backup.
**Proposal** · Where `window.showSaveFilePicker` exists (Chromium desktop), remember the
`FileSystemFileHandle` in IndexedDB, show "Backing up to Dropbox/thready.thready" in Settings, and
re-write it on demand (and on a daily first-launch) after re-querying permission.
**Effort** M · **Impact** 2
**Risks** · Chromium desktop only; permission must be re-granted per session in some configurations —
fail back to a plain download without ceremony. Never write without an explicit gesture the first
time.

### 19. `web+thready://` protocol handler for designers
**Why** · A designer could put "Open in Thready or Not" next to their PDF download.
**Proposal** · `protocol_handlers` in the manifest mapping `web+thready` to `./?p=%s`, handling
`web+thready://template?d=<compressed>` (a designer's ready-made part/checklist layout, same decoder
as #9) and `web+thready://pattern?u=<https url>` (fetch and import — only works if the designer's
host sends CORS headers, which most shops will not).
**Effort** S · **Impact** 1
**Risks** · Chromium-installed-only, so a designer's link is a broken promise for most visitors.
Fetching a URL named by an external page is a request-forgery shape: require an explicit user
confirmation showing the host, allow https only, cap the size, and never send anything with it.
Park this until there is a designer actually asking.

### 20. Server-relayed Ravelry, only if the launch plan already buys a server
**Why** · Real Ravelry integration (pull your queue and library, push a finished project) needs a
secret-holding endpoint. The launch checklist already plans a move to Cloudflare Pages.
**Proposal** · If and only if that move happens: one Cloudflare **Worker** (free tier, no per-user
LLM/token cost — it is a token *relay*, not an LLM) doing the OAuth code exchange and proxying a
handful of read endpoints, with the access token stored on-device and the Worker stateless. Scope it
to *read* first: import a pattern from your library into a project. Treat any push to Ravelry as a
separate decision.
**Effort** L · **Impact** 2
**Risks** · Breaks the "no backend" property that makes this app cheap and private; adds an outage
surface, a terms-of-service relationship and a support channel. Rate limits and API changes are
someone else's roadmap. The honest default is #8 and no relay.

---

## Draft `.thready` layout

A plain ZIP (so any OS opens it), UTF-8 names with the language-encoding flag set, no encryption, no
zip64 (guard and refuse above 4 GB). Text entries use method 8 via `CompressionStream('deflate-raw')`;
images use method 0 because JPEG/PNG do not compress twice.

```
thready-or-not-2026-09-17.thready
├── README.txt                 plain English: what this is, what the JSON means, that the
│                              .txt/.md files are readable copies and are ignored on import
├── MANIFEST.json              { "format": "thready", "formatVersion": 2, "appVersion": "…",
│                                "writtenAt": "2026-09-17T14:22:03Z", "device": "iPhone · Safari",
│                                "counts": { "projects": 12, "templates": 4, "images": 38 },
│                                "entries": [ { "path": "…", "bytes": 1234 } ] }
├── state.json                 the authoritative copy — exactly today's exportJSON shape,
│                              minus activeProjectId, with settings moved to settings.json
├── projects/
│   └── 8fk2p9/
│       ├── project.json       this one project, self-contained (parts, craftData, history,
│       │                      timer) — a valid single-project import on its own
│       ├── notes.md           project notes, readable
│       ├── pattern/01-body.txt … per-part pattern text, readable copy
│       ├── chart.oxs          cross-stitch only: the chart in the open format, so the project
│       │                      opens in WinStitch/KXStitch/Saga without us
│       └── pages/0003.jpg     BlobStore images, original bytes, key p:8fk2p9:chartpage:3
├── templates/
│   └── sheep.json             one file per template; a template file is also a valid import
└── settings.json              theme, haptics, craft settings, tours seen — imported only when
                               the user ticks "also restore my settings"
```

**Reading rules (a reader must be able to say this out loud).**
`MANIFEST.json` decides everything; `state.json` is the truth; a reader that does not understand an
entry **keeps it** rather than dropping it on the next export. A bare `.json` file with no zip around
it is a legacy v1 backup and is imported forever. Image entries are matched to BlobStore keys by path,
and a missing image is never an error — the project loads with "page images are on the other device".

**Migration policy (for `docs/FORMAT.md` and the SPEC).**
`formatVersion` is an integer that only ever goes up. **A reader accepts every version ≤ its own** and
runs an ordered chain of pure, idempotent migrations; a version above its own gets "update the app",
never "unsupported". Within a major, writers only *add* fields, never remove or repurpose one, and
readers ignore what they do not know while preserving it byte for byte on round-trip (the rule
`craftData` already follows). Every version ships a frozen fixture in `test/backup.test.html` that
must import cleanly for the life of the app — that test is the promise, not the prose.

---

## The thread running through all of this

The three items that would change how this app *feels* to own are cheap: tolerate old versions (#2),
show people what is about to be overwritten (#3), and put everything — including the chart pages they
can see — in one file that explains itself (#4). Together they are roughly a week. Everything after
that is reach: the link, the QR, the printable, the calendar file. The things that look most like
"integration" — Ravelry, share targets, protocol handlers — are the ones with the worst ratio, the
worst platform coverage, and the least to do with whether a user believes their data is theirs.
