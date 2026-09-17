# 08 — Product, positioning, growth and monetisation

Brainstorm, 2026-09-17. One of ten parallel lenses. Nothing here is decided; nothing
outside this file was edited. Evidence is cited inline — repo files, the research
docs in `docs/research/`, or a public URL checked today.

---

## Positioning

**Thready or Not is for the maker who already owns the pattern.** It is sitting in
their phone's downloads as a PDF, and the only real problem is starting it and not
losing their place. Everything else on the market is either an *organiser of
objects* — stash, fabric, pattern library, of which sewing alone has ten
(`docs/research/sewing.md` §A.2.1) — or a single-craft marker-upper that is
Android-only (Pattern Keeper), subscription-priced (Markup R-XP), or cannot open a
PDF at all (Cross Stitch Saga). Thready or Not is the only tracker that (a) spans
crochet, cross-stitch and sewing/quilting in one app, so a maker who does two crafts
stops paying for two apps; (b) *reads real commercial PDFs* into parts, charts,
cutting lists and numbered steps instead of asking for data entry — the single
biggest adoption blocker every sewing survey names (`docs/research/sewing.md` §A.2.2
item 4: *"You have to enter every pattern manually. ONE BY ONE."*); (c) turns a
photo into a stitchable chart entirely on-device in ~150 ms, with no server and no
token cost; and (d) asks for no account, no network and no subscription — which
means nothing to cancel, nothing to leak, and an app that still works in five years
when its one author has moved on (see `docs/research/sewing.md` on Textillia being
dissolved and Cora untouched since 2019). Sold once, for less than the price of one
pattern.

**Proposed one-liner:** *"Drop in the pattern. Never lose your place."*
**Sub-line:** *Crochet, cross-stitch and sewing. Works offline. No account, ever.*

**What is actually defensible, in order of strength**

1. **Parser coverage on real files.** 263 fixture assertions against real crochet
   PDFs, 174 against 11 real charts, 137 against real sewing booklets (HANDOFF
   "Tests"). That is a moat built out of grind, not cleverness — and Pattern Keeper's
   own designer page concedes *"it is impossible to set any strict guidelines"*
   for PDF structure ([patternkeeper.app/for-designers](https://patternkeeper.app/for-designers/)),
   which is why its compatibility is a hand-maintained designer whitelist.
2. **Three crafts, one shell.** No competitor spans them. The craft plugin contract
   (`docs/CRAFTS.md`) means craft four costs a module, not an app.
3. **On-device photo → chart.** Free to run forever; a hook nobody can undercut on price.
4. **No account / offline / iOS + Android + desktop.** Pattern Keeper is Android-only
   with no sync; Cora is iOS-only with no sync (`docs/research/cross-stitch.md` §A1.4,
   `docs/research/sewing.md` §A.2.2 item 6).

**What is *not* defensible:** the counter itself (dozens of free row counters), themes,
and the stash/library niche — which the sewing research correctly tells us to stay out of.

---

## The 23 proposals, ranked by impact ÷ effort

Score = Impact (1–5) ÷ Effort (S=1, M=2, L=3). Ties broken by how much a thing
unblocks other things.

---

### 1. Make the 15-second demo clip the product's front door — Effort S · Impact 5 · **5.0**

**Why.** Every channel in the launch plan — TikTok, Instagram Reels, Product Hunt,
a Reddit comment, a Discord reply, the landing page hero, the Play listing — needs
the same asset, and it is the one asset that proves the claim other apps can't make.
Markup R-XP's reviews complain about a learning curve; Pattern Keeper's grey-X help
page exists because import failure is the thing buyers fear. A silent screen
recording of *finger drags a PDF in → chart appears → tap, tap, counter moves* kills
both objections in less time than it takes to read a paragraph.

**Proposal.** Three clips, phone-shot at 375 px, no voiceover, big captions:
(1) crochet PDF → parts + counts + checklist; (2) cross-stitch PDF → key + chart
pages + tap-to-mark; (3) a photo of a pet → chart → floss list. Each ends on the
same card: name, one-liner, URL. Cut a 6-second loop of each for Reels/TikTok and a
45-second cut for Product Hunt. Record on the owner's own phone with the owner's own
pattern so there is no copyright question about the clip.

**Cost / risks.** £0. Risk: filming a commercial PDF on screen republishes someone's
chart — use the owner's own FlossCross export (already on the HANDOFF list as fixture
item 1) or a free pattern with the designer's name shown.

---

### 2. Spend one day testing on real phones before anything else ships — Effort S · Impact 5 · **5.0**

**Why.** HANDOFF "What's left" item 3: *"nothing here has run on touch hardware."*
A phone-first app whose 3D swipe, chart pinch-zoom and photo-crop handles have only
been driven by synthetic pointer events in a desktop pane is not launchable. One bad
first-touch experience in front of an r/CrossStitch audience is not recoverable —
you get one launch per community.

**Proposal.** A borrowed iPhone (Safari) and a mid-range Android (Chrome), one
afternoon, scripted: install to home screen → offline reload → import each craft's
PDF → 3D swipe vs tap → chart pinch and drag → photo crop → print → export/import
round trip → battery/thermals after 20 minutes of counting. Log findings as a numbered
list like `docs/ux-sweep-2026-09-16.md` and fix before any marketing link exists.

**Cost / risks.** £0 if phones are borrowed; a used mid-Android for testing is
~£80–120 and is the single best hardware purchase this project can make.

---

### 3. Finished-object share card — Effort S · Impact 4 · **4.0**

**Why.** This is the only organic growth loop that does not require the owner to
self-promote. Makers post finished objects constantly — it is the core ritual of
r/crochet, r/CrossStitch and #sewcialists (`docs/research/sewing.md` §A.2.3). The
app already holds the things that make a *good* post: the timer total, the row/stitch
counts, the history, the theme palette. Nobody else can generate "47 hours, 18,400
stitches" because nobody else counted them.

**Proposal.** On `projectDone` (and from the ⋯ menu any time), render a 1080×1350
canvas card in the active theme: project name + emoji, hours from `timer.totalMs`,
total rows/stitches/colours, a small progress ring, tiny wordmark + URL in the
corner. One button → `navigator.share({ files: [png] })`, falling back to download.
Let the user toggle each stat off. No photo upload, no network, ~150 lines in a new
`js/focard.js`.

**Cost / risks.** £0. Risk: looking like an ad in someone's celebration post — keep
the wordmark small and make the stats the hero. Watermark must be honest, not a QR code.

---

### 4. Settle the name this month — Effort S · Impact 4 · **4.0**

**Why.** A search today for the exact phrase returns **"Thready Or Not Embroidery"**,
an existing needlework shop with a Shopify storefront ([shop.app listing](https://shop.app/m/c7hu51q4p0)),
and **"Thready: Your Thread Tracker"**, a live iOS floss-organiser
([App Store](https://apps.apple.com/us/app/thready-your-thread-tracker/id1511345898)).
Both are in the same craft vertical — the worst place for a collision. Every launch
asset, domain, store listing and licence key ties to the name, so this is cheap now
and expensive in ninety days. The GitHub repo is also public and indexed, with the
description *"Creating something something to help jas and em track their crochet
projects"* — charming in private, undermining on a paid product's first search result.

**Proposal.** (a) Run the free registry searches (UK IPO search, USPTO TESS, EUIPO
eSearch) for class 9 (software) and class 26 (haberdashery) before buying a domain.
(b) If it is clear, register the wordmark in one class and buy `threadyornot.app` /
`.com` the same week; if it is not, shortlist alternatives that keep the joke
(*Stitch or Miss*, *Row or Never*, *Count Me In*) and decide in one sitting.
(c) Either way, fix the repo description today. (d) Keep the internal names
(`stitchkeeper.v1` storage key, `CrochetBs` folder) exactly as they are — SPEC.md
already explains why.

**Cost / risks.** Registry searches free. A UK trade-mark filing is on the order of
£170 for one class plus ~£50 per extra class; a US TEAS Plus filing ~$250 per class
— verify current fees at filing time. Risk of *not* doing it: a rename after launch
burns every backlink, every licence key issued under the old name, and any store listing.

---

### 5. Rewrite the pitch everywhere it is still "a crochet counter" — Effort S · Impact 4 · **4.0**

**Why.** `manifest.webmanifest` says *"Row & stitch counter for crochet projects"*,
`index.html`'s meta description says *"A crochet row, round and stitch counter that
works offline"*, and README.md describes only crochet. Those three strings are the
install prompt, the search snippet and the first thing a linked visitor reads — and
two thirds of the app is now invisible in all of them. This is the cheapest impact
in the whole document.

**Proposal.** One consistent pitch across `index.html` meta (description + og:title
+ og:description + og:image pointing at a real screenshot), `manifest.webmanifest`
(`description`, and add `categories: ["productivity","lifestyle"]` and
`screenshots[]` so Chrome shows a rich install prompt), README.md, the Settings →
About line, and the future landing page. Copy: *"Drop in the pattern. Never lose
your place. A crochet, cross-stitch and sewing counter that reads your PDFs on your
own phone. Offline. No account."*

**Cost / risks.** £0. Touches shell-owned files (`index.html`, manifest) — one
agent, one commit, cache bump.

---

### 6. Decide it now: photo → chart is **free**, and it is the advertisement — Effort S · Impact 4 · **4.0**

**Why.** Open product decision, HANDOFF item 9. It costs nothing per user by
construction (Web Worker, ~90–160 ms, no network). It is also the single most
screenshot-able thing the app does and the only feature that reaches people who do
*not* yet own a pattern — i.e. the top of the funnel. Putting the demo behind the
paywall means the paywall has to sell itself with words.

**Proposal.** Photo → chart is free and uncapped on screen, including the DMC floss
list. **Pro** unlocks what you do with the result: printable chart, OXS export, and
saving a photo chart as a reusable template. Rationale to state publicly: "the fun
part is free; the part that replaces buying a pattern generator is paid."

**Cost / risks.** £0 to run. Risk: it cannibalises chart *sales* for designers you
later want as partners — mitigate by positioning it as "your own photos", never as
a pattern shop, and never adding a gallery.

---

### 7. Publish an honest compatibility page and let the app be its own trial — Effort S · Impact 4 · **4.0**

**Why.** The market's dominant anxiety is "will it open *my* pattern?". Pattern
Keeper answers it with a maintained whitelist of supported designers and a help page
about grey Xs; Cross Stitch Saga's reviews are dominated by *"99% of sellers don't
give you the file types this app offers"* (`docs/research/cross-stitch.md` §A1.4).
Because our import runs entirely on-device, we can do what none of them can: let
someone test their own file, for free, in ten seconds, with no upload and no account.

**Proposal.** A `/compatibility` page (plain HTML, same repo) that says in plain
words: what imports well (numbered steps, cutting lists, floss keys, crochet section
headers), what imports partially (two-column tables, size charts), what never will
(scans and photos — no OCR; pattern pieces — never attempted, that is the designer's
property). Then: *"Don't take our word for it — open the app and drop your PDF in.
It is read on your phone; nothing is uploaded; if it doesn't work you have lost ten
seconds and paid nothing."* Link it from the paywall itself.

**Cost / risks.** £0. Risk: writing down limits invites comparison — but the
alternative is refunds and one-star reviews, and the honesty *is* the differentiator
against a whitelist.

---

### 8. A one-tap "this PDF didn't import" loop that feeds the fixture backlog — Effort S · Impact 4 · **4.0**

**Why.** Parser coverage is the moat (proposal 0 above), and the only way to grow it
is more real files. `tmp-pdf/SOURCES.md` currently has 7 KG-Chart charts, 1 Spriter,
3 DMC, 2 Pattern Runway booklets, 9 crochet PDFs — a good start and a narrow one.
HANDOFF's owner-side list is explicitly blocked on missing fixture classes (Artecy /
Pattern-Keeper-style charts, a quilt booklet, a bag booklet).

**Proposal.** In the import review screen, a quiet link: *"Didn't come out right?"*
→ a sheet that (a) shows exactly what the parser saw (section count, page count,
first three headers) so the user learns something, and (b) offers **Copy a report**
(structure only: page count, chars, detected columns, header candidates — never the
pattern text) plus a mailto link to a `patterns@` address, with one explicit
sentence: *"If you're happy for me to see the actual PDF, attach it; I'll use it
only to fix the parser and I won't share it."* Every received file becomes a fixture
in the existing `test/*.fixtures.html` harness (which already reads PDFs directly
from `tmp-pdf/`, so adding one is minutes).

**Cost / risks.** £0 (mailto, no backend). Risk: receiving copyrighted PDFs — the
`tmp-pdf/` gitignore rule already handles it; state the retention policy on the
privacy page. Do not build an upload endpoint: it would create a real per-user cost
and a real liability.

---

### 9. Recruit 20 beta stitchers before launch, from the places that allow it — Effort S · Impact 4 · **4.0**

**Why.** The app has never been used by a stranger. Twenty real users produce the
fixture files (8), the testimonials for the landing page, the first reviews, and the
list of people who will vouch for you in the exact threads where self-promotion is
banned but a *recommendation from a member* is not.

**Proposal.** Craft Discords and Ravelry groups only, with the moderator asked first
in every case. Ravelry's own guidelines make the rule explicit: unsolicited
promotional PMs are spam, and posting the same message to more than two boards
without the group owner's permission is not permitted
([Ravelry Community Guidelines](https://www.ravelry.com/about/guidelines)) — so it is
one group, one post, mod-approved, offering free lifetime licences to the first 20
who reply, in exchange for: install it, use it on a real project for a week, tell me
one thing that annoyed you. Track them in a text file, not a CRM.

**Cost / risks.** £0 (20 free licence keys). Risk: being seen as astroturfing —
never ask a beta user to post a review; ask only for the annoyance.

---

### 10. Trust block: privacy page, open changelog, plain-English licence — Effort S · Impact 3 · **3.0**

**Why.** There is currently no privacy page and no changelog anywhere in the repo
(grep of `js/`, `index.html`: no matches for privacy/changelog), and the Settings →
About line is a single sentence: *"everything stays on this device."* True, but a
buyer about to type a card number wants it in writing. The proprietary LICENSE is
also strict all-rights-reserved on a *publicly visible* repo, which reads as a
mistake rather than a choice.

**Proposal.** Three short pages linked from Settings and from the footer:
(a) **Privacy** — "no account, no analytics on you, no network calls except Google
Fonts (and here is how to turn even that off); your projects live in this browser's
storage and in files you export; a PDF you import is read in the page and never
leaves the device; if you email me a pattern I keep it only until the parser is
fixed." (b) **Changelog** — one markdown file, newest first, bumped with the cache
version, human sentences. (c) **What you're buying** — one screen: a personal
licence, unlimited devices you own, no expiry, no subscription, works offline
forever, refunds within 30 days no questions.

**Cost / risks.** £0. Also worth deciding deliberately: repo public (a trust signal,
but the all-rights-reserved licence then confuses people and the code is copyable)
versus private (matches the licence and the HANDOFF plan). Recommend **private**,
with the changelog and privacy pages published on the site instead.

---

### 11. Say out loud what happens if the author stops — Effort S · Impact 3 · **3.0**

**Why.** This audience has been burned and talks about it: Cora abandoned since
March 2019 with no sync; Textillia's company *dissolved* and the site run on
donations; Threadloop's rename caused data-migration problems
(`docs/research/sewing.md` §A.2.1). Every one of those is a *server* failure. An
offline app with file export is structurally immune, and almost nobody says so.

**Proposal.** One paragraph on the privacy/about page, and one line in the store
listings: *"This app runs entirely on your device. If I stop working on it tomorrow,
it keeps working — there is no server to switch off, no account to expire, and your
backup file is plain JSON you can read in a text editor. If I ever shut the site
down I will post the final build as a downloadable file first."* Then actually
honour it: keep the export format documented in the changelog.

**Cost / risks.** £0. Risk: a promise you must keep — keep it modest (no source
escrow, no "I'll open-source it"), and keep it in the changelog so it is dated.

---

### 12. A rules-safe Reddit/Ravelry protocol, written down before anyone posts — Effort S · Impact 3 · **3.0**

**Why.** These are the highest-yield communities and the easiest to get permanently
banned from. Reddit's site-wide norm is the 90/10 rule — *"it's fine to be a redditor
with a website, it's not fine to be a website with a Reddit account"*
([guide](https://redship.io/blog/reddit-self-promotion-rules)) — and craft subs
enforce it harder than most, often routing anything promotional into a pinned weekly
thread. Ravelry's guidelines are quoted in proposal 9. Neither r/crochet's nor
r/CrossStitch's live rule text could be fetched from this environment, so **read the
sidebar the day you post** and message the mods first; treat anything below as the
plan, not as the rules.

**Proposal.** A written protocol: (1) The owner's own account participates normally
for weeks before anything is mentioned — answer counting/pattern questions, post
their own FOs. (2) First mention is *never* a launch post; it is a reply to one of
the recurring *"what app do you use to keep track?"* threads, disclosed
(*"I made this, it's free to try, no account"*). (3) Any standalone post is
mod-approved in advance, one subreddit at a time, a week apart, never cross-posted
verbatim. (4) Lead with the demo clip and the free tier — never a price. (5) If a
mod says no, the answer is no, and that community gets reached through its Discord
instead. (6) One person, one account, ever — no second accounts, no asking beta
users to comment.

**Cost / risks.** £0. Risk: a ban is permanent and the crafting subs talk to each
other; the protocol exists to make patience the default.

---

### 13. Price it pay-what-you-want with a £9 / $12 floor, and sell gift licences — Effort S · Impact 3 · **3.0**

**Why.** The comparison set: Pattern Keeper ~$9 one-time, Android only, full crosses
only, ~1-month trial ([Play listing](https://play.google.com/store/apps/details?id=app.patternkeeper.android));
Markup R-XP a £14.99/yr subscription after a 14-day trial
([markuprxp.co.uk FAQ](https://markuprxp.co.uk/the-faq-page/)); Cross Stitch Saga
$14.99 with no PDF support; knitCompanion freemium with paid tiers around $9.99/yr
([App Store](https://apps.apple.com/us/app/knitcompanion-knitting-more/id1058142783));
Stash Hub ~£3.49/mo. A single £9–12 lifetime price for *three* crafts undercuts every
subscription on lifetime cost and sits exactly where this audience already pays.
Craft communities also reliably overpay solo makers when given the option.

**Proposal.** One product, "Thready or Not Pro", pay-what-you-want with a £9 / $12
minimum and a suggested £15. A **gift** option (buy a key for a friend) because
crafters buy each other supplies constantly, and a free-key request line for anyone
who says they can't afford it (answer yes, always, no questions — it costs nothing
and buys more goodwill than the £9).

**Cost / risks.** Platform fees, see proposal 15. Risk: PWYW can anchor low; setting
the minimum at the Pattern Keeper price and the suggestion above it protects the median.

---

### 14. Decide the sync story: files first, and publish the real cost of the alternative — Effort S · Impact 3 · **3.0**

**Why.** "No sync" is the top complaint about Pattern Keeper and Cora alike, so it
will be the top question at launch and needs a confident answer rather than a silence.
The honest one: real sync means a server, accounts, conflict resolution and a bill
— and the bill is not the blocker, the *promise* is. Numbers, so the decision is
made with facts: a Cloudflare Worker + KV relay is **$5/month** on the Workers Paid
plan (10M reads and 1M writes included; free tier is roughly 100k reads and 1k
writes/day, 1 GB storage; overage $0.50/M reads, $5/M writes, $0.50/GB-month —
[Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/)).
A device-to-device handoff is ~2 writes, so thousands of users fit inside $5/month.
It is affordable; it is just not free, and it converts a "nothing leaves your device"
promise into an asterisk.

**Proposal.** v1 answer, stated plainly in the FAQ: *"There is no cloud sync, on
purpose. Moving a project to another device is one file."* Make that file excellent
(proposal 17): Export → `navigator.share` → AirDrop / iCloud Drive / Google Drive /
WhatsApp-to-yourself, and Import via the same picker, which already reaches iCloud
and Drive for free. Revisit a relay only if ≥ 3 in 10 beta users name sync as the
reason they stopped — and if so, build it as an **opt-in, end-to-end-encrypted,
24-hour expiring handoff code**, never an account.

**Cost / risks.** £0 now; $5/mo + overage later if built. Risk: saying "no sync"
loses some buyers — the trade is credibility on the privacy claim, which is the
positioning.

---

### 15. Offline licence keys + Gumroad — Effort M · Impact 5 · **2.5**

**Why.** The hard rule is no per-user cost, and "no account" is a positioning pillar,
so the unlock must verify with no network and no server. That is a solved problem:
sign a tiny payload with a private key held offline, verify in the app with the
public key. The seller choice is the real decision. Gumroad is **10% + $0.50** on a
direct sale, plus card processing of roughly 2.9% + $0.30, i.e. about **12.9% + $0.80**
all-in — ~$2.35 on a $12 sale ([Gumroad fee breakdown 2026](https://www.swell.is/content/gumroad-pricing)).
Stripe Payment Links are far cheaper (~2.9% + 30¢, less for UK domestic cards) but
**you become the merchant of record**, which means handling EU/UK VAT on digital
goods yourself. Gumroad acts as merchant of record and handles that — for a solo
owner that is worth 10%.

**Proposal.** `js/licence.js` (~150 lines, no build step, fits the IIFE/global
pattern): a key is base32 of `{ name, issuedAt, tier, nonce }` + an **ECDSA P-256**
signature (universally supported by WebCrypto; Ed25519 is not, on older Safari),
verified against a public key baked into the file. `Store.settings.licence` holds
the key string; the app shows *"Licensed to Jas — thank you"*. Selling: Gumroad
product with PWYW, keys generated in batches by a tiny local Node/PowerShell script
run on the owner's machine and uploaded to Gumroad's "content/licence keys" list, or
generated per-sale by hand at low volume. Restore = paste the key again (it is the
receipt). No activation limit, no device count.

**Cost / risks.** ~12.9% + $0.80 per sale; Gumroad also holds payouts until $100
balance for unverified accounts. Keys are shareable and will be shared — accept it;
the personalised "Licensed to <name>" line is the only deterrent worth having, and
chasing piracy on a £9 craft app costs more than it recovers. Keep the private key
off the repo and in a password manager; losing it means reissuing every key.

---

### 16. "Try it on your own pattern first" — two free imports, then Pro — Effort M · Impact 5 · **2.5**

**Why.** This is the pricing mechanism that turns proposal 7's honesty into revenue.
Every competitor's trial is time-based (Pattern Keeper ~1 month, Markup R-XP 14
days), which answers "do I like it?" but not "does it work on *my* files?" — the
actual question. A *usage*-based trial answers exactly that, and the user who gets
through two successful imports has already proven the value to themselves.

**Proposal.** Free forever: unlimited counting, unlimited manual/pasted patterns,
all themes, export/import, photo → chart on screen. Free trial of the import engine:
**the first two PDF imports across the whole app**, in any craft, with no time limit
(a counter in settings, not a clock). Third import → a single sheet: what it found
in that file (so the value is concrete at the moment of the ask), the price, the
Gumroad link, the "can't afford it?" line. No nags anywhere else, no banner ads, no
countdown.

**Cost / risks.** £0. Risk: two is a guess — instrument it locally (proposal 21) and
ask the beta cohort; if most users only ever import one pattern, the gate is wrong
and the split should move to the per-craft power features instead (see the table below).

---

### 17. Zip backup that actually contains everything — Effort M · Impact 4 · **2.0**

**Why.** HANDOFF item 10: the backup JSON excludes BlobStore page images, and the UI
has to admit *"chart images are stored on this device only."* That makes the one
answer we give about sync (proposal 14) partly false for the crafts that need it
most — a cross-stitch project's chart pages are the project. It also makes "your
data is yours" a weaker claim than it should be.

**Proposal.** Export produces a `.zip` containing `backup.json` plus
`blobs/p-<id>-chartpage-3.png` etc. A **stored (uncompressed) zip writer is ~100
lines** — local file header, data, central directory, CRC-32 — no library, no build
step, and PNG/JPEG are already compressed so deflate buys almost nothing. Import
accepts either the zip or the old bare JSON (sniff `PK\x03\x04`). Then wire
`navigator.share({ files })` so Export → Share → AirDrop/Drive/iCloud is one flow on
a phone, and update the FAQ line that currently apologises.

**Cost / risks.** £0. Risk: multi-hundred-MB backups on big projects — show the size
before writing, and offer "projects only (small)" vs "everything (N MB)". Test the
iOS Safari memory ceiling on a 40-page chart project during proposal 2's phone day.

---

### 18. Cloudflare Pages + a real domain + cookieless analytics — Effort M · Impact 4 · **2.0**

**Why.** Already the plan (HANDOFF item 11) and it unlocks four things at once: a
private repo consistent with the proprietary licence, a custom domain that survives
a GitHub username change, headers you control (CSP, COOP/COEP if the photo worker
ever wants `SharedArrayBuffer`), and **free, cookieless, per-page analytics that
profile nobody**. `puckhead456.github.io/ThreadyOrNot/` is not a URL to print on a
share card, and every backlink earned before the move has to be re-earned after it.

**Proposal.** Move hosting before the first marketing link exists. Cloudflare Pages
(free tier: unlimited requests/bandwidth for static), custom domain, 301 the old
GitHub Pages URL, keep deploy-on-push to `main` so the workflow the owner knows does
not change. Add Cloudflare Web Analytics (free, no cookies, no per-visitor
identifiers) for page views only — that satisfies "am I growing?" without breaking
the privacy promise, because it measures *pages*, not people.

**Cost / risks.** Domain ~£10–15/yr (a `.app` domain also forces HTTPS, which is a
small bonus). Pages and Web Analytics free at this scale. Risk: service-worker
scope changes when the path moves from `/ThreadyOrNot/` to the domain root — the
relative-paths rule in SPEC.md means it should just work, but it needs a
clear-caches test and a cache-version bump on the day.

---

### 19. Rename the IP-referencing themes and redraw the mascots — Effort M · Impact 4 · **2.0**

**Why.** HANDOFF item 11, and it is a launch blocker the moment money changes hands.
`js/themes.js` ships `Pelican Town Spring`, `Stardrop Night` ("Counting under the
stardrops"), `Harvest Festival` (Stardew Valley), `Night Fury` ("Plasma blasts and
belly rubs" — How to Train Your Dragon) and `Fire & Blood` ("A stitch of fire and
blood" — Game of Thrones). A free hobby app gets ignored; a paid product on Product
Hunt with a Night Fury theme is a takedown waiting to happen, and app stores action
IP complaints without argument.

**Proposal.** Keep every palette *exactly* as it is — the colours are the loved part
— and change only `name` and `tagline` in `js/themes.js` to evocative, generic
equivalents (*Valley Spring*, *Starfall Night*, *Harvest Table*, *Midnight Scale*,
*Ember & Ash*, *Pixel Wyrm* is probably already fine). Redraw the two mascots as
original art. Do it in one commit, mention it in the changelog as a rename so the
six beta users are not confused, and keep the theme **ids** unchanged so saved
settings survive.

**Cost / risks.** £0 for renaming; mascot art is an evening or a ~£50 commission.
Risk: users who loved the references — the changelog note ("same colours, new names,
boring legal reasons") handles it and is quite charming.

---

### 20. Template packs, and three designer partnerships — Effort M · Impact 3 · **1.5**

**Why.** Templates already carry pattern text per part (HANDOFF, v19) and
`Template.craft` / `craftData` are in the contract, so a template is already a
shareable, self-contained unit — the plumbing is done. And the pitch to a designer
is unusually clean: *"your customers open your PDF in the app and it works, because
I've tested against your file."* That is the same relationship Pattern Keeper built
with its supported-designer list, which is exactly why its whitelist is a moat.

**Proposal.** (a) **Export/import a single template as a file** (`.thready.json`),
plus "add template" from the file picker. Keep it file-based, not a directory — no
server, no moderation burden, no copyright liability. (b) Approach three designers
who publish *free* patterns first (Yarnspirations' 10,000-pattern free library and
Hobbii's free patterns are the obvious starts), asking only for written permission
to ship a template for one named free pattern. (c) In return, a "works with" page
naming them and a licence key each. Never redistribute paid pattern text — the
template a user makes from their own purchased PDF stays on their device, and the
privacy page should say so explicitly.

**Cost / risks.** £0 + outreach time (expect 1 reply in 10). Risk: a designer reads
"imports your PDF" as piracy tooling — lead every email with "it never uploads, never
exports your pattern, and it can't extract your pattern pieces" (the sewing spec
already makes that a hard rule).

---

### 21. Opt-in local stats and a "Year in Stitches" card — Effort M · Impact 3 · **1.5**

**Why.** Two jobs in one build. (a) The owner needs to know which features are used
before deciding the paywall line (16) — without tracking anyone. (b) Wrapped-style
year cards are the most reliably shared artefact any hobby app produces, and the app
already has `history` (capped 500 per project), the timer, and per-craft counts.

**Proposal.** A local-only `stats` object (counts of imports per craft, projects
created, rows/stitches, hours, features opened) that never leaves the device, shown
on a **Your stitching** screen — a genuinely nice feature, not a telemetry apology.
Then one button: **Copy my stats** → a short anonymous text block the user can paste
into an email or a Discord thread if they *choose* to help. That is the entire
analytics strategy: opt-in, human-in-the-loop, zero infrastructure. Add a
shareable year card (reuse proposal 3's canvas) in December.

**Cost / risks.** £0. Risk: self-selected data is biased — treat it as anecdote, and
weight the beta cohort's answers higher. Raise the 500-entry history cap or keep a
rolling monthly aggregate so a year card is possible.

---

### 22. Play Store via PWABuilder; skip the App Store for now — Effort M · Impact 3 · **1.5**

**Why.** Store presence is discovery ("cross stitch app" is searched in the Play
Store, not in Google), and it removes the "is this a real app?" objection. But the
economics are asymmetric: Google is a **$25 one-time** developer registration, and a
Trusted Web Activity wrapper of an existing PWA is close to free to produce. Apple
is **$99/year**, requires a Mac or a cloud build for signing, and its review of a
thin web wrapper is the classic rejection case. Both stores require their own billing
for digital unlocks (15% under each small-business programme), which is *cheaper*
than Gumroad's ~12.9% + $0.80 only above about £5 — so store billing is not a
disaster, it is just another SKU to reconcile against licence keys.

**Proposal.** Order of operations: web + Gumroad first; Play TWA at day ~75 once the
app has survived real phones and 20 betas; App Store only if Play converts (and then
as a Capacitor shell, not a TWA, since iOS has no TWA). On stores, sell the unlock
with the store's own billing and have the purchase write a locally-generated licence
— never ask a store user to paste a Gumroad key.

**Cost / risks.** $25 Google one-time; $99/yr Apple; 15% store commission on store
sales; Apple rejection risk for a wrapper. Also: iOS PWA install already works and
costs nothing, so the App Store is a growth choice, not a necessity.

---

### 23. Landing page + Product Hunt, in that order — Effort M · Impact 3 · **1.5**

**Why.** Product Hunt reaches makers and press, not crafters — its value is a
permanent, linkable "real product" signal and a spike of feedback, not sales. It is
worth doing *once*, after the assets exist, and it is worthless without a landing
page that converts.

**Proposal.** A single static page on the new domain, in the app's own theme: the
demo clip above the fold, the one-liner, three screenshots (one per craft), the
honest compatibility section (7), the price and the "try it on your own pattern"
promise (16), privacy in one line, and a single CTA that opens the app — not a
signup. Then Product Hunt on a Tuesday, launched by the owner in their own voice
("solo dev, no account, no subscription, my partner and I made it to track our own
projects"), with the origin story, which is the strongest thing this project has and
is currently only visible in a GitHub repo description.

**Cost / risks.** £0 (Product Hunt listing is free). Risk: launching before the phone
testing and the rename is done turns the one-shot into a one-star; sequence it last.

---

## Free vs Pro

Principles: (1) nothing in Pro can cost money to run; (2) the free tier must be
genuinely good, because it is the marketing; (3) the gate is *value realised*, not
time elapsed; (4) never gate safety — export, import and backup are always free, so
nobody is ever locked out of their own data.

| | **Free (forever)** | **Pro — £9 / $12 one-time, pay-what-you-want** |
|---|---|---|
| Counting | Unlimited projects, parts, rows, stitches, repeats, alerts, timer, history, undo | same |
| Patterns | Paste pattern text, manual entry, all built-in templates, editable templates | same |
| **PDF import** | **First 2 imports, any craft, no time limit** | Unlimited, all crafts |
| Cross-stitch | Manual chart entry, OXS **import**, chart viewer, colour key, tallies | Chart **pages from PDF** (page images), grid reader, parking sheets, floss shopping list, OXS **export** |
| Photo → chart | **Full, uncapped, on screen, with floss list** | Print it, export as OXS, save as a template |
| Sewing | Step counter, manual cutting list and notions | Booklet import, page images, machine presets, saved measurements, size/alteration sheets |
| Printing | — | Printable chart (colour and B&W), cutting list, notions shopping list |
| Data | Export, import, JSON backup — always free | Zip backup with page images |
| Look | All six themes, celebrations, tours, FAQ | same + one or two Pro-only themes (cheap delight, zero cost) |
| Support | FAQ, tours, compatibility page | "Send me the PDF" parser fixes, front of the queue |

Deliberately **not** Pro: themes-as-a-whole (mean), the counter (the point), export
(hostage-taking), undo, offline (the promise). Deliberately **not built**: anything
with a recurring bill.

Fallback split if the 2-import trial tests badly: keep *import* free for crochet
(the original audience, where the owner has the most goodwill and the deepest parser)
and make cross-stitch + sewing the Pro crafts. Simpler to explain, easier to sell,
loses the "try your own file" pitch.

---

## 90-day roadmap — one owner plus AI agents

Assumes the delegation pattern in HANDOFF ("one Opus agent per independent file
group with strict file ownership"), the owner doing decisions, phones, outreach and
anything involving money or a real person.

**Days 1–30 — Make it legitimate.** *Gate: nothing ships to strangers until this is done.*
- Week 1: name decision + registry searches + domain (4); repo description fixed;
  pitch strings rewritten everywhere (5); privacy / changelog / "what you're buying"
  pages (10, 11). *Agent work: 5, 10. Owner: 4.*
- Week 2: **real-phone day** (2) and the fix list it produces; theme renames and
  mascot redraw (19). *Owner: 2. Agents: fixes, 19.*
- Week 3: Cloudflare Pages + domain + redirect + cookieless analytics (18); zip
  backup + Web Share (17). *Agents, in parallel — different file groups.*
- Week 4: finished-object share card (3); compatibility page (7); record the three
  demo clips (1). *Owner: 1. Agent: 3, 7.*

**Days 31–60 — Make it a product.** *Gate: 20 real users have used it for a week.*
- Week 5: `js/licence.js` + key generation script + Gumroad product, PWYW, gift
  option (13, 15). Test the whole purchase → key → unlock → restore path on a phone.
- Week 6: paywall placement — 2-import trial, the single ask sheet, no nags (16);
  local stats screen (21) so the trial line can be judged with numbers.
- Week 7: recruit the 20 betas from Discords/Ravelry with mod permission (9, 12);
  issue free keys; open the "didn't import?" loop (8).
- Week 8: fixture sprint from whatever the betas send — Artecy-style chart, a quilt
  booklet, a bag booklet, the owner's own FlossCross PDF+OXS pair (HANDOFF's
  owner-side list); parser fixes as fixtures land. *This week is the moat.*

**Days 61–90 — Make it findable.** *Gate: the free tier is good enough that a
recommendation is not embarrassing.*
- Week 9: landing page on the domain, with beta quotes (23); template export/import
  file format (20a).
- Week 10: designer outreach, three free-pattern designers, permission in writing
  (20b); first TikTok/Instagram clips posted on the owner's own account, weekly
  cadence, craft-first content with the app incidental.
- Week 11: Product Hunt (23), then — days apart, one at a time, mod-approved —
  Ravelry group post and the first Reddit reply-in-an-existing-thread (12).
- Week 12: Play Store TWA via PWABuilder, $25 (22); Year-in-Stitches card queued for
  December (21); review the stats and the refund/complaint log, and decide whether
  the Free/Pro line moved.

**Explicitly parked past day 90:** any server, any account, any sync relay, iOS App
Store, a pattern marketplace, a stash/library module (crowded, and it is not the
job), and a fourth craft — until the first three have paying users.

**The three ways this fails, watched weekly:** (1) the parser misses the files people
actually own, and the trial converts at ~0 → the fixture sprint is the answer, not a
marketing push; (2) the owner burns a community with one badly-timed post → the
protocol in 12 exists for this; (3) it stays free forever because the paywall is
never shipped → weeks 5–6 are dated for that reason.
