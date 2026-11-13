/* Stitchkeeper — js/store.js
 * window.Store : state, persistence (localStorage), counting semantics,
 * undo stack, timers, templates, export/import.
 * Pure data layer — never touches the DOM.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Constants
   * ------------------------------------------------------------------ */

  var KEY = 'stitchkeeper.v1';
  var VERSION = 1;
  var UNDO_CAP = 50;
  /* Wave 1 (09 #9): the entry cap is not enough when one entry is a 500x500
   * chart. Shift the oldest until the serialised stack is under this. */
  var UNDO_BYTE_CAP = 2 * 1024 * 1024;
  var HISTORY_CAP = 500;
  var SAVE_DEBOUNCE = 150;

  /* Free-text safety (13 #10): no name may reach the DOM unbounded, and the
   * bidi overrides must never travel with one. */
  var NAME_MAX = 120;
  /* Built from strings, never from literals: a bidi override or a control byte
   * typed straight into this file would be invisible here and would make git
   * and ripgrep treat js/store.js as binary (09 #7). */
  var BIDI_RE = new RegExp('[\u202A-\u202E\u2066-\u2069]', 'g');
  var CONTROL_RE = new RegExp('[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]', 'g');

  /* Timers (13 #8): a single span longer than this is a clock artefact, not
   * crochet. */
  var MAX_SPAN_MS = 18 * 60 * 60 * 1000;

  var state = null;
  var undoStack = [];
  var undoBytesTotal = 0;
  var saveTimer = null;
  // partId -> { text, length, size, lines, version, index }. The key is compared
  // by REFERENCE, never rebuilt — see partLines().
  var lineCache = Object.create(null);
  var lineVersion = 0;
  var diagramCache = Object.create(null); // partId -> { key, model } (live 3D diagram)

  /* ---- Wave 1: persistence health -------------------------------------- *
   * Nothing in here is persisted. It is what this tab knows about whether
   * the last write worked, whether another tab has moved underneath us, and
   * whether the data on disk was readable at all.
   * ---------------------------------------------------------------------- */

  /** Identifies THIS tab across the `storage` event (13 #1). */
  var WRITER_ID = null;
  /** True once a write failed; cleared by the next write that works. */
  var saveFailedFlag = false;
  var lastStorageError = null;
  var storageErrorSubs = [];
  /** Unsaved local changes: set by save(), cleared by a successful write. */
  var dirty = false;
  /** The raw text that could not be read, and where a copy of it went. */
  var corruptFlag = false;
  var corruptText = null;
  var corruptKeyName = null;
  /** Another tab wrote while we had work in flight. */
  var conflictFlag = false;
  var conflictDetail = null;
  var conflictSubs = [];
  var externalSubs = [];
  /** The pre-import snapshot, for Store.undoImport() (09 #3). */
  var preimportText = null;
  /** Timer (13 #8): the monotonic start of the span currently running. */
  var runningSpan = null;

  /* Live diagram: the reserved main-yarn key and its warm cream default. */
  var MAIN_YARN = '*';
  var MAIN_YARN_DEFAULT = '#f1e3c8';
  /* Never model more rounds than this — a 900-row blanket would choke the GPU. */
  var DIAGRAM_MAX_ROUNDS = 400;
  /* How much of that window sits BEHIND the round being worked (the rest ahead). */
  var DIAGRAM_WINDOW_BACK = 0.7;
  /* Per-stitch records kept for one round; the count itself is never truncated. */
  var STITCH_DETAIL_MAX = 999;
  /* Ring POSITIONS read out of one expansion, matching the parser's own
     MAX_STITCHES. A ch-3 mesh row spends four positions per stitch (the
     Premier sparkling wrap: 1,617 positions for 405 sts), so a ceiling set to
     the renderer's detail budget used to cut the row — and the row after it,
     which starts from this one's count — down to 999. */
  var DIAGRAM_MAX_POSITIONS = 20000;

  /* ------------------------------------------------------------------ *
   * Small utilities
   * ------------------------------------------------------------------ */

  function now() { return Date.now(); }

  function uid() {
    return (
      Date.now().toString(36) +
      '-' +
      Math.random().toString(36).slice(2, 8) +
      Math.random().toString(36).slice(2, 6)
    );
  }

  function clampInt(v, min, max, dflt) {
    var n = typeof v === 'number' ? v : parseInt(v, 10);
    if (typeof n !== 'number' || !isFinite(n)) return dflt;
    n = Math.floor(n);
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
  }

  function str(v, dflt) {
    return typeof v === 'string' ? v : dflt;
  }

  /** A finite, positive number (stitch height / width), else the default. */
  function posNum(v, dflt) {
    return typeof v === 'number' && isFinite(v) && v > 0 ? v : dflt;
  }

  function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /** A plain, JSON-safe copy of an object — or {} when it cannot be one. */
  function jsonObject(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    try {
      var copy = JSON.parse(JSON.stringify(raw));
      if (!copy || typeof copy !== 'object' || Array.isArray(copy)) return {};
      return copy;
    } catch (e) {
      return {};
    }
  }

  /** A JSON-safe copy of any value (undefined when it cannot be one). */
  function jsonValue(v) {
    if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return undefined; }
  }

  /**
   * A name that is safe to store and to render (13 #10): bidi overrides and
   * control characters stripped, trimmed, capped at 120 characters on a whole
   * code point.
   */
  function safeName(v, dflt) {
    var s = str(v, '');
    if (!s) return dflt;
    s = s.replace(BIDI_RE, '').replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();
    if (s.length > NAME_MAX) {
      s = s.slice(0, NAME_MAX);
      // Never leave half a surrogate pair behind.
      var last = s.charCodeAt(s.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, s.length - 1);
      s = s.replace(/\s+$/, '');
    }
    return s || dflt;
  }

  /**
   * `Part.workMode`: 'auto' (ask the pattern, then the project), or an explicit
   * 'rounds' / 'rows' the owner picked. 05-ux-meaning #2 — one project-level
   * word cannot be right for a round yoke AND its flat panels.
   */
  function normalizeWorkMode(v, dflt) {
    var s = str(v, '').trim().toLowerCase();
    if (s === 'rounds' || s === 'rows' || s === 'auto') return s;
    return dflt || 'auto';
  }

  /**
   * `Part.orientation`: 'auto' (ask the pattern text), or the explicit
   * 'top-down' / 'bottom-up' the owner picked. The model always grows DOWNWARD
   * from round 1, so a body the designer worked from its base renders upside
   * down until something says so — and the text does not always say it in
   * words the phrase list can see.
   */
  function normalizeOrientation(v, dflt) {
    var s = str(v, '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (s === 'top-down' || s === 'bottom-up' || s === 'auto') return s;
    return dflt || 'auto';
  }

  /**
   * `Part.dialect`: 'auto' (ask this piece's own text, and failing that whatever
   * the imported DOCUMENT said), or the explicit 'uk' / 'us' the owner picked.
   *
   * UK and US crochet count the same — sc/dc/tr are all one-for-one — so this
   * never changes a stitch count. It changes HEIGHTS, which is the whole of the
   * 3D diagram: a UK `tr` is a US `dc` (h 2.01), while a US `tr` is a round
   * taller (h 2.68). `Patterns.dialectHints` reads the Stylecraft hood leaflet
   * as UK on the strength of `htr` and "Tension" on its abbreviations page, but
   * the Motif SECTION on its own writes nothing but `tr`, `dc` and `ch` — so
   * the section alone is undecided, `expand` fell back to US trebles, and the
   * granny square came out 33 % too tall and cupped.
   */
  function normalizeDialect(v, dflt) {
    var s = str(v, '').trim().toLowerCase();
    if (s === 'uk' || s === 'us' || s === 'auto') return s;
    return dflt || 'auto';
  }

  /** FNV-1a, base36. Short, stable, and good enough to key a PDF section. */
  function hash32(text) {
    var h = 0x811c9dc5;
    var s = String(text == null ? '' : text);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      // h *= 16777619, kept in 32 bits without Math.imul (ES5).
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return (h >>> 0).toString(36);
  }

  /** A monotonic millisecond clock. Never goes backwards; never jumps. */
  function mono() {
    try {
      if (window.performance && typeof window.performance.now === 'function') {
        var t = window.performance.now();
        if (typeof t === 'number' && isFinite(t)) return t;
      }
    } catch (e) { /* fall through */ }
    return Date.now();
  }

  /** 'YYYY-MM-DD' in local time, for the backup-nag day counter. */
  function dayKey(ts) {
    var d = new Date(typeof ts === 'number' && isFinite(ts) ? ts : Date.now());
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  /** Subscribe helper — returns the unsubscribe function. */
  function subscribe(list, fn) {
    if (typeof fn !== 'function') return function () {};
    list.push(fn);
    return function () {
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  function emit(list, payload) {
    for (var i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (e) { /* a broken subscriber never breaks a save */ }
    }
  }

  /* ------------------------------------------------------------------ *
   * Crafts
   *
   * The shell knows three things about a craft: its id, how to repair its
   * opaque `craftData`, and how to write a home-card summary line. Crochet is
   * the default and needs no registration at all — it is what every old save
   * and every project without a `craft` migrates to.
   * ------------------------------------------------------------------ */

  var DEFAULT_CRAFT = 'crochet';
  var crafts = Object.create(null);   // id -> { id, normalize, summary, templates }
  var craftOrder = [];

  /**
   * Called at script time by a craft's pure-logic module.
   * @param {{id:string, normalize?:Function, summary?:Function, templates?:Array}} def
   */
  function registerCraft(def) {
    if (!def || typeof def !== 'object') return null;
    var id = str(def.id, '').trim();
    if (!id) return null;
    var prevEntry = crafts[id] || null;
    var entry = {
      id: id,
      normalize: typeof def.normalize === 'function' ? def.normalize : null,
      summary: typeof def.summary === 'function' ? def.summary : null,
      templates: [],
      // wave K: optional hooks (docs/wave-k/api/shell-data.md §1); a later
      // registration that does not name one keeps the earlier one
      template: 'template' in def ? hookObj(def.template) : (prevEntry ? prevEntry.template : null),
      settingsHook: 'settings' in def ? hookObj(def.settings) : (prevEntry ? prevEntry.settingsHook : null),
      heavy: 'heavy' in def ? normalizeHeavyDef(def.heavy) : (prevEntry ? prevEntry.heavy : null)
    };
    if (Array.isArray(def.templates)) {
      for (var i = 0; i < def.templates.length; i++) {
        var t = def.templates[i];
        if (!t || typeof t !== 'object') continue;
        if (!str(t.id, '').trim()) continue;
        var copy = deepCopy(t);
        copy.craft = id;
        entry.templates.push(copy);
      }
    }
    if (!crafts[id]) craftOrder.push(id);
    crafts[id] = entry;

    // A craft that registers AFTER Store.load() (a lazily added module, a test)
    // still gets its templates seeded and its projects repaired.
    if (state) {
      seedCraftTemplates(id);
      renormalizeCraft(id);
      save();
    }
    return entry;
  }

  function craftIds() {
    return craftOrder.slice();
  }

  function craftDef(id) {
    var key = str(id, '');
    return (key && crafts[key]) || null;
  }

  /** Every craft-supplied built-in template definition, in registration order. */
  function craftTemplateDefs() {
    var out = [];
    for (var i = 0; i < craftOrder.length; i++) {
      var c = crafts[craftOrder[i]];
      if (!c) continue;
      for (var j = 0; j < c.templates.length; j++) out.push(c.templates[j]);
    }
    return out;
  }

  /**
   * Repair a project's opaque craftData through its module. Never throws; with
   * no module registered the data is kept exactly as it was, so a craft whose
   * script failed to load does not lose the user's work.
   */
  function normalizeCraftData(craftId, raw, rawProject) {
    var data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    var c = crafts[craftId];
    if (!c || !c.normalize) return data;
    try {
      var out = c.normalize(data, rawProject);
      if (out && typeof out === 'object' && !Array.isArray(out)) return out;
    } catch (e) {
      /* a broken module must never stop the app loading */
    }
    return data;
  }

  /** Re-run one craft's normalize over the projects already in memory. */
  function renormalizeCraft(id) {
    var c = crafts[id];
    if (!c || !c.normalize || !state || !Array.isArray(state.projects)) return;
    for (var i = 0; i < state.projects.length; i++) {
      var p = state.projects[i];
      if (p.craft !== id) continue;
      // wave K: half a craftData (heavy fields not loaded yet) is never normalised
      if (!isHeavyReady(p)) continue;
      p.craftData = normalizeCraftData(id, p.craftData, p);
    }
    if (state.settings && state.settings.crafts && state.settings.crafts[id]) {
      state.settings.crafts[id] = normalizeOneCraftSettings(id, state.settings.crafts[id]);
    }
  }

  /* ------------------------------------------------------------------ *
   * Templates
   * ------------------------------------------------------------------ */

  /**
   * Templates v2: templates are DATA in state, not a constant. These are the
   * shipped defaults — seeded on first load and re-seeded if a built-in id has
   * gone missing from a saved state. User templates are never touched.
   */
  var BUILTIN_TEMPLATES = [
    {
      id: 'blank',
      name: 'Single piece',
      emoji: '🧶',
      countMode: 'rows',
      groupSize: 10,
      parts: [{ name: 'Main', makeCount: 1 }],
      checklist: []
    },
    {
      id: 'sheep',
      name: 'Sheep',
      emoji: '🐑',
      countMode: 'rounds',
      groupSize: 10,
      parts: [
        { name: 'Body', makeCount: 1 },
        { name: 'Head', makeCount: 1 },
        { name: 'Ears', makeCount: 2 },
        { name: 'Legs', makeCount: 4 },
        { name: 'Tail', makeCount: 1 }
      ],
      checklist: [
        'Stuff body',
        'Stuff head',
        'Sew head to body',
        'Attach safety eyes',
        'Sew ears',
        'Sew legs',
        'Sew tail',
        'Embroider face'
      ]
    },
    {
      id: 'dragon',
      name: 'Dragon',
      emoji: '🐉',
      countMode: 'rounds',
      groupSize: 10,
      parts: [
        { name: 'Body', makeCount: 1 },
        { name: 'Head', makeCount: 1 },
        { name: 'Wings', makeCount: 2 },
        { name: 'Legs', makeCount: 4 },
        { name: 'Tail', makeCount: 1 },
        { name: 'Horns', makeCount: 2 },
        { name: 'Spikes', makeCount: 1 }
      ],
      checklist: [
        'Stuff body',
        'Stuff head',
        'Sew head to body',
        'Attach safety eyes',
        'Sew wings',
        'Sew legs',
        'Sew tail',
        'Sew horns',
        'Sew spikes down back',
        'Embroider nostrils'
      ]
    }
  ];

  /**
   * The shipped definition for a built-in id, or null for user templates.
   * Craft modules contribute their own built-ins through registerCraft.
   */
  function builtInDef(id) {
    var i;
    for (i = 0; i < BUILTIN_TEMPLATES.length; i++) {
      if (BUILTIN_TEMPLATES[i].id === id) return BUILTIN_TEMPLATES[i];
    }
    var extra = craftTemplateDefs();
    for (i = 0; i < extra.length; i++) {
      if (extra[i].id === id) return extra[i];
    }
    return null;
  }

  function normalizeTemplate(t) {
    t = t && typeof t === 'object' ? t : {};
    var parts = [];
    if (Array.isArray(t.parts)) {
      for (var i = 0; i < t.parts.length; i++) {
        var p = t.parts[i];
        if (!p || typeof p !== 'object') continue;
        var pname = str(p.name, '').trim();
        if (!pname) continue;
        // Templates carry the pattern text of the part they were drafted from
        // (a PDF import saved as a template), so a project made from one comes
        // out with its rounds already in place. The placing notes ride along
        // the same way. Built-ins have neither.
        parts.push({
          name: pname,
          makeCount: clampInt(p.makeCount, 1, 99, 1),
          patternText: str(p.patternText, ''),
          placementNotes: str(p.placementNotes, ''),
          // Rides along with patternText: a template drafted from an amigurumi
          // part keeps "this piece is worked in rounds".
          workMode: normalizeWorkMode(p.workMode, 'auto'),
          // ...and which way up it was worked, for the same reason.
          orientation: normalizeOrientation(p.orientation, 'auto'),
          // ...and which side of the Atlantic named its stitches: the text
          // rides along, so the reading of the text must too.
          dialect: normalizeDialect(p.dialect, 'auto')
        });
        // wave G: the size this part belongs to (present only when set)
        var tg = normalizeGroupName(p.group);
        if (tg) parts[parts.length - 1].group = tg;
        // wave H: knitting markers + two-at-a-time partner (present only when set)
        knitTemplatePart(parts[parts.length - 1], p);
      }
    }
    if (!parts.length) {
      parts = [{
        name: 'Main', makeCount: 1, patternText: '', placementNotes: '',
        workMode: 'auto', orientation: 'auto', dialect: 'auto'
      }];
    }

    var checklist = [];
    if (Array.isArray(t.checklist)) {
      for (var j = 0; j < t.checklist.length; j++) {
        var c = str(t.checklist[j], '').trim();
        if (c) checklist.push(c);
      }
    }

    var id = str(t.id, '') || uid();
    var nt = {
      id: id,
      name: str(t.name, '').trim() || 'Untitled template',
      emoji: str(t.emoji, '') || '🧶',
      countMode: t.countMode === 'rounds' ? 'rounds' : 'rows',
      // 0 = grouping off
      groupSize: clampInt(t.groupSize, 0, 50, 10),
      parts: parts,
      checklist: checklist,
      // Crafts: old templates have no idea and migrate to crochet.
      craft: str(t.craft, '').trim() || DEFAULT_CRAFT,
      // Seed craftData for projects made from this template (deep-copied on use).
      craftData:
        t.craftData && typeof t.craftData === 'object' && !Array.isArray(t.craftData)
          ? jsonObject(t.craftData)
          : null,
      builtIn: !!builtInDef(id),
      updatedAt: clampInt(t.updatedAt, 0, 1e15, 0) || now()
    };
    // Wave F (size-once): a template saved from a multi-size import keeps the
    // leaflet's size names and the size that was picked, so a project made
    // from it offers "XS/S M L …" (not "Size 1..N") and starts at that size.
    // Present only when there are sizes, so older templates are unchanged.
    if (Array.isArray(t.sizes)) {
      var tsz = t.sizes.map(function (x) { return str(x, '').trim(); }).filter(Boolean);
      if (tsz.length >= 2) {
        nt.sizes = tsz;
        var tsel = normalizeProjectSize(t.size);
        if (tsel && tsel.index < tsz.length) nt.size = { index: tsel.index, label: tsz[tsel.index] };
      }
    }
    // Wave G: a template saved from a multi-size booklet keeps every size, in
    // order. Present only when a part names a group, so older templates and
    // the built-ins are unchanged.
    var tgroups = normalizeGroups(t.groups, parts);
    if (tgroups.length) nt.groups = tgroups;
    // Wave H: the pattern gauge (present only when known)
    knitTemplateCarry(nt, t);
    return nt;
  }

  function seedTemplate(def) {
    var t = normalizeTemplate(deepCopy(def));
    t.builtIn = true;
    return t;
  }

  function findTemplate(list, id) {
    if (!id) return null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /**
   * Normalise a saved `templates` array:
   * - migrates the old `blob` id to `sheep` (unless a real `sheep` exists),
   * - keeps every user template untouched,
   * - re-seeds any missing built-in.
   */
  function normalizeTemplates(raw) {
    var out = [];
    if (Array.isArray(raw)) {
      for (var i = 0; i < raw.length; i++) {
        if (!raw[i] || typeof raw[i] !== 'object') continue;
        var t = normalizeTemplate(raw[i]);
        if (findTemplate(out, t.id)) continue; // first one wins on duplicates
        out.push(t);
      }
    }
    // blob → sheep
    var blob = findTemplate(out, 'blob');
    if (blob) {
      if (findTemplate(out, 'sheep')) {
        out.splice(out.indexOf(blob), 1);
      } else {
        blob.id = 'sheep';
        blob.builtIn = true;
      }
    }
    // Re-seed anything shipped that this save is missing — crochet's built-ins
    // and every built-in a craft module declared before load().
    var defs = BUILTIN_TEMPLATES.concat(craftTemplateDefs());
    for (var k = 0; k < defs.length; k++) {
      if (!findTemplate(out, defs[k].id)) out.push(seedTemplate(defs[k]));
    }
    return out;
  }

  /** Late registration: add just this craft's missing built-ins. */
  function seedCraftTemplates(craftId) {
    var c = crafts[craftId];
    if (!c || !state) return;
    var list = templateList();
    for (var i = 0; i < c.templates.length; i++) {
      if (!findTemplate(list, c.templates[i].id)) list.push(seedTemplate(c.templates[i]));
    }
  }

  function templateList() {
    var s = getState();
    if (!Array.isArray(s.templates)) s.templates = normalizeTemplates(null);
    return s.templates;
  }

  /**
   * Built-ins in shipped order first, then user templates by name.
   * @param {string} [craft] when given, only templates for that craft.
   */
  function templates(craft) {
    var list = templateList();
    var built = [];
    var user = [];
    var defs = BUILTIN_TEMPLATES.concat(craftTemplateDefs());
    for (var i = 0; i < defs.length; i++) {
      var b = findTemplate(list, defs[i].id);
      if (b && built.indexOf(b) === -1) built.push(b);
    }
    for (var j = 0; j < list.length; j++) {
      if (!builtInDef(list[j].id)) user.push(list[j]);
    }
    user.sort(function (a, b2) {
      return a.name.toLowerCase() < b2.name.toLowerCase() ? -1 : a.name.toLowerCase() > b2.name.toLowerCase() ? 1 : 0;
    });
    var out = built.concat(user);
    var want = str(craft, '').trim();
    if (!want) return out;
    return out.filter(function (t) {
      return (t.craft || DEFAULT_CRAFT) === want;
    });
  }

  function template(id) {
    return findTemplate(templateList(), id);
  }

  /** Throws an Error with a human message when the template is not usable. */
  function validateTemplate(tpl) {
    if (!tpl || typeof tpl !== 'object') throw new Error('Nothing to save.');
    var name = str(tpl.name, '').trim();
    if (!name) throw new Error('Give the template a name.');
    var src = Array.isArray(tpl.parts) ? tpl.parts : [];
    var parts = [];
    for (var i = 0; i < src.length; i++) {
      var p = src[i] && typeof src[i] === 'object' ? src[i] : {};
      var pname = str(p.name, '').trim();
      if (!pname) throw new Error('Every part needs a name.');
      var mc = typeof p.makeCount === 'number' ? p.makeCount : parseInt(p.makeCount, 10);
      if (!isFinite(mc) || Math.floor(mc) < 1 || Math.floor(mc) > 99) {
        throw new Error('Make counts must be between 1 and 99.');
      }
      // No length limit on the pattern text — a whole part's instructions fit.
      parts.push({
        name: pname,
        makeCount: Math.floor(mc),
        patternText: str(p.patternText, ''),
        placementNotes: str(p.placementNotes, ''),
        workMode: normalizeWorkMode(p.workMode, 'auto'),
        orientation: normalizeOrientation(p.orientation, 'auto'),
        dialect: normalizeDialect(p.dialect, 'auto')
      });
      // wave G: the part's size group rides along
      var vg = normalizeGroupName(p.group);
      if (vg) parts[parts.length - 1].group = vg;
      // wave H: so do knitting markers and the two-at-a-time partner
      knitTemplatePart(parts[parts.length - 1], p);
    }
    if (!parts.length) throw new Error('Add at least one part.');
    var checklist = [];
    var cs = Array.isArray(tpl.checklist) ? tpl.checklist : [];
    for (var j = 0; j < cs.length; j++) {
      var c = str(cs[j], '').trim();
      if (c) checklist.push(c);
    }
    return { name: name, parts: parts, checklist: checklist };
  }

  /** Create (no id / unknown id) or update. Returns the stored template. */
  function saveTemplate(tpl) {
    var ok = validateTemplate(tpl);
    var list = templateList();
    var existing = tpl.id ? findTemplate(list, tpl.id) : null;
    // wave K: templates live in localStorage; a whole chart does not belong there
    if (tpl.craftData && typeof tpl.craftData === 'object') checkTemplateSize(tpl.craftData);
    var next = normalizeTemplate({
      id: existing ? existing.id : uid(),
      name: ok.name,
      emoji: tpl.emoji,
      countMode: tpl.countMode,
      groupSize: tpl.groupSize,
      parts: ok.parts,
      checklist: ok.checklist,
      craft: tpl.craft || (existing ? existing.craft : DEFAULT_CRAFT),
      craftData: tpl.craftData !== undefined ? tpl.craftData : existing ? existing.craftData : null,
      // wave F: size names + picked size (kept from the saved template when
      // the caller does not say)
      sizes: tpl.sizes !== undefined ? tpl.sizes : existing ? existing.sizes : undefined,
      size: tpl.size !== undefined ? tpl.size : existing ? existing.size : undefined,
      // wave G: the size groups' order (the parts say which exist)
      groups: tpl.groups !== undefined ? tpl.groups : existing ? existing.groups : undefined,
      // wave H: the pattern gauge (kept from the saved template when not said)
      gauge: tpl.gauge !== undefined ? tpl.gauge : existing ? existing.gauge : undefined,
      updatedAt: now()
    });
    if (existing) list[list.indexOf(existing)] = next;
    else list.push(next);
    save();
    return next;
  }

  /** User templates only — built-ins can be reset but never deleted. */
  function deleteTemplate(id) {
    var list = templateList();
    var t = findTemplate(list, id);
    if (!t || builtInDef(t.id)) return false;
    list.splice(list.indexOf(t), 1);
    save();
    return true;
  }

  /** Restore a built-in to its shipped values. */
  function resetTemplate(id) {
    var def = builtInDef(id);
    if (!def) return null;
    var list = templateList();
    var fresh = seedTemplate(def);
    var existing = findTemplate(list, id);
    if (existing) list[list.indexOf(existing)] = fresh;
    else list.push(fresh);
    save();
    return fresh;
  }

  /** An UNSAVED template drafted from a project (for "Save as template"). */
  /**
   * `opts.group` (wave G, "Make this size a template"): only that size's parts
   * (and any part shared by every size), as a plain one-size template.
   */
  function templateFromProject(projectId, opts) {
    var proj = project(projectId);
    if (!proj) return null;
    var only = opts && opts.group ? normalizeGroupName(opts.group) : null;
    if (only && !(proj.groups || []).some(function (g) { return g.name === only; })) only = null;
    var srcParts = only
      ? proj.parts.filter(function (p) { return !p.group || p.group === only; })
      : proj.parts;
    var draft = {
      id: '',
      name: (proj.name + (only ? ' (' + only + ')' : '') + ' template').trim(),
      emoji: proj.emoji,
      countMode: proj.countMode,
      groupSize: proj.groupSize,
      parts: srcParts.map(function (p) {
        var tp = {
          name: p.name,
          makeCount: p.makeCount,
          patternText: str(p.patternText, ''),
          placementNotes: str(p.placementNotes, ''),
          workMode: normalizeWorkMode(p.workMode, 'auto'),
          orientation: normalizeOrientation(p.orientation, 'auto'),
          dialect: normalizeDialect(p.dialect, 'auto')
        };
        // wave G: the size each part belongs to, unless one size was asked for
        if (!only && p.group) tp.group = p.group;
        // wave H: markers and the two-at-a-time partner (as an index)
        knitTemplatePartFromProject(tp, p, srcParts);
        return tp;
      }),
      checklist: proj.checklist
        .map(function (c) { return str(c.text, '').trim(); })
        .filter(function (t) { return !!t; }),
      craft: proj.craft || DEFAULT_CRAFT,
      craftData: null,
      builtIn: false,
      updatedAt: now()
    };
    // wave F: the leaflet's size names and the picked size travel too
    if (Array.isArray(proj.sizes) && proj.sizes.length >= 2) {
      draft.sizes = proj.sizes.slice();
      if (proj.size) draft.size = { index: proj.size.index, label: proj.size.label };
    }
    // wave G: every size, in order
    if (!only && proj.groups && proj.groups.length) {
      draft.groups = proj.groups.map(function (g) { return { name: g.name }; });
    }
    // wave H: the pattern gauge (never the swatch: that is this knitter's)
    var tg = templateGauge(proj.gauge);
    if (tg) draft.gauge = tg;
    // wave K: any craft's own seed (progress dropped) through its template hook
    return applyTemplateHook(draft, proj, opts);
  }

  /* ------------------------------------------------------------------ *
   * Factories + normalisation
   * ------------------------------------------------------------------ */

  function makePart(name, makeCount) {
    return {
      id: uid(),
      name: safeName(name, 'Main'),
      makeCount: clampInt(makeCount, 1, 99, 1),
      // Stable identity for a section imported from a PDF (13 #7). '' on any
      // part the user made by hand.
      importKey: '',
      piecesDone: 0,
      row: 0,
      stitch: 0,
      targetRows: null,
      repeat: { enabled: false, startRow: 1, endRow: 1, times: 1, mode: 'times', untilRows: null },
      alerts: [],
      placementNotes: '',
      patternText: '',
      sizeIndex: 0,
      // 3D diagram: rounds vs rows for THIS piece. 'auto' asks the pattern.
      workMode: 'auto',
      // 3D diagram: which way up THIS piece was worked. 'auto' asks the text.
      orientation: 'auto',
      // 3D diagram: UK or US stitch names for THIS piece. 'auto' asks this
      // piece's text, then whatever the imported document said.
      dialect: 'auto',
      // Live diagram: index = row number (1-based), value = stitches in that row.
      rowStitches: [0]
    };
  }

  /**
   * `rowStitches` is 1-based: slot 0 is a permanent placeholder so the array
   * index IS the row number. Holes (rows completed before this feature shipped,
   * or jumped over) normalise to 0 = "unknown".
   */
  function normalizeRowStitches(raw, rowCount) {
    var out = [0];
    if (!Array.isArray(raw)) return out;
    var max = Math.min(raw.length, DIAGRAM_MAX_ROUNDS * 4 + 1);
    for (var i = 1; i < max; i++) {
      out[i] = clampInt(raw[i], 0, 999999, 0);
    }
    // Nothing recorded beyond the rows actually completed.
    if (typeof rowCount === 'number' && out.length > rowCount + 1) out.length = rowCount + 1;
    return out;
  }

  /**
   * `Part.repeat`. Wave F (03 #6): `mode: 'times' | 'untilRows'`. A garment
   * says "Repeat Rows 5-8 until there are a total of 25 (29, 33 …) Rows"; in
   * 'untilRows' mode `times` is derived from `untilRows` (see repeatTimes), so
   * the intent survives and a size change re-derives it. Old saves are 'times'.
   */
  function normalizeRepeat(rep) {
    rep = rep && typeof rep === 'object' ? rep : {};
    var out = {
      enabled: !!rep.enabled,
      startRow: clampInt(rep.startRow, 1, 999999, 1),
      endRow: clampInt(rep.endRow, 1, 999999, 1),
      times: clampInt(rep.times, 1, 9999, 1),
      mode: rep.mode === 'untilRows' ? 'untilRows' : 'times',
      untilRows: rep.untilRows === null || rep.untilRows === undefined || rep.untilRows === ''
        ? null
        : clampInt(rep.untilRows, 1, 999999, 0) || null
    };
    if (out.mode === 'untilRows' && !out.untilRows) out.mode = 'times';
    // `times` is kept in step, so every reader of the plain field (the
    // repeat readout, the diagram's row mapping) needs no second rule.
    if (out.mode === 'untilRows') out.times = clampInt(repeatTimes(out), 1, 9999, 1);
    return out;
  }

  /**
   * How many times a repeat block runs. 'untilRows': as many whole blocks as
   * fit between its first row and the row total ("rows 5-8 until 25 rows" is
   * (25 - 5 + 1) / 4 = 5 blocks, rows 5-24; row 25 is the row after).
   */
  function repeatTimes(r) {
    if (!r) return 0;
    if (r.mode === 'untilRows' && r.untilRows > 0) {
      var len = r.endRow - r.startRow + 1;
      if (len <= 0) return 0;
      return Math.max(1, Math.floor((r.untilRows - r.startRow + 1) / len));
    }
    return r.times;
  }

  function normalizePart(p) {
    p = p && typeof p === 'object' ? p : {};
    var rep = p.repeat && typeof p.repeat === 'object' ? p.repeat : {};
    var alerts = [];
    if (Array.isArray(p.alerts)) {
      for (var i = 0; i < p.alerts.length; i++) {
        var n = clampInt(p.alerts[i], 1, 99999, 0);
        if (n > 0 && alerts.indexOf(n) === -1) alerts.push(n);
      }
      alerts.sort(function (a, b) { return a - b; });
    }
    var np = {
      id: str(p.id, '') || uid(),
      name: safeName(p.name, 'Main'),
      makeCount: clampInt(p.makeCount, 1, 99, 1),
      // v4 (13 #7): parts saved before import keys simply have none.
      importKey: str(p.importKey, ''),
      piecesDone: clampInt(p.piecesDone, 0, 99, 0),
      row: clampInt(p.row, 0, 999999, 0),
      stitch: clampInt(p.stitch, 0, 999999, 0),
      targetRows:
        p.targetRows === null || p.targetRows === undefined || p.targetRows === ''
          ? null
          : clampInt(p.targetRows, 1, 999999, 0) || null,
      repeat: normalizeRepeat(rep),
      alerts: alerts,
      placementNotes: str(p.placementNotes, ''),
      patternText: str(p.patternText, ''),
      // v2: parts saved before multi-size support simply get size 0.
      sizeIndex: clampInt(p.sizeIndex, 0, 99, 0),
      // v5 (3D wave A): parts saved before per-part rounds/rows ask the pattern.
      workMode: normalizeWorkMode(p.workMode, 'auto'),
      // v5 (3D wave C): ...and parts saved before the orientation hint ask the
      // pattern text. Additive with a default, so no backup migration is due.
      orientation: normalizeOrientation(p.orientation, 'auto'),
      // v5 (3D wave D): ...and parts saved before the dialect carry ask their
      // own text. Additive with a default, so no backup migration is due.
      dialect: normalizeDialect(p.dialect, 'auto'),
      // v3 (live diagram): saves from before it simply have nothing recorded.
      rowStitches: normalizeRowStitches(p.rowStitches, clampInt(p.row, 0, 999999, 0))
    };
    // Wave F: the importer made this part twice because the assembly text
    // attaches it in the plural (Patterns `makeCountInferred`). Present only
    // when true, and dropped once the owner sets the count by hand.
    if (p.makeCountInferred === true) np.makeCountInferred = true;
    // Wave G (size groups): the size of a multi-size booklet this part belongs
    // to ("Keyring" / "Medium" / "Big"), or null. Additive with a default, so
    // no backup migration is due.
    np.group = normalizeGroupName(p.group);
    return np;
  }

  /** A size group's name: trimmed, at most 60 characters, or null. */
  function normalizeGroupName(v) {
    if (v && typeof v === 'object') v = v.name;
    var s = str(v, '').replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, 60) : null;
  }

  /**
   * `Project.groups` (wave G): [{name}] in document order. Every group a part
   * names is listed (a save that lost the list gets it back from its parts),
   * and a group no part belongs to any more is dropped.
   */
  function normalizeGroups(raw, parts) {
    var out = [], seen = {};
    function push(n) {
      if (!n || seen[n]) return;
      seen[n] = true;
      out.push({ name: n });
    }
    if (Array.isArray(raw)) raw.forEach(function (g) { push(normalizeGroupName(g)); });
    (parts || []).forEach(function (p) { push(p && p.group); });
    return out.filter(function (g) {
      return (parts || []).some(function (p) { return p && p.group === g.name; });
    });
  }

  /** '#abc' / 'ABCDEF' / '#aabbcc' → '#aabbcc'. Anything else → null. */
  function normalizeHex(v) {
    var s = str(v, '').trim();
    if (!s) return null;
    if (s.charAt(0) === '#') s = s.slice(1);
    if (/^[0-9a-fA-F]{3}$/.test(s)) {
      s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    }
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return '#' + s.toLowerCase();
  }

  /** { [yarn name]: '#hex' } with '*' (the main yarn) always present. */
  function normalizeYarnColors(raw) {
    var out = {};
    if (raw && typeof raw === 'object') {
      var keys = Object.keys(raw);
      for (var i = 0; i < keys.length && i < 200; i++) {
        var name = str(keys[i], '').trim();
        if (!name) continue;
        var hex = normalizeHex(raw[keys[i]]);
        if (hex) out[name] = hex;
      }
    }
    if (!out[MAIN_YARN]) out[MAIN_YARN] = MAIN_YARN_DEFAULT;
    return out;
  }

  /** `Project.size`: { index, label } or null (wave F). */
  function normalizeProjectSize(v) {
    if (!v || typeof v !== 'object') return null;
    var idx = clampInt(v.index, 0, 99, -1);
    if (idx < 0) return null;
    return { index: idx, label: str(v.label, '').trim() || 'Size ' + (idx + 1) };
  }

  function normalizeProject(p) {
    p = p && typeof p === 'object' ? p : {};
    var parts = Array.isArray(p.parts) ? p.parts.map(normalizePart) : [];
    if (!parts.length) parts = [makePart('Main', 1)];

    var status = p.status;
    if (['active', 'paused', 'finished', 'frogged'].indexOf(status) === -1) status = 'active';

    var timer = p.timer && typeof p.timer === 'object' ? p.timer : {};
    var checklist = [];
    if (Array.isArray(p.checklist)) {
      for (var i = 0; i < p.checklist.length; i++) {
        var c = p.checklist[i];
        if (!c || typeof c !== 'object') continue;
        checklist.push({
          id: str(c.id, '') || uid(),
          text: str(c.text, ''),
          done: !!c.done
        });
      }
    }
    var history = [];
    if (Array.isArray(p.history)) {
      for (var j = 0; j < p.history.length; j++) {
        var h = p.history[j];
        if (!h || typeof h !== 'object') continue;
        var hOut = {
          ts: clampInt(h.ts, 0, 1e15, 0),
          partId: str(h.partId, ''),
          partName: str(h.partName, ''),
          row: clampInt(h.row, 0, 999999, 0)
        };
        // wave K (knit-store, P1): "I'm at the length" is a history entry of its own kind
        if (h.kind === 'stretchEnd') { hOut.kind = 'stretchEnd'; hOut.stretchRows = clampInt(h.stretchRows, 0, 9999, 0); }
        history.push(hOut);
      }
      if (history.length > HISTORY_CAP) history = history.slice(history.length - HISTORY_CAP);
    }

    var activePartId = str(p.activePartId, '');
    var found = false;
    for (var k = 0; k < parts.length; k++) if (parts[k].id === activePartId) found = true;
    if (!found) activePartId = parts[0].id;

    // Crafts: every save made before September 2026 is a crochet project.
    var craft = str(p.craft, '').trim() || DEFAULT_CRAFT;

    // Wave G: the sizes of a multi-size booklet, and the one on screen.
    var groups = normalizeGroups(p.groups, parts);
    var activeGroup = normalizeGroupName(p.activeGroup);
    if (!groups.some(function (g) { return g.name === activeGroup; })) {
      var ap = null;
      for (var q = 0; q < parts.length; q++) if (parts[q].id === activePartId) ap = parts[q];
      activeGroup = ap && ap.group ? ap.group : (groups.length ? groups[0].name : null);
    }

    // wave H (knit-counter): gauge, side, markers, links, short rows
    // wave K: heavy side table, activity, goals, step overlay (when present)
    return wkProjectOut(knitNormalizeProject({
      id: str(p.id, '') || uid(),
      name: safeName(p.name, 'Untitled project'),
      emoji: str(p.emoji, '') || '🧶',
      status: status,
      createdAt: clampInt(p.createdAt, 0, 1e15, 0) || now(),
      updatedAt: clampInt(p.updatedAt, 0, 1e15, 0) || now(),
      finishedAt: p.finishedAt ? clampInt(p.finishedAt, 0, 1e15, 0) : null,
      countMode: p.countMode === 'rounds' ? 'rounds' : 'rows',
      // 0 = grouping off
      groupSize: clampInt(p.groupSize, 0, 50, 10),
      notes: str(p.notes, ''),
      timer: {
        totalMs: clampInt(timer.totalMs, 0, 1e15, 0),
        runningSince: timer.runningSince ? clampInt(timer.runningSince, 0, 1e15, 0) : null
      },
      // Which template the project was created from (Templates v2). Old saves
      // have no idea, so they migrate to null.
      templateId: str(p.templateId, '') || null,
      parts: parts,
      activePartId: activePartId,
      checklist: checklist,
      history: history,
      // Live diagram yarn colours: name → '#hex', '*' = the main yarn.
      yarnColors: normalizeYarnColors(p.yarnColors),
      // Size names detected from a pasted pattern (e.g. ['XS','S','M']); shared by all parts.
      sizes: Array.isArray(p.sizes) && p.sizes.length
        ? p.sizes.map(function (x) { return str(x, ''); }).filter(Boolean)
        : null,
      // Wave F (size-once, 03 #1): the size the maker picked, once, for the
      // whole project. null = never asked (a single-size pattern, or a save
      // from before). Every part's `sizeIndex` follows it unless that part was
      // set on its own in the part editor. Additive with a default, so no
      // backup migration is due.
      size: normalizeProjectSize(p.size),
      // Crafts: 'crochet' | 'crossstitch' | 'sewing' | anything a module registers.
      craft: craft,
      // Opaque to the shell — owned by the craft module, repaired by its normalize.
      // Wave K: a project whose heavy fields live in IndexedDB is normalised
      // once they are loaded back (Store.whenReady), never half-way.
      craftData: wkCraftDataIn(craft, p),
      // Wave G (size groups): [{name}] in document order ([] when the pattern
      // has one size), and the group whose tab is open (null without groups).
      // Additive with a default, so no backup migration is due.
      groups: groups,
      activeGroup: activeGroup
    }, p), p);
  }

  function defaultState() {
    return {
      version: VERSION,
      // Multi-tab safety (13 #1): bumped on every write, stamped with the tab
      // that wrote it, so a `storage` event can tell "them" from "us".
      revision: 0,
      writerId: '',
      settings: {
        theme: 'stardew-night',
        haptics: true,
        sounds: true,
        keepAwake: false,
        autoAdvance: true,
        // The 3D piece inside the stitch button.
        liveDiagram: true,
        // Wave I (focus-mode): the ids of the projects whose full-screen
        // working mode was left open, so reopening one returns to it. A view
        // preference of this device: settings are never in an undo snapshot,
        // so an Undo can never close (or open) the mode.
        focusProjects: [],
        // Guided help: which tours have been completed, and whether the
        // first-run welcome card has been answered.
        toursSeen: [],
        welcomed: false,
        // Backup reminder (12 #1): when the last backup was taken, until when
        // the nag is snoozed, and the distinct days work happened on.
        lastBackupAt: 0,
        backupNagSnoozedUntil: 0,
        touchDays: [],
        // Whether navigator.storage.persist() has been granted (09 #4).
        persistGranted: false,
        // Per-craft settings shared across projects (body measurements, fabric
        // defaults…): { [craftId]: object }, opaque to the shell.
        crafts: {}
      },
      // Crochet's built-ins plus every built-in a craft module declared.
      templates: normalizeTemplates(null),
      projects: [],
      activeProjectId: null
    };
  }

  /** `Settings.crafts` — one opaque JSON object per craft id. */
  function normalizeCraftSettings(raw) {
    var out = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      var keys = Object.keys(raw);
      for (var i = 0; i < keys.length && i < 50; i++) {
        var id = str(keys[i], '').trim();
        if (!id) continue;
        var v = raw[keys[i]];
        if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
        // wave K: a craft that registered `settings.normalize` repairs its own bag
        out[id] = normalizeOneCraftSettings(id, v);
      }
    }
    return out;
  }

  /**
   * A list of 'YYYY-MM-DD' day stamps, newest last, capped. Nothing else in
   * the app reads it — it exists so `backupDue()` can say "you have worked on
   * five separate days since your last backup".
   */
  function normalizeTouchDays(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length; i++) {
      var d = str(raw[i], '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      if (out.indexOf(d) === -1) out.push(d);
    }
    out.sort();
    if (out.length > 60) out = out.slice(out.length - 60);
    return out;
  }

  /** Wave I: `settings.focusProjects` — distinct non-empty id strings, capped. */
  var FOCUS_PROJECTS_MAX = 200;
  function normalizeFocusProjects(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length && out.length < FOCUS_PROJECTS_MAX; i++) {
      var id = typeof raw[i] === 'string' ? raw[i].trim() : '';
      if (id && out.indexOf(id) === -1) out.push(id);
    }
    return out;
  }

  /* Everything the shell knows how to normalise. Anything else in a saved or
   * imported state is carried through verbatim (12 #2). */
  var KNOWN_STATE_KEYS = {
    version: 1, revision: 1, writerId: 1,
    settings: 1, templates: 1, projects: 1, activeProjectId: 1
  };

  function normalizeState(raw) {
    var d = defaultState();
    if (!raw || typeof raw !== 'object') return d;
    var s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    var out = {
      version: VERSION,
      revision: clampInt(raw.revision, 0, 1e12, 0),
      writerId: str(raw.writerId, ''),
      settings: {
        theme: str(s.theme, '') || d.settings.theme,
        haptics: s.haptics === undefined ? true : !!s.haptics,
        sounds: s.sounds === undefined ? true : !!s.sounds,
        keepAwake: !!s.keepAwake,
        autoAdvance: s.autoAdvance === undefined ? true : !!s.autoAdvance,
        // Old saves have no idea the diagram exists — they migrate to "on".
        liveDiagram: s.liveDiagram === undefined ? true : !!s.liveDiagram,
        // Wave I: old saves never had a working mode open.
        focusProjects: normalizeFocusProjects(s.focusProjects),
        // Old saves have neither — they migrate to "nothing seen, not welcomed".
        toursSeen: Array.isArray(s.toursSeen)
          ? s.toursSeen.filter(function (t) { return typeof t === 'string' && t; })
          : [],
        welcomed: !!s.welcomed,
        // Old saves have never taken a backup and have never been nagged.
        lastBackupAt: clampInt(s.lastBackupAt, 0, 1e15, 0),
        backupNagSnoozedUntil: clampInt(s.backupNagSnoozedUntil, 0, 1e15, 0),
        touchDays: normalizeTouchDays(s.touchDays),
        persistGranted: !!s.persistGranted,
        // Old saves have no craft settings at all.
        crafts: normalizeCraftSettings(s.crafts)
      },
      templates: normalizeTemplates(raw.templates),
      projects: Array.isArray(raw.projects) ? raw.projects.map(normalizeProject) : [],
      activeProjectId: str(raw.activeProjectId, '') || null
    };
    // Wave K: the maker's profile (measurements, units, stashes), present once used.
    if (s.profile && typeof s.profile === 'object' && !Array.isArray(s.profile)) {
      out.settings.profile = normalizeProfile(s.profile);
    }
    // Only one timer may run at a time. A span banked here comes from the wall
    // clock (the monotonic one does not survive a reload) so it is capped.
    var running = false;
    for (var i = 0; i < out.projects.length; i++) {
      var t = out.projects[i].timer;
      if (t.runningSince) {
        if (running) {
          t.totalMs += cappedSpan(now() - t.runningSince);
          t.runningSince = null;
        } else {
          running = true;
        }
      }
    }
    // Wave I: a working mode remembered for a project that is gone is dropped.
    out.settings.focusProjects = out.settings.focusProjects.filter(function (id) {
      return !!findProject(out.projects, id);
    });
    // Active project must exist.
    if (out.activeProjectId && !findProject(out.projects, out.activeProjectId)) {
      out.activeProjectId = null;
    }
    // A reader keeps what it does not understand rather than dropping it on the
    // next export (12 #2): unknown top-level keys survive load AND import.
    var keys = Object.keys(raw);
    for (var k = 0; k < keys.length && k < 200; k++) {
      var name = keys[k];
      if (KNOWN_STATE_KEYS[name]) continue;
      try {
        out[name] = JSON.parse(JSON.stringify(raw[name]));
      } catch (e) { /* not JSON-safe — it could not have come from a backup */ }
    }
    return out;
  }

  function findProject(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Persistence
   * ------------------------------------------------------------------ */

  function ls() {
    return window.localStorage;
  }

  function lsGet(key) {
    try { return ls().getItem(key); } catch (e) { return null; }
  }

  function lsRemove(key) {
    try { ls().removeItem(key); } catch (e) { /* ignore */ }
  }

  /**
   * Which kind of storage failure this is (13 #2). A write that fails for a
   * DIFFERENT key too is a browser that will not store anything at all —
   * Safari's private mode — and deserves a calmer message than "full".
   */
  function classifyStorageError(err) {
    var probe = KEY + '.__probe';
    try {
      ls().setItem(probe, 'x');
      ls().removeItem(probe);
    } catch (e) {
      return 'private';
    }
    var name = err && (err.name || '');
    var code = err && err.code;
    if (
      name === 'QuotaExceededError' ||
      name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      code === 22 || code === 1014
    ) {
      return 'quota';
    }
    return 'unknown';
  }

  function reportStorageError(kind, err) {
    saveFailedFlag = true;
    lastStorageError = { kind: kind, error: err || null, at: now() };
    emit(storageErrorSubs, { kind: kind, error: err || null });
  }

  /**
   * Boot probe (09 #2): can we write at all, are we in a private window, how
   * much of the origin's budget is already spent, and is there a quarantined
   * copy of unreadable data sitting there.
   */
  function storageHealth() {
    var out = { writable: false, privateMode: false, bytesUsed: 0, corruptKey: null };
    var probe = KEY + '.__probe';
    try {
      ls().setItem(probe, 'x');
      ls().removeItem(probe);
      out.writable = true;
    } catch (e) {
      out.writable = false;
    }
    var newestCorrupt = '';
    try {
      var store = ls();
      for (var i = 0; i < store.length; i++) {
        var k = store.key(i);
        if (k === null) continue;
        var v = store.getItem(k);
        // UTF-16 code units; the browsers that meter localStorage meter these.
        out.bytesUsed += k.length + (v === null ? 0 : v.length);
        if (k.indexOf(KEY + '.corrupt.') === 0 && k > newestCorrupt) newestCorrupt = k;
      }
    } catch (e) { /* a storage we cannot even enumerate reports 0 */ }
    // Safari private mode: writes throw and there is nothing stored at all.
    out.privateMode = !out.writable && out.bytesUsed === 0;
    out.corruptKey = corruptKeyName || newestCorrupt || null;
    return out;
  }

  /**
   * Pre-flight for the import paths (09 #2): would another `extraBytes` fit?
   * Answered by actually trying, because every browser's budget differs.
   */
  function wouldExceedQuota(extraBytes) {
    var n = clampInt(extraBytes, 0, 1e9, 0);
    if (!n) return false;
    // Building a >5 MB probe string costs more than the answer is worth, and
    // nothing that big belongs in localStorage anyway.
    if (n > 5 * 1024 * 1024) return true;
    var probe = KEY + '.__quotaprobe';
    try {
      ls().setItem(probe, new Array(n + 1).join('x'));
      lsRemove(probe);
      return false;
    } catch (e) {
      lsRemove(probe);
      return true;
    }
  }

  /**
   * Put the unreadable text somewhere the user can still get at it (13 #3),
   * and refuse to write over the main key until they have been told.
   */
  function quarantine(txt) {
    corruptFlag = true;
    corruptText = txt;
    var base = KEY + '.corrupt.' + now();
    var name = base;
    var n = 1;
    try {
      while (ls().getItem(name) !== null && n < 50) name = base + '.' + n++;
      ls().setItem(name, txt);
      corruptKeyName = name;
    } catch (e) {
      // No room for the copy — the ORIGINAL is still under KEY and we are
      // about to refuse to overwrite it, so nothing is lost either way.
      corruptKeyName = null;
      reportStorageError(classifyStorageError(e), e);
    }
  }

  function load() {
    var raw = null;
    var txt = null;
    var bad = false;

    if (!WRITER_ID) WRITER_ID = uid();
    corruptFlag = false;
    corruptText = null;
    corruptKeyName = null;
    conflictFlag = false;
    conflictDetail = null;
    saveFailedFlag = false;
    lastStorageError = null;
    dirty = false;
    runningSpan = null;

    try {
      txt = ls().getItem(KEY);
    } catch (e) {
      txt = null;
    }
    if (typeof txt === 'string' && txt.replace(/\s/g, '')) {
      try {
        raw = JSON.parse(txt);
      } catch (e) {
        bad = true;
      }
      // Valid JSON that is not a state object is corruption too — normalising
      // it would hand back a pristine empty app and the next save would erase
      // whatever was really there.
      if (!bad && (!raw || typeof raw !== 'object' || Array.isArray(raw))) bad = true;
      if (!bad) {
        try {
          state = normalizeState(raw);
        } catch (e) {
          bad = true;
        }
      }
    }

    if (bad) {
      quarantine(txt);
      state = normalizeState(null);
    } else if (!state || raw === null) {
      state = normalizeState(raw);
    }
    // wave K: side tables into the runtime; nothing heavy is loaded yet
    hv = Object.create(null);
    heavyIngest(state.projects, null);

    lineCache = Object.create(null);
    diagramCache = Object.create(null);
    return state;
  }

  /**
   * @returns {{ok:boolean, kind:string|null, error:Error|null, retried:boolean, blocked:string|null}}
   */
  function writeNow() {
    saveTimer = null;
    if (!state) return { ok: false, kind: null, error: null, retried: false, blocked: 'nostate' };
    // Refuse to destroy data we could not read (13 #3) or to stamp on a tab
    // that has moved underneath us (13 #1).
    if (corruptFlag) return { ok: false, kind: null, error: null, retried: false, blocked: 'corrupt' };
    if (conflictFlag) return { ok: false, kind: null, error: null, retried: false, blocked: 'conflict' };

    state.revision = clampInt(state.revision, 0, 1e12, 0) + 1;
    state.writerId = WRITER_ID;

    var text;
    try {
      // wave K: byte for byte JSON.stringify(state) unless heavy craft data is in play
      text = serializeState();
    } catch (e) {
      reportStorageError('unknown', e);
      return { ok: false, kind: 'unknown', error: e, retried: false, blocked: null };
    }

    try {
      ls().setItem(KEY, text);
      saveFailedFlag = false;
      lastStorageError = null;
      dirty = false;
      heavyAfterWrite(text);
      return { ok: true, kind: null, error: null, retried: false, blocked: null };
    } catch (e) {
      // One second chance with the in-memory undo stack gone: it frees heap,
      // and on a browser that counts the whole origin it can free bytes too.
      clearUndo();
      try {
        ls().setItem(KEY, text);
        saveFailedFlag = false;
        lastStorageError = null;
        dirty = false;
        heavyAfterWrite(text);
        return { ok: true, kind: null, error: null, retried: true, blocked: null };
      } catch (e2) {
        var kind = classifyStorageError(e2);
        // wave K: a full localStorage first tries to move opted-in craft data
        // to IndexedDB; the commit asks for another save when it lands
        var rescuing = kind === 'quota' && heavyRescue();
        reportStorageError(kind, e2);
        return { ok: false, kind: kind, error: e2, retried: true, blocked: null, rescuing: !!rescuing };
      }
    }
  }

  function save() {
    dirty = true;
    // While a conflict is unresolved nothing auto-saves; the shell must call
    // resolveConflict() first.
    if (conflictFlag || corruptFlag) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(writeNow, SAVE_DEBOUNCE);
  }

  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    return writeNow();
  }

  /* touch() is on the tap path, so the day stamp is worked out at most once a
   * minute rather than once a tap. */
  var dayCache = { at: 0, key: '' };
  function dayKeyNow() {
    var t = now();
    if (dayCache.key && t - dayCache.at >= 0 && t - dayCache.at < 60000) return dayCache.key;
    dayCache.at = t;
    dayCache.key = dayKey(t);
    return dayCache.key;
  }

  /** Remember that work happened today (12 #1). Cheap: one string compare. */
  function markTouchDay() {
    var s = state && state.settings;
    if (!s) return;
    if (!Array.isArray(s.touchDays)) s.touchDays = [];
    var d = dayKeyNow();
    if (s.touchDays[s.touchDays.length - 1] === d) return;
    if (s.touchDays.indexOf(d) === -1) s.touchDays.push(d);
    if (s.touchDays.length > 60) s.touchDays.splice(0, s.touchDays.length - 60);
  }

  function touch(project) {
    if (project) project.updatedAt = now();
    markTouchDay();
    save();
  }

  /* ---- corrupt state (13 #3) ----------------------------------------- */

  function isCorrupt() { return corruptFlag; }
  function corruptSnapshot() { return corruptFlag ? corruptText : null; }
  function corruptKey() { return corruptKeyName; }

  /** The user has been shown the copy — writing may resume. */
  function acknowledgeCorrupt() {
    if (!corruptFlag) return false;
    corruptFlag = false;
    corruptText = null;
    save();
    return true;
  }

  /* ---- save failure (13 #2) ------------------------------------------- */

  function saveFailed() { return saveFailedFlag; }
  function lastSaveError() { return lastStorageError; }
  function onStorageError(fn) { return subscribe(storageErrorSubs, fn); }

  /* ---- multi-tab (13 #1) ---------------------------------------------- */

  function revision() { return state ? clampInt(state.revision, 0, 1e12, 0) : 0; }
  function writerId() { return WRITER_ID; }
  function conflict() { return conflictFlag; }
  function conflictInfo() { return conflictDetail; }
  function onConflict(fn) { return subscribe(conflictSubs, fn); }
  function onExternalChange(fn) { return subscribe(externalSubs, fn); }

  function adoptForeign(raw) {
    var prevProjects = state && state.projects;
    state = normalizeState(raw);
    // wave K: keep heavy values already loaded when their table did not move
    heavyIngest(state.projects, prevProjects);
    lineCache = Object.create(null);
    diagramCache = Object.create(null);
    dirty = false;
    runningSpan = null;
  }

  /**
   * Another tab (or another window of the same PWA) wrote our key. With
   * nothing of our own in flight we simply take their state; with unsaved
   * work we stop saving and hand the decision to the shell.
   */
  function handleStorageEvent(e) {
    if (!e || e.key !== KEY) return;
    if (!state) return;
    if (e.newValue === null || e.newValue === undefined) return;
    var raw;
    try {
      raw = JSON.parse(e.newValue);
    } catch (err) {
      return; // someone else wrote rubbish; our copy in memory is still good
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    if (str(raw.writerId, '') === WRITER_ID) return; // our own write, echoed
    if (conflictFlag) return; // already flagged; the first one wins

    var theirs = clampInt(raw.revision, 0, 1e12, 0);
    var mine = clampInt(state.revision, 0, 1e12, 0);

    if (!dirty && !saveTimer) {
      adoptForeign(raw);
      emit(externalSubs, { revision: theirs, writerId: str(raw.writerId, '') });
      return;
    }

    conflictFlag = true;
    conflictDetail = { mine: mine, theirs: theirs, writerId: str(raw.writerId, ''), theirState: raw };
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    emit(conflictSubs, { mine: mine, theirs: theirs, writerId: conflictDetail.writerId });
  }

  /**
   * 'keepMine'    — our state wins; it is written over theirs immediately.
   * 'takeTheirs'  — their state wins; ours is dropped, and so is the undo
   *                 stack, whose snapshots belong to projects that are gone.
   * @returns {boolean} whether anything was resolved
   */
  function resolveConflict(how) {
    if (!conflictFlag) return false;
    var detail = conflictDetail;
    conflictFlag = false;
    conflictDetail = null;
    if (how === 'takeTheirs') {
      var raw = detail && detail.theirState;
      if (!raw) {
        load();
      } else {
        adoptForeign(raw);
      }
      clearUndo();
      emit(externalSubs, { revision: revision(), writerId: (detail && detail.writerId) || '' });
      return true;
    }
    // keepMine (the default): jump past their revision so the next storage
    // event in the OTHER tab is unambiguous, then write.
    if (detail && state) {
      state.revision = Math.max(clampInt(state.revision, 0, 1e12, 0), detail.theirs);
    }
    dirty = true;
    flush();
    return true;
  }

  try {
    if (window.addEventListener) window.addEventListener('storage', handleStorageEvent, false);
  } catch (e) { /* no window events — the app still works, single-tab */ }

  /* ---- persistent storage (09 #4 / 12 #1) ----------------------------- */

  /** @returns {Promise<boolean>} — resolves false wherever it is unavailable. */
  function requestPersist() {
    function done(granted) {
      var ok = !!granted;
      try {
        if (state && state.settings && state.settings.persistGranted !== ok) {
          state.settings.persistGranted = ok;
          save();
        }
      } catch (e) { /* ignore */ }
      return ok;
    }
    try {
      var nav = window.navigator;
      if (nav && nav.storage && typeof nav.storage.persist === 'function' && window.Promise) {
        return window.Promise.resolve(nav.storage.persist()).then(done, function () { return done(false); });
      }
    } catch (e) { /* fall through */ }
    return window.Promise ? window.Promise.resolve(false) : { then: function (f) { f(false); } };
  }

  /* ---- backup reminder (12 #1) ---------------------------------------- */

  /**
   * How many separate days work has happened on since the last backup.
   * Days are local calendar days, recorded by touch().
   */
  function daysSinceBackup() {
    var s = settings();
    var last = clampInt(s.lastBackupAt, 0, 1e15, 0);
    var since = last ? dayKey(last) : '';
    var days = Array.isArray(s.touchDays) ? s.touchDays : [];
    var n = 0;
    for (var i = 0; i < days.length; i++) {
      if (!since || days[i] > since) n++;
    }
    return n;
  }

  /** True when it is fair to ask for a backup (5+ working days, not snoozed). */
  function backupDue() {
    var s = settings();
    if (!projects().length) return false;
    if (clampInt(s.backupNagSnoozedUntil, 0, 1e15, 0) > now()) return false;
    return daysSinceBackup() >= 5;
  }

  function backupStatus() {
    var s = settings();
    return {
      due: backupDue(),
      days: daysSinceBackup(),
      lastBackupAt: clampInt(s.lastBackupAt, 0, 1e15, 0),
      snoozedUntil: clampInt(s.backupNagSnoozedUntil, 0, 1e15, 0),
      persistGranted: !!s.persistGranted
    };
  }

  /** "Not now" — default 14 days, per 12 #1. */
  function snoozeBackupNag(days) {
    var n = clampInt(days, 1, 365, 14);
    settings().backupNagSnoozedUntil = now() + n * 86400000;
    save();
    return settings().backupNagSnoozedUntil;
  }

  /* ------------------------------------------------------------------ *
   * Lookup helpers
   * ------------------------------------------------------------------ */

  function getState() {
    if (!state) load();
    return state;
  }

  function settings() {
    return getState().settings;
  }

  /**
   * The (always-present) settings bag for one craft. Opaque to the shell;
   * mutating the returned object directly is fine as long as you then save().
   */
  function craftSettings(craftId) {
    var id = str(craftId, '').trim();
    if (!id) return {};
    var s = settings();
    if (!s.crafts || typeof s.crafts !== 'object' || Array.isArray(s.crafts)) s.crafts = {};
    if (!s.crafts[id] || typeof s.crafts[id] !== 'object' || Array.isArray(s.crafts[id])) {
      s.crafts[id] = {};
    }
    // wave K: the craft's registered defaults fill whatever the bag lacks
    var dflt = craftDefaults(id);
    if (dflt) {
      for (var k in dflt) {
        if (Object.prototype.hasOwnProperty.call(dflt, k) && !(k in s.crafts[id])) {
          s.crafts[id][k] = jsonValue(dflt[k]);
        }
      }
    }
    return s.crafts[id];
  }

  function setCraftSetting(craftId, key, value) {
    var bag = craftSettings(craftId);
    var k = str(key, '');
    if (!k) return bag;
    bag[k] = value;
    save();
    return bag;
  }

  function setSetting(key, value) {
    var s = settings();
    if (!(key in s)) return;
    s[key] = value;
    save();
  }

  /**
   * Wave I (focus-mode): was the full-screen working mode left open on this
   * project? A device preference kept in `settings.focusProjects`, not on the
   * project, so it is in no undo snapshot and never moves `updatedAt`.
   * @returns {boolean}
   */
  function focusMode(projectId) {
    var id = str(projectId, '').trim();
    if (!id) return false;
    var list = settings().focusProjects;
    return Array.isArray(list) && list.indexOf(id) !== -1;
  }

  /**
   * Remember (or forget) the working mode for one project. No undo step.
   * Refuses an id that names no project.
   * @returns {boolean} whether the stored value is now `on`
   */
  function setFocusMode(projectId, on) {
    var id = str(projectId, '').trim();
    if (!id || !project(id)) return false;
    var s = settings();
    var list = normalizeFocusProjects(s.focusProjects);
    var at = list.indexOf(id);
    if (on && at === -1) {
      list.push(id);
      // the oldest remembered project gives way past the cap
      if (list.length > FOCUS_PROJECTS_MAX) list.splice(0, list.length - FOCUS_PROJECTS_MAX);
    } else if (!on && at !== -1) {
      list.splice(at, 1);
    }
    s.focusProjects = list;
    save();
    return focusMode(id) === !!on;
  }

  function projects() {
    return getState().projects;
  }

  function project(id) {
    if (!id) return null;
    return findProject(projects(), id);
  }

  function part(proj, partId) {
    if (!proj) return null;
    for (var i = 0; i < proj.parts.length; i++) {
      if (proj.parts[i].id === partId) return proj.parts[i];
    }
    return null;
  }

  function activePart(proj) {
    if (!proj) return null;
    return part(proj, proj.activePartId) || proj.parts[0] || null;
  }

  /* ------------------------------------------------------------------ *
   * Undo stack (in memory only)
   * ------------------------------------------------------------------ */

  /**
   * The undo stack is bounded twice (09 #9): by entry count, and by the
   * serialised size of what it holds — 50 crochet snapshots are 275 KB, but
   * 50 snapshots of a 500x500 cross-stitch chart are tens of megabytes of
   * heap that never shrinks. One entry always survives, so even a project
   * bigger than the whole budget stays undoable once.
   */
  function trimUndo() {
    while (undoStack.length > UNDO_CAP) {
      undoBytesTotal -= undoStack.shift().bytes || 0;
    }
    while (undoStack.length > 1 && undoBytesTotal > UNDO_BYTE_CAP) {
      undoBytesTotal -= undoStack.shift().bytes || 0;
    }
    if (undoBytesTotal < 0) undoBytesTotal = 0;
  }

  function snapshot(proj) {
    if (!proj) return;
    var list = projects();
    // Wave K: one stringify serves as both the copy and its size (it used to
    // be done twice), and an opted-in craft's heavy fields are shared or
    // diffed instead of copied (docs/wave-k/api/shell-data.md §4).
    var D = heavyDef(proj.craft);
    var ready = isHeavyReady(proj);
    var text, heavy = null;
    if (D && ready) {
      var hs = heavySnapshot(proj, D);
      text = hs.text;
      heavy = hs.heavy;
    } else {
      text = JSON.stringify(proj);
    }
    var data = JSON.parse(text);
    var bytes = text.length;
    var entry = {
      id: proj.id,
      index: list.indexOf(proj),
      data: data,
      bytes: bytes,
      activeProjectId: getState().activeProjectId
    };
    if (heavy) { entry.heavy = heavy; entry.heavyBytes = 0; }
    if (!ready) entry.notReady = true;
    undoStack.push(entry);
    undoBytesTotal += bytes;
    trimUndo();
  }

  /** The serialised size of everything the undo stack is holding on to. */
  function undoBytes() {
    return undoBytesTotal;
  }

  function canUndo() {
    return undoStack.length > 0;
  }

  function undo() {
    var entry = undoStack.pop();
    if (!entry) return false;
    undoBytesTotal -= entry.bytes || 0;
    if (undoBytesTotal < 0) undoBytesTotal = 0;
    var list = projects();
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === entry.id) idx = i;
    // wave K: heavy slots come back from the shared value or a checked diff;
    // a diff that no longer fits what is live refuses rather than guessing
    if (entry.heavy) {
      var restored = heavyRestore(entry, idx >= 0 ? list[idx] : null);
      if (!restored) {
        dropUndoFor(entry.id);
        return false;
      }
    }
    if (entry.notReady && hv[entry.id] && hv[entry.id].table) {
      // taken before its heavy fields were loaded: they load again from disk
      hv[entry.id].state = 'unloaded';
      hv[entry.id].durableText = null;
    }
    if (idx >= 0) {
      list[idx] = entry.data;
    } else {
      var at = entry.index;
      if (at < 0 || at > list.length) at = list.length;
      list.splice(at, 0, entry.data);
    }
    if (entry.activeProjectId !== undefined) {
      getState().activeProjectId = entry.activeProjectId;
    }
    lineCache = Object.create(null);
    diagramCache = Object.create(null);
    save();
    return true;
  }

  function clearUndo() {
    undoStack.length = 0;
    undoBytesTotal = 0;
  }

  /* ------------------------------------------------------------------ *
   * Pattern bridge (defensive — the parser may be missing)
   *
   * Wave H: one parser per craft. Crochet (and any craft that never
   * registered one) reads its text through `window.Patterns`; a counter craft
   * registers its own with `registerCraftParser('knitting', 'Knits')` — the
   * api object itself, or the name of its window global, looked up on every
   * call so script order never matters. A registered parser whose global is
   * missing resolves to null: that craft's parts get no parse at all (a plain
   * counter), never crochet's reading of knitting text.
   * ------------------------------------------------------------------ */

  var craftParsers = Object.create(null);   // craftId -> api object | global name
  var craftParserExtras = Object.create(null); // craftId -> { checklistStart, checklistSections }
  var partProjectMemo = Object.create(null); // partId -> project (verified on every read)

  /**
   * @param {string} craftId
   * @param {Object|string|null} api  the parser (same names as window.Patterns),
   *   the name of its window global, or null to unregister
   * @param {{checklistStart?:RegExp, checklistSections?:RegExp}} [extras]
   *   the craft's own "this line is a finishing step" verbs and section names
   *   for `suggestChecklist`
   * @returns {boolean}
   */
  function registerCraftParser(craftId, api, extras) {
    var id = str(craftId, '').trim();
    // crochet IS window.Patterns; it cannot be re-pointed
    if (!id || id === DEFAULT_CRAFT) return false;
    if (api === null) {
      delete craftParsers[id];
      delete craftParserExtras[id];
    } else if ((typeof api === 'string' && api.trim()) || (api && typeof api === 'object')) {
      craftParsers[id] = typeof api === 'string' ? api.trim() : api;
      var ex = {};
      if (extras && extras.checklistStart instanceof RegExp) ex.checklistStart = extras.checklistStart;
      if (extras && extras.checklistSections instanceof RegExp) ex.checklistSections = extras.checklistSections;
      craftParserExtras[id] = ex;
    } else {
      return false;
    }
    // every cached parse may have been read by the old parser
    lineCache = Object.create(null);
    diagramCache = Object.create(null);
    return true;
  }

  function resolveParser(entry) {
    var api = typeof entry === 'string' ? window[entry] : entry;
    return api && typeof api === 'object' ? api : null;
  }

  /**
   * The craft a project, part, probe part or craft id is read as. A part
   * names no craft of its own, so it is the craft of the project holding it
   * (a probe part from the import preview may carry `craft` itself). Never
   * loads the state just to answer.
   */
  function craftKeyOf(ctx) {
    if (!ctx) return DEFAULT_CRAFT;
    if (typeof ctx === 'string') return ctx.trim() || DEFAULT_CRAFT;
    if (typeof ctx !== 'object') return DEFAULT_CRAFT;
    if (typeof ctx.craft === 'string' && ctx.craft.trim()) return ctx.craft.trim();
    if (Array.isArray(ctx.parts)) return DEFAULT_CRAFT;   // a project with no craft
    if (!ctx.id) return DEFAULT_CRAFT;
    // The memo is keyed on the part OBJECT: a binding from bindPartProject
    // (the project a caller handed in wins) or an earlier lookup.
    var m = partProjectMemo[ctx.id];
    if (m && m.part === ctx) return m.craft;
    if (!state || !Array.isArray(state.projects)) return DEFAULT_CRAFT;
    var proj = projectOfPart(ctx);
    if (!proj) return DEFAULT_CRAFT;   // not remembered: it may join a project yet
    var craft = typeof proj.craft === 'string' && proj.craft.trim() ? proj.craft.trim() : DEFAULT_CRAFT;
    partProjectMemo[ctx.id] = { part: ctx, craft: craft };
    return craft;
  }

  /**
   * A caller that names the project (`diagramModel(part, project)`) decides
   * the craft of a part with none of its own, for EVERY read of that part —
   * parse, row index and expand alike — so it can never be parsed as one
   * craft and expanded as another. A part's own `craft` still wins.
   */
  function bindPartProject(prt, proj) {
    if (!prt || typeof prt !== 'object' || !prt.id || !proj || typeof proj !== 'object') return;
    if (typeof prt.craft === 'string' && prt.craft.trim()) return;
    partProjectMemo[prt.id] = { part: prt, craft: craftKeyOf(proj) };
  }

  /**
   * The parser for a project, a part, a probe part or a craft id: the craft's
   * registered parser, else `window.Patterns` (crochet, and any craft that
   * registered none). Null when it is not loaded.
   */
  function parserFor(ctx) {
    var craft = craftKeyOf(ctx);
    if (craft !== DEFAULT_CRAFT && craftParsers[craft] !== undefined) return resolveParser(craftParsers[craft]);
    return resolveParser('Patterns');
  }

  function patternsApi(ctx) {
    return parserFor(ctx);
  }

  function sizeIndexOf(prt) {
    return prt && typeof prt.sizeIndex === 'number' && prt.sizeIndex > 0 ? Math.floor(prt.sizeIndex) : 0;
  }

  /**
   * How many sizes the document names, for `Patterns.parse({sizeCount})`: the
   * project's `sizes` (a probe part may carry its own `sizeCount`). 0 when the
   * names were never found, which keeps the old reading.
   */
  function partSizeCount(prt) {
    if (!prt) return 0;
    if (typeof prt.sizeCount === 'number') return prt.sizeCount >= 2 ? Math.floor(prt.sizeCount) : 0;
    var proj = projectOfPart(prt);
    return proj && Array.isArray(proj.sizes) && proj.sizes.length >= 2 ? proj.sizes.length : 0;
  }

  var EMPTY_ENTRY = { text: '', length: 0, size: 0, lines: [], version: 0, index: null };

  /**
   * wave H (knit-qa-2): the size names a text declares — the parser's
   * `detectSizes`, else the `Sizes: a, b, c` line the knitting reader puts on
   * top of every part it splits off (which its own detector does not read
   * back when the names are "2 yrs, 4 yrs …"). null when fewer than two.
   */
  var CARRIED_SIZES_RE = /^\s*sizes\s*:\s*([^\n]+)$/im;

  function knitSizesFromText(api, text) {
    var own = null;
    if (api && typeof api.detectSizes === 'function' && text) {
      try { own = api.detectSizes(text); } catch (e) { own = null; }
    }
    if (Array.isArray(own) && own.length >= 2) return own.map(String);
    var m = CARRIED_SIZES_RE.exec(str(text, ''));
    if (m && m[1].indexOf(',') >= 0) {
      var names = m[1].split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s && s.length <= 24; });
      if (names.length >= 2 && names.length <= 20) return names;
    }
    return null;
  }

  function sizesOfText(text, craft) {
    var c = craftKeyOf(craft);
    if (c === DEFAULT_CRAFT) return null;
    return knitSizesFromText(patternsApi(c), str(text, ''));
  }

  /**
   * wave H (knit-qa): the size names a counter-craft part is read at — its own
   * text's when it names two or more (an ebook pattern's "Sizes:" line), else
   * the project's (a probe part's `sizeCount` stands for its project). `count`
   * is how many (0 = none known).
   */
  function knitPartSizes(prt, api, text) {
    var own = knitSizesFromText(api, text);
    if (Array.isArray(own) && own.length >= 2) return { names: own.map(String), count: own.length, own: true };
    var proj = prt && typeof prt.sizeCount !== 'number' ? projectOfPart(prt) : null;
    if (proj && Array.isArray(proj.sizes) && proj.sizes.length >= 2) {
      return { names: proj.sizes.map(String), count: proj.sizes.length, own: false };
    }
    return { names: null, count: 0, own: false };
  }

  /**
   * The per-part parsed-pattern cache: `{ text, length, size, lines, version,
   * index }`.
   *
   * The cache key is the text itself, compared by reference (`===` on the same
   * string is a pointer test), and NEVER rebuilt. The old key was
   * `size + ' ' + text`, i.e. a fresh 54 KB concatenation plus a full compare on
   * every call, which is where a 1,500-row `buildDiagramModel` spent 312 of its
   * 434 ms (03-model-builder finding 2 — HANDOFF 12 blamed `Patterns.lineFor`,
   * which costs 0.004 ms).
   *
   * `version` is an incrementing id for "this parse", so the diagram cache can
   * key off the pattern text without touching the text at all.
   */
  function partLines(prt) {
    if (!prt) return EMPTY_ENTRY;
    var text = prt.patternText || '';
    var size = sizeIndexOf(prt);
    // wave H: the craft (and the parser it resolves to) is part of the key
    var craft = craftKeyOf(prt);
    var api = patternsApi(craft);
    var cached = lineCache[prt.id];
    // wave H (knit-qa): the parser's own `version` is part of the key, so a
    // reader that changed under a live page never answers from a stale parse
    var apiVersion = api && api.version !== undefined ? String(api.version) : '';
    if (cached && cached.craft === craft && cached.api === api && cached.apiVersion === apiVersion &&
        cached.size === size && cached.length === text.length && cached.text === text &&
        (typeof prt.sizeCount !== 'number' || cached.sizeCountAsked === (prt.sizeCount >= 2 ? Math.floor(prt.sizeCount) : 0))) {
      // wave K (knit-store, P1): a knitting part in stretch phases reads its
      // rows renumbered from where each stretch ended (crochet: untouched)
      return craft === 'knitting' ? knitPhased(prt, cached) : cached;
    }
    var lines = [];
    // Wave F: how many sizes the DOCUMENT names (`Project.sizes`), so a list
    // of another length resolves to no count instead of the clamp's guess.
    // Read on a miss only; setProjectSize / the importer drop the entries.
    var askedN = text ? partSizeCount(prt) : 0;
    var sizeN = askedN;
    // wave H (knit-qa): a counter craft's parser also gets the size NAMES
    // (`opts.sizes`), so "Sizes XL, 2/3XL and 4/5XL only:" maps to the right
    // sizes. A part whose own text names its sizes (an ebook pattern carries
    // its own "Sizes: 6 (7¼, 7¾)" line) reads at those, not at the project's
    // (the first pattern's): a six-size sock read with a three-size count
    // resolved every list in it to no count at all.
    var docSizes = null;
    if (craft !== DEFAULT_CRAFT && /\S/.test(text)) {
      var ps = knitPartSizes(prt, api, text);
      docSizes = ps.names;
      if (ps.count) sizeN = ps.count;
    }
    if (/\S/.test(text)) {
      if (api && typeof api.parse === 'function') {
        try {
          var popts = { size: size, sizeCount: sizeN };
          if (docSizes) popts.sizes = docSizes.slice();
          var out = api.parse(text, popts);
          if (Array.isArray(out)) lines = out;
        } catch (e) {
          lines = [];
        }
      }
    }
    var entry = {
      text: text,
      length: text.length,
      size: size,
      craft: craft,
      api: api,
      apiVersion: apiVersion,
      sizeCountAsked: askedN,
      sizeCount: sizeN,
      lines: lines,
      version: ++lineVersion,
      index: null
    };
    lineCache[prt.id] = entry;
    return craft === 'knitting' ? knitPhased(prt, entry) : entry;   // wave K (P1)
  }

  function linesFor(prt) {
    return partLines(prt).lines;
  }

  /** `Line.count` as `Patterns.targetFor` reads it: no v1 `stitches` fallback. */
  function strictCount(line) {
    if (!line) return null;
    return typeof line.count === 'number' && isFinite(line.count) ? line.count : null;
  }

  /**
   * The count a line publishes for ONE row of its range — `Patterns.countAt`'s
   * rule, which `Patterns.targetFor` reads through. A back-referencing range
   * grows or shrinks row by row and prints its total on the LAST row only
   * ("Row 6-55: Repeat rows 4 & 5 <57 sts>" is 9 at row 6 and 57 at row 55), so
   * `line.count` on its own freezes the whole shawl at its finished width.
   */
  function countAtRow(line, row) {
    if (!line) return null;
    // wave H (knit-qa): a repeat line's per-row `counts` start at its own
    // `countsFrom` (the first row it adds), not at `row`
    if (line.counts && line.countsFrom >= 1) {
      var cf = line.counts[row - line.countsFrom];
      if (typeof cf === 'number' && isFinite(cf)) return cf;
    } else if (line.counts && line.row >= 1) {
      var c = line.counts[row - line.row];
      if (typeof c === 'number' && isFinite(c)) return c;
    }
    return strictCount(line);
  }

  /**
   * row -> line / row -> count, built once per parse instead of scanning every
   * line for every row. Resolution order is `Patterns.lineFor`'s, to the letter:
   * the first line of section 0 that covers the row, then the first line of any
   * section. `count` is resolved separately because a section-0 line WITHOUT a
   * count does not shadow a later line that has one, and it is read PER ROW so a
   * growing range keeps its shape (`countAtRow`).
   */
  function buildRowIndex(lines, upTo, knit) {
    var line = [];
    var count = [];
    var pass, i, l, r, end, c, per, cr;
    for (pass = 0; pass < 2; pass++) {
      for (i = 0; i < lines.length; i++) {
        l = lines[i];
        if (!l || typeof l.row !== 'number' || !isFinite(l.row) || l.row < 1) continue;
        if (pass === 0 && l.section !== 0) continue;
        end = typeof l.rowEnd === 'number' && isFinite(l.rowEnd) && l.rowEnd > l.row ? l.rowEnd : l.row;
        if (end > upTo) end = upTo;
        if (l.row > upTo) continue;
        // One count for the whole line is the common case and stays hoisted;
        // only a line with per-row `counts` pays for a lookup per row.
        c = strictCount(l);
        per = l.counts ? l.counts : null;
        // wave H (knit-qa-2): a knitted range that CHANGES the count and has
        // no per-row counts ("Cast off 7 sts beg next 2 rows. 140 sts.",
        // "Cast off 15 sts beg next 4 rows, then 16 sts beg next 2 rows")
        // prints its total for its LAST row; the rows before it are not that
        // number (row 3 of the mock neck back makes 147, not 140), so they
        // get no target rather than the finished one
        // (only when the count BEFORE it is known and differs: a range whose
        // start is unknown keeps its one count, as before)
        var knitShaping = knit && !per && c !== null && end > l.row &&
          ((typeof l.prevCount === 'number' && l.prevCount !== c) ||
           // ...or it says it shapes ("Cast off 15 sts beg next 4 rows")
           /\b(?:cast\s+off|bind\s+off|bo|dec(?:rease)?|inc(?:rease)?)\b[^.]{0,60}\bnext\s+\d+\s+(?:rows|rnds|rounds)\b/i.test(str(l.text, '')));
        for (r = l.row; r <= end; r++) {
          // wave H: "Rows 2, 4, 6 and 8 (WS)" covers those rows, not 3, 5, 7
          if (l.rowList && l.rowList.indexOf(r) < 0) continue;
          if (line[r] === undefined) line[r] = l;
          if (knitShaping && r < end && !(l.rowList && l.rowList[l.rowList.length - 1] === r)) continue;
          if (count[r] === undefined) {
            cr = per ? countAtRow(l, r) : c;
            if (cr !== null) count[r] = cr;
          }
        }
      }
    }
    return { upTo: upTo, line: line, count: count };
  }

  // Rows past this are looked up the slow way; buildDiagramModel never goes there.
  var ROW_INDEX_MAX = DIAGRAM_MAX_ROUNDS * 4;

  function rowIndexOf(prt) {
    var entry = partLines(prt);
    if (!entry.index) {
      if (entry === EMPTY_ENTRY) return buildRowIndex([], ROW_INDEX_MAX);
      entry.index = buildRowIndex(entry.lines, ROW_INDEX_MAX, entry.craft === 'knitting');
    }
    return entry.index;
  }

  /** v2 field with a v1 fallback: Line.count ?? Line.stitches. */
  function countOf(line) {
    if (!line) return null;
    if (typeof line.count === 'number' && isFinite(line.count)) return line.count;
    if (typeof line.stitches === 'number' && isFinite(line.stitches)) return line.stitches;
    return null;
  }

  /** True when a line's count was worked out by the parser rather than printed. */
  function isComputed(line) {
    if (!line) return false;
    if (line.countSource) return line.countSource === 'computed';
    return line.stitches == null && typeof line.computed === 'number';
  }

  function notesOf(line) {
    return line && Array.isArray(line.notes) ? line.notes : [];
  }

  function emptySummary() {
    return {
      rows: 0,
      maxRow: null,
      hasTargets: false,
      computedOnly: false,
      sizes: null,
      multiSize: false,
      sections: [],
      suggestions: null
    };
  }

  /** Normalise a Patterns.summary result so v1 parsers never crash the UI. */
  function normalizeSummary(s) {
    var out = emptySummary();
    if (!s || typeof s !== 'object') return out;
    out.rows = clampInt(s.rows, 0, 999999, 0);
    out.maxRow = typeof s.maxRow === 'number' && isFinite(s.maxRow) ? s.maxRow : null;
    out.hasTargets = !!s.hasTargets;
    out.computedOnly = !!s.computedOnly;
    out.sizes = Array.isArray(s.sizes) && s.sizes.length ? s.sizes.slice() : null;
    out.multiSize = !!s.multiSize;
    out.sections = Array.isArray(s.sections) ? s.sections : [];
    out.suggestions = s.suggestions && typeof s.suggestions === 'object' ? s.suggestions : null;
    return out;
  }

  function patternSummary(prt) {
    var lines = linesFor(prt);
    var api = patternsApi(prt);
    if (!lines.length || !api || typeof api.summary !== 'function') return emptySummary();
    try {
      return normalizeSummary(api.summary(lines));
    } catch (e) {
      return emptySummary();
    }
  }

  /**
   * How many sizes the text carries: the longest multi-size list seen on any
   * line (there is no dedicated API for it), at least the number of size names.
   */
  function sizeCount(prt) {
    var lines = linesFor(prt);
    var n = 0;
    for (var i = 0; i < lines.length; i++) {
      var sz = lines[i] && lines[i].sizes;
      if (Array.isArray(sz) && sz.length > n) n = sz.length;
    }
    var s = patternSummary(prt);
    if (s.sizes && s.sizes.length > n) n = s.sizes.length;
    return n;
  }

  /** The setup / foundation line (row 0), if the pattern has one. */
  function setupLine(prt) {
    var lines = linesFor(prt);
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (!l) continue;
      if (l.kind === 'setup' || (l.row === 0 && l.kind !== 'header' && l.kind !== 'note')) return l;
    }
    return null;
  }

  /**
   * Sections of a raw pattern text, for the import flow.
   * @param {string} [craft] wave H: read with that craft's parser (default crochet)
   */
  function splitSections(text, craft) {
    var api = patternsApi(craft);
    if (!text || !String(text).replace(/\s/g, '')) return [];
    if (api && typeof api.splitSections === 'function') {
      try {
        var out = api.splitSections(String(text));
        if (Array.isArray(out)) {
          var mapped = out.map(function (s) {
            var sec = {
              name: str(s && s.name, ''),
              makeCount: clampInt(s && s.makeCount, 1, 99, 1),
              text: str(s && s.text, ''),
              // "Where things go": the assembly prose the parser handed to
              // this part, plus its own placing sentences. '' when there is
              // none.
              placement: str(s && s.placement, '')
            };
            // Wave F: "made twice, from the assembly text" - the import
            // preview and the part list say so (wave E left it unshown).
            if (s && s.makeCountInferred) sec.makeCountInferred = true;
            // wave H (knit-qa-2): a prose part the reader offers for import
            // although it has no numbered rows (Sandnes' Back And Front)
            if (s && s.offer) sec.offer = true;
            if (s && s.continues) sec.continues = str(s.continues, '');
            // wave K (knit-store, E13): the reader's word for a part worked in rounds
            if (s && s.rowWord === 'rnd') sec.rowWord = 'rnd';
            // Wave G: the size group's name ("Keyring" / "Medium" / "Big"),
            // null when the document has one size
            sec.group = normalizeGroupName(s && s.group);
            // wave H (knit-qa-2): the gauge lines the knitting reader carries for a group
            if (s && Array.isArray(s.gaugeLines) && s.gaugeLines.length) sec.gaugeLines = s.gaugeLines.slice(0, 6).map(String);
            return sec;
          });
          // wave H (knit-qa): a knitting section the parser could not name
          // is named from its own text, else "Part N"
          if (craftKeyOf(craft) === 'knitting') nameKnitSections(mapped);
          return mapped;
        }
      } catch (e) {
        /* fall through */
      }
    }
    // v1 parser (or a failure): one nameless section with everything in it.
    return [{ name: '', makeCount: 1, text: String(text), placement: '' }];
  }

  /*
   * wave H (knit-qa): the garment part an unnamed knitting section is about,
   * from the dominant garment noun in its OWN text — "neck" → Neck,
   * "raglan" / "yoke" → Yoke. A noun only counts where it names the piece
   * being worked: not inside "measures … from front neck" (a place to measure
   * from), not on a "Divide for Sleeves and Body" line (the parts that come
   * next), not on an abbreviation line ("PM = Place marker"). The winner must
   * lead outright and must not already name another section of the same
   * pattern (two parts of one name would merge on import); otherwise the
   * section is "Part N", N its place in its pattern.
   */
  var KNIT_SECTION_NOUNS = [
    ['Yoke', /\b(?:yoke|raglans?)\b/gi],
    ['Neckband', /\bneck\s*band\b/gi],
    ['Neck', /\bneck(?:line)?\b(?!\s*band)/gi],
    ['Collar', /\bcollar\b/gi],
    ['Hood', /\bhood\b/gi],
    ['Button Band', /\bbutton\s*band\b/gi],
    ['Pocket', /\bpockets?\b/gi],
    ['Sleeve', /\bsleeves?\b/gi],
    ['Cuff', /\bcuffs?\b/gi],
    ['Body', /\bbody\b/gi],
    ['Heel', /\bheels?\b/gi],
    ['Gusset', /\bgussets?\b/gi],
    ['Foot', /\bfoot\b/gi],
    ['Toe', /\btoes?\b/gi],
    ['Leg', /\blegs?\b/gi],
    ['Brim', /\bbrim\b/gi],
    ['Crown', /\bcrown\b/gi],
    ['Border', /\bborder\b/gi],
    ['Edging', /\bedging\b/gi]
  ];

  function knitSectionNoun(text) {
    var lines = String(text || '').split(/\r?\n/);
    var counts = {};
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      // the size line the parser carries, abbreviation lines, "Divide for …"
      if (/^\s*sizes?\s*:/i.test(ln) || /\s=\s/.test(ln) || /\bdivide\s+for\b/i.test(ln)) continue;
      // "measures 8½" from front neck", "from back of heel", "from tip of toe"
      ln = ln.replace(/\bfrom\s+(?:the\s+)?(?:\w+\s+){0,2}?(?:of\s+(?:the\s+)?)?(?:neck|heel|toe|cuff|sleeve\s+divide|underarm|brim|crown|cast[-\s]on)\b/gi, ' ');
      // a stitch's own "leading leg" / "right leg" is not the sock's leg
      ln = ln.replace(/\b(?:leading|trailing|right|left|front|back|both)\s+legs?\b/gi, ' ');
      for (var k = 0; k < KNIT_SECTION_NOUNS.length; k++) {
        var m = ln.match(KNIT_SECTION_NOUNS[k][1]);
        if (m) counts[KNIT_SECTION_NOUNS[k][0]] = (counts[KNIT_SECTION_NOUNS[k][0]] || 0) + m.length;
      }
    }
    var best = null, bestN = 0, second = 0;
    Object.keys(counts).forEach(function (n) {
      if (counts[n] > bestN) { second = bestN; bestN = counts[n]; best = n; }
      else if (counts[n] > second) second = counts[n];
    });
    return best && bestN > second ? best : null;
  }

  /** `name`, or "name 2", "name 3" … when a part of the same group has it. */
  function knitUniqueName(proj, name, group) {
    var has = function (n) {
      return proj.parts.some(function (q) {
        return (q.group || null) === (group || null) && String(q.name).toLowerCase() === n.toLowerCase();
      });
    };
    if (!has(name)) return name;
    for (var k = 2; k < 100; k++) if (!has(name + ' ' + k)) return name + ' ' + k;
    return name;
  }

  /** "Sleeves" and "Sleeve" are the same part name. */
  function knitNameKey(n) {
    return String(n || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/s$/, '');
  }

  function nameKnitSections(secs) {
    var taken = {};
    var place = {};
    secs.forEach(function (s) {
      var g = s.group || '';
      if (s.name) taken[g + '\u0001' + knitNameKey(s.name)] = true;
    });
    secs.forEach(function (s) {
      var g = s.group || '';
      place[g] = (place[g] || 0) + 1;
      if (s.name) return;
      var noun = knitSectionNoun(s.text);
      if (noun && !taken[g + '\u0001' + knitNameKey(noun)]) {
        s.name = noun;
      } else {
        s.name = 'Part ' + place[g];
      }
      taken[g + '\u0001' + knitNameKey(s.name)] = true;
    });
    return secs;
  }

  /**
   * Parse a loose block of pattern text without touching any part's cache.
   * `craft` (wave H): the craft whose parser reads it; crochet by default.
   */
  function parseLoose(text, opts, craft) {
    var api = patternsApi(craft);
    if (!api || typeof api.parse !== 'function') return [];
    if (!text || !String(text).replace(/\s/g, '')) return [];
    try {
      var out = opts ? api.parse(String(text), opts) : api.parse(String(text));
      return Array.isArray(out) ? out : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * The row count a section implies (01 #1 / 02 #1): its highest row number,
   * but only when the rows run contiguously from 1 up to it — a range like
   * "Rnd 7-12" counts for every row it covers — and there are at least two.
   * A section whose numbering has holes (a page bleed, a finishing note that
   * parsed as a row) gets no target rather than a wrong one.
   * Wave F: `size` / `sizeCount` read it at the maker's size — a garment's
   * "until there are a total of 25 (29, 33 …) Rows" is 33 rows in size M.
   * Wave H: `craft` reads it with that craft's parser (crochet by default).
   * @returns {number|null}
   */
  function targetRowsFromText(text, size, sizeCount, craft) {
    var sz = typeof size === 'number' && size > 0 ? Math.floor(size) : 0;
    var n = typeof sizeCount === 'number' && sizeCount >= 2 ? Math.floor(sizeCount) : 0;
    // wave H (knit-qa): a counter craft's section that names its own sizes
    // (an ebook pattern's "Sizes:" line) is read at those, as partLines does
    var popts = sz || n ? { size: sz, sizeCount: n } : null;
    if (craftKeyOf(craft) !== DEFAULT_CRAFT) {
      var own = knitPartSizes(null, patternsApi(craft), text);
      if (own.count) popts = { size: sz, sizeCount: own.count, sizes: own.names };
    }
    var lines = parseLoose(text, popts, craft);
    if (!lines.length) return null;
    // wave H (knit-qa): a knitting piece is a target only when every row of
    // it is counted. "Knit even until work measures 2½"" is rows nobody can
    // number without a gauge (the chip says "≈"), and a section whose own
    // numbering starts again ("Sizes XL … only: 1st rnd") has no last row to
    // aim at: the Bernat yoke at XL called itself done at round 5 and the
    // sleeves at 55, a round before their 2" of rib.
    var knitTarget = craftKeyOf(craft) === 'knitting';
    var seen = Object.create(null);
    var max = 0;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (!l || l.sizeSkip) continue;
      if (knitTarget && l.until && l.until.kind === 'length') return null;
      // ...nor "Cont in patt until half the yarn has been used up" / "Rep
      // Rows 3 and 4 until all yos have been consumed": a stretch worked
      // until something happens, that the reader did not turn into rows (the
      // Rico shawl's pattern section called itself done at row 9)
      if (knitTarget && l.kind !== 'row' && /\buntil\b/i.test(String(l.text || '')) &&
          !(l.until && l.until.kind === 'rows') && !(typeof l.repeatRows === 'number' && l.repeatRows >= 1)) return null;
      if (l.kind !== 'row') continue;
      var a = typeof l.row === 'number' && isFinite(l.row) ? Math.floor(l.row) : 0;
      if (a < 1) continue;
      var b = typeof l.rowEnd === 'number' && isFinite(l.rowEnd) && l.rowEnd >= a ? Math.floor(l.rowEnd) : a;
      if (b - a > 9999) continue;
      for (var r = a; r <= b; r++) {
        if (knitTarget && seen[r] && (!l.rowList || l.rowList.indexOf(r) >= 0)) return null;
        if (l.rowList && l.rowList.indexOf(r) < 0) continue;
        seen[r] = true;
        if (r > max) max = r;
      }
    }
    // (one written row is enough when a repeat continues it - the Caron
    // "1st row" + "Rep last row for pat 6 times more" block is 7 rows; the
    // two-row floor is applied after the repeat below)
    if (max < 1) return null;
    // Wave F (03 #5): a repeat in the middle of a piece owns the rows between
    // the ones written around it - "Repeat Rows 5-8 until there are a total of
    // 36 Rows" then "Next Row:" (row 37) is rows 9-36, not a hole. Without it
    // the Wheat Stitch Second Section never got a target at any size.
    for (var h = 0; h < lines.length; h++) {
      var hl = lines[h];
      if (!hl || hl.kind !== 'repeat' || !hl.repeatOf) continue;
      var hf = typeof hl.repeatFrom === 'number' ? Math.floor(hl.repeatFrom) : 0;
      var ht = typeof hl.repeatTo === 'number' && isFinite(hl.repeatTo) ? Math.floor(hl.repeatTo) : 0;
      if (hf >= 1 && ht >= hf && ht < max && ht - hf <= 9999) {
        for (var hr = hf; hr <= ht; hr++) seen[hr] = true;
      }
    }
    for (var k = 1; k <= max; k++) if (!seen[k]) return null;
    // Wave E: a flat count of repeats past the last written row is the pattern
    // stating its own length. "Rep 3rd Rnd 3 times" on the Stylecraft hood
    // motif owns rounds 4-6 (the parser's `repeatFrom`..`repeatRows`, what
    // `Patterns.summary().maxRow` reports and `Patterns.lineFor` answers for,
    // and what the leaflet's own "6 rnds to 16cm" confirms). Without this the
    // counter called the motif complete after round 3 — half of it. Only a
    // repeat that picks up exactly where the written rows stop extends the
    // target, so the run stays contiguous.
    for (var q = 0; q < lines.length; q++) {
      var rl = lines[q];
      if (!rl || rl.kind !== 'repeat') continue;
      var from = typeof rl.repeatFrom === 'number' ? Math.floor(rl.repeatFrom) : 0;
      var to = typeof rl.repeatRows === 'number' && isFinite(rl.repeatRows) ? Math.floor(rl.repeatRows) : 0;
      if (from === max + 1 && to >= from && to - max <= 9999) max = to;
    }
    if (max < 2) return null;
    return max;
  }

  /**
   * A content-derived identity for an imported section (13 #7): the section
   * name plus its first instruction line. Unlike the positional fallback name
   * `'Part ' + (n + 1)`, it means the same thing on every re-import, so a
   * corrected PDF updates the parts it made last time instead of appending
   * copies of them.
   * @returns {string} '' when there is nothing to key on
   */
  function sectionImportKey(name, text, knit) {
    var first = '';
    var rows = str(text, '').split(/\r?\n/);
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i].replace(/\s+/g, ' ').trim();
      // wave H (knit-qa): the size and carried-count lines Knits puts on top of
      // every part of a pattern are not what tells two parts apart
      // (and a knitting part is told apart by its first three lines: the
      // Time Traveler's two "Foot" sections both open with a "Foot" heading)
      if (t && knit && (/^sizes?\s*:/i.test(t) || /^start with \d/i.test(t))) continue;
      if (t && knit) {
        first += (first ? '\n' : '') + t;
        if (first.split('\n').length >= 3) break;
        continue;
      }
      if (t) { first = t; break; }
    }
    var n = str(name, '').trim();
    if (!first && !n) return '';
    return hash32(n.toLowerCase() + String.fromCharCode(0) + first.toLowerCase());
  }

  /* ------------------------------------------------------------------ *
   * Assembly steps hiding in a pasted / imported pattern
   * ------------------------------------------------------------------ */

  var CHECKLIST_SECTION_RE = /\b(?:assembly|finishing|construction|sewing|making up|putting it together)\b/i;
  var CHECKLIST_START_RE =
    /^(?:sew|attach|stuff|embroider|weave in|block|insert(?:\s+the)?(?:\s+safety)?\s+eyes|glue|fasten off and sew|join)\b/i;
  var CHECKLIST_MAX = 20;
  var CHECKLIST_LEN = 90;
  /* "Join our lovely Facebook group" is not an assembly step. */
  var CHECKLIST_SPAM_RE =
    /\b(?:community|newsletter|facebook|instagram|pinterest|youtube|patreon|ravelry|subscribe|follow us|our group|mailing list)\b/i;

  /** One tidy, short, imperative line. */
  function tidyStep(text) {
    var t = str(text, '').replace(/\s+/g, ' ').trim();
    t = t.replace(/^[\s\-–—*•>•]+/, '');
    t = t.replace(/\((?:photo|pic|picture|image)[^)]*\)/gi, '').replace(/\s+/g, ' ').trim();
    t = t.replace(/[.;,:]+$/, '');
    if (t.length > CHECKLIST_LEN) {
      var cut = t.slice(0, CHECKLIST_LEN - 1);
      var sp = cut.lastIndexOf(' ');
      if (sp > 40) cut = cut.slice(0, sp);
      t = cut.replace(/[\s,;:.\-–—]+$/, '') + '…';
    }
    return t;
  }

  /* A step that stops on a preposition, a conjunction or an article is half a
   * sentence — "Stuff head and sew to" (01 #3). */
  var DANGLING_RE =
    /(?:^|\s)(?:to|and|with|on|in|for|from|of|into|onto|at|by|or|the|a|an)$/i;
  /* "Rnd 7:" / "Row 12." at the start, or a labelled row marker anywhere, is a
   * pattern instruction rather than an assembly step. "…on rnd 19" is not. */
  var ROW_MARKER_START_RE = /^(?:rows?|rnds?|rounds?|r)\s*\.?\s*\d/i;
  var ROW_LABEL_RE = /\b(?:rows?|rnds?|rounds?)\s*\d+(?:\s*[-–—+&]\s*\d+)?\s*:/i;
  var TRAILING_COUNT_RE = /\s*\(\s*\d+\s*(?:sts?|stitches?|st)?\s*\)\s*$/i;

  /** "Stuff hand. (6)" → "Stuff hand." — the count belongs on the row, not here. */
  function stripTrailingCount(t) {
    return str(t, '').replace(TRAILING_COUNT_RE, '').replace(/\s+$/, '');
  }

  function danglingTail(t) {
    var s = str(t, '').replace(/…$/, '').replace(/[.;,:]+$/, '').replace(/\s+$/, '');
    return DANGLING_RE.test(s);
  }

  function hasRowMarker(t) {
    return ROW_MARKER_START_RE.test(str(t, '')) || ROW_LABEL_RE.test(str(t, ''));
  }

  /** The four rejections from 01 #3, in one place. */
  function usableStep(t) {
    if (!t || t.length < 5) return false;
    if (!/^[A-Z]/.test(t)) return false;                       // starts lower-case
    if (danglingTail(t)) return false;                         // ends on a preposition
    var words = t.replace(/…$/, '').replace(/\s+$/, '').split(/\s+/);
    if (words.length < 3) return false;                        // under three words
    if (hasRowMarker(t)) return false;                         // a row instruction
    if (CHECKLIST_SPAM_RE.test(t)) return false;
    return true;
  }

  /**
   * One suggestion. It is an object with `.text` and `.confidence` AND it
   * still behaves as its own string (`toLowerCase`, concatenation,
   * `JSON.stringify`, `textContent`), so the shell can be moved over to the
   * object shape without a flag day. Once js/app.js reads `.text`, the String
   * wrapper here can become a plain object literal.
   */
  function suggestion(text, confidence) {
    var s = new String(text);
    s.text = text;
    s.confidence = confidence === 'strong' ? 'strong' : 'weak';
    return s;
  }

  /**
   * Pull the assembly steps out of a pasted (or PDF-imported) pattern:
   * anything in an Assembly / Finishing / Construction / Sewing section, plus
   * any line anywhere that opens with a sewing-up verb. Fragments are either
   * completed from the line below or dropped (01 #3).
   * @param {string} text
   *
   * Confidence: 'strong' is a sentence that stood on its own and opened with
   * a sewing-up verb. 'weak' is one this code had to put back together from
   * two lines, or one that only qualified by living in an Assembly section —
   * the sheet should offer those unticked (01 #3).
   * @returns {Array<{text:string, confidence:'strong'|'weak'}>} at most 20
   *
   * Wave H: `craft` reads the text with that craft's parser, and a craft
   * that registered its own finishing verbs (`registerCraftParser(id, api,
   * { checklistStart, checklistSections })` — knitting's Block, Seam, Graft,
   * Weave in ends …) is matched on those instead of crochet's.
   */
  function suggestChecklist(text, craft) {
    var out = [];
    var seen = Object.create(null);
    var craftKey = craftKeyOf(craft);
    var extras = craftKey !== DEFAULT_CRAFT ? craftParserExtras[craftKey] || {} : {};
    var startRe = extras.checklistStart || CHECKLIST_START_RE;
    var sectionRe = extras.checklistSections || CHECKLIST_SECTION_RE;

    function add(raw, strong, next) {
      if (out.length >= CHECKLIST_MAX) return;
      var t = tidyStep(stripTrailingCount(raw));
      // Wave E: a sentence the PDF wrapped mid-phrase. The Stylecraft hood's
      // "Attach the next motif onto the centre motif of the first 3-motif" /
      // "strip, then attach the sides…" was offered as the first line alone —
      // a step that stops before its noun. No closing stop on this line and a
      // lower-case start on the next one is a wrap: rejoin it (weak, as any
      // reconstructed step is).
      if (t && next && !/[.!?:)]\s*$/.test(str(raw, '')) && /^\s*[a-z]/.test(str(next, '')) &&
          !hasRowMarker(str(next, '').trim())) {
        var wrapped = tidyStep(stripTrailingCount(str(raw, '').replace(/\s+$/, '') + ' ' + str(next, '')));
        // The 90-character cut can land on "…then attach the…": back off
        // to the last word that is not a preposition or an article.
        var guard = 0;
        while (wrapped && /…$/.test(wrapped) && danglingTail(wrapped) && guard++ < 6) {
          wrapped = wrapped.replace(/\s*\S+…$/, '…').replace(/[\s,;:.\-–—]+…$/, '…');
        }
        if (wrapped && !danglingTail(wrapped)) {
          t = wrapped;
          strong = false;
        }
      }
      // A wrapped sentence: glue the line below on when that finishes it.
      // A step we had to reconstruct is only ever weak, however good the verb
      // was — the user should look at it before it goes on the list.
      if (t && danglingTail(t) && next) {
        var joined = tidyStep(
          stripTrailingCount(str(raw, '').replace(/[.;,:]+\s*$/, '') + ' ' + str(next, ''))
        );
        if (joined && !danglingTail(joined)) {
          t = joined;
          strong = false;
        }
      }
      if (!usableStep(t)) return;
      var key = t.toLowerCase();
      if (seen[key]) return;
      // "Sew the ears onto either side of the" and the full sentence are one step.
      var head = key.slice(0, 40);
      for (var i = 0; i < out.length; i++) {
        var other = out[i].text.toLowerCase();
        if (other.indexOf(head) === 0 || key.indexOf(other.slice(0, 40)) === 0) return;
      }
      seen[key] = true;
      out.push(suggestion(t, strong ? 'strong' : 'weak'));
    }

    var raw = str(text, '');
    if (!raw.replace(/\s/g, '')) return out;

    var api = patternsApi(craftKey);
    var lines = null;
    if (api && typeof api.parse === 'function') {
      try { lines = api.parse(raw); } catch (e) { lines = null; }
    }

    if (lines && lines.length) {
      var assembly = Object.create(null);
      var secs = (lines.meta && Array.isArray(lines.meta.sections)) ? lines.meta.sections : [];
      secs.forEach(function (s) {
        if (s && sectionRe.test(str(s.name, ''))) assembly[s.index] = true;
      });
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        if (!l) continue;
        var notes = Array.isArray(l.notes) ? l.notes : [];
        for (var n = 0; n < notes.length; n++) {
          if (startRe.test(tidyStep(notes[n]))) add(notes[n], true, notes[n + 1]);
        }
        if (l.photo || l.kind === 'header' || l.kind === 'row' || l.kind === 'repeat') continue;
        var t = tidyStep(l.text);
        if (!t) continue;
        var nxt = lines[i + 1] && !lines[i + 1].photo ? str(lines[i + 1].text, '') : '';
        // An explicit sewing-up verb is a strong signal; living in an Assembly
        // section is a weak one.
        if (startRe.test(t)) add(l.text, true, nxt);
        else if (assembly[l.section]) add(l.text, false, nxt);
      }
      return out;
    }

    // No parser (or it threw): a plain line scan still finds most of them.
    var plain = raw.split(/\r?\n/);
    for (var p = 0; p < plain.length; p++) {
      var pt = tidyStep(plain[p]);
      if (pt && startRe.test(pt)) add(plain[p], true, plain[p + 1]);
    }
    return out;
  }

  /**
   * Does the parse carry a repeat sentence that owns rows past the written
   * ones (`repeatOf` + `repeatFrom`, see `Patterns.repeatLineFor`)? Only then
   * is an index miss worth asking the parser about.
   */
  function hasRepeatLine(lines) {
    for (var i = lines.length - 1; i >= 0; i--) {
      var l = lines[i];
      if (l && l.kind === 'repeat' && l.repeatOf && l.repeatFrom >= 1) return true;
    }
    return false;
  }

  function lineForRow(prt, rowNumber) {
    var lines = linesFor(prt);
    if (!lines.length) return null;
    if (typeof rowNumber === 'number' && rowNumber >= 1 && rowNumber <= ROW_INDEX_MAX) {
      var hit = rowIndexOf(prt).line[rowNumber];
      if (hit !== undefined) return hit;
      // wave K (knit-store, P1): every row from an open stretch's start on is
      // that stretch until the knitter says it ended
      var openSt = knitOpenStretch(prt, rowNumber);
      if (openSt) return openSt;
      // Wave E: no WRITTEN row covers this one. The index holds numbered rows
      // only, but `Patterns.lineFor` also answers past the last written row
      // with the repeat sentence that owns it ("Rep 3rd Rnd 3 times" is rounds
      // 4-6 of the hood motif; "Rep Row 2 until it measures 59"" is rows 3-89
      // of the throw), so the counter showed no pattern line at all there.
      // Misses are rare (past the end of the rows), so the parser's own scan
      // is affordable; anything the index did hold is answered above.
      if (!hasRepeatLine(lines)) return null;
    }
    var api = patternsApi(prt);
    if (!api || typeof api.lineFor !== 'function') return null;
    try {
      return api.lineFor(lines, rowNumber) || null;
    } catch (e) {
      return null;
    }
  }

  /** Whole, positive stitch targets only — 0 and nonsense read as "no target". */
  function usableCount(c) {
    return typeof c === 'number' && isFinite(c) && c > 0 ? Math.floor(c) : null;
  }

  function targetFor(prt, rowNumber) {
    var lines = linesFor(prt);
    if (!lines.length) return null;
    if (typeof rowNumber === 'number' && rowNumber >= 1 && rowNumber <= ROW_INDEX_MAX) {
      var idx = rowIndexOf(prt);
      if (idx.line[rowNumber] === undefined) {
        var openT = knitOpenStretch(prt, rowNumber);   // wave K (P1)
        if (openT) return usableCount(openT.count);
      }
      // A written row answers for itself, count or no count. Past the written
      // rows, the repeat that owns the row answers with the count of the row
      // it sends you back to (row 40 of the Premier throw is row 2's 94), the
      // same as `Patterns.targetFor` — see lineForRow.
      if (idx.line[rowNumber] !== undefined || !hasRepeatLine(lines)) {
        return usableCount(idx.count[rowNumber]);
      }
    }
    var api = patternsApi(prt);
    if (!api || typeof api.targetFor !== 'function') return null;
    try {
      return usableCount(api.targetFor(lines, rowNumber));
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Repeat math
   * ------------------------------------------------------------------ */

  function repeatInfo(prt) {
    var r = prt && prt.repeat ? prt.repeat : null;
    var workingRow = (prt ? prt.row : 0) + 1;
    var out = {
      inside: false,
      k: 0,
      j: 0,
      len: 0,
      times: r ? r.times : 0,
      patternRow: workingRow,
      workingRow: workingRow
    };
    if (!r || !r.enabled) return out;
    var len = r.endRow - r.startRow + 1;
    out.len = len;
    if (len <= 0 || r.times < 1) return out;
    var span = len * r.times;
    if (workingRow >= r.startRow && workingRow < r.startRow + span) {
      out.inside = true;
      out.k = Math.floor((workingRow - r.startRow) / len) + 1;
      out.j = ((workingRow - r.startRow) % len) + 1;
      out.patternRow = r.startRow + out.j - 1;
    }
    return out;
  }

  /** Stitch target for the row currently being worked on this part. */
  function currentTarget(prt) {
    if (!prt) return null;
    // wave H: a short row is counted to the turn, not to a row total
    if (knitInShortRows(prt)) return null;
    return targetFor(prt, repeatInfo(prt).patternRow);
  }

  /** { value, computed } — computed targets are shown as "≈ 24". */
  function currentTargetInfo(prt) {
    var value = currentTarget(prt);
    if (!value) return { value: null, computed: false };
    var line = prt ? lineForRow(prt, repeatInfo(prt).patternRow) : null;
    return { value: value, computed: isComputed(line) };
  }

  /* ------------------------------------------------------------------ *
   * wave I (group-readout): the groups the row is worked in
   *
   * The readout under the stitch button used to chunk every row into the
   * project's `groupSize` (10): "Inc, 2sc, repeat around" over 18 read
   * "Group 1 of ≈ 3 · stitch 0 of 10". A row worked in repeats is counted in
   * its repeats instead - "Group 1 of 6 · stitch 0 of 4" - read off the
   * row's own expansion (`Patterns.repeatGroups`, the knitting reader's for a
   * knitted part), and only when that expansion makes exactly the row's
   * target. Anything else keeps the groupSize chunks.
   * ------------------------------------------------------------------ */

  /**
   * The repeat groups of the row being worked on `prt`, or null.
   * -> { groups, total, runs: [{ group (0 = before/after the groups), size }] }
   */
  function rowGroups(prt) {
    if (!prt) return null;
    var target = currentTarget(prt);
    if (!target) return null;
    var ri = repeatInfo(prt);
    var row = ri.patternRow;
    // the row worked just before: the end of the block when a repeat starts over
    var prevRow = (ri.inside && ri.j === 1 && ri.k > 1 && prt.repeat) ? prt.repeat.endRow : row - 1;
    var prev = prevRow >= 1 ? targetFor(prt, prevRow) : null;
    var entry = partLines(prt);
    if (!entry || entry === EMPTY_ENTRY || !entry.lines || !entry.lines.length) return null;
    var key = row + '|' + prev + '|' + target;
    if (!entry.groups) entry.groups = {};
    if (Object.prototype.hasOwnProperty.call(entry.groups, key)) return entry.groups[key];
    var out = null;
    var api = patternsApi(prt);
    if (api && typeof api.repeatGroups === 'function') {
      try { out = api.repeatGroups(entry.lines, row, prev); } catch (e) { out = null; }
    }
    // the groups have to add up to the very number the counter counts to
    if (!out || out.total !== target) out = null;
    entry.groups[key] = out;
    return out;
  }

  /**
   * Where stitch `stitch` (stitches done in this row) falls among `info`'s
   * groups. `stitch` 0 is the start of the first run. Past the end of the
   * row (an over-count) the last group's size carries on.
   * -> { group, of, within, size, before (group number the run leads into,
   *      0 when none), boundary (true when this stitch ends a group) }
   */
  function groupAt(info, stitch) {
    if (!info || !info.runs || !info.runs.length) return null;
    var s = Math.max(0, Math.floor(stitch || 0));
    var runs = info.runs, cum = 0, i, r = runs[0];
    function next(from) {
      for (var j = from; j < runs.length; j++) if (runs[j].group) return runs[j].group;
      return 0;
    }
    if (s === 0) {
      return { group: r.group, of: info.groups, within: 0, size: r.size,
        before: r.group ? 0 : next(0), boundary: false };
    }
    for (i = 0; i < runs.length; i++) {
      r = runs[i];
      if (s <= cum + r.size) {
        return { group: r.group, of: info.groups, within: s - cum, size: r.size,
          before: r.group ? 0 : next(i + 1), boundary: !!r.group && s === cum + r.size };
      }
      cum += r.size;
    }
    // over-count: past the row's total
    var last = runs[runs.length - 1], extra = s - info.total;
    if (last.group) {
      var w = ((extra - 1) % last.size) + 1;
      return { group: last.group + Math.ceil(extra / last.size), of: info.groups, within: w,
        size: last.size, before: 0, boundary: w === last.size };
    }
    return { group: 0, of: info.groups, within: last.size + extra, size: last.size, before: 0, boundary: false };
  }

  /**
   * The readout under the stitch button: "Group 1 of 6 · stitch 0 of 4" for a
   * row worked in repeats ("Before group 1 · stitch 1 of 1" / "After group 5
   * · stitch 2 of 2" for the stitches outside them), else the `groupSize`
   * chunks - the last chunk only as long as what is left of the row, "≈" on
   * a computed total ("Group 2 of ≈ 3 · stitch 4 of 10"). The repeat count
   * carries no "≈": it is what the row's own words say.
   * @param {Object} prt
   * @param {number} stitch  stitches done in this row
   * @param {number} g       group size (> 0; 0 = grouping off -> "stitch N")
   * @param {number|null} target  this row's stitch target
   * @param {string} approx  '≈ ' when the target was computed
   */
  function groupReadout(prt, stitch, g, target, approx) {
    approx = approx || '';
    if (!(g > 0)) return 'stitch ' + stitch;
    var at = groupAt(rowGroups(prt), stitch);
    if (at) {
      var tail = ' · stitch ' + at.within + ' of ' + at.size;
      if (at.group) return 'Group ' + at.group + ' of ' + at.of + tail;
      return (at.before ? 'Before group ' + at.before : 'After group ' + at.of) + tail;
    }
    var groupNo = stitch === 0 ? 1 : Math.ceil(stitch / g);
    var within = stitch === 0 ? 0 : ((stitch - 1) % g) + 1;
    var size = g;
    if (target) {
      var groups = Math.ceil(target / g);
      if (groupNo === groups && stitch <= target) size = target - (groups - 1) * g;
    }
    var text = 'Group ' + groupNo;
    if (target) text += ' of ' + approx + Math.ceil(target / g);
    return text + ' · stitch ' + within + ' of ' + (size < g ? approx : '') + size;
  }

  /* ------------------------------------------------------------------ *
   * Counting
   * ------------------------------------------------------------------ */

  function pushHistory(proj, prt) {
    proj.history.push({
      ts: now(),
      partId: prt.id,
      partName: prt.name,
      row: prt.row
    });
    if (proj.history.length > HISTORY_CAP) {
      proj.history.splice(0, proj.history.length - HISTORY_CAP);
    }
  }

  /**
   * True when every targeted part is finished (and at least one has a target).
   *
   * 02 #2: a part with no target that has never been touched BLOCKS the
   * project rather than being skipped — otherwise finishing two ears shelves
   * the whole toy while five parts sit untouched. A part with no target that
   * HAS been worked on is still skipped: it is the open-ended scrap-yarn tail
   * the user chose not to bound, and "Finish anyway" covers the rest.
   */
  /**
   * Wave G: does `prt` count for size group `group`? A part of that size, or
   * a part no size claims (one shared by every size). `group` null/undefined
   * = the whole project.
   */
  function inGroup(prt, group) {
    if (!group) return true;
    return !prt.group || prt.group === group;
  }

  /** `group` (wave G): only that size's parts (and the shared ones). */
  function allPartsDone(proj, group) {
    var any = false;
    for (var i = 0; i < proj.parts.length; i++) {
      var p = proj.parts[i];
      if (!inGroup(p, group)) continue;
      if (!p.targetRows) {
        if (!p.row && !p.stitch && !p.piecesDone) return false;
        continue;
      }
      any = true;
      if (p.piecesDone < p.makeCount) return false;
    }
    return any;
  }

  /**
   * The parts standing between this project and "done", by name.
   * @param {object|string} projectOrId
   */
  function blockingParts(projectOrId, group) {
    var out = [];
    var proj = projectOrId && typeof projectOrId === 'object' ? projectOrId : project(projectOrId);
    if (!proj || !Array.isArray(proj.parts)) return out;
    // wave G: in a project of several sizes a part is named with its size
    // ("Medium · Wings"), unless the question was about one size only
    var label = function (p) { return p.group && !group && (proj.groups || []).length > 1 ? p.group + ' · ' + p.name : p.name; };
    for (var i = 0; i < proj.parts.length; i++) {
      var p = proj.parts[i];
      if (!inGroup(p, group)) continue;
      if (!p.targetRows) {
        if (!p.row && !p.stitch && !p.piecesDone) out.push(label(p));
        continue;
      }
      if (p.piecesDone < p.makeCount) out.push(label(p));
    }
    return out;
  }

  /**
   * Wave G: how far one size of a multi-size project is.
   * @returns {{name:string, parts:number, partsDone:number, rows:number,
   *            rowsDone:number, done:boolean, started:boolean}|null}
   *   `rows` / `rowsDone` count every piece (a Wings made twice is two
   *   pieces' rows); a part with no target counts its rows done only.
   */
  function groupProgress(projectId, name) {
    var proj = projectId && typeof projectId === 'object' ? projectId : project(projectId);
    var g = normalizeGroupName(name);
    if (!proj || !g || !(proj.groups || []).some(function (x) { return x.name === g; })) return null;
    var out = { name: g, parts: 0, partsDone: 0, rows: 0, rowsDone: 0, done: false, started: false };
    proj.parts.forEach(function (p) {
      if (p.group !== g) return;
      out.parts++;
      var t = p.targetRows || 0;
      if (t && p.piecesDone >= p.makeCount) out.partsDone++;
      out.rows += t * p.makeCount;
      out.rowsDone += t ? Math.min(t * p.makeCount, p.piecesDone * t + Math.min(p.row, t)) : p.row;
      if (p.row || p.stitch || p.piecesDone) out.started = true;
    });
    out.done = out.parts > 0 && allPartsDone(proj, g);
    return out;
  }

  /** The size groups of a project, [] when it has one size (wave G). */
  function projectGroups(projectOrId) {
    var proj = projectOrId && typeof projectOrId === 'object' ? projectOrId : project(projectOrId);
    return proj && Array.isArray(proj.groups) ? proj.groups : [];
  }

  /** The parts of one size, in order (wave G). Shared parts are included. */
  function groupParts(projectOrId, name) {
    var proj = projectOrId && typeof projectOrId === 'object' ? projectOrId : project(projectOrId);
    if (!proj) return [];
    var g = normalizeGroupName(name);
    if (!g) return proj.parts.slice();
    return proj.parts.filter(function (p) { return inGroup(p, g); });
  }

  /**
   * Open a size's tab (wave G). View state, like setActivePart: no undo step.
   * The active part moves into that size (its first unfinished part) unless it
   * is already there.
   */
  function setActiveGroup(projectId, name) {
    var proj = project(projectId);
    var g = normalizeGroupName(name);
    if (!proj || !g || !(proj.groups || []).some(function (x) { return x.name === g; })) return false;
    proj.activeGroup = g;
    var ap = activePart(proj);
    if (!ap || ap.group !== g) {
      var mine = proj.parts.filter(function (p) { return p.group === g; });
      var pick = null;
      for (var i = 0; i < mine.length && !pick; i++) if (!isPartTerminal(mine[i])) pick = mine[i];
      pick = pick || mine[0];
      if (pick) proj.activePartId = pick.id;
    }
    touch(proj);
    return true;
  }

  /**
   * "Remove this size" (wave G): every part of that size goes, in one undo
   * step. The last size standing (with nothing shared) is refused - a project
   * keeps at least one part.
   * @returns {{removed:number, activeGroup:(string|null)}|null}
   */
  function removeGroup(projectId, name) {
    var proj = project(projectId);
    var g = normalizeGroupName(name);
    if (!proj || !g || !(proj.groups || []).some(function (x) { return x.name === g; })) return null;
    var keep = proj.parts.filter(function (p) { return p.group !== g; });
    if (!keep.length) return null;
    snapshot(proj);
    proj.parts.forEach(function (p) {
      if (p.group !== g) return;
      delete lineCache[p.id];
      delete colorPlanCache[p.id];
      delete diagramCache[p.id];
    });
    var removed = proj.parts.length - keep.length;
    proj.parts = keep;
    proj.groups = proj.groups.filter(function (x) { return x.name !== g; });
    if (!part(proj, proj.activePartId)) {
      var first = proj.groups.length ? keep.filter(function (p) { return p.group === proj.groups[0].name; })[0] : null;
      proj.activePartId = (first || keep[0]).id;
    }
    var ap = activePart(proj);
    proj.activeGroup = ap && ap.group ? ap.group : (proj.groups.length ? proj.groups[0].name : null);
    touch(proj);
    return { removed: removed, activeGroup: proj.activeGroup };
  }

  /**
   * The terminal state of a part: the last piece of the last row is done.
   * Every transition into it must be idempotent (13 #6).
   */
  function isPartTerminal(prt) {
    return !!(prt && prt.targetRows && prt.piecesDone >= prt.makeCount && prt.row >= prt.targetRows);
  }

  /**
   * Remember how many stitches a row ended up with, for the live diagram.
   * Called with the row being worked (prt.row + 1) before the counter moves on,
   * so a tapped row and an auto-advanced one both record what was on screen.
   */
  function recordRowStitches(prt, rowNumber, count) {
    if (!prt) return;
    if (!Array.isArray(prt.rowStitches)) prt.rowStitches = [0];
    if (rowNumber < 1 || rowNumber > DIAGRAM_MAX_ROUNDS * 4) return;
    // Rows skipped by a jump stay 0 = "unknown", never undefined.
    for (var i = prt.rowStitches.length; i < rowNumber; i++) prt.rowStitches[i] = 0;
    prt.rowStitches[rowNumber] = clampInt(count, 0, 999999, 0);
  }

  /** Drop everything recorded past `rowCount` completed rows. */
  function trimRowStitches(prt, rowCount) {
    if (!prt || !Array.isArray(prt.rowStitches)) return;
    if (prt.rowStitches.length > rowCount + 1) prt.rowStitches.length = rowCount + 1;
  }

  /**
   * Shared row-completion logic used by tapRow and auto-advance.
   *
   * 13 #6: at the terminal state this is a no-op that says so. Counting does
   * not run past the target, the celebration fires exactly once, and
   * `finishedAt` is never rewritten.
   */
  function completeRow(proj, prt) {
    if (isPartTerminal(prt)) {
      return { event: 'alreadyDone', partName: prt.name, row: prt.row, targetRows: prt.targetRows };
    }
    recordRowStitches(prt, prt.row + 1, prt.stitch);
    prt.row += 1;
    prt.stitch = 0;
    knitRowMoved(prt, 1);   // wave H: the side turns with the work
    pushHistory(proj, prt);
    counterCounted(proj, prt, 1, 'row', prt.targetRows);   // wave K

    if (prt.targetRows && prt.row >= prt.targetRows) {
      if (prt.piecesDone + 1 < prt.makeCount) {
        prt.piecesDone += 1;
        prt.row = 0;
        // The next piece starts from nothing, and so does its diagram.
        prt.rowStitches = [0];
        knitNewPiece(prt);
        return {
          event: 'pieceDone',
          piecesDone: prt.piecesDone,
          makeCount: prt.makeCount,
          partName: prt.name
        };
      }
      prt.piecesDone = prt.makeCount;
      if (allPartsDone(proj)) return { event: 'projectDone', partName: prt.name };
      // wave G: one size of a multi-size booklet is finished - the maker may
      // have wanted only that one ("finish the project?"), or go on to the next
      if (prt.group && (proj.groups || []).length > 1 && allPartsDone(proj, prt.group)) {
        return { event: 'groupDone', partName: prt.name, group: prt.group };
      }
      return { event: 'partDone', partName: prt.name };
    }
    return { event: 'row', row: prt.row };
  }

  function tapStitch(projectId, partId) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt) return { event: 'none' };
    snapshot(proj);

    prt.stitch += 1;
    var s = prt.stitch;

    var target = currentTarget(prt);
    counterCounted(proj, prt, 1, 'stitch', target);   // wave K: sessions + count event
    if (target && s >= target && settings().autoAdvance) {
      var res = completeRow(proj, prt);
      // A finished part pins its stitch count at the target instead of
      // creeping past it forever (13 #6).
      if (res.event === 'alreadyDone') prt.stitch = target;
      // wave H: two at a time, the work moves on to the other piece
      knitAfterAutoRow(proj, prt, res);
      touch(proj);
      // Plain row completions report as 'rowAuto'; bigger milestones win.
      if (res.event === 'row') return { event: 'rowAuto', row: prt.row, switchedTo: res.switchedTo };
      return res;
    }

    touch(proj);

    // Stitch alerts take priority over group boundaries: alerts are explicit,
    // hand-entered stitch numbers and frequently land on a group multiple.
    if (prt.alerts && prt.alerts.indexOf(s) !== -1) {
      return { event: 'alert', stitch: s };
    }
    // groupSize 0 means grouping is off — no group event, no buzz.
    var g = proj.groupSize;
    if (g > 0) {
      // wave I: a row worked in repeats buzzes at the end of each repeat
      var rg = rowGroups(prt);
      if (rg) {
        var at = groupAt(rg, s);
        if (at && at.boundary) return { event: 'group', stitch: s, group: at.group };
        return { event: 'stitch', stitch: s };
      }
      if (s % g === 0) return { event: 'group', stitch: s, group: s / g };
    }
    return { event: 'stitch', stitch: s };
  }

  /**
   * wave K (knit-store, for shell-ui's "a tap counts a repeat"): `n`
   * stitches as ONE action - one undo step, one count event - behaving as
   * n single taps would: never past the row's count, the row completes (and
   * auto-advances) when they reach it, a stitch alert inside the run is
   * reported, a group boundary inside it buzzes. Additive: tapStitch itself
   * is unchanged. -> the same shape as tapStitch, plus `n` (stitches added).
   */
  function tapStitches(projectId, partId, n) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    var want = Math.floor(Number(n));
    if (!proj || !prt || !(want >= 1)) return { event: 'none', n: 0 };
    if (want === 1) { var one = tapStitch(projectId, partId); one.n = 1; return one; }
    var target = currentTarget(prt);
    var from = prt.stitch;
    if (target && from + want > target) want = Math.max(0, target - from);
    if (!want) {
      // already at the row's count: what a single tap does there
      var at0 = tapStitch(projectId, partId);
      at0.n = 1;
      return at0;
    }
    snapshot(proj);
    prt.stitch = from + want;
    var s = prt.stitch;
    counterCounted(proj, prt, want, 'stitch', target);
    if (target && s >= target && settings().autoAdvance) {
      var res = completeRow(proj, prt);
      if (res.event === 'alreadyDone') prt.stitch = target;
      knitAfterAutoRow(proj, prt, res);
      touch(proj);
      res.n = want;
      if (res.event === 'row') return { event: 'rowAuto', row: prt.row, switchedTo: res.switchedTo, n: want };
      return res;
    }
    touch(proj);
    var k;
    if (prt.alerts && prt.alerts.length) {
      for (k = from + 1; k <= s; k++) if (prt.alerts.indexOf(k) !== -1) return { event: 'alert', stitch: k, n: want };
    }
    var g = proj.groupSize;
    if (g > 0) {
      var rg = rowGroups(prt);
      if (rg) {
        for (k = s; k > from; k--) {
          var gat = groupAt(rg, k);
          if (gat && gat.boundary) return { event: 'group', stitch: s, group: gat.group, n: want };
        }
        return { event: 'stitch', stitch: s, n: want };
      }
      if (Math.floor(s / g) > Math.floor(from / g)) return { event: 'group', stitch: s, group: Math.floor(s / g), n: want };
    }
    return { event: 'stitch', stitch: s, n: want };
  }

  function untapStitch(projectId, partId) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt) return { event: 'none' };
    snapshot(proj);
    var hadStitch = prt.stitch > 0;
    prt.stitch = Math.max(0, prt.stitch - 1);
    if (hadStitch) counterCounted(proj, prt, -1, 'stitch', null);   // wave K
    touch(proj);
    return { event: 'stitch', stitch: prt.stitch };
  }

  function resetStitches(projectId, partId) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt) return { event: 'none' };
    snapshot(proj);
    prt.stitch = 0;
    touch(proj);
    return { event: 'stitch', stitch: 0 };
  }

  function tapRow(projectId, partId) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt) return { event: 'none' };
    // wave H: short rows and two-at-a-time (null = the ordinary row below)
    var knitRes = knitTapRow(proj, prt);
    if (knitRes) return knitRes;
    // A dead press on a finished part costs nothing: no snapshot, no write,
    // no second celebration, no rewritten finishedAt (13 #6).
    if (isPartTerminal(prt)) {
      return { event: 'alreadyDone', partName: prt.name, row: prt.row, targetRows: prt.targetRows };
    }
    snapshot(proj);
    var res = completeRow(proj, prt);
    touch(proj);
    return res;
  }

  /**
   * The exact inverse of `completeRow` (13 #4), piece boundary included:
   *
   * - at the terminal state → back to piecesDone-1 / row targetRows-1,
   * - at row 0 with pieces done → piecesDone-1, row = targetRows,
   * - otherwise row-1,
   * - and when nothing can move, nothing moves: no history entry is eaten,
   *   no undo snapshot is pushed, no save is triggered.
   */
  function untapRow(projectId, partId) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt) return { event: 'none' };
    // wave H: back a short row, or both pieces worked two at a time
    var knitRes = knitUntapRow(proj, prt);
    if (knitRes) return knitRes;

    var canStep = prt.row > 0 || prt.piecesDone > 0;
    if (!canStep) {
      // Row 0 of the first piece. Clearing a part-started stitch count is the
      // only thing left to step back, and it is not a row, so no history goes.
      if (prt.stitch > 0) {
        snapshot(proj);
        prt.stitch = 0;
        touch(proj);
        return { event: 'row', row: 0 };
      }
      return { event: 'none', row: 0 };
    }

    snapshot(proj);
    if (isPartTerminal(prt)) {
      prt.piecesDone = Math.max(0, prt.makeCount - 1);
      prt.row = Math.max(0, prt.targetRows - 1);
    } else if (prt.row > 0) {
      prt.row -= 1;
    } else {
      // Stepping back off row 0 onto the piece before it.
      prt.piecesDone -= 1;
      prt.row = prt.targetRows || 0;
    }
    prt.stitch = 0;
    knitRowMoved(prt, -1);   // wave H
    counterCounted(proj, prt, -1, 'row', prt.targetRows);   // wave K
    trimRowStitches(prt, prt.row);
    var last = proj.history[proj.history.length - 1];
    if (last && last.partId === prt.id) proj.history.pop();
    touch(proj);
    return { event: 'row', row: prt.row, piecesDone: prt.piecesDone };
  }

  function jumpToRow(projectId, partId, rowNumber) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt) return { event: 'none' };
    snapshot(proj);
    // "Jump to row 7" means row 7 is the one being worked → 6 completed.
    var rowBefore = prt.row;
    prt.row = Math.max(0, clampInt(rowNumber, 1, 999999, 1) - 1);
    prt.stitch = 0;
    knitRowMoved(prt, prt.row - rowBefore);   // wave H
    trimRowStitches(prt, prt.row);
    touch(proj);
    return { event: 'row', row: prt.row };
  }

  function resetPart(projectId, partId) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt) return false;
    snapshot(proj);
    prt.row = 0;
    prt.stitch = 0;
    prt.rowStitches = [0];
    knitNewPiece(prt);   // wave H
    touch(proj);
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Projects
   * ------------------------------------------------------------------ */

  function createProject(opts) {
    opts = opts || {};
    var tpl =
      template(opts.templateId || 'blank') ||
      template('blank') ||
      seedTemplate(BUILTIN_TEMPLATES[0]);

    // The craft comes from the caller, else from the template, else crochet.
    var craft = str(opts.craft, '').trim() || str(tpl.craft, '').trim() || DEFAULT_CRAFT;

    // Template seed first, then whatever the New project sheet collected.
    var seed = tpl.craftData && tpl.craft === craft ? jsonObject(tpl.craftData) : {};
    var extra = jsonObject(opts.craftData);
    var keys = Object.keys(extra);
    for (var i = 0; i < keys.length; i++) seed[keys[i]] = extra[keys[i]];

    // Wave F: a template saved from a multi-size import carries the leaflet's
    // size names and the size picked then; the project starts there.
    var tplSizes = Array.isArray(tpl.sizes) && tpl.sizes.length >= 2 ? tpl.sizes.slice() : null;
    var tplSize = tplSizes && tpl.size ? normalizeProjectSize(tpl.size) : null;
    var tplIdx = tplSize ? tplSize.index : 0;
    var proj = normalizeProject({
      id: uid(),
      sizes: tplSizes,
      size: tplSize,
      name: safeName(opts.name, '') || safeName(tpl.name, 'Untitled project'),
      emoji: opts.emoji || tpl.emoji,
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
      finishedAt: null,
      countMode: opts.countMode === 'rounds' || opts.countMode === 'rows' ? opts.countMode : tpl.countMode,
      groupSize: clampInt(opts.groupSize, 0, 50, typeof tpl.groupSize === 'number' ? tpl.groupSize : 10),
      notes: str(opts.notes, ''),
      templateId: tpl.id,
      timer: { totalMs: 0, runningSince: null },
      // Non-crochet crafts get the one `Main` part too, so everything in the
      // shell that assumes parts.length >= 1 keeps working.
      // A template part may carry the pattern text and the placing notes it
      // was saved with; the new part gets a fresh id, so there is no stale
      // lineCache entry to clear.
      parts: tpl.parts.map(function (p) {
        var made = makePart(p.name, p.makeCount);
        made.patternText = str(p.patternText, '');
        made.placementNotes = str(p.placementNotes, '');
        made.workMode = normalizeWorkMode(p.workMode, 'auto');
        made.orientation = normalizeOrientation(p.orientation, 'auto');
        made.dialect = normalizeDialect(p.dialect, 'auto');
        // Wave E: the same target the PDF import sets (01 #1). A project made
        // from a template saved off a PDF came out with its rounds in place but
        // no target on any part — no progress bar, no "Body complete", and a
        // project that could never finish on its own — while the project the
        // template was saved from had all of them.
        if (tplSize) made.sizeIndex = tplIdx;
        if (made.patternText) {
          made.targetRows = targetRowsFromText(made.patternText, tplIdx, tplSizes ? tplSizes.length : 0, craft);
        }
        // wave G: the size this part belongs to
        made.group = normalizeGroupName(p.group);
        return made;
      }),
      checklist: tpl.checklist.map(function (t) { return { id: uid(), text: t, done: false }; }),
      history: [],
      craft: craft,
      craftData: seed,
      // wave G: every size the template carries, in order; the first is open
      groups: Array.isArray(tpl.groups) ? deepCopy(tpl.groups) : []
    });
    // wave H: the template's gauge, markers and two-at-a-time pairs (and a
    // gauge the New project sheet read off the PDF, `opts.gauge`)
    knitFromTemplate(proj, tpl, opts.gauge);
    // wave K (knit-store, P1): a knitting project made from now on numbers
    // its rows in stretch phases; older projects keep their numbering
    if (isKnitProject(proj)) proj.rowPhases = true;
    projects().push(proj);
    save();
    return proj;
  }

  /**
   * The ONLY door a craft module writes project state through: undo snapshot,
   * mutate, bump updatedAt, debounced save. `patchOrFn` is either an object
   * merged into craftData or a function that mutates it in place.
   * @returns {object|null} the project's craftData
   */
  function updateCraftData(projectId, patchOrFn, opts) {
    var proj = project(projectId);
    if (!proj) return null;
    // Wave F (cross-stitch request): `{ undo: false }` (alias `undoable:
    // false`) is for VIEW state - zoom, pan, tool, layer - that must persist
    // but must never fill the undo stack, and is not "work" either, so it
    // neither snapshots nor bumps updatedAt / the touch days. The write goes
    // through the same save() as every other, so revision / writerId and the
    // multi-tab rules are unchanged.
    var silent = !!(opts && (opts.undo === false || opts.undoable === false));
    // Wave K: a project whose heavy fields are still in IndexedDB is half a
    // craftData; writing to it would save the half. Store.whenReady first.
    if (!isHeavyReady(proj)) return null;
    var D = silent ? heavyDef(proj.craft) : null;
    var before = null;
    if (D && proj.craftData && typeof proj.craftData === 'object') {
      before = {};
      for (var bi = 0; bi < D.fields.length; bi++) before[D.fields[bi]] = getPath(proj.craftData, D.fields[bi]);
    }
    if (!silent) snapshot(proj);
    if (!proj.craftData || typeof proj.craftData !== 'object' || Array.isArray(proj.craftData)) {
      proj.craftData = {};
    }
    if (typeof patchOrFn === 'function') {
      try {
        var res = patchOrFn(proj.craftData, proj);
        if (res && typeof res === 'object' && !Array.isArray(res)) proj.craftData = res;
      } catch (e) {
        /* a throwing mutator leaves whatever it managed to do, undoable */
      }
    } else if (patchOrFn && typeof patchOrFn === 'object' && !Array.isArray(patchOrFn)) {
      var keys = Object.keys(patchOrFn);
      for (var i = 0; i < keys.length; i++) proj.craftData[keys[i]] = patchOrFn[keys[i]];
    }
    // wave K: a heavy field moved without a snapshot: the top diff is re-anchored
    if (before) heavyRebase(proj, before);
    if (silent) save();
    else touch(proj);
    return proj.craftData;
  }

  /** The crochet home-card line — the fallback for any craft without one. */
  function crochetSummary(p) {
    var prt = activePart(p);
    if (!prt) return '';
    var bits = [prt.name, (p && p.countMode === 'rounds' ? 'Rnd' : 'Row') + ' ' + prt.row];
    var target = currentTarget(prt);
    bits.push(target ? prt.stitch + '/' + target + ' sts' : prt.stitch + ' sts');
    return bits.join(' · ');
  }

  /** Home-card summary line: the craft's own, else the crochet one. */
  function summaryFor(p) {
    if (!p) return '';
    // wave K: not loaded yet - the line written the last time it was
    var hrt = hv[p.id];
    if (hrt && !rtReady(hrt)) {
      if (hrt.table && hrt.table.summary) return hrt.table.summary;
      return hrt.state === 'missing' ? 'Part of this project is missing on this device' : 'Loading…';
    }
    var c = crafts[p.craft];
    if (c && c.summary) {
      try {
        var s = c.summary(p);
        if (typeof s === 'string' && s) return s;
      } catch (e) {
        /* fall through to the generic line */
      }
    }
    return crochetSummary(p);
  }

  function updateProject(projectId, patch) {
    var proj = project(projectId);
    if (!proj || !patch) return null;
    if (typeof patch.name === 'string') proj.name = safeName(patch.name, proj.name);
    if (typeof patch.emoji === 'string' && patch.emoji) proj.emoji = patch.emoji;
    if (patch.countMode === 'rows' || patch.countMode === 'rounds') proj.countMode = patch.countMode;
    if (patch.groupSize !== undefined) proj.groupSize = clampInt(patch.groupSize, 0, 50, proj.groupSize);
    if (typeof patch.notes === 'string') proj.notes = patch.notes;
    touch(proj);
    return proj;
  }

  function setStatus(projectId, status) {
    var proj = project(projectId);
    if (!proj) return null;
    if (['active', 'paused', 'finished', 'frogged'].indexOf(status) === -1) return proj;
    proj.status = status;
    if (status === 'finished') {
      if (!proj.finishedAt) proj.finishedAt = now();
    } else {
      proj.finishedAt = null;
    }
    if (status !== 'active') bankTimer(proj);
    touch(proj);
    return proj;
  }

  /**
   * What lowering a part's make-count would throw away (13 #9). The UI asks
   * before calling updatePart, which still clamps — this only reports.
   * @returns {{piecesLost:number, piecesDone:number, makeCount:number}}
   */
  function makeCountImpact(projectId, partId, newCount) {
    var prt = part(project(projectId), partId);
    if (!prt) return { piecesLost: 0, piecesDone: 0, makeCount: 0 };
    var n = clampInt(newCount, 1, 99, prt.makeCount);
    return {
      piecesLost: Math.max(0, prt.piecesDone - n),
      piecesDone: prt.piecesDone,
      makeCount: n
    };
  }

  /**
   * Mark a project finished. Without `force` it refuses while any part still
   * blocks completion and says which ones — that is the "Finish anyway" path
   * 02 #2 asks for.
   * @returns {{ok:boolean, blocking:string[], project:object|null}}
   */
  function finishProject(projectId, opts) {
    var proj = project(projectId);
    if (!proj) return { ok: false, blocking: [], project: null };
    var force = !!(opts && opts.force);
    var blocking = blockingParts(proj);
    if (!force && (blocking.length || !allPartsDone(proj))) {
      return { ok: false, blocking: blocking, project: proj };
    }
    snapshot(proj);
    proj.status = 'finished';
    if (!proj.finishedAt) proj.finishedAt = now();
    bankTimer(proj);
    touch(proj);
    return { ok: true, blocking: [], project: proj };
  }

  function deleteProject(projectId) {
    var proj = project(projectId);
    if (!proj) return false;
    snapshot(proj);
    var list = projects();
    list.splice(list.indexOf(proj), 1);
    if (getState().activeProjectId === projectId) getState().activeProjectId = null;
    save();
    return true;
  }

  function setActiveProject(projectId) {
    getState().activeProjectId = projectId || null;
    save();
  }

  /* ------------------------------------------------------------------ *
   * Parts
   * ------------------------------------------------------------------ */

  function addPart(projectId, opts) {
    var proj = project(projectId);
    if (!proj) return null;
    opts = opts || {};
    snapshot(proj);
    var prt = makePart(safeName(opts.name, '') || 'Part ' + (proj.parts.length + 1), opts.makeCount);
    // wave F: a new part is read at the project's size like the others
    if (proj.size) prt.sizeIndex = proj.size.index;
    // wave G: ...and joins the size whose tab is open (opts.group: null for a
    // part shared by every size)
    var ag = opts.group !== undefined ? normalizeGroupName(opts.group) : proj.activeGroup;
    prt.group = ag && (proj.groups || []).some(function (g) { return g.name === ag; }) ? ag : null;
    if (isKnitProject(proj)) knitPartDefaults(prt);   // wave H
    proj.parts.push(prt);
    proj.activePartId = prt.id;
    touch(proj);
    return prt;
  }

  function updatePart(projectId, partId, patch, internal) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt || !patch) return null;
    // (`internal` is Store-only: updatePartWithProjectSize took the snapshot)
    if (!(internal && internal.noSnapshot)) snapshot(proj);
    if (typeof patch.name === 'string') prt.name = safeName(patch.name, prt.name);
    if (typeof patch.importKey === 'string') prt.importKey = patch.importKey;
    if (patch.makeCount !== undefined) {
      var mcBefore = prt.makeCount;
      prt.makeCount = clampInt(patch.makeCount, 1, 99, prt.makeCount);
      if (prt.piecesDone > prt.makeCount) prt.piecesDone = prt.makeCount;
      // the owner's own number is no longer the importer's inference
      if (prt.makeCount !== mcBefore) delete prt.makeCountInferred;
    }
    if (patch.targetRows !== undefined) {
      prt.targetRows =
        patch.targetRows === null || patch.targetRows === '' ? null : clampInt(patch.targetRows, 1, 999999, 0) || null;
    }
    if (patch.repeat) {
      prt.repeat = normalizeRepeat({
        enabled: !!patch.repeat.enabled,
        startRow: clampInt(patch.repeat.startRow, 1, 999999, prt.repeat.startRow),
        endRow: clampInt(patch.repeat.endRow, 1, 999999, prt.repeat.endRow),
        times: clampInt(patch.repeat.times, 1, 9999, prt.repeat.times),
        // wave F: "until N rows total" (03 #6); omitted = keep what it was
        mode: patch.repeat.mode !== undefined ? patch.repeat.mode : prt.repeat.mode,
        untilRows: patch.repeat.untilRows !== undefined ? patch.repeat.untilRows : prt.repeat.untilRows
      });
    }
    if (patch.alerts !== undefined) {
      var alerts = [];
      var src = Array.isArray(patch.alerts) ? patch.alerts : [];
      for (var i = 0; i < src.length; i++) {
        var n = clampInt(src[i], 1, 99999, 0);
        if (n > 0 && alerts.indexOf(n) === -1) alerts.push(n);
      }
      alerts.sort(function (a, b) { return a - b; });
      prt.alerts = alerts;
    }
    if (typeof patch.placementNotes === 'string') prt.placementNotes = patch.placementNotes;
    if (typeof patch.patternText === 'string') prt.patternText = patch.patternText;
    if (patch.sizeIndex !== undefined) prt.sizeIndex = clampInt(patch.sizeIndex, 0, 99, prt.sizeIndex || 0);
    // The two-chip "This piece: In rounds / In rows" control. Undoable like
    // everything else here, because updatePart snapshotted above.
    if (patch.workMode !== undefined) {
      prt.workMode = normalizeWorkMode(patch.workMode, normalizeWorkMode(prt.workMode, 'auto'));
    }
    // The three-chip "This piece: Auto / Top down / Bottom up" control. Undoable
    // for the same reason, and it overrides whatever the pattern text says.
    if (patch.orientation !== undefined) {
      prt.orientation = normalizeOrientation(patch.orientation, normalizeOrientation(prt.orientation, 'auto'));
    }
    // The three-chip "Stitch names: Auto / UK / US" control, and the door the
    // importer uses to write the document's dialect onto a section that could
    // not decide for itself. Undoable for the same reason as the two above.
    if (patch.dialect !== undefined) {
      prt.dialect = normalizeDialect(patch.dialect, normalizeDialect(prt.dialect, 'auto'));
    }
    if (patch.piecesDone !== undefined) prt.piecesDone = clampInt(patch.piecesDone, 0, prt.makeCount, prt.piecesDone);
    touch(proj);
    return prt;
  }

  function deletePart(projectId, partId) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt || proj.parts.length <= 1) return false;
    snapshot(proj);
    proj.parts.splice(proj.parts.indexOf(prt), 1);
    if (proj.activePartId === partId) {
      // wave G: stay in the same size when it has another part
      var same = prt.group ? proj.parts.filter(function (p) { return p.group === prt.group; })[0] : null;
      proj.activePartId = (same || proj.parts[0]).id;
    }
    // wave G: a size whose last part went is no longer a size
    proj.groups = normalizeGroups(proj.groups, proj.parts);
    var apd = activePart(proj);
    proj.activeGroup = apd && apd.group ? apd.group : (proj.groups.length ? proj.groups[0].name : null);
    delete lineCache[partId];
    delete colorPlanCache[partId];
    delete diagramCache[partId];
    touch(proj);
    return true;
  }

  /**
   * Add the placing lines of `incoming` that `have` does not carry yet.
   * Compared case-insensitively on the trimmed line, so re-importing the same
   * PDF twice does not double the notes up.
   */
  function mergePlacement(have, incoming) {
    var kept = str(have, '').split(/\r\n|\r|\n/);
    var seen = {};
    var out = [];
    var i, t;
    for (i = 0; i < kept.length; i++) {
      t = kept[i];
      out.push(t);
      if (t.trim()) seen[t.trim().toLowerCase()] = true;
    }
    var add = str(incoming, '').split(/\r\n|\r|\n/);
    for (i = 0; i < add.length; i++) {
      t = add[i];
      if (!t.trim() || seen[t.trim().toLowerCase()]) continue;
      seen[t.trim().toLowerCase()] = true;
      out.push(t);
    }
    // Drop the empty lines an empty starting value would leave behind.
    while (out.length && !out[0].trim()) out.shift();
    while (out.length && !out[out.length - 1].trim()) out.pop();
    return out.join('\n');
  }

  /**
   * True when every section carrying text reads as worked in rounds. A section
   * the parser cannot place ('rows' or null) blocks the answer — flipping a
   * project's counting label on a guess is worse than leaving it.
   */
  function sectionsAllRounds(sections, craft) {
    var api = patternsApi(craft);
    if (!api || typeof api.workMode !== 'function') return false;
    var seen = 0;
    for (var i = 0; i < sections.length; i++) {
      var text = str(sections[i] && sections[i].text, '');
      if (!text.replace(/\s/g, '')) continue;
      var m = null;
      try {
        m = api.workMode(text);
      } catch (e) {
        return false;
      }
      if (m !== 'rounds') return false;
      seen++;
    }
    return seen > 0;
  }

  /**
   * `Patterns.dialectHints(text).dialect` → 'uk' | 'us' | null, never throwing.
   * Null means "this text does not say", which is the whole point: it is the
   * question the importer asks of a SECTION before it lends it the document's
   * answer, and the question `partDialect` asks of a part's own text.
   */
  function textDialect(text, craft) {
    var api = patternsApi(craft);
    if (!api || typeof api.dialectHints !== 'function') return null;
    var s = str(text, '');
    if (!/\S/.test(s)) return null;
    var d = null;
    try {
      d = api.dialectHints(s);
    } catch (e) {
      return null;
    }
    var v = d && typeof d === 'object' ? str(d.dialect, '') : '';
    return v === 'uk' || v === 'us' ? v : null;
  }

  /* ---- wave H: gauge + needle from a knitting pattern's front matter ---- */

  // "Needles: 4 mm (US 6)", "4.5mm (US 7)", "Sizes U.S. 8 (5 mm) and U.S. 10 (6 mm)", "US 6"
  var NEEDLE_SIZE_RE = new RegExp(
    '\\bU\\.?\\s?S\\.?\\s*(?:size\\s*)?(\\d+(?:\\.\\d+)?)\\s*[\\(\\[]\\s*(\\d+(?:[.,]\\d+)?)\\s*mm\\s*[\\)\\]]' +
    '|(\\d+(?:[.,]\\d+)?)\\s*mm\\b(?:\\s*[\\(\\[]\\s*U\\.?\\s?S\\.?\\s*(?:size\\s*)?(\\d+(?:\\.\\d+)?)\\s*[\\)\\]])?' +
    '|\\bU\\.?\\s?S\\.?\\s*(?:size\\s*)?(\\d+(?:\\.\\d+)?)\\b', 'gi');
  // (wave H, knit-qa-2: "ndl" / "ndls" is Sandnes' word for a needle)
  var NEEDLE_LINE_RE = /\bneedles?\b|\bndls?\b|\bcircular\b|\bdpns?\b|\bdouble[- ]pointed\b/i;

  /** Every needle size the needle lines name, in order: [{ mm, label }]. */
  function needleSizes(text) {
    var rows = str(text, '').split(/\r?\n/);
    var out = [];
    for (var i = 0; i < rows.length && i < 400; i++) {
      var t = rows[i];
      // the size may sit on the line after a bare "NEEDLES" label
      // (wave H, knit-qa-2: or the line the PDF wrapped before "needles":
      // "Sizes U.S. 6 (4 mm) and U.S. 7 (4.5 mm) Susan Bates®" /
      // "Silvalume® knitting needles or size needed to obtain gauge.")
      if (!NEEDLE_LINE_RE.test(t) && !(i > 0 && /^\s*needles?\s*:?\s*$/i.test(rows[i - 1])) &&
          !(i + 1 < rows.length && /^[^.]{0,40}\bneedles?\b/i.test(rows[i + 1]) && /\bmm\b|\bU\.?\s?S\.?\s*\d/i.test(t))) continue;
      NEEDLE_SIZE_RE.lastIndex = 0;
      var m;
      while ((m = NEEDLE_SIZE_RE.exec(t)) !== null) {
        var mm = m[2] || m[3] || null;
        var us = m[1] || m[4] || m[5] || null;
        var v = mm ? parseFloat(mm.replace(',', '.')) : null;
        if (mm && !(v > 0 && v < 30)) continue;
        out.push({
          mm: v,
          label: mm ? mm.replace(',', '.') + ' mm' + (us ? ' (US ' + us + ')' : '') : 'US ' + us
        });
      }
    }
    return out;
  }

  /**
   * The needle the gauge is knitted on, as printed ("6 mm (US 10)"), or ''.
   * "… in stocking st with larger needles" picks the largest size the
   * pattern lists ("smaller" the smallest); otherwise the first one.
   */
  function needleFromText(text, gaugeSource) {
    var sizes = needleSizes(text);
    if (!sizes.length) return '';
    var raw = str(text, '');
    var hint = '';
    if (gaugeSource) {
      var at = raw.indexOf(gaugeSource);
      hint = at >= 0 ? raw.slice(at, at + gaugeSource.length + 80) : gaugeSource;
    }
    var want = /\blarger\b/i.test(hint) ? 1 : (/\bsmaller\b/i.test(hint) ? -1 : 0);
    // wave H (knit-qa-2): "TENSION: 14 sts St-st with 6 mm ndls = 10 cm" names
    // the gauge needle itself (the Sandnes raglan listed its 5 mm rib needle first)
    var tm = /\b(?:tension|gauge)\b[^\n]{0,80}?\bwith\s+(\d+(?:[.,]\d+)?)\s*mm\b/i.exec(hint || raw);
    if (tm) {
      var tmm = parseFloat(tm[1].replace(',', '.'));
      for (var ti = 0; ti < sizes.length; ti++) if (sizes[ti].mm === tmm) return sizes[ti].label;
    }
    if (!want) return sizes[0].label;
    var best = null;
    sizes.forEach(function (s) {
      if (s.mm === null) return;
      if (!best || (want > 0 ? s.mm > best.mm : s.mm < best.mm)) best = s;
    });
    return (best || sizes[0]).label;
  }

  function round1(v) {
    return typeof v === 'number' && isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : null;
  }

  /**
   * Read the gauge (`api.gauge`) and the needle size out of a whole document
   * into `{ sts, rows, over, unit, needle }`, in the unit the pattern printed
   * its swatch in (else the knitter's unit setting). Written to
   * `Project.gauge` when the project carries that field (knit-counter's
   * normaliser), else to `craftData.gauge`. A gauge the knitter already has
   * (any number on it) is never overwritten, and their swatch is kept.
   * @returns {boolean} whether anything was written
   */
  /**
   * wave H (knit-qa): the gauge an import of `fullText` would write, without
   * writing it — `{sts, rows, over, unit, needle}` or null. The import
   * preview shows it ("Gauge 12 sts × 17 rows = 4 in · 6 mm (US 10)").
   */
  function gaugeFromText(fullText, craft) {
    var c = craftKeyOf(craft);
    if (!fullText || c === DEFAULT_CRAFT) return null;
    return readImportGauge(String(fullText), patternsApi(c), c);
  }

  function readImportGauge(fullText, api, craft) {
    var g = null;
    if (api && typeof api.gauge === 'function') {
      try { g = api.gauge(fullText); } catch (e) { g = null; }
    }
    var needle = needleFromText(fullText, g && g.source ? String(g.source) : '');
    var hasG = !!(g && (g.stsPer10cm || g.rowsPer10cm));
    if (!hasG && !needle) return null;
    var src = g && g.source ? String(g.source) : '';
    var pref = (craftSettings(craft) || {}).unit === 'in' ? 'in' : 'cm';
    var cmAt = src.search(/\b10\s*cm\b/i);
    var inAt = src.search(/\b4\s*(?:"|''|in\b|inch)/i);
    var printed = cmAt >= 0 && (inAt < 0 || cmAt < inAt) ? 'cm' : (inAt >= 0 ? 'in' : pref);
    return {
      sts: hasG ? round1(printed === 'in' ? g.stsPer4in : g.stsPer10cm) : null,
      rows: hasG ? round1(printed === 'in' ? g.rowsPer4in : g.rowsPer10cm) : null,
      over: printed === 'in' ? 4 : 10,
      unit: printed,
      needle: needle
    };
  }

  /*
   * wave H (knit-qa-2): the pattern's own abbreviation block ("C4F = Slip
   * next 2 stitches onto a cable needle and leave at front of work. K2, then
   * K2 from cable needle.") as printed, from its heading to the next heading
   * of the front matter. The importer keeps it on the project
   * (`craftData.abbreviations`, plus `craftData.glossary` read from it) so the
   * 3D draws a cable from the PATTERN's definition (the boyfriend's T3F is 1
   * over 1, the mock neck's 2 over a purl) and the glossary sheet lists it.
   * '' when the document has no such block.
   */
  var ABBR_HEAD_RE = /^\s*(?:abbreviations?|abbreviation\s+key|stitch\s+abbreviations)\s*:?\s*$/i;
  var ABBR_END_RE = /^\s*(?:={3}\s*page\b|sizes?\b|to fit\b|gauge\b|tension\b|instructions\b|materials\b|measurements\b|notes?\s*:?\s*$|the instructions are written|finished\s+(?:size|measurements|chest))/i;

  function knitAbbreviationBlock(fullText) {
    var rows = str(fullText, '').split(/\r?\n/);
    for (var i = 0; i < rows.length && i < 2000; i++) {
      if (!ABBR_HEAD_RE.test(rows[i])) continue;
      var out = [];
      for (var j = i + 1; j < rows.length && out.length < 160; j++) {
        var t = rows[j];
        if (ABBR_END_RE.test(t)) break;
        if (!/\S/.test(t)) continue;
        out.push(t.replace(/\s+$/, ''));
      }
      var block = out.join('\n');
      // a heading with no "X = …" lines under it is not the block
      if (/^\s*[A-Za-z][\w/()&.]{0,12}\s*(?:=|:)\s*\S/m.test(block)) return block.slice(0, 8000);
    }
    return '';
  }

  /** Keep the document's abbreviation block on a knitting project (in the import's snapshot). */
  function importAbbreviations(proj, fullText, api) {
    var block = knitAbbreviationBlock(fullText);
    if (!block) return false;
    if (!proj.craftData || typeof proj.craftData !== 'object' || Array.isArray(proj.craftData)) proj.craftData = {};
    if (proj.craftData.abbreviations === block) return false;
    proj.craftData.abbreviations = block;
    var gl = [];
    if (api && typeof api.glossary === 'function') {
      try {
        gl = (api.glossary('ABBREVIATIONS\n' + block) || []).filter(function (g) { return g && g.fromPattern && str(g.abbr, '').trim(); })
          .slice(0, 120).map(function (g) { return { abbr: str(g.abbr, '').trim(), meaning: str(g.meaning, '').trim(), fromPattern: true }; });
      } catch (e) { gl = []; }
    }
    proj.craftData.glossary = gl;
    return true;
  }

  function importGauge(proj, fullText, api) {
    // The swatch as PRINTED, in the unit printed FIRST: "12 sts and 17 rows =
    // 4in [10 cm]" is 12 / 17 over 4 in (docs/research/knitting.md §1); with
    // no unit printed, the knitter's own. The gauge card converts.
    var next = readImportGauge(fullText, api, craftKeyOf(proj));
    if (!next) return false;
    var needle = next.needle;
    var useField = Object.prototype.hasOwnProperty.call(proj, 'gauge');
    if (!useField && (!proj.craftData || typeof proj.craftData !== 'object' || Array.isArray(proj.craftData))) {
      proj.craftData = {};
    }
    var have = useField ? proj.gauge : proj.craftData.gauge;
    have = have && typeof have === 'object' ? have : null;
    if (have && (have.sts || have.rows)) {
      // the knitter's (or an earlier import's) gauge stands; only a missing needle is filled in
      if (needle && !have.needle) { have.needle = needle; return true; }
      return false;
    }
    if (have && have.swatch) next.swatch = have.swatch;
    if (have && have.needle && !next.needle) next.needle = have.needle;
    // knit-counter's setGauge normalises it (inside the import's own snapshot)
    if (useField && typeof setGauge === 'function') setGauge(proj.id, next, { undo: false });
    else if (useField) proj.gauge = next;
    else proj.craftData.gauge = next;
    return true;
  }

  /**
   * Import parsed pattern sections into a project.
   * mode 'parts'  → one part per section: a part with the same name (case
   *                 insensitive) is updated, otherwise a new part is added.
   *                 A section's `placement` lands in the part's
   *                 `placementNotes` — replacing it on a new part, and adding
   *                 only the lines it does not have yet on an existing one.
   * mode 'active' → every section's text lands in the active part.
   *
   * Parts are matched on their `importKey` (content) before their name, and a
   * section whose rows run 1..maxRow contiguously sets `targetRows` on the
   * part it makes (or on one that has none). `opts.noTargets` turns the
   * second half off. When the import CREATES parts and every section reads as
   * worked in rounds, a project labelled 'rows' is corrected to 'rounds' and
   * `modeFlipped` says so.
   *
   * `opts.text` (the WHOLE document) also carries the dialect into the parts:
   * a leaflet that says UK on its abbreviations page says UK about every
   * section in it, including the one whose own instructions are all `tr` and
   * `dc` and so decide nothing. A section that DOES decide for itself keeps its
   * own reading — the King Cole festival pair share an abbreviations page, and
   * the US edition's rows say `sc` — and a part the owner has already put on an
   * explicit 'uk' / 'us' is never touched. `dialectSet` counts the parts that
   * were lent the document's answer.
   * @returns {{created:number, updated:number, placed:number, targeted:number,
   *            modeFlipped:boolean, dialectSet:number}}
   */
  function importPatternSections(projectId, sections, opts) {
    var proj = project(projectId);
    var out = { created: 0, updated: 0, placed: 0, targeted: 0, modeFlipped: false, dialectSet: 0 };
    if (!proj || !Array.isArray(sections) || !sections.length) return out;
    var mode = opts && opts.mode === 'active' ? 'active' : 'parts';
    snapshot(proj);

    // Size names usually live on a different page than the instructions, so look for
    // them in the whole pasted text and remember them on the project.
    var fullText = opts && typeof opts.text === 'string' ? opts.text : '';
    var sizesBefore = JSON.stringify(proj.sizes || null);
    // wave H: the project's own craft reads it (knitting → Knits)
    var craft = craftKeyOf(proj);
    var docApi = patternsApi(craft);
    if (fullText && docApi && typeof docApi.detectSizes === 'function') {
      try {
        var names = docApi.detectSizes(fullText);
        if (Array.isArray(names) && names.length > 1) proj.sizes = names.map(String);
      } catch (e) { /* ignore parser errors */ }
    }
    // wave H (knit-qa): a knitting ebook's groups are PATTERNS, each with its
    // own sizes; the project's sizes are those of the (first) pattern it
    // imports, not the book's first pattern ("7 (8½, 9½)"" for Speed Bump).
    var knitGroupText = null;
    if (craft !== DEFAULT_CRAFT && docApi && typeof docApi.detectSizes === 'function') {
      var g0 = null, gText = [];
      sections.forEach(function (s0) {
        var g = normalizeGroupName(s0 && s0.group);
        if (!g) return;
        if (g0 === null) g0 = g;
        if (g === g0) {
          gText.push(str(s0 && s0.text, ''));
          // (knit-qa-2: and the gauge lines the reader carries for it)
          if (s0 && Array.isArray(s0.gaugeLines)) s0.gaugeLines.forEach(function (gl) { gText.push(str(gl, '')); });
        }
      });
      if (g0 !== null) {
        knitGroupText = gText.join('\n');
        try {
          var gNames = knitSizesFromText(docApi, knitGroupText);
          if (Array.isArray(gNames) && gNames.length > 1) proj.sizes = gNames.map(String);
        } catch (e) { /* ignore parser errors */ }
      }
    }
    // wave H: a counter craft's gauge and needle lines (front matter) go to
    // the project's gauge, never into a part's rows
    // (wave H, knit-qa: a pattern book's gauge is the imported pattern's own,
    // read from its sections; the book's first gauge line is another sock's)
    var gaugeText = knitGroupText !== null ? knitGroupText : fullText;
    if (gaugeText && craft !== DEFAULT_CRAFT && importGauge(proj, gaugeText, docApi)) out.gauge = true;
    // wave H (knit-qa-2): the abbreviation block (cable definitions) rides along
    if (fullText && craft === 'knitting' && importAbbreviations(proj, fullText, docApi)) out.abbreviations = true;
    // Wave F (size-once, 03 #1): the size picked in the import preview, for
    // the whole project. Every part this import touches is read at it, and
    // its target is that size's ("a total of 25 (29, 33 …) Rows").
    var sizeIdx = opts && typeof opts.size === 'number' && opts.size >= 0 && isFinite(opts.size)
      ? Math.min(99, Math.floor(opts.size)) : null;
    var docSizeN = proj.sizes && proj.sizes.length >= 2 ? proj.sizes.length : 0;
    if (sizeIdx !== null) {
      proj.size = normalizeProjectSize({
        index: sizeIdx,
        label: (proj.sizes && proj.sizes[sizeIdx]) || (opts && typeof opts.sizeLabel === 'string' ? opts.sizeLabel : '')
      });
      out.sizeSet = proj.size.label;
    }
    var readSize = sizeIdx !== null ? sizeIdx : (proj.size ? proj.size.index : 0);
    if (JSON.stringify(proj.sizes || null) !== sizesBefore) {
      // every parse of this project's parts read the old size count
      proj.parts.forEach(function (p0) { delete lineCache[p0.id]; });
    }

    // Read ONCE for the whole document, not once per section: `dialectHints`
    // scans the text with ten regexes and a 200-page leaflet is not a contest.
    var docDialect = fullText ? textDialect(fullText, craft) : null;

    /**
     * Lend `prt` the document's dialect, but only where there is nothing to
     * override: not over the owner's own chip, and not over a section whose own
     * instructions name their dialect outright.
     */
    function lendDialect(prt, sectionText) {
      if (!docDialect || !prt) return;
      if (normalizeDialect(prt.dialect, 'auto') !== 'auto') return;
      if (textDialect(sectionText, craft)) return;
      prt.dialect = docDialect;
      out.dialectSet++;
    }

    if (mode === 'active') {
      var prt = activePart(proj);
      if (!prt) return out;
      var joined = sections
        .map(function (s) { return str(s && s.text, ''); })
        .filter(function (t) { return t.replace(/\s/g, ''); })
        .join('\n\n');
      prt.patternText = joined;
      var place = sections
        .map(function (s) { return str(s && s.placement, ''); })
        .filter(function (t) { return !!t.trim(); })
        .join('\n');
      if (place) {
        var merged = mergePlacement(prt.placementNotes, place);
        if (merged !== str(prt.placementNotes, '')) { prt.placementNotes = merged; out.placed = 1; }
      }
      if (sizeIdx !== null || proj.size) prt.sizeIndex = readSize;
      if (!(opts && opts.noTargets) && !prt.targetRows) {
        var activeTarget = targetRowsFromText(joined, readSize, docSizeN, craft);
        if (activeTarget) { prt.targetRows = activeTarget; out.targeted = 1; }
      }
      lendDialect(prt, joined);
      delete lineCache[prt.id];
      out.updated = 1;
      touch(proj);
      return out;
    }

    var noTargets = !!(opts && opts.noTargets);

    // Wave G (size groups): `opts.groups` names the sizes to keep ("Import
    // this size" in the preview); omitted = every size. A part only ever
    // matches a part of its own size, so the three Bodies of a three-size
    // booklet are three parts (the owner got the Big one only: each Body
    // matched the one before it by name and the last one won).
    var keepGroups = null;
    if (opts && Array.isArray(opts.groups)) {
      keepGroups = {};
      opts.groups.forEach(function (g) { var n = normalizeGroupName(g); if (n) keepGroups[n] = true; });
    }
    var importedGroups = [];
    out.groups = [];

    // wave H (knit-qa): in a knitting import a part made or updated by THIS
    // import is never matched again: the Time Traveler sock has two "Foot"
    // sections and the second overwrote the first. It is "Foot 2".
    var knitImport = craft === 'knitting';
    var takenNow = [];
    for (var i = 0; i < sections.length; i++) {
      var sec = sections[i] || {};
      var name = str(sec.name, '').trim();
      var text = str(sec.text, '');
      var makeCount = clampInt(sec.makeCount, 1, 99, 1);
      var key = sectionImportKey(name, text, knitImport);
      var secGroup = normalizeGroupName(sec.group);
      if (secGroup && keepGroups && !keepGroups[secGroup]) continue;
      if (secGroup && importedGroups.indexOf(secGroup) < 0) importedGroups.push(secGroup);
      var existing = null;
      var j;
      // Content key first (13 #7) — a section the parser could not name still
      // matches itself on a re-import. Only then the name. (wave G: only
      // within the section's own size)
      if (key) {
        for (j = 0; j < proj.parts.length; j++) {
          if (proj.parts[j].importKey && proj.parts[j].importKey === key && !(knitImport && takenNow.indexOf(proj.parts[j]) >= 0) &&
              (proj.parts[j].group || null) === secGroup) {
            existing = proj.parts[j];
            break;
          }
        }
      }
      if (!existing && name) {
        for (j = 0; j < proj.parts.length; j++) {
          if (proj.parts[j].name.toLowerCase() === name.toLowerCase() && !(knitImport && takenNow.indexOf(proj.parts[j]) >= 0) &&
              (proj.parts[j].group || null) === secGroup) {
            existing = proj.parts[j];
            break;
          }
        }
      }
      // 01 #1 / 02 #1: without this every PDF project is un-finishable.
      var target = noTargets ? null : targetRowsFromText(text, readSize, docSizeN, craft);
      var place = str(sec.placement, '');
      if (existing) {
        existing.patternText = text;
        existing.makeCount = makeCount;
        if (sec.makeCountInferred) existing.makeCountInferred = true;
        else delete existing.makeCountInferred;
        if (knitImport) { if (sec.rowWord === 'rnd') existing.rowWord = 'rnd'; else delete existing.rowWord; }   // wave K (E13)
        if (sizeIdx !== null || proj.size) existing.sizeIndex = readSize;
        existing.importKey = key || existing.importKey;
        if (existing.piecesDone > existing.makeCount) existing.piecesDone = existing.makeCount;
        // A target the user set by hand is never overwritten.
        if (target && !existing.targetRows) {
          existing.targetRows = target;
          out.targeted++;
        }
        // The part is already there and may carry notes the owner typed, so
        // only the lines that are not in it yet are added.
        if (place) {
          var merged = mergePlacement(existing.placementNotes, place);
          if (merged !== str(existing.placementNotes, '')) {
            existing.placementNotes = merged;
            out.placed++;
          }
        }
        lendDialect(existing, text);
        delete lineCache[existing.id];
        takenNow.push(existing);
        out.updated++;
      } else {
        var added = makePart(knitImport && name ? knitUniqueName(proj, name, secGroup) : (name || 'Part ' + (proj.parts.length + 1)), makeCount);
        added.patternText = text;
        added.importKey = key;
        added.group = secGroup;
        if (sec.makeCountInferred) added.makeCountInferred = true;
        if (knitImport && sec.rowWord === 'rnd') added.rowWord = 'rnd';   // wave K (E13): a part worked in rounds
        if (sizeIdx !== null || proj.size) added.sizeIndex = readSize;
        if (target) { added.targetRows = target; out.targeted++; }
        if (place) { added.placementNotes = place; out.placed++; }
        lendDialect(added, text);
        proj.parts.push(added);
        takenNow.push(added);
        out.created++;
      }
    }
    // If the import created real parts, drop the untouched template placeholder
    // ("Main" with no progress and no pattern) so it doesn't linger as a stray tab.
    if (out.created > 0) {
      var kept = proj.parts.filter(function (p) {
        var pristine = p.name === 'Main' && !p.row && !p.stitch && !p.piecesDone && !str(p.patternText, '').trim();
        return !pristine;
      });
      if (kept.length && kept.length < proj.parts.length) {
        proj.parts.forEach(function (p) { if (kept.indexOf(p) < 0) delete lineCache[p.id]; });
        proj.parts = kept;
        if (!part(proj, proj.activePartId)) proj.activePartId = kept[0].id;
      }
      // 05-ux-meaning #2: the snowman and the baphomet both imported as 'rows'
      // although every line reads `R12-R17: 66 sc around`, and one project-level
      // word then modelled two spheres as a flat sheet. The parts themselves
      // stay on 'auto' — this only corrects the project's own label.
      if (proj.countMode !== 'rounds' && sectionsAllRounds(sections, craft)) {
        proj.countMode = 'rounds';
        out.modeFlipped = true;
      }
    }
    // Wave G: the sizes, in document order after any the project had; the
    // parts ordered by size (shared parts first), then as they were; the first
    // imported size is the open tab when the open part is not in one.
    if (importedGroups.length) {
      var gl = (proj.groups || []).map(function (g) { return g.name; });
      importedGroups.forEach(function (g) { if (gl.indexOf(g) < 0) gl.push(g); });
      proj.groups = normalizeGroups(gl, proj.parts);
      var order = {};
      proj.groups.forEach(function (g, gi) { order[g.name] = gi + 1; });
      proj.parts = proj.parts
        .map(function (p, pi) { return { p: p, pi: pi }; })
        .sort(function (a, b) {
          return ((order[a.p.group] || 0) - (order[b.p.group] || 0)) || (a.pi - b.pi);
        })
        .map(function (x) { return x.p; });
      var apg = activePart(proj);
      var untouched = apg && !apg.row && !apg.stitch && !apg.piecesDone;
      if (!apg || (!apg.group && untouched)) {
        var firstG = importedGroups[0];
        var firstP = proj.parts.filter(function (p) { return p.group === firstG; })[0];
        if (firstP) proj.activePartId = firstP.id;
      }
      var apn = activePart(proj);
      proj.activeGroup = apn && apn.group ? apn.group : (proj.groups.length ? proj.groups[0].name : null);
      out.groups = importedGroups.slice();
    }
    knitAfterImport(proj, sections, fullText);   // wave K (knit-store, P1): no row target across an open stretch
    touch(proj);
    return out;
  }

  /**
   * Apply Patterns.summary(...).suggestions to a part.
   * Returns what was actually applied: { targetRows, repeat }.
   */
  function applySuggestions(projectId, partId, suggestions) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt || !suggestions || typeof suggestions !== 'object') return null;
    var applied = { targetRows: null, repeat: null };
    snapshot(proj);

    if (typeof suggestions.targetRows === 'number' && suggestions.targetRows > 0) {
      prt.targetRows = clampInt(suggestions.targetRows, 1, 999999, prt.targetRows || 0) || null;
      applied.targetRows = prt.targetRows;
    }

    var r = suggestions.repeat;
    if (r && typeof r === 'object') {
      var startRow = clampInt(r.startRow, 1, 999999, 0);
      var endRow = clampInt(r.endRow, 1, 999999, 0);
      if (startRow && endRow && endRow >= startRow) {
        var len = endRow - startRow + 1;
        var times = typeof r.times === 'number' && r.times > 0 ? Math.floor(r.times) : null;
        if (times === null && typeof r.untilRows === 'number' && r.untilRows > 0) {
          times = Math.floor((r.untilRows - startRow + 1) / len);
        }
        times = clampInt(times, 1, 9999, 1);
        // Wave F (03 #6): "until there are a total of 25 Rows" keeps its
        // intent - the part counts toward 25, and a size change moves it.
        var until = typeof r.untilRows === 'number' && r.untilRows > 0 && !(typeof r.times === 'number' && r.times > 0)
          ? Math.floor(r.untilRows) : null;
        prt.repeat = normalizeRepeat({
          enabled: true, startRow: startRow, endRow: endRow, times: times,
          mode: until ? 'untilRows' : 'times', untilRows: until
        });
        applied.repeat = {
          enabled: true, startRow: startRow, endRow: endRow, times: prt.repeat.times,
          mode: prt.repeat.mode, untilRows: prt.repeat.untilRows
        };
      }
    }

    touch(proj);
    return applied;
  }

  /* ------------------------------------------------------------------ *
   * Size-once (wave F, 03 #1 / 11 #3)
   *
   * The maker picks the size ONCE — in the import preview, or later in the
   * part editor — and every count, row target and "Next row" the counter
   * shows is that size's. `Project.size` is the pick; each part's
   * `sizeIndex` follows it (a part can still be set on its own, the rare
   * "body in L, sleeves in M"). Changing the size never touches progress:
   * rows, stitches and pieces stay; only the numbers they are measured
   * against move.
   * ------------------------------------------------------------------ */

  /**
   * The size names a project offers: the document's own (`Project.sizes`),
   * else "Size 1".."Size N" up to the longest size list in its parts.
   * @returns {string[]} [] when the pattern is single-size
   */
  function sizeNames(proj) {
    if (!proj) return [];
    if (Array.isArray(proj.sizes) && proj.sizes.length >= 2) return proj.sizes.slice();
    // The longest size list on any line (cached parses; no summary pass, so
    // this stays cheap on the tap path).
    var n = 0;
    for (var i = 0; i < proj.parts.length; i++) {
      var ls = linesFor(proj.parts[i]);
      for (var j = 0; j < ls.length; j++) {
        var sz = ls[j] && ls[j].sizes;
        if (Array.isArray(sz) && sz.length > n) n = sz.length;
      }
    }
    var out = [];
    if (n >= 2) for (var k = 0; k < n; k++) out.push('Size ' + (k + 1));
    return out;
  }

  /**
   * What size a part is read at, and why.
   * @returns {{index:number, label:string|null, source:'project'|'part'|null,
   *            names:string[]}} source null = a single-size pattern
   */
  function partSize(proj, prt) {
    var names = sizeNames(proj);
    var idx = sizeIndexOf(prt);
    var out = { index: idx, label: null, source: null, names: names };
    if (!names.length) return out;
    out.label = names[Math.min(idx, names.length - 1)] || null;
    if (proj && proj.size && proj.size.index !== idx) out.source = 'part';
    else if (proj && proj.size) out.source = 'project';
    return out;
  }

  /**
   * Pick the project's size. Every part is moved to it, and a target that
   * came from the pattern (the size's own "a total of N Rows") follows: a
   * part whose `targetRows` was the old size's reading gets the new size's,
   * and an 'untilRows' repeat that was the old suggestion takes the new one.
   * A target typed by hand is left alone. Progress is never touched.
   * Undoable (one snapshot).
   * @returns {{index:number, label:string, retargeted:number}|null}
   */
  function setProjectSize(projectId, index, internal) {
    var proj = project(projectId);
    if (!proj) return null;
    var names = sizeNames(proj);
    var idx = clampInt(index, 0, 99, 0);
    if (names.length && idx > names.length - 1) idx = names.length - 1;
    if (!(internal && internal.noSnapshot)) snapshot(proj);
    var docN = proj.sizes && proj.sizes.length >= 2 ? proj.sizes.length : 0;
    var res = { index: idx, label: names[idx] || 'Size ' + (idx + 1), retargeted: 0 };
    proj.size = normalizeProjectSize({ index: idx, label: res.label });
    for (var i = 0; i < proj.parts.length; i++) {
      var prt = proj.parts[i];
      var old = sizeIndexOf(prt);
      var text = str(prt.patternText, '');
      if (text.replace(/\s/g, '') && old !== idx) {
        var was = targetRowsFromText(text, old, docN, proj.craft);
        var now = targetRowsFromText(text, idx, docN, proj.craft);
        // only a target that IS the pattern's reading moves ("Don't set
        // targets" and a hand-typed number both stay as they are)
        if (now && was !== null && prt.targetRows === was) {
          if (prt.targetRows !== now) res.retargeted++;
          prt.targetRows = now;
        }
        var rep = prt.repeat;
        if (rep && rep.mode === 'untilRows') {
          var sugOld = untilSuggestion(text, old, docN, proj.craft);
          var sugNew = untilSuggestion(text, idx, docN, proj.craft);
          if (sugNew && rep.untilRows === sugOld) {
            prt.repeat = normalizeRepeat({
              enabled: rep.enabled, startRow: rep.startRow, endRow: rep.endRow,
              times: rep.times, mode: 'untilRows', untilRows: sugNew
            });
          }
        }
      }
      prt.sizeIndex = idx;
      delete lineCache[prt.id];
    }
    touch(proj);
    return res;
  }

  /**
   * The part editor's Save when its Size select picks the PROJECT's size:
   * the part's edits and the size change are ONE undo step. The box's
   * pattern text goes in first (the size reads it), then the size moves every
   * part and its pattern targets, then the rest of the sheet - so a target
   * the owner typed still wins, and one left alone follows the size.
   * @returns {{part:Object, size:Object}|null}
   */
  function updatePartWithProjectSize(projectId, partId, patch, index) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt || !patch) return null;
    snapshot(proj);
    if (typeof patch.patternText === 'string' && patch.patternText !== prt.patternText) {
      prt.patternText = patch.patternText;
      delete lineCache[prt.id];
    }
    var res = setProjectSize(projectId, index, { noSnapshot: true });
    var rest = {};
    for (var k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k) && k !== 'sizeIndex') rest[k] = patch[k];
    }
    updatePart(projectId, partId, rest, { noSnapshot: true });
    return { part: prt, size: res };
  }

  /** The parser's "until there are a total of N Rows" for a text at a size. */
  function untilSuggestion(text, size, sizeCount, craft) {
    var api = patternsApi(craft);
    if (!api || typeof api.summary !== 'function') return null;
    var lines = parseLoose(text, { size: size, sizeCount: sizeCount }, craft);
    if (!lines.length) return null;
    try {
      var s = api.summary(lines);
      var r = s && s.suggestions && s.suggestions.repeat;
      return r && typeof r.untilRows === 'number' && r.untilRows > 0 ? Math.floor(r.untilRows) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Wave F (03 #5): is this part's row target the pattern's own reading AND
   * an estimate - rows read off a tape measure through a gauge ("until it
   * measures 59""), or rows numbered after an unresolved length ("Cont even
   * until work from beg measures 13"" then "Next 6 rows")? The counter then
   * says "≈ 81". Cached per parse; a target typed by hand is never "≈".
   */
  function targetApprox(prt) {
    if (!prt || !prt.targetRows) return false;
    var entry = partLines(prt);
    if (!entry.lines.length) return false;
    if (entry.approxInfo === undefined) {
      var any = false;
      for (var i = 0; i < entry.lines.length; i++) {
        var l = entry.lines[i];
        if (l && (l.approxRow || (l.kind === 'repeat' && l.repeatFromLength && l.repeatTo >= 1))) { any = true; break; }
      }
      var s = any ? patternSummary(prt) : null;
      entry.approxInfo = any ? { maxRow: s.maxRow } : null;
    }
    return !!(entry.approxInfo && entry.approxInfo.maxRow === prt.targetRows);
  }

  /* ------------------------------------------------------------------ *
   * Count confidence (wave F, 06 #1 / #8): "71 rounds · 12 counts computed ·
   * 1 count disagrees with the pattern"
   * ------------------------------------------------------------------ */

  /**
   * `Patterns.countReport` for a part (its own size) or for loose text.
   * @param {Object|string} partOrText
   * @param {{size?:number, sizeCount?:number, craft?:string}} [opts] for loose text
   */
  function countReport(partOrText, opts) {
    var empty = { rows: 0, printed: 0, computed: 0, missing: 0, unresolved: 0, disagree: [] };
    var loose = typeof partOrText === 'string';
    var craft = loose ? (opts && opts.craft) || DEFAULT_CRAFT : partOrText;
    var api = patternsApi(craft);
    if (!api || typeof api.countReport !== 'function') return empty;
    var lines = loose
      ? parseLoose(partOrText, opts && (opts.size || opts.sizeCount) ? { size: opts.size || 0, sizeCount: opts.sizeCount || 0 } : null, craft)
      : linesFor(partOrText);
    try {
      return api.countReport(lines) || empty;
    } catch (e) {
      return empty;
    }
  }

  /* ------------------------------------------------------------------ *
   * Colour changes on the counter (wave F, 02 #3 / 10 #1)
   * ------------------------------------------------------------------ */

  var colorPlanCache = Object.create(null);

  /**
   * The yarn every row is worked in, read the way the 3D piece reads it
   * (`Patterns.expand`'s colour state, row by row), plus the change a row
   * ENDS with ("join with Yarn B at end of final st", "changing to black in
   * last 2 loops"). Cached per parse and repeat, so it costs one walk per
   * pattern edit, never per tap.
   * @returns {Array<{color:string|null, endTo:string|null}>} index = row (1-based)
   */
  function colorPlan(prt) {
    var entry = partLines(prt);
    var lines = entry.lines;
    var api = patternsApi(prt);
    if (!lines.length || !api || typeof api.expand !== 'function') return [];
    var rep = prt.repeat || {};
    var key = entry.version + '|' + (rep.enabled ? rep.startRow + '-' + rep.endRow + 'x' + rep.times : '');
    var hit = colorPlanCache[prt.id];
    if (hit && hit.key === key) return hit.plan;
    var sum = patternSummary(prt);
    var last = Math.min(Math.max(sum.maxRow || 0, (prt.row || 0) + 1), ROW_INDEX_MAX);
    var plan = [null];
    var state = null;
    var prev = null;
    var any = false;
    for (var row = 1; row <= last; row++) {
      var ex = null;
      try {
        ex = api.expand(lines, patternRowForRow(prt, row), prev, state);
      } catch (e) {
        ex = null;
      }
      if (!ex || typeof ex !== 'object') { plan.push({ color: null, endTo: null }); continue; }
      state = ex.state;
      var n = 0;
      if (Array.isArray(ex.stitches)) {
        for (var s = 0; s < ex.stitches.length; s++) if (ex.stitches[s] && ex.stitches[s].t !== 'ch') n++;
      }
      if (n) prev = n;
      var endTo = state && state.pendingColor && state.pendingFrom === patternRowForRow(prt, row) ? state.pendingColor : null;
      if (ex.color || endTo) any = true;
      plan.push({ color: ex.color || null, endTo: endTo });
    }
    if (!any) plan = [];
    colorPlanCache[prt.id] = { key: key, plan: plan };
    return plan;
  }

  /**
   * What the counter says about yarn on the row being worked:
   *   color   the yarn this row is worked in (null = the pattern never says)
   *   change  { to, at: 'start'|'end' } when this row starts in a new yarn,
   *           or ends by joining the next one; null otherwise
   * @returns {{color:string|null, change:({to:string, at:string}|null)}}
   */
  function rowColorInfo(prt, rowNumber) {
    var out = { color: null, change: null };
    if (!prt) return out;
    var plan = colorPlan(prt);
    var r = typeof rowNumber === 'number' ? rowNumber : (prt.row || 0) + 1;
    if (!plan.length || r < 1 || r >= plan.length) return out;
    var cur = plan[r] || { color: null, endTo: null };
    var before = r > 1 ? plan[r - 1] : null;
    out.color = cur.color;
    if (cur.endTo && cur.endTo !== cur.color) {
      out.change = { to: cur.endTo, at: 'end' };
    } else if (r > 1 && cur.color && before && before.color !== cur.color &&
               !(before.endTo && before.endTo === cur.color)) {
      out.change = { to: cur.color, at: 'start' };
    }
    return out;
  }

  function setActivePart(projectId, partId) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt) return false;
    proj.activePartId = partId;
    // wave G: the size tab follows the part
    if (prt.group) proj.activeGroup = prt.group;
    touch(proj);
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Checklist / notes / history
   * ------------------------------------------------------------------ */

  function addChecklistItem(projectId, text) {
    var proj = project(projectId);
    if (!proj) return null;
    text = (text || '').trim();
    if (!text) return null;
    var item = { id: uid(), text: text, done: false };
    proj.checklist.push(item);
    touch(proj);
    return item;
  }

  function toggleChecklistItem(projectId, itemId) {
    var proj = project(projectId);
    if (!proj) return false;
    for (var i = 0; i < proj.checklist.length; i++) {
      if (proj.checklist[i].id === itemId) {
        proj.checklist[i].done = !proj.checklist[i].done;
        touch(proj);
        return true;
      }
    }
    return false;
  }

  function deleteChecklistItem(projectId, itemId) {
    var proj = project(projectId);
    if (!proj) return false;
    for (var i = 0; i < proj.checklist.length; i++) {
      if (proj.checklist[i].id === itemId) {
        proj.checklist.splice(i, 1);
        touch(proj);
        return true;
      }
    }
    return false;
  }

  function renameChecklistItem(projectId, itemId, text) {
    var proj = project(projectId);
    if (!proj) return false;
    var next = str(text, '').trim();
    if (!next) return false;
    for (var i = 0; i < proj.checklist.length; i++) {
      if (proj.checklist[i].id === itemId) {
        proj.checklist[i].text = next;
        touch(proj);
        return true;
      }
    }
    return false;
  }

  /** delta -1 = up, +1 = down. Returns true when the item actually moved. */
  function moveChecklistItem(projectId, itemId, delta) {
    var proj = project(projectId);
    if (!proj) return false;
    var d = delta < 0 ? -1 : 1;
    for (var i = 0; i < proj.checklist.length; i++) {
      if (proj.checklist[i].id !== itemId) continue;
      var to = i + d;
      if (to < 0 || to >= proj.checklist.length) return false;
      var item = proj.checklist.splice(i, 1)[0];
      proj.checklist.splice(to, 0, item);
      touch(proj);
      return true;
    }
    return false;
  }

  /** opts.completedOnly → keep the unticked items. Returns how many went. */
  function clearChecklist(projectId, opts) {
    var proj = project(projectId);
    if (!proj) return 0;
    var completedOnly = !!(opts && opts.completedOnly);
    var before = proj.checklist.length;
    if (completedOnly) {
      proj.checklist = proj.checklist.filter(function (c) { return !c.done; });
    } else {
      proj.checklist = [];
    }
    var removed = before - proj.checklist.length;
    if (removed) touch(proj);
    return removed;
  }

  /**
   * Replace the checklist with the one from the template the project was made
   * from. Returns the new item count, or null when there is no template to
   * reload from.
   */
  function reloadChecklistFromTemplate(projectId) {
    var proj = project(projectId);
    if (!proj || !proj.templateId) return null;
    var tpl = template(proj.templateId);
    if (!tpl) return null;
    proj.checklist = tpl.checklist.map(function (t) {
      return { id: uid(), text: t, done: false };
    });
    touch(proj);
    return proj.checklist.length;
  }

  function setNotes(projectId, notes) {
    var proj = project(projectId);
    if (!proj) return false;
    proj.notes = typeof notes === 'string' ? notes : '';
    touch(proj);
    return true;
  }

  function clearHistory(projectId) {
    var proj = project(projectId);
    if (!proj) return false;
    proj.history.length = 0;
    touch(proj);
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Timer
   * ------------------------------------------------------------------ */

  /**
   * A span of work, sanity-checked (13 #8). Negative is a clock that moved
   * backwards and is worth nothing; longer than 18 hours is a clock that
   * jumped forward, or a timer left running for a week, and is capped rather
   * than believed.
   */
  function cappedSpan(ms) {
    if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return 0;
    return ms > MAX_SPAN_MS ? MAX_SPAN_MS : Math.floor(ms);
  }

  /**
   * How long the running span has lasted. `performance.now()` is the source
   * whenever this tab started the span; after a reload only the wall clock is
   * left, so that path is capped too. Because a span is never negative,
   * `totalMs` can only ever go up — a backward clock change cannot erase
   * recorded time.
   */
  function runningMs(proj) {
    if (!proj || !proj.timer || !proj.timer.runningSince) return 0;
    if (runningSpan && runningSpan.projectId === proj.id) {
      return cappedSpan(mono() - runningSpan.startMono);
    }
    return cappedSpan(now() - proj.timer.runningSince);
  }

  /** Bank whatever the running span is worth and stop it. */
  function bankTimer(proj) {
    if (!proj || !proj.timer || !proj.timer.runningSince) return 0;
    var span = runningMs(proj);
    proj.timer.totalMs = clampInt(proj.timer.totalMs, 0, 1e15, 0) + span;
    proj.timer.runningSince = null;
    if (runningSpan && runningSpan.projectId === proj.id) runningSpan = null;
    return span;
  }

  function stopAllTimers(exceptId) {
    var list = projects();
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.id === exceptId) continue;
      bankTimer(p);
    }
  }

  function toggleTimer(projectId) {
    var proj = project(projectId);
    if (!proj) return false;
    if (proj.timer.runningSince) {
      bankTimer(proj);
    } else {
      stopAllTimers(projectId);
      // The wall clock is what survives a reload; the monotonic one is what
      // the arithmetic actually uses while this tab is open.
      proj.timer.runningSince = now();
      runningSpan = { projectId: proj.id, startMono: mono(), startWall: proj.timer.runningSince };
    }
    touch(proj);
    return !!proj.timer.runningSince;
  }

  function elapsedMs(proj) {
    if (!proj || !proj.timer) return 0;
    return clampInt(proj.timer.totalMs, 0, 1e15, 0) + runningMs(proj);
  }

  /* ------------------------------------------------------------------ *
   * Export / import
   * ------------------------------------------------------------------ */

  /**
   * The whole state as a file. Taking one counts as a backup, so the nag
   * clock resets here (12 #1) and the file itself carries the new
   * `lastBackupAt`.
   */
  function exportJSON() {
    var s = getState();
    s.settings.lastBackupAt = now();
    s.settings.backupNagSnoozedUntil = 0;
    save();
    return JSON.stringify(exportView(s), null, 2);
  }

  /**
   * Wave K: what a backup holds. In memory a ready project is whole, so it
   * goes out inline exactly as before; a project whose heavy fields are not
   * loaded keeps its side table (Store.hydrateAll first for a complete file;
   * exportThready does).
   */
  function exportView(s) {
    var any = false;
    for (var i = 0; i < s.projects.length; i++) {
      var rt = hv[s.projects[i].id];
      if (rt && !rtReady(rt) && rt.table) { any = true; break; }
    }
    if (!any) return s;
    var out = {};
    for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) out[k] = s[k];
    out.projects = s.projects.map(exportProjectView);
    return out;
  }

  function exportProjectView(p) {
    var rt = hv[p.id];
    return rt && !rtReady(rt) && rt.table ? withExtra(p, 'heavy', rt.table) : p;
  }

  var PREIMPORT_KEY_SUFFIX = '.preimport';

  /**
   * Ordered, pure, idempotent state → state migrations (12 #2).
   * `MIGRATIONS[n]` reads a backup written by version n and returns one at
   * version n + 1. Never delete one: `test/backup.test.html` holds a frozen
   * fixture per version that must keep importing for the life of the app.
   */
  var MIGRATIONS = {
    /* 0 → 1. The very first backups carried no `version` key at all. Every
     * field they are missing — craft, craftData, templates, sizeIndex,
     * rowStitches, importKey — is filled in by normalizeProject and
     * normalizeState, so this step only has to stamp the number on. */
    0: function (raw) {
      var out = {};
      var keys = Object.keys(raw || {});
      for (var i = 0; i < keys.length; i++) out[keys[i]] = raw[keys[i]];
      out.version = 1;
      return out;
    }
  };

  function backupError(message, code) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  /**
   * Parse, version-check and migrate a backup. Writes nothing; both
   * `previewImport` and `importJSON` go through it so they can never disagree
   * about what a file says.
   */
  function readBackup(text) {
    var raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw backupError('That file is not valid JSON.', 'notJson');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw backupError('That file is not a Thready or Not backup.', 'notBackup');
    }
    var v = raw.version;
    if (v === undefined || v === null) v = 0;
    if (typeof v !== 'number' || !isFinite(v)) {
      throw backupError('That file is not a Thready or Not backup.', 'notBackup');
    }
    v = Math.floor(v);
    if (v > VERSION) {
      throw backupError(
        'This backup was made by a newer version of Thready or Not. Update the app, then try again.',
        'newerVersion'
      );
    }
    for (var n = v; n < VERSION; n++) {
      var step = MIGRATIONS[n];
      if (typeof step !== 'function') {
        throw backupError('This backup is from version ' + v + ' and cannot be read by this app.', 'noMigration');
      }
      raw = step(raw);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw backupError('That backup could not be migrated.', 'badMigration');
      }
    }
    if (!Array.isArray(raw.projects)) throw backupError('That backup has no projects.', 'noProjects');
    return raw;
  }

  function sameJson(a, b) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch (e) {
      return false;
    }
  }

  /** One preview row for a project or a template. */
  function previewRow(incoming, local) {
    var row = {
      id: incoming.id,
      name: incoming.name,
      craft: incoming.craft || DEFAULT_CRAFT,
      updatedAt: clampInt(incoming.updatedAt, 0, 1e15, 0),
      localUpdatedAt: local ? clampInt(local.updatedAt, 0, 1e15, 0) : null,
      status: 'new'
    };
    // A shipped template is in every backup and on every phone; the preview
    // leaves an unchanged one out of its tally (Wave E).
    if (incoming.builtIn) row.builtIn = true;
    if (!local) return row;
    if (sameJson(local, incoming)) row.status = 'identical';
    else if (row.updatedAt > row.localUpdatedAt) row.status = 'replace';
    else row.status = 'older';
    return row;
  }

  /**
   * What importing this file WOULD do (09 #3 / 12 #3). Writes nothing and
   * throws the same errors `importJSON` would, so the sheet can show them.
   * @param {string} text
   * @param {Array} [pages]  from readBackupFile: each project row then says
   *        how many page images the file carries for it (`row.pages`)
   * @returns {{projects:Array, templates:Array, counts:object, version:number}}
   */
  function previewImport(text, pages) {
    var raw = readBackup(text);
    var pageCount = Object.create(null);
    if (Array.isArray(pages)) {
      for (var pc = 0; pc < pages.length; pc++) {
        var pid = pages[pc] && pages[pc].projectId;
        if (pid) pageCount[pid] = (pageCount[pid] || 0) + 1;
      }
    }
    var list = projects();
    var tlist = templateList();
    // `counts` is the whole sheet (projects AND templates); the two split
    // tallies are there for a header line that names them separately.
    var counts = { new: 0, replace: 0, identical: 0, older: 0 };
    var projectCounts = { new: 0, replace: 0, identical: 0, older: 0 };
    var templateCounts = { new: 0, replace: 0, identical: 0, older: 0 };
    var projRows = [];
    var tplRows = [];
    var i;

    for (i = 0; i < raw.projects.length; i++) {
      if (!raw.projects[i] || typeof raw.projects[i] !== 'object') continue;
      var incoming = normalizeProject(raw.projects[i]);
      var row = previewRow(incoming, findProject(list, incoming.id));
      row.pages = pageCount[incoming.id] || 0;
      counts[row.status]++;
      projectCounts[row.status]++;
      projRows.push(row);
    }

    if (Array.isArray(raw.templates)) {
      for (i = 0; i < raw.templates.length; i++) {
        if (!raw.templates[i] || typeof raw.templates[i] !== 'object') continue;
        var tpl = normalizeTemplate(raw.templates[i]);
        if (tpl.id === 'blob') tpl.id = 'sheep';
        var trow = previewRow(tpl, findTemplate(tlist, tpl.id));
        counts[trow.status]++;
        templateCounts[trow.status]++;
        tplRows.push(trow);
      }
    }

    return {
      projects: projRows,
      templates: tplRows,
      counts: counts,
      projectCounts: projectCounts,
      templateCounts: templateCounts,
      // wave K: what restoring the file's settings block would change
      settings: previewSettings(raw),
      version: clampInt(raw.version, 0, 1e6, 0)
    };
  }

  /** Fresh ids throughout, so a "keep both" copy shares nothing with its twin. */
  function reidentify(proj) {
    var map = Object.create(null);
    var i;
    proj.id = uid();
    for (i = 0; i < proj.parts.length; i++) {
      var old = proj.parts[i].id;
      proj.parts[i].id = uid();
      map[old] = proj.parts[i].id;
    }
    proj.activePartId = map[proj.activePartId] || (proj.parts[0] && proj.parts[0].id) || '';
    for (i = 0; i < proj.history.length; i++) {
      var h = proj.history[i];
      if (map[h.partId]) h.partId = map[h.partId];
    }
    for (i = 0; i < proj.checklist.length; i++) proj.checklist[i].id = uid();
    return proj;
  }

  function fromBackupName(name) {
    return safeName(str(name, '') + ' (from backup)', str(name, '') || 'Untitled project');
  }

  /**
   * Restore a backup.
   *
   * @param {string} text
   * @param {{projects?:Object, templates?:Object}} [choices] per-id
   *        'skip' | 'replace' | 'keepBoth'. Anything not named defaults to
   *        'replace', which is what this call has always done.
   * @returns {number} how many projects were applied
   */
  function importJSON(text, choices) {
    var raw = readBackup(text);
    choices = choices && typeof choices === 'object' ? choices : {};
    var projChoice = choices.projects && typeof choices.projects === 'object' ? choices.projects : {};
    var tplChoice = choices.templates && typeof choices.templates === 'object' ? choices.templates : {};

    var s = getState();
    // Take the whole state first (09 #3): "Undo import" for the rest of the
    // session, in memory and on disk so a reload can still use it.
    preimportText = null;
    try {
      preimportText = JSON.stringify(s);
      // wave K: the on-disk copy leaves heavy fields in IndexedDB (their
      // blobs are kept while it exists) instead of doubling them here
      var diskCopy = wkNeedsCustom() ? serializeState() : preimportText;
      try { ls().setItem(KEY + PREIMPORT_KEY_SUFFIX, diskCopy); } catch (e) { /* memory copy stands */ }
    } catch (e) {
      preimportText = null;
    }

    var i;

    // Keys this reader does not understand survive the round trip (12 #2).
    var topKeys = Object.keys(raw);
    for (i = 0; i < topKeys.length && i < 200; i++) {
      if (KNOWN_STATE_KEYS[topKeys[i]]) continue;
      try {
        s[topKeys[i]] = JSON.parse(JSON.stringify(raw[topKeys[i]]));
      } catch (e) { /* not JSON-safe; it cannot have come from a file */ }
    }

    // Templates merge by id — imported wins unless the caller said otherwise.
    // Built-ins that the backup does not carry stay put.
    if (Array.isArray(raw.templates)) {
      var tlist = templateList();
      for (i = 0; i < raw.templates.length; i++) {
        if (!raw.templates[i] || typeof raw.templates[i] !== 'object') continue;
        var incomingTpl = normalizeTemplate(raw.templates[i]);
        if (incomingTpl.id === 'blob') {
          incomingTpl.id = 'sheep';
          incomingTpl.builtIn = true;
        }
        var howTpl = str(tplChoice[incomingTpl.id], '') || 'replace';
        if (howTpl === 'skip') continue;
        var existingTpl = findTemplate(tlist, incomingTpl.id);
        if (existingTpl && howTpl === 'keepBoth') {
          incomingTpl.id = uid();
          incomingTpl.builtIn = false;
          incomingTpl.name = fromBackupName(incomingTpl.name);
          tlist.push(incomingTpl);
          continue;
        }
        if (existingTpl) tlist[tlist.indexOf(existingTpl)] = incomingTpl;
        else tlist.push(incomingTpl);
      }
    }

    var list = projects();
    var count = 0;
    // What happened to each project in the file, for importPages() (12 #4).
    var plan = { applied: Object.create(null), idMap: Object.create(null) };
    for (i = 0; i < raw.projects.length; i++) {
      if (!raw.projects[i] || typeof raw.projects[i] !== 'object') continue;
      var incoming = normalizeProject(raw.projects[i]);
      var how = str(projChoice[incoming.id], '') || 'replace';
      if (how === 'skip') continue;
      var existing = findProject(list, incoming.id);
      if (existing && how === 'keepBoth') {
        // The clone's page images are keyed by its NEW id (12 #4):
        // importPages() writes the file's copies there, or copies the local
        // original's, so the twins never share (or lose) each other's pages.
        var fileId = incoming.id;
        incoming.name = fromBackupName(incoming.name);
        reidentify(incoming);
        incoming.craftData = rekeyBlobs(incoming.craftData, fileId, incoming.id);
        // wave K: a side table points at the clone's own copies too
        if (incoming.heavy) incoming.heavy = rekeyBlobs(incoming.heavy, fileId, incoming.id);
        plan.applied[fileId] = 'keepBoth';
        plan.idMap[fileId] = incoming.id;
        list.push(incoming);
        heavyIngestOne(incoming);
        count++;
        continue;
      }
      plan.applied[incoming.id] = 'replace';
      if (existing) list[list.indexOf(existing)] = incoming;
      else list.push(incoming);
      heavyIngestOne(incoming);
      count++;
    }
    lastImport = plan;
    // wave K: the file's settings block comes back too (default 'merge'),
    // inside the same pre-import snapshot, so Undo import takes it back out
    var howSettings = str(choices.settings, '') || 'merge';
    if (howSettings !== 'skip' && raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)) {
      applySettings(s.settings, raw.settings, howSettings === 'replace' ? 'replace' : 'merge', false);
    }
    // A page snapshot from an earlier import must not be "undone" by this one.
    queuePageWork(clearPageSnapshot);

    lineCache = Object.create(null);
    diagramCache = Object.create(null);
    // The undo stack is NOT cleared: it belongs to the state the pre-import
    // snapshot restores, and losing it was half of what made 09 #3 dangerous.
    dirty = true;
    flush();
    return count;
  }

  function preimportSnapshot() {
    if (preimportText) return preimportText;
    var txt = lsGet(KEY + PREIMPORT_KEY_SUFFIX);
    return typeof txt === 'string' && txt ? txt : null;
  }

  function canUndoImport() {
    return !!preimportSnapshot();
  }

  /** Put everything back the way it was before the last import. */
  function undoImport() {
    var txt = preimportSnapshot();
    if (!txt) return false;
    var raw;
    try {
      raw = JSON.parse(txt);
    } catch (e) {
      return false;
    }
    var keepRevision = revision();
    var prevProjects = state && state.projects;
    state = normalizeState(raw);
    heavyIngest(state.projects, prevProjects);   // wave K
    state.revision = Math.max(clampInt(state.revision, 0, 1e12, 0), keepRevision);
    lineCache = Object.create(null);
    diagramCache = Object.create(null);
    preimportText = null;
    lsRemove(KEY + PREIMPORT_KEY_SUFFIX);
    lastImport = null;
    dirty = true;
    flush();
    // The page images go back too (12 #4); Store.pagesIdle() says when.
    queuePageWork(undoPageSnapshot);
    return true;
  }

  /* ---- .thready: one zip with the backup AND the page images ------------ *
   *
   * docs/brainstorm/12-interoperability.md #4 / #5. Layout:
   *
   *   backup.json              exactly exportJSON() (or a one-project file in
   *                            the same format); importable on its own forever
   *   manifest.json            { format:'thready', formatVersion, scope:
   *                            'all'|'project', writtenAt, backupVersion,
   *                            counts, entries:[{path, key, type, bytes}] }
   *   README.txt               what this is, in plain words
   *   pages/<projectId>/<n>.<ext>   BlobStore page images, original bytes;
   *                            the manifest maps each path to its BlobStore key
   *
   * Reading rules: backup.json is the truth; the manifest only says where the
   * images go; a missing pages/ folder, a missing manifest or a damaged image
   * is never an error (that page is simply not restored); a zip with no
   * backup.json is not a backup. Needs window.Zip (js/zip.js) and, for the
   * images, window.BlobStore; without BlobStore it degrades to backup.json.
   * --------------------------------------------------------------------- */

  var THREADY_FORMAT_VERSION = 1;
  var BACKUP_FILE_MAX_BYTES = 50 * 1024 * 1024;
  /** Where importPages() parks the images it is about to replace. Not 'p:…',
   *  so a project delete or a sweep never touches it. */
  var PAGE_SNAPSHOT_PREFIX = 'preimport:';
  var PAGE_SNAPSHOT_LIST = 'preimport:__list';
  var EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  var TYPE_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
  var THREADY_README =
    'Thready or Not backup\r\n' +
    '=====================\r\n\r\n' +
    'This file is an ordinary zip. Inside it:\r\n\r\n' +
    '  backup.json    every project, template and setting, as plain JSON. This is\r\n' +
    '                 the real backup: on its own it is still a valid file to import.\r\n' +
    '  manifest.json  what is in here, and which project each page image belongs to.\r\n' +
    '  pages/         the chart and pattern page images, one folder per project,\r\n' +
    '                 exactly as they were saved on the device.\r\n\r\n' +
    'To restore: Thready or Not > Settings > Import backup, and pick this file\r\n' +
    '(or the backup.json inside it).\r\n';

  function noop() { /* swallow: a failed page step must not stop the queue */ }

  /** The last importJSON's per-project outcome, read by importPages(). */
  var lastImport = null;
  /** Page writes, restores and undos run one at a time, in order. */
  var pageWork = null;

  function blobStore() {
    var B = window.BlobStore;
    try {
      return B && typeof B.available === 'function' && B.available() &&
        typeof B.putMany === 'function' ? B : null;
    } catch (e) {
      return null;
    }
  }

  function zipLib() {
    var Z = window.Zip;
    return Z && typeof Z.write === 'function' && typeof Z.read === 'function' ? Z : null;
  }

  function queuePageWork(fn) {
    if (typeof Promise !== 'function') return null;
    var prev = pageWork || Promise.resolve();
    var job = prev.then(function () { return fn(); });
    pageWork = job.then(noop, noop);
    return job;
  }

  /** Resolves once every queued page restore / undo has finished. */
  function pagesIdle() {
    return pageWork || Promise.resolve();
  }

  function blobText(b) {
    if (!b) return Promise.resolve('');
    if (typeof b.text === 'function') return b.text();
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { resolve(''); };
      fr.readAsText(b);
    });
  }

  function clearPageSnapshot() {
    var B = blobStore();
    return B ? B.deletePrefix(PAGE_SNAPSHOT_PREFIX) : null;
  }

  /** Put the images an import replaced back, and take away what it added. */
  function undoPageSnapshot() {
    var B = blobStore();
    if (!B) return null;
    return B.get(PAGE_SNAPSHOT_LIST).then(blobText).then(function (txt) {
      var rec = null;
      try { rec = JSON.parse(txt || 'null'); } catch (e) { rec = null; }
      if (!rec || typeof rec !== 'object') return null;
      var written = Array.isArray(rec.written) ? rec.written : [];
      return B.deleteKeys(written).then(function () {
        return B.entries(PAGE_SNAPSHOT_PREFIX);
      }).then(function (list) {
        var back = [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].key === PAGE_SNAPSHOT_LIST) continue;
          back.push({ key: list[i].key.slice(PAGE_SNAPSHOT_PREFIX.length), value: list[i].blob });
        }
        return B.putMany(back);
      });
    }).then(function () {
      return B.deletePrefix(PAGE_SNAPSHOT_PREFIX);
    });
  }

  /** A clone's craftData points its page keys at its own id. */
  function rekeyBlobs(craftData, fromId, toId) {
    if (!craftData || typeof craftData !== 'object' || !fromId || !toId) return craftData;
    try {
      var txt = JSON.stringify(craftData);
      var needle = '"p:' + fromId + ':';
      if (txt.indexOf(needle) < 0) return craftData;
      return JSON.parse(txt.split(needle).join('"p:' + toId + ':'));
    } catch (e) {
      return craftData;
    }
  }

  function sizeText(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return Math.round(n / (1024 * 1024)) + ' MB';
  }

  /** The size guard's message, or null when the file is a plausible size. */
  function backupFileProblem(bytes) {
    var n = Number(bytes) || 0;
    if (n <= BACKUP_FILE_MAX_BYTES) return null;
    return 'That file is ' + sizeText(n) + ' — a Thready or Not backup is never bigger than ' +
      sizeText(BACKUP_FILE_MAX_BYTES) + ', so it is probably not one.';
  }

  /** One project, in the backup format, for "Send this project" (12 #5). */
  function exportProjectJSON(projectId) {
    var p = findProject(projects(), projectId);
    if (!p) return null;
    return JSON.stringify({ version: VERSION, projects: [deepCopy(exportProjectView(p))], templates: [] }, null, 2);
  }

  function safeSeg(s) {
    return String(s).replace(/[^A-Za-z0-9._-]/g, '_') || '_';
  }

  /** 'p:abc:chartpage:3' → 'pages/abc/3.jpg' (unique within `used`). */
  function pagePath(pid, key, type, used) {
    var bits = key.slice(('p:' + pid + ':').length).split(':');
    var n = bits[bits.length - 1];
    var ext = EXT_BY_TYPE[String(type || '').toLowerCase()] || 'bin';
    var dir = 'pages/' + encodeURIComponent(pid) + '/';
    var path = dir + (/^\d+$/.test(n) ? n : safeSeg(bits.join('-'))) + '.' + ext;
    if (used[path]) path = dir + safeSeg(bits.join('-')) + '.' + ext;
    var k = 2;
    while (used[path]) path = dir + safeSeg(bits.join('-')) + '-' + (k++) + '.' + ext;
    used[path] = true;
    return path;
  }

  /**
   * Build a `.thready` file.
   * @param {{projectId?:string, appVersion?:string}} [opts]  projectId → a
   *        one-project file (12 #5), which does NOT count as a backup
   * @returns {Promise<{blob:Blob, scope:'all'|'project', projects:number,
   *          images:number, bytes:number}>}
   */
  function exportThready(opts) {
    // wave K: every heavy field is loaded first, so backup.json is whole
    if (typeof Promise !== 'function') return exportThreadyNow(opts);
    var scope = opts && opts.projectId ? [opts.projectId] : null;
    return hydrateAll(scope).then(function () { return heavyIdle(); }).then(function () {
      return exportThreadyNow(opts);
    });
  }

  function exportThreadyNow(opts) {
    opts = opts || {};
    var Z = zipLib();
    if (!Z || typeof Promise !== 'function') {
      return Promise.reject(backupError('The backup file writer is not loaded.', 'noZip'));
    }
    var one = null;
    if (opts.projectId) {
      one = findProject(projects(), opts.projectId);
      if (!one) return Promise.reject(backupError('That project is no longer here.', 'noProject'));
    }
    var text;
    try {
      text = one ? exportProjectJSON(one.id) : exportJSON();
    } catch (e) {
      return Promise.reject(e);
    }
    var ids = one ? [one.id] : projects().map(function (p) { return p.id; });
    var B = blobStore();
    var images = [];
    var chain = Promise.resolve();
    if (B) {
      ids.forEach(function (pid) {
        chain = chain.then(function () {
          return B.entries('p:' + pid + ':').then(function (list) {
            for (var i = 0; i < list.length; i++) {
              // wave K: heavy fields are inline in backup.json already
              if (list[i].key.indexOf('p:' + pid + ':heavy:') === 0 && rtReady(hv[pid])) continue;
              if (list[i].blob && typeof list[i].blob.size === 'number') {
                images.push({ pid: pid, key: list[i].key, blob: list[i].blob });
              }
            }
          });
        });
      });
    }
    return chain.then(function () {
      var written = new Date(now());
      var json = Z.utf8(text);
      var used = Object.create(null);
      var listed = [{ path: 'backup.json', bytes: json.length }];
      var pageEntries = [];
      images.forEach(function (img) {
        var type = String(img.blob.type || '');
        var path = pagePath(img.pid, img.key, type, used);
        listed.push({ path: path, key: img.key, type: type, bytes: img.blob.size });
        pageEntries.push({ name: path, data: img.blob });
      });
      var manifest = {
        format: 'thready',
        formatVersion: THREADY_FORMAT_VERSION,
        scope: one ? 'project' : 'all',
        app: 'Thready or Not',
        appVersion: str(opts.appVersion, ''),
        writtenAt: written.toISOString(),
        backup: 'backup.json',
        backupVersion: VERSION,
        counts: {
          projects: ids.length,
          templates: one ? 0 : templateList().length,
          images: images.length
        },
        entries: listed
      };
      var entries = [
        { name: 'backup.json', data: json },
        { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
        { name: 'README.txt', data: THREADY_README }
      ].concat(pageEntries);
      return Z.write(entries, { date: written }).then(function (blob) {
        return {
          blob: blob,
          scope: manifest.scope,
          projects: ids.length,
          images: images.length,
          bytes: blob.size
        };
      });
    });
  }

  function bytesFrom(input) {
    if (typeof Uint8Array !== 'function') return Promise.reject(backupError('Could not read that file.', 'unreadable'));
    if (input instanceof Uint8Array) return Promise.resolve(input);
    if (typeof ArrayBuffer === 'function' && input instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(input));
    if (input && typeof input.arrayBuffer === 'function') {
      return input.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    }
    if (input && typeof Blob === 'function' && input instanceof Blob) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(new Uint8Array(fr.result)); };
        fr.onerror = function () { reject(backupError('Could not read that file.', 'unreadable')); };
        fr.readAsArrayBuffer(input);
      });
    }
    return Promise.reject(backupError('Could not read that file.', 'unreadable'));
  }

  function decodeText(u8) {
    var Z = zipLib();
    if (Z) return Z.fromUtf8(u8);
    if (typeof TextDecoder === 'function') return new TextDecoder('utf-8').decode(u8);
    var s = '';
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return s;
  }

  function looksLikeZip(u8) {
    return u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b &&
      ((u8[2] === 3 && u8[3] === 4) || (u8[2] === 5 && u8[3] === 6));
  }

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * A page with no manifest line: 'pages/<id>/3.jpg' → the key the project's
   * own data uses for page 3 ('p:<id>:chartpage:3'), or null.
   */
  function guessPageKey(text, pid, file) {
    var base = String(file).replace(/\.[A-Za-z0-9]+$/, '');
    var m = /^(?:([A-Za-z]+)-)?(\d+)$/.exec(base);
    if (!m) return null;
    if (m[1]) return 'p:' + pid + ':' + m[1] + ':' + m[2];
    var re = new RegExp('"p:' + escapeRe(pid) + ':([A-Za-z]+):' + m[2] + '"');
    var hit = re.exec(text);
    return hit ? 'p:' + pid + ':' + hit[1] + ':' + m[2] : null;
  }

  function readThreadyBytes(u8) {
    var Z = zipLib();
    if (!Z) return Promise.reject(backupError('This copy of the app cannot open .thready files.', 'noZip'));
    return Z.read(u8).then(function (zip) {
      var main = null;
      var depth = function (n) { return n.split('/').length; };
      zip.entries.forEach(function (e) {
        if (e.dir || !/(^|\/)backup\.json$/.test(e.name)) return;
        if (!main || depth(e.name) < depth(main.name)) main = e;
      });
      if (!main) {
        throw backupError('That zip has no backup.json inside, so it is not a Thready or Not backup.', 'noBackupJson');
      }
      if (!main.data || main.crcOk !== true) {
        throw backupError('The backup inside that file is damaged and cannot be read.', 'damaged');
      }
      var root = main.name.slice(0, main.name.length - 'backup.json'.length);
      var text = decodeText(main.data).replace(/^﻿/, '');

      var manifest = null;
      var byName = Object.create(null);
      zip.entries.forEach(function (e) { byName[e.name] = e; });
      var mEntry = byName[root + 'manifest.json'];
      if (mEntry && mEntry.data && mEntry.crcOk) {
        try { manifest = JSON.parse(decodeText(mEntry.data)); } catch (e) { manifest = null; }
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) manifest = null;
      }
      if (manifest && typeof manifest.formatVersion === 'number' && manifest.formatVersion > THREADY_FORMAT_VERSION) {
        throw backupError(
          'This backup was made by a newer version of Thready or Not. Update the app, then try again.',
          'newerVersion'
        );
      }
      var listed = Object.create(null);
      if (manifest && Array.isArray(manifest.entries)) {
        manifest.entries.forEach(function (m) {
          if (m && typeof m.path === 'string' && typeof m.key === 'string') listed[m.path] = m;
        });
      }

      var pages = [];
      var skipped = 0;
      zip.entries.forEach(function (e) {
        if (e.dir || e.name.indexOf(root + 'pages/') !== 0) return;
        var rel = e.name.slice(root.length);
        var m = /^pages\/([^\/]+)\/([^\/]+)$/.exec(rel);
        if (!m) { skipped++; return; }
        var pid;
        try { pid = decodeURIComponent(m[1]); } catch (x) { skipped++; return; }
        if (!e.data || e.crcOk !== true) { skipped++; return; }
        var line = listed[rel];
        var key = line && line.key.indexOf('p:' + pid + ':') === 0 && line.key.length < 300 ? line.key : null;
        if (!key) key = guessPageKey(text, pid, m[2]);
        if (!key) { skipped++; return; }
        var ext = ((/\.([A-Za-z0-9]+)$/.exec(m[2]) || [])[1] || '').toLowerCase();
        var type = line && /^image\/[a-z0-9.+-]+$/i.test(String(line.type || '')) ? line.type : (TYPE_BY_EXT[ext] || 'application/octet-stream');
        pages.push({ projectId: pid, key: key, path: rel, type: type, bytes: e.data });
      });

      return {
        kind: 'thready',
        scope: manifest && manifest.scope === 'project' ? 'project' : 'all',
        text: text,
        pages: pages,
        skipped: skipped,
        manifest: manifest
      };
    });
  }

  /**
   * Read a chosen file: a `.thready` zip (sniffed by its magic bytes, never
   * by name or MIME type, which iOS does not know) or a bare `.json` backup.
   * Writes nothing; feed `text` (+ `pages`) to previewImport / importJSON /
   * importPages.
   * @param {File|Blob|ArrayBuffer|Uint8Array|string} input
   * @returns {Promise<{kind:'json'|'thready', scope:'all'|'project',
   *          text:string, pages:Array, skipped:number, manifest:?Object}>}
   *          Rejects with `.code` 'tooBig' | 'noBackupJson' | 'damaged' |
   *          'newerVersion' | 'noZip' | 'unreadable' or a Zip error code.
   */
  function readBackupFile(input) {
    if (typeof Promise !== 'function') throw backupError('Could not read that file.', 'unreadable');
    if (typeof input === 'string') {
      return Promise.resolve({ kind: 'json', scope: 'all', text: input.replace(/^﻿/, ''), pages: [], skipped: 0, manifest: null });
    }
    var size = input && typeof input.size === 'number' ? input.size
      : (input && typeof input.byteLength === 'number' ? input.byteLength : 0);
    var big = backupFileProblem(size);
    if (big) return Promise.reject(backupError(big, 'tooBig'));
    return bytesFrom(input).then(function (u8) {
      if (looksLikeZip(u8)) return readThreadyBytes(u8);
      return { kind: 'json', scope: 'all', text: decodeText(u8).replace(/^﻿/, ''), pages: [], skipped: 0, manifest: null };
    });
  }

  /** Move every image under `prefix` aside, recording the keys in `saved`. */
  function parkImages(B, prefix, saved) {
    return B.entries(prefix).then(function (list) {
      if (!list.length) return null;
      var aside = list.map(function (e) { return { key: PAGE_SNAPSHOT_PREFIX + e.key, value: e.blob }; });
      return B.putMany(aside).then(function (n) {
        // Only take the originals away once their copies are safe.
        if (!n) return null;
        var keys = list.map(function (e) { return e.key; });
        return B.deleteKeys(keys).then(function () {
          for (var i = 0; i < keys.length; i++) saved.push(keys[i]);
        });
      });
    });
  }

  /**
   * After importJSON: put the file's page images where the imported projects
   * expect them, undoably (Store.undoImport takes them back out).
   *  - a project the file replaced or added: its images in the file replace
   *    the local ones; with none in the file the local ones stay (a restore
   *    onto the same phone, or a file written before .thready existed)
   *  - a "Keep both" copy: the file's images under its new id, or a copy of
   *    the local original's when the file has none
   *  - a skipped project: nothing
   * @param {Array} pages  readBackupFile().pages (may be empty)
   * @returns {Promise<{written:number, copied:number, skipped:number}>}
   */
  function importPages(pages) {
    var result = { written: 0, copied: 0, skipped: 0 };
    pages = Array.isArray(pages) ? pages : [];
    var plan = lastImport;
    var B = blobStore();
    if (!plan || !B) {
      result.skipped = pages.length;
      return Promise.resolve(result);
    }
    return queuePageWork(function () {
      var written = [];
      var saved = [];
      var record = function () {
        return B.put(PAGE_SNAPSHOT_LIST, JSON.stringify({ written: written, saved: saved }));
      };
      var chain = Promise.resolve();
      Object.keys(plan.applied).forEach(function (fileId) {
        var how = plan.applied[fileId];
        var target = how === 'keepBoth' ? plan.idMap[fileId] : fileId;
        var from = 'p:' + fileId + ':';
        var mine = pages.filter(function (pg) {
          return pg && pg.projectId === fileId && typeof pg.key === 'string' && pg.key.indexOf(from) === 0 && pg.bytes;
        });
        chain = chain.then(function () {
          if (mine.length) {
            var put = mine.map(function (pg) {
              return {
                key: 'p:' + target + ':' + pg.key.slice(from.length),
                value: new Blob([pg.bytes], { type: pg.type || 'application/octet-stream' })
              };
            });
            var before = how === 'replace' ? parkImages(B, from, saved) : Promise.resolve();
            return before.then(function () {
              return B.putMany(put);
            }).then(function (n) {
              if (n) {
                put.forEach(function (x) { written.push(x.key); });
                result.written += put.length;
              } else {
                result.skipped += put.length;
              }
            }).then(record);
          }
          if (how !== 'keepBoth') return null;
          return B.entries(from).then(function (list) {
            if (!list.length) return null;
            var copy = list.map(function (e) {
              return { key: 'p:' + target + ':' + e.key.slice(from.length), value: e.blob };
            });
            return B.putMany(copy).then(function (n) {
              if (!n) return null;
              copy.forEach(function (x) { written.push(x.key); });
              result.copied += copy.length;
              return record();
            });
          });
        });
      });
      pages.forEach(function (pg) {
        if (!pg || !plan.applied[pg.projectId]) result.skipped++;
      });
      return chain.then(record).then(function () { return result; });
    });
  }

  /**
   * Project ids something still points at: the live list, every project the
   * undo stack or the pre-import snapshot could bring back, and whatever is
   * on disk right now (another tab may have created one). Used to sweep
   * orphaned page images (09 #10).
   */
  function referencedProjectIds() {
    var seen = Object.create(null);
    var out = [];
    var add = function (id) {
      if (typeof id === 'string' && id && !seen[id]) {
        seen[id] = true;
        out.push(id);
      }
    };
    var addAll = function (txt) {
      if (typeof txt !== 'string' || !txt) return;
      try {
        var raw = JSON.parse(txt);
        if (raw && Array.isArray(raw.projects)) raw.projects.forEach(function (p) { add(p && p.id); });
      } catch (e) { /* unreadable: contributes nothing */ }
    };
    projects().forEach(function (p) { add(p.id); });
    for (var i = 0; i < undoStack.length; i++) add(undoStack[i] && undoStack[i].id);
    addAll(preimportSnapshot());
    addAll(lsGet(KEY));
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Live 3D diagram
   *
   * `diagramModel(part, project)` turns a part into the Model the renderer
   * (js/diagram.js) eats. Everything here is defensive: a missing parser, a
   * parser without the colour additions, or a part with no pattern at all all
   * end up with a sensible model built from what was actually tapped.
   * ------------------------------------------------------------------ */

  function emptyModel() {
    return {
      mode: 'rounds',
      rounds: [],
      current: 0,
      defaultColor: MAIN_YARN_DEFAULT,
      shape: {
        start: 'unknown', chainLen: null, ringCount: null, stuffed: null,
        corners: 0, cornersSource: null,
        upsideDown: false, upsideDownSource: null,
        dialect: null
      },
      window: { first: 0, total: 0 },
      deviation: { expected: null, actual: 0 }
    };
  }

  /** The project's palette, repaired in place for saves made before v3. */
  function yarnColorsOf(proj) {
    if (!proj) return { '*': MAIN_YARN_DEFAULT };
    if (!proj.yarnColors || typeof proj.yarnColors !== 'object') {
      proj.yarnColors = { '*': MAIN_YARN_DEFAULT };
    } else if (!proj.yarnColors[MAIN_YARN]) {
      proj.yarnColors[MAIN_YARN] = MAIN_YARN_DEFAULT;
    }
    return proj.yarnColors;
  }

  function mainYarn(proj) {
    return yarnColorsOf(proj)[MAIN_YARN] || MAIN_YARN_DEFAULT;
  }

  /** Which project a part belongs to (for `diagramModel(part)` with no project). */
  function projectOfPart(prt) {
    if (!prt) return null;
    var list = projects();
    for (var i = 0; i < list.length; i++) {
      for (var j = 0; j < list[i].parts.length; j++) {
        if (list[i].parts[j] === prt || list[i].parts[j].id === prt.id) return list[i];
      }
    }
    return null;
  }

  /** Patterns.colorHex(name) → '#hex' | null, never throwing. */
  function patternColorHex(name, craft) {
    var api = patternsApi(craft);
    if (!api || typeof api.colorHex !== 'function') return null;
    try {
      return normalizeHex(api.colorHex(name));
    } catch (e) {
      return null;
    }
  }

  /** Patterns.colors(text) → { legend, names }, never throwing. */
  function patternColorsOf(text, craft) {
    var out = { legend: {}, names: [] };
    var api = patternsApi(craft);
    if (!api || typeof api.colors !== 'function') return out;
    if (!text || !String(text).replace(/\s/g, '')) return out;
    try {
      var res = api.colors(String(text));
      if (res && typeof res === 'object') {
        if (res.legend && typeof res.legend === 'object') out.legend = res.legend;
        if (Array.isArray(res.names)) out.names = res.names;
      }
    } catch (e) {
      /* a parser without the colour additions, or a bad pattern — no colours */
    }
    return out;
  }

  /**
   * name → '#hex' for one part: the user's override wins, then the legend
   * ('A' → 'Almond') retried as an override, then the parser's colour words,
   * then the main yarn. Memoised — a 48-stitch round asks for the same handful
   * of names over and over.
   */
  function makeColorResolver(proj, prt) {
    var yarn = yarnColorsOf(proj);
    var main = yarn[MAIN_YARN] || MAIN_YARN_DEFAULT;
    var memo = Object.create(null);
    var lower = null;
    var legend = null;

    function override(name) {
      if (!name) return null;
      var direct = normalizeHex(yarn[name]);
      if (direct) return direct;
      if (!lower) {
        lower = Object.create(null);
        var keys = Object.keys(yarn);
        for (var i = 0; i < keys.length; i++) lower[keys[i].toLowerCase()] = yarn[keys[i]];
      }
      return normalizeHex(lower[String(name).toLowerCase()]);
    }

    return function resolve(rawName) {
      var name = str(rawName, '').trim();
      if (!name) return main;
      var hit = memo[name];
      if (hit) return hit;

      var out = override(name);
      if (!out) {
        if (legend === null) legend = patternColorsOf(prt && prt.patternText, proj || prt).legend || {};
        var full = str(legend[name], '').trim();
        if (full && full !== name) out = override(full) || patternColorHex(full, proj || prt);
      }
      if (!out) out = patternColorHex(name, proj || prt);
      if (!out) out = main;
      memo[name] = out;
      return out;
    };
  }

  /**
   * Which pattern row a working row shows. Same mapping as `repeatInfo`, but
   * for any row rather than only the one being worked.
   */
  function patternRowForRow(prt, row) {
    var r = prt && prt.repeat ? prt.repeat : null;
    if (!r || !r.enabled) return row;
    var len = r.endRow - r.startRow + 1;
    if (len <= 0 || r.times < 1) return row;
    var span = len * r.times;
    if (row < r.startRow || row >= r.startRow + span) return row;
    return r.startRow + ((row - r.startRow) % len);
  }

  /**
   * Patterns.workMode(text) → 'rounds'|'rows'|null, never throwing, memoised on
   * the parse. `diagramKey` asks for this on every tap, and scanning 50 KB of
   * pattern text per tap is exactly the kind of thing finding 2 was about.
   */
  function patternWorkMode(prt) {
    var api = patternsApi(prt);
    if (!api || typeof api.workMode !== 'function') return null;
    var text = prt && prt.patternText ? String(prt.patternText) : '';
    // /\S/ stops at the first non-space character; `text.replace(/\s/g,'')`
    // rebuilds the whole 52 KB, and this is on the tap path.
    if (!/\S/.test(text)) return null;
    var entry = partLines(prt);
    // Keyed on the function itself, so a test page that swaps the parser out
    // gets a fresh answer instead of a frozen one.
    if (entry.patternModeFn === api.workMode) return entry.patternMode;
    var out = null;
    try {
      var m = api.workMode(text);
      if (m === 'rounds' || m === 'rows') out = m;
      // wave H (knit-qa): a knitted piece BEGUN in the round (a sock's cuff)
      // is a piece in the round, whatever flat stretch it holds (its heel
      // flap); the per-row `workedIn` makes those rows ROW (rowWorkMode).
      // Knits.workMode says 'rows' as soon as any row is flat, which drew the
      // whole sock as a flat panel.
      if (out === 'rows' && craftKeyOf(prt) === 'knitting') {
        for (var wi = 0; wi < entry.lines.length; wi++) {
          var wl = entry.lines[wi];
          if (!wl || wl.kind !== 'row' || !(wl.row >= 1) || wl.sizeSkip) continue;
          if (wl.workedIn === 'rounds') out = 'rounds';
          break;
        }
      }
    } catch (e) {
      /* a parser without workMode, or a bad pattern — leave it unknown */
    }
    entry.patternModeFn = api.workMode;
    entry.patternMode = out;
    return out;
  }

  /**
   * Rounds or rows for ONE piece, in resolution order (05-ux-meaning #2):
   * the owner's explicit `Part.workMode`, then what the pattern text says, then
   * the project's `countMode` as the tie-break.
   * @returns {'rounds'|'rows'}
   */
  function partWorkMode(prt, proj) {
    var explicit = normalizeWorkMode(prt && prt.workMode, 'auto');
    if (explicit !== 'auto') return explicit;
    var guess = patternWorkMode(prt);
    if (guess) return guess;
    if (proj === undefined) proj = projectOfPart(prt);
    return proj && proj.countMode === 'rounds' ? 'rounds' : 'rows';
  }

  /**
   * Rounds or rows for ONE ROW of a piece (wave G): a piece begun in the
   * round can go on in rows ("Now instead of crocheting in the round ... 3.
   * Ch1, turn"), and the parser marks those lines `workedIn: 'rows'`. The
   * owner's explicit chip still wins for the whole piece.
   * @returns {'rounds'|'rows'}
   */
  function rowWorkMode(prt, rowNumber, proj) {
    var whole = partWorkMode(prt, proj);
    if (normalizeWorkMode(prt && prt.workMode, 'auto') !== 'auto') return whole;
    if (whole !== 'rounds' || !(rowNumber >= 1)) return whole;
    var l = lineForRow(prt, rowNumber);
    return l && l.workedIn === 'rows' ? 'rows' : whole;
  }

  /* ------------------------------------------------------------------ *
   * Which way up (01 §1.4.8)
   *
   * The model has exactly one direction of growth: round 1 first, and every
   * round after it further DOWN the piece. That is right for a head worked
   * from its crown, and upside down for the very common amigurumi body the
   * designer worked from its base — the baphomet ("Starting from bottom of
   * body in main color"), the snowman ("bottom to top:"), and every pattern
   * that opens "start at the base" / "worked from the bottom up" / "begin at
   * the bottom". The model does not flip anything; it publishes
   * `shape.upsideDown` and `DiagramGeo.layout` does the flipping.
   *
   * The phrase list is deliberately mean. "bottom" in a finished pattern is
   * usually ASSEMBLY ("sew to the bottom of the body", "18 sc into the bottom
   * of the head", "close at the bottom by sewing", "into bottom side of first
   * ch"), so a match needs a direction of travel stated outright
   * ("bottom to top", "bottom up") or a starting verb reaching for the bottom
   * ("starting FROM bottom", "begin AT the bottom"); a line that mentions
   * joining pieces up is skipped whatever else it says; and the scan stops
   * after the piece's own header / setup lines, because that is the only place
   * a designer ever writes this down.
   * ------------------------------------------------------------------ */

  var ORIENT_SCAN_MIN = 30;              // ...and never fewer lines than this
  var ORIENT_SCAN_MAX = 80;              // ...nor more, however long the preamble

  /* "R1:", "Rnd 1", "Round 12", "Row 6-55" — the first one ends the header. */
  var ORIENT_ROW_RE = /^\s*(?:r|rd|rnd|rnds|row|rows|round|rounds)\s*\.?\s*:?\s*\d/i;

  /* Putting the toy together is not a statement about how it was worked. Bare
     "stitch" is deliberately NOT in here — it is half the vocabulary of every
     pattern — and it does not need to be: "slip stitch to the base of the head"
     has no starting verb in it either way. */
  var ORIENT_ASSEMBLY_RE =
    /\b(?:sew|sewn|sewing|stitching|attach|attached|attaching|join|joined|joining|insert|inserted|inserting|glue|glued|pin|pinned|place|places|placed|placing|placement|position|positioned|close|closed|closing|stuff|stuffed|stuffing|embroider|embroidered|marker|fasten)\b/;

  /* The direction of travel, said outright. */
  var ORIENT_DOWN_RE = /\bbottom\s*(?:to|-|–|—|>|→)+\s*top\b|\bbottom[\s-]*up(?:ward|wards)?\b/;
  var ORIENT_UP_RE = /\btop\s*(?:to|-|–|—|>|→)+\s*bottom\b|\btop[\s-]*down(?:ward|wards)?\b/;

  /* A starting verb reaching for one end of the piece. `from|at|with` only —
     "working INTO the bottom loops of the chain" is a stitch placement. */
  var ORIENT_VERBS =
    '(?:start|starts|started|starting|begin|begins|began|beginning|work|works|worked|working|make|made|crochet|crocheted|commence|commencing)';
  var ORIENT_START_DOWN_RE =
    new RegExp('\\b' + ORIENT_VERBS + '\\b[^.\\n]{0,24}?\\b(?:from|at|with)\\b[^.\\n]{0,24}?\\b(?:bottom|base)\\b');
  var ORIENT_START_UP_RE =
    new RegExp('\\b' + ORIENT_VERBS + '\\b[^.\\n]{0,24}?\\b(?:from|at|with)\\b[^.\\n]{0,24}?\\btop\\b');

  /**
   * How many leading lines count as the piece's header / setup: everything up
   * to and including its first numbered round, and never fewer than
   * ORIENT_SCAN_MIN nor more than ORIENT_SCAN_MAX. A section whose preamble is
   * 16 lines of stitch glossary (the snowman) still gets its "bottom to top:".
   */
  function orientScanLimit(lines) {
    var limit = ORIENT_SCAN_MIN, i;
    for (i = 0; i < lines.length && i < ORIENT_SCAN_MAX; i++) {
      if (ORIENT_ROW_RE.test(lines[i])) {
        if (i + 1 > limit) limit = i + 1;
        break;
      }
    }
    if (limit > ORIENT_SCAN_MAX) limit = ORIENT_SCAN_MAX;
    if (limit > lines.length) limit = lines.length;
    return limit;
  }

  /**
   * True when the pattern text says this piece was worked from its bottom.
   * A top-down phrase anywhere in the window wins, so a head that says
   * "starting at the top of the head" can never be flipped by a stray
   * "bottom" further down.
   */
  function textUpsideDown(raw) {
    var text = String(raw == null ? '' : raw);
    if (!/\S/.test(text)) return false;
    var lines = text.split(/\r\n|\r|\n/);
    var limit = orientScanLimit(lines);
    var down = false;
    for (var i = 0; i < limit; i++) {
      var line = lines[i].replace(/\s+/g, ' ').toLowerCase();
      if (!line) continue;
      if (ORIENT_ASSEMBLY_RE.test(line)) continue;
      if (ORIENT_UP_RE.test(line) || ORIENT_START_UP_RE.test(line)) return false;
      if (ORIENT_DOWN_RE.test(line) || ORIENT_START_DOWN_RE.test(line)) down = true;
    }
    return down;
  }

  /**
   * `textUpsideDown` memoised on the parse — the same cache `partLines`
   * invalidates when the text changes, so a row tap that rebuilds the model
   * never re-scans the header (exactly as `textCornersFor` does).
   */
  function textUpsideDownFor(prt) {
    var entry = partLines(prt);
    if (entry === EMPTY_ENTRY) return false;
    if (typeof entry.upsideDownText !== 'boolean') {
      entry.upsideDownText = textUpsideDown(prt && prt.patternText ? String(prt.patternText) : '');
    }
    return entry.upsideDownText;
  }

  /**
   * `{upsideDown, upsideDownSource}` for `Model.shape`, in resolution order:
   * the owner's explicit `Part.orientation` first — a chip beats a guess, both
   * ways round — then the pattern text, then false, because a piece that never
   * says grows the way the model already draws it.
   * @returns {{upsideDown:boolean, upsideDownSource:'part'|'text'|null}}
   */
  function orientationOf(prt) {
    var explicit = normalizeOrientation(prt && prt.orientation, 'auto');
    if (explicit === 'bottom-up') return { upsideDown: true, upsideDownSource: 'part' };
    if (explicit === 'top-down') return { upsideDown: false, upsideDownSource: 'part' };
    if (textUpsideDownFor(prt)) return { upsideDown: true, upsideDownSource: 'text' };
    return { upsideDown: false, upsideDownSource: null };
  }

  /**
   * `textDialect` memoised on the parse — the same cache `partLines` invalidates
   * when the text changes, exactly as `textUpsideDownFor` does. `diagramKey`
   * asks for this on every tap and the hints are ten regexes over 50 KB.
   * `false` is the memo for "asked, and the text does not say".
   */
  function textDialectFor(prt) {
    var entry = partLines(prt);
    if (entry === EMPTY_ENTRY) return null;
    if (entry.dialectText === undefined) {
      entry.dialectText = textDialect(prt && prt.patternText ? String(prt.patternText) : '', entry.craft) || false;
    }
    return entry.dialectText || null;
  }

  /**
   * UK or US stitch names for ONE piece, in resolution order: the owner's (or
   * the importer's) explicit `Part.dialect`, then what this piece's own text
   * says, then null — "nobody knows", and `Patterns.expand` may go on reading
   * the text for itself.
   * @returns {'uk'|'us'|null}
   */
  function partDialect(prt) {
    var explicit = normalizeDialect(prt && prt.dialect, 'auto');
    if (explicit !== 'auto') return explicit;
    return textDialectFor(prt);
  }

  var START_KINDS = {
    'magic-ring': true,
    'chain-ring': true,
    'chain-oval': true,
    'chain-row': true,
    unknown: true
  };

  function posIntOrNull(v) {
    return typeof v === 'number' && isFinite(v) && v > 0 ? Math.floor(v) : null;
  }

  /**
   * `Model.shape` — how the piece starts, whether it is stuffed and which way
   * up it was worked, from `Patterns.startHint` / `Patterns.stuffingHint` and
   * `orientationOf`. Every field degrades to 'unknown' / null / false, so a
   * parser without them costs nothing but detail.
   */
  function partShape(prt) {
    var orient = orientationOf(prt);
    var out = {
      start: 'unknown', chainLen: null, ringCount: null, stuffed: null,
      // The polygon prior (01 §1.4). Filled in by buildDiagramModel, which is
      // the only place that has the per-round increase sites to judge it.
      corners: 0, cornersSource: null,
      // Which way up the piece was worked — the chip, else the text, else
      // false. See `orientationOf` above.
      upsideDown: orient.upsideDown, upsideDownSource: orient.upsideDownSource,
      // Which dialect named the stitches, and so how tall a `tr` is — the chip
      // or the import, else this piece's own text, else null. See `partDialect`.
      dialect: partDialect(prt)
    };
    var api = patternsApi(prt);
    var lines = linesFor(prt);
    if (api && typeof api.startHint === 'function' && lines.length) {
      try {
        var h = api.startHint(lines);
        if (h && typeof h === 'object') {
          var s = str(h.start, '').trim();
          if (START_KINDS[s]) out.start = s;
          out.chainLen = posIntOrNull(h.chainLen);
          out.ringCount = posIntOrNull(h.ringCount);
        }
      } catch (e) {
        /* leave it unknown */
      }
    }
    if (api && typeof api.stuffingHint === 'function') {
      try {
        var v = api.stuffingHint(prt && prt.patternText ? String(prt.patternText) : '');
        if (v === true || v === false) out.stuffed = v;
      } catch (e) {
        /* leave it null — "the pattern does not say" */
      }
    }
    // wave H (knit-qa-2): a knitted piece picked up along the TOP edge of
    // another and worked up (the Cabled Yoke's Top Yoke) is drawn bottom-up
    // by the model (knitShapeHints); the viewer's "Auto — …" line reads it here,
    // so it no longer said "Auto — top-down" over "worked bottom-up"
    if (!out.upsideDownSource && craftKeyOf(prt) === 'knitting' &&
        KNIT_WORKED_UP_RE.test(prt && prt.patternText ? String(prt.patternText) : '')) {
      out.upsideDown = true;
      out.upsideDownSource = 'text';
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * The polygon prior (01 §1.4, 07-review finding 1 / defect D1)
   *
   * A granny square, a hexagon motif and an octagon are RINGS in the count
   * sequence and polygons on the table, and the difference is where the
   * increases sit. `js/diagram-geo.js` `polygonFit` already reads the
   * per-round increase sites the model publishes — but a granny round is
   * phrased `(3 dc, ch 3, 3 dc) in corner sp`, which `Patterns.expand` returns
   * as a flat count with no positioned `inc` at all, so there is nothing to
   * fit and every motif in the corpus renders as a solid of revolution.
   *
   * `Model.shape.corners` is the escape hatch 01 §1.4.7 asked for: the number
   * of corners the PATTERN TEXT says the piece has, offered to the geometry as
   * a prior for exactly the case where the sites are missing.
   * `cornersSource` says where it came from, so nothing downstream has to
   * treat a guess as a measurement.
   * ------------------------------------------------------------------ */

  var CORNER_KS = [4, 6, 8, 3];          // same order as DiagramGeo.POLY_KS
  var CORNER_OCCUPANCY = 0.8;            // >= ceil(0.8k) of the k slots used
  var CORNER_MIN_PER_SITE = 1.8;         // a corner takes a group, not one st
  var CORNER_PERSIST = 3;                // 01 §1.4.4: one round is a dart
  var CORNER_MIN_ROUNDS = 3;             // ...so a 1-round scrap is never a k-gon
  var TAU = Math.PI * 2;

  /**
   * Best k for ONE round's increase sites, or 0. A deliberate mirror of
   * `DiagramGeo.polygonFit` (01 §1.4 steps 2-4) on the RAW site list: the
   * store must reach the same verdict the geometry will, because the whole
   * point of the text fallback is to fire only where the sites cannot decide.
   */
  /**
   * A round's increase sites as positions along the round, measured by the
   * widths of the stitch records before them, and the round's own record width
   * — the mirror of `DiagramGeo`'s `sitePositions`. A round of one-wide stitches
   * gives back exactly (sites, count).
   */
  function sitePlaces(r, sites, count) {
    var list = r && Array.isArray(r.stitches) ? r.stitches : null;
    if (!list || !list.length) return { pos: sites, mod: count };
    var cum = [0], i, w, lastW = 1;
    for (i = 0; i < list.length; i++) {
      w = list[i] && typeof list[i].w === 'number' && isFinite(list[i].w) && list[i].w >= 0 ? list[i].w : 1;
      lastW = w;
      cum.push(cum[i] + w);
    }
    var mod = cum[list.length];
    if (count > list.length) mod += (count - list.length) * lastW;
    if (!(mod > 0)) return { pos: sites, mod: count };
    var pos = [];
    for (i = 0; i < sites.length; i++) {
      var s = sites[i] | 0;
      pos.push(s >= 0 && s < list.length ? cum[s] : s);
    }
    return { pos: pos, mod: mod };
  }

  /** Increase groups with a chain run inside them (`inc … ch … inc+`): the
   *  mirror of `DiagramGeo`'s `cornerGroups`. */
  function cornerGroupCount(r) {
    var list = r && Array.isArray(r.stitches) ? r.stitches : null;
    if (!list) return 0;
    var n = 0, i, inGroup = false, sawCh = false;
    for (i = 0; i < list.length; i++) {
      var t = (list[i] && list[i].t) || '';
      if (t === 'inc') { inGroup = true; sawCh = false; continue; }
      if (!inGroup) continue;
      if (t === 'ch') { sawCh = true; continue; }
      if (t === 'inc+') { if (sawCh) { n++; inGroup = false; } continue; }
      inGroup = false;
    }
    return n;
  }

  function cornerFitRound(sites, count) {
    if (!sites || sites.length < 3 || count < 6) return 0;
    var thetas = [], i;
    for (i = 0; i < sites.length; i++) {
      thetas.push((((sites[i] % count) + count) % count) / count * TAU);
    }
    for (var ki = 0; ki < CORNER_KS.length; ki++) {
      var k = CORNER_KS[ki];
      var need = Math.ceil(CORNER_OCCUPANCY * k);
      if (thetas.length < need) continue;
      if (thetas.length > k * 2) continue;     // too many sites for k corners
      var seg = TAU / k, sx = 0, sy = 0, u;
      for (i = 0; i < thetas.length; i++) {
        u = thetas[i] % seg;
        sx += Math.cos(u * k); sy += Math.sin(u * k);
      }
      /* A weak resultant means the sites are spread across the slice rather
         than clustered in it — 6 hexagon corners tested against k = 4. */
      if (Math.sqrt(sx * sx + sy * sy) / thetas.length < 0.5) continue;
      var mean = Math.atan2(sy, sx) / k;
      if (mean < 0) mean += seg;
      var tol = (Math.PI / k) / 3, ok = true, occ = {}, nOcc = 0, d, slot, key;
      for (i = 0; i < thetas.length; i++) {
        d = thetas[i] - mean;
        slot = Math.round(d / seg);
        if (Math.abs(d - slot * seg) > tol) { ok = false; break; }
        key = ((slot % k) + k) % k;
        if (!occ[key]) { occ[key] = 1; nOcc++; }
      }
      if (ok && nOcc >= need) return k;
    }
    return 0;
  }

  /**
   * What the increase SITES say about the piece.
   * `k` is a corner count they settle on their own (the same k for
   * CORNER_PERSIST consecutive rounds, each growing by >= 1.8 stitches per
   * site — a corner is a group, 01 §1.4.5); `circle` counts the rounds whose
   * sites DO land on k even slots but add only one stitch each, which is not a
   * polygon at all, it is the `[n sc, inc] x k` of every amigurumi sphere.
   * @returns {{k:number, circle:number}}
   */
  function siteCorners(rounds) {
    var best = 0, runK = 0, run = 0, circle = 0, prev = 0, i;
    for (i = 0; i < rounds.length; i++) {
      var r = rounds[i];
      var c = r && r.count > 0 ? r.count : 0;
      if (!c) { runK = 0; run = 0; prev = 0; continue; }
      var sites = Array.isArray(r.inc) ? r.inc : [];
      // Placed along the round by the widths of the records before them, as
      // `DiagramGeo.polygonFit` now places them: a site is a RECORD index, and a
      // lace round carries more records (its chain spaces) than its count.
      var sp = sitePlaces(r, sites, c);
      var k = cornerFitRound(sp.pos, sp.mod);
      if (k && prev > 0) {
        // Mirrors DiagramGeo's `spread` test. A group with a chain run inside it
        // — `(sc, ch 2, sc) in the corner` — is a corner by construction, and a
        // round whose COUNT fell (a lace round trading stitches for chain
        // spaces: Persian Tiles round 4 reads 36 -> 19) says nothing about
        // "+1 per site", so it is never counted as a circle.
        var dnc = c - prev;
        if (cornerGroupCount(r) > 0 || (dnc > 0 && dnc / sites.length >= CORNER_MIN_PER_SITE)) {
          if (k === runK) { run++; } else { runK = k; run = 1; }
          if (run >= CORNER_PERSIST && !best) best = k;
        } else if (dnc > 0) {
          circle++;
          runK = 0; run = 0;
        } else {
          runK = 0; run = 0;
        }
      } else {
        runK = 0; run = 0;
      }
      prev = c;
    }
    return { k: best, circle: circle };
  }

  /* 01 §1.4.7, verbatim from the fixtures. Tried in this order, so a piece
     that says "hexagon" in one place and "square brackets" in another is a
     hexagon: the named polygon always beats the generic corner vocabulary. */
  var CORNER_TEXT = [
    { k: 8, re: /\boctagon(s|al)?\b/ },
    {
      k: 6,
      re: /\bhexagon(s|al)?\b|\bhexes\b|\bhex\b|\b6\s*x\s*3\s*tr\b|\bsix[\s-]?(fold|sided|pointed)\b|\b(six|6)\s+corners\b/
    },
    { k: 3, re: /\btriangle\s+motif\b|\btriangular\s+motif\b|\bmotif\s+triangle\b/ },
    {
      k: 4,
      re: /\bcorner[\s-]*sp(ace)?s?\b|\bin each corner\b|\bgranny\b|\bsquares?\b|\btiles?\b|\bmotifs?\b|\(\s*3\s*d?c[^)]*\bch\s*[235]\b[^)]*\)\s*in\b[^.]{0,24}\bcorner\b/
    }
  ];

  /** 0 | 3 | 4 | 6 | 8 from the part's pattern text. */
  function textCorners(raw) {
    if (!raw) return 0;
    var t = String(raw).replace(/\s+/g, ' ').toLowerCase();
    for (var i = 0; i < CORNER_TEXT.length; i++) {
      if (CORNER_TEXT[i].re.test(t)) return CORNER_TEXT[i].k;
    }
    return 0;
  }

  /**
   * `textCorners` against a 52 KB pattern, memoised on the parse (the same
   * cache `partLines` invalidates when the text changes), so a row tap that
   * rebuilds the model never re-scans the text.
   */
  function textCornersFor(prt) {
    var entry = partLines(prt);
    if (entry === EMPTY_ENTRY) return 0;
    if (typeof entry.cornersText !== 'number') {
      entry.cornersText = textCorners(prt && prt.patternText ? String(prt.patternText) : '');
    }
    return entry.cornersText;
  }

  /**
   * `{corners, cornersSource}` for `Model.shape`. Rounds only — a panel worked
   * in rows has edges, not corners, and `classifyRows` says so — and only for
   * a piece with enough rounds to persist (01 §1.4.4).
   */
  function cornersOf(mode, rounds, prt) {
    var out = { corners: 0, cornersSource: null };
    if (mode !== 'rounds') return out;
    var solid = 0, i;
    for (i = 0; i < rounds.length; i++) if (rounds[i] && rounds[i].count > 0) solid++;
    if (solid < CORNER_MIN_ROUNDS) return out;

    var sc = siteCorners(rounds);
    if (sc.k) {
      out.corners = sc.k;
      out.cornersSource = 'sites';
      return out;
    }
    /* The sites are readable and they read as a CIRCLE. This is the guard that
       keeps the panda, the snowman, the turtle, the bear, cato, the baphomet,
       the bee and the pumpkins at 0 corners no matter what stray word
       ("a tension square") the pattern happens to contain. */
    if (sc.circle >= CORNER_PERSIST) return out;

    var k = textCornersFor(prt);
    if (k) {
      out.corners = k;
      out.cornersSource = 'text';
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Outlier rounds (07-review finding 3 / defect D4)
   *
   * `405, 2, 5, 5, 405 …` is not a wrap with a notch in it and `18, 18, 2, 2,
   * 2, 2` is not a swatch with a tower on it: they are lines the parser
   * misread, and drawn at full width ratio they tear the sheet into detached
   * pieces. The count is KEPT — the model never invents fabric — and the round
   * carries `outlier: true` so the geometry can leave it out of the surface.
   * ------------------------------------------------------------------ */

  var OUTLIER_FRAC = 0.2;

  /**
   * Flags every round whose count is a wild outlier from its neighbours, and
   * sets `outlier: false` on every other one so the field is never undefined.
   *
   * Rows mode judges a row against the nearest real row before it and the
   * nearest full-size row after it (their median), which is what makes the
   * whole `2, 5, 5` run fall: once row 2 is out, row 3 is measured against the
   * 405 before it and not against row 2. A trailing run can fall the same way
   * — the cardigan swatch's four 2-stitch rows are the clearest single image
   * of the defect. What CANNOT fall is a genuine decrease run, because each of
   * its steps is a fraction of the row before, not a fifth of it.
   *
   * Rounds mode is stricter: only a MID-PIECE round, under a fifth of both
   * neighbours — a mis-parsed note between two real rounds. Never the first or
   * the last round, so a magic-ring start and a `pull to close` finish are
   * safe by construction.
   */
  function flagOutliers(mode, rounds) {
    var n = rounds.length, i, j;
    for (i = 0; i < n; i++) if (rounds[i]) rounds[i].outlier = false;
    if (n < 3) return;
    var hi = mode === 'rows' ? n - 1 : n - 2;
    for (i = 1; i <= hi; i++) {
      var r = rounds[i];
      if (!r || !(r.count > 0)) continue;
      if (r.row === 1) continue;           // the piece's own first round, never
      var prev = 0;
      for (j = i - 1; j >= 0; j--) {
        if (rounds[j] && rounds[j].count > 0 && !rounds[j].outlier) {
          prev = rounds[j].count;
          break;
        }
      }
      if (!(prev > 0)) continue;
      var thresh = OUTLIER_FRAC * prev;
      if (r.count >= thresh) continue;
      var next = 0;
      for (j = i + 1; j < n; j++) {
        var c = rounds[j] && rounds[j].count > 0 ? rounds[j].count : 0;
        if (c >= thresh && c > 0) { next = c; break; }
      }
      // In rounds mode a run that never comes back is the piece closing, not a
      // note: `…, 12, 6, 2` is real fabric and must stay.
      if (!next) { if (mode !== 'rows') continue; }
      else if (r.count >= OUTLIER_FRAC * ((prev + next) / 2)) continue;
      r.outlier = true;
    }
    // The LAST round in rounds mode, which the loop above never judges (a
    // `pull to close` finish is real fabric). A round cannot shrink faster than
    // its tightest decrease allows — a 3-into-1 takes three stitches to one — so
    // a closing round under a third of the round before it is not a round at
    // all: it is a few stitches worked on the way to fastening off. cato's Ears
    // end `11. Sc 2, then FO. Pinch ear together` — 21, 21, 2 — and the 2 capped
    // an open cup and pinched it shut.
    if (mode !== 'rows') {
      var li = n - 1;
      while (li > 0 && !(rounds[li] && rounds[li].count > 0)) li--;
      if (li > 0 && rounds[li].row !== 1) {
        var lp = 0;
        for (j = li - 1; j >= 0; j--) {
          if (rounds[j] && rounds[j].count > 0 && !rounds[j].outlier) { lp = rounds[j].count; break; }
        }
        if (lp > 0 && rounds[li].count * 3 < lp) rounds[li].outlier = true;
      }
    }
  }

  /* A chain ring's first round is worked into EVERY chain, so `make 240ch,
     join chain into a circle` is a 240-stitch round however few stitches the
     parse found in the `Rnd 1` line (the Stylecraft cowl reads 23 — 07-review
     defect D5). Small rings are left alone: `ch 4; join to form a ring` then
     `16 dc in ring` is 16 stitches in a 4-chain loop, not 4. */
  var CHAIN_RING_MIN = 12;
  var CHAIN_RING_FRAC = 0.5;

  /**
   * The pattern's count for the round being worked vs the stitches actually
   * tapped into it (05-ux-meaning #12). `expected` is null when the pattern
   * never said, and is never compared against a count the store invented.
   * @returns {{expected:number|null, actual:number, row:number, delta:number|null}}
   */
  function roundDeviation(prt) {
    if (!prt) return { expected: null, actual: 0, row: 0, delta: null, printed: null, computed: null };
    var row = clampInt(prt.row, 0, 999999, 0) + 1;
    var patternRow = patternRowForRow(prt, row);
    var expected = targetFor(prt, patternRow);
    var actual = clampInt(prt.stitch, 0, 999999, 0);
    // A designer error kept as printed (Baphomet R29 "(2sc, dec)x8 [36]" makes
    // 24; cato Feet R3). `expected` stays the PRINTED count — the pattern is
    // quoted, never corrected — and the pair rides along so the UI can say
    // which number the instructions themselves make.
    var chk = null;
    try {
      var idx = linesFor(prt).length ? rowIndexOf(prt) : null;
      chk = countCheck(idx ? idx.line[patternRow] : null, null);
    } catch (e) {
      chk = null;
    }
    return {
      expected: expected,
      actual: actual,
      row: row,
      delta: expected === null ? null : actual - expected,
      printed: chk ? chk.printed : null,
      computed: chk ? chk.computed : null
    };
  }

  function finiteCount(v) {
    return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : null;
  }

  /**
   * `{printed, computed}` when a round's printed total and the count its own
   * instructions make DISAGREE, else null. Reads, most specific first: the
   * `deviation` object the parser puts on an `expand` round record and on the
   * parse line (only for rounds written in plain sc/inc/dec arithmetic, where
   * its evaluation is reliable), then bare `printed` / `computed` on either.
   * It does NOT fall back to the parse line's `stitches` / `computed` pair:
   * the parser leaves `computed` on rounds it could not evaluate exactly, and
   * flagging those would tell the maker the pattern is wrong when it is not.
   */
  function countCheck(line, ex) {
    var printed = null, computed = null;
    var srcs = [ex && ex.deviation, line && line.deviation, ex, line], i, s;
    for (i = 0; i < srcs.length && (printed === null || computed === null); i++) {
      s = srcs[i];
      if (!s || typeof s !== 'object') continue;
      if (printed === null) printed = finiteCount(s.printed);
      if (computed === null) computed = finiteCount(s.computed);
    }
    if (printed === null || computed === null || printed === computed) return null;
    return { printed: printed, computed: computed };
  }

  /**
   * Increase / decrease positions for one round. `expand`'s own index arrays
   * win; without them the stitch types are read, collapsing the two adjacent
   * `inc` entries of one increase (and the newer `inc` + `inc+` pair) into the
   * single site they really are.
   */
  function incDecPositions(ex, stitches, positions) {
    var inc = [];
    var dec = [];
    var i, n;

    // `stitches` may be an even SAMPLE of a long round (see the position cap in
    // buildDiagramModel), and `expand` indexes the full list — so an index is
    // scaled into the sample it was taken from, or a mesh row's marks would all
    // land in its first quarter.
    var kept = stitches.length;
    var total = (typeof positions === 'number' && positions > kept) ? positions : kept;
    var scale = (kept > 0 && total > kept) ? kept / total : 0;

    function collect(raw, into) {
      if (!Array.isArray(raw)) return false;
      var seen = {};
      for (var k = 0; k < raw.length; k++) {
        var v = raw[k];
        if (typeof v === 'number' && isFinite(v) && v >= 0 && v < total) {
          v = Math.floor(v);
          if (scale) {
            v = Math.floor(v * scale);
            if (v >= kept) v = kept - 1;
          }
          if (!seen[v]) { seen[v] = 1; into.push(v); }
        }
      }
      into.sort(function (a, b) { return a - b; });
      return true;
    }

    var gotInc = ex ? collect(ex.inc, inc) : false;
    var gotDec = ex ? collect(ex.dec, dec) : false;
    if (gotInc && gotDec) return { inc: inc, dec: dec };

    // An increase produces TWO stitches in one place, so pair them up: six
    // adjacent `inc` entries are six stitches at three sites, not one site.
    // `inc+` (the newer parser's explicit continuation) closes a pair outright.
    var open = false;
    for (i = 0, n = stitches.length; i < n; i++) {
      var t = stitches[i].t;
      if (t === 'inc') {
        if (open) open = false;
        else { if (!gotInc) inc.push(i); open = true; }
      } else if (t === 'inc+') {
        open = false;
      } else {
        open = false;
        if (!gotDec && t === 'dec') dec.push(i);
        // Wave H: a knitting record is its own site — one yo / m1 / kfb is one
        // increase, one k2tog / ssk / cdd one decrease. No crochet type is here.
        else if (!gotInc && KNIT_INC_T[t] === 1) inc.push(i);
        else if (!gotDec && KNIT_DEC_T[t] === 1) dec.push(i);
      }
    }
    return { inc: inc, dec: dec };
  }

  var KNIT_INC_T = { yo: 1, m1: 1, m1l: 1, m1r: 1, m1p: 1, kfb: 1, pfb: 1, kyok: 1 };
  var KNIT_DEC_T = {
    k2tog: 1, ssk: 1, p2tog: 1, ssp: 1, k3tog: 1, p3tog: 1, sssk: 1, sssp: 1, cdd: 1, s2kp: 1,
    sk2p: 1, skp: 1
  };

  /**
   * How many of `expand`'s positions the pattern COUNTS. A chain space is a ring
   * position but not a stitch (`{t:'ch'}`), and the totals a pattern prints —
   * and so `Patterns` reports — never include them. Feeding positions forward as
   * the next row's starting count is what inflated a ch-3 mesh row by 4x a row.
   */
  /** A stitch record's height: a real 0 (a chain space) is kept, junk is 1. */
  function diagramStitchH(v) {
    return typeof v === 'number' && isFinite(v) && v >= 0 ? v : 1;
  }

  function countableStitches(list) {
    var n = 0, i, e;
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (!e || e.t !== 'ch') n += knitRecordSpan(e);
    }
    return n;
  }

  /**
   * Stitches one record stands for: 1, except a knitted cable (wave H), which
   * is ONE record `w` wide over several stitches (contract §2) — its own `n`
   * when `Knits.expand` gives it, else its width at 0.85 a stitch. Crochet
   * records never carry either, so their count is unchanged.
   */
  function knitRecordSpan(e) {
    // a bound-off stitch is in its row's fabric but no longer on the needle
    if (e && e.t === 'bo') return 0;
    // Knits.expand writes a cable as one record per stitch (`span`, `at`)
    if (!e || e.t !== 'cable' || typeof e.at === 'number') return 1;
    if (typeof e.n === 'number' && isFinite(e.n) && e.n >= 1) return Math.min(24, Math.floor(e.n));
    var w = typeof e.w === 'number' && isFinite(e.w) && e.w > 0 ? e.w : 4 * 0.85;
    return Math.max(2, Math.min(24, Math.round(w / 0.85)));
  }

  function buildDiagramModel(prt, proj) {
    // wave H: lines and expand come from ONE craft — the project's
    bindPartProject(prt, proj);
    var mode = partWorkMode(prt, proj === undefined ? null : proj);
    var main = mainYarn(proj);
    var resolve = makeColorResolver(proj, prt);
    var lines = linesFor(prt);
    var rowIndex = lines.length ? rowIndexOf(prt) : null;
    var rs = Array.isArray(prt.rowStitches) ? prt.rowStitches : [];
    var api = patternsApi(prt);
    var canExpand = !!(lines.length && api && typeof api.expand === 'function');
    // Read up front: round 1 is seeded from a big chain ring (D5) while the
    // rows are being walked, not patched up afterwards.
    var shape = partShape(prt);
    // Wave H: a knitting part tells the 3D how its rows were worked (side,
    // short rows, markers) and how its ends close (graft, a toe cast-on).
    var knit = craftKeyOf(proj || prt) === 'knitting';
    if (knit) knitShapeHints(shape, prt);
    var cableDefs = knit ? knitCableDefsFor(prt, proj) : null;

    var maxRow = 0;
    if (lines.length) {
      var sum = patternSummary(prt);
      if (typeof sum.maxRow === 'number' && sum.maxRow > 0) maxRow = Math.floor(sum.maxRow);
    }
    var workingRow = clampInt(prt.row, 0, 999999, 0) + 1;
    var total = Math.max(workingRow, maxRow, rs.length - 1);
    if (total < 1) total = 1;
    if (total > ROW_INDEX_MAX) total = ROW_INDEX_MAX;

    // A 900-round blanket shows a window of rounds, and that window is anchored
    // to the round being WORKED, not to the end of the pattern
    // (03-model-builder finding 1: at round 5 of 600 the old window returned
    // rounds 201-600 and wrote the live stitch count onto round 600).
    var anchor = Math.min(workingRow, total);
    var first = 1;
    var last = total;
    if (total > DIAGRAM_MAX_ROUNDS) {
      first = anchor - Math.floor(DIAGRAM_MAX_ROUNDS * DIAGRAM_WINDOW_BACK);
      var latest = total - DIAGRAM_MAX_ROUNDS + 1;
      if (first > latest) first = latest;
      if (first < 1) first = 1;
      last = Math.min(total, first + DIAGRAM_MAX_ROUNDS - 1);
    }

    var rounds = [];
    var current = -1;
    // `expand` reads the dialect off the part text it was handed and caches the
    // answer on its own state, so a section that says nothing gets US heights —
    // a `tr` two rounds tall instead of the UK treble's 2.01, which cupped every
    // granny square in a UK leaflet. Seeding the state says it outright; a null
    // dialect seeds nothing and `expand` goes on deciding for itself.
    var state = shape.dialect ? { uk: shape.dialect === 'uk' } : null;
    var prevCount = 0;
    // Wave H: a knitted piece starts on its cast-on ("CO 56 sts", the parser's
    // row-0 setup line), so row 1 is worked over those stitches, not from 0 —
    // "*k2, p2; rep from * to end" needs to know where the end is.
    if (knit) {
      for (var li = 0; li < lines.length; li++) {
        var sl0 = lines[li];
        if (!sl0) continue;
        if (typeof sl0.row === 'number' && sl0.row >= 1) break;
        if (sl0.kind === 'setup' && typeof sl0.count === 'number' && isFinite(sl0.count) && sl0.count > 0) {
          prevCount = Math.floor(sl0.count);
          break;
        }
      }
      /* knit-3d-2: a part that starts mid-piece ("Sleeves (continued)": the
         section break fell inside the sleeve) carries the stitches the part
         before it in the project ended on — Knits expands its rows from 0
         otherwise and answers `live: 0`, "unknown" */
      if (!prevCount && lines.length) prevCount = knitCarriedCount(prt, proj);
    }

    // Rows past the window are never pushed and nothing downstream reads their
    // colour state, so the walk stops at `last`.
    for (var row = 1; row <= last; row++) {
      var patternRow = patternRowForRow(prt, row);
      var line = rowIndex ? rowIndex.line[patternRow] : null;
      if (line === undefined) line = null;
      var stitches = [];
      var count = 0;
      var height = 1;
      var color = main;
      var ex = null;
      var positions = 0;
      var truncated = false;
      var boOnly = 0;
      var knitUnknown = false;

      if (canExpand) {
        try {
          ex = api.expand(lines, patternRow, prevCount, state);
        } catch (e) {
          ex = null;
        }
        if (ex && typeof ex === 'object') {
          if (ex.state !== undefined) state = ex.state;
          if (typeof ex.height === 'number' && isFinite(ex.height) && ex.height > 0) height = ex.height;
          if (ex.color) color = resolve(ex.color);
          var list = Array.isArray(ex.stitches) ? ex.stitches : [];
          if (list.length > DIAGRAM_MAX_POSITIONS) list = list.slice(0, DIAGRAM_MAX_POSITIONS);
          // knit-3d-2: a fallback (Knits now writes `at` on every cable record): a cable written one record per stitch without `at` (a
          // panel row Knits expanded) is numbered, so it counts as its stitches
          if (knit) list = knitCableAt(list);
          positions = list.length;
          // The round's COUNT is its stitches; its POSITIONS are its geometry.
          // On a ch-3 mesh row those differ four-fold, and it is the count that
          // the next row starts from (and that the stitch counter compares
          // against), so the chain spaces are left out of it.
          count = countableStitches(list);
          // Wave H: a row that binds every stitch off leaves none on the needle,
          // but it is still a row of fabric — the bind-off edge — so it is drawn
          // as the stitches it bound off, and the next row starts from 0.
          if (knit && !count) {
            for (var bi = 0; bi < list.length; bi++) if (list[bi] && list[bi].t === 'bo') boOnly++;
            if (boOnly) count = boOnly;
          }
          /* knit-3d-2: `live: 0` on a row that says something is UNKNOWN (no
             start count reached it), not an empty ring: it carries the count
             before it and is marked `countless` below */
          // (a round with no row of its own — "Cont St-st in rnds until 32 cm"
          // after "= 92 sts." — carries the stitches it was started on)
          if (knit && !count && !list.length && ex.live === 0 &&
              (line ? line.kind !== 'setup' && /\S/.test(String(line.text || '')) : prevCount > 0)) knitUnknown = true;
          // Rows before the window are walked only to carry `prevCount` and the
          // colour state forward, so they never pay for stitch records.
          if (row >= first && positions > 0) {
            var keep = positions > STITCH_DETAIL_MAX ? STITCH_DETAIL_MAX : positions;
            truncated = keep < positions;
            for (var si = 0; si < keep; si++) {
              // Evenly sampled, never the first 999 of 1,617: the row still
              // reads as itself, and `truncated` says the list is a sample.
              var src = truncated ? Math.floor(si * positions / keep) : si;
              var st = list[src] && typeof list[src] === 'object' ? list[src] : {};
              // h/w per stitch: a dc bump is twice as tall as an sc, an inc
              // wider than a dec. `expand` computed them and used to throw
              // them away.
              var rec = {
                t: str(st.t, '') || 'x',
                c: st.c ? resolve(st.c) : null,
                // A chain is a SPACE: `expand` gives it h 0 (01 §1.2, "ch-k
                // bridging k skipped sts: width k, height 0"), and reading that
                // 0 as "missing" stood every chain up as a one-sc-high stitch,
                // so a mesh round's height was voted on by its chain spaces.
                h: diagramStitchH(st.h),
                w: posNum(st.w, 1)
              };
              // Post and loop placement (07 D9): the renderer gives a front-post
              // stitch relief, sinks a back-post one and ridges a BLO base. Only
              // the two known values of each pass, and only when expand sends them.
              if (st.post === 'front' || st.post === 'back') rec.post = st.post;
              if (st.lp === 'blo' || st.lp === 'flo') rec.lp = st.lp;
              // Wave H: the side of the row a knit stitch was worked on (a purl
              // on the WS is a knit V on the face), a cable's cross and span.
              if (knit) {
                if (st.side === 'rs' || st.side === 'ws') rec.side = st.side;
                if (st.cross === 'f' || st.cross === 'b') rec.cross = st.cross;
                if (typeof st.n === 'number' && isFinite(st.n) && st.n >= 1) rec.n = Math.floor(st.n);
                if (typeof st.span === 'number' && isFinite(st.span) && st.span >= 1) rec.span = Math.floor(st.span);
                if (typeof st.at === 'number' && isFinite(st.at) && st.at >= 0) rec.at = Math.floor(st.at);
                // knit-3d-2: a crossing's name and its two groups, when Knits sends them
                if (st.t === 'cable') {
                  if (typeof st.name === 'string' && st.name) rec.name = st.name.slice(0, 8);
                  if (typeof st.cf === 'number' && isFinite(st.cf) && st.cf >= 1) rec.cf = Math.floor(st.cf);
                  if (typeof st.cb === 'number' && isFinite(st.cb) && st.cb >= 0) rec.cb = Math.floor(st.cb);
                }
              }
              stitches.push(rec);
            }
            // knit-3d-2: which cable each crossing is, and its two groups
            if (knit && cableDefs) knitNameCables(stitches, line, cableDefs);
          }
        } else {
          ex = null;
        }
      }
      // No expand (or it gave up): counts only, generic stitches. The row index
      // already holds the count this ROW publishes, so a growing range does not
      // fall back to its end-of-range total (`countOf` reads `line.count`, which
      // is 57 for every row of "Row 6-55: Repeat rows 4 & 5 <57 sts>").
      if (!count && line) {
        var lc = rowIndex ? rowIndex.count[patternRow] : undefined;
        if (typeof lc !== 'number' || !isFinite(lc)) lc = countOf(line);
        if (typeof lc === 'number' && lc > 0) count = Math.floor(lc);
      }
      if (!count && rs[row] > 0) count = rs[row];
      /* Wave F (3D follow): the round being worked with no parsed count is
         sized from the counter's own target for that row — the number the
         readout shows, which also answers past the written rows from the
         repeat sentence — so the piece can turn 360/target per tap. With no
         target either, the ring is only as long as what has been tapped and
         the round says so (`countless`): there is no honest size to turn by. */
      // knit-3d-2: an unknown knitted row (`live: 0`) carries the count before it
      var knitCarried = false;
      if (knitUnknown && !count && prevCount > 0) { count = prevCount; knitCarried = true; }
      var countless = false;
      if (!count && row === workingRow) {
        var tgt = (rowIndex ? usableCount(rowIndex.count[patternRow]) : null) || targetFor(prt, patternRow) || 0;
        count = Math.max(prt.stitch, tgt);
        countless = !tgt;
      }

      // The chain ring wins round 1 (D5). Round 2 then starts from the chain
      // too, because `prevCount` is what `expand` is handed next.
      if (row === 1 && mode === 'rounds' && shape.start === 'chain-ring' &&
          shape.chainLen >= CHAIN_RING_MIN && count < CHAIN_RING_FRAC * shape.chainLen) {
        count = shape.chainLen;
        // The parsed positions described a 23-stitch round; they do not
        // describe this one, so the round falls back to generic stitches
        // below and publishes no increase sites it cannot vouch for.
        stitches = [];
        positions = 0;
        truncated = false;
        ex = null;
      }

      var done;
      if (row < workingRow) done = rs[row] > 0 ? rs[row] : count;
      else if (row === workingRow) done = prt.stitch;
      else done = 0;
      if (count < done) count = done;

      // A count with nothing behind it still gets one entry per stitch, so the
      // renderer never has to guess how long the round is.
      if (row >= first && !stitches.length && count > 0) {
        var generic = Math.min(count, STITCH_DETAIL_MAX);
        // wave H: a knitted row with nothing behind it is plain knitting, 0.75 tall
        for (var gi = 0; gi < generic; gi++) {
          stitches.push(knit ? { t: 'k', c: null, h: 0.75, w: 1 } : { t: 'x', c: null, h: 1, w: 1 });
        }
      }

      if (row >= first) {
        if (row === anchor) current = rounds.length;
        var marks = incDecPositions(ex, stitches, positions);
        // A printed total that disagrees with its own instructions is kept as
        // printed (`count`); the pair is published for whoever wants to say so.
        var chkR = countCheck(line, ex);
        var roundRec = {
          printed: chkR ? chkR.printed : null,
          computed: chkR ? chkR.computed : null,
          count: count,
          done: done,
          stitches: stitches,
          color: color,
          height: height,
          ghost: row > workingRow,
          inc: marks.inc,
          dec: marks.dec,
          // true when `stitches` is an even SAMPLE of a longer position list.
          truncated: truncated,
          // set by flagOutliers once the whole sequence is known: this count is
          // a wild outlier from its neighbours, i.e. a mis-parsed line.
          outlier: false,
          // 1-based pattern row this round draws (= the work row; they differ
          // only inside a repeat, where the pattern row is reused).
          row: row
        };
        // Only on the working round, and only when nothing sized it (wave F):
        // its `count` is just the stitches tapped so far, so the renderer's
        // follow mode must not turn by it. Absent otherwise.
        if (countless) roundRec.countless = true;
        // knit-3d-2: an unknown knitted row drawn at the count it carried (or none)
        if (knitUnknown && (knitCarried || !count)) roundRec.countless = true;
        if (knit && line) knitRoundFields(roundRec, line);
        // wave H (knit-qa): a flat stretch inside a piece knitted in the
        // round takes its side by parity from the last stated tag — the
        // sock's "Rows 59-88: Rep Rows 57-58" states none, so 30 of its 32
        // heel-flap rows read as full rounds and the sock never turned its L
        if (knit && line && !roundRec.side && mode === 'rounds' && line.workedIn === 'rows') {
          var flatSide = patternSideAt(prt, patternRow, proj, { flat: true });
          if (flatSide && flatSide.side) roundRec.side = flatSide.side;
        }
        // the expand's own short-row verdict ("K25, wrap next st, turn")
        if (knit && ex && ex.shortRow === true) roundRec.shortRow = true;
        if (knit && ex && !roundRec.side && (ex.side === 'rs' || ex.side === 'ws')) roundRec.side = ex.side;
        rounds.push(roundRec);
      }
      prevCount = boOnly ? 0 : count;
    }

    if (current < 0) current = rounds.length ? rounds.length - 1 : 0;

    flagOutliers(mode, rounds);
    // wave K (K3, knit-3d; glue by knit-store): stranded colour from a read
    // chart, stitch by stitch. Knitting only; nothing changes without a read
    // chart whose key gives colours.
    var DG = window.DiagramGeo;
    if (knit && DG && typeof DG.applyChart === 'function' && knitHasColourChart(proj)) {
      for (var kci = 0; kci < rounds.length; kci++) {
        var kcells = null;
        try { kcells = knitChartCellsAt(prt, proj, rounds[kci].row); } catch (eK) { kcells = null; }
        if (kcells) {
          try { rounds[kci] = DG.applyChart(rounds[kci], kcells, { palette: yarnColorsOf(proj), main: mainYarn(proj) }); } catch (eK2) { /* keep the round */ }
        }
      }
    }
    /* knit-3d-2: a short row worked flat inside a round piece is SUPPOSED to
       be a few stitches of the ring (the first German short row across a
       back neck is 5 of 56) — DiagramGeo closes it with its held stitches;
       it is not a misread count */
    if (knit && mode === 'rounds') {
      for (var oi = 0; oi < rounds.length; oi++) {
        var orr = rounds[oi];
        if (orr.outlier && orr.shortRow === true && (orr.side === 'rs' || orr.side === 'ws')) orr.outlier = false;
      }
    }
    var ck = cornersOf(mode, rounds, prt);
    shape.corners = ck.corners;
    shape.cornersSource = ck.cornersSource;

    var dev = roundDeviation(prt);
    var model = {
      mode: mode,
      rounds: rounds,
      current: current,
      defaultColor: main,
      shape: shape,
      window: { first: rounds.length ? first : 0, total: total },
      deviation: { expected: dev.expected, actual: dev.actual }
    };
    // Wave H: the renderer and DiagramGeo take their knitting path from this
    if (knit) model.craft = 'knitting';
    return model;
  }

  /* ---- knitting (wave H, docs/wave-h/knit-3d.md) ---- */

  /** A toe or a sock closed by grafting — Kitchener stitch — is shut. */
  var KNIT_GRAFT_RE = /\b(?:kitchener|graft(?:ed|ing)?)\b/i;
  /** A cast-on that starts a toe (or a crown) closed instead of on an open edge. */
  var KNIT_CLOSED_START_RE =
    /\b(?:turkish|judy'?s|figure[\s-]*(?:8|eight)|magic[\s-]+cast[\s-]*on|pinhole|emily\s+ocker'?s?|circular\s+cast[\s-]*on|disappearing\s+loop)\b/i;

  /**
   * `shape.graft` / `shape.closedStart` (knitting only), memoised on the parse
   * like the orientation hint. Only `true` is ever written, so a crochet
   * shape and a knitting text that says neither keep exactly their keys.
   */
  function knitShapeHints(shape, prt) {
    var entry = partLines(prt);
    if (entry === EMPTY_ENTRY) return shape;
    if (!entry.knitHints) {
      var text = prt && prt.patternText ? String(prt.patternText) : '';
      entry.knitHints = { graft: KNIT_GRAFT_RE.test(text), closedStart: KNIT_CLOSED_START_RE.test(text),
        up: KNIT_WORKED_UP_RE.test(text) };
    }
    if (entry.knitHints.graft) shape.graft = true;
    if (entry.knitHints.closedStart) shape.closedStart = true;
    /* knit-3d-2: a piece picked up along the TOP edge of another and worked
       up from it (the Patons Cabled Yoke's Top Yoke, a collar) is drawn
       with its first round at the bottom — unless the part already says. */
    if (entry.knitHints.up && !shape.upsideDownSource) {
      shape.upsideDown = true;
      shape.upsideDownSource = 'text';
    }
    return shape;
  }

  /**
   * Number a cable written one record per stitch without `at` (Knits'
   * expanded panel rows): a run of identical cable records whose length is a
   * multiple of their `span` is that many crossings, `at` 0..span-1 each.
   * Returns the list itself when there is nothing to number.
   */
  function knitCableAt(list) {
    var out = null, i = 0, n = list.length;
    while (i < n) {
      var r = list[i];
      if (!r || r.t !== 'cable' || typeof r.at === 'number' || !(r.span >= 2)) { i++; continue; }
      var sp = Math.min(24, Math.floor(r.span)), j = i;
      while (j < n && list[j] && list[j].t === 'cable' && typeof list[j].at !== 'number' && list[j].span === r.span &&
             list[j].cross === r.cross && (list[j].name || '') === (r.name || '')) j++;
      var len = j - i;
      if (len >= sp && len % sp === 0) {
        if (!out) out = list.slice();
        for (var q = i; q < j; q++) {
          var c = {};
          for (var k in list[q]) if (Object.prototype.hasOwnProperty.call(list[q], k)) c[k] = list[q][k];
          c.at = (q - i) % sp;
          out[q] = c;
        }
      }
      i = j;
    }
    return out || list;
  }

  /**
   * The stitches a knitting part starts on when it prints no cast-on: what
   * the part before it in the project ended on ("Sleeves (continued)" after
   * "Sleeves"). 0 when there is no such part, it ended bound off, or it is
   * too long for its model to reach its end.
   */
  var knitCarryDepth = 0;
  function knitPrevPart(prt, proj) {
    var ps = proj && Array.isArray(proj.parts) ? proj.parts : null;
    if (!ps || !prt) return null;
    var i = ps.indexOf(prt);
    if (i < 0) for (var j = 0; j < ps.length; j++) if (ps[j] && ps[j].id === prt.id) { i = j; break; }
    return i > 0 ? ps[i - 1] || null : null;
  }
  function knitCarriedCount(prt, proj) {
    var pp = knitPrevPart(prt, proj);
    if (!pp || knitCarryDepth > 6) return 0;
    var m;
    knitCarryDepth++;
    try { m = diagramModel(pp, proj); } catch (e) { m = null; } finally { knitCarryDepth--; }
    var rs = m && Array.isArray(m.rounds) ? m.rounds : [];
    if (!rs.length || !m.window || m.window.total !== rs.length) return 0;
    for (var k = rs.length - 1; k >= 0; k--) {
      var r = rs[k];
      if (!r || !(r.count > 0) || r.shortRow === true) continue;
      if (r.countless) return 0;
      var st = Array.isArray(r.stitches) ? r.stitches : [], bo = 0;
      for (var q = 0; q < st.length; q++) if (st[q] && st[q].t === 'bo') bo++;
      return st.length && bo === st.length ? 0 : Math.floor(r.count);
    }
    return 0;
  }
  /** What a knitting part's model reads from the part before it (for the cache key). */
  function knitPrevKey(prt, proj) {
    if (!proj || craftKeyOf(proj) !== 'knitting') return '';
    var pp = knitPrevPart(prt, proj);
    if (!pp) return '';
    var e = partLines(pp);
    return pp.id + ':' + sizeIndexOf(pp) + ':' + e.length + ':' + e.version;
  }

  /** "pick up and knit 198 sts around top edge of Cable Yoke" — worked up from it. */
  var KNIT_WORKED_UP_RE =
    /\bpick(?:ed)?\s+up\b[^.]{0,120}?\b(?:around|along|across)\s+(?:the\s+)?top\s+edge\b|\bwork(?:ed)?\s+up(?:ward)?s?\s+in\s+(?:the\s+)?(?:round|rnds?)\b/i;

  /* ---- cables (knit-3d-2) ----------------------------------------------
     DiagramGeo 1.6.0 draws each crossing from its two groups: `cf` stitches
     in front (knit, on top) and `cb` knit stitches left in the back group
     (the rest of it is purl). A cable's name does not say that reliably —
     Patons' mock neck T3F carries 2 knits over a purl, the boyfriend's T3F
     one twisted stitch over a knit and a purl — so the pattern's OWN
     definition decides ("T3F = Slip next 2 stitches onto a cable needle and
     leave at front of work. P1, then K2 from cable needle."). `Knits.expand`
     writes a cable as one record per stitch (`span`, `at`) without its name,
     so the name comes from the row's own words (the n-th 3-stitch front
     cross on the row is the n-th of them in its text), else from the only
     cable of that width and direction the pattern defines. */
  var KNIT_CABLE_NAME_G = /\b((?:c|t|cr|tw)\d{1,2}(?:f|b|l|r)(?:k|p)?|\d\/\d\s*(?:l|r)p?(?:c|t)|rt|lt)\b/gi;
  var KNIT_CABLE_DEF_RE = /^\s*((?:c|t|cr|tw)\d{1,2}(?:f|b|l|r)(?:k|p)?|\d\/\d\s*(?:l|r)p?(?:c|t))\s*(?:=|:|–|—|-)\s*(.*)$/i;
  var KNIT_ABBR_LINE_RE = /^\s*[A-Za-z][\w/()&.]{0,12}\s*(?:=|:)\s*\S/;
  var KNIT_CABLE_HOLD_RE = /\bsl(?:ip)?\s+(?:the\s+)?(?:next\s+)?(\d+|one|two|three|four|five|six)?\s*(?:st(?:itch)?(?:e?s)?)?\s*(?:onto|on|to)\s+(?:a\s+|the\s+)?(?:cable\s+needle|cn)\b[^.]*?\b(front|back)\b/i;
  var KNIT_WORD_N = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

  function knitCableKey(name) { return String(name || '').toUpperCase().replace(/\s+/g, ''); }
  function knitCableNameN(name) {
    var k = knitCableKey(name), m = /^(\d)\/(\d)/.exec(k);
    if (m) return (+m[1]) + (+m[2]);
    if (k === 'RT' || k === 'LT') return 2;
    m = /\d+/.exec(k);
    return m ? +m[0] : 0;
  }
  function knitCableNameCross(name) {
    var k = knitCableKey(name), m = /^\d\/\d(L|R)/.exec(k);
    if (m) return m[1] === 'L' ? 'f' : 'b';
    if (k === 'LT') return 'f';
    if (k === 'RT') return 'b';
    m = /^(?:C|T|CR|TW)\d+(F|B|L|R)/.exec(k);
    return m ? (m[1] === 'F' || m[1] === 'L' ? 'f' : 'b') : null;
  }

  /** One definition → `{n, cf, cb}`, or null when it does not say. */
  function knitCableDefOf(name, body) {
    var hold = KNIT_CABLE_HOLD_RE.exec(body);
    if (!hold) return null;
    var held = hold[1] ? (KNIT_WORD_N[hold[1].toLowerCase()] || +hold[1]) : 1;
    var rest = body.slice(hold.index + hold[0].length), m, re = /\b([kp])(\d{1,2})/gi, toks = [], tot = 0;
    while ((m = re.exec(rest)) && tot < 48) { toks.push({ k: m[1].toLowerCase() === 'k', c: +m[2] }); tot += +m[2]; }
    var n = knitCableNameN(name);
    if (!(n >= 2) || tot !== n || !(held >= 1 && held < n)) return null;
    /* The stitches worked first come off the left needle (n − held of them);
       the rest come off the cable needle (the held group). The group held
       in FRONT is the one on top; count the knits each group shows. */
    var need = n - held, kWorked = 0, kHeld = 0;
    for (var i = 0; i < toks.length; i++) {
      var c = toks[i].c, take = Math.min(c, need);
      if (toks[i].k) { kWorked += take; kHeld += c - take; }
      need -= take;
    }
    var front = hold[2].toLowerCase() === 'front';
    var cf = front ? kHeld : kWorked, cb = front ? kWorked : kHeld;
    if (!(cf >= 1 && cf < n && cb >= 0 && cf + cb <= n)) return null;
    return { n: n, cf: cf, cb: cb };
  }

  /** `{NAME: {n, cf, cb}}` from every cable definition in the text. */
  function knitCableDefs(text) {
    var lines = String(text || '').split(/\r?\n/), out = {}, i, j;
    for (i = 0; i < lines.length; i++) {
      var m = KNIT_CABLE_DEF_RE.exec(lines[i]);
      if (!m) continue;
      // a definition wraps over the lines after it, up to the next abbreviation
      var body = m[2];
      for (j = i + 1; j < lines.length && j < i + 8 && body.length < 320; j++) {
        if (KNIT_ABBR_LINE_RE.test(lines[j])) break;
        body += ' ' + lines[j];
      }
      var d = knitCableDefOf(m[1], body);
      if (d) out[knitCableKey(m[1])] = d;
    }
    return out;
  }

  /** The definitions a part can see: its own text, its project's notes and sibling parts. */
  function knitCableDefsFor(prt, proj) {
    var entry = partLines(prt);
    var bits = [prt && prt.patternText ? String(prt.patternText) : ''];
    if (proj) {
      if (proj.notes) bits.push(String(proj.notes));
      // wave H (knit-qa-2): the abbreviation block the importer kept
      if (proj.craftData && typeof proj.craftData.abbreviations === 'string') bits.push(proj.craftData.abbreviations);
      var ps = Array.isArray(proj.parts) ? proj.parts : [];
      for (var i = 0; i < ps.length && i < 40; i++) if (ps[i] && ps[i] !== prt && ps[i].patternText) bits.push(String(ps[i].patternText));
    }
    var text = bits.join('\n');
    if (entry !== EMPTY_ENTRY && entry.knitCables && entry.knitCables.len === text.length) return entry.knitCables.defs;
    var defs = text.length < 400000 ? knitCableDefs(text) : {};
    if (entry !== EMPTY_ENTRY) entry.knitCables = { len: text.length, defs: defs };
    return defs;
  }

  /**
   * Name each cable crossing of a knitted row's records and, when the
   * pattern defines it, give its records `cf` / `cb`. In place.
   */
  function knitNameCables(stitches, line, defs) {
    var i, k, m;
    var hasCable = false;
    for (i = 0; i < stitches.length; i++) if (stitches[i] && stitches[i].t === 'cable') { hasCable = true; break; }
    if (!hasCable) return;
    var said = {}, text = line && line.text ? String(line.text) : '';
    KNIT_CABLE_NAME_G.lastIndex = 0;
    while ((m = KNIT_CABLE_NAME_G.exec(text))) {
      var nm = knitCableKey(m[1]), key = knitCableNameN(nm) + (knitCableNameCross(nm) || '?');
      (said[key] = said[key] || []).push(nm);
    }
    var defined = {};
    for (k in defs) {
      if (!Object.prototype.hasOwnProperty.call(defs, k)) continue;
      var dk = defs[k].n + (knitCableNameCross(k) || '?');
      (defined[dk] = defined[dk] || []).push(k);
    }
    var used = {};
    i = 0;
    while (i < stitches.length) {
      var r = stitches[i];
      if (!r || r.t !== 'cable' || (typeof r.at === 'number' && r.at !== 0)) { i++; continue; }
      var run = 1;
      if (typeof r.at === 'number') {
        while (i + run < stitches.length && stitches[i + run] && stitches[i + run].t === 'cable' &&
               stitches[i + run].at === run) run++;
      } else run = knitRecordSpan(r);
      var cross = r.cross === 'b' ? 'b' : 'f', key2 = run + cross;
      var name = r.name ? knitCableKey(r.name) : null;
      if (!name && said[key2]) { var u = used[key2] | 0; name = said[key2][u % said[key2].length]; used[key2] = u + 1; }
      if (!name && defined[key2] && defined[key2].length === 1) name = defined[key2][0];
      var def = name ? defs[name] : null;
      var span = typeof r.at === 'number' ? run : 1;
      for (k = 0; k < span; k++) {
        var rr = stitches[i + k];
        if (name) rr.name = name.slice(0, 8);
        if (def && def.n === run) { rr.cf = def.cf; rr.cb = def.cb; }
      }
      i += span;
    }
  }

  /**
   * The parse line's knitting fields onto a Model round, only when they say
   * something: `side` 'rs'|'ws' (a row worked flat — inside a round piece,
   * a heel flap), `shortRow: true`, `markers` [{name, at}], `delta` (a
   * stated change, "8 sts inc"). DiagramGeo reads the first two; the rest
   * ride along for the renderer and the counter.
   */
  function knitRoundFields(rec, line) {
    if (line.side === 'rs' || line.side === 'ws') rec.side = line.side;
    if (line.shortRow === true) rec.shortRow = true;
    if (Array.isArray(line.markers) && line.markers.length) {
      var mk = [];
      for (var i = 0; i < line.markers.length && mk.length < 24; i++) {
        var m = line.markers[i];
        if (!m || typeof m !== 'object') continue;
        var at = typeof m.at === 'number' && isFinite(m.at) && m.at >= 0 ? Math.floor(m.at) : null;
        if (at === null) continue;
        mk.push({ name: str(m.name, '').slice(0, 24), at: at });
      }
      if (mk.length) rec.markers = mk;
    }
    if (typeof line.delta === 'number' && isFinite(line.delta)) rec.delta = line.delta;
    return rec;
  }

  /** Cheap palette fingerprint — these objects hold a handful of keys. */
  function yarnSerial(proj) {
    var yarn = yarnColorsOf(proj);
    var keys = Object.keys(yarn);
    var out = '';
    for (var i = 0; i < keys.length; i++) out += keys[i] + '=' + yarn[keys[i]] + ',';
    return out;
  }

  /**
   * A fingerprint of `rowStitches` VALUES, not just its length, so editing a
   * past row's count can never leave a stale model behind (finding 20). No
   * string building: this runs on the tap path.
   */
  function rowStitchSerial(rs) {
    var h = 0;
    for (var i = 0; i < rs.length; i++) h = (h * 31 + (rs[i] | 0)) | 0;
    return rs.length + ':' + h;
  }

  /**
   * Everything `buildDiagramModel` reads, except `part.stitch` (the tap path
   * mutates the live round instead). The pattern text is NOT concatenated in:
   * `partLines().version` changes whenever the parse does, which is the same
   * thing for a fraction of the cost.
   */
  function diagramKey(prt, proj) {
    var rs = Array.isArray(prt.rowStitches) ? prt.rowStitches : [];
    var entry = partLines(prt);
    return (
      sizeIndexOf(prt) + '|' + prt.row + '|' + prt.piecesDone + '|' + rowStitchSerial(rs) + '|' +
      (prt.repeat && prt.repeat.enabled ? prt.repeat.startRow + '-' + prt.repeat.endRow + 'x' + prt.repeat.times : '-') +
      '|' + partWorkMode(prt, proj === undefined ? null : proj) +
      // The text-derived orientation rides on `entry.version`; the chip does not.
      '|' + normalizeOrientation(prt.orientation, 'auto') +
      // The RESOLVED dialect, because both halves of it move the heights: the
      // chip, and the document's answer the importer wrote onto the part.
      '|' + (partDialect(prt) || '-') +
      '|' + yarnSerial(proj) +
      '|' + entry.length + '|v' + entry.version +
      // knit-3d-2: a part with no cast-on starts where the part before it ended
      '|' + knitPrevKey(prt, proj) +
      // wave K (K3): the charts read for the project colour its rounds
      '|' + knitChartKey(proj)
    );
  }

  /**
   * The only thing that changes on the tap path: how much of the round being
   * worked is done. Mutating it in place keeps a tap off the model builder.
   * It writes to the round the user is ACTUALLY on — `current` is built to point
   * there, and the round's own `row` is checked before anything is written, so a
   * model that has gone stale is left alone rather than corrupted.
   */
  function applyLiveRound(model, prt) {
    if (!model || !Array.isArray(model.rounds)) return model;
    var cur = model.rounds[model.current];
    if (!cur) return model;
    var workingRow = clampInt(prt.row, 0, 999999, 0) + 1;
    var total = model.window && model.window.total > 0 ? model.window.total : 0;
    if (total && workingRow > total) workingRow = total;
    if (typeof cur.row === 'number' && cur.row !== workingRow) return model;
    cur.done = prt.stitch;
    if (cur.count < cur.done) cur.count = cur.done;
    cur.ghost = false;
    if (model.deviation) model.deviation.actual = prt.stitch;
    return model;
  }

  /**
   * @param {object} prt  a part
   * @param {object} [proj]  its project (looked up when omitted)
   * @returns {{mode:'rounds'|'rows', rounds:Array, current:number,
   *           defaultColor:string,
   *           shape:{start:string, chainLen:number|null, ringCount:number|null, stuffed:boolean|null,
   *                  corners:0|3|4|6|8, cornersSource:'sites'|'text'|null,
   *                  upsideDown:boolean, upsideDownSource:'part'|'text'|null,
   *                  dialect:'uk'|'us'|null},
   *           window:{first:number, total:number},
   *           deviation:{expected:number|null, actual:number}}}
   */
  function diagramModel(prt, proj) {
    if (!prt) return emptyModel();
    if (!proj) proj = projectOfPart(prt);
    bindPartProject(prt, proj);
    var key;
    try {
      key = diagramKey(prt, proj);
    } catch (e) {
      return emptyModel();
    }
    var hit = diagramCache[prt.id];
    var model;
    if (hit && hit.key === key) {
      model = hit.model;
    } else {
      try {
        model = buildDiagramModel(prt, proj);
      } catch (e) {
        model = emptyModel();
      }
      diagramCache[prt.id] = { key: key, model: model };
    }
    return applyLiveRound(model, prt);
  }

  /**
   * Every yarn colour name the project's patterns mention, first-seen order,
   * de-duplicated case-insensitively, with legend letters ('A') resolved to
   * their names ('Almond'). The main yarn key '*' is never in here.
   */
  function yarnColorNames(proj) {
    var out = [];
    var seen = Object.create(null);

    function add(raw) {
      var name = str(raw, '').trim();
      if (!name || name === MAIN_YARN) return;
      var k = name.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(name);
    }

    if (!proj || !Array.isArray(proj.parts)) return out;
    for (var i = 0; i < proj.parts.length; i++) {
      var info = patternColorsOf(proj.parts[i].patternText, proj);
      var legend = info.legend || {};
      for (var n = 0; n < info.names.length; n++) {
        var name = str(info.names[n], '').trim();
        if (!name) continue;
        // 'A' on its own is a legend letter, not a colour you can picture.
        var full = str(legend[name], '').trim();
        add(full || name);
      }
      var letters = Object.keys(legend);
      for (var L = 0; L < letters.length; L++) add(legend[letters[L]]);
    }
    return out;
  }

  /** The hex a name resolves to right now: override → parser → main yarn. */
  function yarnColorFor(proj, name) {
    var key = str(name, '').trim();
    var main = mainYarn(proj);
    if (!key || key === MAIN_YARN) return main;
    var yarn = yarnColorsOf(proj);
    return normalizeHex(yarn[key]) || patternColorHex(key, proj) || main;
  }

  /** Whether the user has pinned this name to a colour of their own. */
  function hasYarnColor(proj, name) {
    var key = str(name, '').trim();
    if (!key) return false;
    var yarn = yarnColorsOf(proj);
    if (key === MAIN_YARN) return normalizeHex(yarn[MAIN_YARN]) !== MAIN_YARN_DEFAULT;
    return !!normalizeHex(yarn[key]);
  }

  /**
   * Pin a yarn colour. A falsy / unparseable hex clears the override again
   * ('*' goes back to the default cream).
   * @returns {string|null} the stored hex, or null when it was cleared
   */
  function setYarnColor(projectId, name, hex) {
    var proj = project(projectId);
    if (!proj) return null;
    var key = str(name, '').trim();
    if (!key) return null;
    var yarn = yarnColorsOf(proj);
    var value = normalizeHex(hex);
    if (value) {
      yarn[key] = value;
    } else if (key === MAIN_YARN) {
      yarn[MAIN_YARN] = MAIN_YARN_DEFAULT;
      value = null;
    } else {
      delete yarn[key];
    }
    // The palette feeds every part's model.
    for (var i = 0; i < proj.parts.length; i++) delete diagramCache[proj.parts[i].id];
    touch(proj);
    return value;
  }

  /* ------------------------------------------------------------------ *
   * Knitting (wave H, knit-counter; docs/wave-h/CONTRACT.md §3)
   *
   * The knitting-only state that rides on the shared counter:
   *
   *   Project.gauge   { sts, rows, over, unit, needle, swatch: { sts, rows } }
   *                   sts / rows over `over` units of `unit` ('cm' | 'in') as
   *                   printed; `swatch` is what the knitter measured, over the
   *                   same span. Numbers are null until known.
   *   Part.side       'rs' | 'ws' | null - the knitter's own word on the side
   *                   of the row being worked. null = follow the pattern
   *                   (`Line.side`, else parity from the nearest tagged row).
   *                   It flips with every row (and every short row) worked.
   *   Part.markers    [{ id, name, at }] - `at` = stitches from the row start;
   *                   the name 'BOR' (beginning of round) is reserved, at 0.
   *   Part.markerTotal  the row's stitch total when the markers were placed
   *                   (null = unknown), so a row that makes a different total
   *                   never shows a "7 → marker" it cannot vouch for.
   *   Part.linked     partId | null - worked two-at-a-time with that part
   *                   (always mutual; repaired on load).
   *   Part.shortRows  { active, n, of, row, base, numbered } | null - the
   *                   short-row sub-counter. `n` = the short row being worked
   *                   (1-based), `of` = how many the pattern says (null when it
   *                   says "until all sts are worked"), `row` = Part.row while
   *                   they are worked (it does not advance), `base` = the row
   *                   before the first short row, `numbered` = the pattern
   *                   numbers them as rows of the part (a heel turn's Row 1-8),
   *                   so leaving the run lands the counter on the row after it.
   *                   `active: false` is the "done for this row" marker.
   *
   * Every knitting project carries all of them (defaults: an empty gauge,
   * null, [], null, null, null). Any other craft carries one only when it is
   * set, so a crochet save is exactly what it was, and nothing crochet reads
   * them. Every writer below snapshots and touches (one Undo each).
   * ------------------------------------------------------------------ */

  var KNIT_CRAFT = 'knitting';
  var KNIT_MARKERS_MAX = 40;
  var KNIT_MARKER_NAME_MAX = 24;
  var KNIT_CM_PER_IN = 2.54;
  var KNIT_LOOKAHEAD = 64;              // rows scanned ahead for the next cable crossing

  function isKnitProject(proj) {
    return !!(proj && proj.craft === KNIT_CRAFT);
  }

  function isKnitPart(prt) {
    if (!prt) return false;
    try { return craftKeyOf(prt) === KNIT_CRAFT; } catch (e) { return false; }
  }

  /** A positive measurement (22.5, '22,5'), two decimals, or null. */
  function knitNum(v, max) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    if (!isFinite(n) || n <= 0) return null;
    if (n > max) n = max;
    return Math.round(n * 100) / 100;
  }

  function knitUnit(v) {
    var s = str(v, '').trim().toLowerCase();
    return s === 'in' || s === 'inch' || s === 'inches' || s === '"' || s === "''" ? 'in' : 'cm';
  }

  /** Settings → Knitting's unit, read without loading the state. */
  function knitDefaultUnit() {
    var k = state && state.settings && state.settings.crafts ? state.settings.crafts[KNIT_CRAFT] : null;
    return k && k.unit === 'in' ? 'in' : 'cm';
  }

  function emptyGauge(unit) {
    var u = knitUnit(unit);
    return { sts: null, rows: null, over: u === 'in' ? 4 : 10, unit: u, needle: '', swatch: { sts: null, rows: null } };
  }

  /** `Project.gauge`, or null when `raw` is not a gauge at all. */
  function normalizeGauge(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var g = emptyGauge(raw.unit);
    g.sts = knitNum(raw.sts, 999);
    g.rows = knitNum(raw.rows, 999);
    var over = knitNum(raw.over, 100);
    if (over) g.over = over;
    g.needle = str(raw.needle, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    var sw = raw.swatch && typeof raw.swatch === 'object' ? raw.swatch : {};
    g.swatch = { sts: knitNum(sw.sts, 999), rows: knitNum(sw.rows, 999) };
    return g;
  }

  function gaugeIsEmpty(g) {
    return !g || (!g.sts && !g.rows && !g.needle && !(g.swatch && (g.swatch.sts || g.swatch.rows)));
  }

  function normalizeKnitSide(v) {
    var s = str(v, '').trim().toLowerCase();
    return s === 'rs' || s === 'ws' ? s : null;
  }

  /** A marker position: a whole stitch count >= 0, else -1 (clampInt would pin -1 to 0). */
  function knitAt(v) {
    var n = typeof v === 'number' ? v : parseInt(v, 10);
    if (!isFinite(n) || n < 0) return -1;
    return Math.min(99999, Math.floor(n));
  }

  function isBorName(name) {
    return /^bor$/i.test(str(name, '').trim());
  }

  /** `Part.markers`: sorted by position, ids unique, one BOR at 0, capped. */
  function normalizeMarkers(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    var seen = {}, bor = false;
    for (var i = 0; i < raw.length && out.length < KNIT_MARKERS_MAX; i++) {
      var m = raw[i];
      if (!m || typeof m !== 'object') continue;
      var name = str(m.name, '').replace(/\s+/g, ' ').trim().slice(0, KNIT_MARKER_NAME_MAX);
      var at = knitAt(m.at);
      if (isBorName(name)) {
        if (bor) continue;
        bor = true;
        name = 'BOR';
        at = 0;
      }
      if (at < 0) continue;
      var id = str(m.id, '') || uid();
      if (seen[id]) id = uid();
      seen[id] = true;
      var mk = { id: id, name: name, at: at, _i: i };
      // wave K (P9): a marker around a stitch ("place marker around next st")
      if (m.kind === 'stitch' || m.around === true) mk.kind = 'stitch';
      out.push(mk);
    }
    out.sort(function (a, b) { return a.at - b.at || a._i - b._i; });
    for (var j = 0; j < out.length; j++) delete out[j]._i;
    return out;
  }

  function normalizeShortRows(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var of = raw.of === null || raw.of === undefined || raw.of === '' ? null : (clampInt(raw.of, 1, 9999, 0) || null);
    var out = {
      active: !!raw.active,
      n: clampInt(raw.n, 1, 9999, 1),
      of: of,
      row: clampInt(raw.row, 0, 999999, 0),
      base: 0,
      numbered: !!raw.numbered
    };
    out.base = clampInt(raw.base, 0, out.row, out.row);
    if (of && out.n > of) out.n = of;
    return out;
  }

  function knitPartDefaults(prt) {
    if (!prt) return prt;
    if (prt.side === undefined) prt.side = null;
    if (!Array.isArray(prt.markers)) prt.markers = [];
    if (prt.markerTotal === undefined) prt.markerTotal = null;
    if (prt.linked === undefined) prt.linked = null;
    if (prt.shortRows === undefined) prt.shortRows = null;
    return prt;
  }

  /** Links are mutual, point at a part that exists and never at itself. */
  function repairLinks(parts) {
    var byId = {};
    parts.forEach(function (q) { byId[q.id] = q; });
    parts.forEach(function (q) {
      if (!q.linked) return;
      var mate = byId[q.linked];
      if (!mate || mate === q) { q.linked = null; return; }
      if (!mate.linked) mate.linked = q.id;
      if (mate.linked !== q.id) q.linked = null;
    });
  }

  /** Called by normalizeProject with the normalised project and the raw one. */
  function knitNormalizeProject(np, raw) {
    var knit = np.craft === KNIT_CRAFT;
    var rawParts = raw && Array.isArray(raw.parts) ? raw.parts : [];
    var g = normalizeGauge(raw && raw.gauge);
    if (knit) np.gauge = g || emptyGauge(knitDefaultUnit());
    else if (g && !gaugeIsEmpty(g)) np.gauge = g;
    for (var i = 0; i < np.parts.length; i++) {
      var prt = np.parts[i];
      var rp = rawParts[i] && typeof rawParts[i] === 'object' ? rawParts[i] : {};
      var side = normalizeKnitSide(rp.side);
      var markers = normalizeMarkers(rp.markers);
      var mt = rp.markerTotal === null || rp.markerTotal === undefined ? null : (clampInt(rp.markerTotal, 1, 999999, 0) || null);
      var linked = str(rp.linked, '').trim() || null;
      var sr = normalizeShortRows(rp.shortRows);
      if (knit) {
        prt.side = side;
        prt.markers = markers;
        prt.markerTotal = markers.length ? mt : null;
        prt.linked = linked;
        prt.shortRows = sr;
        // wave K (knit-store): stretch ends, the pattern's own target, measurements
        var sts = normalizeStretchEnds(rp.stretches);
        if (sts) prt.stretches = sts;
        if (typeof rp.phaseTarget === 'number' && rp.phaseTarget >= 1) prt.phaseTarget = clampInt(rp.phaseTarget, 1, 99999, 1);
        var ms0 = normalizeMeasures(rp.measures);
        if (ms0.length) prt.measures = ms0;
        if (markers.length && typeof rp.markerRow === 'number' && rp.markerRow >= 0) prt.markerRow = clampInt(rp.markerRow, 0, 99999, 0);
        if (rp.rowWord === 'rnd') prt.rowWord = 'rnd';
        if (rp.phaseTargetAuto === true) prt.phaseTargetAuto = true;
      } else {
        if (side) prt.side = side;
        if (markers.length) { prt.markers = markers; if (mt) prt.markerTotal = mt; }
        if (linked) prt.linked = linked;
        if (sr) prt.shortRows = sr;
      }
    }
    repairLinks(np.parts);
    if (!knit) np.parts.forEach(function (q) { if (q.linked === null) delete q.linked; });
    // wave K (knit-store, P1): only a project that was made with stretch
    // phases (or switched to them) has them; an older save keeps its numbering
    if (knit && raw && raw.rowPhases === true) np.rowPhases = true;
    return np;
  }

  /* ---- templates carry the knitting state that is not progress -------- *
   * Template.gauge (the pattern gauge, no swatch), and per template part
   * `markers` ([{name, at}]) plus `linked` (the INDEX of its partner in the
   * template's parts). Side and short rows are progress: never carried. */

  function knitTemplatePart(out, src) {
    if (!out || !src || typeof src !== 'object') return out;
    var ms = normalizeMarkers(src.markers);
    if (ms.length) out.markers = ms.map(function (m) { return { name: m.name, at: m.at }; });
    if (typeof src.linked === 'number' && src.linked >= 0 && src.linked < 999) out.linked = Math.floor(src.linked);
    return out;
  }

  /** The partner's index in a parts list, for a template drafted from a project. */
  function knitTemplatePartFromProject(out, prt, srcParts) {
    if (!out || !prt) return out;
    knitTemplatePart(out, { markers: prt.markers });
    if (prt.linked) {
      for (var i = 0; i < srcParts.length; i++) {
        if (srcParts[i].id === prt.linked) { out.linked = i; break; }
      }
    }
    return out;
  }

  /** The pattern half of a gauge (a template never carries a swatch). */
  function templateGauge(raw) {
    var g = normalizeGauge(raw);
    if (!g) return null;
    g.swatch = { sts: null, rows: null };
    return gaugeIsEmpty(g) ? null : g;
  }

  function knitTemplateCarry(nt, src) {
    var g = src ? templateGauge(src.gauge) : null;
    if (g) nt.gauge = g;
    else delete nt.gauge;
    // a link must point at another part of this template
    (nt.parts || []).forEach(function (p, i) {
      if (typeof p.linked !== 'number') return;
      if (p.linked === i || p.linked >= nt.parts.length) delete p.linked;
    });
    return nt;
  }

  /** createProject: the template's gauge, markers and links on the new project. */
  function knitFromTemplate(proj, tpl, extraGauge) {
    if (!proj || !tpl) return proj;
    var g = normalizeGauge(extraGauge);
    if (!g || gaugeIsEmpty(g)) g = templateGauge(tpl.gauge);
    if (g && !gaugeIsEmpty(g)) proj.gauge = g;
    var tparts = Array.isArray(tpl.parts) ? tpl.parts : [];
    for (var i = 0; i < proj.parts.length && i < tparts.length; i++) {
      var tp = tparts[i] || {};
      var ms = normalizeMarkers(tp.markers);
      if (ms.length) proj.parts[i].markers = ms;
      if (typeof tp.linked === 'number' && proj.parts[tp.linked] && tp.linked !== i) {
        proj.parts[i].linked = proj.parts[tp.linked].id;
      }
    }
    repairLinks(proj.parts);
    return proj;
  }

  /* ---- gauge ----------------------------------------------------------- */

  /** The project's gauge (always an object for a knitting project). */
  function gaugeOf(projOrId) {
    var proj = projOrId && typeof projOrId === 'object' ? projOrId : project(projOrId);
    if (!proj) return null;
    return normalizeGauge(proj.gauge) || (isKnitProject(proj) ? emptyGauge(knitDefaultUnit()) : null);
  }

  /**
   * Merge `patch` into the project's gauge: any of sts, rows, over, unit,
   * needle, swatch: {sts, rows}. `null` / '' clears a number. Undoable unless
   * `opts.undo === false` (the importer's own write inside its snapshot).
   */
  function setGauge(projectId, patch, opts) {
    var proj = project(projectId);
    if (!proj || !patch || typeof patch !== 'object') return null;
    var silent = !!(opts && (opts.undo === false || opts.undoable === false));
    if (!silent) snapshot(proj);
    var g = gaugeOf(proj) || emptyGauge(knitDefaultUnit());
    var next = deepCopy(g);
    ['sts', 'rows', 'over', 'needle'].forEach(function (k) {
      if (patch[k] !== undefined) next[k] = patch[k];
    });
    if (patch.unit !== undefined) {
      next.unit = knitUnit(patch.unit);
      // a new unit with no span given takes that unit's usual span
      if (patch.over === undefined && next.unit !== g.unit) next.over = next.unit === 'in' ? 4 : 10;
    }
    if (patch.swatch && typeof patch.swatch === 'object') {
      if (patch.swatch.sts !== undefined) next.swatch.sts = patch.swatch.sts;
      if (patch.swatch.rows !== undefined) next.swatch.rows = patch.swatch.rows;
    }
    proj.gauge = normalizeGauge(next);
    if (silent) save();
    else touch(proj);
    return proj.gauge;
  }

  /** Rows (or sts) per one unit of the gauge's own unit. */
  function gaugePer(g, what, which) {
    if (!g || !g.over) return null;
    var key = what === 'sts' ? 'sts' : 'rows';
    var mine = g.swatch ? g.swatch[key] : null;
    var v = which === 'pattern' ? g[key] : which === 'swatch' ? mine : (mine || g[key]);
    return v ? v / g.over : null;
  }

  function lengthIn(value, fromUnit, toUnit) {
    var u = str(fromUnit, '').toLowerCase();
    var cm = u === 'in' || u === '"' || u === 'inch' || u === 'inches' ? value * KNIT_CM_PER_IN
      : u === 'mm' ? value / 10 : value;
    return toUnit === 'in' ? cm / KNIT_CM_PER_IN : cm;
  }

  /**
   * "32 cm" → rows, through the measured row gauge (`which` 'swatch'), the
   * pattern's ('pattern'), or the measured one when there is one (default).
   * null when that gauge has no row count.
   */
  function lengthToRows(projOrGauge, value, unit, which) {
    var g = projOrGauge && projOrGauge.over !== undefined && projOrGauge.swatch ? normalizeGauge(projOrGauge) : gaugeOf(projOrGauge);
    var v = knitNum(value, 99999);
    if (!g || !v) return null;
    var per = gaugePer(g, 'rows', which);
    if (!per) return null;
    return Math.round(lengthIn(v, unit || g.unit, g.unit) * per);
  }

  /** Measured vs printed: { rowsPct, stsPct } (+8 = 8% more per cm = tighter). */
  function gaugeCompare(projOrId) {
    var g = gaugeOf(projOrId);
    var out = { gauge: g, rowsPct: null, stsPct: null };
    if (!g) return out;
    if (g.rows && g.swatch.rows) out.rowsPct = Math.round((g.swatch.rows / g.rows - 1) * 1000) / 10;
    if (g.sts && g.swatch.sts) out.stsPct = Math.round((g.swatch.sts / g.sts - 1) * 1000) / 10;
    return out;
  }

  /* ---- reading the pattern for knitting extras ------------------------- */

  function knitSpan(l) {
    if (!l || !(l.row >= 1)) return 1;
    var end = l.rowEnd >= l.row ? l.rowEnd : l.row;
    return end - l.row + 1;
  }

  function isRowLine(l) {
    return !!(l && l.row >= 1);
  }

  /** The written row a pattern row is: a repeat sentence sends you back. */
  function underlyingLine(prt, patternRow) {
    var l = lineForRow(prt, patternRow);
    // wave K (audit): a stretch ("Cont in pat until …") is never one written row repeated
    if (l && l.stretch && l.stretch.key) return l;
    var from = backRefFrom(l);
    if (from && patternRow >= from) {
      var u = l.repeatOf[(patternRow - from) % l.repeatOf.length];
      if (typeof u === 'number' && u >= 1 && u !== patternRow) {
        var ul = lineForRow(prt, u);
        if (ul && !backRefFrom(ul)) return ul;
      }
    }
    return l;
  }

  /**
   * The first row a back-reference covers ("Rep Rows 91-92 4 more times", or
   * the parser's numbered "Rows 93-100: Rep Rows 91-92"), else 0.
   */
  function backRefFrom(l) {
    if (!l || !Array.isArray(l.repeatOf) || !l.repeatOf.length) return 0;
    if (l.repeatFrom >= 1) return l.repeatFrom;
    return l.row >= 1 ? l.row : 0;
  }

  /* ---- wave K (knit-store, P1): stretch phases ------------------------- *
   * An open "work until" line (a length, "same length as Back", "until N
   * sts rem") is a STRETCH: the knitter decides when it ends. The parser
   * numbers the rows after it as if it took no rows (Boyfriend Front: the
   * raglan cast-offs on rows 5-6, the "cont even" stretch after them, E1) or
   * by its own gauge guess (Bernat sleeve: rounds 1-13). In a project with
   * `rowPhases`, the store renumbers the part's lines instead:
   *   - the stretch starts on the row after the rows written before it;
   *   - while it is open it owns every row from there on, keeping the stitch
   *     total (its own "on 216 sts", else the count before it), and nothing
   *     after it has a row number;
   *   - once ended (`Part.stretches[key].rows`, "I'm at the length", or the
   *     gauge estimate after "Use") the lines after it are numbered from its
   *     end.
   * The renumbered lines are a derived parse (`knitPhased`), so every reader
   * of `partLines` (row index, targets, sides, markers, charts, 3D) sees one
   * numbering. Crochet never comes here; projects without `rowPhases` neither.
   */

  var KNIT_STRETCH_LEN_RE = /\buntil\b[^.]{0,160}?\b(?:measures?|same\s+length|desired\s+length|long\s+enough|reaches)\b|\bsame\s+length\s+as\b/i;
  var KNIT_STRETCH_STS_RE = /\buntil\s+(?:there\s+are\s+)?\d+(?:\s*\([\d\s,\-–]+\))?\s*sts?\b/i;
  var KNIT_ON_STS_RE = /\bon\s+(?:these\s+|the\s+)?(?:rem(?:aining)?\s+)?\d+(?:\s*\([^)]*\))?\s*sts?\b[^.]*?\buntil\b/i;
  var KNIT_SHAPES_RE = /\b(?:inc(?:rease)?s?|dec(?:rease)?s?|k2tog|ssk|m1|cast\s+off|bind\s+off)\b/i;
  var knitPhaseMemo = Object.create(null);

  function knitHash(s) {
    var h = 5381;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /** `Part.stretches`: { key: { rows, planned, at } }, or null when empty. */
  function normalizeStretchEnds(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var out = {}, n = 0;
    Object.keys(raw).forEach(function (k) {
      if (n >= 64 || !/^s\d{1,4}:[a-z0-9]{1,8}$/.test(k)) return;
      var v = raw[k];
      if (!v || typeof v !== 'object') return;
      var rows = typeof v.rows === 'number' && isFinite(v.rows) ? clampInt(v.rows, 0, 9999, 0) : null;
      if (rows === null) return;
      out[k] = { rows: rows, planned: !!v.planned, at: typeof v.at === 'number' && isFinite(v.at) ? v.at : 0 };
      n++;
    });
    return n ? out : null;
  }

  /** `Part.measures` (P10): [{ row, value, unit, at }], newest last, ≤ 24. */
  function normalizeMeasures(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (m) {
      if (!m || typeof m !== 'object') return;
      var v = knitNum(m.value, 9999);
      var r = clampInt(m.row, 0, 99999, -1);
      if (!v || r < 0) return;
      out.push({ row: r, value: v, unit: knitUnit(m.unit), at: typeof m.at === 'number' && isFinite(m.at) ? m.at : 0 });
    });
    return out.slice(-24);
  }

  /** Is this part's project numbered in stretch phases? (memo on the part object, flag read live) */
  function knitPhasesOn(prt) {
    if (!prt || !prt.id) return false;
    var m = knitPhaseMemo[prt.id];
    if (!m || m.part !== prt) {
      var proj = projectOfPart(prt);
      if (!proj) return false;
      m = knitPhaseMemo[prt.id] = { part: prt, proj: proj };
    }
    return !!(m.proj && m.proj.rowPhases && isKnitProject(m.proj));
  }

  /** A line the knitter ends by measuring (or by counting what is left). */
  function knitIsStretch(l) {
    if (!l || typeof l !== 'object' || l.shortRow) return false;
    // "CO 124 sts … Work in rib for 3/4"": the cast-on first, then the stretch (knit-parse §9)
    // (audit: a set-up line that IS the stretch, "Work 2½" in Twisted Ribbing …", is one too)
    if (l.kind === 'setup' && l.stretch && typeof l.stretch === 'object' && !l.stretch.key && l.stretch.open !== false) return true;
    if (l.kind === 'setup' || l.kind === 'header') return false;
    // the knitting reader's own word, when it gives one (docs/wave-k/api/knit-parse.md §3)
    if (l.stretch && typeof l.stretch === 'object' && !l.stretch.key) return l.stretch.open !== false && !l.stretch.within;
    var u = untilOf(l);
    // a note is a stretch only when the reader read a length into it
    if (l.kind === 'note') return !!(u && u.kind === 'length' && !(l.row >= 1));
    if (u && u.kind === 'rows') return false;
    if (u && u.kind === 'length') return true;
    var t = str(l.text, '');
    var bounded = typeof l.repeatTo === 'number' && l.repeatTo >= 1 && !(l.row >= 1);
    if (KNIT_STRETCH_LEN_RE.test(t)) return !bounded;
    // "until 30 sts rem" ends a run of ROWS ("Rep last 2 rows until …", "dec
    // every RS row until …"); inside a row ("*p1, k2; rep from * until 3 sts
    // rem, k3") it is stitch-level and no stretch
    var body = t.replace(/^\s*[^:]{0,40}:\s*/, '');
    if (KNIT_STRETCH_STS_RE.test(t) && (l.kind === 'repeat' || /\b(?:rows?|rnds?|rounds?)\b[^.]*\buntil\b/i.test(body)) &&
        !/\brep(?:eat)?\s+from\s+\*[^.]*\buntil\b/i.test(body)) {
      return !bounded && !(typeof l.repeatTimes === 'number' && l.repeatTimes >= 1);
    }
    return false;
  }

  /**
   * wave K (knit-store, P5): an UNNUMBERED line that still takes a known
   * number of rows: "Work Rows 1-61 of Lace chart", "Work through Rnd 84 of
   * Leg chart", "Work 5 rnds even". -> { rows, chart: {name, row, rowEnd}|null } or null.
   */
  function knitBlockOf(l) {
    if (!l || typeof l !== 'object' || l.shortRow || l.kind === 'setup' || l.kind === 'header') return null;
    if (l.kind === 'note' && !(l.chart && typeof l.chart === 'object')) return null;
    if (knitLineStart(l) >= 1 || l.row === 0) return null;
    var t = str(l.text, '');
    var c = l.chart && typeof l.chart === 'object' ? knitChartPos(l) : null;
    if (c && c.row >= 1 && c.rowEnd > c.row && c.rowEnd - c.row < 400 && !/\bfor\s+(?:rows?|rnds?|rounds?)\s+\d/i.test(t)) {
      return { rows: Math.floor(c.rowEnd) - Math.floor(c.row) + 1, chart: { name: c.name, row: Math.floor(c.row), rowEnd: Math.floor(c.rowEnd) } };
    }
    if (c && c.row >= 2 && !(c.rowEnd >= 1) && c.row < 400 && /\bthrough\s+(?:rnd|row|round)s?\s+\d+/i.test(t)) {
      return { rows: Math.floor(c.row), chart: { name: c.name, row: 1, rowEnd: Math.floor(c.row) } };
    }
    var u = untilOf(l);
    if (u && u.kind === 'rows' && u.value >= 1 && u.value < 400 && !/^\s*(?:[^:]{0,30}:\s*)?rep/i.test(t)) {
      return { rows: Math.round(u.value), chart: null };
    }
    return null;
  }

  /** The last row a line takes in the parser's numbering (0 = none). */
  function knitLineEnd(l) {
    if (!l) return 0;
    if (l.row >= 1) return l.rowList && l.rowList.length ? l.rowList[l.rowList.length - 1] : (l.rowEnd >= l.row ? l.rowEnd : l.row);
    if (typeof l.repeatTo === 'number' && l.repeatTo >= 1 && l.repeatFrom >= 1) return l.repeatTo;
    return 0;
  }

  /** The first row a line takes in the parser's numbering (0 = none). */
  function knitLineStart(l) {
    if (!l) return 0;
    if (l.row >= 1) return l.rowList && l.rowList.length ? l.rowList[0] : l.row;
    if (typeof l.repeatTo === 'number' && l.repeatTo >= 1 && l.repeatFrom >= 1) return l.repeatFrom;
    return 0;
  }

  /**
   * The stretches of a parse, in pattern order (cached on the raw entry):
   * [{ i, line, key, prevEnd, nextFirst, lead }] in the parser's numbering.
   */
  function knitScanStretches(lines) {
    var out = [];
    var maxEnd = 0;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (knitIsStretch(l)) {
        var nextFirst = null;
        for (var j = i + 1; j < lines.length && nextFirst === null; j++) {
          var s0 = knitLineStart(lines[j]);
          if (s0 >= 1) nextFirst = s0;
        }
        // "Rep last 2 rows Twisted Ribbing." then "Pat for 4" …": the open
        // repeat just before the length names the rows the stretch works
        var lead = null;
        for (var b = i - 1; b >= 0; b--) {
          var pl = lines[b];
          if (!pl || pl.kind === 'note' || pl.kind === 'header') continue;
          if (pl.kind === 'repeat' && Array.isArray(pl.repeatOf) && pl.repeatOf.length && pl.repeatFrom >= 1 &&
              typeof pl.repeatTo !== 'number' && !knitIsStretch(pl)) lead = pl;
          break;
        }
        out.push({ i: i, line: l, key: 's' + i + ':' + knitHash(l.text).slice(0, 8), prevEnd: maxEnd, nextFirst: nextFirst, lead: lead });
      } else {
        // wave K (P5): a block of known length with no row numbers of its own
        var blk = knitBlockOf(l);
        if (blk) {
          var nf = null;
          for (var j2 = i + 1; j2 < lines.length && nf === null; j2++) {
            var s2 = knitLineStart(lines[j2]);
            if (s2 >= 1) nf = s2;
          }
          out.push({ i: i, line: l, key: 'b' + i, prevEnd: maxEnd, nextFirst: nf, lead: null, block: blk });
        }
      }
      var e = knitLineEnd(l);
      if (e > maxEnd) maxEnd = e;
    }
    return out;
  }

  /** The derived parse of a knitting part in stretch phases (or the entry itself). */
  function knitPhased(prt, entry) {
    if (!entry || entry === EMPTY_ENTRY || !entry.lines || !entry.lines.length) return entry;
    if (!knitPhasesOn(prt)) return entry;
    if (!entry.stretchScan) {
      try { entry.stretchScan = knitScanStretches(entry.lines); } catch (e) { entry.stretchScan = []; }
    }
    var list = entry.stretchScan;
    if (!list.length) return entry;
    var ends = prt.stretches && typeof prt.stretches === 'object' ? prt.stretches : null;
    var sig = '';
    for (var i = 0; i < list.length; i++) {
      // a block of known length: only the read charts (its counts) can change it
      if (list[i].block) { sig += list[i].key + (list[i].block.chart ? knitChartKey(knitPhaseMemo[prt.id] && knitPhaseMemo[prt.id].proj) : '') + ';'; continue; }
      var rec = ends ? ends[list[i].key] : null;
      if (rec && typeof rec.rows === 'number') { sig += list[i].key + '=' + rec.rows + (rec.planned ? 'p' : '') + ';'; continue; }
      sig += list[i].key + '@' + ((prt.row || 0) + 1) + ';';
      break;
    }
    if (entry.phased && entry.phased.sig === sig) return entry.phased.entry;
    var derived;
    try { derived = knitBuildPhased(prt, entry, list, ends); } catch (e2) { derived = null; }
    if (!derived) return entry;
    entry.phased = { sig: sig, entry: derived };
    return derived;
  }

  function knitRawCountAt(entry, p) {
    if (!(p >= 1)) {
      for (var i = 0; i < entry.lines.length; i++) {
        var s = entry.lines[i];
        if (s && (s.kind === 'setup' || (s.row === 0 && s.kind !== 'header' && s.kind !== 'note'))) return usableCount(countOf(s));
      }
      return null;
    }
    if (!entry.rawIndex) entry.rawIndex = buildRowIndex(entry.lines, ROW_INDEX_MAX, true);
    var c = entry.rawIndex.count[p];
    if (c !== undefined) return usableCount(c);
    var api = entry.api;
    if (api && typeof api.targetFor === 'function' && hasRepeatLine(entry.lines)) {
      try { return usableCount(api.targetFor(entry.lines, p)); } catch (e) { return null; }
    }
    return null;
  }

  /** The stitches a stretch keeps while it runs, or null when it shapes. */
  function knitStretchCount(entry, s) {
    var l = s.line;
    var st = l.stretch && typeof l.stretch === 'object' ? l.stretch : null;
    if (st && typeof st.count === 'number' && st.count > 0) return Math.floor(st.count);
    if (st && st.shaping) return null;
    var t = str(l.text, '');
    var untilAt = t.search(/\buntil\b/i);
    if (KNIT_ON_STS_RE.test(t) && usableCount(countOf(l))) return usableCount(countOf(l));
    if (st && typeof st.onSts === 'number' && st.onSts > 0) return Math.floor(st.onSts);
    // it shapes as it goes ("Rep last 2 rows until 30 sts rem"): no total to keep
    if (KNIT_SHAPES_RE.test(untilAt > 0 ? t.slice(0, untilAt) : t) && !/\bevenly\s+across\s+last\b/i.test(t)) return null;
    if (KNIT_STRETCH_STS_RE.test(t)) return null;
    return knitRawCountAt(entry, s.prevEnd);
  }

  /** The stitch count the pattern stands on just before line `i` (the last count printed or worked out). */
  function knitRunningCount(lines, i) {
    for (var j = i - 1; j >= 0; j--) {
      var c = usableCount(countOf(lines[j]));
      if (c) return c;
      // the reader's carried "Start with 84 sts." note for a piece split out of the one before
      var m = /^\s*start\s+with\s+(\d{1,5})\s+sts?\b/i.exec(str(lines[j] && lines[j].text, ''));
      if (m) return usableCount(+m[1]);
    }
    return null;
  }

  /**
   * wave K (P5): per-row counts for chart rows `ref.row..ref.rowEnd` worked
   * from `start` stitches, through `KnitChart.rowInfo` (what each chart row
   * takes and makes, repeated round the work). A row with an unknown cell,
   * or a width the chart does not divide, has no count, nor has any row
   * after it. -> { counts } or null.
   */
  function knitChartCounts(prt, proj, ref, start) {
    var KC = window.KnitChart;
    if (!KC || typeof KC.rowInfo !== 'function' || !proj || !start) return null;
    var page = knitChartPageNamed(chartPagesOf(proj), ref.name);
    var chart = page && page.chart;
    if (!chart || !chart.cells || chart.image) return null;
    var counts = [], run = start, any = false;
    for (var r = ref.row; r <= ref.rowEnd; r++) {
      var info = null;
      if (run !== null) { try { info = KC.rowInfo(chart, r); } catch (e) { info = null; } }
      if (run === null || !info || info.unknown || !(info.consumes > 0) || run % info.consumes !== 0) {
        run = null;
        counts.push(null);
        continue;
      }
      run = (run / info.consumes) * info.produces;
      counts.push(run);
      any = true;
    }
    return any ? { counts: counts } : null;
  }

  function knitBuildPhased(prt, entry, list, ends) {
    var lines = entry.lines;
    var W = (prt.row || 0) + 1;
    var segs = [], stretchAt = {};
    var eff = 0, pc = 0, open = null, i;
    for (i = 0; i < list.length; i++) {
      var s = list[i];
      var plain = Math.max(0, s.prevEnd - pc);
      if (plain) segs.push({ pFrom: pc + 1, pTo: s.prevEnd, off: eff - pc });
      eff += plain;
      pc = Math.max(pc, s.prevEnd);
      var rec = ends ? ends[s.key] : null;
      var start = eff + 1;
      var rows = s.block ? s.block.rows : (rec && typeof rec.rows === 'number' ? rec.rows : null);
      var info = { s: s, start: start, end: rows === null ? null : start + rows - 1, planned: !!(rec && rec.planned), block: s.block || null };
      stretchAt[s.i] = info;
      if (rows === null) { open = info; break; }
      eff = info.end;
      if (s.nextFirst !== null && s.nextFirst - 1 > pc) pc = s.nextFirst - 1;
      // the rows the parser gave the stretch line itself are the stretch's
      var ownEnd = knitLineEnd(s.line);
      if (ownEnd > pc) pc = ownEnd;
    }
    var projP = knitPhaseMemo[prt.id] ? knitPhaseMemo[prt.id].proj : projectOfPart(prt);
    if (!open) segs.push({ pFrom: pc + 1, pTo: null, off: eff - pc });
    function map(p) {
      if (typeof p !== 'number' || !(p >= 1)) return null;
      for (var k = 0; k < segs.length; k++) {
        var g = segs[k];
        if (p >= g.pFrom && (g.pTo === null || p <= g.pTo)) return p + g.off;
      }
      return null;
    }
    var firstStretch = list[0].i;
    var out = [];
    var copies = {};
    var posOf = {};   // line index -> its place in `out` (a set-up's stretch adds a line)
    for (i = 0; i < lines.length; i++) {
      var l = lines[i];
      var c = {};
      for (var key in l) if (Object.prototype.hasOwnProperty.call(l, key)) c[key] = l[key];
      var st = stretchAt[i];
      var isSt = !!st || list.some(function (x) { return x.i === i; });
      if (st && st.block) {
        // wave K (P5): a block of known length, numbered where it is worked
        c.row = st.end < st.start ? null : st.start;
        c.rowEnd = c.row === null ? null : st.end;
        c.rowList = null;
        c.prevCount = null;
        delete c.approxRow;
        c.repeatOf = null; c.repeatFrom = null; c.repeatTo = null; c.repeatRows = null;
        var run0 = knitRunningCount(lines, i);
        c.counts = null; c.countsFrom = null;
        if (st.block.chart) {
          c.chart = {};
          for (var ck in l.chart) if (Object.prototype.hasOwnProperty.call(l.chart, ck)) c.chart[ck] = l.chart[ck];
          c.chart.row = st.block.chart.row;
          c.chart.rowEnd = st.block.chart.rowEnd;
          var cc = knitChartCounts(prt, projP, st.block.chart, run0);
          if (cc) {
            // the line's own printed total ends the block when the chart could not get there
            if (cc.counts[cc.counts.length - 1] === null && typeof l.count === 'number') cc.counts[cc.counts.length - 1] = l.count;
            c.counts = cc.counts;
            c.countsFrom = st.start;
            // (a row the chart cannot count must not fall back to the line's total)
            c.count = cc.counts.indexOf(null) >= 0 ? null : cc.counts[cc.counts.length - 1];
            c.countSource = 'chart';
            if (typeof l.count === 'number' && l.count !== c.count) c.chartPrinted = l.count;   // the line's own total disagrees: keep both
          } else if (typeof l.count === 'number' && st.block.rows > 1) {
            // a printed end total and no per-row counts: only the last row has it
            c.counts = [];
            for (var cr = 0; cr < st.block.rows - 1; cr++) c.counts.push(null);
            c.counts.push(l.count);
            c.countsFrom = st.start;
            c.count = null;
          }
        } else if (!(typeof c.count === 'number')) {
          c.count = run0;
        }
        c.block = { rows: st.block.rows, start: st.start, end: st.end };
        copies[i] = c;
      } else if (st) {
        var n0 = st.end === null ? Math.max(st.start, W) : st.end;
        var kept = knitStretchCount(entry, st.s);
        c.row = st.end !== null && st.end < st.start ? null : st.start;
        c.rowEnd = c.row === null ? null : n0;
        c.rowList = null;
        c.counts = null;
        c.countsFrom = null;
        c.prevCount = null;
        c.count = kept;
        c.countSource = kept ? 'kept' : null;
        c.computed = null;
        delete c.approxRow;
        if (Array.isArray(l.repeatOf) && l.repeatOf.length) {
          c.repeatOf = l.repeatOf.map(map);
          c.repeatFrom = c.row === null ? null : st.start;
          c.repeatTo = st.end === null ? null : st.end;
        } else {
          c.repeatOf = null; c.repeatFrom = null; c.repeatTo = null;
        }
        c.repeatRows = null;
        c.stretch = { key: st.s.key, start: st.start, end: st.end, open: st.end === null, planned: st.planned,
          count: kept, lead: null, parser: l.stretch && typeof l.stretch === 'object' ? l.stretch : null };
        if (st.end === null) open.copy = c;
        copies[i] = c;
      } else if (isSt || i > firstStretch || knitLineEnd(l) > list[0].prevEnd) {
        // after the first stretch (or numbered past it): renumber
        if (isSt) {
          c.row = null; c.rowEnd = null; c.repeatFrom = null; c.repeatTo = null; c.unnumbered = true;
        } else if (c.row >= 1) {
          var r1 = map(l.rowList && l.rowList.length ? l.rowList[0] : l.row);
          if (r1 === null) {
            c.row = null; c.rowEnd = null; c.rowList = null; c.unnumbered = true;
          } else {
            var d = r1 - (l.rowList && l.rowList.length ? l.rowList[0] : l.row);
            c.row = l.row + d;
            c.rowEnd = typeof l.rowEnd === 'number' ? l.rowEnd + d : l.rowEnd;
            if (l.rowList) c.rowList = l.rowList.map(function (x) { return x + d; });
          }
        }
        if (typeof l.repeatFrom === 'number' && l.repeatFrom >= 1 && !isSt) {
          var f1 = map(l.repeatFrom);
          if (f1 === null) { c.repeatFrom = null; c.repeatTo = null; }
          else {
            var dd = f1 - l.repeatFrom;
            c.repeatFrom = f1;
            if (typeof l.repeatTo === 'number') c.repeatTo = l.repeatTo + dd;
            if (typeof l.countsFrom === 'number') c.countsFrom = l.countsFrom + dd;
            if (typeof l.repeatRows === 'number') c.repeatRows = l.repeatRows + dd;
            if (typeof l.repeatAfter === 'number') c.repeatAfter = l.repeatAfter + dd;
          }
        } else if (typeof l.countsFrom === 'number' && c.row >= 1 && l.row >= 1) {
          c.countsFrom = l.countsFrom + (c.row - l.row);
        }
        if (Array.isArray(l.repeatOf)) c.repeatOf = l.repeatOf.map(map);
        // a row numbered after an ended (or planned) stretch is a row, not ≈ one
        if (i > firstStretch) delete c.approxRow;
      }
      if (st && !st.block && l.kind === 'setup') {
        // within: the cast-on stays row 0 and the stretch it opens follows
        // as its own line; otherwise the set-up line is the stretch itself
        if (l.stretch && l.stretch.within) {
          var su = {};
          for (var sk in l) if (Object.prototype.hasOwnProperty.call(l, sk)) su[sk] = l[sk];
          out.push(su);
          if (l.stretch.text) c.text = String(l.stretch.text);
        }
        c.kind = 'row';
      }
      posOf[i] = out.length;
      out.push(c);
    }
    list.forEach(function (s) {
      var cp = copies[s.i];
      if (cp && s.lead) {
        var li0 = lines.indexOf(s.lead);
        var li = li0 >= 0 ? posOf[li0] : -1;
        if (li >= 0) {
          // the open repeat works the stretch's rows: it starts where the stretch does
          if (cp.row >= 1) { out[li].repeatFrom = cp.row; out[li].repeatTo = cp.stretch.end; }
          cp.stretch.lead = out[li];
        }
      }
    });
    for (var pk in lines) {
      if (Object.prototype.hasOwnProperty.call(lines, pk) && !/^\d+$/.test(pk)) out[pk] = lines[pk];
    }
    var derived = {};
    for (var ek in entry) if (Object.prototype.hasOwnProperty.call(entry, ek)) derived[ek] = entry[ek];
    derived.lines = out;
    derived.version = ++lineVersion;
    derived.index = null;
    derived.groups = null;
    derived.phased = null;
    derived.stretchScan = null;
    derived.rawIndex = null;
    derived.raw = entry;
    derived.phases = { segments: segs, stretches: list.map(function (s) { return stretchAt[s.i] || { s: s, start: null, end: null, planned: false }; }) };
    derived.openStretch = open && open.copy ? open.copy : null;
    return derived;
  }

  /** The open stretch that owns row `row` (past the rows the index holds), or null. */
  function knitOpenStretch(prt, row) {
    if (!prt || !(row >= 1)) return null;
    var entry = partLines(prt);
    var op = entry && entry.openStretch;
    return op && op.row >= 1 && row >= op.row ? op : null;
  }

  /** The renumbering state of a part: { entry, phases } or null when it has none. */
  function knitPhaseState(prt) {
    if (!prt || !isKnitPart(prt)) return null;
    var entry = partLines(prt);
    return entry && entry.phases ? entry : null;
  }

  /**
   * The stretch row `row` (default the row being worked) is in, or null.
   * @returns {{key, line, start, end, state:'open'|'planned'|'ended', row, of, count, estimate}|null}
   */
  function stretchInfo(prt, row) {
    if (!prt || !isKnitPart(prt)) return null;
    var W = typeof row === 'number' ? row : repeatInfo(prt).patternRow;
    var l = lineForRow(prt, W);
    if (!l || !l.stretch || !l.stretch.key) return null;
    var st = l.stretch;
    if (st.end !== null && (W > st.end || W < st.start)) return null;
    var out = {
      key: st.key, line: l, start: st.start, end: st.end,
      state: st.end === null ? 'open' : (st.planned ? 'planned' : 'ended'),
      row: W - st.start + 1, of: st.end === null ? null : st.end - st.start + 1,
      count: usableCount(st.count), estimate: null
    };
    var ui = null;
    try { ui = untilInfo(prt, W); } catch (e) { ui = null; }
    if (ui && ui.kind === 'length' && ui.targetRow) {
      out.estimate = { rows: ui.targetRow - st.start + 1, end: ui.targetRow, value: ui.value, unit: ui.unit,
        gaugeSource: ui.gaugeSource, fromRow: ui.fromRow, approx: true };
    }
    return out;
  }

  /** Every stretch of the part, in pattern order: [{ key, line, start, end, state }]. */
  function stretchList(prt) {
    var ps = knitPhaseState(prt);
    if (!ps) return [];
    return ps.phases.stretches.filter(function (x) { return !x.s.block; }).map(function (x) {
      var copy = null;
      if (x.start !== null) {
        for (var i = 0; i < ps.lines.length; i++) if (ps.lines[i] && ps.lines[i].stretch && ps.lines[i].stretch.key === x.s.key) { copy = ps.lines[i]; break; }
      }
      return { key: x.s.key, line: copy || x.s.line, start: x.start, end: x.end,
        state: x.start === null ? 'later' : x.end === null ? 'open' : (x.planned ? 'planned' : 'ended') };
    });
  }

  /** `Part.targetRows` follows the stretches: none while one is open, the pattern's moved by their rows when all have ended. */
  function knitSyncTarget(prt) {
    if (!prt || !knitPhasesOn(prt)) return;
    var raw = lineCache[prt.id];
    var scan = raw && raw.stretchScan;
    if (!raw || !scan) { partLines(prt); raw = lineCache[prt.id]; scan = raw && raw.stretchScan; }
    if (!scan || !scan.length) return;
    var auto = false;
    if (prt.phaseTarget === undefined || prt.phaseTarget === null) {
      // wave K (audit): a part the import gave no target (it had a "work
      // until") gets one once its last stretch has ended: its last written row
      if (!(prt.targetRows >= 1) || prt.phaseTargetAuto) auto = true;
      else prt.phaseTarget = prt.targetRows;
    }
    var ps = knitPhaseState(prt);
    if (!ps) return;
    if (ps.openStretch || ps.phases.stretches.some(function (x) { return x.end === null; })) {
      if (!auto || prt.phaseTargetAuto) prt.targetRows = null;
      return;
    }
    if (auto) {
      var lastEnd = 0, openAfter = false;
      ps.lines.forEach(function (l) {
        var e = knitLineEnd(l);
        if (e > lastEnd) { lastEnd = e; openAfter = false; }
        // an open repeat after the last numbered row ("Rep last 2 rows to end") has no end
        if (l && l.kind === 'repeat' && l.repeatFrom >= 1 && typeof l.repeatTo !== 'number' && !(l.stretch && l.stretch.key)) openAfter = true;
      });
      if (lastEnd >= 1 && !openAfter) { prt.targetRows = lastEnd; prt.phaseTargetAuto = true; }
      return;
    }
    var base = prt.phaseTarget, segs = ps.phases.segments, mapped = null;
    for (var k = 0; k < segs.length; k++) {
      var g = segs[k];
      if (base >= g.pFrom && (g.pTo === null || base <= g.pTo)) { mapped = base + g.off; break; }
    }
    prt.targetRows = mapped;
  }

  /** importPatternSections' last step: parts with an open stretch get no row target. */
  function knitAfterImport(proj, sections, fullText) {
    if (!proj || !isKnitProject(proj)) return;
    // wave K (knit-store, P7): a pattern out of a book remembers its own PDF
    // pages, so only ITS charts attach (`setChartPages`), never the book's others
    try { knitRememberPatternPages(proj, sections, fullText); } catch (e0) { /* no pages known */ }
    if (!proj.rowPhases) return;
    proj.parts.forEach(function (p) {
      // a target the import (re)computed is the pattern's own numbering
      if (p.targetRows >= 1) delete p.phaseTarget;
      try { knitSyncTarget(p); } catch (e) { /* keep it */ }
    });
  }

  /**
   * `craftData.patternPages` [{name, from, to}]: the book patterns this import
   * took (`Knits.bookPatterns`), by the sections' group names. Absent for a
   * single pattern (every chart is its own).
   */
  function knitRememberPatternPages(proj, sections, fullText) {
    var api = patternsApi(KNIT_CRAFT);
    if (!fullText || !api || typeof api.bookPatterns !== 'function' || !Array.isArray(sections)) return;
    var book = api.bookPatterns(String(fullText));
    if (!Array.isArray(book) || book.length < 2) return;
    var names = [];
    sections.forEach(function (s) { var g = normalizeGroupName(s && s.group); if (g && names.indexOf(g) < 0) names.push(g); });
    if (!names.length) return;
    var key = function (n) { return str(n, '').toLowerCase().replace(/[^a-z0-9]+/g, ''); };
    var keep = [];
    book.forEach(function (b) {
      if (!b || !b.pages || !(b.pages.from >= 1)) return;
      if (!names.some(function (n) { return key(n) === key(b.name); })) return;
      keep.push({ name: str(b.name, ''), from: Math.floor(b.pages.from), to: Math.floor(b.pages.to >= b.pages.from ? b.pages.to : b.pages.from) });
    });
    if (!keep.length) return;
    if (!proj.craftData || typeof proj.craftData !== 'object') proj.craftData = {};
    proj.craftData.patternPages = keep;
  }

  /** Is PDF page `page` one of the imported book patterns' own pages (true when none are known)? */
  function knitPageInPattern(cd, page) {
    var pp = cd && Array.isArray(cd.patternPages) ? cd.patternPages : null;
    if (!pp || !pp.length) return true;
    return pp.some(function (x) { return x && page >= x.from && page <= x.to; });
  }

  function knitSetStretch(projectId, partId, fn) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt || !isKnitPart(prt)) return null;
    return fn(proj, prt);
  }

  /**
   * "I'm at the length": the rows done so far end the stretch being worked;
   * the next row is the first instruction after it. One undo step, one
   * history entry.
   */
  function endStretch(projectId, partId) {
    return knitSetStretch(projectId, partId, function (proj, prt) {
      var si = stretchInfo(prt);
      if (!si) return { event: 'none' };
      snapshot(proj);
      var rows = Math.max(0, (prt.row || 0) - si.start + 1);
      if (!prt.stretches || typeof prt.stretches !== 'object') prt.stretches = {};
      prt.stretches[si.key] = { rows: rows, planned: false, at: now() };
      prt.stitch = 0;
      knitSyncTarget(prt);
      pushHistory(proj, prt);
      var h = proj.history[proj.history.length - 1];
      if (h) { h.kind = 'stretchEnd'; h.stretchRows = rows; }
      touch(proj);
      var p2 = part(proj, partId);
      return { event: 'stretchEnd', key: si.key, start: si.start, end: si.start + rows - 1, rows: rows,
        next: lineForRow(p2, repeatInfo(p2).patternRow) };
    });
  }

  /** "Use" on the ≈ estimate: the stretch is planned to end there (a target). One undo step. */
  function useStretchEstimate(projectId, partId) {
    return knitSetStretch(projectId, partId, function (proj, prt) {
      var si = stretchInfo(prt);
      if (!si || !si.estimate || !(si.estimate.end >= si.start - 1)) return null;
      snapshot(proj);
      if (!prt.stretches || typeof prt.stretches !== 'object') prt.stretches = {};
      prt.stretches[si.key] = { rows: Math.max(0, si.estimate.end - si.start + 1), planned: true, at: now() };
      knitSyncTarget(prt);
      touch(proj);
      return stretchInfo(part(proj, partId));
    });
  }

  /** Take an end back off (the stretch being worked, else the last one ended before it). One undo step. */
  function reopenStretch(projectId, partId, key) {
    return knitSetStretch(projectId, partId, function (proj, prt) {
      if (!prt.stretches) return false;
      var k = key;
      if (!k) {
        var si = stretchInfo(prt);
        if (si && si.state !== 'open') k = si.key;
        if (!k) {
          var W = repeatInfo(prt).patternRow;
          stretchList(prt).forEach(function (x) { if (x.end !== null && x.start !== null && x.start <= W) k = x.key; });
        }
      }
      if (!k || !prt.stretches[k]) return false;
      snapshot(proj);
      delete prt.stretches[k];
      if (!Object.keys(prt.stretches).length) delete prt.stretches;
      knitSyncTarget(prt);
      touch(proj);
      return true;
    });
  }

  /* ---- wave K (knit-store, P10): "I measured" ------------------------- */

  /**
   * What the knitter's measurements say: rows per unit fitted through them
   * (least squares through the start of what is measured), the rows left to
   * the stretch's length, and a row-gauge offer (never applied here).
   */
  function measureInfo(prt) {
    var out = { pairs: [], rowsPerUnit: null, unit: null, rowsLeft: null, endRow: null, fromRow: 0, gaugeOffer: null };
    if (!prt || !isKnitPart(prt)) return out;
    var proj = projectOfPart(prt);
    var g = gaugeOf(proj);
    var unit = g ? g.unit : knitDefaultUnit();
    out.unit = unit;
    out.pairs = normalizeMeasures(prt.measures);
    var ui = null, si = null;
    try {
      // the stretch being worked, else the last one that started before this
      // row (a planned end the knitter has passed is still what they measure)
      si = stretchInfo(prt);
      if (!si) {
        var W0 = repeatInfo(prt).patternRow, lastSt = null;
        stretchList(prt).forEach(function (x) { if (x.start !== null && x.start <= W0 && x.end !== null) lastSt = x; });
        if (lastSt) si = stretchInfo(prt, lastSt.start);
      }
      ui = untilInfo(prt, si ? si.start : undefined);
    } catch (e) { ui = null; }
    out.stretch = si || null;
    var from = ui && typeof ui.fromRow === 'number' ? ui.fromRow : 0;
    out.fromRow = from;
    var sxy = 0, sxx = 0, used = 0;
    out.pairs.forEach(function (m) {
      if (m.row <= from) return;
      var x = lengthIn(m.value, m.unit, unit);
      sxy += (m.row - from) * x;
      sxx += x * x;
      used++;
    });
    if (!used || !(sxx > 0)) return out;
    out.rowsPerUnit = Math.round((sxy / sxx) * 1000) / 1000;
    if (ui && ui.kind === 'length' && ui.value) {
      var target = lengthIn(ui.value, ui.unit || unit, unit);
      out.endRow = from + Math.round(target * out.rowsPerUnit);
      out.rowsLeft = Math.max(0, out.endRow - (prt.row || 0));
      out.stretchKey = si ? si.key : null;
    }
    // the row gauge these measurements make, against the one in use
    var over = g && g.over ? g.over : (unit === 'in' ? 4 : 10);
    var rowsOver = Math.round(out.rowsPerUnit * over * 10) / 10;
    var was = g ? (g.swatch && g.swatch.rows) || g.rows : null;
    var rowsSpan = out.pairs.reduce(function (a, m) { return Math.max(a, m.row - from); }, 0);
    if ((used >= 2 || rowsSpan >= 10) && (!was || Math.abs(rowsOver - was) / was >= 0.02)) {
      out.gaugeOffer = { rows: rowsOver, over: over, unit: unit, was: was || null };
    }
    return out;
  }

  /**
   * "I measured: 14 in" on the row just finished. A stretch whose end was
   * only planned from the gauge is re-planned from the measurements; an open
   * one is left for the knitter ("I'm at the length"). One undo step.
   */
  function addMeasurement(projectId, partId, value, unit) {
    return knitSetStretch(projectId, partId, function (proj, prt) {
      var v = knitNum(value, 9999);
      if (!v) return null;
      snapshot(proj);
      var list = normalizeMeasures(prt.measures);
      list.push({ row: prt.row || 0, value: v, unit: knitUnit(unit || (gaugeOf(proj) || {}).unit), at: now() });
      prt.measures = list.slice(-24);
      var info = measureInfo(prt);
      var si = info.stretch;
      if (si && si.state === 'planned' && info.endRow !== null && info.stretchKey === si.key) {
        prt.stretches[si.key] = { rows: Math.max(0, info.endRow - si.start + 1), planned: true, at: now() };
        knitSyncTarget(prt);
        info = measureInfo(prt);
        info.replanned = true;
      }
      info.atLength = !!(si && info.endRow !== null && (prt.row || 0) >= info.endRow);
      touch(proj);
      return info;
    });
  }

  /** Switch a knitting project to stretch phases (or back to the absolute numbering). One undo step. */
  function setRowPhases(projectId, on) {
    var proj = project(projectId);
    if (!proj || !isKnitProject(proj)) return false;
    if (!!proj.rowPhases === !!on) return true;
    snapshot(proj);
    if (on) proj.rowPhases = true;
    else delete proj.rowPhases;
    knitPhaseMemo = Object.create(null);
    proj.parts.forEach(function (p) {
      if (on) knitSyncTarget(p);
      else if (p.phaseTarget >= 1) { p.targetRows = p.phaseTarget; delete p.phaseTarget; }
      else if (p.phaseTargetAuto) { p.targetRows = null; delete p.phaseTargetAuto; }
    });
    touch(proj);
    return true;
  }

  /* ---- wave K (knit-store, P2): "this row" resolves the repeat ---------- */

  // a sentence that sends you back to rows already written ("Rep last 6
  // rnds 8 times more", "Rows 93-100: Rep Rows 91-92", "3rd row: As 1st row")
  var KNIT_REP_SENTENCE_RE = /\b(?:rep(?:eat)?|as)\b/i;

  /** "Knit 5 rnds even" counts rows; the reader may still hang a repeatOf on it. */
  function knitPlainSpan(l) {
    if (l && l.plainRows) return true;   // knit-parse §9: so many plain rows, no back-reference
    var u = untilOf(l);
    return !!(u && u.kind === 'rows' && !/^\s*(?:[^:]{0,30}:\s*)?rep/i.test(str(l.text, '')));
  }

  var KNIT_NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };

  /**
   * Does the sentence itself name the rows `refs` (the rows it sends you
   * back to)? "Rep last 6 rnds" (6 rows, the ones just above), "Rep Rows
   * 91-92" / "Rows 63 and 64", "As 1st row" / "Rep Row 1". "Rep Inc rnd every
   * other rnd" (a plain round the pattern never wrote, then the named one),
   * "Cont in pat until … same length as Back" and anything else: no.
   */
  function knitRepProven(text, refs, from) {
    var t = String(text || '');
    var n = refs.length, i;
    var ROWW = '(?:short[\\s-]*)?(?:rows?|rnds?|rounds?)';
    var lastRe = new RegExp('\\brep(?:eat)?\\s+(?:the\\s+)?last\\s+(\\d+|[a-z]+)\\s*(\\([^)]*\\))?\\s*' + ROWW + '\\b', 'i');
    var last = lastRe.exec(t);
    // "every other row" / "alt rnds": the plain row between is not a written one
    if (!last && /\bevery\s+(?:other|alternate|alt\.?|2nd|following\s+alt(?:ernate)?)\s+(?:rows?|rnds?|rounds?)\b|\bon\s+alt(?:ernate)?\.?\s+(?:rows?|rnds?)\b/i.test(t)) return false;
    if (last) {
      // "Rep last 6 (6-6-6-4-4) rnds": one of the sizes' numbers
      var allowed = [/^\d+$/.test(last[1]) ? +last[1] : KNIT_NUM_WORDS[last[1].toLowerCase()]];
      if (last[2]) (last[2].match(/\d+/g) || []).forEach(function (d) { allowed.push(+d); });
      if (allowed.indexOf(n) < 0) return false;
      for (i = 0; i < n; i++) if (refs[i] !== from - n + i) return false;
      return true;
    }
    if (/\brep(?:eat)?\s+(?:the\s+)?last\s+(?:row|rnd|round)\b/i.test(t)) return n === 1 && refs[0] === from - 1;
    var range = /\b(?:rows?|rnds?|rounds?)\s+(\d+)\s*(?:-|–|—|to|through)\s*(\d+)\b/i.exec(t);
    if (range && /\brep(?:eat)?\b/i.test(t)) {
      var a = +range[1], b = +range[2];
      if (b - a + 1 !== n) return false;
      for (i = 0; i < n; i++) if (refs[i] !== a + i) return false;
      return true;
    }
    var pair = /\b(?:rows?|rnds?)\s+(\d+)\s+(?:and|&)\s+(\d+)\b/i.exec(t);
    if (pair && /\brep(?:eat)?\b/i.test(t)) return n === 2 && refs[0] === +pair[1] && refs[1] === +pair[2];
    var as = /\bas\s+(?:for\s+)?(?:(\d+)(?:st|nd|rd|th)\s+(?:row|rnd|round)|(?:row|rnd|round)\s+(\d+))\b/i.exec(t);
    if (as) return n === 1 && refs[0] === +(as[1] || as[2]);
    var one = /\brep(?:eat)?\s+(?:row|rnd|round)\s+(\d+)\b/i.exec(t);
    if (one) return n === 1 && refs[0] === +one[1];
    return false;
  }

  /**
   * Row `row` of a back-referencing line: the written row it works and where
   * it is in the cycle, or null when the store cannot tell.
   * @returns {{shown:Object, k:number, n:number, cycle:number, of:(number|null), ref:number}|null}
   */
  function knitResolveRepeat(prt, l, row, depth) {
    if (!l || (depth || 0) > 4 || knitPlainSpan(l)) return null;
    var refs = l.repeatOf;
    var from = backRefFrom(l);
    if (!from || !(row >= from) || !Array.isArray(refs) || !refs.length) return null;
    if (!KNIT_REP_SENTENCE_RE.test(str(l.text, ''))) return null;
    for (var i = 0; i < refs.length; i++) {
      if (typeof refs[i] !== 'number' || !isFinite(refs[i]) || refs[i] < 1 || refs[i] >= row || Math.floor(refs[i]) !== refs[i]) return null;
    }
    // wave K (audit): only a sentence that SAYS which rows it repeats, and
    // says the same rows the reader found, is resolved
    if (!knitRepProven(str(l.text, ''), refs, from)) return null;
    var n = refs.length;
    var k = ((row - from) % n) + 1;
    var u = refs[k - 1];
    var ul = lineForRow(prt, u);
    if (!ul) return null;
    var shown = ul;
    if (backRefFrom(ul) && !knitPlainSpan(ul)) {
      var deeper = knitResolveRepeat(prt, ul, u, (depth || 0) + 1);
      if (!deeper) return null;
      shown = deeper.shown;
    }
    // the rows repeated are the ones just above the sentence: they were the
    // first working ("Rep last 6 rnds 8 times more" = workings 2 to 9)
    var contiguous = true;
    for (var j = 0; j < n; j++) if (refs[j] !== from - n + j) contiguous = false;
    var cycle = Math.floor((row - from) / n) + (contiguous ? 2 : 1);
    var of = null;
    if (typeof l.repeatTo === 'number' && l.repeatTo >= from) {
      var span = l.repeatTo - from + 1;
      if (span % n === 0) of = span / n + (contiguous ? 1 : 0);
    }
    return { shown: shown, k: k, n: n, cycle: cycle, of: of, ref: u };
  }

  /**
   * The pattern line for a row, with a repeat sentence resolved to the row
   * it sends you back to. Knitting only; crochet (and anything the store
   * cannot resolve) gets `shown === line`, `via === null`.
   * @returns {{line:Object, shown:Object, via:(Object|null), k:(number|null),
   *   n:(number|null), cycle:(number|null), of:(number|null)}|null}
   */
  function lineInfo(prt, rowNumber) {
    var l = lineForRow(prt, rowNumber);
    if (!l) return null;
    var out = { line: l, shown: l, via: null, k: null, n: null, cycle: null, of: null, unsure: false };
    if (!isKnitPart(prt)) return out;
    var src = l.stretch && l.stretch.lead ? l.stretch.lead : l;
    var res = null;
    try { res = knitResolveRepeat(prt, src, rowNumber, 0); } catch (e) { res = null; }
    if (!res) {
      // wave K (audit): a back-reference the store could not prove: show the
      // printed sentence, and say so
      if (backRefFrom(src) && Array.isArray(src.repeatOf) && src.repeatOf.length && !knitPlainSpan(src) && rowNumber >= backRefFrom(src)) out.unsure = true;
      return out;
    }
    out.shown = res.shown;
    out.via = l;
    out.k = res.k;
    out.n = res.n;
    out.cycle = res.cycle;
    out.of = res.of;
    return out;
  }

  /** A back-reference whose every re-worked row is a short row. */
  function shortBackRef(prt, l) {
    if (!backRefFrom(l)) return false;
    return l.repeatOf.every(function (r) {
      var ul = lineForRow(prt, r);
      return !!(ul && ul.shortRow && !backRefFrom(ul));
    });
  }

  /** The pattern row an actual row is, through the part's own repeat block. */
  function patternRowOf(prt, row) {
    var r = prt && prt.repeat;
    if (!r || !r.enabled) return row;
    var len = r.endRow - r.startRow + 1;
    var times = repeatTimes(r);
    if (len <= 0 || times < 1) return row;
    if (row >= r.startRow && row < r.startRow + len * times) return r.startRow + ((row - r.startRow) % len);
    return row;
  }

  var SHORT_RANGE_RE = /\bshort\s+rows?\s+(\d{1,3})\s*(?:-|–|—|to|through)\s*(\d{1,3})\b/i;

  function unnumberedSpan(l) {
    var m = SHORT_RANGE_RE.exec(str(l && l.text, ''));
    if (m) {
      var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (b >= a && b - a < 200) return b - a + 1;
    }
    return 1;
  }

  /**
   * The run of short rows the counter is in (or about to work), or null.
   *   numbered: the working row's own line says `turn` / `w&t` (a heel turn's
   *     Row 1..8); the run is the contiguous short-row lines around it, plus
   *     a repeat sentence that sends you back into it.
   *   unnumbered: short-row lines sitting between the row just finished and
   *     the next numbered row ("Short row 1 (RS): K to 3 sts before m, w&t").
   * @returns {{numbered:boolean, start:number, base:number, n:number,
   *            of:number|null, lines:Array}|null}
   */
  function shortRowRun(prt) {
    var lines = linesFor(prt);
    if (!lines.length) return null;
    var R = prt.row || 0;
    var PW = repeatInfo(prt).patternRow;
    var L = lineForRow(prt, PW);
    var i, of, l;
    // the written row this one is (a "Rep Rows 91-92" row is Row 91 or 92)
    var U = underlyingLine(prt, PW);
    if (U && U.shortRow && isRowLine(U) && !backRefFrom(U)) {
      var at = lines.indexOf(U);
      var s = at;
      var firstRow = U.row;
      // back over the short rows (and numbered back-references to them)
      // written before it
      for (i = at - 1; i >= 0; i--) {
        l = lines[i];
        if (isRowLine(l) && l.kind !== 'repeat') {
          if ((l.shortRow || shortBackRef(prt, l)) && (l.rowEnd >= l.row ? l.rowEnd : l.row) === firstRow - 1) {
            s = i;
            firstRow = l.row;
            continue;
          }
          break;
        }
        if (l.kind === 'repeat' || l.kind === 'setup') break;
      }
      var start = firstRow;
      var last = start - 1;
      var run = [];
      // forward: contiguous short rows, and repeat sentences that send you
      // back into them ("Rep Rows 91-92 4 more times", "... until all heel
      // sts have been worked" = no known end)
      for (i = s; i < lines.length; i++) {
        l = lines[i];
        if (l && l.kind === 'repeat') {
          var refs = Array.isArray(l.repeatOf) ? l.repeatOf : [];
          var inside = refs.length && refs.every(function (r) { return r >= start && r <= last; });
          if (!inside || !(l.repeatFrom >= 1) || l.repeatFrom !== last + 1) break;
          if (l.repeatTo >= l.repeatFrom) { last = l.repeatTo; continue; }
          last = null;
          break;
        }
        if (isRowLine(l)) {
          if ((l.shortRow || shortBackRef(prt, l)) && l.row === last + 1) {
            run.push(l);
            last = l.rowEnd >= l.row ? l.rowEnd : l.row;
            continue;
          }
          break;
        }
        // a note between them ("18 heel sts remain") does not end the run
      }
      if (last !== null && PW > last) return null;
      of = last === null ? null : last - start + 1;
      return { numbered: true, start: start, base: start - 1, n: PW - start + 1, of: of || null, lines: run };
    }
    // unnumbered short rows after the row just finished
    var iPrev = -1, iNext = lines.length;
    var prevLine = R >= 1 ? lineForRow(prt, patternRowOf(prt, R)) : null;
    if (prevLine) iPrev = lines.indexOf(prevLine);
    if (L && isRowLine(L)) iNext = lines.indexOf(L);
    if (iNext < 0) iNext = lines.length;
    var found = [];
    for (i = iPrev + 1; i < iNext; i++) {
      l = lines[i];
      if (isRowLine(l)) break;
      if (l.shortRow) found.push(l);
      else if (found.length && l.kind === 'repeat') { found.push(l); }
    }
    if (!found.length) return null;
    of = 0;
    for (i = 0; i < found.length; i++) {
      if (found[i].kind === 'repeat' && !found[i].shortRow) {
        if (found[i].repeatTimes >= 1 && found[i].repeatTimes < 100) of = of === null ? null : of * (found[i].repeatTimes + 1);
        else of = null;
        continue;
      }
      if (of !== null) of += unnumberedSpan(found[i]);
    }
    return { numbered: false, start: null, base: R, n: 1, of: of || null, lines: found };
  }

  /** The line short row `n` of a run is worked from. */
  function shortRowLine(prt, run, n) {
    if (!run) return null;
    if (run.numbered) return underlyingLine(prt, run.base + n) || run.lines[run.lines.length - 1] || null;
    var acc = 0, real = run.lines.filter(function (l) { return l.shortRow; });
    for (var i = 0; i < real.length; i++) {
      acc += unnumberedSpan(real[i]);
      if (n <= acc) return real[i];
    }
    // past the written ones ("rep the last 2 short rows"): alternate the last two
    if (real.length >= 2) return real[real.length - 2 + ((n - acc - 1) % 2)];
    return real[real.length - 1] || null;
  }

  /**
   * The short-row state of a part right now: its stored sub-counter, or the
   * one the pattern puts it in, or null (not in short rows, or done here).
   * @returns {{active:boolean, n:number, of:number|null, row:number, base:number,
   *   numbered:boolean, line:Object|null, patternRow:number|null}|null}
   */
  function shortRowInfo(prt) {
    var info = shortRowInfoBase(prt);
    if (!info) return info;
    // wave H (knit-qa-2): `Line.shortRows` [{n, side, worked}] — how far this
    // short row works and on which side ("Short row 3 of 6 · 11 sts")
    var list = info.line && Array.isArray(info.line.shortRows) ? info.line.shortRows : null;
    info.worked = null;
    info.side = null;
    if (list) {
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (!e || e.n !== info.n) continue;
        if (typeof e.worked === 'number' && isFinite(e.worked) && e.worked > 0) info.worked = Math.floor(e.worked);
        info.side = normalizeKnitSide(e.side);
        break;
      }
    }
    return info;
  }

  function shortRowInfoBase(prt) {
    if (!prt || !isKnitPart(prt)) return null;
    var st = prt.shortRows && typeof prt.shortRows === 'object' ? prt.shortRows : null;
    if (st && !st.active && st.row === prt.row) return null;   // done for this row
    var run = null;
    try { run = shortRowRun(prt); } catch (e) { run = null; }
    if (st && st.active) {
      var n = st.n;
      return {
        active: true, n: n, of: st.of, row: st.row, base: st.base, numbered: !!st.numbered,
        line: shortRowLine(prt, run || { numbered: st.numbered, base: st.base, lines: [] }, n),
        patternRow: st.numbered ? st.base + n : null
      };
    }
    if (!run) return null;
    return {
      active: false, n: run.n, of: run.of, row: prt.row, base: run.base, numbered: run.numbered,
      line: shortRowLine(prt, run, run.n),
      patternRow: run.numbered ? run.base + run.n : null
    };
  }

  function flipSideOf(prt) {
    if (prt && (prt.side === 'rs' || prt.side === 'ws')) prt.side = prt.side === 'rs' ? 'ws' : 'rs';
  }

  /** Hook: the counter moved `delta` rows (completeRow, untapRow, jumpToRow). */
  function knitRowMoved(prt, delta) {
    if (!prt || !isKnitPart(prt)) return;
    if (delta % 2 !== 0) flipSideOf(prt);
    // the knitter's word holds until the pattern states a side again: a row
    // whose own line says (RS) / (WS) takes over from it
    if (prt.side && delta !== 0) {
      var pr = patternRowOf(prt, prt.row + 1);
      try { if (lineSideFor(lineForRow(prt, pr), pr)) prt.side = null; } catch (e) { /* keep it */ }
    }
    // a "done here" marker below the row it was for is stale
    var st = prt.shortRows;
    if (st && !st.active && prt.row < st.row) prt.shortRows = null;
  }

  /** Hook: a new piece (or a reset) starts from nothing. */
  function knitNewPiece(prt) {
    if (!prt || !isKnitPart(prt)) return;
    prt.side = null;
    prt.shortRows = null;
  }

  /** In short rows, the stitch count is stitches worked before the turn: no target. */
  function knitInShortRows(prt) {
    return !!(prt && isKnitPart(prt) && shortRowInfo(prt));
  }

  /** One short row finished. Called inside tapRow's snapshot. */
  function shortRowStep(proj, prt, info) {
    if (info.of && info.n >= info.of) {
      var done = info.of;
      if (info.numbered) {
        // the rows the pattern numbered are worked: land on the row after them
        prt.shortRows = null;
        prt.row = Math.max(0, info.base + done - 1);
        var res = completeRow(proj, prt);   // records, history, piece/part done, side flip
        prt.shortRows = { active: false, n: done, of: done, row: prt.row, base: info.base, numbered: true };
        res.shortRowsDone = done;
        return res;
      }
      prt.stitch = 0;
      flipSideOf(prt);
      prt.shortRows = { active: false, n: done, of: done, row: prt.row, base: info.base, numbered: false };
      return { event: 'shortRowsDone', n: done, of: done, row: prt.row, partName: prt.name };
    }
    prt.stitch = 0;
    flipSideOf(prt);
    prt.shortRows = {
      active: true, n: info.n + 1, of: info.of, row: prt.row, base: info.base, numbered: !!info.numbered
    };
    return { event: 'shortRow', n: info.n + 1, of: info.of, row: prt.row, partName: prt.name };
  }

  /* ---- two at a time --------------------------------------------------- */

  function linkedPart(proj, prt) {
    if (!proj || !prt || !prt.linked) return null;
    var mate = part(proj, prt.linked);
    return mate && mate !== prt && mate.linked === prt.id ? mate : null;
  }

  var LINK_NUM_RE = /^(.*?)\s*#?(\d{1,2})$/;
  var LINK_SIDE_RE = /^(left|right)\s+(.+)$/i;

  /** "Sleeve 1+2", "Sock 1+2", "Left+Right Front", else "Back+Front". */
  function linkedLabel(proj, prt) {
    var mate = linkedPart(proj, prt);
    if (!mate) return prt ? prt.name : '';
    var a = prt, b = mate;
    if (proj.parts.indexOf(b) < proj.parts.indexOf(a)) { a = mate; b = prt; }
    if (a.name === b.name) return a.name + ' 1+2';
    var ma = LINK_NUM_RE.exec(a.name), mb = LINK_NUM_RE.exec(b.name);
    if (ma && mb && ma[1] && ma[1].toLowerCase() === mb[1].toLowerCase()) return ma[1] + ' ' + ma[2] + '+' + mb[2];
    var sa = LINK_SIDE_RE.exec(a.name), sb = LINK_SIDE_RE.exec(b.name);
    if (sa && sb && sa[2].toLowerCase() === sb[2].toLowerCase()) return sa[1] + '+' + sb[1] + ' ' + sa[2];
    return a.name + '+' + b.name;
  }

  function unlinkIn(proj, prt) {
    if (!prt) return;
    var mate = prt.linked ? part(proj, prt.linked) : null;
    if (mate && mate.linked === prt.id) mate.linked = null;
    prt.linked = null;
  }

  /** Work two parts two-at-a-time (each is unlinked from any other first). */
  function linkParts(projectId, partId, otherId) {
    var proj = project(projectId);
    var a = part(proj, partId), b = part(proj, otherId);
    if (!proj || !a || !b || a === b) return false;
    snapshot(proj);
    unlinkIn(proj, a);
    unlinkIn(proj, b);
    a.linked = b.id;
    b.linked = a.id;
    touch(proj);
    return true;
  }

  function unlinkPart(projectId, partId) {
    var proj = project(projectId);
    var a = part(proj, partId);
    if (!proj || !a || !a.linked) return false;
    snapshot(proj);
    unlinkIn(proj, a);
    touch(proj);
    return true;
  }

  /**
   * "Knit both at once" for a part made twice (a Socks template's one Sock
   * ×2, Sleeves ×2): it becomes two linked parts, "Sock 1" and "Sock 2",
   * each made once, the second a copy of the first's pattern and settings
   * starting from nothing. Only before the first piece is finished. One Undo.
   * @returns {{a:Object, b:Object}|null}
   */
  function splitTwoAtATime(projectId, partId) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt || prt.makeCount !== 2 || prt.piecesDone > 0) return null;
    snapshot(proj);
    var stem = prt.name.replace(/([^s])s$/i, '$1');
    var twin = makePart(stem + ' 2', 1);
    ['patternText', 'placementNotes', 'sizeIndex', 'workMode', 'orientation', 'dialect', 'targetRows', 'group']
      .forEach(function (k) { if (prt[k] !== undefined) twin[k] = deepCopy(prt[k]); });
    twin.repeat = deepCopy(prt.repeat);
    twin.alerts = (prt.alerts || []).slice();
    knitPartDefaults(twin);
    twin.markers = normalizeMarkers((prt.markers || []).map(function (m) { return { name: m.name, at: m.at }; }));
    twin.markerTotal = twin.markers.length ? (prt.markerTotal || null) : null;
    prt.name = safeName(stem + ' 1', prt.name);
    prt.makeCount = 1;
    delete prt.makeCountInferred;
    knitPartDefaults(prt);
    proj.parts.splice(proj.parts.indexOf(prt) + 1, 0, twin);
    unlinkIn(proj, prt);
    prt.linked = twin.id;
    twin.linked = prt.id;
    touch(proj);
    return { a: prt, b: twin };
  }

  var knitLinkBusy = false;

  function undoTop() {
    return undoStack.length ? undoStack[undoStack.length - 1] : null;
  }

  /** Drop the one snapshot a nested call pushed on top of `mark` (one Undo for two moves). */
  function dropSnapshotAbove(mark) {
    if (undoTop() === mark || !undoStack.length) return;
    var e = undoStack.pop();
    undoBytesTotal -= e.bytes || 0;
    if (undoBytesTotal < 0) undoBytesTotal = 0;
  }

  /**
   * Hook at the top of tapRow. Returns a result when knitting handled it
   * (short-row mode, a linked pair), else null for the ordinary path.
   */
  function knitTapRow(proj, prt) {
    if (!isKnitProject(proj)) return null;
    var mate = knitLinkBusy ? null : linkedPart(proj, prt);
    var res = null;
    var before = undoTop();
    var sr = shortRowInfo(prt);
    if (sr) {
      if (!isPartTerminal(prt)) {
        snapshot(proj);
        res = shortRowStep(proj, prt, sr);
        touch(proj);
      }
    }
    if (!mate) return res;
    // Two at a time: one row tap advances both, one Undo takes both back.
    if (!res) {
      knitLinkBusy = true;
      try { res = tapRow(proj.id, prt.id); } finally { knitLinkBusy = false; }
    }
    if (res.event === 'alreadyDone' && isPartTerminal(mate)) return res;
    var firstPushed = undoTop() !== before;
    var mid = undoTop();
    knitLinkBusy = true;
    var other;
    try { other = tapRow(proj.id, mate.id); } finally { knitLinkBusy = false; }
    if (firstPushed) dropSnapshotAbove(mid);
    res.linked = { partId: mate.id, partName: mate.name, event: other ? other.event : 'none', row: mate.row };
    // the bigger milestone wins the announcement
    var rank = { none: 0, alreadyDone: 0, shortRow: 1, row: 1, shortRowsDone: 2, pieceDone: 3, partDone: 4, groupDone: 5, projectDone: 6 };
    if (other && (rank[other.event] || 0) > (rank[res.event] || 0)) {
      other.linked = { partId: prt.id, partName: prt.name, event: res.event, row: prt.row };
      return other;
    }
    return res;
  }

  /** Hook at the top of untapRow (the inverse of knitTapRow). */
  function knitUntapRow(proj, prt) {
    if (!isKnitProject(proj)) return null;
    var mate = knitLinkBusy ? null : linkedPart(proj, prt);
    var res = null;
    var before = undoTop();
    var st = prt.shortRows;
    if (st && st.active && st.n > 1) {
      snapshot(proj);
      st.n -= 1;
      prt.stitch = 0;
      flipSideOf(prt);
      touch(proj);
      res = { event: 'shortRow', n: st.n, of: st.of, row: prt.row };
    } else if (st && !st.active && !st.numbered && st.row === prt.row && st.of) {
      // straight after the last short row: back onto it
      snapshot(proj);
      prt.shortRows = { active: true, n: st.of, of: st.of, row: st.row, base: st.base, numbered: false };
      prt.stitch = 0;
      flipSideOf(prt);
      touch(proj);
      res = { event: 'shortRow', n: st.of, of: st.of, row: prt.row };
    } else if (st && st.active) {
      // short row 1: leave short-row mode and step back a row as usual
      snapshot(proj);
      var mine = undoTop();
      prt.shortRows = null;
      knitLinkBusy = true;
      try { res = untapRow(proj.id, prt.id); } finally { knitLinkBusy = false; }
      dropSnapshotAbove(mine);
      if (!res || res.event === 'none') { touch(proj); res = { event: 'row', row: prt.row }; }
    }
    if (!mate) return res;
    if (!res) {
      knitLinkBusy = true;
      try { res = untapRow(proj.id, prt.id); } finally { knitLinkBusy = false; }
    }
    var firstPushed = undoTop() !== before;
    var mid = undoTop();
    knitLinkBusy = true;
    var other;
    try { other = untapRow(proj.id, mate.id); } finally { knitLinkBusy = false; }
    if (firstPushed) dropSnapshotAbove(mid);
    if (res && res.event === 'none' && other && other.event !== 'none') res = other;
    if (res) res.linked = { partId: mate.id, partName: mate.name, event: other ? other.event : 'none', row: mate.row };
    return res;
  }

  /**
   * Hook in tapStitch after a row completed on its own: two at a time, the
   * work moves on to the partner when it is behind ("Sock 2 next").
   */
  function knitAfterAutoRow(proj, prt, res) {
    if (!isKnitProject(proj) || !res || (res.event !== 'row' && res.event !== 'rowAuto')) return res;
    var mate = linkedPart(proj, prt);
    if (!mate || isPartTerminal(mate)) return res;
    if (mate.piecesDone < prt.piecesDone || (mate.piecesDone === prt.piecesDone && mate.row < prt.row)) {
      proj.activePartId = mate.id;
      res.switchedTo = { partId: mate.id, partName: mate.name };
    }
    return res;
  }

  /* ---- right side / wrong side ----------------------------------------- */

  function otherSide(s) { return s === 'rs' ? 'ws' : s === 'ws' ? 'rs' : null; }

  // A side the line's own words state: "(RS)", "(wrong side)", "Row 3 RS:".
  // A parser may also fill `side` by parity on untagged rows; that is only
  // as good as its count, so the chip does its own parity from stated tags.
  var SIDE_STATED_RE = /\(\s*(?:rs|ws|right\s+side|wrong\s+side)\s*\)|^[^:]{0,40}?\b(?:rs|ws)\s*[:.]|\bright[-\s]side\s+rows?\b|\bwrong[-\s]side\s+rows?\b/i;

  function sideStated(l) {
    return !!(l && SIDE_STATED_RE.test(str(l.text, '').slice(0, 80)));
  }

  /** wave K (audit): "With RS facing, … join yarn …" on a ROW states that row's side. */
  function knitFacingSide(l) {
    if (!l || !(l.row >= 1) || l.kind === 'setup') return null;
    var m = /\bwith\s+(rs|ws|right\s+side|wrong\s+side)\s+(?:of\s+work\s+)?facing\b/i.exec(str(l.text, ''));
    if (!m) return null;
    return /^(?:rs|right)/i.test(m[1]) ? 'rs' : 'ws';
  }

  /**
   * wave K (audit): "Join yarn to rem sts …" starts the second side of a
   * divided piece on the side the first side began on (the row that said
   * "Turn. Leave rem sts on a st holder").
   */
  function knitRejoinSide(lines, l) {
    if (!l || !(l.row >= 1) || !/^\s*(?:next\s+row\s*:\s*)?(?:with\s+(?:rs|right\s+side)\s+facing,?\s*)?(?:re)?join\s+yarn\b/i.test(str(l.text, ''))) return null;
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i];
      if (s === l) break;
      if (s && s.row >= 1 && /\bturn\b[^]*?\bleave\s+(?:the\s+)?rem(?:aining)?\s+sts\b|\bleave\s+(?:the\s+)?rem(?:aining)?\s+sts\s+on\s+a\s+(?:st(?:itch)?\s+)?holder/i.test(str(s.text, '')) && sideStated(s)) {
        return normalizeKnitSide(s.side);
      }
    }
    return null;
  }

  function lineSideFor(l, row) {
    var fs = knitFacingSide(l);
    if (fs && l.row === row) return fs;
    if (!l || !l.side || !sideStated(l)) return null;
    var side = normalizeKnitSide(l.side);
    if (!side) return null;
    var list = enumRows(l);
    if (list && list.indexOf(row) >= 0) return side;   // "Rows 2, 4, 6 and 8 (WS)"
    if (l.row === row) return side;
    return null;
  }

  /** An enumerated line's rows (Knits `rowList`; `rows` accepted too), or null. */
  function enumRows(l) {
    if (l && Array.isArray(l.rowList) && l.rowList.length) return l.rowList;
    if (l && Array.isArray(l.rows) && l.rows.length) return l.rows;
    return null;
  }

  /**
   * The side the PATTERN puts a row on: its own tag, else parity from the
   * nearest tagged row (a setup row counts as row 0). null in the round, and
   * null when the pattern never says.
   * @returns {{side:'rs'|'ws'|null, source:'pattern'|'parity'|'round'|null}}
   */
  function patternSideAt(prt, row, proj, opts) {
    if (!prt) return { side: null, source: null };
    var lines = linesFor(prt);
    // a row that states its side is worked flat, even in a piece knitted in
    // the round (a sock's heel flap: "Row 57 (RS)" between rounds)
    var ownLine = lines.length ? lineForRow(prt, patternRowOf(prt, row)) : null;
    var own = lineSideFor(ownLine, patternRowOf(prt, row));
    if (own) return { side: own, source: 'pattern' };
    if (!(opts && opts.flat) && (rowWorkMode(prt, Math.max(1, row), proj) === 'rounds' || prt.rowWord === 'rnd' || knitSpeaksRounds(prt)) &&
        !(normalizeWorkMode(prt.workMode, 'auto') === 'auto' && ownLine && /^\s*rows?\b/i.test(str(ownLine.text, '')))) {
      return { side: null, source: 'round' };
    }
    if (!lines.length) return { side: null, source: null };
    var best = null, bestD = Infinity;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var side = normalizeKnitSide(l && l.side);
      var tagRows;
      // wave K (audit): an ended stretch "ending on a WS row" states its last row's side;
      // "With RS facing … join yarn" states its own row's
      var stSide = knitStretchEndSide(l);
      var fSide = knitFacingSide(l) || knitRejoinSide(lines, l);
      if (stSide) { side = stSide; tagRows = [l.stretch.end]; }
      else if (fSide) { side = fSide; tagRows = [l.row]; }
      else {
        if (!side || !sideStated(l)) continue;
        tagRows = enumRows(l) || (l.row >= 1 ? [l.row] : (l.kind === 'setup' ? [0] : []));
      }
      for (var j = 0; j < tagRows.length; j++) {
        // ONLY the last tag at or before the row: patterns put RS on even
        // rows and swap mid-way, so a tag further on says nothing about here
        // (research: docs/wave-h/knit-research.md)
        if (tagRows[j] > row) continue;
        var d = row - tagRows[j];
        if (d < bestD) { bestD = d; best = { row: tagRows[j], side: side }; }
      }
    }
    // wave K (audit): a part that carries on the one before it ("Front
    // (continued)", "Start with 89 sts.") carries on its row parity
    if (!best && isKnitPart(prt) && !(opts && opts.noCarry)) {
      var carried = knitCarriedSide(prt, proj);
      if (carried) best = { row: 0, side: carried };
    }
    if (!best) return { side: null, source: null };
    return { side: (row - best.row) % 2 === 0 ? best.side : otherSide(best.side), source: 'parity' };
  }

  /** The side an ended stretch's last row is on, when its words say ("ending on a WS row"). */
  function knitStretchEndSide(l) {
    if (!l || !l.stretch || !l.stretch.key || !(l.stretch.end >= 1) || l.stretch.end < l.stretch.start) return null;
    var u = untilOf(l);
    var e = u && u.endOn ? normalizeKnitSide(u.endOn) : null;
    if (!e && l.stretch.parser && l.stretch.parser.ends) e = normalizeKnitSide(l.stretch.parser.ends.endOn);
    return e;
  }

  var knitSideCarryBusy = false;

  /** The side of the last row of the part this one continues, as "row 0" of this one; null when not known. */
  function knitCarriedSide(prt, proj) {
    if (knitSideCarryBusy) return null;
    proj = proj || projectOfPart(prt);
    var su = setupLine(prt);
    var cont = /\(continued/i.test(str(prt.name, '')) || (su && /^\s*start\s+with\s+\d/i.test(str(su.text, '')));
    if (!cont) return null;
    var pp = knitPrevPart(prt, proj);
    if (!pp || !isKnitPart(pp)) return null;
    var end = usableCount(pp.targetRows) || usableCount(patternSummary(pp).maxRow);
    if (!end) return null;
    knitSideCarryBusy = true;
    try {
      var s = patternSideAt(pp, end, proj, { flat: true });
      return s && s.side ? s.side : null;
    } finally { knitSideCarryBusy = false; }
  }

  /** Every numbered line of the part speaks of rounds ("Next rnd …", "Rnd 3: …"), none of rows. */
  function knitSpeaksRounds(prt) {
    var entry = partLines(prt);
    if (!entry || !entry.lines || !entry.lines.length) return false;
    if (entry.speaksRounds !== undefined) return entry.speaksRounds;
    var rnd = 0, rows = 0;
    entry.lines.forEach(function (l) {
      if (!l || !(l.row >= 1)) return;
      var t = str(l.text, '');
      // the line's own label: "Next rnd …", "Rnd 3:", "2nd rnd:" / "Row 1", "Next row", "Short-row 2"
      if (/^\s*(?:[A-Za-z ]{0,20}:\s*)?(?:next\s+|\d+(?:st|nd|rd|th)\s+)?(?:short[\s-]*)?rows?\b/i.test(t) || knitFacingSide(l)) rows++;
      else if (/^\s*(?:[A-Za-z ]{0,20}:\s*)?(?:next\s+|\d+(?:st|nd|rd|th)\s+|set-?up\s+|inc\.?\s+|dec\.?\s+)?(?:rnds?|rounds?)\b/i.test(t)) rnd++;
    });
    entry.speaksRounds = rnd >= 1 && rows === 0;
    return entry.speaksRounds;
  }

  /**
   * The RS/WS chip: the side of the row (or short row) being worked.
   * @returns {{side, source:'you'|'pattern'|'parity'|'round'|null, pattern, inRound:boolean, row:number}}
   */
  function sideInfo(prt, proj) {
    if (!prt) return { side: null, source: null, pattern: null, inRound: false, row: 0 };
    proj = proj || projectOfPart(prt);
    var ri = repeatInfo(prt);
    var row = ri.workingRow;
    var sr = shortRowInfo(prt);
    var pat;
    if (sr) {
      // a short row turns the work: each one flips the side
      var rowEq = sr.numbered ? sr.base + sr.n : (sr.row || 0) + sr.n;
      var tag = sr.line ? normalizeKnitSide(sr.line.side) : null;
      // an unnumbered short-row line's own tag ("Short row 1 (RS)") holds
      // when the line is one short row; a numbered one answers below
      if (tag && !sr.numbered && sideStated(sr.line) && unnumberedSpan(sr.line) === 1) pat = { side: tag, source: 'pattern' };
      // wave H (knit-qa-2): the reader's own list of the short rows a line
      // spans says each one's side (Sandnes' German short rows: RS, WS …)
      else if (sr.side) pat = { side: sr.side, source: 'pattern' };
      else pat = patternSideAt(prt, rowEq, proj, { flat: true });   // a short row turns: flat
      row = rowEq;
    } else {
      pat = patternSideAt(prt, row, proj);
    }
    if (pat.source === 'round') return { side: null, source: 'round', pattern: null, inRound: true, row: row };
    var mine = normalizeKnitSide(prt.side);
    if (mine) return { side: mine, source: 'you', pattern: pat.side, inRound: false, row: row };
    return { side: pat.side, source: pat.side ? pat.source : null, pattern: pat.side, inRound: false, row: row };
  }

  /** Set the side of the row being worked ('rs' | 'ws' | null = the pattern's). */
  function setSide(projectId, partId, side) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt) return null;
    snapshot(proj);
    prt.side = normalizeKnitSide(side);
    touch(proj);
    return sideInfo(prt, proj);
  }

  /** The chip's tap: the other side. Agreeing with the pattern again clears it. */
  function flipSide(projectId, partId) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt) return null;
    var info = sideInfo(prt, proj);
    if (info.inRound) return info;
    var next = info.side ? otherSide(info.side) : 'rs';
    snapshot(proj);
    prt.side = next === info.pattern ? null : next;
    touch(proj);
    return sideInfo(prt, proj);
  }

  /* ---- stitch markers -------------------------------------------------- */

  /** The markers a pattern line places (`Line.markers`) at or before a row. */
  function patternMarkers(prt) {
    var lines = linesFor(prt);
    if (!lines.length) return null;
    var row = repeatInfo(prt).patternRow;
    var best = null;
    // wave K (knit-store, P9): in stretch phases a marker NOTE ("Insert
    // markers around 4 sts …") is placed after the last numbered row before
    // it (it used to count as row 0, so its positions were read against
    // every later row); a note past an open stretch is not placed yet
    var phases = knitPhasesOn(prt) && isKnitPart(prt);
    var lastRow = 0, stopped = false, sameRow = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (!l) continue;
      if (phases && l.stretch && l.stretch.open && l.row >= 1) { stopped = true; }
      if (phases && l.row >= 1) lastRow = Math.max(lastRow, knitLineEnd(l));
      if (!Array.isArray(l.markers) || !l.markers.length) continue;
      // (wave K, P1: a line past an open stretch has no row yet, it is not row 0)
      if (l.unnumbered) continue;
      var lr = l.row >= 1 ? l.row : (phases && l.kind !== 'setup' ? (stopped ? -1 : lastRow) : 0);
      if (lr < 0 || lr > row) continue;
      if (!best || lr > best.row) { best = { row: lr, line: l }; sameRow = [l]; }
      else if (lr === best.row) { best = { row: lr, line: l }; sameRow.push(l); }
    }
    if (!best) return null;
    var list = [];
    var stitchWords = /\bmarkers?\s+around\b|\baround\s+(?:the\s+)?next\s+st\b/i;
    (phases ? sameRow : [best.line]).forEach(function (ml) {
      ml.markers.forEach(function (m, i) {
        if (!m || typeof m !== 'object') return;
        var at = knitAt(m.at);
        if (at < 0) return;
        var nm = str(m.name, '').trim();
        var pmk = { id: 'pattern:' + (ml === best.line ? '' : lines.indexOf(ml) + ':') + i, name: isBorName(nm) ? 'BOR' : nm, at: isBorName(nm) ? 0 : at };
        // wave K (P9): a marker around a stitch ("insert marker around next st")
        if (m.kind === 'stitch' || m.around === true || (isKnitPart(prt) && !isBorName(nm) && stitchWords.test(str(ml.text, '')))) pmk.kind = 'stitch';
        if (list.some(function (x) { return x.name === pmk.name && x.at === pmk.at; })) return;
        if (pmk.name === 'BOR' && list.some(function (x) { return x.name === 'BOR'; })) return;
        list.push(pmk);
      });
    });
    list.sort(function (a, b) { return a.at - b.at; });
    var total = usableCount(best.line.count);
    if (!total && best.line.row >= 1) total = usableCount(targetFor(prt, best.line.row));
    if (!total && phases && !(best.line.row >= 1)) {
      total = best.row >= 1 ? usableCount(targetFor(prt, best.row)) : null;
      if (!total && best.row === 0) { var su = setupLine(prt); total = su ? usableCount(countOf(su)) : null; }
    }
    return list.length ? { markers: list, row: best.row, total: total || null, line: best.line } : null;
  }

  /**
   * The marker strip: where the markers are, how far the next one is, and
   * the stitches between them.
   * @returns {{markers:Array, source:'part'|'pattern'|null, stitch:number,
   *   total:number|null, basis:number|null, shifted:boolean,
   *   next:{marker:Object|null, end:boolean, in:number}|null, atMarker:Object|null,
   *   segments:Array<number>|null, segIndex:number}}
   */
  function markerInfo(prt) {
    var out = { markers: [], source: null, stitch: prt ? prt.stitch : 0, total: null, basis: null,
      shifted: false, next: null, atMarker: null, segments: null, segIndex: -1 };
    if (!prt) return out;
    var mine = normalizeMarkers(prt.markers);
    if (mine.length) {
      out.markers = mine;
      out.source = 'part';
      out.basis = usableCount(prt.markerTotal);
    } else {
      var pm = null;
      try { pm = patternMarkers(prt); } catch (e) { pm = null; }
      if (pm) {
        out.markers = pm.markers;
        out.source = 'pattern';
        out.basis = pm.total;
        out.basisRow = pm.row;   // wave K (P9): the row the markers were placed on
      }
    }
    // wave K (knit-store, P9): the part before it in the same piece ends with
    // markers in place (Bernat's neck rows → the yoke rounds)
    if (!out.markers.length && isKnitPart(prt)) {
      var car = null;
      try { car = knitCarriedMarkers(prt); } catch (e3) { car = null; }
      if (car) { out.markers = car.markers; out.source = 'carried'; out.basis = car.total; out.basisRow = 0; out.from = car.from; }
    }
    if (!out.markers.length) return out;
    var total = null;
    try { total = knitInShortRows(prt) ? null : usableCount(targetFor(prt, repeatInfo(prt).patternRow)); } catch (e2) { total = null; }
    out.total = total;
    // markers set on a row of another size: the stitch counts to them are not this row's
    out.shifted = !!(out.basis && total && out.basis !== total);
    // wave K (audit): a lone beginning-of-round marker sits at stitch 0 on
    // every round: there is nothing to vouch for
    if (out.shifted && out.markers.every(function (m) { return m.at === 0; })) out.shifted = false;
    // wave K (P9): ...unless the rows since then can be walked stitch by
    // stitch, moving each marker by the increases on its own side of it
    if (out.shifted && isKnitPart(prt)) {
      var basisRow = out.source === 'pattern' ? (out.basisRow !== undefined ? out.basisRow : null) :
        out.source === 'carried' ? 0 : (prt.markerRow >= 0 ? prt.markerRow : null);
      var mv = null;
      if (basisRow !== null) { try { mv = knitMoveMarkers(prt, out.markers, out.basis, basisRow, repeatInfo(prt).patternRow); } catch (e4) { mv = null; } }
      if (mv && mv.total === total) {
        out.markers = mv.markers;
        out.basis = mv.total;
        out.shifted = false;
        out.moved = true;
      } else {
        out.unplaced = true;
      }
    }
    var pos = out.markers.filter(function (m) { return m.at > 0; }).map(function (m) { return m.at; });
    var uniq = [];
    pos.forEach(function (a) { if (uniq.indexOf(a) < 0) uniq.push(a); });
    var s = out.stitch;
    if (!out.shifted) {
      for (var i = 0; i < out.markers.length; i++) {
        var m = out.markers[i];
        if (m.at > 0 && m.at === s && !out.atMarker) out.atMarker = m;
        if (m.at > s) { out.next = { marker: m, end: false, in: m.at - s }; break; }
      }
      if (!out.next && total && s < total && uniq.length) out.next = { marker: null, end: true, in: total - s };
      var lastAt = uniq.length ? uniq[uniq.length - 1] : 0;
      var closes = total || out.basis;
      if (uniq.length && (!closes || closes > lastAt)) {
        var segs = [], prev = 0;
        uniq.forEach(function (a) { segs.push(a - prev); prev = a; });
        segs.push(closes ? closes - prev : null);
        out.segments = segs;
        var idx = 0;
        for (var k = 0; k < uniq.length; k++) if (s >= uniq[k]) idx = k + 1;
        out.segIndex = idx;
        // wave K (P9): marked stitches ("● raglan st"): the plain stitches
        // between them, each marked stitch counted on its own
        var kinds = uniq.map(function (a) { return out.markers.some(function (m) { return m.at === a && m.kind === 'stitch'; }); });
        if (kinds.some(Boolean)) {
          out.marked = true;
          out.plain = segs.map(function (n, j) { return n === null ? null : n - (j > 0 && kinds[j - 1] ? 1 : 0); });
        }
      }
    }
    return out;
  }

  function writeMarkers(proj, prt, list, total) {
    prt.markers = normalizeMarkers(list);
    if (!prt.markers.length) { prt.markerTotal = null; delete prt.markerRow; }
    else if (total !== undefined) {
      prt.markerTotal = usableCount(total);
      // wave K (P9): the row the positions count in (the row being worked)
      if (isKnitPart(prt)) prt.markerRow = repeatInfo(prt).patternRow;
    }
  }

  /* ---- wave K (knit-store, P9): markers that move ---------------------- *
   * From the row the markers were placed on to the row being worked, each
   * row's own expansion (`Knits.expand`) is walked stitch by stitch: what it
   * takes from the row below and what it makes. A marker sits between two
   * old stitches; an increase made right at it goes to the side the row's
   * words put it ("M1. SM." → before the marker, "SM. M1." → after). When
   * the words do not say (or do not match the expansion) the walk gives up
   * and the strip keeps its honest "markers set on a 38-st row" (E5: wrong
   * numbers are worse than none). */

  var KNIT_SITES = { m1: [0, 1], m1l: [0, 1], m1r: [0, 1], m1p: [0, 1], yo: [0, 1], co: [0, 1],
    kfb: [1, 2], pfb: [1, 2], k2tog: [2, 1], p2tog: [2, 1], ssk: [2, 1], ssp: [2, 1], skp: [2, 1],
    k3tog: [3, 1], p3tog: [3, 1], sk2p: [3, 1], cdd: [3, 1], sssk: [3, 1], bo: [1, 0] };

  function knitSiteOf(rec) {
    var t = rec && rec.t ? String(rec.t).toLowerCase() : '';
    return KNIT_SITES[t] || [1, 1];
  }

  /**
   * The row's words as SM / INC tokens with the star blocks worked out:
   * [{sm: [{before, after}]}] in the order the markers are met, or null.
   */
  function knitSmFlags(text) {
    var t = str(text, '').replace(/^\s*[^:]{0,40}:\s*/, '');
    t = t.replace(/\(\s*(?:rs|ws)\s*\)\.?/ig, ' ')
      // the stars a "Rep from * to **" sentence names are words, not marks
      .replace(/\bfrom\s*\*\s*to\s*\*\*/gi, 'from STAR to STARS').replace(/\bfrom\s*\*/gi, 'from STAR')
      .replace(/\*\*/g, ' \u0002 ').replace(/\*/g, ' \u0001 ');
    var raw = t.split(/[.,;]|(?=\u0001)|(?=\u0002)|(?:\u0001)|(?:\u0002)/);
    // re-split keeping the star marks as their own tokens
    var toks = [];
    t.split(/(\u0001|\u0002)/).forEach(function (chunk) {
      if (chunk === '\u0001') { toks.push('S'); return; }
      if (chunk === '\u0002') { toks.push('E'); return; }
      chunk.split(/[.,;]/).forEach(function (s) {
        s = s.trim();
        if (!s) return;
        if (/^(?:sm|slip\s+marker)\b/i.test(s)) toks.push('M');
        else if (/^(?:m1[lr]?p?|kfb|pfb|yo|inc(?:rease)?)\b/i.test(s)) toks.push('I');
        else if (/\b(?:k2tog|ssk|p2tog|ssp|skp|k3tog|sk2p|cdd|sssk|dec(?:rease)?|cast\s+off|bind\s+off)\b/i.test(s)) toks.push('D');
        else if (/^rep(?:eat)?\s+from\s+STAR\b/.test(s.replace(/^(rep(?:eat)?)/i, 'rep'))) toks.push('R:' + s);
        else if (/^then\s+from\s+STAR\s+to\s+STARS\b/i.test(s)) toks.push('T:' + s);
        else if (/^\d+\s*(?:\([^)]*\)\s*)?sts?\b/i.test(s) || /^\(?\d+\s*(?:\([^)]*\))?\s*sts?\)?$/i.test(s)) return;
        else toks.push('O');
      });
    });
    raw = null;
    function times(w) {
      w = String(w || '').toLowerCase().trim();
      if (w === 'once') return 1;
      if (w === 'twice') return 2;
      if (w === 'three times' || w === 'thrice') return 3;
      var m = /^(\d{1,2})\s+times?$/.exec(w);
      return m ? +m[1] : null;
    }
    var seq = [], i = 0, A = null, B = null, inA = false, inB = false, lastA = null;
    for (i = 0; i < toks.length; i++) {
      var k = toks[i];
      if (k.indexOf('T:') === 0) {
        var mt = /to\s+STARS\s+(once|twice|three\s+times|\d{1,2}\s+times?)/i.exec(k);
        var nt = mt ? times(mt[1]) : null;
        if (!lastA || nt === null) return null;
        for (var qt = 0; qt < nt; qt++) seq = seq.concat(lastA);
        continue;
      }
      if (k.indexOf('R:') === 0 && A) lastA = A;
      if (k === 'S') { if (A) return null; A = []; inA = true; continue; }
      if (k === 'E') { if (!inA) return null; inA = false; inB = true; B = []; continue; }
      if (k.indexOf('R:') === 0) {
        var s2 = k.slice(2);
        var m1 = /rep(?:eat)?\s+from\s+STAR\s+to\s+STARS\s+(once|twice|three\s+times|\d{1,2}\s+times?)(?:\s+more)?/i.exec(s2);
        var m2 = /rep(?:eat)?\s+from\s+STAR\s+(once|twice|three\s+times|\d{1,2}\s+times?)\s+more(?:\s*,?\s*then\s+from\s+STAR\s+to\s+STARS\s+(once|twice|\d{1,2}\s+times?))?/i.exec(s2);
        if (!A) return null;
        var unit = A, n = null;
        if (m1) { n = times(m1[1]); }
        else if (m2) {
          n = times(m2[1]);
          unit = A.concat(B || []);
          var then = m2[2] ? times(m2[2]) : 0;
          if (n === null || then === null) return null;
          for (var q = 0; q < n; q++) seq = seq.concat(unit);
          for (q = 0; q < then; q++) seq = seq.concat(A);
          A = null; B = null; inA = false; inB = false;
          continue;
        } else return null;
        if (n === null) return null;
        for (var q2 = 0; q2 < n; q2++) seq = seq.concat(unit);
        A = null; B = null; inA = false; inB = false;
        continue;
      }
      if (inA) { A.push(k); seq.push(k); }
      else { if (inB && B) B.push(k); seq.push(k); }
    }
    // ", then from * to ** once" in its own sentence
    if (inA) return null;
    var flags = [];
    flags.incs = 0;
    flags.decs = 0;
    flags.loose = 0;
    for (i = 0; i < seq.length; i++) {
      if (seq[i] === 'I') {
        flags.incs++;
        if (seq[i - 1] !== 'M' && seq[i + 1] !== 'M') flags.loose++;
      }
      if (seq[i] === 'D') flags.decs++;
      if (seq[i] !== 'M') continue;
      flags.push({ before: seq[i - 1] === 'I', after: seq[i + 1] === 'I' });
    }
    // "M1. SM. M1." cannot tell which marker an increase belongs to: one each side only
    for (i = 1; i < seq.length - 1; i++) if (seq[i] === 'I' && seq[i - 1] === 'M' && seq[i + 1] === 'M') flags.loose++;
    return flags;
  }

  /**
   * Walk rows (basisRow, row] moving `markers` (positions on a `basis`-st row).
   * @returns {{markers:Array, total:number}|null}
   */
  function knitMoveMarkers(prt, markers, basis, basisRow, row) {
    var api = patternsApi(prt);
    if (!(row > basisRow) || row - basisRow > 400) return null;
    var entry = partLines(prt);
    var sig = entry.version + '|' + basisRow + '|' + row + '|' + basis + '|' + markers.map(function (m) { return m.at; }).join(',');
    var hit = knitMarkerCache[prt.id];
    if (hit && hit.sig === sig) return hit.out;
    var res = knitWalkMarkers(prt, api, entry.lines, markers, basis, basisRow, row);
    knitMarkerCache[prt.id] = { sig: sig, out: res };
    return res;
  }
  var knitMarkerCache = Object.create(null);

  function knitWalkMarkers(prt, api, lines, markers, basis, basisRow, row) {
    // The row's WORDS place each increase (the expansion cannot: "Knit to
    // first marker" has no length until the markers are known); the row's
    // printed total must agree with the increases the words name.
    var pos = markers.map(function (m) { return m.at; });
    var total = basis;
    for (var r = basisRow + 1; r <= row; r++) {
      var after = usableCount(targetFor(prt, r));
      var info = lineInfo(prt, r);
      var words = info ? info.shown : null;
      var flags = knitSmFlags(words ? words.text : '');
      if (after === null) {
        // no total for the row: only a row whose words shape nothing keeps them
        if (flags && !flags.incs && !flags.decs) continue;
        return null;
      }
      var delta = after - total;
      if (delta === 0 && !(flags && (flags.incs || flags.decs))) continue;
      var inner = [];
      pos.forEach(function (p, ix) { if (p > 0 && p < total) inner.push(ix); });
      // marked raglan stitches: "inc 1 st at each side of marked sts" makes
      // two per marked stitch, one before it and one after
      var allMarked = inner.length && inner.every(function (ix) { return markers[ix].kind === 'stitch'; });
      if (allMarked && delta === 2 * inner.length && flags && !flags.decs && !flags.length) {
        var order0 = inner.slice().sort(function (a, b) { return pos[a] - pos[b]; });
        var nx = pos.slice();
        order0.forEach(function (ix, j) { nx[ix] = pos[ix] + 2 * j + 1; });
        pos = nx;
        total = after;
        continue;
      }
      // every increase must sit beside a marker, and they must make the row's total
      if (!flags || flags.decs || flags.loose || flags.incs !== delta || flags.length !== inner.length) return null;
      var side = null;
      try { side = patternSideAt(prt, r, projectOfPart(prt)); } catch (e2) { side = null; }
      var ws = !!(side && side.side === 'ws');
      var at = pos.map(function (p) { return ws ? total - p : p; });
      // the markers in the order the row meets them
      var meet = inner.slice().sort(function (a, b) { return at[a] - at[b]; });
      var next = pos.slice(), cum = 0;
      for (var i = 0; i < meet.length; i++) {
        var f = flags[i];
        if (f.before) cum++;
        var na = at[meet[i]] + cum;
        next[meet[i]] = ws ? after - na : na;
        if (f.after) cum++;
      }
      pos = next;
      total = after;
    }
    return {
      markers: markers.map(function (m, i) { var o = {}; for (var k in m) o[k] = m[k]; o.at = m.at === 0 && isBorName(m.name) ? 0 : pos[i]; return o; }),
      total: total
    };
  }

  /** The markers the part before it (same piece) ends with, when this part starts on its stitches. */
  function knitCarriedMarkers(prt) {
    var proj = projectOfPart(prt);
    var pp = knitPrevPart(prt, proj);
    if (!pp || !isKnitPart(pp) || knitCarryBusy) return null;
    var first = setupLine(prt);
    var startCount = first ? usableCount(countOf(first)) : null;
    if (!startCount) return null;
    var end = usableCount(pp.targetRows) || usableCount(patternSummary(pp).maxRow);
    if (!end) return null;
    knitCarryBusy = true;
    try {
      var fake = {};
      for (var k in pp) fake[k] = pp[k];
      fake.row = end - 1;
      fake.stitch = 0;
      fake.shortRows = null;
      var mi = markerInfo(fake);
      if (!mi.markers.length || mi.shifted || mi.unplaced) return null;
      var tot = mi.total || mi.basis;
      if (tot !== startCount) return null;
      return { markers: mi.markers.map(function (m) { return { id: 'carried:' + m.id, name: m.name, at: m.at, kind: m.kind }; }), total: tot, from: pp.name };
    } finally { knitCarryBusy = false; }
  }
  var knitCarryBusy = false;

  /** The markers the strip shows, as a list the part can own (pattern ones copied). */
  function ownedMarkers(prt) {
    var info = markerInfo(prt);
    return {
      list: info.markers.map(function (m) { return { id: info.source === 'part' ? m.id : uid(), name: m.name, at: m.at }; }),
      total: info.source === 'part' ? usableCount(prt.markerTotal) : info.basis
    };
  }

  /** Place a marker at the current stitch (or `opts.at`). */
  function addMarker(projectId, partId, opts) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt) return null;
    opts = opts || {};
    var cur = ownedMarkers(prt);
    if (cur.list.length >= KNIT_MARKERS_MAX) return null;
    var at = opts.at !== undefined ? clampInt(opts.at, 0, 99999, prt.stitch) : prt.stitch;
    var name = str(opts.name, '').replace(/\s+/g, ' ').trim().slice(0, KNIT_MARKER_NAME_MAX);
    if (isBorName(name) && cur.list.some(function (m) { return isBorName(m.name); })) return null;
    snapshot(proj);
    var m = { id: uid(), name: name, at: isBorName(name) ? 0 : at };
    cur.list.push(m);
    var target = usableCount(currentTarget(prt));
    writeMarkers(proj, prt, cur.list, cur.list.length === 1 ? target : (cur.total || target));
    touch(proj);
    return part(proj, partId).markers.filter(function (x) { return x.id === m.id; })[0] || null;
  }

  function renameMarker(projectId, partId, markerId, name) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt) return null;
    var cur = ownedMarkers(prt);
    var info = markerInfo(prt);
    var idx = -1;
    for (var i = 0; i < info.markers.length; i++) if (info.markers[i].id === markerId) idx = i;
    if (idx < 0) return null;
    var nm = str(name, '').replace(/\s+/g, ' ').trim().slice(0, KNIT_MARKER_NAME_MAX);
    if (isBorName(nm) && cur.list.some(function (m, j) { return j !== idx && isBorName(m.name); })) return null;
    snapshot(proj);
    cur.list[idx].name = nm;
    if (isBorName(nm)) cur.list[idx].at = 0;
    var keepId = cur.list[idx].id;
    writeMarkers(proj, prt, cur.list, cur.total);
    touch(proj);
    return prt.markers.filter(function (x) { return x.id === keepId; })[0] || null;
  }

  function removeMarker(projectId, partId, markerId) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt) return false;
    var cur = ownedMarkers(prt);
    var info = markerInfo(prt);
    var idx = -1;
    for (var i = 0; i < info.markers.length; i++) if (info.markers[i].id === markerId) idx = i;
    if (idx < 0) return false;
    snapshot(proj);
    cur.list.splice(idx, 1);
    writeMarkers(proj, prt, cur.list, cur.total);
    touch(proj);
    return true;
  }

  /** Replace the part's markers (`[]` clears them: the pattern's show again). */
  function setMarkers(projectId, partId, list, total) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt) return null;
    snapshot(proj);
    writeMarkers(proj, prt, Array.isArray(list) ? list : [], total === undefined ? usableCount(currentTarget(prt)) : total);
    touch(proj);
    return prt.markers;
  }

  /* ---- cables ---------------------------------------------------------- */

  // C6F, C4B, T3R, T2L, C2R... and the slash family: 1/1 RC, 2/2 LC, 2/1 RPC
  var CABLE_TOKEN_RE = /(?:^|[^A-Za-z0-9])(?:[CT]\d{1,2}(?:[FB]|[LR]P?)|\d\/\d(?:\/\d)?\s*[LR]P?[CT])(?![A-Za-z0-9])/i;

  function isCableLine(l) {
    if (!l) return false;
    if (CABLE_TOKEN_RE.test(str(l.text, ''))) return true;
    return Array.isArray(l.stitches) && l.stitches.some(function (s) { return s && s.t === 'cable'; });
  }

  /**
   * "Cable in 3": the rows until the next crossing, read by walking the rows
   * ahead through the part's repeat and the pattern's own repeat sentences,
   * else from a stated cadence (`Line.cable.every`). null when there is none.
   * @returns {{inRows:number, every:number|null, nextRow:number, name:string|null,
   *   source:'pattern'|'stated'}|null}
   */
  var knitCableCache = Object.create(null);

  function cableInfo(prt) {
    if (!prt || !isKnitPart(prt)) return null;
    var entry = partLines(prt);
    if (!entry.lines.length) return null;
    // per tap this is a cache hit: the walk ahead runs once per row
    var key = entry.version + ':' + prt.row + ':' + JSON.stringify(prt.repeat || null);
    var hit = knitCableCache[prt.id];
    if (hit && hit.key === key) return hit.out;
    var out = cableScan(prt, entry.lines);
    knitCableCache[prt.id] = { key: key, out: out };
    return out;
  }

  /**
   * wave H (knit-qa-2): the crossing rows of one panel definition, read once
   * per definition text: `{rows: N, cross: [{row, name}]}` or null. The
   * panel's rows are expanded by the knitting reader, so "7th to 12th rows:
   * As 1st to 6th rows" crosses where the 1st-6th do.
   */
  var panelCrossCache = Object.create(null);

  function panelCrossRows(api, def) {
    if (!def || !def.text || !api || typeof api.parse !== 'function' || typeof api.expand !== 'function') return null;
    var key = String(api.version || '') + '\u0001' + def.text;
    if (panelCrossCache[key] !== undefined) return panelCrossCache[key];
    var out = null;
    try {
      var pl = api.parse(String(def.text));
      var n = 0, m = /\bthese\s+(\d{1,3})\s+rows\b/i.exec(def.text);
      if (m) n = +m[1];
      if (!n) pl.forEach(function (l) { var e = l && l.rowEnd >= l.row ? l.rowEnd : (l && l.row); if (e > n && e < 200) n = e; });
      if (n >= 2 && n <= 120) {
        var cross = [];
        for (var r = 1; r <= n; r++) {
          var ex = null;
          try { ex = api.expand(pl, r, def.width >= 1 ? def.width : null, null); } catch (e) { ex = null; }
          var cab = ex && Array.isArray(ex.stitches) ? ex.stitches.filter(function (s) { return s && s.t === 'cable'; }) : [];
          if (cab.length) cross.push({ row: r, name: cab[0].name ? String(cab[0].name) : null });
        }
        out = { rows: n, cross: cross };
      }
    } catch (e) { out = null; }
    panelCrossCache[key] = out;
    return out;
  }

  /**
   * wave H (knit-qa-2): one panel row in the panel's own words ("C6F. K3."),
   * following "As 1st row" / "7th to 12th rows: As 1st to 6th rows" back to
   * the row it repeats. null when the definition does not say.
   */
  function panelRowText(api, def, row) {
    if (!def || !def.text || !api || typeof api.parse !== 'function' || typeof api.lineFor !== 'function') return null;
    try {
      var pl = api.parse(String(def.text));
      var r = row, seen = 0, l = null;
      while (seen++ < 6) {
        l = api.lineFor(pl, r);
        if (!l) return null;
        var t = str(l.text, '').replace(/^\s*[^:]{0,40}:\s*/, '').replace(/\s*\(\s*(?:rs|ws)\s*\)\s*\.?\s*/i, ' ').trim();
        var as = /^as\s+(\d+)(?:st|nd|rd|th)\s+(?:to\s+(\d+)(?:st|nd|rd|th)\s+)?rows?\b/i.exec(t);
        if (!as) return t || null;
        var from = +as[1];
        r = as[2] && l.row >= 1 ? from + (r - l.row) : from;
      }
    } catch (e) { return null; }
    return null;
  }

  /** "cable in 2" from the panels the working row works, or null. */
  function panelCableRing(prt, lines, W) {
    var defs = lines && lines.panelDefs;
    if (!defs || typeof defs !== 'object') return null;
    var PWc = patternRowOf(prt, W);
    var ul = underlyingLine(prt, PWc);
    var ch = ul && ul.chart;
    var list = ch ? [ch].concat(Array.isArray(ch.also) ? ch.also : []) : null;
    // wave K (P3): a "cont in pat" row works the panels placed before it
    if (!list) {
      var run = knitPanelsAt(prt, PWc, lineForRow(prt, PWc));
      if (run) list = run.filter(function (p) { return p.row; }).map(function (p) { return { name: p.name, row: p.row }; });
    }
    if (!list || !list.length) return null;
    var api = patternsApi(prt);
    var best = null;
    list.forEach(function (c) {
      if (!c || !(c.row >= 1)) return;
      var def = defs[str(c.name, '').toLowerCase().trim()];
      var pc = panelCrossRows(api, def);
      if (!pc || !pc.cross.length) return;
      for (var d = 0; d < pc.rows; d++) {
        var q = ((c.row - 1 + d) % pc.rows) + 1;
        var hit = null;
        for (var k = 0; k < pc.cross.length; k++) if (pc.cross[k].row === q) { hit = pc.cross[k]; break; }
        if (hit) {
          if (!best || d < best.inRows) best = { inRows: d, every: null, nextRow: W + d, name: hit.name, source: 'panel', panel: str(c.name, '') };
          break;
        }
      }
    });
    return best;
  }

  function cableScan(prt, lines) {
    var stated = null, any = false;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l && l.cable && l.cable.every >= 2 && (!stated || (l.row || 0) <= prt.row + 1)) stated = l;
      if (!any && isCableLine(l)) any = true;
    }
    if (!any && !stated) return lines.panelDefs ? panelCableRing(prt, lines, prt.row + 1) : null;
    var W = prt.row + 1;
    // wave K (audit): rows working written panels cross where the PANELS do
    // (inside a stretch the walk below re-read one placing row and rang
    // "cable in 1" on every row)
    if (lines.panelDefs) {
      var pan0 = panelCableRing(prt, lines, W);
      if (pan0) return pan0;
    }
    var hits = [];
    if (any) {
      for (var d = 0; d < KNIT_LOOKAHEAD && hits.length < 2; d++) {
        var pr = patternRowOf(prt, W + d);
        var ul = underlyingLine(prt, pr);
        if (!ul) { if (d > 0 && !hasRepeatLine(lines)) break; continue; }
        if (isCableLine(ul)) hits.push(d);
      }
    }
    var name = stated && stated.cable.name ? str(stated.cable.name, '') : null;
    // wave H (knit-qa-2): a row that works PANELS ("Work 1st row of Panel
    // Pat C … Panel Pat B … Panel Pat A") crosses where the panels' own rows
    // do. The part's numbered rows are only the set-up rows (the rest is
    // "cont in pat until …"), so the walk above finds nothing; the panels'
    // definitions (`lines.panelDefs`) say "C6F on 3rd row, C6B on 9th".
    if (!hits.length && !stated) {
      var pan = panelCableRing(prt, lines, W);
      if (pan) return pan;
    }
    if (hits.length) {
      var every = hits.length >= 2 ? hits[1] - hits[0] : (stated ? Math.floor(stated.cable.every) : null);
      return { inRows: hits[0], every: every, nextRow: W + hits[0], name: name, source: 'pattern' };
    }
    if (stated) {
      // "cross the cable every 8th row", counted from the line that says so
      var ev = Math.floor(stated.cable.every);
      var anchor = stated.row >= 1 ? stated.row : null;
      if (!anchor || W < anchor) return { inRows: anchor ? anchor - W : null, every: ev, nextRow: anchor, name: name, source: 'stated' };
      var k = (ev - ((W - anchor) % ev)) % ev;
      return { inRows: k, every: ev, nextRow: W + k, name: name, source: 'stated' };
    }
    return null;
  }

  /* ---- "until it measures 32 cm" --------------------------------------- */

  var FROM_START_RE = /\bfrom\s+(?:the\s+)?(?:cast[\s-]*on(?:\s+edge)?|co\b|beg(?:inning)?\b\.?|start\b|lower\s+edge|bottom\s+edge|hem\b)/i;
  var FROM_ANY_RE = /\bfrom\s+(?:the\s+)?[a-z]/i;

  function untilOf(l) {
    var u = l && l.until && typeof l.until === 'object' ? l.until : null;
    if (!u || !(u.value > 0)) return null;
    return u;
  }

  /**
   * The length a part is being worked to, as rows: "32 cm ≈ 118 rows, not
   * 110" - through the measured row gauge, else the pattern's. Never a hard
   * target: `targetRow` is the row it comes to (≈), `fromRow` the row the
   * length is measured from (0 = the start of the part).
   */
  function untilInfo(prt, rowNumber) {
    if (!prt) return null;
    var lines = linesFor(prt);
    if (!lines.length) return null;
    var W = typeof rowNumber === 'number' ? rowNumber : prt.row + 1;
    var PW = patternRowOf(prt, W);
    var own = null, fromRow = null, i, l;
    var at = lineForRow(prt, PW);
    if (at && untilOf(at)) {
      own = at;
      if (at.row >= 1) {
        fromRow = at.row - 1;
      } else {
        // a "work even until..." sentence: it starts after the rows written before it
        var before = 0, ix = lines.indexOf(at);
        for (i = 0; i < ix; i++) {
          l = lines[i];
          if (isRowLine(l) && l.kind !== 'repeat') before = Math.max(before, l.rowEnd >= l.row ? l.rowEnd : l.row);
          // "Rep Rows 1-8 4 more times" wrote rows 9-40
          if (l && l.repeatTo >= 1 && !untilOf(l)) before = Math.max(before, l.repeatTo);
        }
        fromRow = before || (at.repeatFrom >= 1 ? at.repeatFrom - 1 : null);
      }
    } else if (!at || at.approxRow) {
      // an unnumbered "work even until..." after the last written row before
      // this one (rows numbered after it are only ≈, so it may still own them)
      var prevEnd = 0, cand = null, candFrom = 0;
      for (i = 0; i < lines.length; i++) {
        l = lines[i];
        if (isRowLine(l) && l.kind !== 'repeat') {
          if (l.row >= PW) break;
          prevEnd = Math.max(prevEnd, l.rowEnd >= l.row ? l.rowEnd : l.row);
          if (!l.approxRow) cand = null;
          continue;
        }
        if (untilOf(l)) { cand = l; candFrom = prevEnd; continue; }
        if (l && l.repeatTo >= 1) {
          if (l.repeatFrom >= PW) break;
          prevEnd = Math.max(prevEnd, l.repeatTo);
        }
      }
      if (cand) { own = cand; fromRow = candFrom; }
    }
    if (!own) return null;
    var u = untilOf(own);
    var text = str(own.text, '');
    // "until piece measures 32 cm" is the whole piece; "... from underarm"
    // is measured from where this stretch began; "from cast-on" the start
    var mIdx = text.search(/\bmeasures?\b|\blength\b/i);
    var tail = mIdx >= 0 ? text.slice(mIdx) : text;
    // wave H (knit-qa): "for a further 2"" and "until ribbing measures 2""
    // are measured from where THIS stretch began, not from the cast-on (the
    // Bernat body's 2" of rib said "≈ row 9" when it starts at round 2)
    var stretchOnly = !!u.relative || /\b(?:a\s+)?further\b/i.test(text) ||
      /\b(?:rib(?:bing)?|border|band|hem|cuff|edging|garter\s+(?:st(?:itch)?\s+)?(?:section|border))\s+measures?\b/i.test(text);
    if (!(stretchOnly && fromRow !== null) && (FROM_START_RE.test(tail) || !FROM_ANY_RE.test(tail))) fromRow = 0;
    var out = {
      kind: u.kind === 'rows' ? 'rows' : 'length', value: u.value, unit: u.unit || null,
      endOn: normalizeKnitSide(u.endOn), line: own, fromRow: fromRow,
      rows: null, patternRows: null, gaugeSource: null, targetRow: null, approx: true
    };
    if (out.kind === 'rows') {
      out.rows = Math.round(u.value);
      out.approx = false;
    } else {
      var proj = projectOfPart(prt);
      var g = gaugeOf(proj);
      out.patternRows = lengthToRows(g, u.value, u.unit, 'pattern');
      var mineRows = lengthToRows(g, u.value, u.unit, 'swatch');
      out.rows = mineRows || out.patternRows;
      out.gaugeSource = mineRows ? 'swatch' : out.patternRows ? 'pattern' : null;
    }
    if (out.rows && fromRow !== null) {
      var t = fromRow + out.rows;
      if (out.endOn && t >= 1) {
        var s = patternSideAt(prt, t);
        if (s.side && s.side !== out.endOn) t += 1;
      }
      out.targetRow = t;
    }
    return out;
  }

  /* ---- glossary -------------------------------------------------------- */

  // [abbr, meaning, regex source that finds it in a pattern]. The profile
  // table (contract §2 vocabulary), for when Knits.glossary is not loaded.
  var KNIT_GLOSSARY = [
    ['k', 'knit', '\\bk\\d*\\b'],
    ['p', 'purl', '\\bp\\d*\\b'],
    ['st(s)', 'stitch(es)', '\\bsts?\\b'],
    ['RS', 'right side (the side that shows)', '\\bRS\\b'],
    ['WS', 'wrong side', '\\bWS\\b'],
    ['rnd(s)', 'round(s) - worked in the round, no turning', '\\brnds?\\b'],
    ['CO', 'cast on', '\\bCO\\b|\\bcast\\s+on\\b'],
    ['BO', 'bind off (UK: cast off)', '\\bBO\\b|\\bbind\\s+off\\b'],
    ['yo', 'yarn over: wrap the yarn over the needle, makes a stitch and a hole', '\\byo\\b'],
    ['k2tog', 'knit 2 together (right-leaning decrease)', '\\bk2\\s*tog\\b'],
    ['p2tog', 'purl 2 together', '\\bp2\\s*tog\\b'],
    ['k3tog', 'knit 3 together (double decrease)', '\\bk3\\s*tog\\b'],
    ['ssk', 'slip, slip, knit: slip 2 knitwise one at a time, knit them together (left-leaning decrease)', '\\bssk\\b'],
    ['ssp', 'slip, slip, purl (left-leaning decrease on the WS)', '\\bssp\\b'],
    ['sssk', 'slip 3 knitwise one at a time, knit them together', '\\bsssk\\b'],
    ['skp', 'slip 1, knit 1, pass the slipped stitch over', '\\bskp\\b'],
    ['sk2p', 'slip 1, k2tog, pass the slipped stitch over (double decrease)', '\\bsk2p\\b'],
    ['cdd', 'centred double decrease: slip 2 together knitwise, k1, pass the 2 slipped sts over', '\\bcdd\\b|\\bs2kp2?\\b'],
    ['psso', 'pass the slipped stitch over', '\\bp2?sso\\b'],
    ['m1', 'make 1: lift the bar between stitches and knit it', '\\bm1\\b'],
    ['m1L', 'make 1 left-leaning: lift the bar from the front, knit it through the back loop', '\\bm1\\s*l\\b'],
    ['m1R', 'make 1 right-leaning: lift the bar from the back, knit it through the front loop', '\\bm1\\s*r\\b'],
    ['m1p', 'make 1 purlwise', '\\bm1\\s*p\\b'],
    ['kfb', 'knit into the front and back of the same stitch (1 st becomes 2)', '\\bk1?fb\\b'],
    ['pfb', 'purl into the front and back of the same stitch', '\\bp1?fb\\b'],
    ['sl', 'slip a stitch from the left needle to the right without working it', '\\bsl\\d*\\b'],
    ['wyif / wyib', 'with yarn in front / with yarn in back', '\\bwy[if]b?\\b|\\bwyi[fb]\\b'],
    ['tbl', 'through the back loop', '\\btbl\\b'],
    ['pm', 'place marker', '\\bpm\\b'],
    ['sm', 'slip marker', '\\bsm\\b'],
    ['rm', 'remove marker', '\\brm\\b'],
    ['BOR', 'beginning of round (its marker)', '\\bBOR\\b|\\bbeg(?:inning)?\\s+of\\s+(?:the\\s+)?r(?:ou)?nd\\b'],
    ['w&t', 'wrap and turn: a short row - wrap the next stitch, turn the work', 'w\\s*&\\s*t\\b|\\bwrap\\s+and\\s+turn\\b'],
    ['turn', 'turn the work before the end of the row (a short row)', '\\bturn\\b'],
    ['GSR / DS', 'German short row / double stitch', '\\bGSR\\b|\\bDS\\b'],
    ['C4F / C6F', 'cable front: slip half the sts to a cable needle held in front, knit the rest, knit those from the cable needle (crosses to the left)', '\\bC\\d{1,2}F\\b'],
    ['C4B / C6B', 'cable back: the same with the cable needle held at the back (crosses to the right)', '\\bC\\d{1,2}B\\b'],
    ['T3R / T3L', 'twist: a cable crossing knit over purl, to the right / left', '\\bT\\d{1,2}[LR]\\b'],
    ['1/1 RC / LC', 'right / left cross (cable notation: sts held / sts crossed)', '\\b\\d\\/\\d\\s*[LR]P?C\\b'],
    ['cn', 'cable needle', '\\bcn\\b'],
    ['St st', 'stockinette (stocking) stitch: knit RS rows, purl WS rows; knit every round in the round', '\\bst(?:ocking|ockinette)?\\.?\\s*st(?:itch)?\\b'],
    ['garter st', 'knit every row (purl alternate rounds in the round)', '\\bgarter\\b'],
    ['rib', 'ribbing, e.g. k2, p2 rib: knit the knits and purl the purls', '\\brib(?:bing)?\\b'],
    ['patt', 'pattern', '\\bpatt?\\b'],
    ['rep', 'repeat', '\\brep\\b'],
    ['beg', 'beginning', '\\bbeg\\b'],
    ['rem', 'remain(ing)', '\\brem\\b'],
    ['inc', 'increase(d)', '\\binc\\b'],
    ['dec', 'decrease(d)', '\\bdec\\b'],
    ['tog', 'together', '\\btog\\b'],
    ['foll', 'following', '\\bfoll\\b'],
    ['cont', 'continue', '\\bcont\\b'],
    ['LH / RH', 'left-hand / right-hand needle', '\\b[LR]H\\b'],
    ['dpn', 'double-pointed needle', '\\bdpns?\\b'],
    ['MC / CC', 'main colour / contrast colour', '\\b[MC]C\\d?\\b']
  ];

  /** The pattern text of a project or part, for the glossary. */
  function glossaryText(projOrPart) {
    if (!projOrPart) return '';
    if (typeof projOrPart === 'string') return projOrPart;
    if (Array.isArray(projOrPart.parts)) {
      var bits = projOrPart.parts.map(function (p) { return str(p.patternText, ''); });
      bits.push(str(projOrPart.notes, ''));
      // wave H (knit-qa-2): the pattern's abbreviation block, kept at import
      var cd = projOrPart.craftData;
      if (cd && typeof cd.abbreviations === 'string') bits.unshift('ABBREVIATIONS\n' + cd.abbreviations);
      return bits.join('\n');
    }
    var pp = projectOfPart(projOrPart);
    var pcd = pp && pp.craftData;
    if (pcd && typeof pcd.abbreviations === 'string') return 'ABBREVIATIONS\n' + pcd.abbreviations + '\n' + str(projOrPart.patternText, '');
    return str(projOrPart.patternText, '');
  }

  /**
   * [{abbr, meaning, fromPattern, used}] - `Knits.glossary` when it is
   * loaded (the pattern's own abbreviation block + its profile table), else
   * the table above. `used` = the abbreviation appears in this pattern.
   */
  function glossaryFor(projOrPart) {
    var text = glossaryText(projOrPart);
    var list = null;
    var api = null;
    try { api = parserFor(projOrPart && typeof projOrPart === 'object' ? projOrPart : KNIT_CRAFT); } catch (e) { api = null; }
    if (api && typeof api.glossary === 'function') {
      try {
        var got = api.glossary(text);
        if (Array.isArray(got)) {
          list = got.filter(function (g) { return g && str(g.abbr, '').trim() && str(g.meaning, '').trim(); })
            .map(function (g) {
              return { abbr: str(g.abbr, '').trim(), meaning: str(g.meaning, '').trim(), fromPattern: !!g.fromPattern, used: !!g.fromPattern };
            });
        }
      } catch (e2) { list = null; }
    }
    var table = KNIT_GLOSSARY.map(function (row) {
      var used = false;
      try { used = !!text && new RegExp(row[2], 'i').test(text); } catch (e3) { used = false; }
      return { abbr: row[0], meaning: row[1], fromPattern: false, used: used };
    });
    if (!list) return table;
    // a parser's entry that the table also has: mark it used when the text has it
    list.forEach(function (g) {
      if (g.used) return;
      var key = g.abbr.toLowerCase();
      table.forEach(function (t) { if (t.used && t.abbr.toLowerCase().split(/\s*\/\s*/).indexOf(key) >= 0) g.used = true; });
    });
    return list;
  }

  /* ---- charts ---------------------------------------------------------- */

  function chartKey(name) {
    // "Chart A" = "A", "Henley chart" = "Henley"
    return str(name, '').toLowerCase().replace(/\bcharts?\b/g, '').replace(/[^a-z0-9]+/g, '');
  }

  /**
   * `Project.craftData.chartPages` (defined here, filled by the importer):
   * [{ page, name, key?, chart? }] - the PDF page a chart is printed on, its
   * name as the pattern calls it ("Chart A"), the BlobStore key of the page
   * image (default 'p:<projectId>:chartpage:<page>') and, when
   * `KnitChart.fromHandle` read it, the chart itself.
   */
  function chartPagesOf(proj) {
    var cd = proj && proj.craftData && typeof proj.craftData === 'object' ? proj.craftData : null;
    var raw = cd && Array.isArray(cd.chartPages) ? cd.chartPages : [];
    // `craftData.charts` (contract change from knit-chart): the charts
    // KnitChart read at import time, [{page, name, rows, cols, cells|null,
    // legend, repeatBox, ...}], so the counter never opens the PDF again
    var read = cd && Array.isArray(cd.charts) ? cd.charts.filter(function (c) { return c && typeof c === 'object'; }) : [];
    function readFor(page, name) {
      var k = chartKey(name), byPage = null;
      for (var i = 0; i < read.length; i++) {
        if (clampInt(read[i].page, 0, 9999, 0) !== page) continue;
        if (!k || chartKey(read[i].name) === k) return read[i];
        if (!byPage) byPage = read[i];
      }
      return byPage;
    }
    var out = [];
    raw.forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var page = clampInt(c.page, 1, 9999, 0);
      if (!page) return;
      var name = str(c.name, '').trim();
      out.push({
        page: page,
        name: name,
        key: str(c.key, '').trim() || ('p:' + proj.id + ':chartpage:' + page),
        scale: c.scale > 0 ? Number(c.scale) : null,
        chart: c.chart && typeof c.chart === 'object' ? c.chart : readFor(page, name)
      });
    });
    // a chart that was read but whose page image was not kept still counts
    read.forEach(function (c) {
      var page = clampInt(c.page, 1, 9999, 0);
      if (!page || out.some(function (o) { return o.chart === c; })) return;
      out.push({ page: page, name: str(c.name, '').trim(), key: null, chart: c, noImage: true });
    });
    return out;
  }

  /**
   * "Chart row 7 of 16" for the row being worked: the chart the line names
   * (`Line.chart`), the page it is printed on, and the row written out when
   * the chart was read (`KnitChart.rowText`).
   */
  /* ---- wave K (knit-store, P3): panels and charts that keep running ----- *
   * A line that places panels ("Work 1st row of Cable Panel C … Panel B …
   * Panel A") sets each panel's ORIGIN: the part row its row 1 is worked on
   * (line row − (panel row − 1)). Every later row of the part that carries
   * the pattern on ("Cont in pat …", "Keeping cont of pat, cast off …", a
   * stretch, a back-reference) works panel row ((row − origin) mod N) + 1,
   * a pure function of the row, so undo and jumps need nothing. N is the
   * panel's own length (its written definition, else a chart of that exact
   * name); unknown N leaves the row unknown, never a number. */

  var KNIT_CONTINUES_RE = /\b(?:pat(?:t|tern)?s?|panels?|charts?|as\s+(?:set|established|placed|before))\b/i;

  function knitContinuesPattern(l) {
    if (!l) return false;
    if (l.stretch || backRefFrom(l) || untilOf(l)) return true;
    return KNIT_CONTINUES_RE.test(str(l.text, ''));
  }

  /** A chart page of exactly this name (no single-page fallback: E3). */
  function knitChartPageNamed(pages, rawName) {
    var KC = window.KnitChart, i, page = null;
    var name = str(rawName, '').trim();
    var key = chartKey(/^[A-Z0-9]{1,3}$/i.test(name) ? 'Chart ' + name : name);
    if (KC && typeof KC.find === 'function') {
      try {
        var hit = KC.find(pages.map(function (pg) { return pg.chart; }).filter(Boolean), name);
        for (i = 0; hit && i < pages.length; i++) if (pages[i].chart === hit) { page = pages[i]; break; }
      } catch (e0) { page = null; }
    }
    for (i = 0; !page && i < pages.length; i++) if (key && chartKey(pages[i].name) === key) page = pages[i];
    for (i = 0; !page && i < pages.length; i++) if (key && pages[i].chart && chartKey(pages[i].chart.name) === key) page = pages[i];
    return page;
  }

  /** How many rows a panel / chart has: its written definition, else its read chart; null = unknown. */
  function knitPanelRows(prt, rawName, pages) {
    var name = str(rawName, '').trim();
    var pdefs = linesFor(prt).panelDefs;
    var pdef = pdefs && typeof pdefs === 'object' ? pdefs[name.toLowerCase()] : null;
    if (pdef) {
      var pc = panelCrossRows(patternsApi(prt), pdef);
      if (pc && pc.rows) return pc.rows;
    }
    var page = knitChartPageNamed(pages || chartPagesOf(projectOfPart(prt)), name);
    var chart = page && page.chart ? page.chart : null;
    if (chart) {
      var nos = Array.isArray(chart.rowNos) ? chart.rowNos.filter(function (n) { return n > 0; }) : [];
      if (nos.length) return Math.max.apply(null, nos);
      if (chart.rows > 0) return Math.floor(chart.rows);
    }
    return null;
  }

  /**
   * The panels running on part row `r` when its own line names none: from the
   * last line at or before `r` that places them. [{name, row, of, origin,
   * continued: true}] (row / of null when the panel's length is unknown), or
   * null when `r`'s line speaks for itself or nothing was placed.
   */
  /**
   * The chart position a line names, or null when its chart mention is no
   * position: an end condition ("ending with chart Rnd 10") or a chart
   * carried on from elsewhere ("Work even through Row 11 of Foot chart").
   */
  function knitChartPos(l) {
    var c = l && l.chart && typeof l.chart === 'object' ? l.chart : null;
    if (!c) return null;
    var t = str(l.text, '');
    if (/\bending\s+(?:with|on|after)\b[^.;]*\b(?:rnd|row|round)\s+\d+/i.test(t) && !(c.rowEnd > 0)) return null;
    if (/\b(?:even|cont(?:inue|inuing)?|keeping)\b[^.;]*\bthrough\s+(?:row|rnd|round)\s+\d+/i.test(t)) return null;
    return c;
  }

  function knitPanelsAt(prt, r, rowLine, pages) {
    if (!(r >= 1) || !rowLine || knitChartPos(rowLine)) return null;
    if (!knitContinuesPattern(rowLine)) return null;
    var lines = linesFor(prt);
    var best = null;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (!l || !l.chart || typeof l.chart !== 'object' || !(l.row >= 1) || l.row > r) continue;
      if (!(l.chart.row >= 1) || l.stretch || !knitChartPos(l)) continue;
      if (!best || l.row >= best.row) best = l;
    }
    if (!best) return null;
    var list = [best.chart].concat(Array.isArray(best.chart.also) ? best.chart.also : []);
    var out = [];
    list.forEach(function (c) {
      if (!c || !(c.row >= 1) || !str(c.name, '').trim()) return;
      var origin = best.row - (Math.floor(c.row) - 1);
      var n = knitPanelRows(prt, c.name, pages);
      var row = n ? ((((r - origin) % n) + n) % n) + 1 : null;
      out.push({ name: str(c.name, '').trim(), row: row, of: n || null, origin: origin, continued: true });
    });
    return out.length ? out : null;
  }

  /** Name, page, chart, length and the row written out, for one panel / chart at chart row `row`. */
  function knitChartMeta(prt, proj, pages, rawName, row) {
    var name = str(rawName, '').trim() || 'Chart';
    if (/^[A-Z0-9]{1,3}$/i.test(name)) name = 'Chart ' + name;
    var page = knitChartPageNamed(pages, rawName);
    var chart = page && page.chart ? page.chart : null;
    var of = null;
    if (chart) {
      var nos = Array.isArray(chart.rowNos) ? chart.rowNos.filter(function (n) { return n > 0; }) : [];
      of = nos.length ? Math.max.apply(null, nos) : (chart.rows > 0 ? Math.floor(chart.rows) : null);
    }
    var pdefs = linesFor(prt).panelDefs;
    var pdef = !chart && pdefs && typeof pdefs === 'object' ? pdefs[str(name, '').toLowerCase().trim()] : null;
    var text = null, textSource = null;
    if (pdef) {
      var pc = panelCrossRows(patternsApi(prt), pdef);
      if (pc && pc.rows) of = pc.rows;
      if (row) { text = panelRowText(patternsApi(prt), pdef, row); if (text) textSource = 'pattern'; }
    }
    var KC = window.KnitChart;
    if (chart && chart.cells && !chart.image && row && KC && typeof KC.rowText === 'function') {
      try {
        var side = sideInfo(prt, proj);
        var sideArg = side.inRound ? null : (side.side || undefined);
        var repeat = chartRepeatFor(chart, proj, prt);
        var t = repeat === null ? KC.rowText(chart, row, sideArg) : KC.rowText(chart, row, sideArg, { repeat: repeat });
        if (typeof t === 'string' && t.trim()) { text = t.trim(); textSource = 'chart'; }
      } catch (e) { /* keep the panel's words */ }
    }
    return { name: name, page: page, chart: chart, of: of, panel: !!pdef, text: text, textSource: textSource };
  }

  function chartInfo(prt) {
    if (!prt || !isKnitPart(prt)) return null;
    var proj = projectOfPart(prt);
    var sr = shortRowInfo(prt);
    // the pattern row being worked, through a back-reference to the row it re-works
    var prow = sr ? (sr.numbered ? sr.patternRow : null) : repeatInfo(prt).patternRow;
    var line = sr ? sr.line : lineForRow(prt, prow);
    // wave K (P3): the panels placed earlier keep running on this row
    if (!sr && prow >= 1) {
      var pagesK = chartPagesOf(proj);
      var running = knitPanelsAt(prt, prow, line, pagesK);
      if (running) {
        var panels = running.map(function (p) {
          var m = knitChartMeta(prt, proj, pagesK, p.name, p.row);
          return { name: m.name, row: p.row, of: p.row ? (p.of || m.of) : (p.of || null), origin: p.origin,
            page: m.page, chart: m.chart, text: p.row ? m.text : null, textSource: p.row ? m.textSource : null,
            panel: m.panel, continued: true };
        });
        var p0 = panels[0];
        return { name: p0.name, row: p0.row, of: p0.of, page: p0.page, chart: p0.chart, text: p0.text,
          textSource: p0.textSource, panel: p0.panel, repeat: null, line: line, continued: true, panels: panels };
      }
    }
    // wave K (audit): a chart named as an END ("ending with chart Rnd 10")
    // or carried on from elsewhere ("Work even through Row 11 of Foot
    // chart") names no position: the chart, its row unknown
    if (line && line.chart && typeof line.chart === 'object' && !knitChartPos(line)) {
      var pagesU = chartPagesOf(proj);
      var nmU = str(line.chart.name, '').trim();
      if (!nmU) return null;
      var mU = knitChartMeta(prt, proj, pagesU, nmU, null);
      return { name: mU.name, row: null, of: knitPanelRows(prt, nmU, pagesU) || mU.of || null, page: mU.page, chart: mU.chart,
        text: null, textSource: null, panel: mU.panel, repeat: null, line: line, unknown: true };
    }
    var from = backRefFrom(line);
    // (only a back-reference whose sentence names the rows it repeats)
    if (from && prow >= from && !(line.stretch && line.stretch.key) && knitRepProven(str(line.text, ''), line.repeatOf, from)) {
      var u = line.repeatOf[(prow - from) % line.repeatOf.length];
      var ul = typeof u === 'number' ? lineForRow(prt, u) : null;
      if (ul && !backRefFrom(ul)) { line = ul; prow = u; }
    }
    var ch = line && line.chart && typeof line.chart === 'object' ? line.chart : null;
    var gapRow = null;
    if (!ch && !sr && prow >= 1) {
      // "Work Rows 1-61 of Lace chart" written as a sentence, not as numbered
      // rows (the Interweave hat): the rows after the last written one are
      // that chart's rows, one for one, as far as the sentence reaches
      var gap = chartGapLine(prt, prow);
      if (gap) { line = gap.line; ch = gap.line.chart; gapRow = gap.row; }
    }
    if (!ch) return null;
    var row = gapRow || clampInt(ch.row, 1, 9999, 0) || null;
    // "Rows 3-16: work rows 3-16 of Chart A": row 7 is chart row 7
    var chEnd = clampInt(ch.rowEnd, 1, 9999, 0) || null;
    if (!gapRow && row && chEnd && chEnd > row && line.row >= 1 && prow > line.row) row = Math.min(chEnd, row + (prow - line.row));
    // wave K (audit): a line covering several rows with ONE chart row named
    // ("Row 15 and all following odd rows", "Rows 38 and 40"): the chart is
    // numbered as the pattern's rows when it names the line's own first row,
    // else the row is not known
    else if (!gapRow && row && !chEnd && line.row >= 1 && prow > line.row &&
             (enumRows(line) || (line.rowEnd > line.row))) {
      row = Math.floor(ch.row) === line.row ? prow : null;
    }
    var name = str(ch.name, '').trim() || 'Chart';
    if (/^[A-Z0-9]{1,3}$/i.test(name)) name = 'Chart ' + name;
    var pages = chartPagesOf(proj);
    var KC = window.KnitChart;
    var key = chartKey(name), page = null, i;
    // KnitChart.find knows "Chart A" = "A" and "Leg chart" = "Leg"
    if (KC && typeof KC.find === 'function') {
      try {
        var hit = KC.find(pages.map(function (pg) { return pg.chart; }).filter(Boolean), str(ch.name, ''));
        for (i = 0; hit && i < pages.length; i++) if (pages[i].chart === hit) { page = pages[i]; break; }
      } catch (e0) { page = null; }
    }
    for (i = 0; !page && i < pages.length; i++) if (chartKey(pages[i].name) === key) page = pages[i];
    // a chart of that name read off the page (the page entry may be unnamed)
    for (i = 0; !page && i < pages.length; i++) if (pages[i].chart && chartKey(pages[i].chart.name) === key) page = pages[i];
    // wave K (P3, E3): no "the only chart found" fallback - it bound every
    // panel name to that chart and printed its length ("of 28" for a 12-row panel)
    var chart = page && page.chart ? page.chart : null;
    var of = null;
    if (chart) {
      // with rowStep 2 only the odd rows are drawn: the last charted row number
      var nos = Array.isArray(chart.rowNos) ? chart.rowNos.filter(function (n) { return n > 0; }) : [];
      of = nos.length ? Math.max.apply(null, nos) : (chart.rows > 0 ? Math.floor(chart.rows) : null);
    }
    // wave H (knit-qa-2): a written-out panel ("Panel Pat C (worked over 9
    // sts): 1st row: … These 12 rows form Panel Pat C") is a chart the
    // pattern spells out: its row count is the panel's, and the row's own
    // words are the "written out" line (the chip said "row 2 of 2")
    var panelText = null;
    var pdefs = linesFor(prt).panelDefs;
    var pdef = !chart && pdefs && typeof pdefs === 'object' ? pdefs[str(name, '').toLowerCase().trim()] : null;
    if (pdef) {
      var pc = panelCrossRows(patternsApi(prt), pdef);
      if (pc && pc.rows) of = pc.rows;
      if (row) panelText = panelRowText(patternsApi(prt), pdef, row);
    }
    if (!of && !/\bpanel\b/i.test(name)) {
      // the highest row of this chart any line names (wave K: never for a
      // panel - its placing rows say nothing about its length)
      // (wave K, audit: only a RANGE says how far a chart goes - "Rows 3-16
      // of Chart A", "Work Rows 1-61" - a single row named says nothing:
      // "ending with chart Rnd 10" made "row 10 of 10")
      linesFor(prt).forEach(function (l) {
        if (!l || !l.chart || chartKey(l.chart.name) !== key || !(l.chart.rowEnd > 0)) return;
        var top = Math.max(l.chart.row || 0, l.chart.rowEnd || 0);
        if (top > (of || 0)) of = Math.floor(top);
      });
    }
    // never a chart row past the chart's last row: that position is unknown
    if (row && of && row > of) row = null;
    if (!row) panelText = null;
    var text = null, repeat = null;
    if (chart && chart.cells && !chart.image && row && KC && typeof KC.rowText === 'function') {
      try {
        // null in the round, 'rs' / 'ws' flat, left out when the side is not known
        var side = sideInfo(prt, proj);
        var sideArg = side.inRound ? null : (side.side || undefined);
        repeat = chartRepeatFor(chart, proj, prt);
        var t = repeat === null ? KC.rowText(chart, row, sideArg) : KC.rowText(chart, row, sideArg, { repeat: repeat });
        if (typeof t === 'string' && t.trim()) text = t.trim();
      } catch (e) { text = null; }
    }
    var textSource = text ? 'chart' : null;
    if (!text && panelText) { text = panelText; textSource = 'pattern'; }
    var outInfo = { name: name, row: row, of: of, page: page, chart: chart, text: text, textSource: textSource,
      panel: !!pdef, repeat: repeat, line: line };
    // wave K (P3): a row that places several panels lists every one of them
    if (Array.isArray(ch.also) && ch.also.length) {
      var shift = row && ch.row >= 1 ? row - Math.floor(ch.row) : 0;
      outInfo.panels = [{ name: name, row: row, of: of, page: page, chart: chart, text: text, textSource: textSource, panel: !!pdef }];
      ch.also.forEach(function (c) {
        if (!c || !str(c.name, '').trim()) return;
        var r2 = c.row >= 1 && row ? Math.floor(c.row) + shift : null;
        var n2 = knitPanelRows(prt, c.name, pages);
        if (r2 && n2 && r2 > n2) r2 = null;
        var m = knitChartMeta(prt, proj, pages, c.name, r2);
        outInfo.panels.push({ name: m.name, row: r2, of: n2 || m.of, page: m.page, chart: m.chart, text: m.text, textSource: m.textSource, panel: m.panel });
      });
    }
    return outInfo;
  }

  /**
   * An unnumbered line naming a range of chart rows ("Work Rows 1-61 of Lace
   * chart") that owns pattern row `prow`: it sits after the last written row
   * before `prow`, and `prow` falls within the range it names.
   * @returns {{line:Object, row:number}|null} row = the chart row
   */
  function chartGapLine(prt, prow) {
    var lines = linesFor(prt);
    var prevEnd = 0, cand = null, candFrom = 0, forCand = null;
    // wave H (knit-qa): "See Chart E for Rows 3-15" names the PATTERN's rows
    // (the Icelandic border's pick-up "counts as Row 1"): row 3 is chart row
    // 3, rows 1-2 are no chart row, and the written rows inside the range do
    // not end it. "Work Rows 1-61 of Lace chart" counts from where it is worked.
    var FOR_ROWS_RE = /\bfor\s+(?:rows?|rnds?|rounds?)\s+\d/i;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (!l) continue;
      if (isRowLine(l) && l.kind !== 'repeat') {
        if (l.row >= prow) break;
        prevEnd = Math.max(prevEnd, l.rowEnd >= l.row ? l.rowEnd : l.row);
        cand = null;
        continue;
      }
      var c = l.chart;
      if (c && c.row >= 1 && c.rowEnd > c.row) {
        if (FOR_ROWS_RE.test(str(l.text, ''))) forCand = l;
        else { cand = l; candFrom = prevEnd; }
      }
    }
    if (!cand && forCand) {
      return prow >= forCand.chart.row && prow <= forCand.chart.rowEnd ? { line: forCand, row: prow } : null;
    }
    if (!cand) return null;
    var r = cand.chart.row + (prow - candFrom - 1);
    return r >= cand.chart.row && r <= cand.chart.rowEnd ? { line: cand, row: r } : null;
  }

  /**
   * Several repeat boxes (a sock chart's "60 sts" / "68 sts"): the one for
   * this knitter. By stitch count first (the part's row total, else the
   * setup row's), then by the project's size name in the box label, then by
   * the size index when there is one box per size. null = the chart's own.
   */
  function chartRepeatFor(chart, proj, prt) {
    var reps = Array.isArray(chart.repeats) ? chart.repeats : [];
    if (reps.length < 2) return null;
    var sts = usableCount(currentTarget(prt));
    if (!sts) {
      var setup = setupLine(prt);
      sts = setup ? usableCount(setup.count) : null;
    }
    var i;
    if (sts) for (i = 0; i < reps.length; i++) if (reps[i] && reps[i].sizeSts === sts) return i;
    var label = proj && proj.size ? str(proj.size.label, '').toLowerCase() : '';
    if (label) {
      for (i = 0; i < reps.length; i++) {
        var l = str(reps[i] && reps[i].label, '').toLowerCase();
        if (l && (' ' + l.replace(/[^a-z0-9/]+/g, ' ') + ' ').indexOf(' ' + label + ' ') >= 0) return i;
      }
    }
    if (proj && proj.size && Array.isArray(proj.sizes) && proj.sizes.length === reps.length) return proj.size.index;
    return null;
  }

  /* ---- wave K (K3 glue): chart cells for the 3D's stranded colour ------ */

  /** Does the project hold a read chart whose key gives colours? */
  function knitHasColourChart(proj) {
    if (!proj || !isKnitProject(proj)) return false;
    return chartPagesOf(proj).some(function (pg) {
      var c = pg.chart;
      return !!(c && c.cells && !c.image && Array.isArray(c.legend) && c.legend.some(function (e) { return e && e.color; }));
    });
  }

  var knitChartSerial = 0;

  /** What the 3D cache key needs to know about the read charts ('' for crochet). */
  function knitChartKey(proj) {
    if (!proj || !isKnitProject(proj)) return '';
    var cd = proj.craftData && typeof proj.craftData === 'object' ? proj.craftData : null;
    var n = cd && Array.isArray(cd.charts) ? cd.charts.length : 0;
    var p = cd && Array.isArray(cd.chartPages) ? cd.chartPages.length : 0;
    if (!n && !p) return '';
    // the charts array is replaced whenever charts are written: its identity is the version
    var arr = cd.charts || cd.chartPages, id = arr.__kid;
    if (!id) {
      id = ++knitChartSerial;
      try { Object.defineProperty(arr, '__kid', { value: id, enumerable: false }); } catch (e) { id = 0; }
    }
    return 'c' + n + 'p' + p + 'i' + id + (knitHasColourChart(proj) ? 'k' : '');
  }

  /**
   * `KnitChart.rowCells` for actual row `row` of a part: chartInfo's chart
   * and chart row for that row, the side in which it is worked (null in the
   * round). null when the row works no read chart, or the chart gives no colour.
   */
  function knitChartCellsAt(prt, proj, row) {
    var KC = window.KnitChart;
    if (!KC || typeof KC.rowCells !== 'function' || !(row >= 1)) return null;
    var probe = {};
    for (var k in prt) if (Object.prototype.hasOwnProperty.call(prt, k)) probe[k] = prt[k];
    probe.row = row - 1;
    probe.stitch = 0;
    probe.shortRows = null;
    probe.side = null;
    bindPartProject(probe, proj);
    var ci = chartInfo(probe);
    var chart = ci && ci.chart;
    if (!chart || !chart.cells || chart.image || !(ci.row >= 1)) return null;
    if (!(Array.isArray(chart.legend) && chart.legend.some(function (e) { return e && e.color; }))) return null;
    var si = sideInfo(probe, proj);
    var cells = KC.rowCells(chart, ci.row, si.inRound ? null : (si.side || undefined));
    return Array.isArray(cells) && cells.some(function (c) { return c && c.color; }) ? cells : null;
  }

  /** The importer's door for `craftData.chartPages` (one Undo with the rest of an import if `undo:false`). */
  function setChartPages(projectId, list, opts) {
    return updateCraftData(projectId, function (cd) {
      var good = (Array.isArray(list) ? list : []).filter(function (c) { return c && typeof c === 'object' && c.page >= 1; });
      // wave K (P7, E12): one pattern out of a book keeps only the charts on its own pages
      good = good.filter(function (c) { return knitPageInPattern(cd, Math.floor(c.page)); });
      cd.chartPages = good.filter(function (c) { return !c.noImage; }).map(function (c) {
        var o = { page: Math.floor(c.page), name: str(c.name, '').trim() };
        if (c.key) o.key = str(c.key, '');
        // px per PDF point of the kept image, for the crop to chart.bbox
        if (c.scale > 0) o.scale = Number(c.scale);
        return o;
      });
      var charts = [];
      good.forEach(function (c) {
        if (!c.chart || typeof c.chart !== 'object') return;
        var ch = jsonObject(c.chart);
        ch.page = Math.floor(c.page);
        if (!ch.name) ch.name = str(c.name, '').trim();
        charts.push(ch);
      });
      if (charts.length) cd.charts = charts;
      else delete cd.charts;
    }, opts);
  }

  function installKnitApi(api) {
    // fields + writers
    api.KNIT_CRAFT = KNIT_CRAFT;
    api.gaugeOf = gaugeOf;
    api.setGauge = setGauge;
    api.normalizeGauge = normalizeGauge;
    api.lengthToRows = lengthToRows;
    api.gaugeCompare = gaugeCompare;
    api.sideInfo = sideInfo;
    api.patternSideAt = patternSideAt;
    api.setSide = setSide;
    api.flipSide = flipSide;
    api.markerInfo = markerInfo;
    api.addMarker = addMarker;
    api.renameMarker = renameMarker;
    api.removeMarker = removeMarker;
    api.setMarkers = setMarkers;
    api.linkParts = linkParts;
    api.unlinkPart = unlinkPart;
    api.splitTwoAtATime = splitTwoAtATime;
    api.linkedPart = function (projOrId, prt) {
      var pr = projOrId && typeof projOrId === 'object' ? projOrId : project(projOrId);
      return linkedPart(pr, prt);
    };
    api.linkedLabel = function (projOrId, prt) {
      var pr = projOrId && typeof projOrId === 'object' ? projOrId : project(projOrId);
      return pr ? linkedLabel(pr, prt) : '';
    };
    api.shortRowInfo = shortRowInfo;
    api.endShortRows = endShortRows;
    api.cableInfo = cableInfo;
    api.untilInfo = untilInfo;
    api.glossary = glossaryFor;
    api.chartInfo = chartInfo;
    api.lineInfo = lineInfo;   // wave K (knit-store, P2)
    // wave K (knit-store, P1): stretch phases
    api.stretchInfo = stretchInfo;
    api.stretchList = stretchList;
    api.endStretch = endStretch;
    api.useStretchEstimate = useStretchEstimate;
    api.reopenStretch = reopenStretch;
    api.setRowPhases = setRowPhases;
    api.measureInfo = measureInfo;       // wave K (knit-store, P10)
    api.addMeasurement = addMeasurement;
    api.chartPages = function (projOrId) {
      var pr = projOrId && typeof projOrId === 'object' ? projOrId : project(projOrId);
      return pr ? chartPagesOf(pr) : [];
    };
    api.setChartPages = setChartPages;
    return api;
  }

  /**
   * "Done with short rows": the knitter ends the run by hand (the pattern
   * said "until all heel sts are worked", or they stopped early). The short
   * rows finished so far (n - 1) are kept; a numbered run lands on the row
   * after them.
   */
  function endShortRows(projectId, partId) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt) return { event: 'none' };
    var info = shortRowInfo(prt);
    if (!info) return { event: 'none' };
    snapshot(proj);
    var done = Math.max(0, info.n - 1);
    var res;
    if (info.numbered && done >= 1) {
      prt.shortRows = null;
      prt.row = Math.max(0, info.base + done - 1);
      res = completeRow(proj, prt);
      prt.shortRows = { active: false, n: done, of: done, row: prt.row, base: info.base, numbered: true };
      res.shortRowsDone = done;
    } else {
      prt.stitch = 0;
      prt.shortRows = { active: false, n: Math.max(1, done), of: done || null, row: prt.row, base: info.base, numbered: !!info.numbered };
      res = { event: 'shortRowsDone', n: done, of: done, row: prt.row, partName: prt.name };
    }
    touch(proj);
    return res;
  }

  /* ------------------------------------------------------------------ *
   * Wave K (shell-data; docs/wave-k/api/shell-data.md)
   *
   *  K1 craft hooks: template / settings / heavy
   *  K2 heavy craft data off localStorage (IndexedDB) + diff undo
   *  K3 count events, sessions, pace, goals, mark log
   *  K4 step edits and notes (steps crafts)
   *  K5 the user's profile and settings that survive a backup
   *  K6 storage report
   * ------------------------------------------------------------------ */

  /* ---- K1: craft hooks ------------------------------------------------- */

  var TEMPLATE_CRAFTDATA_MAX = 256 * 1024;
  var HEAVY_MIN_BYTES = 32 * 1024;

  function normalizeHeavyDef(h) {
    if (!h || typeof h !== 'object' || !Array.isArray(h.fields)) return null;
    var fields = [];
    for (var i = 0; i < h.fields.length && fields.length < 16; i++) {
      var f = str(h.fields[i], '').trim();
      if (/^[A-Za-z0-9_$]+(\.[A-Za-z0-9_$]+){0,5}$/.test(f) && fields.indexOf(f) === -1) fields.push(f);
    }
    if (!fields.length) return null;
    return { fields: fields, minBytes: clampInt(h.minBytes, 1, 64 * 1024 * 1024, HEAVY_MIN_BYTES) };
  }

  function hookObj(h) { return h && typeof h === 'object' ? h : null; }

  /** The same hooks registerCraft takes, for a craft whose hooks live App-side. */
  function setCraftHooks(id, hooks) {
    var key = str(id, '').trim();
    if (!key || !hooks || typeof hooks !== 'object') return null;
    if (!crafts[key]) {
      crafts[key] = { id: key, normalize: null, summary: null, templates: [], template: null, settingsHook: null, heavy: null };
      craftOrder.push(key);
    }
    var c = crafts[key];
    if ('template' in hooks) c.template = hookObj(hooks.template);
    if ('settings' in hooks) {
      c.settingsHook = hookObj(hooks.settings);
      if (state && state.settings && state.settings.crafts && state.settings.crafts[key]) {
        state.settings.crafts[key] = normalizeOneCraftSettings(key, state.settings.crafts[key]);
      }
    }
    if ('heavy' in hooks) c.heavy = normalizeHeavyDef(hooks.heavy);
    if (state) save();
    return c;
  }

  function heavyDef(craftId) {
    var c = crafts[str(craftId, '')];
    return (c && c.heavy) || null;
  }

  /** "＋ New template" for any craft: an unsaved draft. */
  function templateDraft(craftId) {
    var craft = str(craftId, '').trim() || DEFAULT_CRAFT;
    var c = crafts[craft];
    var seed = null;
    if (c && c.template && typeof c.template.blank === 'function') {
      try {
        var b = c.template.blank();
        if (b && typeof b === 'object' && !Array.isArray(b)) seed = jsonObject(b);
      } catch (e) { seed = null; }
    }
    return {
      id: '', name: '', emoji: '', countMode: 'rows', groupSize: 10,
      parts: [{ name: 'Main', makeCount: 1, patternText: '', placementNotes: '' }],
      checklist: [], craft: craft, craftData: seed, builtIn: false
    };
  }

  /** templateFromProject's craft step: the hook's seed, checklist and emoji. */
  function applyTemplateHook(draft, proj, opts) {
    var c = crafts[proj.craft];
    var fn = opts && typeof opts.fromProject === 'function' ? opts.fromProject
      : (c && c.template && typeof c.template.fromProject === 'function' ? c.template.fromProject : null);
    if (!fn) return draft;
    var res = null;
    try { res = fn(deepCopy(proj)); } catch (e) { res = null; }
    if (!res || typeof res !== 'object') return draft;
    if (res.craftData && typeof res.craftData === 'object' && !Array.isArray(res.craftData)) {
      draft.craftData = jsonObject(res.craftData);
    }
    if (Array.isArray(res.checklist)) {
      draft.checklist = res.checklist.map(function (t) { return str(t, '').trim(); }).filter(Boolean);
    }
    if (typeof res.emoji === 'string' && res.emoji) draft.emoji = res.emoji;
    return draft;
  }

  function checkTemplateSize(craftData) {
    if (!craftData) return;
    var n = 0;
    try { n = JSON.stringify(craftData).length; } catch (e) { n = 0; }
    if (n > TEMPLATE_CRAFTDATA_MAX) {
      throw new Error('That chart is too big to keep as a template (' + Math.round(n / 1024) +
        ' KB; the limit is ' + Math.round(TEMPLATE_CRAFTDATA_MAX / 1024) + ' KB). Send the project as a file instead.');
    }
  }

  /* ---- K2: heavy craft data -------------------------------------------- */

  /* id -> runtime record. Nothing here is persisted except `table`, which is
   * written into the project's on-disk copy as `Project.heavy`. */
  var hv = Object.create(null);
  var heavySubs = [];
  var heavyLastError = null;

  function newRt(table) {
    return {
      state: 'none',          // 'none' | 'ready' | 'unloaded' | 'loading' | 'missing'
      table: table || null,   // { v, fields: { path: { key, rev, bytes, t } }, summary }
      committed: Object.create(null),  // path -> the ref that is on disk
      prevKeys: Object.create(null),   // path -> the key one rev back (kept for a second tab)
      memo: Object.create(null),       // path -> { ref, text } JSON of an object value
      failed: Object.create(null),     // path -> true: the first move failed; stays inline
      inflight: null, commitTimer: null, loading: null,
      durableText: null, gcDue: false, force: false, missingKeys: null,
      evict: [], scanned: false, summaryAt: 0,
      stats: { commits: 0, lastCommitMs: 0, lastBytes: 0 }
    };
  }

  function getPath(obj, path) {
    var ps = path.split('.');
    var o = obj;
    for (var i = 0; i < ps.length; i++) {
      if (!o || typeof o !== 'object') return undefined;
      o = o[ps[i]];
    }
    return o;
  }

  function setPath(obj, path, v) {
    var ps = path.split('.');
    var o = obj;
    for (var i = 0; i < ps.length - 1; i++) {
      if (o[ps[i]] === undefined) o[ps[i]] = {};
      o = o[ps[i]];
      if (!o || typeof o !== 'object') return false;
    }
    o[ps[ps.length - 1]] = v;
    return true;
  }

  function delPath(obj, path) {
    var ps = path.split('.');
    var o = obj;
    for (var i = 0; i < ps.length - 1; i++) {
      if (!o || typeof o !== 'object') return false;
      o = o[ps[i]];
    }
    if (!o || typeof o !== 'object' || !(ps[ps.length - 1] in o)) return false;
    delete o[ps[ps.length - 1]];
    return true;
  }

  function normalizeHeavyTable(raw) {
    if (!raw || typeof raw !== 'object' || !raw.fields || typeof raw.fields !== 'object') return null;
    var out = { v: 1, fields: {}, summary: str(raw.summary, '').slice(0, 300) };
    var keys = Object.keys(raw.fields);
    var any = false;
    for (var i = 0; i < keys.length && i < 16; i++) {
      var f = raw.fields[keys[i]];
      if (!f || typeof f !== 'object') continue;
      var k = str(f.key, '');
      if (!/^p:[^:]+:heavy:/.test(k) || k.length > 400) continue;
      out.fields[keys[i]] = {
        key: k,
        rev: str(f.rev, ''),
        bytes: clampInt(f.bytes, 0, 1e10, 0),
        t: f.t === 'j' ? 'j' : 's'
      };
      any = true;
    }
    return any ? out : null;
  }

  function tablePaths(t) { return t && t.fields ? Object.keys(t.fields) : []; }

  /** Does a raw (on-disk) craftData lack any field its side table holds? */
  function heavyValuesMissing(cd, t) {
    var paths = tablePaths(t);
    for (var i = 0; i < paths.length; i++) {
      if (getPath(cd, paths[i]) === undefined) return true;
    }
    return false;
  }

  /** normalizeProject's craftData step: never normalise half a craftData. */
  function wkCraftDataIn(craft, p) {
    var t = normalizeHeavyTable(p.heavy);
    if (t && heavyValuesMissing(p.craftData, t)) {
      var cd = p.craftData;
      return cd && typeof cd === 'object' && !Array.isArray(cd) ? cd : {};
    }
    return normalizeCraftData(craft, p.craftData, p);
  }

  function rtReady(rt) {
    return !rt || rt.state === 'none' || rt.state === 'ready';
  }

  function isHeavyReady(proj) {
    return !proj || rtReady(hv[proj.id]);
  }

  function heavyState(id) {
    var p = project(id);
    if (!p) return 'none';
    var rt = hv[p.id];
    if (rt && rt.state !== 'none') return rt.state;
    return heavyDef(p.craft) ? 'ready' : 'none';
  }

  function emitHeavy(id, type, extra) {
    var ev = { projectId: id, type: type };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) ev[k] = extra[k];
    emit(heavySubs, ev);
  }

  /**
   * After a state was (re)built from text: move every `Project.heavy` side
   * table into the runtime, and keep a project's already-loaded heavy values
   * when the table did not change (a second tab saved something else).
   */
  function heavyIngest(list, prevList) {
    var prevHv = hv;
    var prevById = Object.create(null);
    if (Array.isArray(prevList)) for (var j = 0; j < prevList.length; j++) prevById[prevList[j].id] = prevList[j];
    var next = Object.create(null);
    for (var i = 0; i < (list || []).length; i++) {
      var p = list[i];
      var t = p.heavy ? normalizeHeavyTable(p.heavy) : null;
      if ('heavy' in p) delete p.heavy;
      if (!t) {
        // a project with no table: whatever is in memory is the whole thing
        if (heavyDef(p.craft)) { next[p.id] = newRt(null); next[p.id].state = 'ready'; }
        continue;
      }
      var rt = newRt(t);
      next[p.id] = rt;
      if (!heavyValuesMissing(p.craftData, t)) {
        // values travelled inline (an import): they are the truth; the old
        // blobs are rewritten on the next save and then swept
        rt.state = 'ready';
        continue;
      }
      var old = prevHv[p.id];
      var oldP = prevById[p.id];
      if (old && old.state === 'ready' && old.table && oldP && sameTableKeys(old.table, t)) {
        var ok = true;
        var paths = tablePaths(t);
        for (var k = 0; k < paths.length; k++) {
          var v = getPath(oldP.craftData, paths[k]);
          if (v === undefined) { ok = false; break; }
          setPath(p.craftData, paths[k], v);
        }
        if (ok) {
          p.craftData = normalizeCraftData(p.craft, p.craftData, p);
          for (k = 0; k < paths.length; k++) {
            var nv = getPath(p.craftData, paths[k]);
            if (nv === getPath(oldP.craftData, paths[k])) rt.committed[paths[k]] = nv;
          }
          rt.memo = old.memo;
          rt.prevKeys = old.prevKeys;
          rt.state = 'ready';
          continue;
        }
      }
      rt.state = 'unloaded';
    }
    hv = next;
  }

  /** One project that just arrived (an import): its own fresh runtime. */
  function heavyIngestOne(p) {
    var saved = hv;
    var tmp = Object.create(null);
    hv = tmp;
    try {
      heavyIngest([p], null);
    } finally {
      hv = saved;
    }
    if (tmp[p.id]) hv[p.id] = tmp[p.id];
    else delete hv[p.id];
  }

  function sameTableKeys(a, b) {
    var pa = tablePaths(a), pb = tablePaths(b);
    if (pa.length !== pb.length) return false;
    for (var i = 0; i < pa.length; i++) {
      if (!b.fields[pa[i]] || b.fields[pa[i]].key !== a.fields[pa[i]].key) return false;
    }
    return true;
  }

  /** {text, t} of a heavy value; objects are stringified once per reference. */
  function heavyText(rt, path, v) {
    if (typeof v === 'string') return { text: v, t: 's' };
    var m = rt.memo[path];
    if (m && m.ref === v) return { text: m.text, t: 'j' };
    var text;
    try { text = JSON.stringify(v); } catch (e) { text = ''; }
    rt.memo[path] = { ref: v, text: text };
    return { text: text, t: 'j' };
  }

  function withExtra(p, key, value) {
    var o = {};
    var ks = Object.keys(p);
    for (var i = 0; i < ks.length; i++) o[ks[i]] = p[ks[i]];
    if (value) o[key] = value;
    return o;
  }

  function wkNeedsCustom() {
    var list = state && state.projects;
    if (!Array.isArray(list)) return false;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (hv[p.id] && (hv[p.id].table || hv[p.id].state !== 'none')) return true;
      if (heavyDef(p.craft)) return true;
    }
    return false;
  }

  /** What the heavy fields of a ready project need now. */
  function heavyPlan(p, D, rt) {
    var cd = p.craftData || {};
    var out = { strip: [], need: false, dirtyTable: false };
    var min = rt.force ? 1024 : D.minBytes;
    var B = blobStore();
    for (var i = 0; i < D.fields.length; i++) {
      var path = D.fields[i];
      var v = getPath(cd, path);
      var inT = rt.table && rt.table.fields[path];
      if (v === undefined || v === null) {
        if (inT) { out.dirtyTable = true; out.need = true; }
        continue;
      }
      if (inT) {
        if (v === rt.committed[path]) out.strip.push(path);
        else { out.dirtyTable = true; out.need = true; }
        continue;
      }
      if (rt.failed[path] || !B || typeof B.putManyResult !== 'function') continue;
      var size = typeof v === 'string' ? v.length : heavyText(rt, path, v).text.length;
      if (size >= min) out.need = true;
    }
    // fields the craft no longer declares go back inline
    var paths = tablePaths(rt.table);
    for (var j = 0; j < paths.length; j++) {
      if (D.fields.indexOf(paths[j]) === -1) { out.dirtyTable = true; out.need = true; }
    }
    return out;
  }

  /** One project's on-disk JSON text (writeNow). */
  function projectText(p) {
    var rt = hv[p.id];
    if (rt && !rtReady(rt)) return JSON.stringify(withExtra(p, 'heavy', rt.table));
    var D = heavyDef(p.craft);
    if (!D) {
      if (rt && rt.table) {
        // the craft stopped opting in: everything goes back inline
        rt.table = null;
        rt.gcDue = true;
        rt.committed = Object.create(null);
      }
      return JSON.stringify(p);
    }
    if (!rt) { rt = hv[p.id] = newRt(null); }
    if (rt.state === 'none') rt.state = 'ready';
    var plan = heavyPlan(p, D, rt);
    if (plan.need) scheduleCommit(p.id);
    if ((rt.inflight || plan.dirtyTable) && rt.durableText) return rt.durableText;
    if (!plan.strip.length || !rt.table) {
      if (!rt.inflight && !plan.dirtyTable) rt.durableText = null;
      return JSON.stringify(p);
    }
    var cd = p.craftData;
    var hold = [];
    for (var i = 0; i < plan.strip.length; i++) {
      hold.push([plan.strip[i], getPath(cd, plan.strip[i])]);
      delPath(cd, plan.strip[i]);
    }
    var txt;
    try {
      txt = JSON.stringify(withExtra(p, 'heavy', rt.table));
    } finally {
      for (var h = 0; h < hold.length; h++) setPath(cd, hold[h][0], hold[h][1]);
    }
    if (!plan.dirtyTable) rt.durableText = txt;
    return txt;
  }

  /** writeNow's serialiser: byte-identical to JSON.stringify(state) unless heavy data is in play. */
  function serializeState() {
    if (!wkNeedsCustom()) return JSON.stringify(state);
    var parts = [];
    for (var i = 0; i < state.projects.length; i++) parts.push(projectText(state.projects[i]));
    var TOKEN = '__wk_projects_' + uid() + '__';
    var saved = state.projects;
    var head;
    state.projects = TOKEN;
    try { head = JSON.stringify(state); } finally { state.projects = saved; }
    var at = head.indexOf('"' + TOKEN + '"');
    return head.slice(0, at) + '[' + parts.join(',') + ']' + head.slice(at + TOKEN.length + 2);
  }

  function scheduleCommit(id) {
    var rt = hv[id];
    if (!rt || rt.inflight || rt.commitTimer) return;
    rt.commitTimer = setTimeout(function () { rt.commitTimer = null; startCommit(id); }, 0);
  }

  function heavySummary(p) {
    var c = crafts[p.craft];
    if (!c || !c.summary) return '';
    try { var s = c.summary(p); return typeof s === 'string' ? s.slice(0, 300) : ''; } catch (e) { return ''; }
  }

  /** Write a project's changed heavy fields to IndexedDB, then point localStorage at them. */
  function startCommit(id) {
    var rt = hv[id];
    var p = project(id);
    if (!rt || !p || !rtReady(rt) || rt.inflight) return null;
    var D = heavyDef(p.craft);
    if (!D) return null;
    var B = blobStore();
    if (!B || typeof B.putManyResult !== 'function') return null;
    var cd = p.craftData || {};
    var min = rt.force ? 1024 : D.minBytes;
    var rev = uid();
    var writes = [];
    var plan = [];
    var paths = tablePaths(rt.table);
    for (var j = 0; j < paths.length; j++) {
      if (D.fields.indexOf(paths[j]) === -1) plan.push({ path: paths[j], drop: true });
    }
    for (var i = 0; i < D.fields.length; i++) {
      var path = D.fields[i];
      var v = getPath(cd, path);
      var inT = rt.table && rt.table.fields[path];
      if (v === undefined || v === null) {
        if (inT) plan.push({ path: path, drop: true });
        continue;
      }
      if (inT && v === rt.committed[path]) continue;
      var ht = heavyText(rt, path, v);
      if (!inT && (rt.failed[path] || ht.text.length < min)) continue;
      if (inT && ht.text.length < Math.floor(min / 4)) { plan.push({ path: path, drop: true }); continue; }
      var key = 'p:' + id + ':heavy:' + path + ':' + rev;
      writes.push({ key: key, value: ht.text });
      plan.push({ path: path, key: key, ref: v, text: ht.text, bytes: ht.text.length, t: ht.t, migrate: !inT });
    }
    if (!plan.length) return null;
    var t0 = mono();
    rt.inflight = { rev: rev, keys: writes.map(function (w) { return w.key; }) };
    var job = (writes.length ? B.putManyResult(writes) : Promise.resolve({ ok: true, count: 0, error: null }))
      .then(function (res) {
        if (!res || !res.ok) return res || { ok: false, error: 'UnknownError' };
        // A field's FIRST move is read back before localStorage lets go of it.
        var checks = plan.filter(function (x) { return x.migrate; });
        if (!checks.length || typeof B.getText !== 'function') return res;
        return Promise.all(checks.map(function (x) {
          return B.getText(x.key).then(function (txt) { return txt === x.text; });
        })).then(function (oks) {
          for (var k = 0; k < oks.length; k++) if (!oks[k]) return { ok: false, error: 'ReadBackMismatch' };
          return res;
        });
      })
      .then(function (res) {
        rt.inflight = null;
        if (hv[id] !== rt || !project(id)) return;
        var p2 = project(id);
        if (res && res.ok) {
          if (!rt.table) rt.table = { v: 1, fields: {}, summary: '' };
          plan.forEach(function (x) {
            var old = rt.table.fields[x.path];
            if (old) {
              // the revision two back falls out (the sweep after the next write deletes it)
              if (rt.prevKeys[x.path] && rt.prevKeys[x.path] !== old.key) rt.evict.push(rt.prevKeys[x.path]);
              rt.prevKeys[x.path] = old.key;
            }
            if (x.drop) {
              delete rt.table.fields[x.path];
              delete rt.committed[x.path];
              return;
            }
            rt.table.fields[x.path] = { key: x.key, rev: rev, bytes: x.bytes, t: x.t };
            rt.committed[x.path] = x.ref;
          });
          if (!tablePaths(rt.table).length) rt.table = null;
          else if (!rt.table.summary || mono() - (rt.summaryAt || 0) > 5000) {
            // the craft's summary can walk a whole chart: at most every 5 s
            rt.table.summary = heavySummary(p2);
            rt.summaryAt = mono();
          }
          rt.force = false;
          rt.gcDue = true;
          rt.durableText = null;
          rt.stats.commits++;
          rt.stats.lastCommitMs = mono() - t0;
          rt.stats.lastBytes = writes.reduce(function (s, w) { return s + w.value.length; }, 0);
          emitHeavy(id, 'committed', { ms: rt.stats.lastCommitMs, bytes: rt.stats.lastBytes });
        } else {
          var err = (res && res.error) || 'UnknownError';
          heavyLastError = { projectId: id, error: err, at: now() };
          var inlined = false;
          plan.forEach(function (x) {
            if (x.migrate) { rt.failed[x.path] = true; return; }
            if (rt.table && rt.table.fields[x.path] && !x.drop) {
              // the newer value cannot reach IndexedDB: bring the field back
              // inline (localStorage then reports its own failure if it is full)
              rt.prevKeys[x.path] = rt.table.fields[x.path].key;
              delete rt.table.fields[x.path];
              delete rt.committed[x.path];
              rt.failed[x.path] = true;
              inlined = true;
            }
          });
          if (rt.table && !tablePaths(rt.table).length) rt.table = null;
          rt.durableText = null;
          rt.gcDue = true;
          emitHeavy(id, inlined ? 'inlined' : 'failed', { error: err });
        }
        save();
      }, function (e) {
        rt.inflight = null;
        heavyLastError = { projectId: id, error: (e && e.name) || 'UnknownError', at: now() };
        emitHeavy(id, 'failed', { error: heavyLastError.error });
      });
    heavyJobs.push(job);
    job.then(function () { heavyJobs.splice(heavyJobs.indexOf(job), 1); });
    return job;
  }

  var heavyJobs = [];

  /** Resolves once every pending heavy write has landed or failed. */
  function heavyIdle() {
    if (typeof Promise !== 'function') return null;
    var pending = [];
    var ids = Object.keys(hv);
    for (var i = 0; i < ids.length; i++) {
      var rt = hv[ids[i]];
      if (rt.commitTimer) { clearTimeout(rt.commitTimer); rt.commitTimer = null; var j = startCommit(ids[i]); if (j) pending.push(j); }
      if (rt.loading) pending.push(rt.loading);
    }
    pending = pending.concat(heavyJobs);
    if (!pending.length) return Promise.resolve();
    return Promise.all(pending).then(function () {
      // a commit asks for a save; once that write is done the chain is quiet
      if (saveTimer) flush();
      var more = Object.keys(hv).some(function (id) { return hv[id].inflight || hv[id].commitTimer; });
      return more ? heavyIdle() : undefined;
    });
  }

  /** After a localStorage write that worked: drop heavy blobs nothing points at. */
  function heavyAfterWrite(text) {
    var B = blobStore();
    if (!B) return;
    var ids = Object.keys(hv);
    for (var i = 0; i < ids.length; i++) {
      var rt = hv[ids[i]];
      if (!rt.gcDue || rt.inflight || rt.commitTimer || !rtReady(rt)) continue;
      rt.gcDue = false;
      (function (id, rt2) {
        var pre = (preimportText || '') + (lsGet(KEY + PREIMPORT_KEY_SUFFIX) || '');
        // the first sweep of a session lists every heavy key of the project;
        // after that only the revisions that just fell out are candidates
        var list = rt2.scanned ? Promise.resolve(rt2.evict.splice(0, rt2.evict.length))
          : B.keys('p:' + id + ':heavy:');
        rt2.scanned = true;
        list.then(function (keys) {
          var doomed = [];
          for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            if (text.indexOf('"' + key + '"') >= 0 || pre.indexOf('"' + key + '"') >= 0) continue;
            if (rt2.inflight && rt2.inflight.keys.indexOf(key) >= 0) continue;
            var keep = false;
            for (var pk in rt2.prevKeys) if (rt2.prevKeys[pk] === key) keep = true;
            if (rt2.table) for (var tk in rt2.table.fields) if (rt2.table.fields[tk].key === key) keep = true;
            if (!keep) doomed.push(key);
          }
          if (doomed.length) return B.deleteKeys(doomed);
          return 0;
        });
      })(ids[i], rt);
    }
  }

  /** localStorage is full: move opted-in inline fields out at a lower bar. */
  function heavyRescue() {
    var list = state && state.projects;
    if (!Array.isArray(list)) return false;
    var any = false;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!heavyDef(p.craft) || !isHeavyReady(p)) continue;
      var rt = hv[p.id] || (hv[p.id] = newRt(null));
      if (rt.state === 'none') rt.state = 'ready';
      rt.force = true;
      rt.failed = Object.create(null);
      scheduleCommit(p.id);
      any = true;
    }
    return any;
  }

  /** Read the side table a project has on disk right now (another tab may have moved it on). */
  function diskTable(id) {
    var txt = lsGet(KEY);
    if (!txt) return null;
    try {
      var raw = JSON.parse(txt);
      var list = raw && Array.isArray(raw.projects) ? raw.projects : [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === id) return normalizeHeavyTable(list[i].heavy);
      }
    } catch (e) { /* unreadable: nothing to learn */ }
    return null;
  }

  function loadHeavy(id, rt, retry) {
    var B = blobStore();
    var paths = tablePaths(rt.table);
    if (!B || typeof B.getText !== 'function') {
      rt.state = 'missing';
      rt.missingKeys = paths.map(function (p) { return rt.table.fields[p].key; });
      emitHeavy(id, 'missing', { keys: rt.missingKeys, reason: 'noIndexedDB' });
      return Promise.resolve('missing');
    }
    return Promise.all(paths.map(function (path) { return B.getText(rt.table.fields[path].key); }))
      .then(function (texts) {
        if (hv[id] !== rt) return heavyState(id);
        var p = project(id);
        if (!p) return 'none';
        var miss = [];
        var vals = [];
        for (var i = 0; i < paths.length; i++) {
          var f = rt.table.fields[paths[i]];
          if (texts[i] === null || texts[i] === undefined) { miss.push(f.key); continue; }
          if (f.t === 'j') {
            try { vals.push(JSON.parse(texts[i])); } catch (e) { miss.push(f.key); }
          } else {
            vals.push(texts[i]);
          }
        }
        if (miss.length) {
          var disk = retry ? diskTable(id) : null;
          if (disk && !sameTableKeys(disk, rt.table)) {
            rt.table = disk;
            return loadHeavy(id, rt, false);
          }
          rt.state = 'missing';
          rt.missingKeys = miss;
          emitHeavy(id, 'missing', { keys: miss });
          return 'missing';
        }
        var cd = p.craftData && typeof p.craftData === 'object' ? p.craftData : (p.craftData = {});
        for (var k = 0; k < paths.length; k++) setPath(cd, paths[k], vals[k]);
        p.craftData = normalizeCraftData(p.craft, cd, p);
        for (k = 0; k < paths.length; k++) {
          var nv = getPath(p.craftData, paths[k]);
          if (nv === vals[k]) { rt.committed[paths[k]] = nv; continue; }
          if (nv !== undefined && nv !== null && typeof nv === 'object') {
            var ht = heavyText(rt, paths[k], nv);
            if (ht.text === texts[k]) rt.committed[paths[k]] = nv;
          } else if (typeof nv === 'string' && nv === texts[k]) {
            rt.committed[paths[k]] = nv;
          }
        }
        rt.state = 'ready';
        rt.missingKeys = null;
        rt.durableText = null;
        try { projectText(p); } catch (e) { /* the next save tries again */ }
        emitHeavy(id, 'ready');
        return 'ready';
      });
  }

  /** Load a project's heavy fields (on demand). Resolves with heavyState(id). */
  function whenReady(id) {
    if (typeof Promise !== 'function') return null;
    var p = project(id);
    if (!p) return Promise.resolve('none');
    var rt = hv[p.id];
    if (!rt || rtReady(rt)) return Promise.resolve(heavyState(p.id));
    if (rt.loading) return rt.loading;
    rt.state = 'loading';
    rt.loading = pagesIdle().then(function () {
      return loadHeavy(p.id, rt, true);
    }).then(function (st) {
      rt.loading = null;
      return st;
    }, function () {
      rt.loading = null;
      rt.state = 'missing';
      emitHeavy(p.id, 'missing', { reason: 'error' });
      return 'missing';
    });
    return rt.loading;
  }

  function hydrateAll(ids) {
    var list = Array.isArray(ids) ? ids : projects().map(function (p) { return p.id; });
    return Promise.all(list.map(function (id) { return whenReady(id); }));
  }

  function heavyInfo(id) {
    var p = project(id);
    var out = { state: heavyState(id), pending: false, fields: [] };
    if (!p) return out;
    var rt = hv[p.id];
    var D = heavyDef(p.craft);
    out.pending = !!(rt && (rt.inflight || rt.commitTimer || rt.loading));
    var seen = Object.create(null);
    var paths = (D ? D.fields : []).concat(tablePaths(rt && rt.table));
    for (var i = 0; i < paths.length; i++) {
      if (seen[paths[i]]) continue;
      seen[paths[i]] = true;
      var f = rt && rt.table && rt.table.fields[paths[i]];
      if (f) { out.fields.push({ path: paths[i], where: 'idb', bytes: f.bytes, key: f.key }); continue; }
      var v = getPath(p.craftData, paths[i]);
      if (v === undefined || v === null) continue;
      var n = typeof v === 'string' ? v.length : (rt ? heavyText(rt, paths[i], v).text.length : JSON.stringify(v).length);
      out.fields.push({ path: paths[i], where: 'inline', bytes: n, key: null });
    }
    if (rt && rt.missingKeys) out.missing = rt.missingKeys.slice();
    if (rt) out.stats = { commits: rt.stats.commits, lastCommitMs: rt.stats.lastCommitMs, lastBytes: rt.stats.lastBytes };
    return out;
  }

  function onHeavy(fn) { return subscribe(heavySubs, fn); }

  /** The user accepted that the heavy data is gone: keep what is left, whole. */
  function discardMissingHeavy(id) {
    var p = project(id);
    var rt = p && hv[p.id];
    if (!p || !rt || rt.state !== 'missing') return false;
    snapshot(p);
    rt.table = null;
    rt.state = 'ready';
    rt.missingKeys = null;
    rt.gcDue = true;
    p.craftData = normalizeCraftData(p.craft, p.craftData, p);
    touch(p);
    return true;
  }

  /* -- diff undo for heavy fields -- */

  function strDiff(oldS, newS) {
    var n = Math.min(oldS.length, newS.length);
    var p = 0;
    while (p < n && oldS.charCodeAt(p) === newS.charCodeAt(p)) p++;
    var s = 0;
    var lo = oldS.length - 1, ln = newS.length - 1;
    while (s < n - p && oldS.charCodeAt(lo - s) === newS.charCodeAt(ln - s)) s++;
    return { p: p, s: s, mid: oldS.slice(p, oldS.length - s) };
  }

  function strPatch(base, d) {
    return base.slice(0, d.p) + d.mid + base.slice(base.length - d.s);
  }

  function lastEntryFor(id) {
    for (var i = undoStack.length - 1; i >= 0; i--) if (undoStack[i].id === id) return undoStack[i];
    return null;
  }

  function entryText(slot, rt, path) {
    if (typeof slot.v === 'string') return slot.v;
    try { return JSON.stringify(slot.v); } catch (e) { return ''; }
  }

  /** Turn a full slot into a diff against `cur` (the state after that entry's change). */
  function compactSlot(entry, path, cur, rt) {
    var slot = entry.heavy[path];
    if (!slot || !('v' in slot)) return;
    if (slot.v === cur) return;   // unchanged: the shared immutable value costs nothing
    if (slot.v === undefined || slot.v === null || cur === undefined || cur === null) return;
    var isStr = typeof slot.v === 'string' && typeof cur === 'string';
    var oldText = isStr ? slot.v : entryText(slot, rt, path);
    var curText = isStr ? cur : heavyText(rt, path, cur).text;
    var d = strDiff(oldText, curText);
    var before = entry.heavyBytes || 0;
    entry.heavy[path] = { d: d, bl: curText.length, bh: hash32(curText), t: isStr ? 's' : 'j' };
    var after = 0;
    for (var k in entry.heavy) if (entry.heavy[k].d) after += entry.heavy[k].d.mid.length + 24;
    entry.heavyBytes = after;
    entry.bytes += after - before;
    undoBytesTotal += after - before;
  }

  /** The value a slot stands for, given the live value it was diffed against; undefined = refuse. */
  function slotValue(slot, live, rt, path) {
    if ('v' in slot) return slot.v;
    if (live === undefined || live === null) return undefined;
    var liveText = slot.t === 's' ? (typeof live === 'string' ? live : null) : heavyText(rt, path, live).text;
    if (liveText === null || liveText.length !== slot.bl || hash32(liveText) !== slot.bh) return undefined;
    var txt = strPatch(liveText, slot.d);
    if (slot.t === 's') return txt;
    try { return JSON.parse(txt); } catch (e) { return undefined; }
  }

  /** snapshot()'s path for an opted-in project. */
  function heavySnapshot(proj, D) {
    var rt = hv[proj.id] || (hv[proj.id] = newRt(null));
    if (rt.state === 'none') rt.state = 'ready';
    var cd = proj.craftData && typeof proj.craftData === 'object' ? proj.craftData : null;
    var held = [];
    var heavy = {};
    for (var i = 0; i < D.fields.length; i++) {
      var v = cd ? getPath(cd, D.fields[i]) : undefined;
      heavy[D.fields[i]] = { v: v };
      if (v !== undefined && cd) { held.push([D.fields[i], v]); delPath(cd, D.fields[i]); }
    }
    var text;
    try {
      text = JSON.stringify(proj);
    } finally {
      for (var h = 0; h < held.length; h++) setPath(cd, held[h][0], held[h][1]);
    }
    // the previous entry of this project now gets diffed against what is live
    var prev = lastEntryFor(proj.id);
    if (prev && prev.heavy) {
      for (var path in prev.heavy) compactSlot(prev, path, cd ? getPath(cd, path) : undefined, rt);
    }
    return { text: text, heavy: heavy };
  }

  /** After a write that took no snapshot moved a heavy field: re-anchor the top diff. */
  function heavyRebase(proj, before) {
    var e = lastEntryFor(proj.id);
    if (!e || !e.heavy) return;
    var rt = hv[proj.id];
    for (var path in before) {
      var now2 = getPath(proj.craftData, path);
      if (now2 === before[path]) continue;
      var slot = e.heavy[path];
      if (!slot || 'v' in slot) continue;
      var full = slotValue(slot, before[path], rt, path);
      if (full === undefined) { dropUndoFor(proj.id); return; }
      e.bytes -= slot.d.mid.length + 24;
      undoBytesTotal -= slot.d.mid.length + 24;
      e.heavy[path] = { v: full };
    }
  }

  function dropUndoFor(id) {
    for (var i = undoStack.length - 1; i >= 0; i--) {
      if (undoStack[i].id !== id) continue;
      undoBytesTotal -= undoStack[i].bytes || 0;
      undoStack.splice(i, 1);
    }
    if (undoBytesTotal < 0) undoBytesTotal = 0;
  }

  /** undo()'s path for an entry with heavy slots: the restored project, or null to refuse. */
  function heavyRestore(entry, live) {
    var rt = hv[entry.id] || (hv[entry.id] = newRt(null));
    var data = entry.data;
    if (!data.craftData || typeof data.craftData !== 'object') data.craftData = {};
    for (var path in entry.heavy) {
      var slot = entry.heavy[path];
      var liveV = live ? getPath(live.craftData, path) : undefined;
      var v = slotValue(slot, liveV, rt, path);
      if (v === undefined) {
        if ('v' in slot) continue;   // the field was absent then
        return null;
      }
      setPath(data.craftData, path, v);
    }
    return data;
  }

  /* ---- K3: count events, sessions, pace, goals, mark log ---------------- */

  var SESSION_IDLE_MS = 10 * 60 * 1000;
  var SESSIONS_MAX = 200;
  var DAYS_MAX = 800;
  var BY_MAX = 60;
  var countSubs = [];

  function unitName(u) {
    var s = str(u, '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
    return s || 'unit';
  }

  function bump(obj, key, n) {
    var v = (obj[key] || 0) + n;
    if (v <= 0) delete obj[key];
    else obj[key] = v;
  }

  function normalizeCounts(raw, max) {
    var out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    var ks = Object.keys(raw);
    for (var i = 0, n = 0; i < ks.length && n < (max || 20); i++) {
      var k = unitName(ks[i]);
      var v = clampInt(raw[ks[i]], 0, 1e9, 0);
      if (v > 0) { out[k] = v; n++; }
    }
    return out;
  }

  function normalizeActivity(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var sessions = [];
    if (Array.isArray(raw.sessions)) {
      for (var i = Math.max(0, raw.sessions.length - SESSIONS_MAX); i < raw.sessions.length; i++) {
        var s = raw.sessions[i];
        if (!s || typeof s !== 'object') continue;
        var st = clampInt(s.s, 0, 1e15, 0);
        if (!st) continue;
        var by = {};
        if (s.by && typeof s.by === 'object' && !Array.isArray(s.by)) {
          var bk = Object.keys(s.by);
          for (var b = 0, nb = 0; b < bk.length && nb < BY_MAX; b++) {
            var name = safeName(bk[b], '').slice(0, 60);
            if (!name) continue;
            var c = normalizeCounts(s.by[bk[b]]);
            if (Object.keys(c).length) { by[name] = c; nb++; }
          }
        }
        sessions.push({ s: st, e: Math.max(st, clampInt(s.e, 0, 1e15, st)), c: normalizeCounts(s.c), by: by });
      }
    }
    var days = {};
    if (raw.days && typeof raw.days === 'object' && !Array.isArray(raw.days)) {
      var dk = Object.keys(raw.days).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }).sort();
      if (dk.length > DAYS_MAX) dk = dk.slice(dk.length - DAYS_MAX);
      for (var d = 0; d < dk.length; d++) {
        var dc = normalizeCounts(raw.days[dk[d]]);
        if (Object.keys(dc).length) days[dk[d]] = dc;
      }
    }
    var out = { sessions: sessions, days: days, total: normalizeCounts(raw.total) };
    if (!sessions.length && !Object.keys(days).length && !Object.keys(out.total).length) return null;
    return out;
  }

  function normalizeGoals(raw) {
    if (!Array.isArray(raw)) return null;
    var out = [];
    for (var i = 0; i < raw.length && out.length < 20; i++) {
      var g = raw[i];
      if (!g || typeof g !== 'object') continue;
      var kind = g.kind === 'byDate' ? 'byDate' : (g.kind === 'perDay' ? 'perDay' : null);
      if (!kind) continue;
      var ng = {
        id: str(g.id, '') || uid(),
        kind: kind,
        unit: unitName(g.unit),
        label: safeName(g.label, '').slice(0, 80)
      };
      if (kind === 'perDay') {
        var gn = typeof g.n === 'number' ? g.n : parseFloat(g.n);
        if (!isFinite(gn) || gn < 1) continue;
        ng.n = clampInt(gn, 1, 1e7, 1);
      } else {
        ng.until = clampInt(g.until, 0, 1e15, 0);
        if (!ng.until) continue;
        if (g.n !== undefined && g.n !== null) ng.n = clampInt(g.n, 0, 1e9, 0);
      }
      out.push(ng);
    }
    return out.length ? out : null;
  }

  var STEP_KEY_RE = /^s[0-9a-z]{1,9}(~\d{1,4})?$/;

  function normalizeOverlay(raw) {
    if (!raw || typeof raw !== 'object' || !raw.steps || typeof raw.steps !== 'object') return null;
    var steps = {};
    var ks = Object.keys(raw.steps);
    var n = 0;
    for (var i = 0; i < ks.length && n < 2000; i++) {
      if (!STEP_KEY_RE.test(ks[i])) continue;
      var e = raw.steps[ks[i]];
      if (!e || typeof e !== 'object') continue;
      var o = {};
      if (typeof e.text === 'string' && e.text.trim()) o.text = e.text.replace(BIDI_RE, '').slice(0, 4000);
      if (typeof e.note === 'string' && e.note.trim()) o.note = e.note.replace(BIDI_RE, '').slice(0, 2000);
      if (!o.text && !o.note) continue;
      o.at = clampInt(e.at, 0, 1e15, 0);
      steps[ks[i]] = o;
      n++;
    }
    return n ? { steps: steps } : null;
  }

  /** normalizeProject's last step: the wave K project fields, present only when used. */
  function wkProjectOut(np, p) {
    var t = normalizeHeavyTable(p.heavy);
    if (t) np.heavy = t;
    var a = normalizeActivity(p.activity);
    if (a) np.activity = a;
    var g = normalizeGoals(p.goals);
    if (g) np.goals = g;
    var o = normalizeOverlay(p.overlay);
    if (o) np.overlay = o;
    return np;
  }

  function sessionCopy(s) {
    var c = {};
    for (var k in s.c) c[k] = s.c[k];
    return { s: s.s, e: s.e, c: c };
  }

  /** The heart of K3: cheap, bounded, no snapshot of its own. */
  function recordCount(proj, n, unit, part, at) {
    var a = proj.activity;
    if (!a || typeof a !== 'object') a = proj.activity = { sessions: [], days: {}, total: {} };
    var ss = a.sessions;
    var last = ss.length ? ss[ss.length - 1] : null;
    var opened = false;
    if (!last || (n > 0 && (at - last.e > SESSION_IDLE_MS || at < last.s - 60000))) {
      if (n <= 0 && !last) return null;
      last = { s: at, e: at, c: {}, by: {} };
      ss.push(last);
      if (ss.length > SESSIONS_MAX) ss.splice(0, ss.length - SESSIONS_MAX);
      opened = true;
    }
    if (at > last.e) last.e = at;
    bump(last.c, unit, n);
    if (part) {
      var by = last.by[part];
      if (!by) {
        if (Object.keys(last.by).length < BY_MAX && n > 0) by = last.by[part] = {};
      }
      if (by) {
        bump(by, unit, n);
        if (!Object.keys(by).length) delete last.by[part];
      }
    }
    var dk = Math.abs(at - now()) < 60000 ? dayKeyNow() : dayKey(at);
    var day = a.days[dk];
    if (!day) {
      if (n <= 0) day = null;
      else {
        day = a.days[dk] = {};
        var keys = Object.keys(a.days);
        if (keys.length > DAYS_MAX) {
          keys.sort();
          for (var i = 0; i < keys.length - DAYS_MAX; i++) delete a.days[keys[i]];
        }
      }
    }
    if (day) {
      bump(day, unit, n);
      if (!Object.keys(day).length) delete a.days[dk];
    }
    bump(a.total, unit, n);
    if (opened && ss.length > 1) {
      // a new session is a natural chunk boundary for the mark log
      if (markBuf[proj.id] && markBuf[proj.id].list.length) flushMarks(proj.id);
    }
    return last;
  }

  function counted(ev) {
    if (!ev || typeof ev !== 'object') return null;
    var proj = project(str(ev.projectId, ''));
    if (!proj) return null;
    var n = typeof ev.n === 'number' ? ev.n : parseFloat(ev.n);
    if (!isFinite(n) || !n) return null;
    n = Math.max(-1e7, Math.min(1e7, Math.round(n)));
    if (!n) return null;
    var unit = unitName(ev.unit);
    var part = ev.part === undefined || ev.part === null ? '' : safeName(String(ev.part), '').slice(0, 60);
    var at = typeof ev.at === 'number' && isFinite(ev.at) && ev.at > 0 ? ev.at : now();
    var sess = recordCount(proj, n, unit, part, at);
    save();
    var out = {
      projectId: proj.id, n: n,
      total: typeof ev.total === 'number' && isFinite(ev.total) ? ev.total : null,
      unit: unit, part: part || null, at: at,
      origin: ev.origin === 'counter' ? 'counter' : 'craft',
      session: sess ? sessionCopy(sess) : null
    };
    emit(countSubs, out);
    return out;
  }

  /** The crochet / knitting counter's own work (tapStitch, tapRow …). */
  function counterCounted(proj, prt, n, unit, total) {
    if (!proj || !prt) return;
    var sess = recordCount(proj, n, unit, prt.name, now());
    if (!countSubs.length) return;
    emit(countSubs, {
      projectId: proj.id, n: n, total: typeof total === 'number' ? total : null, unit: unit,
      part: prt.name, at: now(), origin: 'counter', session: sess ? sessionCopy(sess) : null
    });
  }

  function onCount(fn) { return subscribe(countSubs, fn); }

  function activityOf(id) {
    var p = project(id);
    var a = p && p.activity;
    if (!a) return { sessions: [], days: {}, total: {} };
    return a;
  }

  function mainUnit(a) {
    var best = null, bv = -1;
    for (var k in a.total) if (a.total[k] > bv) { bv = a.total[k]; best = k; }
    return best || 'unit';
  }

  function trimmedMean(xs) {
    if (!xs.length) return null;
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var cut = s.length >= 5 ? Math.floor(s.length * 0.1) : 0;
    var t = s.slice(cut, s.length - cut);
    var sum = 0;
    for (var i = 0; i < t.length; i++) sum += t[i];
    return sum / t.length;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return null;
    var pos = (sorted.length - 1) * q;
    var lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /** Pace, streak and a ≈ finish range from the activity log. */
  function pace(id, opts) {
    opts = opts || {};
    var a = activityOf(id);
    var unit = opts.unit ? unitName(opts.unit) : mainUnit(a);
    var t = now();
    var out = {
      unit: unit, sessions: a.sessions.length, perHour: null, perDay: null, today: 0,
      streak: 0, lastAt: null, daysSinceLast: null, finish: null
    };
    var rates = [];
    for (var i = a.sessions.length - 1; i >= 0 && rates.length < 20; i--) {
      var s = a.sessions[i];
      var dur = s.e - s.s;
      var n = s.c[unit] || 0;
      if (dur >= 120000 && n > 0) rates.push(n / (dur / 3600000));
    }
    out.perHour = rates.length ? Math.round(trimmedMean(rates) * 10) / 10 : null;
    var today = dayKeyNow();
    out.today = (a.days[today] && a.days[today][unit]) || 0;
    var since = dayKey(t - 27 * 86400000);
    var worked = [];
    for (var d in a.days) if (d >= since && a.days[d][unit] > 0) worked.push(a.days[d][unit]);
    if (worked.length) {
      var sum = 0;
      for (var w = 0; w < worked.length; w++) sum += worked[w];
      out.perDay = Math.round(sum / worked.length * 10) / 10;
    }
    // streak: consecutive days with work, ending today (or yesterday)
    var day = new Date(t);
    day.setHours(12, 0, 0, 0);
    if (!out.today) day = new Date(day.getTime() - 86400000);
    for (var k = 0; k < 3650; k++) {
      var key = dayKey(day.getTime());
      if (!(a.days[key] && a.days[key][unit] > 0)) break;
      out.streak++;
      day = new Date(day.getTime() - 86400000);
    }
    var last = a.sessions[a.sessions.length - 1];
    if (last) {
      out.lastAt = last.e;
      out.daysSinceLast = Math.max(0, Math.floor((t - last.e) / 86400000));
    }
    var remaining = typeof opts.remaining === 'number' && isFinite(opts.remaining) ? opts.remaining : 0;
    if (remaining > 0 && a.sessions.length >= 5 && worked.length) {
      var sorted = worked.slice().sort(function (x, y) { return x - y; });
      // how many of the last 28 calendar days had work (at least one)
      var frac = Math.max(1, worked.length) / 28;
      var firstDay = Object.keys(a.days).sort()[0];
      if (firstDay && firstDay > since) {
        var span = Math.max(1, Math.round((t - new Date(firstDay + 'T12:00:00').getTime()) / 86400000) + 1);
        frac = Math.min(1, worked.length / span);
      }
      var fast = quantile(sorted, 0.75) * frac, slow = quantile(sorted, 0.25) * frac;
      if (fast > 0 && slow > 0) {
        out.finish = {
          low: t + Math.ceil(remaining / fast) * 86400000,
          high: t + Math.ceil(remaining / slow) * 86400000,
          approx: true
        };
      }
    }
    return out;
  }

  function setGoal(id, goal) {
    var proj = project(id);
    if (!proj || !goal || typeof goal !== 'object') return null;
    var list = normalizeGoals([goal]);
    if (!list) return null;
    var g = list[0];
    snapshot(proj);
    var goals = Array.isArray(proj.goals) ? proj.goals : [];
    var at = -1;
    for (var i = 0; i < goals.length; i++) if (goals[i].id === g.id) at = i;
    if (at >= 0) goals[at] = g;
    else goals.push(g);
    if (goals.length > 20) goals.splice(0, goals.length - 20);
    proj.goals = goals;
    touch(proj);
    return g;
  }

  function removeGoal(id, goalId) {
    var proj = project(id);
    if (!proj || !Array.isArray(proj.goals)) return false;
    var keep = proj.goals.filter(function (g) { return g.id !== goalId; });
    if (keep.length === proj.goals.length) return false;
    snapshot(proj);
    if (keep.length) proj.goals = keep;
    else delete proj.goals;
    touch(proj);
    return true;
  }

  function goalStatus(id, opts) {
    var proj = project(id);
    if (!proj || !Array.isArray(proj.goals)) return [];
    var a = activityOf(id);
    var t = now();
    var today = dayKeyNow();
    return proj.goals.map(function (g) {
      if (g.kind === 'perDay') {
        var done = (a.days[today] && a.days[today][g.unit]) || 0;
        return { goal: g, done: done, target: g.n, met: done >= g.n };
      }
      var remaining = opts && typeof opts.remaining === 'number' ? opts.remaining
        : (typeof g.n === 'number' ? Math.max(0, g.n - (a.total[g.unit] || 0)) : null);
      var daysLeft = Math.max(1, Math.ceil((g.until - t) / 86400000));
      var out = { goal: g, done: a.total[g.unit] || 0, target: g.n === undefined ? null : g.n,
        remaining: remaining, daysLeft: g.until > t ? daysLeft : 0, met: remaining === 0 };
      if (remaining !== null && remaining > 0) out.perDayNeeded = Math.ceil(remaining / daysLeft);
      return out;
    });
  }

  /* -- mark log (04 X3): varint deltas in BlobStore, never in localStorage -- */

  var MARK_FLUSH_MS = 60000;
  var markBuf = Object.create(null);   // id -> { list: [i, d, i, d …], at, timer, seq }

  function logMarks(id, list) {
    var p = project(id);
    if (!p || !Array.isArray(list) || !list.length) return false;
    var m = markBuf[p.id] || (markBuf[p.id] = { list: [], at: 0, timer: null, seq: null });
    if (!m.list.length) m.at = now();
    for (var i = 0; i < list.length && m.list.length < 400000; i++) {
      var it = list[i];
      var idx = Array.isArray(it) ? it[0] : it;
      var d = Array.isArray(it) ? it[1] : 1;
      if (typeof idx !== 'number' || idx < 0 || idx > 1e8 || idx !== Math.floor(idx)) continue;
      m.list.push(idx, d ? 1 : 0);
    }
    if (!m.timer && m.list.length) {
      m.timer = setTimeout(function () { m.timer = null; flushMarks(p.id); }, MARK_FLUSH_MS);
    }
    return true;
  }

  function pushVarint(out, v) {
    while (v >= 128) { out.push((v % 128) + 128); v = Math.floor(v / 128); }
    out.push(v);
  }

  function encodeMarks(at, list) {
    var out = [1];
    pushVarint(out, at);
    pushVarint(out, list.length / 2);
    var prev = 0;
    for (var i = 0; i < list.length; i += 2) {
      var delta = list[i] - prev;
      prev = list[i];
      var zz = delta >= 0 ? delta * 2 : -delta * 2 - 1;
      pushVarint(out, zz * 2 + list[i + 1]);
    }
    var u8 = new Uint8Array(out.length);
    for (var j = 0; j < out.length; j++) u8[j] = out[j];
    return u8;
  }

  function decodeMarks(u8) {
    var pos = 0;
    function rd() {
      var v = 0, mul = 1, b;
      do {
        if (pos >= u8.length) throw new Error('short');
        b = u8[pos++];
        v += (b & 127) * mul;
        mul *= 128;
      } while (b >= 128);
      return v;
    }
    if (u8[pos++] !== 1) throw new Error('version');
    var at = rd();
    var n = rd();
    var marks = [];
    var prev = 0;
    for (var i = 0; i < n; i++) {
      var v = rd();
      var d = v % 2;
      var zz = (v - d) / 2;
      var delta = zz % 2 === 0 ? zz / 2 : -(zz + 1) / 2;
      prev += delta;
      marks.push([prev, d]);
    }
    return { at: at, marks: marks };
  }

  function nextMarkSeq(B, id, m) {
    if (m.seq !== null) return Promise.resolve(m.seq);
    return B.keys('p:' + id + ':marks:').then(function (keys) {
      var max = 0;
      keys.forEach(function (k) { var n = parseInt(k.slice(k.lastIndexOf(':') + 1), 10); if (n > max) max = n; });
      m.seq = max + 1;
      return m.seq;
    });
  }

  function flushMarks(id) {
    var m = markBuf[id];
    if (typeof Promise !== 'function') return null;
    if (!m || !m.list.length) return Promise.resolve(0);
    if (m.timer) { clearTimeout(m.timer); m.timer = null; }
    var B = blobStore();
    if (!B || typeof B.putManyResult !== 'function') return Promise.resolve(0);
    var list = m.list;
    var at = m.at;
    m.list = [];
    var job = (m.flushing || Promise.resolve()).then(function () {
      return nextMarkSeq(B, id, m);
    }).then(function (seq) {
      m.seq = seq + 1;
      return B.putManyResult([{ key: 'p:' + id + ':marks:' + seq, value: encodeMarks(at, list) }]);
    }).then(function (res) {
      if (res && res.ok) return list.length / 2;
      // keep them for the next try, in order
      m.list = list.concat(m.list);
      m.at = at;
      m.seq = null;
      emitHeavy(id, 'failed', { error: (res && res.error) || 'UnknownError', what: 'marks' });
      return 0;
    }, function () { m.list = list.concat(m.list); m.seq = null; return 0; });
    m.flushing = job;
    return job;
  }

  function flushAllMarks() {
    return Promise.all(Object.keys(markBuf).map(flushMarks));
  }

  function blobBytes(b) {
    if (!b) return Promise.resolve(null);
    if (typeof b.arrayBuffer === 'function') return b.arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () { resolve(new Uint8Array(fr.result)); };
      fr.onerror = function () { resolve(null); };
      fr.readAsArrayBuffer(b);
    });
  }

  function readMarks(id) {
    var B = blobStore();
    if (!B || typeof Promise !== 'function') return Promise.resolve([]);
    var pre = 'p:' + id + ':marks:';
    return flushMarks(id).then(function () { return B.entries(pre); }).then(function (list) {
      list.sort(function (a, b) {
        return parseInt(a.key.slice(pre.length), 10) - parseInt(b.key.slice(pre.length), 10);
      });
      return Promise.all(list.map(function (e) { return blobBytes(e.blob); })).then(function (bufs) {
        var out = [];
        for (var i = 0; i < bufs.length; i++) {
          if (!bufs[i]) continue;
          try { out.push(decodeMarks(bufs[i])); } catch (e) { /* a damaged chunk is skipped */ }
        }
        return out;
      });
    });
  }

  try {
    if (window.addEventListener) {
      window.addEventListener('pagehide', function () { flushAllMarks(); }, false);
      window.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flushAllMarks();
      }, false);
    }
  } catch (e) { /* no window events */ }

  /* ---- K4: step edits and notes ---------------------------------------- */

  function stepNorm(text) {
    return str(text, '').toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);
  }

  function stepKey(text) { return 's' + hash32(stepNorm(text)); }

  function stepKeys(texts) {
    var seen = Object.create(null);
    return (Array.isArray(texts) ? texts : []).map(function (t) {
      var k = stepKey(t);
      seen[k] = (seen[k] || 0) + 1;
      return seen[k] > 1 ? k + '~' + seen[k] : k;
    });
  }

  function setStepField(id, key, field, value, cap) {
    var proj = project(id);
    if (!proj || !STEP_KEY_RE.test(str(key, ''))) return null;
    var v = typeof value === 'string' ? value.replace(BIDI_RE, '').slice(0, cap) : '';
    var cur = proj.overlay && proj.overlay.steps && proj.overlay.steps[key];
    if (!v.trim() && !(cur && cur[field])) return cur || null;
    if (cur && cur[field] === v) return cur;
    snapshot(proj);
    if (!proj.overlay || !proj.overlay.steps) proj.overlay = { steps: {} };
    var e = proj.overlay.steps[key] || {};
    if (v.trim()) e[field] = v;
    else delete e[field];
    e.at = now();
    if (!e.text && !e.note) delete proj.overlay.steps[key];
    else proj.overlay.steps[key] = e;
    if (!Object.keys(proj.overlay.steps).length) delete proj.overlay;
    touch(proj);
    return proj.overlay ? proj.overlay.steps[key] || null : null;
  }

  function setStepEdit(id, key, text) { return setStepField(id, key, 'text', text, 4000); }
  function setStepNote(id, key, note) { return setStepField(id, key, 'note', note, 2000); }

  function stepOverlay(id) {
    var p = project(id);
    return (p && p.overlay && p.overlay.steps) || {};
  }

  function applyStepOverlay(id, texts) {
    var steps = stepOverlay(id);
    var list = Array.isArray(texts) ? texts : [];
    var keys = stepKeys(list);
    var used = Object.create(null);
    var rows = keys.map(function (k, i) {
      var o = steps[k];
      used[k] = true;
      return {
        key: k, printed: str(list[i], ''),
        text: o && o.text ? o.text : str(list[i], ''),
        edited: !!(o && o.text), note: o && o.note ? o.note : ''
      };
    });
    var orphans = [];
    Object.keys(steps).forEach(function (k) {
      if (!used[k]) orphans.push({ key: k, text: steps[k].text || '', note: steps[k].note || '' });
    });
    return { rows: rows, orphans: orphans };
  }

  /* ---- K5: profile, craft settings, settings in a backup ---------------- */

  function lengthUnit(u, dflt) {
    var s = str(u, '').trim().toLowerCase();
    if (s === 'cm' || s === 'in') return s;
    if (s === 'inch' || s === 'inches' || s === '"') return 'in';
    return dflt;
  }

  function localeUnit() {
    try {
      var lang = String((window.navigator && (window.navigator.language || '')) || '');
      if (/^en-(US|LR|MM)$/i.test(lang)) return 'in';
    } catch (e) { /* fall through */ }
    return 'cm';
  }

  function convertLength(v, from, to) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return null;
    var f = str(from, '').toLowerCase(), t = str(to, '').toLowerCase();
    var cm = f === 'in' ? n * 2.54 : (f === 'mm' ? n / 10 : n);
    var out = t === 'in' ? cm / 2.54 : (t === 'mm' ? cm * 10 : cm);
    return Math.round(out * 1000) / 1000;
  }

  function normalizeProfile(raw) {
    raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    var units = raw.units && typeof raw.units === 'object' ? raw.units : {};
    var out = { units: { length: lengthUnit(units.length, localeUnit()) }, measurements: {}, floss: {}, fabric: [] };
    var m = raw.measurements && typeof raw.measurements === 'object' && !Array.isArray(raw.measurements) ? raw.measurements : {};
    var mk = Object.keys(m);
    for (var i = 0, n = 0; i < mk.length && n < 100; i++) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(mk[i])) continue;
      var e = m[mk[i]];
      if (!e || typeof e !== 'object') continue;
      var unit = str(e.unit, '').toLowerCase();
      var val = typeof e.value === 'number' ? e.value : parseFloat(e.value);
      if (unit === 'mm') { val = val / 10; unit = 'cm'; }
      unit = lengthUnit(unit, null);
      if (!unit || !isFinite(val) || val <= 0 || val > 10000) continue;
      out.measurements[mk[i]] = { value: Math.round(val * 1000) / 1000, unit: unit, at: clampInt(e.at, 0, 1e15, 0) };
      n++;
    }
    var fl = raw.floss && typeof raw.floss === 'object' && !Array.isArray(raw.floss) ? raw.floss : {};
    var bk = Object.keys(fl);
    for (var b = 0, nb = 0; b < bk.length && nb < 20; b++) {
      var brand = bk[b].trim().toLowerCase();
      if (!/^[a-z0-9 _-]{1,30}$/.test(brand) || !fl[bk[b]] || typeof fl[bk[b]] !== 'object') continue;
      var rows = {};
      var ck = Object.keys(fl[bk[b]]);
      for (var c = 0, nc = 0; c < ck.length && nc < 3000; c++) {
        var code = ck[c].trim();
        if (!/^[A-Za-z0-9._ -]{1,20}$/.test(code)) continue;
        var r = fl[bk[b]][ck[c]];
        if (typeof r === 'number') r = { owned: r };
        if (!r || typeof r !== 'object') continue;
        var owned = typeof r.owned === 'number' ? r.owned : parseFloat(r.owned);
        if (!isFinite(owned) || owned <= 0) continue;
        var row = { owned: Math.min(9999, Math.round(owned * 4) / 4), at: clampInt(r.at, 0, 1e15, 0) };
        if (typeof r.note === 'string' && r.note.trim()) row.note = r.note.replace(BIDI_RE, '').slice(0, 200);
        rows[code] = row;
        nc++;
      }
      if (Object.keys(rows).length) { out.floss[brand] = rows; nb++; }
    }
    if (Array.isArray(raw.fabric)) {
      var seen = Object.create(null);
      for (var f = 0; f < raw.fabric.length && out.fabric.length < 500; f++) {
        var fb = normalizeFabric(raw.fabric[f]);
        if (!fb || seen[fb.id]) continue;
        seen[fb.id] = true;
        out.fabric.push(fb);
      }
    }
    return out;
  }

  function optNum(v, lo, hi) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n) || n < lo || n > hi) return null;
    return Math.round(n * 1000) / 1000;
  }

  function normalizeFabric(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var out = {
      id: str(raw.id, '').slice(0, 60) || uid(),
      kind: safeName(raw.kind, 'fabric').slice(0, 30),
      unit: lengthUnit(raw.unit, 'cm'),
      qty: clampInt(raw.qty, 0, 999, 1),
      at: clampInt(raw.at, 0, 1e15, 0) || now()
    };
    var count = optNum(raw.count, 1, 60);
    if (count !== null) out.count = count;
    var color = safeName(raw.color, '').slice(0, 40);
    if (color) out.color = color;
    var w = optNum(raw.w, 0.1, 100000), h = optNum(raw.h, 0.1, 100000);
    if (w !== null) out.w = w;
    if (h !== null) out.h = h;
    if (typeof raw.note === 'string' && raw.note.trim()) out.note = raw.note.replace(BIDI_RE, '').slice(0, 200);
    return out;
  }

  function profile() {
    var s = settings();
    if (!s.profile || typeof s.profile !== 'object') s.profile = normalizeProfile(null);
    return s.profile;
  }

  function setProfile(patch) {
    if (!patch || typeof patch !== 'object') return profile();
    var cur = profile();
    var next = {
      units: patch.units !== undefined ? patch.units : cur.units,
      measurements: patch.measurements !== undefined ? patch.measurements : cur.measurements,
      floss: patch.floss !== undefined ? patch.floss : cur.floss,
      fabric: patch.fabric !== undefined ? patch.fabric : cur.fabric
    };
    settings().profile = normalizeProfile(next);
    save();
    return settings().profile;
  }

  function setMeasurement(key, value, unit) {
    var k = str(key, '');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(k)) return null;
    var pr = profile();
    var val = typeof value === 'number' ? value : parseFloat(value);
    var u = str(unit, '').toLowerCase();
    if (u === 'mm') { val = val / 10; u = 'cm'; }
    u = lengthUnit(u, pr.units.length);
    if (!isFinite(val) || val <= 0 || val > 10000) {
      if (value === null || value === '' || value === undefined) { delete pr.measurements[k]; save(); }
      return null;
    }
    pr.measurements[k] = { value: Math.round(val * 1000) / 1000, unit: u, at: now() };
    save();
    return pr.measurements[k];
  }

  function measurement(key, unit) {
    var pr = profile();
    var e = pr.measurements[str(key, '')];
    if (!e) return null;
    var u = str(unit, '').toLowerCase();
    if (!u) return e.value;
    return convertLength(e.value, e.unit, u);
  }

  function removeMeasurement(key) {
    var pr = profile();
    if (!pr.measurements[str(key, '')]) return false;
    delete pr.measurements[str(key, '')];
    save();
    return true;
  }

  function flossBrand(b) { return str(b, '').trim().toLowerCase(); }

  function flossOwned(brand, code) {
    var fl = profile().floss[flossBrand(brand)];
    var r = fl && fl[str(code, '').trim()];
    return r ? r.owned : 0;
  }

  function setFlossOwned(brand, code, owned, note) {
    var b = flossBrand(brand), c = str(code, '').trim();
    if (!/^[a-z0-9 _-]{1,30}$/.test(b) || !/^[A-Za-z0-9._ -]{1,20}$/.test(c)) return null;
    var pr = profile();
    var n = typeof owned === 'number' ? owned : parseFloat(owned);
    if (!isFinite(n) || n <= 0) {
      if (pr.floss[b]) {
        delete pr.floss[b][c];
        if (!Object.keys(pr.floss[b]).length) delete pr.floss[b];
      }
      save();
      return 0;
    }
    if (!pr.floss[b]) pr.floss[b] = {};
    var row = { owned: Math.min(9999, Math.round(n * 4) / 4), at: now() };
    var keep = note !== undefined ? note : (pr.floss[b][c] && pr.floss[b][c].note);
    if (typeof keep === 'string' && keep.trim()) row.note = keep.replace(BIDI_RE, '').slice(0, 200);
    pr.floss[b][c] = row;
    save();
    return row.owned;
  }

  function adjustFloss(brand, code, delta) {
    var n = flossOwned(brand, code) + (Number(delta) || 0);
    return setFlossOwned(brand, code, Math.max(0, n)) || 0;
  }

  function flossStash() {
    var out = [];
    var fl = profile().floss;
    Object.keys(fl).sort().forEach(function (b) {
      Object.keys(fl[b]).forEach(function (c) {
        var r = fl[b][c];
        out.push({ brand: b, code: c, owned: r.owned, note: r.note || '', at: r.at });
      });
    });
    return out;
  }

  /** Who gets the floss: projects in priority order take what they need. Computed, never stored. */
  function flossAllocation(list) {
    var left = Object.create(null);
    var fl = profile().floss;
    var out = {};
    (Array.isArray(list) ? list : []).forEach(function (item) {
      if (!item || !item.projectId || !item.needs || typeof item.needs !== 'object') return;
      var mine = out[item.projectId] = out[item.projectId] || {};
      Object.keys(item.needs).forEach(function (brand) {
        var b = flossBrand(brand);
        var needs = item.needs[brand];
        if (!needs || typeof needs !== 'object') return;
        Object.keys(needs).forEach(function (code) {
          var need = Math.max(0, Number(needs[code]) || 0);
          var k = b + '\u0000' + code;
          if (!(k in left)) left[k] = fl[b] && fl[b][code] ? fl[b][code].owned : 0;
          var give = Math.min(need, left[k]);
          left[k] -= give;
          if (!mine[b]) mine[b] = {};
          mine[b][code] = { need: need, allocated: give, short: Math.max(0, need - give) };
        });
      });
    });
    return out;
  }

  function addFabric(piece) {
    var f = normalizeFabric(piece);
    if (!f) return null;
    var pr = profile();
    pr.fabric = pr.fabric.filter(function (x) { return x.id !== f.id; });
    pr.fabric.push(f);
    save();
    return f;
  }

  function updateFabric(id, patch) {
    var pr = profile();
    for (var i = 0; i < pr.fabric.length; i++) {
      if (pr.fabric[i].id !== id) continue;
      var merged = {};
      for (var k in pr.fabric[i]) merged[k] = pr.fabric[i][k];
      for (var k2 in (patch || {})) merged[k2] = patch[k2];
      merged.id = id;
      merged.at = now();
      var f = normalizeFabric(merged);
      if (!f) return null;
      pr.fabric[i] = f;
      save();
      return f;
    }
    return null;
  }

  function removeFabric(id) {
    var pr = profile();
    var n = pr.fabric.length;
    pr.fabric = pr.fabric.filter(function (x) { return x.id !== id; });
    if (pr.fabric.length !== n) save();
    return pr.fabric.length !== n;
  }

  function fabricStash() { return profile().fabric.slice(); }

  function normalizeOneCraftSettings(id, bag) {
    var c = crafts[id];
    var out = jsonObject(bag);
    var hook = c && c.settingsHook;
    if (hook && typeof hook.normalize === 'function') {
      try {
        var r = hook.normalize(out);
        if (r && typeof r === 'object' && !Array.isArray(r)) out = jsonObject(r);
      } catch (e) { /* keep the plain copy */ }
    }
    return out;
  }

  function craftDefaults(id) {
    var c = crafts[str(id, '')];
    var d = c && c.settingsHook && c.settingsHook.defaults;
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
  }

  function setCraftSettings(id, obj) {
    var key = str(id, '').trim();
    if (!key) return {};
    var s = settings();
    if (!s.crafts || typeof s.crafts !== 'object') s.crafts = {};
    s.crafts[key] = normalizeOneCraftSettings(key, obj);
    save();
    return craftSettings(key);
  }

  /* Settings a backup may bring back, and the words the preview uses. */
  var RESTORE_SETTINGS = [
    ['theme', 'Theme'], ['haptics', 'Vibration'], ['sounds', 'Sounds'], ['keepAwake', 'Keep the screen awake'],
    ['autoAdvance', 'Move on at the row total'], ['liveDiagram', 'The 3D piece in the button']
  ];

  function mergeProfiles(local, incoming, how) {
    if (how === 'replace') return normalizeProfile(incoming);
    var a = normalizeProfile(local), b = normalizeProfile(incoming);
    var out = normalizeProfile(local);
    out.units = b.units;
    Object.keys(b.measurements).forEach(function (k) {
      var x = a.measurements[k], y = b.measurements[k];
      if (!x || (y.at || 0) >= (x.at || 0)) out.measurements[k] = y;
    });
    Object.keys(b.floss).forEach(function (br) {
      if (!out.floss[br]) out.floss[br] = {};
      Object.keys(b.floss[br]).forEach(function (code) {
        var x = out.floss[br][code], y = b.floss[br][code];
        if (!x || (y.at || 0) >= (x.at || 0)) out.floss[br][code] = y;
      });
    });
    var byId = Object.create(null);
    out.fabric.forEach(function (f, i) { byId[f.id] = i; });
    b.fabric.forEach(function (f) {
      if (f.id in byId) {
        if ((f.at || 0) >= (out.fabric[byId[f.id]].at || 0)) out.fabric[byId[f.id]] = f;
      } else {
        out.fabric.push(f);
      }
    });
    return out;
  }

  function describeProfile(p) {
    if (!p) return 'none';
    var pr = normalizeProfile(p);
    var bits = [];
    var m = Object.keys(pr.measurements).length;
    var f = flossCount(pr);
    if (m) bits.push(m + ' measurement' + (m === 1 ? '' : 's'));
    if (f) bits.push(f + ' floss colour' + (f === 1 ? '' : 's'));
    if (pr.fabric.length) bits.push(pr.fabric.length + ' fabric piece' + (pr.fabric.length === 1 ? '' : 's'));
    return bits.join(', ') || 'empty';
  }

  function flossCount(pr) {
    var n = 0;
    for (var b in pr.floss) n += Object.keys(pr.floss[b]).length;
    return n;
  }

  /** Apply a backup's settings block to `s` (a live settings object). Returns the change list. */
  function applySettings(s, raw, how, dryRun) {
    var changes = [];
    if (!raw || typeof raw !== 'object' || how === 'skip') return changes;
    var target = dryRun ? JSON.parse(JSON.stringify(s)) : s;
    var inc = normalizeState({ settings: raw }).settings;
    RESTORE_SETTINGS.forEach(function (pair) {
      var k = pair[0];
      if (!(k in raw)) return;
      if (!sameJson(target[k], inc[k])) {
        changes.push({ key: k, label: pair[1], from: target[k], to: inc[k] });
        target[k] = inc[k];
      }
    });
    if (raw.crafts && typeof raw.crafts === 'object') {
      var ids = Object.keys(inc.crafts);
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var cur = target.crafts && target.crafts[id] ? target.crafts[id] : {};
        var next;
        if (how === 'replace') next = inc.crafts[id];
        else {
          next = jsonObject(cur);
          for (var k2 in inc.crafts[id]) next[k2] = inc.crafts[id][k2];
        }
        next = normalizeOneCraftSettings(id, next);
        if (!sameJson(cur, next)) {
          changes.push({ key: 'crafts.' + id, label: 'Settings for ' + id, from: cur, to: next });
          if (!target.crafts) target.crafts = {};
          target.crafts[id] = next;
        }
      }
    }
    if (raw.profile && typeof raw.profile === 'object') {
      var merged = mergeProfiles(target.profile, raw.profile, how);
      if (!sameJson(target.profile ? normalizeProfile(target.profile) : null, merged)) {
        changes.push({ key: 'profile', label: 'Your profile', from: describeProfile(target.profile), to: describeProfile(merged) });
        target.profile = merged;
      }
    }
    // tours and the welcome: what either side has seen stays seen
    var seen = (target.toursSeen || []).slice();
    (inc.toursSeen || []).forEach(function (t) { if (seen.indexOf(t) === -1) seen.push(t); });
    if (seen.length !== (target.toursSeen || []).length) {
      changes.push({ key: 'toursSeen', label: 'Guided tours already seen', from: (target.toursSeen || []).length, to: seen.length });
      target.toursSeen = seen;
    }
    if (inc.welcomed && !target.welcomed) target.welcomed = true;
    target.lastBackupAt = Math.max(clampInt(target.lastBackupAt, 0, 1e15, 0), inc.lastBackupAt || 0);
    target.touchDays = normalizeTouchDays((target.touchDays || []).concat(inc.touchDays || []));
    return changes;
  }

  function previewSettings(raw) {
    var present = !!(raw && raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings));
    if (!present) return { present: false, changes: [], count: 0 };
    var changes = applySettings(settings(), raw.settings, 'merge', true);
    return { present: true, changes: changes, count: changes.length };
  }

  /* ---- K6: storage report ---------------------------------------------- */

  function storageUsage() {
    var health = storageHealth();
    var out = {
      localBytes: health.bytesUsed, blobCount: null, blobBytes: null, heavyBytes: 0,
      quota: null, usage: null, persisted: null
    };
    Object.keys(hv).forEach(function (id) {
      var t = hv[id].table;
      tablePaths(t).forEach(function (p) { out.heavyBytes += t.fields[p].bytes || 0; });
    });
    if (typeof Promise !== 'function') return null;
    var B = window.BlobStore;
    var jobs = [];
    if (B && typeof B.usage === 'function') {
      jobs.push(B.usage().then(function (u) { if (u) { out.blobCount = u.count; out.blobBytes = u.bytes; } }, noop));
    }
    try {
      var st = window.navigator && window.navigator.storage;
      if (st && typeof st.estimate === 'function') {
        jobs.push(Promise.resolve(st.estimate()).then(function (e) {
          if (e) { out.quota = typeof e.quota === 'number' ? e.quota : null; out.usage = typeof e.usage === 'number' ? e.usage : null; }
        }, noop));
      }
      if (st && typeof st.persisted === 'function') {
        jobs.push(Promise.resolve(st.persisted()).then(function (p) { out.persisted = !!p; }, noop));
      }
    } catch (e) { /* the numbers stay null */ }
    return Promise.all(jobs).then(function () { return out; });
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  window.Store = {
    KEY: KEY,
    VERSION: VERSION,
    DEFAULT_CRAFT: DEFAULT_CRAFT,

    // crafts (the plugin contract — docs/CRAFTS.md)
    registerCraft: registerCraft,
    // wave H: one parser per craft (crochet → Patterns, knitting → Knits)
    registerCraftParser: registerCraftParser,
    parserFor: parserFor,
    craftOf: craftKeyOf,
    crafts: craftIds,
    craftDef: craftDef,
    updateCraftData: updateCraftData,
    summaryFor: summaryFor,
    craftSettings: craftSettings,
    setCraftSetting: setCraftSetting,

    // templates (v2 — data in state)
    templates: templates,
    template: template,
    saveTemplate: saveTemplate,
    deleteTemplate: deleteTemplate,
    resetTemplate: resetTemplate,
    templateFromProject: templateFromProject,

    // persistence
    load: load,
    save: save,
    flush: flush,
    writeNow: writeNow,
    getState: getState,
    settings: settings,
    setSetting: setSetting,
    // wave I (focus-mode): the per-project working mode, a device preference
    focusMode: focusMode,
    setFocusMode: setFocusMode,

    // persistence health (13 #1–#3, 09 #2/#4, 12 #1)
    saveFailed: saveFailed,
    lastSaveError: lastSaveError,
    onStorageError: onStorageError,
    storageHealth: storageHealth,
    wouldExceedQuota: wouldExceedQuota,
    isCorrupt: isCorrupt,
    corruptSnapshot: corruptSnapshot,
    corruptKey: corruptKey,
    acknowledgeCorrupt: acknowledgeCorrupt,
    revision: revision,
    writerId: writerId,
    conflict: conflict,
    conflictInfo: conflictInfo,
    onConflict: onConflict,
    onExternalChange: onExternalChange,
    resolveConflict: resolveConflict,
    requestPersist: requestPersist,
    backupDue: backupDue,
    backupStatus: backupStatus,
    snoozeBackupNag: snoozeBackupNag,

    // lookup
    projects: projects,
    project: project,
    part: part,
    activePart: activePart,

    // projects
    createProject: createProject,
    updateProject: updateProject,
    setStatus: setStatus,
    finishProject: finishProject,
    blockingParts: blockingParts,
    // wave G: size groups
    groupProgress: groupProgress,
    projectGroups: projectGroups,
    groupParts: groupParts,
    setActiveGroup: setActiveGroup,
    removeGroup: removeGroup,
    allPartsDone: function (projectOrId, group) {
      var pr = projectOrId && typeof projectOrId === 'object' ? projectOrId : project(projectOrId);
      return pr ? allPartsDone(pr, group) : false;
    },
    deleteProject: deleteProject,
    setActiveProject: setActiveProject,

    // parts
    addPart: addPart,
    updatePart: updatePart,
    deletePart: deletePart,
    setActivePart: setActivePart,
    resetPart: resetPart,
    makeCountImpact: makeCountImpact,
    importPatternSections: importPatternSections,
    applySuggestions: applySuggestions,
    // The target the importer (and a project made from a template) sets, so
    // the import preview can say the same number instead of re-deriving it.
    targetRowsFromText: targetRowsFromText,
    // wave F: size-once, count confidence, colour changes on the counter
    sizeNames: sizeNames,
    partSize: partSize,
    setProjectSize: setProjectSize,
    updatePartWithProjectSize: updatePartWithProjectSize,
    countReport: countReport,
    targetApprox: targetApprox,
    colorPlan: colorPlan,
    rowColorInfo: rowColorInfo,
    repeatTimes: repeatTimes,

    // counting
    tapStitch: tapStitch,
    tapStitches: tapStitches,   // wave K (knit-store): n stitches as one action
    untapStitch: untapStitch,
    resetStitches: resetStitches,
    tapRow: tapRow,
    untapRow: untapRow,
    jumpToRow: jumpToRow,

    // pattern bridge
    linesFor: linesFor,
    lineForRow: lineForRow,
    targetFor: targetFor,
    currentTarget: currentTarget,
    currentTargetInfo: currentTargetInfo,
    // wave I (group-readout): the repeat groups of the row being worked
    rowGroups: rowGroups,
    groupAt: groupAt,
    groupReadout: groupReadout,
    patternSummary: patternSummary,
    splitSections: splitSections,
    // wave H (knit-qa): the gauge an import would write (preview), never writing
    gaugeFromText: gaugeFromText,
    // wave H (knit-qa-2): the sizes a (part) text names, carried "Sizes:" line included
    sizesOfText: sizesOfText,
    sizeCount: sizeCount,
    setupLine: setupLine,
    countOf: countOf,
    isComputed: isComputed,
    notesOf: notesOf,
    repeatInfo: repeatInfo,

    // live 3D diagram
    diagramModel: diagramModel,
    partWorkMode: partWorkMode,
    rowWorkMode: rowWorkMode,
    partDialect: partDialect,
    partShape: partShape,
    roundDeviation: roundDeviation,
    yarnColorNames: yarnColorNames,
    yarnColorFor: yarnColorFor,
    hasYarnColor: hasYarnColor,
    setYarnColor: setYarnColor,
    MAIN_YARN: MAIN_YARN,
    MAIN_YARN_DEFAULT: MAIN_YARN_DEFAULT,

    // checklist / notes / history
    addChecklistItem: addChecklistItem,
    toggleChecklistItem: toggleChecklistItem,
    deleteChecklistItem: deleteChecklistItem,
    renameChecklistItem: renameChecklistItem,
    moveChecklistItem: moveChecklistItem,
    clearChecklist: clearChecklist,
    reloadChecklistFromTemplate: reloadChecklistFromTemplate,
    suggestChecklist: suggestChecklist,
    setNotes: setNotes,
    clearHistory: clearHistory,

    // timer
    toggleTimer: toggleTimer,
    elapsedMs: elapsedMs,
    stopAllTimers: stopAllTimers,

    // undo
    undo: undo,
    canUndo: canUndo,
    clearUndo: clearUndo,
    undoBytes: undoBytes,

    // backup
    exportJSON: exportJSON,
    importJSON: importJSON,
    previewImport: previewImport,
    canUndoImport: canUndoImport,
    undoImport: undoImport,
    MIGRATIONS: MIGRATIONS,
    // .thready container (12 #4 / #5)
    exportThready: exportThready,
    exportProjectJSON: exportProjectJSON,
    readBackupFile: readBackupFile,
    importPages: importPages,
    pagesIdle: pagesIdle,
    backupFileProblem: backupFileProblem,
    referencedProjectIds: referencedProjectIds,
    BACKUP_FILE_MAX_BYTES: BACKUP_FILE_MAX_BYTES,
    THREADY_FORMAT_VERSION: THREADY_FORMAT_VERSION,

    // wave K (shell-data; docs/wave-k/api/shell-data.md)
    setCraftHooks: setCraftHooks,
    templateDraft: templateDraft,
    TEMPLATE_CRAFTDATA_MAX: TEMPLATE_CRAFTDATA_MAX,
    setCraftSettings: setCraftSettings,
    profile: profile,
    setProfile: setProfile,
    setMeasurement: setMeasurement,
    measurement: measurement,
    removeMeasurement: removeMeasurement,
    convertLength: convertLength,
    flossOwned: flossOwned,
    setFlossOwned: setFlossOwned,
    adjustFloss: adjustFloss,
    flossStash: flossStash,
    flossAllocation: flossAllocation,
    addFabric: addFabric,
    updateFabric: updateFabric,
    removeFabric: removeFabric,
    fabricStash: fabricStash,
    heavyState: heavyState,
    whenReady: whenReady,
    hydrateAll: hydrateAll,
    heavyIdle: heavyIdle,
    heavyInfo: heavyInfo,
    onHeavy: onHeavy,
    discardMissingHeavy: discardMissingHeavy,
    heavyLastError: function () { return heavyLastError; },
    counted: counted,
    onCount: onCount,
    activity: activityOf,
    pace: pace,
    SESSION_IDLE_MS: SESSION_IDLE_MS,
    setGoal: setGoal,
    removeGoal: removeGoal,
    goalStatus: goalStatus,
    logMarks: logMarks,
    flushMarks: flushMarks,
    readMarks: readMarks,
    stepKey: stepKey,
    stepKeys: stepKeys,
    setStepEdit: setStepEdit,
    setStepNote: setStepNote,
    stepOverlay: stepOverlay,
    applyStepOverlay: applyStepOverlay,
    storageUsage: storageUsage,
    /** TEST ONLY: the heavy runtime and the diff helpers. */
    __heavy: {
      rt: function (id) { return hv[id] || null; },
      strDiff: strDiff, strPatch: strPatch,
      encodeMarks: encodeMarks, decodeMarks: decodeMarks,
      serializeState: function () { return serializeState(); },
      undoEntries: function () { return undoStack; }
    },

    // misc
    uid: uid,

    /**
     * TEST ONLY. Point the store at a different localStorage key so a test
     * page can run without borrowing (and racing for) the real one. Reloads
     * from the new key. Never call this from app code.
     */
    __setKeyForTests: function (key) {
      var k = str(key, '').trim();
      if (!k) return KEY;
      KEY = k;
      window.Store.KEY = k;
      state = null;
      undoStack.length = 0;
      undoBytesTotal = 0;
      preimportText = null;
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      Object.keys(hv).forEach(function (id) { if (hv[id].commitTimer) clearTimeout(hv[id].commitTimer); });
      load();
      return KEY;
    }
  };
  // wave H (knit-counter): gauge, side, markers, two at a time, short rows,
  // cables, lengths, glossary, charts - see "Knitting" above
  installKnitApi(window.Store);
})();
