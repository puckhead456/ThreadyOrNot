/* Thready or Not — js/blobstore.js
 * window.BlobStore : a tiny IndexedDB wrapper for big binary data that has no
 * business sitting in localStorage (rasterised chart pages, photos).
 *
 * Database `stitchkeeper-blobs`, one object store `blobs` keyed by string.
 * Key convention: 'p:<projectId>:<kind>:<n>'  e.g. 'p:abc:chartpage:3'.
 *
 *   BlobStore.put(key, blob | ArrayBuffer | string) -> Promise<boolean>
 *   BlobStore.get(key)                             -> Promise<Blob|null>
 *   BlobStore.delete(key)                          -> Promise<boolean>
 *   BlobStore.keys(prefix)                         -> Promise<string[]>
 *   BlobStore.deletePrefix(prefix)                 -> Promise<number>
 *   BlobStore.entries(prefix)                      -> Promise<[{key, blob}]>
 *   BlobStore.putMany([{key, value}])              -> Promise<number>  (one transaction)
 *   BlobStore.deleteKeys([key])                    -> Promise<number>
 *   BlobStore.sweep(liveProjectIds, {prefix})      -> Promise<{count, bytes}>  (09 #10)
 *   BlobStore.available()                          -> boolean
 *   BlobStore.usage()                              -> Promise<{count, bytes}|null>
 *
 * Nothing here ever rejects: when IndexedDB is missing or refuses to open
 * (private mode, an old WebView, a blocked origin) every call resolves to the
 * empty answer — null / false / [] / 0 — so a craft module can carry on with
 * "chart images are stored on this device only" and offer a re-import.
 *
 * Values are normalised to Blobs on the way in, so `get` always hands back a
 * Blob and a string round-trips through `blob.text()`.
 */
(function () {
  'use strict';

  var DB_NAME = 'stitchkeeper-blobs';
  var STORE = 'blobs';
  var DB_VERSION = 1;

  var dbPromise = null;
  var unavailable = false;

  /* ------------------------------------------------------------------ *
   * Opening
   * ------------------------------------------------------------------ */

  function idb() {
    try {
      return window.indexedDB || null;
    } catch (e) {
      return null;
    }
  }

  function available() {
    return !unavailable && !!idb();
  }

  function openDb() {
    if (!available()) return Promise.resolve(null);
    if (dbPromise) return dbPromise;

    dbPromise = new Promise(function (resolve) {
      var req;
      try {
        req = idb().open(DB_NAME, DB_VERSION);
      } catch (e) {
        unavailable = true;
        resolve(null);
        return;
      }
      if (!req) {
        unavailable = true;
        resolve(null);
        return;
      }
      req.onupgradeneeded = function () {
        try {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        } catch (e) {
          /* the transaction will abort and onerror fires */
        }
      };
      req.onsuccess = function () {
        var db = req.result;
        if (!db) {
          unavailable = true;
          resolve(null);
          return;
        }
        // A second tab upgrading the schema would otherwise deadlock it.
        db.onversionchange = function () {
          try { db.close(); } catch (e) { /* ignore */ }
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = function () {
        unavailable = true;
        resolve(null);
      };
      req.onblocked = function () {
        resolve(null);
      };
    });
    return dbPromise;
  }

  /**
   * Run `fn(store, done)` inside one transaction and resolve with whatever
   * `done(value)` was last handed, or `fallback` if anything went wrong.
   */
  function withStore(mode, fallback, fn) {
    return openDb().then(function (db) {
      if (!db) return fallback;
      return new Promise(function (resolve) {
        var t;
        try {
          t = db.transaction(STORE, mode);
        } catch (e) {
          resolve(fallback);
          return;
        }
        var out = fallback;
        var store;
        try {
          store = t.objectStore(STORE);
          fn(store, function (v) { out = v; });
        } catch (e) {
          try { t.abort(); } catch (e2) { /* ignore */ }
          resolve(fallback);
          return;
        }
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { resolve(fallback); };
        t.onabort = function () { resolve(fallback); };
      });
    }, function () {
      return fallback;
    });
  }

  /* ------------------------------------------------------------------ *
   * Value normalisation
   * ------------------------------------------------------------------ */

  function toBlob(value) {
    if (value === null || value === undefined) return null;
    try {
      if (typeof Blob === 'function' && value instanceof Blob) return value;
      if (typeof value === 'string') return new Blob([value], { type: 'text/plain' });
      if (value instanceof ArrayBuffer) return new Blob([value], { type: 'application/octet-stream' });
      if (value && value.buffer instanceof ArrayBuffer) {
        return new Blob([value.buffer], { type: 'application/octet-stream' });
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  function keyOf(key) {
    return typeof key === 'string' ? key : String(key == null ? '' : key);
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  function put(key, value) {
    var k = keyOf(key);
    if (!k) return Promise.resolve(false);
    var blob = toBlob(value);
    if (!blob) return Promise.resolve(false);
    return withStore('readwrite', false, function (store, done) {
      var req = store.put(blob, k);
      req.onsuccess = function () { done(true); };
    });
  }

  function get(key) {
    var k = keyOf(key);
    if (!k) return Promise.resolve(null);
    return withStore('readonly', null, function (store, done) {
      var req = store.get(k);
      req.onsuccess = function () {
        var v = req.result;
        done(v === undefined ? null : v);
      };
    });
  }

  function del(key) {
    var k = keyOf(key);
    if (!k) return Promise.resolve(false);
    return withStore('readwrite', false, function (store, done) {
      var req = store['delete'](k);
      req.onsuccess = function () { done(true); };
    });
  }

  /** Every key starting with `prefix` ('' or missing = all of them), sorted. */
  function keys(prefix) {
    var pre = prefix === undefined || prefix === null ? '' : String(prefix);
    return withStore('readonly', [], function (store, done) {
      var found = [];
      if (typeof store.getAllKeys === 'function') {
        var req = store.getAllKeys();
        req.onsuccess = function () {
          var all = req.result || [];
          for (var i = 0; i < all.length; i++) {
            var k = String(all[i]);
            if (!pre || k.indexOf(pre) === 0) found.push(k);
          }
          done(found);
        };
        return;
      }
      var cur = store.openCursor();
      cur.onsuccess = function () {
        var c = cur.result;
        if (!c) {
          done(found);
          return;
        }
        var ck = String(c.key);
        if (!pre || ck.indexOf(pre) === 0) found.push(ck);
        c['continue']();
      };
    });
  }

  /** Delete every key under `prefix` and resolve with how many went. */
  function deletePrefix(prefix) {
    var pre = prefix === undefined || prefix === null ? '' : String(prefix);
    return keys(pre).then(function (list) {
      if (!list.length) return 0;
      return withStore('readwrite', 0, function (store, done) {
        var n = 0;
        for (var i = 0; i < list.length; i++) {
          (function (k) {
            var req = store['delete'](k);
            req.onsuccess = function () {
              n++;
              done(n);
            };
          })(list[i]);
        }
      });
    });
  }

  /**
   * Every `{key, blob}` under `prefix`, sorted by key, in one read
   * transaction. The backup writer (12 #4) uses it to gather a project's
   * page images.
   */
  function entries(prefix) {
    var pre = prefix === undefined || prefix === null ? '' : String(prefix);
    return withStore('readonly', [], function (store, done) {
      var found = [];
      var range = null;
      try {
        if (pre && typeof IDBKeyRange !== 'undefined') range = IDBKeyRange.bound(pre, pre + '￿');
      } catch (e) {
        range = null;
      }
      var cur = range ? store.openCursor(range) : store.openCursor();
      cur.onsuccess = function () {
        var c = cur.result;
        if (!c) {
          done(found);
          return;
        }
        var ck = String(c.key);
        if (!pre || ck.indexOf(pre) === 0) found.push({ key: ck, blob: c.value });
        c['continue']();
      };
    });
  }

  /**
   * Write many `{key, value}` pairs in ONE transaction: all of them land or
   * none do. Resolves with how many were written (0 when it failed). Items
   * with an empty key or a value that is not blob-like are left out.
   */
  function putMany(list) {
    if (!Array.isArray(list) || !list.length) return Promise.resolve(0);
    var items = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it) continue;
      var k = keyOf(it.key);
      var b = toBlob(it.value);
      if (k && b) items.push({ key: k, blob: b });
    }
    if (!items.length) return Promise.resolve(0);
    return withStore('readwrite', 0, function (store, done) {
      for (var j = 0; j < items.length; j++) store.put(items[j].blob, items[j].key);
      done(items.length);
    });
  }

  /** Delete exactly these keys, in one transaction; resolves with the count. */
  function deleteKeys(list) {
    if (!Array.isArray(list) || !list.length) return Promise.resolve(0);
    var ks = [];
    for (var i = 0; i < list.length; i++) {
      var k = keyOf(list[i]);
      if (k) ks.push(k);
    }
    if (!ks.length) return Promise.resolve(0);
    return withStore('readwrite', 0, function (store, done) {
      for (var j = 0; j < ks.length; j++) store['delete'](ks[j]);
      done(ks.length);
    });
  }

  /**
   * 09 #10: delete every project blob ('p:<id>:…') whose project id is not in
   * `liveIds`. Keys that do not follow the 'p:<id>:' convention are never
   * touched. An empty or missing list sweeps NOTHING (a store that failed to
   * load must not read as "no projects, delete everything").
   * Resolves with { count, bytes } of what went. `opts.prefix` (default
   * 'p:') is the namespace in front of the id; the test page uses its own so
   * it can never sweep the app's real images.
   */
  function sweep(liveIds, opts) {
    if (!Array.isArray(liveIds) || !liveIds.length) return Promise.resolve({ count: 0, bytes: 0 });
    var pre = opts && typeof opts.prefix === 'string' && opts.prefix ? opts.prefix : 'p:';
    var live = Object.create(null);
    for (var i = 0; i < liveIds.length; i++) live[String(liveIds[i])] = true;
    return entries(pre).then(function (all) {
      var doomed = [];
      var bytes = 0;
      for (var j = 0; j < all.length; j++) {
        var k = all[j].key;
        var end = k.indexOf(':', pre.length);
        if (end < 0) continue;
        var id = k.slice(pre.length, end);
        if (!id || live[id]) continue;
        doomed.push(k);
        var v = all[j].blob;
        if (v && typeof v.size === 'number') bytes += v.size;
      }
      if (!doomed.length) return { count: 0, bytes: 0 };
      return deleteKeys(doomed).then(function (n) {
        return { count: n, bytes: n ? bytes : 0 };
      });
    });
  }

  /** How much of the device this craft's images are eating. */
  function usage() {
    return withStore('readonly', null, function (store, done) {
      var count = 0;
      var bytes = 0;
      var cur = store.openCursor();
      cur.onsuccess = function () {
        var c = cur.result;
        if (!c) {
          done({ count: count, bytes: bytes });
          return;
        }
        count++;
        var v = c.value;
        if (v && typeof v.size === 'number') bytes += v.size;
        else if (v && typeof v.byteLength === 'number') bytes += v.byteLength;
        c['continue']();
      };
    });
  }

  /** Test hook: forget the cached connection and the "unavailable" verdict. */
  function reset() {
    if (dbPromise) {
      dbPromise.then(function (db) {
        if (db) { try { db.close(); } catch (e) { /* ignore */ } }
      });
    }
    dbPromise = null;
    unavailable = false;
  }

  window.BlobStore = {
    put: put,
    get: get,
    'delete': del,
    keys: keys,
    deletePrefix: deletePrefix,
    entries: entries,
    putMany: putMany,
    deleteKeys: deleteKeys,
    sweep: sweep,
    available: available,
    usage: usage,
    DB_NAME: DB_NAME,
    STORE: STORE,
    _reset: reset
  };
})();
