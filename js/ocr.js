/* Thready or Not: opt-in text reader for scanned pages (wave K, proposal R4).
 *
 * window.Ocr wraps a vendored tesseract.js v5 (LSTM-only WASM core, English
 * tessdata_fast). It is a FALLBACK for image-only pages, never the default path:
 *
 *   - nothing under js/vendor/tesseract/ is fetched until Ocr.install() runs,
 *     which the maker starts by tapping a button;
 *   - install() copies the files, same-origin, into their own Cache Storage
 *     bucket (Ocr.CACHE). They are never in sw.js PRECACHE_URLS;
 *   - after that the engine never touches the network: every file is read
 *     back out of the bucket and handed to the worker as a Blob URL or bytes,
 *     so it works offline without any help from the service worker;
 *   - recognition runs in a Web Worker; no server, no CDN, no telemetry.
 *
 * Contract: docs/wave-k/api/ocr.md. Measurements: docs/wave-k/ocr.md.
 * ES5, one global. */
(function (global) {
  'use strict';

  var VERSION = '5.1.1';
  var CACHE = 'thready-ocr-v1';
  var CACHE_PREFIX = 'thready-ocr-';
  var START_LIMIT_MS = 60000;

  /* Where the vendored files live, relative to this script (so a test page
     under test/ and the app at the root both find them). */
  var BASE = (function () {
    try {
      var s = global.document && (document.currentScript ||
        (function () {
          var all = document.getElementsByTagName('script');
          for (var i = all.length - 1; i >= 0; i--) {
            if (/(^|\/)ocr\.js(\?|#|$)/.test(all[i].src)) return all[i];
          }
          return null;
        })());
      if (s && s.src) return new URL('vendor/tesseract/', s.src).href;
    } catch (e) { /* fall through */ }
    return new URL('js/vendor/tesseract/', global.location.href).href;
  })();

  /* Exact byte sizes of the vendored files (js/vendor/tesseract/README.md
     lists the same with SHA-256). One core variant is downloaded per device. */
  var FILES = {
    lib: { path: 'tesseract.min.js', bytes: 66695, type: 'application/javascript' },
    worker: { path: 'worker.min.js', bytes: 123724, type: 'application/javascript' },
    coreSimd: { path: 'tesseract-core-simd-lstm.js', bytes: 124396, type: 'application/javascript' },
    wasmSimd: { path: 'tesseract-core-simd-lstm.wasm', bytes: 2859709, type: 'application/wasm' },
    core: { path: 'tesseract-core-lstm.js', bytes: 124391, type: 'application/javascript' },
    wasm: { path: 'tesseract-core-lstm.wasm', bytes: 2859424, type: 'application/wasm' },
    lang: { path: 'eng.traineddata.gz', bytes: 1976293, type: 'application/gzip' }
  };

  /* --------------------------------------------------------------- *
   * Capability checks
   * --------------------------------------------------------------- */
  var simdCache = null;
  function hasSimd() {
    if (simdCache !== null) return simdCache;
    try {
      // The wasm-feature-detect SIMD probe (i8x16 ops in one function).
      simdCache = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
        3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    } catch (e) { simdCache = false; }
    return simdCache;
  }

  function available() {
    try {
      return typeof Worker === 'function' && typeof WebAssembly === 'object' &&
        typeof caches === 'object' && !!caches && typeof fetch === 'function' &&
        typeof Blob === 'function' && !!(global.URL && URL.createObjectURL);
    } catch (e) { return false; }
  }

  function neededKeys() {
    return hasSimd() ? ['lib', 'worker', 'coreSimd', 'wasmSimd', 'lang'] : ['lib', 'worker', 'core', 'wasm', 'lang'];
  }

  function urlOf(key) { return BASE + FILES[key].path; }

  function downloadSize() {
    var keys = neededKeys(), bytes = 0;
    for (var i = 0; i < keys.length; i++) bytes += FILES[keys[i]].bytes;
    var mb = bytes / 1048576;
    return { bytes: bytes, mb: Math.round(mb * 10) / 10, label: 'about ' + Math.round(mb) + ' MB' };
  }

  function abortError(msg) {
    var e;
    try { e = new DOMException(msg || 'Cancelled', 'AbortError'); } catch (x) { e = new Error(msg || 'Cancelled'); e.name = 'AbortError'; }
    return e;
  }
  function namedError(name, msg) { var e = new Error(msg); e.name = name; return e; }
  function aborted(signal) { return !!(signal && (signal.aborted || signal.cancelled)); }

  /* --------------------------------------------------------------- *
   * Install / remove
   * --------------------------------------------------------------- */
  function openCache() { return caches.open(CACHE); }
  // Reads must not create the bucket (caches.open would), or remove() never sticks.
  function openExisting() { return caches.has(CACHE).then(function (has) { return has ? caches.open(CACHE) : null; }); }

  function installed() {
    if (!available()) return Promise.resolve(false);
    var keys = neededKeys();
    return openExisting().then(function (cache) {
      if (!cache) return [null];
      return Promise.all(keys.map(function (k) { return cache.match(urlOf(k)); }));
    }).then(function (rs) {
      for (var i = 0; i < rs.length; i++) if (!rs[i]) return false;
      return true;
    }, function () { return false; });
  }

  /** Fetch one file with byte progress; resolves a Blob. */
  function fetchWithProgress(url, type, signal, onBytes) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var onAbort = null;
    if (signal && ctl && typeof signal.addEventListener === 'function') {
      onAbort = function () { ctl.abort(); };
      signal.addEventListener('abort', onAbort);
    }
    var done = function () { if (onAbort) signal.removeEventListener('abort', onAbort); };
    return fetch(url, { cache: 'no-cache', credentials: 'same-origin', signal: ctl ? ctl.signal : undefined })
      .then(function (resp) {
        if (!resp.ok) throw namedError('NetworkError', 'Could not download ' + url + ' (' + resp.status + ')');
        if (!resp.body || !resp.body.getReader) {
          return resp.arrayBuffer().then(function (ab) { onBytes(ab.byteLength); return new Blob([ab], { type: type }); });
        }
        var reader = resp.body.getReader(), parts = [];
        function pump() {
          if (aborted(signal)) { try { var pc = reader.cancel(); if (pc && pc.catch) pc.catch(function () {}); } catch (e) {} throw abortError(); }
          return reader.read().then(function (r) {
            if (r.done) return new Blob(parts, { type: type });
            parts.push(r.value);
            onBytes(r.value.byteLength);
            return pump();
          });
        }
        return pump();
      })
      .then(function (b) { done(); return b; }, function (e) {
        done();
        if (aborted(signal) || (e && e.name === 'AbortError')) throw abortError();
        throw e;
      });
  }

  /**
   * Download the engine once into Cache Storage. Idempotent.
   * @param {{onProgress?:function({loaded,total,file,fraction}), signal?}} opts
   */
  var installing = null;   // installs run one at a time
  function install(opts) {
    var run = function () { return installOnce(opts); };
    var p = (installing || Promise.resolve()).then(run, run);
    var mine = installing = p.then(null, function () {});
    mine.then(function () { if (installing === mine) installing = null; });
    return p;
  }

  function installOnce(opts) {
    opts = opts || {};
    var signal = opts.signal, onProgress = opts.onProgress;
    if (!available()) return Promise.reject(namedError('NotSupportedError', 'This browser cannot run the text reader.'));
    var t0 = now(), keys = neededKeys(), total = downloadSize().bytes, loaded = 0, fetched = 0;
    var report = function (file) {
      if (onProgress) {
        try { onProgress({ loaded: loaded, total: total, file: file, fraction: total ? Math.min(1, loaded / total) : 1 }); } catch (e) {}
      }
    };
    return openCache().then(function (cache) {
      // Drop any older bucket (a future thready-ocr-v2 replaces v1).
      var sweep = caches.keys().then(function (names) {
        return Promise.all(names.filter(function (n) { return n.indexOf(CACHE_PREFIX) === 0 && n !== CACHE; })
          .map(function (n) { return caches.delete(n); }));
      });
      var i = 0;
      function next() {
        if (i >= keys.length) return null;
        var key = keys[i++], url = urlOf(key), f = FILES[key];
        if (aborted(signal)) throw abortError();
        return cache.match(url).then(function (hit) {
          if (hit) { loaded += f.bytes; report(f.path); return next(); }
          return fetchWithProgress(url, f.type, signal, function (n) { loaded += n; report(f.path); })
            .then(function (blob) {
              fetched += blob.size;
              // Only a complete file is ever stored. Chrome can refuse a put
              // ("Entry already exists") while an older write of the same key
              // settles; clear that key and write once more.
              var put = function () { return cache.put(url, new Response(blob, { headers: { 'Content-Type': f.type } })); };
              return put().then(null, function () { return cache.delete(url).then(put); });
            })
            .then(function () { if (aborted(signal)) throw abortError(); return next(); });
        });
      }
      return sweep.then(next);
    }).then(function () {
      report('');
      return { bytes: fetched, ms: Math.round(now() - t0) };
    }, function (e) {
      if (aborted(signal)) throw abortError();
      throw e;
    });
  }

  function remove() {
    terminate();
    if (typeof caches !== 'object' || !caches) return Promise.resolve(false);
    return caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n.indexOf(CACHE_PREFIX) === 0; })
        .map(function (n) { return caches.delete(n); }));
    }).then(function (r) { return r.length > 0; });
  }

  /** Bytes the bucket holds now (for "Text reader: 5.0 MB · Remove"). */
  function storedBytes() {
    if (!available()) return Promise.resolve(0);
    return openExisting().then(function (cache) {
      if (!cache) return [];
      return cache.keys().then(function (reqs) {
        return Promise.all(reqs.map(function (r) {
          return cache.match(r).then(function (resp) { return resp ? resp.blob() : null; }).then(function (b) { return b ? b.size : 0; });
        }));
      });
    }).then(function (sizes) { var s = 0; for (var i = 0; i < sizes.length; i++) s += sizes[i]; return s; }, function () { return 0; });
  }

  /* --------------------------------------------------------------- *
   * Engine start-up (all from the bucket, no network)
   * --------------------------------------------------------------- */
  var engine = null;      // { worker, urls:[], params:{} }
  var starting = null;    // Promise<engine>
  var current = null;     // { reject } of the job in flight
  var progressSink = null;

  function blobFromCache(cache, key) {
    return cache.match(urlOf(key)).then(function (r) {
      if (!r) throw namedError('NotInstalledError', 'The text reader is not downloaded yet.');
      return r.blob();
    });
  }

  function loadLib(blob) {
    if (global.Tesseract && global.Tesseract.createWorker) return Promise.resolve(global.Tesseract);
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () { URL.revokeObjectURL(url); global.Tesseract ? resolve(global.Tesseract) : reject(new Error('Text reader failed to load')); };
      s.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Text reader failed to load')); };
      document.head.appendChild(s);
    });
  }

  function startEngine() {
    if (engine) return Promise.resolve(engine);
    if (starting) return starting;
    var simd = hasSimd(), t0 = now(), urls = [];
    var mk = function (blob, type) { var u = URL.createObjectURL(type ? new Blob([blob], { type: type }) : blob); urls.push(u); return u; };
    starting = openCache().then(function (cache) {
      return Promise.all([
        blobFromCache(cache, 'lib'), blobFromCache(cache, 'worker'),
        blobFromCache(cache, simd ? 'coreSimd' : 'core'), blobFromCache(cache, simd ? 'wasmSimd' : 'wasm'),
        blobFromCache(cache, 'lang')
      ]);
    }).then(function (b) {
      return loadLib(b[0]).then(function (T) {
        var workerUrl = mk(b[1], 'application/javascript');
        var coreUrl = mk(b[2], 'application/javascript');
        var wasmUrl = mk(b[3], 'application/wasm');
        var langUrl = mk(b[4], 'application/gzip');
        // Runs inside the worker before the core starts. The core looks for its
        // .wasm beside itself, and from a Blob URL there is no "beside", so
        // locateFile points at the wasm Blob. The worker then fetches
        // <langPath>/eng.traineddata.gz; that one same-origin URL is answered
        // from the Blob too, so recognition never needs the network.
        // (tesseract.js 5.1.1 cannot take the traineddata bytes directly: its
        // initialize step joins the bytes into the language name.)
        var shim = 'importScripts(' + JSON.stringify(coreUrl) + ');' +
          '(function(){var C=self.TesseractCore;self.TesseractCore=function(m){m=m||{};' +
          'm.locateFile=function(p,d){return /\\.wasm$/.test(p)?' + JSON.stringify(wasmUrl) + ':d+p;};return C(m);};' +
          'var F=self.fetch,L=' + JSON.stringify(urlOf('lang')) + ',B=' + JSON.stringify(langUrl) + ';' +
          'self.fetch=function(u,o){return String(u&&u.url||u)===L?F.call(self,B):F.call(self,u,o);};})();';
        var shimUrl = mk(new Blob([shim], { type: 'application/javascript' }));
        var made = T.createWorker('eng', 1, {
          workerPath: workerUrl,
          workerBlobURL: false,
          corePath: shimUrl + '#tesseract-core.js',   // must end in "js" for the worker to importScripts it
          langPath: BASE.replace(/\/$/, ''),
          cacheMethod: 'none',
          gzip: true,
          logger: function (m) {
            if (progressSink && m && typeof m.progress === 'number') {
              try { progressSink({ stage: /recogniz/.test(m.status || '') ? 'recognizing' : 'loading', fraction: m.progress, status: m.status }); } catch (e) {}
            }
          },
          errorHandler: function () {}
        });
        // tesseract.js never settles createWorker when the worker dies while
        // loading, so start-up has its own time limit.
        return new Promise(function (resolve, reject) {
          var timer = setTimeout(function () {
            timer = null;
            made.then(function (w) { try { w.terminate(); } catch (x) {} }, function () {});
            reject(namedError('EngineError', 'The text reader did not start.'));
          }, START_LIMIT_MS);
          made.then(function (w) { if (timer) { clearTimeout(timer); resolve(w); } },
            function (e) { if (timer) { clearTimeout(timer); reject(namedError('EngineError', 'The text reader did not start: ' + (e && e.message || e))); } });
        });
      });
    }).then(function (w) {
      engine = { worker: w, urls: urls, params: {}, loadMs: Math.round(now() - t0), fresh: true };
      starting = null;
      return engine;
    }, function (e) {
      starting = null;
      urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (x) {} });
      throw e;
    });
    return starting;
  }

  function terminate() {
    var e = engine;
    engine = null;
    starting = null;
    if (e) {
      try { e.worker.terminate(); } catch (x) {}
      e.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (x) {} });
    }
  }

  function cancel() {
    var c = current;
    current = null;
    terminate();
    if (c) c.reject(abortError());
  }

  /* --------------------------------------------------------------- *
   * Recognition
   * --------------------------------------------------------------- */
  var MODES = {
    text: { whitelist: '', psm: 3 },
    codes: { whitelist: '0123456789 ABCDEHIKLMNORTUWabcehiklnortuw', psm: 11 },
    digits: { whitelist: '0123456789.,/- ', psm: 6 }
  };

  function toPng(source) {
    if (typeof Blob === 'function' && source instanceof Blob) return Promise.resolve(source);
    var canvas = source;
    if (typeof ImageData === 'function' && source instanceof ImageData ||
        (typeof ImageBitmap === 'function' && source instanceof ImageBitmap)) {
      canvas = document.createElement('canvas');
      canvas.width = source.width; canvas.height = source.height;
      var ctx = canvas.getContext('2d');
      if (source instanceof ImageData) ctx.putImageData(source, 0, 0); else ctx.drawImage(source, 0, 0);
    }
    if (!canvas || typeof canvas.toBlob !== 'function') {
      if (canvas && typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: 'image/png' });
      return Promise.reject(new TypeError('Ocr.recognize needs a canvas, ImageData, ImageBitmap or Blob'));
    }
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('Could not encode the page picture')); }, 'image/png');
    });
  }

  function sizeOf(source) {
    return source && source.width ? { w: source.width, h: source.height } : { w: 0, h: 0 };
  }

  function bbox(b) { return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }; }

  /** Flatten tesseract's blocks into words and lines (exported for tests). */
  function shape(data) {
    var words = [], lines = [];
    var blocks = (data && data.blocks) || [];
    for (var b = 0; b < blocks.length; b++) {
      var paras = blocks[b].paragraphs || [];
      for (var p = 0; p < paras.length; p++) {
        var ls = paras[p].lines || [];
        for (var l = 0; l < ls.length; l++) {
          var L = ls[l], idx = [], ws = L.words || [];
          for (var w = 0; w < ws.length; w++) {
            var W = ws[w];
            var t = String(W.text || '').trim();
            if (!t) continue;
            idx.push(words.length);
            words.push({ text: t, conf: Math.round(W.confidence * 10) / 10, bbox: bbox(W.bbox), line: lines.length });
          }
          if (!idx.length) continue;
          var sc = 0;
          for (var k = 0; k < idx.length; k++) sc += words[idx[k]].conf;
          lines.push({
            text: idx.map(function (j) { return words[j].text; }).join(' '),
            conf: Math.round(sc / idx.length * 10) / 10,
            bbox: bbox(L.bbox), words: idx
          });
        }
      }
    }
    var s = 0;
    for (var i = 0; i < words.length; i++) s += words[i].conf;
    return {
      words: words, lines: lines,
      text: lines.map(function (x) { return x.text; }).join('\n'),
      conf: words.length ? Math.round(s / words.length * 10) / 10 : 0
    };
  }

  var OUTPUT = { blocks: true, text: true, hocr: false, tsv: false };
  var ROTATE_BELOW = 75;
  function rotatable(s) { return !!(s && s.width && s.height && typeof document !== 'undefined' && !(typeof Blob === 'function' && s instanceof Blob)); }
  /** The source drawn turned clockwise by deg (90 or 270). */
  function turned(s, deg) {
    var src = s;
    if (typeof ImageData === 'function' && s instanceof ImageData) {
      src = document.createElement('canvas'); src.width = s.width; src.height = s.height;
      src.getContext('2d').putImageData(s, 0, 0);
    }
    var c = document.createElement('canvas'); c.width = s.height; c.height = s.width;
    var g = c.getContext('2d');
    if (deg === 90) { g.translate(s.height, 0); g.rotate(Math.PI / 2); } else { g.translate(0, s.width); g.rotate(-Math.PI / 2); }
    g.drawImage(src, 0, 0);
    return c;
  }
  /** Map boxes read on a turned picture back onto the original (exported for tests). */
  function unturn(res, deg, size) {
    var W = size.w, H = size.h;
    var back = function (b) {
      return deg === 90 ? { x0: b.y0, y0: H - b.x1, x1: b.y1, y1: H - b.x0 }
        : { x0: W - b.y1, y0: b.x0, x1: W - b.y0, y1: b.x1 };
    };
    res.words.forEach(function (w) { w.bbox = back(w.bbox); });
    res.lines.forEach(function (l) { l.bbox = back(l.bbox); });
    return res;
  }
  function goodWeight(res) {
    var s = 0;
    res.words.forEach(function (w) { if (w.conf >= 60 && /[A-Za-z0-9]{2,}/.test(w.text)) s += w.text.length; });
    return s;
  }

  /**
   * Read the text in a page picture.
   * @returns {Promise<{words, lines, text, conf, ms, loadMs, size}>}
   */
  function recognize(source, opts) {
    opts = opts || {};
    var signal = opts.signal;
    if (aborted(signal)) return Promise.reject(abortError());
    var mode = MODES[opts.mode] || MODES.text;
    var params = {
      tessedit_pageseg_mode: String(opts.psm != null ? opts.psm : mode.psm),
      tessedit_char_whitelist: opts.whitelist != null ? String(opts.whitelist) : mode.whitelist,
      user_defined_dpi: opts.dpi ? String(Math.round(opts.dpi)) : '0',
      preserve_interword_spaces: '0'
    };
    var size = sizeOf(source);
    return new Promise(function (resolve, reject) {
      var job = { reject: reject };
      var finished = false;
      var settle = function (fn, v) { if (finished) return; finished = true; if (current === job) current = null; progressSink = null; fn(v); };
      job.reject = function (e) { settle(reject, e); };
      if (current) { var prev = current; current = null; terminate(); prev.reject(abortError('Superseded')); }
      current = job;
      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', function () { if (current === job) cancel(); });
      }
      progressSink = opts.onProgress || null;
      installed().then(function (ok) {
        if (!ok) throw namedError('NotInstalledError', 'The text reader is not downloaded yet.');
        return Promise.all([startEngine(), toPng(source)]);
      }).then(function (r) {
        if (finished) return null;
        var e = r[0], png = r[1];
        var loadMs = e.fresh ? e.loadMs : 0;
        e.fresh = false;
        var changed = {}, any = false;
        for (var k in params) if (e.params[k] !== params[k]) { changed[k] = params[k]; any = true; }
        var t0;
        return (any ? e.worker.setParameters(changed).then(function () { for (var k2 in changed) e.params[k2] = changed[k2]; }) : Promise.resolve())
          .then(function () {
            if (finished) return null;
            t0 = now();
            return e.worker.recognize(png, {}, OUTPUT);
          })
          .then(function (res) {
            if (finished || !res) return null;
            var out = shape(res.data);
            out.rotation = 0;
            // Sideways pages (size tables and cutting layouts turned 90 degrees)
            // read as confident-looking junk. Tesseract's own orientation check
            // needs the legacy engine, so when a page reads poorly we simply try
            // it turned both ways and keep the reading with the most good words.
            var mayTurn = opts.rotate != null ? !!opts.rotate : (!opts.mode || opts.mode === 'text') && opts.whitelist == null;
            if (!mayTurn || !rotatable(source) || out.conf >= ROTATE_BELOW || !out.words.length) return out;
            var best = out, turns = [90, 270];
            var tryTurn = function (i) {
              if (i >= turns.length || finished) return best;
              return toPng(turned(source, turns[i])).then(function (p) { return e.worker.recognize(p, {}, OUTPUT); }).then(function (rr) {
                if (finished || !rr) return best;
                var o2 = shape(rr.data);
                if (goodWeight(o2) > goodWeight(best) * 1.5) { unturn(o2, turns[i], size); o2.rotation = turns[i]; best = o2; }
                return tryTurn(i + 1);
              });
            };
            return tryTurn(0);
          })
          .then(function (out) {
            if (finished || !out) return;
            out.ms = Math.round(now() - t0);
            out.loadMs = loadMs;
            out.size = size;
            settle(resolve, out);
          });
      }).then(null, function (err) {
        if (aborted(signal)) err = abortError();
        settle(reject, err);
      });
    });
  }

  /* --------------------------------------------------------------- *
   * Hand-off to the existing parsers
   * --------------------------------------------------------------- */

  /**
   * OCR lines as PdfText layout lines (docs/wave-k/api/pdftext.md §1).
   * @param result OcrResult
   * @param o {pageWidth, pageHeight (page units, points), scale (canvas px per
   *          page unit; e.g. region.scale or dpi/72), offsetX, offsetY (page
   *          units of the rendered region's top-left), minConf}
   */
  function toTextItems(result, o) {
    o = o || {};
    var scale = o.scale || 1, ox = o.offsetX || 0, oy = o.offsetY || 0, minConf = o.minConf || 0;
    var W = o.pageWidth || (result.size && result.size.w / scale) || 1;
    var H = o.pageHeight || (result.size && result.size.h / scale) || 1;
    var toBox = function (b) { return { x0: ox + b.x0 / scale, y0: oy + b.y0 / scale, x1: ox + b.x1 / scale, y1: oy + b.y1 / scale }; };
    var toN = function (b) { return { x0: b.x0 / W, y0: b.y0 / H, x1: b.x1 / W, y1: b.y1 / H }; };
    var out = [];
    (result.lines || []).forEach(function (L) {
      var ws = [];
      L.words.forEach(function (j) {
        var w = result.words[j];
        if (!w || w.conf < minConf) return;
        var box = toBox(w.bbox);
        ws.push({ text: w.text, conf: w.conf, box: box, nbox: toN(box) });
      });
      if (!ws.length) return;
      var box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }, sc = 0;
      ws.forEach(function (w) {
        box.x0 = Math.min(box.x0, w.box.x0); box.y0 = Math.min(box.y0, w.box.y0);
        box.x1 = Math.max(box.x1, w.box.x1); box.y1 = Math.max(box.y1, w.box.y1);
        sc += w.conf;
      });
      var nb = toN(box);
      out.push({
        i: out.length,
        text: ws.map(function (w) { return w.text; }).join(' '),
        box: box, nbox: nb, font: 'ocr', fontId: null,
        size: Math.round((box.y1 - box.y0) * 100) / 100,
        margin: nb.y1 < 0.08 || nb.y0 > 0.92,
        ocr: true, conf: Math.round(sc / ws.length * 10) / 10, words: ws
      });
    });
    return out;
  }

  function toPlainText(result, o) {
    var minConf = (o && o.minConf) || 0;
    // dropMargin: leave out lines wholly in the top / bottom 8% of the picture
    // (running heads and page numbers such as "[126]", which a line parser
    // would otherwise take for a stitch count).
    // A scan often sits inside a wide border, so a folio alone on the first or
    // last line of the text block counts as margin too.
    var H = result.size && result.size.h, drop = !!(o && o.dropMargin);
    var all = result.lines || [];
    var body = all.filter(function (L) { return !(H && (L.bbox.y1 < H * 0.08 || L.bbox.y0 > H * 0.92)); });
    var FOLIO = /^[\[(]?\d{1,4}[\])]?$/;
    while (body.length && FOLIO.test(body[0].text)) body.shift();
    while (body.length && FOLIO.test(body[body.length - 1].text)) body.pop();
    return (drop ? body : all).map(function (L) {
      return L.words.map(function (j) { return result.words[j]; })
        .filter(function (w) { return w && w.conf >= minConf; })
        .map(function (w) { return w.text; }).join(' ');
    }).filter(function (s) { return s; }).join('\n');
  }

  /* Floss codes: DMC digits (1-4), B5200, E + 3-4 digits (Light Effects),
     colour words. OCR confusions are folded only inside digit-shaped tokens. */
  var CODE_RE = /^(B5200|E\d{3,4}|\d{1,4}|WHITE|BLANC|ECRU)$/;
  function cleanTok(t) {
    return String(t).replace(/^(DMC|ANCHOR|ANC)[:#]?(?=[0-9BE])/i, '').replace(/[.,;:]+$/, '').replace(/^[(\[]|[)\]]$/g, '');
  }
  function foldCode(t) {
    var s = cleanTok(t);
    var up = s.toUpperCase();
    if (/^(WHITE|BLANC|ECRU)$/.test(up)) return up;
    if (/^B ?52[0O]{2}$/.test(up)) return 'B5200';
    var m = /^([E]?)([0-9OoIlSZB]{1,4})$/.exec(s.replace(/^e/, 'E'));
    if (!m) return null;
    var digits = m[2];
    // Fold only when the token already has at least one real digit.
    if (!/\d/.test(digits)) return null;
    digits = digits.replace(/[Oo]/g, '0').replace(/[Il]/g, '1').replace(/S/g, '5').replace(/Z/g, '2').replace(/B/g, '8');
    var code = m[1] + digits;
    return CODE_RE.test(code) ? code : null;
  }

  function inLexicon(lex, code) {
    if (!lex) return true;
    if (typeof lex.indexOf === 'function' && lex.length != null) return lex.indexOf(code) !== -1;
    if (typeof lex.has === 'function') return lex.has(code);
    return Object.prototype.hasOwnProperty.call(lex, code);
  }

  function codesFrom(result, o) {
    var lex = o && o.lexicon, minSure = (o && o.minConf) || 80, out = [];
    (result.words || []).forEach(function (w) {
      var code = foldCode(w.text);
      if (!code) return;
      out.push({ text: w.text, code: code, conf: w.conf, bbox: w.bbox, sure: w.conf >= minSure && code === cleanTok(w.text).toUpperCase() && inLexicon(lex, code) });
    });
    return out;
  }

  function now() { return (global.performance && performance.now) ? performance.now() : Date.now(); }

  global.Ocr = {
    VERSION: VERSION,
    CACHE: CACHE,
    BASE: BASE,
    FILES: FILES,
    available: available,
    hasSimd: hasSimd,
    downloadSize: downloadSize,
    installed: installed,
    install: install,
    remove: remove,
    storedBytes: storedBytes,
    recognize: recognize,
    cancel: cancel,
    terminate: terminate,
    toTextItems: toTextItems,
    toPlainText: toPlainText,
    codesFrom: codesFrom,
    _foldCode: foldCode,
    _shape: shape,
    _modes: MODES,
    _unturn: unturn,
    _turned: turned
  };
})(typeof window !== 'undefined' ? window : this);
