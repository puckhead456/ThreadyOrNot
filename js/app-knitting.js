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
    return items;
  }

  /* ================================================================== *
   * 6. Registration
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
    onInit: function () {
      if (window.Tour && typeof window.Tour.register === 'function') {
        try { window.Tour.register(TOUR); } catch (e) { /* the counter tour still runs */ }
      }
    }
  });

  window.AppKnitting = {
    settings: settings,
    needleLabel: needleLabel,
    needleSizes: NEEDLES.map(function (n) { return { mm: n[0], us: n[1], uk: n[2] }; }),
    sectionNames: SECTION_NAMES.slice(),
    templates: TEMPLATES.map(function (t) { return t.id; })
  };
})();
