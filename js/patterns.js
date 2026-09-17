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
'use strict';

(function () {

  // =====================================================================
  // 1. Helpers
  // =====================================================================

  var DASHES = /[\u2010-\u2015\u2212]/g;

  function normDashes(s) { return s.replace(DASHES, '-'); }

  function trimLine(s) {
    return normDashes(String(s == null ? '' : s))
      .replace(/\u00a0/g, ' ')
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
    ['dtr', 1, 1],
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

  var NEXT_ROW_RE = /^next\s+(?:rows?|rnds?|rounds?)\b\s*:?/i;

  var SETUP_RE = /^(?:[a-z]+\s+)?(?:setup(?:\s+rows?)?|foundation(?:\s+rows?)?|base(?:\s+rows?)?|starting\s+row)\s*(?:\((?:ws|rs)\))?\s*:/i;

  // When a keyword marker is separated from its instruction by nothing but a
  // space ("Round 6 if you wish."), the rest must look like crochet or it is
  // just prose that happens to mention a round.
  var ROW_REST_OK_RE = new RegExp('^(?:[(\\[*]|\\d|with|using|work|into|fold|turn|join|magic|mr\\b|ch(?:ain)?\\b|' + STITCH_ALT + '\\b)', 'i');

  // Returns { row, rowEnd, rest } or null.
  function detectMarker(line) {
    var m = KEYWORD_RE.exec(line);
    if (m) {
      var r = num(m[1]);
      var rest = line.slice(m[0].length);
      var sep = m[0].charAt(m[0].length - 1);
      if (/\s/.test(sep) && rest.trim() && !ROW_REST_OK_RE.test(rest.trim())) return null;
      return { row: r, rowEnd: m[2] !== undefined ? num(m[2]) : r, rest: rest };
    }
    var b = BARE_RE.exec(line);
    if (b) {
      var r2 = num(b[1]);
      return { row: r2, rowEnd: b[2] !== undefined ? num(b[2]) : r2, rest: line.slice(b[0].length) };
    }
    return null;
  }

  function detectNextRow(line) {
    var m = NEXT_ROW_RE.exec(line);
    if (!m) return null;
    return { rest: line.slice(m[0].length) };
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
  var MULTI_SRC = '(\\d+)\\s*\\(\\s*(\\d+(?:\\s*,\\s*\\d+)+)\\s*\\)(?:\\s*\\(\\s*(\\d+(?:\\s*,\\s*\\d+)+)\\s*\\))?';
  var MULTI_ANY = new RegExp(MULTI_SRC);
  var MULTI_TAIL = new RegExp(MULTI_SRC + '\\s*(?:sts?|stitches?|sc)?\\s*[.,;!]*\\s*$', 'i');

  function flattenMulti(m) {
    var out = [num(m[1])];
    var push = function (grp) {
      if (!grp) return;
      grp.split(',').forEach(function (x) { var n = num(x.trim()); if (n !== null) out.push(n); });
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
  var DASH_TAIL_RE = /-\s*(\d+)\s*(?:sts?|stitches?)?\s*[.,;!]*\s*$/i;
  var PLAIN_TAIL_RE = /(\d+)\s*(?:sts?|stitches?)\s*[.,;!]*\s*$/i;
  var LABEL_TAIL_RE = /\b(?:st|stitch)\s*count\s*:?\s*(\d+)|\bsts?\s*:\s*(\d+)\s*$/i;

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
    var m = MULTI_TAIL.exec(line);
    if (m) return { sizes: flattenMulti(m), start: m.index, end: line.length };

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
  var R_EACH = new RegExp('^(?:(\\d+)\\s*)?(' + STITCH_ALT + ')\\s*(?:sts?|stitch(?:es)?)?\\s*(?:in|into)?\\s*(?:each|every|all)\\b', 'i');
  var R_AROUND = new RegExp('^(' + STITCH_ALT + ')\\s*(?:sts?|stitch(?:es)?)?\\s+(?:around|across|to\\s+end)\\b', 'i');
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

  // Scan an instruction into items: plain text runs and bracket groups.
  function scanItems(s) {
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
        var fm = FILL_AROUND_RE.exec(after);
        if (fm) { filled = true; consumed = fm[0].length; }
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

  function evaluate(instruction, prevCount) {
    if (instruction == null) return null;
    var prev = (typeof prevCount === 'number' && isFinite(prevCount)) ? prevCount : null;
    var s = normDashes(String(instruction)).replace(/\u00a0/g, ' ');
    s = fixTypos(s);

    // Drop a leading row marker if the caller passed a whole line.
    var mk = detectMarker(s.trim());
    if (mk) s = mk.rest;
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
    'finished', 'shaping', 'colours', 'colors'];

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
    /^(.*?)\s+make\s*(\d+)\s*$/i
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
      if (m && m[1].trim()) { s = m[1].trim(); makeCount = num(m[2]) || 1; break; }
    }
    // The colon can sit BEFORE the make-count ("Arms: (Make 2)", "Ears:
    // (make 2)"), so the name is left holding it once the count is off.
    s = s.replace(/\s*:\s*$/, '').trim();
    if (!s) return null;
    s = stripColourSuffix(s);
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
  var INSTR_START_RE = new RegExp('^(?:with|using|work|join|fsc|magic|mr\\b|ch(?:ain)?\\s*\\d|ch(?:ain)?\\b|\\d+\\s*(?:' + STITCH_ALT + ')\\b|' + STITCH_ALT + '\\b)', 'i');

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
    return { name: h.name, makeCount: h.makeCount, rest: m[2], prefixLen: t.length - m[2].length };
  }

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
  var FRONT_MATTER_RE = /^(?:materials?|supplies|tools?|you\s+will\s+need|what\s+you\s+(?:will\s+)?need|abbreviations?|terminolog(?:y|ies)|terms(?:\s+used)?|glossary|gauge|difficulty)\s*[:.]?\s*$/i;

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
  var WORD_NUM = { two: 2, twice: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

  function detectRepeat(t, size) {
    var m = REPEAT_RE.exec(t);
    if (!m) return null;
    var startRow = num(m[1]), endRow = num(m[2]);
    var after = t.slice(m.index + m[0].length);
    var untilRows = null, times = null;

    var u = /until\b([^.]*)/i.exec(after);
    if (u) {
      var seg = u[1];
      var ml = MULTI_ANY.exec(seg);
      if (ml) untilRows = pickSize(flattenMulti(ml), size);
      else {
        var n1 = /(\d+)/.exec(seg);
        if (n1) untilRows = num(n1[1]);
      }
    }
    var tm = /\bx\s*(\d+)\b/i.exec(after);
    if (tm) times = num(tm[1]);
    if (times === null) {
      var tw = /\b(\d+|two|three|four|five|six|seven|eight|nine|ten|twice)\s*(more\s+)?times?\b/i.exec(after);
      if (tw) {
        var v = /^\d+$/.test(tw[1]) ? num(tw[1]) : WORD_NUM[tw[1].toLowerCase()];
        if (v) times = v + (tw[2] ? 1 : 0);
      }
    }
    return { startRow: startRow, endRow: endRow, times: times, untilRows: untilRows };
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
    for (i = 0; i < raws.length; i++) furniture[i] = isFurniture(trimLine(raws[i]));

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

  /** Paragraphs of one assembly block, each with the sub-label above it. */
  function assemblyItems(lines, blk, heads) {
    var out = [], cur = null, label = '', i, l, t, m;
    for (i = blk.from; i < blk.to && i < lines.length; i++) {
      l = lines[i];
      if (!l || l.furniture) continue;
      t = trimLine(l.text);
      if (!t) { cur = null; continue; }
      if (isPhotoLabel(t)) { cur = null; continue; }
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
  var INSTR_ROW_RE = new RegExp('\\b(?:' + STITCH_ALT + '|ch(?:ain)?|mr|magic|turn|join|work)\\b', 'i');

  function makeLine(i, raw) {
    return {
      index: i, text: raw, kind: 'note',
      row: null, rowEnd: null, section: 0,
      stitches: null, sizes: null, computed: null,
      count: null, countSource: null, notes: []
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
      if (!INSTR_ROW_RE.test(t)) continue;
      var ex = findExplicit(t);
      if (ex && ex.end >= t.length) found = ex;
    }
    return found;
  }

  // A physical line can carry two columns of rows:
  // "2. (Hdc 1, Hdc Inc) x 3 (9) 1. 5 Sc in Magic Ring (5)"
  var COLUMN_SPLIT_RE = /\)\s+(?=\d+(?:\s*-\s*\d+)?\s*[.:]\s)/;

  function prepareLines(text) {
    var raws = String(text).split(/\r\n|\r|\n/);
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
      /^(?:inc|sc|hdc|dc|tr|dec|fsc|bbl|sl\s*st|slst)\b/i.test(t) ||
      // "...(sc in next 4 sts," / "2 sc in next st) 5 times...": a wrap can
      // land on the count of a stitch, which reads as a number then a stitch.
      // A line like that with no row marker of its own is always a leftover.
      /^\d+\s*(?:inc|sc|hdc|dc|tr|dec|ch|sl\s*st|slst)\b/i.test(t);
    if (!startsOk) return false;
    // must read like instructions, not like prose commentary
    var hasCount = /[(\[]\s*\d+\s*(?:sts?|stitches?|sc|hdc|dc)?\s*[)\]]/i.test(t) || /\|\s*\d+/.test(t);
    // The count is often glued to the stitch ("21sc", "3scinc"), which a
    // plain \b would miss - a digit and a letter are both word characters,
    // so there is no boundary in front of the "sc" to anchor to.
    var hasStitch = /\b\d*(?:sc|hdc|dc|tr|inc|dec|ch|sl\s*st|slst|bbl|puff|fsc)\b/i.test(t);
    return hasCount || hasStitch;
  }

  function parse(text, opts) {
    if (text === null || text === undefined) return [];
    var size = (opts && typeof opts.size === 'number') ? opts.size : 0;
    var raws = prepareLines(text);
    var heads = findRunningHeads(raws);
    var special = findSpecial(raws, size, heads);
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
        if (!suggestion) { suggestion = cls.repeat; suggestionSection = cur.index; }
      } else if (cls.nextRow) {
        L.row = (cur.lastRow === null ? 0 : cur.lastRow) + 1; L.rowEnd = L.row; L.kind = 'row';
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
        L.row = 1; L.rowEnd = 1; L.kind = 'row';
        prefixLen = cls.nameRow.prefixLen;
        isRow = true;
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
        L.computed = evaluate(instr, cur.prevCount);
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

  function targetFor(lines, row) {
    if (!lines || !lines.length) return null;
    var i, l;
    for (i = 0; i < lines.length; i++) {
      l = lines[i];
      if (l.section === 0 && l.row >= 1 && inRange(l, row) && l.count !== null && l.count !== undefined) return l.count;
    }
    for (i = 0; i < lines.length; i++) {
      l = lines[i];
      if (l.row >= 1 && inRange(l, row) && l.count !== null && l.count !== undefined) return l.count;
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
   'photo photos left right back loops loop').split(' ').forEach(function (w) { COLOR_STOP[w] = true; });

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
  var C_IN = /^\s*(?:in|with|using|w\/)\b\s*(?:the\s+)?(colou?r\s+[a-z]\b|[A-Za-z][A-Za-z'-]*)/i;
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

  function stitchTok(word) {
    var info = stitchInfo(word);
    if (!info) return null;
    var w = String(word).toLowerCase().replace(/\s+/g, ' ').trim();
    var t = 'sc', h = 1;
    if (/hdc/.test(w)) { t = 'hdc'; h = 1.5; }
    else if (/dtr|treble|\btr\b/.test(w)) { t = 'tr'; h = 2.5; }
    else if (/dc/.test(w)) { t = 'dc'; h = 2; }
    else if (/sl\s*st|slst|slip/.test(w)) { t = 'sl'; h = 1; }
    else if (/puff/.test(w)) { t = 'puff'; h = 1; }
    else if (/bbl|bobble|popcorn|cluster|shell/.test(w)) { t = 'bbl'; h = 1; }
    else if (/^ch/.test(w)) { t = 'ch'; h = 1; }
    if (info.p === 2 && info.c === 1) t = 'inc';
    else if (info.p === 1 && info.c === 2) t = 'dec';
    return { p: info.p, c: info.c, t: t, h: h };
  }

  function emit(tok, times) {
    var out = [], n = times * tok.p, i;
    for (i = 0; i < n; i++) out.push({ t: tok.t, c: null, h: tok.h });
    return out;
  }

  function runOf(type, height, n) {
    var out = [], i;
    for (i = 0; i < n; i++) out.push({ t: type, c: null, h: height });
    return out;
  }

  function cloneList(list) {
    var out = [], i;
    for (i = 0; i < list.length; i++) {
      var e = list[i];
      if (e === FILL_MARK) continue;
      out.push({ t: e.t, c: e.c, h: e.h });
    }
    return out;
  }

  function paint(list, colr) {
    var out = [], i;
    for (i = 0; i < list.length; i++) {
      var e = list[i];
      if (e === FILL_MARK) { out.push(e); continue; }
      out.push({ t: e.t, c: colr, h: e.h });
    }
    return out;
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
  function mrList(s, n) {
    var mm = /(\d+)\s*(hdc|dc|tr|sc)\b/i.exec(s);
    var tok = mm ? stitchTok(mm[2]) : null;
    return runOf(tok ? tok.t : 'sc', tok ? tok.h : 1, n > 0 ? n : 0);
  }

  // The stitch-emitting twin of parseSegment(). Same branches, same order.
  // -> { list, c } | { fill:{list,c} } | { abs:list } | null
  function expandSegment(seg) {
    var s = seg.trim().replace(/\s+/g, ' ');
    if (!s) return { list: [], c: 0 };

    var i, m, st;
    for (i = 0; i < ZERO_RES.length; i++) if (ZERO_RES[i].test(s)) return { list: [], c: 0 };
    if (WORK_EVEN_RE.test(s)) return { fill: { list: runOf('sc', 1, 1), c: 1 } };

    m = MR_RE1.exec(s); if (m) return { abs: mrList(s, num(m[1])) };
    m = MR_RE2.exec(s); if (m) return { abs: mrList(s, num(m[1])) };

    s = s.replace(PREFIX_RE, '');
    for (i = 0; i < ZERO_RES.length; i++) if (ZERO_RES[i].test(s)) return { list: [], c: 0 };
    m = MR_RE1.exec(s); if (m) return { abs: mrList(s, num(m[1])) };

    m = R_NEXT_N.exec(s);
    if (m) {
      st = stitchTok(m[2]); if (!st) return null;
      var lead = m[1] ? num(m[1]) : 1;
      var n = num(m[3]);
      return { list: emit(st, n * lead), c: n * st.c };
    }
    m = R_FROM_HOOK.exec(s);
    if (m) { st = stitchTok(m[1]); return st ? { list: emit(st, 1), c: 0 } : null; }

    m = R_EACH.exec(s);
    if (m) {
      st = stitchTok(m[2]); if (!st) return null;
      var lead2 = m[1] ? num(m[1]) : 1;
      return { fill: { list: emit(st, lead2), c: st.c } };
    }
    m = R_AROUND.exec(s);
    if (m) { st = stitchTok(m[1]); return st ? { fill: { list: emit(st, 1), c: st.c } } : null; }

    m = R_N_IN_NEXT.exec(s);
    if (m) { st = stitchTok(m[2]); return st ? { list: emit(st, num(m[1])), c: st.c } : null; }

    m = R_N_ST.exec(s);
    if (m) { st = stitchTok(m[2]); return st ? { list: emit(st, num(m[1])), c: num(m[1]) * st.c } : null; }

    m = R_ST_X.exec(s);
    if (m) { st = stitchTok(m[1]); return st ? { list: emit(st, num(m[2])), c: num(m[2]) * st.c } : null; }

    m = R_ST_N.exec(s);
    if (m) { st = stitchTok(m[1]); return st ? { list: emit(st, num(m[2])), c: num(m[2]) * st.c } : null; }

    m = R_ST.exec(s);
    if (m) { st = stitchTok(m[1]); return st ? { list: emit(st, 1), c: st.c } : null; }

    return null;
  }

  // The stitch-emitting twin of sumSegments().
  function expandSegments(list) {
    var out = [], c = 0, fill = null;
    for (var i = 0; i < list.length; i++) {
      var r = expandSegment(list[i]);
      if (!r) return null;
      if (r.abs !== undefined) return { abs: r.abs };
      if (r.fill) { if (fill) return null; fill = r.fill; out.push(FILL_MARK); continue; }
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
    if (i <= 0) return null;
    var before = items[i - 1];
    if (!before || before.kind !== 'text') return null;
    var m = PREFIX_TAIL_RE.exec(before.text);
    if (!m) return null;
    return resolveColor(m[1], ctx);
  }

  // The stitch-emitting twin of evaluate(). Returns a list or null.
  function expandInstruction(instruction, prevCount, ctx) {
    if (instruction == null) return null;
    var prev = (typeof prevCount === 'number' && isFinite(prevCount)) ? prevCount : null;
    var s = normDashes(String(instruction)).replace(/ /g, ' ');
    s = fixTypos(s);

    var mk = detectMarker(s.trim());
    if (mk) s = mk.rest;
    s = s.toLowerCase().trim();
    if (!s) return null;

    // "Rnd 5 (yellow): ..." - the whole row is worked in that colour
    var rc = /^\(\s*([a-z][a-z ]{1,20}?)\s*\)\s*:?\s*/.exec(s);
    if (rc) {
      var rcName = resolveColor(rc[1], ctx);
      if (rcName) { ctx.rowColor = rcName; s = s.slice(rc[0].length); }
    }

    if (prev !== null && OPEN_FILL_RE.test(s)) return runOf('sc', 1, prev);

    var repAround = /\b(?:rep(?:eat)?)\s+(?:around|across|to\s+end)\b/i.exec(s);
    var tailFill = false;
    if (repAround) { s = s.slice(0, repAround.index); tailFill = true; }

    var items = scanItems(s);
    if (!items.length) return null;

    var list = [], consumed = 0, fill = null, filledGroup = null;
    var k;

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.kind === 'text') {
        var r = expandSegments(splitSegments(it.text));
        if (!r) return null;
        if (r.abs !== undefined) return r.abs;
        if (r.fill) { if (fill) return null; fill = r.fill; }
        list = list.concat(r.list); consumed += r.c;
      } else {
        var g = expandSegments(splitSegments(it.text));
        if (!g || g.abs !== undefined || g.fill) {
          if (it.mult === 1 && !it.filled && (!g || !g.fill)) continue;
          return null;
        }
        var colr = prefixColorFor(items, i, ctx);
        var glist = colr ? paint(g.list, colr) : g.list;
        if (it.filled) {
          if (filledGroup) return null;
          filledGroup = { list: glist, c: g.c };
          list.push(FILL_MARK);
        } else {
          for (k = 0; k < it.mult; k++) list = list.concat(cloneList(glist));
          consumed += g.c * it.mult;
        }
      }
    }

    if (filledGroup) {
      var rest = (prev == null) ? null : prev - consumed;
      if (rest == null || filledGroup.c <= 0) return null;
      var groups = Math.floor(rest / filledGroup.c);
      var leftover = rest - groups * filledGroup.c;
      if (groups < 0 || leftover < 0) return null;
      var rep = [];
      for (k = 0; k < groups; k++) rep = rep.concat(cloneList(filledGroup.list));
      rep = rep.concat(runOf('sc', 1, leftover));
      return spliceMark(list, rep);
    }

    if (tailFill) {
      var plain = stripMarks(list);
      if (!plain.length && consumed === 0) return null;
      if (prev == null || consumed <= 0) return null;
      var groups2 = Math.floor(prev / consumed);
      var left2 = prev - groups2 * consumed;
      var out2 = [];
      for (k = 0; k < groups2; k++) out2 = out2.concat(cloneList(plain));
      return out2.concat(runOf('sc', 1, left2));
    }

    if (fill) {
      if (prev == null) return null;
      var remaining = prev - consumed;
      if (remaining < 0) return null;
      if (fill.c <= 0) return null;
      var whole = Math.floor(remaining / fill.c);
      var left = remaining - whole * fill.c;
      var rep2 = [];
      for (k = 0; k < whole; k++) rep2 = rep2.concat(cloneList(fill.list));
      rep2 = rep2.concat(runOf('sc', 1, left));
      return spliceMark(list, rep2);
    }

    var plain2 = stripMarks(list);
    if (!plain2.length && consumed === 0) return null;
    return plain2;
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
    return rest;
  }

  function newState() {
    return { color: null, legend: {}, names: {}, ready: false, init: false };
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

  function dominantHeight(list) {
    if (!list.length) return 1;
    var counts = {}, i;
    for (i = 0; i < list.length; i++) {
      var h = list[i].h === undefined ? 1 : list[i].h;
      counts[h] = (counts[h] || 0) + 1;
    }
    var best = 1, bestN = -1;
    Object.keys(counts).forEach(function (k) {
      var v = counts[k], hv = parseFloat(k);
      if (v > bestN || (v === bestN && hv > best)) { bestN = v; best = hv; }
    });
    return best;
  }

  function fitTo(list, target) {
    if (target === null || target === undefined || !isFinite(target)) return list;
    if (target <= 0) return [];
    if (list.length > target) return list.slice(0, target);
    while (list.length < target) list.push({ t: 'sc', c: null, h: 1 });
    return list;
  }

  function expand(lines, rowNumber, prevCount, state) {
    var parsed, st;
    try {
      parsed = asParsed(lines);
      st = normState(state, parsed);
    } catch (e) {
      st = normState(state, []);
      return { stitches: [], color: st.color || null, height: 1, state: st };
    }

    var res = { stitches: [], color: st.color || null, height: 1, state: st };

    try {
      var line = lineFor(parsed, rowNumber);
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

      var instr = instrOf(line);
      var prev = (typeof prevCount === 'number' && isFinite(prevCount)) ? prevCount : null;
      var ctx = { legend: st.legend, names: st.names, rowColor: null };

      var ev = null;
      try { ev = evaluate(instr, prev); } catch (e2) { ev = null; }

      var target = (line.count === null || line.count === undefined) ? ev : line.count;

      var list = null;
      if (ev !== null) {
        try { list = expandInstruction(instr, prev, ctx); } catch (e3) { list = null; }
      }
      if (ctx.rowColor) st.color = ctx.rowColor;

      if (list === null) {
        list = (target === null || target === undefined) ? [] : runOf('x', 1, target);
      }
      list = fitTo(list, target);

      res.color = st.color || null;
      res.height = dominantHeight(list);
      res.stitches = list.map(function (e) { return { t: e.t, c: e.c === undefined ? null : e.c }; });
    } catch (e4) {
      res.stitches = res.stitches || [];
    }
    return res;
  }

  window.Patterns = {
    parse: parse,
    targetFor: targetFor,
    lineFor: lineFor,
    summary: summary,
    splitSections: splitSections,
    placement: placement,
    detectSizes: detectSizes,
    evaluate: evaluate,
    colors: colors,
    colorHex: colorHex,
    expand: expand
  };

})();
