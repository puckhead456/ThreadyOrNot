// js/patterns.js
// window.Patterns - crochet pattern-text parser (v2). Pure functions, no DOM.
//
// Sections of this file:
//   1. small helpers / normalisation
//   2. stitch vocabulary
//   3. row + setup markers
//   4. explicit stitch counts (multi-size aware)
//   5. size names
//   6. evaluate() - computed counts (tokenizer + vocabulary)
//   7. headers / sections / notes / repeat suggestions
//   8. parse(), targetFor(), lineFor(), summary(), splitSections()
//   9. expand() - the stitch-by-stitch reading (cells, colours, geometry)
//   9b. motif anchors - how many corners / spaces / group-gaps the round
//       below left, which is the only place a motif round's repeat count is
//       written down (roundStruct, anchorHits, anchorReps)
//  10. row plumbing, back-references (refTarget)
//  11. shape hints (startHint, workMode, stuffingHint)
'use strict';

(function () {

  // =====================================================================
  // 1. Helpers
  // =====================================================================

  var DASHES = /[\u2010-\u2015\u2212]/g;

  function normDashes(s) { return s.replace(DASHES, '-'); }

  // --- Unicode hygiene (06 #7) -----------------------------------------
  // Text pasted from a web page, a Google Doc or a justified-typeset PDF
  // carries characters none of the rules below would ever match: a soft
  // hyphen inside "in-crease", a zero-width space in front of "Rnd 6", a
  // fullwidth "\uff17", a "\u25aa" bullet, a curly quote in a 6" measurement, a
  // non-breaking space between a number and its unit. Each one used to make
  // a whole round disappear from the count, silently. Fold them all to ASCII
  // before anything looks at the line.
  var INVISIBLE_RE = /[\u0000\u00ad\u200b-\u200d\u2060\ufeff]/g;
  var NBSP_RE = /[\u00a0\u2007\u202f]/g;
  // "exotic" bullets: any of these in front of a round is the same "-".
  var BULLET_RE = /[\u2022\u2023\u25e6\u25aa\u25ab\u25cf\u25cb\u25fe\u00b7\u2027\u2043\u2219]/g;
  var FULLWIDTH_RE = /[\uff01-\uff5e]/g;
  var SQUOTE_RE = /[\u2018\u2019\u201a\u201b\u2032]/g;
  var DQUOTE_RE = /[\u201c\u201d\u201e\u201f\u2033]/g;

  function normUnicode(s) {
    return String(s == null ? '' : s)
      .replace(INVISIBLE_RE, '')
      .replace(FULLWIDTH_RE, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
      })
      .replace(NBSP_RE, ' ')
      .replace(BULLET_RE, '-')
      .replace(SQUOTE_RE, '\'')
      .replace(DQUOTE_RE, '"');
  }

  function trimLine(s) {
    return normDashes(normUnicode(s))
      .replace(/\s+$/, '')
      .replace(/^\s+/, '');
  }

  function titleCase(s) {
    return s.toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
  }

  function num(s) { var n = parseInt(s, 10); return isNaN(n) ? null : n; }

  // Typos seen in real PDFs.
  function fixTypos(s) {
    return s
      .replace(/\binx\b/gi, 'inc')
      .replace(/\beact\b/gi, 'each')
      .replace(/\bevry\b/gi, 'every')
      .replace(/\bstich(es)?\b/gi, 'stitch$1');
  }

  // =====================================================================
  // 2. Stitch vocabulary  (produced, consumed)
  // =====================================================================

  var VOCAB = [
    // compound forms first ("Hdc Inc" / "HdcInc" behave like inc)
    ['(?:hdc|sc|dc|tr)\\s*inc(?:rease)?', 2, 1],
    ['(?:hdc|sc|dc|tr)\\s*dec(?:rease)?', 1, 2],
    ['sl\\s*st(?:itch)?(?:es)?', 1, 1],
    ['slst', 1, 1],
    ['slip\\s+stitch(?:es)?', 1, 1],
    // Post stitches (06 #3): the backbone of ribbing, baskets, cuffs and
    // textured blankets. They must sit above the plain stitches so "fpdc"
    // never reads as an "f" and a "dc".
    ['(?:fp|bp)(?:sc|hdc|dc|tr)', 1, 1],
    ['(?:sc|hdc|dc|tr)3tog', 1, 3],
    ['sc2tog', 1, 2],
    ['hdc2tog', 1, 2],
    ['dc2tog', 1, 2],
    ['inv\\.?\\s*dec', 1, 2],
    ['invdec', 1, 2],
    ['decrease', 1, 2],
    ['dec', 1, 2],
    ['increase', 2, 1],
    ['incr', 2, 1],
    ['inc', 2, 1],
    ['fsc', 1, 0],
    ['spike\\s*(?:sc|hdc|dc|tr)?', 1, 1],
    ['crossed\\s+(?:dc|tr)', 2, 2],
    ['x[- ]?st(?:itch)?', 2, 2],
    ['v[- ]?st(?:itch)?', 2, 1],
    ['picot', 0, 0],
    // UK terms. "htr" and "ttr"/"trtr" have to be matched before "tr" or the
    // leading letter is left behind and the row never computes.
    ['trtr', 1, 1],
    ['ttr', 1, 1],
    ['dtr', 1, 1],
    ['htr', 1, 1],
    ['hdc', 1, 1],
    ['tr(?:eble)?', 1, 1],
    ['dc', 1, 1],
    ['sc', 1, 1],
    ['puff(?:\\s*st(?:itch)?)?', 1, 1],
    ['bobble', 1, 1],
    ['popcorn', 1, 1],
    ['cluster', 1, 1],
    ['shell', 1, 1],
    ['bbl', 1, 1],
    ['skip', 0, 1],
    ['miss', 0, 1],
    ['sk', 0, 1]
  ];

  // One alternation, longest-first (the table above is already ordered).
  var STITCH_ALT = '(?:' + VOCAB.map(function (v) { return v[0]; }).join('|') + ')';

  function stitchInfo(word) {
    var w = word.toLowerCase().replace(/\s+/g, ' ').trim();
    for (var i = 0; i < VOCAB.length; i++) {
      var re = new RegExp('^(?:' + VOCAB[i][0] + ')$', 'i');
      if (re.test(w)) return { p: VOCAB[i][1], c: VOCAB[i][2] };
    }
    return null;
  }

  // --- UK / US terms (06 #3) -------------------------------------------
  // sc/dc/tr are all one-produced-one-consumed, so a UK pattern computes
  // exactly the same numbers as a US one and there is nothing to convert.
  // The hint is purely informational: the import review shows "Looks like UK
  // terms" so the maker knows the app read the pattern the way it is written.
  // "miss" is also an ordinary English verb ("be careful not to miss any
  // stitches"), so it only counts as the UK word for skip when it is used as
  // an instruction - otherwise half the US patterns in the world grow a UK
  // chip.
  // [token, dialect, pattern, kind]. `kind` is what the token is evidence OF:
  //   'voc'  - a stitch abbreviation that exists in one dialect only. The only
  //            trustworthy evidence, and the only thing the verdict counts.
  //   'said' - the pattern naming its own dialect. A good tie-breaker for a
  //            pattern whose stitches are all dialect-neutral (dc, slst), but
  //            NOT decisive: crochet-kingcole-festival-us reuses the UK
  //            edition's abbreviations page and so calls itself "UK TERMS"
  //            while every instruction in it says sc and hdc.
  //   'style'- house style, not dialect ("Tension" vs "Gauge", and "miss",
  //            which the US edition of the King Cole blanket uses 103 times).
  //            Kept for the informational chip; ignored by the verdict.
  // UK publishers glue the count to the stitch ("1htr in next st", "5tr in
  // next 1-ch-sp"), so `\bhtr\b` never matches - a digit and a letter are both
  // word characters and there is no boundary between them. LEAD is the
  // boundary that does hold: anything that is not a letter.
  var LEAD = '(?:^|[^a-z])';
  var TAIL = '(?![a-z])';
  var DIALECT_TOKENS = [
    ['htr', 'uk', LEAD + 'htr' + TAIL, 'voc'],
    ['dtr', 'uk', LEAD + 'dtr' + TAIL, 'voc'],
    ['trtr', 'uk', LEAD + '(?:trtr|ttr)' + TAIL, 'voc'],
    ['miss', 'uk', '\\bmiss\\s+(?:\\d+|the\\s+next\\b|next\\b|a\\s+st)', 'style'],
    ['tension', 'uk', '\\btension\\b', 'style'],
    ['uk terms', 'uk', '\\buk\\s+(?:term|terminolog)', 'said'],
    ['sc', 'us', LEAD + 'sc' + TAIL, 'voc'],
    ['hdc', 'us', LEAD + 'hdc' + TAIL, 'voc'],
    ['gauge', 'us', '\\bgauge\\b', 'style'],
    ['us terms', 'us', '\\b(?:us|american)\\s+(?:term|terminolog)', 'said']
  ];

  var DIALECT_MARGIN = 2;      // the winner must be this many times the loser
  var DIALECT_MIN_HITS = 3;    // ...and be used at least this often

  function countMatches(s, src) {
    var re = new RegExp(src, 'ig');
    var n = 0;
    while (re.exec(s) !== null) {
      n++;
      if (n > 5000) break;                 // a 200-page scan is not a contest
    }
    return n;
  }

  // Knitting (and weaving, and macrame) files land in the crochet importer all
  // the time, and a knitted "Row 1: K2, p2" looks exactly like a crocheted row
  // to a row-marker regex. These words never appear as crochet instructions,
  // so a file that is full of them and short of hooks is not ours (#19-ish);
  // the caller can say so instead of offering phantom parts.
  var KNIT_RE = '\\b(?:k\\d+|p\\d+|k2tog|p2tog|ssk|psso|yo\\b|yfwd|knit(?:wise)?|purl(?:wise)?|cast\\s+on|bind\\s+off|cast\\s+off|stockinette|stocking\\s+st|garter|dpns?|circular\\s+needles?|needles?\\b)';
  var HOOK_RE = '\\b(?:sc|hdc|dc|tr|htr|dtr|ch\\s*\\d|chain\\s*\\d|sl\\s*st|slst|crochet|hook|magic\\s*ring)\\b';

  /**
   * @returns {{uk:boolean, us:boolean, tokens:string[],
   *            dialect:('uk'|'us'|null), craft:('crochet'|'knit'|null)}}
   */
  function dialectHints(text) {
    var s = normUnicode(text).toLowerCase();
    var res = { uk: false, us: false, tokens: [], dialect: null, craft: null };
    var voc = { uk: 0, us: 0 };
    var said = { uk: 0, us: 0 };
    for (var i = 0; i < DIALECT_TOKENS.length; i++) {
      var hits = countMatches(s, DIALECT_TOKENS[i][2]);
      if (!hits) continue;
      var side = DIALECT_TOKENS[i][1];
      res[side] = true;
      res.tokens.push(DIALECT_TOKENS[i][0]);
      if (DIALECT_TOKENS[i][3] === 'voc') voc[side] += hits;
      else if (DIALECT_TOKENS[i][3] === 'said') said[side] += hits;
    }
    if (voc.uk >= DIALECT_MIN_HITS && voc.uk >= voc.us * DIALECT_MARGIN) res.dialect = 'uk';
    else if (voc.us >= DIALECT_MIN_HITS && voc.us >= voc.uk * DIALECT_MARGIN) res.dialect = 'us';
    // A pattern whose stitches are all dialect-neutral (dc, slst, ch) decides
    // it on what it calls itself - King Cole's pumpkins say "This pattern is
    // written in UK terminology" and nothing else gives it away.
    else if (said.uk && !said.us) res.dialect = 'uk';
    else if (said.us && !said.uk) res.dialect = 'us';
    // ...and failing that, on an absence: a crochet pattern that never once
    // writes `sc` or `hdc` but does write htr/dtr, or "miss"/"tension", is UK.
    else if (!voc.us && (voc.uk || res.uk)) res.dialect = 'uk';
    else if (!voc.uk && voc.us) res.dialect = 'us';

    var knit = countMatches(s, KNIT_RE);
    var hook = countMatches(s, HOOK_RE);
    if (hook >= DIALECT_MIN_HITS && hook >= knit) res.craft = 'crochet';
    else if (knit >= DIALECT_MIN_HITS && knit > hook * DIALECT_MARGIN) res.craft = 'knit';
    return res;
  }

  // =====================================================================
  // 3. Row / setup markers
  // =====================================================================

  // "Row 1", "Row 1 (WS)", "Rows 3-4", "Rows 5 to 8", "Rows 5 & 6",
  // "Rnd1", "Rounds 6-10", "R5", "R 5". The keyword must be followed by a
  // number, so "Repeat"/"Rep" never match.
  // The far end of a range may repeat the keyword ("R12-R17:") and may be
  // joined with a plus ("Rnd 7+8:"), both of which are common in translated
  // amigurumi patterns; without that the range reads as a single row.
  var KEYWORD_RE = new RegExp(
    '^[-*\\u2022]?\\s*(?:rnds?|rounds?|rows?|r)\\.?\\s*' +
    '(\\d+)\\s*(?:(?:-|to|&|and|\\+)\\s*(?:rnds?|rounds?|rows?|r)?\\.?\\s*(\\d+))?' +
    '\\s*(?:\\((?:ws|rs|wrong side|right side)\\))?' +
    '\\s*(?::|\\.|-|\\)|\\s|$)', 'i');

  // Bare numbers need adjacent punctuation: "1.", "5:", "6..", "5-6.", "8-11.."
  // A single dot followed by a digit is a decimal point, not a row marker, so
  // a measurement on the cover page ('15.7"') stops opening a phantom row 15.
  var BARE_RE = /^[-*\u2022]?\s*(\d+)(?:\s*-\s*(\d+))?(\.\.\.?|\.(?!\d)|:|\))/;

  // Ordinal markers: "1st row:", "2nd Rnd:", "3rd round-", "21st row". The
  // whole Yarnspirations / Stylecraft / King Cole house style numbers its rows
  // this way, and so does every Victorian magazine the Antique Pattern Library
  // scanned ("1st round-Make 12 ch."), so without this a Bernat blanket yields
  // no rows at all.
  var ORDINAL_RE = new RegExp(
    '^[-*\\u2022]?\\s*(\\d+)\\s*(?:st|nd|rd|th)\\s*' +
    '(?:-|to|&|and)?\\s*(?:(\\d+)\\s*(?:st|nd|rd|th)\\s*)?' +
    '(?:rows?|rnds?|rounds?)\\b\\s*' +
    '(?:\\(?(?:ws|rs|wrong side|right side)\\)?)?' +
    '\\s*(?::|\\.|-|\\)|\\s|$)', 'i');

  // "Next row:", "Next Rnd", "Next 6 rows:", "Next 2 rows", and the multi-size
  // "Next 5 (5, 5, 1, 1, 1) row(s):" - a run of N unnumbered rows that carries
  // on from wherever the section had got to.
  var NEXT_ROW_RE = /^next\s+(?:(\d+)\s*(?:\([^)]*\))?\s*)?(?:rows?|rnds?|rounds?)\b\s*(?:\(\s*s\s*\))?\s*:?/i;

  // "Setup:", "Foundation row:", "Foundation Rnd RS:", "Base rnd -".
  var SETUP_RE = /^(?:[a-z]+\s+)?(?:setup(?:\s+(?:rows?|rnds?|rounds?))?|foundation(?:\s+(?:rows?|rnds?|rounds?))?|base(?:\s+(?:rows?|rnds?|rounds?))?|starting\s+row)\s*(?:\(?(?:ws|rs)\)?)?\s*[:.-]/i;

  // When a keyword marker is separated from its instruction by nothing but a
  // space ("Round 6 if you wish."), the rest must look like crochet or it is
  // just prose that happens to mention a round.
  var ROW_REST_OK_RE = new RegExp('^(?:[(\\[*]|\\d|with|using|work|into|fold|turn|join|magic|mr\\b|ch(?:ain)?\\b|' + STITCH_ALT + '\\b)', 'i');

  // --- bare-number rejections (06 #2, 03 #4) ---------------------------
  // BARE_RE takes any line-initial number with punctuation after it and has
  // never had a rest-check of its own, so a video timestamp, a table of
  // contents and a numbered materials list each opened a phantom section at
  // the front of the import - and because those rows start at 1, the
  // expected-next-row matcher happily handed real page-4 rounds to it.
  // ROW_REST_OK_RE stays the primary allow ("1. 6 sc in MR" is a round);
  // everything below is a rejection of last resort.
  var TIMESTAMP_RE = /^[-*•]?\s*\d{1,2}:\d{2}\b/;            // "3:40 Attaching the head"
  var DOT_LEADER_RE = /\.{3,}/;                                   // "5. Assembly ..... 12"
  var TOC_TAIL_RE = /[ .]\d{1,3}\s*$/;                            // "...Assembly 12"
  var UNIT_SRC = '(?:mm|cm|mtr|m|yds?|yards?|g|gr|oz|inch(?:es)?|in|")';
  var MEASURE_LEAD_RE = new RegExp('^\\d+(?:[.,]\\d+)?\\s*' + UNIT_SRC + '(?![a-z])', 'i');
  var MEASURE_RE = new RegExp('\\d+(?:[.,]\\d+)?\\s*' + UNIT_SRC + '(?![a-z])', 'i');
  var STITCH_WORD_RE = new RegExp(
    '\\b(?:' + STITCH_ALT + '|ch(?:ain)?s?|sts?|stitch(?:es)?|magic\\s*ring|mr|rnds?|rounds?|rows?)\\b', 'i');
  // A wrapped multi-size list puts its tail at the head of the next printed
  // line: "...leaving the remaining 96 (108," / "116) sts unworked, turn."
  // reads as Row 116 (03 #4). Nothing real starts a round with "sts".
  var STS_REST_RE = /^\s*(?:sts?|stitches?)\b/i;

  // A numbered PROSE step, not a round. Tutorial ebooks and the "NOTES" block
  // of every Lion Brand pattern number their paragraphs, and those paragraphs
  // pass ROW_REST_OK_RE on words like "Work" ("1. Work along the edge of a
  // finished item.") or STITCH_WORD_RE on the word "row" ("5. Repeat step 4
  // across the row."). What separates a round from a paragraph is not the
  // vocabulary but the NOTATION: a real round is written in abbreviations
  // (sc, ch 3, dc2tog), while prose spells the stitches out in full.
  var ABBREV_STITCH_RE = new RegExp(
    '(?:^|[^a-z])(?:' + STITCH_ALT + '|ch|chs|mr|blo|flo|sts?|yoh|yo|rep)(?:[^a-z]|$)', 'i');
  var PROSE_MIN_WORDS = 5;

  function bareIsProseStep(rest) {
    var r = String(rest).trim();
    // "7. Rnd: If you crocheted a white belly for your fish..." - the number is
    // followed by the word Rnd, so it is a round however prose-y the rest is.
    if (/^(?:rnds?|rounds?|rows?)\b/i.test(r)) return false;
    if (!/^[A-Z(]/.test(r)) return false;                 // rounds start lowercase or capped
    if (r.split(/\s+/).length < PROSE_MIN_WORDS) return false;
    if (/[(\[]\s*\d+\s*(?:sts?|stitches?)?\s*[)\]]/.test(r)) return false;  // it has a count
    return !ABBREV_STITCH_RE.test(r);
  }

  function bareLooksWrong(line, rest) {
    var r = String(rest).trim();
    if (STS_REST_RE.test(r)) return true;
    var stitchy = STITCH_WORD_RE.test(r);
    if (!stitchy && TIMESTAMP_RE.test(line)) return true;
    if (!stitchy && MEASURE_LEAD_RE.test(r)) return true;         // "1. 4 mm hook"
    if (bareIsProseStep(r)) return true;                          // "1. Pullover is made in 4 pieces:"
    if (ROW_REST_OK_RE.test(r)) return false;                     // "1. 6 sc in MR"
    if (DOT_LEADER_RE.test(line)) return true;
    if (!stitchy && TOC_TAIL_RE.test(line)) return true;
    if (!stitchy && MEASURE_RE.test(line)) return true;           // "2) Safety eyes, 8 mm"
    return false;
  }

  // Returns { row, rowEnd, rest, bare } or null.
  function detectMarker(line) {
    var m = KEYWORD_RE.exec(line);
    if (m) {
      var r = num(m[1]);
      var rest = line.slice(m[0].length);
      var sep = m[0].charAt(m[0].length - 1);
      if (/\s/.test(sep) && rest.trim() && !ROW_REST_OK_RE.test(rest.trim())) return null;
      return { row: r, rowEnd: m[2] !== undefined ? num(m[2]) : r, rest: rest, bare: false };
    }
    var o = ORDINAL_RE.exec(line);
    if (o) {
      var ro = num(o[1]);
      var resto = line.slice(o[0].length);
      var sepo = o[0].charAt(o[0].length - 1);
      if (/\s/.test(sepo) && resto.trim() && !ROW_REST_OK_RE.test(resto.trim())) return null;
      return { row: ro, rowEnd: o[2] !== undefined ? num(o[2]) : ro, rest: resto, bare: false };
    }
    var b = BARE_RE.exec(line);
    if (b) {
      var rest2 = line.slice(b[0].length);
      if (bareLooksWrong(line, rest2)) return null;
      var r2 = num(b[1]);
      return { row: r2, rowEnd: b[2] !== undefined ? num(b[2]) : r2, rest: rest2, bare: true };
    }
    return null;
  }

  function detectNextRow(line) {
    var m = NEXT_ROW_RE.exec(line);
    if (!m) return null;
    var span = m[1] === undefined ? 1 : num(m[1]);
    if (!span || span < 1 || span > 60) span = 1;
    return { rest: line.slice(m[0].length), span: span };
  }

  function detectSetup(line) {
    var m = SETUP_RE.exec(line);
    if (!m) return null;
    return { rest: line.slice(m[0].length) };
  }

  // =====================================================================
  // 4. Explicit stitch counts
  // =====================================================================

  // A multi-size list: "184 (208, 224)" or "58 (58, 62, 64, 66) (68, 72, 72, 74)".
  // At least two numbers inside the first bracket, so "x6 (30)" is NOT a list.
  // Yarnspirations, Stylecraft and King Cole separate the sizes inside the
  // bracket with DASHES, not commas: "158 (176-194-212-242-260) sc". Allowing
  // either separator is what makes every Bernat/Patons/Caron cardigan in the
  // corpus resolve a size at all. A list of pure integers only, so a measure
  // ("[25.5 (26.5-28-30-33-33) cm]") never reads as a stitch count - see
  // MEASURE_AFTER_RE, which rejects the ones that are integers anyway
  // ('10 (10-10-11-12-13)"').
  var MULTI_INNER = '\\d+(?:\\s*[,\\-]\\s*\\d+)+';
  var MULTI_SRC = '(\\d+)\\s*\\(\\s*(' + MULTI_INNER + ')\\s*\\)(?:\\s*\\(\\s*(' + MULTI_INNER + ')\\s*\\))?';
  var MULTI_ANY = new RegExp(MULTI_SRC);
  // Units, loosely: "sts", "sc", "hdc", "X-sts", "shells", "3tr groups".
  var COUNT_UNIT = '(?:[a-z]+-)?(?:sts?|stitches?|sc|hdc|dc|htr|dtr|trtr|tr|shells?)';
  var MULTI_TAIL = new RegExp(MULTI_SRC + '\\s*' + COUNT_UNIT + '?\\s*[.,;!]*\\s*$', 'i');
  // ...and the same list with a unit but prose after it: "88 (88-92-92-96-96)
  // hdc at end of 6th row." / "140 (140-148-148-156-156) hdc rem."
  var MULTI_UNIT_G = new RegExp(MULTI_SRC + '\\s*' + COUNT_UNIT + '\\b', 'ig');
  // A measurement wearing a size list's clothes. Checked on what FOLLOWS the
  // bracket, because the numbers inside are often plain integers.
  var MEASURE_AFTER_RE = /^\s*(?:"|''|in\b|inch|cm\b|mm\b|m\b|yds?\b|yards?\b|g\b|oz\b|\[|time|ball|skein|button|row|rnd|round)/i;

  function flattenMulti(m) {
    var out = [num(m[1])];
    var push = function (grp) {
      if (!grp) return;
      grp.split(/[,\-]/).forEach(function (x) { var n = num(x.trim()); if (n !== null) out.push(n); });
    };
    push(m[2]); push(m[3]);
    return out;
  }

  function pickSize(sizes, size) {
    if (!sizes || !sizes.length) return null;
    var i = (typeof size === 'number' && size >= 0) ? size : 0;
    if (i > sizes.length - 1) i = sizes.length - 1;
    return sizes[i];
  }

  var BRACKET_TAIL_RE = /[(\[]\s*([^()\[\]]*?)\s*[)\]]\s*[.,;!]*\s*$/;
  var BRACKET_CONTENT_RE = /^(?:\d+\s*,\s*)*(\d+)\s*(?:(?:sts?|stitches?|sc|total)\s*)*$/i;
  var EQUALS_TAIL_RE = /=\s*(\d+)\s*(?:sts?|stitches?)?\s*[.,;!]*\s*$/i;
  // "join with a sl st to top of ch-3" is a stitch NAME with a number in it,
  // not a total, so the dash has to stand alone: "... turn - 16 sts".
  var DASH_TAIL_RE = /(?:^|\s)-\s*(\d+)\s*(?:sts?|stitches?)?\s*[.,;!]*\s*$/i;
  var PLAIN_TAIL_RE = /(\d+)\s*(?:sts?|stitches?)\s*[.,;!]*\s*$/i;
  var LABEL_TAIL_RE = /\b(?:st|stitch)\s*count\s*:?\s*(\d+)|\bsts?\s*:\s*(\d+)\s*$/i;
  // Hobbii's generator declares "< > = stitch count" in its abbreviations and
  // then writes every total that way: "... Turn. <5 sts>".
  var ANGLE_TAIL_RE = /<\s*(\d+)\s*(?:sts?|stitches?)?\s*>\s*[.,;!]*\s*$/i;
  // A total whose unit is the stitch's own name, not the word "sts":
  // "turn. 98 sts." but also "... 2htr." / "... Turn. 11htr." / "10 sc."
  // (Stylecraft, Premier). The count has to be its own clause - after a full
  // stop, a dash, a pipe or at the start of the line - or every Yarnspirations
  // row that happens to end "...to last 2 hdc." would report a count of 2.
  // The full stop at the end is load-bearing: a printed line that WRAPS ends
  // mid-clause ("...Rep from * to last st. 1 dc" / "in top of turning ch 3."),
  // and without it every Bernat row reports a total of 1.
  var CLAUSE_TAIL_RE = new RegExp(
    '(?:^|[.;:|]\\s*|[-=]\\s*)(\\d+)\\s*' + COUNT_UNIT + '\\s*[.;!]\\s*$', 'i');
  // "ch 42 (42-46-46-50-50)." is a starting chain, not a stitch total.
  var MULTI_CH_BEFORE_RE = /\b(?:ch|chain)\s*$/i;
  // "...join with a sl st to top of ch-3 - 16 sts. Fasten off." Red Heart and
  // Coats put the total mid-line with a finishing instruction after it, so
  // none of the end-of-line rules ever reaches it. The lookahead stops the
  // match before the note, so TRAILING_NOTE_RE can pick the note up as usual.
  var DASH_NOTE_G = new RegExp(
    '(?:^|\\s)[-=]\\s*(\\d+)\\s*(?:sts?|stitches?|sc|hdc|dc|htr|tr)\\b\\s*[.,;!]*\\s*' +
    '(?=(?:fasten\\s+off|fo\\b|stuff\\b|tie\\s+off|sl\\s*st|slst|weave\\b|do\\s*not\\b))', 'ig');

  // Fragments that are page furniture, not instructions. Removed from the
  // line before anything else looks at it.
  var FRAGMENT_RES = [
    /\(\s*photos?\s+[a-z](?:\s*-\s*[a-z])?\s*\)/ig,
    /\(\s*\d+\s*rounds?\s+total\s*\)/ig,
    /\(\s*\d+\s*rounds?\s*[x\u00d7][^()]*\)/ig
  ];

  function stripFragments(s) {
    var out = String(s == null ? '' : s);
    for (var i = 0; i < FRAGMENT_RES.length; i++) out = out.replace(FRAGMENT_RES[i], ' ');
    return out.replace(/[ \t]{2,}/g, ' ').replace(/\s+$/, '');
  }

  // A bracket whose whole content is a stitch total: "(30)", "(30 sts)",
  // "(6 sc made)".
  var PLAIN_BRACKET_RE = /[(\[]\s*(\d+)\s*(?:sts?|stitches?|sc|hdc|dc)?\s*(?:total|made)?\s*[)\]]/ig;

  // Text that follows a count and is really a note on that row.
  var TRAILING_NOTE_RE = /^[\s.,;:-]*((?:fasten\s+off|fo\b|stuff\b|tie\s+off|sl\s*st|slst|don'?t\s+fo|do\s+not\s+fasten)[\s\S]*)$/i;

  // Returns { sizes:[..], start, end } (character range of the match) or null.
  function findExplicit(line) {
    // (1) after a pipe: first number / multi-size list there
    var bar = line.indexOf('|');
    if (bar >= 0) {
      var after = line.slice(bar + 1);
      var first = /\d+/.exec(after);
      if (first) {
        var tail = after.slice(first.index);
        var mm = MULTI_ANY.exec(tail);
        if (mm && mm.index === 0) {
          return { sizes: flattenMulti(mm), start: bar, end: line.length };
        }
        return { sizes: [num(first[0])], start: bar, end: line.length };
      }
      return null;
    }

    // (2) the LAST plain-number bracket anywhere, even with text after it
    //     ("(30) (PHOTO A)", "- (18) touching round 6", "(12) Fasten off")
    PLAIN_BRACKET_RE.lastIndex = 0;
    var pb = null, hit;
    while ((hit = PLAIN_BRACKET_RE.exec(line)) !== null) pb = hit;
    if (pb) return { sizes: [num(pb[1])], start: pb.index, end: pb.index + pb[0].length };

    // (3) end of line
    var an = ANGLE_TAIL_RE.exec(line);
    if (an) return { sizes: [num(an[1])], start: an.index, end: line.length };

    var m = MULTI_TAIL.exec(line);
    if (m && !MULTI_CH_BEFORE_RE.test(line.slice(0, m.index)) &&
        !MEASURE_AFTER_RE.test(line.slice(m.index + m[0].length))) {
      return { sizes: flattenMulti(m), start: m.index, end: line.length };
    }

    // (3b) a multi-size list with a unit and prose after it, last one wins:
    //      "88 (88-92-92-96-96) hdc at end of 6th row."
    MULTI_UNIT_G.lastIndex = 0;
    var mu = null, muHit;
    while ((muHit = MULTI_UNIT_G.exec(line)) !== null) {
      if (!MULTI_CH_BEFORE_RE.test(line.slice(0, muHit.index))) mu = muHit;
    }
    if (mu) return { sizes: flattenMulti(mu), start: mu.index, end: mu.index + mu[0].length };

    DASH_NOTE_G.lastIndex = 0;
    var dn = null, dnHit;
    while ((dnHit = DASH_NOTE_G.exec(line)) !== null) dn = dnHit;
    if (dn) {
      var dnAt = line.indexOf(dn[1], dn.index);
      return { sizes: [num(dn[1])], start: dnAt < 0 ? dn.index : dnAt,
               end: dn.index + dn[0].length };
    }

    var br = BRACKET_TAIL_RE.exec(line);
    if (br) {
      var inner = BRACKET_CONTENT_RE.exec(br[1].trim());
      if (inner) return { sizes: [num(inner[1])], start: br.index, end: line.length };
    }

    var lab = LABEL_TAIL_RE.exec(line);
    if (lab) return { sizes: [num(lab[1] || lab[2])], start: lab.index, end: line.length };

    var eq = EQUALS_TAIL_RE.exec(line);
    if (eq) return { sizes: [num(eq[1])], start: eq.index, end: line.length };

    var da = DASH_TAIL_RE.exec(line);
    if (da) return { sizes: [num(da[1])], start: da.index, end: line.length };

    var pl = PLAIN_TAIL_RE.exec(line);
    if (pl) return { sizes: [num(pl[1])], start: pl.index, end: line.length };

    var cl = CLAUSE_TAIL_RE.exec(line);
    if (cl) {
      var at = line.indexOf(cl[1], cl.index);
      return { sizes: [num(cl[1])], start: at < 0 ? cl.index : at, end: line.length };
    }

    return null;
  }

  // =====================================================================
  // 5. Size names
  // =====================================================================

  var SIZE_TOKEN_RE = /^(?:x{0,3}s|s|m|l|x{0,3}l|\d+\s*x(?:l)?|\d+\s*x?s)$/i;
  var SIZE_LINE_RE = /^([a-z0-9]{1,4})\s*\(\s*([^()]+?)\s*\)(?:\s*\(\s*([^()]+?)\s*\))?\s*[:.]?\s*$/i;

  function detectSizes(text) {
    if (text == null) return null;
    var lines = String(text).split(/\r\n|\r|\n/);
    for (var i = 0; i < lines.length; i++) {
      var t = trimLine(lines[i]);
      var m = SIZE_LINE_RE.exec(t);
      if (!m) continue;
      var toks = [m[1]];
      var ok = true;
      [m[2], m[3]].forEach(function (grp) {
        if (!grp) return;
        grp.split(',').forEach(function (x) { toks.push(x.trim()); });
      });
      var hasLetter = false;
      for (var j = 0; j < toks.length; j++) {
        var tk = toks[j];
        if (!tk || !SIZE_TOKEN_RE.test(tk)) { ok = false; break; }
        if (/[a-z]/i.test(tk)) hasLetter = true;
      }
      if (ok && hasLetter && toks.length >= 2) {
        return toks.map(function (t2) { return t2.toUpperCase().replace(/\s+/g, ''); });
      }
    }
    return null;
  }

  // =====================================================================
  // 6. evaluate() - computed stitch counts
  // =====================================================================

  // Segments that contribute nothing to the stitch count.
  var ZERO_RES = [
    /^ch(?:ain)?\s*\d*\s*(?:st|sts|ch|chs)?$/i,
    /^ch(?:ain)?\s*\d+\b/i,
    /^ch(?:ain)?\b\s*$/i,
    /^turn\b/i, /^do\s*not\b/i, /^don't\b/i, /^join\b/i, /^fasten\s+off\b/i,
    /^tie\s+off\b/i, /^flip\b/i, /^with\b/i, /^using\b/i, /^pull\b/i,
    /^leave\b/i, /^leaving\b/i, /^cut\b/i, /^stuff\b/i, /^start\s+stuffing\b/i,
    /^place\b/i, /^add\b/i, /^put\b/i, /^mark\b/i, /^before\b/i, /^after\b/i,
    // "12sc, Attach tail (3sc through both sides of Tail and into body), 21sc"
    // - "attach X" costs nothing by itself; the stitches that do the joining
    // are spelled out in the bracket beside it and are counted there.
    /^attach\b/i,
    /^now\b/i, /^instead\b/i, /^this\b/i, /^these\b/i, /^colou?r\s+change\b/i,
    /^change\s+to\b/i, /^switch\s+to\b/i, /^in\s+(?:yellow|black|white|mc|cc|a|b)\s*$/i,
    /^(?:mr|magic\s*ring|magic\s*circle)\s*$/i,
    /^[a-z]$/i, /^into\b/i, /^fold\b/i, /^sew\b/i, /^lay\b/i, /^pinch\b/i,
    // a stray stitch total, e.g. the "30" of a trailing "(30)" / "30 sts"
    // (NOT "2sc", which is two single crochets)
    /^\d+\s*(?:sts?|stitches?|total)?$/i
  ];

  var WORK_EVEN_RE = /^(?:work\s+even|work\s+in\s+(?:the\s+)?(?:established\s+)?pattern|continue\s+in\s+(?:the\s+)?established\s+pattern|work\s+in\s+pattern)/i;

  var MR_RE1 = new RegExp('^(\\d+)\\s*(?:sc|sts?|dc|hdc|tr)?\\s*(?:in|into)\\s+(?:a\\s+|the\\s+)?(?:mr|magic\\s*ring|magic\\s*circle|magic\\s*loop|ring|circle)\\b', 'i');
  var MR_RE2 = new RegExp('^(?:mr|magic\\s*ring|magic\\s*circle)\\s*(?:with\\s+)?(\\d+)', 'i');

  var PREFIX_RE = /^(?:blo|flo|back\s+loop\s+only|front\s+loop\s+only|work\s+a|work|then|and)\s+/i;

  var R_NEXT_N = new RegExp('^(?:(\\d+)\\s+)?(' + STITCH_ALT + ')\\s+(?:in|into)\\s+(?:each\\s+of\\s+)?(?:the\\s+)?next\\s+(\\d+)', 'i');
  var R_FROM_HOOK = new RegExp('^(' + STITCH_ALT + ')\\s+(?:in|into)\\s+(?:the\\s+)?\\d+(?:st|nd|rd|th)\\s+(?:ch|chain|st|stitch)\\s+from', 'i');
  // "hdc in back loop only of each st across" / "sc in flo of each st around":
  // the loop phrase sits BETWEEN the stitch and "each", where PREFIX_RE (which
  // only strips a leading one) never sees it, and without it the whole row
  // computes as a single stitch instead of "same as the row before".
  var LOOP_PHRASE = '(?:(?:back|front)\\s+loops?\\s+only|blo|flo)\\s*(?:of|in)?\\s*';
  var R_EACH = new RegExp('^(?:(\\d+)\\s*)?(' + STITCH_ALT + ')\\s*(?:sts?|stitch(?:es)?)?\\s*(?:in|into)?\\s*(?:' + LOOP_PHRASE + ')?(?:each|every|all)\\b', 'i');
  // ...and the same with the post-stitch preposition: "Dcfp around each of
  // next 4 sts", "fpdc behind every st".
  var R_EACH_AROUND = new RegExp('^(?:(\\d+)\\s*)?(' + STITCH_ALT + ')\\s*(?:sts?|stitch(?:es)?)?\\s*(?:around|over|behind|through)\\s*(?:' + LOOP_PHRASE + ')?(?:each|every|all)\\b', 'i');
  var R_AROUND = new RegExp('^(' + STITCH_ALT + ')\\s*(?:sts?|stitch(?:es)?)?\\s*(?:in|into)?\\s*(?:' + LOOP_PHRASE + ')?\\s*(?:around|across|to\\s+end)\\b', 'i');
  var R_N_IN_NEXT = new RegExp('^(\\d+)\\s*(' + STITCH_ALT + ')\\s+(?:in|into)\\s+(?:the\\s+)?(?:next|same)\\b', 'i');
  var R_N_ST = new RegExp('^(\\d+)\\s*(' + STITCH_ALT + ')\\b', 'i');
  var R_ST_N = new RegExp('^(' + STITCH_ALT + ')\\s+(\\d+)\\b', 'i');
  // "Inc x 8", "Decx9", "Hdc Inc x 13" - N repetitions of the stitch
  var R_ST_X = new RegExp('^(' + STITCH_ALT + ')\\s*[x\\u00d7]\\s*(\\d+)\\b', 'i');
  var R_ST = new RegExp('^(' + STITCH_ALT + ')\\b', 'i');

  // Parse one comma-separated segment.
  // -> { p, c } | { fill:{p,c} } | { abs:n } | null
  function parseSegment(seg) {
    var s = seg.trim().replace(/\s+/g, ' ');
    if (!s) return { p: 0, c: 0 };

    var i, m;
    for (i = 0; i < ZERO_RES.length; i++) if (ZERO_RES[i].test(s)) return { p: 0, c: 0 };
    if (WORK_EVEN_RE.test(s)) return { fill: { p: 1, c: 1 } };

    m = MR_RE1.exec(s); if (m) return { abs: num(m[1]) };
    m = MR_RE2.exec(s); if (m) return { abs: num(m[1]) };

    s = s.replace(PREFIX_RE, '');
    for (i = 0; i < ZERO_RES.length; i++) if (ZERO_RES[i].test(s)) return { p: 0, c: 0 };
    m = MR_RE1.exec(s); if (m) return { abs: num(m[1]) };

    var st;
    m = R_NEXT_N.exec(s);
    if (m) {
      st = stitchInfo(m[2]); if (!st) return null;
      var lead = m[1] ? num(m[1]) : 1;
      var n = num(m[3]);
      return { p: n * lead * st.p, c: n * st.c };
    }
    m = R_FROM_HOOK.exec(s);
    if (m) { st = stitchInfo(m[1]); return st ? { p: st.p, c: 0 } : null; }

    m = R_EACH.exec(s);
    if (m) {
      st = stitchInfo(m[2]); if (!st) return null;
      var lead2 = m[1] ? num(m[1]) : 1;
      return { fill: { p: lead2 * st.p, c: st.c } };
    }
    m = R_AROUND.exec(s);
    if (m) { st = stitchInfo(m[1]); return st ? { fill: { p: st.p, c: st.c } } : null; }

    m = R_N_IN_NEXT.exec(s);
    if (m) { st = stitchInfo(m[2]); return st ? { p: num(m[1]) * st.p, c: st.c } : null; }

    m = R_N_ST.exec(s);
    if (m) { st = stitchInfo(m[2]); return st ? { p: num(m[1]) * st.p, c: num(m[1]) * st.c } : null; }

    m = R_ST_X.exec(s);
    if (m) { st = stitchInfo(m[1]); return st ? { p: num(m[2]) * st.p, c: num(m[2]) * st.c } : null; }

    m = R_ST_N.exec(s);
    if (m) { st = stitchInfo(m[1]); return st ? { p: num(m[2]) * st.p, c: num(m[2]) * st.c } : null; }

    m = R_ST.exec(s);
    if (m) { st = stitchInfo(m[1]); return st ? { p: st.p, c: st.c } : null; }

    return null;
  }

  // Split a string on , ; . and " and ", ignoring nothing (groups are handled
  // by the scanner before this is called).
  function splitSegments(s) {
    return s.split(/[,;.:]|\band\b/i);
  }

  // Sum a list of plain segments. -> { p, c, fill } | null
  function sumSegments(list) {
    var p = 0, c = 0, fill = null;
    for (var i = 0; i < list.length; i++) {
      var r = parseSegment(list[i]);
      if (!r) return null;
      if (r.abs !== undefined) return { abs: r.abs };
      if (r.fill) { if (fill) return null; fill = r.fill; continue; }
      p += r.p; c += r.c;
    }
    return { p: p, c: c, fill: fill };
  }

  var MULT_RE = /^\s*[,]?\s*(?:x|\u00d7|\*)\s*(\d+)|^\s*[,]?\s*(?:rep(?:eat)?(?:\s+from\s*\*)?\s*)?(\d+)\s*(more\s+)?times?\b|^\s*[,]?\s*(twice)\b/i;
  var FILL_AROUND_RE = /^[\s,]*(?:rep(?:eat)?\s+)?(?:around|across|to\s+end)\b/i;

  // "(3tr, 2ch) five times in ring" - UK and translated patterns spell the
  // multiplier out. Only the expander reads these (`rich`), so no count that
  // parse() already computes can move.
  var MULT_WORD_RE = /^\s*[,]?\s*(?:rep(?:eat)?\s*)?(twice|thrice|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(more\s+)?times?\b/i;

  // Scan an instruction into items: plain text runs and bracket groups.
  function scanItems(s, rich) {
    var items = [];
    var buf = '';
    var i = 0;
    while (i < s.length) {
      var ch = s.charAt(i);
      var close = null;
      if (ch === '(') close = ')';
      else if (ch === '[') close = ']';
      else if (ch === '*' && /[a-z0-9]/i.test(s.charAt(i + 1) || '')) close = '*';
      if (!close) { buf += ch; i++; continue; }
      var end = s.indexOf(close, i + 1);
      if (end < 0) { buf += ch; i++; continue; }
      var inner = s.slice(i + 1, end);
      var after = s.slice(end + 1);
      var mult = 1, consumed = 0, filled = false;
      var mm = MULT_RE.exec(after);
      if (mm) {
        consumed = mm[0].length;
        if (mm[4]) mult = 2;
        else {
          mult = num(mm[1] || mm[2]);
          if (mm[3]) mult += 1; // "5 more times" = 6 total
        }
      } else {
        var wm = rich ? MULT_WORD_RE.exec(after) : null;
        if (wm) {
          consumed = wm[0].length;
          mult = wordNum(wm[1]);
          if (!(mult > 0)) mult = 1;
          else if (wm[2]) mult += 1;
        } else {
          var fm = FILL_AROUND_RE.exec(after);
          if (fm) { filled = true; consumed = fm[0].length; }
        }
      }
      if (buf.trim()) { items.push({ kind: 'text', text: buf }); }
      buf = '';
      items.push({ kind: 'group', text: inner, mult: mult, filled: filled });
      i = end + 1 + consumed;
    }
    if (buf.trim()) items.push({ kind: 'text', text: buf });
    return items;
  }

  // Fill `prev` stitches with a repeating group of (gp produced, gc consumed).
  function fillGroup(gp, gc, prev) {
    if (prev == null || gc <= 0) return null;
    var groups = Math.floor(prev / gc);
    var leftover = prev - groups * gc;
    return groups * gp + leftover;
  }

  // Open-ended fills: the row says "keep going in the established pattern to
  // the end of the row", so the count is simply the previous count. Token
  // math is NOT attempted on the rest of the line (the bracketed stitch
  // pattern of such a row - e.g. "[skip the next st, sc in next, work a puff
  // st into the skipped st]" - is net-neutral, not literally countable).
  var OPEN_FILL_RE = new RegExp(
    '\\bwork\\s+across\\b' +
    '|\\bwork\\s+(?:even\\s+)?in\\s+(?:the\\s+)?(?:established\\s+)?pattern\\b' +
    '|\\bcontinue\\s+(?:working\\s+)?in\\s+(?:the\\s+)?(?:established\\s+)?pattern\\b' +
    '|\\brep(?:eat)?\\s+from\\s*\\*\\s*(?:across|around|to\\s+(?:the\\s+)?end)\\b' +
    '|\\bto\\s+(?:the\\s+)?end\\b', 'i');

  // The subset of OPEN_FILL_RE that says outright "keep going in the stitch
  // pattern" - a net-neutral bracket the expander must NOT try to count
  // ("[skip the next st, sc in next, work a puff st into the skipped st] work
  // across" eats two stitches and makes two, and reads as three). A
  // `rep from *` is not in here: that one the expander can read stitch for
  // stitch, and a granny round depends on it.
  var OPEN_FILL_VAGUE_RE = new RegExp(
    '\\bwork\\s+across\\b' +
    '|\\bwork\\s+(?:even\\s+)?in\\s+(?:the\\s+)?(?:established\\s+)?pattern\\b' +
    '|\\bcontinue\\s+(?:working\\s+)?in\\s+(?:the\\s+)?(?:established\\s+)?pattern\\b', 'i');

  function evaluate(instruction, prevCount) {
    if (instruction == null) return null;
    var prev = (typeof prevCount === 'number' && isFinite(prevCount)) ? prevCount : null;
    var s = normDashes(normUnicode(instruction));
    s = fixTypos(s);

    // Drop a leading row marker if the caller passed a whole line. A bare
    // numeral marker ("3.") leaves the keyword behind ("3. Rnd: ..."), so take
    // that off too or the whole instruction reads as prose (03 #12).
    var mk = detectMarker(s.trim());
    if (mk) s = stripRowKeyword(mk.rest);
    s = s.toLowerCase().trim();
    if (!s) return null;

    if (prev !== null && OPEN_FILL_RE.test(s)) return prev;

    // "X, Y, repeat around" - the comma list before the marker is the group.
    var repAround = /\b(?:rep(?:eat)?)\s+(?:around|across|to\s+end)\b/i.exec(s);
    var tailFill = false;
    if (repAround) { s = s.slice(0, repAround.index); tailFill = true; }

    var items = scanItems(s);
    if (!items.length) return null;

    var total = 0, consumed = 0, fill = null, filledGroup = null;

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.kind === 'text') {
        var r = sumSegments(splitSegments(it.text));
        if (!r) return null;
        if (r.abs !== undefined) return r.abs;
        if (r.fill) { if (fill) return null; fill = r.fill; }
        total += r.p; consumed += r.c;
      } else {
        var g = sumSegments(splitSegments(it.text));
        if (!g || g.abs !== undefined || g.fill) {
          // Un-parsable parenthetical with no multiplier: treat as commentary.
          if (it.mult === 1 && !it.filled && (!g || !g.fill)) continue;
          return null;
        }
        if (it.filled) {
          if (filledGroup) return null;
          filledGroup = g;
        } else {
          total += g.p * it.mult;
          consumed += g.c * it.mult;
        }
      }
    }

    if (filledGroup) {
      var rest = (prev == null) ? null : prev - consumed;
      var got = fillGroup(filledGroup.p, filledGroup.c, rest);
      return got == null ? null : total + got;
    }

    if (tailFill) {
      if (total === 0 && consumed === 0) return null;
      var rest2 = (prev == null) ? null : prev;
      return fillGroup(total, consumed, rest2);
    }

    if (fill) {
      if (prev == null) return null;
      var remaining = prev - consumed;
      if (remaining < 0) return null;
      if (fill.c <= 0) return null;
      var whole = Math.floor(remaining / fill.c);
      var left = remaining - whole * fill.c;
      return total + whole * fill.p + left;
    }

    if (total === 0 && consumed === 0) return null;
    return total;
  }

  // =====================================================================
  // 7. Headers, notes, repeat suggestions
  // =====================================================================

  // Words that are never a part on their own; stripped from the end of a
  // header ("BODY EYES" -> "Body"). If nothing is left the line is a note.
  var NON_PART = ['eyes', 'eye', 'assembly', 'notes', 'note', 'materials',
    'terminology', 'abbreviations', 'finishing', 'tips', 'tip', 'gauge',
    'sizing', 'sizes', 'size', 'instructions', 'instruction', 'or', 'and',
    'supplies', 'difficulty', 'pattern', 'placement', 'facial', 'sculpting',
    'finished', 'shaping', 'colours', 'colors',
    // the reference furniture of the commercial one-pagers
    'special', 'abbreviation', 'explanation', 'guide', 'stitches', 'stitch',
    'contents', 'tension', 'measurements', 'measurement', 'notions', 'level',
    'skill', 'chart', 'charts', 'key', 'diagram', 'diagrams', 'yarn', 'yarns',
    'hook', 'hooks', 'information', 'info', 'required', 'requirements',
    'general', 'your', 'used', 'needed', 'questions', 'warning', 'copyright'];

  // Whole headings that are never a part, however they are worded. NON_PART
  // only strips words off the END of a name, so "Warning - Copyright",
  // "Stitches Used" and "Yarn Requirements" survived it and turned into parts
  // in the Stylecraft and Lion Brand one-pagers.
  var NON_PART_PHRASE_RE = new RegExp('^(?:' + [
    'warning\\b.*', 'special\\b.*', 'stitch(?:es)?\\s+(?:used|guide|explanation|key)',
    'abbreviations?\\b.*', 'yarn\\s+(?:requirements?|quality)', 'materials?\\s+required',
    'you\\s+will\\s+need', 'what\\s+you\\s+(?:will\\s+)?need',
    '(?:finished\\s+)?measurements?', 'tension', 'gauges?', 'skill\\s+level',
    'table\\s+of\\s+contents', 'contents', 'notions?', 'pattern\\s+(?:notes?|information)',
    'info(?:rmation)?\\s+and\\s+tips', 'additional\\s+materials?', 'stitch\\s+guide',
    'difficulty', 'questions?', 'hashtags\\b.*', 'to\\s+fit\\b.*',
    '(?:to\\s+)?mak(?:e|ing)\\s+up', 'adult\\b.*', 'one\\s+size',
    'letter\\s+from\\s+the\\s+editors?', 'the\\s+antique\\s+pattern\\s+library',
    // a stray row keyword that a column break left standing on its own
    'rows?', 'rnds?', 'rounds?',
    // a designer credit on the cover ("By Eleonora Tully of Coastal Crochet")
    'by\\s+[a-z].*', 'design(?:ed)?\\s+by\\b.*'
  ].join('|') + ')$', 'i');

  // ...but a couple of those are a crocheted piece in their own right in some
  // patterns ("Eye" with its own rounds) and only a face-detail caption in
  // others ("BODY / EYES" above a note on eye placement). A header that is
  // nothing but such a word comes back marked `weak`; classify() promotes it
  // to a real header only when the very next line starts its rounds.
  var STANDALONE_OK = { eye: true, eyes: true };

  // A part name is a noun phrase. Crochet instructions are written as
  // imperatives and "Make a Magic Ring" / "Use Orange Yarn" happen to be in
  // Title Case, so rule the verbs out before Title Case lets them through.
  // One-word lines are left alone: a part really can be called "Join".
  var IMPERATIVE_RE = /^(?:make|use|using|start|begin|work|continue|repeat|rep|sew|stuff|fasten|join|attach|turn|skip|insert|place|add|cut|leave|change|weave|thread|pull|fold|close|mark|pinch|do|don'?t|now|then|next|follow|check|keep|take|hold|count)\b/i;

  // Photo captions / column labels: "A", "E F", "I J K", "(PHOTO M-N)".
  var PHOTO_LABEL_RE = /^(?:\(?\s*photos?\s+[a-z](?:\s*-\s*[a-z])?\s*\)?|(?:[A-Z]\s+)*[A-Z])$/;

  function isPhotoLabel(t) { return !!t && t.length <= 24 && PHOTO_LABEL_RE.test(t); }

  var MAKE_RES = [
    /^(.*?)\s*\(\s*(?:make\s*)?x?\s*(\d+)\s*\)\s*$/i,
    /^(.*?)\s*\(\s*(\d+)\s*x\s*\)\s*$/i,          // "Feet - green (4x)"
    /^(.*?)\s*-\s*make\s*(\d+)\s*$/i,
    /^(.*?)\s+x\s*(\d+)\s*$/i,
    /^(.*?)\s+make\s*(\d+)\s*$/i,
    // "Cuffs (make 2 - worked lengthwise)": the bracket carries a note as well
    // as the count, so the strict forms above never saw it.
    /^(.*?)\s*\(\s*make\s+(\d+)\b[^)]*\)\s*$/i,
    // "Mitts (make two alike)" - Stylecraft spells the count out.
    /^(.*?)\s*\(\s*make\s+(two|three|four|five|six|seven|eight|nine|ten)\b[^)]*\)\s*$/i
  ];

  // Translated patterns hang the yarn colour off the part name:
  //   "Shell - brown:"   "Feet - green (4x):"   "Body in light blue:"
  // That is a note about the piece, not part of its name. The tail is only
  // dropped when colorHex() actually recognises it as a colour, so a part
  // genuinely called "Front - Back" or "Hat in Rounds" keeps its name.
  var HEADER_DASH_COLOUR_RE = /^(.+?[A-Za-z])\s*-\s*([A-Za-z][A-Za-z -]*?)\s*$/;
  var HEADER_IN_COLOUR_RE = /^(.+?[A-Za-z])\s+in\s+([A-Za-z][A-Za-z -]*?)\s*$/i;

  function stripColourSuffix(s) {
    var res = [HEADER_DASH_COLOUR_RE, HEADER_IN_COLOUR_RE];
    for (var i = 0; i < res.length; i++) {
      var m = res[i].exec(s);
      if (m && m[1].trim() && colorHex(m[2])) return m[1].trim();
    }
    return s;
  }

  var ALLCAPS_RE = /^[A-Z][A-Z '&\/-]*$/;
  // A slash joins two names into one heading for a piece that is worked in
  // one go ("Body/Head", "Body / Head"), so a slash-joined run of Title Case
  // words is one title word. Without this "Body/Head" reads as prose.
  var TITLE_WORD = "[A-Z][a-z'-]*(?:\\s*\\/\\s*[A-Z][a-z'-]*)*";
  var TITLE_RE = new RegExp(
    '^(' + TITLE_WORD + ')(\\s+(' + TITLE_WORD + '|&|of|the|and|in|a|for|to|with))*$');

  // -> { name, makeCount } | 'note' | null
  function headerInfo(t) {
    if (!t || t.length > 40) return null;
    if (isPhotoLabel(t)) return 'note';
    var s = t.replace(/\s*:\s*$/, '').trim();
    // trailing column/photo label letters: "Legs G" -> "Legs"
    s = s.replace(/(?:\s+[A-Z]){1,3}$/, function (m2, off) { return off > 0 ? '' : m2; }).trim();
    if (!s) return null;
    var makeCount = 1;
    for (var i = 0; i < MAKE_RES.length; i++) {
      var m = MAKE_RES[i].exec(s);
      if (m && m[1].trim()) {
        s = m[1].trim();
        makeCount = num(m[2]) || WORD_NUM[String(m[2]).toLowerCase()] || 1;
        break;
      }
    }
    // The colon can sit BEFORE the make-count ("Arms: (Make 2)", "Ears:
    // (make 2)"), so the name is left holding it once the count is off.
    s = s.replace(/\s*:\s*$/, '').trim();
    if (!s) return null;
    s = stripColourSuffix(s);
    if (NON_PART_PHRASE_RE.test(s)) return 'note';
    if (!/^[A-Za-z][A-Za-z '&\/-]*$/.test(s)) return null;
    if (!ALLCAPS_RE.test(s) && !TITLE_RE.test(s)) return null;
    if (/\s/.test(s) && IMPERATIVE_RE.test(s)) return null;

    // strip trailing non-part words
    var words = s.split(/\s+/);
    while (words.length && NON_PART.indexOf(words[words.length - 1].toLowerCase()) >= 0) {
      words.pop();
    }
    if (!words.length) {
      // Nothing but non-part words. A single one of the few that can also be
      // a real piece ("Eye") is offered as a weak header for classify() to
      // confirm; everything else is just a caption.
      var only = s.split(/\s+/);
      if (only.length === 1 && STANDALONE_OK[only[0].toLowerCase()]) {
        return { name: titleCase(s), makeCount: makeCount, weak: true };
      }
      return 'note';
    }
    var name = words.join(' ');
    if (name.replace(/[^A-Za-z]/g, '').length < 3) return 'note';
    return { name: titleCase(name), makeCount: makeCount };
  }

  // "Stem: With MC, ch 40. Sl st in 2nd ch from hook..." -> header + row 1
  var NAME_ROW_RE = /^([A-Za-z][A-Za-z '&\/-]{1,38}):\s*(\S.*)$/;
  // "WRAP: Beg at long bottom edge, ch 406." (Premier), "Edging: Ch 2. 1 hdc
  // in each st across" (Bernat), "Ribbing: With smaller hook, ch 11." (Patons):
  // the commercial one-pagers open a part with "Beg"/"Beginning at"/"Starting"
  // as often as with a stitch.
  var INSTR_START_RE = new RegExp('^(?:with|using|work|join|fsc|magic|beg(?:in|inning)?\\b|start(?:ing)?\\b|mr\\b|ch(?:ain)?\\s*\\d|ch(?:ain)?\\b|\\d+\\s*(?:' + STITCH_ALT + ')\\b|' + STITCH_ALT + '\\b)', 'i');

  function nameRowInfo(t) {
    var m = NAME_ROW_RE.exec(t);
    if (!m) return null;
    // Abbreviation glossary rows ("Slst: Slip Stitch", "Inc: Sc Increase")
    // look exactly like a one-line part, so rule them out: a short name, a
    // short expansion and not a number in sight.
    if (m[1].trim().length <= 5 && m[2].length < 40 && !/\d/.test(m[2])) return null;
    var h = headerInfo(m[1] + ':');
    if (!h || h === 'note' || h.weak) return null;
    if (!INSTR_START_RE.test(m[2])) return null;
    // "WRAP: Beg at long bottom edge, ch 406." is the foundation chain, not
    // row 1 - Row 1 is printed on the next line. A rest that is nothing but a
    // starting chain is a setup; "Stem: With MC, ch 40. Sl st in 2nd ch from
    // hook..." carries real stitches after the chain and stays row 1.
    var foundation = FOUNDATION_ONLY_RE.test(m[2]);
    return { name: h.name, makeCount: h.makeCount, rest: m[2],
             foundation: foundation, prefixLen: t.length - m[2].length };
  }

  var FOUNDATION_ONLY_RE = /^[^.!?]*\b(?:ch|chain)\s*\d+\s*(?:\([^)]*\))?\s*[.,;]?\s*$/i;

  // A running head ("WHEAT STITCH CROCHET CARDIGAN" on every page) reads like
  // a section header, so collect the repeats up front and refuse to name a
  // section after one. Short repeated names (BODY, WINGS) are real parts.
  function findRunningHeads(raws) {
    var counts = {}, firsts = {}, pageStart = true, i, t, key;
    for (i = 0; i < raws.length; i++) {
      t = trimLine(raws[i]);
      if (/^===\s*page\b/i.test(t)) { pageStart = true; continue; }
      if (!t) continue;
      key = t.toLowerCase().replace(/\s+/g, ' ');
      counts[key] = (counts[key] || 0) + 1;
      if (pageStart) { firsts[key] = (firsts[key] || 0) + 1; pageStart = false; }
    }
    var heads = {};
    Object.keys(counts).forEach(function (k) {
      var wordy = k.split(' ').length >= 3 || k.length >= 18;
      if ((firsts[k] || 0) >= 2 || (counts[k] >= 2 && wordy)) heads[k] = true;
    });
    return heads;
  }

  function headKey(t) { return t.toLowerCase().replace(/\s+/g, ' '); }

  var NOTE_KEY_RE = /^(?:colou?r\s+change|invisible\s+colou?r\s+change|change\b|switch\b|add\b|stuff\b|start\b|begin\b|tie\s+off|fasten\b|fo\b|sl\s*st|slst|join\b|place\b|insert\b|attach\b|sew\b|embroider\b|do\s*not\b|don'?t\b|put\b|with\b|cut\b|leave\b|leaving\b|finish\b|close\b|before\b|after\b|now\b|next\b|make\s+sure|mark\b|pinch\b|fold\b|work\b|continue\b|optional\b|using\b|in\s+colou?r\b|with\s+colou?r\b|in\s+(?:yellow|black|white|grey|gray|brown|pink|red|blue|green|mc|cc)\s*[.,]?\s*$|in\s+(?:colou?r\s+)?[a-z][a-z]*\s*[:.]?\s*$)/i;

  // Front-matter headings. A part name never sits above the materials list or
  // the abbreviation table, so one of these ends the cover page: a name the
  // first section picked up from a title further up ("SNOWMAN" three pages
  // before the rows) is dropped and the pending header group is cleared.
  var FRONT_MATTER_RE = /^(?:materials?(?:\s+required)?|supplies|tools?|you\s+will\s+need|what\s+you\s+(?:will\s+)?need|abbreviations?|terminolog(?:y|ies)|terms(?:\s+used)?|glossary|gauges?|tension|difficulty|yarn\s+requirements?|(?:finished\s+)?measurements?|special\s+stitches|pattern\s+notes?|notions?|skill\s+level)\s*[:.]?\s*$/i;

  // --- a NEW DESIGN inside one file (06 #15) ---------------------------
  // A multi-pattern ebook, a "2 easy crochet designs" leaflet and a "Small,
  // Medium & Large" toy sheet all put several complete patterns in one PDF.
  // A heading that is followed by its OWN front matter - a materials list, a
  // gauge box or a designer byline - before any row is not another part of the
  // piece above it: it is the start of a different design, and the row counter
  // has to start again there or the ebook hands back one 138-row "Shawl".
  var DESIGN_FRONT_RE = /^(?:materials?|supplies|you\s+will\s+need|what\s+you\s+(?:will\s+)?need|gauge|tension|finished\s+measurements?|measurements?|yarn\s+requirements?|skill\s+level|abbreviations?)\s*[:.]?/i;
  var BYLINE_DESIGN_RE = /^(?:by|design(?:ed)?(?:\s+by)?)\s*:?\s+[A-Z]/;
  var DESIGN_LOOKAHEAD = 8;

  function isDesignStart(raws, i) {
    var seen = 0;
    for (var j = i + 1; j < raws.length && seen < DESIGN_LOOKAHEAD; j++) {
      var t = trimLine(raws[j]);
      if (!t || isFurniture(t)) continue;
      seen++;
      if (DESIGN_FRONT_RE.test(t) || BYLINE_DESIGN_RE.test(t)) return true;
      if (detectMarker(t) || detectSetup(t)) return false;   // just another part
    }
    return false;
  }

  // An abbreviation table ("MR- Magic ring", "SC - Single crochet", "HDCInc-
  // Half-double crochet increase") is front matter whatever its heading says,
  // so a heading that sits straight on top of one ("Stitch Terms") must never
  // name a section. Deliberately strict: the definitions have to start on the
  // very next line and a row marker anywhere in the run means it is a part
  // whose first lines happen to name colours ("MC - main colour" then "R1:").
  var GLOSSARY_DEF_RE = /^[A-Za-z][A-Za-z0-9]{0,9}\s*[-:]\s*[A-Za-z]/;
  var GLOSSARY_LOOKAHEAD = 4;

  function looksLikeGlossary(raws, i) {
    var defs = 0, seen = 0;
    for (var j = i + 1; j < raws.length && seen < GLOSSARY_LOOKAHEAD; j++) {
      var t = trimLine(raws[j]);
      if (!t || PAGE_MARK_RE.test(t)) continue;
      seen++;
      if (detectMarker(t) || detectSetup(t)) return false;
      if (GLOSSARY_DEF_RE.test(t)) defs++;
      else if (seen === 1) return false;   // must start immediately
    }
    return defs >= 2;
  }

  // Lines that may sit between two headers without breaking the header group.
  var COLOUR_NOTE_RE = /^(?:in\s+(?:colou?r\s+)?[a-z][a-z0-9]*\s*[:.,]?|\(\s*[a-z]\s*=\s*[a-z]+\s*\))$/i;

  // Words that make a line continue into the next one (note paragraphs).
  var CONNECTOR_RE = /(?:,|-|\b(?:the|of|and|a|an|for|to|between|in|is|you|your|be|with|or|on|at|from|as|are|if|this|that|will|it|into|until|each|up|do))\s*$/i;

  function isAttachableNote(t) {
    return !!t && t.length <= 220 && NOTE_KEY_RE.test(t);
  }

  // --- repeat lines -----------------------------------------------------

  var REPEAT_RE = /\b(?:rep|repeat)\s+(?:rows?|rnds?|rounds?)\s*(\d+)\s*(?:-|to|&|and)\s*(\d+)/i;
  // "Rep 2nd to 5th rows for Basketweave Pat until piece measures approx 56""
  // and "Rep rows 8-11, 29 times more" - the ordinal spelling of the same
  // thing, which the whole Yarnspirations / Stylecraft corpus uses.
  var REPEAT_ORD_RE = /\b(?:rep|repeat)\s+(\d+)\s*(?:st|nd|rd|th)\s*(?:-|to|&|and)\s*(\d+)\s*(?:st|nd|rd|th)\s*(?:rows?|rnds?|rounds?)/i;
  // "Rep last row until work measures 36"", "Rep last 2 rows 11 times more",
  // "Repeat Row 2 until blanket measures approximately 59"". The block being
  // repeated is "the N rows just worked", so the row numbers are resolved by
  // the parse loop from the section's own last row - see resolveRepeat.
  var REPEAT_LAST_RE = /\b(?:rep|repeat)\s+(?:the\s+)?last\s+(\d+|two|three|four)?\s*(?:rows?|rnds?|rounds?)\b/i;
  var REPEAT_ONE_RE = /\b(?:rep|repeat)\s+(?:rows?|rnds?|rounds?)\s*(\d+)\b(?!\s*(?:-|to|&|and)\s*\d)/i;
  var REPEAT_ONE_ORD_RE = /\b(?:rep|repeat)\s+(\d+)\s*(?:st|nd|rd|th)\s*(?:rows?|rnds?|rounds?)\b/i;
  var WORD_NUM = { two: 2, twice: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

  function detectRepeat(t, size) {
    var m = REPEAT_RE.exec(t) || REPEAT_ORD_RE.exec(t);
    var lastCount = null;
    if (!m) {
      var ml = REPEAT_LAST_RE.exec(t);
      if (ml) {
        m = ml;
        lastCount = ml[1] ? (WORD_NUM[String(ml[1]).toLowerCase()] || num(ml[1]) || 1) : 1;
      }
    }
    if (!m) m = REPEAT_ONE_RE.exec(t) || REPEAT_ONE_ORD_RE.exec(t);
    if (!m) return null;
    var startRow = lastCount === null ? num(m[1]) : null;
    var endRow = lastCount === null ? (m[2] === undefined ? startRow : num(m[2])) : null;
    var after = t.slice(m.index + m[0].length);
    var untilRows = null, times = null;

    var u = /until\b([\s\S]*)$/i.exec(after);
    if (u) {
      var segAll = u[1];
      var seg = segAll.split(/\.(?!\d)/)[0];
      // A number that SAYS it counts rows wins wherever it is in the sentence:
      // "until work measures 10 inches long, approx. 44 rows." is 44 rows, not
      // 10 (King Cole's pumpkins), and "until there are a total of 25 (29, 33)
      // Rows" is 25 (the cardigan).
      var mlRow = new RegExp(MULTI_SRC + '\\s*(?:total\\s+)?rows?\\b', 'i').exec(segAll);
      var plainRow = /(\d+)\s*(?:total\s+)?rows?\b/i.exec(segAll);
      var ml = MULTI_ANY.exec(seg);
      if (mlRow) untilRows = pickSize(flattenMulti(mlRow), size);
      else if (plainRow) untilRows = num(plainRow[1]);
      else if (ml) untilRows = pickSize(flattenMulti(ml), size);
      else {
        // ...otherwise the first number that is not a MEASUREMENT: "until
        // piece measures approx 56" [142 cm]" sets no row target at all.
        var scan = /(\d+)([^\d]*)/g, hit;
        while ((hit = scan.exec(seg)) !== null) {
          if (MEASURE_AFTER_RE.test(hit[2])) continue;
          untilRows = num(hit[1]);
          break;
        }
      }
    }
    var tm = /\bx\s*(\d+)\b/i.exec(after);
    if (tm) times = num(tm[1]);
    if (times === null) {
      // "11 times more" and "11 more times" are the same instruction; both
      // mean the block is worked one more time than the number says.
      var tw = /\b(\d+|two|three|four|five|six|seven|eight|nine|ten|twice)\s*(more\s+)?times?(\s+more)?\b/i.exec(after);
      if (tw) {
        var v = /^\d+$/.test(tw[1]) ? num(tw[1]) : WORD_NUM[tw[1].toLowerCase()];
        if (v) times = v + ((tw[2] || tw[3]) ? 1 : 0);
      }
    }
    return { startRow: startRow, endRow: endRow, times: times, untilRows: untilRows,
             lastCount: lastCount };
  }

  /**
   * Turn "repeat the last 2 rows" into real row numbers once we know where the
   * section had got to. `lastRow` is the section's last row number (null when
   * it has none yet, in which case the repeat has nothing to point at).
   */
  function resolveRepeat(rep, lastRow) {
    var out = { startRow: rep.startRow, endRow: rep.endRow,
                times: rep.times, untilRows: rep.untilRows };
    if (rep.lastCount && typeof lastRow === 'number' && lastRow >= rep.lastCount) {
      out.endRow = lastRow;
      out.startRow = lastRow - rep.lastCount + 1;
    }
    return out;
  }

  // --- back-references: a row that only says "work an earlier row again" ---
  //
  // These are the bulk of every garment pattern, and until now the rows the
  // expander read as NOTHING at all (03 #6): a 46-row Premier wrap came out as
  // two real rows and 44 slivers, and all fifteen rounds of the Stylecraft hex
  // socks were empty. `backRefRows` turns the sentence into the row numbers it
  // points at; parse() stores them on the line as `repeatOf` and expand()
  // re-runs THAT row's words against the CURRENT stitch count, so a shaping
  // repeat keeps growing or shrinking instead of freezing.
  //
  // Every form is anchored at the START of the instruction, so a row that does
  // its own work and only then says "rep rows 1-2" keeps its own words:
  //
  //   rep rows 4 and 5 / rows 4 & 5 / rows 4-5 / rows 4 to 5    -> [4, 5]
  //   rep row 2 / rep rnd 3 / repeat round 3                    -> [2] / [3]
  //   rep 2nd row / rep 2nd to 5th rows                         -> [2] / [2..5]
  //   as row 2 / work as row 2 / same as rows 3 and 4           -> [2] / [3, 4]
  //   rep last 2 rows / rep the last two rows / rep last row     -> the N before
  //   continue in pattern as set / work even as established      -> the row before
  //
  // "work as for First Leg" names another PART, which nothing here can line up
  // row for row, so it matches none of these and is left to the generic
  // reading on purpose - a wrong row is worse than an honest generic one.
  var REF_VERB = '(?:rep(?:eat)?(?:ing)?|work(?:ing|ed)?|cont(?:inue|inuing)?)';
  var REF_AS = '(?:(?:same\\s+)?as(?:\\s+for)?)';
  var REF_KW = '(?:rows?|rnds?|rounds?)';
  var REF_ORD = '(?:st|nd|rd|th)';
  // an optional "(RS)"/"(WS)" the marker left behind, then the verb and/or "as"
  var REF_HEAD = '^(?:\\(\\s*(?:ws|rs|wrong\\s+side|right\\s+side)\\s*\\)\\s*[:.,]?\\s*)?' +
    '(?:' + REF_VERB + '\\s+(?:' + REF_AS + '\\s+)?|' + REF_AS + '\\s+)' +
    '(?:the\\s+)?(?:in\\s+)?';

  var REF_RANGE_RE = new RegExp(REF_HEAD + REF_KW + '\\s*(\\d+)\\s*(?:-|to|&|and)\\s*(\\d+)\\b', 'i');
  var REF_ORD_RANGE_RE = new RegExp(REF_HEAD + '(\\d+)' + REF_ORD + '\\s*(?:-|to|&|and)\\s*(\\d+)' +
    REF_ORD + '\\s*' + REF_KW + '\\b', 'i');
  var REF_ONE_RE = new RegExp(REF_HEAD + REF_KW + '\\s*(\\d+)\\b', 'i');
  var REF_ORD_ONE_RE = new RegExp(REF_HEAD + '(\\d+)' + REF_ORD + '\\s+' + REF_KW + '\\b', 'i');
  var REF_LAST_RE = new RegExp('^' + REF_VERB + '\\s+(?:the\\s+)?last\\s+(\\d+|one|two|three|four)?\\s*' +
    REF_KW + '\\b', 'i');
  // "Continue in pattern as set", "work even as established", "as before" - the
  // designer means "whatever you have been doing", which is the row before.
  var REF_SET_RE = new RegExp('^(?:' + REF_VERB + '\\s+)?(?:even\\s+)?(?:in\\s+)?' +
    '(?:(?:the\\s+)?patt(?:ern)?\\s+)?' + REF_AS + '\\s+(?:set|established|before)\\b', 'i');

  // No repeat can point at more rows than this; a bigger range is a misreading.
  var REF_SPAN_MAX = 64;

  function refRange(a, b) {
    var out = [], i;
    if (!(a >= 1) || !(b >= a) || b - a >= REF_SPAN_MAX) return null;
    for (i = a; i <= b; i++) out.push(i);
    return out;
  }

  /**
   * The rows a back-reference points at, as absolute row numbers, or null.
   * @param {string} instr  the row's instruction, row marker already off
   * @param {number} row    the FIRST row the reference is worked on - what
   *   "the last 2 rows" and "as set" are measured back from.
   * @returns {number[]|null}
   */
  function backRefRows(instr, row) {
    var t = String(instr == null ? '' : instr).replace(/^[\s,;:.-]+/, '');
    if (!t) return null;
    var m, rows = null;
    if ((m = REF_RANGE_RE.exec(t)) || (m = REF_ORD_RANGE_RE.exec(t))) {
      rows = refRange(num(m[1]), num(m[2]));
    } else if ((m = REF_ONE_RE.exec(t)) || (m = REF_ORD_ONE_RE.exec(t))) {
      rows = refRange(num(m[1]), num(m[1]));
    } else if ((m = REF_LAST_RE.exec(t))) {
      var n = m[1] ? (WORD_NUM[String(m[1]).toLowerCase()] || num(m[1]) || 1) : 1;
      if (!(row >= 1) || n < 1 || n > REF_SPAN_MAX) return null;
      rows = refRange(row - n, row - 1);
    } else if (REF_SET_RE.test(t)) {
      if (!(row >= 2)) return null;
      rows = [row - 1];
    }
    if (!rows) return null;
    // A reference must point BACKWARDS at a row that really exists; "Row 5:
    // rep row 5" and "rep rows 4-9" written on row 4 are both nonsense.
    for (var i = 0; i < rows.length; i++) {
      if (!(rows[i] >= 1) || (row >= 1 && rows[i] >= row)) return null;
    }
    return rows;
  }

  /**
   * The line that carries `row`, preferring the section the reference was
   * written in. lineFor() prefers section 0 instead, which is right for the
   * app (it asks about one part at a time) and wrong here.
   */
  function refLineAt(lines, section, row) {
    var i, l, end, best = null;
    for (i = 0; i < lines.length; i++) {
      l = lines[i];
      if (!l || l.row === null || l.row === undefined || l.row < 1) continue;
      end = (l.rowEnd === null || l.rowEnd === undefined) ? l.row : l.rowEnd;
      if (row < l.row || row > end) continue;
      if (l.section === section) return l;
      if (!best) best = l;
    }
    return best;
  }

  /**
   * How many stitches ONE working of `row` added. A repeat of a row changes the
   * count by the same amount the row itself did - that is what makes a hexagon
   * a hexagon and a shawl a triangle - so this is what the repeated rows are
   * counted with. Reading it off a range line needs the per-row `counts`, or
   * "rep Rnd 3" written on a "Rnds 3-4" line would add the whole range's
   * growth every round. null when the row has no count to go by.
   */
  function refDelta(lines, section, row) {
    var l = refLineAt(lines, section, row);
    if (!l) return null;
    var before = l.prevCount, after = l.count, i;
    if (l.counts && l.row >= 1) {
      i = row - l.row;
      if (i >= 1) before = l.counts[i - 1];
      if (l.counts[i] !== undefined) after = l.counts[i];
    }
    if (after === null || after === undefined || before === null || before === undefined) return null;
    return after - before;
  }

  /**
   * One count per row of a back-referencing range, or null when none of them
   * can be worked out. `printed` is the total the line printed, if any: it
   * belongs to the LAST row of the range ("Row 6-55: Repeat rows 4 & 5 <57
   * sts>" is 57 at row 55, not at row 6), so it overrides that entry only.
   */
  function repeatCounts(lines, section, refs, prevIn, startRow, endRow, printed) {
    var end = (endRow === null || endRow === undefined || endRow < startRow) ? startRow : endRow;
    if (end - startRow >= 1000) end = startRow + 999;
    // One delta per referenced row, looked up once: a 1,000-row range over a
    // 2,000-line document would otherwise rescan the lines a million times.
    var deltas = [], j;
    for (j = 0; j < refs.length; j++) deltas.push(refDelta(lines, section, refs[j]));
    var out = [], prev = prevIn, any = false, i, d, c;
    for (i = startRow; i <= end; i++) {
      d = deltas[(i - startRow) % refs.length];
      c = (d === null || prev === null || prev === undefined) ? null : prev + d;
      if (c !== null) { any = true; prev = c; }
      out.push(c);
    }
    // ...but only when the range really ended here: a range long enough to be
    // capped above has no last row to hang the printed total on.
    if (printed !== null && printed !== undefined && (endRow === null || endRow === undefined || end === endRow || end === startRow)) {
      out[out.length - 1] = printed;
      any = true;
    }
    return any ? out : null;
  }

  /** The count a line publishes for one row of its range. */
  function countAt(line, row) {
    if (!line) return null;
    if (line.counts && line.row >= 1) {
      var c = line.counts[row - line.row];
      if (typeof c === 'number' && isFinite(c)) return c;
    }
    return (line.count === null || line.count === undefined) ? null : line.count;
  }

  // =====================================================================
  // 7b. Placing notes - "where things go"
  //
  // Two sources feed a section's `placement` string:
  //   a. an ASSEMBLY BLOCK - a heading such as "Assembly:" / "Finishing" /
  //      "Eyes deepen:" followed by prose with no row markers. It is not a
  //      part, it must not attach as notes to the part above it, and it never
  //      reaches a section's text. Its paragraphs are handed out to the parts
  //      they talk about (sub-label first, then a part name in the sentence,
  //      else the body/head/main part).
  //   b. IN-SECTION SENTENCES - "Attach safety eyes between R21&R22..." stays
  //      a row note (it is useful while counting) and is copied into its own
  //      part's placement as well.
  // =====================================================================

  // Page scaffolding and end-of-document furniture: never a line, a note or a
  // placing note.
  var PAGE_LINE_RE = /^===\s*page\b/i;
  var END_FURNITURE_RE = /^additional\s+photos?\s*:?\s*$/i;

  function isFurniture(t) {
    return !!t && (PAGE_LINE_RE.test(t) || END_FURNITURE_RE.test(t));
  }

  // --- running heads and back matter (03 #10) --------------------------
  // (a) A designer's title block ("WHEAT STITCH CROCHET CARDIGAN" / "by
  // Briana K Designs") is printed on every page at whatever y-position they
  // chose, so the geometric margin pass in PdfText does not always catch it
  // and the pattern sheet ends up showing it as a heading in the middle of
  // somebody's rounds. A line is page furniture when it is the document's
  // own title (it appears on the cover, before the first row) or a byline,
  // AND it turns up on two or more pages. Both halves are needed: a real
  // part name reprinted over its second column must survive.
  var BYLINE_RE = /^by\s+[A-Z]/;

  function titleFurniture(raws) {
    var pages = {}, cover = {}, out = {};
    var page = 0, seenRow = false, prevKey = null, i, t, key;
    for (i = 0; i < raws.length; i++) {
      t = trimLine(raws[i]);
      if (PAGE_LINE_RE.test(t)) { page++; continue; }
      if (!t) continue;
      if (!seenRow && detectMarker(t)) seenRow = true;
      var byline = t.length <= 60 && BYLINE_RE.test(t);
      // "<Pattern name>" / "by <Designer>" is a title block wherever it is
      // printed - no part is ever called "by someone" - so the pair goes
      // whether or not the geometry pass saw it repeat.
      if (byline) {
        out[headKey(t)] = true;
        if (prevKey) out[prevKey] = true;
      }
      var shaped = t.length <= 60 && !/[.!?,;:]/.test(t) &&
        (t.split(/\s+/).length >= 3 || t.length >= 18) &&
        !detectMarker(t) && !detectSetup(t) && !detectNextRow(t);
      prevKey = shaped ? headKey(t) : null;
      if (!shaped && !byline) continue;
      key = headKey(t);
      if (!seenRow || byline) cover[key] = true;
      if (!pages[key]) pages[key] = {};
      pages[key][page] = true;
    }
    Object.keys(pages).forEach(function (k) {
      if (cover[k] && Object.keys(pages[k]).length >= 2) out[k] = true;
    });
    return out;
  }

  // (b) Back matter: the designer's other patterns, the shop links and the
  // legal boilerplate. Cut from the first advert-shaped line to the end of
  // the document - but only once no row marker follows it, so a "click here"
  // in the middle of a pattern never truncates the pattern.
  var ADVERT_RE = /click\s+here|for\s+more\s+information|\bGPSR\b|^https?:|@[\w.-]+\.(?:com|co\.uk|net|org)\b/i;

  // A heading that opens a block of assembly prose. The line has to be nothing
  // but one of these words (a trailing colon is fine), so the "Finishing" that
  // bleeds off the next column into "Ear Finishing" still names the Ear, and
  // the prose line "sewing." is not mistaken for a heading.
  var ASSEMBLY_HEAD_RE = new RegExp('^(?:final\\s+)?(?:' + [
    'assembly', 'assembling', 'assemble',
    'finishing(?:\\s+(?:up|touches))?', 'finish',
    'making\\s+up', 'putting\\s+(?:it\\s+)?(?:all\\s+)?together',
    'sewing\\s+up', 'construction',
    'face(?:\\s+details?)?', 'embroidery', 'embroidering',
    'details?', 'eyes?\\s+deepen(?:ing)?'
  ].join('|') + ')$', 'i');

  function isAssemblyHead(t) {
    if (!t || t.length > 40) return false;
    if (/[.!?]$/.test(t)) return false;
    return ASSEMBLY_HEAD_RE.test(t.replace(/\s*:\s*$/, '').trim());
  }

  // "Muzzle -", "Horns -", "Muzzle:" - the label of one paragraph of assembly.
  var SUB_LABEL_RE = /^([A-Za-z][A-Za-z'&\/ -]{0,28}?)\s*[-:]\s*$/;

  // Verbs that put one piece on another. Gerunds are deliberately absent:
  // "leave a long tail for sewing" is not a placing note.
  var PLACE_VERBS = {
    sew: 1, sews: 1, attach: 1, attaches: 1, insert: 1, inserts: 1,
    place: 1, places: 1, position: 1, positions: 1, pin: 1, pins: 1,
    glue: 1, glues: 1, embroider: 1, embroiders: 1, mount: 1, mounts: 1
  };
  // The verb has to be one of the first few words, so the sentence reads as an
  // instruction ("Sew the nose in the center") and not as an aside that
  // happens to mention it ("FO and leave a long tail to sew to head").
  var PLACE_LEAD = 4;
  var STITCH_VERB_NEXT_RE = /^(?:the|it|them|on|onto|in|into|around|to)$/i;

  // Where it goes: a preposition, a landmark or a round/row/stitch reference.
  var PLACE_CUE_RE = /\b(?:between|onto|on|to|at|around|below|above|under|over|apart|centered|centred|center|centre|middle|underside|top|bottom|front|back|side|sides|next|rnds?|rounds?|rows?|sts?|stitches?)\b|\bR\s?\d/i;
  // ...or the thing being placed.
  var PLACE_NOUN_RE = /\b(?:eyes?|nose|noses|mouth|muzzles?|snouts?|beaks?|ears?|arms?|legs?|feet|foot|hands?|paws?|tails?|horns?|wings?|fins?|heads?|body|bodies|buttons?|key\s*rings?|keyrings?|eyebrows?|eyelids?|cheeks?|whiskers?|antennae?|pupils?|hats?|scarf|scarves|bows?|stars?|hearts?|petals?|leaf|leaves|spots?|stripes?|patch(?:es)?|pieces?|limbs?)\b/i;

  // "Note: ... placement ..." is a placing note however it is phrased.
  var NOTE_PLACE_RE = /^note\b[\s\S]*\bplacement\b/i;
  // A promise about a later step, not an instruction about this one.
  var FUTURE_RE = /^(?:(?:now|then|next|finally|first|also|and|so)\b[\s,]*)*(?:we|you|i|they)\s*(?:'ll|will|are\s+going\s+to|shall)\b/i;

  var SENTENCE_STOP_RE = /[.!?]["')\]]?$/;
  // Tokens whose full stop does not end a sentence. A bare number is the big
  // one: "2. 12sc, attach tail..." is one row, not a row marker plus a
  // sentence that reads like a placing note.
  var ABBREV_TOKEN_RE = /^(?:\d+(?:-\d+)?|[A-Za-z]|no|fig|approx|etc|vs|ca|rnd|rnds|st|sts)\.$/i;

  function placeWords(s) {
    return String(s).replace(/[^A-Za-z0-9'&()\[\]\/,.;:+-]+/g, ' ').trim().split(/\s+/);
  }

  function bareWord(w) { return String(w == null ? '' : w).toLowerCase().replace(/[^a-z]/g, ''); }

  /** A placing verb inside the first PLACE_LEAD words. */
  function placeVerbEarly(sentence) {
    var w = placeWords(sentence), n = Math.min(w.length, PLACE_LEAD), i, b;
    for (i = 0; i < n; i++) {
      b = bareWord(w[i]);
      if (PLACE_VERBS[b] === 1) return true;
      // "stitch" is a noun nine times out of ten; only "stitch it onto..."
      // style forms count.
      if (b === 'stitch' && STITCH_VERB_NEXT_RE.test(bareWord(w[i + 1]))) return true;
    }
    return false;
  }

  /** A placing verb anywhere - the looser test used inside assembly blocks. */
  function hasPlaceVerb(text) {
    var w = placeWords(text), i;
    for (i = 0; i < w.length; i++) if (PLACE_VERBS[bareWord(w[i])] === 1) return true;
    return false;
  }

  function splitSentences(s) {
    var toks = String(s).trim().split(/\s+/);
    var out = [], buf = [], i;
    for (i = 0; i < toks.length; i++) {
      if (!toks[i]) continue;
      buf.push(toks[i]);
      if (SENTENCE_STOP_RE.test(toks[i]) && !ABBREV_TOKEN_RE.test(toks[i])) {
        out.push(buf.join(' '));
        buf = [];
      }
    }
    if (buf.length) out.push(buf.join(' '));
    return out;
  }

  /** Does this sentence say where something goes? */
  function isPlacementSentence(s) {
    var t = String(s).replace(/\s+/g, ' ').trim();
    if (t.length < 12) return false;
    if (isFurniture(t)) return false;
    if (detectMarker(t) || detectSetup(t) || detectNextRow(t)) return false;
    if (NOTE_PLACE_RE.test(t)) return true;
    if (FUTURE_RE.test(t)) return false;
    if (!placeVerbEarly(t)) return false;
    return PLACE_CUE_RE.test(t) || PLACE_NOUN_RE.test(t);
  }

  /** A line that has come to a stop, so the next one starts a new thought. */
  function terminated(t) {
    return /[.!?:][)"'\]]?$/.test(String(t).replace(/\s+$/, ''));
  }

  /**
   * Blocks of assembly prose, and the page furniture, found up front so the
   * main loop can skip both.
   * @returns {{furniture:boolean[], assembly:boolean[], blocks:Array}}
   */
  function findSpecial(raws, size, heads) {
    var furniture = [], assembly = [], blocks = [];
    var i, j, k, t, u, cls, prose;
    var titles = titleFurniture(raws);
    for (i = 0; i < raws.length; i++) {
      t = trimLine(raws[i]);
      furniture[i] = isFurniture(t) || (!!t && !!titles[headKey(t)]);
    }

    // Back matter (03 #10b): from the first advert line that has no row
    // marker after it, to the end of the document.
    var lastRowAt = -1;
    for (i = raws.length - 1; i >= 0; i--) {
      t = trimLine(raws[i]);
      if (t && (detectMarker(t) || detectSetup(t) || detectNextRow(t))) { lastRowAt = i; break; }
    }
    for (i = lastRowAt + 1; i < raws.length; i++) {
      t = trimLine(raws[i]);
      if (!t || !ADVERT_RE.test(t)) continue;
      // A designer's tutorial link ("I've uploaded a video on my YouTube
      // channel https://youtu.be/...") sits in the MIDDLE of the finishing
      // pages, so an advert line alone cannot mean "the pattern is over". Real
      // back matter never has a Finishing / Assembly heading after it.
      var headAfter = false;
      for (k = i + 1; k < raws.length; k++) {
        if (isAssemblyHead(trimLine(raws[k]))) { headAfter = true; break; }
      }
      if (headAfter) continue;
      for (j = i; j < raws.length; j++) furniture[j] = true;
      break;
    }

    for (i = 0; i < raws.length; i++) {
      if (furniture[i]) continue;
      t = trimLine(raws[i]);
      if (!isAssemblyHead(t)) continue;
      prose = 0;
      for (j = i + 1; j < raws.length; j++) {
        u = trimLine(raws[j]);
        if (furniture[j]) {
          if (END_FURNITURE_RE.test(u)) break;   // the photo appendix ends it
          continue;                              // a page break does not
        }
        if (!u) continue;
        // "Muzzle -" / "Ears:" inside a block is a sub-label, and reads as a
        // header on its own. It is only a real part when its rounds start
        // right below it.
        if (SUB_LABEL_RE.test(u)) {
          var below = nextLine(raws, j);
          if (detectMarker(below) || detectSetup(below) || detectNextRow(below)) break;
          continue;
        }
        cls = classify(u, size, heads, nextLine(raws, j));
        if (cls.marker || cls.repeat || cls.nextRow || cls.setup || cls.nameRow || cls.header) break;
        if (FRONT_MATTER_RE.test(u)) break;
        prose++;
      }
      // A heading with rows straight under it is a part called "Finish", not
      // an assembly block.
      if (!prose) continue;
      assembly[i] = true;
      for (k = i + 1; k < j; k++) if (!furniture[k]) assembly[k] = true;
      blocks.push({ head: i, from: i + 1, to: j });
      i = j - 1;
    }
    return { furniture: furniture, assembly: assembly, blocks: blocks };
  }

  // Inside a finishing block, a NUMBERED step is needlework ("2. Then you
  // insert the needle again below the eye...") and a link is an advert. Neither
  // says where a piece goes, so neither belongs in a part's placing notes.
  var STEP_LEAD_RE = /^\d+\s*[.)]\s/;
  var LINK_RE = /https?:\/\/|\bwww\.[\w-]+\.[a-z]{2,}/i;

  /** Paragraphs of one assembly block, each with the sub-label above it. */
  function assemblyItems(lines, blk, heads) {
    var out = [], cur = null, label = '', i, l, t, m;
    for (i = blk.from; i < blk.to && i < lines.length; i++) {
      l = lines[i];
      if (!l || l.furniture) continue;
      t = trimLine(l.text);
      if (!t) { cur = null; continue; }
      if (isPhotoLabel(t)) { cur = null; continue; }
      if (STEP_LEAD_RE.test(t) || LINK_RE.test(t)) { cur = null; continue; }
      if (heads && heads[headKey(t)]) { cur = null; continue; }
      m = SUB_LABEL_RE.exec(t);
      if (m) { label = m[1].trim(); cur = null; continue; }
      if (cur && !terminated(cur.text)) { cur.text += ' ' + t; continue; }
      cur = { label: label, text: t };
      out.push(cur);
    }
    return out;
  }

  /** One item per thought inside a part: wrapped note lines are rejoined. */
  function sectionItems(ls) {
    var out = [], cur = null, i, l, t, isNote;
    for (i = 0; i < ls.length; i++) {
      l = ls[i];
      t = trimLine(l.text);
      if (!t) { cur = null; continue; }
      isNote = l.kind === 'note';
      if (cur && cur.note && isNote && l.index === cur.last + 1 && !terminated(cur.text)) {
        cur.text += ' ' + t;
        cur.last = l.index;
        continue;
      }
      cur = { text: t, note: isNote, last: l.index };
      out.push(cur);
    }
    return out;
  }

  // "Body/Head" answers to "body" and to "head"; "Ears" answers to "ear".
  function nameKeys(name) {
    var out = [];
    String(name || '').split(/\s*[\/&,]\s*|\s+and\s+/i).forEach(function (piece) {
      var p = piece.trim().toLowerCase().replace(/[^a-z' ]/g, '').trim();
      if (p.length < 3) return;
      out.push(p);
      if (/(?:ch|sh|s|x|z)$/.test(p)) out.push(p + 'es'); else out.push(p + 's');
      if (/ies$/.test(p)) out.push(p.replace(/ies$/, 'y'));
      if (/es$/.test(p)) out.push(p.replace(/es$/, ''));
      if (/s$/.test(p)) out.push(p.replace(/s$/, ''));
    });
    return out;
  }

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** The body/head/main piece an unaddressed assembly line belongs to. */
  function mainSectionIndex(secs) {
    for (var i = 0; i < secs.length; i++) {
      if (/\b(?:body|head|main)\b/i.test(secs[i].name || '')) return i;
    }
    return 0;
  }

  /**
   * The section a line of assembly talks about: the part name that comes
   * first in the text wins, and when a pattern has that part more than once
   * (three sizes of the same bee) the nearest one above the block does.
   */
  function matchPart(text, keyMap, keys, atLine, secs) {
    var bestAt = -1, bestKey = null, i, m;
    for (i = 0; i < keys.length; i++) {
      m = new RegExp('\\b' + escapeRe(keys[i]) + '\\b', 'i').exec(text);
      if (!m) continue;
      if (bestAt < 0 || m.index < bestAt || (m.index === bestAt && keys[i].length > bestKey.length)) {
        bestAt = m.index;
        bestKey = keys[i];
      }
    }
    if (bestKey === null) return -1;
    var cands = keyMap[bestKey], pick = -1;
    for (i = 0; i < cands.length; i++) {
      if (secs[cands[i]].startLine <= atLine) pick = cands[i];
    }
    return pick >= 0 ? pick : cands[0];
  }

  /**
   * Fill in each section's `placement`. `secs` are the real sections, each
   * carrying `startLine` and the `lines` that belong to it.
   */
  function distributePlacement(secs, lines, meta) {
    var buckets = secs.map(function () { return []; });
    var seen = secs.map(function () { return {}; });
    var keyMap = {}, keys = [];
    secs.forEach(function (s, ix) {
      nameKeys(s.name).forEach(function (k) {
        if (!keyMap[k]) { keyMap[k] = []; keys.push(k); }
        if (keyMap[k].indexOf(ix) < 0) keyMap[k].push(ix);
      });
    });
    var mainIx = mainSectionIndex(secs);

    function add(ix, text) {
      if (ix < 0 || ix >= buckets.length) return;
      var t = String(text).replace(/\s+/g, ' ').trim();
      if (!t) return;
      var key = t.toLowerCase();
      if (seen[ix][key]) return;
      seen[ix][key] = true;
      buckets[ix].push(t);
    }

    // (a) sentences inside a part
    secs.forEach(function (s, ix) {
      sectionItems(s.lines).forEach(function (item) {
        splitSentences(item.text).forEach(function (sent) {
          if (isPlacementSentence(sent)) add(ix, sent);
        });
      });
    });

    // (b) assembly blocks, handed out by name
    var blocks = (meta && meta.assemblyBlocks) || [];
    var heads = (meta && meta.heads) || null;
    blocks.forEach(function (blk) {
      assemblyItems(lines, blk, heads).forEach(function (item) {
        if (!hasPlaceVerb(item.text)) return;    // "Your fish is ready!" is not
        var ix = item.label ? matchPart(item.label, keyMap, keys, blk.head, secs) : -1;
        if (ix < 0) ix = matchPart(item.text, keyMap, keys, blk.head, secs);
        if (ix < 0) ix = mainIx;
        add(ix, item.label ? item.label + ': ' + item.text : item.text);
      });
    });

    secs.forEach(function (s, ix) { s.placement = buckets[ix].join('\n'); });
  }

  // =====================================================================
  // 8. parse() and friends
  // =====================================================================

  // Does a row line actually carry crochet instructions?
  // UK publishers glue the count to the stitch ("3ch, 2tr in ring"), and a
  // \b in front of "ch" never matches there - a digit and a letter are both
  // word characters. A whole Stylecraft round used to count as carrying no
  // instructions at all, which cost its part its name.
  var INSTR_ROW_RE = new RegExp(
    '(?:^|[^a-z])(?:' + STITCH_ALT + '|ch(?:ain)?|mr|magic|turn|join|work)(?![a-z])', 'i');

  function makeLine(i, raw) {
    return {
      index: i, text: raw, kind: 'note',
      row: null, rowEnd: null, section: 0,
      stitches: null, sizes: null, computed: null,
      count: null, countSource: null, notes: [],
      // --- back-references (03 #6) ---------------------------------------
      // prevCount: the count this row started from, so a later "rep row N" can
      //   see what row N added.
      // repeatOf: the rows this one re-works, in order; row R of the range
      //   re-works repeatOf[(R - repeatFrom) % repeatOf.length].
      // repeatFrom/repeatTo: which rows the reference covers. On a numbered row
      //   they are row/rowEnd; on a bare "Rep Row 2 until it measures 59\""
      //   sentence they are filled in after the parse loop, from the section's
      //   last written row and the repeat's own row target (null = open-ended).
      // counts: one count per row of the range, where they can be worked out.
      // repeatTimes/repeatUntil: what such a sentence said about how long to
      //   keep going ("20 times more", "until there are 25 Rows"), kept only
      //   until repeatTo can be worked out from them.
      prevCount: null, repeatOf: null, repeatFrom: null, repeatTo: null,
      repeatTimes: null, repeatUntil: null, counts: null
    };
  }

  // A two-column PDF can wrap a row onto the next line, leaving its stitch
  // count stranded there ("...turn." / "| 18 sts ..."). If the line right
  // after a row is plain continuation text carrying a count, use it.
  function continuationCount(raws, i) {
    if (i + 1 >= raws.length) return null;
    var t = trimLine(raws[i + 1]);
    if (!t) return null;
    if (detectMarker(t) || detectRepeat(t, 0) || detectNextRow(t) || detectSetup(t) || nameRowInfo(t)) return null;
    var h = headerInfo(t);
    if (h && h !== 'note') return null;
    return findExplicit(t);
  }

  /**
   * The row number of the first row marker within the next few printed lines,
   * or null. Used to tell "Name: <foundation chain>" from "Name: <row 1>": the
   * foundation is followed by Row/Rnd 1, and the sentence that carries it often
   * wraps, so nextLine() alone looks at the wrong line.
   */
  var MARKER_LOOKAHEAD = 4;

  function firstMarkerRowAhead(raws, i) {
    for (var j = i + 1, seen = 0; j < raws.length && seen < MARKER_LOOKAHEAD; j++) {
      var t = trimLine(raws[j]);
      if (!t || isFurniture(t)) continue;
      seen++;
      var mk = detectMarker(t);
      if (mk) return mk.row;
      if (headerInfo(t) && headerInfo(t) !== 'note') return null;
    }
    return null;
  }

  /** The next line with anything on it, for the lookaheads below. */
  function nextLine(raws, i) {
    for (var j = i + 1; j < raws.length; j++) {
      var t = trimLine(raws[j]);
      if (t) return t;
    }
    return '';
  }

  // A very long instruction can wrap over a dozen printed lines, with the
  // stitch count stranded on the last of them ("...continue normally: 9 sc
  // (40)"). The three-line merge above only follows lines that clearly read as
  // instructions, which a wrapped paragraph of prose does not, so as a last
  // resort look ahead for the stranded count. Deliberately narrow: the row
  // must be left hanging (no sentence-ending full stop), nothing in between
  // may be a row, header, repeat or page break, and the line that carries the
  // count must end with it and read like crochet rather than like a remark.
  var STRANDED_LIMIT = 16;
  var SENTENCE_END_RE = /[.!?]["')\]]?\s*$/;
  var PAGE_MARK_RE = /^===\s*page\b/i;
  // A whole line that is only a stitch total.
  var COUNT_ONLY_RE = /^[-=]?\s*(?:[(\[<]\s*\d+[^)\]>]{0,20}[)\]>]|\d+\s*(?:sts?|stitches?))\s*[.,;!]*$/i;

  function strandedCount(raws, i, rowText, size, heads) {
    if (SENTENCE_END_RE.test(rowText)) return null;
    var found = null;
    for (var j = i + 1, seen = 0; j < raws.length && seen < STRANDED_LIMIT; j++) {
      var t = trimLine(raws[j]);
      if (!t) continue;
      if (PAGE_MARK_RE.test(t)) break;
      seen++;
      var cls = classify(t, size, heads, nextLine(raws, j));
      if (cls.marker || cls.repeat || cls.nextRow || cls.setup ||
          cls.nameRow || cls.header) break;
      // A line that is NOTHING but the total ("[145 sts]", "(40)", "<57 sts>")
      // is the stranded count itself. It does not read like crochet - there is
      // no stitch word on it at all - so INSTR_ROW_RE below would skip it, and
      // the same King Cole blanket typeset one column narrower loses every
      // count it has (the UK file prints "turn. [145 sts]" on one line, the US
      // file wraps the bracket onto its own).
      if (COUNT_ONLY_RE.test(t)) {
        var only = findExplicit(t);
        if (only) found = only;
        continue;
      }
      if (!INSTR_ROW_RE.test(t)) continue;
      var ex = findExplicit(t);
      // Only a DECLARED total counts when it is picked up off a later line:
      // one in brackets, angle brackets or after a dash or an equals sign. A
      // bare "...in next 3 sts (the first 3 sts" is the middle of the
      // instruction, and reading 3 off it is how the same blanket typeset two
      // columns wide and three columns wide disagreed on 30 of its 127 rows.
      if (ex && ex.end >= t.length &&
          (/^[-=(\[<]/.test(t.slice(ex.start).replace(/^\s+/, '')) ||
           /[.;:|]\s*$/.test(t.slice(0, ex.start)))) {
        found = ex;
      }
    }
    return found;
  }

  // A physical line can carry two columns of rows:
  // "2. (Hdc 1, Hdc Inc) x 3 (9) 1. 5 Sc in Magic Ring (5)"
  var COLUMN_SPLIT_RE = /\)\s+(?=\d+(?:\s*-\s*\d+)?\s*[.:]\s)/;

  // The rest of 03 #4, the half that needs context detectMarker does not
  // have. A bare number is not a row when the printed line above it left a
  // multi-size bracket hanging open ("...the remaining 96 (108," then
  // "116) sts unworked"), and it is not a row when it lands absurdly far
  // past the rounds this section has counted so far.
  var OPEN_LIST_END_RE = /[(,]\s*$/;

  function unclosedBracket(s) {
    return (s.match(/\(/g) || []).length > (s.match(/\)/g) || []).length;
  }

  var ROW_JUMP_LIMIT = 40;

  function bareIsStray(raws, i, mk, cur) {
    if (!mk || !mk.bare) return false;
    if (cur && cur.hasRow && cur.lastRow !== null && mk.row > cur.lastRow + ROW_JUMP_LIMIT) return true;
    for (var j = i - 1; j >= 0; j--) {
      var p = trimLine(raws[j]);
      if (!p) continue;
      return unclosedBracket(p) && OPEN_LIST_END_RE.test(p);
    }
    return false;
  }

  // --- line repairs before anything is classified ----------------------

  // "Right Front: Shape V-neck and armhole: 1st row: (RS). Ch 4." - the whole
  // Yarnspirations house style prints the part name, the shaping label and the
  // first row on ONE printed line, so without splitting it the part has no
  // header and the row is buried behind 40 characters of label.
  var LABEL_ROW_RE = new RegExp(
    '^((?:[A-Za-z][A-Za-z0-9 \'&/-]{1,34}:\\s*){1,2})' +
    '(?=(?:\\d+\\s*(?:st|nd|rd|th)\\s*(?:rows?|rnds?|rounds?)|' +
    'next\\s+(?:\\d+\\s*)?(?:rows?|rnds?|rounds?)|' +
    'rows?\\s*\\d|rnds?\\s*\\d|rounds?\\s*\\d|foundation\\s+(?:row|rnd))\\b)', 'i');

  // "SECOND SQUARE-Rnds 1-5: Work same as First Square." / "BORDER-Rnd 1: ..."
  // Red Heart and Coats hyphenate the part name straight onto its first round.
  var NAME_DASH_ROW_RE = /^([A-Za-z][A-Za-z '&/]{2,34}?)\s*-\s*(?=(?:rnds?|rounds?|rows?)\s*\d)/i;

  // A superscript ordinal that pdf.js hands back as its own line: "Row 1: Hdc
  // in 3 ch from hook" is printed "3rd" with the "rd" raised, and the raised
  // glyph arrives on a line of its own above or below the row.
  var ORPHAN_ORDINAL_RE = /^(?:st|nd|rd|th)$/i;

  // A count split by the line wrap: "... Turn. <3" / "sts>" (Hobbii).
  var OPEN_ANGLE_RE = /<\s*\d+\s*$/;
  var CLOSE_ANGLE_RE = /^\s*(?:sts?|stitches?)\s*>/i;

  // A row marker that a neighbouring column has been printed in front of:
  // "WS wrong side Row 7 (RS): 4ch (counts as 1tr and" is the tail of the
  // abbreviation table glued to the head of round 7. The marker must carry a
  // colon (so "Repeat Row 2 until..." is untouched) and the debris in front of
  // it must be short and must not be the words that make the line a repeat or
  // a cross-reference.
  var BLEED_ROW_RE = /^(.{1,28}?[a-z)½¼¾])\s+((?:rows?|rnds?|rounds?)\s*\d+\s*(?:\((?:ws|rs)\))?\s*:)/i;
  var BLEED_STOP_RE = /\b(?:rep|repeat|until|as|see|from|through|work|and|end|of|in|to)\s*$/i;

  function prepareLines(text) {
    // Unicode hygiene runs here, once, so every downstream rule (and the
    // `text` a section hands back) sees plain ASCII punctuation (06 #7).
    var raws = normUnicode(text).split(/\r\n|\r|\n/);
    var repaired = [];
    for (var r0 = 0; r0 < raws.length; r0++) {
      var line = raws[r0];
      var tl = trimLine(line);
      if (ORPHAN_ORDINAL_RE.test(tl)) continue;
      // close a wrapped <count> onto the line that opened it
      if (CLOSE_ANGLE_RE.test(tl) && repaired.length &&
          OPEN_ANGLE_RE.test(trimLine(repaired[repaired.length - 1]))) {
        repaired[repaired.length - 1] = repaired[repaired.length - 1].replace(/\s+$/, '') + ' ' + tl;
        continue;
      }
      var nd = NAME_DASH_ROW_RE.exec(tl);
      if (nd && headerInfo(nd[1]) && headerInfo(nd[1]) !== 'note') {
        repaired.push(nd[1]);
        repaired.push(tl.slice(nd[0].length));
        continue;
      }
      if (!detectMarker(tl) && !detectSetup(tl)) {
        var bl = BLEED_ROW_RE.exec(tl);
        if (bl && !BLEED_STOP_RE.test(bl[1])) {
          repaired.push(bl[1]);
          repaired.push(tl.slice(bl[1].length).replace(/^\s+/, ''));
          continue;
        }
      }
      var lr = LABEL_ROW_RE.exec(tl);
      if (lr) {
        var labels = lr[1].split(':');
        var pushed = false;
        for (var li = 0; li < labels.length; li++) {
          var lab = trimLine(labels[li]);
          if (!lab) continue;
          var hi = headerInfo(lab + ':');
          if (hi && hi !== 'note') { repaired.push(lab + ':'); pushed = true; }
        }
        if (pushed) {
          repaired.push(tl.slice(lr[0].length));
          continue;
        }
      }
      repaired.push(line);
    }
    raws = repaired;
    var out = [];
    for (var i = 0; i < raws.length; i++) {
      var s = stripFragments(raws[i]);
      var guard = 0;
      while (guard++ < 4 && detectMarker(trimLine(s))) {
        var m = COLUMN_SPLIT_RE.exec(s);
        if (!m) break;
        out.push(s.slice(0, m.index + 1));
        s = s.slice(m.index + 1).replace(/^\s+/, '');
      }
      out.push(s);
    }
    return out;
  }

  /**
   * @param {string} t     the line
   * @param {number} size
   * @param {Object} heads running heads to refuse as names
   * @param {string} [next] the next non-blank line, used to confirm a weak
   *   header (see STANDALONE_OK): "Eye" is a part when its rounds start on
   *   the very next line, and a caption when prose follows instead.
   */
  function classify(t, size, heads, next) {
    if (!t) return { blank: true };
    if (isPhotoLabel(t)) return { photo: true };
    var mk = detectMarker(t);
    if (mk) return { marker: mk };
    var rep = detectRepeat(t, size);
    if (rep) return { repeat: rep };
    var nx = detectNextRow(t);
    if (nx) return { nextRow: nx };
    var sp = detectSetup(t);
    if (sp) return { setup: sp };
    var nr = nameRowInfo(t);
    if (nr) return { nameRow: nr };
    if (COLOUR_NOTE_RE.test(t)) return { note: true };   // "In Twilight :"
    if (heads && heads[headKey(t)]) return { note: true };  // running head
    var h = headerInfo(t);
    if (h && h !== 'note') {
      if (h.weak && !(next && detectMarker(next))) return { note: true };
      return { header: { name: h.name, makeCount: h.makeCount } };
    }
    return { note: true };
  }

  // A wrapped row: the line below carries the rest of the instruction.
  function looksLikeContinuation(t, cls) {
    if (!t || !cls.note) return false;
    var startsOk = /^[(\[]/.test(t) || /^[a-z]/.test(t) || /^[A-Z]\s*\(/.test(t) ||
      /^(?:inc|sc|hdc|dc|htr|dtr|trtr|ttr|tr|dec|fsc|bbl|puff|sl\s*st|slst)\b/i.test(t) ||
      // "...(sc in next 4 sts," / "2 sc in next st) 5 times...": a wrap can
      // land on the count of a stitch, which reads as a number then a stitch.
      // A line like that with no row marker of its own is always a leftover.
      /^\d+\s*(?:inc|sc|hdc|dc|htr|dtr|trtr|ttr|tr|dec|ch|sl\s*st|slst)\b/i.test(t) ||
      // Red Heart and Coats print the total on the next line, dashed off:
      // "Rnd 1: Ch 3, 15 dc in ring; join..." / "- 16 sts. Fasten off."
      /^[-=]\s*\d+\s*(?:sts?|stitches?|sc|hdc|dc|htr|tr)\b/i.test(t);
    if (!startsOk) return false;
    // must read like instructions, not like prose commentary
    var hasCount = /[(\[]\s*\d+\s*(?:sts?|stitches?|sc|hdc|dc)?\s*[)\]]/i.test(t) || /\|\s*\d+/.test(t) ||
      CLAUSE_TAIL_RE.test(t) || ANGLE_TAIL_RE.test(t) ||
      /^[-=]\s*\d+\s*(?:sts?|stitches?|sc|hdc|dc|htr|tr)\b/i.test(t);
    // The count is often glued to the stitch ("21sc", "3scinc"), which a
    // plain \b would miss - a digit and a letter are both word characters,
    // so there is no boundary in front of the "sc" to anchor to.
    var hasStitch = /\b\d*(?:sc|hdc|dc|htr|dtr|trtr|ttr|tr|inc|dec|ch|sl\s*st|slst|bbl|puff|fsc)\b/i.test(t);
    return hasCount || hasStitch;
  }

  function parse(text, opts) {
    if (text === null || text === undefined) return [];
    var size = (opts && typeof opts.size === 'number') ? opts.size : 0;
    var raws = prepareLines(text);
    var heads = findRunningHeads(raws);
    var special = findSpecial(raws, size, heads);
    // A bare-number run printed BEFORE the first front-matter heading is a
    // table of contents or a numbered supply list, never rounds (06 #2).
    // Only front matter that really is at the front counts, so a glossary
    // printed at the back of the pattern never disqualifies real rows.
    var frontMatterAt = -1;
    for (var fmi = 0; fmi < raws.length; fmi++) {
      if (FRONT_MATTER_RE.test(trimLine(raws[fmi]))) { frontMatterAt = fmi; break; }
    }
    if (frontMatterAt > raws.length * 0.5) frontMatterAt = -1;
    var lines = [];
    var sections = [];
    var consumed = [];
    var multiSize = false;
    var suggestion = null;
    var suggestionSection = null;
    var group = { entries: [], sawContent: false };

    function openSection(name, makeCount, startLine) {
      var sec = {
        index: sections.length, name: name || '', makeCount: makeCount || 1,
        startLine: startLine, endLine: startLine, rows: 0, maxRow: null,
        lastRow: null, lastRowLine: null, prevCount: null, hasRow: false,
        hasSetup: false, instrRows: 0
      };
      sections.push(sec);
      return sec;
    }

    function pushHeader(h, line, used) {
      if (group.sawContent) group = { entries: [], sawContent: false };
      // A two-column PDF can print the same heading twice - once as the big
      // display heading over the artwork, once as the label of the column
      // that carries its rounds ("Tail:" / "Tail:"). Two identical headers on
      // neighbouring lines are one part, not two, and left as two the spare
      // entry gets handed to the next unnamed section further down the page.
      var last = group.entries[group.entries.length - 1];
      if (last && !used && line - last.line <= 2 &&
          last.name.toLowerCase() === h.name.toLowerCase()) {
        // whichever copy carries the make-count speaks for both
        if (h.makeCount > last.makeCount) last.makeCount = h.makeCount;
        return;
      }
      group.entries.push({ name: h.name, makeCount: h.makeCount, line: line, used: !!used });
    }

    function takeName() {
      for (var g = 0; g < group.entries.length; g++) {
        if (!group.entries[g].used) { group.entries[g].used = true; return group.entries[g]; }
      }
      return null;
    }

    // Open a section for a row at lineIdx, taking the next unused header name
    // and back-dating the section start to that header where possible.
    function openSectionAtRow(lineIdx) {
      var entry = takeName();
      var prev = cur;
      var start = lineIdx;
      if (entry && entry.line < lineIdx) {
        var floor = (prev.lastRowLine === null) ? prev.startLine : prev.lastRowLine + 1;
        start = Math.min(lineIdx, Math.max(entry.line, floor));
      }
      var sec = openSection(entry ? entry.name : '', entry ? entry.makeCount : 1, start);
      // An unnamed restart is the same piece continuing, so carry the count.
      if (!entry) sec.prevCount = prev.prevCount;
      for (var k = start; k < lineIdx; k++) {
        if (lines[k] && lines[k].section === prev.index) lines[k].section = sec.index;
      }
      return sec;
    }

    // Expected-next-row matching: a row goes to the most recently opened
    // section that expects it; a restart (row 1, or a number already seen)
    // opens a new one; anything else continues the current section.
    function sectionForRow(rowStart, lineIdx) {
      if (!cur.hasRow && cur.lastRow === null) return cur;
      for (var k = sections.length - 1; k >= 0; k--) {
        if (sections[k].lastRow !== null && sections[k].lastRow + 1 === rowStart) return sections[k];
      }
      if (rowStart === 1 || (cur.lastRow !== null && rowStart <= cur.lastRow)) return openSectionAtRow(lineIdx);
      return cur;
    }

    var cur = openSection('', 1, 0);

    for (var i = 0; i < raws.length; i++) {
      var t = trimLine(raws[i]);
      var L = makeLine(i, raws[i]);
      lines.push(L);
      cur.endLine = i;
      L.section = cur.index;

      if (consumed[i]) { L.consumed = true; continue; }
      if (!t) continue;

      // Page scaffolding and assembly prose: they belong to no part, so they
      // never become a line, a header or a note on somebody's last row. The
      // placement pass reads their text straight off `lines`.
      if (special.furniture[i]) { L.furniture = true; L.omit = true; continue; }
      if (special.assembly[i]) { L.assembly = true; L.omit = true; continue; }

      // Front matter closes the cover page: whatever title the not-yet-started
      // first section is carrying is a document title, not a part name.
      if (!cur.hasRow && FRONT_MATTER_RE.test(t)) {
        cur.name = ''; cur.makeCount = 1; cur.startLine = i;
        cur.titleGroup = null; cur.titleEntry = null;
        group = { entries: [], sawContent: false };
        continue;
      }

      var cls = classify(t, size, heads, nextLine(raws, i));
      // Phantom rows from bare numbers (06 #2) and from wrapped size lists
      // (03 #4): both need the context this loop has and detectMarker does
      // not, so they are demoted to notes here.
      if (cls.marker && cls.marker.bare &&
          (i < frontMatterAt || bareIsStray(raws, i, cls.marker, cur))) {
        cls = { note: true };
      }
      var prefixLen = 0;
      var isRow = false, isSetup = false;

      if (cls.photo) { L.photo = true; continue; }

      if (cls.header) {
        // A heading over an abbreviation table is front matter: it closes the
        // cover page exactly like FRONT_MATTER_RE above and names nothing.
        if (looksLikeGlossary(raws, i)) {
          if (!cur.hasRow) {
            cur.name = ''; cur.makeCount = 1; cur.startLine = i;
            cur.titleGroup = null; cur.titleEntry = null;
          }
          group = { entries: [], sawContent: false };
          continue;
        }
        L.kind = 'header';
        // A different design in the same file: start the row counter again so
        // the ebook's ten patterns are ten parts, not one long one (06 #15).
        if ((cur.hasRow || cur.hasSetup) && isDesignStart(raws, i)) {
          group = { entries: [], sawContent: false };
          cur = openSection(cls.header.name, cls.header.makeCount, i);
          pushHeader(cls.header, i, true);
          cur.titleGroup = group;
          cur.titleEntry = group.entries[0] || null;
          L.section = cur.index;
          continue;
        }
        pushHeader(cls.header, i, false);
        // A section that has not started yet takes its name from the newest
        // header group, so the header closest before the first row wins over
        // a cover title or a chapter heading further up. Inside the group the
        // FIRST entry wins, because a group of headers is a queue on a
        // two-column page ("Arms (Make 2)" / "Ears (Make 2)" with a column of
        // rows each). The pattern-title case ("Little Panda" directly above
        // "Body") is corrected after the loop, once we know whether the entry
        // below was ever claimed - see "pattern title" below.
        // ...and a section that has already started keeps the name it was
        // given: a heading printed in the middle of its rounds is the
        // pattern's own title set over the artwork, not a rename. A
        // foundation row counts as started even though it is not numbered.
        if (!cur.hasRow && !cur.hasSetup) {
          var first = group.entries[0];
          cur.name = first.name;
          cur.makeCount = first.makeCount;
          cur.startLine = first.line;
          first.used = true;
          cur.titleGroup = group;
          cur.titleEntry = first;
        }
        continue;
      }

      if (cls.marker) {
        cur = sectionForRow(cls.marker.row, i);
        L.row = cls.marker.row; L.rowEnd = cls.marker.rowEnd; L.kind = 'row';
        prefixLen = t.length - cls.marker.rest.length;
        isRow = true;
      } else if (cls.repeat) {
        L.kind = 'repeat';
        // "Repeat Row 2 until work measures / 10 inches long, approx. 44
        // rows." - the clause that carries the target wraps in a narrow
        // column, so read the repeat off the joined sentence. The following
        // lines are NOT consumed: they stay notes, exactly as before.
        var rt = t;
        for (var j4 = i + 1, g4 = 0; g4 < 2 && j4 < raws.length && !SENTENCE_END_RE.test(rt); j4++) {
          var ct4 = trimLine(raws[j4]);
          if (!ct4 || isFurniture(ct4)) continue;
          var c4 = classify(ct4, size, heads);
          if (c4.marker || c4.header || c4.setup || c4.nameRow) break;
          rt = rt + ' ' + ct4;
          g4++;
        }
        var rp = resolveRepeat(detectRepeat(rt, size) || cls.repeat, cur.lastRow);
        if (!suggestion && rp.startRow !== null) { suggestion = rp; suggestionSection = cur.index; }
        // "Rep Row 2 until the blanket measures 59"" / "Repeat Rows 5-8 until
        // there are a total of 25 Rows": a repeat with no row number of its own
        // stands for every row after the part's last written one. Where that is
        // cannot be known here - in a de-interleaved two-column PDF the
        // sentence is printed ABOVE the rows it repeats (the cardigan) - so the
        // rows it covers are filled in after the loop.
        if (rp.startRow !== null && rp.endRow !== null) {
          L.repeatOf = refRange(rp.startRow, rp.endRow);
          if (L.repeatOf) { L.repeatTimes = rp.times; L.repeatUntil = rp.untilRows; }
        }
      } else if (cls.nextRow) {
        L.row = (cur.lastRow === null ? 0 : cur.lastRow) + 1;
        L.rowEnd = L.row + (cls.nextRow.span || 1) - 1;
        L.kind = 'row';
        prefixLen = t.length - cls.nextRow.rest.length;
        isRow = true;
      } else if (cls.setup) {
        if (cur.hasRow) cur = openSectionAtRow(i);
        L.row = 0; L.rowEnd = 0; L.kind = 'setup';
        // A line that says "Setup row:" in so many words starts the section;
        // a counted line guessed into a setup further down does not (a
        // materials list - "Hook size: 2-3" - reads as one).
        cur.hasSetup = true;
        if (cur.lastRow === null) cur.lastRow = 0;
        prefixLen = t.length - cls.setup.rest.length;
        isSetup = true;
      } else if (cls.nameRow) {
        if (cur.hasRow || cur.name) cur = openSection(cls.nameRow.name, cls.nameRow.makeCount, i);
        else { cur.name = cls.nameRow.name; cur.makeCount = cls.nameRow.makeCount; }
        // "FIRST SQUARE: With CA, ch 4; join with a sl st to form a ring." is
        // followed by "Rnd 1:", so it is the setup for round 1, not round 1
        // itself - otherwise the part is cut in two, a 1-row stub and a 6-row
        // remainder (crochet-redheart-persian-tiles). The opening sentence
        // usually wraps, so look past its continuation lines.
        if (firstMarkerRowAhead(raws, i) === 1) cls.nameRow.foundation = true;
        if (cls.nameRow.foundation) {
          L.row = 0; L.rowEnd = 0; L.kind = 'setup';
          cur.hasSetup = true;
          if (cur.lastRow === null) cur.lastRow = 0;
          isSetup = true;
        } else {
          L.row = 1; L.rowEnd = 1; L.kind = 'row';
          isRow = true;
        }
        prefixLen = cls.nameRow.prefixLen;
      } else {
        L.kind = 'note';
      }

      L.section = cur.index;
      if (!COLOUR_NOTE_RE.test(t)) group.sawContent = true;

      // --- wrapped rows: merge the continuation lines into this one -------
      var lastIdx = i;
      if (isRow || isSetup) {
        var guard = 0, j2 = i + 1;
        while (guard < 3 && j2 < raws.length) {
          if (!/,\s*$/.test(t) && findExplicit(t.slice(prefixLen))) break;
          var ct = trimLine(raws[j2]);
          if (!looksLikeContinuation(ct, classify(ct, size, heads))) break;
          t = t.replace(/\s+$/, '') + ' ' + ct;
          consumed[j2] = true;
          lastIdx = j2;
          j2++; guard++;
        }
        if (lastIdx !== i) L.text = t;
      }

      // --- explicit count -----------------------------------------------
      var expl = findExplicit(t.slice(prefixLen));
      var body = t;
      if (expl) {
        expl.start += prefixLen; expl.end += prefixLen;
        L.sizes = expl.sizes.length > 1 ? expl.sizes : null;
        L.stitches = pickSize(expl.sizes, size);
        if (expl.sizes.length > 1) multiSize = true;
        if (expl.start > prefixLen) body = t.slice(0, expl.start);
        // text right after the count that is really a note on this row
        var after = TRAILING_NOTE_RE.exec(t.slice(expl.end));
        if (after) {
          var nt = after[1].replace(/\s+/g, ' ').replace(/\s+\./g, '.').trim();
          if (nt) L.notes.push(nt);
        }
      }

      if ((isRow || isSetup) && L.stitches === null) {
        var cont = continuationCount(raws, lastIdx) ||
          strandedCount(raws, lastIdx, t, size, heads);
        if (cont) {
          L.sizes = cont.sizes.length > 1 ? cont.sizes : null;
          L.stitches = pickSize(cont.sizes, size);
          if (cont.sizes.length > 1) multiSize = true;
        }
      }

      // A counted line before row 1 of the section is a setup/foundation row.
      if (!isRow && !isSetup && L.kind === 'note' && L.stitches !== null && !cur.hasRow) {
        L.kind = 'setup'; L.row = 0; L.rowEnd = 0; isSetup = true;
        if (cur.lastRow === null) cur.lastRow = 0;
      }

      // --- computed count -----------------------------------------------
      if (isRow || isSetup) {
        var instr = body.slice(Math.min(prefixLen, body.length));
        L.prevCount = (cur.prevCount === undefined) ? null : cur.prevCount;
        // "Rnds 4-15: rep Rnd 3" / "Rows 6-46: rep rows 4 and 5" / "as Row 2":
        // the row has no words of its own, so it is counted from the row it
        // points at rather than from evaluate(), which reads it as prose.
        var refs = isRow ? backRefRows(instr, L.row) : null;
        if (refs) {
          L.repeatOf = refs;
          L.repeatFrom = L.row;
          L.repeatTo = L.rowEnd;
          L.counts = repeatCounts(lines, cur.index, refs, cur.prevCount,
            L.row, L.rowEnd, L.stitches);
          L.computed = L.counts ? L.counts[L.counts.length - 1] : null;
        } else {
          L.computed = evaluate(instr, cur.prevCount);
        }
        L.count = (L.stitches !== null) ? L.stitches : L.computed;
        L.countSource = (L.stitches !== null) ? 'explicit' : (L.computed !== null ? 'computed' : null);
        if (L.count !== null) cur.prevCount = L.count;
        if (isRow) {
          cur.hasRow = true;
          // a section needs real instructions, not just numbered lines
          if (INSTR_ROW_RE.test(instr)) cur.instrRows += 1;
          cur.lastRow = L.rowEnd;
          cur.lastRowLine = i;
          cur.rows += (L.rowEnd - L.row + 1);
          if (cur.maxRow === null || L.rowEnd > cur.maxRow) cur.maxRow = L.rowEnd;
        }
      } else if (L.stitches !== null) {
        L.count = L.stitches;
        L.countSource = 'explicit';
      }
    }

    // --- pattern title above the first part header -----------------------
    // A pattern's own title often sits directly on top of the first part's
    // header ("Little Panda" over "Body"). Both read as headers and the first
    // section took the upper one, so if the header just below it was never
    // claimed by any section, that one was the part name and the line above it
    // was the title. When the pair is a queue instead (two columns, one header
    // each) the lower entry IS claimed and nothing moves.
    var s0 = sections[0];
    if (s0 && s0.hasRow && s0.titleEntry && s0.titleGroup) {
      var es = s0.titleGroup.entries;
      var at = es.indexOf(s0.titleEntry);
      var below = at >= 0 ? es[at + 1] : null;
      if (below && !below.used && below.line - s0.titleEntry.line <= 3) {
        below.used = true;
        s0.name = below.name;
        s0.makeCount = below.makeCount;
        s0.startLine = below.line;   // the title line drops out of the text
      }
    }

    // --- which rows a bare repeat sentence covers ------------------------
    // Now that every section's last row is known: "Rep Row 2 until the blanket
    // measures approximately 59"" covers row 3 onwards, and "Repeat Rows 5-8
    // until there are a total of 25 Rows" covers rows 9 to 25. `repeatTo` stays
    // null when only a measurement is given - expand() then answers for
    // whatever row the caller asks about, which is what the store wants.
    for (var rq = 0; rq < lines.length; rq++) {
      var rl = lines[rq];
      if (rl.kind !== 'repeat' || !rl.repeatOf) continue;
      var rsec = sections[rl.section];
      var from = (rsec && rsec.maxRow !== null && rsec.maxRow >= 1) ? rsec.maxRow + 1 : null;
      // every row it points at has to have been written, and before `from`
      if (from === null || rl.repeatOf[rl.repeatOf.length - 1] >= from ||
          !refLineAt(lines, rl.section, rl.repeatOf[0])) {
        rl.repeatOf = null;
        continue;
      }
      rl.repeatFrom = from;
      if (rl.repeatUntil >= from) rl.repeatTo = rl.repeatUntil;
      else if (rl.repeatTimes >= 1) rl.repeatTo = from + rl.repeatTimes * rl.repeatOf.length - 1;
      else rl.repeatTo = null;
    }

    // --- note paragraphs, then attachment -------------------------------
    var paras = [];
    var para = null;
    for (var j = 0; j < lines.length; j++) {
      var n = lines[j];
      var tx = trimLine(n.text);
      if (n.kind !== 'note' || n.consumed || n.photo || n.omit || !tx) { para = null; continue; }
      // a connector continues the paragraph - unless the next line is itself
      // a fresh instruction ("Colour change to yellow")
      if (para && para.section === n.section && para.lastIdx === j - 1 &&
          CONNECTOR_RE.test(para.text) && !NOTE_KEY_RE.test(tx)) {
        para.text += ' ' + tx;
        para.lastIdx = j;
      } else {
        para = { text: tx, section: n.section, firstIdx: j, lastIdx: j };
        paras.push(para);
      }
    }
    paras.forEach(function (p) {
      if (!isAttachableNote(p.text)) return;
      var target = null, k;
      for (k = p.lastIdx + 1; k < lines.length; k++) {
        if (lines[k].section !== p.section) break;
        if (lines[k].kind === 'row' || lines[k].kind === 'setup') { target = lines[k]; break; }
      }
      if (!target) {
        for (k = p.firstIdx - 1; k >= 0; k--) {
          if (lines[k].section !== p.section) break;
          if (lines[k].kind === 'row' || lines[k].kind === 'setup') { target = lines[k]; break; }
        }
      }
      if (target) target.notes.push(p.text);
    });

    lines.meta = {
      sections: sections.map(function (s) {
        return {
          index: s.index, name: s.name, makeCount: s.makeCount,
          startLine: s.startLine, endLine: s.endLine, rows: s.rows,
          maxRow: s.maxRow, instrRows: s.instrRows
        };
      }),
      sizes: detectSizes(text),
      multiSize: multiSize,
      suggestion: (suggestionSection === 0 || suggestionSection === null) ? suggestion : null,
      anySuggestion: suggestion,
      assemblyBlocks: special.blocks,
      heads: heads
    };
    return lines;
  }

  // A section worth offering as a part: it has rows, and at least one of them
  // is a real instruction rather than a bare number or a glossary line.
  function isRealSection(s) {
    return s.rows > 0 && (s.instrRows === undefined || s.instrRows > 0);
  }

  function inRange(line, row) {
    if (!line || line.row === null || line.row === undefined) return false;
    var end = (line.rowEnd === null || line.rowEnd === undefined) ? line.row : line.rowEnd;
    return row >= line.row && row <= end;
  }

  // A back-referencing range grows or shrinks row by row ("Row 6-55: Repeat
  // rows 4 & 5" adds two stitches every second row), so its target is read out
  // of the line's own per-row `counts` where it has them - `count` alone is the
  // count at the END of the range and would freeze the shape.
  function targetFor(lines, row) {
    if (!lines || !lines.length) return null;
    var i, l, c;
    for (i = 0; i < lines.length; i++) {
      l = lines[i];
      if (l.section === 0 && l.row >= 1 && inRange(l, row)) {
        c = countAt(l, row);
        if (c !== null) return c;
      }
    }
    for (i = 0; i < lines.length; i++) {
      l = lines[i];
      if (l.row >= 1 && inRange(l, row)) {
        c = countAt(l, row);
        if (c !== null) return c;
      }
    }
    return null;
  }

  function lineFor(lines, row) {
    if (!lines || !lines.length) return null;
    var i, l;
    for (i = 0; i < lines.length; i++) {
      l = lines[i];
      if (l.section === 0 && l.row >= 1 && inRange(l, row)) return l;
    }
    for (i = 0; i < lines.length; i++) {
      l = lines[i];
      if (l.row >= 1 && inRange(l, row)) return l;
    }
    return null;
  }

  function summary(lines) {
    var rows = 0, maxRow = null, hasTargets = false, anyExplicit = false, anyComputed = false;
    var meta = (lines && lines.meta) ? lines.meta : null;
    if (lines) {
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        if (l.row !== null && l.row !== undefined && l.row >= 1) {
          var end = (l.rowEnd === null || l.rowEnd === undefined) ? l.row : l.rowEnd;
          rows += (end - l.row + 1);
          if (maxRow === null || end > maxRow) maxRow = end;
        }
        if (l.count !== null && l.count !== undefined) hasTargets = true;
        if (l.stitches !== null && l.stitches !== undefined) anyExplicit = true;
        if (l.computed !== null && l.computed !== undefined) anyComputed = true;
      }
    }
    var secs = meta ? meta.sections.filter(isRealSection) : [];
    if (meta && !secs.length && meta.sections.length) secs = [meta.sections[0]];
    var sug = meta && meta.suggestion ? meta.suggestion : null;
    return {
      rows: rows,
      maxRow: maxRow,
      hasTargets: hasTargets,
      computedOnly: !anyExplicit && anyComputed,
      sizes: meta ? meta.sizes : null,
      multiSize: meta ? meta.multiSize : false,
      sections: secs,
      suggestions: {
        targetRows: sug ? sug.untilRows : null,
        repeat: sug ? { startRow: sug.startRow, endRow: sug.endRow, times: sug.times, untilRows: sug.untilRows } : null
      }
    };
  }

  function splitSections(text) {
    if (text === null || text === undefined) return [];
    var lines = parse(text);
    var meta = lines.meta || {};
    var secs = meta.sections || [];
    // Build each section's text from the lines that belong to it: with
    // two-column bleed the sections interleave, so a raw slice would not do.
    // `omit` drops the page scaffolding and the assembly prose - the latter is
    // handed to the parts it names by distributePlacement() instead.
    var out = secs.filter(isRealSection).map(function (s) {
      var body = [], own = [];
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        if (l.section !== s.index || l.consumed || l.photo || l.omit) continue;
        if (l.index < s.startLine) continue;
        if (!trimLine(l.text)) continue;
        body.push(trimLine(l.text));
        own.push(l);
      }
      return {
        name: s.name, makeCount: s.makeCount, text: body.join('\n'),
        placement: '', startLine: s.startLine, lines: own
      };
    });
    if (!out.length) {
      var all = [], raw = [];
      for (var j = 0; j < lines.length; j++) {
        if (lines[j].furniture) continue;
        raw.push(String(lines[j].text));
        if (!lines[j].consumed && !lines[j].photo && !lines[j].omit && trimLine(lines[j].text)) all.push(lines[j]);
      }
      out = [{
        name: '', makeCount: 1, text: raw.join('\n'),
        placement: '', startLine: 0, lines: all
      }];
    }
    distributePlacement(out, lines, meta);
    return out.map(function (s) {
      return { name: s.name, makeCount: s.makeCount, text: s.text, placement: s.placement };
    });
  }

  /** The placing notes splitSections() would hand each section, on their own. */
  function placement(text) {
    return splitSections(text).map(function (s) { return s.placement; });
  }

  // =====================================================================
  // 9. Colours - colorHex(), colors()
  // =====================================================================

  // ~130 yarn colour words. Values are deliberately a little muted: they are
  // drawn as yarn, not as screen primaries.
  var COLOR_TABLE = {
    // neutrals / naturals
    black: '#1c1c1c', white: '#fdfdfb', cream: '#f5ebd8', ivory: '#fffff0',
    ecru: '#d6cbb3', natural: '#e8dcc4', linen: '#faf0e6', bone: '#e3dac9',
    almond: '#efdecd', sand: '#e3cda4', beige: '#f0e2c8', oatmeal: '#e5dbc7',
    biscuit: '#e0c9a6', wheat: '#f5deb3', vanilla: '#f3e5ab', champagne: '#f7e7ce',
    pearl: '#eae0c8', blonde: '#e6be8a', nude: '#e3bc9a', tan: '#d2a86a',
    camel: '#c19a6b', khaki: '#c3b091', taupe: '#b3a394', latte: '#c8a882',
    caramel: '#c68e3f', honey: '#eab64b', toffee: '#a9743c', mocha: '#8b6f4e',
    coffee: '#6f4e37', chocolate: '#5c3a21', brown: '#7b4b28', chestnut: '#954535',
    walnut: '#5c4033', hazelnut: '#9c7248', cocoa: '#6b4423', fawn: '#d5b596',
    // greys
    grey: '#9e9e9e', gray: '#9e9e9e', silver: '#c0c0c0', pewter: '#96a8a1',
    slate: '#708090', ash: '#b2beb5', charcoal: '#36454f', graphite: '#45474b',
    smoke: '#848884', stone: '#a8a196', dove: '#c9c5c1', heather: '#a8a2b0',
    // reds / pinks
    red: '#d32f2f', crimson: '#dc143c', scarlet: '#e22c18', cherry: '#b3121e',
    brick: '#9c3a26', burgundy: '#6d071a', maroon: '#6e1414', wine: '#722f37',
    ruby: '#9b111e', pink: '#ffc0cb', blush: '#e39aa7', rose: '#d9607a',
    salmon: '#fa8072', coral: '#ff7f50', watermelon: '#fc6c85', strawberry: '#e33d4a',
    raspberry: '#b3446c', cerise: '#de3163', fuchsia: '#e83e8c', magenta: '#d6249f',
    // oranges / yellows
    peach: '#ffcba4', apricot: '#fbceb1', orange: '#f28c28', tangerine: '#f28500',
    pumpkin: '#ff7518', carrot: '#ed9121', ginger: '#b06500', rust: '#b7410e',
    terracotta: '#c76a4a', copper: '#b87333', bronze: '#cd7f32', amber: '#ffbf00',
    marigold: '#f4a300', gold: '#d4af37', mustard: '#d4a017', yellow: '#f5d547',
    lemon: '#f6ea5c', butter: '#f7e6a3', banana: '#ffe135', sunflower: '#ffc512',
    corn: '#fbec5d', cornsilk: '#fff8dc',
    // greens
    green: '#3f9142', emerald: '#2e8b57', jade: '#00a86b', forest: '#1f4d2e',
    pine: '#2a5c45', hunter: '#355e3b', olive: '#708238', moss: '#8a9a5b',
    fern: '#4f7942', sage: '#9caf88', mint: '#a8e6cf', seafoam: '#93e9be',
    pistachio: '#b5d99c', lime: '#9fd356', chartreuse: '#b5d000', avocado: '#78866b',
    // blues
    blue: '#2f6fb5', navy: '#1f2a5a', cobalt: '#0047ab', royal: '#2b4fbf',
    denim: '#4a6fa5', sky: '#87ceeb', azure: '#3d8bd4', cornflower: '#6495ed',
    periwinkle: '#a3aee0', powder: '#b0e0e6', ice: '#d6f0f5', teal: '#1d8a8a',
    turquoise: '#40e0d0', aqua: '#7fdbda', cyan: '#00ced1', peacock: '#1f7a8c',
    ocean: '#1f6f8b', lagoon: '#4aa3a2', blueberry: '#4f86c6', midnight: '#191970',
    twilight: '#2b3556', storm: '#4f5b66', dusk: '#4a4e69', steel: '#5b7c99',
    'baby blue': '#bcd4e6', 'baby pink': '#f4c2c2',
    // purples
    purple: '#7b3fa0', violet: '#8f5fd6', lavender: '#c3aee0', lilac: '#c8a2c8',
    mauve: '#b784a7', orchid: '#da70d6', plum: '#8e4585', grape: '#6f2da8',
    indigo: '#4b0082', amethyst: '#9966cc', iris: '#8a6fd1',
    // soft neutrals used as "whites"
    snow: '#fffafa', cloud: '#e8eaed', mist: '#dfe6e9', chalk: '#f2f0e6'
  };

  var LIGHTEN_RE = /^(light|lite|lt|pale|baby|soft|powder)$/;
  var DARKEN_RE = /^(dark|dk|deep|dusky|rich)$/;

  function hexBytes(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function byte2(n) {
    var v = Math.max(0, Math.min(255, Math.round(n))).toString(16);
    return v.length < 2 ? '0' + v : v;
  }
  function mixHex(hex, towards, amount) {
    var a = hexBytes(hex), b = hexBytes(towards);
    return '#' + byte2(a[0] + (b[0] - a[0]) * amount) +
      byte2(a[1] + (b[1] - a[1]) * amount) +
      byte2(a[2] + (b[2] - a[2]) * amount);
  }

  // Words that follow "in/with/using" but are never a yarn colour.
  var COLOR_STOP = {};
  ('each every all both the a an this that these those next same other half front back ' +
   'mr magic ring circle loop round rounds row rows rnd rnds st sts stitch stitches ' +
   'turn work working pattern total hook hand yarn wool color colour colors colours ' +
   'place between order addition general fact case way end ends side sides top bottom ' +
   'main contrast contrasting it its you your my our their one two three four five six ' +
   'seven eight nine ten first second third last long short same time times set sets ' +
   'photo photos left right back loops loop ' +
   // abbreviation-table words, so "with RS facing" / "in patt" never read as
   // a colour (04 H, 03 #19)
   'rs ws mm cm beg rem patt tog lp lps sp sps blo flo sk skip miss ' +
   'facing marker markers'
  ).split(' ').forEach(function (w) { COLOR_STOP[w] = true; });

  // The abbreviation table at the top of nearly every commercial PDF is
  // written in exactly the "X = word" shape a colour legend uses, so
  // `ch = chain` / `sc = single crochet` were being offered to the user as
  // yarn colours (03 #19, 04 H). A legend VALUE has to look like a colour.
  var TERM_STOP = {};
  ('chain,chains,stitch,stitches,crochet,double,treble,half,slip,space,spaces,' +
   'round,rounds,row,rows,repeat,together,skip,miss,increase,increasing,decrease,decreasing,' +
   'loop,loops,back,front,post,over,beginning,begin,remain,remaining,remainder,' +
   'continue,continuing,following,follow,pattern,patterns,tension,gauge,approximately,' +
   'millimeter,millimeters,millimetre,millimetres,centimeter,centimetres,inch,inches,' +
   'gram,grams,gramme,grammes,previous,alternate,as required,' +
   'single crochet,double crochet,half double crochet,treble crochet,slip stitch,' +
   'half treble,double treble,triple treble,back loop,front loop,back loop only,' +
   'front loop only,yarn over,chain space,stitch marker,right side,wrong side')
    .split(',').forEach(function (w) { if (w) TERM_STOP[w.trim()] = true; });

  // Does a legend value name a yarn colour, or an abbreviation-table term?
  function legendColour(raw) {
    var t = cleanName(raw);
    if (!t || t.length < 2 || t.length > 24) return false;
    var low = t.toLowerCase();
    if (TERM_STOP[low]) return false;
    if (COLOR_STOP[low]) return false;
    if (stitchInfo(t)) return false;
    if (/^(?:main|contrast(?:ing)?|accent|background|border)\s+colou?r$/.test(low)) return true;
    if (/^colou?r\s+[a-z]$/.test(low)) return true;
    if (/^(?:mc|cc)$/.test(low)) return true;
    if (colorHex(t)) return true;
    // an unknown but capitalised shade name: "Twilight", "Chronicle", "Sea Mist"
    return /^[A-Z][A-Za-z'-]{2,15}(?:\s+[A-Za-z'-]{1,15})?$/.test(t);
  }

  function colorHex(name) {
    if (name === null || name === undefined) return null;
    var s = String(name).toLowerCase().replace(/[^a-z\s-]+/g, ' ').replace(/\s+/g, ' ').trim();
    s = s.replace(/\s+(?:yarn|wool|colou?r|thread)$/, '').trim();
    if (!s) return null;
    if (/^colou?r\s+[a-z]$/.test(s)) return null;      // "Color A"
    if (/^(?:mc|cc|pc|a|b|c|d|e|f)$/.test(s)) return null;  // scheme letters
    if (/^[a-z]$/.test(s)) return null;
    if (COLOR_TABLE[s]) return COLOR_TABLE[s];

    var m = /^([a-z]+)[\s-]+(.+)$/.exec(s);
    if (m) {
      var mod = m[1], rest = m[2];
      var base = COLOR_TABLE[rest] || COLOR_TABLE[rest.split(' ').pop()] || null;
      if (base) {
        if (LIGHTEN_RE.test(mod)) return mixHex(base, '#ffffff', 0.35);
        if (DARKEN_RE.test(mod)) return mixHex(base, '#000000', 0.30);
        if (/^(bright|hot|neon|vivid)$/.test(mod)) return base;
        return base;                                   // "heather grey", "sea green"
      }
    }
    var last = s.split(' ').pop();
    if (last !== s && COLOR_TABLE[last]) return COLOR_TABLE[last];
    return null;
  }

  // --- colour names ------------------------------------------------------

  function cleanName(s) {
    var t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    t = t.replace(/[.,;:!]+$/, '').trim();
    t = t.replace(/\s+(?:yarn|wool|thread)$/i, '').trim();
    if (/^colou?r\s+[a-z]$/i.test(t)) return titleCase(t);
    if (/^(?:mc|cc)$/i.test(t)) return t.toUpperCase();
    return t;
  }

  // Is this captured word plausibly a yarn colour?
  function looksLikeColor(raw, legendVals) {
    var t = cleanName(raw);
    if (!t) return false;
    if (/^colou?r\s+[a-z]$/i.test(t)) return true;
    if (/^(?:mc|cc)$/i.test(t)) return true;
    if (/^[a-z]$/i.test(t)) return false;
    if (t.length > 24) return false;
    var low = t.toLowerCase();
    if (COLOR_STOP[low]) return false;
    if (stitchInfo(t)) return false;
    if (legendVals && legendVals[low]) return true;
    if (colorHex(t)) return true;
    // a capitalised word we do not know ("Twilight", "Seaglass")
    return /^[A-Z][a-z]{2,15}$/.test(t);
  }

  var LEGEND_RE = /(?:^|[(\[,;])\s*([A-Za-z]{1,3})\s*=\s*([A-Za-z][A-Za-z '\-]{1,23}?)\s*(?=[)\]]|,|;|$)/g;
  // "In Twilight :", "With MC", and - the amigurumi idiom expand() never read -
  // the same phrase sitting straight after the row marker: "Rnd 1: With black,
  // ch 2, 6 sc" (04 H).
  var C_IN = /^\s*(?:(?:rnds?|rounds?|rows?|r)?\.?\s*\d+(?:\s*[-&+]\s*\d+)?\s*(?:\([^)]{0,14}\))?\s*[:.)]\s*)?(?:in|with|using|w\/)\b\s*(?:the\s+)?(colou?r\s+[a-z]\b|[A-Za-z][A-Za-z'-]*)/i;
  var C_CHANGE = /\b(?:colou?r\s*change|change|changing|switch|switching)\s+to\s+(?:the\s+)?(colou?r\s+[a-z]\b|[A-Za-z][A-Za-z'-]*)/ig;
  var C_OFF = /\bfasten\s+off\s+(?:the\s+)?(colou?r\s+[a-z]\b|[A-Za-z][A-Za-z'-]*)/ig;
  var C_INCOLOR = /\bin\s+(colou?r\s+[a-z])\b/ig;
  var C_ADDYARN = /\badd\s+([A-Za-z][A-Za-z'-]*)\s+yarn\b/ig;

  // Colour instructions carried by one line / note, in reading order.
  // kind: 'base' (sets the working colour) | 'off' (ends a colour)
  function colorPhrases(text, legendVals, baseOnly) {
    var s = trimLine(text);
    var hits = [];
    var m;
    if (!s) return hits;

    m = C_IN.exec(s);
    if (m && looksLikeColor(m[1], legendVals)) hits.push({ at: m.index, kind: 'base', name: cleanName(m[1]) });

    C_CHANGE.lastIndex = 0;
    while ((m = C_CHANGE.exec(s)) !== null) {
      if (looksLikeColor(m[1], legendVals)) hits.push({ at: m.index, kind: 'base', name: cleanName(m[1]) });
    }
    C_OFF.lastIndex = 0;
    while ((m = C_OFF.exec(s)) !== null) {
      if (looksLikeColor(m[1], legendVals)) hits.push({ at: m.index, kind: 'off', name: cleanName(m[1]) });
    }
    if (!baseOnly) {
      C_INCOLOR.lastIndex = 0;
      while ((m = C_INCOLOR.exec(s)) !== null) {
        hits.push({ at: m.index, kind: 'mention', name: cleanName(m[1]) });
      }
      C_ADDYARN.lastIndex = 0;
      while ((m = C_ADDYARN.exec(s)) !== null) {
        if (looksLikeColor(m[1], legendVals)) hits.push({ at: m.index, kind: 'mention', name: cleanName(m[1]) });
      }
    }
    hits.sort(function (a, b) { return a.at - b.at; });
    return hits;
  }

  function textLines(text) {
    if (text === null || text === undefined) return [];
    if (typeof text === 'string') return text.split(/\r\n|\r|\n/);
    if (Object.prototype.toString.call(text) === '[object Array]') {
      return text.map(function (x) {
        return (x && typeof x === 'object' && x.text !== undefined) ? String(x.text) : String(x == null ? '' : x);
      });
    }
    return String(text).split(/\r\n|\r|\n/);
  }

  function colors(text) {
    var raws = textLines(text);
    var legend = {};
    var legendVals = {};
    var names = [];
    var seen = {};
    var i, m, t;

    function add(name) {
      var n = cleanName(name);
      if (!n) return;
      var k = n.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      names.push(n);
    }

    // pass 1: the legend, so later lines can lean on its colour words
    for (i = 0; i < raws.length; i++) {
      t = trimLine(raws[i]);
      if (!t || t.indexOf('=') < 0) continue;
      LEGEND_RE.lastIndex = 0;
      while ((m = LEGEND_RE.exec(t)) !== null) {
        var key = m[1].toUpperCase();
        var val = cleanName(m[2]);
        if (!val || val.length < 2) continue;
        if (/^\d/.test(val)) continue;
        if (stitchInfo(val)) continue;
        if (stitchInfo(key)) continue;            // "SC = single crochet"
        if (!legendColour(val)) continue;         // "CH = chain"
        if (!legend[key]) legend[key] = val;
        legendVals[val.toLowerCase()] = true;
      }
    }
    Object.keys(legend).forEach(function (k) { add(legend[k]); });

    // pass 2: colour phrases in reading order
    for (i = 0; i < raws.length; i++) {
      colorPhrases(raws[i], legendVals, false).forEach(function (hit) { add(hit.name); });
    }

    return { legend: legend, names: names };
  }

  // =====================================================================
  // 10. expand() - one entry per produced stitch
  // =====================================================================

  var FILL_MARK = { fillMark: true };

  // --- stitch geometry (3D wave A) --------------------------------------
  // Heights are in sc units and come from the folk "flat circle" rates:
  // N_flat = 2*pi*h/w, so 6 sc per round flat => h/w = 6/2pi = 0.955, 8 hdc
  // => 1.27, 12 dc => 1.91, 16 tr => 2.55. Rounded to the reference table in
  // docs/brainstorm/3d/01-geometry-truth.md Part 1.2, which is what the
  // renderer is measured against.
  //
  //   [prefix, type, US height, UK height]
  // UK terms are one rung shorter than they read: UK dc = US sc, UK htr = US
  // hdc, UK tr = US dc, UK dtr = US tr, UK ttr/trtr = US dtr (03 #9).
  var STITCH_H = [
    [/^(?:trtr|ttr|quad)/, 'dtr', 3.3, 3.3],
    [/^dtr/, 'dtr', 3.3, 2.68],
    [/^htr/, 'hdc', 1.34, 1.34],
    [/^hdc/, 'hdc', 1.34, 1.34],
    [/^(?:tr|treble)/, 'tr', 2.68, 2.01],
    [/^dc/, 'dc', 2.01, 1],
    [/^(?:slst|slipst|slip|sl|ss)/, 'sl', 0.3, 0.3],
    [/^(?:fsc|sc)/, 'sc', 1, 1],
    [/^ch/, 'ch', 0, 0]
  ];
  // A bobble / puff / cluster stands as tall as whatever it is made of, which
  // the words rarely say - so it is left PENDING and resolved to the row's
  // dominant height at the end of expand().
  var H_PENDING = null;
  var W_SL = 0.7;                   // a slip stitch is narrower than a stitch

  // Affixes that decorate a stitch name without changing how tall it is.
  var TOK_LEAD_RE = /^(?:inv(?:isible)?|spike|crossed|cross|foundation|standing|extended|ext|linked|back|front|reverse|rev)+/;
  var TOK_TAIL_RE = /(?:inc(?:rease)?|incr|dec(?:rease)?|\d*tog(?:ether)?)$/;

  // -> { t, h, hUk } - the geometric family of a normalised token.
  function stitchFamily(bare) {
    var b = bare;
    var i;
    if (/(?:puff)/.test(b)) return { t: 'puff', h: H_PENDING, hUk: H_PENDING };
    if (/(?:bbl|bobble|popcorn|cluster|shell)/.test(b)) {
      return { t: 'bbl', h: H_PENDING, hUk: H_PENDING };
    }
    for (i = 0; i < STITCH_H.length; i++) {
      if (STITCH_H[i][0].test(b)) return { t: STITCH_H[i][1], h: STITCH_H[i][2], hUk: STITCH_H[i][3] };
    }
    b = b.replace(TOK_LEAD_RE, '').replace(TOK_TAIL_RE, '');
    for (i = 0; i < STITCH_H.length; i++) {
      if (STITCH_H[i][0].test(b)) return { t: STITCH_H[i][1], h: STITCH_H[i][2], hUk: STITCH_H[i][3] };
    }
    return { t: 'sc', h: 1, hUk: 1 };
  }

  /**
   * One stitch token, with the geometry the 3D model needs.
   * @param {string} word    the abbreviation as written
   * @param {boolean} [uk]   resolve heights in UK terms
   * @returns {{p:number,c:number,t:string,h:number|null,w:number,
   *            post:('front'|'back'|null),base:string}|null}
   */
  function stitchTok(word, uk) {
    var info = stitchInfo(word);
    if (!info) return null;
    var bare = String(word).toLowerCase().replace(/[^a-z0-9]/g, '');
    var post = null;
    var pm = /^(fp|bp)(sc|hdc|dc|tr)$/.exec(bare);
    if (pm) { post = pm[1] === 'fp' ? 'front' : 'back'; bare = pm[2]; }
    var fam = stitchFamily(bare);
    var t = fam.t;
    var h = uk ? fam.hUk : fam.h;
    if (info.p === 2 && info.c === 1) t = 'inc';
    else if (info.p === 1 && info.c >= 2) t = 'dec';
    return { p: info.p, c: info.c, t: t, h: h, w: t === 'sl' ? W_SL : 1, post: post, base: fam.t };
  }

  // A ceiling on one row's stitch list. A lace/granny round that is expanded
  // from the round below grows its own `prevCount` every round, so a pattern
  // that repeats such a round doubles the list each time - 40 rounds of it
  // would exhaust memory. No real row is this long; anything that reaches the
  // cap is a misreading, and a misreading must fail, not hang.
  var MAX_STITCHES = 20000;

  function cell(t, h, w) {
    return { t: t, c: null, h: h === undefined ? 1 : h, w: w === undefined ? 1 : w };
  }

  // n produced stitches of `tok`, repeated `times`. The second and later
  // stitches of ONE increase carry 'inc+' so a consumer can tell "one increase
  // of two" from "two separate increases" (01 §1.4 detection rule 1).
  function emit(tok, times) {
    var out = [], i, j;
    if (!(times > 0)) return out;
    if (times * Math.max(1, tok.p) > MAX_STITCHES) times = Math.floor(MAX_STITCHES / Math.max(1, tok.p));
    for (i = 0; i < times; i++) {
      for (j = 0; j < tok.p; j++) {
        out.push(cell(j > 0 && tok.t === 'inc' ? 'inc+' : tok.t, tok.h, tok.w));
      }
    }
    return out;
  }

  // n stitches worked into ONE position of the round below: an increase of n.
  // Only a plain 1-for-1 stitch becomes an increase; an `inc`/`dec` token that
  // already says what it is keeps its own meaning.
  function incRun(tok, n) {
    if (!(n >= 2) || tok.p !== 1 || tok.c !== 1) return emit(tok, n > 0 ? n : 0);
    var out = [], i;
    for (i = 0; i < n; i++) out.push(cell(i === 0 ? 'inc' : 'inc+', tok.h, tok.w));
    return out;
  }

  // One stitch that eats `n` positions of the round below: a decrease.
  function decCell(tok) { return cell('dec', tok.h, tok.w); }

  function runOf(type, height, n) {
    var out = [], i;
    if (n > MAX_STITCHES) n = MAX_STITCHES;
    for (i = 0; i < n; i++) out.push(cell(type, height, type === 'sl' ? W_SL : 1));
    return out;
  }

  function cloneList(list) {
    var out = [], i;
    for (i = 0; i < list.length; i++) {
      var e = list[i];
      if (e === FILL_MARK) continue;
      out.push({ t: e.t, c: e.c, h: e.h, w: e.w, g: e.g });
    }
    return out;
  }

  function paint(list, colr) {
    var out = [], i;
    for (i = 0; i < list.length; i++) {
      var e = list[i];
      if (e === FILL_MARK) { out.push(e); continue; }
      out.push({ t: e.t, c: colr, h: e.h, w: e.w, g: e.g });
    }
    return out;
  }

  // =====================================================================
  // 8c. Per-stitch WIDTH: who shares the width of what they are worked into
  //
  // 01 §1.2 states the rule twice: a chain space is `k` wide and 0 tall, and
  // "groups worked into one place share the width of what they are worked
  // into". A stitch worked into a stitch is one wide, and an increase is two
  // stitches side by side in the new round - that is why `Sigma w` = count for
  // every amigurumi round and why a +6 round is 6 wider than the one below.
  // But a shell, a cluster or a corner group worked into ONE chain space does
  // not widen the fabric by its stitch count: the Premier wrap's shell row
  // puts eight positions (sc, ch 3, tr, dc, hdc, sc) into one ch-3 space plus
  // the stitch it skips over, and the finished wrap is 405 stitches wide at
  // every one of its 46 rows, not 808. So those eight positions divide the
  // four positions they consume between them.
  //
  // The division cannot be done where the words are read: a repeat unit is
  // expanded ONCE and then cloned once per anchor, long after. So each cell
  // that shares carries a share id, and one {w, n} record says how wide the
  // anchor is and how many cells were in the unit. Every clone of that unit
  // then divides the same anchor between the same n cells - which is exactly
  // what the fabric does, one anchor per repeat.
  // ---------------------------------------------------------------------

  /** Open a share over an anchor `w` positions wide. Under 2 there is nothing
   *  to share: one stitch into one stitch is one stitch wide. */
  function openShare(ctx, w) {
    if (!ctx) return;
    ctx.share = null;
    if (!(w >= 2)) return;
    ctx.shareId = (ctx.shareId || 0) + 1;
    var id = 's' + ctx.shareId;
    ctx.shares[id] = { w: w, n: 0 };
    ctx.share = id;
  }

  /** These cells go into the anchor the open share names. */
  function joinShare(ctx, cells) {
    if (!ctx || !ctx.share || !cells) return;
    var rec = ctx.shares[ctx.share], i;
    for (i = 0; i < cells.length; i++) {
      if (!cells[i] || cells[i] === FILL_MARK) continue;
      cells[i].g = ctx.share;
      rec.n++;
    }
  }

  // The stitch the group sits over: "(sc, ch 3, tr, dc, hdc, sc) in this ch-3
  // sp, sk next st" consumes the space AND the skipped stitch, so the group is
  // four positions wide, not three.
  function widenShare(ctx, extra) {
    if (ctx && ctx.share && extra > 0) ctx.shares[ctx.share].w += extra;
  }

  function closeShare(ctx) { if (ctx) ctx.share = null; }

  /** Divide each anchor between the cells worked into it. A stitch is never
   *  made WIDER this way - a lone sc in a ch-3 space gathers the space, it
   *  does not become three stitches wide. */
  function applyShares(list, shares) {
    var i, e, rec, w;
    if (!list || !shares) return;
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (!e || e === FILL_MARK || !e.g) continue;
      rec = shares[e.g];
      if (rec && rec.n > 0) {
        w = rec.w / rec.n;
        if (w < e.w) e.w = w;
      }
      delete e.g;
    }
  }

  // How many positions of the round below the anchor a phrase names covers.
  // "in next ch-3 sp" says three; "in next sc" says one; a bare "in next sp"
  // says nothing at all, and guessing it from the round below's widest space
  // reads a granny round's own new corner loop as part of the space it grew
  // out of - so an unnumbered space shares nothing and every stitch in it
  // stays one wide.
  function anchorWidth(text) {
    return chSpWidth(text);
  }

  function sumWidth(list) {
    var t = 0, i;
    for (i = 0; i < list.length; i++) {
      if (!list[i] || list[i] === FILL_MARK) continue;
      t += (typeof list[i].w === 'number' && isFinite(list[i].w)) ? list[i].w : 1;
    }
    return Math.round(t * 1e6) / 1e6;
  }

  // Is everything this fragment made a chain? A made chain either bridges to
  // the next anchor (one wide per chain, 01 §1.2) or sits inside the anchor
  // the fragment before it worked into, and only the words that come next say
  // which.
  function allChain(list) {
    var i, any = false;
    for (i = 0; i < list.length; i++) {
      if (!list[i] || list[i] === FILL_MARK) continue;
      if (list[i].t !== 'ch') return false;
      any = true;
    }
    return any;
  }

  // The stitches of one bracket group all worked into a single stitch or space
  // (a granny corner, a shell, a cluster): the first becomes the increase, the
  // rest 'inc+'. Chain spaces inside the group keep their own type, so a
  // `(3tr, 2ch, 3tr)` corner still reports its 2-chain gap.
  function asIncGroup(list) {
    var out = [], i, first = true;
    for (i = 0; i < list.length; i++) {
      var e = list[i];
      if (e === FILL_MARK) { out.push(e); continue; }
      if (e.t === 'ch') { out.push({ t: e.t, c: e.c, h: e.h, w: e.w, g: e.g }); continue; }
      out.push({ t: first ? 'inc' : 'inc+', c: e.c, h: e.h, w: e.w, g: e.g });
      first = false;
    }
    return out;
  }

  function countable(list) {
    var n = 0, i;
    for (i = 0; i < list.length; i++) if (list[i] !== FILL_MARK && list[i].t !== 'ch') n++;
    return n;
  }

  // A motif has between three and eight corners. Anything outside that is a
  // mesh, a ring of chain spaces or a misreading, and naming it "the corners"
  // would be worse than admitting the round said nothing.
  var CORNERS_MIN = 3, CORNERS_MAX = 8;

  /**
   * The anchors one expanded round leaves for the next: its chain spaces, the
   * clusters it worked into a single place, and the gaps between those
   * clusters. All of it read back off the stitch list, which is the only
   * record of what the round actually made.
   *
   * A `(3tr, 2ch, 3tr)` corner is one cluster with its chain space INSIDE it,
   * which is what tells a corner from a side: a cluster carrying a chain run
   * is a corner group, and the gaps between neighbouring clusters (walked
   * circularly, because a round has no ends) are the side spaces the next
   * round works into.
   *
   * @param {Array} list  cells as expand() hands them out
   * @returns {{spaces:number, sizes:Object, spaceW:number, groups:number,
   *            corners:number, cornerW:number, between:number, perSide:number}}
   */
  function roundStruct(list) {
    var res = { spaces: 0, sizes: {}, spaceW: 0, groups: 0, corners: 0,
      cornerW: 0, between: 0, perSide: 0 };
    if (!list || !list.length) return res;
    var n = list.length, i, j, runs = [], groups = [];
    for (i = 0; i < n; ) {
      if (list[i] && list[i].t === 'ch') {
        j = i;
        while (j < n && list[j] && list[j].t === 'ch') j++;
        runs.push({ s: i, e: j - 1, w: j - i });
        i = j;
      } else i++;
    }
    for (i = 0; i < n; ) {
      if (list[i] && list[i].t === 'inc') {
        j = i + 1;
        var last = i;
        while (j < n && list[j] && (list[j].t === 'inc+' || list[j].t === 'ch')) {
          if (list[j].t === 'inc+') last = j;
          j++;
        }
        groups.push({ s: i, e: last });
        i = last + 1;
      } else i++;
    }
    res.spaces = runs.length;
    var wCount = {}, k, maxW = 0, bestW = 0;
    for (i = 0; i < runs.length; i++) {
      wCount[runs[i].w] = (wCount[runs[i].w] || 0) + 1;
      if (runs[i].w > maxW) maxW = runs[i].w;
    }
    res.sizes = wCount;
    for (k in wCount) if (wCount[k] > bestW) { bestW = wCount[k]; res.spaceW = +k; }
    res.groups = groups.length;

    // corners: the clusters that carry a chain space of their own, else the
    // widest chain spaces of the round
    var cornerGroups = 0, cw = 0;
    for (i = 0; i < groups.length; i++) {
      for (j = 0; j < runs.length; j++) {
        if (runs[j].s > groups[i].s && runs[j].e < groups[i].e) {
          cornerGroups++; if (!cw) cw = runs[j].w;
          break;
        }
      }
    }
    if (cornerGroups >= CORNERS_MIN && cornerGroups <= CORNERS_MAX) {
      res.corners = cornerGroups;
      res.cornerW = cw;
    } else if (maxW > 0 && wCount[maxW] >= CORNERS_MIN && wCount[maxW] <= CORNERS_MAX) {
      res.corners = wCount[maxW];
      res.cornerW = maxW;
    }

    // side spaces: the gaps between neighbouring clusters, walked circularly,
    // that hold no chain run of their own
    if (groups.length >= 2) {
      for (i = 0; i < groups.length; i++) {
        var a = groups[i], b = groups[(i + 1) % groups.length];
        var from = a.e + 1, to = (i + 1 === groups.length) ? b.s + n : b.s;
        var clear = true;
        for (j = from; j < to; j++) {
          var cellAt = list[j % n];
          if (cellAt && cellAt.t === 'ch') { clear = false; break; }
        }
        if (clear) res.between++;
      }
    }
    if (res.corners > 0 && res.between > 0) {
      res.perSide = Math.round(res.between / res.corners);
    }
    return res;
  }

  function stripMarks(list) {
    var out = [], i;
    for (i = 0; i < list.length; i++) if (list[i] !== FILL_MARK) out.push(list[i]);
    return out;
  }

  function spliceMark(list, replacement) {
    var out = [], i, done = false;
    for (i = 0; i < list.length; i++) {
      if (list[i] === FILL_MARK) {
        if (!done) { out = out.concat(replacement); done = true; }
        continue;
      }
      out.push(list[i]);
    }
    if (!done) out = out.concat(replacement);
    return out;
  }

  // "8 Sc into Magic Ring" / "Mr6" - n stitches of whatever kind is named.
  function mrList(s, n, uk) {
    var mm = /(\d+)\s*(hdc|dc|tr|sc)\b/i.exec(s);
    var tok = mm ? stitchTok(mm[2], uk) : null;
    return runOf(tok ? tok.t : 'sc', tok ? tok.h : 1, n > 0 ? n : 0);
  }

  // --- longhand / lace vocabulary (3D wave A) ---------------------------
  // These only ever run on the expand() side. evaluate() keeps its own
  // narrower reading, so nothing here can move a count that parse() already
  // computes - the richer shapes below simply stop expand() from giving up.

  // "Make a chain": "ch 3", "ch3", "3ch", "ch-3". NOT "ch-3 sp", which names a
  // space in the round below rather than making one.
  var R_CHAIN_MAKE = /^ch(?:ain)?s?\s*-?\s*(\d+)(?!\s*-?\s*(?:sp|space))|^(\d+)\s*-?\s*ch(?:ain)?s?\b(?!\s*-?\s*(?:sp|space))/i;
  // "sc next 2 sts tog", "sc in next 3 sts together", "dc in next 2 tog"
  var R_TOG_LONG = new RegExp('^(' + STITCH_ALT + ')\\s+(?:in\\s+)?(?:the\\s+)?next\\s+(\\d+)\\s*(?:sts?|stitches?|' +
    STITCH_ALT + ')?\\s*tog(?:ether)?\\b', 'i');
  // "Dcfp around each of next 4 sts", "sc in each of next 6 sts"
  var R_NEXT_N2 = new RegExp('^(?:(\\d+)\\s*)?(' + STITCH_ALT +
    ')\\s*(?:sts?|stitches?)?\\s*(?:in|into|around|over|behind)\\s+(?:each\\s+of\\s+)?(?:the\\s+)?next\\s+(\\d+)', 'i');
  // "sc twice in next st", "hdc 3 times in the same st"
  var R_TIMES_IN = new RegExp('^(' + STITCH_ALT +
    ')\\s*(?:sts?|stitches?)?\\s+(twice|thrice|two|three|four|five|\\d+)\\s*(?:times?)?\\s+(?:in|into)\\s+(?:the\\s+)?(?:next|same|first|last)\\b', 'i');
  // "hdc to last st", "Hdc until you have 2 sts remaining", "sc across to last st"
  var R_TO_LAST = new RegExp('^(' + STITCH_ALT +
    ')\\s*(?:sts?|stitches?)?\\s*(?:across\\s+|evenly\\s+)?(?:to|until|till)\\s+(?:the\\s+)?(?:last|end\\b|you\\s+have|within|\\d+\\s*(?:sts?|stitches?)\\s+rem)', 'i');
  // "3tr cl", "4dc cluster" - n posts closed into one stitch, over one place
  var R_CLUSTER = new RegExp('^(?:(\\d+)\\s*)?(' + STITCH_ALT + ')\\s*(?:cl|clu|cluster)\\b', 'i');
  // "miss 3tr", "skip 2dc" - R_ST_N's `(\d+)\b` cannot match when the count is
  // glued to a stitch name (a digit and a letter are both word characters), so
  // "miss 3tr" was reading as ONE missed stitch instead of three, and every
  // granny round built on it repeated three times too often.
  var R_ST_N_UNIT = new RegExp('^(' + STITCH_ALT + ')\\s+(\\d+)\\s*(?:' + STITCH_ALT +
    '|sts?|stitches?)?(?![a-z0-9])', 'i');
  // "3 dc in next sc", "7 dc in ch-5 sp", "5dc in next", "3 hdc in last st"
  var R_N_IN_ONE = new RegExp('^(\\d+)\\s*(' + STITCH_ALT + ')\\s*(?:sts?|stitches?)?\\s+(?:in|into)\\s+', 'i');
  // "3 sc in each corner", "2 dc in each ch-1 sp around", "3tr in space
  // between each 3tr group to next 2ch-sp", "sc in each sp around": the
  // stitch is plain enough, but how MANY times the phrase repeats is only in
  // the round below - anchorHits() asks it.
  var R_ANCHORED = new RegExp('^(?:(\\d+)\\s*)?(' + STITCH_ALT +
    ')\\s*(?:sts?|stitch(?:es)?)?\\s*(?:in|into|around)\\s+(.+)$', 'i');
  var IN_ONE_TARGET_RE = new RegExp('^(?:the\\s+|a\\s+|any\\s+|one\\s+)?' +
    '(?:next|same|this|that|last|first|corner|centre|center|middle|' +
    'ch(?:ain)?\\s*-?\\s*\\d|\\d+\\s*-?\\s*ch(?:ain)?\\s*-?\\s*(?:sp|space)|' +
    'sp\\b|space|ring|circle|loop|lp\\b|st\\b|stitch|arch|gap)', 'i');
  // The group / stitch goes into ONE place: "(3tr, 2ch, 3tr) in next 2ch-sp"
  var GROUP_IN_ONE_RE = /^[\s,;]*(?:all\s+)?(?:in|into)\s+(?:the\s+|a\s+|any\s+)?(?:next|same|this|that|last|first|corner|centre|center|each\s+corner|ch(?:ain)?\s*-?\s*\d+\s*-?\s*(?:sp|space)|\d+\s*-?\s*ch(?:ain)?\s*-?\s*(?:sp|space)|ch\s*-?\s*sp|sp\b|space\b)/i;
  var GROUP_IN_EACH_RE = /^[\s,;]*(?:all\s+)?(?:in|into)\s+(?:each|every)\b/i;
  // How many positions of the round below a named chain space covers.
  var CH_SP_WIDTH_RE = /(?:ch(?:ain)?\s*-?\s*(\d+)|(\d+)\s*-?\s*ch(?:ain)?)\s*-?\s*(?:sp|space)/i;
  // Connectives that only join one instruction fragment to the next.
  var SEG_LEAD_RE = /^(?:ending\s+with|ending|end\s+with|finishing\s+with|then|also|finally|now|next|followed\s+by|working|work\s+in|and\s+then)\s+/i;
  // A fragment with no stitch abbreviation in it at all is commentary, not an
  // instruction the expander has failed to read ("in next 2ch-sp", "3 per
  // side", "end at **", "above the dc of Rnd 4").
  var SEG_STITCHY_RE = new RegExp('(?:^|[^a-z])(?:' + STITCH_ALT + ')(?![a-z])', 'i');
  // Positioning moves and printed asides that DO name a stitch, so the plain
  // branches would otherwise read them as work: "Sl st across sts to next
  // 2ch-sp" travels to the start of the round, "12 x 3tr groups" is the total
  // the leaflet prints, "(counts as 1 tr)" describes the chain before it.
  var SEG_MOVE_RE = [
    /^(?:sl\s*st|slst|ss)\s*(?:es)?\s+(?:across|round|around|along)\b/i,
    /^(?:sl\s*st|slst|ss)\s*(?:es)?\s+(?:in|into|to)\s+(?:the\s+)?(?:join|top|first|beg|corner|centre|center|marker|form)/i,
    /^(?:sl\s*st|slst|ss)\s*(?:es)?\s+to\s+/i,
    /^counts?\s+as\b/i,
    /^(?:does|do|don'?t)\s+not\s+count\b/i,
    /^\d+\s*[x×]\s*\d*\s*[a-z]*\s*groups?\b/i,
    /^\d+\s*per\s/i
  ];
  var SEG_COMMENT_RE = new RegExp('^(?:' + [
    '(?:all\\s+)?in(?:to)?\\s+', 'at\\s+', 'to\\s+', 'above\\b', 'below\\b', 'behind\\b',
    'between\\b', 'through\\b', 'around\\b', 'across\\b', 'over\\b', 'from\\b',
    'rep(?:eat)?\\b', 'end(?:ing)?\\b', 'join\\w*\\b', 'counts?\\s+as\\b',
    '(?:does\\s+not|dont|don\'t)\\s+count\\b', 'sl\\s*st\\s+across\\b', 'ss\\s+across\\b',
    'slst\\s+across\\b', '(?:sl\\s*st|ss|slst)\\s+(?:to|in(?:to)?)\\s+(?:join|top|first|beg|the\\s+top)',
    'one\\s+side\\b', 'ch(?:ain)?\\s*-?\\s*\\d+\\s*-?\\s*(?:sp|space)', '\\*+\\s*$',
    '\\d+\\s*(?:per|x)\\b', 'same\\b', 'corner\\b', 'sp\\b', 'space\\b', 'side\\b'
  ].join('|') + ')', 'i');

  function chSpWidth(s) {
    var m = CH_SP_WIDTH_RE.exec(s);
    if (!m) return 0;
    var n = num(m[1] || m[2]);
    return (n && n > 0 && n < 30) ? n : 0;
  }

  // =====================================================================
  // 9b. Motif anchors: how many times a round repeats is in the ROUND BELOW
  //
  // A granny/motif round almost never says how often it repeats. "3tr in
  // space between each 3tr group to next 2ch-sp", "(3tr, 2ch, 3tr) in each
  // corner sp", "2 dc in each ch-1 sp around", "*3tr in next sp; rep from *
  // around" all mean "once per anchor of this kind", and the only place the
  // number of anchors is written down is the fabric the round below made.
  //
  // So every expanded round is boiled down to a small structure record
  // (roundStruct) and parked in `state`; the next round reads it back as
  // ctx.struct. Before this, such a round was sized by dividing the round
  // below's POSITION count by whatever the words seemed to consume, which
  // over-read every granny round it met: the Stylecraft hexagon came out at
  // 109 trebles where the leaflet prints 54, and "Rep Rnd 3" then re-read
  // that same misreading twelve times.
  // ---------------------------------------------------------------------

  // A target that names a SPACE (or a corner) of the round below rather than
  // a stitch: "in next 2ch-sp", "all in ch-3 sp", "in same ch-sp",
  // "skip next sp", "in each corner". "all in next sc" is NOT one of these.
  var SPACE_TARGET_RE = new RegExp('\\b(?:in|into|skip|miss|sk)\\s+' +
    '(?:(?:the|a|an|any|all|each|every|next|same|this|that|last|first|corner|centre|center|' +
    'of|ch|chain|\\d+(?:st|nd|rd|th))\\s+)*' +
    '(?:ch(?:ain)?\\s*-?\\s*\\d*\\s*-?\\s*|\\d+\\s*-?\\s*ch(?:ain)?s?\\s*-?\\s*)?' +
    '(?:sp|space|corner)s?\\b', 'i');
  // "(tr, dc, hdc, sc) in SAME ch-3 sp" goes back into the space the fragment
  // before it already worked into, so it is not another anchor - unless nothing
  // has been worked yet, in which case "in same ch-sp" IS this piece's own
  // space ("sl st across to next 2ch-sp, 3ch, (2tr, 2ch, 3tr) in same ch-sp").
  var SAME_TARGET_RE = /\b(?:in|into)\s+(?:the\s+)?same\b/i;

  function eatsSpace(text, ctx) {
    if (!SPACE_TARGET_RE.test(text)) return false;
    if (SAME_TARGET_RE.test(text) && ctx.spUsed > 0) return false;
    return true;
  }

  // "in the space between each 3tr group to the next corner" - a gap between
  // two clusters of the round below, not a chain space.
  var A_BETWEEN_RE = /\bbetween\b[^,;]*?\bgroups?\b/i;
  // "between the next two 3tr groups" names ONE gap; "in the space between the
  // 3tr groups" names every gap of that side, which is one in the round that
  // sets the pattern and one more in each round that re-works it.
  var A_ONE_GAP_RE = /\bbetween\s+(?:the\s+)?next\s+(?:two|2)\b/i;
  var A_EACH_RE = /\b(?:each|every|all)\b/i;
  var A_TO_CORNER_RE = /\bto\s+(?:the\s+)?(?:next|last|first)?\s*(?:corner|ch(?:ain)?\s*-?\s*\d|\d+\s*-?\s*ch)/i;
  var A_CORNER_RE = /\b(?:each|every|all)\s+(?:of\s+the\s+)?(?:\d+\s+)?corner/i;
  var A_CHSP_RE = /\b(?:each|every|all)\s+(?:of\s+the\s+)?(?:ch(?:ain)?\s*-?\s*(\d+)|(\d+)\s*-?\s*ch(?:ain)?s?)\s*-?\s*(?:sp|space)/i;
  var A_SP_RE = /\b(?:each|every|all)\s+(?:of\s+the\s+)?(?:ch(?:ain)?\s*-?\s*)?(?:sp|space)/i;
  var A_GROUP_RE = /\b(?:each|every|all)\s+(?:of\s+the\s+)?(?:\S+\s+)?groups?\b/i;

  /**
   * Which anchor of the round below a phrase names, and how many there are.
   * @param {string} text    the words after the stitch ("in each corner sp")
   * @param {Object} struct  roundStruct() of the round below
   * @returns {{n:number,w:number,kind:string}|null} null when the words name
   *          no anchor, or the round below never said how many it left.
   */
  function anchorHits(text, struct) {
    if (!struct) return null;
    var t = String(text == null ? '' : text);
    var m;
    if (A_BETWEEN_RE.test(t)) {
      if (!(struct.perSide >= 1)) return null;
      var many = A_EACH_RE.test(t) || A_TO_CORNER_RE.test(t) || !A_ONE_GAP_RE.test(t);
      return { n: many ? struct.perSide : 1, w: 1, kind: 'gap' };
    }
    if (A_CORNER_RE.test(t)) {
      if (!(struct.corners >= 1)) return null;
      return { n: struct.corners, w: struct.cornerW || 1, kind: 'corner' };
    }
    m = A_CHSP_RE.exec(t);
    if (m) {
      var w = num(m[1] || m[2]);
      var nw = (w && struct.sizes) ? (struct.sizes[w] || 0) : 0;
      if (!(nw >= 1)) return null;
      return { n: nw, w: w, kind: 'space' };
    }
    if (A_SP_RE.test(t)) {
      if (!(struct.spaces >= 1)) return null;
      return { n: struct.spaces, w: struct.spaceW || 1, kind: 'space' };
    }
    if (A_GROUP_RE.test(t)) {
      if (!(struct.groups >= 1)) return null;
      return { n: struct.groups, w: 1, kind: 'group' };
    }
    return null;
  }

  /**
   * How many unit repeats a "* ... ; rep from * around" needs so that the
   * anchors it eats come to exactly the number the round below left.
   *   total = pre + reps*head + (endAt ? reps-1 : reps)*post + rest
   * @returns {number|null} null when the unit eats no anchor of this kind.
   */
  function anchorReps(total, endAt, pre, head, post, rest) {
    var per = head + post;
    if (!(total >= 1) || per <= 0) return null;
    var room = total - pre - rest + (endAt ? post : 0);
    var n = Math.round(room / per);
    if (!(n >= 1) || n > 500) return null;
    return n;
  }

  var WORD_N = { twice: 2, thrice: 3, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  function wordNum(s) {
    if (s === null || s === undefined) return null;
    var t = String(s).toLowerCase().trim();
    if (WORD_N[t] !== undefined) return WORD_N[t];
    return num(t);
  }

  // The stitch-emitting twin of parseSegment(). Same branches, same order,
  // plus the longhand/lace branches above when `ctx` is supplied.
  // -> { list, c } | { fill:{list,c} } | { abs:list } | null
  function expandSegment(seg, ctx, next) {
    var s = seg.trim().replace(/\s+/g, ' ');
    if (!s) return { list: [], c: 0 };
    var rich = !!ctx;
    var uk = rich && ctx.uk;
    var nx = String(next == null ? '' : next).trim();
    // A repeat marker the scanner could not pair up (the closing `*` is on a
    // printed line the column extractor never joined): "*Dcfp around each".
    if (rich) { s = s.replace(/^\*+\s*/, '').replace(/\s*\*+$/, ''); if (!s) return { list: [], c: 0 }; }

    var i, m, st, lead, n, rest;

    // A chain: a turning/foundation chain before the row's first stitch (and
    // one parked in front of a "turn") makes no ring position; a chain worked
    // BETWEEN stitches is a space, as wide as the stitches it bridges and no
    // taller than the fabric it spans (01 §1.2).
    if (rich) {
      m = R_CHAIN_MAKE.exec(s);
      if (m) {
        n = num(m[1] || m[2]);
        ctx.hadChain = true;
        if (!(n > 0)) return { list: [], c: 0 };
        var bridges = ctx.produced || /^(?:skip|miss|sk)\b/i.test(nx);
        if (!bridges || /^turn\b/i.test(nx)) {
          // "Ch 6, sc in 3rd ch of next ch-3 sp": an opening chain longer than
          // the turning chain carries the row's FIRST space in its tail. Drop
          // the turn and keep the space, or a mesh row makes one space fewer
          // than it ate and the whole wrap narrows a space every row.
          var opw = /^turn\b/i.test(nx) ? 0 : chSpWidth(nx);
          if (opw > 0 && opw < n) return { list: runOf('ch', 0, opw), c: 0 };
          return { list: [], c: 0 };
        }
        return { list: runOf('ch', 0, n), c: 0 };
      }
      for (i = 0; i < SEG_MOVE_RE.length; i++) {
        if (SEG_MOVE_RE[i].test(s)) return { list: [], c: 0 };
      }
    }

    for (i = 0; i < ZERO_RES.length; i++) if (ZERO_RES[i].test(s)) return { list: [], c: 0 };
    if (WORK_EVEN_RE.test(s)) return { fill: { list: runOf('sc', 1, 1), c: 1 } };

    // "8 sc into the ring": the whole row when it opens the piece, but only
    // `n` more stitches when the row has already made some ("3ch, 2tr in
    // ring, 2ch, (3tr, 2ch) five times in ring" is 18 tr, not 2).
    var midRing = rich && ctx.produced;
    m = MR_RE1.exec(s);
    if (m) return midRing ? { list: mrList(s, num(m[1]), uk), c: 0 } : { abs: mrList(s, num(m[1]), uk) };
    m = MR_RE2.exec(s);
    if (m) return midRing ? { list: mrList(s, num(m[1]), uk), c: 0 } : { abs: mrList(s, num(m[1]), uk) };

    s = s.replace(PREFIX_RE, '');
    if (rich) s = s.replace(SEG_LEAD_RE, '');
    for (i = 0; i < ZERO_RES.length; i++) if (ZERO_RES[i].test(s)) return { list: [], c: 0 };
    m = MR_RE1.exec(s);
    if (m) return midRing ? { list: mrList(s, num(m[1]), uk), c: 0 } : { abs: mrList(s, num(m[1]), uk) };

    if (rich) {
      // "sc next 2 sts tog" / "sc in next 3 sts together" -> one decrease
      m = R_TOG_LONG.exec(s);
      if (m) {
        st = stitchTok(m[1], uk); if (!st) return null;
        n = num(m[2]);
        if (n >= 2) return { list: [decCell(st)], c: n };
      }
      // "Dcfp around each of next 4 sts"
      m = R_NEXT_N2.exec(s);
      if (m) {
        st = stitchTok(m[2], uk); if (!st) return null;
        lead = m[1] ? num(m[1]) : 1;
        n = num(m[3]);
        if (lead >= 2 && st.p === 1 && st.c === 1) {
          var many = [];
          for (i = 0; i < n; i++) many = many.concat(incRun(st, lead));
          return { list: many, c: n * st.c };
        }
        return { list: emit(st, n * lead), c: n * st.c };
      }
      // "sc twice in next st" / "hdc 3 times in the same st"
      m = R_TIMES_IN.exec(s);
      if (m) {
        st = stitchTok(m[1], uk); if (!st) return null;
        n = wordNum(m[2]);
        if (n >= 2) return { list: incRun(st, n), c: st.c };
      }
    }

    m = R_NEXT_N.exec(s);
    if (m) {
      st = stitchTok(m[2], uk); if (!st) return null;
      lead = m[1] ? num(m[1]) : 1;
      n = num(m[3]);
      if (rich && lead >= 2 && st.p === 1 && st.c === 1) {
        var runs = [];
        for (i = 0; i < n; i++) runs = runs.concat(incRun(st, lead));
        return { list: runs, c: n * st.c };
      }
      return { list: emit(st, n * lead), c: n * st.c };
    }
    m = R_FROM_HOOK.exec(s);
    if (m) { st = stitchTok(m[1], uk); return st ? { list: emit(st, 1), c: 0 } : null; }

    // An anchored phrase repeats once per corner / space / group-gap of the
    // round below, which is a definite number rather than an open fill.
    if (rich && ctx.struct) {
      m = R_ANCHORED.exec(s);
      if (m) {
        var ah = anchorHits(m[3], ctx.struct);
        if (ah) {
          st = stitchTok(m[2], uk);
          if (st) {
            var anLead = m[1] ? num(m[1]) : 1;
            var anUnit = (anLead >= 2 && st.p === 1 && st.c === 1) ?
              incRun(st, anLead) : emit(st, anLead);
            // one anchor per repeat: the unit divides ONE anchor, and every
            // clone of it divides its own
            openShare(ctx, ah.w); joinShare(ctx, anUnit); closeShare(ctx);
            var anAll = [];
            for (i = 0; i < ah.n; i++) anAll = anAll.concat(cloneList(anUnit));
            ctx.anchored = true;
            ctx.spUsed += (ah.kind === 'space' || ah.kind === 'corner') ? ah.n : 0;
            ctx.cnUsed += (ah.kind === 'corner') ? ah.n : 0;
            return { list: anAll, c: ah.n * (ah.w || 1), anchored: true, shared: true };
          }
        }
      }
    }

    m = R_EACH.exec(s);
    if (m) {
      st = stitchTok(m[2], uk); if (!st) return null;
      var lead2 = m[1] ? num(m[1]) : 1;
      // "3 dc in each ch-2 sp around": each repetition eats the whole 2-chain
      // space, not one position.
      var eachW = rich ? chSpWidth(s) : 0;
      var eachC = eachW || st.c;
      var eachL = (rich && lead2 >= 2 && st.p === 1 && st.c === 1) ?
        incRun(st, lead2) : emit(st, lead2);
      // "3 dc in each ch-2 sp": every repeat of the fill shares one 2-wide space
      openShare(ctx, eachW); joinShare(ctx, eachL); closeShare(ctx);
      return { fill: { list: eachL, c: eachC }, shared: true };
    }
    if (rich) {
      m = R_EACH_AROUND.exec(s);
      if (m) {
        st = stitchTok(m[2], uk);
        if (st) {
          var la = m[1] ? num(m[1]) : 1;
          var laW = chSpWidth(s);
          var laL = la >= 2 && st.p === 1 && st.c === 1 ? incRun(st, la) : emit(st, la);
          openShare(ctx, laW); joinShare(ctx, laL); closeShare(ctx);
          return { fill: { list: laL, c: laW || st.c }, shared: true };
        }
      }
    }
    m = R_AROUND.exec(s);
    if (m) { st = stitchTok(m[1], uk); return st ? { fill: { list: emit(st, 1), c: st.c } } : null; }

    if (rich) {
      // "hdc to last st" / "Hdc until you have 2 sts remaining" - work on to
      // the tail the rest of the row spells out.
      m = R_TO_LAST.exec(s);
      if (m) {
        st = stitchTok(m[1], uk);
        if (st) return { fill: { list: emit(st, 1), c: st.c } };
      }
      // "3tr cl in next sp" - n posts closed into one stitch
      m = R_CLUSTER.exec(s);
      if (m) {
        st = stitchTok(m[2], uk);
        if (st) return { list: [cell('bbl', st.h, 1)], c: 1 };
      }
      // "3 dc in next sc", "7 dc in ch-5 sp", "2 hdc in first st" - n stitches
      // into ONE position of the round below: an increase of n.
      m = R_N_IN_ONE.exec(s);
      if (m) {
        rest = s.slice(m[0].length);
        if (IN_ONE_TARGET_RE.test(rest)) {
          st = stitchTok(m[2], uk);
          if (st) {
            n = num(m[1]);
            return { list: incRun(st, n), c: (chSpWidth(rest) || st.c) };
          }
        }
      }
    }

    m = R_N_IN_NEXT.exec(s);
    if (m) {
      st = stitchTok(m[2], uk); if (!st) return null;
      n = num(m[1]);
      return { list: rich ? incRun(st, n) : emit(st, n), c: st.c };
    }

    m = R_N_ST.exec(s);
    if (m) { st = stitchTok(m[2], uk); return st ? { list: emit(st, num(m[1])), c: num(m[1]) * st.c } : null; }

    m = R_ST_X.exec(s);
    if (m) { st = stitchTok(m[1], uk); return st ? { list: emit(st, num(m[2])), c: num(m[2]) * st.c } : null; }

    m = R_ST_N.exec(s);
    if (m) { st = stitchTok(m[1], uk); return st ? { list: emit(st, num(m[2])), c: num(m[2]) * st.c } : null; }

    if (rich) {
      m = R_ST_N_UNIT.exec(s);
      if (m) {
        st = stitchTok(m[1], uk);
        if (st) return { list: emit(st, num(m[2])), c: num(m[2]) * st.c };
      }
    }

    m = R_ST.exec(s);
    if (m) { st = stitchTok(m[1], uk); return st ? { list: emit(st, 1), c: st.c } : null; }

    // Commentary: a fragment that names no stitch at all, or one of the
    // fixed connective openings, costs nothing rather than failing the row.
    if (rich && (!SEG_STITCHY_RE.test(s) || SEG_COMMENT_RE.test(s))) return { list: [], c: 0 };

    return null;
  }

  // The stitch-emitting twin of sumSegments().
  // A `skip`/`miss` of k positions immediately followed by ONE stitch that
  // takes one more is a decrease in disguise ("skip next st, sc in next" eats
  // two and makes one) - unless a chain space has just bridged the gap, in
  // which case it is a mesh and nothing has decreased.
  function expandSegments(list, ctx, tail) {
    var out = [], c = 0, fill = null;
    var pendSkip = 0, lastWasCh = false;
    for (var i = 0; i < list.length; i++) {
      var r = expandSegment(list[i], ctx, list[i + 1]);
      if (!r) return null;
      // Which anchor of the round below did this fragment work into, and is
      // the fragment after it going back into the SAME one? `tail` is what the
      // words say past the bracket group that follows this text run, which is
      // where "(tr, dc, hdc, sc) in same ch-3 sp" spells out that the chain
      // just made sits inside the space rather than bridging to the next.
      if (ctx && !r.shared && r.abs === undefined) {
        var segT = list[i];
        var nextT = tail || '';
        for (var q = i + 1; q < list.length; q++) {
          if (String(list[q] || '').trim()) { nextT = list[q]; break; }
        }
        var cells = r.fill ? r.fill.list : r.list;
        if (!cells.length && r.c > 0) {
          widenShare(ctx, r.c);            // a skipped stitch the group sits over
        } else if (!cells.length) {
          /* commentary: leave the open share alone */
        } else if (allChain(cells)) {
          if (SAME_TARGET_RE.test(nextT)) joinShare(ctx, cells);
          else closeShare(ctx);
        } else if (SAME_TARGET_RE.test(segT)) {
          joinShare(ctx, cells);
        } else {
          openShare(ctx, anchorWidth(segT));
          joinShare(ctx, cells);
        }
      }
      // A fragment that works into (or skips) a SPACE of the round below eats
      // one of its anchors. Only a fragment that actually did something: the
      // bare " in next 2ch-sp" left over beside a bracket group is commentary
      // on the group, and the group has already been counted.
      if (ctx && !r.fill && r.abs === undefined && !r.anchored &&
          (r.c > 0 || (r.list && r.list.length)) && eatsSpace(list[i], ctx)) {
        ctx.spUsed++;
      }
      if (r.abs !== undefined) {
        if (ctx && r.abs.length) ctx.produced = true;
        return { abs: r.abs };
      }
      if (r.fill) {
        if (fill) return null;
        fill = r.fill; out.push(FILL_MARK);
        if (ctx) ctx.produced = true;
        pendSkip = 0; lastWasCh = false;
        continue;
      }
      if (ctx) {
        if (r.list.length === 0 && r.c > 0) { pendSkip += r.c; c += r.c; continue; }
        if (pendSkip > 0 && !lastWasCh && !ctx.hadChain && r.list.length === 1 && r.c === 1 &&
            r.list[0].t !== 'ch' && r.list[0].t !== 'inc') {
          var dc1 = cell('dec', r.list[0].h, r.list[0].w);
          dc1.g = r.list[0].g;
          out.push(dc1);
          c += r.c; pendSkip = 0; ctx.produced = true;
          continue;
        }
        pendSkip = 0;
        if (r.list.length) {
          var hasReal = false;
          for (var k = 0; k < r.list.length; k++) if (r.list[k].t !== 'ch') hasReal = true;
          lastWasCh = r.list[r.list.length - 1].t === 'ch';
          if (hasReal) ctx.produced = true;
        }
      }
      out = out.concat(r.list); c += r.c;
    }
    return { list: out, c: c, fill: fill };
  }

  // A colour prefix sitting at the end of the text run before a group:
  // "Sc 10 , A (Sc 3)", "Hdc 1 , Almond (Hdc 13)", "(in B) sc 3".
  var PREFIX_TAIL_RE = /(?:^|[,;.:)\]]|\s)\s*(?:in\s+)?(colou?r\s+[a-z]|[a-z][a-z'-]{0,15})\s*:?\s*$/i;

  function resolveColor(word, ctx) {
    var t = String(word == null ? '' : word).trim().replace(/[:.,]+$/, '').replace(/\s+/g, ' ');
    if (!t) return null;
    if (/^[a-z]$/i.test(t)) {
      var k = t.toUpperCase();
      return ctx.legend[k] || k;
    }
    if (/^colou?r\s+[a-z]$/i.test(t)) return titleCase(t);
    if (/^(?:mc|cc)$/i.test(t)) return t.toUpperCase();
    if (stitchInfo(t)) return null;
    var low = t.toLowerCase();
    if (COLOR_STOP[low]) return null;
    if (ctx.names[low]) return ctx.names[low];
    if (colorHex(t)) return ctx.names[low] || t;
    return null;
  }

  function prefixColorFor(items, i, ctx) {
    if (i <= 0 || !ctx || !ctx.legend) return null;
    var before = items[i - 1];
    if (!before || before.kind !== 'text') return null;
    var m = PREFIX_TAIL_RE.exec(before.text);
    if (!m) return null;
    return resolveColor(m[1], ctx);
  }

  // The cell to pad a short row with: the row's own dominant stitch, never a
  // hard-coded sc (03 #7 - a 98-stitch dc row was reported at sc height).
  function padCell(list) {
    var counts = {}, i, e, key, best = null, bestN = -1;
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (e === FILL_MARK || e.t === 'ch' || e.h === H_PENDING) continue;
      key = e.t + '|' + e.h;
      counts[key] = counts[key] || { n: 0, t: e.t, h: e.h, w: e.w };
      counts[key].n += 1;
    }
    Object.keys(counts).forEach(function (k) {
      var v = counts[k];
      if (v.n > bestN || (v.n === bestN && v.h > best.h)) { bestN = v.n; best = v; }
    });
    if (!best) return cell('sc', 1, 1);
    var t = best.t;
    if (t === 'inc' || t === 'inc+' || t === 'dec') {
      t = 'sc';
      for (var j = 0; j < STITCH_H.length; j++) {
        if (STITCH_H[j][2] === best.h) { t = STITCH_H[j][1]; break; }
      }
    }
    return cell(t, best.h, t === 'sl' ? W_SL : 1);
  }

  function padRun(list, n) {
    var pc = padCell(list), out = [], i;
    for (i = 0; i < n; i++) out.push({ t: pc.t, c: null, h: pc.h, w: pc.w });
    return out;
  }

  // "3. Rnd: ..." / "12. Round - ..." - a bare-numeral marker leaves the
  // keyword standing in front of the instruction, and every UK/translated
  // pattern that numbers its rounds this way then failed to evaluate at all
  // (03 #12). Strip it wherever a marker has just come off the front.
  var ROW_KEYWORD_RE = /^\s*(?:rnds?|rounds?|rows?)\s*\d*\s*(?:\(\s*(?:ws|rs|wrong\s+side|right\s+side)\s*\))?\s*[:.)–-]\s*/i;
  function stripRowKeyword(s) {
    return String(s == null ? '' : s).replace(ROW_KEYWORD_RE, '');
  }

  // Pattern-wide text repairs that only the expander applies.
  //   Dcfp/Dcbp   Yarnspirations writes the post stitches back to front
  //   3ch (counts as 1 tr)   a turning chain that IS a stitch
  //   ...(counts as 1 tr here and throughout)   and so is the same chain at
  //   the head of every later round, though only the first round says so.
  //   Without that carry the Stylecraft hexagon loses one treble a round and
  //   its "18 x 3tr groups" round 3 comes out at 53 rather than 54.
  function richNormalise(s, ctx) {
    s = s
      .replace(/\bdc(fp|bp)\b/gi, function (all, w) { return w.toLowerCase() + 'dc'; })
      .replace(/\b(?:sc|hdc|tr)(fp|bp)\b/gi, function (all, w) {
        return w.toLowerCase() + all.slice(0, all.length - 2);
      })
      .replace(/\binvisible\s+dec(?:rease)?\b/gi, 'invdec')
      .replace(/\binv(?:isible)?\s+dec(?:rease)?\b/gi, 'invdec')
      .replace(/(\d+)\s*ch(?:ain)?s?\s*\(\s*counts?\s+as\s+(\d+)?\s*(sc|hdc|dc|htr|dtr|tr)\b([^)]*)\)/gi,
        function (all, ch, n, stw, tail) {
          if (ctx && /\bthroughout\b/i.test(tail)) {
            ctx.chThrough = { n: num(ch), st: stw };
          }
          return (n || '1') + ' ' + stw;
        });
    var th = ctx && ctx.chThrough;
    if (th && th.n > 0 && th.st) {
      // only the turning chain at the head of the round or of a clause, never
      // a "2ch-sp" (that names a space below) or a "top of beg 3ch"
      s = s.replace(new RegExp('(^|[,;:]\\s*)' + th.n +
        '\\s*ch(?:ain)?s?\\b(?!\\s*-?\\s*(?:sp|space))', 'i'),
        function (all, lead) { return lead + '1 ' + th.st; });
    }
    return s;
  }

  // One bracket group / comma run, expanded. Recursive, so a granny corner
  // inside a starred repeat inside a row all come out in the right order.
  // -> { list, c, fill } | null   (list may hold one FILL_MARK)
  function expandBody(s, ctx, items) {
    items = items || scanItems(s, !!ctx);
    if (!items.length) return null;
    var list = [], consumed = 0, fill = null;
    var i, k;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.kind === 'text') {
        // the words past the bracket group that follows this run - where a
        // group's own target ("... in same ch-3 sp") is written down
        var lookAhead = '';
        if (items[i + 1] && items[i + 1].kind === 'group' &&
            items[i + 2] && items[i + 2].kind === 'text') {
          lookAhead = items[i + 2].text;
        }
        var r = expandSegments(splitSegments(it.text), ctx, lookAhead);
        if (!r) return null;
        if (r.abs !== undefined) return { list: r.abs, c: 0, fill: null, abs: true };
        if (r.fill) { if (fill) return null; fill = r.fill; }
        list = list.concat(r.list); consumed += r.c;
        continue;
      }
      var spBefore = ctx ? ctx.spUsed : 0, cnBefore = ctx ? ctx.cnUsed : 0;
      // The words INSIDE a bracket name no anchor of their own - the anchor is
      // written after the bracket ("... in same ch-3 sp"). So the share the run
      // before the bracket opened has to survive reading the bracket, or the
      // group can no longer join the space the sc before it went into.
      var shBefore = ctx ? ctx.share : null;
      var g = ctx ? expandBody(it.text, ctx) : expandSegments(splitSegments(it.text), ctx);
      if (ctx) ctx.share = shBefore;
      if (!g || g.abs || g.fill) {
        if (it.mult === 1 && !it.filled && (!g || !g.fill)) continue;
        return null;
      }
      var colr = prefixColorFor(items, i, ctx);
      var glist = colr ? paint(g.list, colr) : g.list;
      var gc = g.c;
      // "(3tr, 2ch, 3tr) in next 2ch-sp" / "(sc, ch 2, sc) all in ch-3 sp":
      // the whole group lands in ONE place, so it is one increase of n and it
      // eats only the space it is worked into.
      var after = (items[i + 1] && items[i + 1].kind === 'text') ? items[i + 1].text : '';
      // Only the clause that names the group's OWN target, never everything the
      // round says next: in "(2tr, 2ch, 3tr) in same ch-sp, 3tr in space
      // between 3tr groups" the second clause is its own instruction, and
      // reading it as part of the group's target repeated the corner.
      var aft = after.replace(/^[\s,;]+/, '').split(/[,;]/)[0];
      if (ctx && aft && countable(glist) >= 2 &&
          (GROUP_IN_ONE_RE.test(aft) || GROUP_IN_EACH_RE.test(aft))) {
        glist = asIncGroup(glist);
        gc = chSpWidth(aft) || 1;
        if (eatsSpace(aft, ctx)) { ctx.cnUsed++; ctx.spUsed++; }
        // "(3tr, 2ch, 3tr) in each corner sp" - one such corner per corner of
        // the round below, a number only the round below knows.
        var ga = ctx.struct ? anchorHits(aft, ctx.struct) : null;
        // 01 §1.2: the group shares the width of the ONE place it is worked
        // into. "in same ch-3 sp" goes back into the space the fragment before
        // it already opened, so it joins that share instead of starting one.
        if (SAME_TARGET_RE.test(aft) && ctx.share) joinShare(ctx, glist);
        else {
          openShare(ctx, (ga && ga.w > 1) ? ga.w : anchorWidth(aft));
          joinShare(ctx, glist);
        }
        if (ga && ga.n > 1) {
          var gone = glist, grep = [];
          for (k = 0; k < ga.n; k++) grep = grep.concat(cloneList(gone));
          glist = grep;
          gc = ga.n * (ga.w || gc);
          ctx.spUsed += ga.n - 1;
          if (ga.kind === 'corner') ctx.cnUsed += ga.n - 1;
          ctx.anchored = true;
        }
      }
      if (it.filled) {
        if (fill) return null;
        fill = { list: glist, c: gc };
        list.push(FILL_MARK);
      } else {
        for (k = 0; k < it.mult; k++) list = list.concat(cloneList(glist));
        consumed += gc * it.mult;
        // a bracket worked `mult` times eats its anchors `mult` times over,
        // but the words inside it were only read once
        if (ctx && it.mult > 1) {
          ctx.spUsed += (ctx.spUsed - spBefore) * (it.mult - 1);
          ctx.cnUsed += (ctx.cnUsed - cnBefore) * (it.mult - 1);
        }
      }
    }
    return { list: list, c: consumed, fill: fill };
  }

  // "* UNIT ; rep from * around" / "* HEAD ** TAIL ; rep from * around, end at
  // **" / "* UNIT ; rep from * 3 times more". Returns the pieces, or null when
  // the line does not use the form.
  var REP_FROM_RE = /\brep(?:eat)?\s+from\s*\*+/i;
  // The FIRST lone `*` before `pos` - `**` is a second marker ("end at **"),
  // never the start of the repeat.
  function firstLoneStar(s, pos) {
    var i = 0;
    while (i < pos) {
      var at = s.indexOf('*', i);
      if (at < 0 || at >= pos) return -1;
      if (s.charAt(at + 1) === '*') { i = at + 2; while (s.charAt(i) === '*') i++; continue; }
      if (s.charAt(at - 1) === '*') { i = at + 1; continue; }
      return at;
    }
    return -1;
  }

  function starRepeat(s) {
    var rf = REP_FROM_RE.exec(s);
    if (!rf) return null;
    var star = firstLoneStar(s, rf.index);
    if (star < 0) return null;
    var unit = s.slice(star + 1, rf.index).replace(/[\s,;.]+$/, '');
    if (!unit.trim()) return null;
    var tail = s.slice(rf.index + rf[0].length);
    var endAt = /\bend(?:ing)?\s*(?:at|with)?\s*\*\*/i.test(tail) && unit.indexOf('**') >= 0;
    var head = unit, post = '';
    if (unit.indexOf('**') >= 0) {
      var cut = unit.indexOf('**');
      head = unit.slice(0, cut).replace(/[\s,;.]+$/, '');
      post = unit.slice(cut + 2).replace(/^[\s,;.]+/, '');
    }
    var times = null;
    var tm = /^[\s,]*(?:to\s+(?:the\s+)?end|around|across|to\s+next\s+corner)\b/i.exec(tail);
    if (!tm) {
      var nm = /^[\s,]*(\d+)\s*(more\s+)?times?(\s+more)?\b/i.exec(tail) ||
        /^[\s,]*(twice|three|four|five|six|seven|eight|nine|ten)\s*(more\s+)?times?(\s+more)?\b/i.exec(tail);
      if (nm) {
        times = wordNum(nm[1]);
        // "2 more times" and "2 times more" both mean three in all
        if (times !== null && (nm[2] || nm[3])) times += 1;
      }
    }
    // everything the tail still says after the repeat clause ("ending with
    // miss 3tr, sl st in top of beg 3ch")
    var rest = tail.replace(/^[\s,]*(?:to\s+(?:the\s+)?end|around|across|to\s+next\s+corner|(?:\d+|twice|three|four|five|six|seven|eight|nine|ten)\s*(?:more\s+)?times?)\b/i, '');
    rest = rest.replace(/^[\s,;.]*(?:end(?:ing)?\s*(?:at|with)?\s*\*+\s*[,;.]?)/i, '');
    return { before: s.slice(0, star), head: head, post: post, endAt: endAt,
      times: times, rest: rest };
  }

  // The stitch-emitting twin of evaluate(). Returns a list or null.
  function expandInstruction(instruction, prevCount, ctx) {
    if (instruction == null) return null;
    var prev = (typeof prevCount === 'number' && isFinite(prevCount)) ? prevCount : null;
    var rich = !!ctx;
    var s = normDashes(normUnicode(instruction));
    s = fixTypos(s);

    var mk = detectMarker(s.trim());
    if (mk) s = stripRowKeyword(mk.rest);
    s = s.toLowerCase().trim();
    if (!s) return null;

    // "Rnd 5 (yellow): ..." - the whole row is worked in that colour
    var rc = /^\(\s*([a-z][a-z ]{1,20}?)\s*\)\s*:?\s*/.exec(s);
    if (rc) {
      var rcName = resolveColor(rc[1], ctx);
      if (rcName) { ctx.rowColor = rcName; s = s.slice(rc[0].length); }
    }

    if (prev !== null && (rich ? OPEN_FILL_VAGUE_RE : OPEN_FILL_RE).test(s)) {
      return runOf('sc', 1, prev);
    }
    if (rich) {
      s = richNormalise(s, ctx);
      ctx.produced = false; ctx.hadChain = false; ctx.share = null;
      ctx.spUsed = 0; ctx.cnUsed = 0;
    }

    var out = rich ? expandRich(s, prev, ctx) : expandPlainBody(s, prev, ctx);
    if (out === null && rich && prev !== null && OPEN_FILL_RE.test(s)) {
      return runOf('sc', 1, prev);
    }
    return out;
  }

  // The starred-repeat / fill resolution, shared by both readings.
  function resolveFill(list, fill, consumed, prev) {
    if (prev == null || !fill || fill.c <= 0) return null;
    var remaining = prev - consumed;
    if (remaining < 0) return null;
    var whole = Math.floor(remaining / fill.c);
    var left = remaining - whole * fill.c;
    if (whole * Math.max(1, fill.list.length) + left > MAX_STITCHES) return null;
    var rep = [], k;
    for (k = 0; k < whole; k++) rep = rep.concat(cloneList(fill.list));
    rep = rep.concat(padRun(fill.list.length ? fill.list : list, left));
    return spliceMark(list, rep);
  }

  function expandPlainBody(s, prev, ctx) {
    var repAround = /\b(?:rep(?:eat)?)\s+(?:around|across|to\s+end)\b/i.exec(s);
    var tailFill = false;
    if (repAround) { s = s.slice(0, repAround.index); tailFill = true; }

    var body = expandBody(s, ctx);
    if (!body) return null;
    if (body.abs) return body.list;

    var k;
    if (tailFill) {
      var plain = stripMarks(body.list);
      if (!plain.length && body.c === 0) return null;
      if (prev == null || body.c <= 0) return null;
      var groups = Math.floor(prev / body.c);
      var left = prev - groups * body.c;
      if (groups * Math.max(1, plain.length) + left > MAX_STITCHES) return null;
      var out = [];
      for (k = 0; k < groups; k++) out = out.concat(cloneList(plain));
      return out.concat(padRun(plain, left));
    }
    if (body.fill) return resolveFill(body.list, body.fill, body.c, prev);
    var plain2 = stripMarks(body.list);
    if (!plain2.length && body.c === 0) return null;
    return plain2;
  }

  function expandRich(s, prev, ctx) {
    var k;
    // "* ... ; rep from * around, end at **"
    var sr = starRepeat(s);
    if (sr) {
      // Each piece is expanded once and the anchors it eats are tallied, so
      // that "rep from * around" can be sized by the round below (once per
      // corner, once per space) rather than by dividing position counts.
      ctx.spUsed = 0; ctx.cnUsed = 0;
      var pre = sr.before.trim() ? expandBody(sr.before, ctx) : { list: [], c: 0, fill: null };
      var preCn = ctx.cnUsed, preSp = ctx.spUsed;
      if (!pre || pre.fill || pre.abs) { pre = { list: [], c: 0, fill: null }; preCn = 0; preSp = 0; }
      ctx.spUsed = 0; ctx.cnUsed = 0;
      var headB = expandBody(sr.head, ctx);
      var headCn = ctx.cnUsed, headSp = ctx.spUsed;
      if (!headB || headB.fill || headB.abs) return null;
      ctx.spUsed = 0; ctx.cnUsed = 0;
      var postB = sr.post.trim() ? expandBody(sr.post, ctx) : { list: [], c: 0, fill: null };
      var postCn = ctx.cnUsed, postSp = ctx.spUsed;
      if (!postB || postB.fill || postB.abs) { postB = { list: [], c: 0, fill: null }; postCn = 0; postSp = 0; }
      ctx.spUsed = 0; ctx.cnUsed = 0;
      var restB = sr.rest.trim() ? expandBody(sr.rest, ctx) : { list: [], c: 0, fill: null };
      var restCn = ctx.cnUsed, restSp = ctx.spUsed;
      if (!restB || restB.fill || restB.abs) { restB = { list: [], c: 0, fill: null }; restCn = 0; restSp = 0; }

      var unitC = headB.c + postB.c;
      var reps = sr.times, spare = 0;
      if (reps === null && ctx.struct) {
        // a corner body runs once per corner; a side body once per space
        var an = anchorReps(ctx.struct.corners, sr.endAt, preCn, headCn, postCn, restCn);
        if (an === null) {
          an = anchorReps(ctx.struct.spaces, sr.endAt, preSp, headSp, postSp, restSp);
        }
        if (an !== null) { reps = an; spare = 0; ctx.anchored = true; }
      }
      if (reps === null) {
        if (prev == null) return null;
        var room = prev - pre.c - restB.c;
        if (room < 0 || unitC <= 0) return null;
        // "end at **": the last repeat stops before the post-** piece, so the
        // head runs once more than the tail does.
        reps = sr.endAt ? Math.round((room + postB.c) / unitC) : Math.floor(room / unitC);
        if (reps < 1) reps = 1;
        spare = room - (reps * unitC - (sr.endAt ? postB.c : 0));
        if (spare < 0) spare = 0;
      }
      if (reps * Math.max(1, headB.list.length + postB.list.length) + spare > MAX_STITCHES) return null;
      var out = pre.list.slice();
      for (k = 0; k < reps; k++) {
        out = out.concat(cloneList(headB.list));
        if (!(sr.endAt && k === reps - 1)) out = out.concat(cloneList(postB.list));
      }
      if (spare > 0) out = out.concat(padRun(headB.list, spare));
      out = out.concat(restB.list);
      if (!out.length) return null;
      return out;
    }

    // "X, Y, repeat around" - and "X, Y, rep from * around" when the opening
    // `*` never made it through the column extractor, which is the same shape:
    // the comma list in front is the unit.
    var repAround = /\b(?:rep(?:eat)?)\s+(?:from\s*\*+\s*)?(?:around|across|to\s+(?:the\s+)?end)\b/i.exec(s);
    if (repAround) {
      var headTxt = s.slice(0, repAround.index);
      var tailTxt = s.slice(repAround.index + repAround[0].length);
      var hb = expandBody(headTxt, ctx);
      if (!hb || hb.abs) return null;
      if (hb.fill) return resolveFill(hb.list, hb.fill, hb.c, prev);
      var tb = tailTxt.trim() ? expandBody(tailTxt, ctx) : { list: [], c: 0, fill: null };
      if (!tb || tb.fill || tb.abs) tb = { list: [], c: 0, fill: null };
      var plain = stripMarks(hb.list);
      if (!plain.length && hb.c === 0) return null;
      if (prev == null || hb.c <= 0) return null;
      var room2 = prev - tb.c;
      if (room2 < 0) return null;
      var groups = Math.floor(room2 / hb.c);
      var left2 = room2 - groups * hb.c;
      if (groups * Math.max(1, plain.length) + left2 > MAX_STITCHES) return null;
      var out2 = [];
      for (k = 0; k < groups; k++) out2 = out2.concat(cloneList(plain));
      out2 = out2.concat(padRun(plain, left2));
      return out2.concat(tb.list);
    }

    var body = expandBody(s, ctx);
    if (!body) return null;
    if (body.abs) return body.list;
    if (body.fill) return resolveFill(body.list, body.fill, body.c, prev);
    var plain3 = stripMarks(body.list);
    if (!plain3.length && body.c === 0) return null;
    return plain3;
  }

  // --- row plumbing ------------------------------------------------------

  function asParsed(lines) {
    if (!lines) return [];
    if (typeof lines === 'string') return parse(lines);
    if (Object.prototype.toString.call(lines) !== '[object Array]') return [];
    if (!lines.length) return lines;
    if (typeof lines[0] === 'string') return parse(lines.join('\n'));
    return lines;
  }

  // A starred repeat whose closing "rep from * around" was wrapped onto the
  // next printed line. The column extractor hands the tail over as a note of
  // its own, and without it the round stops in the middle of its repeat unit -
  // Red Heart's Persian Tiles round 6 breaks off at "(3 dc, ch 5, 3 dc)" and
  // came out at a quarter of its size.
  var REP_TAIL_RE = /\brep(?:eat)?\s+from\s*\*/i;
  var END_AT_RE = /\bend(?:ing)?\s*(?:at|with)?\s*\*\*/i;

  /** Does this instruction open a starred repeat it never closes? */
  function repeatIncomplete(instr) {
    if (firstLoneStar(instr, instr.length) < 0) return false;
    var rf = REP_TAIL_RE.exec(instr);
    if (!rf) return true;
    // "... ** sk next st; rep from * across to last st ending" - the "at **"
    // that closes the two-marker form is on the next printed line
    return instr.slice(0, rf.index).indexOf('**') >= 0 &&
      !END_AT_RE.test(instr.slice(rf.index));
  }

  function joinRepeatTail(lines, line, instr) {
    if (!instr || !repeatIncomplete(instr)) return instr;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i] !== line) continue;
      var nx = lines[i + 1];
      if (!nx || nx.kind !== 'note' || (nx.row !== null && nx.row !== undefined)) return instr;
      var txt = String(nx.text || '');
      if (txt.indexOf('*') < 0 && !REP_TAIL_RE.test(txt)) return instr;
      var joined = instr.replace(/[\s,;.]+$/, '') + ' ' + trimLine(txt);
      return repeatIncomplete(joined) ? instr : joined;
    }
    return instr;
  }

  // The instruction part of a row line: marker off the front, count off the
  // back - exactly what parse() feeds to evaluate().
  function instrOf(line) {
    var t = trimLine(line.text);
    var prefixLen = 0, m, nr;
    m = detectMarker(t);
    if (m) prefixLen = t.length - m.rest.length;
    else {
      m = detectNextRow(t);
      if (m) prefixLen = t.length - m.rest.length;
      else {
        m = detectSetup(t);
        if (m) prefixLen = t.length - m.rest.length;
        else { nr = nameRowInfo(t); if (nr) prefixLen = nr.prefixLen; }
      }
    }
    var rest = t.slice(prefixLen);
    var e = findExplicit(rest);
    if (e && e.start > 0) rest = rest.slice(0, e.start);
    return stripRowKeyword(rest);
  }

  function newState() {
    return { color: null, legend: {}, names: {}, ready: false, init: false, structs: {} };
  }

  /**
   * The structure of the last round expanded BEFORE `row` - the anchors the
   * next round works into. Keyed by row so that expanding the same row twice
   * (a re-render) reads the same round below rather than its own output.
   */
  function structBefore(st, row) {
    if (!st.structs || !(row >= 1)) return null;
    var best = null, bestRow = -1, k, r;
    for (k in st.structs) {
      r = +k;
      if (r < row && r > bestRow) { bestRow = r; best = st.structs[k]; }
    }
    return best;
  }

  function rememberStruct(st, row, list) {
    if (!(row >= 1)) return;
    if (!st.structs) st.structs = {};
    st.structs[row] = roundStruct(list);
  }

  function normState(state, parsed) {
    var st = (state && typeof state === 'object') ? state : newState();
    if (!st.legend) st.legend = {};
    if (!st.names) st.names = {};
    if (st.color === undefined) st.color = null;
    if (!st.ready) {
      var c = colors(parsed);
      st.legend = c.legend;
      st.names = {};
      c.names.forEach(function (n) { st.names[n.toLowerCase()] = n; });
      st.ready = true;
    }
    return st;
  }

  function applyPhrases(text, st) {
    colorPhrases(text, null, true).forEach(function (hit) {
      if (hit.kind === 'base') {
        var resolved = st.names[hit.name.toLowerCase()] || hit.name;
        if (/^[a-z]$/i.test(resolved) && st.legend[resolved.toUpperCase()]) {
          resolved = st.legend[resolved.toUpperCase()];
        }
        st.color = resolved;
      }
      // 'off' ends a secondary colour; the base colour is left alone.
    });
  }

  // The dominant height of the row, ignoring chain spaces (height 0 by
  // definition) and the bobbles whose height is still pending. A tie goes to
  // the taller stitch.
  function dominantHeight(list) {
    var counts = {}, i, any = false;
    for (i = 0; i < list.length; i++) {
      var e = list[i];
      if (e === FILL_MARK || e.t === 'ch' || e.h === H_PENDING || e.h === undefined) continue;
      counts[e.h] = (counts[e.h] || 0) + 1;
      any = true;
    }
    if (!any) return 1;
    var best = 1, bestN = -1;
    Object.keys(counts).forEach(function (k) {
      var v = counts[k], hv = parseFloat(k);
      if (v > bestN || (v === bestN && hv > best)) { bestN = v; best = hv; }
    });
    return best;
  }

  // Reconcile the expansion with the count the pattern printed. Chain spaces
  // are ring positions but not stitches, so they are not what the printed
  // total counts - `target` is matched against the countable entries only, and
  // any padding is the row's own dominant stitch rather than an sc.
  function fitTo(list, target) {
    if (target === null || target === undefined || !isFinite(target)) return list;
    if (target <= 0) return [];
    var have = countable(list);
    if (have === target) return list;
    if (have < target) return list.concat(padRun(list, target - have));
    var out = [], n = 0, i;
    for (i = 0; i < list.length; i++) {
      if (list[i].t === 'ch') { if (n < target) out.push(list[i]); continue; }
      if (n >= target) break;
      out.push(list[i]); n++;
    }
    return out;
  }

  // A bobble / puff / cluster is as tall as whatever it is made of, which the
  // words almost never say - so it takes the row's dominant height.
  function settleHeights(list, dom) {
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].h === H_PENDING || list[i].h === undefined) list[i].h = dom;
    }
  }

  function marksOf(list) {
    var inc = [], dec = [], i;
    for (i = 0; i < list.length; i++) {
      if (list[i].t === 'inc') inc.push(i);
      else if (list[i].t === 'dec') dec.push(i);
    }
    return { inc: inc, dec: dec };
  }

  function textOf(parsed) {
    if (typeof parsed === 'string') return parsed;
    return textLines(parsed).join('\n');
  }

  // --- resolving a back-reference at expand() time ----------------------

  // "Rows 20-40: rep rows 10-19" where rows 10-19 were themselves a repeat is
  // real (Yarnspirations stacks them), but a cycle is not, so the chain is
  // followed only this far and every hop must point at a LOWER row number.
  var REF_DEPTH_MAX = 4;

  /**
   * The row `row` points straight at: "Rows 6-46: rep rows 4 and 5" sends row 6
   * to row 4 and row 7 to row 5, so the parity of a two-row repeat survives.
   * @returns {number|null}
   */
  function refRowOf(line, row) {
    var refs = line.repeatOf;
    if (!refs || !refs.length) return null;
    var from = (typeof line.repeatFrom === 'number' && line.repeatFrom >= 1) ? line.repeatFrom : line.row;
    if (!(from >= 1) || row < from) return null;
    var ref = refs[(row - from) % refs.length];
    return (ref >= 1 && ref < row) ? ref : null;
  }

  /**
   * The line whose words row `row` actually works, following a chain of
   * back-references down to a row that says something.
   * @returns {Object|null} null when the chain is broken or circular.
   */
  function refSource(lines, line, row, depth) {
    if (!line) return null;
    var refs = line.repeatOf;
    if (!refs || !refs.length) return line;
    if (depth >= REF_DEPTH_MAX) return null;
    var ref = refRowOf(line, row);
    if (ref === null) return null;
    var src = refLineAt(lines, line.section, ref);
    if (!src || src === line) return null;
    return refSource(lines, src, ref, depth + 1);
  }

  /**
   * A bare "Rep Row 2 until it measures 59"" sentence carries no row number, so
   * lineFor() finds nothing for row 7 of the blanket. This does - it is how the
   * store gets an answer for every row it asks about past the last written one.
   */
  function repeatLineFor(lines, row) {
    var i, l, best = null;
    if (!lines || !lines.length || !(row >= 1)) return null;
    for (i = 0; i < lines.length; i++) {
      l = lines[i];
      if (!l || l.kind !== 'repeat' || !l.repeatOf || !(l.repeatFrom >= 1)) continue;
      if (row < l.repeatFrom) continue;
      if (l.repeatTo >= l.repeatFrom && row > l.repeatTo) continue;
      if (l.section === 0) return l;
      if (!best) best = l;
    }
    return best;
  }

  // A repeat of one row cannot plausibly do this to the piece. The open-ended
  // fills inside a granny round are read off the round below, so re-reading the
  // same round every round compounds the misreading: unguarded, the hex socks
  // went 133, 365, 1003, 2761, 7592 and the wrap hit the 20,000 cap by row 15.
  var REF_GROWTH_MAX = 3;

  /**
   * How many stitches a back-referencing row should end up with. In order:
   *   1. the count the LINE publishes for this row - the printed total at the
   *      end of a numbered range, else the delta chain parse() worked out;
   *   2. the referenced row's own shaping delta added to the count so far,
   *      which is what keeps a shawl growing one edge when the repeat is a bare
   *      sentence ("Repeat rows 2 & 3 until it measures 60 cm") that parse()
   *      could not attach a range of counts to;
   *   3. the referenced words read against the current count, which is "the
   *      same as the round below" for the open-ended fills of a granny round;
   *   4. the sanity ceiling, so a misread fill cannot compound.
   *
   * `target` is a number of STITCHES (fitTo ignores chain spaces); `cap` is a
   * ceiling on the total number of ring POSITIONS, set only in cases 2 and 3,
   * where no count is known anywhere and "as many stitches as the row below had
   * positions" would otherwise inflate the row by its own chain spaces every
   * time it is repeated. Both are null when the expansion speaks for itself.
   */
  function refTarget(lines, line, row, srcInstr, prev, raw) {
    var out = { target: null, cap: null, from: null };
    var c = (line.row >= 1) ? countAt(line, row) : null;
    if (c !== null && isFinite(c)) {
      out.target = c;
      // a total the pattern PRINTS is the designer's word; one parse() only
      // computed is its own arithmetic, and no better than the expansion
      out.from = (line.countSource === 'explicit') ? 'printed' : 'computed';
      return out;
    }
    var ref = refRowOf(line, row);
    var d = (ref === null) ? null : refDelta(lines, line.section, ref);
    if (d !== null && prev !== null && prev + d >= 0) {
      out.target = prev + d; out.from = 'delta'; return out;
    }
    // A row that only says "work an earlier row again", with no count anywhere
    // to go by, cannot hold more ring positions than the row below did. Without
    // this the chain spaces compound: the hex socks grew 22 % a round on
    // nothing but their own ch-2 corners, and geometrically at that.
    if (prev !== null && prev > 0) out.cap = prev;
    var ev = null;
    try { ev = evaluate(srcInstr, prev); } catch (e) { ev = null; }
    if (typeof ev === 'number' && isFinite(ev) && ev >= 0) {
      out.target = ev; out.from = 'evaluate'; return out;
    }
    if (prev !== null && prev > 0 && raw && countable(raw) > prev * REF_GROWTH_MAX) {
      out.target = prev; out.from = 'growth';
    }
    return out;
  }

  function ukOf(st, parsed) {
    if (st.uk === undefined) {
      var d = null;
      try { d = dialectHints(textOf(parsed)); } catch (e) { d = null; }
      st.uk = !!(d && d.dialect === 'uk');
    }
    return st.uk;
  }

  function expand(lines, rowNumber, prevCount, state) {
    var parsed, st;
    try {
      parsed = asParsed(lines);
      st = normState(state, parsed);
    } catch (e) {
      st = normState(state, []);
      return { stitches: [], color: st.color || null, height: 1, width: 0, state: st, inc: [], dec: [] };
    }

    var res = { stitches: [], color: st.color || null, height: 1, width: 0, state: st, inc: [], dec: [] };

    try {
      // A numbered line wins; failing that, a bare "Rep Row 2 until it measures
      // 59"" sentence answers for every row after the last written one.
      var line = lineFor(parsed, rowNumber) || repeatLineFor(parsed, rowNumber);
      if (!line) return res;

      // header-adjacent colour lines, once, before the first row we see
      if (!st.init) {
        st.init = true;
        for (var i = 0; i < parsed.length; i++) {
          var l = parsed[i];
          if (l.index >= line.index) break;
          if (l.kind !== 'note' && l.kind !== 'header') continue;
          applyPhrases(l.text, st);
        }
      }
      if (line.notes && line.notes.length) {
        for (var n = 0; n < line.notes.length; n++) applyPhrases(line.notes[n], st);
      }

      var instr = joinRepeatTail(parsed, line, instrOf(line));
      var prev = (typeof prevCount === 'number' && isFinite(prevCount)) ? prevCount : null;
      var ctx = { legend: st.legend, names: st.names, rowColor: null,
        uk: ukOf(st, parsed), produced: false,
        // the anchors the round below left, and the turning chain an earlier
        // round declared to be a stitch "here and throughout"
        struct: structBefore(st, rowNumber), chThrough: st.chThrough || null,
        spUsed: 0, cnUsed: 0, anchored: false,
        // the anchor each group of stitches divides between them (§8c)
        shares: {}, shareId: 0, share: null };

      // "With black, ch 2, 6 sc" / "Colour change to black, sc in each st" /
      // "... changing to black in last 2 loops": a colour written on the row
      // itself sets the row's colour, which is the common amigurumi idiom and
      // was the one form expand() never read (04 H).
      applyPhrases(instr, st);

      // "Rnds 4-15: rep Rnd 3": the row's own words say nothing, so the row it
      // points at is read again HERE, against the count this row starts from,
      // and every stitch, increase position and per-stitch height comes out of
      // that reading rather than out of a generic run (03 #6, proposal 9).
      var src = line.repeatOf ? refSource(parsed, line, rowNumber, 0) : null;
      var srcInstr = (src && src !== line) ?
        joinRepeatTail(parsed, src, instrOf(src)) : instr;

      var list = null;
      try { list = expandInstruction(srcInstr, prev, ctx); } catch (e3) { list = null; }
      if (ctx.rowColor) st.color = ctx.rowColor;
      if (ctx.chThrough) st.chThrough = ctx.chThrough;

      // The total the pattern PRINTS is the designer's word and wins. A
      // computed total is only evaluate()'s own reading of the same words, and
      // a coarser one - it falls back to "same as the round before" on any
      // open-ended fill, which would crop a granny round back to a plain ring.
      // So when nothing is printed, the expansion speaks for itself, and
      // evaluate() is used only to size the generic run if nothing expanded.
      // A back-reference is the exception: nothing on the line describes what
      // it makes, so the count it is reconciled against is worked out from the
      // row it points at - see refTarget().
      var target = (line.countSource === 'explicit' && line.count !== null &&
        line.count !== undefined) ? line.count : null;
      var refCap = null;
      if (src && src !== line) {
        var rt = refTarget(parsed, line, rowNumber, srcInstr, prev, list);
        target = rt.target;
        // The "no more positions than the round below" ceiling, and evaluate()'s
        // own coarse reading of the referenced words, both exist because an
        // open-ended granny fill used to compound. A round whose repeats were
        // counted off the round below's own anchors is not a guess, and a
        // growing motif MUST outgrow the round below - the hexagon gains 18
        // trebles a round, exactly as the leaflet prints. Only a total the
        // pattern actually PRINTS still outranks such an expansion.
        refCap = ctx.anchored ? null : rt.cap;
        if (ctx.anchored && rt.from !== 'printed') target = null;
      }
      if (list === null) {
        var ev = null;
        try { ev = evaluate(srcInstr, prev); } catch (e2) { ev = null; }
        if (target === null) {
          target = (line.count === null || line.count === undefined) ? ev : line.count;
        }
        list = (target === null || target === undefined) ? [] : runOf('x', 1, target);
      }
      if (list.length > MAX_STITCHES) list = list.slice(0, MAX_STITCHES);
      // the row's height comes from what was READ, never from the padding
      var dom = dominantHeight(list);
      settleHeights(list, dom);
      list = fitTo(list, target);
      if (refCap !== null && list.length > refCap) list = list.slice(0, refCap);
      // every group that was worked into one place now divides that place's
      // width between its stitches (§8c) - the row's WIDTH, which is what the
      // geometry sums for a perimeter, rather than its stitch count
      applyShares(list, ctx.shares);
      // what this round leaves for the next one to work into
      rememberStruct(st, rowNumber, list);

      var marks = marksOf(list);
      res.color = st.color || null;
      res.height = dom;
      res.width = sumWidth(list);
      res.inc = marks.inc;
      res.dec = marks.dec;
      res.stitches = list.map(function (e) {
        return { t: e.t, c: e.c === undefined ? null : e.c,
          h: e.h === undefined || e.h === H_PENDING ? dom : e.h,
          w: e.w === undefined ? 1 : e.w };
      });
    } catch (e4) {
      res.stitches = res.stitches || [];
      res.inc = res.inc || [];
      res.dec = res.dec || [];
    }
    return res;
  }

  // =====================================================================
  // 11. Shape hints: how a piece starts, how it is worked, is it stuffed
  // =====================================================================

  // How the FIRST round/row casts on. The renderer cannot guess this from the
  // counts: a 24-stitch ring is a closed magic-ring cap, an open chain ring or
  // a flat row depending on words alone (01 §1.5-1.6, 03 #13).
  var MR_WORD_RE = /\b(?:magic\s*(?:ring|circle|loop)|\bmr\b|adjustable\s+ring|magic\s+knot)/i;
  var MR_N_RE = /(\d+)\s*(?:sc|dc|hdc|tr|sts?|stitches?)?\s*(?:in|into)\s+(?:a\s+|the\s+)?(?:mr\b|magic\s*(?:ring|circle|loop)|ring|circle)/i;
  var MR_TIGHT_RE = /\b(?:mr|magic\s*ring|magic\s*circle)\s*(?:with\s+)?(\d+)/i;
  // "ch 2, 6 sc in 2nd ch from hook" - the amigurumi magic ring written out
  var MR_CH2_RE = /\bch(?:ain)?\s*\d*\s*,?\s*(?:then\s+)?(\d+)\s*(?:sc|dc|hdc|tr)\s*(?:in|into)\s+(?:the\s+)?(?:2nd|second|1st|first)\s+ch/i;
  // ...and the translated word order: "2 ch, into the first ch: 9 sc"
  var MR_CH2_ALT_RE = /\b(?:\d+\s*ch(?:ain)?|ch(?:ain)?\s*\d+)\s*[,:;]?\s*(?:in|into)\s+(?:the\s+)?(?:2nd|second|1st|first)\s+ch(?:ain)?\s*(?:from\s+(?:the\s+)?hook)?\s*[,:;]?\s*(\d+)\s*(?:sc|dc|hdc|tr)/i;
  var RING_JOIN_RE = /\b(?:ch(?:ain)?\s*(\d+)|(\d+)\s*ch(?:ain)?s?)[\s\S]{0,70}?\b(?:join|sl\s*st|slst|ss)\b/i;
  var RING_WORD_RE = /\b(?:form\s+a\s+(?:ring|circle|loop)|into\s+a\s+(?:ring|circle)|to\s+form\s+a\s+ring|in\s+(?:a\s+)?ring\b|into\s+ring\b|join\s+chain\s+into)/i;
  var OVAL_RE = /\b(?:down|along|back\s+down|back\s+along|across)\s+(?:the\s+)?(?:opposite|other)\s+side|\b(?:opposite|other)\s+side\s+of\s+(?:the\s+)?(?:ch|chain|foundation)|\bin\s+(?:each|the)\s+ch(?:ain)?\s+(?:across|down|back)\s+(?:the\s+)?(?:other|opposite)/i;
  var OVAL_TURN_RE = /\b\d+\s*(?:sc|dc|hdc|tr)\s*(?:inc)?\s*(?:\([^)]*\)\s*)?(?:in|into)\s+(?:the\s+)?(?:last|same|final)\s+(?:ch|chain|st)/i;
  var FROM_HOOK2_RE = /\b(?:2nd|second)\s+ch(?:ain)?\s+from\s+(?:the\s+)?hook/i;
  var CH_N_LOOSE_RE = /\b(?:ch(?:ain)?\s*(\d+)|(\d+)\s*ch(?:ain)?s?)\b/i;
  var CH_N_ALL_RE = /\b(?:ch(?:ain)?\s*(\d+)|(\d+)\s*ch(?:ain)?s?)\b/ig;

  // The FOUNDATION chain, not the turning chain: "Rnd 3: ch 1, sc in same st,
  // ... join with a sl st" opens with a 1-chain that is nobody's foundation, so
  // take the first chain long enough to be one and only fall back to the first
  // of any length.
  function foundationChain(s, min) {
    var first = 0, m;
    CH_N_ALL_RE.lastIndex = 0;
    while ((m = CH_N_ALL_RE.exec(s)) !== null) {
      var n = num(m[1] || m[2]) || 0;
      if (!first) first = n;
      if (n >= min) return n;
      if (CH_N_ALL_RE.lastIndex > 4000) break;
    }
    return first;
  }

  /**
   * @param {Array|string} lines  parsed lines or raw pattern text
   * @returns {{start:('magic-ring'|'chain-ring'|'chain-oval'|'chain-row'|'unknown'),
   *            chainLen:number, ringCount:number}}
   */
  function startHint(lines) {
    var res = { start: 'unknown', chainLen: 0, ringCount: 0 };
    var parsed, i, l, txt = [];
    try { parsed = asParsed(lines); } catch (e) { return res; }
    // the setup + the first two rows, plus any note/header before them
    var firstRow = null;
    for (i = 0; i < parsed.length; i++) {
      l = parsed[i];
      if (l.row !== null && l.row >= 1) { firstRow = l; break; }
    }
    for (i = 0; i < parsed.length; i++) {
      l = parsed[i];
      if (l.row !== null && l.row >= 3) continue;
      if (firstRow && l.index > firstRow.index + 6) break;
      txt.push(String(l.text || ''));
      if (l.notes && l.notes.length) txt.push(l.notes.join(' '));
    }
    var s = normDashes(normUnicode(txt.join('\n')));
    if (!s.trim()) return res;
    var m;

    // 1. an oval: a chain worked down one side and back up the other
    if ((OVAL_RE.test(s) || (OVAL_TURN_RE.test(s) && FROM_HOOK2_RE.test(s))) &&
        CH_N_LOOSE_RE.test(s)) {
      var ov = foundationChain(s, 4);
      res.start = 'chain-oval';
      res.chainLen = Math.max(0, ov - (FROM_HOOK2_RE.test(s) ? 2 : 1));
      return res;
    }

    // 2. a magic ring (or the "ch 2, n sc in the 2nd ch" that stands in for it)
    if (MR_WORD_RE.test(s) || MR_TIGHT_RE.test(s) || MR_CH2_RE.test(s) || MR_CH2_ALT_RE.test(s)) {
      res.start = 'magic-ring';
      m = MR_TIGHT_RE.exec(s) || MR_N_RE.exec(s) || MR_CH2_RE.exec(s) || MR_CH2_ALT_RE.exec(s);
      if (m) res.ringCount = num(m[1]) || 0;
      return res;
    }

    // 3. a chain joined into a ring
    var ringish = RING_JOIN_RE.test(s) || RING_WORD_RE.test(s);
    if (ringish && CH_N_LOOSE_RE.test(s)) {
      var cl = foundationChain(s, 3);
      if (cl >= 3) {
        res.start = 'chain-ring';
        res.chainLen = cl;
        m = MR_N_RE.exec(s);
        if (m) res.ringCount = num(m[1]) || 0;
        return res;
      }
    }

    // 4. a flat foundation chain
    if (CH_N_LOOSE_RE.test(s)) {
      var cn = foundationChain(s, 3);
      if (cn >= 3) {
        res.start = 'chain-row';
        res.chainLen = Math.max(0, FROM_HOOK2_RE.test(s) ? cn - 1 : cn);
        return res;
      }
    }
    return res;
  }

  var MODE_RND_RE = '(?:^|[^a-z])(?:rnds?|rounds?)\\.?\\s*\\d';
  var MODE_ROW_RE = '(?:^|[^a-z])rows?\\.?\\s*\\d';
  var MODE_R_RE = '(?:^|[^a-z])r\\s?\\d+\\s*[:.)\\-]';
  var MODE_RND_WORDS = '\\b(?:magic\\s*ring|in\\s+the\\s+round|do\\s+not\\s+turn|join\\s+with|around\\b|spiral)';
  var MODE_ROW_WORDS = '\\b(?:turn\\b|across\\b|turning\\s+ch)';

  /** @returns {'rounds'|'rows'|null} */
  function workMode(text) {
    var s;
    try { s = normUnicode(textOf(text)).toLowerCase(); } catch (e) { return null; }
    if (!s) return null;
    var rnd = countMatches(s, MODE_RND_RE) + countMatches(s, MODE_R_RE);
    var row = countMatches(s, MODE_ROW_RE);
    if (rnd > row) return 'rounds';
    if (row > rnd) return 'rows';
    var rw = countMatches(s, MODE_RND_WORDS);
    var ow = countMatches(s, MODE_ROW_WORDS);
    if (rw > ow) return 'rounds';
    if (ow > rw) return 'rows';
    return null;
  }

  var NO_STUFF_RE = /\b(?:do\s*(?:es)?\s*not\s+stuff|don'?t\s+stuff|no\s+stuffing|without\s+stuffing|leave\s+(?:it\s+)?unstuffed|unstuffed|not\s+stuffed)\b/i;
  var STUFF_RE = /\b(?:stuff(?:ing|ed|s)?)\b/i;

  /** @returns {true|false|null} - null = the pattern never says. */
  function stuffingHint(text) {
    var s;
    try { s = normUnicode(textOf(text)); } catch (e) { return null; }
    if (!s) return null;
    if (NO_STUFF_RE.test(s)) return false;
    if (STUFF_RE.test(s)) return true;
    return null;
  }

  window.Patterns = {
    parse: parse,
    targetFor: targetFor,
    lineFor: lineFor,
    summary: summary,
    splitSections: splitSections,
    placement: placement,
    detectSizes: detectSizes,
    dialectHints: dialectHints,
    evaluate: evaluate,
    colors: colors,
    colorHex: colorHex,
    expand: expand,
    startHint: startHint,
    workMode: workMode,
    stuffingHint: stuffingHint
  };

})();
