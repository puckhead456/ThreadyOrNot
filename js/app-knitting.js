/* Thready or Not — js/app-knitting.js
 * window.AppKnitting : knitting's registration (wave H, docs/wave-h/CONTRACT.md §1).
 *
 * Knitting is NOT a #screen-craft module. It registers with
 * `App.registerCraft({ usesCounter: true, parser: 'Knits' })`, so a knitting
 * project renders #screen-project — the crochet counter, with every crochet
 * feature — and its pattern text is read by window.Knits (js/knits.js)
 * instead of window.Patterns. When js/knits.js is missing, a knitting project
 * is a plain counter and the shell says so in one line.
 *
 * This file contributes:
 *   - the built-in knitting templates (Store.registerCraft): Single piece,
 *     Sweater, Socks, Hat, Shawl, Blanket, each with parts, a checklist and
 *     short real pattern text that the counter can follow row by row
 *   - knitting's finishing verbs for the import's checklist suggestions
 *   - Settings → 🧣 Knitting: measuring unit and needle-size system
 *     (Store.craftSettings('knitting') = { unit: 'cm'|'in',
 *      needleSystem: 'metric'|'us'|'uk' })
 *   - FAQ entries and a "Knitting with the counter" tour
 *   - the garment section names the importer offers (`sectionNames`)
 *
 * ES5, one global, never throws at load: a broken file must not take
 * crochet down with it.
 */
(function () {
  'use strict';

  var Store = window.Store;
  var App = window.App;
  if (!Store || !App || typeof App.registerCraft !== 'function') return;

  var CRAFT = 'knitting';

  /* ================================================================== *
   * 1. Settings
   * ================================================================== */

  var UNITS = ['cm', 'in'];
  var NEEDLE_SYSTEMS = ['metric', 'us', 'uk'];

  function defaultUnit() {
    try {
      var lang = String((navigator.languages && navigator.languages[0]) || navigator.language || '');
      return /^en-(US|LR|MM)\b/i.test(lang) ? 'in' : 'cm';
    } catch (e) {
      return 'cm';
    }
  }

  /** `{ unit, needleSystem }`, always both, whatever is stored. */
  function settings() {
    var bag = {};
    try { bag = Store.craftSettings(CRAFT) || {}; } catch (e) { bag = {}; }
    var unit = UNITS.indexOf(bag.unit) >= 0 ? bag.unit : defaultUnit();
    var sys = NEEDLE_SYSTEMS.indexOf(bag.needleSystem) >= 0 ? bag.needleSystem
      : (unit === 'in' ? 'us' : 'metric');
    return { unit: unit, needleSystem: sys };
  }

  function setSetting(key, value) {
    try { Store.setCraftSetting(CRAFT, key, value); } catch (e) { /* settings stay as they were */ }
  }

  /*
   * Needle sizes, metric → US → UK (Craft Yarn Council's table). `null` where
   * a system has no size for that diameter.
   */
  var NEEDLES = [
    [2.0, '0', '14'], [2.25, '1', '13'], [2.5, null, null], [2.75, '2', '12'], [3.0, null, '11'],
    [3.25, '3', '10'], [3.5, '4', null], [3.75, '5', '9'], [4.0, '6', '8'], [4.5, '7', '7'],
    [5.0, '8', '6'], [5.5, '9', '5'], [6.0, '10', '4'], [6.5, '10.5', '3'], [7.0, null, '2'],
    [7.5, null, '1'], [8.0, '11', '0'], [9.0, '13', '00'], [10.0, '15', '000'],
    [12.0, '17', null], [15.0, '19', null], [19.0, '35', null], [25.0, '50', null]
  ];

  /**
   * A needle diameter in the knitter's system: needleLabel(4) → '4 mm' /
   * 'US 6' / 'UK 8'. A size with no equivalent stays in mm rather than
   * guessing.
   */
  function needleLabel(mm, system) {
    var v = typeof mm === 'number' ? mm : parseFloat(String(mm).replace(',', '.'));
    if (!(v > 0)) return '';
    var sys = system || settings().needleSystem;
    var metric = (Math.round(v * 100) / 100) + ' mm';
    if (sys === 'metric') return metric;
    for (var i = 0; i < NEEDLES.length; i++) {
      if (Math.abs(NEEDLES[i][0] - v) < 0.01) {
        var s = sys === 'us' ? NEEDLES[i][1] : NEEDLES[i][2];
        return s ? (sys === 'us' ? 'US ' : 'UK ') + s : metric;
      }
    }
    return metric;
  }

  function settingsFields(body, ctx) {
    var s = settings();
    var unitSeg = ctx.segmented(
      [{ id: 'cm', label: 'Centimetres' }, { id: 'in', label: 'Inches' }],
      s.unit,
      function (v) { setSetting('unit', v); }
    );
    unitSeg.node.setAttribute('aria-label', 'Measuring unit');
    body.appendChild(ctx.field('Measure in', unitSeg.node, 'Gauge and “knit until it measures …” are shown in this unit.'));
    var sysSeg = ctx.segmented(
      [{ id: 'metric', label: 'mm' }, { id: 'us', label: 'US' }, { id: 'uk', label: 'UK' }],
      s.needleSystem,
      function (v) { setSetting('needleSystem', v); }
    );
    sysSeg.node.setAttribute('aria-label', 'Needle sizes');
    body.appendChild(ctx.field('Needle sizes', sysSeg.node, 'How needle sizes are written: 4 mm, US 6 or UK 8.'));
    // wave K (knit-ui, P14)
    try { clickerFields(body, ctx); } catch (e) { /* the settings above still show */ }
  }

  /* ================================================================== *
   * 2. Import: garment section names and finishing steps
   * ================================================================== */

  /** The garment parts a knitting pattern is split into (CONTRACT §1). */
  var SECTION_NAMES = [
    'Back', 'Front', 'Left Front', 'Right Front', 'Sleeve', 'Sleeves', 'Yoke', 'Body', 'Collar',
    'Cuff', 'Neckband', 'Button Band', 'Hood', 'Pocket', 'Heel', 'Heel Flap', 'Heel Turn',
    'Gusset', 'Foot', 'Toe', 'Leg', 'Brim', 'Crown', 'Border', 'Edging'
  ];

  // A finishing step in a knitting pattern: Block, Seam, Graft (Kitchener),
  // Weave in ends, Sew on buttons, Pick up … for the neckband is a part, not
  // a step, so it is not here.
  var CHECKLIST_START = /^(?:block|wet[- ]block|steam|seam|sew|graft|kitchener|weave in|join (?:the )?(?:shoulder|side|sleeve)|set in|attach|make (?:a )?(?:pom|tassel|fringe)|add (?:a )?(?:pom|tassel|fringe)|fold|darn|thread (?:the )?(?:tail|yarn) through)\b/i;
  var CHECKLIST_SECTIONS = /\b(?:finishing|making up|assembly|to finish|blocking|construction)\b/i;

  /* ================================================================== *
   * 3. Built-in templates
   *
   * Every count below was worked through by hand: the stitch totals in
   * brackets are what is on the needles at the end of that row, and a row
   * that works only some of the stitches (short rows, the heel turn) prints
   * no total at all.
   * ================================================================== */

  var HAT = [
    'Brim',
    'Set-up: CO 88 sts. Pm and join to work in the rnd, being careful not to twist. (88 sts)',
    'Rnds 1-12: *K2, p2; rep from * to end. (88 sts)',
    'Body',
    'Rnds 13-40: Knit. (88 sts)',
    'Crown',
    'Rnd 41: *K9, k2tog; rep from * to end. (80 sts)',
    'Rnd 42: Knit. (80 sts)',
    'Rnd 43: *K8, k2tog; rep from * to end. (72 sts)',
    'Rnd 44: Knit. (72 sts)',
    'Rnd 45: *K7, k2tog; rep from * to end. (64 sts)',
    'Rnd 46: Knit. (64 sts)',
    'Rnd 47: *K6, k2tog; rep from * to end. (56 sts)',
    'Rnd 48: Knit. (56 sts)',
    'Rnd 49: *K5, k2tog; rep from * to end. (48 sts)',
    'Rnd 50: *K4, k2tog; rep from * to end. (40 sts)',
    'Rnd 51: *K3, k2tog; rep from * to end. (32 sts)',
    'Rnd 52: *K2, k2tog; rep from * to end. (24 sts)',
    'Rnd 53: *K1, k2tog; rep from * to end. (16 sts)',
    'Rnd 54: *K2tog; rep from * to end. (8 sts)',
    'Cut the yarn, thread it through the remaining 8 sts and pull tight.'
  ].join('\n');

  var SOCK = [
    'Cuff',
    'Set-up: CO 64 sts. Pm and join to work in the rnd, being careful not to twist. (64 sts)',
    'Rnds 1-16: *K2, p2; rep from * to end. (64 sts)',
    'Leg',
    'Rnds 17-56: Knit. (64 sts)',
    'Heel Flap',
    'The heel flap is worked back and forth over the first 32 sts; the other 32 sts wait for the instep.',
    'Row 57 (RS): *Sl1, k1; rep from * to end. (32 sts)',
    'Row 58 (WS): Sl1, p to end. (32 sts)',
    'Rows 59-88: Rep Rows 57-58. (32 sts)',
    'Heel Turn',
    'Row 89 (RS): Sl1, k17, ssk, k1, turn.',
    'Row 90 (WS): Sl1, p5, p2tog, p1, turn.',
    'Row 91 (RS): Sl1, k to 1 st before gap, ssk, k1, turn.',
    'Row 92 (WS): Sl1, p to 1 st before gap, p2tog, p1, turn.',
    'Rows 93-100: Rep Rows 91-92.',
    'Row 101 (RS): Sl1, k to 1 st before gap, ssk, turn.',
    'Row 102 (WS): Sl1, p to 1 st before gap, p2tog, turn.',
    '18 heel sts remain.',
    'Row 103 (RS): K9 to the centre of the heel. This is the new beginning of rnd.',
    'Gusset',
    'Rnd 104: K9, pick up and knit 17 sts along the side of the heel flap, pm, k32, pm, ' +
      'pick up and knit 17 sts along the other side of the heel flap, k9. (84 sts)',
    'Rnd 105: K to 3 sts before marker, k2tog, k1, sm, k32, sm, k1, ssk, k to end. (82 sts)',
    'Rnd 106: Knit. (82 sts)',
    'Rnds 107-124: Rep Rnds 105-106. (64 sts)',
    'Foot',
    'Rnds 125-164: Knit. (64 sts)',
    'Work more or fewer rounds here so the foot measures 5 cm / 2" less than the full foot length.',
    'Toe',
    'Rnd 165: K to 3 sts before marker, k2tog, k1, sm, k1, ssk, k to 3 sts before marker, ' +
      'k2tog, k1, sm, k1, ssk, k to end. (60 sts)',
    'Rnd 166: Knit. (60 sts)',
    'Rnds 167-176: Rep Rnds 165-166. (40 sts)',
    'Rnd 177: Work as Rnd 165. (36 sts)',
    'Rnd 178: Work as Rnd 165. (32 sts)',
    'Rnd 179: Work as Rnd 165. (28 sts)',
    'Rnd 180: Work as Rnd 165. (24 sts)',
    'Rnd 181: Work as Rnd 165. (20 sts)',
    'Rnd 182: Work as Rnd 165. (16 sts)',
    'Graft the remaining 8 instep and 8 sole sts together with Kitchener stitch.'
  ].join('\n');

  // Boat-neck sweater, worked flat in pieces. 18 sts x 24 rows = 10 cm.
  var BACK = [
    'Set-up: CO 90 sts. (90 sts)',
    'Row 1 (RS): K2, *p2, k2; rep from * to end. (90 sts)',
    'Row 2 (WS): P2, *k2, p2; rep from * to end. (90 sts)',
    'Rows 3-14: Rep Rows 1-2. (90 sts)',
    'Rows 15-96: Work in St st (knit RS rows, purl WS rows), beg with a RS row. (90 sts)',
    'Armholes',
    'Row 97 (RS): BO 5 sts, k to end. (85 sts)',
    'Row 98 (WS): BO 5 sts, p to end. (80 sts)',
    'Row 99 (RS): K1, ssk, k to last 3 sts, k2tog, k1. (78 sts)',
    'Row 100 (WS): Purl. (78 sts)',
    'Rows 101-106: Rep Rows 99-100. (72 sts)',
    'Rows 107-144: Work in St st. (72 sts)',
    'Shoulders',
    'Row 145 (RS): BO 5 sts, k to end. (67 sts)',
    'Row 146 (WS): BO 5 sts, p to end. (62 sts)',
    'Row 147 (RS): BO 5 sts, k to end. (57 sts)',
    'Row 148 (WS): BO 5 sts, p to end. (52 sts)',
    'Row 149 (RS): BO 5 sts, k to end. (47 sts)',
    'Row 150 (WS): BO 5 sts, p to end. (42 sts)',
    'BO the remaining 42 sts for the boat neck.'
  ].join('\n');

  var SLEEVE = [
    'Set-up: CO 42 sts. (42 sts)',
    'Row 1 (RS): K2, *p2, k2; rep from * to end. (42 sts)',
    'Row 2 (WS): P2, *k2, p2; rep from * to end. (42 sts)',
    'Rows 3-14: Rep Rows 1-2. (42 sts)',
    'Row 15 (RS): K1, m1, k to last st, m1, k1. (44 sts)',
    'Rows 16-20: Work in St st, beg with a WS row. (44 sts)',
    'Rows 21-86: Rep Rows 15-20. (66 sts)',
    'Rows 87-104: Work in St st. (66 sts)',
    'Sleeve cap',
    'Row 105 (RS): BO 5 sts, k to end. (61 sts)',
    'Row 106 (WS): BO 5 sts, p to end. (56 sts)',
    'Row 107 (RS): K1, ssk, k to last 3 sts, k2tog, k1. (54 sts)',
    'Row 108 (WS): Purl. (54 sts)',
    'Rows 109-130: Rep Rows 107-108. (32 sts)',
    'Row 131 (RS): BO 3 sts, k to end. (29 sts)',
    'Row 132 (WS): BO 3 sts, p to end. (26 sts)',
    'BO the remaining 26 sts.'
  ].join('\n');

  // Top-down garter triangle, four increases every RS row.
  var SHAWL = [
    'Set-up: CO 7 sts. (7 sts)',
    'Row 1 (RS): K2, yo, k1, yo, k1, yo, k1, yo, k2. (11 sts)',
    'Row 2 (WS): Knit. (11 sts)',
    'Row 3 (RS): K2, yo, k to centre st, yo, k1, yo, k to last 2 sts, yo, k2. (15 sts)',
    'Row 4 (WS): Knit. (15 sts)',
    'Rows 5-124: Rep Rows 3-4. (255 sts)',
    'Row 125 (RS): Knit. (255 sts)',
    'BO loosely knitwise on the WS.'
  ].join('\n');

  // Seed-stitch blanket with a garter border, worked flat on a long circular.
  var BLANKET = [
    'Set-up: CO 151 sts. (151 sts)',
    'Rows 1-10: Knit. (151 sts)',
    'Rows 11-290: K5, *k1, p1; rep from * to last 6 sts, k6. (151 sts)',
    'Rows 291-300: Knit. (151 sts)',
    'BO all sts knitwise.'
  ].join('\n');

  var TEMPLATES = [
    {
      id: 'knit-blank',
      name: 'Single piece',
      emoji: '🧣',
      countMode: 'rows',
      groupSize: 10,
      parts: [{ name: 'Main', makeCount: 1 }],
      checklist: []
    },
    {
      id: 'knit-sweater',
      name: 'Sweater',
      emoji: '🧥',
      countMode: 'rows',
      groupSize: 10,
      parts: [
        { name: 'Back', makeCount: 1, patternText: BACK, workMode: 'rows' },
        { name: 'Front', makeCount: 1, patternText: BACK, workMode: 'rows' },
        { name: 'Sleeves', makeCount: 2, patternText: SLEEVE, workMode: 'rows' }
      ],
      checklist: ['Block all pieces', 'Seam the shoulders', 'Set in the sleeves', 'Sew the side and sleeve seams', 'Weave in ends']
    },
    {
      id: 'knit-socks',
      name: 'Socks',
      emoji: '🧦',
      countMode: 'rounds',
      groupSize: 0,
      parts: [{ name: 'Sock', makeCount: 2, patternText: SOCK }],
      checklist: ['Graft the toes with Kitchener stitch', 'Weave in ends', 'Block the socks']
    },
    {
      id: 'knit-hat',
      name: 'Hat',
      emoji: '🧢',
      countMode: 'rounds',
      groupSize: 0,
      parts: [{ name: 'Hat', makeCount: 1, patternText: HAT, workMode: 'rounds' }],
      checklist: ['Weave in ends', 'Block the hat', 'Make and attach a pom-pom (optional)']
    },
    {
      id: 'knit-shawl',
      name: 'Shawl',
      emoji: '🧣',
      countMode: 'rows',
      groupSize: 0,
      parts: [{ name: 'Shawl', makeCount: 1, patternText: SHAWL, workMode: 'rows' }],
      checklist: ['Weave in ends', 'Wet-block the shawl']
    },
    {
      id: 'knit-blanket',
      name: 'Blanket',
      emoji: '🛏️',
      countMode: 'rows',
      groupSize: 10,
      parts: [{ name: 'Blanket', makeCount: 1, patternText: BLANKET, workMode: 'rows' }],
      checklist: ['Weave in ends', 'Block the blanket']
    }
  ];

  try {
    if (typeof Store.registerCraft === 'function') {
      Store.registerCraft({ id: CRAFT, templates: TEMPLATES });
    }
  } catch (e) { /* the knitting templates are missing; projects still open */ }

  /* ================================================================== *
   * 4. Help: FAQ + tour
   * ================================================================== */

  var FAQ = [
    {
      q: 'Can I count knitting?',
      a: 'Yes — pick 🧣 Knitting when you start a project. It is the same counter as crochet: rows or ' +
        'rounds, stitches, parts you make twice, repeats, alerts and the 3D piece, reading knitting ' +
        'abbreviations (k2tog, ssk, yo, m1, C6F …) from your pattern.'
    },
    {
      q: 'Where does a knitting pattern’s gauge go?',
      a: 'When you import a knitting PDF, its gauge and needle size are kept with the project (not mixed into ' +
        'the rows), so “work until it measures 32 cm” can be turned into a number of rows.'
    },
    {
      q: 'Centimetres or inches, mm or US needles?',
      a: 'Settings → 🧣 Knitting. Pick how you measure and how you write needle sizes (4 mm, US 6 or UK 8).'
    }
  ];

  /** Open a knitting project for the tour, making a Socks one when there is none. */
  function ensureKnittingProject(ctx) {
    var cur = null;
    try { cur = Store.project(Store.getState().activeProjectId); } catch (e) { cur = null; }
    if (cur && cur.craft === CRAFT) return cur;
    var list = Store.projects().filter(function (p) { return p.craft === CRAFT && p.status !== 'finished'; });
    var p = list[0];
    if (!p) {
      p = Store.createProject({ name: 'Practice socks', emoji: '🧦', templateId: 'knit-socks', craft: CRAFT });
      try { Store.clearUndo(); } catch (e) { /* ignore */ }
      if (ctx) ctx.sampleId = p.id;
    }
    Store.setActiveProject(p.id);
    if (typeof App.render === 'function') App.render();
    return p;
  }

  var TOUR = {
    id: CRAFT,
    title: 'Knitting with the counter',
    blurb: 'Rows and rounds, right and wrong side, markers and the sock or sweater in 3D.',
    steps: function () {
      return [
        {
          target: '#part-tabs',
          before: function (c) {
            if (typeof App.closeAllSheets === 'function') App.closeAllSheets();
            ensureKnittingProject(c);
          },
          title: 'One tab per piece',
          body: 'Back, Front, Sleeves ×2 — or one Sock you make twice. Each piece counts on its own, ' +
            'and tapping the open tab edits it.'
        },
        {
          target: '[data-tour="row-counter"]',
          title: 'Rows and rounds',
          body: '+ finishes a row (or round). Your pattern’s own row numbers follow along, including ' +
            '“Rep Rows 3-4 60 more times”.'
        },
        {
          target: '[data-tour="knit-side"]',
          title: 'Right side or wrong side',
          body: 'The RS / WS chip says which side you are on, from the pattern’s (RS) and (WS). Tap it ' +
            'if your knitting disagrees. Worked in the round, there is no chip.'
        },
        {
          target: '[data-tour="knit-markers"]',
          title: 'Stitch markers',
          body: 'Markers from the pattern show here with the stitches left to the next one as you tap.'
        },
        {
          target: '#stitch-btn',
          title: 'Stitches on the needle',
          body: 'Tap for every stitch. The number beside it is what the row should end with, ' +
            'straight from the pattern’s (88 sts).'
        },
        {
          target: '#stitch-3d',
          title: 'Your piece, in 3D',
          body: 'The fabric grows as you count. Tap 3D view to turn it around.'
        },
        {
          target: '#pattern-line',
          title: 'The row you are on',
          body: 'The pattern line for this row. Tap it for the whole pattern.'
        },
        {
          target: '#p-menu',
          title: 'Everything else',
          body: 'Import pattern, Parts, Checklist, Notes, Yarn colours, Save as template and more live ' +
            'behind the ⋯ — the same as for crochet.'
        }
      ];
    }
  };

  /* ================================================================== *
   * 5. ⋯ menu extras
   * ================================================================== */

  /** knit-counter's glossary sheet, when it is there (CONTRACT §3). */
  function menuItems(p) {
    var items = [];
    var open = App.openGlossarySheet || App.openKnitGlossary;
    // wave H (knit-qa): Store.glossary has its own table, so any knitting project gets it
    if (typeof open === 'function') {
      items.push({ icon: '📖', label: 'Glossary', run: function () { open(p.id); } });
    }
    // wave K (knit-ui, P1): the part's "work until" stretches, to end or reopen
    var prt = safe(function () { return Store.activePart(p); }, null);
    if (prt && has(Store, 'stretchList') && safe(function () { return Store.stretchList(prt).length; }, 0)) {
      items.push({ icon: '📏', label: 'Stretches', run: function () { openStretchSheet(p.id, prt.id); } });
    }
    // wave K (knit-ui, P19): a note on this row, shown again on the other piece
    if (prt && has(Store, 'setStepNote')) {
      items.push({ icon: '📝', label: 'Note on this row', run: function () { openRowNoteSheet(p.id, prt.id); } });
    }
    // wave K (knit-ui, P1): a project saved before stretch numbering can switch to it
    if (!p.rowPhases && has(Store, 'setRowPhases')) {
      items.push({ icon: '📏', label: 'Number “work until” stretches as their own rows', run: function () { askRowPhases(p.id); } });
    }
    // wave K (knit-ui, P20 / P17)
    items.push({ icon: '🧶', label: 'Materials', run: function () { openMaterialsSheet(p.id); } });
    items.push({ icon: '📐', label: 'Schematic', run: function () { openSchematicSheet(p.id); } });
    return items;
  }

  /* ================================================================== *
   * 6. Wave K (knit-ui): what the knitter sees on the counter
   *
   * docs/wave-k/api/knit-ui.md. The counter is js/app.js's; this paints
   * into the nodes it already has (the .knit-extra row under the pattern
   * line, the pattern tag and text), so the working mode's HUD, which
   * mirrors those nodes, shows the same thing. Every Store / Knits call is
   * feature-detected: a missing one paints today's screen.
   * ================================================================== */

  var MINE = 'data-knit-ui';

  function C() { return App.ctx || {}; }
  function has(o, k) { return !!(o && typeof o[k] === 'function'); }
  function safe(fn, dflt) { try { var v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } }

  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function btn(cls, text, label) {
    var b = mk('button', cls, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    return b;
  }
  function mine(n) { n.setAttribute(MINE, ''); return n; }

  /** 15.5 → '15½', 6.25 → '6¼', 2.375 → '2⅜'; anything else to one decimal. */
  function frac(v) {
    var n = Number(v);
    if (!isFinite(n)) return '';
    var whole = Math.floor(n + 1e-9), f = n - whole;
    var map = [[0, ''], [0.125, '⅛'], [0.25, '¼'], [0.375, '⅜'], [0.5, '½'], [0.625, '⅝'], [0.75, '¾'], [0.875, '⅞']];
    for (var i = 0; i < map.length; i++) {
      if (Math.abs(f - map[i][0]) < 0.01) return (whole || !map[i][1] ? String(whole) : '') + map[i][1];
    }
    if (Math.abs(f - 1) < 0.01) return String(whole + 1);
    return String(Math.round(n * 10) / 10);
  }

  function unitWord(u) { return u === 'in' || u === '"' ? 'in' : u === 'mm' ? 'mm' : 'cm'; }

  /** 'row' or 'rnd' for this part's row being worked. */
  function wordOf(p, prt) {
    var si = safe(function () { return Store.sideInfo(prt, p); }, null);
    if (si && si.inRound) return 'rnd';
    return si && !(si.side === 'rs' || si.side === 'ws') && partInRounds(prt) ? 'rnd' : 'row';
  }

  /**
   * The stretch card's words.
   * @returns {{tag, title, sub, of, approx, say}}
   */
  function stretchText(si, word) {
    word = word || 'row';
    var est = si.estimate || null;
    var out = { tag: 'Stretch · ' + word + ' ' + si.row, title: '', sub: '', of: null, approx: false, say: '' };
    var bits = [];
    if (si.state === 'open') {
      if (est && est.rows >= 1) {
        out.of = est.rows;
        out.approx = true;
        out.title = 'Stretch · ' + word + ' ' + si.row + ' of ≈ ' + est.rows;
        bits.push(frac(est.value) + ' ' + unitWord(est.unit) + ' at ' + (est.gaugeSource === 'swatch' ? 'your gauge' : 'the pattern’s gauge') +
          (est.end ? ', about ' + word + ' ' + est.end : ''));
      } else {
        out.title = 'Stretch · ' + word + ' ' + si.row;
        var ends = si.line && si.line.stretch && si.line.stretch.parser && si.line.stretch.parser.ends;
        if (ends && ends.kind === 'sameAs') bits.push('until the same length as ' + ends.of + (ends.at ? ' to ' + ends.at : ''));
        // knit-audit: "until there are 61 sts" (an increase) is not "61 sts remain"
        else if (ends && ends.kind === 'count') bits.push('until you have ' + ends.value + ' sts');
        else if (ends && ends.kind === 'length') bits.push('until it measures ' + frac(ends.value) + ' ' + unitWord(ends.unit) + ' · add your gauge for an estimate');
        else bits.push('until the pattern’s length');
      }
      // the part's row target waits for the stretch's end
      bits.push('no row target until you end it');
    } else {
      out.of = si.of;
      out.title = 'Stretch · ' + word + ' ' + si.row + ' of ' + si.of;
      bits.push(si.state === 'planned' ? 'planned from your gauge · measure to be sure' : 'you ended it after ' + si.of + ' ' + word + (si.of === 1 ? '' : 's'));
    }
    // knit-audit: the count a stretch line prints is the one it ENDS on (a rib that
    // "inc 8 sts evenly across last row. 93 sts" is worked on 85 until then)
    if (si.count) bits.push(si.count + ' sts at the end');
    out.sub = bits.join(' · ');
    out.countEnd = countEnd(si);
    out.say = out.title.replace('≈', 'about') + '. ' + out.sub.replace(/≈/g, 'about');
    return out;
  }

  /** The stitch count a "work until N sts" stretch ends on, or null (a length or "same as" stretch). */
  function countEnd(si) {
    var ends = si && si.line && si.line.stretch && si.line.stretch.parser && si.line.stretch.parser.ends;
    return ends && ends.kind === 'count' && ends.value > 0 ? ends.value : null;
  }

  /** "repeat 3 of 9 · rnd 1 of 6", or '' when the store did not resolve the row. */
  function repeatText(li, word) {
    if (!li || !li.via || !(li.n >= 1) || !(li.k >= 1)) return '';
    var w = word || 'row';
    // knit-audit: "3rd row: As 1st row." is not a repeat worth counting ("repeat 1 of 1")
    var s = li.cycle >= 1 && !(li.of === 1 && li.cycle === 1) ? 'repeat ' + li.cycle + (li.of ? ' of ' + li.of : '') : '';
    if (li.n > 1) s += (s ? ' · ' : '') + w + ' ' + li.k + ' of ' + li.n;
    return s;
  }

  /** "Cable Panel C" → "C", "Chart A" → "A", "Leg chart" → "Leg". */
  function panelShort(name) {
    var n = String(name || '').replace(/\s+/g, ' ').trim();
    var m = /(?:panel|chart)\s*(?:pat(?:t(?:ern)?)?\s*)?([A-Z0-9]{1,3})$/i.exec(n);
    if (m) return m[1].toUpperCase();
    n = n.replace(/\s*\bchart\b\s*/i, ' ').trim();
    return n.length > 12 ? n.slice(0, 11) + '…' : n || '?';
  }

  function panelChip(panels) {
    var parts = [], said = [];
    (panels || []).forEach(function (q) {
      var s = panelShort(q.name);
      if (q.row >= 1) {
        parts.push(s + ' ' + q.row + (q.of ? '/' + q.of : ''));
        said.push(q.name + ' row ' + q.row + (q.of ? ' of ' + q.of : ''));
      } else {
        parts.push(s + ' row ?');
        said.push(q.name + ', row not known');
      }
    });
    return { text: parts.join(' · '), label: said.join('; ') };
  }

  /** "MC 3 · CC1 1 · ×17", from KnitChart.colourRuns (times = repeats in the row, or null). */
  function colourText(info, times) {
    if (!info) return '';
    var runs = info.repeat ? info.repeat.runs : info.runs;
    var s = runs.map(function (x) { return x.label + ' ' + x.n; }).join(' · ');
    if (info.repeat) s += times > 1 ? ' · ×' + times : ' · repeat';
    return s;
  }

  /* ---- the paint ---- */

  function removeMine(root) {
    if (!root) return;
    Array.prototype.slice.call(root.querySelectorAll('[' + MINE + ']')).forEach(function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
  }

  function counterPaint(p, prt, host) {
    if (!host) return;
    if (!p || p.craft !== CRAFT || !prt || typeof Store.sideInfo !== 'function') return;
    var extra = host.extra;
    removeMine(extra);
    removeMine(host.patternText);
    removeMine(host.patternTag);
    if (!extra || host.finished) return;
    var ri = safe(function () { return Store.repeatInfo(prt); }, null);
    if (!ri) return;
    var W = ri.patternRow;
    var word = wordOf(p, prt);
    var sr = safe(function () { return has(Store, 'shortRowInfo') ? Store.shortRowInfo(prt) : null; }, null);
    var si = !sr && has(Store, 'stretchInfo') ? safe(function () { return Store.stretchInfo(prt); }, null) : null;
    var li = !sr && has(Store, 'lineInfo') ? safe(function () { return Store.lineInfo(prt, W); }, null) : null;

    if (si) paintStretch(p, prt, si, word, host);
    if (li && li.via && li.shown && li.shown.text && li.shown !== li.line) {
      if (repeatTrusted(p, prt, si, li)) paintRepeat(p, prt, li, word, host);
      // not shown: the chips below read the sentence on screen, not the row behind it
      else li = { line: li.line, shown: li.line, via: null };
    }
    var chi = safe(function () { return Store.chartInfo(prt); }, null);
    if (chi) paintChart(p, prt, chi, word, host, W);
    paintShaping(p, prt, si, li, word, host, W);
    paintCalc(p, prt, li, si, word, host, W);
    paintPastEnd(p, prt, si, word, host, W);
    paintMirror(p, prt, host, W);
    paintMarkerExtras(p, prt);
    paintTerms(p, prt, li, host, W);
    paintRowNote(p, prt, word, host, W);

    var any = false;
    for (var c = extra.firstChild; c; c = c.nextSibling) if (!c.hidden) any = true;
    extra.hidden = !any;
  }

  /* P1: the stretch card */
  function paintStretch(p, prt, si, word, host) {
    var t = stretchText(si, word);
    if (host.patternTag) {
      host.patternTag.textContent = t.tag.charAt(0).toUpperCase() + t.tag.slice(1);
    }
    // the length chip said the same as the card, less well
    Array.prototype.slice.call(host.extra.querySelectorAll('.knit-until-chip')).forEach(function (n) { n.parentNode.removeChild(n); });
    var card = mine(mk('div', 'knit-stretch knit-stretch-' + si.state));
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', t.say);
    card.appendChild(mk('div', 'knit-stretch-title', t.title));
    if (t.sub) card.appendChild(mk('div', 'knit-stretch-sub', t.sub));
    var row = mk('div', 'knit-stretch-btns');
    if (si.state === 'open' || si.state === 'planned') {
      var worked = Math.max(0, (prt.row || 0) - si.start + 1);
      // a stretch that ends on a stitch count is not ended by measuring
      var goText = t.countEnd ? 'I have ' + t.countEnd + ' sts' : 'I’m at the length';
      var go = btn('btn primary knit-stretch-go', goText, goText + ': end this stretch after its ' + worked + ' ' + word + (worked === 1 ? '' : 's') + ' worked');
      go.addEventListener('click', function (e) { e.stopPropagation(); endStretchNow(p.id, prt.id, word); });
      row.appendChild(go);
    }
    if (si.state === 'open' && si.estimate && si.estimate.rows >= 1) {
      var use = btn('btn ghost knit-stretch-use', 'Use ≈ ' + si.estimate.rows,
        'Use the estimate: plan the stretch to end after about ' + si.estimate.rows + ' ' + word + 's');
      use.addEventListener('click', function (e) { e.stopPropagation(); useEstimateNow(p.id, prt.id, word); });
      row.appendChild(use);
    }
    if (si.state !== 'ended' && !t.countEnd && has(Store, 'addMeasurement')) {
      var meas = btn('btn ghost knit-stretch-measure', 'I measured', 'I measured: enter how long it is now');
      meas.addEventListener('click', function (e) { e.stopPropagation(); openMeasureSheet(p.id, prt.id); });
      row.appendChild(meas);
    }
    if (si.state !== 'open' && has(Store, 'reopenStretch')) {
      var re = btn('btn ghost knit-stretch-reopen', si.state === 'planned' ? 'Drop the plan' : 'Not at the length yet',
        si.state === 'planned' ? 'Take the planned end off this stretch' : 'Reopen this stretch');
      re.addEventListener('click', function (e) {
        e.stopPropagation();
        if (Store.reopenStretch(p.id, prt.id, si.key)) {
          C().fb && C().fb('tap');
          C().render();
          undoToast('Stretch open again');
        }
      });
      row.appendChild(re);
    }
    card.appendChild(row);
    host.extra.insertBefore(card, host.extra.firstChild);
  }

  function undoToast(msg) {
    var c = C();
    if (c.announce) c.announce(msg);
    if (c.toast) c.toast(msg, { actionText: 'Undo', onAction: function () { Store.undo(); c.render(); } });
  }

  function endStretchNow(projectId, partId, word) {
    if (!has(Store, 'endStretch')) return null;
    var res = Store.endStretch(projectId, partId);
    if (!res || res.event !== 'stretchEnd') return res;
    var c = C();
    if (c.fb) c.fb('row');
    c.render();
    var next = res.next && res.next.text ? String(res.next.text) : '';
    var msg = 'Stretch done: ' + res.rows + ' ' + (word || 'row') + (res.rows === 1 ? '' : 's') + (next ? '. Next: ' + next.slice(0, 80) : '');
    undoToast(msg);
    return res;
  }

  function useEstimateNow(projectId, partId, word) {
    if (!has(Store, 'useStretchEstimate')) return null;
    var res = Store.useStretchEstimate(projectId, partId);
    if (!res) return null;
    C().render();
    undoToast('Planned: the stretch ends after ' + res.of + ' ' + (word || 'row') + 's. Measure to be sure.');
    return res;
  }

  /** ⋯ → switch an older project to stretch numbering (one Undo). */
  function askRowPhases(projectId) {
    var c = C();
    if (typeof c.confirmSheet !== 'function') return;
    c.confirmSheet({
      title: 'Number stretches as their own rows?',
      message: 'A “work until it measures …” line becomes a stretch: you knit it until you tap “I’m at the length”, ' +
        'and the rows after it are numbered from there. Your rows done stay as they are. Undo switches it back.',
      confirmText: 'Switch it on',
      cancelText: 'Not now'
    }).then(function (yes) {
      if (!yes) return;
      if (Store.setRowPhases(projectId, true)) { c.render(); undoToast('Stretches are numbered on their own now'); }
    });
  }

  /* P10: "I measured" */
  function openMeasureSheet(projectId, partId) {
    var p = Store.project(projectId);
    var prt = p ? Store.part(p, partId) : null;
    if (!prt || !has(Store, 'addMeasurement')) return;
    var c = C();
    var mi = has(Store, 'measureInfo') ? safe(function () { return Store.measureInfo(prt); }, null) : null;
    var g = safe(function () { return Store.gaugeOf(p); }, null) || {};
    var unit = (mi && mi.unit) || g.unit || settings().unit;
    var input, seg;
    c.openSheet({
      subject: projectId,
      title: 'I measured',
      cls: 'sheet-knit-measure',
      build: function (body) {
        input = document.createElement('input');
        input.type = 'number';
        input.inputMode = 'decimal';
        input.step = 'any';
        input.min = '0';
        input.placeholder = unit === 'in' ? '14' : '35';
        input.className = 'knit-measure-input';
        seg = c.segmented([{ id: 'cm', label: 'cm' }, { id: 'in', label: 'in' }], unit === 'in' ? 'in' : 'cm', function () {});
        seg.node.setAttribute('aria-label', 'Measured in');
        var w = mk('div', 'row-flex knit-measure-row');
        w.appendChild(input);
        w.appendChild(seg.node);
        body.appendChild(c.field('How long is it now?', w,
          'After ' + prt.row + ' ' + wordOf(p, prt) + 's. Measure flat, from where the pattern says.'));
        if (mi && mi.pairs && mi.pairs.length) {
          var list = mk('div', 'knit-measure-list');
          list.appendChild(mk('div', 'field-label', 'Measured before'));
          mi.pairs.slice(-5).forEach(function (m) {
            list.appendChild(mk('div', 'knit-measure-item', frac(m.value) + ' ' + unitWord(m.unit) + ' after ' + m.row + ' ' + wordOf(p, prt) + 's'));
          });
          body.appendChild(list);
        }
        body.appendChild(mk('div', 'field-hint', 'The app works out the ' + wordOf(p, prt) + 's left from this (≈). It never changes your gauge without asking.'));
        setTimeout(function () { try { input.focus(); } catch (e) { /* ignore */ } }, 50);
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        {
          text: 'Save', cls: 'btn primary', onClick: function (api) {
            var v = parseFloat(String(input.value).replace(',', '.'));
            if (!(v > 0)) { c.toast('Type how long it is, e.g. ' + (seg.get() === 'in' ? '14' : '35')); return; }
            api.close();
            measured(projectId, partId, v, seg.get());
          }
        }
      ]
    });
  }

  /** After "I measured": what it means, and the gauge as a question. */
  function measured(projectId, partId, value, unit) {
    var c = C();
    var res = Store.addMeasurement(projectId, partId, value, unit);
    if (!res) { c.toast('That measurement could not be saved'); return null; }
    var p = Store.project(projectId);
    var prt = Store.part(p, partId);
    var word = wordOf(p, prt);
    c.render();
    var msg = 'Saved ' + frac(value) + ' ' + unit;
    if (res.atLength) msg += '. That is the length: tap “I’m at the length”';
    else if (res.rowsLeft !== null && res.rowsLeft !== undefined) msg += '. About ' + res.rowsLeft + ' ' + word + (res.rowsLeft === 1 ? '' : 's') + ' to go';
    if (res.replanned) msg += ' (the planned end moved to ' + word + ' ' + res.endRow + ')';
    undoToast(msg);
    var off = res.gaugeOffer;
    if (off && off.rows > 0 && typeof c.confirmSheet === 'function') {
      c.confirmSheet({
        title: 'Use your row gauge?',
        message: 'Your measurements come to ' + frac(off.rows) + ' ' + word + 's over ' + frac(off.over) + ' ' + unitWord(off.unit) +
          (off.was ? ' (the gauge in use says ' + frac(off.was) + ')' : '') + '. Use ' + frac(off.rows) +
          ' as your row gauge on this project? The ≈ estimates will follow it.',
        confirmText: 'Use it',
        cancelText: 'Not now'
      }).then(function (yes) {
        if (!yes) return;
        Store.setGauge(projectId, { swatch: { rows: off.rows } });
        c.render();
        undoToast('Row gauge set to ' + frac(off.rows) + ' over ' + frac(off.over) + ' ' + unitWord(off.unit));
      });
    }
    return res;
  }

  /**
   * knit-audit: show a resolved row only when it can be right. A "Cont in pat
   * until …" stretch resolved to ONE row (boyfriend Front: "4th row: P0 …" on
   * every row, RS rows too) is a wrong instruction; so is a row whose printed
   * side is not the side being worked. Then the pattern's own sentence stays.
   */
  function repeatTrusted(p, prt, si, li) {
    if (si && !(li.n >= 2)) return false;
    var tx = String(li.shown.text || '');
    // a round that places the markers or casts on is a set-up, never the one a
    // "rep Inc rnd every other rnd" repeats (Time Traveler toe: it named the
    // marker set-up round as "rnd 1 of 2" of every repeat)
    if (li.cycle >= 2 && /\b(?:pm|place\s+(?:a\s+)?markers?|cast\s+on|co)\b/i.test(tx)) return false;
    // nor is a short row ("… and turn") the plain round of a round repeat
    // (Sandnes raglan: "Work and turn 2 sts pass previous turning …" as rnd 1 of 2)
    if (wordOf(p, prt) === 'rnd' && /\bturn(?:ing)?\b|\bshort[- ]rows?\b/i.test(tx) && !/\bturn(?:ing)?\b|\bshort[- ]rows?\b/i.test(String(li.via && li.via.text || ''))) return false;
    var m = /^\s*(?:[^:]{0,40}:\s*)?\(\s*(RS|WS|right side|wrong side)\s*\)/i.exec(tx) ||
      /^\s*(?:rows?|rnds?)\s+\d+[^:(]{0,12}\(\s*(RS|WS|right side|wrong side)\s*\)/i.exec(tx);
    var side = sideFor(p, prt);
    if (m && (side === 'rs' || side === 'ws')) {
      var printed = /^(rs|right side)$/i.test(m[1]) ? 'rs' : 'ws';
      if (printed !== side) return false;
    }
    return true;
  }

  /* P2: the resolved row first, the repeat sentence under it */
  function paintRepeat(p, prt, li, word, host) {
    var pt = host.patternText;
    if (!pt) return;
    // its own "Rnds 2-6:" label would name rows you are not on; a named
    // label ("Dec rnd:") stays
    var shown = stripRowLabel(String(li.shown.text));
    var c = C();
    while (pt.firstChild) pt.removeChild(pt.firstChild);
    if (typeof c.fillSizeMarked === 'function') {
      var holder = mk('span', 'knit-shown');
      c.fillSizeMarked(holder, shown, prt, p);
      pt.appendChild(holder);
    } else {
      pt.appendChild(document.createTextNode(shown));
    }
    var via = mine(mk('span', 'knit-via', String(li.via.text)));
    pt.appendChild(via);
    var where = repeatText(li, word);
    if (where && host.patternTag) {
      host.patternTag.appendChild(mine(mk('span', 'knit-rep-tag', ' · ' + where)));
    }
  }

  /** "Rnds 2-6: Knit." → "Knit."; "Row 3 (RS): K2" → "K2"; "Dec rnd: K2tog" stays. */
  function stripRowLabel(t) {
    var m = /^\s*(?:rows?|rnds?|rounds?)\s+\d+(?:\s*(?:[-–—]|to|,|&|and)\s*\d+)*\s*(?:\((?:rs|ws|right side|wrong side)\))?\s*[:.]\s*/i.exec(t);
    return m && m[0].length < t.length ? t.slice(m[0].length) : t;
  }

  /* P3 / P4 / P11: the chart chip, the panel stack, the strip, the colours */
  function paintChart(p, prt, chi, word, host, W) {
    var extra = host.extra;
    var old = extra.querySelector('.knit-chart-chip');
    var panels = Array.isArray(chi.panels) ? chi.panels : null;
    var label, text;
    if (panels && panels.length >= 2) {
      var pc = panelChip(panels);
      text = '▦ ' + pc.text;
      label = pc.label + '. Open the charts';
    } else if (old) {
      text = old.textContent;
      label = old.getAttribute('aria-label') || text;
      if (chi.row === null && chi.panels && chi.panels.length === 1 && chi.continued) {
        text = '▦ ' + chi.name + ' · row ?';
        label = chi.name + ', row not known. Open the chart';
      }
    } else {
      return;
    }
    var chip = mine(btn('knit-chip knit-chart-chip' + (panels && panels.length >= 2 ? ' knit-panels-chip' : ''), text, label));
    chip.addEventListener('click', function (e) { e.stopPropagation(); openChartSheet(p.id, prt.id); });
    if (old) { old.parentNode.replaceChild(chip, old); }
    else extra.appendChild(chip);

    var ch = chi.page && chi.page.chart ? chi.page.chart : chi.chart && chi.chart.cells ? chi.chart : null;
    var KC = window.KnitChart;
    if (!ch || !KC || !chi.row) return;
    var side = sideFor(p, prt);
    // P11: colours of this row
    if (typeof KC.colourRuns === 'function') {
      var cr = safe(function () { return KC.colourRuns(ch, chi.row, side); }, null);
      if (cr && cr.colours.length) {
        var target = safe(function () { return Store.currentTarget(prt); }, null);
        var times = cr.repeat && target && cr.repeat.width ? Math.round(target / cr.repeat.width) : null;
        if (times && Math.abs(times * cr.repeat.width - target) > cr.repeat.width) times = null;
        var box = mine(mk('div', 'knit-colours'));
        box.setAttribute('role', 'note');
        var strip = mk('span', 'knit-colour-runs', colourText(cr, times));
        box.appendChild(strip);
        var tail = [];
        if (cr.longestFloat && cr.longestFloat.n >= 2) {
          tail.push('longest float ' + cr.longestFloat.n + (cr.longestFloat.n >= 5 ? ': catch it' : ''));
        }
        if (!cr.repeat && side !== null && cr.runs.length >= 2) {
          tail.push(cr.runs.length + ' blocks (' + cr.bobbins.join(', ') + ') if worked with bobbins');
        }
        if (cr.unknown) tail.push(cr.unknown + ' cell' + (cr.unknown === 1 ? '' : 's') + ' not read (?)');
        if (tail.length) box.appendChild(mk('span', 'knit-colour-more', ' · ' + tail.join(' · ')));
        box.setAttribute('aria-label', 'Colours this ' + word + ': ' + box.textContent.replace(/×/g, 'times '));
        extra.appendChild(box);
      }
    }
    // P11: the key's printed colours as the project's yarn colours (one tap, Undo)
    var kc = typeof KC.keyColours === 'function' ? safe(function () { return KC.keyColours(ch); }, []) : [];
    var fresh = kc.filter(function (x) { return x.hex && has(Store, 'setYarnColor') && !safe(function () { return Store.hasYarnColor(p, x.label); }, true); });
    if (fresh.length) {
      var yb = mine(btn('knit-chip knit-yarn-chip', '🎨 Use the chart’s colours (' + fresh.map(function (x) { return x.label; }).join(', ') + ')',
        'Use the colours printed in the chart key as this project’s yarn colours: ' + fresh.map(function (x) { return x.label; }).join(', ')));
      fresh.forEach(function (x) {
        var sw = mk('span', 'knit-yarn-sw');
        sw.style.background = x.hex;
        sw.setAttribute('aria-hidden', 'true');
        yb.appendChild(sw);
      });
      yb.addEventListener('click', function (e) {
        e.stopPropagation();
        var n = 0;
        fresh.forEach(function (x) { if (Store.setYarnColor(p.id, x.label, x.hex)) n++; });
        var c = C();
        c.render();
        if (c.announce) c.announce('Yarn colours set from the chart key');
        if (c.toast) c.toast('Yarn colours set from the chart key', { actionText: 'Undo', onAction: function () { for (var i = 0; i < n; i++) Store.undo(); c.render(); } });
      });
      extra.appendChild(yb);
    }
    // P4: the thin strip, shown in working mode (css hides it on the counter)
    var svg = safe(function () { return chartStripSvg(ch, chi.row, side, prt.stitch); }, null);
    if (svg) extra.appendChild(mine(svg));
  }

  /** 'rs' | 'ws' | null (in the round) for the row being worked; undefined = let the chart say. */
  function sideFor(p, prt) {
    var si = safe(function () { return Store.sideInfo(prt, p); }, null);
    if (!si) return undefined;
    if (si.inRound) return null;
    if (si.side === 'rs' || si.side === 'ws') return si.side;
    // knit-audit: side unknown on a part whose lines are all rounds (Time Traveler's
    // Foot: "Next rnd …", "Cont in patt") — read a chart right to left, not
    // "left to right (WS)" because the chart row number is even
    return partInRounds(prt) ? null : undefined;
  }

  /** The part's text speaks of rounds and never of RS / WS rows. */
  function partInRounds(prt) {
    var t = String(prt && prt.patternText || '');
    if (prt && prt.rowWord === 'rnd') return true;
    return /\b(?:rnds?|rounds?)\b/i.test(t) && !/\b(?:RS|WS|right side|wrong side)\b|\brows?\s+\d/i.test(t.replace(/\b(?:Row|Rows)\s+\d+(?:\s*[-–]\s*\d+)?\s+of\s+(?:the\s+)?[A-Z][\w ]{0,20}chart\b/gi, ''));
  }

  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  /** The current row ± 2 of a read chart, drawn from its cells (an SVG survives the HUD's clone). */
  function chartStripSvg(ch, rowNo, side, stitches) {
    var KC = window.KnitChart;
    if (!ch || !Array.isArray(ch.cells) || !ch.cells.length || typeof KC.rowBand !== 'function') return null;
    var band = KC.rowBand(ch, rowNo);
    if (!band || band.unit !== 'pt') return null;
    var R = band.r, cols = ch.cols || ch.cells[0].length;
    var lo = Math.max(0, R - 2), hi = Math.min(ch.cells.length - 1, R + 2);
    var n = hi - lo + 1, cell = 10;
    var done = safe(function () { return KC.doneCols(ch, rowNo, side, stitches); }, null);
    var doneSet = {};
    if (done) done.cols.forEach(function (c) { doneSet[c] = true; });
    var svg = svgEl('svg', { viewBox: '0 0 ' + (cols * cell) + ' ' + (n * cell), preserveAspectRatio: 'xMidYMid meet', 'class': 'knit-chart-strip', role: 'img' });
    var colourCls = {}, fills = {};
    if (typeof KC.keyColours === 'function') safe(function () { return KC.keyColours(ch); }, []).forEach(function (x) { if (x.hex) fills[x.label] = x.hex; });
    var palette = 0;
    for (var r = hi; r >= lo; r--) {
      var y = (hi - r) * cell;
      var row = ch.cells[r] || [];
      for (var c = 0; c < cols; c++) {
        if (row[c] == null) continue;
        var e = null;
        for (var i = 0; i < (ch.legend || []).length; i++) if (ch.legend[i].sym === row[c]) { e = ch.legend[i]; break; }
        var col = KC.colourOf ? KC.colourOf(e) : null;
        var cls = 'kcs-cell';
        if (col) {
          if (colourCls[col] === undefined) colourCls[col] = palette++ % 4;
          cls += ' kcs-c' + colourCls[col];
        } else if (!e || e.kind === 'unknown') cls += ' kcs-unk';
        else if (e.kind === 'nostitch') cls += ' kcs-none';
        else if (e.stitch && e.stitch !== 'k') cls += ' kcs-sym';
        if (r === R) cls += ' kcs-now';
        if (r === R && doneSet[c]) cls += ' kcs-done';
        var rect = svgEl('rect', { x: c * cell + 0.5, y: y + 0.5, width: cell - 1, height: cell - 1, 'class': cls });
        // the colour the key prints, when it was read (an inline style wins over the theme's stand-in)
        if (col && fills[col]) rect.style.fill = fills[col];
        svg.appendChild(rect);
      }
    }
    var yb = (hi - R) * cell;
    svg.appendChild(svgEl('rect', { x: 0.5, y: yb + 0.25, width: cols * cell - 1, height: cell - 0.5, 'class': 'kcs-band' }));
    var t = svgEl('title', {});
    var step = ch.rowStep || 1, first = ch.startRow != null ? ch.startRow : 1;
    t.textContent = 'Chart rows ' + (first + lo * step) + ' to ' + (first + hi * step) + ', row ' + rowNo + ' highlighted';
    svg.insertBefore(t, svg.firstChild);
    svg.setAttribute('aria-label', t.textContent);
    return svg;
  }

  /* P6: "at the same time" */
  function shapingText(res, row) {
    if (!res || !res.readable || !Array.isArray(res.schedule) || !res.schedule.length || !(row >= 1)) return null;
    var entry = null, i;
    for (i = 0; i < res.schedule.length; i++) if (res.schedule[i].row === row) { entry = res.schedule[i]; break; }
    if (!entry) return null;
    var names = [];
    res.clauses.forEach(function (cl) { var w = cl.what || 'shaping'; if (names.indexOf(w) < 0) names.push(w); });
    var lines = names.map(function (w) {
      var total = 0, every = null, op = null;
      res.clauses.forEach(function (cl) {
        if ((cl.what || 'shaping') !== w) return;
        total = cl.times === null || total === null ? null : total + cl.times;
        every = every || cl.every;
        op = op || cl.op;
      });
      var here = entry.changes.some(function (x) { return x.what === w; });
      var done = entry.done && entry.done[w] ? entry.done[w] : 0;
      // the next row this shaping falls on
      var inRows = null;
      if (!here) {
        for (i = 0; i < res.schedule.length; i++) {
          var s = res.schedule[i];
          if (s.row > row && s.changes.some(function (x) { return x.what === w; })) { inRows = s.row - row; break; }
        }
      }
      var name = w.charAt(0).toUpperCase() + w.slice(1);
      var opWord = op === 'inc' ? 'inc' : op === 'bo' ? 'bind off' : 'dec';
      return {
        what: w, here: here, done: done, total: total,
        text: name + ' ' + (here ? opWord + ' ✓' : '—') + ' · ' + done + ' of ' + (total === null ? '?' : total) +
          (inRows ? ' · ' + opWord + ' ' + (inRows === 1 ? 'next row' : 'row in ' + inRows) : '')
      };
    });
    var say = 'This row: ' + lines.map(function (l) { return l.what + (l.here ? ' yes' : ' no'); }).join(', ');
    return { lines: lines, count: entry.count, say: say };
  }

  function paintShaping(p, prt, si, li, word, host, W) {
    var K = window.Knits;
    if (!K || typeof K.shaping !== 'function') return;
    var line = li ? li.line : safe(function () { return Store.lineForRow(prt, W); }, null);
    if (!line || !line.text || !/\bat\s+the\s+same\s+time\b|\bevery\s+(?:following\s+)?(?:\d+|alt|other|rs|ws|4th|6th|8th|\d+(?:st|nd|rd|th))\b/i.test(line.text)) return;
    var startRow = si ? si.start : (line.row >= 1 ? line.row : null);
    if (!(startRow >= 1)) return;
    var before = safe(function () { return Store.targetFor(prt, startRow - 1); }, null);
    if (!(before > 0)) return;
    var sizes = Array.isArray(p.sizes) ? p.sizes.length : 0;
    var res = safe(function () { return K.shaping(line.text, { size: prt.sizeIndex || 0, sizeCount: sizes, start: before }); }, null);
    var st = shapingText(res, W - startRow + 1);
    if (!st) return;
    var card = mine(mk('div', 'knit-shaping'));
    card.setAttribute('role', 'group');
    card.appendChild(mk('div', 'knit-shaping-title', 'Shaping · ' + word + ' ' + (W - startRow + 1) + (res.rows ? ' of ' + res.rows : '')));
    st.lines.forEach(function (l) { card.appendChild(mk('div', 'knit-shaping-line' + (l.here ? ' on' : ''), l.text)); });
    if (st.count) card.appendChild(mk('div', 'knit-shaping-count', st.count + ' sts after this ' + word + ' (worked out by the app)'));
    card.setAttribute('aria-label', st.say + '. ' + card.textContent);
    host.extra.appendChild(card);
  }

  /**
   * knit-audit: past the last row a part's pattern gives (no row target, e.g.
   * after its "work until" stretches were ended), the counter went blank and
   * silent. Say where the rows end and which part carries on.
   * @returns {{last:number, next:Object|null}|null}
   */
  function pastEnd(p, prt, si, W) {
    if (si || prt.targetRows >= 1 || !(W > 1)) return null;
    if (safe(function () { return Store.lineForRow(prt, W); }, null)) return null;
    var last = 0;
    for (var r = W - 1; r >= Math.max(1, W - 800); r--) {
      if (safe(function () { return Store.lineForRow(prt, r); }, null)) { last = r; break; }
    }
    if (!last) return null;
    // a gap inside the part (rows the reader did not number) is not its end
    for (var f = W + 1; f <= W + 400; f++) {
      if (safe(function () { return Store.lineForRow(prt, f); }, null)) return null;
    }
    var next = null;
    for (var i = 0; i < p.parts.length; i++) if (p.parts[i].id === prt.id) { next = p.parts[i + 1] || null; break; }
    return { last: last, next: next };
  }

  function paintPastEnd(p, prt, si, word, host, W) {
    var pe = pastEnd(p, prt, si, W);
    if (!pe) return;
    // the length chip of the stretch just ended is not about this row
    Array.prototype.slice.call(host.extra.querySelectorAll('.knit-until-chip')).forEach(function (n) { n.parentNode.removeChild(n); });
    var box = mine(mk('div', 'knit-calc knit-past-end'));
    box.setAttribute('role', 'note');
    box.appendChild(mk('span', null, 'The pattern’s ' + word + 's for ' + prt.name + ' end at ' + word + ' ' + pe.last + '.' +
      (pe.next ? ' It carries on in ' + pe.next.name + '.' : '')));
    if (pe.next) {
      var nx = pe.next;
      var go = btn('knit-chip knit-past-end-go', 'Go to ' + nx.name, 'Open ' + nx.name);
      go.addEventListener('click', function (e) {
        e.stopPropagation();
        if (has(Store, 'setActivePart')) { Store.setActivePart(p.id, nx.id); C().render(); }
      });
      box.appendChild(go);
    }
    host.extra.appendChild(box);
  }

  /* P15: "inc 8 sts evenly across" → a suggestion, from knit-parse (feature-detected) */
  // a line that ends on its own stitch total ("… across last row. 81 (85-93) sts.")
  var PRINTED_TOTAL = /(?:^|[.:]\s+)\(?\d+\s*(?:\([^)]*\)\s*)?(?:sts?|stitches)\.?\)?\s*(?:rem(?:ain)?\.?)?\s*$/i;

  function paintCalc(p, prt, li, si, word, host, W) {
    var K = window.Knits;
    if (!K) return;
    var line = li ? li.shown : safe(function () { return Store.lineForRow(prt, W); }, null);
    if (!line || !line.text) return;
    var sizes = Array.isArray(p.sizes) && p.sizes.length >= 2 ? p.sizes.length : 0;
    if (typeof K.evenlyRow === 'function' && /\bevenly\b/i.test(line.text)) {
      // the stitches on the needle before this row
      var start = safe(function () { return W > 1 ? Store.targetFor(prt, W - 1) : null; }, null);
      if (!(start > 0)) {
        var su = safe(function () { return Store.setupLine(prt); }, null);
        start = su && su.count > 0 ? su.count : null;
      }
      var ev = function (n) {
        return n > 0 ? safe(function () {
          return K.evenlyRow(line.text, { count: n, size: prt.sizeIndex || 0, sizeCount: sizes, round: word === 'rnd' ? true : undefined });
        }, null) : null;
      };
      // knit-audit: the total a line prints ("… inc 8 sts evenly across last row.
      // 93 sts.") is AFTER the increases; the count the counter carries into a
      // stretch is that total too. Work from the total back: 93 − 8 = 85, never
      // "from 93 sts" (that makes 101, a wrong instruction).
      var after = safe(function () { return Store.targetFor(prt, W); }, null);
      var probe = ev(after > 0 ? after : start);
      var change = probe && typeof probe.change === 'number' ? probe.change : null;
      var printed = PRINTED_TOTAL.test(line.text);
      if (printed && after > 0 && change && after - change > 0) start = after - change;
      var res = ev(start);
      if (res && printed && after > 0 && typeof res.to === 'number' && res.to !== after) res = null;   // it would not come to the printed total: say nothing
      if (res && res.text) {
        var box = mine(mk('div', 'knit-calc'));
        var lastRow = !!si && /\blast\s+(?:row|rnd|round)\b/i.test(line.text);
        box.appendChild(mk('span', 'knit-calc-tag', 'Suggestion, worked out by the app from ' + start + ' sts' + (lastRow ? ', for the last ' + word + ' of this stretch' : '') + ': '));
        box.appendChild(mk('span', 'knit-calc-text', res.text));
        box.setAttribute('role', 'note');
        host.extra.appendChild(box);
      }
    }
    var pm = /\bpick\s*up\s+(?:and\s+knit\s+)?(\d+)\b/i.exec(line.text);
    if (pm && typeof K.pickupRatio === 'function') {
      var ch = mine(btn('knit-chip knit-pickup-chip', '🧮 Pick-up helper', 'Work out how many stitches to pick up for every few rows'));
      var sts = parseInt(pm[1], 10);
      ch.addEventListener('click', function (e) { e.stopPropagation(); openPickupSheet(p.id, sts, line.text); });
      host.extra.appendChild(ch);
    }
  }

  /** "Pick up and knit 68 sts": how many for every few rows, given the rows along the edge. */
  function openPickupSheet(projectId, sts, text) {
    var c = C();
    var K = window.Knits;
    var rowsIn, stsIn, outN;
    c.openSheet({
      subject: projectId,
      title: 'Pick-up helper',
      build: function (body) {
        body.appendChild(mk('div', 'knit-terms-line', '“' + String(text).slice(0, 160) + '”'));
        stsIn = document.createElement('input');
        stsIn.type = 'number'; stsIn.inputMode = 'numeric'; stsIn.min = '1'; stsIn.value = String(sts);
        rowsIn = document.createElement('input');
        rowsIn.type = 'number'; rowsIn.inputMode = 'numeric'; rowsIn.min = '1'; rowsIn.placeholder = '90';
        var r = mk('div', 'row-flex knit-calib-form');
        r.appendChild(c.field('Stitches to pick up', stsIn));
        r.appendChild(c.field('Rows along the edge', rowsIn));
        body.appendChild(r);
        outN = mk('div', 'knit-calc');
        outN.setAttribute('aria-live', 'polite');
        body.appendChild(outN);
        function paint() {
          var s = parseInt(stsIn.value, 10), rw = parseInt(rowsIn.value, 10);
          var res = s > 0 && rw > 0 ? safe(function () { return K.pickupRatio(s, rw); }, null) : null;
          outN.textContent = res && res.text ? 'Suggestion, worked out by the app: ' + res.text + (res.exact ? '' : ' (≈)') + '.'
            : 'Count the rows (or rounds) along the edge and type them in.';
        }
        rowsIn.addEventListener('input', paint);
        stsIn.addEventListener('input', paint);
        paint();
        setTimeout(function () { try { rowsIn.focus(); } catch (e) { /* ignore */ } }, 50);
      }
    });
  }

  /* P12: "Work Left Front as Right Front, reversing shaping" */
  var MIRROR_HEAD = 'Worked out by the app from ';
  var MIRROR_FLAG = ' [mirror this yourself]';

  /** The part this part says to mirror, or null. */
  function mirrorSource(p, prt) {
    var t = String(prt.patternText || '');
    if (t.indexOf(MIRROR_HEAD) === 0) return null;
    var m = /\bas\s+(?:for\s+(?:the\s+)?)?([a-z][a-z ]{1,24}?)\s*,?\s*(?:but\s+)?revers(?:e|ing)\s+(?:all\s+)?shaping/i.exec(t);
    if (!m) return null;
    var want = m[1].trim().toLowerCase();
    var src = null;
    p.parts.forEach(function (q) {
      if (!src && q.id !== prt.id && String(q.name || '').trim().toLowerCase() === want && String(q.patternText || '').trim()) src = q;
    });
    return src;
  }

  /**
   * knit-audit: "Work same as Right Front, reversing all shaping." at the end of
   * the Right Front's OWN text (Red Heart season cardigan: the Left Front heading
   * was lost, so there is no Left Front part). → { newName: 'Left Front',
   * srcText: the Right Front's text before that sentence } when no part of that
   * name exists yet; else null.
   */
  function mirrorTwin(p, prt) {
    var t = String(prt.patternText || '');
    if (t.indexOf(MIRROR_HEAD) === 0) return null;
    var re = /(?:^|\n)[^\n]*?\bas\s+(?:for\s+)?(?:the\s+)?([a-z][a-z ]{1,24}?)\s*,?\s*(?:but\s+)?revers(?:e|ing)\s+(?:all\s+)?shaping[^\n]*/i;
    var m = re.exec(t);
    var own = String(prt.name || '').trim().toLowerCase();
    if (!m || m[1].trim().toLowerCase() !== own) return null;
    var twin = /\bleft\b/i.test(prt.name) ? prt.name.replace(/\bleft\b/i, function (w) { return w.charAt(0) === 'L' ? 'Right' : 'right'; })
      : /\bright\b/i.test(prt.name) ? prt.name.replace(/\bright\b/i, function (w) { return w.charAt(0) === 'R' ? 'Left' : 'left'; }) : null;
    if (!twin) return null;
    var exists = p.parts.some(function (q) { return String(q.name || '').trim().toLowerCase() === twin.toLowerCase(); });
    if (exists) return null;
    var srcText = t.slice(0, m.index).replace(/\s*(?:left|right)\s+front\s*:?\s*$/i, '');
    if (!srcText.trim()) return null;
    return { newName: twin, srcText: srcText };
  }

  function mirroredFrom(prt) {
    var t = String(prt.patternText || '');
    if (t.indexOf(MIRROR_HEAD) !== 0) return null;
    var m = /^Worked out by the app from ([^.(\n]+)/.exec(t);
    return m ? m[1].trim() : '?';
  }

  function paintMirror(p, prt, host, W) {
    var K = window.Knits;
    var from = mirroredFrom(prt);
    if (from) {
      var tag = mine(btn('knit-chip knit-mirror-chip', '↔ Worked out by the app from ' + from,
        'These rows were worked out by the app by mirroring ' + from + '. Check each one'));
      tag.addEventListener('click', function (e) { e.stopPropagation(); openMirrorInfo(from); });
      host.extra.appendChild(tag);
      var line = safe(function () { return Store.lineForRow(prt, W); }, null);
      if (line && line.text && line.text.indexOf(MIRROR_FLAG.trim()) >= 0) {
        host.extra.appendChild(mine(mk('div', 'knit-calc knit-mirror-warn', 'The app could not mirror this row safely: mirror it yourself.')));
      }
      return;
    }
    var tw = K && typeof K.mirrorText === 'function' ? mirrorTwin(p, prt) : null;
    if (tw) {
      var bt = mine(btn('knit-chip knit-mirror-chip knit-mirror-twin', '↔ Make the ' + tw.newName + ' from this, mirrored',
        'The pattern says to work the ' + tw.newName + ' as ' + prt.name + ', reversing the shaping. Let the app write its rows out mirrored, as a new part'));
      bt.addEventListener('click', function (e) { e.stopPropagation(); openMirrorSheet(p.id, prt.id, prt.id, tw); });
      host.extra.appendChild(bt);
      return;
    }
    var src = K && typeof K.mirrorText === 'function' ? mirrorSource(p, prt) : null;
    if (!src) return;
    var b = mine(btn('knit-chip knit-mirror-chip', '↔ Write it out from ' + src.name + ', mirrored',
      'The pattern says to work this as ' + src.name + ', reversing the shaping. Let the app write the rows out mirrored'));
    b.addEventListener('click', function (e) { e.stopPropagation(); openMirrorSheet(p.id, prt.id, src.id); });
    host.extra.appendChild(b);
  }

  function openMirrorInfo(from) {
    C().openSheet({
      title: 'Worked out by the app',
      build: function (body) {
        body.appendChild(mk('p', 'muted', 'The pattern only wrote ' + from + ' out. The app turned each of its rows round (k2tog ↔ ssk, ' +
          'left ↔ right, beginning ↔ end of the row). Rows it was not sure of are left as printed and say “mirror this yourself”. ' +
          'Check them against your knitting; Undo puts the pattern’s own sentence back.'));
      }
    });
  }

  /**
   * opts.newName: the mirrored rows become a NEW part of that name (the pattern
   * wrote "Work same as Right Front, reversing all shaping" at the end of the
   * Right Front's own text, so there is no Left Front part to fill);
   * opts.srcText: the source rows (the source part's text without that sentence).
   * knit-parse's mirrorText keeps a row's printed total at the end of the row now
   * (api §10), so the rows are used as it returns them.
   */
  function openMirrorSheet(projectId, partId, srcId, opts) {
    opts = opts || {};
    var p = Store.project(projectId);
    var prt = p ? Store.part(p, partId) : null;
    var src = p ? Store.part(p, srcId) : null;
    if (!prt || !src) return;
    var srcText = typeof opts.srcText === 'string' ? opts.srcText : String(src.patternText || '');
    var res = safe(function () { return window.Knits.mirrorText(srcText); }, null);
    if (!res || !Array.isArray(res.lines)) { C().toast('The app could not mirror ' + src.name); return; }
    // knit-parse's mirror keeps "—43 sts." / "(38 sts)." at the end now, but still
    // turns ". 29 sts." round into the row ("Knit to last 3 sts. 29 sts, k2tog,
    // k1" — knit-audit, 2026-11-13). Where the source row ends on a total and the
    // mirrored row does not, mirror the stitches alone and put the total back.
    var TAIL = /(\.\s*\(?\s*\d+\s*(?:sts?|stitches)\s*(?:rem(?:ain)?)?\s*\)?\.?\s*)$/i;
    if (typeof window.Knits.mirror === 'function') {
      res.lines = res.lines.map(function (l) {
        var from = String(l.from || ''), tm = TAIL.exec(from);
        if (!tm || l.mirrorYourself || TAIL.test(String(l.to || ''))) return l;
        var m = safe(function () { return window.Knits.mirror(from.slice(0, tm.index) + '.'); }, null);
        if (!m || !m.text) return l;
        return { from: from, to: String(m.text).replace(/\.\s*$/, '') + tm[1], mirrored: !!m.mirrored, mirrorYourself: !!m.mirrorYourself, unknown: m.unknown };
      });
    }
    var target = opts.newName || prt.name;
    // knit-audit: a bind-off is worked at the BEGINNING of a row; "bind off 7 sts
    // at end of next row" (beg ↔ end swapped) is not something a knitter can do —
    // the mirror is "at the beginning of the next WS (or RS) row". Leave such a
    // row as printed and say so rather than show a wrong instruction.
    res.lines = res.lines.map(function (l) {
      if (l && l.mirrored && /\b(?:bind|cast)\s+off\b[^.]*\bat\s+(?:the\s+)?end\s+of\b|\bBO\b[^.]*\bat\s+(?:the\s+)?end\s+of\b/i.test(String(l.to || ''))) {
        return { from: l.from, to: l.from, mirrored: false, mirrorYourself: true, unknown: ['(bind-off side)'] };
      }
      return l;
    });
    var unsure = res.lines.filter(function (l) { return l.mirrorYourself; }).length;
    var changed = res.lines.filter(function (l) { return l.mirrored && String(l.to) !== String(l.from); }).length;
    var c = C();
    c.openSheet({
      subject: projectId,
      title: target + ' from ' + src.name,
      cls: 'sheet-knit-mirror',
      build: function (body) {
        body.appendChild(mk('div', 'field-hint', 'Worked out by the app: ' + changed + ' row' + (changed === 1 ? '' : 's') + ' mirrored' +
          (unsure ? ', ' + unsure + ' left as printed for you to mirror yourself' : '') + '. Check them before you knit.'));
        var list = mk('div', 'knit-mirror-list');
        res.lines.forEach(function (l) {
          if (!String(l.from || '').trim()) return;
          var changedHere = !!(l.mirrored && String(l.to) !== String(l.from));
          var r = mk('div', 'knit-mirror-row' + (l.mirrorYourself ? ' unsure' : changedHere ? ' done' : ''));
          r.appendChild(mk('span', 'knit-mirror-badge', l.mirrorYourself ? 'mirror this yourself' : changedHere ? 'worked out by the app' : 'same as ' + src.name));
          r.appendChild(mk('div', 'knit-mirror-to', l.to));
          if (changedHere) r.appendChild(mk('div', 'knit-mirror-from', src.name + ': ' + l.from));
          list.appendChild(r);
        });
        body.appendChild(list);
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        {
          text: 'Use these rows', cls: 'btn primary', onClick: function (api) {
            var text = MIRROR_HEAD + src.name + ' (mirrored). Check each row.\n' +
              res.lines.map(function (l) { return l.mirrorYourself && String(l.to || '').trim() ? l.to + MIRROR_FLAG : l.to; }).join('\n');
            api.close();
            if (opts.newName) {
              var made = has(Store, 'addPart') ? Store.addPart(projectId, { name: opts.newName, makeCount: src.makeCount || 1 }) : null;
              if (!made) { c.toast('The app could not add ' + opts.newName); return; }
              Store.updatePart(projectId, made.id, { patternText: text });
              c.render();
              var cc = C();
              if (cc.announce) cc.announce(opts.newName + ' added: rows worked out by the app from ' + src.name);
              // two store steps (the part, then its rows): Undo takes both back
              if (cc.toast) cc.toast(opts.newName + ' added: rows worked out by the app from ' + src.name, { actionText: 'Undo', onAction: function () { Store.undo(); Store.undo(); cc.render(); } });
              return;
            }
            Store.updatePart(projectId, partId, { patternText: text });
            c.render();
            undoToast(prt.name + ': rows worked out by the app from ' + src.name);
          }
        }
      ]
    });
  }

  /* P20: needles and yarn for your size */
  function materialsOf(p) {
    var K = window.Knits;
    var cd = p.craftData && typeof p.craftData === 'object' ? p.craftData : {};
    if (cd.materials && typeof cd.materials === 'object') return cd.materials;
    if (!K || typeof K.materials !== 'function') return null;
    var text = typeof cd.materialsText === 'string' ? cd.materialsText
      : p.parts.map(function (q) { return String(q.placementNotes || '') + '\n' + String(q.patternText || ''); }).join('\n');
    return safe(function () { return K.materials(text); }, null);
  }

  function ownedSet(projectId) {
    var bag = safe(function () { return Store.craftSettings(CRAFT) || {}; }, {});
    var all = bag.materialsOwned && typeof bag.materialsOwned === 'object' ? bag.materialsOwned : {};
    return Array.isArray(all[projectId]) ? all[projectId].slice() : [];
  }

  function setOwned(projectId, list) {
    var bag = safe(function () { return Store.craftSettings(CRAFT) || {}; }, {});
    var all = bag.materialsOwned && typeof bag.materialsOwned === 'object' ? JSON.parse(JSON.stringify(bag.materialsOwned)) : {};
    if (list.length) all[projectId] = list; else delete all[projectId];
    setSetting('materialsOwned', all);
  }

  /** Text cut at a word boundary with "…" (and a dangling "[61" or "(5" dropped). */
  function clip(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim().replace(/\s*[\[(][^\])]*$/, '');
    if (s.length <= n) return s;
    var cut = s.slice(0, n).replace(/\s+\S*$/, '').replace(/\s*[\[(][^\])]*$/, '').replace(/[\s,;:.\-–]+$/, '');
    return (cut || s.slice(0, n)) + '…';
  }

  /** The yarn amount for the chosen size: '2 balls' (or the printed list when it cannot tell). */
  function yarnFor(y, size, sizeNames) {
    var per = Array.isArray(y.per) ? y.per : [];
    if (!per.length) return '';
    var n = per.length === 1 ? per[0] : (y.bySize && size < per.length ? per[size] : null);
    var unit = y.unit || 'balls';
    if (n === null || n === undefined) return per.join(' / ') + ' ' + unit + ' (one per size)';
    return n + ' ' + (n === 1 ? unit.replace(/s$/, '') : unit) + (per.length > 1 && sizeNames && sizeNames[size] ? ' (size ' + sizeNames[size] + ')' : '');
  }

  function openMaterialsSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var c = C();
    var prt = Store.activePart(p);
    var size = prt ? prt.sizeIndex || 0 : 0;
    var mat = materialsOf(p) || { yarn: [], needles: [] };
    var g = safe(function () { return Store.gaugeOf(p); }, null) || {};
    var owned = ownedSet(projectId);
    c.openSheet({
      subject: projectId,
      title: 'Materials',
      cls: 'sheet-knit-materials',
      build: function (body) {
        var any = false;
        function item(key, label, sub) {
          var r = mk('label', 'knit-mat-row');
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = owned.indexOf(key) >= 0;
          cb.addEventListener('change', function () {
            owned = owned.filter(function (k) { return k !== key; });
            if (cb.checked) owned.push(key);
            setOwned(projectId, owned);
            paintNeed();
          });
          r.appendChild(cb);
          var t = mk('span', 'knit-mat-text');
          t.appendChild(mk('span', 'knit-mat-main', label));
          if (sub) t.appendChild(mk('span', 'knit-mat-sub', sub));
          r.appendChild(t);
          return r;
        }
        var keys = [];
        if (mat.yarn && mat.yarn.length) {
          body.appendChild(mk('div', 'parts-group-head', 'Yarn'));
          mat.yarn.forEach(function (y, i) {
            var k = 'y' + i;
            keys.push({ k: k, label: (y.name || 'Yarn') + ': ' + yarnFor(y, size, p.sizes) });
            body.appendChild(item(k, (y.name || 'Yarn') + (y.alternative ? ' (or)' : ''), yarnFor(y, size, p.sizes)));
          });
          any = true;
        }
        if (mat.needles && mat.needles.length) {
          body.appendChild(mk('div', 'parts-group-head', 'Needles'));
          mat.needles.forEach(function (n, i) {
            var k = 'n' + i;
            var sizes = (n.mm || []).map(function (mm) { return needleLabel(mm); }).filter(Boolean).join(' and ');
            // knit-audit: plain words ("double-pointed", "24 in long"), and the printed
            // line cut at a word with "…", not mid-word ("… 24" [61")
            var kw = { dpn: 'double-pointed', circular: 'circular', straight: 'straight' };
            var kind = (n.kind || []).map(function (x) { return kw[x] || x; }).join(', ') +
              (n.length && n.length.value ? ', ' + n.length.value + ' ' + n.length.unit + ' long' : '');
            keys.push({ k: k, label: 'Needles ' + (sizes || n.text) });
            body.appendChild(item(k, sizes || clip(n.text, 80), [kind, sizes ? '“' + clip(n.text, 100) + '”' : ''].filter(Boolean).join(' · ')));
          });
          any = true;
        } else if (g.needle) {
          body.appendChild(mk('div', 'parts-group-head', 'Needles'));
          body.appendChild(item('g', String(g.needle), 'from the gauge'));
          keys.push({ k: 'g', label: 'Needles ' + g.needle });
          any = true;
        }
        if (!any) {
          body.appendChild(mk('div', 'field-hint', 'No yarn or needle list was read from this pattern. The materials list is usually before the instructions; import the PDF again to read it.'));
          return;
        }
        var need = mk('div', 'knit-mat-need');
        need.setAttribute('aria-live', 'polite');
        body.appendChild(need);
        function paintNeed() {
          var left = keys.filter(function (x) { return owned.indexOf(x.k) < 0; });
          need.textContent = left.length ? 'Still to get: ' + left.map(function (x) { return x.label; }).join(' · ') : 'You have everything on the list.';
        }
        paintNeed();
        body.appendChild(mk('div', 'field-hint', 'Read from the pattern' + (Array.isArray(p.sizes) && p.sizes.length > 1 ? ', for your size' : '') + '. Needle sizes follow Settings → Knitting.'));
      }
    });
  }

  /* P17: a schematic from the numbers */
  /**
   * The width of the piece row by row, from the stitch counts the counter
   * knows: [{ row, sts }] (rows with no count carry the one before).
   */
  function widthProfile(prt) {
    // to the part's target; with none (an open stretch), to the last row with a count
    var last = prt.targetRows >= 1 ? Math.min(prt.targetRows, 1500) : 0;
    if (!last && has(Store, 'stretchList')) {
      // an open stretch keeps its count for ever: draw it to where the knitter is
      var open = safe(function () { return Store.stretchList(prt); }, []).filter(function (x) { return x.state === 'open'; })[0];
      if (open && open.start) last = Math.max(prt.row || 0, open.start);
    }
    var su = safe(function () { return Store.setupLine(prt); }, null);
    var cur = su && su.count > 0 ? su.count : null;
    var out = [], miss = 0;
    if (cur) out.push({ row: 0, sts: cur });
    for (var r = 1; r <= (last || 1500); r++) {
      var t = safe(function () { return Store.targetFor(prt, r); }, null);
      if (t > 0) { cur = t; miss = 0; } else if (!last && ++miss > 80) break;
      if (cur) out.push({ row: r, sts: cur });
    }
    if (!last) while (out.length > 1 && miss-- > 0) out.pop();
    return out.length >= 2 ? out : null;
  }

  function schematicSvg(prof, g, unit) {
    var perSt = g && g.sts && g.over ? g.over / g.sts : null;
    var perRow = g && g.rows && g.over ? g.over / g.rows : null;
    var mySt = g && g.swatch && g.swatch.sts && g.over ? g.over / g.swatch.sts : null;
    if (!perSt || !perRow) return null;
    var maxSts = 0;
    prof.forEach(function (x) { if (x.sts > maxSts) maxSts = x.sts; });
    var rows = prof[prof.length - 1].row || 1;
    var Wd = maxSts * perSt, H = rows * perRow;
    var scale = 220 / Math.max(Wd, H);
    var w = Wd * scale, h = H * scale;
    var VW = Math.max(w, 120) + 140, VH = h + 60;
    var cx = VW / 2, top = 20;
    var svg = svgEl('svg', { viewBox: '0 0 ' + Math.round(VW) + ' ' + Math.round(VH), 'class': 'knit-schematic', role: 'img' });
    var left = [], right = [];
    prof.forEach(function (x) {
      var hw = x.sts * perSt * scale / 2, y = top + h - x.row * perRow * scale;
      left.push((cx - hw).toFixed(1) + ',' + y.toFixed(1));
      right.unshift((cx + hw).toFixed(1) + ',' + y.toFixed(1));
    });
    svg.appendChild(svgEl('polygon', { points: left.concat(right).join(' '), 'class': 'ks-shape' }));
    function lab(x, y, text, cls) {
      var t = svgEl('text', { x: x, y: y, 'class': cls || 'ks-label', 'text-anchor': 'middle' });
      t.textContent = text;
      svg.appendChild(t);
    }
    var first = prof[0], lastP = prof[prof.length - 1];
    function len(v) { return frac(Math.round(v * (unit === 'in' ? 8 : 10)) / (unit === 'in' ? 8 : 10)) + ' ' + unit; }
    lab(cx, top + h + 16, first.sts + ' sts · ' + len(first.sts * perSt));
    if (lastP.sts !== first.sts) lab(cx, top - 6, lastP.sts + ' sts · ' + len(lastP.sts * perSt));
    var vt = svgEl('text', { x: cx + w / 2 + 8, y: top + h / 2, 'class': 'ks-label', 'text-anchor': 'start' });
    vt.textContent = len(H);
    svg.appendChild(vt);
    var say = 'Widest ' + maxSts + ' sts, ' + len(Wd) + '; ' + rows + ' rows, ' + len(H) + ' long at the pattern’s gauge';
    var diff = null;
    if (mySt) {
      diff = maxSts * mySt - Wd;
      if (Math.abs(diff) >= (unit === 'in' ? 0.25 : 0.5)) {
        lab(cx, top + h + 34, 'your gauge makes this ' + len(Math.abs(diff)) + (diff > 0 ? ' wider' : ' narrower'), 'ks-label ks-warn');
        say += '. Your gauge makes it ' + len(Math.abs(diff)) + (diff > 0 ? ' wider' : ' narrower');
      } else diff = null;
    }
    svg.setAttribute('aria-label', say);
    return { svg: svg, say: say, width: Wd, length: H, diff: diff };
  }

  function openSchematicSheet(projectId) {
    var p = Store.project(projectId);
    if (!p) return;
    var g = safe(function () { return Store.gaugeOf(p); }, null);
    var unit = g && g.unit === 'in' ? 'in' : 'cm';
    C().openSheet({
      subject: projectId,
      title: 'Schematic',
      cls: 'sheet-knit-schematic',
      build: function (body) {
        if (!g || !g.sts || !g.rows) {
          body.appendChild(mk('div', 'field-hint', 'Add the pattern’s gauge (stitches and rows) in the part editor to draw the pieces to size.'));
          return;
        }
        body.appendChild(mk('div', 'field-hint', 'Drawn by the app from the stitch counts at the pattern’s gauge' +
          (Array.isArray(p.sizes) && p.sizes.length > 1 ? ', for your size' : '') + '. An open “work until” stretch is drawn to where you are.'));
        var drawn = 0;
        p.parts.forEach(function (q) {
          var prof = widthProfile(q);
          var s = prof ? schematicSvg(prof, g, unit) : null;
          var box = mk('div', 'knit-schematic-part');
          box.appendChild(mk('div', 'parts-group-head', q.name + (q.makeCount > 1 ? ' ×' + q.makeCount : '')));
          if (s) { box.appendChild(s.svg); box.appendChild(mk('div', 'field-hint', s.say + '.')); drawn++; }
          else box.appendChild(mk('div', 'field-hint', 'Not enough stitch counts in this part to draw it.'));
          body.appendChild(box);
        });
        if (!drawn) body.appendChild(mk('div', 'field-hint', 'No part has enough numbers yet.'));
      }
    });
  }

  /* P9: markers that move, marked stitches, markers carried on (the strip is app.js's) */
  function paintMarkerExtras(p, prt) {
    var strip = document.querySelector('#screen-project .knit-markers:not(.work-markers)');
    if (!strip || strip.hidden) return;
    removeMine(strip);
    var mi = safe(function () { return Store.markerInfo(prt); }, null);
    if (!mi || !mi.markers || !mi.markers.length) return;
    // a marker around a stitch is a ringed stitch
    var btns = strip.querySelectorAll('.knit-marker');
    mi.markers.forEach(function (m, i) {
      var b = btns[i];
      if (!b || m.kind !== 'stitch') return;
      b.textContent = '◉ ' + (m.name ? m.name + ' st' : 'st ' + (m.at + 1));
      b.classList.add('knit-marked-st');
      b.setAttribute('aria-label', 'Marked stitch' + (m.name ? ' ' + m.name : '') + ', stitch ' + (m.at + 1) + '. Tap to rename, hold (or press Delete) to remove');
    });
    var info = strip.querySelector('.knit-marker-info');
    if (mi.marked && Array.isArray(mi.plain) && info) {
      var segs = info.querySelector('.knit-segments');
      if (segs) {
        while (segs.firstChild) segs.removeChild(segs.firstChild);
        mi.plain.forEach(function (n, i) {
          if (i) segs.appendChild(mk('span', 'knit-seg-bar knit-seg-st', ' ◉ '));
          segs.appendChild(mk('span', 'knit-seg', n === null ? '…' : String(n)));
        });
        segs.setAttribute('aria-label', 'Plain stitches between the marked stitches: ' + mi.plain.map(function (n) { return n === null ? 'unknown' : n; }).join(', '));
      }
    }
    var notes = [];
    if (mi.moved) notes.push('moved with this row’s increases');
    if (mi.source === 'carried' && mi.from) notes.push('carried on from ' + mi.from);
    if (notes.length) {
      var n = mine(mk('div', 'knit-marker-moved', notes.join(' · ')));
      strip.appendChild(n);
    }
  }

  /* P16: the pattern's own words for the terms on this line */
  function lineTerms(p, text) {
    var list = safe(function () { return Store.glossary(p) || []; }, []);
    var t = ' ' + String(text || '').toLowerCase() + ' ';
    var hits = [];
    list.forEach(function (g) {
      if (!g || !g.abbr || !g.meaning || hits.length >= 12) return;
      var a = String(g.abbr).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (a.length < 2 && !g.fromPattern) return;
      if (new RegExp('(^|[^a-z0-9])' + a + '(?![a-z])').test(t)) hits.push(g);
    });
    // the pattern's own definitions first
    hits.sort(function (a, b) { return (b.fromPattern ? 1 : 0) - (a.fromPattern ? 1 : 0); });
    return hits;
  }

  function paintTerms(p, prt, li, host, W) {
    if (!has(Store, 'glossary')) return;
    var line = li ? li.shown : safe(function () { return Store.lineForRow(prt, W); }, null);
    if (!line || !line.text) return;
    var hits = lineTerms(p, line.text).filter(function (g) { return g.fromPattern || !/^(k|p|knit|purl|st|sts|rs|ws|rnd|rnds|row|rows|rep|pat|patt|cont|beg|end|rem|alt|foll|inc|dec|tog|approx|est|tbl|yo|sl|pm|sm|rm|cm|in|mm|mc|cc|cc1|cc2|st st|stst|garter|rib|rev)$/i.test(g.abbr); });
    if (!hits.length) return;
    var names = hits.slice(0, 3).map(function (g) { return g.abbr; }).join(' · ') + (hits.length > 3 ? ' …' : '');
    var chip = mine(btn('knit-chip knit-terms-chip', '📖 ' + names, 'What ' + hits.map(function (g) { return g.abbr; }).join(', ') + ' mean' + (hits.length === 1 ? 's' : '')));
    chip.addEventListener('click', function (e) { e.stopPropagation(); openTermsSheet(p.id, line.text); });
    host.extra.appendChild(chip);
  }

  function openTermsSheet(projectId, text) {
    var p = Store.project(projectId);
    if (!p) return;
    var hits = lineTerms(p, text);
    C().openSheet({
      subject: projectId,
      title: 'On this row',
      build: function (body) {
        body.appendChild(mk('div', 'knit-terms-line', '“' + String(text).slice(0, 200) + (String(text).length > 200 ? '…' : '') + '”'));
        hits.forEach(function (g) {
          var r = mk('div', 'knit-gloss-row');
          r.appendChild(mk('span', 'knit-gloss-abbr', g.abbr));
          r.appendChild(mk('span', 'knit-gloss-meaning', g.meaning));
          r.appendChild(mk('span', 'knit-gloss-src', g.fromPattern ? 'this pattern' : 'usual meaning'));
          body.appendChild(r);
        });
        if (typeof App.openGlossarySheet === 'function') {
          var all = btn('btn ghost', 'Whole glossary');
          all.addEventListener('click', function () { App.openGlossarySheet(projectId); });
          body.appendChild(all);
        }
      }
    });
  }

  /* P19: your own note on a row, kept for the second sleeve or sock */
  function noteKey(prt, row) {
    // the pair's two halves ("Sock 1", "Sock 2") and the second piece of a ×2 part share notes
    var base = String(prt.name || '').toLowerCase().replace(/\s*(?:\d+|[ab]|left|right|first|second)\s*$/i, '').replace(/\s+/g, ' ').trim() || 'part';
    var h = 5381;
    for (var i = 0; i < base.length; i++) h = ((h * 33) ^ base.charCodeAt(i)) >>> 0;
    return 's' + h.toString(36).slice(0, 9) + '~' + Math.max(0, Math.min(9999, row));
  }

  function rowNote(projectId, prt, row) {
    if (!has(Store, 'stepOverlay')) return '';
    var ov = safe(function () { return Store.stepOverlay(projectId); }, null) || {};
    var e = ov[noteKey(prt, row)];
    return e && e.note ? String(e.note) : '';
  }

  function paintRowNote(p, prt, word, host, W) {
    var note = rowNote(p.id, prt, W);
    if (!note) return;
    var chip = mine(btn('knit-chip knit-note-chip', '📝 ' + (note.length > 40 ? note.slice(0, 39) + '…' : note),
      'Your note on ' + word + ' ' + W + ': ' + note + '. Edit it'));
    chip.addEventListener('click', function (e) { e.stopPropagation(); openRowNoteSheet(p.id, prt.id); });
    host.extra.appendChild(chip);
  }

  function openRowNoteSheet(projectId, partId) {
    var p = Store.project(projectId);
    var prt = p ? Store.part(p, partId) : null;
    if (!prt || !has(Store, 'setStepNote')) return;
    var c = C();
    var W = Store.repeatInfo(prt).patternRow;
    var word = wordOf(p, prt);
    var area;
    c.openSheet({
      subject: projectId,
      title: 'Note on ' + word + ' ' + W,
      build: function (body) {
        area = document.createElement('textarea');
        area.className = 'knit-note-area';
        area.maxLength = 2000;
        area.rows = 3;
        area.value = rowNote(projectId, prt, W);
        area.placeholder = 'picked up 2 extra at the underarm, switched to 4 mm…';
        body.appendChild(c.field('Your note', area, 'Shown again on ' + word + ' ' + W + ' of the other ' + (prt.makeCount > 1 || Store.linkedPart && Store.linkedPart(p, prt) ? 'piece' : 'piece, if you make it again') + '.'));
      },
      footer: [
        { text: 'Cancel', cls: 'btn ghost', onClick: function (api) { api.close(); } },
        {
          text: 'Save', cls: 'btn primary', onClick: function (api) {
            Store.setStepNote(projectId, noteKey(prt, W), area.value.trim() ? area.value : null);
            api.close();
            c.render();
          }
        }
      ]
    });
  }

  /* P14: a clicker or pedal, outside working mode too, and a key you teach it */
  function learnedKeys() {
    var bag = safe(function () { return Store.craftSettings(CRAFT) || {}; }, {});
    return { forward: typeof bag.clickerForward === 'string' ? bag.clickerForward : '', back: typeof bag.clickerBack === 'string' ? bag.clickerBack : '' };
  }

  function keyName(k) {
    return k === ' ' ? 'Space' : k || '—';
  }

  /** 'forward' | 'back' | null for a key on the knitting counter. */
  function clickerAction(e, inWork) {
    var k = e.key, lk = learnedKeys();
    // the shell's own pedal map runs in working mode; here only what it does not know
    var shell = window.WorkMode && typeof WorkMode.keyAction === 'function' ? WorkMode.keyAction(e) : null;
    if (inWork && shell) return null;
    if (lk.forward && k === lk.forward) return 'forward';
    if (lk.back && k === lk.back) return 'back';
    if (!inWork && (k === 'PageDown')) return 'forward';
    if (!inWork && (k === 'PageUp')) return 'back';
    return null;
  }

  function onClickerKey(e) {
    if (learning || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable)) return;
    if (document.querySelector('dialog.sheet') || (window.Tour && typeof Tour.isRunning === 'function' && Tour.isRunning())) return;
    var scr = document.getElementById('screen-project');
    if (!scr || scr.hidden) return;
    var p = safe(function () { return C().currentProject(); }, null);
    if (!p || p.craft !== CRAFT) return;
    var wm = App.workMode;
    var inWork = !!(wm && typeof wm.isOn === 'function' && wm.isOn());
    var act = clickerAction(e, inWork);
    if (!act) return;
    var b = document.getElementById(act === 'forward' ? 'row-plus' : 'row-minus');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    b.click();
  }

  var learning = false;
  function clickerFields(body, ctx) {
    var lk = learnedKeys();
    var wrap = mk('div', 'knit-clicker');
    function row(which, label) {
      var r = mk('div', 'row-flex knit-clicker-row');
      var cur = mk('span', 'knit-clicker-key', keyName(lk[which]));
      var b = btn('btn ghost', 'Teach', 'Teach the ' + label + ' key');
      b.addEventListener('click', function () {
        learning = true;
        cur.textContent = 'Press your clicker now…';
        function got(e) {
          if (e.key === 'Escape') { done(); cur.textContent = keyName(learnedKeys()[which]); return; }
          if (/^(Shift|Control|Alt|Meta)$/.test(e.key)) return;
          e.preventDefault();
          e.stopPropagation();
          setSetting(which === 'forward' ? 'clickerForward' : 'clickerBack', e.key);
          cur.textContent = keyName(e.key);
          done();
          if (ctx && ctx.announce) ctx.announce(label + ' key set to ' + keyName(e.key));
        }
        function done() { learning = false; document.removeEventListener('keydown', got, true); clearTimeout(tm); }
        var tm = setTimeout(function () { done(); cur.textContent = keyName(learnedKeys()[which]); }, 15000);
        document.addEventListener('keydown', got, true);
      });
      var clr = btn('btn ghost', 'Clear', 'Forget the ' + label + ' key');
      clr.addEventListener('click', function () { setSetting(which === 'forward' ? 'clickerForward' : 'clickerBack', ''); cur.textContent = keyName(''); });
      r.appendChild(mk('span', 'knit-clicker-label', label));
      r.appendChild(cur);
      r.appendChild(b);
      r.appendChild(clr);
      return r;
    }
    wrap.appendChild(row('forward', 'Row done'));
    wrap.appendChild(row('back', 'Row back'));
    body.appendChild(ctx.field('Clicker or foot pedal', wrap,
      'Page Down / Page Up already work on the counter. Tap Teach and press a button on your clicker if it sends something else.'));
  }

  /* ---- P4: the chart sheet, with your row on it ---- */

  var PAD = 10;   // points of page round the chart, as app.js crops

  function openChartSheet(projectId, partId) {
    var p = Store.project(projectId);
    var prt = p ? Store.part(p, partId) : null;
    var c = C();
    if (!prt) return;
    var chi = safe(function () { return Store.chartInfo(prt); }, null);
    if (!chi) return;
    var urls = [];
    var KC = window.KnitChart;
    var side = sideFor(p, prt);
    c.openSheet({
      subject: projectId,
      title: chi.name + (chi.row ? ' · row ' + chi.row + (chi.of ? ' of ' + chi.of : '') : ''),
      cls: 'sheet-knit-chart',
      onClose: function () { urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } }); },
      build: function (body) {
        var panels = Array.isArray(chi.panels) && chi.panels.length ? chi.panels : [chi];
        panels.forEach(function (q) {
          var w = mk('div', 'knit-chart-row');
          var dir = side === null ? 'read right to left' : side === 'ws' ? 'WS, read left to right' : side === 'rs' ? 'RS, read right to left' : '';
          if (q.textSource === 'pattern') dir = 'as the pattern writes it';
          w.appendChild(mk('div', 'field-label', (panels.length > 1 ? q.name + ' · ' : '') + (q.row ? 'Row ' + q.row + (q.of ? ' of ' + q.of : '') : 'Row ? (its length is not known)') + (dir && q.row ? ' (' + dir + ')' : '')));
          if (q.text) w.appendChild(mk('div', 'knit-chart-text', q.text));
          else if (q.row) w.appendChild(mk('div', 'field-hint', q.page && q.page.chart && q.page.chart.image ? 'This chart is a picture, so the app cannot write the row out: read it from the chart below.' : 'This row could not be written out from the chart; read it from the page.'));
          body.appendChild(w);
        });
        var rc = chi.page && chi.page.chart ? chi.page.chart : null;
        if (rc && Array.isArray(rc.legend)) {
          var legend = rc.legend.filter(function (l) { return l && (l.meaning || l.text); });
          if (legend.length) {
            var key = document.createElement('details');
            key.className = 'knit-gloss-more';
            var ks = document.createElement('summary');
            ks.textContent = 'Key (' + legend.length + ')';
            key.appendChild(ks);
            legend.slice(0, 40).forEach(function (l) {
              var r = mk('div', 'knit-gloss-row');
              r.appendChild(mk('span', 'knit-gloss-abbr', String(l.stitch || l.text || l.sym || '').slice(0, 14)));
              r.appendChild(mk('span', 'knit-gloss-meaning', String(l.meaning || l.text || '')));
              key.appendChild(r);
            });
            body.appendChild(key);
          }
        }
        var stage = mk('div', 'knit-chart-stage');
        body.appendChild(stage);
        var B = window.BlobStore;
        if (!chi.page || !chi.page.key || !B || typeof B.get !== 'function') {
          if (rc && rc.cells && KC) drawFromCells(stage, rc, chi, side, prt);
          else if (chi.textSource !== 'pattern') stage.appendChild(mk('div', 'field-hint', 'The page this chart is printed on is not kept with the project. Import the PDF again (⋯ → Import pattern) to keep its chart pages.'));
          return;
        }
        stage.appendChild(mk('div', 'field-hint', 'Loading page ' + chi.page.page + '…'));
        B.get(chi.page.key).then(function (blob) {
          while (stage.firstChild) stage.removeChild(stage.firstChild);
          if (!blob) {
            if (rc && rc.cells && KC) drawFromCells(stage, rc, chi, side, prt);
            else stage.appendChild(mk('div', 'field-hint', 'Page ' + chi.page.page + ' is not on this device any more. Import the PDF again to keep it.'));
            return;
          }
          var url = URL.createObjectURL(blob);
          urls.push(url);
          var img = new Image();
          img.onload = function () { drawOnPage(stage, img, chi, side, prt, p); };
          img.onerror = function () { stage.appendChild(mk('div', 'field-hint', 'The page picture could not be opened.')); };
          img.src = url;
        });
      }
    });
  }

  /** The cropped page with the band, the arrow, the repeat box, the done cells; tap for a cell's meaning. */
  function drawOnPage(stage, img, chi, side, prt, p) {
    var KC = window.KnitChart;
    var ch = chi.page.chart || null;
    var s = chi.page.scale > 0 ? chi.page.scale : null;
    var b = ch && ch.bbox;
    var turned = !!(ch && ch.turned);
    var full = false, zoom = 1;
    var tools = mk('div', 'row-flex knit-chart-tools');
    var wholeB = btn('btn ghost', 'Whole page', 'Show the whole page');
    var minus = btn('btn ghost', '−', 'Zoom out');
    var plus = btn('btn ghost', '+', 'Zoom in');
    tools.appendChild(wholeB);
    tools.appendChild(minus);
    tools.appendChild(plus);
    stage.appendChild(tools);
    var note = mk('div', 'field-hint knit-chart-note');
    note.setAttribute('aria-live', 'polite');
    stage.appendChild(note);
    var wrap = mk('div', 'knit-chart-wrap');
    var cv = document.createElement('canvas');
    cv.className = 'knit-chart-canvas';
    cv.tabIndex = 0;
    wrap.appendChild(cv);
    stage.appendChild(wrap);
    var pop = mk('div', 'knit-cell-pop');
    pop.hidden = true;
    pop.setAttribute('role', 'status');
    stage.appendChild(pop);
    var calRow = mk('div', 'knit-calib-bar');
    stage.appendChild(calRow);

    var canCrop = !!(b && s && !turned && b.x1 > b.x0);
    var vectorBand = !!(ch && ch.cells && canCrop && typeof KC.rowBand === 'function');
    var frame = null;   // {sx, sy, sw, sh} in image px

    function frameNow() {
      if (full || !canCrop) return { sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight };
      var sx = Math.max(0, (b.x0 - PAD) * s), sy = Math.max(0, img.naturalHeight - (b.y1 + PAD) * s);
      return { sx: sx, sy: sy, sw: Math.min(img.naturalWidth - sx, (b.x1 - b.x0 + 2 * PAD) * s), sh: Math.min(img.naturalHeight - sy, (b.y1 - b.y0 + 2 * PAD) * s) };
    }
    // PDF points → canvas px of the current frame
    function ptX(x) { return x * s - frame.sx; }
    function ptY(y) { return img.naturalHeight - y * s - frame.sy; }
    function fracX(f) { return f * img.naturalWidth - frame.sx; }
    function fracY(f) { return f * img.naturalHeight - frame.sy; }

    function calOf() { return ch && ch.calib && typeof KC.calib === 'function' ? KC.calib(ch.calib) : null; }

    function paint() {
      frame = frameNow();
      cv.width = Math.max(1, Math.round(frame.sw));
      cv.height = Math.max(1, Math.round(frame.sh));
      cv.style.width = (zoom * 100) + '%';
      var g = cv.getContext('2d');
      g.drawImage(img, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, frame.sw, frame.sh);
      var hl = cssVar('--accent') || '#f0a868';
      var pr = cssVar('--primary') || '#7cb342';
      var band = null;
      if (chi.row && vectorBand) band = KC.rowBand(ch, chi.row);
      var k = !vectorBand ? calOf() : null;
      if (chi.row && k) band = KC.calibBand(k, chi.row);
      if (band) {
        var x0 = band.unit === 'pt' ? ptX(band.x0) : fracX(band.x0), x1 = band.unit === 'pt' ? ptX(band.x1) : fracX(band.x1);
        var y0 = band.unit === 'pt' ? ptY(band.y1) : fracY(band.y0), y1 = band.unit === 'pt' ? ptY(band.y0) : fracY(band.y1);
        g.save();
        g.globalAlpha = 0.28;
        g.fillStyle = hl;
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
        g.globalAlpha = 1;
        g.lineWidth = Math.max(2, (y1 - y0) * 0.08);
        g.strokeStyle = hl;
        g.strokeRect(x0, y0, x1 - x0, y1 - y0);
        // stitches done on this row, shaded darker
        if (vectorBand && prt.stitch > 0 && typeof KC.doneCols === 'function') {
          var d = KC.doneCols(ch, chi.row, side, prt.stitch);
          if (d && d.cols.length) {
            g.globalAlpha = 0.35;
            g.fillStyle = pr;
            d.cols.forEach(function (cc) {
              var bx = KC.cellBox(ch, band.r, cc);
              if (bx) g.fillRect(ptX(bx.x0), ptY(bx.y1), ptX(bx.x1) - ptX(bx.x0), ptY(bx.y0) - ptY(bx.y1));
            });
            g.globalAlpha = 1;
          }
        }
        // the way to read it: ← on RS and in the round, → on WS
        var ltr = side === 'ws' || (side === undefined && KC && ch && chi.row % 2 === 0 && !(ch.labelSide && ch.labelSide[chi.row] === 'right'));
        var ah = Math.max(8, Math.min(28, y1 - y0));
        // inside the band at the end you start from, so the row numbers stay readable
        var ax = ltr ? x0 + ah * 0.5 : x1 - ah * 0.5, ay = (y0 + y1) / 2;
        g.fillStyle = hl;
        g.beginPath();
        if (ltr) { g.moveTo(ax + ah * 0.6, ay); g.lineTo(ax - ah * 0.2, ay - ah * 0.45); g.lineTo(ax - ah * 0.2, ay + ah * 0.45); }
        else { g.moveTo(ax - ah * 0.6, ay); g.lineTo(ax + ah * 0.2, ay - ah * 0.45); g.lineTo(ax + ah * 0.2, ay + ah * 0.45); }
        g.closePath();
        g.fill();
        g.restore();
        note.textContent = 'Row ' + chi.row + ' is marked' + (side === null ? ', read right to left (in the round)' : ltr ? ', read left to right (WS)' : ', read right to left') +
          (band.unit === 'frac' ? ' · placed from your two marks' : '') + '. Tap a stitch for what it means.';
      } else if (chi.row) {
        note.textContent = turned ? 'This chart is printed sideways, so the row cannot be marked on it: count from the row numbers.'
          : (ch && ch.cells ? 'Row ' + chi.row + ' is not drawn on this chart.' : 'Mark the top and bottom rows once and the app will find each row on this picture.');
      }
      // the repeat box outlined
      if (vectorBand && ch.repeatBox && ch.repeatBox.c1 >= ch.repeatBox.c0) {
        var rb = ch.repeatBox, r0 = rb.r0 || 0, r1 = rb.r1 == null ? ch.cells.length - 1 : rb.r1;
        var lo = KC.cellBox(ch, r0, rb.c0), hi = KC.cellBox(ch, r1, rb.c1);
        if (lo && hi) {
          g.save();
          g.setLineDash([6, 4]);
          g.lineWidth = 3;
          g.strokeStyle = pr;
          g.strokeRect(ptX(lo.x0), ptY(hi.y1), ptX(hi.x1) - ptX(lo.x0), ptY(lo.y0) - ptY(hi.y1));
          g.restore();
        }
      }
      if (k && !vectorBand) drawCalHandles(g, k);
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', chi.name + ', page ' + chi.page.page + (chi.row ? ', row ' + chi.row + ' marked' : ''));
    }

    function drawCalHandles(g, k) {
      var col = cssVar('--primary') || '#7cb342';
      g.save();
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.setLineDash([4, 4]);
      [k.top, k.bottom].forEach(function (f) {
        var y = fracY(f);
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(cv.width, y);
        g.stroke();
      });
      g.restore();
    }

    wholeB.addEventListener('click', function () {
      full = !full;
      wholeB.textContent = full ? 'Just the chart' : 'Whole page';
      paint();
    });
    if (!canCrop) wholeB.hidden = true;
    minus.addEventListener('click', function () { zoom = Math.max(1, zoom - 0.5); paint(); });
    plus.addEventListener('click', function () { zoom = Math.min(4, zoom + 0.5); paint(); });

    // tap a cell: its key meaning
    cv.addEventListener('click', function (e) {
      if (calibrating) return;
      if (!vectorBand || typeof KC.cellAt !== 'function') return;
      var r = cv.getBoundingClientRect();
      var px = (e.clientX - r.left) * (cv.width / r.width) + frame.sx;
      var py = (e.clientY - r.top) * (cv.height / r.height) + frame.sy;
      var hit = KC.cellAt(ch, px / s, (img.naturalHeight - py) / s);
      showCell(hit);
    });
    function showCell(hit) {
      if (!hit) { pop.hidden = true; return; }
      var en = hit.entry;
      pop.hidden = false;
      pop.textContent = 'Row ' + hit.rowNo + ', stitch ' + (ch.cols - hit.c) + ' from the right: ' +
        (en && en.meaning ? en.meaning : en && en.text ? en.text : 'a symbol the key does not explain') +
        (en && en.text && en.meaning && en.text !== en.meaning ? ' (' + en.text + ')' : '');
    }

    // P4 raster / unread: the one-time two-mark calibration
    var calibrating = false;
    if (!vectorBand && !turned) {
      var calB = btn('btn ghost knit-calib-start', calOf() ? 'Mark the rows again' : 'Mark the rows');
      calRow.appendChild(calB);
      calB.addEventListener('click', function () { startCalib(); });
    }
    function startCalib() {
      calibrating = true;
      paint();
      while (calRow.firstChild) calRow.removeChild(calRow.firstChild);
      var marks = [];
      var hint = mk('div', 'field-hint knit-calib-hint', 'Tap the middle of the TOP row of the chart.');
      calRow.appendChild(hint);
      var rowsIn = document.createElement('input');
      rowsIn.type = 'number';
      rowsIn.inputMode = 'numeric';
      rowsIn.min = '1';
      rowsIn.max = '999';
      rowsIn.className = 'knit-calib-rows';
      rowsIn.setAttribute('aria-label', 'How many rows the chart has');
      var firstIn = document.createElement('input');
      firstIn.type = 'number';
      firstIn.inputMode = 'numeric';
      firstIn.min = '0';
      firstIn.value = '1';
      firstIn.className = 'knit-calib-first';
      firstIn.setAttribute('aria-label', 'The number of the bottom row');
      var save = btn('btn primary knit-calib-save', 'Save the marks');
      save.disabled = true;
      var form = mk('div', 'row-flex knit-calib-form');
      form.appendChild(C().field('Rows on the chart', rowsIn));
      form.appendChild(C().field('Bottom row is row', firstIn));
      form.hidden = true;
      calRow.appendChild(form);
      calRow.appendChild(save);
      function onTap(e) {
        var r = cv.getBoundingClientRect();
        var fy = ((e.clientY - r.top) * (cv.height / r.height) + frame.sy) / img.naturalHeight;
        var fx = ((e.clientX - r.left) * (cv.width / r.width) + frame.sx) / img.naturalWidth;
        marks.push({ x: fx, y: fy });
        var g = cv.getContext('2d');
        g.fillStyle = cssVar('--primary') || '#7cb342';
        g.fillRect(0, fracY(fy) - 1, cv.width, 3);
        if (marks.length === 1) hint.textContent = 'Now tap the middle of the BOTTOM row.';
        if (marks.length >= 2) {
          cv.removeEventListener('click', onTap);
          hint.textContent = 'How many rows are there from the top mark to the bottom mark, both counted?';
          form.hidden = false;
          save.disabled = false;
          try { rowsIn.focus(); } catch (e2) { /* ignore */ }
        }
      }
      cv.addEventListener('click', onTap);
      save.addEventListener('click', function () {
        var top = Math.min(marks[0].y, marks[1].y), bottom = Math.max(marks[0].y, marks[1].y);
        // the band spans the part of the page in view (the chart, when it is cropped)
        var cal = KC.calib({ top: top, bottom: bottom, rows: parseInt(rowsIn.value, 10), first: parseInt(firstIn.value, 10) || 1,
          x0: frame.sx / img.naturalWidth, x1: (frame.sx + frame.sw) / img.naturalWidth });
        if (!cal) { C().toast('Type how many rows the chart has'); return; }
        if (saveCalib(p.id, chi, cal)) {
          ch = ch || {};
          ch.calib = cal;
          calibrating = false;
          while (calRow.firstChild) calRow.removeChild(calRow.firstChild);
          C().toast('Rows marked. The app places each row from these marks.');
          paint();
        }
      });
    }
    paint();
  }

  /** Keep a calibration with the chart (craftData.charts[n].calib). */
  function saveCalib(projectId, chi, cal) {
    if (!has(Store, 'chartPages') || !has(Store, 'setChartPages')) return false;
    var list = safe(function () { return Store.chartPages(projectId); }, []) || [];
    var hit = false;
    list.forEach(function (e) {
      if (e.page === chi.page.page && (!chi.name || !e.name || e.name === chi.page.name || e.name === chi.name)) {
        e.chart = e.chart && typeof e.chart === 'object' ? e.chart : { name: e.name, image: true, cells: null };
        e.chart.calib = cal;
        hit = true;
      }
    });
    if (!hit) return false;
    Store.setChartPages(projectId, list);
    return true;
  }

  /** No page picture: draw the read chart from its cells. */
  function drawFromCells(stage, ch, chi, side, prt) {
    var svg = chartStripSvg(ch, chi.row, side, prt.stitch);
    if (!svg) return;
    stage.appendChild(mk('div', 'field-hint', 'The page is not kept with the project; this is the chart as the app read it, around row ' + chi.row + '.'));
    svg.setAttribute('class', 'knit-chart-strip knit-chart-strip-sheet');
    stage.appendChild(svg);
  }

  function cssVar(name) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { return ''; }
  }

  /* ---- the stretch list sheet (⋯ → Stretches) ---- */

  function openStretchSheet(projectId, partId) {
    var p = Store.project(projectId);
    var prt = p ? Store.part(p, partId) : null;
    if (!prt || !has(Store, 'stretchList')) return;
    var c = C();
    var word = wordOf(p, prt);
    c.openSheet({
      subject: projectId,
      title: 'Stretches in ' + prt.name,
      build: function (body) {
        var list = safe(function () { return Store.stretchList(prt); }, []);
        if (!list.length) { body.appendChild(mk('div', 'field-hint', 'No “work until it measures” stretches in this part.')); return; }
        body.appendChild(mk('div', 'field-hint', 'A stretch is worked until you say it is long enough. Nothing after an open stretch has a ' + word + ' number yet.'));
        list.forEach(function (x) {
          var r = mk('div', 'knit-stretch-item knit-stretch-' + x.state);
          var where = x.start === null ? 'after the one before it' : x.end === null ? 'from ' + word + ' ' + x.start + ', open' : word + 's ' + x.start + '–' + x.end + (x.state === 'planned' ? ' (planned ≈)' : '');
          r.appendChild(mk('div', 'knit-stretch-where', where));
          r.appendChild(mk('div', 'knit-stretch-line', String(x.line && x.line.text || '').slice(0, 140)));
          if (x.end !== null && has(Store, 'reopenStretch')) {
            var b = btn('btn ghost', 'Reopen', 'Reopen this stretch');
            b.addEventListener('click', function () {
              if (Store.reopenStretch(projectId, partId, x.key)) { c.closeAllSheets(); c.render(); undoToast('Stretch open again'); }
            });
            r.appendChild(b);
          }
          body.appendChild(r);
        });
      }
    });
  }

  /* ================================================================== *
   * 7. Registration
   * ================================================================== */

  App.registerCraft({
    id: CRAFT,
    name: 'Knitting',
    label: 'Knitting',
    emoji: '🧣',
    tagline: 'The row counter, reading knitting patterns: RS/WS, markers, k2tog and C6F.',
    usesCounter: true,
    parser: 'Knits',
    parserExtras: { checklistStart: CHECKLIST_START, checklistSections: CHECKLIST_SECTIONS },
    sectionNames: SECTION_NAMES.slice(),
    settingsFields: settingsFields,
    menuItems: menuItems,
    tourId: CRAFT,
    faq: FAQ,
    // wave K (knit-ui): called by js/app.js at the end of updateKnitWidgets
    counterPaint: counterPaint,
    onInit: function () {
      if (window.Tour && typeof window.Tour.register === 'function') {
        try { window.Tour.register(TOUR); } catch (e) { /* the counter tour still runs */ }
      }
      try { document.addEventListener('keydown', onClickerKey); } catch (e3) { /* no clicker keys */ }
    }
  });

  window.AppKnitting = {
    counterPaint: counterPaint,
    openChartSheet: openChartSheet,
    openStretchSheet: openStretchSheet,
    openMeasureSheet: openMeasureSheet,
    openRowNoteSheet: openRowNoteSheet,
    openTermsSheet: openTermsSheet,
    openMirrorSheet: openMirrorSheet,
    openMaterialsSheet: openMaterialsSheet,
    openSchematicSheet: openSchematicSheet,
    openPickupSheet: openPickupSheet,
    mirrorSource: mirrorSource,
    mirrorTwin: mirrorTwin,
    pastEnd: pastEnd,
    repeatTrusted: repeatTrusted,
    partInRounds: partInRounds,
    clip: clip,
    materialsOf: materialsOf,
    widthProfile: widthProfile,
    schematicSvg: schematicSvg,
    yarnFor: yarnFor,
    __hookOnly: true,
    menuItems: menuItems,
    measured: measured,
    noteKey: noteKey,
    clickerAction: clickerAction,
    endStretch: endStretchNow,
    useEstimate: useEstimateNow,
    ui: {
      frac: frac,
      stretchText: stretchText,
      repeatText: repeatText,
      panelShort: panelShort,
      panelChip: panelChip,
      colourText: colourText,
      shapingText: shapingText,
      chartStripSvg: chartStripSvg
    },
    settings: settings,
    needleLabel: needleLabel,
    needleSizes: NEEDLES.map(function (n) { return { mm: n[0], us: n[1], uk: n[2] }; }),
    sectionNames: SECTION_NAMES.slice(),
    templates: TEMPLATES.map(function (t) { return t.id; })
  };
})();
