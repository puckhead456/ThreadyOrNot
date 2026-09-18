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
  var lineCache = Object.create(null); // partId -> { key, lines }   (key = sizeIndex + ' ' + text)
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
    var entry = {
      id: id,
      normalize: typeof def.normalize === 'function' ? def.normalize : null,
      summary: typeof def.summary === 'function' ? def.summary : null,
      templates: []
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
      p.craftData = normalizeCraftData(id, p.craftData, p);
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
          placementNotes: str(p.placementNotes, '')
        });
      }
    }
    if (!parts.length) parts = [{ name: 'Main', makeCount: 1, patternText: '', placementNotes: '' }];

    var checklist = [];
    if (Array.isArray(t.checklist)) {
      for (var j = 0; j < t.checklist.length; j++) {
        var c = str(t.checklist[j], '').trim();
        if (c) checklist.push(c);
      }
    }

    var id = str(t.id, '') || uid();
    return {
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
        placementNotes: str(p.placementNotes, '')
      });
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
  function templateFromProject(projectId) {
    var proj = project(projectId);
    if (!proj) return null;
    return {
      id: '',
      name: (proj.name + ' template').trim(),
      emoji: proj.emoji,
      countMode: proj.countMode,
      groupSize: proj.groupSize,
      parts: proj.parts.map(function (p) {
        return {
          name: p.name,
          makeCount: p.makeCount,
          patternText: str(p.patternText, ''),
          placementNotes: str(p.placementNotes, '')
        };
      }),
      checklist: proj.checklist
        .map(function (c) { return str(c.text, '').trim(); })
        .filter(function (t) { return !!t; }),
      craft: proj.craft || DEFAULT_CRAFT,
      craftData: null,
      builtIn: false,
      updatedAt: now()
    };
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
      repeat: { enabled: false, startRow: 1, endRow: 1, times: 1 },
      alerts: [],
      placementNotes: '',
      patternText: '',
      sizeIndex: 0,
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
    return {
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
      repeat: {
        enabled: !!rep.enabled,
        startRow: clampInt(rep.startRow, 1, 999999, 1),
        endRow: clampInt(rep.endRow, 1, 999999, 1),
        times: clampInt(rep.times, 1, 9999, 1)
      },
      alerts: alerts,
      placementNotes: str(p.placementNotes, ''),
      patternText: str(p.patternText, ''),
      // v2: parts saved before multi-size support simply get size 0.
      sizeIndex: clampInt(p.sizeIndex, 0, 99, 0),
      // v3 (live diagram): saves from before it simply have nothing recorded.
      rowStitches: normalizeRowStitches(p.rowStitches, clampInt(p.row, 0, 999999, 0))
    };
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
        history.push({
          ts: clampInt(h.ts, 0, 1e15, 0),
          partId: str(h.partId, ''),
          partName: str(h.partName, ''),
          row: clampInt(h.row, 0, 999999, 0)
        });
      }
      if (history.length > HISTORY_CAP) history = history.slice(history.length - HISTORY_CAP);
    }

    var activePartId = str(p.activePartId, '');
    var found = false;
    for (var k = 0; k < parts.length; k++) if (parts[k].id === activePartId) found = true;
    if (!found) activePartId = parts[0].id;

    // Crafts: every save made before September 2026 is a crochet project.
    var craft = str(p.craft, '').trim() || DEFAULT_CRAFT;

    return {
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
      // Crafts: 'crochet' | 'crossstitch' | 'sewing' | anything a module registers.
      craft: craft,
      // Opaque to the shell — owned by the craft module, repaired by its normalize.
      craftData: normalizeCraftData(craft, p.craftData, p)
    };
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
        out[id] = jsonObject(v);
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
      text = JSON.stringify(state);
    } catch (e) {
      reportStorageError('unknown', e);
      return { ok: false, kind: 'unknown', error: e, retried: false, blocked: null };
    }

    try {
      ls().setItem(KEY, text);
      saveFailedFlag = false;
      lastStorageError = null;
      dirty = false;
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
        return { ok: true, kind: null, error: null, retried: true, blocked: null };
      } catch (e2) {
        var kind = classifyStorageError(e2);
        reportStorageError(kind, e2);
        return { ok: false, kind: kind, error: e2, retried: true, blocked: null };
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
    state = normalizeState(raw);
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
    var data = deepCopy(proj);
    var bytes = 0;
    try { bytes = JSON.stringify(data).length; } catch (e) { bytes = 0; }
    undoStack.push({
      id: proj.id,
      index: list.indexOf(proj),
      data: data,
      bytes: bytes,
      activeProjectId: getState().activeProjectId
    });
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
   * Pattern bridge (defensive — window.Patterns may be missing)
   * ------------------------------------------------------------------ */

  function patternsApi() {
    return window.Patterns && typeof window.Patterns === 'object' ? window.Patterns : null;
  }

  function sizeIndexOf(prt) {
    return prt && typeof prt.sizeIndex === 'number' && prt.sizeIndex > 0 ? Math.floor(prt.sizeIndex) : 0;
  }

  function linesFor(prt) {
    if (!prt) return [];
    var text = prt.patternText || '';
    if (!text.replace(/\s/g, '')) return [];
    var size = sizeIndexOf(prt);
    var key = size + ' ' + text;
    var cached = lineCache[prt.id];
    if (cached && cached.key === key) return cached.lines;
    var lines = [];
    var api = patternsApi();
    if (api && typeof api.parse === 'function') {
      try {
        var out = api.parse(text, { size: size });
        if (Array.isArray(out)) lines = out;
      } catch (e) {
        lines = [];
      }
    }
    lineCache[prt.id] = { key: key, lines: lines };
    return lines;
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
    var api = patternsApi();
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

  /** Sections of a raw pattern text, for the import flow. */
  function splitSections(text) {
    var api = patternsApi();
    if (!text || !String(text).replace(/\s/g, '')) return [];
    if (api && typeof api.splitSections === 'function') {
      try {
        var out = api.splitSections(String(text));
        if (Array.isArray(out)) {
          return out.map(function (s) {
            return {
              name: str(s && s.name, ''),
              makeCount: clampInt(s && s.makeCount, 1, 99, 1),
              text: str(s && s.text, ''),
              // "Where things go": the assembly prose the parser handed to
              // this part, plus its own placing sentences. '' when there is
              // none.
              placement: str(s && s.placement, '')
            };
          });
        }
      } catch (e) {
        /* fall through */
      }
    }
    // v1 parser (or a failure): one nameless section with everything in it.
    return [{ name: '', makeCount: 1, text: String(text), placement: '' }];
  }

  /** Parse a loose block of pattern text without touching any part's cache. */
  function parseLoose(text) {
    var api = patternsApi();
    if (!api || typeof api.parse !== 'function') return [];
    if (!text || !String(text).replace(/\s/g, '')) return [];
    try {
      var out = api.parse(String(text));
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
   * @returns {number|null}
   */
  function targetRowsFromText(text) {
    var lines = parseLoose(text);
    if (!lines.length) return null;
    var seen = Object.create(null);
    var max = 0;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (!l || l.kind !== 'row') continue;
      var a = typeof l.row === 'number' && isFinite(l.row) ? Math.floor(l.row) : 0;
      if (a < 1) continue;
      var b = typeof l.rowEnd === 'number' && isFinite(l.rowEnd) && l.rowEnd >= a ? Math.floor(l.rowEnd) : a;
      if (b - a > 9999) continue;
      for (var r = a; r <= b; r++) {
        seen[r] = true;
        if (r > max) max = r;
      }
    }
    if (max < 2) return null;
    for (var k = 1; k <= max; k++) if (!seen[k]) return null;
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
  function sectionImportKey(name, text) {
    var first = '';
    var rows = str(text, '').split(/\r?\n/);
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i].replace(/\s+/g, ' ').trim();
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
   */
  function suggestChecklist(text) {
    var out = [];
    var seen = Object.create(null);

    function add(raw, strong, next) {
      if (out.length >= CHECKLIST_MAX) return;
      var t = tidyStep(stripTrailingCount(raw));
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

    var api = patternsApi();
    var lines = null;
    if (api && typeof api.parse === 'function') {
      try { lines = api.parse(raw); } catch (e) { lines = null; }
    }

    if (lines && lines.length) {
      var assembly = Object.create(null);
      var secs = (lines.meta && Array.isArray(lines.meta.sections)) ? lines.meta.sections : [];
      secs.forEach(function (s) {
        if (s && CHECKLIST_SECTION_RE.test(str(s.name, ''))) assembly[s.index] = true;
      });
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        if (!l) continue;
        var notes = Array.isArray(l.notes) ? l.notes : [];
        for (var n = 0; n < notes.length; n++) {
          if (CHECKLIST_START_RE.test(tidyStep(notes[n]))) add(notes[n], true, notes[n + 1]);
        }
        if (l.photo || l.kind === 'header' || l.kind === 'row' || l.kind === 'repeat') continue;
        var t = tidyStep(l.text);
        if (!t) continue;
        var nxt = lines[i + 1] && !lines[i + 1].photo ? str(lines[i + 1].text, '') : '';
        // An explicit sewing-up verb is a strong signal; living in an Assembly
        // section is a weak one.
        if (CHECKLIST_START_RE.test(t)) add(l.text, true, nxt);
        else if (assembly[l.section]) add(l.text, false, nxt);
      }
      return out;
    }

    // No parser (or it threw): a plain line scan still finds most of them.
    var plain = raw.split(/\r?\n/);
    for (var p = 0; p < plain.length; p++) {
      var pt = tidyStep(plain[p]);
      if (pt && CHECKLIST_START_RE.test(pt)) add(plain[p], true, plain[p + 1]);
    }
    return out;
  }

  function lineForRow(prt, rowNumber) {
    var lines = linesFor(prt);
    var api = patternsApi();
    if (!lines.length || !api || typeof api.lineFor !== 'function') return null;
    try {
      return api.lineFor(lines, rowNumber) || null;
    } catch (e) {
      return null;
    }
  }

  function targetFor(prt, rowNumber) {
    var lines = linesFor(prt);
    var api = patternsApi();
    if (!lines.length || !api || typeof api.targetFor !== 'function') return null;
    try {
      var t = api.targetFor(lines, rowNumber);
      if (typeof t === 'number' && isFinite(t) && t > 0) return Math.floor(t);
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
  function allPartsDone(proj) {
    var any = false;
    for (var i = 0; i < proj.parts.length; i++) {
      var p = proj.parts[i];
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
  function blockingParts(projectOrId) {
    var out = [];
    var proj = projectOrId && typeof projectOrId === 'object' ? projectOrId : project(projectOrId);
    if (!proj || !Array.isArray(proj.parts)) return out;
    for (var i = 0; i < proj.parts.length; i++) {
      var p = proj.parts[i];
      if (!p.targetRows) {
        if (!p.row && !p.stitch && !p.piecesDone) out.push(p.name);
        continue;
      }
      if (p.piecesDone < p.makeCount) out.push(p.name);
    }
    return out;
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
    pushHistory(proj, prt);

    if (prt.targetRows && prt.row >= prt.targetRows) {
      if (prt.piecesDone + 1 < prt.makeCount) {
        prt.piecesDone += 1;
        prt.row = 0;
        // The next piece starts from nothing, and so does its diagram.
        prt.rowStitches = [0];
        return {
          event: 'pieceDone',
          piecesDone: prt.piecesDone,
          makeCount: prt.makeCount,
          partName: prt.name
        };
      }
      prt.piecesDone = prt.makeCount;
      if (allPartsDone(proj)) return { event: 'projectDone', partName: prt.name };
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
    if (target && s >= target && settings().autoAdvance) {
      var res = completeRow(proj, prt);
      // A finished part pins its stitch count at the target instead of
      // creeping past it forever (13 #6).
      if (res.event === 'alreadyDone') prt.stitch = target;
      touch(proj);
      // Plain row completions report as 'rowAuto'; bigger milestones win.
      if (res.event === 'row') return { event: 'rowAuto', row: prt.row };
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
    if (g > 0 && s % g === 0) return { event: 'group', stitch: s, group: s / g };
    return { event: 'stitch', stitch: s };
  }

  function untapStitch(projectId, partId) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt) return { event: 'none' };
    snapshot(proj);
    prt.stitch = Math.max(0, prt.stitch - 1);
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
    prt.row = Math.max(0, clampInt(rowNumber, 1, 999999, 1) - 1);
    prt.stitch = 0;
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

    var proj = normalizeProject({
      id: uid(),
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
        return made;
      }),
      checklist: tpl.checklist.map(function (t) { return { id: uid(), text: t, done: false }; }),
      history: [],
      craft: craft,
      craftData: seed
    });
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
  function updateCraftData(projectId, patchOrFn) {
    var proj = project(projectId);
    if (!proj) return null;
    snapshot(proj);
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
    touch(proj);
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
    proj.parts.push(prt);
    proj.activePartId = prt.id;
    touch(proj);
    return prt;
  }

  function updatePart(projectId, partId, patch) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt || !patch) return null;
    snapshot(proj);
    if (typeof patch.name === 'string') prt.name = safeName(patch.name, prt.name);
    if (typeof patch.importKey === 'string') prt.importKey = patch.importKey;
    if (patch.makeCount !== undefined) {
      prt.makeCount = clampInt(patch.makeCount, 1, 99, prt.makeCount);
      if (prt.piecesDone > prt.makeCount) prt.piecesDone = prt.makeCount;
    }
    if (patch.targetRows !== undefined) {
      prt.targetRows =
        patch.targetRows === null || patch.targetRows === '' ? null : clampInt(patch.targetRows, 1, 999999, 0) || null;
    }
    if (patch.repeat) {
      prt.repeat = {
        enabled: !!patch.repeat.enabled,
        startRow: clampInt(patch.repeat.startRow, 1, 999999, prt.repeat.startRow),
        endRow: clampInt(patch.repeat.endRow, 1, 999999, prt.repeat.endRow),
        times: clampInt(patch.repeat.times, 1, 9999, prt.repeat.times)
      };
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
    if (proj.activePartId === partId) proj.activePartId = proj.parts[0].id;
    delete lineCache[partId];
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
   * second half off.
   * @returns {{created:number, updated:number, placed:number, targeted:number}}
   */
  function importPatternSections(projectId, sections, opts) {
    var proj = project(projectId);
    var out = { created: 0, updated: 0, placed: 0, targeted: 0 };
    if (!proj || !Array.isArray(sections) || !sections.length) return out;
    var mode = opts && opts.mode === 'active' ? 'active' : 'parts';
    snapshot(proj);

    // Size names usually live on a different page than the instructions, so look for
    // them in the whole pasted text and remember them on the project.
    var fullText = opts && typeof opts.text === 'string' ? opts.text : '';
    if (fullText && window.Patterns && typeof window.Patterns.detectSizes === 'function') {
      try {
        var names = window.Patterns.detectSizes(fullText);
        if (Array.isArray(names) && names.length > 1) proj.sizes = names.map(String);
      } catch (e) { /* ignore parser errors */ }
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
      if (!(opts && opts.noTargets) && !prt.targetRows) {
        var activeTarget = targetRowsFromText(joined);
        if (activeTarget) { prt.targetRows = activeTarget; out.targeted = 1; }
      }
      delete lineCache[prt.id];
      out.updated = 1;
      touch(proj);
      return out;
    }

    var noTargets = !!(opts && opts.noTargets);

    for (var i = 0; i < sections.length; i++) {
      var sec = sections[i] || {};
      var name = str(sec.name, '').trim();
      var text = str(sec.text, '');
      var makeCount = clampInt(sec.makeCount, 1, 99, 1);
      var key = sectionImportKey(name, text);
      var existing = null;
      var j;
      // Content key first (13 #7) — a section the parser could not name still
      // matches itself on a re-import. Only then the name.
      if (key) {
        for (j = 0; j < proj.parts.length; j++) {
          if (proj.parts[j].importKey && proj.parts[j].importKey === key) {
            existing = proj.parts[j];
            break;
          }
        }
      }
      if (!existing && name) {
        for (j = 0; j < proj.parts.length; j++) {
          if (proj.parts[j].name.toLowerCase() === name.toLowerCase()) {
            existing = proj.parts[j];
            break;
          }
        }
      }
      // 01 #1 / 02 #1: without this every PDF project is un-finishable.
      var target = noTargets ? null : targetRowsFromText(text);
      var place = str(sec.placement, '');
      if (existing) {
        existing.patternText = text;
        existing.makeCount = makeCount;
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
        delete lineCache[existing.id];
        out.updated++;
      } else {
        var added = makePart(name || 'Part ' + (proj.parts.length + 1), makeCount);
        added.patternText = text;
        added.importKey = key;
        if (target) { added.targetRows = target; out.targeted++; }
        if (place) { added.placementNotes = place; out.placed++; }
        proj.parts.push(added);
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
    }
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
        prt.repeat = { enabled: true, startRow: startRow, endRow: endRow, times: times };
        applied.repeat = { enabled: true, startRow: startRow, endRow: endRow, times: times };
      }
    }

    touch(proj);
    return applied;
  }

  function setActivePart(projectId, partId) {
    var proj = project(projectId);
    var prt = part(proj, partId);
    if (!proj || !prt) return false;
    proj.activePartId = partId;
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
    return JSON.stringify(s, null, 2);
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
    if (!local) return row;
    if (sameJson(local, incoming)) row.status = 'identical';
    else if (row.updatedAt > row.localUpdatedAt) row.status = 'replace';
    else row.status = 'older';
    return row;
  }

  /**
   * What importing this file WOULD do (09 #3 / 12 #3). Writes nothing and
   * throws the same errors `importJSON` would, so the sheet can show them.
   * @returns {{projects:Array, templates:Array, counts:object, version:number}}
   */
  function previewImport(text) {
    var raw = readBackup(text);
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
      try { ls().setItem(KEY + PREIMPORT_KEY_SUFFIX, preimportText); } catch (e) { /* memory copy stands */ }
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
    for (i = 0; i < raw.projects.length; i++) {
      if (!raw.projects[i] || typeof raw.projects[i] !== 'object') continue;
      var incoming = normalizeProject(raw.projects[i]);
      var how = str(projChoice[incoming.id], '') || 'replace';
      if (how === 'skip') continue;
      var existing = findProject(list, incoming.id);
      if (existing && how === 'keepBoth') {
        // The clone carries no BlobStore page images: those are keyed by the
        // id it no longer has. The import sheet says so.
        incoming.name = fromBackupName(incoming.name);
        reidentify(incoming);
        list.push(incoming);
        count++;
        continue;
      }
      if (existing) list[list.indexOf(existing)] = incoming;
      else list.push(incoming);
      count++;
    }

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
    state = normalizeState(raw);
    state.revision = Math.max(clampInt(state.revision, 0, 1e12, 0), keepRevision);
    lineCache = Object.create(null);
    diagramCache = Object.create(null);
    preimportText = null;
    lsRemove(KEY + PREIMPORT_KEY_SUFFIX);
    dirty = true;
    flush();
    return true;
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
    return { mode: 'rounds', rounds: [], current: 0, defaultColor: MAIN_YARN_DEFAULT };
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
  function patternColorHex(name) {
    var api = patternsApi();
    if (!api || typeof api.colorHex !== 'function') return null;
    try {
      return normalizeHex(api.colorHex(name));
    } catch (e) {
      return null;
    }
  }

  /** Patterns.colors(text) → { legend, names }, never throwing. */
  function patternColorsOf(text) {
    var out = { legend: {}, names: [] };
    var api = patternsApi();
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
        if (legend === null) legend = patternColorsOf(prt && prt.patternText).legend || {};
        var full = str(legend[name], '').trim();
        if (full && full !== name) out = override(full) || patternColorHex(full);
      }
      if (!out) out = patternColorHex(name);
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

  function buildDiagramModel(prt, proj) {
    var mode = proj && proj.countMode === 'rounds' ? 'rounds' : 'rows';
    var main = mainYarn(proj);
    var resolve = makeColorResolver(proj, prt);
    var lines = linesFor(prt);
    var rs = Array.isArray(prt.rowStitches) ? prt.rowStitches : [];
    var api = patternsApi();
    var canExpand = !!(lines.length && api && typeof api.expand === 'function');

    var maxRow = 0;
    if (lines.length) {
      var sum = patternSummary(prt);
      if (typeof sum.maxRow === 'number' && sum.maxRow > 0) maxRow = Math.floor(sum.maxRow);
    }
    var workingRow = prt.row + 1;
    var total = Math.max(workingRow, maxRow, rs.length - 1);
    if (total < 1) total = 1;
    if (total > DIAGRAM_MAX_ROUNDS * 4) total = DIAGRAM_MAX_ROUNDS * 4;
    // A 900-round blanket only shows its most recent rounds.
    var start = Math.max(1, total - DIAGRAM_MAX_ROUNDS + 1);

    var rounds = [];
    var current = -1;
    var state = null;
    var prevCount = 0;

    for (var row = 1; row <= total; row++) {
      var patternRow = patternRowForRow(prt, row);
      var line = lines.length ? lineForRow(prt, patternRow) : null;
      var stitches = [];
      var count = 0;
      var height = 1;
      var color = main;

      if (canExpand) {
        var ex = null;
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
          for (var si = 0; si < list.length && si < 999; si++) {
            var st = list[si] && typeof list[si] === 'object' ? list[si] : {};
            stitches.push({ t: str(st.t, '') || 'x', c: st.c ? resolve(st.c) : null });
          }
          count = stitches.length;
        }
      }
      // No expand (or it gave up): counts only, generic stitches.
      if (!count && line) {
        var lc = countOf(line);
        if (typeof lc === 'number' && lc > 0) count = Math.floor(lc);
      }
      if (!count && rs[row] > 0) count = rs[row];
      if (!count && row === workingRow) {
        count = Math.max(prt.stitch, targetFor(prt, patternRow) || 0);
      }

      var done;
      if (row < workingRow) done = rs[row] > 0 ? rs[row] : count;
      else if (row === workingRow) done = prt.stitch;
      else done = 0;
      if (count < done) count = done;

      if (row >= start) {
        if (row === workingRow) current = rounds.length;
        rounds.push({
          count: count,
          done: done,
          stitches: stitches,
          color: color,
          height: height,
          ghost: row > workingRow
        });
      }
      prevCount = count;
    }

    if (current < 0) current = rounds.length ? rounds.length - 1 : 0;
    return { mode: mode, rounds: rounds, current: current, defaultColor: main };
  }

  /** Cheap palette fingerprint — these objects hold a handful of keys. */
  function yarnSerial(proj) {
    var yarn = yarnColorsOf(proj);
    var keys = Object.keys(yarn);
    var out = '';
    for (var i = 0; i < keys.length; i++) out += keys[i] + '=' + yarn[keys[i]] + ',';
    return out;
  }

  function diagramKey(prt, proj) {
    var rs = Array.isArray(prt.rowStitches) ? prt.rowStitches : [];
    var text = prt.patternText || '';
    return (
      sizeIndexOf(prt) + '|' + prt.row + '|' + prt.piecesDone + '|' + rs.length + '|' +
      (prt.repeat && prt.repeat.enabled ? prt.repeat.startRow + '-' + prt.repeat.endRow + 'x' + prt.repeat.times : '-') +
      '|' + (proj && proj.countMode === 'rounds' ? 'rounds' : 'rows') + '|' + yarnSerial(proj) +
      '|' + text.length + '|' + text
    );
  }

  /**
   * The only thing that changes on the tap path: how much of the round being
   * worked is done. Mutating it in place keeps a tap off the model builder.
   */
  function applyLiveRound(model, prt) {
    var cur = model && model.rounds ? model.rounds[model.current] : null;
    if (!cur) return model;
    cur.done = prt.stitch;
    if (cur.count < cur.done) cur.count = cur.done;
    cur.ghost = false;
    return model;
  }

  /**
   * @param {object} prt  a part
   * @param {object} [proj]  its project (looked up when omitted)
   * @returns {{mode:string, rounds:Array, current:number, defaultColor:string}}
   */
  function diagramModel(prt, proj) {
    if (!prt) return emptyModel();
    if (!proj) proj = projectOfPart(prt);
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
      var info = patternColorsOf(proj.parts[i].patternText);
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
    return normalizeHex(yarn[key]) || patternColorHex(key) || main;
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
   * Public API
   * ------------------------------------------------------------------ */

  window.Store = {
    KEY: KEY,
    VERSION: VERSION,
    DEFAULT_CRAFT: DEFAULT_CRAFT,

    // crafts (the plugin contract — docs/CRAFTS.md)
    registerCraft: registerCraft,
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

    // counting
    tapStitch: tapStitch,
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
    patternSummary: patternSummary,
    splitSections: splitSections,
    sizeCount: sizeCount,
    setupLine: setupLine,
    countOf: countOf,
    isComputed: isComputed,
    notesOf: notesOf,
    repeatInfo: repeatInfo,

    // live 3D diagram
    diagramModel: diagramModel,
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
      load();
      return KEY;
    }
  };
})();
