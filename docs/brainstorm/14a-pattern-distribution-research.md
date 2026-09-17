# 14a — Pattern distribution market research (supporting 14-pattern-designers.md)

Late-arriving research from a sub-agent of the designer brainstormer, 2026-09-17. Facts marked ⚠️ could not be verified.

## Ribblr (the closest "interactive pattern" competitor)
- Authoring in Ribbuild: structured lines (section / sub-section / note / row), per-line size tags, auto-linked abbreviations, tappable repeats, separate interactive chart editor. No exportable file format; the ePattern is a server record.
- PDF import for designers launched 17 Aug 2026 at 25 Gems (≈ $1.75) per import. Generated PDFs are watermarked unless a paid tier removes it. A downloadable PDF can be attached to a listing but the listing itself is always the ePattern.
- Non-exclusive; designers may sell the PDF elsewhere. Fees: free to 4% + Stripe, min 25¢; tips 5%. Consumer tiers $6.99–$13.99/mo.
- ToS: designer keeps ownership but grants an irrevocable, perpetual, transferable, sublicensable licence incl. the right to sell and resell, plus a moral-rights waiver. This is the lock-in story.
- Complaints, sourced: buyers refuse to buy without a PDF (Trustpilot 2.9/5, forum threads Aug 2025); template rigidity (Ashlee Brotzell, Dec 2022, "as a customer I'd rather have the PDF"); low volume (25–41 sales in six months vs Etsy exposure, Dec 2025 thread); mandatory follows; #CraftersAgainstPiracy claims are unsourced. Screenshots are not technically blocked.
- Scale: iOS 4.2★ / 533 ratings; ~420k Android installs (third-party estimate). **Ribblr does not support cross-stitch.**

## How designers distribute today
| Platform | Fees | Files |
|---|---|---|
| Etsy | $0.20 listing + 6.5% + ~3% + $0.25 + regulatory fee (raised 22 Jun 2026) + 12–15% offsite ads | 5 files × 20 MB; pdf/zip/txt but **no .json**; **digital items cannot be downloaded in the Etsy mobile app** |
| Ravelry | 3.5% on $30–$1,500/mo + PayPal | 50 MB PDF only; fastest DMCA response; platform-risk history (2019, 2020) |
| Payhip | 5% / $29 2% / $99 0% + processor | 5 GB; per-buyer PDF stamping (email + date, portrait only, under 250 MB); default 5 downloads |
| LoveCrafts | ~35p + 4% + VAT (one designer's 2025 breakdown) | can import from Ravelry |
| Gumroad | 10% + $0.50; 30% via Discover | any file; PDF stamping bottom-right; licence keys |
| Ko-fi | 5% or 0% on Gold $12/mo | storefront only |
| SendOwl | $39–$299/mo, 0% | stamping name/email/order, download caps, link expiry |
| KnitPicks/WeCrochet IDP | designer keeps 85% | — |
| Hobbii | ⚠️ no public designer terms found | — |

No mainstream platform has a first-class slot for a structured companion file next to a PDF. Zip on phones is a support burden. The one working precedent is **knitCompanion's kCDesign**: 1,500+ patterns pre-formatted by Create2Thrive's own tech editors at no fee to the designer, sold via the app's shop, PDF still exists, no lock-in backlash. This is the model closest to a `.thready` companion file, and the argument for embedding companion data inside the designer's own PDF (14 #9).

## Piracy: what the community accepts
- **Accepted, no backlash found:** per-buyer PDF stamping with name/email/order id (designers petitioned Ravelry for it in 2013); importing your own purchased PDF into a tracker app (knitCompanion has done it for years with zero copyright objection on r/knitting, r/crochet, r/CrossStitch).
- **Disliked:** heavy visual watermarks over instructions (accessibility complaints).
- **Hated:** password-protected / print-disabled PDFs (r/craftsnark Sep 2022, Apr 2025: copyshop rejections, no iPad annotation, "won't buy from them again"); app-only no-PDF delivery; screenshot detection.
- **Presumed guilty:** AI-flavoured pattern-import platforms (r/craftsnark on Loomily, May 2026: everything assumed stolen; the founder's reply did not help). Sharpest warning for how photo→chart and PDF import are described publicly.
- Shape of piracy: ~800-member Discord sharing paid knitting patterns (Feb 2025); r/PDFSewingExchange active daily (Sep 2026); PinDIY; Facebook ads selling scraped bundles; a Scribd takedown took ~4 months. The only hard loss figures are from the 2000 cross-stitch wave (Pegasus Originals, ~40% down). ⚠️ No credible modern estimate. "Personal use only" clauses are of dubious enforceability (Sulcoski, Craft Industry Alliance); copyright covers the document, not the finished object.

## Cross-stitch and sewing specifics
- **Pattern Keeper** (Android only, $9 one-time, Datadromeda AB): full crosses only. Compatibility needs TTF symbols as selectable text with the font embedded, a vector grid, a text legend with Number/Name headings not word-wrapped, ~60×70 stitches per page, 10×10 blocks not split across pages, 15–30 colours. MacStitch/WinStitch has a one-click "Export for Pattern Keeper". PK's FAQ says copyright stops them debugging charts and tells buyers to ask the designer, which converts failed imports into buyer pressure. Designers merchandise it: Lindy Stitches runs a "Pattern Keeper Compatible Charts" collection; Etsy has an auto-generated market page for it.
- **Markup R-XP** (iOS + Android, $17.99/yr) markets the opposite: "any PDF or image, no special formatting", with a submit-your-broken-file channel. This is the direct counter-argument to a compatibility badge.
- Chart tools: Stitch Fiddle (web, own tracker), FlossCross (free, 300×300, OXS), KG-Chart (`.kgc` undocumented), PCStitch (`.pat`), Pattern Maker (`.xsd`), MacStitch (`.chart`).
- Sewing: tiled A4/Letter, A0 copyshop, and projector files are now standard (Closet Core layered since Feb 2019; Seamwork from #3123). Projector-ready spec (projectorsewing.com, Apr 2026): layered nested sizes, unsplit pieces, both mirrored pieces, no password, fonts of 20pt or more, 3–6pt high-contrast lines, a calibration box.

## Badge governance precedents
1. Self-declared controlled badge (Pattern Keeper): a "Tested" badge for designers who test themselves, a "Supported Designer" list (28 designers) after collaborative testing; free; badge placement rules and a mandatory "not affiliated" disclaimer; no audit.
2. Community-curated list (projector sewing): a spreadsheet of ~150 companies maintained by a Facebook group member; reputational governance.
3. Paid certification (Benetech GCA, $2k–$8k plus annual fees) is a non-starter at $5–$15 patterns with 25–41 sales a quarter.

Read-across: free, self-declared, app-published technical guidance plus a badge, with buyers doing the enforcement, is the only model that has worked in craft.

## Existing authoring guidance and interchange formats
- Craft Yarn Council standards (rev 2018-11-06): abbreviations, chart symbols, yarn weight 0–7 (category 8 flagged as coming: do not hard-code), hook/needle sizing, skill levels, garment sizing. Designers add their own abbreviations defined in-pattern, so the parser needs per-pattern overrides. Ravelry publishes metadata fields, not body formatting (guideline pages login-gated). No UK terminology standard exists; UK vs US `dc` collides silently. Discriminators: `sc` implies US; `htr` vs `hdc`; "tension" vs "gauge". Detection must be document-level, explicit, overridable, confidence-scored.
- **OXS** (Ursa, v1.0 2020/24) is the only open cross-vendor craft format: UTF-8 XML, unknown elements ignored. ⚠️ No schema, no changelog, single-vendor governance, no reusable library. Everything else in cross-stitch is undocumented binary. An MIT-licensed `.pat`/`.xsd`/`.kgc`/`.chart` reader normalising to OXS would be the highest-leverage open contribution (compare pyembroidery, MIT, 46 formats, which became the de facto embroidery standard).
- **Knitspeak** (stitch-maps.com): rows start with `Row` or `Rnd` plus a colon, counts required, `[…] n times` vs `*…repeat from *`, one variable-width section per row. Closed source; the open implementation is knotty (GPL-3). The best-tested constraint set for a row DSL; it ports to crochet.
- **CrochetPARADE** (JS, GPLv3, 70★): a crochet grammar with stitch-count and attachment consistency checks and 2D/3D rendering. Becoming the academic intermediate representation: Dias and Karim (AAAI SS 2025) translate natural language to CrochetPARADE at 74%; CrochetBench (arXiv 2511.09483, Nov 2025). Relevant as prior art for the computed-vs-stated check and the 3D diagram; GPL means read, do not copy.
- KnitML is dead (2014). Knitout is industrial machine code, irrelevant.

## Additions from the final report
- **Sewing's compatibility problem is already dissolved** by Pattern Projector (free, open-source PWA at patternprojector.com) that calibrates the projector and fixes files at read time. Compete in sewing on tracking and cutting workflow, not file compatibility.
- **Cross Stitch Saga** (iOS, $15) takes native chart files only (XSD/PAT/OXS), no PDF, so it needs no badge but gets "does not work with PDF" complaints. Pattern Keeper's designer-permission gate capped it at 27 supported designers and left the door open to Markup R-XP's "no special formatting required".
- **EPUB Accessibility 1.2** is the closest free badge precedent with machine-readable self-declaration: conformance, certifier and report URL live in the file's own metadata. The same idea fits companion data embedded in a pattern PDF's metadata or attachment stream, which is the only channel that survives Ravelry's PDF-only store, Etsy's 20 MB cap and KnitPicks IDP's 5 MB cap.
- Ravelry's designated copyright agent page: ravelry.com/about/copyright; counter-notice restores in 10–14 business days. Etsy's DMCA form only accepts reports from the rights holder.
- **Cross-cutting takeaways** the researcher drew: (1) Ribblr's weakness is exactly the buyer's "give me a PDF", so a tool that reads the designer's existing PDF and never becomes the only copy is on the right side of every complaint; (2) the ceiling of acceptable anti-piracy is per-buyer stamping, never DRM or screenshot detection; (3) do not replicate Pattern Keeper's permission gate; (4) no written-pattern standard exists, so aligning the internal representation with CrochetPARADE syntax buys a dataset, a benchmark and a validator for free; (5) hard-code Craft Yarn Council vocabularies as overridable defaults and detect US/UK at document level with a confidence score and a user override.
- **Gumroad has been merchant of record since 1 Jan 2025** (handles all sales tax and VAT worldwide), which matters for the Pro licence-key plan in 08 #15: Ko-fi leaves the seller as merchant of record, Payhip collects EU/UK VAT but is not merchant of record.
- Hobbii pays freelance designers 100% of pattern revenue minus PayPal with a €60 payout threshold and no sales analytics (one designer account, May 2026). Ravelry's copyright agent is Mary Heather Browne (legal@ravelry.com).
