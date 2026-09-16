# Sewing module — research and proposed spec

Research report + technical proposal for adding a **sewing** craft to Thready or Not, so the app serves garment, bag and quilt sewists with the same "drop a PDF and immediately have the info" experience the crochet import gives.

Status: **proposal only.** No app code was written. A companion document proposes cross-stitch; the craft plugin hook in Part B is designed to be shared by both.

Audience: the build agent who implements it. Everything in Part B is meant to be implementable without further research.

---

# Part A — Research

## A.1 How sewing patterns are delivered today

### A.1.1 The five delivery formats

| Format | What the buyer gets | Text extractable? |
|---|---|---|
| **Indie PDF pattern** (dominant since ~2015) | Instruction booklet PDF + print-at-home tiled A4/US-Letter pattern sheets (layered by size) + A0/copyshop file + increasingly a projector file | **Yes** — the booklet is born-digital vector text |
| **Big-4 envelope** (Simplicity, McCall's, Vogue, Butterick) | Tissue pattern pieces + a large folded printed guide sheet ("1 of 4") | No — paper only, unless the sewist buys the digital edition |
| **Magazine** (Burda Style, Ottobre, La Maison Victor) | Trace-off master sheets with all patterns overprinted in different colours + terse written instructions in the magazine | No — paper; and Burda sheets carry **no seam allowance**, the sewist adds it while tracing |
| **Digital-first / made-to-measure** (Bootstrap Fashion, Tailornova, MyBodyModel) | Patterns generated to the user's own measurements; PDF + DXF, sometimes minimal instructions | Partially — instructions are famously thin |
| **Free web tutorial** (Purl Soho, SewCanShe, Mood Sewciety, Noodlehead) | HTML steps + a small PDF template | Yes, but the *steps live in HTML*, not the PDF |

The only format that matters for import is the **indie PDF instruction booklet**, plus free-pattern PDFs that combine instructions and templates in one file. That is also the format the owner's target user already has sitting in their downloads folder.

**Pattern file anatomy that sewists talk about** (and which the app should *understand as vocabulary*, even though it cannot read the pattern sheets):

- **Tiled print-at-home file** — A4/US-Letter pages to print, trim and tape. Nearly always carries a **test square** that must measure exactly 2" × 2" (50.8 mm) to verify print scale ([Little Castle Designs](https://www.littlecastledesigns.com/post/how-to-use-pdf-sewing-patterns), [The Green Pepper](https://thegreenpepper.com/blogs/news/your-guide-to-using-pdf-sewing-patterns)).
- **Layered sizes** — the PDF's layer panel lets you switch off every size but yours before printing ([Cashmerette](https://blog.cashmerette.com/2020/06/print-patterns-using-layers.html)).
- **A0 / copyshop file** — one big sheet, no taping; print shops and services like [gather here](https://gatherhereonline.com/products/pdf-sewing-pattern-printing) and [Love Notions' guide](https://www.lovenotions.com/how-to-print-a0-copy-shop-large-format-sewing-patterns) exist purely for this.
- **Projector file** — layered for size plus a 4"/10 cm **calibration grid**; the sewist projects the pattern onto the fabric and cuts without printing at all ([Sinclair Patterns](https://sinclairpatterns.com/collections/free-sewing-patterns), [Made by Rae's projector setup](https://www.made-by-rae.com/blog/2024/12/my-sewing-projector-setup)). This is the fastest-growing corner of the hobby and it means a growing number of sewists **never print anything** — their whole pattern life is already on a screen. That is directly relevant: a phone-first step tracker fits that workflow better than it fits the paper one.

### A.1.2 What is inside an instruction booklet, in order

Across indie publishers the order is remarkably stable:

1. **Cover** — pattern name, designer, line drawings of each view/variant (View A, View B…), version number.
2. **Contents / "How to use this pattern"** — often a short page on printing, layers, the test square.
3. **Size chart (body measurements)** — a table: sizes across the top, `Bust / Waist / Hip / Height` down the side.
4. **Finished garment measurements** — a second table, same shape, used for ease. The Big-4 traditionally omit most of these from the envelope and print them on the tissue instead, which is a long-standing sewist complaint ([PatternReview thread](https://sewing.patternreview.com/SewingDiscussions/topic/119847)). Indies print both, and [In the Folds explicitly teaches choosing size by finished measurements](https://inthefolds.com/q-a-series/2021/using-finished-garment-measurements-to-select-your-size).
5. **Fabric requirements** — a table keyed by **fabric width** (115 cm/45", 150 cm/60") × **size**, in metres or yards, often branching by view. Plus fabric *recommendations* ("light to mid-weight wovens; at least 20% horizontal stretch").
6. **Notions / "You will need"** — thread, zip, buttons, elastic, interfacing, bias binding. Bag patterns extend this into a **hardware** list (D-rings, swivel hooks, magnetic snaps, rivets, grommets) and an **interfacing** list by branded product.
7. **Cutting layout** — diagrams of pieces on folded fabric, one per view × fabric width. Pure image; unextractable.
8. **Cutting list / pattern piece list** — the text version: `Front Bodice — cut 2`, `Back — cut 1 on fold`, `Pocket bag ×4 lining`. Big-4 guide sheets show "an illustrated guide to the pattern pieces… all the pieces are illustrated and numbered" ([Sew Direct](https://www.sewdirect.com/blog/getting-started-with-sewing/part-3-how-to-read-a-sewing-pattern/)).
9. **Seam allowance statement** — a single sentence, very consistently worded. The commercial standard is `Seam allowance: 5/8" (1.5 cm) unless otherwise stated`; indies vary between 1.5 cm (5/8"), 1 cm (3/8") and 6 mm (1/4"), and Closet Core has publicly moved some patterns from 5/8" to 3/8" ([Closet Core errata](https://closetcorepatterns.com/pages/errata), [Ageberry on seam allowances](https://www.ageberry.com/seam-allowances-in-sewing-patterns/)). Quilting is universally **1/4"** and does not restate it. Burda magazine patterns include **none** ([So Sew Easy](https://so-sew-easy.com/tracing-burda-patterns/)).
10. **Glossary / notation key** — notches, grainline, RST (right sides together), WS/RS, staystitch, understitch.
11. **Numbered construction steps with diagrams** — the body of the booklet.
12. **Hem / finishing / care**, then a "show us your make" page with a hashtag.

### A.1.3 What the publishers share, and where they diverge

**Shared across Closet Core, Grainline, Tilly and the Buttons, Helen's Closet, Cashmerette, True Bias, Merchant & Mills, Sew Over It, Named, Papercut, Friday Pattern Co and Peppermint:**

- The section order above, almost verbatim.
- Tables for sizes / finished measurements / fabric requirements.
- A one-sentence seam allowance declaration near the start of construction.
- Numbered steps, one action per step, imperative voice, opening with a verb: *Sew, Press, Pin, Baste, Stitch, Fold, Turn, Topstitch, Understitch, Staystitch, Clip, Trim, Grade, Finish, Attach, Insert, Gather, Ease, Edgestitch, Slipstitch, Serge/Overlock, Interface, Mark, Notch.*
- "RST" (right sides together) in roughly every third step.
- View/variant branching: `For View A only…`.

**Where they diverge — and this is what a parser has to survive:**

| Axis | Variation seen |
|---|---|
| Step numbering | `1.` · `1)` · `Step 1` · `STEP 1` · `01` · restart-at-1 per section · **no numbers at all** (Merchant & Mills and several European houses run terse continuous prose with diagram callouts) |
| Section headings | ALL CAPS (`CONSTRUCTION`) · Title Case (`Attaching the Collar`) · numbered (`3. THE SLEEVES`) · none |
| Units | Metric-first (Peppermint/AU, Named/FI, Merchant & Mills/UK) · imperial-first (Mood/US, Riley Blake) · dual `1.5 cm (5/8")` · mixed within one doc (imperial body chart + metric yardage — verified in Helen's Closet Horizon Tank) |
| Inch glyph | `"` · `”` · `''` (two apostrophes — verified in Mood's Wren Shirt) · `in` · `inch` |
| Fractions | `1/2` · `½` (Unicode) · `2-1/2 yards` (hyphenated mixed number — verified in Sew Sweetness Baker Street Bag) |
| Cutting list style | Dot-leader table (`Front ............ Cut 2`) · bullets · a real PDF table · embedded in the step ("cut 2 on the fold using the pattern template" — SewCanShe sling bag) |
| Layout | Single column · **two column** (very common in booklets designed for booklet-printing) · text boxes floating beside diagrams |
| Seam allowance | One value · **one value with exceptions** — Mood's Wren Shirt says *"All seams are ½'' besides the collar and the neckline, which are sewn at ⅜''"*, which a naive single-value extractor gets wrong |

### A.1.4 Quilting patterns

Different enough to deserve its own parsing branch. The canonical order ([String & Story](https://www.stringandstory.com/blog/how-to-read-a-quilt-pattern), [Alderwood Studio](https://www.alderwood-studio.com/blog/reading-quilt-patterns)):

1. Cover — finished quilt size(s), finished block size, designer.
2. **Fabric requirements chart** — fabrics (`Fabric A`, `Background`, `Binding`, `Backing`) down the side, quilt sizes (Baby / Throw / Twin / Queen) across the top, cells in yards or precut counts (fat quarters, jelly rolls).
3. **Cutting instructions** — the highest-value extractable block in the whole document. Lines look like:
   - `From Fabric A, cut (7) 4½" x WOF strips.`
   - `10 strips 2½" x width of fabric` — the same document can spell WOF out and abbreviate it
   - `Subcut into (64) 4½" squares.`
   - Multi-size counts in parentheses: `4 (64, 264)` — 4 for the pillow, 64 throw, 264 bed
4. **Block / unit assembly** — numbered, heavy on `Fig. 1` diagram references.
5. **Quilt top assembly** — rows and columns.
6. **Finishing** — batting, basting, quilting, binding.

Seam allowance is **1/4" scant**, assumed rather than stated. WOF = width of fabric, selvage to selvage, ~42". Quilters track **block counts** ("224 flying geese") the way crocheters track stitch counts — that is a natural fit for a counter app and is the strongest single argument that this module belongs in *this* app rather than a separate one.

### A.1.5 Bag patterns

Bag patterns are the format most amenable to import, because almost everything is rectangles stated in text rather than pattern pieces:

- **Cutting list is dimensional**: `Cut 2 — 14" x 16" from exterior`, `two 4" × 38" strap pieces`, `one 16" × 11" exterior zipper pocket`.
- **Interfacing list is its own block**, usually by branded product: `Pellon SF-101 Shape Flex`, `Soft and Stable`, `fusible fleece`, `2½ yards fusible woven interfacing (20" wide)`.
- **Hardware list**: `2 × ⅝" D-rings`, `1 × 18 mm magnetic snap`, `two 10"+ zippers`, swivel hooks, triglides, rivets, grommets. [Andrie Designs notes](https://www.andriedesigns.com/beginners-guide-to-sewing-your-first-bag-part-1/) that the hardware list is "on the back of the pattern if printed or the first couple of pages if a PDF" — i.e. reliably near the top.
- Seam allowance **changes mid-pattern**: SewCanShe's sling bag uses ¼" for pockets then says *"½" seam allowance from this point forward"*. Any seam-allowance model must support per-step overrides.

---

## A.2 How people actually sew, and what they track

### A.2.0 The headline finding

**Cross-stitch has [Pattern Keeper](https://play.google.com/store/apps/details?id=app.patternkeeper.android) — you open the chart PDF and mark off progress stitch by stitch. Sewing, quilting and bag-making have no equivalent.** Every sewing app found in this survey tracks *objects* — fabric, patterns, notions, projects, stash — and none of them tracks *position inside the instructions*. That is the gap this module should aim at, and it is the same gap Thready or Not already fills for crochet.

The corroborating evidence is unusually clean. [SewGuide built a free interactive 10-stage garment sewing checklist](https://sewguide.com/garment-sewing-checklist/) precisely because of *"forgetting whether you already understitched that facing or pressed that seam"* — and the page says outright that **it does not save your progress**: "If you close the tab, your checkmarks will reset. That's intentional." The tool that names the problem cannot persist the answer.

### A.2.1 The app landscape

**Stash and pattern organisers — a crowded, well-served middle.**

| Tool | Platform / price | Does well | Weak / stale |
|---|---|---|---|
| [Stash Hub](https://stashhubapp.com/) | iOS, Android, web, sync. Free tier record-capped; Plus £3.49/mo | The category leader (35k+ users). Fabric with photo/length/type/storage location, patterns (PDF + paper + notions), project plans with **checklists**, "Magic Mockup" | Object-centric; no step position. [Priced at ~$33/yr per a PatternReview member](https://sewing.patternreview.com/SewingDiscussions/topic/130202) |
| [Threadloop](https://threadloop.app/) (formerly Backstitch) | Web PWA, free core, ~$5/mo Plus | ~116k-pattern community database, stash yardage, project journals, PDF storage, preset task lists, **link-import bot** | Rename caused [data-migration problems](https://www.costumary.com/blog/sewing-project-planner-tools-2026) |
| [Cora – Sew Your Fabric Stash](https://apps.apple.com/us/app/cora-sew-your-fabric-stash/id1114445108) | iOS only, $6.99 after 5 fabrics | Excellent fabric filtering (colour, length, designer, price paid, pre-washed) | **Abandoned — last updated March 2019.** No sync at all. Never gained pattern tracking |
| [Sew Organized](https://play.google.com/store/apps/details?id=com.diydanielle.seworganized) (DIY Danielle) | Free, Android + iOS, synced | Fabric, projects, measurements, **shopping list** | Pattern tracking still "in the works"; third-party mirrors date the build to 2020 |
| [Sewjo](https://sewjo.app/) | Free, iOS/Android/web | Claims "step-by-step tracking", stash, patterns, notions, community | Brand new — a single App Store rating |
| [PatternMate](https://apps.apple.com/us/app/patternmate/id6464105499) | Apple only, free + $9.99/yr | **Pattern-packet document scanner** that auto-fills title/number; sells "remember where you left off" across concurrent projects | Tiny user base; Apple-only |
| [Sewing Pattern Buddy](https://mode-de-lis.blogspot.com/2017/08/sewing-pattern-buddy-app.html) | Android, ~NZ$6.99 after 25 | Deepest *pattern library* schema found: company, number, era, size range, fabric requirements, notions, cost, **printed/unprinted**, condition, copies, physical location, previous makes, rating | Library only |
| [PatternReview](https://sewing.patternreview.com/) | Free + paid "Friends of PR" | ~249k pattern reviews — the irreplaceable corpus; online Pattern Stash and fabric stash | Dated UI, [no project management](https://www.costumary.com/blog/best-sewing-apps-2026) |
| [Textillia](https://www.textillia.com/) | Free/donations | Pattern database + project logging | [The business was dissolved](https://www.textillia.com/about); run as a hobby on [donations](https://donorbox.org/textillia). Real bus-factor risk |
| [QuiltKeeper Studio](https://quiltkeeperstudio.com/), Quiltful, Stash Star, Sew Awesome 2, Threadalog | mixed | Quilt-specific WIP/block/stash tracking | Same object-centric shape |
| [Seamly2D](https://github.com/FashionFreedom/Seamly2D/releases) | Free GPLv3 desktop | Parametric pattern drafting; actively released through 2026 despite the [contentious 2017 Valentina fork](https://librearts.org/2017/12/valentina-seamly2d/) | Steep curve; irrelevant to project tracking |

Three things named in the brief turned out **not to be sewing tools**: "Sew Sketchy" is a [fashion-illustration brand](https://sewsketchy.com/), not an app; "Indyplan" does not exist (the nearest is the wardrobe app Indyx); "Stash Flash" is a [fabric-shopping service](https://www.quiltingboard.com/links-resources-f4/stash-flash-service-t303429.html), not software.

**What sewists build for themselves when the apps don't fit.** Trello is the most documented: [Helen Wilkinson's pattern board](https://helensclosetpatterns.com/blogs/helens-closet/how-to-organize-your-patterns-using-trello) uses one board, lists per garment category, cards carrying envelope photos and PDFs, labels like "want to make", and cross-board links to *fabric* cards; [A Piece of Quiet's quilt-queue board](https://www.apieceofquietquilts.com/quilty-blog/tame-your-quilt-queue) runs idea → in progress → finished with per-card checklists. Also: [Notion templates](https://matchymatchysewingclub.com/products/sewing-clubhouse-notion-template), [Airtable planners](https://www.threadandtherapy.com/airtable-sewing-planner-template/) — one maker explicitly built [three linked tables (Makes / Patterns / Fabric) "as a replacement for Ravelry"](https://janeofallfibres.com/how-im-using-airtable-to-track-my-knitting-and-sewing-projects) — and [Evernote/OneNote, recommended repeatedly on PatternReview](https://sewing.patternreview.com/SewingDiscussions/topic/92466).

**Wardrobe planners are a separate stack and none are sewing-aware.** Stylebook, [Whering, Cladwell, Indyx](https://www.myindyx.com/versus/stylebook-vs-cladwell) model outfits, not makes. No evidence any of them record "self-made", pattern used, or yardage.

**The healthiest adjacent niche is projector/PDF tooling**, and it is worth studying because it is where sewists already accept software in the sewing room: [Pattern Projector](https://www.patternprojector.com/en) (free, open-source PWA — calibrate to a cutting mat, stitch multi-page tiled PDFs, toggle size layers, invert/thicken lines), PDF Stitcher, and Project & Cut, [compared here](https://projectorsewing.com/software/). Calibration layers are conventionally a 10 cm and a 4" grid ([Craftstorming](https://www.craftstorming.com/2020/05/tips-for-using-pdf-sewing-patterns-on-a-projector)). The relevant point for this proposal: **a free, offline, browser-based PWA is a shape this audience already trusts.**

### A.2.2 What sewists complain is missing

Reddit is not fetchable from this environment, so the quotes below come from blogs, forums and app-store reviews. They converge hard.

1. **"Where was I?" is genuinely unsolved.** SewGuide's non-persisting checklist (above) is the clearest case. [PatternMate](https://apps.apple.com/us/app/patternmate/id6464105499) markets "remember where you left off" as a headline feature, which tells you it is a felt need — but it means *which project*, not *which step*.
2. **Forgetting alterations between sessions.** Charlotte Kan: *"I often put away a project for weeks, sometimes months and forget whether or not I've added those 2 extra centimeters to the sleeve"*, and *"some edits are quite subtle and hard to backtrack from a garment that's been worn and washed"* ([source](https://charlottekan.com/blogs/sewingblog/how-to-track-your-sewing-projects-and-alterations-a-pdf-template)).
3. **Tracking overhead kills adoption.** Jen Beeman of Grainline: *"If you're spending more time updating your system than actually sewing, that's probably a red flag"* ([source](https://grainlinestudio.substack.com/p/how-much-project-tracking-is-enough)) — and she argues explicitly against digitising information that is already visible on the pattern. On Quiltingboard: *"this sounds WAY too techie for me… I would spend more time putting my data into the app than I would care to"* ([source](https://www.quiltingboard.com/mission-organization-f23/do-you-use-app-keeping-track-your-stash-t242601.html)).
4. **Manual entry is the number-one adoption blocker.** *"You have to enter every pattern manually. ONE BY ONE."* ([Sewrendipity](https://sewrendipity.com/2017/11/10/pattern-stash-organising-app/)). This is exactly why PatternMate's scanner and Threadloop's link-import bot are their headline features — **and it is the single strongest argument for this module's PDF-import-first design.**
5. **Layered PDFs misbehave.** A long [Adobe community thread](https://community.adobe.com/t5/acrobat-discussions/layers-on-pdf-patterns-to-print-only-one-size-which-is-on-the-layers-function/td-p/14034573): sewists deselect sizes and *all* sizes still print; some files ship with no layers at all; and layer controls "are not fully supported on mobile devices". Pattern companies publish workaround posts because of it.
6. **Platform and sync gaps.** Android users are repeatedly locked out (Cora, most quilting apps are iOS-only); Cora has no cross-device sync at all, and its App Store reviewers ask for fractional yardage entry, multi-filter and width filtering. Quiltingboard threads default to [Evernote or Excel purely for cross-platform reach](https://www.quiltingboard.com/mission-organization-f23/fabric-inventory-app-program-t252314.html).
7. **Nothing joins the pieces up.** *"Your inspiration lives in one place, your materials in another, your timeline nowhere"*; Trello "breaks down fast" past ~5 projects; Notion has "poor mobile usability for quick logging" ([Costumary](https://www.costumary.com/blog/sewing-project-planner-tools-2026)).
8. **Duplicate buying** is the recurring stash complaint: *"Now I have 2 'optic' whites"*.
9. **Tiled printing is hated.** *"I'm too old to print a tiled pattern, lay it out on my floor and tape it all together. Not gonna do it!"* ([gather here](https://gatherhereonline.com/pages/pdf-sewing-pattern-printing-letter-size-vs-a0)).

**Design conclusions drawn from complaints 3, 4 and 6:** the module must (a) fill itself from the PDF rather than asking for data entry, (b) never require an account or a network, and (c) stay on the "follow the pattern" job rather than becoming another stash database — the stash niche is crowded and Thready or Not would be the eleventh entrant.

### A.2.3 What people actually track — evidence per item

| Tracked | Evidence | In scope for v1? |
|---|---|---|
| **Which step I am on** | SewGuide checklist; PatternMate marketing; Tales of Cloth's WIP toolkit exists because quilters *"forget what needs to be done next"* and so imagine *"the next job must be huge and boring and difficult"* ([source](https://www.talesofcloth.com/blogs/blog/grab-my-wip-tracking-toolkit)) | **Yes — the core** |
| **Cutting checklist per piece** | Practice, not software: "keep a list handy of what and how many pieces you need to cut", highlight interfacing pieces on the paper pattern ([Closet Core](https://blog.closetcorepatterns.com/clare-sewalong-cutting-interfacing/), [WeAllSew](https://weallsew.com/garment-sew-along-part-2-pattern-cutting-markings-and-fitting/)). Note Beeman argues *against* digitising visible information — so it must be one tap, not a form | **Yes** |
| **Notions shopping list** | Sew Organized's shopping list; Stash Hub notions; Sewing Pattern Buddy's notions field | **Yes** — plus copy-to-clipboard |
| **Size chosen + alterations** | Charlotte Kan's template; an Oliver + S reader annotates each envelope with *"size of pattern traced off; alterations made to draft; child intended…; date the draft traced"* ([source](https://oliverands.com/community/blog/2016/05/tell-us-do-you-keep-a-sewing-journal.html)). Abundant evidence for *free-text* alteration notes; **no app found with structured FBA / lengthen-shorten / sway-back fields** | **Yes** — free text, not a form |
| **Machine settings per fabric** | Beeman records *"stitch length and width for bartacks or topstitching"*; Kan's template carries stitch length and thread colour numbers; community practice is a ["stitch sample book with labeled swatches, recorded settings, and fabric notes"](https://sewingtrip.com/sewing-machine-stitches-library/) plus needle-by-fabric charts. **No app surfaced that stores settings per fabric type** | **Yes** — a small, genuine gap |
| **Fabric stash yardage** | Every stash app; plus Evernote hacks (photo with a 6" ruler for scale) | **No — crowded, out of scope** |
| **Project timeline / photos / makes log** | Start/finish dates, photos, recipient (Oliver + S comments); Threadloop and Sewjo journals; PatternReview reviews; [#sewcialists](https://thesewcialists.com/) sharing | Partly — the existing timer, history, notes and status cover it |
| **Pattern library, paper vs PDF, printed or not** | Explicit fields in Sewing Pattern Buddy and Stash Hub | **No — v2 at the earliest** |
| **Fitting notes per pattern** | Kan's template; Oliver + S journal comments | Folded into alterations |

### A.2.4 Quilting and bag/MYOG specifics

**Quilting** wants *next actions* more than *steps*. [Tales of Cloth's toolkit](https://www.talesofcloth.com/blogs/blog/grab-my-wip-tracking-toolkit) is WIP Stocktake / Next Steps / WIP Notes / daily WIP Tracker. [A Quilting Life readers](https://www.aquiltinglife.com/sew-your-stash-5-essential-tips-for-project-tracking/) track fabric line, thread colour, size and dates, and "check off your progress".

Crucially, **block counts and WOF strip maths live in calculators that are disconnected from any tracker**: [Quilt Geek](https://apps.apple.com/us/app/quilt-geek-quilting-calculator/id6499062474) (binding/backing/batting with a settable default WOF), [Designed to Quilt](https://designedtoquilt.com/fabric-yardage-calculator/) (42" default WOF), [Quilters Retreat](https://www.thequiltersretreat.com/pages/fabric-yardage-calculator) (enter pieces, strip width, or type "WOF"), Robert Kaufman's calculator, QuiltSandwich. **Nothing found links "strips cut / blocks made so far" back to the calculator output.** For an app that already owns a big counting button, "224 flying geese, 96 made" is nearly free and is a real hole in the market.

**Bags / MYOG.** Patterns ship a hardware bill of materials — *"1 Magnetic Snap – 3/4″ (18mm), 4 O-Rings… 1 Swivel Hook – 3/4″, 1 Coordinating Dress Zipper – 8″"* ([Andrie Designs](https://www.andriedesigns.com/beginners-guide-to-sewing-your-first-bag-part-1/), [Sew Yours hardware guide](https://www.sewyours.com/blogs/bag-making-tips-tools-techniques/hardware-essentials-a-guide-to-bag-clasps-zippers-and-rings)) — plus separate exterior/lining/strap quantities and an interfacing-versus-stabiliser choice. Bag makers' documented inventory workaround is **analogue**: a stapled [zipper catalog sheet](https://idleblooms.com/2021/05/21/organize-your-zippers-by-creating-a-zipper-catalog-free-downloads-included/) recording name, size and where purchased "making reordering a breeze", and [pegboard jars for hardware](https://idleblooms.com/2021/04/12/organize-your-handbag-hardware-for-functionality-and-style/). MYOG culture is fabric-spec-heavy ("2.2 oz HEX70 XL") but **no MYOG-specific tracking tool exists** — only [dimension calculators](https://www.myogtutorials.com/).

---

## A.3 Import feasibility with pdf.js

The app already has `PdfText.extract(file, {onProgress})` → `{ text, pages, chars, columnsDetected }` (`js/pdftext.js`), which groups items into lines by Y, untangles two-column pages into left-block-then-right-block, repairs `fi`/`fl` ligature splits, drops page furniture and emits `=== PAGE n ===` markers. That is already ~80% of what a sewing importer needs and should be reused **unchanged**.

### A.3.1 What extracts reliably

| Target | Reliability | Why |
|---|---|---|
| **Numbered construction steps** | **High** (~85% of indie booklets) | Steps start at line-start with `1.`/`Step 1`/`1)`; the existing line-per-printed-line output preserves that |
| **Seam allowance sentence** | **High** | One sentence, fixed vocabulary, always contains the phrase "seam allowance" plus a measurement |
| **Notions list** | **High** | Short bullet lines under a heading from a tiny known set (`NOTIONS`, `SUPPLIES`, `YOU WILL NEED`, `HABERDASHERY`, `HARDWARE`, `MATERIALS`) |
| **Cutting list (bag/quilt)** | **High** | Dimensional, formulaic (`Cut (4) 2½" x WOF`) |
| **Cutting list (garment)** | **Medium** | Often a dot-leader pseudo-table; the leaders collapse to spaces but piece/qty order survives |
| **Pattern meta** (name, designer, version, views) | **Medium** | Cover page has large text with no structural marker; footers repeat `© Designer Name` on every page, which is the more reliable signal |
| **Size chart / finished measurements** | **Low–Medium** | A real table. See below |
| **Fabric requirements by width × size** | **Low–Medium** | Same problem, worse — two header axes |
| **Cutting layout diagrams** | **None** | Vector art |
| **Pattern pieces** | **None** | And should never be attempted — that is the pattern's commercial value |
| **Step diagrams** | **None** as text; recoverable only as page images (A.3.4) |
| **Scanned/photographed patterns** | **None** — no OCR. Fail loudly | |

### A.3.2 Where naive extraction breaks, and the coping strategy

**Two-column layouts.** Already solved for prose by `PdfText`'s gap-band detector (≥14 units of clear vertical space between 30% and 70% of page width, for ≥70% of lines). It reports `columnsDetected`. But note the known failure mode documented for this class of heuristic: *"display equations bridge every candidate column gap"* ([DEV: why browser-based PDF extraction loses table structure](https://dev.to/bonzai2carn/the-empty-quadrant-mapping-the-design-space-of-frontend-pdf-extraction-166g)). The sewing equivalent is a **full-width table or a full-width diagram on an otherwise two-column page** — it bridges the band, the page falls back to single-column, and the two columns interleave line by line. Cope by:
- Keeping `MAX_CROSSING` tolerant (it is already 30%), and
- Making the parser **position-independent**: never rely on line N+1 being the continuation of line N unless it also passes a continuation test (no marker, starts lowercase or with `(`), exactly as `Patterns` already does for wrapped crochet rows.
- Surfacing `columnsDetected` in the import UI so a user who sees garbage knows why.

**Tables.** `getTextContent()` returns positioned runs; the grid has to be inferred, *"which requires heuristics, thresholds, and fails on borderless tables"*, and *"strict point-in-box assignment drops text whose origin is 0.1 px outside a cell"* ([same source](https://dev.to/bonzai2carn/most-pdf-extractors-use-the-wrong-api-heres-what-we-built-instead-5dgh)). Pattern size charts are borderless more often than not. Two coping options:

1. **Row-shape heuristic on the already-flattened text** (recommended for v1, no `pdftext.js` change): find a line whose tokens are ≥3 size labels from a known vocabulary (`XXS XS S M L XL 2X 3X`, `0 2 4 6 …`, `A B C … J`, `34 36 38 40` EU, `6 8 10 12 14`), then treat following lines of the shape `<label> <n> <n> <n> …` with matching arity as chart rows. Robust because a flattened table row *is* still one line in `PdfText` output (items on the same baseline are joined with a space).
2. **A `PdfText.extractTables()` sidecar** (v2 if v1's hit rate disappoints): re-run `getTextContent` and cluster item `transform[4]` x-origins into columns per page region. Keep it out of `pdftext.js`'s main path so the crochet importer is untouched. `getStructTree()` is the theoretically correct API but tagged PDFs are rare in this corner of publishing — do not depend on it, but it is free to try and fall back.

**Other concrete breakages and mitigations:**

| Breakage | Mitigation |
|---|---|
| Dot leaders: `Front Bodice . . . . . . . . Cut 2` | Collapse runs of `.`/`·`/`…`/`—` of length ≥3 to a single separator before matching |
| Inch glyph chaos (`"` `”` `''` `in`) | Normalise all to `"` in a pre-pass |
| Unicode vs ASCII fractions (`½` vs `1/2` vs `2-1/2`) | Normalise `¼½¾⅛⅜⅝⅞⅓⅔` to ASCII; treat `2-1/2` as `2 1/2` |
| Steps restarting at 1 per section | Track `(section, n)`; open a new section on a decrease, exactly as `Patterns` does for crochet rows |
| Step number that is really a measurement (`1.5 cm`, `2. 5 mm`) | Require the marker to be followed by whitespace then a letter, and reject when the rest of the line begins with a unit |
| Booklets with **no** numbered steps | Detect and fall back to a page-segmented step list (one step per paragraph run), with a warning |
| Ligature splits (`fi nished`, `stuf fi ng`) | Already handled by `PdfText` |
| `=== PAGE n ===` markers | Keep them — they give every step a `page` number for free, which is exactly what the step viewer needs |

### A.3.3 Expected hit rate

Based on the format survey, a tolerant rule-based parser should land roughly at: **steps 85%**, **seam allowance 90%**, **notions 75%**, **cutting list 65%** (garment) / **85%** (bag, quilt), **size chart 50%**, **fabric requirements 40%**. That is enough for the "drop a PDF and immediately have the info" promise *provided* every extracted block is editable, and provided the import sheet shows counts before applying so the user can uncheck a group that came out wrong. Do not chase 100%; chase "never silently wrong".

### A.3.4 Page images: worth it, but not in v1

pdf.js can render a page to a canvas (`page.render({ canvasContext, viewport })`). At `scale: 1.5` an A4 page is ~1240×1754; `canvas.toBlob('image/jpeg', 0.75)` gives roughly **120–350 KB per page**, so a 20-page booklet is **3–7 MB** and a 40-page one is up to ~14 MB.

- **localStorage is out.** It is ~5 MB per origin on iOS Safari and the whole app state already lives there; a single booklet would blow it, and in Private Browsing writes throw `QuotaExceededError` immediately ([Bugnet](https://bugnet.io/blog/fix-html5-game-localstorage-quota-exceeded-on-safari-ios)).
- **IndexedDB is the right store.** Since Safari 17 the overall per-origin quota is *"up to 80% of the total disk space"* for browser apps ([WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)), and Chrome/Firefox are similar or more generous ([MDN quotas & eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)).
- **Eviction is the real risk.** WebKit deletes script-created storage for origins with *"no user interaction… in the last seven days of browser use"*. Mitigate by calling `navigator.storage.persist()` and by leaning on the fact that the app is already a home-screen PWA (installed web apps are treated as persistent). Still: **page images must be a cache, never the source of truth.** The steps' text lives in localStorage; images are a bonus that can vanish.

**Verdict:** worth building, in phase 6. It turns "step 12 of 34" into something a sewist can actually follow without the laptop, because the diagram *is* the instruction for half of all steps. Design it as: opt-in checkbox in the import sheet ("Keep the pages so you can see the diagrams"), render **lazily** (only when the user first taps the page chip on a step), cap at 40 pages, store JPEG blobs keyed `{projectId, page}`, display via `URL.createObjectURL` and revoke on close, delete the project's images when the project is deleted.

---

## A.4 Sample pattern PDFs for parser fixtures

**All of these are copyrighted, personal-use-only material.** None may be committed, vendored, redistributed or checked in. `tmp-pdf/` is already in `.gitignore` — keep it that way and put a `tmp-pdf/SOURCES.md` (also gitignored) listing where each file came from. Silence about redistribution in a publisher's terms is not permission; copyright defaults to all-rights-reserved.

The owner downloads these themselves. Five need no signup; three are gated behind an email address or a free account.

| # | Pattern | Landing page | Direct PDF? | What it demonstrates |
|---|---|---|---|---|
| 1 | **Peppermint Magazine** instruction booklets (by In the Folds and others) — Tansey Top, Belle Shirt, West End Jacket | https://peppermintmag.com/pattern-instructions/ | **Yes**, public, e.g. `…/uploads/2026/01/PEPPERMINT-TanseyTop-INSTRUCTIONS.pdf` | The **separate instruction booklet** case (12–20 pp). Australian **metric**. Professionally typeset: size chart, finished measurements, fabric requirements table by size, notions, stated seam allowance, numbered steps. The single best all-round garment fixture. |
| 2 | **Riley Blake Designs** free quilt patterns — Misty Morning, Color My World, Little Things | https://www.rileyblakedesigns.com/free-quilt-patterns | **Yes**, public, e.g. `…/freepatterns/quiltpatterns/MistyMorningFreePattern.pdf` | The **quilting WOF cutting chart**. Real strings include `7 strips 4½" x WOF` and `10 strips 2½" x width of fabric` **in the same document** — abbreviation vs spelled-out is a genuine edge case. Unicode fractions, imperial only, 2–6 pp. |
| 3 | **Robert Kaufman / Noodlehead — Forage Bag** | https://www.robertkaufman.com/quilting/quilts_patterns/forage_bag/ | **Yes**, public: `https://www.robertkaufman.com/assets/pdf/ForageBag.pdf` | The **bag hardware + interfacing** case: grommets, 8" and 6" zippers, leather pulls, fusible interfacing by type. Two sizes (regular/mini) means requirements that branch by view. Combined instructions + templates. |
| 4 | **Sew Sweetness — Baker Street Bag** | https://sewsweetness.com/2015/01/free-pattern-baker-street-bag.html | **Yes**, public: `…/uploads/2015/01/PATTERN-Baker-Street-Bag-1.pdf` | **11 stated pages**, 26 photo-illustrated steps → stresses reading order with images interleaved. Branded interfacing list (Soft and Stable, Pellon SF-101) and `2-1/2 yards` — a hyphenated mixed number. |
| 5 | **Suzy Quilts — Duval Star** | https://suzyquilts.com/free-duval-star-quilt-pattern/ | **Yes**, public: `…/uploads/2023/08/DuvalStarPattern.pdf` | Modern indie quilt: **fat-quarter-based** requirements (20 FQ) rather than WOF yardage, so it contrasts with #2. Finished sizes as parseable dimensions, `Fig. 1` references, repeated-unit counts (224 flying geese). |
| 6 | **Helen's Closet — Horizon Tank** | https://helensclosetpatterns.com/collections/free-patterns | No — **email signup** | The **wide size-chart table**: sizes 0–34, 33"–62" hip. Mixes imperial body measurements with metric yardage in one document. Stretch-percentage fabric requirement. Long, high-quality separate booklet (20–30 pp). |
| 7 | **Mood Sewciety — The Wren Shirt (MDF300)** | https://blog.moodfabrics.com/the-wren-shirt-free-sewing-pattern/ | No — **email + verification** | `Step 1` heading style as a contrast to `1.`; per-view materials lists; inch written as `''` (two apostrophes); and a **seam allowance with an exception clause**: *"All seams are ½'' besides the collar and the neckline, which are sewn at ⅜''"*. Note the steps live on the **HTML page**, not the PDF. |
| 8 | **Fabrics-Store** free linen patterns — Phoebe Tank, Monique Tee | https://fabrics-store.com/sewing-patterns | No — **free account** | Dual A4 + US-Letter tiling in one file; a large catalogue of consistently-templated documents, useful for checking the parser generalises rather than overfits. *Unverified* — the site blocked automated fetches; confirm manually. |

**Recommended minimum fixture set: 1, 2, 3, 4, 7.** That covers separate-vs-combined PDFs, metric vs imperial, `1.` vs `Step 1`, a WOF quilting chart, bag hardware/interfacing, a photo-heavy layout and a seam-allowance exception clause — and four of the five need no signup. Add 6 for the wide size chart, which nothing else covers.

---

# Part B — Proposed spec

## B.0 Design principles

**Positioning, from A.2:** the stash/pattern-library niche has ten competent entrants and does not need an eleventh. The *"which step am I on"* niche has **none** for sewing, quilting or bag-making, even though cross-stitch has Pattern Keeper and knitting/crochet have row counters. Build the step counter, not the stash database. Fill it from the PDF, because manual entry is the documented number-one adoption blocker.

1. **The crochet code is not touched.** `js/patterns.js`, `js/diagram.js`, `js/celebrate.js` get zero edits. `js/app.js` and `js/store.js` get small, generic, craft-agnostic additions only.
2. **One new global per file**, IIFE, `'use strict'`, no build step, no ES modules — same as everything else.
3. **The parser is pure.** `window.Sewing` touches no DOM and no storage, so it is unit-testable in `test/sewing.test.html` exactly like `Patterns`.
4. **Nothing is silently wrong.** Every parsed block is shown with a count before it is applied, and everything is editable afterwards.
5. **Phone-first, 375 px.** Same CSS variables, same six themes, no new theme variables.

## B.1 The craft plugin hook

### B.1.1 Data

```js
Project.craft = 'crochet' | 'crossstitch' | 'sewing'   // default 'crochet'
Project.craftData = object | null                       // craft-owned payload, opaque to store.js
Template.craft = 'crochet' | ...                        // default 'crochet'
Template.craftData = object | null                      // seeded into new projects
```

Migration in `Store.normalizeProject`: `p.craft = KNOWN_CRAFTS[p.craft] ? p.craft : 'crochet'`. Every existing save silently becomes a crochet project. `normalizeTemplate` does the same. Export/import already round-trips whole project objects, so backups keep working with no change to `exportJSON`/`importJSON`.

`store.js` never inspects `craftData`. It only:

```js
Store.registerCraftData(craftId, { empty(): object, normalize(data): object })
Store.craftData(projectOrId) -> object            // normalised, created on demand
Store.updateCraft(projectId, mutator) -> Project  // pushUndo(); mutator(data, project); touch(); save()
```

`updateCraft` is the single mutation door. Because it calls the existing `pushUndo()` deep-copy snapshot, **undo works for sewing for free**, as do the `updatedAt` bump, the debounced save and the `visibilitychange` flush.

### B.1.2 UI hook

```js
App.registerCraft({
  id: 'sewing',
  name: 'Sewing',
  emoji: '🪡',
  emojiSet: ['🪡','🧵','👗','👚','👖','🧥','👜','🎒','🧶','🛏️','✂️','📐','🧷','🪢','🌸'],

  // Home screen
  summary(project) -> string,          // replaces projectSummary() for this craft
  cardBadge(project) -> string|null,   // optional extra pill, e.g. "12 of 34 steps"

  // Project screen — renders into the generic craft screen host
  renderProject(project, host),
  teardownProject(),                   // called when leaving the screen

  // Overflow menu additions (merged with the generic items)
  menuItems(project) -> [{ id, label, icon, onSelect(project) }],

  // Import
  importSheet(projectId, initialText),  // full replacement for openImportSheet

  // Optional
  onProjectCreated(project),
  supportsDiagram: false                // App skips Diagram.mount entirely
})

App.craft(id) -> def | null
App.crafts() -> def[]                   // registration order
App.dom = { el, button, textInput, on, clear }   // existing private helpers, exposed
```

`host` passed to `renderProject`:

```js
host = {
  screen, body, bottombar,        // DOM: #screen-craft, #craft-body, #craft-bottombar
  setTitle(emoji, name),
  render(),                        // ask App to re-render the current screen
  toast(msg, opts), confirmSheet(opts), openSheet(opts), closeAllSheets(),
  goHome(), openProjectEditor(projectId),
  Store, Feedback, Celebrate, Tour,
  dom: App.dom
}
```

### B.1.3 index.html changes

One new generic screen, used by **every** non-crochet craft (this is what keeps the hook compatible with the cross-stitch proposal):

```html
<section id="screen-craft" class="screen" aria-label="Project" hidden>
  <header class="topbar">
    <button type="button" id="c-back" class="icon-btn" aria-label="Back to projects">‹</button>
    <button type="button" id="c-title" class="title-btn">
      <span id="c-emoji" class="title-emoji"></span>
      <span id="c-name" class="title-name"></span>
    </button>
    <button type="button" id="c-timer" class="chip timer-chip">0:00:00</button>
    <button type="button" id="c-menu" class="icon-btn" aria-label="Project menu">⋯</button>
  </header>
  <main class="screen-body craft-body" id="craft-body"></main>
  <nav class="bottombar" id="craft-bottombar" aria-label="Project tools"></nav>
</section>
```

Script order in `index.html` (both new files after `store.js`, before `app.js` is fine because registration happens at `App.init`; simplest is after `app.js` since `app-sewing.js` calls `App.registerCraft` at load and `App` is a plain global):

```html
<script src="./js/sewing.js"></script>       <!-- pure logic -->
<script src="./js/app-sewing.js"></script>   <!-- after app.js -->
<link rel="stylesheet" href="./css/sewing.css">
```

`App.render()` router change — about ten lines, the only structural edit to `app.js`:

```js
function render() {
  var p = currentProject();
  var def = p ? App.craft(p.craft) : null;   // null for 'crochet'
  if (p && def) { showOnly(els.craft); renderCraftProject(p, def); }
  else if (p)   { showOnly(els.project); renderProject(p); }
  else          { showOnly(els.home); destroyLiveDiagram(); renderHome(); }
  syncWakeLock();
}
```

`projectCard()` gains one line: `var def = App.craft(p.craft); var text = def && def.summary ? def.summary(p) : projectSummary(p);`.
`openImportSheet()` gains one line at the top: `var def = App.craft(p.craft); if (def && def.importSheet) return def.importSheet(projectId, initialText);`.
New-project sheet: the template picker filters by the craft chosen in a new **Craft** segmented control at the top (Crochet / Cross-stitch / Sewing), shown only when `App.crafts().length > 0`.

Bump `CACHE_VERSION` in `sw.js` and precache `./js/sewing.js`, `./js/app-sewing.js`, `./css/sewing.css`.

## B.2 Sewing data model

`Project.craftData` when `craft === 'sewing'`:

```js
SewingData = {
  meta: {
    designer: string,        // 'Peppermint Magazine'
    patternName: string,     // 'Tansey Top'
    version: string,         // 'v2' | ''
    view: string,            // 'View A' | ''
    url: string              // user-entered link back to the shop page
  },

  size: {
    chosen: string,          // 'M' | '12' | 'E'
    sizeLabels: string[],    // ['XS','S','M','L','XL'] — from the parsed chart, or []
    alterations: string      // free text: 'FBA 2.5 cm, lengthened bodice 3 cm, sway back 1 cm'
  },

  measurements: {
    body:     [{ label: 'Bust',  values: string[] }],   // values align to sizeLabels
    finished: [{ label: 'Bust',  values: string[] }],
    mine:     [{ label: 'Bust',  value: '96 cm' }]      // the user's own, entered once, reused
  },

  fabric: [
    { name: 'Main fabric', width: '150 cm', amounts: string[], note: '' }   // amounts align to sizeLabels
  ],

  notions: [ { id, text: '1 x 20 cm invisible zip', qty: 1, have: false } ],

  cutting: [
    { id, piece: 'Front Bodice', qty: 2, cutCount: 0,
      material: 'main'|'lining'|'interfacing'|'contrast'|'batting'|'other',
      onFold: false, grain: '', note: '(1 pair)', dims: '' }
  ],

  steps: [
    { id, n: 1, section: 'Construction', text: 'With RST, sew the shoulder seams…',
      done: false, page: 6, imageRef: null }
  ],
  currentStep: 0,            // index into steps

  units: [ { id, name: 'Flying geese', target: 224, done: 96 } ],   // quilt block counters (B.4.5)

  seamAllowance: {
    text: 'Seam allowance is 1.5 cm (5/8") unless otherwise noted',
    mm: 15, inches: '5/8',
    exceptions: [ { text: 'collar and neckline are sewn at 3/8"', mm: 10 } ]
  } | null,

  machine: {
    needle: '80/12 universal', thread: 'Gütermann Sew-All 800',
    stitchLength: '2.5', tension: '4', presserFoot: 'standard',
    notes: ''
  },

  sourceText: string,        // the full extracted PDF text, kept so it can be re-parsed or read
  warnings: string[]
}
```

### B.2.1 How the cutting list maps onto the existing Part idea

The mapping is exact and worth stating, because it is why this belongs in this app:

| Crochet `Part` | Sewing cutting entry |
|---|---|
| `name` — 'Wing' | `piece` — 'Front Bodice' |
| `makeCount` — 2 | `qty` — 2 |
| `piecesDone` — 1 | `cutCount` — 1 |
| tab badge `1/2` | chip `1 of 2 cut` |
| `pieceDone` event → small `Celebrate` burst | same event, same burst |
| all parts done → `projectDone` | all pieces cut → "Everything's cut ✂️" milestone |

**Recommendation: keep `cutting` as its own array in `craftData`, not as real `Part` objects.** A `Part` also carries `row`, `stitch`, `targetRows`, `repeat`, `alerts`, `rowStitches`, `patternText` — nine dead fields per cut piece, all of which `normalizePart`, `diagramModel`, `linesFor` and the tab renderer would keep touching. Instead: give a sewing project exactly **one** `Part` named `Main` so every piece of existing project-level machinery (export, history, timer, status, checklist) keeps working untouched, and mirror the *vocabulary* (`qty`/`cutCount` ≡ `makeCount`/`piecesDone`) so the two crafts read the same way in code and in the UI.

Similarly, **steps map onto rows**: `steps[i].done` is the row counter, `currentStep` is `part.row`, and the "Step done ✓" button is the big tap button. But the sewing module owns that state in `craftData` rather than reusing `tapRow`, because `tapRow` also drives stitch targets, repeats, `rowStitches` and the 3D diagram. The *interaction* is reused; the *state machine* is not.

## B.3 Import flow and the parser contract

### B.3.1 Flow

```
PDF file
  → PdfText.extract(file, {onProgress})      [unchanged, reused as-is]
  → { text, pages, chars, columnsDetected }
  → Sewing.parse(text, { units: 'auto'|'metric'|'imperial' })
  → SewingParse                               [review UI: counts per group, checkboxes]
  → Sewing.toCraftData(parse, existing?)      [merge into Project.craftData]
  → Store.updateCraft(projectId, …)
```

### B.3.2 `window.Sewing` API

```js
Sewing.parse(text, opts?) -> SewingParse
// opts = { units: 'auto'|'metric'|'imperial' (default 'auto'),
//          craftHint: 'garment'|'bag'|'quilt'|null (default null → auto-detect) }

SewingParse = {
  meta:         { designer, patternName, version, views: string[] },
  sizes:        { labels: string[], chart: MeasureRow[], finished: MeasureRow[] } | null,
  fabric:       FabricRow[],
  notions:      NotionRow[],
  cuttingList:  CutRow[],
  steps:        StepRow[],
  seamAllowance: { text, mm: number|null, inches: string|null,
                   included: boolean|null, exceptions: [{text, mm}] } | null,
  kind:         'garment'|'bag'|'quilt'|'unknown',
  pages:        number,
  warnings:     string[]
}

MeasureRow = { label: string, values: string[] }          // values.length === sizes.labels.length
FabricRow  = { name: string, width: string, amounts: string[], note: string, line: string }
NotionRow  = { text: string, qty: number|null, kind: 'notion'|'hardware'|'interfacing', line: string }
CutRow     = { piece: string, qty: number, material: string, onFold: boolean,
               grain: string, dims: string, note: string, line: string }
StepRow    = { n: number, section: string, text: string, page: number|null, marker: '1.'|'Step'|'1)'|'none' }

// exposed for tests and for reuse by the UI
Sewing.normalizeText(text) -> string         // glyph/fraction/leader normalisation
Sewing.parseSteps(lines) -> StepRow[]
Sewing.parseCutting(lines) -> CutRow[]
Sewing.parseNotions(lines) -> NotionRow[]
Sewing.parseSeamAllowance(text) -> object|null
Sewing.parseSizes(lines) -> object|null
Sewing.toCraftData(parse, existing?) -> SewingData
Sewing.templates() -> Template[]             // the three built-in sewing templates
```

**Invariants:** never throws (wrap every block in try/catch and push a warning instead); always returns every key, empty array rather than null, except `sizes`/`seamAllowance` which may be `null`; input of `''` returns an empty parse with one warning.

### B.3.3 Parsing rules

**Pre-pass — `normalizeText`** (run before anything else, and unit-test on its own):
- `”“„` → `"`, `’‘` → `'`, `''` (two apostrophes) → `"`, `″` → `"`, `′` → `'`
- `¼½¾⅛⅜⅝⅞⅓⅔` → `1/4 1/2 3/4 1/8 3/8 5/8 7/8 1/3 2/3` (with a leading space if glued to a digit: `4½` → `4 1/2`)
- `2-1/2` → `2 1/2`
- Runs of `.·…–—_` of length ≥3 → ` — ` (dot leaders)
- `–—` → `-` elsewhere; collapse runs of whitespace
- Keep `=== PAGE n ===` markers intact; the parser tracks the current page from them.

**Steps.** A line is a step marker when, after trimming bullets `-*•`:
```
/^(?:step\s*)?(\d{1,3})\s*[.)\]:\-–]\s+(?=\S)/i      →  '1. ' '1) ' '01: ' 'Step 1 - '
/^step\s+(\d{1,3})\b/i                                →  'Step 1'  'STEP 12'
```
Rejected when: the remainder starts with a unit (`cm|mm|m|in|inch|"|yd|yard|yds`), the line looks like a measurement (`^\d+\.\d`), the line is inside a cutting/notions/fabric block, or the number is > `lastN + 12` (a stray figure reference). Section restart: if `n <= lastN`, open a new step section named from the most recent heading. Continuation: subsequent lines merge into `text` until the next marker, heading, page marker or a blank-ish separator; cap merged text at 800 chars and note the overflow. `page` = the page of the marker line. `marker` records which style matched, so the UI can say "34 steps found (Step N style)".

**Headings** (reuse the `Patterns` heuristic, retuned): ≤ 48 chars, no sentence-final punctuation, and either ALL CAPS or Title Case. Recognised block headings drive the block parsers:
```
CUT:        CUTTING | CUTTING INSTRUCTIONS | CUTTING LIST | CUT YOUR FABRIC | PATTERN PIECES | FROM <FABRIC NAME>
NOTIONS:    NOTIONS | SUPPLIES | YOU WILL NEED | WHAT YOU NEED | HABERDASHERY | HARDWARE | MATERIALS | TOOLS
FABRIC:     FABRIC | FABRIC REQUIREMENTS | FABRIC SUGGESTIONS | YARDAGE | REQUIREMENTS
SIZE:       SIZE CHART | SIZING | BODY MEASUREMENTS | FINISHED (GARMENT) MEASUREMENTS | MEASUREMENTS
STEPS:      CONSTRUCTION | INSTRUCTIONS | SEWING INSTRUCTIONS | LET'S SEW | ASSEMBLY | BLOCK ASSEMBLY |
            QUILT TOP ASSEMBLY | FINISHING | HEM | VIEW A | VIEW B
```
A block ends at the next recognised heading, at a step marker, or after 60 lines.

**Cutting list.** Match in this order, first hit wins:
```js
// 1.  'Front Bodice — Cut 2 on the fold, main'   /  'Front .... cut 1'
/^(.{2,48}?)\s*(?:—|-|:)?\s*\bcut\s*(\d{1,3})\b(.*)$/i
// 2.  'Cut 2 - 14" x 16" from exterior'  /  'Cut (4) 2 1/2" x WOF strips'
/^cut\s*\(?(\d{1,3})\)?\s*[-–—]?\s*(.*)$/i
// 3.  '2 x Front (main)'  /  'Pocket bag x4 lining'
/^(\d{1,3})\s*[x×]\s*(.{2,48}?)(?:\s*[-–—(](.*))?$/i
/^(.{2,48}?)\s*[x×]\s*(\d{1,3})\b(.*)$/i
// 4.  quilting: '7 strips 4 1/2" x WOF'  /  '10 strips 2 1/2" x width of fabric'
/^\(?(\d{1,3})\)?\s+strips?\s+(.+?)\s*[x×]\s*(?:WOF|width of fabric)\b(.*)$/i
// 5.  quilting subcut: 'Subcut into (64) 4 1/2" squares'
/^sub-?cut\s+(?:into\s+)?\(?(\d{1,4})\)?\s*(.*)$/i
```
Flags pulled from the remainder:
- `onFold` ← `/\bon (the )?fold\b/i`
- `material` ← first match of `main|self|shell|outer|exterior|fashion fabric` → `main`; `lining` → `lining`; `interfacing|interlining|fusible|SF-?101|shape ?flex|soft and stable|fusible fleece|foam` → `interfacing`; `contrast|CB|accent|binding` → `contrast`; `batting|wadding` → `batting`; `background|fabric [A-H]\b` → `other` with the label kept in `note`
- `grain` ← `/\bon the bias\b|\bbias\b|\bcrosswise\b|\blengthwise\b|\bgrainline\b|\bmirror(ed)?\b|\breverse[d]?\b/i`
- `dims` ← `/(\d[\d \/]*)\s*(?:"|in|cm)?\s*[x×]\s*(\d[\d \/]*)\s*(?:"|in|cm)?/`
- `note` ← anything in parentheses: `(1 pair)`, `(interfacing)`
- Quilting rows 4/5: `piece` becomes `"4 1/2\" x WOF strip"` / `"4 1/2\" square"` and `material` comes from the nearest preceding `From Fabric A,` line.

**Notions.** Inside a NOTIONS/HARDWARE block: every non-heading line of 3–90 chars becomes a row. Anywhere else: a line is a notion when it matches the vocabulary
```
thread | zip | zipper | invisible zip | separating zip | button | snap | magnetic snap |
press stud | hook and eye | bra hook | elastic | bias binding | bias tape | twill tape |
interfacing | fusible | webbing | D-ring | O-ring | rectangle ring | swivel hook | swivel clasp |
triglide | slider | rivet | grommet | eyelet | drawstring | cord | cord stop | toggle | velcro |
hook-and-loop | boning | shoulder pad | label | batting | wadding | basting spray | safety pins |
walking foot | zipper foot | needle | rotary blade
```
`qty` ← leading `2 x`, `(2)`, `two`, `1 -`, or a trailing `x2`. `kind` ← `hardware` for the ring/hook/rivet/grommet family, `interfacing` for the interfacing family, else `notion`.

**Seam allowance.** Scan the whole text for sentences containing `seam allowance`:
```js
/seam allowances?\s*(?:is|are|of|:)?\s*([\d \/.]+)\s*(cm|mm|in|inch|inches|")/i
/\(([\d \/.]+)\s*(cm|mm|in|inch|inches|")\)/                       // the dual-unit bracket
/seam allowances?\s+(?:are|is)\s+(included|not included)/i
/unless otherwise (?:noted|stated|specified|indicated)/i
```
Capture `mm` (converting inches ×25.4; `5/8"` → 15.875 → round to 16, but keep the literal `inches` string for display). Any *later* sentence that also names a seam allowance and contains `except|besides|apart from|other than|at the` becomes an `exceptions` entry — this is the Mood Wren case. If no match: `null`, plus warning `"No seam allowance found — check the pattern."` If `kind === 'quilt'` and none found, default to `{mm: 6, inches: '1/4', text: 'Quilting standard — 1/4"'}` with a warning saying it was assumed.

**Sizes.** Find a **header line**: ≥3 tokens, all from the size vocabulary, in one of the families `XXS XS S M L XL XXL 1X 2X 3X 4X 5X` / `0 2 4 … 34` / `A B C … J` / `6 8 10 … 30` / `32 34 … 52` (EU), monotonic where numeric. Then, for following lines (max 12): split on whitespace, take the leading word run as `label` and require the remaining numeric tokens to number exactly `labels.length`; otherwise stop. Label normalisation: `Bust/Chest`, `Waist`, `Hip/Hips`, `Height`, `Back length`, `Inseam`, `Sleeve length`, `Upper arm`, `Neck`. A second such table after a heading containing `finished` populates `finished` instead of `chart`. On failure: `sizes = null` + warning.

**Fabric requirements.** Inside a FABRIC block, a line containing a width (`115 cm`, `150cm`, `45"`, `60 inch`) starts a `FabricRow`; per-size amounts are the numeric-with-unit tokens on that line (or the next line). If the amounts count ≠ `labels.length`, keep the raw `line` and set `amounts: []` — the UI shows the raw line, which is still useful.

**Kind detection.** `quilt` when ≥2 of {WOF, `strips`, `binding`, `backing`, `batting`, `fat quarter`, `block`}; `bag` when ≥2 of {`lining`, `interfacing`, `D-ring`, `swivel`, `magnetic snap`, `zip`, `strap`, `gusset`}; else `garment` if a size chart or `bodice|sleeve|hem|dart` is found; else `unknown`.

### B.3.4 Edge cases the build agent must handle

| Case | Required behaviour |
|---|---|
| No numbered steps at all | `steps = []`, warning `"No numbered steps found — the text was kept so you can add steps yourself."` Import still applies everything else and sets `sourceText`. |
| Steps restart at 1 in each section | New `section`, `n` restarts; the UI numbers them 1..N globally and shows the section name. |
| Two views (A/B) both numbered from 1 | `views` in meta; steps get `section: 'View A'`; the size/view picker filters the step list. |
| A step marker inside a cutting block | Cutting block wins; step parsing resumes after the block. |
| `1.5 cm` at line start | Rejected by the unit look-ahead. |
| Scanned PDF (no text layer) | `PdfText` already returns near-zero `chars`; if `chars < 200` show the existing "it may be scanned images" toast and do not call `Sewing.parse`. |
| Two-column bleed produced interleaved nonsense | Steps come out non-monotonic; if > 40% of candidate markers are rejected for non-monotonicity, add warning `"This PDF's columns may be interleaved (N columns detected) — check the steps."` |
| Duplicate cutting rows from a repeated header/footer | De-duplicate by `piece.toLowerCase() + qty + material`. |
| Booklet with 300 "steps" (figure captions misread) | Cap at 200 steps and warn. |
| Metric + imperial in one document | Keep both strings verbatim; only `seamAllowance.mm` is normalised. Never convert user-facing text. |
| Re-import over an existing project | `toCraftData(parse, existing)` merges: steps/cutting/notions are **replaced** only for groups the user checked; `done`/`have`/`cutCount` flags are preserved by matching on normalised text, and `size`, `alterations`, `machine`, `meta.url` are never overwritten. |

### B.3.5 Fixture strategy

Mirror the crochet setup exactly:

- **`test/sewing.test.html`** — committed, synthetic snippets only. Same harness shape as `test/patterns.test.html` (`log/group/deepEqual`, pass/fail counts, `<script src="../js/sewing.js">`). Target ~200 assertions covering: `normalizeText` glyph/fraction/leader cases; each step marker style and each rejection; every cutting regex family including the quilting pair; notion qty forms; all four seam-allowance shapes plus the exception clause; size-chart detection and arity mismatch; kind detection; every edge case in the table above; and `toCraftData` merge semantics.
- **`test/sewing.fixtures.html`** — committed page, reads `.txt` files from the gitignored `tmp-pdf/`. Assertions are *shape* assertions (`steps.length >= 25`, `cuttingList` contains a piece named `Front`, `seamAllowance.mm === 15`), never verbatim pattern text, so the committed file contains no copyrighted material. Skip gracefully with "fixture not present" when a file is missing, so CI and a fresh clone stay green.
- **`tmp-pdf/`** — stays gitignored. Add `tmp-pdf/SOURCES.md` (gitignored) from the A.4 table so the owner can re-fetch. Extract `.txt` via the existing `tmp-pdf/extract.html` or in-app `PdfText`.

### B.3.6 What is reused from the crochet side

| Asset | Verdict |
|---|---|
| `PdfText.extract` | **Reused unchanged.** Zero edits to `js/pdftext.js`. |
| `PdfText` column untangling, ligature repair, page markers, furniture dropping | Reused, and directly valuable — the `=== PAGE n ===` markers become `StepRow.page`. |
| `Patterns.parse` | **Not reusable.** Its vocabulary is crochet stitches. |
| `Patterns`' *techniques* — line-marker regex family, section-restart-on-decrease, wrapped-line continuation test, note-paragraph merging, header heuristics | **Copied as design, reimplemented in `sewing.js`.** Do not import; the two must be free to diverge. |
| `Store.suggestChecklist` | **Not reused.** Its `CHECKLIST_START_RE` is crochet assembly vocabulary, and for sewing the parsed *steps* already are the checklist — a second derived checklist would be noise. Leave the function untouched. |
| `Store` undo / save / export / import / timer / status / notes / history | **Reused in full** via `Store.updateCraft`. |
| `Store.templates()` and the template editor | Reused, with `Template.craft` filtering. |
| `App.openSheet`, `confirmSheet`, `toast`, theme system, `Celebrate`, `Tour` engine | **Reused in full.** |
| `Diagram` | **Not used.** `supportsDiagram: false` → no canvas mounted, Settings' "Live diagram" toggle stays crochet-only. |

## B.4 Screens

All at 375 px, existing CSS variables only, `css/sewing.css` adds layout classes prefixed `sw-`.

### B.4.1 Sewing project screen (`#screen-craft`)

```
┌────────────────────────────────────┐
│ ‹   🪡 Tansey Top     0:42:10   ⋯  │   topbar (reused, timer reused)
├────────────────────────────────────┤
│ ▓▓▓▓▓▓▓░░░░░░░  Step 7 of 34 · 21% │   sw-progress  (tap → Steps sheet)
├────────────────────────────────────┤
│  STEP 7            Construction    │
│  ┌──────────────────────────────┐  │
│  │ With right sides together,   │  │   sw-step-card
│  │ pin the front to the back at │  │   text scrolls if long
│  │ the shoulder seams and stitch│  │
│  │ at 1.5 cm. Press the seam    │  │
│  │ allowances towards the back. │  │
│  └──────────────────────────────┘  │
│  📄 page 6        SA 1.5 cm (5/8") │   sw-step-meta
│                                    │
│  ┌──────────────────────────────┐  │
│  │                              │  │
│  │        Step done ✓           │  │   .stitch-btn reused, min-height 26vh
│  │                              │  │
│  └──────────────────────────────┘  │
│        ↺ back a step               │
├────────────────────────────────────┤
│ 📏 Size M · FBA 2.5 cm        edit │   sw-size-strip
│ ✂️ 4 of 12 pieces cut              │   sw-mini rows, tap → sheets
│ 🧷 2 of 7 notions ready            │
├────────────────────────────────────┤
│  ↶ Undo   ☀ Awake   ✂️ Cut  🧷 Notions │  bottombar
└────────────────────────────────────┘
```

- The **"Step done ✓"** button reuses `.stitch-btn` (pointerdown-to-fire, 12 px move cancel, press state, `Feedback.row()` haptic) but at `min-height: 26vh` rather than 45vh, because the step text needs the room. On tap: mark done, advance `currentStep`, `Celebrate.play(theme, {kind:'piece'})` every 10th step, `Celebrate.play(theme, {kind:'project'})` on the last step plus the existing finished-project sheet.
- **↺ back a step** is `Store.undo()` — the generic undo already covers it.
- Reduced-motion and the live region (`"Step 8 of 34"`) behave exactly as the crochet counter does.

### B.4.2 Sheets

**Steps sheet** — full list, grouped by section, each row: number, first ~70 chars, checkbox, page chip. Tapping a row jumps `currentStep` (with a confirm if it moves backwards past done steps, mirroring the pattern sheet's jump-to-row confirm). Header: "7 of 34 done". Footer: "＋ Add step", "Clear all done".

**Cutting sheet** — grouped by `material` with a header per group (`Main fabric · 6 pieces`). Each row: a tap-to-cycle counter chip `0/2 → 1/2 → 2/2 → 0/2`, piece name, `on fold` pill, grain note, dims. Header progress `4 of 12 pieces cut`. Per-group "Cut all". Add / rename / delete / reorder with the same controls as the checklist sheet. When every piece is cut: toast "Everything's cut ✂️" + small celebrate burst.

**Notions sheet** — have/need checkboxes, qty, free-text add. A **"Copy shopping list"** button that puts the un-had items on the clipboard (`navigator.clipboard.writeText`, with a `navigator.share` path on mobile) — this is the single most-requested thing sewists ask software for and it costs almost nothing.

**Size & measurements sheet** — size picker (chips from `sizeLabels`), a horizontally scrollable size-chart table with the chosen column highlighted, a Body/Finished toggle, a "my measurements" column the user fills in once (stored in `Settings`, not the project, so it is reused across projects), an auto-computed **ease** row when both body and finished exist for the chosen size, and an **Alterations** textarea seeded with a hint (`FBA, lengthen/shorten, sway back…`).

**Fabric sheet** — the parsed requirement rows plus the raw lines that failed to parse, and a free-text "what I actually used" field.

**Machine settings sheet** — needle, thread, stitch length, tension, presser foot, notes. Plus **presets**: `Settings.sewingPresets: [{ id, name: 'Knit jersey', needle: '75/11 stretch', … }]`, "Save these as a preset" / "Load a preset". Sewists rewrite these settings on a sticky note for every fabric; storing them per project *and* as reusable presets is the useful shape.

**Notes sheet / Status sheet / History sheet / Export** — the existing generic sheets, unchanged.

### B.4.3 Import sheet variant

Same drop zone, same progress line, same "Read 14 pages · 2 columns untangled · 31,402 characters" result line. Below it, instead of the sections list, a **review list** of collapsible groups, each with a checkbox (default on when non-empty):

```
☑ Steps              34 found   (Step N style)     ▸
☑ Cutting list       12 pieces  (main 6 · lining 4 · interfacing 2)  ▸
☑ Notions             7 items                       ▸
☑ Sizes              XS–XXL, bust/waist/hip         ▸
☑ Fabric              3 widths                      ▸
☑ Seam allowance     1.5 cm (5/8") + 1 exception    ▸
☐ Keep the pages so you can see the diagrams  (adds ~5 MB)
⚠ This PDF's columns may be interleaved — check the steps.
```
Expanding a group shows the parsed rows, editable inline. Footer: **Import** and **Just keep the text**. Toast: "Imported 34 steps, 12 pieces and 7 notions."

A "Paste instead" disclosure keeps the plain textarea for people whose pattern is a web page.

### B.4.4 Templates

Three built-ins, `craft: 'sewing'`, seeded on load the same way the crochet built-ins are (missing ids re-seeded so old saves gain them):

| id | name | emoji | Default cutting | Default notions |
|---|---|---|---|---|
| `sew-garment` | Garment | 🧥 | Front ×1 on fold (main), Back ×1 on fold (main), Sleeve ×2 (main), Facing/Neckband ×1 (main), Interfacing ×1 | Matching thread, Interfacing, Zip or buttons, Bias binding |
| `sew-bag` | Bag | 👜 | Exterior ×2, Lining ×2, Pocket ×2, Strap ×2, Base ×1, Interfacing ×2 | Zip, Magnetic snap, D-rings ×2, Swivel hooks ×2, Webbing, Thread, Rivets |
| `sew-quilt` | Quilt | 🧵 | Fabric A strips, Fabric B strips, Background, Backing, Binding, Batting | Piecing thread, Quilting thread, Batting, Basting pins or spray, Walking foot, Rotary blade |

`Template.craftData` holds those defaults; `createProject` copies them into `Project.craftData` through the registered `normalize`.

### B.4.5 Quilt projects: reuse the counter

For `kind === 'quilt'`, the module shows one extra card above the step card — a **unit counter** that is the existing big-button interaction applied to blocks:

```
┌──────────────────────────────┐
│  FLYING GEESE                │
│        96 / 224              │   tap the card to +1, long-press for −1
│  ▓▓▓▓▓▓▓▓░░░░░░░░░░  43%     │
└──────────────────────────────┘
```

`SewingData.units: [{ id, name: 'Flying geese', target: 224, done: 96 }]`, seeded from the parser when it finds `(\d{2,4})\s+(flying geese|half square triangles|HSTs?|blocks|squares|units)` in the text, and addable by hand. `Feedback.tap()`, `Feedback.group()` at every 10, and `Celebrate.play(theme, {kind:'piece'})` on completion — all reused verbatim from the crochet counter. This is the cheapest high-value feature in the whole proposal: it is ~80 lines, it reuses the app's single best-built interaction, and A.2.4 found **no existing tool that connects a quilt calculator's unit count to progress**.

### B.4.6 The live diagram

**Hide it for sewing.** The 3D model is a solid of revolution built from stitch counts; it has no meaning for a cut-and-sew garment, and forcing it would be worse than nothing. `supportsDiagram: false` means `App` never mounts the canvas and the Settings toggle stays crochet-only.

If a progress illustration is wanted later (phase 7, optional), the honest sewing equivalent is **flat, 2D and about pieces, not stitches**: a small SVG "cutting table" — one rounded rectangle per cutting-list entry, sized by `qty`, greyed when uncut and filled in the project's accent colour as pieces are cut — sitting above the step card, plus a thin ring around the step number showing `currentStep / steps.length`. That is a ~150-line `app-sewing.js` addition with no WebGL and no new dependency, and it reuses `Celebrate` for the "all cut" moment. Do **not** try to render garment shapes; that needs the pattern pieces, which the app cannot and should not read.

### B.4.7 Tour

One new tour id `sewing`, registered by `app-sewing.js` into the existing `Tour` engine: step card → Step done button → progress strip (tap for the whole list) → cutting sheet → notions sheet + copy shopping list → size/alterations card → import. The existing `Tour.list()` / Settings "Help & tours" section picks it up with no change, as long as `Tour` gains a `Tour.register(def)` (or `app-sewing.js` pushes into the existing definitions array — whichever the tour agent's code allows with the smaller edit).

## B.5 Risks and open questions

**Risks**

1. **Parser variance is materially worse than crochet.** Crochet rows have a numbering convention enforced by the craft; sewing steps do not, and a minority of respected publishers use none. *Mitigation:* the "no steps found" fallback must be a first-class path, not an error — keep the text, offer one-tap "make a step from this paragraph".
2. **Tables.** Size charts and fabric requirements are the two blocks sewists most want and the two hardest to extract. *Mitigation:* ship v1 with the row-shape heuristic, accept ~50%, always show the raw line as a fallback, and only build `extractTables()` if real fixtures prove it necessary.
3. **Copyright.** The app must never transmit, bundle or publish pattern content. It already does everything on-device, which is the correct answer, and it should say so in the import sheet ("stays on your phone"). Fixtures must stay out of git. This is also a **feature** for the eventual business plan: "your patterns never leave your phone".
4. **Scope creep into a wardrobe planner.** Fabric stash, makes log, photo timeline and pattern library are all adjacent and all tempting. They are separate products. v1 should do *one* thing: follow a pattern from PDF to finished garment.
5. **Storage.** Even without page images, a 40-step booklet's `sourceText` can be 40–80 KB; ten projects is most of the localStorage budget. *Mitigation:* cap `sourceText` at 60 KB per project, and if page images ship, move `sourceText` to IndexedDB alongside them.
6. **Two crafts landing at once.** Sewing and cross-stitch both want `App.registerCraft` and both want `#screen-craft`. *Mitigation:* land the hook as its own commit first, with both agents reviewing the shape, before either module is written.
7. **"Thready or Not" positioning.** The name survives the widening fine; the mascots and themes are crochet-flavoured but craft-neutral enough. The home screen will need a craft emoji on each card so a mixed project list stays readable.

**Open questions for the owner**

1. Should a project's craft be **changeable after creation**? (Recommended: no — it is a different data shape. Offer "duplicate as…" instead.)
2. Should the **cutting list** be able to feed the crochet-style Part tabs for people who sew a bag with crocheted panels? (Recommended: not in v1.)
3. Do sewists want **per-project step photos** (their own progress shots) before they want PDF page images? Worth one question in the owner's user testing.
4. Is **metric or imperial** the primary audience? It changes which defaults look right, though the parser keeps both verbatim either way.
5. Should **measurements ("mine")** live in Settings and be shared across projects (recommended) or per project?
6. Does the **"Import" tour** get a sewing variant, or one shared craft-aware tour?

## B.6 Suggested build order and rough effort

| Phase | Work | Files | Effort |
|---|---|---|---|
| **0** | Craft hook: `Project.craft` + `craftData` + migration, `Store.registerCraftData/craftData/updateCraft`, `App.registerCraft/craft/crafts/dom`, `#screen-craft` in `index.html`, router change, project-card and import-sheet delegation, `Template.craft` + picker filter | `store.js`, `app.js`, `index.html` | **0.5 day** — land alone, review with the cross-stitch agent |
| **1** | Parser core: `normalizeText`, `parseSteps`, `parseSeamAllowance`, `parseNotions`, kind detection, `parse` shell, warnings. Full synthetic test page. | `js/sewing.js`, `test/sewing.test.html` | **1.5 days** |
| **2** | Sewing project screen + Steps / Cutting / Notions sheets + `Store.updateCraft` wiring + celebrations | `js/app-sewing.js`, `css/sewing.css` | **2 days** |
| **3** | `parseCutting` (all five families incl. quilting), `toCraftData` merge, import sheet variant with the review list | `js/sewing.js`, `js/app-sewing.js` | **1 day** |
| **4** | Templates (Garment / Bag / Quilt), size & measurements sheet, machine settings + presets, **quilt unit counter (B.4.5)**, notes/status reuse | `js/sewing.js`, `js/app-sewing.js` | **1 day** |
| **5** | `parseSizes` + fabric requirements, fixture page against real PDFs, tolerance tuning | `js/sewing.js`, `test/sewing.fixtures.html` | **1 day** |
| **6** | Tour, help FAQ entries, accessibility pass, 375 px polish, `CACHE_VERSION` bump + precache, release | all | **0.5 day** |
| **7** *(optional)* | Page images: pdf.js `page.render()` → JPEG blobs in IndexedDB, lazy, opt-in, `navigator.storage.persist()`, delete-with-project | new `js/pagestore.js` | **1 day** |
| **8** *(optional)* | 2D cutting-table progress illustration | `js/app-sewing.js` | **0.5 day** |

**Total for a shippable v1 (phases 0–6): roughly 7.5 days of agent time**, or three parallel agents — parser, UI, integration — against the contracts above, which is the delegation pattern that already worked for the 3D diagram.

**Definition of done for v1:** a sewist drops a Peppermint instruction booklet on the import sheet, taps Import, and within ten seconds has a phone-sized step counter showing "Step 1 of 34", a cutting checklist with twelve pieces grouped by fabric, a notions list they can copy to their phone's clipboard at the fabric shop, and a seam allowance reminder on every step — with nothing having left the device.

---

## Sources

Sources for section A.2 (the app landscape and sewist complaints) are linked inline in that section and are not repeated here.

**Research caveats:** `reddit.com` (r/sewing, r/sewhelp, r/quilting, r/myog) was not reachable from this environment, and PatternReview forum pages and textillia.com returned HTTP 403 to automated fetches — the PatternReview evidence above comes from search-result snippets plus real, human-browsable thread URLs. The Fabrics-Store entry in A.4 is marked unverified for the same reason. A human spot-check of Reddit would strengthen A.2.2 and is cheap to do.

- [Made by Rae — my sewing projector setup](https://www.made-by-rae.com/blog/2024/12/my-sewing-projector-setup)
- [Love Notions — how to print A0 / copyshop patterns](https://www.lovenotions.com/how-to-print-a0-copy-shop-large-format-sewing-patterns)
- [Cashmerette — how to print PDF patterns using layers](https://blog.cashmerette.com/2020/06/print-patterns-using-layers.html)
- [The Green Pepper — your guide to using PDF sewing patterns](https://thegreenpepper.com/blogs/news/your-guide-to-using-pdf-sewing-patterns)
- [Little Castle Designs — how to use PDF sewing patterns](https://www.littlecastledesigns.com/post/how-to-use-pdf-sewing-patterns)
- [Sinclair Patterns — free patterns (A4, Letter, A0, projector)](https://sinclairpatterns.com/collections/free-sewing-patterns)
- [gather here — A0 / large format PDF printing](https://gatherhereonline.com/products/pdf-sewing-pattern-printing)
- [Brother — how to read sewing patterns](https://sewingcraft.brother.eu/en/blog/tutorials/2022/how-to-read-sewing-patterns)
- [The Sewing Directory — understanding sewing patterns](https://www.thesewingdirectory.co.uk/understanding-sewing-patterns/)
- [Sew Direct — part 3: how to read a sewing pattern](https://www.sewdirect.com/blog/getting-started-with-sewing/part-3-how-to-read-a-sewing-pattern/)
- [PatternReview — finished measurements on tissue vs envelope](https://sewing.patternreview.com/SewingDiscussions/topic/119847)
- [In the Folds — using finished garment measurements to select your size](https://inthefolds.com/q-a-series/2021/using-finished-garment-measurements-to-select-your-size)
- [Ageberry — seam allowances in sewing patterns](https://www.ageberry.com/seam-allowances-in-sewing-patterns/)
- [Closet Core Patterns — errata](https://closetcorepatterns.com/pages/errata)
- [So Sew Easy — tracing Burda patterns](https://so-sew-easy.com/tracing-burda-patterns/)
- [String & Story — how to read a quilt pattern](https://www.stringandstory.com/blog/how-to-read-a-quilt-pattern)
- [Alderwood Studio — reading quilt patterns](https://www.alderwood-studio.com/blog/reading-quilt-patterns)
- [SewCanShe — easy sling bag free pattern](https://sewcanshe.com/easy-sling-bag-free-sewing-pattern/)
- [Andrie Designs — beginner's guide to sewing your first bag](https://www.andriedesigns.com/beginners-guide-to-sewing-your-first-bag-part-1/)
- [Twig + Tale — common cutting layouts and principles](https://www.twigandtale.com/blogs/twig-and-tale-blog/common-cutting-layouts-principles)
- [BootstrapFashion — made-to-measure patterns](https://patterns.bootstrapfashion.com/bootstrap-fashion-original-custom-fit-sewing-patterns.html)
- [MyBodyModel](https://www.mybodymodel.com/)
- [Projector Sewing — made-to-measure](https://projectorsewing.com/made-to-measure/)
- [DEV — most PDF extractors use the wrong API](https://dev.to/bonzai2carn/most-pdf-extractors-use-the-wrong-api-heres-what-we-built-instead-5dgh)
- [DEV — why browser-based PDF extraction loses table structure](https://dev.to/bonzai2carn/the-empty-quadrant-mapping-the-design-space-of-frontend-pdf-extraction-166g)
- [WebKit — updates to storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [MDN — storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [Bugnet — localStorage quota exceeded on Safari iOS](https://bugnet.io/blog/fix-html5-game-localstorage-quota-exceeded-on-safari-ios)
- [Peppermint Magazine — pattern instructions index](https://peppermintmag.com/pattern-instructions/)
- [Riley Blake Designs — free quilt patterns](https://www.rileyblakedesigns.com/free-quilt-patterns)
- [Robert Kaufman / Noodlehead — Forage Bag](https://www.robertkaufman.com/quilting/quilts_patterns/forage_bag/)
- [Sew Sweetness — Baker Street Bag](https://sewsweetness.com/2015/01/free-pattern-baker-street-bag.html)
- [Suzy Quilts — Duval Star](https://suzyquilts.com/free-duval-star-quilt-pattern/)
- [Helen's Closet — free patterns](https://helensclosetpatterns.com/collections/free-patterns)
- [Mood Sewciety — the Wren Shirt](https://blog.moodfabrics.com/the-wren-shirt-free-sewing-pattern/)
- [Fabrics-Store — sewing patterns](https://fabrics-store.com/sewing-patterns)
