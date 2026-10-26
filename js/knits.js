// js/knits.js
// window.Knits - the knitting pattern reader (wave H). Pure functions, no DOM.
//
// It is the crochet engine of js/patterns.js built over a KNITTING profile
// (Patterns.createParser): sections, headers, notes, wrapped rows, repeats,
// sizes, colours and placement are the engine's; this file supplies the
// knitting vocabulary and the three things knitting writes differently:
//
//   1. sizes INSIDE a segment: "CO 60 (66, 72) sts", "k17 (19), ssk" - the
//      bracket is the same number for the other sizes, never a row total;
//   2. real asterisk repeats with a remainder: "K2, *yo, k2tog, k3; rep from *
//      to last 3 sts, k3", "*M1. SM. K2.** ... Rep from * to ** once more";
//   3. the side of the work: "(RS)" / "(WS)" kept on Line.side, with parity
//      carried from the last tagged row.
//
// Line gains (contract §2): side, delta, until, markers, shortRow, chart,
// cable, plus rowList on an enumerated row ("Rows 2, 4, 6 and 8 (WS)") and
// sizeSkip on a line written for other sizes only.
//
// Sections:
//   1. small helpers (numbers with fractions, size lists)
//   2. the knitting profile tables (vocabulary, part nouns, glossary)
//   3. reading an instruction: tokens -> program -> run (knitEval)
//   4. the profile's hooks into the engine (markers, counts, sizes, repeats)
//   5. expand() - one record per stitch, for the 3D view
//   6. workMode / startHint
'use strict';

(function () {
  if (!window.Patterns || typeof window.Patterns.createParser !== 'function') return;

  var E = null;          // the engine's helpers, handed over by init()

  // =====================================================================
  // 1. Helpers
  // =====================================================================

  var FRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
  var NUM_SRC = '\\d+(?:[.,]\\d+)?(?:\\s?[½¼¾⅓⅔⅛]|\\s\\d\\/\\d)?|[½¼¾]';

  /** "12½" -> 12.5, "1 1/2" -> 1.5, "2,5" -> 2.5 */
  function fnum(s) {
    var t = String(s == null ? '' : s).trim();
    if (!t) return null;
    var v = 0, m;
    m = /^(\d+)?(?:[.,](\d+))?\s*([½¼¾⅓⅔⅛])?(?:\s(\d)\/(\d))?$/.exec(t);
    if (!m) return null;
    if (m[1]) v += parseInt(m[1], 10);
    if (m[2]) v += parseFloat('0.' + m[2]);
    if (m[3]) v += FRAC[m[3]];
    if (m[4]) v += parseInt(m[4], 10) / parseInt(m[5], 10);
    if (!m[1] && !m[3] && !m[2]) return null;
    return Math.round(v * 1000) / 1000;
  }

  function int(s) { var n = parseInt(s, 10); return isNaN(n) ? null : n; }

  function clone(o) {
    var r = {}, k;
    if (o) for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k];
    return r;
  }

  // A size list: a number then a bracket of the other sizes' numbers, with
  // commas (Interweave) or hyphens (Yarnspirations), or a bare bracket on a
  // line written for some sizes only ("(256-260-272) sts").
  var LIST_INNER = '(?:' + NUM_SRC + ')(?:\\s*[,\\-]\\s*(?:' + NUM_SRC + '))*';
  var SIZE_LIST_G = new RegExp('(' + NUM_SRC + ')\\s*\\(\\s*(' + LIST_INNER + ')\\s*\\)', 'g');
  var BARE_LIST_G = new RegExp('(^|[^\\d\\s½¼¾)\\]]\\s*|[a-z]\\s+|^\\s*)\\(\\s*((?:' + NUM_SRC + ')(?:\\s*[\\-,]\\s*(?:' + NUM_SRC + '))+)\\s*\\)', 'gi');

  function splitList(s) {
    return String(s).split(/\s*[,\-]\s*/).map(fnum);
  }

  /**
   * The value of a size list for the size being read, or undefined when the
   * list is not one number per size (and so says nothing for this size).
   * ctx: { size, count (document's size count, 0 = unknown), scope: {indices} }
   */
  function pickFrom(vals, ctx) {
    var size = ctx && ctx.size >= 0 ? ctx.size : 0;
    var n = ctx && ctx.count >= 2 ? ctx.count : 0;
    var sc = ctx && ctx.scope && ctx.scope.indices ? ctx.scope.indices : null;
    if (sc && vals.length === sc.length && vals.length !== n) {
      var k = sc.indexOf(size);
      return k >= 0 ? vals[k] : undefined;
    }
    if (n && vals.length !== n) {
      // ...unless the pattern says which sizes each number is for (six sizes
      // over two numbers - see columnsOf)
      var cols = curColumns();
      if (cols && cols.length === n && vals.length === colCount(cols)) return vals[cols[size]];
      // a two-number "17 (19)" in a document of more sizes says nothing
      return undefined;
    }
    var i = Math.min(size, vals.length - 1);
    return vals[i];
  }

  /**
   * Every size list in `s` replaced by the chosen size's number. `bad` is set
   * when a list could not be resolved for this size (the caller must then
   * not compute anything from the text).
   */
  // "CO 66 (72 (78, 91, 97) sts" - a bracket opened twice by mistake reads as
  // one list (same length, so indices into the line still hold)
  function fixNested(s) {
    return String(s).replace(/(\(\s*\d+(?:[.,]\d+)?\s*)\((?=\s*\d)/g, '$1,');
  }

  function resolveSizes(s, ctx) {
    var bad = false;
    var out = fixNested(s).replace(SIZE_LIST_G, function (all, first, rest) {
      var vals = [fnum(first)].concat(splitList(rest));
      if (vals.some(function (v) { return v === null; })) return all;
      var v = pickFrom(vals, ctx);
      if (v === undefined) { bad = true; return all; }
      return String(v);
    });
    out = out.replace(BARE_LIST_G, function (all, lead, list) {
      var vals = splitList(list);
      if (vals.some(function (v) { return v === null; })) return all;
      var v = pickFrom(vals, { size: ctx && ctx.size, count: 0, scope: ctx && ctx.scope });
      // a bare list is only ever a list for the sizes a scope names
      if (!(ctx && ctx.scope && ctx.scope.indices && vals.length === ctx.scope.indices.length)) {
        bad = true;
        return all;
      }
      if (v === undefined) { bad = true; return all; }
      return lead + String(v);
    });
    return { text: out, bad: bad };
  }

  // =====================================================================
  // 2. The knitting profile tables
  // =====================================================================

  function n1(m) { return m && m[1] ? +m[1] : 1; }
  function cableN(m) { return m && m[1] ? +m[1] : 2; }
  function slashN(m) { return m ? (+m[1]) + (+m[2]) : 2; }

  // [source, produced, consumed] - what the engine's own regexes (row-rest
  // checks, instruction-row checks, the stitch alternation) recognise. The
  // counting itself is section 3, which reads the same names.
  var VOCAB = [
    // C4F, T3B, Cr5B, Tw4R, C3FK / C3BP (Patons: the knit or purl stitch the
    // crossing ends on), T2F - the width is the number in the name
    ['(?:c|t|cr|tw)(\\d+)(?:f|b|l|r)(?:k|p)?', cableN, cableN],
    ['(\\d+)\\/(\\d+)\\s*(?:l|r)p?(?:c|t)', slashN, slashN],
    ['sl1-k2tog-psso|sk2po?', 1, 3],
    ['s2kp2?|s2kpo|cdd', 1, 3],
    ['k3tog(?:\\s*tbl)?|p3tog(?:\\s*tbl)?|sssk|sssp', 1, 3],
    ['k2tog(?:\\s*tbl)?|p2tog(?:\\s*tbl)?|ssk|ssp|skpo?', 1, 2],
    ['kfbf', 3, 1],
    ['kfb|pfb|k1fb|p1fb|kf&b|pf&b', 2, 1],
    ['m1(?:l|r|p|lp|rp|pl|pr)?|lli|rli', 1, 0],
    ['yo2', 2, 0],
    ['yo|yfwd|yfrn|yf|yon|yrn', 1, 0],
    ['psso', -1, 0],
    ['mb|bobble', 1, 1],
    ['rt|lt', 2, 2],
    ['knit(?:wise)?', 1, 1],
    ['purl(?:wise)?', 1, 1],
    ['k(\\d+)?(?:\\s*tbl|b)?', n1, n1],
    ['p(\\d+)?(?:\\s*tbl|b)?', n1, n1],
    ['sl(?:ip)?\\s*(\\d+)?', n1, n1],
    ['bo|bind\\s+off|cast\\s+off', 0, 1],
    ['co|cast\\s+on', 1, 0],
    ['pu', 1, 0]
  ];

  var NEVER = /(?!)/;

  var ZERO_RES = [
    /^turn\b/i, /^w&t\b/i, /^wrap\b/i, /^(?:pm|sm|rm|slm)\b/i, /^sl\s*m\b/i,
    /^(?:place|slip|remove)\s+(?:the\s+)?(?:beg(?:inning)?[-\s]of[-\s](?:rnd|round)\s+)?markers?\b/i,
    /^join\b/i, /^with\b/i, /^using\b/i, /^change\s+to\b/i, /^cut\b/i, /^break\b/i,
    /^leave\b/i, /^leaving\b/i, /^weave\b/i, /^do\s*not\b/i, /^don't\b/i, /^divide\b/i,
    /^\d+\s*(?:sts?|stitches?|total)?$/i
  ];

  var PART_NOUN_RE = /\b(?:back|fronts?|sleeves?|yoke|body|collar|cuffs?|neckband|neck\s*band|button\s*bands?|buttonhole\s*bands?|hood|pockets?|heels?|heel\s*flap|gussets?|foot|feet|toes?|legs?|brim|crown|border|edging|hat|mittens?|mitts?|thumbs?|socks?|shawl|scarf|cowl|blanket|panel|straps?|instep|sole|bodice|skirt|ribbing)\b/i;
  var PLACE_NOUN_RE = /\b(?:pockets?|buttons?|button\s*bands?|collar|hood|sleeves?|pom[-\s]?poms?|tassels?|fringe|ties?|straps?|labels?|zips?|zippers?|i-?cords?|thumbs?|appliques?|patch(?:es)?|pieces?|ears?|eyes?|nose|tails?|bows?)\b/i;

  var IMPERATIVE_RE = /^(?:make|use|using|start|begin|work|continue|cont|repeat|rep|sew|join|rejoin|place|pick|slip|sl|change|weave|cut|leave|break|do|don'?t|now|then|next|follow|keep|take|hold|count|cast|bind|knit|purl|rib|remove|transfer|graft|divide|block|fold|try|measure|with|turn\s+work)\b/i;

  var NON_PART = [
    // page furniture spaced out by the extractor: "K NITS" (an Interweave advert)
    '[a-z]\\s[a-z]{2,}',
    'cast[-\\s]+on', 'bind[-\\s]+off', 'cast[-\\s]+off', '.*\\b(?:bind|cast)[-\\s]+(?:on|off)', 'glossary', 'stitch\\s+guide', 'needles?',
    'notions', 'yarn\\b.*', 'finished\\s+(?:size|measurements?)', 'instructions',
    '(?:pattern\\s+)?stitch(?:es)?\\s+patterns?', 'pattern\\s+stitch(?:es)?', 'techniques?',
    'short[-\\s]rows?', 'figures?\\s*\\d*', 'charts?\\s*[a-z0-9]?', '[a-z]+\\s+charts?',
    'continued', 'cont(?:inued)?\\s+from\\b.*', 'key', 'legend', 'whipstitch', 'kitchener\\s+st(?:itch)?',
    'grafting', 'make\\s+1\\b.*', 'm1\\b.*', 'sssk\\b.*', 'turkish\\s+cast[-\\s]on', '.*\\bcast[-\\s]on',
    'gauge\\b.*', 'size\\b.*', 'about\\s+the\\s+designer',
    // "Left Neck shaping:", "Armhole shaping:" - a stage of the piece being
    // knitted, not a piece (Patons; the research's "sub-header, not a part")
    '(?:[a-z-]+\\s+){0,2}shaping',
    // "...Now begin the 'intakes.' Make" / "3 intakes on each side, with 7
    // rounds between." - the start of a table, not a piece
    'make\\W*'
  ];

  // [abbr, meaning, optional regex source]
  var GLOSSARY = [
    ['k', 'knit', 'k(?=\\d|\\b)'], ['p', 'purl', 'p(?=\\d|\\b)'],
    ['k2tog', 'knit 2 together (right-leaning decrease)'], ['p2tog', 'purl 2 together'],
    ['ssk', 'slip, slip, knit the 2 together through the back loops (left-leaning decrease)'],
    ['ssp', 'slip, slip, purl together through the back loops'],
    ['skp', 'slip 1, knit 1, pass the slipped stitch over', 'skpo?'],
    ['k3tog', 'knit 3 together (double decrease)'], ['sssk', 'slip 3, knit them together (double decrease)'],
    ['cdd', 'centred double decrease', 'cdd|s2kp2?|s2kpo'],
    ['sk2p', 'slip 1, knit 2 together, pass the slipped stitch over', 'sk2po?|sl1-k2tog-psso'],
    ['psso', 'pass the slipped stitch over'],
    ['yo', 'yarn over (makes a stitch and a hole)', 'yo|yfwd|yon|yrn'],
    ['m1', 'make 1: lift the bar between stitches and knit it through the back loop', 'm1'],
    ['m1L', 'make 1 left-leaning', 'm1l'], ['m1R', 'make 1 right-leaning', 'm1r'],
    ['m1p', 'make 1 purlwise', 'm1p'],
    ['kfb', 'knit into the front and back of the same stitch (increase)', 'kfb|k1fb|kf&b'],
    ['pfb', 'purl into the front and back of the same stitch', 'pfb|p1fb'],
    ['tbl', 'through the back loop', 'tbl|k1tbl|p1tbl'],
    ['sl', 'slip a stitch from the left needle to the right without working it', 'sl(?=\\s?\\d|\\b)'],
    ['wyib', 'with yarn in back', 'wyib|wyb'], ['wyif', 'with yarn in front', 'wyif|wyf'],
    ['kwise', 'knitwise'], ['pwise', 'purlwise'],
    ['pm', 'place marker'], ['sm', 'slip marker', 'sm|sl\\s*m'], ['rm', 'remove marker'],
    ['m', 'marker', 'm(?=[,;.\\s]|$)'],
    ['BOR', 'beginning of round', 'bor|beg[-\\s]of[-\\s]rnd'],
    ['w&t', 'wrap and turn (short row)', 'w\\s*&\\s*t'],
    ['CO', 'cast on', 'co|cast\\s+on'], ['BO', 'bind off', 'bo|bind\\s+off|cast\\s+off'],
    ['pu', 'pick up (and knit) stitches along an edge', 'pu|pick\\s+up'],
    ['C4F', 'cable 4 front: 2 sts to a cable needle held in front, k2, k2 from the needle', 'c4f'],
    ['C4B', 'cable 4 back: 2 sts to a cable needle held in back, k2, k2 from the needle', 'c4b'],
    ['C6F', 'cable 6 front: 3 sts to a cable needle held in front, k3, k3 from the needle', 'c6f'],
    ['C6B', 'cable 6 back: 3 sts to a cable needle held in back, k3, k3 from the needle', 'c6b'],
    ['cn', 'cable needle'], ['MB', 'make bobble', 'mb'],
    ['St st', 'stockinette (stocking) stitch: knit RS rows, purl WS rows', 'st\\s*st|stocking\\s+st'],
    ['garter st', 'knit every row', 'garter'],
    ['rib', 'ribbing: knits and purls stacked in columns'],
    ['RS', 'right side'], ['WS', 'wrong side'],
    ['rnd', 'round', 'rnds?'], ['st(s)', 'stitch(es)', 'sts?'],
    ['rep', 'repeat'], ['patt', 'pattern', 'patt?'], ['beg', 'beginning'], ['rem', 'remain(ing)'],
    ['foll', 'follow(ing)'], ['cont', 'continue'], ['tog', 'together'], ['dec', 'decrease'],
    ['inc', 'increase'], ['dpn', 'double-pointed needle', 'dpns?'], ['cir', 'circular needle'],
    ['MC', 'main colour'], ['CC', 'contrast colour']
  ];

  // =====================================================================
  // 3. Reading an instruction
  // =====================================================================
  //
  // An instruction becomes a PROGRAM: a list of items in text order -
  //   {op:{p,c,t,n,...}}        stitches (n = how many times)
  //   {fill:{p,c,t}, to:{...}}  "knit to end" / "k to last 3 sts" / "p to m"
  //   {group:prog, times|to}    "[k6, C6F] 8 times", "(k1, yo) to last st"
  //   {mark:1|2}                the "*" and "**" a repeat points back at
  //   {rep:{from,to,times|until}}  "rep from * to last 3 sts", "...once more"
  //   {pm:label} {turn} {co:n} {bo:n} {boAll}
  // and run() walks it against the stitches the row starts with.

  var REP_TAIL_TIMES = /^\s*(?:(\d+)\s+more\s+times?|(\d+)\s+times?\s+more|(\d+)\s+(?:additional\s+)?times?|(once|twice|thrice)\s+more|(once|twice|thrice)|(one|two|three|four|five|six|seven|eight|nine|ten)\s+more\s+times?|(two|three|four|five|six|seven|eight|nine|ten)\s+times?)\b/;
  var WORDN = { once: 1, twice: 2, thrice: 3, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

  // where a fill or a repeat runs to
  var TO_SRC = '(?:to\\s+(?:the\\s+)?end(?:\\s+of\\s+(?:the\\s+)?(?:row|rnd|round|needle))?|across(?:\\s+(?:the\\s+)?(?:row|needle))?|around|' +
    'to\\s+(?:the\\s+)?last\\s+(\\d+|one|two|three)\\s+sts?|to\\s+(?:the\\s+)?last\\s+st|' +
    'to\\s+(?:within\\s+)?(\\d+|one|two|three)\\s+sts?\\s+(?:before|from)\\s+(?:the\\s+)?(?:next\\s+|first\\s+|end-of-[a-z]+\\s+|[a-z]+\\s+)?(?:m|marker|marked\\s+st(?:itch)?|gap|wrapped\\s+st(?:itch)?|wrap|turn(?:ing)?\\s+point|cent(?:er|re))\\b(?:\\s+formed\\s+by\\s+(?:the\\s+)?previous\\s+(?:row|rnd))?|' +
    'to\\s+(?:the\\s+)?(?:next\\s+|first\\s+|second\\s+|end-of-[a-z]+\\s+|beg-of-[a-z]+\\s+|[a-z]+\\s+)?(?:m|marker|marked\\s+st(?:itch)?|gap|wrapped\\s+st(?:itch)?|wrap|turn(?:ing)?\\s+point|cent(?:er|re))\\b(?:\\s+formed\\s+by\\s+(?:the\\s+)?previous\\s+(?:row|rnd))?)';
  var TO_RE = new RegExp('^\\s*' + TO_SRC, 'i');
  // "rep from * until 3 sts rem" / "until 1 st remains" (Icelandic shawl)
  var UNTIL_REM_RE = /^\s*until\s+(\d+|one|two|three)\s+sts?\s+rem(?:ain(?:s|ing)?)?\b/i;

  function readTo(s) {
    var u = UNTIL_REM_RE.exec(s);
    if (u) return { to: { kind: 'last', n: WORDN[u[1].toLowerCase()] || int(u[1]) }, len: u[0].length };
    var m = TO_RE.exec(s);
    if (!m) return null;
    var w = m[0].toLowerCase(), to;
    var nn = m[1] || m[2];
    var k = nn ? (WORDN[nn] || int(nn)) : 0;
    if (/\bgap\b/.test(w)) to = { kind: 'gap' };
    // ("Knit to next marked st": a marked stitch stands where a marker would)
    else if (/\b(?:m|marker|marked)\b/.test(w)) to = { kind: 'marker', before: k };
    else if (/\b(?:wrapped|wrap|turn|turning|cent)/.test(w)) to = { kind: 'unknown' };
    else if (/\blast\b/.test(w)) to = { kind: 'last', n: m[1] ? k : 1 };
    else to = { kind: 'end' };
    return { to: to, len: m[0].length };
  }

  // A stitch, with its count: [regex, fn(m) -> op]. Order matters.
  function op(p, c, t, extra) {
    var o = { p: p, c: c, t: t };
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
  }
  var TOKENS = [
    [/^(?:c|t|cr|tw)(\d+)(f|b|l|r)(k|p)?\b/, function (m) {
      var n = +m[1];
      return op(n, n, 'cable', { cross: (m[2] === 'f' || m[2] === 'l') ? 'f' : 'b', span: n, purled: m[3] === 'p' || /^t\d/.test(m[0]), name: m[0].toUpperCase() });
    }],
    [/^(\d+)\/(\d+)\s*(l|r)(p?)(c|t)\b/, function (m) {
      var n = (+m[1]) + (+m[2]);
      return op(n, n, 'cable', { cross: m[3] === 'l' ? 'f' : 'b', span: n, purled: !!m[4], name: m[0].toUpperCase() });
    }],
    [/^(rt|lt)\b/, function (m) { return op(2, 2, 'cable', { cross: m[1] === 'lt' ? 'f' : 'b', span: 2, name: m[1].toUpperCase() }); }],
    [/^(?:sl\s*1\s*[-,]?\s*k2tog\s*[-,]?\s*psso|sk2po?)\b/, function () { return op(1, 3, 'k3tog'); }],
    [/^(?:cdd|s2kp2?|s2kpo|sl\s*2\s*(?:tog\s*)?(?:kwise\s*)?[-,]?\s*k1\s*[-,]?\s*p2sso)\b/, function () { return op(1, 3, 'cdd'); }],
    [/^(?:k3tog|p3tog)(?:\s*tbl)?\b|^ss[sk]k\b|^sssp\b/, function () { return op(1, 3, 'k3tog'); }],
    [/^(?:sl\s*1\s*[-,]?\s*k1\s*[-,]?\s*psso|skpo?)\b/, function () { return op(1, 2, 'ssk'); }],
    [/^(?:k2tog|p2tog)\s*tbl\b|^ss[kp]\b/, function () { return op(1, 2, 'ssk'); }],
    [/^(?:k2tog|p2tog)\b/, function () { return op(1, 2, 'k2tog'); }],
    // spelled out: "knit 2 together", "purl two together", "knit 3 tog"
    [/^(?:knit|purl)\s+(?:3|three)\s+tog(?:ether)?\b/, function () { return op(1, 3, 'k3tog'); }],
    [/^(?:knit|purl)\s+(?:2|two)\s+tog(?:ether)?\b/, function () { return op(1, 2, 'k2tog'); }],
    [/^p2sso\b/, function () { return op(-2, 0, null); }],
    [/^psso\b/, function () { return op(-1, 0, null); }],
    [/^kfbf\b/, function () { return op(3, 1, 'kfb'); }],
    [/^(?:kfb|pfb|k1fb|p1fb|kf&b|pf&b|k1f&b|p1f&b)\b/, function () { return op(2, 1, 'kfb'); }],
    [/^(?:m1(?:l|r|p|lp|rp|pl|pr)?|make\s+1|make\s+one|lli|rli|lri|rri)\b/, function () { return op(1, 0, 'm1'); }],
    [/^(?:yo2|yo\s+twice|double\s+yo)\b/, function () { return op(2, 0, 'yo'); }],
    [/^(?:yo|yfwd|yfrn|yf|yon|yrn|yarn\s+over)\b/, function () { return op(1, 0, 'yo'); }],
    [/^(?:mb|make\s+bobble|bobble)\b/, function () { return op(1, 1, 'k', { bobble: true }); }],
    // (older books: "over" alone, and "sk2p" from "slip, narrow and bind")
    [/^over\b/, function () { return op(1, 0, 'yo'); }],
    [/^sk2p\b/, function () { return op(1, 3, 'k3tog'); }],
    [/^k(\d+)?(?:\s*tbl\b|b\b)?/, function (m) { var n = m[1] ? +m[1] : 1; return op(n, n, 'k'); }],
    [/^knit\s+(\d+)\b/, function (m) { var n = +m[1]; return op(n, n, 'k'); }],
    [/^p(\d+)?(?:\s*tbl\b|b\b)?/, function (m) { var n = m[1] ? +m[1] : 1; return op(n, n, 'p'); }],
    [/^purl\s+(\d+)\b/, function (m) { var n = +m[1]; return op(n, n, 'p'); }],
    // "purl remaining 17 stitches", "knit next 9 stitches"
    [/^(knit|purl|k|p)\s+(?:the\s+)?(?:rem(?:aining)?|next|following)\s+(\d+)\b/, function (m) { var n = +m[2]; return op(n, n, /^p/.test(m[1]) ? 'p' : 'k'); }],
    [/^sl(?:ip)?\s*(\d+)?(?:\s*sts?\b)?/, function (m) { var n = m[1] ? +m[1] : 1; return op(n, n, 'sl'); }],
    [/^work\s+(\d+)(?!\s*(?:st|nd|rd|th)\s+(?:row|rnd|round))\s*(?:sts?|stitches)?\b/, function (m) { var n = +m[1]; return op(n, n, 'k', { work: true }); }],
    // "Rib across 8 sts", "Pat across next 7 sts", "work across 12 sts" (Patons)
    [/^(?:rib|patt?|work|knit|k|purl|p)\s+(?:across|over)\s+(?:the\s+)?(?:next\s+)?(\d+)\s*(?:sts?|stitches)?\b/, function (m) { var n = +m[1]; return op(n, n, 'k', { work: true }); }]
  ];
  // words that ride along with a stitch and change nothing about the count
  var MOD_RE = /^(?:with\s+(?:mc|cc\d?|ac\d?|[a-e]|yarn\s+[a-e]|colou?r\s+[a-e])|wyif|wyib|wyf|wyb|with\s+yarn\s+in\s+(?:front|back)|kwise|pwise|knitwise|purlwise|tbl|through\s+(?:the\s+)?back\s+loops?|loosely|as\s+(?:if\s+)?to\s+(?:knit|purl)|to\s+(?:the\s+)?(?:right|left)[-\s]hand\s+needle(?:\s+point)?|of\s+(?:the\s+)?heel(?:\s+flap)?|in\s+patt(?:ern)?|in\s+rib|(?:heel(?:\s+flap)?|instep|sole|held|gusset|cent(?:er|re)|edge|selvedge)\s+(?:sts?|stitches)|sts?|stitch(?:es)?|of|the|next|each|st\b|on\s+(?:the\s+)?(?:rs|ws)|tog\s+tbl)\b/;
  var MULT_AFTER_RE = /^\s*(?:x\s*(\d+)|(\d+)\s+times|(twice|thrice)|(two|three|four|five|six)\s+times)\b/;

  // whole-segment forms
  var CO_RE = /^(?:co|cast\s+on|using\s+[a-z\s-]+?,?\s*co)\s+(?:loosely\s+)?(\d+)\s*(?:new\s+)?(?:(?:underarm|extra|more)\s+)?(?:sts?|stitches)?\b\s*(.*)$/;
  var BO_RE = /^(?:bo|bind\s+off|cast\s+off)\s+(\d+)\s*(?:sts?|stitches)?\b\s*(.*)$/;
  var BO_ALL_RE = /^(?:bo|bind\s+off|cast\s+off)\b\s*(?:all\s+|rem(?:aining)?\s+)?(?:sts?\s*)?(?:loosely|knitwise|purlwise|kwise|pwise|in\s+(?:patt?(?:ern)?|rib(?:bing)?)|as\s+(?:established|set)|\s)*$/;
  var PU_RE = /^(?:pu&k|pu|pick\s+up)\s+(\d+)\s*(?:[a-z]+\s+)?(?:sts?|stitches)?\b(.*)$/;
  var HOLD_RE = /^(?:sl(?:ip)?|place|put|transfer|move)\s+(?:the\s+)?(?:next\s+|last\s+|rem(?:aining)?\s+|first\s+)?(\d+)\s*(?:[a-z]+\s+){0,2}?(?:sts?|stitches)\b\s*(.*)$/;
  var HOLDER_WORD = /\b(?:holder|scrap|waste|spare|stitch\s+holder|st\s+holder)\b/;
  var PM_RE = /^(?:pm|(?:place|insert)\s+(?:a\s+|another\s+|new\s+|unique\s+|removable\s+|locking\s+|contrasting\s+|colou?red\s+|split[-\s]ring\s+)*(?:beg(?:inning)?[-\s]of[-\s](?:rnd|round)\s+)?m(?:arker)?s?)\b\s*(.*)$/;
  var ZERO_SEG_RE = /^(?:includ(?:ed|ing)\b.*|sm|sl\s*m|slm|slip\s+(?:the\s+)?m(?:arker)?|rm|remove\s+(?:the\s+)?(?:old\s+)?(?:beg[-\s]of[-\s]rnd\s+|beg-of-rnd\s+|[a-z]+\s+)?m(?:arkers?)?\b.*|removing\s+.*|join\b.*|rejoin\b.*|with\b.*|using\b.*|change\s+to\b.*|cut\b.*|break\b.*|leave\b.*|leaving\b.*|weave\b.*|divide\b.*|do\s+not\b.*|don'?t\b.*|being\s+careful\b.*|careful\b.*|note\b.*|beg(?:in)?\s+(?:working|to\s+work)\b.*|working\s+(?:back\s+and\s+forth|in\s+(?:the\s+)?rnds?|flat)\b.*|proceed\b.*|as\s+foll(?:ows)?|fold\b.*|whipstitch\b.*|graft\b.*|unknit\b.*|block\b.*|ending\s+(?:with|after|on)\b.*|end\s+(?:with|after|on)\b.*|heel\s+turn\s+is\b.*|turn\s+heel|shape\s+[a-z]+|then\s*$|and\s*$|\(?see\b.*|needles?\s*\d+|n\d)$/;
  var TURN_RE = /^(?:turn(?:\s+work)?|w&t|wrap\s+(?:and|&)\s+turn|wrap\s+next\s+st(?:itch)?(?:\s+and\s+turn)?)\s*$/;
  var FILL_VERB_RE = /^(?:(k|knit|p|purl)|(work|cont(?:inue)?|rib|patt?)(?:\s+even)?(?:\s+(?:in\s+)?(?:the\s+)?(?:est(?:ablished)?\s+)?(?:patt?(?:ern)?|rib(?:bing)?|st\s*st|stockinette|garter\s+st|[a-z ]{0,30}?\s+patt?)(?:\s+as\s+(?:established|set))?)?|(k2tog|p2tog|ssk|ssp|k1tbl|p1tbl|ktbl|ptbl))\b\s*(.*)$/;
  var UNK_FILL_RE = /^(?:work|knit|k|purl|p)\s+(?:the\s+|all\s+|rem(?:aining)?\s+)?(?:[a-z]+\s+){0,2}?sts?\s*(?:in\s+(?:patt?(?:ern)?|rib|st\s*st))?(?:\s+as\s+(?:established|set))?\s*$/;
  // "work 1st row of panel pat c" / "work 2nd row cable panel b over 7 sts" /
  // "work row 7 of chart a" (lower case: parseSeg's input)
  var PANEL_REF_RE = /^work\s+(?:the\s+)?((?:\d+(?:st|nd|rd|th)|next|same|first|last)\s+(?:row|rnd|round)|(?:row|rnd|round)\s+\d+)\s+(?:of\s+)?(?:the\s+)?((?:[a-z]+\s+){0,3}?(?:panel|pat|patt|pattern|chart|cable)(?:\s+[a-z]+){0,2}?(?:\s+[a-z0-9]{1,2})?)(?:\s+(?:over|across)\s+(?:the\s+)?(?:next\s+)?(\d+)\s*(?:sts?|stitches)?)?$/;
  // "Panel Pat A (worked over 24 sts)", "CABLE PANEL A (worked over" / "15
  // sts).": a stitch panel the rows of a piece work by name
  var PANEL_DEF_G = /([A-Z][A-Za-z]*(?:\s+[A-Za-z0-9]+){0,3})\s*\(\s*worked\s+over\s+(\d+)\s+(?:sts?|stitches)\s*\)/g;

  function panelKey(n) {
    return String(n || '').toLowerCase().replace(/^(?:the|of)\s+/, '').replace(/\s+/g, ' ').trim();
  }
  function collectPanels(raws) {
    var flat = raws.map(function (l) { return String(l).trim(); }).join(' '), m, out = {}, any = false;
    PANEL_DEF_G.lastIndex = 0;
    while ((m = PANEL_DEF_G.exec(flat)) !== null) { out[panelKey(m[1])] = int(m[2]); any = true; }
    return any ? out : null;
  }
  var GUIDE_LINE_RE = /^([A-Za-z][A-Za-z0-9 ]{1,40}?)\s*\(\s*worked\s+over\s+(\d+)\s+(?:sts?|stitches)\s*\)\s*:\s*(\S.*\|.*)$/i;

  /**
   * Each panel the document defines, with the lines that define it: the
   * "Panel Pat A (worked over 24 sts)" line and what follows it up to "These 24
   * rows form Panel Pat A." (or the next panel / heading). Expand reads a
   * panel row from these when a row says "Work 1st row of Panel Pat A".
   */
  function collectPanelText(raws, out) {
    out = out || {};
    var any = Object.keys(out).length > 0;
    for (var i = 0; i < raws.length; i++) {
      var t = String(raws[i]).trim();
      var d = /^([A-Za-z][A-Za-z0-9 ]{1,40}?)\s*\(\s*worked\s+over\s+(\d+)\s+(?:sts?|stitches)\s*\)/i.exec(t);
      if (!d) continue;
      var key = panelKey(d[1]);
      if (out[key]) continue;
      var block = [t];
      for (var j = i + 1; j < raws.length && j <= i + 60; j++) {
        var n = String(raws[j]).trim();
        if (!n) continue;
        if (/^===\s*page/i.test(n)) continue;
        if (/\(\s*worked\s+over\s+\d+/i.test(n) || /^[A-Z][A-Z &'\/-]{3,40}$/.test(n)) break;
        block.push(n);
        if (/^these\s+(?:\d+(?:st|nd|rd|th)\s+to\s+\d+(?:st|nd|rd|th)\s+)?(?:\d+\s+)?(?:rows?|rnds?|rounds?)\s+form\b/i.test(n)) break;
      }
      if (block.length < 2) continue;
      out[key] = { width: int(d[2]), text: block.join('\n') };
      any = true;
    }
    return any ? out : null;
  }

  // expand(): the panels of the lines being expanded (see knitExpand)
  var CUR_PANELS = null, PANEL_DEPTH = 0;
  // expand(): garment rows since the row a repeat works again - a panel goes
  // on from where that row left it ("keeping cont of Panel Pats")
  var PANEL_SHIFT = 0;

  function panelDef(name) {
    if (!CUR_PANELS) return null;
    var k = panelKey(name);
    if (CUR_PANELS[k]) return CUR_PANELS[k];
    var hit = null;
    Object.keys(CUR_PANELS).forEach(function (d) {
      if (!hit && (d.slice(-(k.length + 1)) === ' ' + k || k.slice(-(d.length + 1)) === ' ' + d)) hit = CUR_PANELS[d];
    });
    return hit;
  }

  /** The stitch records of row `row` of a panel, or null. */
  function panelRecords(name, row) {
    var def = panelDef(name);
    if (!def || !(row >= 1) || PANEL_DEPTH > 2) return null;
    if (!def.lines) { try { def.lines = Knits.parse(def.text); } catch (e) { def.lines = []; } }
    if (def.cycle === undefined) {
      // "These 24 rows form Panel Pat A." (rows 1-24 over and over), "These 3rd
      // to 16th rows form Panel Pat A." (rows 1-2 once, then 3-16 over and
      // over) - else the rows it writes
      var pm = /\bthese\s+(\d+)\s+(?:rows?|rnds?|rounds?)\s+form\b/i.exec(def.text);
      var pr = /\bthese\s+(\d+)(?:st|nd|rd|th)\s+to\s+(\d+)(?:st|nd|rd|th)\s+(?:rows?|rnds?|rounds?)\s+form\b/i.exec(def.text);
      def.cycle = pr ? { from: int(pr[1]), to: int(pr[2]) } : pm ? { from: 1, to: int(pm[1]) } : null;
      if (!def.cycle) { try { var mxr = Knits.summary(def.lines).maxRow; def.cycle = mxr >= 1 ? { from: 1, to: mxr } : null; } catch (e1) { def.cycle = null; } }
      if (def.cycle && !(def.cycle.to >= def.cycle.from && def.cycle.from >= 1)) def.cycle = null;
    }
    if (PANEL_SHIFT && def.cycle) {
      var cy = def.cycle, rr = row + PANEL_SHIFT;
      if (rr > cy.to) rr = cy.from + (rr - cy.from) % (cy.to - cy.from + 1);
      if (rr >= 1) row = rr;
    }
    var savedShift = PANEL_SHIFT;
    PANEL_SHIFT = 0;
    PANEL_DEPTH++;
    try {
      var ex = knitExpand(def.lines, row, def.width, null);
      if (!ex || !ex.stitches || ex.live !== def.width) return null;
      return ex.stitches.map(function (s) {
        var r = { t: s.t };
        if (s.t === 'cable') { r.cross = s.cross; r.span = s.span; r.name = s.name; r.at = s.at; }
        return r;
      });
    } finally { PANEL_DEPTH--; PANEL_SHIFT = savedShift; }
  }

  function panelWidth(name) {
    var ps = E && E.run().panels;
    // (in expand() the parse is over: the panels of the lines being expanded)
    if (CUR_PANELS) { var pd = panelDef(name); if (pd) return pd.width; }
    if (!ps) return null;
    var k = panelKey(name);
    if (ps[k] !== undefined) return ps[k];
    var hit = null;
    Object.keys(ps).forEach(function (d) {
      if (hit === null && (d.slice(-(k.length + 1)) === ' ' + k || k.slice(-(d.length + 1)) === ' ' + d)) hit = ps[d];
    });
    return hit;
  }

  var EACH_END_RE = /\s+at\s+(?:each|both)\s+ends?(?:\s+of\s+(?:the\s+)?(?:next|this|every|foll(?:owing)?)\b.*)?$|\s+each\s+side\s*$/;

  /**
   * Text -> { items, bad } for one instruction (marker, side tag and count
   * tails already off, sizes already resolved, lower case).
   */
  function program(s, reps) {
    reps = reps || [];
    // "Knit 6 (10, 6), knit 2 together. Repeat to end of row." - no star: the
    // stitches before it are the block (magic loop toe)
    if (!reps.length && s.indexOf('*') < 0) {
      var bare = /([.,;]\s*)(?:then\s+)?rep(?:eat)?\s+((?:to\s+(?:the\s+)?end(?:\s+of\s+(?:the\s+)?(?:row|rnd|round|needle))?|across|around)\b)/.exec(s);
      if (bare && /[a-z0-9]/.test(s.slice(0, bare.index))) {
        s = '* ' + s.slice(0, bare.index) + bare[1] + 'rep from * ' + bare[2] + s.slice(bare.index + bare[0].length);
      } else {
        // "Purl 2, slip and bind, ..., knit 6; repeat twice." / "...; repeat." /
        // "K 2 tog, K 2, repeat from across row" (older books, Begin to Knit):
        // the stitches before it are the block
        var bare2 = /([.,;]\s*)(?:then\s+)?rep(?:eat)?(?:\s+from)?(?:\s+((?:once|twice|thrice|\d+\s+times)(?:\s+more)?|(?:to\s+(?:the\s+)?end|across|around)(?:\s+(?:the\s+)?(?:row|rnd|round|needle))?))?\s*[.;]?\s*$/.exec(s);
        if (bare2 && /[a-z0-9]/.test(s.slice(0, bare2.index))) {
          s = '* ' + s.slice(0, bare2.index) + bare2[1] + 'rep from * ' + (bare2[2] || 'to end');
        }
      }
    }
    // repeat phrases first, so their stars are not read as marks
    var REP_G = /(?:\b(?:then\s+)?rep(?:eat)?(?:\s+(?:the\s+)?(?:sts?\s+)?)?\s+from\s+|\bthen\s+from\s+|^\s*from\s+)(\*+)(?:\s+to\s+(\*+))?([^,;.]*)/g;
    s = s.replace(REP_G, function (all, from, to, tail) {
      reps.push({ from: from.length, to: to ? to.length : 0, tail: tail });
      return ' \u0001R' + (reps.length - 1) + '\u0001 ';
    });
    s = s.replace(/\*\*+/g, ' \u0001M2\u0001 ').replace(/\*/g, ' \u0001M1\u0001 ');
    var items = [], i = 0, buf = '', bad = false;
    function flush() {
      if (!buf.trim()) { buf = ''; return; }
      var segs = buf.split(/[,;:]|\.(?!\d)/);
      for (var k = 0; k < segs.length; k++) {
        var seg = segs[k].trim();
        if (!seg) continue;
        var r = parseSeg(seg);
        if (r === null) { bad = true; items.push({ unknown: seg }); continue; }
        for (var q = 0; q < r.length; q++) items.push(r[q]);
      }
      buf = '';
    }
    while (i < s.length) {
      var ch = s.charAt(i);
      if (ch === '\u0001') {
        var end = s.indexOf('\u0001', i + 1);
        var tag = s.slice(i + 1, end);
        flush();
        if (tag === 'M1') items.push({ mark: 1 });
        else if (tag === 'M2') items.push({ mark: 2 });
        else {
          var rp = reps[int(tag.slice(1))];
          var spec = repSpec(rp.tail);
          if (!spec) { bad = true; items.push({ unknown: 'rep ' + rp.tail }); }
          else items.push({ rep: { from: rp.from, to: rp.to, times: spec.times, until: spec.until } });
        }
        i = end + 1;
        continue;
      }
      if (ch === '(' || ch === '[') {
        var close = ch === '(' ? ')' : ']';
        var depth = 0, j = i;
        for (; j < s.length; j++) {
          if (s.charAt(j) === ch) depth++;
          else if (s.charAt(j) === close) { depth--; if (!depth) break; }
        }
        if (j >= s.length) { buf += ch; i++; continue; }
        var inner = s.slice(i + 1, j);
        var after = s.slice(j + 1);
        var mult = null, to = null, used = 0, mm;
        if ((mm = MULT_AFTER_RE.exec(after)) || (mm = /^\s*(\d+)\s+more\s+times\b/.exec(after))) {
          used = mm[0].length;
          mult = mm[1] ? int(mm[1]) : mm[2] ? int(mm[2]) : mm[3] ? WORDN[mm[3]] : WORDN[mm[4]];
          if (/more/.test(mm[0])) mult += 1;
        } else if ((mm = /^\s*(once|twice|thrice)\s+more\b/.exec(after))) {
          used = mm[0].length; mult = WORDN[mm[1]] + 1;
        } else {
          var rt = readTo(after.replace(/^\s*(?:rep(?:eat)?\s+)?/, ''));
          if (rt) {
            to = rt.to;
            used = after.length - after.replace(/^\s*(?:rep(?:eat)?\s+)?/, '').length + rt.len;
          }
        }
        var sub = program(inner, reps);
        flush();
        if (mult !== null || to) {
          if (sub.bad) bad = true;
          items.push({ group: sub.items, times: mult, to: to });
        } else if (!sub.bad && sub.items.some(function (x) { return x.op || x.fill || x.group || x.co || x.bo; })) {
          // a bracket of stitches with no multiplier is worked once
          items.push({ group: sub.items, times: 1, to: null });
        }
        // anything else in brackets is commentary: "(see Glossary)",
        // "(center front)", "(1 st each side of gap)", "(removing marker)"
        i = j + 1 + used;
        continue;
      }
      buf += ch;
      i++;
    }
    flush();
    return { items: items, bad: bad };
  }

  function repSpec(tail) {
    var t = String(tail || '').trim();
    if (!t) return { times: null, until: { kind: 'none' } };
    var m = REP_TAIL_TIMES.exec(t);
    if (m) {
      var n;
      if (m[1] || m[2]) n = int(m[1] || m[2]);            // N more times
      else if (m[3]) n = int(m[3]);                       // N times (more: see below)
      else if (m[4]) n = WORDN[m[4]];                      // once/twice more
      else if (m[5]) n = WORDN[m[5]];                      // "then from * to ** once"
      else if (m[6]) n = WORDN[m[6]];
      else n = WORDN[m[7]];
      // "rep from * N times" is read as N MORE times - the instructions before
      // the star have already been worked once. When the row's own total is
      // known run() checks the other reading too (see `ambiguous`).
      return { times: n, until: null, ambiguous: !!(m[3] || m[7]) };
    }
    var rt = readTo(t);
    if (rt) return { times: null, until: rt.to };
    if (/^(?:across|around)\b/.test(t)) return { times: null, until: { kind: 'end' } };
    return null;
  }

  /** One comma/period segment -> list of items, or null if unreadable. */
  function parseSeg(seg) {
    var s = seg.replace(/\s+/g, ' ').trim()
      .replace(/^(?:and|then|now|next,?)\s+/, '')
      .replace(/\s+(?:as\s+foll(?:ows)?|even|as\s+(?:established|set)|in\s+patt(?:ern)?)$/, '');
    if (!s) return [];
    var m;
    if (TURN_RE.test(s)) return [{ turn: true }];
    // "insert marker around next st" (Sandnes): a marked stitch - the marker
    // sits on it, and it is worked like the rest
    if (/^(?:insert|place)\s+(?:a\s+)?marker\s+(?:around|on)\s+(?:the\s+)?(?:next|last)\s+st(?:itch)?$/.test(s)) return [{ pm: 'around' }, { op: op(1, 1, 'k', { work: true }), n: 1 }];
    if ((m = PM_RE.exec(s))) return [{ pm: m[1] || '' }];
    // "count 10 sts" (Sandnes, placing markers): stitches passed over
    if ((m = /^count\s+(\d+)\s*(?:sts?|stitches)$/.exec(s))) return [{ op: op(int(m[1]), int(m[1]), 'k', { work: true }), n: 1 }];
    // "Pat across 55 sts (neck edge). Turn. Leave rem sts on a spare needle.":
    // the rest of the row waits - what was worked is what is on the needle
    if (/^(?:leave|leaving|place|put|slip|sl)\s+(?:the\s+)?(?:rem(?:aining)?|other|all\s+rem(?:aining)?)\s+(?:sts?|stitches)\s+(?:on|onto)\s+(?:a\s+|the\s+)?(?:spare\s+needle|(?:st(?:itch)?\s+)?holder|scrap|waste)/.test(s)) return [{ heldRest: true }];
    if (ZERO_SEG_RE.test(s)) return [{ zero: s, join: /^(?:join|rejoin)\b/.test(s) }];
    // "...leaving 5 (6, 08 stitches unworked" (a bracket the pattern never
    // closed): what stays on the needle
    if (/^(?:\d+\s*)?(?:sts?|stitches)\s+(?:unworked|left|rem(?:aining)?|on\s+(?:each|the))\b/.test(s)) return [{ zero: s }];
    // "transfer sl st to left needle" - a stitch moved, not worked
    if (/^(?:transfer|return|move|slip|sl)\s+(?:the\s+)?(?:sl\s+|slipped\s+|last\s+)?(?:st|stitch)\s+(?:back\s+)?(?:to|onto)\s+(?:the\s+)?(?:left|right|lh|rh)(?:[-\s]hand)?\s+needle\b/.test(s)) return [{ zero: s }];
    if ((m = CO_RE.exec(s))) {
      if (m[2] && !/^(?:(?:using|with|for|at|to|onto|on)\b.*|\(.*|-.*|(?:using\s+)?(?:the\s+)?[a-z]+\s+(?:method|cast[-\s]on).*)?$/.test(m[2].trim())) return null;
      return [{ co: int(m[1]) }];
    }
    if ((m = BO_RE.exec(s))) {
      var rest = m[2].trim(), times = 1, mm;
      if ((mm = /^(?:at\s+)?(?:the\s+)?beg(?:inning)?(?:\s+of)?\s+(?:the\s+)?next\s+(\d+)\s+(?:rows?|rnds?)/.exec(rest))) times = int(mm[1]);
      else if (/^(?:at\s+)?(?:the\s+)?beg(?:inning)?(?:\s+of)?\s+(?:the\s+)?next\s+and\s+(?:the\s+)?foll(?:owing)?\s+alt(?:ernate)?\s+(?:row|rnd)s?$/.test(rest)) times = 2;
      else if (rest && !/^(?:knitwise|purlwise|kwise|pwise|loosely|in\s+patt?(?:ern)?|(?:at\s+)?(?:the\s+)?beg(?:inning)?(?:\s+of)?\s+(?:the\s+)?(?:next\s+)?(?:row|rnd))\b/.test(rest)) return null;
      return [{ bo: int(m[1]) * times }];
    }
    // "(cast off 15 sts beg next 4 rows,) then 16 sts beg following 2 rows"
    if ((m = /^(\d+)\s*(?:sts?|stitches)\s+(?:at\s+)?(?:the\s+)?beg(?:inning)?(?:\s+of)?\s+(?:the\s+)?(?:next|foll(?:owing)?)\s+(\d+)\s+(?:rows?|rnds?)$/.exec(s))) {
      return [{ bo: int(m[1]) * int(m[2]) }];
    }
    // "dec 1 st at neck edge on next 9 rows", "inc 1 st each end of needle on
    // next row": the edge stitches shaped, the rest of each row worked
    if ((m = SHAPE_ROWS_RE.exec(s)) && m[0].replace(/[\s.]+$/, '').length === s.replace(/[\s.]+$/, '').length) {
      var per = (WORDN[m[2]] || int(m[2])) * (/each|both/.test(m[3]) ? 2 : 1) * (m[4] ? int(m[4]) : 1);
      var shOp = /^dec/.test(m[1]) ? op(1, 2, 'k2tog') : op(1, 0, 'm1');
      return [{ op: shOp, n: per }, { fill: { p: 1, c: 1, t: 'k' }, to: { kind: 'end' }, implicit: true }];
    }
    if (BO_ALL_RE.test(s)) return [{ boAll: true }];
    if ((m = PU_RE.exec(s))) return [{ op: op(int(m[1]), 0, 'k', { picked: true }), n: 1 }];
    // "...then 16 sts along edge of heel flap, ..." - more stitches picked up
    if ((m = /^(\d+)\s*sts?\s+(?:along|from|in|between|across|up|down)\b/.exec(s))) return [{ op: op(int(m[1]), 0, 'k', { picked: true }), n: 1 }];
    if ((m = HOLD_RE.exec(s)) && HOLDER_WORD.test(m[2] || '')) {
      var nn = int(m[1]);
      if (/\bfrom\b/.test(m[2])) return [{ op: op(nn, 0, 'k', { fromHolder: true }), n: 1 }];
      return [{ held: nn }];
    }
    // "k2tog at each end of next row" - one at each end
    var each = EACH_END_RE.exec(s);
    if (each) {
      var core = parseSeg(s.slice(0, each.index));
      if (!core || !core.length) return null;
      var coreC = 0;
      for (var ci = 0; ci < core.length; ci++) {
        if (!core[ci].op) return null;
        coreC += core[ci].op.c * (core[ci].n || 1);
      }
      return [{ group: core, times: 1, to: null }, { fill: { p: 1, c: 1, t: 'k' }, to: { kind: 'last', n: coreC }, implicit: true },
              { group: core, times: 1, to: null }];
    }
    // "Work 1st row of Panel Pat C", "Work 3rd row Cable Panel B across next 13
    // sts", "work row 7 of Chart A over 32 sts": the panel's width, from its
    // own definition ("Panel Pat C (worked over 9 sts)") or from the line
    if ((m = PANEL_REF_RE.exec(s))) {
      var pw = m[3] ? int(m[3]) : panelWidth(m[2]);
      if (pw === null) return null;
      var prow = /^(\d+)/.exec(m[1]) || /(\d+)$/.exec(m[1]);
      return [{ op: op(pw, pw, 'k', { work: true, panel: m[2], panelRow: prow ? int(prow[1]) : null }), n: 1 }];
    }
    // a fill: "knit to end", "p to last 3 sts", "work in patt to m", "Purl."
    if ((m = FILL_VERB_RE.exec(s))) {
      var verb = m[1] || m[2] || m[3];
      // "work in speed bumps patt for gussets and foot to m": who it is for
      // changes nothing
      var tail = (m[4] || '').replace(/^for\s+[a-z ,&]{1,40}?\s+(?=to\b|across\b|around\b)/, '');
      var rate = { p: 1, c: 1, t: /^p(?:url|1tbl|tbl)?$/.test(verb) ? 'p' : 'k' };
      if (/^(?:k2tog|p2tog)$/.test(verb)) rate = { p: 1, c: 2, t: 'k2tog' };
      else if (/^(?:ssk|ssp)$/.test(verb)) rate = { p: 1, c: 2, t: 'ssk' };
      // a bare "k2tog" / "k" is one stitch, not a fill; a bare "Knit." /
      // "Purl." / "Work even." is the whole row
      var bareOk = /^(?:knit|purl|work|cont|rib|pat)/.test(verb);
      if ((!tail.trim() && bareOk) || (bareOk && /^(?:until|end\s+of\s+(?:the\s+)?(?:rnd|round|row))\b/.test(tail.trim())) ||/^(?:all\s+sts?|across|around|even|(?:\d+\s+)?(?:rnds?|rows?|rounds?)(?:\s+even)?|to\s+end.*)$/.test(tail.trim())) {
        var rnds = /^(\d+)\s+(?:rnds?|rows?|rounds?)/.exec(tail.trim());
        if (rnds && int(rnds[1]) !== 1) return [{ fill: rate, to: { kind: 'end' }, rows: int(rnds[1]) }];
        var rt0 = readTo(tail);
        if (rt0 && rt0.to.kind !== 'end') return [{ fill: rate, to: rt0.to }];
        return [{ fill: rate, to: { kind: 'end' } }];
      }
      var rt = readTo(tail);
      if (rt && !tail.slice(rt.len).trim().replace(/^(?:of\s+(?:the\s+)?(?:row|rnd|round)|in\s+patt(?:ern)?|as\s+(?:established|set)|even)\b/, '').trim()) {
        return [{ fill: rate, to: rt.to }];
      }
      if (UNK_FILL_RE.test(s)) return [{ fill: rate, to: { kind: 'unknown' } }];
    }
    if (UNK_FILL_RE.test(s)) return [{ fill: { p: 1, c: 1, t: 'k' }, to: { kind: 'unknown' } }];
    // a run of stitches: "k2 p2", "sl 1 pwise wyb", "k2tog twice", "c6f"
    var sawMod = false;
    var out = [], pos = s, guard = 0;
    while (pos.length && guard++ < 40) {
      pos = pos.replace(/^[\s,]+/, '');
      if (!pos) break;
      var mod = MOD_RE.exec(pos);
      if (mod) { pos = pos.slice(mod[0].length); sawMod = true; continue; }
      var hit = null;
      for (var k = 0; k < TOKENS.length; k++) {
        var tm = TOKENS[k][0].exec(pos);
        if (tm && (tm[0].length === pos.length || /^[\s,&\-]/.test(pos.charAt(tm[0].length)) || /\d$/.test(tm[0]) === false)) {
          // the token must end at a word boundary ("knit" is not "k" + "nit")
          var nextCh = pos.charAt(tm[0].length);
          if (nextCh && /[a-z]/.test(nextCh)) continue;
          hit = { op: TOKENS[k][1](tm), len: tm[0].length };
          break;
        }
      }
      if (!hit) return null;
      pos = pos.slice(hit.len);
      var mul = MULT_AFTER_RE.exec(pos), times2 = 1;
      if (mul) {
        times2 = mul[1] ? int(mul[1]) : mul[2] ? int(mul[2]) : mul[3] ? WORDN[mul[3]] : WORDN[mul[4]];
        pos = pos.slice(mul[0].length);
      }
      out.push({ op: hit.op, n: times2 });
    }
    // ("...purl 3 (3 3) stitches": what is left after a bracket is words that
    // change nothing)
    if (!out.length && sawMod && !pos.trim()) return [];
    return out.length ? out : null;
  }

  var REP_MAX = 1000;

  /**
   * Run a program against `prev` stitches. -> state:
   *   P produced, C consumed, net (P - C, known even when P/C are not),
   *   known (P and C are known), fail, short, markers, trace (for expand),
   *   unknownFills, co, gap
   */
  function newRun(prev) {
    return { prev: prev, P: 0, C: 0, net: 0, known: true, fail: false, short: false,
      markers: [], trace: [], unknownFills: 0, co: 0, gap: false, sawFill: false,
      joined: false, held: 0, bo: 0, rows: 1 };
  }

  function remaining(st) {
    if (st.prev === null || st.prev === undefined || !st.known) return null;
    return st.prev - st.C;
  }

  function addOp(st, o, n) {
    if (!(n >= 1)) return;
    if (n > REP_MAX) { st.fail = true; return; }
    st.P += o.p * n; st.C += o.c * n; st.net += (o.p - o.c) * n;
    st.toEnd = false;
    st.trace.push(st.rp ? { op: o, n: n, rp: st.rp } : { op: o, n: n });
  }

  // wave I (group-readout): under Patterns.repeatGroups (E.tagReps()) every
  // working of a repeated block tags the ops it adds `rp: {s, k}`, so the
  // counter can say "Group 3 of 20 · stitch 2 of 4" for "*k2, p2; rep from *
  // to end". A repeat inside a repeat keeps the outer tag (`st.rp` is set).
  var REP_SET = 0;
  function repTagging(st) { return !!(E && E.tagReps && E.tagReps()) && !st.rp; }
  function repWork(st, set, k, fn) {
    if (!set) { fn(); return; }
    st.rp = { s: set, k: k };
    try { fn(); } finally { st.rp = null; }
  }

  function exec(items, st, depth) {
    if ((depth || 0) > 6) { st.fail = true; return; }
    var marks = {}, tpos = {};
    for (var i = 0; i < items.length && !st.fail; i++) {
      var it = items[i];
      if (it.unknown) { st.fail = true; return; }
      if (it.mark) { tpos[i] = st.trace.length; marks[it.mark] = i; if (it.mark === 1) { marks.prev1 = marks.last1; marks.last1 = i; } continue; }
      if (it.op) { addOp(st, it.op, it.n || 1); continue; }
      if (it.zero) { if (it.join) st.joined = true; continue; }
      if (it.turn) { st.short = true; continue; }
      if (it.pm !== undefined) {
        st.markers.push({ label: it.pm, at: st.known ? st.P : null });
        continue;
      }
      if (it.co !== undefined) { st.co += it.co; addOp(st, { p: it.co, c: 0, t: 'co' }, 1); continue; }
      if (it.bo !== undefined) { st.bo += it.bo; addOp(st, { p: 0, c: it.bo, t: 'bo' }, 1); continue; }
      if (it.held !== undefined) { st.held += it.held; addOp(st, { p: 0, c: it.held, t: null, held: true }, 1); continue; }
      if (it.heldRest) {
        var hr = remaining(st);
        if (hr === null) { st.fail = true; return; }
        if (hr > 0) { st.held += hr; st.heldRest = hr; addOp(st, { p: 0, c: hr, t: null, held: true }, 1); }
        continue;
      }
      if (it.boAll) {
        var r0 = remaining(st);
        if (r0 === null) { st.fail = true; return; }
        st.bo += r0;
        addOp(st, { p: 0, c: 1, t: 'bo' }, r0);
        continue;
      }
      if (it.fill) { fill(st, it.fill, it.to, it); continue; }
      if (it.group) {
        var gset = repTagging(st) ? ++REP_SET : 0;
        if (it.to) { repeatUntil(st, it.group, it.to, depth, true, gset, 1); continue; }
        for (var g = 0, gt = (it.times === null || it.times === undefined) ? 1 : it.times; g < gt && !st.fail; g++) {
          repWork(st, gt > 1 ? gset : 0, g + 1, function () { exec(it.group, st, (depth || 0) + 1); });
        }
        continue;
      }
      if (it.rep) {
        var start = it.rep.from >= 2 ? marks[2] : marks.last1;
        if (start === undefined) { st.fail = true; return; }
        var stop = i;
        // "* k3tog, k3, yo, k2, yo, k3*; rep from * to * 14 times more": the
        // block sits between a pair of single stars
        var paired = it.rep.from === 1 && marks.prev1 !== undefined &&
          (it.rep.to === 1 || !items.slice(marks.last1 + 1, i).some(function (x) { return x.op || x.fill || x.group; }));
        if (paired) {
          start = marks.prev1;
          stop = marks.last1;
        } else if (it.rep.to) {
          stop = marks[2];
          if (stop === undefined || stop <= start) { st.fail = true; return; }
        }
        var block = items.slice(start + 1, stop).filter(function (x) { return !x.mark; });
        // the block was worked once already on the way here: that working
        // is group 1 (its trace entries, between the two marks)
        var rset = 0;
        if (repTagging(st) && tpos[start] !== undefined) {
          rset = ++REP_SET;
          var tEnd = stop === i ? st.trace.length : tpos[stop];
          for (var ti = tpos[start]; ti < tEnd && ti < st.trace.length; ti++) st.trace[ti].rp = { s: rset, k: 1 };
        }
        if (it.rep.times !== null && it.rep.times !== undefined) {
          for (var t = 0; t < it.rep.times && !st.fail; t++) {
            repWork(st, rset, t + 2, function () { exec(block, st, (depth || 0) + 1); });
          }
        } else if (it.rep.until && it.rep.until.kind !== 'none') {
          repeatUntil(st, block, it.rep.until, depth, false, rset, 2);
        } else {
          st.fail = true;
        }
      }
    }
  }

  /** How one working of `block` moves the counts, without touching `st`. */
  function probe(block, depth) {
    var s = newRun(null);
    exec(block, s, (depth || 0) + 1);
    return s;
  }

  function repeatUntil(st, block, to, depth, first, tagSet, tagK) {
    var pr = probe(block, depth);
    if (pr.fail || pr.short) { st.fail = true; return; }
    if (to.kind === 'gap') { st.gap = true; st.fail = true; return; }
    if (to.kind === 'marker' || to.kind === 'unknown') {
      // how many times it fits before the marker is not written down; only a
      // block that leaves the count alone can be read at all
      if (pr.net !== 0) { st.fail = true; return; }
      st.known = false; st.unknownFills++;
      st.trace.push({ unknownBlock: block, net: 0 });
      return;
    }
    var rem = remaining(st);
    var reserve = to.kind === 'last' ? to.n : 0;
    if (rem === null || !pr.known || pr.C <= 0) {
      if (pr.known && pr.net === 0) { st.known = false; st.unknownFills++; st.trace.push({ unknownBlock: block, net: 0 }); st.toEnd = to.kind === 'end'; return; }
      st.fail = true; return;
    }
    var span = rem - reserve;
    if (span < 0 || span % pr.C !== 0) { st.fail = true; return; }
    var reps = span / pr.C;
    // a group "(k1, p1) to end" is worked from scratch; "rep from * to end"
    // has worked its block once already, so a zero here is fine too
    if (reps > REP_MAX) { st.fail = true; return; }
    for (var r = 0; r < reps && !st.fail; r++) {
      repWork(st, tagSet || 0, (tagK || 1) + r, function () { exec(block, st, (depth || 0) + 1); });
    }
    if (to.kind === 'end') st.toEnd = true;
  }

  function fill(st, rate, to, it) {
    st.sawFill = true;
    if (it && it.rows > 1) st.rows = it.rows;
    if (!to) to = { kind: 'end' };
    if (to.kind === 'gap') { st.gap = true; st.fail = true; return; }
    var rem = remaining(st);
    if (to.kind === 'end' || to.kind === 'last') {
      if (rem !== null) {
        var w = rem - (to.kind === 'last' ? to.n : 0);
        if (w < 0 || w % rate.c !== 0) { st.fail = true; return; }
        addOp(st, { p: rate.p, c: rate.c, t: rate.t, fill: true }, w / rate.c);
        if (to.kind === 'end') st.toEnd = true;
        return;
      }
    } else if (to.kind === 'marker' || to.kind === 'unknown') {
      // nothing says how far the marker is; fine for the count as long as the
      // fill makes as many stitches as it eats
    }
    if (rate.p !== rate.c) { st.fail = true; return; }
    st.known = false; st.unknownFills++;
    st.trace.push({ unknownFill: rate, to: to });
    st.toEnd = to.kind === 'end';
  }

  // --- tails that are not instructions ----------------------------------
  var SIDE_LEAD_RE = /^\s*[:.]?\s*(?:\(\s*(?:rs|ws|right\s+side|wrong\s+side)\s*\)|(?:rs|ws)(?=\s*[:.]))\s*[:.]?\s*/i;
  var LABEL_LEAD_RE = /^\s*[:.]?\s*\(\s*(?:[a-z]+\s+)?(?:inc(?:rease)?|dec(?:rease)?|set[-\s]?up|eyelet|turning|joining)\s*(?:rnd|row|round)?\s*\)\s*[:.]?\s*/i;
  // "-4 sts inc'd", "-56 (68, 76) sts: 28 (34, 38) sts each...", "- 2 sole sts inc'd"
  // (to the end of its sentence: "CO 24 sts—12 sts on each needle. Place
  // marker (pm) and join in the rnd." keeps its second sentence)
  var COUNT_TAIL_RE = /\s*[-=]\s*\d+(?:[.,]\d+)?(?:\s*\([^)]*\))?\s*(?:[a-z]+\s+){0,2}?sts?\b[^.;]*[.;]?/i;
  var DELTA_TAIL_RE = new RegExp('[-=(]\\s*(\\d+)(\\s*\\(\\s*\\d+(?:\\s*[,\\-]\\s*\\d+)*\\s*\\))?\\s*(?:[a-z]+\\s+){0,2}?sts?\\s+' +
    '(inc(?:reased|\'d|d)?|dec(?:reased|\'d|d)?)\\b', 'i');
  var END_TOTAL_RE = /(?:^|[.;,]\s*)\(?\s*\d+(?:\s*\([^)]*\))?\s*sts?\s*(?:rem(?:ain(?:ing)?)?|total|on\s+(?:the\s+)?needles?)?\s*\)?\s*\.?\s*$/i;

  function prep(instr, ctx) {
    var s = E.normDashes(E.normUnicode(String(instr == null ? '' : instr)));
    // "knit 1…leaving 5 stitches unworked…turn work": a pause between steps
    s = s.replace(/…|\.{3}/g, ', ').replace(/\bleaving(?=\d)/gi, 'leaving ')
      .replace(/\b(?:slip|sl)\s*(\d+)\s+(?:st(?:itch)?\s+)?as\s+before\b/gi, 'slip $1');
    var mk = E.detectMarker(s.trim());
    if (mk) s = mk.rest;
    else {
      var nx = E.detectNextRow(s.trim());
      if (nx) s = nx.rest;
      else {
        var su = E.detectSetup(s.trim());
        if (su) s = su.rest;
      }
    }
    s = s.replace(SIDE_LEAD_RE, ' ').replace(LABEL_LEAD_RE, ' ').replace(SIDE_LEAD_RE, ' ')
      // ("...16 sts.**" - the closing "**" of a block a later part copies)
      .replace(/([.\w)])\*{2,3}\s*$/, '$1');
    s = s.replace(COUNT_TAIL_RE, '. ');
    // a closing "(60 sts)" is the total - but "k3 (2)." is a stitch in two sizes
    s = s.replace(/(\d?)\s*\(\s*\d+\s*(?:sts?|stitches)?[^()]*\)\s*\.?\s*$/i, function (all, d) {
      return d && !/\(\s*\d+\s*(?:sts?|stitches)/i.test(all) ? all : d;
    });
    s = s.replace(END_TOTAL_RE, '');
    s = s.replace(/\(s\)/g, 's').toLowerCase()
      .replace(/\bpick\s+up\s+(?:and|&)\s+(?:knit|k)\b/g, 'pu&k')
      .replace(/\bw\s*&\s*t\b/g, 'w&t')
      .replace(/\bwrap\s+(?:and|&)\s+turn\b/g, 'w&t')
      .replace(/\bslip\s+marker\b/g, 'sm').replace(/\bplace\s+marker\s+\(pm\)/g, 'pm')
      .replace(/\bsl\s+marker\b/g, 'sm');
    s = periodVocab(s);
    var rs = resolveSizes(s, ctx);
    return { text: rs.text.trim(), bad: rs.bad };
  }

  // The older vocabulary (wave H, batch 2: the Gutenberg books and the American
  // Thread booklet), rewritten into the words the reader knows - a dialect, not
  // a craft: "pearl" / "seam 2" = purl, "2 plain, 2 pearl" = k2, p2, "knit
  // plain" = knit, "narrow" = k2tog, "purl-narrow" = p2tog, "widen" = m1, "slip
  // and bind" = skp, "slip, narrow and bind" = sk2p, "over" / "put the thread
  // over" / "bring the wool forward" = yo, "take 2 together" = k2tog, "K 2 tog"
  // / "K 20" / "p.s.s.o." / "Y O" (spaced) = k2tog / k20 / psso / yo.
  function periodVocab(s) {
    return s
      .replace(/\bp\.\s*s\.\s*s\.\s*o\.?/g, 'psso')
      .replace(/\b(?:pass|draw|take|lift)\s+(?:the\s+)?(?:sl(?:ipped)?|slip)\s+st(?:itch)?\s+over(?:\s+(?:the\s+)?(?:k(?:nit)?\s+)?st(?:itch)?|\s+it)?\b/g, 'psso')
      // ("pass sl st over K st (p.s.s.o.)" - the bracket only names it)
      .replace(/(psso)\s*\(\s*psso\s*\)/g, '$1')
      .replace(/\by\s+o\b/g, 'yo')
      .replace(/(^|[\s,;(*])([kp])\s+(\d+)\s+tog\b/g, '$1$2$3tog')
      .replace(/(^|[\s,;(*])([kp])\s+(\d+)\b/g, '$1$2$3')
      // "* take 2 together. Repeat from *; knit the last stitch." - to the last
      // stitch; "Repeat from *." with nothing after it - to the end
      .replace(/\brep(?:eat)?\s+from\s+\*\s*[;,.]\s*(?:and\s+)?(knit|k|purl|p)\s+(?:the\s+)?last\s+(?:(\d+|one|two|three)\s+)?st(?:itch)?(?:es|s)?\b/g, function (all, v, n) {
        var k = n ? (WORDN[n] || int(n)) : 1;
        return 'rep from * to last ' + k + ' sts, ' + (/^p/.test(v) ? 'p' : 'k') + k;
      })
      .replace(/\brep(?:eat)?\s+from\s+\*\s*\.?\s*$/, 'rep from * to end')
      .replace(/\b(?:slip|sl)\s+the\s+(?:1st|first)\s+(?:stitch|st)\b/g, 'sl1')
      .replace(/\b(?:pearl|purl)[-\s]narrow\b/g, 'p2tog')
      .replace(/\bslip,?\s+narrow,?\s+and\s+bind\b/g, 'sk2p')
      .replace(/\bslip\s+and\s+bind\b/g, 'skp')
      .replace(/\bnarrow(?:ing)?\b/g, 'k2tog')
      .replace(/\bwiden(?:ing)?\b/g, 'm1')
      .replace(/\btake\s+(?:2|two)\s+together\b/g, 'k2tog')
      .replace(/\b(?:put|pass)\s+(?:the\s+)?(?:thread|wool|yarn)\s+(?:over|round)(?:\s+the\s+needle)?(?:\s+to\s+increase)?\b|\bbring\s+(?:the\s+)?(?:thread|wool|yarn)\s+forward\b|\b(?:wool|thread)\s+over(?:\s+the\s+needle)?\b/g, 'yo')
      .replace(/\bpearl/g, 'purl')
      .replace(/\bseam\s+(\d+)/g, 'purl $1')
      .replace(/\b(?:knit|k)\s+(\d+)\s+plain\b/g, 'k$1')
      .replace(/\b(\d+)\s+plain\b(?!\s+(?:rounds?|rows?|rnds?))/g, 'k$1').replace(/\b(\d+)\s+purl\b(?!\s+(?:rounds?|rows?|stitch))/g, 'p$1')
      .replace(/\b(?:knit|k)\s+plain\b/g, 'knit').replace(/\bplain\s+knitting\b/g, 'knit');
  }

  /**
   * The knitting count of one instruction.
   * opts: { size, sizeCount, scope, castOnAbs }
   * @returns {{count:number|null, net:number|null, markers:Array, short:boolean,
   *            run:Object, bad:boolean}}
   */
  function knitEval(instr, prevCount, opts) {
    var o = opts || {};
    var prev = (typeof prevCount === 'number' && isFinite(prevCount)) ? prevCount : null;
    var ctx = { size: o.size >= 0 ? o.size : (E ? E.sizeIndex() : 0),
      count: o.sizeCount >= 2 ? o.sizeCount : (E ? E.sizeCount() : 0), scope: o.scope || null };
    var res = { count: null, net: null, markers: [], short: false, run: null, bad: false, gap: false };
    if (instr == null) return res;
    var pp = prep(instr, ctx);
    var s = pp.text.replace(/^[\s,;:.]+/, '').replace(/[\s,;:]+$/, '');
    if (!s) return res;
    // a turn where the row stops is a short row (see isShort)
    res.short = isShort(s);
    if (pp.bad) { res.bad = true; return res; }
    var prog = program(s);
    var st = newRun(prev);
    exec(prog.items, st, 0);
    res.run = st;
    res.gap = st.gap;
    // a row that turns after working every stitch is a full row (Albus Argyle's
    // intarsia in the round turns at the end of each one)
    if (res.short && st.known && prev !== null && st.C === prev && !st.fail) res.short = false;
    // ...and so does one that works to the end and turns ("Sl 1, purl to end,
    // turn." on a heel flap), whatever the count
    if (res.short && st.toEnd && !st.fail && !SHORT_LEAVE_RE.test(s)) res.short = false;
    if (st.fail || prog.bad) {
      // the markers placed before the line went unreadable still stand
      res.markers = st.markers;
      res.bad = true;
      return res;
    }
    res.net = st.net;
    res.markers = st.markers;
    var castOnAbs = o.castOnAbs !== undefined ? o.castOnAbs : prev === null;
    if (st.co && st.C === 0 && st.known && castOnAbs) {
      res.count = st.P;
    } else if (prev !== null) {
      // "Work end of rnd, remove m, k1, pm for new beg of rnd." - the stitches
      // worked past the end start the next round: the round is all its
      // stitches, moved, and the count stands
      if (st.known && st.C > prev && st.net === 0 && st.sawFill &&
          /\bnew\s+(?:beg(?:inning)?[-\s]+of[-\s]+(?:rnd|round)|bor)\b/.test(s)) {
        res.count = prev;
        return res;
      }
      if (st.known && st.C > prev) return res;                 // eats more than there is
      // a full row works every stitch; one that stops short and does not turn
      // is a description of part of a row, not a total
      if (st.known && st.C < prev && !st.short && !st.held && !st.sawFill && !st.bo) {
        if (st.C === 0 && st.P > 0) res.count = prev + st.net;   // cast on / pick up / return held
        else return res;
      } else {
        res.count = prev + st.net;
      }
    } else if (st.known && !st.short && st.P > 0 && !st.held) {
      res.count = st.P;
    }
    if (res.count !== null && res.count < 0) res.count = null;
    return res;
  }

  // =====================================================================
  // 4. Profile hooks
  // =====================================================================

  // --- size names ---------------------------------------------------------
  var SIZE_TOK_RE = /^(?:x{0,4}s|s|m|l|x{0,4}l|\d+\s*x(?:l)?|\d+x?s|(?:x{0,3}[sml]|\d?x{0,3}l|\d+x)\/(?:x{0,3}[sml]|\d?x{0,3}l|\d+x)|\d+\/\d+\s*x{0,3}[sl]|one\s+size)$/i;
  var SIZE_PAREN_G = /(?:^|[\s:])([A-Za-z0-9\/]{1,6})\s*\(\s*([A-Za-z0-9\/]{1,6}(?:\s*[-,]\s*[A-Za-z0-9\/]{1,6})+|[A-Za-z0-9\/]{1,6})\s*\)(?:\s*\(\s*([A-Za-z0-9\/]{1,6}(?:\s*[-,]\s*[A-Za-z0-9\/]{1,6})*)\s*\))?/g;
  var NUM_SIZE_LINE_RE = new RegExp('^(?:(?:finished\\s+)?(?:sizes?|to\\s+fit|chest|bust|foot\\s+circumference|circumference)\\b[^\\d]{0,30})?(' + NUM_SRC + ')\\s*("|in\\b|cm\\b)?\\s*\\(\\s*(' + LIST_INNER + ')\\s*\\)\\s*("|in\\b|inches|cm\\b|yrs?\\b|years?\\b|months?\\b)?', 'i');

  function sizeName(t) { return String(t).toUpperCase().replace(/\s+/g, ''); }

  function knitDetectSizes(text, base) {
    if (text == null) return null;
    var s = E.normUnicode(String(text));
    var lines = s.split(/\r\n|\r|\n/);
    var best = null;
    // (a) "written for XS/S (M-L-XL-2/3XL-4/5XL)" anywhere, across a wrap
    var flat = lines.map(function (l) { return l.trim(); }).join(' ').replace(/-\s+/g, '-');
    var m;
    SIZE_PAREN_G.lastIndex = 0;
    while ((m = SIZE_PAREN_G.exec(flat)) !== null) {
      var toks = [m[1]];
      [m[2], m[3]].forEach(function (g) { if (g) g.split(/\s*[-,]\s*/).forEach(function (x) { toks.push(x); }); });
      if (toks.length < 2) continue;
      var ok = toks.every(function (x) { return SIZE_TOK_RE.test(x) && /[a-z]/i.test(x); });
      if (!ok) continue;
      if (!best || toks.length > best.length) best = toks.map(sizeName);
    }
    // (b) the engine's own forms ("Sizes S M L", "S (M, L)")
    var b = base(text);
    if (b && (!best || b.length > best.length)) best = b;
    // (c) a numeric size line: "34 (38, 42, 46)", "FINISHED SIZE 7 (8½, 9½)"
    //     foot circumference" - the measurement is the size's name. The
    //     longest list wins ("About 6 1/2 (7 1/2, 8, 9, 9 3/4)"" over a stray
    //     "S (M)" in the prose); letters win a tie.
    var numeric = numericSizes(lines);
    if (numeric && (!best || numeric.length > best.length)) best = numeric;
    // (c2) "(2) 4 (6) 8 (10) 12 yrs" / "(S) M (L) XL (XXL)" - every other size in
    //      brackets (Sandnes): the first such line is the document's (a second
    //      one is another size group's)
    for (var al = 0; al < lines.length; al++) {
      var alt = E.trimLine(lines[al]);
      if (!ALT_SIZE_LINE_RE.test(alt)) continue;
      var unitA = /\b(yrs?|years?|months?|mths?)\s*$/i.exec(alt);
      var toks = alt.replace(/\b(?:yrs?|years?|months?|mths?|cm)\s*$|"\s*$/i, '').match(/[A-Za-z0-9½]+/g) || [];
      if (toks.length >= 2) { best = toks.map(function (x) { return unitA ? x + ' ' + unitA[1].toLowerCase().replace(/^years?$/, 'yrs').replace(/^yr$/, 'yrs') : sizeName(x); }); }
      break;
    }
    // (d) sizes named by their stitch count: "Magic Loop 36 (40, 48) Stitch
    //     Adult Socks" -> 36 st, 40 st, 48 st
    var stm = /\b(\d{2,3})\s*\(\s*(\d{2,3}(?:\s*,\s*\d{2,3})+)\s*\)\s*(?:stitch|st)\b/i.exec(flat);
    if (stm && !best) best = [stm[1]].concat(stm[2].split(/\s*,\s*/)).map(function (v) { return v + ' st'; });
    return best;
  }

  function numericSizes(lines) {
    for (var i = 0; i < lines.length; i++) {
      var t = E.trimLine(lines[i]);
      var nm = NUM_SIZE_LINE_RE.exec(t);
      if (!nm) continue;
      var labelled = /^(?:(?:finished\s+)?sizes?|to\s+fit|chest|bust|foot|circumference)\b/i.test(t);
      var whole = nm[0].length >= t.replace(/[.:]\s*$/, '').length - 1;
      if (!labelled && !whole) continue;
      var unit = nm[2] || nm[4] || '';
      unit = /cm/i.test(unit) ? ' cm' : /^(?:yr|year)/i.test(unit) ? ' yrs' : /^month/i.test(unit) ? ' months' : (unit ? '"' : '');
      var vals = [nm[1]].concat(nm[3].split(/\s*[,\-]\s*/));
      if (vals.length < 2) continue;
      return vals.map(function (v) { return v.replace(/\s+/g, ' ').trim() + unit; });
    }
    return null;
  }

  /** The line a part carries its sizes on: "Sizes: XS/S, M, L" / "Sizes: 7 (8½, 9½)"". */
  function sizeLine(sz) {
    var m = /^([\d\s.,\/½¼¾]+?)\s*("| cm)?$/.exec(sz[0]);
    if (m && sz.every(function (x) { return /^[\d\s.,\/½¼¾]+(?:"| cm)?$/.test(x); })) {
      var unit = m[2] ? m[2].trim() : '';
      var vals = sz.map(function (x) { return x.replace(/"| cm$/, '').trim(); });
      return 'Sizes: ' + vals[0] + ' (' + vals.slice(1).join(', ') + ')' + (unit === 'cm' ? ' cm' : unit);
    }
    return 'Sizes: ' + sz.join(', ');
  }


  // --- fewer numbers than sizes (wave H polish) -------------------------------
  //
  // Flying Trapeze has six finished sizes (5 (6, 7, 8, 9, 10)" foot) but prints
  // two numbers in every instruction: "the first number is for sizes toddler,
  // woman's small, and man's small (worked over 60 sts); the second number, in
  // parentheses, is for sizes child's, woman's medium, and man's medium". A
  // pattern may also say "sizes S/M (L/XL)" over four sizes. When the pattern
  // states the grouping, a list of that many numbers maps onto the sizes by it;
  // when it does not, such a list stays unread for the size (no count shown).
  // columns: one column index per size, e.g. [0, 1, 0, 1, 0, 1].

  var COL_ORD = ['first', 'second', 'third', 'fourth'];

  function colKey(s) {
    return String(s).toLowerCase().replace(/[’']s\b/g, '').replace(/["”]|\binch(?:es)?\b/g, '')
      .replace(/\bsizes?\b/g, '').replace(/[^a-z0-9\/.½¼¾]+/g, ' ').trim().replace(/s$/, '');
  }

  /** Every name a size goes by: its own ("5\"") and its word in "To fit a toddler (child, woman's small, ...)". */
  function sizeAliases(flat, sizes) {
    var n = sizes.length, al = sizes.map(function (s) { return [colKey(s), normSizeKey(s)]; });
    var W = "[A-Za-z][A-Za-z’' ]{1,30}?";
    var re = new RegExp('(' + W + ')\\s*\\(\\s*(' + W + '(?:\\s*,\\s*' + W + '){' + (n - 2) + '})\\s*\\)', 'g');
    var m;
    while ((m = re.exec(flat)) !== null) {
      var rest = m[2].split(/\s*,\s*/);
      if (rest.length !== n - 1) continue;
      var words = m[1].trim().split(/\s+/);
      var lead = [];
      for (var w = 1; w <= Math.min(3, words.length); w++) lead.push(colKey(words.slice(words.length - w).join(' ')));
      al[0] = al[0].concat(lead);
      for (var k = 0; k < rest.length; k++) al[k + 1].push(colKey(rest[k]));
      break;
    }
    return al;
  }

  function columnsOf(text, sizes) {
    if (!sizes || sizes.length < 3 || text == null) return null;
    var n = sizes.length;
    var flat = E.normUnicode(String(text)).split(/\r\n|\r|\n/).map(function (l) { return l.trim(); }).join(' ');
    var groups = [], m, g;
    // (a) "the first number is for sizes A, B, and C ...; the second number ... is for sizes D, E, F"
    for (g = 0; g < COL_ORD.length; g++) {
      var re = new RegExp('\\b' + COL_ORD[g] + '\\s+(?:number|figure|count)s?\\b[^;.]{0,40}?\\b(?:is|are)\\s+(?:for|given\\s+for)\\s+(?:the\\s+)?(?:sizes?\\s+)?([^;.()]+)', 'i');
      m = re.exec(flat);
      if (!m) break;
      groups.push(m[1].replace(/\s+$/, '').split(/\s*(?:,\s*(?:and\s+)?|\band\b|&)\s*/).filter(function (x) { return x.trim(); }));
    }
    var out = null;
    if (groups.length >= 2 && groups.length < n) {
      var al = sizeAliases(flat, sizes);
      out = [];
      for (g = 0; g < groups.length && out; g++) {
        for (var q = 0; q < groups[g].length; q++) {
          var key = colKey(groups[g][q]), hit = -1;
          for (var s = 0; s < n; s++) if (al[s].indexOf(key) >= 0) { hit = s; break; }
          if (hit < 0 || out[hit] !== undefined) { out = null; break; }
          out[hit] = g;
        }
      }
    }
    // (b) "sizes S/M (L/XL)": the grouping in the size line itself
    if (!out) {
      var keys = sizes.map(normSizeKey);
      var re2 = /\bsizes?\s+([A-Za-z0-9]+(?:\s*\/\s*[A-Za-z0-9]+)+)\s*\(\s*([A-Za-z0-9\/\s,\-]+?)\s*\)/gi;
      while (!out && (m = re2.exec(flat)) !== null) {
        var gs = [m[1]].concat(m[2].split(/\s*[,\-]\s*/));
        if (gs.length < 2 || gs.length >= n) continue;
        var o2 = [];
        var ok2 = gs.every(function (grp, gi) {
          return grp.split(/\s*\/\s*/).every(function (nm) {
            var k = keys.indexOf(normSizeKey(nm));
            if (k < 0 || o2[k] !== undefined) return false;
            o2[k] = gi;
            return true;
          });
        });
        if (ok2) out = o2;
      }
    }
    if (!out) return null;
    for (var z = 0; z < n; z++) if (out[z] === undefined) return null;
    return out;
  }

  /** The columns the current parse was given ([] when none). */
  function curColumns() {
    var o = E && E.run().opts;
    return (o && o.sizeColumns) || null;
  }
  function colCount(cols) { return cols ? Math.max.apply(null, cols) + 1 : 0; }

  /** A list of one number per column, spread to one per size (or the list as it was). */
  function spreadColumns(vals) {
    var cols = curColumns();
    if (!cols || !vals || vals.length !== colCount(cols) || vals.length === cols.length || E.sizeCount() !== cols.length) return vals;
    return cols.map(function (c) { return vals[c]; });
  }

  /** The line a part carries its column grouping on. */
  function columnLine(cols, sizes) {
    var parts = [];
    for (var c = 0; c < colCount(cols); c++) {
      var names = [];
      for (var s = 0; s < cols.length; s++) if (cols[s] === c) names.push(sizes[s]);
      parts.push('the ' + COL_ORD[c] + ' number is for sizes ' + names.join(', '));
    }
    return 'Numbers: ' + parts.join('; ') + '.';
  }

  function normSizeKey(s) {
    return String(s).toLowerCase().replace(/["”]|\binch(?:es)?\b|\bin\b\.?|\s+/g, '').replace(/cm$/, 'cm');
  }

  // "Sizes S (M, L) only:", "Size 7" (18 cm) only:", "Sizes XL, 2/3XL and
  // 4/5XL only:", "All sizes:", "For 2nd, 3rd sizes only" (the engine's)
  var SCOPE_HEAD_RE = /^(?:for\s+(?:the\s+)?)?(all\s+sizes?|sizes?\s+(.{1,80}?)\s+only|size\s+(.{1,40}?)\s+only|((?:\d+(?:st|nd|rd|th)\s*(?:,|and|&)?\s*)+)sizes?(?:\s+only)?)\s*(?::|$)/i;

  // "40 stitch sock only:", "36 and 48 stitch socks only:", "48 stitch only:" -
  // sizes named by their stitch count (magic-loop socks: "36 (40, 48) Stitch")
  // (one way to read a run of numbers - "61 59 57 ..." chart labels must not
  // send the matcher back and forth)
  var SCOPE_ST_RE = /^(\d+(?:\s*(?:,\s*(?:and\s+)?|and\s+|&\s*)\d+)*)\s*(?:stitch(?:es)?|sts?)\s+(?:(?:socks?|sizes?|versions?)\s+)?only\s*(?::|$)/i;

  function stScope(t, names) {
    var m = SCOPE_ST_RE.exec(t);
    if (!m || !names || !names.length) return null;
    var keys = names.map(function (n) { return String(n).replace(/[^0-9.]/g, ''); });
    var out = [];
    var nums = m[1].match(/\d+/g) || [];
    for (var i = 0; i < nums.length; i++) {
      var k = keys.indexOf(nums[i]);
      if (k < 0) return null;
      out.push(k);
    }
    return out.length ? { indices: out, label: t.replace(/[:\s]+$/, '').length <= m[0].replace(/[:\s]+$/, '').length, len: m[0].length } : null;
  }

  // "****Row 7: 40 stitch sock only: Slip 1, ..." / "####Row 9: 48 stitch only:
  // ..." - a row written for some sizes, flagged with stars; one with no scope of
  // its own ("****Row 8: Slip 1, purl 9, ...") goes with the starred row before it
  var STAR_ROW_RE = /^[*#]{2,}\s*((?:rows?|rnds?|rounds?)\s*\d+[^:]{0,12}:)\s*([\s\S]*)$/i;

  function starRow(t) {
    var m = STAR_ROW_RE.exec(String(t || ''));
    if (!m) return null;
    var names = E.sizeNames();
    var rest = m[2], sc = stScope(rest, names) || (SCOPE_HEAD_RE.test(rest) ? knitSizeScope(rest, names, E.baseSizeScope) : null);
    if (sc && sc.len) rest = rest.slice(sc.len).replace(/^\s+/, '');
    return { label: m[1], rest: rest, scope: sc && sc.indices ? sc : null, own: !!sc };
  }

  function knitSizeScope(text, names, base) {
    var t = E.trimLine(String(text == null ? '' : text));
    var stS = stScope(t, names);
    if (stS) return stS;
    var m = SCOPE_HEAD_RE.exec(t);
    if (!m) return base ? base(text, names) : null;
    var label = t.replace(/[:\s]+$/, '').length <= m[0].replace(/[:\s]+$/, '').length;
    if (/^all\s+sizes?$/i.test(m[1])) return { indices: null, label: label, len: m[0].length };
    if (m[4]) {
      var r = base ? base(text, names) : null;
      if (r) r.len = m[0].length;
      return r;
    }
    if (!names || !names.length) return null;
    var list = (m[2] || m[3]).replace(/\(\s*\d+(?:[.,]\d+)?\s*cm\s*\)/gi, '')
      .replace(/[()\[\]]/g, ',').split(/\s*(?:,|\band\b|&)\s*/);
    var keys = names.map(normSizeKey);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var w = list[i].replace(/\.$/, '').trim();
      if (!w) continue;
      var k = keys.indexOf(normSizeKey(w));
      if (k < 0) {
        var word = { 'extra small': 'xs', small: 's', medium: 'm', large: 'l', 'extra large': 'xl' }[w.toLowerCase()];
        k = word ? keys.indexOf(word) : -1;
      }
      if (k < 0) return null;
      out.push(k);
    }
    return out.length ? { indices: out, label: label, len: m[0].length } : null;
  }

  function scopeOf(t) {
    var names = E.sizeNames();
    return knitSizeScope(t, names, E.baseSizeScope);
  }

  /** The line with a "Sizes X only:" / "All sizes:" lead taken off. */
  function stripScope(line) {
    var sc = SCOPE_HEAD_RE.exec(line) || SCOPE_ST_RE.exec(line);
    if (!sc) return null;
    var rest = line.slice(sc[0].length).replace(/^\s+/, '');
    return { rest: rest, at: line.length - rest.length };
  }

  // --- row markers ----------------------------------------------------------
  var ENUM_RE = /^[-*]?\s*(rows?|rnds?|rounds?)\s+(\d+(?:\s*(?:,\s*(?:and|&)?|and|&)\s*\d+){2,}|\d+\s*,\s*(?:and\s+|&\s*)?\d+)\s*(?:\((ws|rs|wrong side|right side)\))?\s*(?::|\.|-|\)|\s|$)/i;
  var ENUM_PAIR_RE = /^[-*]?\s*(rows?|rnds?|rounds?)\s+(\d+)\s*(?:and|&)\s*(\d+)\s*(?:\((ws|rs|wrong side|right side)\))?\s*(?::|\.|-|\))/i;
  var ALT_ROWS_RE = /^[-*]?\s*(?:(?:rows?|rnds?)\s+(\d+)|(\d+)\s*(?:st|nd|rd|th)(?:\s+(?:row|rnd))?)(?:\s*\((?:ws|rs)\))?\s*(?:and|&)\s*(?:all\s+(?:foll(?:owing)?\s+)?(?:ws|rs|wrong[-\s]side|right[-\s]side|even[-\s]numbered|odd[-\s]numbered|foll(?:owing)?|other)|alt(?:ernate)?|every\s+(?:alt(?:ernate)?|other))\s+(?:rows?|rnds?)(?:\s+(?:through|thru|to|until)\s+(?:rows?|rnds?)\s+(\d+))?(?:\s*\((?:ws|rs)\))?\s*(?::|\.|-|\s|$)/i;
  var WORD_ROW_RE = new RegExp('^((?:twenty|thirty|forty)[-\\s]?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth)\\s+(?:row|rnd|round)\\s*(?:\\u2014|--|-|:|\\.)\\s*', 'i');
  var ORD_WORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
    eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
    nineteenth: 19, twentieth: 20, thirtieth: 30, fortieth: 40 };
  function wordOrdinal(w) {
    var s = String(w).toLowerCase().replace(/\s+/g, '-');
    if (ORD_WORDS[s]) return ORD_WORDS[s];
    var m = /^(twenty|thirty|forty)-?(\w+)$/.exec(s);
    if (!m) return null;
    return { twenty: 20, thirty: 30, forty: 40 }[m[1]] + (ORD_WORDS[m[2]] || 0);
  }
  var ORD_ENUM_RE = /^[-*]?\s*(\d+\s*(?:st|nd|rd|th)(?:\s*(?:,\s*(?:and\s+|&\s*)?|and\s+|&\s*)\d+\s*(?:st|nd|rd|th))+)\s+(?:rows?|rnds?|rounds?)\b\s*(?:\(\s*(?:ws|rs|wrong side|right side)\s*\))?\s*(?::|\.|-|\)|\s|$)/i;
  var SHORT_ROW_RE = /^[-*]?\s*short[-\s]?rows?\s+(\d+)(?:\s*(?:-|to)\s*(\d+))?\s*(?:\((?:ws|rs)\))?\s*(?::|\.|-|\s|$)/i;
  var LABEL_ROW_RE = /^([A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*){0,2})\s+((?:rows?|rnds?|rounds?)\s*\d[\s\S]*)$/i;
  var LABEL_BAD_RE = /^(?:rep(?:eat)?|work|cont(?:inue)?|as|same|through|thru|until|of|every|knit|purl|next|and|then|on|in|at|from|after|before|end(?:ing)?|by|for|to|the|this|last|first|with|foll(?:ow(?:ing)?)?|sizes?|all|only|after)\b/i;

  function knitDetectMarker(line, base) {
    var t = String(line == null ? '' : line);
    // "****Row 7: 40 stitch sock only: Slip 1, ..." - the row, its scope taken off
    var star = starRow(t);
    if (star) {
      var sb = base(star.label + ' ' + star.rest);
      return sb || null;
    }
    var sc = stripScope(t);
    if (sc && sc.rest) {
      var inner = knitDetectMarker(sc.rest, base);
      return inner;
    }
    // "rnd 7 (9, 10) more times-56 (68, 76)" is the tail of "rep Inc rnd every
    // other" wrapped onto a new line: a row label is capitalised or followed
    // by its colon
    // ("...inc 3 sts evenly across last" / "row. 76 (80-...) sts." - the end of
    // a sentence, never row 76)
    if (/^\s*(?:rows?|rnds?|rounds?)\.\s/.test(t)) return null;
    // "...Rep 5th and" / "6th rows 4 times more." / "...As 12th and" / "13th
    // rows." - the wrapped tail of a copy, never a row of its own
    if (/^\s*\d+\s*(?:st|nd|rd|th)\s+(?:rows?|rnds?|rounds?)\s+\d+\s+(?:more\s+)?times?\b/i.test(t)) return null;
    if (/^\s*\d+\s*(?:st|nd|rd|th)\s+(?:rows|rnds|rounds)\s*[.,;]?\s*$/i.test(t)) return null;
    if (/^\s*(?:rows?|rnds?|rounds?)\s*\d/.test(t) &&
        !/^\s*(?:rows?|rnds?|rounds?)\s*\d+(?:\s*(?:-|to|and|&)\s*\d+)?\s*(?:\((?:rs|ws)\))?\s*[:.]/i.test(t)) return null;
    var m = SHORT_ROW_RE.exec(t);
    if (m) {
      return { row: int(m[1]), rowEnd: m[2] ? int(m[2]) : int(m[1]), rest: t.slice(m[0].length), bare: false, shortRow: true };
    }
    m = ENUM_RE.exec(t);
    if (m) {
      var nums = m[2].split(/\s*(?:,\s*(?:and|&)?|and|&)\s*/).map(int);
      var sorted = nums.slice().sort(function (a, b) { return a - b; });
      if (sorted.every(function (x, k) { return k === 0 || x > sorted[k - 1]; })) {
        return { row: sorted[0], rowEnd: sorted[sorted.length - 1], rest: t.slice(m[0].length), bare: false,
                 rowList: sorted };
      }
    }
    m = ENUM_PAIR_RE.exec(t);
    if (m && int(m[3]) > int(m[2]) + 1) {
      return { row: int(m[2]), rowEnd: int(m[3]), rest: t.slice(m[0].length), bare: false, rowList: [int(m[2]), int(m[3])] };
    }
    m = ALT_ROWS_RE.exec(t);
    if (m) {
      var r = int(m[1] || m[2]);
      return { row: r, rowEnd: r, rest: t.slice(m[0].length), bare: false, alt: true, altTo: m[3] ? int(m[3]) : null };
    }
    // older books: "First row—knit plain.", "Twenty-first row—slip the 1st, ...",
    // "2d row--", "2, 3, 4. Knit 2, purl 1." (the Handbook's row enumeration)
    m = WORD_ROW_RE.exec(t);
    if (m) {
      var wr = wordOrdinal(m[1]);
      if (wr) return { row: wr, rowEnd: wr, rest: t.slice(m[0].length), bare: false };
    }
    m = /^(\d+)d\s+(?:row|rnd|round)\s*(?:--|—|-|:|\.)\s*/i.exec(t);
    if (m) return { row: int(m[1]), rowEnd: int(m[1]), rest: t.slice(m[0].length), bare: false };
    m = /^(\d+(?:\s*,\s*\d+)+)\.\s+(?=[A-Z])/.exec(t);
    if (m) {
      var en = m[1].split(/\s*,\s*/).map(int);
      if (en.every(function (x, k) { return k === 0 || x > en[k - 1]; })) {
        var econ = en.every(function (x, k) { return k === 0 || x === en[k - 1] + 1; });
        var eo = { row: en[0], rowEnd: en[en.length - 1], rest: t.slice(m[0].length), bare: true };
        if (!econ) eo.rowList = en;
        return eo;
      }
    }
    // "5th and 7th rows: Knit.", "23rd and 25th rows: As 1st row.", "9th, 10th,
    // 11th and 12th ROWS:" - the rows named, not the run between them
    m = ORD_ENUM_RE.exec(t);
    if (m) {
      var on = m[1].match(/\d+/g).map(int);
      var os = on.slice().sort(function (a, b) { return a - b; });
      var inc = os.every(function (x, k) { return k === 0 || x > os[k - 1]; });
      var contig = os.every(function (x, k) { return k === 0 || x === os[k - 1] + 1; });
      if (inc && os.length >= 2) {
        var o = { row: os[0], rowEnd: os[os.length - 1], rest: t.slice(m[0].length), bare: false };
        if (!contig) o.rowList = os;
        return o;
      }
    }
    var b = base(t);
    if (b) return b;
    // "Heel turn Row 1 (RS): ..." - a label naming the part, then the row
    m = LABEL_ROW_RE.exec(t);
    // (a label is a name - "boxes on Row 9 (see Notes)" is the tail of a sentence)
    if (m && !LABEL_BAD_RE.test(m[1]) && m[1].length <= 24 &&
        !/\b(?:on|in|of|at|to|from|for|with|by|and|or|the|a|an|as|see|after|before|until|through|ending|end)\b/i.test(m[1])) {
      var b2 = base(m[2]);
      if (b2) {
        b2.label = E.titleCase(m[1].replace(/-/g, ' ').replace(/\s+/g, ' '));
        return b2;
      }
    }
    return null;
  }

  // "Inc rnd *Knit to m...", "Raglan inc rnd:", "Dec row (RS):", "Eyelet rnd
  // K1, *yo, p2tog..." - a named row is worked where it is printed
  var NAMED_ROW_RE = /^((?:[a-z][a-z-]*\s+){0,2}?(?:inc(?:rease)?\.?|dec(?:rease)?\.?|eyelet|turning|joining|picot|garter|purl|knit|ridge|buttonhole|cable|lace|patt(?:ern)?|rib|shaping|short|foundation)(?:\s+[a-z]+)?)\s+(rows?|rnds?|rounds?)\b\s*(?:\(\s*(rs|ws|right\s+side|wrong\s+side)\s*\))?\s*(?::\s*|\s+(?=[*\[(]|(?:k|p|sl|ssk|m1|yo|knit|purl|work|bo|co|cast|bind|\d)\b|[a-z]+\d))/i;
  var NEXT_N_ROWS_RE = /^(?:then\s+)?((?:bo|bind\s+off|cast\s+off|co|cast\s+on)\s+\d+\s*(?:\(\s*[\d\s,\-]+\))?\s*sts?\b.*?)\s+(?:at\s+)?(?:the\s+)?beg(?:inning)?(?:\s+of)?\s+(?:the\s+)?next\s+(\d+)\s+(?:rows?|rnds?)\b/i;
  // "..., then 16 (16-17-17-18-21) sts beg following 2 rows"
  var THEN_BEG_G = /\bthen\s+\d+\s*(?:\([^)]*\))?\s*sts?\s+(?:at\s+)?(?:the\s+)?beg(?:inning)?(?:\s+of)?\s+(?:the\s+)?(?:next|foll(?:owing)?)\s+(\d+)\s+(?:rows?|rnds?)\b/i;
  // "Armhole shaping: Keeping cont of pat, ..." / "Shape raglans: Keeping
  // continuity of pattern, ..." in front of a shaping instruction
  var SHAPE_LEAD_RE = /^(?:[A-Z][A-Za-z ]{2,30}:\s*)?(?:keeping\s+(?:cont(?:inuity)?\s+of\s+)?(?:the\s+)?(?:patt?(?:ern)?|rib(?:bing)?)(?:\s+(?:as\s+(?:established|set|before)|correct))?\s*,\s*)?/i;
  // "Dec 1 st at neck edge on next 9 rows", "inc 1 st each end of needle on
  // next row": the decreases or increases a row (or N rows) makes at its edges
  var SHAPE_ROWS_RE = /^(dec(?:rease)?|inc(?:rease)?)\s+(\d+|one|two)\s+sts?\s+((?:at\s+)?(?:each|both)\s+ends?|at\s+(?:the\s+)?(?:neck|armhole|raglan|side|front|outer|inner|cent(?:er|re)|shoulder)\s+edges?)(?:\s+of\s+(?:the\s+)?(?:needle|row|rnd|round|work))?(?:\s+(?:on|of|in)\s+(?:the\s+)?next\s+(\d+)\s+(?:rows?|rnds?|rounds?)|\s+(?:on|of|in)\s+(?:the\s+)?next\s+(?:rs\s+|ws\s+)?(?:row|rnd|round))?(?:,?\s*then\s+(?:on\s+)?(?:every\s+)?(?:rs|ws|alt(?:ernate)?|other)\s+rows?\s+(?:only\s+)?(\d+|one|two|three|four|five|six)\s+(?:more\s+)?times?(?:\s+more)?)?\s*\.?\s*(?=$|[.;]|\d+\s*(?:\([^)]*\)\s*)?sts?\b)/i;

  function knitDetectNextRow(line, base) {
    var t = String(line == null ? '' : line);
    var sc = stripScope(t);
    if (sc && sc.rest) return knitDetectNextRow(sc.rest, base);
    // "next row, then every 12th row 4 more times, ..." in lower case is the
    // tail of a wrapped sentence, not a row label
    if (/^next\s+(?:\d+\s+)?(?:rows?|rnds?|rounds?)\b/.test(t) && !/^next\s+(?:\d+\s+)?(?:rows?|rnds?|rounds?)\s*(?:\((?:rs|ws)\))?\s*:/.test(t)) return null;
    if (base) {
      var b = base(t);
      if (b) return b;
    }
    // "Divide for Sleeves and Body: Next rnd: ..." - a step name, then the row
    var nm = /^([A-Z][A-Za-z ,&'-]{2,40}):\s*(next\s+(?:rows?|rnds?|rounds?)\b[\s\S]*)$/i.exec(t);
    if (nm && base) {
      var inner = base(nm[2]);
      if (inner) return { rest: inner.rest, span: inner.span, label: nm[1] };
    }
    var m = NAMED_ROW_RE.exec(t);
    if (m && !/^(?:rep(?:eat)?|work|cont|knit\s+\d)/i.test(t)) {
      return { rest: t.slice(m[0].length), span: 1, named: E.titleCase(m[1]) };
    }
    // "Shape bust: Inc row: (RS) Inc 1 st inside selvedge st each end..." - a
    // step name, then the named row
    var sl = /^([A-Z][A-Za-z ,&'-]{2,30}):\s+(?=\S)/.exec(t);
    if (sl && !/:\s*$/.test(sl[1])) {
      var m3 = NAMED_ROW_RE.exec(t.slice(sl[0].length));
      if (m3 && m3[0].indexOf(':') >= 0 && !/^(?:rep(?:eat)?|work|cont|knit\s+\d)/i.test(m3[1])) {
        return { rest: t.slice(sl[0].length + m3[0].length), span: 1, named: E.titleCase(m3[1]), label: sl[1] };
      }
    }
    // "Armhole shaping: Keeping cont of pat, cast off 4 (7-...) sts beg next 2
    // rows." (Patons): a shaping label and "keeping continuity" ride in front
    var sh = SHAPE_LEAD_RE.exec(t), at = sh ? sh[0].length : 0, u = t.slice(at);
    m = NEXT_N_ROWS_RE.exec(u);
    if (m) {
      // "...beg next 4 rows, then 16 (...) sts beg following 2 rows": 6 rows
      var span = int(m[2]), g = new RegExp(THEN_BEG_G.source, 'gi'), mm;
      while ((mm = g.exec(u)) !== null) span += int(mm[1]);
      return { rest: u, span: Math.min(60, span) || 1 };
    }
    // a pattern written as prose (no row labels): "Change to 6 mm circular ndl,
    // k 1 rnd, while inc 8 sts evenly spaced = 56 sts.", "Knit 24 rounds, 2
    // pearl and 2 plain stitches alternately." (Gutenberg) - so many rounds
    if (E.run().prose) {
      // ("Cast on 128 stitches in black, do 12 rounds of 2 plain, 2 pearl." is
      // the cast-on, with its first rounds said after it)
      var pw = /^(?:[A-Za-z ,']{0,40},\s*)?cast\s+(?:on\s+)?\d+/i.test(t) ? null : PROSE_ROUNDS_RE.exec(t);
      if (pw) {
        var pn = WORDN[pw[2].toLowerCase()] || int(pw[2]);
        if (pn >= 1 && pn <= 400) return { rest: t.slice(pw[1] ? pw[1].length : 0), span: pn };
      }
      // "2 intakes with 6 rounds between each." / "3 " " with 9 rounds between."
      // (Cupples, the ditto marks for "intakes on each side"): N intake rounds,
      // each followed by R plain ones - the intake round itself not counted
      var ik = INTAKE_RE.exec(t);
      if (ik) return { rest: t, span: Math.min(400, int(ik[1]) * (int(ik[2]) + 1)) };
      // German short rows: "k5 sts, turn, sl 1 p-wise with yarn in front ...
      // until 2 loops on right ndl, p9 sts, turn, ..." - one short row for each
      // double stitch made; "Work and turn 2 sts pass previous turning until a
      // total of 3 times at each side" - the rest of them
      var ds = (t.match(/\b2\s+loops?\s+on\s+(?:the\s+)?right\s+(?:ndl|needle)/gi) || []).length;
      if (ds >= 1 && /\bturn\b/i.test(t)) return { rest: t, span: Math.max(ds, (t.match(/\bturn\b/gi) || []).length) };
      var gt = /^work\s+and\s+turn\b[^.]*?\buntil\s+a\s+total\s+of\s+(\d+|one|two|three|four|five|six)\s+times\s+(?:at|on)\s+each\s+side/i.exec(t);
      if (gt) return { rest: t, span: Math.max(1, 2 * (WORDN[gt[1].toLowerCase()] || int(gt[1])) - 2) };
      // "Cont St-st in rnds and inc 1 st at each side of marked sts for raglan
      // (as explained) = 8 sts inc." - the next round
      var rg = /^(?:cont(?:inue)?\b[^.]*?\band\s+)?((?:inc|dec)(?:rease)?\s+(?:for\s+[a-z]+\s+)?\d+\s+sts?\s+(?:at\s+)?(?:each|both)\s+sides?\s+of\s+(?:the\s+|each\s+)?(?:\d+\s+)?marked\s+sts?\b.*)$/i.exec(t);
      if (rg) return { rest: rg[1], span: 1 };
      // the dividing round: "Work 21 sts (= ½ back), transfer 30 sts to spare
      // ndl for sleeve, ..., cast on 4 new underarm sts, work 42 sts ..."
      var dv = /^(?:divide\b[^:]*:\s*)?(work\s+\d+[^.]*?\b(?:transfer|place|slip|put|sl)\s+\d+[^.]*\b(?:spare|holder|waste|scrap)\b.*)$/i.exec(t);
      if (dv) return { rest: dv[1], span: 1 };
    }
    // "Join yarn to rem sts and pat to end of row." / "Join yarn to rem sts. Pat
    // to last 4 sts. K2tog. K2." (the other side of a neck)
    m = /^(?:re)?join\s+(?:the\s+)?yarn\b[^.]*?\band\s+((?:patt?|work|knit|purl|k|p)\b[^.]*?\bto\s+end(?:\s+of\s+(?:the\s+)?(?:row|rnd|round))?\s*\.?)\s*$/i.exec(t) ||
      /^(?:re)?join\s+(?:the\s+)?yarn\s+to\s+(?:the\s+)?(?:rem(?:aining)?|other)\s+sts?\s*[.,;]\s*((?:patt?|work|knit|purl|k\d*|p\d*|ssk|k2tog)\b.*)$/i.exec(t);
    if (m) return { rest: m[1], span: 1 };
    // "Cast off 15 (...) sts beg next and following alt row." - two cast-off
    // rows and the row between them
    if (/^(?:bo|bind\s+off|cast\s+off)\s+\d+\s*(?:\([^)]*\))?\s*sts?\s+(?:at\s+)?(?:the\s+)?beg(?:inning)?(?:\s+of)?\s+(?:the\s+)?next\s+and\s+(?:the\s+)?foll(?:owing)?\s+alt(?:ernate)?\s+(?:row|rnd)s?\b/i.test(u)) return { rest: u, span: 3 };
    // "Dec 1 st at neck edge on next 9 rows."
    m = SHAPE_ROWS_RE.exec(u);
    // (..."then on RS rows only 3 times more": 3 more shaped rows, each with
    // the row between - 8 + 6 rows)
    if (m && m[4]) return { rest: u, span: Math.min(60, int(m[4]) + (m[5] ? 2 * (WORDN[String(m[5]).toLowerCase()] || int(m[5])) : 0)) || 1 };
    // "K2tog at each end of next row." - the row is named at the end
    if (/\b(?:of|on)\s+(?:the\s+)?next\s+(?:rs\s+|ws\s+)?(?:row|rnd|round)\b(?:\s*\((?:rs|ws)\))?\s*\.?\s*$/i.test(u) &&
        /^(?:k|p|ssk|m1|kfb|inc|dec|bo|bind|cast|co|work)/i.test(u) && (at === 0 || /^(?:bo|bind|cast)/i.test(u))) return { rest: u, span: 1 };
    return null;
  }

  var SETUP_RE = /^(?:[a-z]+\s+)?set[-\s]?up(?:\s+(?:rows?|rnds?|rounds?))?\s*(?:\(\s*(?:ws|rs)\s*\))?\s*(?::|\.|-|\s+(?=[A-Z*\[(]|[kp]\d|knit|purl|work|sl\b))/i;
  // "CO 100 sts, pm ...", "With larger circular needle, cast on 36 (38-...) sts.",
  // "Using the Turkish method (see Glossary), CO 24 (28, 32) sts" - the cast-on
  // line is the piece's foundation, whatever follows it on the line
  // ("With the knitting-worsted and No. 5 needles, cast on 119 stitches", "Working
  // Back and Fronts at one time cast on 155 sts" - older books)
  var CO_LINE_RE = /^(?:(?:with|using|working|beginning|starting)\b(?:[^.;]|\b[Nn]o\.(?=\s*\d)){0,80}?(?:,\s*|\s+(?=cast\s+on\b))|at\s+beg\s+of\s+[^,]{1,40},\s*)?(?:co|cast\s+on)\s+(?:loosely\s+|provisionally\s+)?\d+(?:\s*\([^)]*\))?\s*(?:sts?|stitches)\b/i;
  // "With RS facing and smaller circular needle, pick up and knit 36 (...) sts
  // along back neck edge." / "Slip 44 (46-...) sts from scrap yarn onto larger
  // double-pointed needles." - a part that starts from stitches picked up or
  // put back on the needle
  var PICKUP_LINE_RE = /^(?:beg(?:in(?:ning)?)?\s+at\b[^.;]{0,60}?,\s*)?(?:(?:with|using)\b[^.;]{0,80}?(?:,\s*|\s+(?=pick\s+up\b)))?(?:pick\s+up(?:\s+(?:and|&)\s+(?:knit|k))?|pu)\s+(?:\([^)]*\)\s*)?\d+/i;
  var FROM_HOLDER_LINE_RE = /^(?:(?:with|using)\b[^.;]{0,60}?(?:,\s*|\s+(?=(?:slip|sl|place|transfer|move|return)\s)))?(?:slip|sl|place|transfer|move|return)\s+(?:the\s+)?(?:held\s+|\d+\s*(?:\([^)]*\))?\s*(?:[a-z]+\s+)?|[a-z]+\s+)?sts?\s+(?:from|off)\s+(?:the\s+)?(?:scrap|waste|holder|spare|st\s+holder|stitch\s+holder)/i;

  function knitDetectSetup(line, base) {
    var t = String(line == null ? '' : line);
    var sc = stripScope(t);
    if (sc && sc.rest) return knitDetectSetup(sc.rest, base);
    // "**With smaller needles, cast on 130 (...) sts." - the "**" a later "Work
    // from ** to ** as given for Back" points at (Patons) is not part of it
    var mk = /^\*{2,}(?=[A-Za-z])/.exec(t);
    if (mk) {
      var inner = knitDetectSetup(t.slice(mk[0].length), base);
      return inner ? { rest: inner.rest } : null;
    }
    // "BACK AND FRONT" / "= (92) 100 (108) 112 (120) 124 sts." (Sandnes): what a
    // part starts with, stated
    if (/^=\s*\d+(?:\s*\([^)]*\))?\s*(?:sts?|stitches)\b[^.]*\.?\s*$/i.test(t)) return { rest: t };
    // "**With smaller needles, cast on" / "130 (138-...) sts." - the number on
    // the next printed line
    if (/^(?:(?:with|using)\b[^.;]{0,80}?,?\s*)(?:cast(?:\s+on)?|co)\s*$/i.test(t)) return { rest: t };
    // older books: "Cast 18 stitches on each of 3 needles.", "Cast on 23 on the
    // first pin, 22 on the second, and 20 on the third.", "Cast on 80 stitches."
    if (/^(?:[A-Za-z ,']{0,40},\s*)?cast\s+(?:on\s+)?\d+\s+(?:stitches|sts|on\s+the\s+first)\b/i.test(t)) return { rest: t };
    // "**With smaller needles, cast on 73" / "(77-85-93-105-117) sts." - the size
    // list broke after its first number
    if (/^(?:(?:with|using)\b[^.;]{0,80}?(?:,\s*|\s+(?=cast\s+on\b)))?(?:cast\s+on|co)\s+\d+\s*$/i.test(t)) return { rest: t };
    var m = SETUP_RE.exec(t);
    if (m) return { rest: t.slice(m[0].length) };
    if (CO_LINE_RE.test(t) || PICKUP_LINE_RE.test(t) || FROM_HOLDER_LINE_RE.test(t)) return { rest: t };
    // "With working yarn and RS facing, pick up and" / "knit (see Glossary) 1 st..."
    if (/^(?:(?:with|using)\b[^.;]{0,80}?,\s*)(?:pick(?:\s+up(?:\s+(?:and|&)(?:\s+knit)?)?)?)\s*$/i.test(t)) return { rest: t };
    return base ? base(t) : null;
  }

  // --- explicit counts --------------------------------------------------------
  var GAUGE_LINE_RE = /\b(?:gauge|tension)\b|\d+\s*(?:sts?|stitches)\s*(?:and|&|x|,)\s*\d+(?:[.,]\d+)?\s*(?:rows?|rnds?|rounds?)\s*(?:=|to|over|in)/i;
  var MATERIAL_RE = /\b(?:needles?|yarn|yds?|yards?|skeins?|balls?|hanks?|notions|finished\s+(?:size|measurements?)|circumference|markers?\s*\(m\)|tapestry|hook)\b/i;
  var INSTR_WORD_RE = /\b(?:cast\s+on|co|bind\s+off|bo|knit|purl|k\d+|p\d+|pick\s+up|work|rep|pm|rnds?\b|rows?\b|join)\b/i;
  // the first total after a dash: "—80 (90, 100) sts total; 28 (32, 36) sts
  // for instep..." / "- 56 sts rem." / "—50 (62, 74) sts rem: 32 instep sts..."
  var DASH_TOTAL_RE = new RegExp('(?:^|\\s|[a-z0-9.,;)])[-=]\\s*(\\d+)(\\s*\\(\\s*\\d+(?:\\s*[,\\-]\\s*\\d+)*\\s*\\))?\\s*' +
    '(?:(?:heel|instep|sole|gusset|toe|sleeve|body|cuff|leg)\\s+)?(?:sts?|stitches)\\b' +
    '(?!\\s+(?:inc|dec)(?:reased|\'d|d)?\\b|\\s+(?:on\\s+)?each\\b|\\s+(?:in|between|of|worked|unworked|left|st|rows?|rnds?)\\b|\\s+on\\s+(?:needles?|n)\\s*\\d|\\s+on\\s+needle\\s*$)(?:\\s+(?:rem(?:ain(?:ing)?)?|total|on\\s+(?:the\\s+)?needles?))?', 'i');
  var REM_TOTAL_RE = new RegExp('(?:^|[.;:,(]\\s*|\\s)(\\d+)(\\s*\\(\\s*\\d+(?:\\s*[,\\-]\\s*\\d+)*\\s*\\))?\\s*(?:sts?|stitches)\\s+(?:rem(?:ain(?:ing)?)?|on\\s+(?:the\\s+)?needles?)\\b[\\s.;:]*', 'i');
  var NOW_TOTAL_RE = /\b(?:there\s+(?:are|will\s+be)\s+(?:now\s+)?|you\s+(?:will\s+)?(?:now\s+)?have\s+)(\d+)(\s*\(\s*\d+(?:\s*[,\-]\s*\d+)*\s*\))?\s*(?:sts?|stitches)\b/i;
  var BARE_TOTAL_RE = /(?:^|[.;:]\s*|[a-z]\s+)\(\s*(\d+(?:\s*-\s*\d+)+)\s*\)\s*(?:sts?|stitches)\b\s*[.;]?\s*$/i;
  // "CO 36 (40) sts", "on these 120 (128-140-156-176-200) sts": a size list
  // with a unit, the last one on the line (a one-number bracket is a size
  // list here, never the engine's "(40)" total)
  // ...only where a total stands: at the end of a clause, or "sts rem /
  // total / on needle / until" - never "16 (18, 20) sts along edge of heel flap"
  var UNIT_LIST_G = /(\d+)\s*\(\s*(\d+(?:\s*[,\-]\s*\d+)*)\s*\)\s*(?:sts?|stitches)\b(?=\s*(?:[.;:)\]]|$)|\s+(?:rem(?:ain(?:ing)?)?|total|in\s+all|on\s+(?:the\s+)?needles?|until|and\s+(?:join|place|pm)))/gi;

  function sizesOf(first, rest) {
    var out = [int(first)];
    if (rest) rest.replace(/[()]/g, '').split(/\s*[,\-]\s*/).forEach(function (x) { if (x.trim()) out.push(int(x)); });
    return out;
  }

  // An in-segment size list ("k17 (19)", "work 20 (22, 24) sts, pm") is
  // masked before the engine looks for the row's total, so its bracket never
  // reads as one. Same length, so every index the engine returns still fits.
  var IN_SEG_G = /((?:\b(?:k|p|sl|slip|place|transfer|knit|purl|work|next|last|first|rem(?:aining)?|over|across|rib|patt?|pu|pick\s+up(?:\s+and\s+knit)?|co|bo|cast\s+on|bind\s+off|rep(?:eat)?|further|another|every)\s*|[a-z]))(\d+(?:[.,]\d+)?)(\s*)\((\s*\d+(?:[.,]\d+)?(?:\s*[,\-]\s*\d+(?:[.,]\d+)?)*\s*)\)/gi;

  function maskInSegment(line) {
    return line.replace(IN_SEG_G, function (all, lead, n, sp, inner, off, whole) {
      var after = whole.slice(off + all.length);
      // a cast on / bind off total at the very end stays a total
      if (/\b(?:co|cast\s+on)\s*$/i.test(lead) && /^\s*(?:sts?|stitches)\b\s*(?:[.;]|$)/i.test(after)) return all;
      return lead + n + sp + '{' + inner + '}';
    });
  }

  function maskDelta(line) {
    return line.replace(new RegExp(DELTA_TAIL_RE.source, 'gi'), function (all) { return all.replace(/\d/g, '#').replace(/[()]/g, ' '); });
  }

  function knitFindExplicit(line, base) {
    // ("Work 1st row of Panel Pat C" - an ordinal is never a total)
    var t = fixNested(String(line == null ? '' : line)).replace(/\b\d+(?=(?:st|nd|rd|th)\b)/gi, function (d) { return d.replace(/\d/g, '#'); })
      // ("133 (137-" / "143-143-147-147) sts" joined over its wrap: "137- 143" is
      // one list - the space goes to the end so every index still holds)
      .replace(/(\d)-(\s+)(\d+)/g, function (a, x, sp, y) { return x + '-' + y + sp; })
      // ("...136 (140-150-156-166-176) sts.**" - the closing marks of a "Work
      // from ** to **" block)
      .replace(/(\S)(\*{2,3})\s*$/, function (a, x, st) { return x + st.replace(/\*/g, ' '); });
    if (!t.trim()) return null;
    // older books state the count in words: "there ought to be 69 stitches on",
    // "you ought now to have 50 stitches", "reduces the stocking to 69", "There
    // are 28 (32, 36) 32 (36, 38) sts on needle."
    var od = /\b(?:there\s+(?:ought|should)\s+(?:now\s+)?to\s+be|(?:you\s+)?(?:ought|should)\s+(?:now\s+)?(?:to\s+)?have(?:\s+only)?|reduces?\s+(?:it|the\s+[a-z]+)\s+to|making\s+it)\s+(\d+)(\s*\(\s*\d+(?:\s*[,\-]\s*\d+)*\s*\))?\s*(?:stitches|sts)?\b/i.exec(t) ||
      // "reduce until you have 56 for the foot", "decrease over the instep until
      // you have 90 stitches" - shaping to a stated count
      /\b(?:reduc\w*|decreas\w*|increas\w*|narrow\w*|widen\w*|dec|inc)\b[^.]*?\buntil\s+(?:you\s+have|there\s+(?:are|is))\s+(?:only\s+|but\s+)?(\d+)(\s*\(\s*\d+(?:\s*[,\-]\s*\d+)*\s*\))?/i.exec(t);
    if (od) return { sizes: sizesOf(od[1], od[2]), start: t.indexOf(od[1], od.index), end: t.length };
    // "Cast on 23 on the first pin, 22 on the second, and 20 on the third.",
    // "Cast on 24 stitches on each of 2 needles, and 20 on the 3d.", "Cast 18
    // stitches on each of 3 needles." - the needles' counts added up
    var pn = /^cast\s+(?:on\s+)?(\d+)\s*(?:stitches|sts)?\s+on\s+each\s+of\s+(?:the\s+)?(\d+)\s+(?:needles|pins)(?:,?\s*and\s+(\d+)\s+on\s+the\s+(?:\d+(?:st|nd|rd|th|d)|third|fourth|last|other)\b)?/i.exec(t) ||
      /^cast\s+on\s+(\d+)\s+(?:stitches\s+|sts\s+)?on\s+the\s+first\s+(?:pin|needle),\s*(\d+)\s+on\s+the\s+second(?:,?\s*and\s+(\d+)\s+on\s+the\s+third)?/i.exec(t);
    if (pn) {
      var tot = /each\s+of/i.test(pn[0]) ? int(pn[1]) * int(pn[2]) + (pn[3] ? int(pn[3]) : 0) : int(pn[1]) + int(pn[2]) + (pn[3] ? int(pn[3]) : 0);
      return { sizes: [tot], start: pn[0].length, end: pn[0].length };
    }
    // "Leave rem 44 (46-48-50-54-54) sts on a st holder." - what the piece
    // comes to as it is put away
    var lv = /\b(?:leave|leaving|place|slip|put)\s+(?:the\s+)?rem(?:aining)?\s+(\d+)(\s*\(\s*\d+(?:\s*[,\-]\s*\d+)*\s*\))?\s*(?:sts?|stitches)\s+(?:on|onto)\s+(?:a\s+|the\s+)?(?:spare\s+needle|(?:st(?:itch)?\s+)?holder|scrap|waste)/i.exec(t);
    if (lv) return { sizes: sizesOf(lv[1], lv[2]), start: t.indexOf(lv[1], lv.index), end: t.length };
    // a gauge line or a materials line never states a row's total
    if (GAUGE_LINE_RE.test(t) && !/\b(?:cast\s+on|co\s+\d|pick\s+up)\b/i.test(t)) return null;
    if (MATERIAL_RE.test(t) && !INSTR_WORD_RE.test(t)) return null;
    // "...rep from * once more—4 sts" with "dec'd." on the next printed line:
    // a dash total cut off at the end of the line is not read until the line
    // below says what it is
    if (/[-=—]\s*\d+(?:\s*\([^)]*\))?\s*(?:[a-z]+\s+)?(?:sts?)?\s*$/i.test(t)) return null;
    // "...knit to 1 st" / "p to last 3 sts" at the end of a wrapped line is
    // where to knit to, not what the row comes to
    if (/\b(?:to|until|last|before|first|next|over|rem(?:aining)?|leaving|about)\s+\d+(?:\s*\([^)]*\))?\s*(?:[a-z]+\s+)?sts?\b[\s.,;]*$/i.test(t) &&
        !/[-=—(]\s*\d+(?:\s*\([^)]*\))?\s*(?:[a-z]+\s+)?sts?\b[^-=—(]*$/i.test(t)) return null;
    // a cast-on line's total is what it casts on: "CO 24 (28, 32) sts—12 (14,
    // 16) sts on each needle. Place marker (pm) and join in the rnd."
    var co = /^((?:(?:with|using|working|beginning|starting)\b(?:[^.;]|\b[Nn]o\.(?=\s*\d)){0,80}?(?:,\s*|\s+(?=cast\s+on\b))|at\s+beg\s+of\s+[^,]{1,40},\s*)?(?:co|cast\s+on)\s+(?:loosely\s+|provisionally\s+)?)(\d+)(\s*\(\s*\d+(?:\s*[,\-]\s*\d+)*\s*\))?\s*(?:sts?|stitches)\b/i.exec(t);
    // (...unless the same sentence works stitches - "and knit 48 ribs, or 96
    // rows" is a stretch of rows, not a stitch)
    if (co && !/\b(?:k\d|p\d|k2tog|ssk)\b|\b(?:knit|purl|work)\b(?!\s+\d+\s+(?:ribs?|rows?|rounds?|rnds?|plain)\b)/i.test(t.slice(co[0].length).split(/\.(?!\d)/)[0])) {
      return { sizes: sizesOf(co[2], co[3]), start: co[0].length, end: co[0].length };
    }
    var m = DASH_TOTAL_RE.exec(t);
    if (m) {
      var at = t.indexOf(m[1], m.index);
      var dash = t.slice(m.index, at).search(/[-=]/);
      var sz = sizesOf(m[1], m[2]);
      // "—32 (34, 38) instep sts, 24 (34, 38) sole sts.": the parts of one total
      var more = /^\s*(?:,|and)\s*(\d+)(\s*\(\s*\d+(?:\s*[,\-]\s*\d+)*\s*\))?\s*(?:heel|instep|sole|gusset)\s+sts?\b/i
        .exec(t.slice(m.index + m[0].length));
      if (more && /(?:heel|instep|sole|gusset)\s+sts?/i.test(m[0])) {
        var sz2 = sizesOf(more[1], more[2]);
        if (sz2.length === sz.length) sz = sz.map(function (v, k) { return v + sz2[k]; });
        else sz = [null];
      }
      if (sz[0] === null) return null;
      return { sizes: sz, start: dash >= 0 ? m.index + dash : at, end: t.length };
    }
    // "...on each side to 18 (20, 24) for a total of 36 (40, 48) stitches" /
    // "You have 24 (27, 31) stitches on each needle point...a total of 48 (54,
    // 62) stitches in all": the total is the count, not the per-side number
    m = /\ba\s+total\s+of\s+(\d+)(\s*\(\s*\d+(?:\s*[,\-]\s*\d+)*\s*\))?\s*(?:sts?|stitches)\b/i.exec(t);
    if (m) return { sizes: sizesOf(m[1], m[2]), start: t.indexOf(m[1], m.index), end: t.length };
    m = NOW_TOTAL_RE.exec(t);
    if (m) return { sizes: sizesOf(m[1], m[2]), start: m.index, end: t.length };
    // "...rep from * until 3 sts rem, k3" is where the repeat stops, not a total
    var remG = new RegExp(REM_TOTAL_RE.source, 'gi');
    while ((m = remG.exec(t)) !== null) {
      var at2 = t.indexOf(m[1], m.index);
      if (/\b(?:until|till|to|last|leaving|when|with|have|are|is)\s*$/i.test(t.slice(0, at2))) continue;
      return { sizes: sizesOf(m[1], m[2]), start: at2, end: t.length };
    }
    m = BARE_TOTAL_RE.exec(t);
    if (m) {
      var at3 = t.indexOf('(', m.index);
      return { sizes: m[1].split(/\s*-\s*/).map(int), start: at3, end: t.length, bare: true };
    }
    // "...until there are 133 (137-143-143-147-147) sts, taking inc sts into..."
    var ut = /\buntil\s+there\s+(?:are|is)\s+(\d+)(\s*\(\s*\d+(?:\s*[,\-]\s*\d+)*\s*\))?\s*(?:sts?|stitches)\b/i.exec(t);
    if (ut) return { sizes: sizesOf(ut[1], ut[2]), start: t.indexOf(ut[1], ut.index), end: t.length };
    var masked = maskDelta(maskInSegment(t));
    UNIT_LIST_G.lastIndex = 0;
    var u, lastU = null;
    while ((u = UNIT_LIST_G.exec(masked)) !== null) lastU = u;
    // "(Dividing rnd). Slip first 56 (...) sts onto length of spare yarn. ...
    // Cast on 6 (6-8-16-20-26) sts." - the underarm cast-on inside a round
    // that put stitches aside is no total of the round (its own comes later)
    if (lastU && /\b(?:co|cast\s+on)\s*$/i.test(masked.slice(0, lastU.index)) &&
        /\b(?:spare|scrap|waste)\s+yarn\b|\bholders?\b/i.test(masked.slice(0, lastU.index))) return null;
    if (lastU) return { sizes: sizesOf(lastU[1], lastU[2]), start: lastU.index, end: lastU.index + lastU[0].length };

    var r = base(masked);
    if (!r) return null;
    // "...leaving (2) stitches unworked" is what is left on the needle, never
    // the row's total
    if (/\b(?:leaving|leave|until|to|last|before|first|next|over|with)\s*(?:\d+\s*)?\(?\s*$/i.test(masked.slice(Math.max(0, r.start - 24), r.start)) ||
        /^\s*\(?\s*\d+\s*\)?\s*(?:sts?|stitches)\s+(?:unworked|on\s+each|each\s+side|left\s+unworked)/i.test(masked.slice(r.start))) return null;
    // the engine's mid-line "N (n, n) sts" ("then 16 (18, 20) sts along edge of
    // heel flap") is a position in knitting; the real totals are read above
    if (r.sizes.length > 1) return null;
    // "[work wrap tog with wrapped st] 6 (7, 8)" at the end of a wrapped line:
    // a knitting total says "sts"; a bare size list is a count of something else
    if (r.sizes.length > 1 && !/\b(?:sts?|stitches)\b/i.test(masked.slice(r.start, r.end))) return null;
    return r;
  }

  // --- repeats -----------------------------------------------------------------
  function knitDetectRepeat(t, size, base) {
    var line = String(t == null ? '' : t);
    var sc = stripScope(line);
    if (sc && sc.rest) line = sc.rest;
    // (a prose pattern's "Knit 24 rounds, ..." is so many rounds - see
    // knitDetectNextRow - not the last row again; nor are its short rows)
    if (E.run().prose && (PROSE_ROUNDS_RE.test(line) || /\b2\s+loops?\s+on\s+(?:the\s+)?right\b/i.test(line) || /^work\s+and\s+turn\b/i.test(line))) return null;
    // "Rep inc on alt rnds a total of 11 (...) times = 144 (...) sts." (Sandnes):
    // the increase round and the plain round before it, so many times in all
    var ra = /^rep(?:eat)?\s+(?:the\s+)?(?:inc|dec)(?:rease)?s?\s+(?:rnds?\s+|rows?\s+)?(?:on\s+)?(?:every\s+)?(?:alt(?:ernate)?|other)\s+(?:rnds?|rows?|rounds?)\s+(?:a\s+total\s+of\s+)?(\d+(?:\s*\([^)]*\))?)\s+times\b/i.exec(line);
    if (ra) {
      var rav = resolveSizes(ra[1], { size: size, count: E.sizeCount(), scope: E.run().scope || null });
      var ran = rav.bad ? null : int(rav.text);
      return { startRow: null, endRow: null, times: ran, untilRows: null, untilLength: null, lastCount: 2, more: true, every: 2 };
    }
    // "Rep inc every 3½ (...) cm until 24 (...) sts rem." - shaping by length
    if (/^rep(?:eat)?\s+(?:the\s+)?(?:inc|dec)(?:rease)?s?\s+every\s+[\d½¼¾.,]+/i.test(line)) {
      return { startRow: null, endRow: null, times: null, untilRows: null, untilLength: null, lastCount: null, more: false };
    }
    // "2nd row of Panel Pat C. K2.* P3." - the wrapped tail of "...Work" naming a
    // panel's row, never a repeat of this part's row 2
    if (/^\d+(?:st|nd|rd|th)\s+(?:row|rnd|round)\s+(?:of\s+)?(?:the\s+)?(?:[a-z]+\s+){0,3}?(?:panel|pat|patt|pattern|chart)\b/i.test(line)) return null;
    var run = E.run();
    var scope = run.scope || null;
    var ctx = { size: size, count: E.sizeCount(), scope: scope };
    var rs = resolveSizes(line.replace(/\(s\)/g, 's'), ctx);
    var x = rs.text
      // "eleven more times", "twenty-nine more times" (the engine reads to ten)
      .replace(/\b(?:(twenty|thirty|forty)[-\s]?)?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)?\b(?=\s+(?:more\s+)?times?\b)/gi,
        function (all, tens, ones) {
          if (!tens && !ones) return all;
          var T = { twenty: 20, thirty: 30, forty: 40 };
          var O = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
            twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
          return String((tens ? T[tens.toLowerCase()] : 0) + (ones ? O[ones.toLowerCase()] : 0));
        })
      .replace(/\bshort[-\s]rows?\b/gi, 'rows')
      .replace(/^(?:then\s+)?(?:knit|purl|work)\s+(\d+)\s+(?:more\s+)?(?:rnds?|rounds?|rows?)\s*(?:even|in\s+(?:patt?(?:ern)?|st\s*st|rib))?\b/i,
        function (all, n) { return 'work ' + n + ' rows even'; })
      // "Proceed in Box St Pat as given for Front for 8 rows." (Patons)
      .replace(/^(?:then\s+)?proceed\s+in\s+[^.;]{1,60}?\s+for\s+(\d+)\s+(?:more\s+)?(?:rnds?|rounds?|rows?)\b/i,
        function (all, n) { return 'work ' + n + ' rows even'; });
    // "Cont in St st, rep Inc rnd every other rnd 7 (9, 10) more times", "rep
    // Dec row every RS row 8 more times", "Rep Inc rnd every rnd 1 more time":
    // the named row and the plain rows between, as a block of the last N rows
    var ev = /\brep(?:eat)?\s+(?:the\s+)?(?:[a-z.-]+\s+){1,3}?(?:rnd|row|round)\s+(?:on\s+)?every\s+(?:(other|alt(?:ernate)?|rs|ws|right[-\s]side|wrong[-\s]side)(?:\s+|\s*$)|(\d+)(?:st|nd|rd|th)?\s+)?(?:(?:rnd|row|round)s?\b|$)/i.exec(x);
    if (ev) {
      var interval = ev[2] ? int(ev[2]) : (ev[1] ? 2 : 1);
      var tm = /^\s*,?\s*(\d+)\s+(?:more\s+)?times?(?:\s+more)?\b/i.exec(x.slice(ev.index + ev[0].length));
      if (interval >= 1 && interval <= 12) {
        return { startRow: null, endRow: null,
          // the named row is already written: "7 more times" (or "7 times") is 8 workings
          times: tm ? int(tm[1]) + 1 : null, untilRows: null, untilLength: null,
          lastCount: interval, more: true, every: interval };
      }
    }
    var r = base(x, size);
    // "Work even through Row 11 of Foot chart" is a chart row, not the part's
    if (r && r.untilRows !== null && /\b(?:row|rnd|round)\s+\d+\s+of\s+(?:the\s+)?[A-Za-z0-9 ,"']{0,30}?chart\b/i.test(x)) {
      r.untilRows = null;
      if (r.through) { r.through = false; }
    }
    // "Cont even in rnds on 204 sts", "Knit even in rnds until ...": keep
    // working the round just worked, open-ended
    if (!r && (/^(?:then\s+)?(?:cont(?:inue)?|work|knit|purl)(?:\s+working)?\s+even\b/i.test(x) ||
               // ("Cont in pat, keeping cont of Panel Pats and (K3. P2) ribbing
               // ..., until ..." - a stop inside brackets is not the sentence's)
               /^(?:then\s+)?(?:cont(?:inue)?|work)\b(?:[^.;()]|\([^()]*\))*\buntil\b/i.test(x) ||
               // "Pat for 4" [10 cm], ending on a 2nd row ..." / "Rib for 2"" (Patons)
               /^(?:then\s+)?(?:patt?|pattern|rib)\s+for\s+(?:about\s+|approx(?:imately|\.)?\s+)?\d/i.test(x) ||
               // "Dec 1 st at neck edge on next 4 rows, AT SAME TIME, dec 1 st at
               // raglan edge on every following alt row until 4 sts rem." - rows
               // the pattern does not number, up to a stitch count
               /^(?:then\s+)?(?:dec|inc)(?:rease)?\s+(?:\d+|one|two)\s+sts?\b[^.]*\buntil\s+(?:there\s+are\s+)?\d+\s*(?:\([^)]*\)\s*)?sts?\b/i.test(x) ||
               // "Inc 1 st each end of needle on next and following 6th rows
               // twice more, taking inc sts into pat. 57 (...) sts." - shaping
               // over rows the pattern does not number
               /^(?:then\s+)?(?:dec|inc)(?:rease)?\s+(?:\d+|one|two)\s+sts?\b[^.]*\b(?:every|foll(?:owing)?)\s+(?:\d+\s*(?:st|nd|rd|th)|other|alt(?:ernate)?|rs|ws)\b[^.]*\b(?:rows?|rnds?|rounds?)\b/i.test(x))) {
      var ul = untilOf(x, size);
      // "Work as for back until piece measures 9"..." / "Cont in patt, dec 1 st
      // each end every RS row, until ..." is not the last row over and over:
      // its rows carry no count of their own (QA: Henley showed 83 on 140 rows)
      var sameRow = /\beven\b/i.test(x) || !(/\bas\s+for\b/i.test(x) || /\b(?:dec|inc)(?:reas(?:e|ing))?s?\b|\bk2tog\b|\bssk\b|\bm1\b|\bshap/i.test(x));
      r = { startRow: null, endRow: null, times: null, untilRows: null,
        untilLength: ul && ul.kind === 'length' && ul.value !== null ? { value: ul.value, unit: ul.unit } : null,
        lastCount: sameRow ? 1 : null, more: false };
    }
    if (!r) return null;
    if (rs.bad && (r.times !== null || r.untilRows !== null)) {
      r.times = null; r.untilRows = null; r.unresolved = true;
    }
    // "a further 9 times" / "another 9 times": that many MORE
    var fm = /\b(?:a\s+further|another)\s+(\d+)\s+times?\b/i.exec(x);
    if (fm && !r.more) { r.times = int(fm[1]) + 1; r.more = true; }
    // "8 (8-2-0-12-10) times more" for a size that does it 0 more times
    var zm = /\b0\s+(?:more\s+)?times?(?:\s+more)?\b/i.exec(x);
    if (zm && r.times === null) { r.times = 1; r.more = true; }
    // a length is the knitter's to measure, never a row target by itself
    if (r.untilLength) r.untilRows = r.untilRows || null;
    return r;
  }

  // --- until -------------------------------------------------------------------
  // ("patt1 in every rs row" - "in" before a word that is not a length's is
  // the preposition, not inches)
  var LEN_UNIT = '(?:"|\'\'|inch(?:es)?\\b|in\\b\\.?(?!\\s+(?:every|each|the|a|an|next|this|that|rs|ws|patt?(?:ern)?|rib(?:bing)?|st|sts|stocking|garter|row|rows|rnd|rnds|round|rounds|place|front|back|which|its|work)\\b)|cm\\b|mm\\b)';
  // (inside the brackets a typo'd space may stand for a hyphen: "11 (11-11½-12-12
  // 12½)"" - Patons boxy)
  var LEN_INNER = '(?:' + NUM_SRC + ')(?:\\s*[,\\-]\\s*(?:' + NUM_SRC + ')|\\s+(?=\\d)(?:' + NUM_SRC + '))*';
  var LEN_LIST_RE = new RegExp('(' + NUM_SRC + ')\\s*(?:\\(\\s*(' + LEN_INNER + ')\\s*\\)|\\[\\s*(' + LEN_INNER + ')\\s*\\])?\\s*(' + LEN_UNIT + ')', 'i');
  // (...and "Work 2" [5 cm] in (K2. P2) ribbing", "Beg and ending on a 2nd row
  // work 3½" [9 cm] in ribbing" - Patons: a length of rows with no "until")
  var UNTIL_LEAD_RE = /\buntil\b([\s\S]*)$|\bfor\s+(?:about\s+|approx(?:imately|\.)?\s+|a\s+further\s+|another\s+)?(?=\d|[½¼¾])([\s\S]*)$|\bwork\s+(?=\d+(?:[.,]\d+)?\s*[½¼¾]?\s*(?:"|''|in\b|inches\b|cm\b))([\s\S]*)$/i;

  function untilOf(text, size) {
    // "7 (8 or 9) inches": "or" between sizes is a comma
    var t = E.normUnicode(String(text || '')).replace(/(\d)\s+or\s+(\d)/g, '$1, $2');
    var lead = UNTIL_LEAD_RE.exec(t);
    if (!lead) {
      // "Knit 5 (5-5-5-3-3) rnds even." - that many rows
      var kr = /^(?:then\s+)?(?:knit|purl|work)\s+(\d+(?:\s*\([^)]*\))?)\s+(?:more\s+)?(rnds?|rounds?|rows?)(?:\(s\))?\s*(?:even|in\s+(?:patt?|st\s*st|rib))/i.exec(t);
      if (kr) {
        var rv = resolveSizes(kr[1], { size: size, count: E.sizeCount(), scope: E.run().scope }).text;
        var nv = int(rv);
        if (nv !== null) return { kind: 'rows', value: nv, unit: /^r(?:nd|ound)/i.test(kr[2]) ? 'rnds' : 'rows', endOn: null };
      }
      return null;
    }
    var seg = (lead[1] !== undefined ? lead[1] : lead[2] !== undefined ? lead[2] : lead[3]) || '';
    var relative = /\b(?:a\s+further|another)\b/i.test(t.slice(Math.max(0, lead.index - 2), lead.index + 20)) ||
      /\bfor\s+a\s+further\b/i.test(t);
    var endOn = null;
    var eo = /\bending\s+(?:with|after|on)\s+(?:a\s+|an\s+)?(rs|ws|right[-\s]side|wrong[-\s]side)\b/i.exec(t);
    if (eo) endOn = /^(?:rs|right)/i.test(eo[1]) ? 'rs' : 'ws';
    // "ending on a 1st row", "ending on a 4th or 8th row of pat", "ending with
    // 16th row of pat": the side of that row, once the lines are known
    var eor = !eo && /\bending\s+(?:with|after|on)\s+(?:a\s+|an\s+|the\s+)?(\d+)(?:st|nd|rd|th)(?:\s+or\s+(\d+)(?:st|nd|rd|th))?\s+(?:row|rnd)\b/i.exec(t);
    // a row count in so many words
    var rr = /^\s*(?:there\s+are\s+|you\s+have\s+(?:worked\s+|completed\s+|knitted\s+|knit\s+)?(?:a\s+total\s+of\s+)?)?(\d+)(\s*\([^)]*\))?\s*(?:total\s+)?(rows?|rnds?|rounds?)\b/i.exec(seg);
    if (rr) {
      var rv2 = resolveSizes(rr[1] + (rr[2] || ''), { size: size, count: E.sizeCount(), scope: E.run().scope });
      var n = rv2.bad ? null : int(rv2.text);
      var ro = { kind: 'rows', value: n, unit: /^r(?:nd|ound)/i.test(rr[3]) ? 'rnds' : 'rows', endOn: endOn };
      if (eor) ro.endOnRow = eor[2] ? [int(eor[1]), int(eor[2])] : [int(eor[1])];
      return ro;
    }
    var m = LEN_LIST_RE.exec(seg);
    if (!m) return null;
    var vals = [fnum(m[1])];
    var list = m[2] || m[3];
    if (list) vals = vals.concat(String(list).split(/\s*[,\-]\s*|\s+(?=\d+(?![\d\/]))/).map(fnum));
    var v = vals.length > 1 ? pickFrom(vals, { size: size, count: E.sizeCount(), scope: E.run().scope }) : vals[0];
    if (v === undefined) v = null;
    var unit = /cm/i.test(m[4]) ? 'cm' : (/mm/i.test(m[4]) ? 'mm' : 'in');
    if (unit === 'mm' && v !== null) { v = v / 10; unit = 'cm'; }
    var out = { kind: 'length', value: v, unit: unit, endOn: endOn };
    if (relative) out.relative = true;
    if (eor) out.endOnRow = eor[2] ? [int(eor[1]), int(eor[2])] : [int(eor[1])];
    return out;
  }

  /**
   * "ending on a 1st row" -> the side that row is worked on: the row of that
   * number printed with a side before this line (in this part first), else the
   * last "1st row: (RS)" before it, by parity. Rows of two numbers ("a 4th or
   * 8th row") must agree. Null when nothing says.
   */
  function sideOfRows(lines, upto, section, nums) {
    var sides = nums.map(function (n) {
      var any = null, first = null;
      for (var i = Math.min(upto, lines.length) - 1; i >= 0; i--) {
        var l = lines[i];
        if (!l || l.kind !== 'row' || !l.side || !(l.row >= 1)) continue;
        var hit = l.rowList ? l.rowList.indexOf(n) >= 0 : (l.row === n && l.rowEnd === n);
        if (hit) {
          if (l.section === section) return l.side;
          if (any === null) any = l.side;
        }
        if (l.row === 1 && l.rowEnd === 1 && first === null) first = (n % 2 === 1) ? l.side : (l.side === 'rs' ? 'ws' : 'rs');
      }
      return any !== null ? any : first;
    });
    if (!sides.length || sides[0] === null) return null;
    for (var k = 1; k < sides.length; k++) if (sides[k] !== sides[0]) return null;
    return sides[0];
  }

  function resolveEndOn(U, lines, upto, section) {
    if (!U || !U.endOnRow) return U;
    var s = sideOfRows(lines || [], upto, section, U.endOnRow);
    delete U.endOnRow;
    if (U.endOn === null && s) U.endOn = s;
    return U;
  }

  // --- side, chart, cable, delta, markers ---------------------------------------
  // "(RS)", "(WS)", "(Wrong side facing)", "(RS, Row 1 of patt)" - never "(dec
  // rnd)", "(turning ridge)", "(dec)": those sit in the same place and are labels
  var SIDE_TAG_RE = /\(\s*(rs|ws|right[-\s]side|wrong[-\s]side)(?:\s+facing)?\s*(?:[,;][^()]*)?\)/i;

  function sideTag(s) {
    var m = SIDE_TAG_RE.exec(s);
    if (!m) return null;
    return /^(?:rs|right)/i.test(m[1]) ? 'rs' : 'ws';
  }

  function lineSide(text, prefixLen, isRound) {
    if (isRound) return null;
    var head = text.slice(0, prefixLen);
    var s = sideTag(head);
    if (s) return s;
    var rest = text.slice(prefixLen);
    var lead = /^\s*[:.]?\s*(\([^()]{1,40}\))/.exec(rest);
    if (lead && sideTag(lead[1])) return sideTag(lead[1]);
    // "Next row (inc row): (WS)." - a label in brackets, then the side
    if (lead && /^\(\s*(?:[a-z]+\s+)?(?:inc(?:rease)?|dec(?:rease)?|set[-\s]?up|eyelet|turning|joining|dividing|buttonhole)\s*(?:rnd|row|round)?\s*\)$/i.test(lead[1])) {
      var lead2 = /^\s*[:.]?\s*(\([^()]{1,40}\))/.exec(rest.slice(lead[0].length));
      return lead2 ? sideTag(lead2[1]) : null;
    }
    if (lead) return null;
    // "Row 1: RS (Set-up row) Join CC1..." / "RS: K2..."
    var m = /^\s*[:.]?\s*(rs|ws)(?=\s*[:.(])/i.exec(rest);
    if (m) return /^rs/i.test(m[1]) ? 'rs' : 'ws';
    return null;
  }

  var CHART_RES = [
    // "work Row 1 of Foot chart", "work row 7 of Chart A", "Rows 1-12 of Leg chart"
    /\b(?:row|rnd|round)s?\s+(\d+)(?:\s*[-–]\s*(\d+))?\s+of\s+(?:the\s+)?(?:chart\s+([A-Z0-9]{1,3})\b|([A-Za-z0-9][A-Za-z0-9 ]{0,24}?)\s+chart\b)/i,
    // "Chart A, row 7" / "Chart A rnd 7"
    /\bchart\s+([A-Z0-9]{1,3})\b[,:]?\s*(?:row|rnd|round)\s+(\d+)/i,
    // "work Chart A" / "work Lace chart" / "foll chart"
    /\b(?:work|knit|foll(?:ow(?:ing)?)?|cont(?:inue)?\s+in|beg(?:in(?:ning)?)?)\s+(?:the\s+)?(?:chart\s+([A-Z0-9]{1,3})\b|([A-Za-z][A-Za-z0-9 ]{0,20}?)\s+chart\b|chart\b)/i
  ];

  // "Work 1st row of Panel Pat C. ... Work 1st row of Panel Pat B ...": the
  // written (or charted) panels a row works, in order
  var PANEL_ROW_G = /\bwork\s+(?:the\s+)?(\d+)(?:st|nd|rd|th)\s+(?:row|rnd|round)\s+(?:of\s+)?(?:the\s+)?((?:[A-Za-z]+\s+){0,3}?(?:panel|pat|patt|pattern|chart)(?:\s+(?!over\b|across\b)[A-Za-z]+){0,2}?(?:\s+[A-Z0-9]{1,2})?)(?=\s*(?:[.,;]|over\b|across\b|$))/gi;

  function panelsOf(text) {
    var t = String(text || ''), m, out = [], seen = {};
    PANEL_ROW_G.lastIndex = 0;
    while ((m = PANEL_ROW_G.exec(t)) !== null) {
      var nm = m[2].replace(/\s+/g, ' ').trim(), key = nm.toLowerCase() + '#' + m[1];
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ name: nm, row: int(m[1]) });
    }
    return out;
  }

  function chartOf(text) {
    var t = String(text || ''), m;
    var pn = panelsOf(t);
    if (pn.length) {
      var c0 = { name: pn[0].name, row: pn[0].row };
      if (pn.length > 1) c0.also = pn.slice(1);
      return c0;
    }
    // "See Chart B for Rows 14-36." - the rows the chart covers (postParse
    // puts it on each of them)
    if ((m = /\bsee\s+chart\s+([A-Z0-9]{1,3}|[A-Z][a-z]+)\s+for\s+(?:rows?|rnds?|rounds?)\s+(\d+)\s*[-–]\s*(\d+)/i.exec(t))) {
      return { name: m[1], row: int(m[2]), rowEnd: int(m[3]), covers: true };
    }
    // "..., ending with chart Row 20" - the chart row the line ends on
    if ((m = /\bending\s+with\s+chart\s+(?:row|rnd)\s+(\d+)\b/i.exec(t))) return { name: null, row: int(m[1]) };
    if ((m = CHART_RES[0].exec(t))) {
      var o = { name: (m[3] || m[4] || 'Chart').trim(), row: int(m[1]) };
      if (m[2]) o.rowEnd = int(m[2]);
      return o;
    }
    if ((m = CHART_RES[1].exec(t))) return { name: m[1], row: int(m[2]) };
    // "Work Rnds 1–44 of chart once." - the pattern's one chart, unnamed
    if ((m = /\b(?:row|rnd|round)s?\s+(\d+)(?:\s*[-‐-―]\s*(\d+))?\s+of\s+(?:the\s+)?chart\b(?!\s+[A-Z0-9]{1,3}\b)/i.exec(t))) {
      var oc = { name: 'Chart', row: int(m[1]) };
      if (m[2]) oc.rowEnd = int(m[2]);
      return oc;
    }
    if ((m = CHART_RES[2].exec(t))) {
      var nm = (m[1] || m[2] || 'Chart').trim();
      if (/^(?:the|this|a|each|your)$/i.test(nm)) nm = 'Chart';
      return { name: nm, row: null };
    }
    return null;
  }

  var CABLE_EVERY_RE = /\b(?:(c\d+[fb]|t\d+[lrfb]|\d\/\d\s*[lr]p?[ct]|cable|cross(?:ing)?|cable\s+cross(?:ing)?)\b[^.;]{0,60}?\bevery\s+(?:(\d+)(?:st|nd|rd|th)?|(other|alt(?:ernate)?))\s+(?:rs\s+)?(?:row|rnd|round)s?\b|\b(?:rep(?:eat)?|work)\s+(?:these\s+|rows?\s+1\s*[-–]\s*)?(\d+)\s+(?:rows?|rnds?)\s+for\s+(?:the\s+)?(c\d+[fb]|cable)\b)/i;

  function cableOf(text) {
    var m = CABLE_EVERY_RE.exec(String(text || ''));
    if (!m) return null;
    if (m[5]) return { every: int(m[4]), name: /^c\d/i.test(m[5]) ? m[5].toUpperCase() : null };
    var every = m[2] ? int(m[2]) : 2;
    var name = /^(?:c\d|t\d|\d\/)/i.test(m[1]) ? m[1].toUpperCase().replace(/\s+/g, ' ') : null;
    return { every: every, name: name };
  }

  function deltaOf(text, ctx) {
    var t = E.normDashes(E.normUnicode(String(text || '')));
    var m = DELTA_TAIL_RE.exec(t);
    if (!m) return null;
    var v = int(m[1]);
    if (m[2]) {
      var vals = [int(m[1])].concat(m[2].replace(/[()]/g, '').split(/\s*[,\-]\s*/).map(int));
      v = pickFrom(vals, ctx);
      if (v === undefined) return null;
    }
    if (v === null) return null;
    // "8 sts inc" over a repeated block counts per working; the line says it
    return /^dec/i.test(m[3]) ? -v : v;
  }

  var BOR_RE = /\b(?:bor|beg(?:inning)?[-\s]+of[-\s]+(?:the\s+)?(?:new\s+)?(?:rnd|round)|for\s+(?:new\s+)?beg(?:inning)?\b|start\s+of\s+(?:the\s+)?(?:rnd|round)|end\s+of\s+(?:the\s+)?(?:rnd|round)|and\s+join|(?:join|joining)\s+(?:to\s+work\s+)?in\s+the\s+(?:rnd|round))\b/i;

  function markersOf(list, text) {
    if (!list || !list.length) return null;
    var out = [], k = 0;
    var joinedAfter = list.length === 1 && /\b(?:pm|place\s+(?:a\s+|contrasting\s+)?marker)\b[\s\S]{0,90}?\b(?:join|(?:beg(?:in)?\s+)?working\s+in\s+(?:the\s+)?(?:rnds?|round)|in\s+the\s+(?:rnd|round))\b/i.test(String(text || ''));
    for (var i = 0; i < list.length; i++) {
      var mk = list[i], lab = String(mk.label || '').trim();
      if (BOR_RE.test(lab) || (joinedAfter && list.length === 1)) {
        out.push({ name: 'BOR', at: 0 });
        continue;
      }
      k++;
      var name = null;
      var f = /^for\s+(?:the\s+)?([a-z][a-z -]{1,22}?)\s*$/i.exec(lab);
      var letter = /^([a-z])\b/i.exec(lab);
      if (f) name = f[1];
      else if (letter && lab.length <= 2) name = letter[1].toUpperCase();
      else name = 'm' + k;
      out.push({ name: name, at: mk.at });
    }
    return out;
  }

  // A short row TURNS where the row stops: "..., wrap next st, turn.", "K5,
  // w&t", "turn work." / "TURN" at the end, maybe with "—1 st dec'd" after it.
  // Not one: "do not turn", "Turn work, position needle point and work next
  // instep stitches" (magic loop in the round), "Turn so WS is facing" after
  // a row that reached the end (that is decided from the count, see lineCount).
  var SHORT_END_RE = /(?:\bturn(?:\s+work)?|\bw\s*&\s*t|\bwrap\s+(?:and|&)\s+turn|\bwrap\s+next\s+st(?:itch)?(?:,?\s*turn)?)\b[^a-z]*(?:[-—=]\s*\d[^.]*)?(?:\.\s*)?$/i;
  var SHORT_LEAVE_RE = /\bturn(?:\s+work)?\s*,?\s*(?:leaving|with)\b[^.]*\bunworked\b|\bw\s*&\s*t\b|\bunworked\b[^.]*[.;]?\s*turn\b|\bturn\s+so\s+(?:the\s+)?(?:ws|rs|wrong\s+side|right\s+side)\s+(?:is\s+)?facing\b/i;

  function isShort(rest) {
    var r = String(rest || '').replace(/\b(?:heel\s+turn|turn\s+heel|turning\s+ridge|turned)\b/gi, '')
      .replace(/\b(?:do\s+not|don'?t)\s+turn(?:\s+work)?\b/gi, '');
    return SHORT_END_RE.test(r.replace(/\s+$/, '')) || SHORT_LEAVE_RE.test(r) ||
      // "...turn. 26 sts" / "turn—1 heel st dec'd." already covered; "turn work."
      /\bturn(?:\s+work)?\s*[.;]\s*(?:\(?\d+\s*(?:\([^)]*\))?\s*sts?[^.]*\)?\.?)?\s*$/i.test(r);
  }

  function isRoundHead(head) {
    return /\b(?:rnds?|rounds?)\b/i.test(head);
  }

  // --- instructions printed inside a paragraph (wave H polish) ----------------
  //
  // Interweave sets its instructions as running prose: "...rib for 3/4". Inc.
  // Rnd: Work in St st (knit all sts) inc 20 sts evenly spaced—144 sts. Work 5"
  // / "rnds even in St st. Work Rows 1–61 of Lace chart, placing m" / "between
  // each rep—84 sts rem. Break yarn...". A sentence that starts with a row label,
  // "Next row/rnd", a named row ("Inc. Rnd:", "Dec rnd:"), a repeat ("Rep Rows
  // 9–20"), "Work N rnds" / "Work Rows 1–61", a cast-on / pick-up / bind-off of
  // N sts, or "Place ... N sts ...—N sts" is an instruction of its own: it is
  // taken out of the paragraph onto a line of its own, joined across the
  // printed wraps up to its full stop. Everything else keeps its printed lines.
  // A row label that starts a printed line is left to the engine (its wraps are
  // joined there); so is any lead whose words all sit on the line it starts.

  var DASH_CH = '[\\-\\u2010-\\u2015\\u2212]';
  var NUMW = '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten)';
  var RR = '(?:rows?|rnds?|rounds?)';
  var LEAD_FORMS = [
    // 0 - row label: "Row 1: (RS)", "Rows 2 and 4:", "Rnd 13:", "Row 1 (RS) Knit"
    { row: true, src: RR + '\\s*\\d+(?:\\s*(?:' + DASH_CH + '|,|and|&|to)\\s*\\d+)*\\s*(?:\\(\\s*(?:rs|ws|right\\s+side|wrong\\s+side)[^)]*\\)|[:.](?!\\d))' },
    // 1 - "Next rnd: ...", "Next row (RS)", "Next rnd Knit, dec..."
    { row: true, src: 'next\\s+(?:rs\\s+|ws\\s+)?' + RR + '\\b(?!\\s*(?:\\d|and\\b|then\\b|,))' },
    // 2 - a named row: "Inc. Rnd:", "Dec rnd:", "Buttonhole row: (RS)", "Raglan inc rnd:"
    { row: true, src: '(?:[a-z][a-z-]*\\.?\\s+){0,2}?(?:inc(?:rease)?|dec(?:rease)?|eyelet|turning|joining|picot|ridge|buttonhole|set[-\\s]?up|foundation|shaping|raglan|division)\\.?\\s+' + RR + '\\s*(?:\\(\\s*(?:rs|ws)[^)]*\\)\\s*)?:' },
    // 3 - "Short-row 1"
    { row: true, src: 'short[-\\s]?rows?\\s+\\d' },
    // 4 - a repeat: "Rep Rows 9–20", "Rep last 2 rnds", "Repeat from Row 3", "Rep Inc rnd"
    // (joined to its full stop wherever it starts: "Rep last 4 rows 1 (1-0-0) time
    // more." / "43 (43-51-51) sts rem." - Patons)
    { join: true, src: 'rep(?:eat)?\\s+(?:the\\s+)?(?:last\\s+' + NUMW + '\\s+' + RR + '|' + RR + '\\s+\\d|from\\s+' + RR + '|(?:inc|dec)\\s+' + RR + '|these\\s+' + NUMW + '\\s+' + RR + '|this\\s+(?:row|rnd|round))' },
    // 5 - "Work 5 rnds even", "Knit 6 rows", "Work 1 rnd even"
    { src: '(?:work|knit|purl)\\s+' + NUMW + '\\s+(?:more\\s+)?' + RR + '\\b' },
    // 6 - "Work Rows 1–61 of Lace chart", "Work through Rnd 84 of Leg chart"
    { src: 'work\\s+(?:even\\s+)?(?:through\\s+)?' + RR + '\\s+\\d' },
    // 7 - "Change to Chart 2, and work Rows 1–8 once"
    { src: 'change\\s+to\\s+[^.;]{1,40}?,?\\s+and\\s+(?:work|rep(?:eat)?)\\s+' + RR + '\\s+\\d' },
    // 7b - shaping spread over rows: "Shape waist: Cont in charted patt, dec 1 st
    // inside selvedge sts each end of needle every 8th row 6 times, ending ..."
    { src: 'cont(?:inue)?\\s+[^.;]{0,90}?\\bevery\\s+(?:\\d+(?:st|nd|rd|th)|other|alt(?:ernate)?|rs|ws|4th|6th|8th)\\s+(?:row|rnd|round)' },
    // 8 - a cast-on: "CO 27 sts", "With 4 strands ..., use the knitted method (see below) to CO 27 sts"
    { lineStart: true, src: '(?:(?:with|using)\\b[^.;]{0,100}?,\\s*(?:use\\s+[^.;]{0,60}?\\s+to\\s+)?)?(?:co|cast\\s+on)\\s+\\d+' },
    // 9 - a pick-up: "With RS facing, pick up and knit 36 sts"
    { lineStart: true, pickup: true, src: '(?:beg(?:in(?:ning)?)?\\s+at\\b[^.;]{0,60}?,\\s*)?(?:(?:with|using)\\b[^.;]{0,100}?(?:,\\s*|\\s+(?=pick\\s+up\\b)))?(?:pick\\s+up|pu)\\b(?:\\s+(?:and|&)\\s+(?:knit|k))?\\s+\\d+' },
    // 10 - "Place first 15 and last 14 sts of rnd on one needle—29 sts"
    { src: '(?:place|slip|sl|put)\\s+(?:the\\s+)?(?:first|last|next)?\\s*\\d+[^.;]{0,60}?\\bsts?\\b[^.;]{0,60}?' + DASH_CH + '\\s*\\d+\\s*(?:\\([^)]*\\)\\s*)?sts?\\b' },
    // 11 - "BO 4 sts at beg of next 2 rows"
    { lineStart: true, src: '(?:bo|bind\\s+off|cast\\s+off)\\s+\\d+\\s*(?:\\([^)]*\\)\\s*)?(?:sts?|stitches)\\b' },
    // 12..17 (wave H, Patons) - a sentence that runs over several narrow printed
    // lines with no row label: joined to its full stop even when it starts a
    // printed line ("Cont in pat, keeping cont of Panel" / "Pats and (K3. P2)
    // ribbing at side" / ... / "until work from beg measures 15½"" / "[39.5 cm],
    // ending on a WS row.")
    // 12 - "Cont in pat ...", "Continue even until ..."
    { join: true, src: 'cont(?:inue)?\\b' },
    // 13 - "Keeping cont of pat, cast off 4 sts beg next 2 rows."
    { join: true, src: 'keeping\\s+(?:cont(?:inuity)?\\s+of\\s+)?(?:the\\s+)?(?:patt?(?:ern)?|rib(?:bing)?)\\b' },
    // 14 - "Dec 1 st at neck edge on next 9 rows.", "Inc 1 st each end of ..."
    { join: true, src: '(?:dec|inc)(?:rease)?\\s+(?:\\d+|one|two)\\s+sts?\\s+(?:at|each|on|in)\\b' },
    // 15 - "Leave rem 44 (46-48-...) sts on a st holder."
    { join: true, src: '(?:leave|leaving)\\s+(?:the\\s+)?rem(?:aining)?\\s+\\d+' },
    // 16 - "Beg and ending on a 2nd row work 3½" in ribbing", "Work 2" [5 cm] in rib"
    { join: true, src: '(?:beg(?:in(?:ning)?)?\\s+(?:and\\s+end(?:ing)?\\s+)?(?:on|with)\\s+(?:a\\s+)?(?:\\d+(?:st|nd|rd|th)|rs|ws)\\s+row|work\\s+\\d+(?:[.,]\\d+)?\\s*[½¼¾]?\\s*(?:"|in\\b|cm\\b))' },
    // 17 - "Work from ** to ** as given for Back.", "Work as given for Back"
    { join: true, src: 'work\\s+(?:from\\s+\\*+\\s+to\\s+\\*+|as\\s+(?:given\\s+)?for\\b)' },
    // 17a - "Proceed in Box St Pat as given for" / "Front for 8 rows."
    { join: true, src: 'proceed\\s+in\\s+[^.;]{1,60}?\\bfor\\b' },
    // 17b - "Pat for 4" [10 cm], ending on a 2nd row and inc 3 sts evenly across
    // last row. 76 (...) sts." (a stretch of the pattern by length)
    { join: true, src: '(?:patt?|pattern|rib)\\s+for\\s+\\d' },
    // 18 - "With RS facing slip next 26 (...) sts from spare needle onto a st
    // holder.", "Join yarn to rem sts and pat to end of row."
    { join: true, src: 'with\\s+(?:rs|ws|right\\s+side|wrong\\s+side)\\s+(?:of\\s+work\\s+)?facing\\b(?![^.;]{0,60}\\b(?:pick\\s+up|cast\\s+on)\\b)' },
    // 19 - "Join yarn to rem sts. Pat to last 4 sts. K2tog. K2." - the row
    // goes on while its sentences are stitches
    { join: true, stitchy: true, src: '(?:re)?join\\s+(?:the\\s+)?yarn\\b' }
  ];
  // a label of up to four words before the instruction: "toe: Dec rnd:", "Shape bust: Inc row:"
  var LEAD_LABEL_RE = /^([A-Za-z][A-Za-z'&\/-]*(?:\s+[A-Za-z][A-Za-z'&\/-]*){0,3}\s*:\s+)/;
  var LEAD_RES = LEAD_FORMS.map(function (f) { return new RegExp('^(?:' + f.src + ')', 'i'); });
  var PAGE_LINE_RE = /^===\s*page\s+\d+\s*===/i;
  var ROW_START_RE = /^\s*(?:[-*]\s*)?(?:(?:short[-\s]?)?(?:rows?|rnds?|rounds?)\s*\d+[^:.]{0,40}[:.]|next\s+(?:rows?|rnds?|rounds?)\b|\d+(?:st|nd|rd|th)\s+(?:row|rnd|round)\b)/i;
  // (...and "then every following" / "4th row until there are 133 sts" - Patons)
  var WRAPS_INTO_RE = /\b(?:chart|of|with|to|through|thru|and|or|ending|at|after|before|on|in|from|the|a|an|foll(?:owing)?|every|alt(?:ernate)?|other)\s*$/i;
  var SENT_END_G = /[.!?](?=["')\]*]*(?:\s|$))/g;
  var COUNT_SENTENCE_RE = /^\(?\s*\d+\s*(?:\([^)]*\)\s*)?(?:sts?|stitches)\b[^.]*\.?\)?/i;

  /** Which lead (if any) `s` starts with: { form, row, coreAt, len }. */
  function leadAt(s) {
    var lab = LEAD_LABEL_RE.exec(s), off = lab ? lab[1].length : 0;
    var tries = lab ? [off, 0] : [0];
    for (var q = 0; q < tries.length; q++) {
      var at = tries[q], rest = s.slice(at);
      // an instruction starts with a capital ("toe: Dec rnd:" - the label may not)
      if (!/^[A-Z]/.test(rest)) continue;
      for (var f = 0; f < LEAD_RES.length; f++) {
        var m = LEAD_RES[f].exec(rest);
        if (m) return { form: f, row: !!LEAD_FORMS[f].row, lineStart: !!LEAD_FORMS[f].lineStart, join: !!LEAD_FORMS[f].join,
          pickup: !!LEAD_FORMS[f].pickup, stitchy: !!LEAD_FORMS[f].stitchy, coreAt: at, len: at + m[0].length };
      }
    }
    return null;
  }

  /** Where the sentence that runs from `from` ends in `s` (index after its stop), or -1. */
  function sentenceEnd(s, from, isRow, isPickup) {
    SENT_END_G.lastIndex = from;
    var m;
    while ((m = SENT_END_G.exec(s)) !== null) {
      var at = m.index;
      var before = s.slice(Math.max(0, at - 7), at);
      // "i.e.", "e.g.", "approx.", "4 in. from" are never a stop
      if (/(?:\bi\.e|\be\.g|\bapprox|\bincl|\bfig|\bno|\d\s*in)$/i.test(before)) continue;
      // "...keeping cont of Panel Pats and (K3. P2) ribbing at side edges ..." -
      // a stop inside brackets is not the sentence's
      var inside = s.slice(from, at);
      if ((inside.match(/\(/g) || []).length > (inside.match(/\)/g) || []).length ||
          (inside.match(/\[/g) || []).length > (inside.match(/\]/g) || []).length) continue;
      var end = at + 1;
      // ("...176) sts.**" - the closing marks of a "Work from ** to **" block)
      while (end < s.length && /["')\]*]/.test(s.charAt(end))) end++;
      var rest = s.slice(end).replace(/^\s+/, '');
      if (!rest) return end;
      // "(96 sts)" / "42 sts." after the stop belong to the sentence
      var cs = COUNT_SENTENCE_RE.exec(rest);
      if (cs) {
        var nextEnd = s.length - rest.length + cs[0].length;
        if (!/\.\)?$/.test(cs[0])) return nextEnd;
        SENT_END_G.lastIndex = nextEnd - 1;
        continue;
      }
      if (/^[a-z]/.test(rest) && !/^[a-z][a-z ]{0,25}:\s/.test(rest) && !leadAt(rest)) continue;
      // a row goes on while its sentences are stitches: "3rd row: K1. *M1. SM. K2."
      if (isRow && !leadAt(rest) && (CONT_START_RE.test(rest) || /^(?:cast\s+on|co\s+\d|bind\s+off|bo\s+\d)/i.test(rest))) continue;
      // a pick-up goes on while it picks up or knits held stitches in: "K26
      // (...) from front st holder, dec 3 sts evenly across. Pick up and knit
      // 22 sts up right front neck edge. K44 (...) from back st holder ..."
      if (isPickup && /^(?:(?:k|knit)\s*\d+\b[^.]*\bfrom\b|pick\s+up\b|pu\s+\d)/i.test(rest)) continue;
      return end;
    }
    return -1;
  }

  /** May a sentence start at the very beginning of line i? */
  function startsSentence(lines, i) {
    for (var k = i - 1; k >= 0; k--) {
      var p = lines[k].trim();
      if (!p) return true;
      if (PAGE_LINE_RE.test(p)) return true;
      // ("...136 (140-...) sts.**" - the closing marks of a "Work from ** to **" block)
      if (/[.:;!?]["')\]]*\**$/.test(p)) return true;
      // a heading on the line before: "Sock", "Turn heel"
      return p.length <= 40 && p.split(/\s+/).length <= 5 && !/[,(\-]$/.test(p) &&
        !/\b(?:and|the|of|to|with|in|on|a|an|for|or|by|at|from|as|into|onto|until)$/i.test(p);
    }
    return true;
  }

  /**
   * "Next rnd: (Dividing rnd). Slip first 56 (...) sts (Left Sleeve) onto
   * length of spare yarn. Join yarn to next st and K86 (...) (Front)." /
   * "Cast on 6 (...) sts." / "Place marker after 3rd ... cast" / "on st. Slip
   * next 56 ..." / "... Join in rnd. 184" / "(204-224-244-272-332) sts." - a
   * round that puts stitches aside goes on over the lines below it (the
   * underarm cast-on, the other sleeve, the back) up to its printed total:
   * all one round, not a new piece cast on (Patons Cabled Yoke).
   */
  var DIVIDE_TOTAL_END_RE = /(?:^|[.;]\s+)\d+\s*(?:\(\s*\d+(?:\s*[,\-]\s*\d+)*\s*\))?\s*sts?\.?\s*$/i;
  var DIVIDE_ROW_RE = /^(?:[A-Za-z ]{1,20}:\s*)?(?:next\s+(?:rnd|round|row)|\d+(?:st|nd|rd|th)\s+(?:rnd|round|row)|(?:rnd|round|row)\s+\d+|dividing\s+(?:rnd|round|row))\b[^]*\b(?:spare|scrap|waste)\s+yarn\b|^(?:[A-Za-z ]{1,20}:\s*)?(?:next\s+(?:rnd|round|row)|\d+(?:st|nd|rd|th)\s+(?:rnd|round|row)|dividing\s+(?:rnd|round|row))\b[^]*\bholders?\b/i;

  function reflowLines(raws) {
    // a part's carried stitch guide ("Panel Pat C (worked over 9 sts): 1st row:
    // (RS). Knit. | 2nd and every alt row: Purl. | ...") is read as the panel's
    // definition and is no line of the part
    var guides = {}, gi, kept = [];
    for (gi = 0; gi < raws.length; gi++) {
      var gm = GUIDE_LINE_RE.exec(String(raws[gi]).trim());
      if (gm) { guides[panelKey(gm[1])] = { width: int(gm[2]), text: gm[1] + ' (worked over ' + gm[2] + ' sts)\n' + gm[3].split(/\s+\|\s+/).join('\n') }; continue; }
      kept.push(raws[gi]);
    }
    E.run().panels = collectPanels(raws);
    raws = kept;
    // "CABLE PANEL A (worked over" / "15 sts).": the definition joined
    raws = raws.slice();
    for (var w = 0; w + 1 < raws.length; w++) {
      if (/\(\s*worked(?:\s+over)?\s*$/i.test(String(raws[w]).trim()) && /^(?:over\s+)?\d+\s+(?:sts?|stitches)\s*\)/i.test(String(raws[w + 1]).trim())) {
        raws[w] = String(raws[w]).replace(/\s+$/, '') + ' ' + String(raws[w + 1]).trim();
        raws.splice(w + 1, 1);
      }
    }
    E.run().panelText = collectPanelText(raws, guides);
    // "...inc 10 (...) sts evenly around last rnd. 174 ( 192-" / "216-264-294-
    // 354) sts.": a size list broken over the wrap is one list, whatever kind
    // of line it ends
    for (var wl = 0; wl + 1 < raws.length; wl++) {
      var wa = String(raws[wl]).replace(/\s+$/, ''), wb = String(raws[wl + 1]).trim();
      if (/\d+\s*\(\s*\d+(?:[.,]\d+)?(?:\s*[,\-]\s*\d+(?:[.,]\d+)?)*\s*[,\-]$/.test(wa) && /^\d[\d.,\/½\s-]*\)/.test(wb) &&
          !/\(\s*\d[^)]*$/.test(wb.slice(0, wb.indexOf(')')))) {
        raws[wl] = wa + (/-$/.test(wa) ? '' : ' ') + wb;
        raws.splice(wl + 1, 1);
        wl--;
        continue;
      }
      // "Rep from ** to ** 4 times more. 164" / "(184-204) sts."
      if (/[.;]\s+\d+$/.test(wa) && /^\(\s*\d+(?:\s*[,\-]\s*\d+)+\s*\)\s*(?:sts?|stitches)\b/i.test(wb)) {
        raws[wl] = wa + ' ' + wb;
        raws.splice(wl + 1, 1);
        wl--;
      }
    }
    // a pattern written as running prose (no printed row labels - Sandnes; or
    // a plain-text book hard-wrapped at 70 columns - Gutenberg) is read one
    // sentence to a line first
    var pr = proseLines(raws);
    if (pr) raws = pr;
    E.run().prose = !!pr;
    var lines = raws.slice(), tail = {}, out = [], i = 0, WIN = 8;
    while (i < lines.length) {
      var t = lines[i].trim();
      if (!t || PAGE_LINE_RE.test(t)) { out.push(lines[i]); i++; continue; }
      // the window: this line and the lines its sentence may wrap onto
      var parts = [t], starts = [0], flat = t;
      for (var k = i + 1; k < lines.length && k <= i + WIN; k++) {
        var n = lines[k].trim();
        if (!n || PAGE_LINE_RE.test(n)) break;
        // a row label starts a line of its own - unless the line before runs
        // into it: "...ending with chart" / "Rnd 10. toe: Dec rnd: ..."
        if (ROW_START_RE.test(n) && !WRAPS_INTO_RE.test(parts[parts.length - 1])) break;
        starts.push(flat.length + 1);
        flat += ' ' + n;
        parts.push(n);
      }
      // "Row 15 and all following odd-numbered rows through Row" / "35: K1,
      // purl to last st, k1." - the row number the line above stopped short of
      if (!tail[i] && /^\d+\s*[:.](?!\d)/.test(t) && out.length &&
          /\b(?:rows?|rnds?|rounds?)\s*$/i.test(String(out[out.length - 1]).trim())) {
        out[out.length - 1] = String(out[out.length - 1]).replace(/\s+$/, '') + ' ' + t;
        i++;
        continue;
      }
      // "...ending with chart" / "Row 20—87 (99, 111, 123) sts rem; piece
      // measures about 6" from CO." - a row label the line above runs into is
      // the end of that sentence, never a row of its own
      if (!tail[i] && /^(?:rows?|rnds?|rounds?)\s*\d/i.test(t) && out.length && WRAPS_INTO_RE.test(out[out.length - 1].trim()) &&
          !startsSentence(lines, i)) {
        var wEnd = sentenceEnd(flat, 0, false);
        if (wEnd > 0) {
          var wLast = 0;
          for (var wq = 0; wq < starts.length; wq++) if (starts[wq] < wEnd) wLast = wq;
          out[out.length - 1] = out[out.length - 1].replace(/\s+$/, '') + ' ' + flat.slice(0, wEnd).trim();
          var wRest = flat.slice(wEnd, starts[wLast] + parts[wLast].length).trim();
          if (wRest) { lines[i + wLast] = wRest; tail[i + wLast] = true; i = i + wLast; }
          else i = i + wLast + 1;
          continue;
        }
      }
      // "Neckband: Sew right shoulder" / "seam. With RS facing ..., pick up and
      // knit 22 sts ...": the part's name, then finishing prose, then the
      // part's foundation - the name goes on a line of its own (Patons)
      var nbl = /^([A-Z][A-Za-z ]{2,30}):\s+(?=(?:sew|join|seam|block|pin|weave|fold|press)\b)/i.exec(t);
      if (nbl && PART_NOUN_RE.test(nbl[1]) && !/\b(?:shaping|finishing)\b/i.test(nbl[1]) && (tail[i] || startsSentence(lines, i)) &&
          /\b(?:pick\s+up|cast\s+on)\s+(?:and\s+knit\s+)?\d+/i.test(flat)) {
        out.push(nbl[1] + ':');
        lines[i] = t.slice(nbl[0].length);
        tail[i] = true;
        continue;
      }
      var cands = [];
      if (tail[i] || startsSentence(lines, i)) cands.push(0);
      var g = /[.!?]["')\]]*\s+/g, mm;
      while ((mm = g.exec(t)) !== null) {
        if (mm.index + mm[0].length < t.length) cands.push(mm.index + mm[0].length);
      }
      var hit = null;
      for (var c = 0; c < cands.length && !hit; c++) {
        var p = cands[c];
        var ld = leadAt(flat.slice(p));
        if (!ld) continue;
        // the instruction itself starts on this line ("StoCkiNG" / "Cuff: With
        // MC, CO 84 sts." is a heading over a cast-on, not one sentence)
        if (p + ld.coreAt >= t.length) continue;
        if (p === 0 && !tail[i]) {
          // a lead that starts a printed line is the engine's, unless the
          // words that make it one are broken over the wrap ("Toe: With
          // smaller needles and using the" / "Eastern method..., CO 8")
          // (...unless the rows it shapes go on past the wrap: "Shoulder
          // shaping: Cast off 15 (...) sts beg next 4 rows," / "then 16 (...)
          // sts beg following 2 rows." is 6 rows, not 4)
          var thenEnd = (!ld.row && ld.len <= t.length) ? sentenceEnd(flat, p + ld.len, false) : -1;
          var thenMore = thenEnd > t.length && THEN_BEG_G.test(flat.slice(t.length, thenEnd)) && !THEN_BEG_G.test(t);
          if (ld.row || (ld.len <= t.length && !ld.join && !thenMore)) continue;
        }
        // a cast-on / pick-up / bind-off inside a paragraph is part of the
        // sentence before it ("8th row: (WS). Cast on 16 sts (center front).")
        // (...unless what comes before it is a sentence of finishing prose:
        // "Neckband: Sew right shoulder seam. With RS facing and smaller
        // needles, pick up and knit 22 sts ..." - Patons)
        if (p > 0 && ld.lineStart && (!ld.pickup || /\b(?:k\d|p\d|knit|purl|rows?|rnds?|rounds?|sts?)\b/i.test(t.slice(0, p)))) continue;
        var end = sentenceEnd(flat, p + ld.len, ld.row || ld.stitchy, ld.pickup);
        if (end < 0) continue;
        hit = { p: p, end: end, ld: ld };
      }
      if (!hit) { out.push(tail[i] ? t : lines[i]); i++; continue; }
      // the line the sentence ends on
      var last = 0;
      for (var q = 0; q < starts.length; q++) if (starts[q] < hit.end) last = q;
      var pre = t.slice(0, hit.p).trim();
      // the words before it end the sentence the line above started
      // ("...ending with chart" + "Rnd 10.")
      if (pre && !tail[i] && out.length && !startsSentence(lines, i) &&
          out[out.length - 1].trim() && !PAGE_LINE_RE.test(out[out.length - 1].trim())) {
        out[out.length - 1] = out[out.length - 1].replace(/\s+$/, '') + ' ' + pre;
      } else if (pre) out.push(pre);
      var sent = flat.slice(hit.p, hit.end).trim();
      // a heading set in small capitals runs into the sentence ("toe: Dec rnd:"):
      // it goes on a line of its own, or the engine reads it as a wrap
      var lab = hit.ld.coreAt > 0 ? sent.slice(0, hit.ld.coreAt).trim() : '';
      if (lab && /^[a-z]/.test(lab)) { out.push(lab); sent = sent.slice(hit.ld.coreAt).trim(); }
      out.push(sent);
      var rest = flat.slice(hit.end, starts[last] + parts[last].length).trim();
      var at = i + last;
      if (rest) { lines[at] = rest; tail[at] = true; i = at; }
      else i = at + 1;
    }
    markChartTitles(out);
    return altVectors(out);
  }

  var INTAKE_RE = /^(?:make\s*(?:--|—)?\s*)?(\d+)\s+(?:intakes?|["”]+)[\s"”]*(?:on\s+each\s+side,?\s*)?(?:["”\s]*)with\s+(\d+)\s+rounds?\s+between/i;

  // "Change to 6 mm circular ndl, k 1 rnd, ...", "Knit 43 plain rounds, or 2
  // inches", "Do ten rounds in ribs", "knit backwards and forwards for 20 rows"
  var PROSE_ROUNDS_RE = /^((?:[A-Z][^.;]{0,60}?,\s*)?(?:now\s+|then\s+)?)(?:k|knit|p|purl|work|do|rib)\s+(?:back(?:wards)?\s+and\s+forth(?:wards)?\s+(?:for\s+)?)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:more\s+)?(?:plain\s+)?(?:rnds?|rounds?|rows?)\b/i;

  // --- size groups printed as whole copies of the pattern (wave H, batch 2) ----
  var GROUP_WORD_RE = /^(?:children|child|kids?|ladies|women'?s?|men'?s?|adults?|baby|babies|girls?|boys?|toddlers?|teens?|junior)$/i;

  function sizeBlockGroups(raws) {
    var blocks = [], i, j;
    for (i = 0; i < raws.length; i++) {
      var t = E.trimLine(raws[i]);
      if (!/^sizes?\s*:?$/i.test(t)) continue;
      for (j = i + 1; j < raws.length && j <= i + 3; j++) {
        var n = E.trimLine(raws[j]);
        if (!n) continue;
        var sz = null;
        try { sz = knitDetectSizes(n, E.baseDetectSizes); } catch (e) { sz = null; }
        if (sz && sz.length >= 2) blocks.push({ line: i, sizes: sz });
        break;
      }
    }
    if (blocks.length < 2) return null;
    var keys = {};
    blocks.forEach(function (b) { keys[b.sizes.join('|')] = true; });
    if (Object.keys(keys).length < 2) return null;
    var at = {}, names = [];
    // the page a block is printed on: from its "=== PAGE n ===" line to the
    // next one (a text with no pages: from the block to the next block)
    function pageOf(line, k) {
      var a = -1, z = -1, q;
      for (q = line; q >= 0; q--) if (PAGE_LINE_RE.test(E.trimLine(raws[q]))) { a = q; break; }
      for (q = line + 1; q < raws.length; q++) if (PAGE_LINE_RE.test(E.trimLine(raws[q]))) { z = q; break; }
      if (a < 0) return { a: line + 1, z: k + 1 < blocks.length ? blocks[k + 1].line : raws.length };
      return { a: a + 1, z: z < 0 ? raws.length : z };
    }
    blocks.forEach(function (b, k) {
      // the label is the one in the title block of the block's own page - above
      // SIZES or below it, whichever order the page's text comes out in
      // ("Limited edition / children / SINGLE PATTERN ... / SIZES" or "SIZES /
      // ... / TENSION / children") - never one from the next page
      var pg = pageOf(b.line, k), label = null, best = Infinity;
      for (j = pg.a; j < pg.z; j++) {
        var w = E.trimLine(raws[j]);
        if (!GROUP_WORD_RE.test(w)) continue;
        if (j !== b.line && blocks.some(function (o) { return o !== b && o.line >= pg.a && o.line < pg.z && Math.abs(o.line - j) < Math.abs(b.line - j); })) continue;
        if (Math.abs(j - b.line) < best) { best = Math.abs(j - b.line); label = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }
      }
      if (!label) label = b.sizes[0] + '–' + b.sizes[b.sizes.length - 1];
      while (names.indexOf(label) >= 0) label += ' (2)';
      // the group starts at the top of the page the block is on
      var start = b.line;
      for (j = b.line - 1; j >= 0 && j >= b.line - 12; j--) if (PAGE_LINE_RE.test(E.trimLine(raws[j]))) { start = j; break; }
      at[start] = label;
      names.push(label);
    });
    return { at: at, names: names };
  }

  // --- prose patterns (wave H, batch 2) -----------------------------------------
  //
  // Sandnes prints no row label at all: "Change to 6 mm circular ndl, k 1 rnd,
  // while" / "inc 8 sts evenly spaced = (56) 60 (64) 64 (68)" / "68 sts." The
  // Gutenberg books are plain text wrapped at 70 columns, one paragraph to a
  // pattern step or a whole pattern. Either way the printed lines say nothing
  // about where an instruction starts: the paragraph is joined and cut into its
  // sentences, one to a line, and the engine reads those. A sentence that
  // starts with a row label goes on while its next sentences are stitches
  // ("Second row—knit the 3 first stitches; * pearl 2, knit 2. Repeat from *
  // until ..."). Headings (a line in capitals, a "=Bold.=" / "_Title._" line, a
  // lone lower-case word such as "children") stay lines of their own.

  var WORD_ORD = 'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|(?:twenty|thirty|forty)[-\\s]?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)?|thirtieth|fortieth';
  // a printed row label at a line start: "Row 3:", "3rd row:", "1st round--",
  // "First row—", "Twenty-first row—", "2, 3, 4. Knit 2", "1. Purl 2"
  var ANY_ROW_LABEL_RE = new RegExp('^\\s*(?:[-*]\\s*)?(?:(?:short[-\\s]?)?(?:rows?|rnds?|rounds?)\\s*\\d+[^:.]{0,40}[:.]|\\d+\\s*(?:st|nd|rd|th|d)\\s+(?:row|rnd|round)s?\\b|(?:' + WORD_ORD + ')\\s+(?:row|rnd|round)s?\\b|\\d+(?:\\s*,\\s*\\d+)*\\.\\s+[A-Z])', 'i');

  function isProseHeading(t) {
    if (!t) return false;
    if (/^=[^=]{2,80}=\s*(?:--.*)?$/.test(t) && !/--/.test(t)) return true;  // "=STOCKINGS.=" alone
    if (/^_[^_]{2,80}_$/.test(t)) return true;                               // "_Lady's Winter Stocking._"
    if (/^(?:sizes|numbers)\s*:\s*\S/i.test(t)) return true;                 // a part's carried "Sizes: S, M, L"
    if (/^[a-z]{3,12}$/.test(t)) return true;                                // "children"
    var letters = t.replace(/[^A-Za-z]/g, '');
    return letters.length >= 3 && letters === letters.toUpperCase() && t.split(/\s+/).length <= 9 && !/[.!?]\s*\S/.test(t);
  }

  function proseDocKind(raws) {
    var pages = 0, labels = 0, blanks = 0, instr = 0, named = 0;
    for (var i = 0; i < raws.length; i++) {
      var t = String(raws[i]).trim();
      if (!t) { blanks++; continue; }
      if (PAGE_LINE_RE.test(t)) { pages++; continue; }
      if (ANY_ROW_LABEL_RE.test(t)) labels++;
      // (Interweave prints its row labels inside the paragraphs: "...as foll:
      // Short-row 1 (RS) K25, wrap next st, turn." - a numbered pattern still)
      // ("Rep inc on alt rnds 17 (20, 21) times" is a count of rounds, not a label)
      named += (t.match(/\b(?:rows?|rnds?|rounds?|short-rows?)\s+\d+\b(?!\s*(?:\(|times\b|more\b))|\b\d+(?:st|nd|rd|th)\s+(?:rows?|rnds?|rounds?)\b/gi) || []).length;
      if (/\b(?:cast\s+on|co)\s+(?:loosely\s+)?\(?\d+|\b(?:knit|k|work)\s+\(?\d+\)?\s*(?:\(\d+\)\s*)*(?:plain\s+)?(?:rnds?|rounds?|rows?)\b/i.test(t)) instr++;
    }
    // a Gutenberg book: no pages, paragraphs between blank lines
    if (!pages && blanks >= 20 && raws.length >= 200) return 'txt';
    // a PDF pattern with instructions and (almost) no row label
    if (pages && instr >= 3 && labels <= 2 && named <= 2) return 'pdf';
    // ...and one part of such a pattern, read on its own (the counter parses one
    // part at a time): sentences, (almost) no row label at all
    if (!pages && labels <= 1 && named <= 1 && instr >= 2 && raws.length >= 3) return 'pdf';
    return null;
  }

  /** The sentences of `s` (a joined paragraph), a row's stitch sentences kept with it. */
  function proseSentences(s) {
    var out = [], from = 0, guard = 0;
    while (from < s.length && guard++ < 400) {
      var rest = s.slice(from).replace(/^\s+/, '');
      if (!rest) break;
      var at = s.length - rest.length;
      var isRow = ANY_ROW_LABEL_RE.test(rest) || /^next\s+(?:\d+\s+)?(?:rows?|rnds?|rounds?)\b/i.test(rest);
      var end = sentenceEnd(s, at + 1, isRow, false);
      // ...and a heading run into the sentence ("HEEL: At beg of round ...",
      // "START TO TURN HEEL: 1st ROW: K 20") is a line of its own
      var hd = /^([A-Z][A-Z '&\/-]{2,40}):\s+(?=\S)/.exec(rest);
      if (hd && !ANY_ROW_LABEL_RE.test(rest)) { out.push(hd[1] + ':'); from = at + hd[0].length; continue; }
      if (end < 0 || end <= at) { out.push(rest.trim()); break; }
      out.push(s.slice(at, end).trim());
      from = end;
    }
    return out;
  }

  // A one-line paragraph that names a pattern ("Knitted Slippers with Ermine
  // Trimming", "Ladies' Knitted Gloves with Fancy Backs") - Gutenberg books
  function isTitleLine(t) {
    if (!t || t.length > 70 || /[,;:]$/.test(t) || /^\d/.test(t)) return false;
    var words = t.replace(/[.]$/, '').split(/\s+/);
    if (words.length > 9) return false;
    var caps = words.filter(function (w) { return /^[A-Z0-9'"‘“(]/.test(w); }).length;
    var small = words.filter(function (w) { return /^(?:a|an|the|and|or|of|for|with|to|in|on|at|by)$/.test(w); }).length;
    return caps >= 1 && caps + small === words.length && !/\.\s/.test(t);
  }

  // "knit ten rounds", "Cast 18 stitches on each of three needles", "knit
  // two and one-half inches" - numbers in words before what they count
  var WORD_NUMS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
    twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  var WORD_NUM_G = /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s](one|two|three|four|five|six|seven|eight|nine))?\b|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/gi;
  var WORD_NUM_AFTER = /^(?:\s+(?:and\s+(?:one|a)[-\s](?:half|quarter)\s+)?(?:more\s+|plain\s+|rows?\s+of\s+)?(?:stitch(?:es)?|sts?|rounds?|rnds?|rows?|ribs?|times|inches|inch|needles?|pins?|patterns?|intakes?|narrowings?|widenings?|stitches)\b)/i;

  function wordNumbers(s) {
    return String(s).replace(WORD_NUM_G, function (all, tens, ones, unit, off, whole) {
      if (!WORD_NUM_AFTER.test(whole.slice(off + all.length))) return all;
      var v = tens ? WORD_NUMS[tens.toLowerCase()] + (ones ? WORD_NUMS[ones.toLowerCase()] : 0) : WORD_NUMS[unit.toLowerCase()];
      return String(v);
    });
  }

  function proseLines(raws) {
    var kind = proseDocKind(raws);
    if (!kind) return null;
    E.run().proseKind = kind;
    var out = [], para = [], i;
    // (Gutenberg: the licence before "*** START OF ..." and after "*** END OF
    // ..." is not the book)
    var from = 0, to = raws.length;
    if (kind === 'txt') {
      for (i = 0; i < raws.length; i++) {
        var gt = String(raws[i]).trim();
        if (/^\*{3}\s*start\s+of\b/i.test(gt)) from = i + 1;
        else if (/^\*{3}\s*end\s+of\b/i.test(gt)) { to = i; break; }
      }
    }
    var knitSeen = false, crochetTail = false;
    // (...and it ends at the next pattern of the book: a heading with its
    // "Materials Required:" under it and a cast-on in its first lines - Begin to
    // Knit's CLAM DIGGERS SHELL after its BASIC CROCHET page)
    function knitPatternAhead(at) {
      var mat = false;
      for (var q = at + 1; q < to && q <= at + 40; q++) {
        var u = String(raws[q]).trim();
        if (q <= at + 14 && /^materials?\s+(?:required|needed)\s*:/i.test(u)) mat = true;
        if (mat && /\bcast\s+on\s+\d+/i.test(u)) return true;
      }
      return false;
    }
    function flush() {
      if (!para.length) return;
      var s = para.join(' ').replace(/\s+/g, ' ').replace(/(\d)-\s+(?=\d)/g, '$1-');
      if (kind === 'txt') {
        // "=For an Infant.=--Knitted with merino wool--Needles, No. 18. Cast
        // on 80 stitches." - the bold title is the pattern's name
        var bt = /^=([^=]{2,80})=\s*(?:--|—)?\s*/.exec(s);
        if (bt) { out.push('=' + bt[1].trim() + '='); s = s.slice(bt[0].length); }
        else if (para.length === 1 && isTitleLine(s)) { out.push(s); para = []; return; }
        s = wordNumbers(s);
        if (/\bcast\s+(?:on\s+)?\d+/i.test(s)) knitSeen = true;
      }
      if (s) proseSentences(s).forEach(function (x) { if (x) out.push(x); });
      para = [];
    }
    for (i = from; i < to; i++) {
      var raw = String(raws[i]), t = raw.trim();
      // (a book of knitting and crochet: from its first crochet heading after
      // the knitting the text is crochet, which the knitting reader leaves out)
      if (kind === 'txt' && !para.length && knitSeen && t.length < 60 && /\bcrochet(?:ed|ing)?\b/i.test(t) && !/\bknit/i.test(t) && (isProseHeading(t) || isTitleLine(t))) crochetTail = true;
      else if (kind === 'txt' && crochetTail && !para.length && (isProseHeading(t) || isTitleLine(t)) && (/\bknit/i.test(t) || knitPatternAhead(i))) crochetTail = false;
      if (crochetTail) continue;
      if (!t || PAGE_LINE_RE.test(t)) { flush(); out.push(raw); continue; }
      // (Gutenberg: the transcriber's "[Illustration: ...]" is not text)
      if (kind === 'txt' && /^\[illustration\b/i.test(t)) { flush(); continue; }
      if (isProseHeading(t) && (kind !== 'txt' || !para.length)) { flush(); out.push(t); continue; }
      // a line that starts a row label starts a new sentence run in a PDF
      if (kind === 'pdf' && ANY_ROW_LABEL_RE.test(t)) flush();
      para.push(t);
    }
    flush();
    return out;
  }

  // --- a Gutenberg book's patterns, one group each -------------------------------
  // "=For an Infant.=", "_Lady's Winter Stocking._", "Ladies' Knitted Gloves with
  // Fancy Backs", "PLAIN SOCKS FOR A GO-GO GUY": a title with a cast-on under it
  // before the next title is a pattern of its own.
  function titleGroups(raws) {
    if (E.run().proseKind !== 'txt') return null;
    var cands = [], i;
    for (i = 0; i < raws.length; i++) {
      var t = E.trimLine(raws[i]);
      if (!t) continue;
      var bt = /^=([^=]{2,80})=$/.exec(t) || /^_([^_]{2,80})_$/.exec(t);
      var caps = isProseHeading(t) && !/^[a-z]+$/.test(t) && !/^(?:sizes|numbers)\s*:/i.test(t);
      if (!(bt || caps || isTitleLine(t))) continue;
      // (a materials line in capitals - "AMERICAN THREAD COMPANY "DAWN" NYLON" -
      // and a NOTE are not pattern titles)
      if (/\b(?:yarns?|thread|company|nylon|wool|needles?|materials?|required|gauge|ozs?|skeins?|balls?|note)\b/i.test(t) && !bt) continue;
      var cn = (bt ? bt[1] : t).replace(/[.:\s]+$/, '').replace(/\s+/g, ' ').trim();
      // "_Lady's Striped Silk Stocking._" / "(MEDIUM SIZE.)" - a subtitle goes
      // with the title above it
      var sub = /^\(\s*([^()]{2,40}?)\s*\.?\s*\)$/.exec(cn);
      if (sub && cands.length && i - cands[cands.length - 1].line <= 3) {
        cands[cands.length - 1].name += ' (' + (/[a-z]/.test(sub[1]) ? sub[1] : E.titleCase(sub[1].toLowerCase())) + ')';
        continue;
      }
      cands.push({ line: i, name: cn });
    }
    // A booklet that heads each pattern with "Materials Required:" (Begin to
    // Knit): a pattern's title is the line above its materials (past a "Size:"
    // line), and a heading with no materials under it is a group only when it
    // stands alone after a gap (FIVE FANCY STITCHES) and is no part's name
    // (SWEATER, SLEEVES, BACK under "FOR THE YEARLING ... the sweater"). A
    // materials line ("Plastic Crochet Hook Size G") or a label ("SEED ST
    // BLOCK: With Lime cast on ...") is never a title.
    var MAT_RE = /^materials?\s+(?:required|needed)\s*:/i, matLines = [];
    for (i = 0; i < raws.length; i++) if (MAT_RE.test(E.trimLine(raws[i]))) matLines.push(i);
    if (matLines.length >= 2) {
      var led = [], usedLine = {};
      matLines.forEach(function (ml) {
        for (var u = ml - 1; u >= 0 && u >= ml - 12; u--) {
          var tu = E.trimLine(raws[u]);
          if (!tu || /\bsizes?\b|^\(?\d|\bmonths?\b|\byears?\b|^directions\b|^approximate\b/i.test(tu) || /^\[illustration\b/i.test(tu)) continue;
          if (tu.length > 70 || /[.;:,]$/.test(tu) || MAT_RE.test(tu)) break;
          if (!usedLine[u]) { usedLine[u] = true; led.push({ line: u, name: tu.replace(/\s+/g, ' ').replace(/\s*[—–]\s*/g, '-') }); }
          break;
        }
      });
      cands.forEach(function (c) {
        if (usedLine[c.line]) return;
        var tc = E.trimLine(raws[c.line]), blank = 0;
        for (var u2 = c.line - 1; u2 >= 0 && !E.trimLine(raws[u2]); u2--) blank++;
        if (blank >= 3 && !/:$/.test(tc) && !PART_NOUN_RE.test(c.name) && !/\bsizes?\b|^\(?\d/i.test(c.name) &&
            !/\b(?:sweater|booties?|hat|mittens?|socks?|pullover|cardigan|slipover|vest)\b/i.test(c.name) &&
            !/\b(?:hook|needles?|yarn|worsted|skeins?|ounces?|crochet)\b/i.test(c.name)) led.push(c);
      });
      led.sort(function (a, b) { return a.line - b.line; });
      cands = led;
    }
    var at = {}, names = [], prev = null;
    for (var k = 0; k < cands.length; k++) {
      var end = k + 1 < cands.length ? cands[k + 1].line : raws.length, cast = false;
      for (i = cands[k].line + 1; i < end && !cast; i++) if (/\bcast\s+(?:on\s+)?\d+|\bcast\s+\d+\s+st/i.test(String(raws[i]))) cast = true;
      if (!cast) continue;
      var nm = cands[k].name, same = /^(?:for\s+)?the\s+same$/i.test(nm) && prev;
      if (same) nm = prev;
      if (!/[a-z]/.test(nm)) nm = E.titleCase(nm.toLowerCase());
      var base = nm, q = 2;
      while (names.indexOf(nm) >= 0) nm = base + ' (' + (q++) + ')';
      at[cands[k].line] = nm;
      names.push(nm);
      // ("For the same." - the pattern above it, in another yarn)
      if (!same) prev = base;
    }
    return names.length >= 2 ? { at: at, names: names } : null;
  }

  // "(48) 52 (56) 56 (60) 60 sts", "k(5) 6 (7) 8 (8) 9 sts", "(S) M (L) XL (XXL)"
  // - Sandnes writes every other size in brackets; that is one value per size in
  // order, not a number and its "other sizes". Rewritten into the "48 (52, 56,
  // 56, 60, 60)" form the rest of this file reads, in documents whose own size
  // line is written that way.
  var ALT_NUM = '\\d+(?:[.,]\\d+)?(?:\\s?[½¼¾])?|[½¼¾]';
  var ALT_RUN_G = new RegExp('\\(\\s*(' + ALT_NUM + ')\\s*\\)\\s*(' + ALT_NUM + ')((?:\\s*\\(\\s*(?:' + ALT_NUM + ')\\s*\\)\\s*(?:' + ALT_NUM + ')?)+)', 'g');
  var ALT_SIZE_LINE_RE = /^\(\s*[A-Za-z0-9½]{1,4}\s*\)\s*[A-Za-z0-9½]{1,4}(?:\s*\(\s*[A-Za-z0-9½]{1,4}\s*\)\s*(?:[A-Za-z0-9½]{1,4})?){1,}\s*(?:yrs?|years?|months?|mths?|cm|")?\s*$/;

  function altSizeDoc(lines) {
    var n = 0;
    for (var i = 0; i < lines.length; i++) if (ALT_SIZE_LINE_RE.test(String(lines[i]).trim())) n++;
    return n > 0;
  }

  function altVectors(lines) {
    if (!altSizeDoc(lines)) return lines;
    return lines.map(function (l) {
      return String(l).replace(ALT_RUN_G, function (all, a, b, more) {
        var vals = [a, b], m, re = new RegExp('\\(\\s*(' + ALT_NUM + ')\\s*\\)\\s*(' + ALT_NUM + ')?', 'g');
        while ((m = re.exec(more)) !== null) { vals.push(m[1]); if (m[2]) vals.push(m[2]); }
        if (vals.length < 3) return all;
        return vals[0].replace(/\s+/g, '') + ' (' + vals.slice(1).map(function (v) { return v.replace(/\s+/g, ''); }).join(', ') + ')' + (/\s$/.test(all) ? ' ' : '');
      });
    });
  }

  // A chart's title printed over its row labels ("Back and Sleeve Lace" / "20"
  // / "18" / ... or "Lace" / "61" / "59" ...) is the chart's name, never a part
  // heading - left as one, it took the back's armhole rows away from the Back.
  var CHART_LABEL_RE = /^(?:\d{1,3}|knit|purl|yo|k2tog|ssk|k3tog|sk2p|no\s+stitch|pattern\s+repeat|\d{1,3}\s*-?\s*st\s+rep(?:eat)?)$/i;
  function markChartTitles(out) {
    var run = E.run(), titles = {};
    for (var i = 0; i < out.length; i++) {
      var t = String(out[i]).trim();
      if (!t || t.length > 40 || /[.:;,]$/.test(t) || /\d/.test(t) || !/^[A-Z]/.test(t)) continue;
      var nums = 0, seen = 0;
      for (var k = i + 1; k < out.length && seen < 8; k++) {
        var n = String(out[k]).trim();
        if (!n) continue;
        seen++;
        if (/^\d{1,3}$/.test(n)) nums++;
        else if (!CHART_LABEL_RE.test(n)) break;
      }
      if (nums >= 4) titles[t.toLowerCase()] = true;
    }
    run.chartTitles = titles;
  }

  // --- the hooks -------------------------------------------------------------

  function ensureFields(L) {
    if (L.side === undefined) L.side = null;
    if (L.delta === undefined) L.delta = null;
    if (L.until === undefined) L.until = null;
    if (L.markers === undefined) L.markers = null;
    if (L.shortRow === undefined) L.shortRow = false;
    if (L.chart === undefined) L.chart = null;
    if (L.cable === undefined) L.cable = null;
    if (L.net === undefined) L.net = null;
  }

  /** How much ONE working of `row` changed the count, from the line that carries it. */
  function rowDelta(lines, section, row) {
    // a row an earlier repeat added ("Knit 5 rnds even"): its own count
    for (var v = 0; v < lines.length; v++) {
      var vl = lines[v];
      if (vl && vl.kind === 'repeat' && vl.section === section && vl.counts && vl.countsFrom >= 1 &&
          row >= vl.countsFrom && row < vl.countsFrom + vl.counts.length) {
        var vi = row - vl.countsFrom;
        return vl.counts[vi] - (vi ? vl.counts[vi - 1] : vl.countsStart);
      }
    }
    var src = E.refLineAt(lines, section, row);
    if (!src) return null;
    if (typeof src.net === 'number' && src.repeatOf === null) return typeof src.delta === 'number' ? src.delta : src.net;
    if (src.counts && src.row >= 1 && !src.rowList) {
      var i = row - src.row;
      var before = i === 0 ? src.prevCount : src.counts[i - 1];
      var after = src.counts[i];
      return (typeof before === 'number' && typeof after === 'number') ? after - before : null;
    }
    if (typeof src.count !== 'number' || typeof src.prevCount !== 'number') return null;
    var span = src.rowList ? src.rowList.length : (src.rowEnd - src.row + 1);
    if (span === 1) return src.count - src.prevCount;
    // a range that changes the count, with no per-row counts, cannot be split
    return src.count === src.prevCount ? 0 : null;
  }

  /**
   * "Rep Rows 3-4 60 more times. (255 sts)" - every repeated row gets its own
   * count, so the shaping keeps going (row 7 of a growing shawl is not row 3's
   * count). L.counts[i] is the count of row L.countsFrom + i; a printed total
   * is the last row's and wins.
   */
  function repeatRowCounts(L, info) {
    var sec = info.section;
    var last = (typeof L.repeatAfter === 'number') ? L.repeatAfter : sec.lastRow;
    if (!L.repeatOf || !L.repeatOf.length || L.repeatLength || last === null || last === undefined) return;
    if (L.repeatOf[L.repeatOf.length - 1] > last) return;
    var nRows = 0;
    if (L.repeatUntil > last) nRows = L.repeatUntil - last;
    else if (L.repeatTimes >= 1) nRows = (L.repeatTimes - (L.repeatMore ? 1 : 0)) * L.repeatOf.length;
    if (!(nRows >= 1) || nRows > 2000) return;
    var start = sec.prevCount;
    // the rows in between cannot be counted, but the printed total is the LAST
    // row's ("Rep last 2 short-rows 3 (4, 5) more times...—18 (20, 22) heel sts
    // rem"): it goes there, the rows before it say nothing
    function lastOnly() {
      if (L.count === null || L.count === undefined || L.countSource !== 'explicit') return;
      var cs = [];
      for (var z = 0; z < nRows - 1; z++) cs.push(null);
      cs.push(L.count);
      L.counts = cs;
      L.countsFrom = last + 1;
    }
    if (typeof start !== 'number') { lastOnly(); return; }
    var deltas = [];
    // "Knit 5 rnds even" / "Work a further 14 rows even": plain rows, whatever
    // the row before them did
    L.even = (/\beven\b/i.test(String(L.text)) ||
      /^(?:then\s+)?(?:knit|purl)\s+\d+\s*(?:\([^)]*\)\s*)?(?:more\s+)?(?:rnds?|rows?|rounds?)\b/i.test(String(L.text)) ||
      // "Work 5 rows in St st." / "Work 6 rows of division patt" (QA: the
      // Henley neckband grew +4 a row through its plain rows)
      /^(?:then\s+)?work\s+\d+\s*(?:\([^)]*\)\s*)?(?:more\s+)?(?:rnds?|rows?|rounds?)\s+(?:in\s+(?:st(?:ockinette)?\s*st(?:itch)?|stockinette|garter(?:\s+st)?|rib(?:bing)?|seed\s+st|moss\s+st)|of\s+[a-z ]{0,30}?patt(?:ern)?)\b/i.test(String(L.text)) ||
      // "Cont St-st in rnds until garment meas 32 cm" (Sandnes)
      /^(?:then\s+)?cont(?:inue)?\s+(?:in\s+)?(?:st-?st|st\s+st|stockinette|stocking\s+st)\b/i.test(String(L.text))) &&
      !/\b(?:inc|dec|m1|k2tog|ssk|evenly)\b/i.test(String(L.text));
    // "Rep inc on alt rnds a total of 11 times" - the increase round, then a
    // plain round before the next one: the block is (plain, increase)
    var altInc = /\b(?:alt(?:ernate)?|other)\s+(?:rnds?|rows?|rounds?)\b/i.test(String(L.text)) &&
      /^rep(?:eat)?\s+(?:the\s+)?(?:inc|dec)/i.test(String(L.text));
    if (altInc && L.repeatOf.length === 2) {
      var dl = rowDelta(info.lines || [], L.section, L.repeatOf[1]);
      if (dl === null) { lastOnly(); return; }
      L.repeatDeltas = [0, dl];
    }
    for (var q = 0; q < L.repeatOf.length; q++) {
      var d = L.even ? 0 : L.repeatDeltas ? L.repeatDeltas[q] : rowDelta(info.lines || [], L.section, L.repeatOf[q]);
      if (d === null) { lastOnly(); return; }
      deltas.push(d);
    }
    var counts = [], c = start;
    for (var r = 0; r < nRows; r++) {
      c += deltas[r % deltas.length];
      if (c < 0) return;
      counts.push(c);
    }
    if (L.count !== null && L.count !== undefined) {
      if (counts[counts.length - 1] !== L.count) {
        L.deviation = { printed: L.count, computed: counts[counts.length - 1] };
      }
      counts[counts.length - 1] = L.count;
    } else {
      L.computed = counts[counts.length - 1];
      L.count = L.computed;
      L.countSource = 'computed';
    }
    L.counts = counts;
    L.countsFrom = last + 1;
    L.countsStart = start;
  }

  // A printed line that carries on the row above it. Knitting rows are long and
  // Yarnspirations ends every stitch with a full stop ("K1. PM. K2. PM."), so
  // a line that starts with a stitch is the rest of the row whatever the line
  // above ended with.
  // (Patons: "T3B. T3F. P1." / "Cr4B. P2." / "psso. yo. K2." / "Rib to end of
  // row." / "Pat to last 4 sts." on the next printed line)
  var CONT_START_RE = /^(?:[(\[*]|[-=—]\s*\d|\d+\s*(?:\([^)]*\)\s*)?(?:sts?|stitches)\b|(?:k|p)\d|(?:k|p)\b|k2tog|p2tog|ssk|ssp|sl\b|sl\s*\d|slip\b|m1|yo\b|pm\b|sm\b|rm\b|kfb|pfb|knit\b|purl\b|rep(?:eat)?\b|remove\b|place\b|join\b|turn\b|work\b|c\d+[fb]\b|needle\s*\d|\*|(?:c|t|cr|tw)\d+[fblr][kp]?\b|psso\b|rib\b|patt?\b|\d+\s*(?:\([^)]*\)?\s*)?(?:times?|time\(s\))\b|\d+\s*\(\s*\d+\s*[-,]|ssk\b)/i;
  // (...and "****Row 7: 40 stitch sock only: ..." - a row written for some sizes,
  // flagged with asterisks: never the tail of the row above)
  var CONT_STOP_RE = /^(?:all\s+sizes|sizes?\b[^:]{0,60}only|note|change\s+to|proceed|cast\s+off|bind\s+off|bo\s+all|finishing|weave\s+in|block\b|[*#]{2,}\s*(?:rows?|rnds?|rounds?)\s*\d)/i;

  function knitContinues(ct, cls, t) {
    if (!ct) return false;
    // (a prose pattern is already one sentence to a line)
    if (E.run().prose) return false;
    if (CONT_STOP_RE.test(ct)) return false;
    var t0 = String(t || '').replace(/^[A-Za-z][A-Za-z '&\/-]{1,38}:\s*/, '');
    if (cls.setup && (PICKUP_LINE_RE.test(t0) || FROM_HOLDER_LINE_RE.test(t0)) &&
        (PICKUP_LINE_RE.test(ct) || FROM_HOLDER_LINE_RE.test(ct))) return true;
    // a dividing round goes on to its total (see DIVIDE_ROW_RE): the underarm
    // cast-on, then what it places, slips, knits and joins after it
    // ...and so does a part that starts from held stitches and casts on more
    // ("Sleeves: With RS of work facing slip 56 (...) sts from spare yarn onto
    // three larger double pointed needles." / "Cast on 6 (...) sts." / "Join in
    // rnd. Place marker ... for" / "beg of rnd. 62 (...) sts.")
    var fromHeld = FROM_HOLDER_LINE_RE.test(t0) &&
      (/^(?:co|cast\s+on)\s+\d+/i.test(ct) || /[.;]\s*(?:co|cast\s+on)\s+\d+/i.test(t0));
    if ((DIVIDE_ROW_RE.test(t) || fromHeld) && !DIVIDE_TOTAL_END_RE.test(t)) {
      if (/^(?:co|cast\s+on)\s+\d+/i.test(ct)) return true;
      var aside = t.search(/\b(?:spare|scrap|waste|holders?)\b/i);
      if (/\b(?:co|cast\s+on)\s+\d+[^.]*\bsts?\b/i.test(t.slice(aside)) &&
          /^(?:place|pm|slip|sl|knit|k\d|join|cast\s+on|co|work)\b/i.test(ct)) return true;
    }
    if (!cls.note) return false;
    // "Shoulder shaping: Cast off ... beg following 2 rows." / "Leave rem 44
    // (46-...) sts on a st holder." - what the rows leave
    if (/^(?:leave|leaving)\s+(?:the\s+)?rem(?:aining)?\s+\d+[^.]*\bsts?\b[^.]*\b(?:holder|spare\s+needle|scrap|waste)\b/i.test(ct) &&
        /\b(?:rows?|rnds?)\s*\.?\s*$/i.test(t)) return true;
    // "...Work 1st" / "row of Panel Pat B. P2. K3." - a panel row broken over the wrap
    if (/\bwork(?:\s+(?:the\s+)?\d+(?:st|nd|rd|th))?\s*$/i.test(t) && /^(?:\d+(?:st|nd|rd|th)\s+)?(?:row|rnd|round)\b/i.test(ct)) return true;
    // "...Work 1st row Cable" / "Panel C over 23 sts. P2." - the panel's name
    // broken over the wrap
    if (/\b[Ww]ork\s+(?:the\s+)?\d+(?:st|nd|rd|th)\s+(?:[Rr]ow|[Rr]nd|[Rr]ound)(?:\s+of)?(?:\s+[A-Z][a-z]+){1,2}\s*$/.test(t) && /^(?:[A-Z][a-z]+|[A-Z0-9])\b/.test(ct) &&
        /\b(?:panel|pat|patt|pattern|chart|cable)\b/i.test(t.slice(-30) + ' ' + ct.slice(0, 20))) return true;
    // "...Work 1st row" / "Cable Panel C. (P2. K2) 1 (1-2-3-" - the panel's name
    if (/\bwork\s+(?:the\s+)?\d+(?:st|nd|rd|th)\s+(?:row|rnd|round)(?:\s+of)?\s*$/i.test(t) && /^(?:the\s+)?(?:[A-Z][a-z]+\s+){0,2}(?:panel|pat|patt|pattern|chart)\b/i.test(ct)) return true;
    // "...Work 2nd row of Panel Pat" / "B. (K2. P3) twice. K2." - the panel's letter
    if (/\b(?:panel|pat|patt|pattern|chart)\s*$/i.test(t) && /^[A-Z0-9]{1,2}\b[.,;:]?(?:\s|$)/.test(ct) && /\bwork\b[^.]*$/i.test(t)) return true;
    // "...rep from * once more—4 sts" / "dec'd." - the rest of a dash total
    if (/^(?:inc|dec)(?:'d|reased|d)?\b|^(?:sts?|stitches)\b/i.test(ct) && /\d\s*(?:\([^)]*\))?\s*(?:[a-z]+\s+)?(?:sts?)?\s*$/i.test(t)) return true;
    if (!/^[a-z([*]/.test(ct) && !CONT_START_RE.test(ct)) return false;
    // ...and reads as instructions
    return /\b(?:sts?|stitch(?:es)?|k\d*|p\d*|knit|purl|sl|ssk|k2tog|p2tog|m1|yo|pm|sm|marker|rep|end|around|across|rnds?|rows?|needles?|holder|scrap|turn|wrap|w&t|mc|cc\d?)\b|\d/i.test(ct);
  }

  var PIECE_END_RE = /\b(?:bind|cast)\s+off\b(?!\s+\d)|\bbo\b(?!\s+\d)|\bfasten\s+off\b|\bgraft\b|\bkitchener\b|\b(?:place|put|slip|leave)\s+(?:all\s+)?(?:rem(?:aining)?\s+)?sts?\s+(?:on|onto)\s+(?:a\s+)?(?:holder|scrap|waste)/i;

  function inScope(scope, size) {
    return !scope || !scope.indices || scope.indices.indexOf(size) >= 0;
  }

  // A length stretch before any written row: "BODY / Knit even in rnds on these
  // 120 sts until Body from Sleeve divide measures 12" ... / Next rnd: *K1tbl.
  // P1..." - the rib is not round 1, it comes after the ~90 plain rounds. When
  // the length is measured from where the part starts (the divide, the cast-on,
  // the pick-up, "a further") and the pattern prints its gauge, the stretch
  // takes its ≈ rows (Line.approxRows) and the rows after it are numbered on
  // from there. Without a gauge, or measured from somewhere else, nothing is
  // renumbered (no invented row numbers).
  var LOCAL_ANCHOR_RE = /\bfrom\s+(?:the\s+)?(?:sleeve\s+|armhole\s+|underarm\s+)?(?:divide|division|cast[-\s]?on|co\b|pick[-\s]?up|beg(?:in(?:ning)?)?\b|join(?:ing)?\b|underarm|marker|here|this\s+point)|\b(?:a\s+further|another)\b/i;

  function shiftRows(L, by) {
    if (typeof L.row === 'number') L.row += by;
    if (typeof L.rowEnd === 'number') L.rowEnd += by;
    if (L.rowList) L.rowList = L.rowList.map(function (r) { return r + by; });
    if (typeof L.repeatFrom === 'number') L.repeatFrom += by;
    if (typeof L.repeatTo === 'number') L.repeatTo += by;
    if (L.repeatOf) L.repeatOf = L.repeatOf.map(function (r) { return r + by; });
    if (typeof L.countsFrom === 'number') L.countsFrom += by;
  }

  function untilSpans(lines, info) {
    var g = null;
    try { g = E.gauge(info.text); } catch (e) { g = null; }
    if (!g || !(g.rowsPer4in > 0 || g.rowsPer10cm > 0)) return;
    var secs = {};
    lines.forEach(function (l) { if (!l.consumed) (secs[l.section] = secs[l.section] || []).push(l); });
    Object.keys(secs).forEach(function (k) {
      var ls = secs[k], at = -1, q;
      for (q = 0; q < ls.length; q++) {
        var l = ls[q];
        if (l.kind === 'row' && l.row >= 1) return;              // rows came first: nothing to do
        if (l.kind === 'repeat' && l.until && l.until.kind === 'length' && l.until.value > 0 &&
            !l.repeatOf && !(l.row >= 1) && LOCAL_ANCHOR_RE.test(String(l.text))) { at = q; break; }
      }
      if (at < 0) return;
      var later = ls.slice(at + 1).filter(function (l) { return l.kind === 'row' && l.row >= 1; });
      if (!later.length || Math.min.apply(null, later.map(function (l) { return l.row; })) !== 1) return;
      // only rows the parser numbered ("Next rnd") move; a printed "Row 1 (RS)"
      // keeps the number the pattern gives it (Boot: the heel flap's rows)
      if (later.some(function (l) { return /^\s*(?:[-*]\s*)?(?:(?:short[-\s]?)?(?:rows?|rnds?|rounds?)\s*\d|\d+\s*(?:st|nd|rd|th)\s+(?:row|rnd|round))/i.test(String(l.text)); })) return;
      var rpu = E.rowsPerUnit(g, ls[at].until.unit);
      var est = rpu ? Math.round(ls[at].until.value * rpu) : 0;
      if (!(est >= 1 && est <= 2000)) return;
      var U = ls[at];
      U.row = 1; U.rowEnd = est; U.approxRows = est;
      if ((U.count === null || U.count === undefined) && /\beven\b/i.test(String(U.text))) {
        var pc = typeof U.prevCount === 'number' ? U.prevCount : null;
        for (q = at - 1; q >= 0 && pc === null; q--) if (typeof ls[q].count === 'number' && /^(?:setup|row|repeat)$/.test(ls[q].kind)) pc = ls[q].count;
        if (pc !== null) { U.count = U.computed = pc; U.countSource = 'computed'; }
      }
      for (q = at + 1; q < ls.length; q++) shiftRows(ls[q], est);
      var sec = info.sections && info.sections[+k];
      if (sec) {
        if (typeof sec.lastRow === 'number') sec.lastRow += est;
        if (typeof sec.maxRow === 'number') sec.maxRow += est;
        sec.rows += est;
      }
    });
  }

  // A pattern stretch after the written rows: "1st row: ... Work 1st row of
  // Panel Pat C ..." / "2nd row: ..." / "Cont in pat, keeping cont of Panel
  // Pats ..., until work from beg measures 15½", ending on a WS row." (Patons).
  // With the gauge printed, the stretch is ≈ so many rows of the pattern rows
  // (Line.approxRows, repeatEstimated), each one working the rows it repeats -
  // and the panels go on from where the written rows left them (see
  // PANEL_SHIFT). The rows after it are numbered on from there. Measured from
  // the cast-on ("from beg", or no anchor) the rows already worked count:
  // the part's own, and those before it when the part goes on from another
  // ("(About 14 rows worked from the cast-on.)", carried by carryIntoParts);
  // measured from the armhole, the rows since its shaping began. Anything
  // else ("from markers") is left as it is.
  var PAT_STRETCH_RE = /^(?:[A-Za-z ,\/]{1,40}:\s*)?(?:(?:cont(?:inue)?|work)\s+(?:even\s+)?(?:in\s+)?(?:[A-Za-z ]{0,20}?\s)?pat(?:t|tern)?\b|pat(?:t|tern)?\s+for\b|rep(?:eat)?\s+(?:the\s+)?last\s+\d+\s+rows\b)/i;
  var CARRIED_ROWS_RE = /^\(about\s+(\d+)\s+rows\s+worked\s+from\s+the\s+cast[-\s]on\.\)$/i;

  function patternStretches(lines, info) {
    var g = null;
    try { g = E.gauge(info.text); } catch (e) { g = null; }
    var out = {};
    // (without a gauge no length becomes rows; the shaping stretches -
    // shapeEvery - need none)
    if (E.run().prose) return out;
    if (!(g && (g.rowsPer4in > 0 || g.rowsPer10cm > 0))) g = null;
    var bySec = {}, order = [];
    lines.forEach(function (l) {
      if (l.consumed) return;
      if (!bySec[l.section]) { bySec[l.section] = []; order.push(l.section); }
      bySec[l.section].push(l);
    });
    var prevEnd = null;
    order.forEach(function (k) {
      var ls = bySec[k], sec = info.sections && info.sections[+k];
      // (a cast-on or pick-up of its own - "**With smaller needles, cast on 130" - not a carried "Start with")
      var hasStart = ls.some(function (l) { var tt = E.trimLine(l.text).replace(/^[*\s]+/, '').replace(/^[A-Za-z ]{2,30}:\s*/, ''); return l.kind === 'setup' && (CO_LINE_RE.test(tt) || PICKUP_LINE_RE.test(tt)); });
      var carried = null;
      ls.forEach(function (l) { var m = CARRIED_ROWS_RE.exec(E.trimLine(l.text)); if (m) carried = int(m[1]); });
      // where the piece's rows started: here (a cast-on), before this part
      // (carried), or - an unnamed part right after another - where that one
      // ended; else unknown
      var base = hasStart ? 0 : carried !== null ? carried : (sec && !sec.name && prevEnd !== null ? prevEnd : null);
      var cum = 0, lastRow = 0, block = null, armAt = null, side1 = null;
      // lengths worked with no rows of their own ("Work 2½" [6 cm] in Twisted
      // Ribbing Pat") count as ≈ rows; a "...measures" one left as words makes
      // the rows before unknown
      var lenRows = 0, lenUnknown = false, unknownAt = null;
      var rpu0 = null;
      function lenOf(L2) {
        if (rpu0 === null) rpu0 = {};
        var u = L2.until.unit;
        if (rpu0[u] === undefined) rpu0[u] = (g && E.rowsPerUnit(g, u)) || 0;
        if (/\bmeas(?:ures?)?\b/i.test(String(L2.text)) || !(rpu0[u] > 0)) { lenUnknown = true; return; }
        lenRows += Math.round(L2.until.value * rpu0[u]);
      }
      for (var q = 0; q < ls.length; q++) {
        var l = ls[q];
        if (cum) shiftRows(l, cum);
        if (l.kind === 'row' && l.row >= 1) {
          var end = l.rowList ? Math.max.apply(null, l.rowList) : (l.rowEnd || l.row);
          if (l.row === 1 && l.side) side1 = l.side;
          if (armAt === null && /\barmholes?\b/i.test(String(l.text))) armAt = l.row - 1;
          if (end > lastRow) lastRow = end;
          continue;
        }
        // "Cont knitting in rnds, dec 1 st at beg and end of rnd as before on
        // every following 10th (...) rnd from previous dec to 54 (...) sts, then
        // on every following 8th (...) rnd to 40 (...) sts." - so many rounds,
        // each counted, the decrease on the last of each group
        if (!(l.row >= 1) && !l.sizeSkip && lastRow >= 1 && (l.kind === 'note' || l.kind === 'repeat')) {
          var kc = null;
          for (var kq0 = q - 1; kq0 >= 0 && kc === null; kq0--) if (typeof ls[kq0].count === 'number' && /^(?:setup|row|repeat)$/.test(ls[kq0].kind) && !ls[kq0].sizeSkip) kc = ls[kq0].count;
          var se = kc !== null ? shapeEvery(String(l.text), kc) : null;
          if (se) {
            var srcRow = null;
            for (var kq1 = q - 1; kq1 >= 0 && srcRow === null; kq1--) {
              var o1 = ls[kq1];
              if (o1.kind === 'row' && o1.row >= 1 && typeof o1.count === 'number' && typeof o1.prevCount === 'number' &&
                  Math.sign(o1.count - o1.prevCount) === Math.sign(se.deltas[se.deltas.length - 1] || 0)) srcRow = o1.row;
            }
            l.kind = 'repeat';
            l.row = lastRow + 1; l.rowEnd = lastRow + se.counts.length;
            l.counts = se.counts; l.countsFrom = l.row;
            l.shapeRows = { deltas: se.deltas, src: srcRow };
            l.count = l.computed = se.counts[se.counts.length - 1]; l.countSource = 'computed';
            cum += se.counts.length;
            lastRow = l.rowEnd;
            if (sec) {
              if (typeof sec.lastRow === 'number') sec.lastRow += se.counts.length;
              if (typeof sec.maxRow === 'number') sec.maxRow += se.counts.length;
              sec.rows += se.counts.length;
            }
            continue;
          }
        }
        // a counted repeat goes on from the last row ("Rep last 4 rows 1 time
        // more" - rows 85-88); one that says no rows ("Cont in pat, inc 1 st
        // each end of ... every following 6th row until there are 59 sts")
        // leaves where the piece stands unknown from here
        if (l.kind === 'repeat' && !(l.row >= 1) && !(l.until && l.until.kind === 'length')) {
          if (typeof l.repeatTo === 'number' && l.repeatTo >= l.repeatFrom) { if (l.repeatTo > lastRow) lastRow = l.repeatTo; }
          else if (l.repeatOf && l.repeatTo === l.repeatFrom - 1) { /* "0 times more" */ }
          else { lenUnknown = true; unknownAt = lastRow; }
          continue;
        }
        if (!l.until || l.until.kind !== 'length' || !(l.until.value > 0) || l.row >= 1) continue;
        if (l.kind !== 'repeat' || !(lastRow >= 1) || !PAT_STRETCH_RE.test(String(l.text))) { lenOf(l); continue; }
        // the rows it works: "Rep last 2 rows" says; else the pattern rows
        // the part opened with (from row 1, while the count stands)
        var lastN = /\brep(?:eat)?\s+(?:the\s+)?last\s+(\d+)\s+rows\b/i.exec(String(l.text));
        var blk = null;
        if (lastN && int(lastN[1]) <= lastRow) {
          blk = [];
          for (var b = lastRow - int(lastN[1]) + 1; b <= lastRow; b++) blk.push(b);
        } else if (block) blk = block;
        else blk = openingRows(ls, q, lastRow);
        if (!blk || !blk.length) { lenUnknown = true; continue; }
        var tx = String(l.text), rowsSince = null;
        if (/\barmholes?\s+meas(?:ures?)?\b/i.test(tx)) rowsSince = armAt !== null && !(unknownAt !== null && unknownAt >= armAt) ? lastRow - armAt : null;
        else if (/\bfrom\s+(?!(?:the\s+)?(?:beg(?:in(?:ning)?)?|cast[-\s]?on|co)\b)/i.test(tx)) rowsSince = null;   // "from markers"
        else if (/\bmeas(?:ures?)?\b/i.test(tx)) rowsSince = base !== null && !lenUnknown ? base + lastRow + lenRows : null;   // from the cast-on
        else rowsSince = unknownAt === null ? lastRow : null;                                                     // "Rep last 2 rows for 2"": the rows written count
        if (rowsSince === null) { lenUnknown = true; continue; }
        var rpu = g ? E.rowsPerUnit(g, l.until.unit) : null;
        if (!(rpu > 0)) { lenUnknown = true; continue; }
        var est = Math.round(l.until.value * rpu) - rowsSince;
        // ...ending on the side it says (row 1 the RS)
        var eo = l.until.endOn;
        if (est >= 1 && (eo === 'rs' || eo === 'ws') && side1) {
          var lastIsRs = ((lastRow + est) % 2 === 1) === (side1 === 'rs');
          if ((eo === 'rs') !== lastIsRs) est += 1;
        }
        if (est > 2000) { lenUnknown = true; continue; }
        if (!(est >= 1)) continue;
        l.row = lastRow + 1; l.rowEnd = lastRow + est; l.approxRows = est;
        l.repeatOf = blk.slice(); l.repeatFrom = l.row; l.repeatTo = l.rowEnd;
        l.repeatTimes = null; l.repeatEstimated = true; l.patternStretch = true;
        // (the pattern rows keep the count: the stretch stands at the count
        // the rows before it left)
        var keep = typeof l.prevCount === 'number' ? l.prevCount : null;
        for (var kq = q - 1; kq >= 0 && keep === null; kq--) if (typeof ls[kq].count === 'number' && /^(?:setup|row|repeat)$/.test(ls[kq].kind)) keep = ls[kq].count;
        if ((l.count === null || l.count === undefined) && keep !== null && !/\b(?:inc|dec)\w*\b/i.test(tx)) {
          l.count = l.computed = keep; l.countSource = 'computed';
        }
        block = blk;
        cum += est;
        lastRow = l.rowEnd;
        if (sec) {
          if (typeof sec.lastRow === 'number') sec.lastRow += est;
          if (typeof sec.maxRow === 'number') sec.maxRow += est;
          sec.rows += est;
        }
      }
      prevEnd = base !== null && !lenUnknown ? base + lastRow + lenRows : null;
      out[k] = prevEnd;
    });
    return out;
  }

  // "dec 1 st at beg and end of rnd ... every following 10th (8th-...) rnd ...
  // to 54 (...) sts, then on every following 8th (...) rnd to 40 (...) sts" /
  // "inc 1 st each end of every 6th row 5 (...) times": the rows, each one's
  // count and change, from `start` - or null when it does not say or the
  // numbers do not divide
  var SHAPE_EVERY_RE = /\b(dec|inc)(?:rease)?\s+(\d+|one)\s+sts?\s+(?:at\s+)?(?:the\s+)?(beg(?:inning)?(?:\s+of\s+(?:the\s+)?(?:rnd|row|round))?\s+and\s+(?:at\s+)?(?:the\s+)?end|each\s+end|both\s+ends|each\s+side|both\s+sides)\b[^,;]*?\bevery\s+(?:following\s+)?(\d+)(\s*\(\s*\d+(?:\s*[,\-]\s*\d+)*\s*\))?\s+(?:rnds?|rows?|rounds?)\b([^,;]*?)(?=,|;|$)/i;
  var SHAPE_THEN_G = /\bthen\s+(?:on\s+)?every\s+(?:following\s+)?(\d+)(\s*\(\s*\d+(?:\s*[,\-]\s*\d+)*\s*\))?\s+(?:rnds?|rows?|rounds?)\b([^,;]*?)(?=,|;|$)/gi;
  function shapeEvery(text, start) {
    var s = E.normDashes(String(text)).replace(/(\d+)(?:st|nd|rd|th)\b/g, '$1');
    var m = SHAPE_EVERY_RE.exec(s);
    if (!m || /\buntil\b/i.test(m[6]) && !/\bto\s+\d/i.test(m[6])) return null;
    var ctx = { size: E.sizeIndex(), count: E.sizeCount(), scope: null };
    function pick(n, list) { var vs = sizesOf(n, list); return vs.length > 1 ? pickFrom(vs, ctx) : vs[0]; }
    var per = (m[2] === 'one' ? 1 : int(m[2])) * 2 * (m[1].toLowerCase() === 'dec' ? -1 : 1);
    var segs = [{ every: pick(m[4], m[5]), tail: m[6] }];
    SHAPE_THEN_G.lastIndex = m.index + m[0].length;
    var t2;
    while ((t2 = SHAPE_THEN_G.exec(s)) !== null) segs.push({ every: pick(t2[1], t2[2]), tail: t2[3] });
    var counts = [], deltas = [], c = start;
    for (var i = 0; i < segs.length; i++) {
      var sg = segs[i], to = /\bto\s+(\d+)(\s*\(\s*\d+(?:\s*[,\-]\s*\d+)*\s*\))?\s*sts?\b/i.exec(sg.tail),
        tm = /\b(\d+)(\s*\(\s*\d+(?:\s*[,\-]\s*\d+)*\s*\))?\s+times\b/i.exec(sg.tail), n;
      if (!(sg.every >= 1 && sg.every <= 40)) return null;
      if (to) { var target = pick(to[1], to[2]); if (typeof target !== 'number') return null; n = (target - c) / per; }
      else if (tm) n = pick(tm[1], tm[2]);
      else return null;
      if (!(n >= 0 && n === Math.round(n) && n * sg.every <= 2000)) return null;
      for (var k = 0; k < n; k++) for (var r = 1; r <= sg.every; r++) {
        var d = r === sg.every ? per : 0;
        c += d; deltas.push(d); counts.push(c);
      }
    }
    return counts.length ? { counts: counts, deltas: deltas } : null;
  }

  // The rows a part opens its pattern with: row 1 on, while each keeps the
  // count (a shaping row ends it), all of them written.
  function openingRows(ls, before, lastRow) {
    var rows = [], seen = {};
    for (var q = 0; q < before; q++) {
      var l = ls[q];
      if (l.kind !== 'row' || !(l.row >= 1) || l.rowList) continue;
      for (var r = l.row; r <= (l.rowEnd || l.row); r++) seen[r] = l;
    }
    for (var r2 = 1; r2 <= lastRow && r2 <= 24; r2++) {
      var o = seen[r2];
      if (!o || o.repeatOf) break;
      if (typeof o.count === 'number' && typeof o.prevCount === 'number' && o.count !== o.prevCount) break;
      rows.push(r2);
    }
    return rows;
  }

  // "Rep last 2 rnds 7 (8, 10) more times, then work Rnd 1 once more—20 (24,
  // 24) sts rem" (Speed Bump toe): the block, then one more working of the
  // rows named - the printed total is that last round's, not the block's end.
  // The repeat's rows are spelled out (the block k times, then the extra), so
  // every round it covers answers with its own count.
  var THEN_MORE_RE = /\bthen\s+(?:work\s+|rep(?:eat)?\s+)?(?:rnds?|rows?|rounds?)\s+(\d+)(?:\s*(?:-|to|and|&)\s*(\d+))?\s+(?:once(?:\s+more)?|one\s+more\s+time|(twice|\d+)\s+(?:more\s+)?times?)\b/i;

  function thenOnceMore(L, info, t) {
    var m = THEN_MORE_RE.exec(E.normDashes(String(t)));
    if (!m || !L.repeatOf || !L.repeatOf.length || !(L.repeatTimes >= 2) || !L.repeatMore) return;
    var a = int(m[1]), b = m[2] ? int(m[2]) : a;
    var n = m[3] ? (m[3] === 'twice' ? 2 : int(m[3])) : 1;
    if (!(b >= a) || b - a > 40 || !(n >= 1 && n <= 20)) return;
    var block = L.repeatOf.slice(), extra = [], k, r;
    for (k = 0; k < n; k++) for (r = a; r <= b; r++) extra.push(r);
    var of = [];
    for (k = 0; k < L.repeatTimes - 1; k++) of = of.concat(block);
    if (of.length + extra.length > 2000) return;
    L.repeatOf = of.concat(extra);
    L.repeatTimes = 2;
    if (typeof L.repeatTo === 'number') L.repeatTo += extra.length;
    var sec = info.section;
    if (typeof sec.repeatEnd === 'number') sec.repeatEnd += extra.length;
  }

  // A stitch pattern spelled out under "Stitch Guide" ("Division Pattern: Row 1
  // (WS) ..."), or one that says it is a stitch definition ("DNA Cable: (worked
  // over 11 sts)", "multiple of 6 sts"), is not a part to knit: it has no
  // cast-on of its own and the pieces that use it do. It stays in the lines
  // (a reference) but splitSections does not offer it as a part.
  var GUIDE_HEAD_RE = /^\s*(?:stitch\s+guide|stitch\s+patterns?|pattern\s+stitch(?:es)?|special\s+stitches)\s*:?\s*$/i;

  function stitchGuideParts(lines, info) {
    var secs = (info.sections || []).filter(function (s) { return s.rows > 0; });
    if (secs.length < 2 || !secs.some(function (s) { return s.hasSetup; })) return;
    secs.forEach(function (s) {
      if (s.hasSetup) return;
      var first = null, q;
      for (q = 0; q < lines.length; q++) if (lines[q].section === s.index && lines[q].kind === 'row') { first = lines[q]; break; }
      if (!first) return;
      var guide = !!s.patternDef;
      for (q = first.index - 1; q >= 0 && q >= first.index - 30 && !guide; q--) {
        var lb = lines[q];
        if (!lb) continue;
        if (lb.kind === 'setup' || (lb.kind === 'row' && lb.section !== s.index)) break;
        if (GUIDE_HEAD_RE.test(String(lb.text))) guide = true;
        // "Panel Pat B (worked over 17 sts)." / "CABLE PANEL C (worked over 6
        // sts)." over the rows: a panel the pieces work, not a piece
        if (/\(\s*worked\s+over\s+\d+\s+(?:sts?|stitches)\s*\)/i.test(String(lb.text))) guide = true;
      }
      if (guide) { s.instrRows = 0; s.stitchGuide = true; }
    });
  }

  // The pattern's own "Gauge: ..." and "Needles: ..." lines (joined over their
  // wraps), first of each.
  function frontLines(src) {
    var ls = String(src || '').split(/\r\n|\r|\n/), out = [], seen = {};
    for (var i = 0; i < ls.length; i++) {
      var t = E.trimLine(ls[i]);
      // ("GAUGE" as a heading over its line: "12 sts and 17 rows = 4" ...")
      if (/^(?:gauge|tension)\s*:?$/i.test(t) && i + 1 < ls.length && /\d\s*(?:sts?|stitches)\b/i.test(ls[i + 1])) {
        t = t.replace(/\s*:?$/, ': ') + E.trimLine(ls[i + 1]);
        i++;
      }
      // (a label: "needles or size needed to obtain gauge." is the tail of the
      // materials list, never the pattern's needle line)
      var m = /^(gauge|tension|needles?)\s*:\s*\S/i.exec(t);
      if (!m) continue;
      var kind = /^(?:gauge|tension)/i.test(m[1]) ? 'g' : 'n';
      if (seen[kind]) continue;
      // "Gauge: 24 sts and 35 rows = 4" in St st in the rnd." / "Gauge 26 sts and 28 rnds" / "= 4" ..."
      var j = i;
      while (j + 1 < ls.length && j - i < 3 && !/[.)]\s*$/.test(t)) {
        var n = E.trimLine(ls[j + 1]);
        if (!n || /^===/.test(n) || /^[A-Z][a-z]+\s*:/.test(n)) break;
        t += ' ' + n; j++;
      }
      if (kind === 'g' && !/\d\s*(?:sts?|stitches)\b/i.test(t)) continue;
      seen[kind] = true;
      out.push(t);
    }
    return out;
  }

  var KNIT_PROFILE = {
    id: 'knitting',
    version: '1',
    rowHeights: false,
    vocab: VOCAB,
    zeroRes: ZERO_RES,
    mrRe1: NEVER, mrRe2: NEVER, mrOnlyRe: NEVER,
    prefixRe: /^(?:work|then|and)\s+/i,
    imperativeRe: IMPERATIVE_RE,
    partNounRe: PART_NOUN_RE,
    placeNounRe: PLACE_NOUN_RE,
    nonPartPhrases: NON_PART,
    glossary: GLOSSARY,
    stitchH: [
      [/^(?:sl|slip)/, 'sl', 0.75, 0.75],
      [/^(?:k|p|knit|purl)/, 'k', 0.75, 0.75]
    ],
    slWidth: 1,

    // engine switches (see js/patterns.js where each is read)
    wrapLimit: 14,              // a knitting row wraps over up to 14 printed lines (Patons columns)
    headerStartsPart: true,     // BODY over "Next rnd" starts the Body part
    joinRepeatWraps: true,      // "Rep last 2 rnds ... 15 (16-...)" / "times more. 204 (...) sts."
    repeatWrapLimit: 4,         // "...until work from dividing rnd measures 8½ ( 8½-" / ... / "sts evenly around last rnd. 174 (...) sts." - a stretch wrapped in a narrow column
    repeatsAddRows: true,       // "Knit 5 rnds even" then "Rep last 6 rnds" reaches back over them
    groupStartsSection: true,   // each pattern of an ebook starts its own parts
    setupOwnsRows: true,        // a part's cast-on / pick-up takes the rows after it
    headerFloor: true,          // rows never go back into a part before a newer named one
    // a prose pattern's lines are whole sentences already: no counts are read
    // off the lines below a row
    wholeLines: function () { return !!E.run().prose; },
    // a heading in capitals naming pieces only ("BACK AND FRONT", "SLEEVES") is
    // printed once per size group, not as page furniture
    notRunningHead: function (t) {
      var s = String(t).trim();
      return /^[A-Z][A-Z &]{2,40}$/.test(s) && s.split(/\s+(?:AND|&)\s+|\s+/).every(function (w) { return PART_NOUN_RE.test(w); });
    },
    // words that may shrink a row to under a quarter of its stitches (the
    // engine otherwise takes such a count for a misreading)
    shrinkRe: /\b(?:cast|bind)\s+off\b|\bbo\s+\d|\bsts?\s+(?:on|onto)\s+(?:a\s+)?(?:st(?:itch)?\s+)?holder|\bspare\s+needle|\bturn\b/i,

    reflow: function (raws) { return reflowLines(raws); },
    // "Sizes XL, 2/3XL and 4/5XL only:" / "1st rnd: Knit." in the middle of the
    // yoke: those rounds come after the rounds before them (the yoke's 32), so
    // their numbers go on from there for as long as the scope lasts
    rowOffset: function (cur, mk) {
      var run = E.run();
      if (run.rowOffset && run.scope && run.offsetScope === run.scope) return run.rowOffset;
      if (mk.row === 1 && cur.hasRow && run.scope && run.scope.indices && run.scopeSection === null) {
        var off = Math.max(cur.lastRow || 0, cur.repeatEnd || 0);
        if (off > 0) { run.rowOffset = off; run.offsetScope = run.scope; return off; }
      }
      return 0;
    },
    continues: function (ct, cls, t) { return knitContinues(ct, cls, t); },
    // a counted note is a part's foundation only when it starts a sentence -
    // "spaced across row, k1-59 sts rem." is the tail of a wrapped paragraph
    // ...and never a sentence about chart rows ("Change to Chart 2, and work
    // Rows 1–8 once—207 sts."): that is the end of rows the chart holds
    setupFromNote: function (t) {
      return /^[A-Z(\d]/.test(t) && !/^\d+\s*\)/.test(t) &&
        !/\b(?:rows?|rnds?|rounds?)\s+\d+\s*[-‐-―]\s*\d+\b[^.]*\bchart\b|\bchart\s+\w+[^.]*\b(?:rows?|rnds?)\s+\d+\s*[-‐-―]\s*\d+/i.test(t) &&
        // ...nor shaping spread over rows ("dec 1 st each end every 8th row 6 times")
        !/\bevery\s+(?:\d+(?:st|nd|rd|th)|other|alt(?:ernate)?)\s+(?:row|rnd|round)/i.test(t);
    },
    // "...Place marker (pm) and" / "join in the rnd." - the sentence goes on
    hangs: function (t, ct) {
      // "...work wrap and 2 sl sts tog as for sssk (see" / "Glossary), turn—1 heel
      // st dec'd." - a bracket the line above left open
      if (t.lastIndexOf('(') > t.lastIndexOf(')') && /^[^(]*\)/.test(ct) && ct.indexOf(')') < 40) return true;
      // "...Turn so" / "WS is facing." - a word that cannot end a sentence
      if (/\b(?:so|the|a|an|of|to|and|with|into|onto)\s*$/i.test(t)) return true;
      return /(?:\b(?:or|then|from|before|after|each|every|for|among|between|across|along|over|on|in|at|by|until|as)|[,(-])\s*$/i.test(t) &&
        /^[a-z(\d]/.test(ct);
    },

    init: function (engine) { E = engine; },

    // An ebook of several patterns ("8 Free Sock Knitting Patterns") lists them
    // in its contents with the page each starts on: each is a group (wave G's
    // size-group machinery), headed at the top of its first page.
    findGroups: function (raws, heads, base) {
      // one pattern printed twice for two size ranges (Sandnes: children 2-12
      // yrs on one page, ladies S-XXL on the next): each SIZES block opens a group
      var sbg = sizeBlockGroups(raws) || titleGroups(raws);
      if (sbg) return sbg;
      var toc = [], i, m;
      for (i = 0; i < raws.length; i++) {
        var t = E.trimLine(raws[i]);
        m = /^(.{3,70}?)\s*\.{3,}\s*(?:page\s*)?(\d{1,3})\s*$/i.exec(t);
        if (!m) continue;
        var name = m[1].replace(/\s+by\s+[A-Z][\s\S]*$/, '').replace(/[\s.]+$/, '').trim();
        // a title the contents page wrapped: "Icelandic Lace Shawl by Halldóra" /
        // "Carol Rasmussen Noble ..... PAGE 12", "Guanaco and" / "Vicuña Lace ..."
        var pv = i > 0 ? E.trimLine(raws[i - 1]) : '';
        if (pv && !/\.{3,}/.test(pv) && pv.length <= 70) {
          if (!/\s+by\s+[A-Z]/.test(m[1]) && /\s+by\s+[A-Z]/.test(pv)) name = pv.replace(/\s+by\s+[A-Z][\s\S]*$/, '').trim();
          else if (/\b(?:and|&|of|the|with|for)\s*$/i.test(pv)) name = pv + ' ' + name;
        }
        // the designers it names are bylines, never parts ("Kari Anderson")
        var by = /\s+by\s+([A-Z][^.]*?)\s*(?:\.{3,}|$)/.exec(m[1]) || /\s+by\s+([A-Z][^.]*?)\s*$/.exec(pv || '');
        if (by) (E.run().designers = E.run().designers || []).push(by[1].replace(/\s+/g, ' ').trim().toLowerCase());
        if (!/\s+by\s+/.test(m[1]) && pv && /\s+by\s+[A-Z]/.test(pv)) (E.run().designers = E.run().designers || []).push(m[1].replace(/[\s.]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase());
        // the book's own back matter is not a pattern
        if (/^(?:glossary|abbreviations|techniques|index|resources|contents|introduction|about\s+the\s+designers?|sources?)\b/i.test(name)) continue;
        if (name.length >= 3) toc.push({ name: name, page: +m[2] });
      }
      if (toc.length < 2) return base(raws, heads);
      var pageAt = {};
      for (i = 0; i < raws.length; i++) {
        m = /^===\s*page\s+(\d+)\s*===/i.exec(E.trimLine(raws[i]));
        if (m) pageAt[+m[1]] = i;
      }
      var at = {}, names = [];
      toc.forEach(function (e) {
        if (pageAt[e.page] === undefined || at[pageAt[e.page]] !== undefined) return;
        at[pageAt[e.page]] = e.name;
        names.push(e.name);
      });
      return names.length >= 2 ? { at: at, names: names } : base(raws, heads);
    },

    // every part carries its pattern's size line, so a part read on its own
    // (the counter parses one part at a time) still resolves its size lists
    // and its "Sizes XL only:" blocks
    carryIntoParts: function (out, lines, text) {
      var meta = lines.meta || {};
      // A pattern's first part begins at its own first heading, cast-on or
      // row: the materials, abbreviations and notes before it are front matter
      // (the gauge card and the notes), never the part's pattern text - the
      // knitter reads this text in the pattern sheet.
      var firstOf = {};
      out.forEach(function (s) {
        if (!s || !s.text || !s.lines || !s.lines.length) return;
        var g = s.group || '';
        if (firstOf[g]) return;
        firstOf[g] = s;
        var k = -1, q;
        for (q = 0; q < s.lines.length; q++) {
          var kd = s.lines[q].kind;
          if (kd === 'setup' || kd === 'row' || kd === 'repeat') { k = q; break; }
        }
        if (k <= 0) return;
        while (k > 0 && s.lines[k - 1].kind === 'header') k--;
        if (k <= 0) return;
        var want = E.trimLine(s.lines[k].text), tl = s.text.split('\n'), at = -1;
        for (q = 0; q < tl.length; q++) if (tl[q] === want) { at = q; break; }
        if (at <= 0) return;
        s.text = tl.slice(at).join('\n');
        s.lines = s.lines.slice(k);
      });
      // A part with no name of its own whose rows start again at 1 right after
      // a named part ("BACK" ... "Change to larger needles and proceed as
      // follows: 1st row:") is that piece going on: "Back (continued)". (A
      // document that names nothing - the Bernat neck and yoke - is left to the
      // store's naming.)
      var lastNamed = {}, used = {};
      out.forEach(function (s) { if (s && s.name) used[(s.group || '') + '\u0001' + s.name.toLowerCase()] = true; });
      out.forEach(function (s) {
        if (!s || !s.lines) return;
        var g = s.group || '';
        if (s.name) { lastNamed[g] = s.name.replace(/\s+\(continued(?:\s+\d+)?\)$/i, ''); return; }
        if (!lastNamed[g]) return;
        var fr = null;
        for (var q = 0; q < s.lines.length; q++) if (/^(?:row|setup)$/.test(s.lines[q].kind)) { fr = s.lines[q]; break; }
        if (!fr || fr.kind !== 'row' || fr.row !== 1) return;
        var nm = lastNamed[g] + ' (continued)', k2 = 2;
        while (used[g + '\u0001' + nm.toLowerCase()]) nm = lastNamed[g] + ' (continued ' + (k2++) + ')';
        s.name = nm;
        s.continues = lastNamed[g];
        used[g + '\u0001' + nm.toLowerCase()] = true;
      });
      var byGroup = {};
      function sizesFor(g) {
        if (byGroup[g] !== undefined) return byGroup[g];
        var src = text;
        if (g && meta.groupAtLine) {
          src = lines.filter(function (l) { return meta.groupAtLine(l.index) === g; })
            .map(function (l) { return l.text; }).join('\n');
        }
        var sz = null;
        try { sz = knitDetectSizes(src, E.baseDetectSizes); } catch (e) { sz = null; }
        byGroup[g] = sz;
        return sz;
      }
      var colsByGroup = {};
      function colsFor(g, sz) {
        if (colsByGroup[g] !== undefined) return colsByGroup[g];
        var src = text;
        if (g && meta.groupAtLine) {
          src = lines.filter(function (l) { return meta.groupAtLine(l.index) === g; })
            .map(function (l) { return l.text; }).join('\n');
        }
        var c = null;
        try { c = columnsOf(src, sz); } catch (e) { c = null; }
        colsByGroup[g] = c;
        return c;
      }
      // ...and the stitches a part starts with when it carries on from the part
      // before it (Turn Heel after Heel Flap): a part read on its own has no
      // part before it to count from
      var docSizes = null;
      try { docSizes = knitDetectSizes(text, E.baseDetectSizes); } catch (e0) { docSizes = null; }
      out.forEach(function (s) {
        if (!s || !s.text || !s.lines) return;
        var first = null;
        for (var q = 0; q < s.lines.length; q++) {
          if (s.lines[q].kind === 'setup') break;
          if (s.lines[q].startFrom) { first = s.lines[q]; break; }
          if (s.lines[q].kind === 'row') break;
        }
        if (!first || typeof first.startFrom.count !== 'number') return;
        var szs = first.startFrom.sizes, phrase = null;
        var groupSizes = sizesFor(s.group || null);
        if (szs && szs.length >= 2 && groupSizes && szs.length === groupSizes.length) {
          phrase = szs[0] + ' (' + szs.slice(1).join(', ') + ')';
        } else if (!(groupSizes && groupSizes.length >= 2) && !(docSizes && docSizes.length >= 2 && !s.group)) {
          phrase = String(first.startFrom.count);
        }
        if (!phrase) return;
        var ls = s.text.split('\n'), at = 0;
        while (at < ls.length && ls[at].trim() && E.headerInfo(E.trimLine(ls[at])) && E.headerInfo(E.trimLine(ls[at])) !== 'note' &&
               !E.detectMarker(E.trimLine(ls[at]))) at++;
        ls.splice(at, 0, 'Start with ' + phrase + ' sts.');
        // ...and, for a piece going on ("Back (continued)"), about how many rows
        // it has had since its cast-on: "until work from beg measures 15½""
        // counts them (see patternStretches)
        var oi = out.indexOf(s), pv = oi > 0 ? out[oi - 1] : null;
        var pIdx = pv && pv.lines && pv.lines.length ? pv.lines[0].section : null;
        var done = (s.continues && lines.rowsFromStart && pIdx !== null) ? lines.rowsFromStart[pIdx] : null;
        if (typeof done === 'number' && done >= 1) ls.splice(at + 1, 0, '(About ' + done + ' rows worked from the cast-on.)');
        s.text = ls.join('\n');
      });
      out.forEach(function (s) {
        if (!s || !s.text) return;
        var sz = sizesFor(s.group || null);
        if (!sz || sz.length < 2) return;
        var own = null;
        try { own = knitDetectSizes(s.text, E.baseDetectSizes); } catch (e) { own = null; }
        // ...and the grouping of its numbers, when the pattern states one
        var gcols = colsFor(s.group || null, sz);
        if (gcols && !columnsOf(s.text, sz)) s.text = columnLine(gcols, sz) + '\n' + s.text;
        if (own && own.length === sz.length) return;
        s.text = sizeLine(sz) + '\n' + s.text;
      });
      // ...and its gauge and needle lines, as a field beside the text (never in
      // it: the text carries only the pattern's own "Sizes:" / "Numbers:" and
      // "Start with" lines), so a book's pattern imported alone still has the
      // gauge its pattern prints
      var gaugeBy = {};
      out.forEach(function (s) {
        if (!s || !s.text) return;
        var g = s.group || null;
        if (gaugeBy[g] === undefined) {
          var src = text;
          if (g && meta.groupAtLine) {
            src = lines.filter(function (l) { return meta.groupAtLine(l.index) === g; })
              .map(function (l) { return l.text; }).join('\n');
          }
          gaugeBy[g] = frontLines(src);
        }
        if (gaugeBy[g].length) s.gaugeLines = gaugeBy[g].slice();
        // ...except where the text itself needs it: a part with a length
        // stretch ("Knit even in rnds until work from sleeve divide measures
        // 3"") takes its rows from the gauge when it is read alone, and a
        // book's pattern is imported from its parts' text alone (its gauge
        // was in the front matter its first part no longer holds). Those end
        // with the pattern's labelled gauge line - at the end, as the crochet
        // engine's carryGauge does, never in front of the part's first row.
        var gl = gaugeBy[g].filter(function (x) { return /^(?:gauge|tension)/i.test(x); })[0];
        if (!gl || !s.lines) return;
        var bookFirst = !!s.group && firstOf[s.group || ''] === s;
        if (!bookFirst && !s.lines.some(function (l) { return l.until && l.until.kind === 'length'; })) return;
        var have = null, gg = null;
        try { have = E.gauge(s.text); gg = E.gauge(gl); } catch (e) { return; }
        if (have && (have.rowsPer4in > 0 || have.rowsPer10cm > 0)) return;
        if (!gg || !(gg.rowsPer4in > 0 || gg.rowsPer10cm > 0)) return;
        s.text += '\n' + gl;
      });
      // ...and the panels its rows work ("Work 1st row of Panel Pat C"), as one
      // stitch-guide line each at the end - "Panel Pat C (worked over 9 sts):
      // 1st row: (RS). Knit. | 2nd and every alt row: Purl. | ..." - so the part
      // read on its own still knows what a panel row is
      var pdefs = lines.panelDefs;
      if (pdefs) {
        out.forEach(function (s) {
          if (!s || !s.text) return;
          var seen = {};
          panelsOf(s.text).forEach(function (p) {
            var saved = CUR_PANELS;
            CUR_PANELS = pdefs;
            var def = panelDef(p.name);
            CUR_PANELS = saved;
            if (!def || seen[def.text]) return;
            seen[def.text] = true;
            var ls = def.text.split('\n'), head = ls[0].replace(/\.\s*$/, '');
            var rows = ls.slice(1).filter(function (x) { return !/^\(?\s*see\s+chart\b/i.test(x) && !/^(?:on\s+)?page\s+\d+\s*\)?\.?\s*$/i.test(x); });
            var hm = /^(.*?\(\s*worked\s+over\s+\d+\s+(?:sts?|stitches)\s*\))/i.exec(head);
            if (hm && rows.length) s.text += '\n' + hm[1] + ': ' + rows.join(' | ');
          });
        });
      }
    },

    // a "(continued)" part is made as often as the piece it goes on ("SLEEVES"
    // made twice, so its pattern rows are too); "Work other sleeve in the same
    // manner." makes a part twice
    finishParts: function (out) {
      out.forEach(function (s) {
        if (!s) return;
        if (!(s.makeCount > 1) && /\b(?:work|make|knit)\s+(?:the\s+)?(?:other|second|2nd)\s+(?:sleeve|mitten|sock|glove|stocking|leg|front|piece|half)\b[^.]*\b(?:same|alike|to\s+correspond|reversing)\b/i.test(String(s.text))) {
          s.makeCount = 2; s.makeCountInferred = true;
        }
      });
      out.forEach(function (s) {
        if (!s || !s.continues) return;
        var g = s.group || '';
        var parent = out.filter(function (p) { return p && (p.group || '') === g && p.name === s.continues; })[0];
        if (parent && parent.makeCount > 1 && !(s.makeCount > 1)) { s.makeCount = parent.makeCount; if (parent.makeCountInferred) s.makeCountInferred = true; }
      });
    },

    parseOpts: function (text, opts) {
      var o = clone(opts);
      if (!o.sizes) {
        var found = null;
        try { found = knitDetectSizes(text, E.baseDetectSizes); } catch (e) { found = null; }
        if (found) o.sizes = found;
      }
      if (!(o.sizeCount >= 2) && o.sizes && o.sizes.length >= 2) o.sizeCount = o.sizes.length;
      // six sizes over two numbers, when the pattern says how
      // (an ebook of several patterns is read whole only to split it: its
      // parts carry their own pattern's grouping - see carryIntoParts)
      var tocLines = String(text || '').split(/\r\n|\r|\n/).filter(function (l) {
        return /^.{3,70}?\s*\.{3,}\s*(?:page\s*)?\d{1,3}\s*$/i.test(l.trim());
      }).length;
      if (!o.sizeColumns && o.sizes && o.sizes.length >= 3 && tocLines < 2 && o.sizeCount === o.sizes.length) {
        var cols = null;
        try { cols = columnsOf(text, o.sizes); } catch (e2) { cols = null; }
        if (cols) o.sizeColumns = cols;
      }
      return o;
    },

    detectSizes: function (text, base) { return knitDetectSizes(text, base); },
    sizeScope: function (text, names, base) {
      var r = knitSizeScope(text, names, base);
      if (r) delete r.len;
      return r;
    },
    detectMarker: function (line, base) { return knitDetectMarker(line, base); },
    detectNextRow: function (line, base) { return knitDetectNextRow(line, base); },
    detectSetup: function (line, base) { return knitDetectSetup(line, base); },
    findExplicit: function (line, base) {
      var r = knitFindExplicit(line, base);
      if (r && r.sizes) r.sizes = spreadColumns(r.sizes);
      return r;
    },
    detectRepeat: function (t, size, base) { return knitDetectRepeat(t, size, base); },
    evaluate: function (instruction, prevCount) {
      return knitEval(instruction, prevCount, {}).count;
    },

    // a line written for other sizes is a note for this one; a line that is
    // nothing but its scope ("All sizes:") is a note always
    classify: function (t, size) {
      // "BACK AND FRONT" (Sandnes): two pieces worked as one
      var bf = /^([A-Z]{3,})((?:\s+(?:AND|&)\s+[A-Z]{3,})+)$/.exec(String(t).trim());
      if (bf && String(t).trim().split(/\s+(?:AND|&)\s+/).every(function (w) { return PART_NOUN_RE.test(w); })) {
        return { header: { name: E.titleCase(String(t).trim().toLowerCase()), makeCount: 1 } };
      }
      // a chart's title over its row labels is never a part
      var cts = E.run().chartTitles;
      if (cts && cts[String(t).trim().toLowerCase()]) return { note: true };
      // a designer's byline the contents page names is never a part
      var dz = E.run().designers;
      if (dz && dz.length && dz.indexOf(t.replace(/^(?:design(?:ed)?\s+by|by)\s+/i, '').replace(/\s+/g, ' ').trim().toLowerCase()) >= 0) return { note: true };
      // a starred size-only row is a note for the sizes it is not written for
      var star = starRow(t);
      if (star) {
        var ssc = star.own ? star.scope : E.run().starScope;
        if (ssc && !inScope(ssc, size)) return { note: true };
        if (star.own && !ssc) return { note: true };
        return null;
      }
      // "Neckband: With RS facing ..., pick up and knit 36 sts ...", "cuff:
      // With MC ..., CO 60 sts": the part's name, then its foundation
      var nr = /^([A-Za-z][A-Za-z '&\/-]{1,38}):\s*(\S.*)$/.exec(t);
      if (nr && (PICKUP_LINE_RE.test(nr[2]) || CO_LINE_RE.test(nr[2]) || FROM_HOLDER_LINE_RE.test(nr[2]) ||
          // ...wrapped before its number: "Neckband: With RS facing and smaller circular needle, pick"
          /^(?:(?:with|using)\b[^.;]{0,80}?,\s*)?(?:pick(?:\s+up(?:\s+(?:and|&)(?:\s+knit)?)?)?|cast(?:\s+on)?|co)\s*$/i.test(nr[2]))) {
        var hi = E.headerInfo(E.titleCase(nr[1]) + ':');
        var scN = scopeOf(t);
        if (hi && hi !== 'note' && !hi.weak && !scN) {
          return { nameRow: { name: hi.name, makeCount: hi.makeCount, rest: nr[2], foundation: true,
            prefixLen: t.length - nr[2].length } };
        }
      }
      var sc = scopeOf(t);
      var run = E.run();
      // a piece's own heading in capitals ("SLEEVES", "FINISHING") ends a "Sizes
      // 2/3XL and 4/5XL only:" block - for the sizes the block skips too
      // (Patons: the sleeves were dropped for XS/S with the neck they follow)
      if (run.scope && !sc && /^[A-Z][A-Z &'\/-]{2,40}$/.test(String(t).trim()) && /[A-Z]{3}/.test(t)) {
        var hh = E.headerInfo(String(t).trim());
        if ((hh && hh !== 'note') || /^(?:FINISHING|FINISH|TO FINISH|MAKING UP|MAKE UP|ASSEMBLY)$/.test(String(t).trim())) { run.scope = null; run.scopeSection = null; }
      }
      if (sc) {
        var lead = stripScope(t);
        if (!inScope(sc, size)) return { note: true };
        if (lead && !lead.rest.trim()) return { note: true };
        return null;
      }
      if (run.scope && !inScope(run.scope, size)) return { note: true };
      return null;
    },

    lineCount: function (L, info) {
      ensureFields(L);
      var t = info.text, size = info.size;
      var sc = scopeOf(t) || E.run().scope || null;
      // "****Row 3: 36 and 48 stitch socks only: Slip 1, knit 17 (23)." - its
      // lists are for the sizes it names
      var stR = starRow(t);
      if (stR && (stR.own ? stR.scope : E.run().starScope)) sc = stR.own ? stR.scope : E.run().starScope;
      // a list for the sizes the scope names: "(256-260-272) sts" on a line
      // for XL, 2/3XL and 4/5XL only
      if (L.sizeUnresolved && L.sizes && sc && sc.indices && L.sizes.length === sc.indices.length) {
        var k = sc.indices.indexOf(size);
        if (k >= 0) { L.stitches = L.sizes[k]; L.sizeUnresolved = false; }
      }
      var head = t.slice(0, info.prefixLen);
      L.side = lineSide(t, info.prefixLen, isRoundHead(head));
      // "...pick up and knit 198 ( 198-220-220-242-242) sts around top edge of
      // Cable Yoke. Join in rnd." - a pick-up with no total of its own after it
      // (read here, once the line is whole: a wrapped pick-up's total may be on
      // the line below)
      if (info.isSetup && L.stitches === null && !L.sizeUnresolved) {
        var pk = /(?:^|[,.;:]\s*|\bneedles?\s+)(?:pick\s+up(?:\s+(?:and|&)\s+(?:knit|k))?|pu)\s+(\d+)(\s*\(\s*\d+(?:\s*[,\-]\s*\d+)*\s*\))?\s*(?:sts?|stitches)\b/i.exec(E.normDashes(t));
        if (pk && !/\d/.test(t.slice(pk.index + pk[0].length).replace(/\bno\.\s*\d+|\d+\s*(?:mm|cm|in|")/gi, ''))) {
          var pkv = sizesOf(pk[1], pk[2]);
          var pkp = pkv.length > 1 ? pickFrom(pkv, { size: size, count: E.sizeCount(), scope: sc }) : pkv[0];
          if (pkp !== undefined && pkp !== null) { L.stitches = pkp; if (pkv.length > 1) L.sizes = pkv; }
        }
      }
      var ctx = { size: size, count: E.sizeCount(), scope: sc };
      L.delta = deltaOf(t, ctx);
      var rest = t.slice(info.prefixLen);
      L.shortRow = isShort(rest) || /^\s*short[-\s]?rows?\b/i.test(t.replace(/^.*?only:\s*/i, ''));
      // a part's first written row is "Row 2" right after its cast-on: row 1
      // was prose the parser did not read, so the cast-on is not this row's
      // starting count (Henley: the neckband's "Row 2: Purl." under a sleeve hem)
      var prevIn = info.prev;
      if (info.isRow && info.section.rows === 0 && info.section.lastRow === 0 && L.row > 1 && !L.rowList) {
        prevIn = null;
        L.prevCount = null;
      }
      // German short rows (a prose pattern): the stitches stay as they are -
      // turning makes a double stitch, it adds and removes nothing
      if (info.isRow && E.run().prose && (/\b2\s+loops?\s+on\s+(?:the\s+)?right\s+(?:ndl|needle)/i.test(t) || /^work\s+and\s+turn\b/i.test(t))) {
        L.shortRow = true;
        L.computed = (typeof prevIn === 'number') ? prevIn : null;
        L.germanShortRows = true;
        L.shortRows = germanShortRows(t, ctx, info.section, L);
        return;
      }
      // "Join yarn to rem sts and pat to end of row." - the other side of a
      // neck: the stitches left waiting when the first side turned, less the
      // centre ones slipped to a holder since
      if (info.isRow && typeof info.section.spare === 'number' && /^(?:[A-Za-z ]{2,30}:\s*)?(?:re)?join\s+(?:the\s+)?yarn\s+to\s+(?:the\s+)?(?:rem(?:aining)?|other)\s+sts?\b/i.test(t)) {
        prevIn = info.section.spare;
        L.prevCount = prevIn;
        info.section.spare = null;
      }
      if (!info.refs) {
        var ev = knitEval(info.instr, prevIn, { size: size, scope: sc, castOnAbs: !info.isRow });
        // "Pat across 55 sts. Turn. Leave rem sts on a spare needle.": what waits
        if (ev.run && ev.run.heldRest > 0 && !ev.bad) info.section.spare = ev.run.heldRest;
        L.computed = (L.sizeUnresolved && !L.stitches) ? null : ev.count;
        L.shortRow = ev.short || /^\s*short[-\s]?rows?\b/i.test(t.replace(/^.*?only:\s*/i, ''));
        // markers from the whole line: a cast-on line's total stops at the
        // cast-on, its "pm for beg of rnd and join" comes after it
        var evM = (rest !== info.instr) ? knitEval(rest, prevIn, { size: size, scope: sc, castOnAbs: !info.isRow }) : ev;
        L.markers = markersOf(evM.markers.length ? evM.markers : ev.markers, rest);
        // "...Join in rnd. Mark first st as beg of rnd." (Patons)
        if (!L.markers && /\bmark\s+(?:the\s+)?first\s+st(?:itch)?\s+as\s+(?:the\s+)?beg(?:inning)?\s+of\s+(?:the\s+)?(?:rnd|round)\b/i.test(rest)) L.markers = [{ name: 'BOR', at: 0 }];
        // what one working of the row does, from its own words (back-references
        // replay this, not the drop to a printed total that sets stitches aside)
        L.net = (ev.net !== null && ev.net !== undefined && !ev.bad) ? ev.net : null;
        if (ev.gap) L.computed = null;
        // "8 sts inc" is the designer's own arithmetic
        if (L.delta !== null && prevIn !== null && prevIn !== undefined && !ev.gap) {
          L.computed = prevIn + L.delta;
        }
      }
      // a prose pattern's stretch of plain rounds ("Knit 43 plain rounds, or 2
      // inches", "Do 10 rounds in ribs of 2 plain, 2 pearl") keeps the count
      if (info.isRow && E.run().prose && L.rowEnd > L.row && (L.computed === null || L.computed === undefined) &&
          typeof prevIn === 'number' && !/\b(?:inc(?:reas(?:e[sd]?|ing))?|dec(?:reas(?:e[sd]?|ing))?|narrow(?:ing)?|widen(?:ing)?|intakes?|together|tog|cast\s+(?:on|off)|bind\s+off|reduc(?:e|es|ed|ing)|pick\s+up|take\s+in|m1|k2tog|ssk|psso)\b/i.test(t)) {
        L.computed = prevIn;
      }
      // "2 intakes with 6 rounds between each." (Cupples): an intake takes in a
      // stitch on each side of the seam - two a time
      var itk = E.run().prose && info.isRow && INTAKE_RE.exec(t);
      if (itk && typeof prevIn === 'number') { L.computed = prevIn - 2 * int(itk[1]); L.delta = -2 * int(itk[1]); }
      // "*Slip 1 ..., knit next stitch*. Repeat this slip 1, knit 1 across all
      // 18 (20, 24) stitches on this needle point." - a row that says how many
      // stitches it works, and shapes none of them, has that many
      if (info.isRow && (L.computed === null || L.computed === undefined) && (L.stitches === null || L.stitches === undefined) && !L.shortRow) {
        var acr = /\b(?:across|over)\s+(?:all\s+)?(?:the\s+)?(\d+(?:\s*\([^)]*\))?)\s*(?:sts?|stitches)\b/i.exec(rest);
        if (acr && !/\b(?:k2tog|p2tog|ssk|ssp|m1[lrp]?|yo|inc|dec|together|tog|psso|kfb|pfb|cdd|sk2p|bind|bo|cast|co)\b/i.test(rest)) {
          var av = resolveSizes(acr[1], { size: size, count: E.sizeCount(), scope: sc });
          var an = av.bad ? null : int(av.text);
          if (an > 0 && (prevIn === null || prevIn === undefined || prevIn === an)) L.computed = an;
        }
      }
      // A short row that only turns - no decrease, no total printed, no stated
      // change - has no count of its own: what is on the needles is not what
      // it works (Genome's "Row 1: (RS) K19, turn, leaving last st unworked."
      // over 20 heel sts of 48; a yo short row's yo is a wrap, not a stitch).
      // The count it stands on carries past it to the next row.
      if (info.isRow && L.shortRow && L.stitches === null && L.delta === null && L.computed !== null &&
          !(typeof L.net === 'number' && L.net < 0)) {
        L.computed = null;
        L.keepCount = true;
      }
      // a printed total its own words do not come to is kept - the designer's
      // word - and said (Bernat XL divide 156 vs 158 worked; Flying Trapeze toe)
      if (L.stitches !== null && L.computed !== null && L.computed !== L.stitches && !L.sizeUnresolved) {
        L.deviation = { printed: L.stitches, computed: L.computed };
      }
      L.chart = chartOf(rest);
      L.cable = cableOf(rest);
      L.until = untilOf(rest, size);
      // "Knit 24 rounds, ..." in a prose pattern: so many rounds, said
      if (!L.until && info.isRow && E.run().prose && L.rowEnd > L.row && PROSE_ROUNDS_RE.test(t)) {
        L.until = { kind: 'rows', value: L.rowEnd - L.row + 1, unit: /\brows?\b/i.test(PROSE_ROUNDS_RE.exec(t)[0]) ? 'rows' : 'rnds', endOn: null };
      }
    },

    // a part that starts again at Row 1 under a new name is the same stitches
    // (Heel Flap -> Turn Heel, flat neck -> yoke rounds) unless the part before
    // it was bound off, grafted or put away
    refDelta: function (lines, section, row, base) {
      var src = E.refLineAt(lines, section, row);
      if (src && typeof src.net === 'number' && !src.repeatOf) return typeof src.delta === 'number' ? src.delta : src.net;
      return base(lines, section, row);
    },

    carryCount: function (prevSection) {
      return !prevSection.endedPiece && !prevSection.patternDef;
    },

    afterLine: function (L, info) {
      ensureFields(L);
      var run = E.run();
      var t = info.text || '';
      // (a line written for other sizes ends nothing for this one: the
      // "Sizes 2/3XL and 4/5XL only:" neck fastens off a side the XS/S never knits)
      // (a prose pattern's "Do 10 rounds in ribs of 2 plain, 2 pearl" is an
      // instruction row though it names no stitch abbreviation)
      if (E.run().prose && info.isRow && !(info.section.instrRows > 0)) info.section.instrRows = 1;
      var scNow = scopeOf(t);
      var offSize = (scNow && !inScope(scNow, info.size)) || (!scNow && run.scope && !inScope(run.scope, info.size));
      if (PIECE_END_RE.test(t) && !offSize) {
        info.section.endedPiece = true;
        // "Cast off rem 16 (16-17-17-18-21) sts." - nothing is on the needle
        // now; the next shaped row (the other side of a neck) is not counted
        // from the stitches that were cast off
        if (L.kind === 'note' && /^(?:then\s+)?(?:bind|cast)\s+off\s+(?:all\s+|rem(?:aining)?\s+)/i.test(t)) { info.section.prevCount = null; info.section.prevSizes = null; }
      }
      // a stitch-pattern definition ("DNA Cable: (worked over 11 sts)", "Wide
      // Wale Rib (multiple of 6 sts)", "Rep Rnd 1 for patt.") is not the piece
      // (only before the part has rows of its own; a cast-on clears it)
      if (!info.section.hasRow &&
          /\b(?:multiple\s+of\s+\d+|worked\s+over\s+\d+\s+sts|for\s+patt(?:ern)?\s*\.|\d+-st\s+(?:panel|rep(?:eat)?))/i.test(t)) info.section.patternDef = true;
      if (info.isSetup && (CO_LINE_RE.test(t) || PICKUP_LINE_RE.test(t))) info.section.patternDef = false;
      // "Work from ** to ** as given for Back." - the piece goes on from where
      // that block ended: the count of the line its closing "**" is on
      if (L.kind === 'note' && /^work\s+from\s+(\*{1,3})\s*to\s*\1\s+as\s+(?:given\s+)?for\b/i.test(t)) {
        for (var cq = L.index - 1; cq >= 0; cq--) {
          var cl = info.lines[cq];
          if (!cl || cl.consumed) continue;
          if (/\S\*{2,3}\s*$/.test(String(cl.text)) && /^(?:row|setup|repeat)$/.test(cl.kind)) {
            if (typeof cl.count === 'number') {
              info.section.prevCount = cl.count;
              info.section.prevSizes = cl.sizes && cl.sizes.length > 1 ? cl.sizes.slice() : null;
              L.copyCount = cl.count;
            }
            break;
          }
        }
      }
      // "With RS facing slip next 26 (...) sts from spare needle onto a st
      // holder." / "slip center 19 (...) sts onto a st holder": the centre of
      // a neck put away from the stitches that wait for the other side
      if (L.kind === 'note' && typeof info.section.spare === 'number') {
        var cs = /\bslip\s+(?:the\s+)?(?:next|cent(?:er|re))\s+(\d+(?:\s*\([^)]*\))?)\s*sts?\s+(?:from\s+(?:the\s+)?(?:spare\s+needle|holder)\s+)?(?:onto|on|to)\s+(?:a\s+|the\s+)?(?:st(?:itch)?\s+)?holder/i.exec(t);
        if (cs) {
          var csv = resolveSizes(cs[1], { size: info.size, count: E.sizeCount(), scope: run.scope || null });
          var csn = csv.bad ? null : int(csv.text);
          info.section.spare = (csn !== null && info.section.spare - csn > 0) ? info.section.spare - csn : null;
        }
      }
      // "Increase three stitches on second round (see page 9)." (Cupples) - a
      // note that changes what is on the needles
      var incN = E.run().prose && L.kind === 'note' && typeof info.section.prevCount === 'number' &&
        /^(?:then\s+|now\s+)?(increase|inc|decrease|dec|widen|narrow|take\s+in)\s+(\d+)\s+(?:stitch(?:es)?|sts?)\b(?![^.]*\b(?:each|every|until|evenly)\b)/i.exec(t);
      if (incN) {
        var dN = (/^(?:increase|inc|widen)/i.test(incN[1]) ? 1 : -1) * int(incN[2]);
        info.section.prevCount += dN;
        L.delta = dN;
        L.count = L.computed = info.section.prevCount;
        L.countSource = 'computed';
      }
      // "Insert marker at beg of rnd = middle back." / "Insert markers around 4
      // sts for raglan inc as follows: Count 13 sts (= ½ back), insert marker
      // around next st, count 11 sts (= sleeve), ..." (Sandnes): markers placed
      // by a sentence, not by a row
      // "Mark first st as beg of rnd." (Patons): the beginning of the round is a stitch
      if (L.kind === 'note' && !L.markers && /\bmark\s+(?:the\s+)?first\s+st(?:itch)?\s+as\s+(?:the\s+)?beg(?:inning)?\s+of\s+(?:the\s+)?(?:rnd|round)\b/i.test(t)) {
        L.markers = [{ name: 'BOR', at: 0 }];
      }
      if (L.kind === 'note' && !L.markers && /\b(?:insert|place)\s+(?:a\s+)?markers?\b/i.test(t) && !/\bon\s+(?:the\s+)?(?:side\s+)?edges?\b/i.test(t)) {
        var mseg = t.replace(/^[^:]*\bas\s+follows\s*:\s*/i, '');
        var mev = knitEval(mseg, typeof info.section.prevCount === 'number' ? info.section.prevCount : null, { size: info.size, scope: run.scope || null });
        if (mev.markers && mev.markers.length) L.markers = markersOf(mev.markers, mseg);
      }
      // "Panel Pat A (worked over 24 sts)": the panel's rows work that many
      if (L.kind === 'note' && !info.section.hasRow) {
        var pd = /\(\s*worked\s+over\s+(\d+)\s+(?:sts?|stitches)\s*\)/i.exec(t);
        if (pd) { info.section.prevCount = int(pd[1]); info.section.prevSizes = null; }
      }
      // "Place last 28 (32, 36) sts worked onto holder for top of foot. Heel flap
      // will be worked back and forth over rem 28 (32, 36) sts." - a note that
      // changes what is on the needle
      if (L.kind === 'note' && typeof info.section.prevCount === 'number') {
        var hctx = { size: info.size, count: E.sizeCount(), scope: run.scope || null };
        var over = /\b(?:worked|work|knit|forth|flap)\b[^.]*?\bover\s+(?:the\s+)?(?:rem(?:aining)?\s+|first\s+|last\s+|cent(?:er|re)\s+)?(\d+(?:\s*\([^)]*\))?)\s*(?:[a-z]+\s+)?sts?\b/i.exec(t);
        var held = /\b(?:place|put|slip|sl|leave|transfer)\s+(?:the\s+)?(?:last|first|next|rem(?:aining)?)?\s*(\d+(?:\s*\([^)]*\))?)\s*(?:[a-z]+\s+)?sts?\b[^.]*?\b(?:on(?:to)?|to)\s+(?:a\s+|the\s+)?(?:st(?:itch)?\s+)?(?:holder|scrap|waste|spare)/i.exec(t);
        var hv;
        // "Heel Flap: This is worked back and forth on half of your stitches
        // only…remainder of stitches will rest" - half of what is on the needle
        var half = /\b(?:worked|work|knit)\b[^.]*?\bon\s+half\s+(?:of\s+)?(?:the|your)\s+(?:stitches|sts)\b/i.test(t);
        if (half && !over && info.section.prevCount % 2 === 0) {
          info.section.prevCount = info.section.prevCount / 2;
          info.section.prevSizes = null;
        } else
        // "Heel: Place first 15 and last 14 sts of rnd on one needle—29 sts for
        // heel." - a note that states what is on the needle now
        // (or after the cast-on: Oriel's "Shape waist: ... every 8th row 6
        // times, ending with chart Row 20—87 (99, 111, 123) sts rem")
        if (L.count !== null && L.count !== undefined && (info.section.hasRow || info.section.hasSetup) && /^[A-Z]/.test(t) &&
            (DASH_TOTAL_RE.test(t) || REM_TOTAL_RE.test(t))) {
          info.section.prevCount = L.count;
          info.section.prevSizes = (L.sizes && L.sizes.length > 1) ? L.sizes.slice() : null;
        } else if (over) {
          hv = resolveSizes(over[1], hctx);
          if (!hv.bad && int(hv.text) > 0) {
            info.section.prevCount = int(hv.text);
            var ol = /^(\d+)\s*\(([^)]*)\)/.exec(over[1]);
            info.section.prevSizes = ol ? [int(ol[1])].concat(ol[2].split(/\s*[,\-]\s*/).map(int)) : null;
          }
        } else if (held) {
          hv = resolveSizes(held[1], hctx);
          if (!hv.bad && int(hv.text) > 0 && info.section.prevCount - int(hv.text) > 0) { info.section.prevCount -= int(hv.text); info.section.prevSizes = null; }
        }
      }
      // a scope lasts until "All sizes:" or the end of the part its first row
      // is in (a "Sizes XL only:" label often opens a new part: "1st rnd:")
      var lead = /^(?:row|setup|repeat)$/.test(L.kind);
      if (run.scope && lead) {
        if (run.scopeSection === null) run.scopeSection = info.section;
        else if (run.scopeSection !== info.section) run.scope = null;
      }
      var sc = scopeOf(t);
      if (sc) {
        run.scope = sc.indices ? sc : null;
        run.scopeSection = lead ? info.section : null;
      }
      if (L.kind === 'repeat' || L.kind === 'note') {
        if (L.until === null) L.until = untilOf(t, info.size);
        if (L.chart === null) L.chart = chartOf(t);
        if (L.cable === null) L.cable = cableOf(t);
        if (L.kind === 'repeat') {
          var scope = sc || run.scope;
          if (L.stitches === null && L.sizes && scope && scope.indices && L.sizes.length === scope.indices.length) {
            var k = scope.indices.indexOf(info.size);
            if (k >= 0) { L.stitches = L.sizes[k]; L.sizeUnresolved = false; L.count = L.stitches; L.countSource = 'explicit'; }
          }
          if (/\bending\s+with\s+(?:a\s+)?(ws|rs)\b/i.test(t)) L.side = null;
          // "...until 4 sts rem." / "until there are 133 (137-...) sts" - what
          // the rows come to, as printed
          if ((L.count === null || L.count === undefined) && !L.repeatOf && (String(t).match(/\buntil\b/gi) || []).length === 1) {
            // ("...until there are (61-63-65) sts" - a bare list on a line for
            // some sizes only)
            var ur = /\buntil\s+(?:there\s+are\s+)?(\(\s*\d[^)]*\)|\d+(?:\s*\([^)]*\))?)\s*sts?\s*(?:rem(?:ain(?:s|ing)?)?|on\s+(?:the\s+)?needles?|in\s+all)?\s*[.;,]?\s*$/i.exec(t.replace(/,\s*taking\b[^.]*\.?\s*$/i, ''));
            if (ur) {
              var urv = resolveSizes(ur[1], { size: info.size, count: E.sizeCount(), scope: (sc || run.scope) || null });
              var urn = urv.bad ? null : int(urv.text);
              if (urn !== null) { L.count = L.stitches = urn; L.countSource = 'explicit'; }
            }
          }
          L.shortRow = /\bshort[-\s]rows?\b/i.test(t);
          thenOnceMore(L, info, t);
          repeatRowCounts(L, info);
          // the rows after a repeat start from what the repeat leaves
          if (L.count !== null && L.count !== undefined) info.section.prevCount = L.count;
        }
      }
      // (a stretch's printed total - "Knit even ... until work measures 8½",
      // inc 10 sts evenly around last rnd. 174 (...) sts." - is where the part
      // now stands, whichever branch above read it)
      if (L.kind === 'repeat' && typeof L.count === 'number' && L.countSource === 'explicit') info.section.prevCount = L.count;
      // the size list behind the count the part now stands at (carried into
      // the next part's text when that part starts from it)
      if ((info.isRow || info.isSetup || L.kind === 'repeat') && L.count !== null && L.count !== undefined) {
        var kept = info.section.prevSizes !== undefined ? info.section.prevSizes :
          (info.section.carried ? info.section.carried.sizes : null);
        var from = L.kind === 'repeat' ? L.countsStart : L.prevCount;
        info.section.prevSizes = (L.countSource === 'explicit' && L.sizes && L.sizes.length > 1) ? L.sizes.slice() :
          // a row that leaves the count as it was leaves every size's count as it was
          ((L.countSource === 'computed' && kept && from === L.count && kept[Math.min(E.sizeIndex(), kept.length - 1)] === L.count) ? kept : null);
      }
      if (info.section.carried && !info.section.carriedNoted && (info.isRow || info.isSetup)) {
        info.section.carriedNoted = true;
        if (info.isRow) L.startFrom = info.section.carried;
      }
      // a row whose count cannot be read leaves the count unknown: the rows
      // after it are not counted from a stale number
      // starred size-only rows: the scope of the starred row before goes on
      var star = starRow(t);
      if (star) {
        var ssc = star.own ? star.scope : run.starScope;
        if (star.own) run.starScope = star.scope;
        if ((ssc && !inScope(ssc, info.size)) || (star.own && !ssc)) L.sizeSkip = true;
      } else if (/^\s*(?:rows?|rnds?|rounds?)\s*\d/i.test(t)) run.starScope = null;
      if (info.isRow && (L.count === null || L.count === undefined) && !L.sizeSkip && !L.keepCount) info.section.prevCount = null;
      var excluded = sc && !inScope(sc, info.size);
      if (excluded || (!sc && run.scope && !inScope(run.scope, info.size))) L.sizeSkip = true;
      // "..., ending on a 1st row." - the side of the row named
      if (L.until && L.until.endOnRow) resolveEndOn(L.until, info.lines, L.index, L.section);
      // "Cast off 15 (...) sts beg next 4 rows, then 16 (...) sts beg following 2
      // rows" as rows 5-10: each row's own count (136, 121, 106, 91, 76, 60, 44)
      if (info.isRow && typeof L.rowEnd === 'number' && L.rowEnd > L.row && !L.rowList && !L.repeatOf &&
          typeof L.prevCount === 'number' && !L.counts) {
        var sch = rowSchedule(t, { size: info.size, count: E.sizeCount(), scope: scopeOf(t) || run.scope || null });
        if (sch && sch.length === L.rowEnd - L.row + 1) {
          var cs = [], c0 = L.prevCount;
          sch.forEach(function (d) { c0 += d; cs.push(c0); });
          if (c0 >= 0 && (typeof L.count !== 'number' || L.countSource !== 'explicit' || L.count === c0)) {
            L.counts = cs; L.countsFrom = L.row;
          }
        }
      }
    },

    postParse: function (lines, info) {
      // the panels the text defines, for expand() (see collectPanelText)
      if (E.run().panelText) lines.panelDefs = E.run().panelText;
      var i, L;
      for (i = 0; i < lines.length; i++) ensureFields(lines[i]);
      untilSpans(lines, info);
      lines.rowsFromStart = patternStretches(lines, info);
      stitchGuideParts(lines, info);
      // a prose pattern (no row labels anywhere) numbers no rows of its own in
      // some parts ("BACK AND FRONT: = 92 sts. Cont St-st in rnds until garment
      // meas 32 cm. ..."): a named part with a start and a stretch to work is
      // still a part to knit
      if (E.run().prose) {
        (info.sections || []).forEach(function (s) {
          // (in a book of patterns the pattern's own title names its part)
          if (s.rows > 0 || (!s.name && E.run().proseKind !== 'txt')) return;
          var own = lines.filter(function (l) { return l.section === s.index; });
          var hasStart = own.some(function (l) { return l.kind === 'setup'; });
          var hasWork = own.some(function (l) { return l.kind === 'repeat' || (l.until && l.until.kind); });
          if (hasStart && hasWork) s.offer = true;
        });
      }
      // "2nd and alt rows: Purl." answers for every even row of its section
      // that no other line writes out
      for (i = 0; i < lines.length; i++) {
        L = lines[i];
        if (L.kind !== 'row' || L.rowList) continue;
        var mk = knitDetectMarker(E.trimLine(L.text), E.baseDetectMarker);
        if (!mk || !mk.alt) continue;
        var max = 0, taken = {};
        for (var j = 0; j < lines.length; j++) {
          var o = lines[j];
          if (o === L || o.section !== L.section || o.kind !== 'row' || !(o.row >= 1)) continue;
          if (o.rowEnd > max) max = o.rowEnd;
          if (o.rowList) o.rowList.forEach(function (r) { taken[r] = true; });
          else for (var r = o.row; r <= o.rowEnd; r++) taken[r] = true;
        }
        var list = [];
        // "...all following odd-numbered rows through Row 35": up to there
        if (mk.altTo > L.row) max = mk.altTo;
        for (var r2 = L.row; r2 <= max; r2 += 2) if (!taken[r2]) list.push(r2);
        if (list.length > 1) {
          L.rowList = list;
          L.rowEnd = list[list.length - 1];
          var sec = info.sections[L.section];
          if (sec) sec.rows += list.length - 1;
        }
      }
      // "2nd and alt rows: Purl." / "Rows 2, 4, 6 and 8 (WS)": each listed row
      // has its own count - the row before it, plus what the line does - so
      // row 6 of a raglan neck is 52, not row 2's 36
      // (row by row, in the order the rows are worked, within the part:
      // "Rows 38 and 40" and "Rows 39 and 41" interleave - row 40 counts from
      // row 39's own count, not from the "Rows 39 and 41" line's last one)
      var listBySec = {};
      for (i = 0; i < lines.length; i++) {
        L = lines[i];
        if (L.kind === 'row' && L.rowList && typeof L.net === 'number') (listBySec[L.section] = listBySec[L.section] || []).push(L);
      }
      Object.keys(listBySec).forEach(function (sk) {
        var secLines = lines.filter(function (l) { return l.section === +sk; });
        var owner = {}, memo = {};
        listBySec[sk].forEach(function (l) { l.rowList.forEach(function (r) { if (!owner[r]) owner[r] = l; }); });
        // ...and the single rows between them, which the reading pass counted
        // from the enumeration's last count ("Row 6: Knit." after "Rows 2 and 4")
        secLines.forEach(function (l) {
          if (l.kind === 'row' && !l.rowList && l.row >= 1 && l.row === l.rowEnd && !owner[l.row]) owner[l.row] = l;
        });
        Object.keys(owner).map(Number).sort(function (a, b) { return a - b; }).forEach(function (r) {
          var l = owner[r], before;
          if (memo[r - 1] !== undefined) before = memo[r - 1];
          else if (r > 1) before = E.api.targetFor(secLines, r - 1);
          if (!l.rowList) {
            // a single row: re-counted from the row before when it was counted
            // from its own words; a printed total stays
            if (l.countSource === 'computed' && typeof l.net === 'number' && typeof before === 'number' && !l.repeatOf && !l.keepCount) {
              l.count = l.computed = before + l.net;
            }
            memo[r] = (typeof l.count === 'number') ? l.count : null;
            return;
          }
          if (typeof before !== 'number' && r === l.rowList[0]) before = l.prevCount;
          var own = (typeof before === 'number') ? before + l.net : null;
          // "...—286 sts after Row 40": the printed total is that row's
          if (r === l.rowEnd && l.countSource === 'explicit' && typeof l.count === 'number') {
            if (own !== null && own !== l.count) l.deviation = { printed: l.count, computed: own };
            own = l.count;
          }
          memo[r] = own;
        });
        listBySec[sk].forEach(function (l) {
          var counts = [], any = false;
          l.rowList.forEach(function (r) { var v = memo[r]; counts[r - l.row] = (typeof v === 'number') ? v : null; if (typeof v === 'number') any = true; });
          if (!any) return;
          for (var z = 0; z < counts.length; z++) if (counts[z] === undefined) counts[z] = null;
          l.counts = counts;
          var lastC = counts[l.rowEnd - l.row];
          if (typeof lastC === 'number' && l.countSource !== 'explicit') l.count = l.computed = lastC;
        });
      });
      // charts named in a sentence: "See Chart B for Rows 14-36" puts the chart
      // on rows 14..36 of the part; "ending with chart Row 20" takes the name
      // of the chart the part last named
      var lastChart = {};
      for (i = 0; i < lines.length; i++) {
        L = lines[i];
        var ch = L.chart;
        if (!ch) continue;
        if (ch.name) lastChart[L.section] = ch.name;
        else if (lastChart[L.section]) ch.name = lastChart[L.section];
        if (!ch.covers) continue;
        for (var j2 = 0; j2 < lines.length; j2++) {
          var o2 = lines[j2];
          if (o2.section !== L.section || o2.kind !== 'row' || o2 === L || o2.chart) continue;
          if (o2.row >= ch.row && o2.row <= ch.rowEnd) o2.chart = { name: ch.name, row: o2.row };
        }
        L.chart = (L.kind === 'row' && L.row >= ch.row && L.row <= ch.rowEnd) ? { name: ch.name, row: L.row } :
          { name: ch.name, row: ch.row, rowEnd: ch.rowEnd };
      }
      // flat or in the round, row by row: a flat heel inside a sock knitted in
      // the round says "rows" while it lasts and "rounds" again after
      for (i = 0; i < lines.length; i++) {
        L = lines[i];
        if (L.kind !== 'row' && L.kind !== 'setup') continue;
        var head = String(L.text).slice(0, 40).replace(/[:.][\s\S]*$/, '');
        if (isRoundHead(head)) L.workedIn = 'rounds';
        else if (/\b(?:rows?|short[-\s]?rows?)\b/i.test(head) || L.side || L.shortRow) L.workedIn = 'rows';
      }
      // Sides come from what the pattern prints. An untagged row gets one only
      // when the tagged rows on BOTH sides of it agree by parity ("Row 1 (RS)",
      // "Row 3", "Row 4 (WS)"): parity is not safe on its own - the Icelandic
      // shawl's even rows are its right side, Albus Argyle flips between chart
      // repeats, Genome's second heel half starts "Row 1: (WS)".
      var bySec = {};
      for (i = 0; i < lines.length; i++) {
        L = lines[i];
        if (L.kind !== 'row' || !(L.row >= 1)) continue;
        (bySec[L.section] || (bySec[L.section] = [])).push(L);
      }
      function flip(s) { return s === 'rs' ? 'ws' : 'rs'; }
      function by(ref, row) { return (Math.abs(row - ref.row) % 2 === 0) ? ref.side : flip(ref.side); }
      Object.keys(bySec).forEach(function (k) {
        var rows = bySec[k], q, tag = rows.map(function (l) { return l.side || null; });
        for (q = 0; q < rows.length; q++) {
          var l = rows[q];
          if (tag[q] || l.workedIn === 'rounds') continue;
          var p = -1, n = -1, a;
          for (a = q - 1; a >= 0; a--) if (tag[a]) { p = a; break; }
          for (a = q + 1; a < rows.length; a++) if (tag[a]) { n = a; break; }
          if (p < 0 || n < 0) continue;
          var sp = by({ row: rows[p].row, side: tag[p] }, l.row);
          var sn = by({ row: rows[n].row, side: tag[n] }, l.row);
          if (sp === sn) l.side = sp;
        }
      });
    }
  };

  var Knits = window.Patterns.createParser(KNIT_PROFILE);

  // =====================================================================
  // 5. expand() - one record per stitch, for the 3D view
  // =====================================================================
  //
  // { stitches:[{t, c, h, w, side, cross?, span?}], color, height, width,
  //   state, inc, dec, shortRow, live }
  // Types: k p yo k2tog ssk k3tog cdd m1 kfb sl cable co bo. Heights in stitch
  // widths (stockinette / rib / lace / cable 0.75 a row; garter 0.5 - a ridge
  // is two rows). Widths: 1 a stitch, a decrease is the one stitch it makes,
  // rib pulls in to 0.8, a cable crossing to 0.85. `bo` records are the
  // stitches bound off in the row: part of its fabric, gone from the needle,
  // so `live` (= count) is the records that are not `bo`. A short row has
  // records only for the stitches it works.

  var H_ROW = 0.75, H_GARTER = 0.5, W_RIB = 0.8, W_CABLE = 0.85;

  function emptyExpand(st) {
    return { stitches: [], color: (st && st.color) || null, height: H_ROW, width: 0, state: st || {}, inc: [], dec: [],
      shortRow: false, live: 0 };
  }

  function recordsOf(run, unknownWidths) {
    var out = [], u = 0;
    function push(t, n, extra) {
      for (var i = 0; i < n && out.length < 20000; i++) {
        var r = { t: t };
        if (extra) for (var k in extra) r[k] = extra[k];
        if (extra && extra.span) r.at = i % extra.span;
        out.push(r);
      }
    }
    (run.trace || []).forEach(function (tr) {
      var at0 = out.length;
      one(tr);
      // wave I: the repeat tag of the op (only ever set under repeatGroups)
      if (tr.rp) for (var j = at0; j < out.length; j++) out[j].rp = tr.rp;
    });
    function one(tr) {
      if (tr.op) {
        var o = tr.op, n = tr.n || 1;
        if (o.held) return;
        if (o.t === 'bo') { push('bo', o.c * n); return; }
        // ("P0 (2-2-2-0-2)": no stitches for this size)
        if (o.p === 0 && o.c === 0) return;
        if (o.p <= 0) {
          // psso: the stitch it passes over leaves the needle; the stitch
          // before it becomes the decrease
          for (var q = 0; q < -o.p * n && out.length; q++) out.pop();
          if (out.length) out[out.length - 1].t = out[out.length - 1].t === 'k' ? 'ssk' : out[out.length - 1].t;
          return;
        }
        var t = o.t || 'k';
        if (t === 'cable') { for (var c = 0; c < n; c++) push('cable', o.p, { cross: o.cross, span: o.span, name: o.name }); return; }
        // "Work 1st row of Panel Pat C": that panel row's own stitches
        if (o.panel && CUR_PANELS) {
          var pr = panelRecords(o.panel, o.panelRow);
          if (pr) {
            for (var pi = 0; pi < n; pi++) pr.forEach(function (r) { var cp = {}; for (var k in r) cp[k] = r[k]; out.push(cp); });
            return;
          }
        }
        if (t === 'kfb') { push('kfb', o.p * n); return; }
        push(t, o.p * n);
      } else if (tr.unknownFill) {
        var w = unknownWidths[u++] || 0;
        push(tr.unknownFill.t || 'k', w);
      } else if (tr.unknownBlock) {
        u++;
      }
    }
    return out;
  }

  function knitExpand(lines, rowNumber, prevCount, state) {
    var savedPanels = CUR_PANELS, savedShift = PANEL_SHIFT;
    // (the panels the document - or the part's carried stitch guide - defines)
    if (lines && lines.panelDefs) CUR_PANELS = lines.panelDefs;
    PANEL_SHIFT = 0;
    try { return knitExpand0(lines, rowNumber, prevCount, state); } finally { CUR_PANELS = savedPanels; PANEL_SHIFT = savedShift; }
  }

  function knitExpand0(lines, rowNumber, prevCount, state) {
    var parsed, st;
    try {
      parsed = E.asParsed(lines);
      st = E.normState(state, parsed);
    } catch (e) {
      return emptyExpand(state);
    }
    var res = emptyExpand(st);
    try {
      var line = E.lineFor(parsed, rowNumber) || E.repeatLineFor(parsed, rowNumber);
      if (!line) return res;
      if (!st.init) {
        st.init = true;
        for (var i = 0; i < parsed.length; i++) {
          var l = parsed[i];
          if (l.index >= line.index) break;
          if (l.kind === 'note' || l.kind === 'header' || l.kind === 'setup') E.applyPhrases(l.text, st);
        }
      }
      if (line.notes) line.notes.forEach(function (n) { E.applyPhrases(n, st); });
      // a German short row of a prose pattern (see germanShortRows): the
      // stitches it works, on its side - the stitches on the needle stay
      if (line.shortRows && typeof line.row === 'number' && rowNumber >= line.row) {
        var gs = line.shortRows[rowNumber - line.row];
        if (gs) {
          var gt = gs.side === 'ws' ? 'p' : 'k';
          res.stitches = [];
          for (var gi = 0; gi < gs.worked; gi++) res.stitches.push({ t: gt, c: st.color || null, h: H_ROW, w: 1, side: gs.side });
          res.color = st.color || null;
          res.height = H_ROW;
          res.width = gs.worked;
          res.inc = []; res.dec = [];
          res.shortRow = true;
          res.side = gs.side;
          res.live = gs.worked;
          res.worked = gs.worked;
          if (typeof line.computed === 'number') res.onNeedle = line.computed;
          return res;
        }
      }
      var src = line.repeatOf ? E.refSource(parsed, line, rowNumber, 0) : null;
      // "Rep inc on alt rnds a total of 11 times" (see repeatRowCounts): the
      // block is (plain round, the increase round) - the plain round is printed
      // nowhere, and the row before the increase may be anything (Sandnes: the
      // last German short row)
      var altPlain = false;
      if (line.kind === 'repeat' && line.repeatDeltas && line.repeatOf && line.repeatOf.length === 2 && rowNumber !== line.row) {
        var aFrom = typeof line.countsFrom === 'number' ? line.countsFrom : line.repeatFrom;
        if (typeof aFrom === 'number' && rowNumber >= aFrom) {
          var aOff = (rowNumber - aFrom) % 2;
          if (line.repeatDeltas[aOff] === 0) altPlain = true;
          else src = E.lineFor(parsed, line.repeatOf[1]) || src;
        }
      }
      // a shaping stretch's rounds (see shapeEvery): plain, and on the last of
      // each group the decrease "as before" (the row it points back to)
      var shapeInstr = null;
      if (line.shapeRows && typeof line.countsFrom === 'number') {
        var sk = rowNumber - line.countsFrom, sd = line.shapeRows.deltas[sk];
        if (sd === 0) shapeInstr = 'Knit.';
        else if (typeof sd === 'number') {
          var ssrc = line.shapeRows.src ? E.lineFor(parsed, line.shapeRows.src) : null;
          if (ssrc) src = ssrc; else shapeInstr = 'Knit.';
        }
      }
      var useLine = (src && src !== line) ? src : line;
      // a repeat works its rows again, and the panels in them go on: garment
      // row 17 working row 1 again works Panel Pat C's row 17, not its row 1
      if (line.kind === 'repeat' && useLine !== line && line.repeatOf && line.repeatOf.length) {
        var rFrom = typeof line.repeatFrom === 'number' ? line.repeatFrom : line.row;
        var ref1 = rFrom >= 1 && rowNumber >= rFrom ? line.repeatOf[(rowNumber - rFrom) % line.repeatOf.length] : null;
        if (ref1 >= 1 && useLine.row === ref1 && !useLine.repeatOf) PANEL_SHIFT = rowNumber - ref1;
      }
      var instr = altPlain ? 'Knit.' : shapeInstr !== null ? shapeInstr : E.instrOf(useLine);
      // a ranged shaping row with per-row counts (see rowSchedule): this row's
      // own cast-off, then the rest of the row in pattern
      if (useLine === line && line.kind === 'row' && line.counts && typeof line.countsFrom === 'number' && typeof line.prevCount === 'number') {
        var rk = rowNumber - line.countsFrom;
        if (rk >= 0 && rk < line.counts.length) {
          var rd = line.counts[rk] - (rk > 0 ? line.counts[rk - 1] : line.prevCount);
          instr = rd < 0 ? 'Cast off ' + (-rd) + ' sts, work to end.' : rd > 0 ? 'Cast on ' + rd + ' sts, work to end.' : 'Work to end.';
        }
      }
      E.applyPhrases(instr, st);
      var prev = (typeof prevCount === 'number' && isFinite(prevCount)) ? prevCount : null;
      if (prev === null && rowNumber === line.row && typeof line.prevCount === 'number') prev = line.prevCount;
      var ev = knitEval(instr, prev, { castOnAbs: line.kind === 'setup' });
      var target = (line.count !== null && line.count !== undefined && !(src && src !== line)) ? line.count :
        (ev.count !== null ? ev.count : null);
      // ("Cast off 2 sts beg next 2 rows. 55 sts rem." as rows 5-6: the
      // printed total is the last row's; the rows before it count from prev)
      if (!(src && src !== line) && typeof line.rowEnd === 'number' && rowNumber < line.rowEnd && rowNumber >= line.row &&
          !line.repeatOf && typeof line.count === 'number' && typeof line.prevCount === 'number') {
        var rSpan = line.rowEnd - line.row + 1, rStep = (line.count - line.prevCount) / rSpan;
        if (rStep === Math.round(rStep)) target = line.count - rStep * (line.rowEnd - rowNumber);
      }
      // a repeat's own count for this row (repeatRowCounts), when it has one
      if ((line.kind === 'repeat' || (line.kind === 'row' && useLine === line)) && line.counts && typeof line.countsFrom === 'number') {
        var rc = line.counts[rowNumber - line.countsFrom];
        if (typeof rc === 'number') target = rc;
      }
      var recs = [];
      if (ev.run && !ev.bad) {
        // the stretches the words do not size ("knit to next marker") share
        // what the row's total leaves over, evenly
        var unk = ev.run.trace.filter(function (x) { return x.unknownFill || x.unknownBlock; });
        var widths = [];
        if (unk.length && prev !== null) {
          var fixedC = 0;
          ev.run.trace.forEach(function (x) { if (x.op && !x.op.held) fixedC += x.op.c * (x.n || 1); else if (x.op && x.op.held) fixedC += x.op.c * (x.n || 1); });
          var left = Math.max(0, prev - fixedC);
          var each = Math.floor(left / unk.length), extra = left - each * unk.length;
          unk.forEach(function (x, k) { widths.push(x.unknownFill ? each + (k < extra ? 1 : 0) : 0); });
        }
        recs = recordsOf(ev.run, widths);
        // a full row whose words did not account for every stitch: the rest
        // are worked in pattern (only when no total says otherwise)
        if (!ev.short && prev !== null) {
          var used = 0;
          ev.run.trace.forEach(function (x) { if (x.op) used += x.op.c * (x.n || 1); });
          widths.forEach(function (w) { used += w; });
        }
      }
      var live = recs.filter(function (r) { return r.t !== 'bo'; }).length;
      // wave I: a row padded or cut to its total is not the groups its words make
      if (E.tagReps() && !ev.short && target !== null && live !== target) res.fitted = true;
      if (!ev.short && target !== null) {
        if (live < target) {
          for (var a = live; a < target; a++) recs.push({ t: 'k' });
        } else if (live > target) {
          var cut = live - target;
          for (var b = recs.length - 1; b >= 0 && cut > 0; b--) {
            if (recs[b].t === 'k' || recs[b].t === 'p') { recs.splice(b, 1); cut--; }
          }
        }
      }
      // fabric: garter, rib, cable
      var side = line.side || null;
      var kinds = { k: 0, p: 0, other: 0 };
      recs.forEach(function (r) { if (r.t === 'k') kinds.k++; else if (r.t === 'p') kinds.p++; else if (r.t !== 'bo') kinds.other++; });
      var pure = (kinds.p === 0 && kinds.other === 0 && kinds.k > 0) ? 'k' : (kinds.k === 0 && kinds.other === 0 && kinds.p > 0 ? 'p' : null);
      var flat = side !== null || /\b(?:rows?)\b/i.test(String(line.text).slice(0, 20));
      var garter = /\bgarter\b/i.test(instr) ||
        (pure && st.lastPure && ((flat && pure === 'k' && st.lastPure === 'k') || (!flat && pure !== st.lastPure)));
      var rib = isRib(recs);
      var h = garter ? H_GARTER : H_ROW;
      st.lastPure = pure;
      res.stitches = recs.map(function (r) {
        var o = { t: r.t, c: st.color || null, h: h, w: 1, side: side };
        if (r.t === 'cable') { o.w = W_CABLE; o.cross = r.cross; o.span = r.span; o.at = r.at; if (r.name) o.name = r.name; }
        else if (rib && (r.t === 'k' || r.t === 'p')) o.w = W_RIB;
        if (r.t === 'bo') o.w = 0;
        if (r.rp) o.rp = r.rp;
        return o;
      });
      res.color = st.color || null;
      res.height = h;
      res.width = res.stitches.reduce(function (s, r) { return s + r.w; }, 0);
      res.inc = []; res.dec = [];
      res.stitches.forEach(function (r, k) {
        if (r.t === 'm1' || r.t === 'kfb' || r.t === 'yo' || r.t === 'co') res.inc.push(k);
        else if (r.t === 'k2tog' || r.t === 'ssk' || r.t === 'k3tog' || r.t === 'cdd') res.dec.push(k);
      });
      res.shortRow = !!(ev.short || line.shortRow);
      res.live = res.stitches.filter(function (r) { return r.t !== 'bo'; }).length;
      res.side = side;
      if (line.deviation) res.deviation = line.deviation;
    } catch (e2) {
      res.stitches = res.stitches || [];
    }
    return res;
  }

  /**
   * Each German short row a prose line works, in order: { n, side, worked }.
   * "k5 (6, 7, 8, 8, 9) sts, turn, ... p9 (11, ...) sts, turn, ..." works 5 on
   * the RS, then 9 on the WS; "Work and turn 2 sts pass previous turning until
   * a total of 3 times at each side" goes on 2 further each time, sides in
   * turn, until each side has turned 3 times (Sandnes: 5, 9, 11, 13, 15, 17).
   * Null when the line does not say how far.
   */
  function germanShortRows(t, ctx, sec, L) {
    var out = [], prev = sec.gsr || null, m;
    var span = (typeof L.rowEnd === 'number' && typeof L.row === 'number') ? L.rowEnd - L.row + 1 : 1;
    var wk = /\b([kp])\s*(\d+)(\s*\(\s*\d+(?:\s*[,\-]\s*\d+)*\s*\))?\s*(?:sts?|stitches)\b/gi;
    while ((m = wk.exec(t)) !== null) {
      var vs = sizesOf(m[2], m[3]), v = vs.length > 1 ? pickFrom(vs, ctx) : vs[0];
      if (typeof v !== 'number') return null;
      out.push({ side: m[1].toLowerCase() === 'k' ? 'rs' : 'ws', worked: v });
    }
    var st = /\b(\d+)\s+sts?\s+(?:pass|past|beyond)\s+(?:the\s+)?previous\s+turn(?:ing)?\b/i.exec(t);
    if (!out.length && st && prev) {
      var step = int(st[1]), w = prev.worked, side = prev.side;
      for (var q = 0; q < span; q++) {
        side = side === 'rs' ? 'ws' : 'rs';
        w += step;
        out.push({ side: side, worked: w });
      }
    }
    if (!out.length || out.length !== span) return null;
    var base = prev ? prev.n : 0;
    out.forEach(function (r, k) { r.n = base + k + 1; });
    sec.gsr = { n: base + out.length, worked: out[out.length - 1].worked, side: out[out.length - 1].side };
    return out;
  }

  /**
   * The stitches each row of a shaping sentence casts off (or on), in order:
   * "Cast off 15 (...) sts beg next 4 rows, then 16 (...) sts beg following 2
   * rows" -> [-15, -15, -15, -15, -16, -16]. Null when it is not one.
   */
  var SCHED_SEG_G = /\b(?:(cast\s+off|bind\s+off|bo|cast\s+on|co)\s+|then\s+)(\d+)(\s*\(\s*\d+(?:\s*[,\-]\s*\d+)*\s*\))?\s*sts?\s+(?:at\s+)?(?:the\s+)?beg(?:inning)?(?:\s+of)?\s+(?:the\s+)?(?:next|foll(?:owing)?)\s+(\d+)\s+(?:rows?|rnds?)\b/gi;
  function rowSchedule(t, ctx) {
    var s = E.normDashes(String(t)), m, out = [], sign = null;
    SCHED_SEG_G.lastIndex = 0;
    while ((m = SCHED_SEG_G.exec(s)) !== null) {
      if (m[1]) sign = /on$|^co$/i.test(m[1].replace(/\s+/g, ' ').trim()) ? 1 : -1;
      if (sign === null) return null;
      var vs = sizesOf(m[2], m[3]), v = vs.length > 1 ? pickFrom(vs, ctx) : vs[0], k = int(m[4]);
      if (typeof v !== 'number' || !(k >= 1 && k <= 60)) return null;
      for (var q = 0; q < k; q++) out.push(sign * v);
    }
    return out.length ? out : null;
  }

  function isRib(recs) {
    var runs = [], cur = null, n = 0;
    recs.forEach(function (r) {
      var t = (r.t === 'k' || r.t === 'p') ? r.t : 'x';
      if (t === cur) n++;
      else { if (cur) runs.push([cur, n]); cur = t; n = 1; }
    });
    if (cur) runs.push([cur, n]);
    if (runs.length < 4) return false;
    return runs.every(function (x) { return x[0] !== 'x' && x[1] <= 3; });
  }

  // =====================================================================
  // 6. workMode / startHint
  // =====================================================================

  function textOfAny(x) { try { return E.normUnicode(E.textOf(x)); } catch (e) { return ''; } }

  /** @returns {'rounds'|'rows'|null} */
  function knitWorkMode(text) {
    var s = textOfAny(text).toLowerCase();
    if (!s) return null;
    var rnd = E.countMatches(s, '(?:^|[^a-z])(?:rnds?|rounds?)\\.?\\s*\\d|\\b(?:next|\\d+(?:st|nd|rd|th))\\s+(?:rnd|round)\\b');
    var row = E.countMatches(s, '(?:^|[^a-z])rows?\\.?\\s*\\d|\\b(?:next|\\d+(?:st|nd|rd|th))\\s+row\\b|\\((?:rs|ws)\\)');
    // a sock begun in the round, with a flat heel flap in the middle and the
    // foot in rounds again after it, is a piece in rounds
    if (row > rnd && rnd > 0) {
      var RND_AT = /(?:^|[^a-z])(?:rnds?|rounds?)\.?\s*\d|\b(?:next|\d+(?:st|nd|rd|th))\s+(?:rnd|round)\b|\bjoin\s+(?:to\s+work\s+)?in\s+the\s+(?:rnd|round)\b|\bin\s+the\s+round\b/g;
      var ROW_AT = /(?:^|[^a-z])rows?\.?\s*\d|\b(?:next|\d+(?:st|nd|rd|th))\s+row\b/g;
      var mm, firstRnd = -1, lastRnd = -1, firstRow = -1, lastRow = -1;
      while ((mm = RND_AT.exec(s)) !== null) { if (firstRnd < 0) firstRnd = mm.index; lastRnd = mm.index; }
      while ((mm = ROW_AT.exec(s)) !== null) { if (firstRow < 0) firstRow = mm.index; lastRow = mm.index; }
      if (firstRnd >= 0 && firstRow >= 0 && firstRnd < firstRow && lastRnd > lastRow) return 'rounds';
    }
    // a piece in prose that says it is worked in rounds ("Join and work 7 cm
    // ribbing k1, p1 in rnds", "k 1 rnd", "beg of rnd", "alt rnds") is in
    // rounds - its German short rows' "turn" and "next row" do not make it flat
    // (Sandnes yokes)
    if (row <= 2 && rnd <= row && /\b(?:join\b[^.]{0,60}\bin\s+(?:the\s+)?(?:rnds?|rounds?)|(?:work|knit|k)\b[^.]{0,40}\bin\s+(?:rnds?|rounds?))\b/.test(s)) {
      var rndW = E.countMatches(s, '\\b(?:rnds?|rounds?)\\b');
      var rowW = E.countMatches(s.replace(/\bshort[-\s]rows?\b/g, ' '), '\\brows?\\b');
      if (rndW > rowW) return 'rounds';
    }
    if (rnd > row) return 'rounds';
    if (row > rnd) return 'rows';
    var rw = E.countMatches(s, '\\b(?:in\\s+the\\s+(?:rnd|round)|join\\s+(?:to\\s+work\\s+)?in\\s+the\\s+(?:rnd|round)|dpns?|double[-\\s]pointed|magic\\s+loop|circular)\\b');
    var ow = E.countMatches(s, '\\b(?:turn|back\\s+and\\s+forth|straight\\s+needles?)\\b');
    if (rw > ow) return 'rounds';
    if (ow > rw) return 'rows';
    return null;
  }

  /**
   * How the piece starts. Same shape as the crochet one plus `castOn`:
   * { start: 'cast-on' | 'cast-on-round' | 'unknown', castOn, method,
   *   chainLen: 0, ringCount: 0 }
   */
  function knitStartHint(lines) {
    var res = { start: 'unknown', chainLen: 0, ringCount: 0, castOn: 0, method: null };
    var parsed;
    try { parsed = E.asParsed(lines); } catch (e) { return res; }
    // from the piece's foundation (the first setup line, else the first
    // row) - the cover and the materials list say nothing about it
    var txt = [], first = -1, firstRow = null;
    for (var i = 0; i < parsed.length; i++) {
      if (parsed[i].kind === 'setup' || parsed[i].kind === 'row') { first = i; break; }
    }
    if (first < 0) return res;
    for (i = first; i < parsed.length && txt.length < 4; i++) {
      var l = parsed[i];
      if (l.kind === 'header' || l.consumed) continue;
      txt.push(String(l.text));
      if (l.kind === 'row') { firstRow = l; break; }
    }
    var s = E.normUnicode(txt.join(' '));
    var m = /\b(?:co|cast\s+on)\s+(\d+)(?:\s*\(\s*([\d\s,\-]+)\))?/i.exec(s);
    if (!m) return res;
    var n = int(m[1]);
    if (m[2]) {
      var v = pickFrom([n].concat(m[2].split(/\s*[,\-]\s*/).map(int)), { size: 0, count: 0 });
      if (v !== undefined) n = v;
    }
    res.castOn = n || 0;
    var meth = /\b(turkish|judy'?s\s+magic|provisional|long[-\s]tail|cable|backward[-\s]loop|knitted|german\s+twisted|tubular|figure[-\s]8)\b/i.exec(s);
    if (meth) res.method = meth[1].toLowerCase().replace(/\s+/g, '-');
    // in the round only when the start says so - a top-down sweater that
    // joins after eight flat neck rows starts flat
    var round = /\bjoin\b[^.]{0,40}\b(?:rnd|round)\b|\bin\s+the\s+(?:rnd|round)\b|\bjoin\s+(?:to\s+work\s+)?in\s+the\s+(?:rnd|round)|\bpm\s+and\s+join\b|\b(?:turkish|judy)/i.test(s.split(/\b(?:row|rnd|round)\s+2\b/i)[0]) ||
      (firstRow && firstRow.workedIn === 'rounds' && !(firstRow.side));
    if (firstRow && firstRow.workedIn === 'rows' && !/\b(?:turkish|judy)/i.test(s)) round = false;
    res.start = round ? 'cast-on-round' : 'cast-on';
    return res;
  }

  Knits.expand = knitExpand;
  Knits.workMode = knitWorkMode;
  Knits.startHint = knitStartHint;
  // the knitting reading of one instruction, with its markers and short-row
  // flag (the counter's marker strip and the tests read it)
  Knits.readInstruction = function (instr, prevCount, opts) {
    var r = knitEval(instr, prevCount, opts || {});
    return { count: r.count, net: r.net, markers: markersOf(r.markers, instr), shortRow: r.short, gap: r.gap };
  };
  Knits.until = function (text, size) { return untilOf(text, size || 0); };
  // (Patterns parity: Tunisian crochet is the crochet reader's; a knitting text
  // never is)
  // the older vocabulary (see periodVocab) is a dialect of knitting: a text
  // written in it ("narrow", "widen", "pearl", "seam-stitch", "slip and bind",
  // "take in", "intakes", "knit plain") says so
  var baseDialect = Knits.dialectHints;
  var PERIOD_WORDS_G = /\b(?:narrow(?:ing)?|widen(?:ing)?|pearl(?:ing|ed)?|seam[-\s]stitch|slip\s+and\s+bind|take\s+in|intakes?|knit\s+plain|plain\s+(?:rounds?|rows?|knitting)|pins,?\s+no\.?|top[-\s]band|over\s+the\s+needle)\b/gi;
  Knits.dialectHints = function (text) {
    var r = baseDialect(text);
    var s = String(text == null ? '' : (typeof text === 'string' ? text : E.textOf(text)));
    var n = (s.match(PERIOD_WORDS_G) || []).length;
    // ("K 2, P 2, ... K 2 tog, p.s.s.o., Y O" - the spaced abbreviations of the
    // older booklets, Begin to Knit)
    var spaced = (s.match(/\b[KP] \d+\b/g) || []).length, oldAbbr = (s.match(/\bp\.s\.s\.o\.|\bY O\b|\bK \d+ tog\b/g) || []).length;
    if (spaced >= 20 && oldAbbr >= 2) n += 3;
    if (r && n >= 3) { r.dialect = 'period'; r.period = true; }
    return r;
  };
  // A pattern's own abbreviation block, each meaning whole: "C6F = Slip next" /
  // "3 stitches onto a cable" / "needle and leave at" / "front of work. K3, then"
  // / "K3 from cable needle." is one meaning, not "Slip next" (the engine's
  // reader takes one line to a meaning). Its entries come first; the craft
  // table fills in the rest as before.
  var baseGlossary = Knits.glossary;
  var OWN_GLOSS_HEAD_RE = /^(?:abbreviations?|terminolog(?:y|ies)|terms(?:\s+used)?|glossary|stitch\s+(?:guide|key|terms)|special\s+(?:abbreviations?|stitches))\b[^.]{0,30}$/i;
  var OWN_GLOSS_DEF_RE = /^([A-Za-z][A-Za-z0-9&\/'+.-]{0,11}(?:\s?\(s\)|\s?\([a-z]{1,4}\))?)\s*(?:=\s*(\S.*)?|(?:\s-\s|–|—)\s*(\S.*))$/;
  var OWN_GLOSS_SPLIT_RE = /\s(?=[A-Za-z][A-Za-z0-9&\/'+.-]{0,11}(?:\s?\(s\))?\s=\s)/;
  function glossKeyK(a) { return String(a).toLowerCase().replace(/\s+/g, '').replace(/\(s\)$/, ''); }
  function ownGlossary(text) {
    var s = E.normUnicode(String(text == null ? '' : (typeof text === 'string' ? text : E.textOf(text))));
    var raws = s.split(/\r\n|\r|\n/), out = [], seen = {};
    for (var i = 0; i < raws.length; i++) {
      if (!OWN_GLOSS_HEAD_RE.test(E.trimLine(raws[i]))) continue;
      var cur = null, miss = 0;
      for (var j = i + 1; j < raws.length && j <= i + 160; j++) {
        var t = E.trimLine(raws[j]);
        if (!t || PAGE_LINE_RE.test(t)) continue;
        if (E.detectMarker(t)) break;
        // ("SKILL LEVEL: INTERMEDIATE" - a badge read inside the list)
        if (/^[A-Z][A-Z ]+:\s*[A-Z][A-Z ]*$/.test(t)) continue;
        var parts = t.split(OWN_GLOSS_SPLIT_RE), hit = false;
        for (var k = 0; k < parts.length; k++) {
          var m = OWN_GLOSS_DEF_RE.exec(parts[k].trim());
          if (!m) {
            if (k === 0 && cur && cur.n < 6 && !/^[A-Z][A-Z &'\/-]{3,}$/.test(t)) { cur.e.meaning += ' ' + parts[k].trim(); cur.n++; hit = true; }
            continue;
          }
          hit = true;
          var key = glossKeyK(m[1]);
          if (seen[key]) { cur = null; continue; }
          seen[key] = true;
          var e = { abbr: m[1].trim(), meaning: (m[2] || m[3] || '').trim(), fromPattern: true };
          out.push(e);
          cur = { e: e, n: 1 };
        }
        if (hit) miss = 0;
        else if (++miss > 3 || /^[A-Z][A-Z &'\/-]{3,}$/.test(t)) break;
      }
    }
    out.forEach(function (e) { e.meaning = e.meaning.replace(/\s+/g, ' ').replace(/\s*\.$/, '').trim(); });
    return out;
  }
  Knits.glossary = function (text) {
    var base = baseGlossary(text), own;
    try { own = ownGlossary(text); } catch (e) { own = []; }
    if (!own.length) return base;
    var seen = {};
    own.forEach(function (e) { seen[glossKeyK(e.abbr)] = true; });
    return own.concat(base.filter(function (e) { return !seen[glossKeyK(e.abbr)]; }));
  };
  // "14 sts St-st with 6 mm ndls = 10 cm" (Sandnes): a gauge of stitches only
  // is still the stitch gauge - rows stay null
  var baseGauge = Knits.gauge;
  var STS_ONLY_GAUGE_RE = /(\d+(?:[.,]\d+)?)\s*(?:sts?|stitches)\b(?![^=\n]*\brows?\b)[^=\n]{0,60}?=\s*(\d+(?:[.,]\d+)?)\s*(cm|in(?:ch(?:es)?)?\b|")/i;
  Knits.gauge = function (text, part) {
    var g = baseGauge(text, part);
    if (!g || g.stsPer4in !== null || g.stsPer10cm !== null || part) return g;
    var s = E.normUnicode(String(text == null ? '' : (typeof text === 'string' ? text : E.textOf(text)))).split(/\r\n|\r|\n/);
    for (var i = 0; i < s.length; i++) {
      var ln = E.trimLine(s[i]), prev = i > 0 ? E.trimLine(s[i - 1]) : '';
      if (!/\b(?:tension|gauge)\b/i.test(ln + ' ' + prev)) continue;
      var m = STS_ONLY_GAUGE_RE.exec(ln);
      if (!m) continue;
      var n = parseFloat(m[1].replace(',', '.')), len = parseFloat(m[2].replace(',', '.'));
      if (!(n > 0 && len > 0)) continue;
      var cm = /^cm/i.test(m[3]) ? len : len * 2.54;
      g.stsPer10cm = Math.round(n * 10 / cm * 10000) / 10000;
      g.stsPer4in = Math.round(n * 10.16 / cm * 10000) / 10000;
      g.source = ln;
      return g;
    }
    return g;
  };
  Knits.isTunisian = function (text) { return false; };
  Knits.tunisian = null;
  Knits.profile = KNIT_PROFILE;

  window.Knits = Knits;
})();
