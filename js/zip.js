/* Thready or Not — js/zip.js
 * window.Zip : a small, dependency-free ZIP writer and reader for the
 * `.thready` backup container (docs/brainstorm/12-interoperability.md #4).
 *
 *   Zip.write(entries, { date, type }) -> Promise<Blob>
 *       entries: [{ name, data }]   data = string (UTF-8) | Uint8Array |
 *                                   ArrayBuffer | Blob
 *       Every entry is STORED (method 0): the big entries are JPEG/PNG page
 *       images that do not compress twice, and the JSON is small. Names are
 *       UTF-8 with the language-encoding flag (bit 11) set. Blob entries are
 *       read one at a time for their CRC and then handed to the output Blob
 *       as Blobs, so a 40-page chart is never one giant ArrayBuffer.
 *   Zip.writeSync(entries, opts) -> Uint8Array   (no Blob entries; tests)
 *   Zip.read(bytes) -> Promise<{ entries: [{ name, size, method, crc,
 *                                  data: Uint8Array|null, crcOk, error }] }>
 *       Structural damage rejects (see codes below). A single damaged entry
 *       does not: it comes back with `crcOk: false` (or `error`) so a caller
 *       can skip one bad page image and keep the rest. DEFLATE entries
 *       (method 8, what an OS "Compress" makes when someone re-zips the
 *       folder) are inflated with DecompressionStream where the browser has
 *       it, otherwise they come back with `error: 'compressed'`.
 *   Zip.parse(bytes) -> the same, synchronously, with method-8 data left
 *                       compressed and unchecked (`crcOk: null`).
 *   Zip.isZip(bytes) -> boolean    (the PK\x03\x04 / PK\x05\x06 magic)
 *   Zip.crc32(bytes [, crc]) -> uint32
 *   Zip.utf8(string) -> Uint8Array ; Zip.fromUtf8(Uint8Array) -> string
 *
 * Errors carry `.code`: 'notZip' (no zip signature), 'badZip' (truncated or
 * inconsistent), 'zip64' (we neither write nor read zip64), 'encrypted',
 * 'tooBig' (over 4 GB or 65 535 entries on write), 'badName' (empty or
 * duplicate name on write).
 */
(function () {
  'use strict';

  var SIG_LOCAL = 0x04034b50;
  var SIG_CENTRAL = 0x02014b50;
  var SIG_END = 0x06054b50;
  var FLAG_UTF8 = 0x0800;
  var MAX_U32 = 0xffffffff;
  var MAX_ENTRIES = 0xffff;

  function zipError(message, code) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  /* ---- CRC-32 (IEEE 802.3, the one zip uses) ------------------------- */

  var CRC_TABLE = null;

  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    var t = typeof Int32Array === 'function' ? new Int32Array(256) : [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    CRC_TABLE = t;
    return t;
  }

  /** CRC of `u8`, optionally continuing from an earlier `crc`. */
  function crc32(u8, crc) {
    var t = crcTable();
    var c = (crc === undefined ? 0 : crc) ^ -1;
    for (var i = 0, n = u8.length; i < n; i++) c = t[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  /* ---- UTF-8 ----------------------------------------------------------- */

  function utf8(str) {
    str = String(str == null ? '' : str);
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(str);
    var bin = unescape(encodeURIComponent(str));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function fromUtf8(u8) {
    if (!u8) return '';
    if (typeof TextDecoder === 'function') return new TextDecoder('utf-8').decode(u8);
    var bin = '';
    for (var i = 0; i < u8.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, Array.prototype.slice.call(u8, i, i + 0x8000));
    }
    try {
      return decodeURIComponent(escape(bin));
    } catch (e) {
      return bin;
    }
  }

  /* ---- byte plumbing --------------------------------------------------- */

  function isBlob(v) {
    return typeof Blob === 'function' && v instanceof Blob;
  }

  function toU8(data) {
    if (data === null || data === undefined) return new Uint8Array(0);
    if (typeof data === 'string') return utf8(data);
    if (data instanceof Uint8Array) return data;
    if (typeof ArrayBuffer === 'function' && data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data && data.buffer && typeof data.byteLength === 'number') {
      return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
    }
    throw zipError('An entry has data of a kind this writer does not take.', 'badData');
  }

  function blobBytes(blob) {
    if (typeof blob.arrayBuffer === 'function') {
      return blob.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    }
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(new Uint8Array(fr.result)); };
      fr.onerror = function () { reject(fr.error || new Error('Could not read a file to zip.')); };
      fr.readAsArrayBuffer(blob);
    });
  }

  function dosTime(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) d = new Date();
    var year = Math.max(1980, Math.min(2107, d.getFullYear()));
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  /* ---- writing ---------------------------------------------------------- */

  /**
   * Check names and turn each entry into { nameBytes, crc, size, part }
   * where `part` is what goes into the output (a Blob stays a Blob).
   */
  function prepareSync(entries) {
    return entries.map(function (e) {
      var u8 = toU8(e.data);
      return { name: e.name, crc: crc32(u8), size: u8.length, part: u8 };
    });
  }

  function checkNames(entries) {
    if (!Array.isArray(entries)) throw zipError('Nothing to zip.', 'badName');
    if (entries.length > MAX_ENTRIES) throw zipError('Too many files for one zip.', 'tooBig');
    var seen = Object.create(null);
    for (var i = 0; i < entries.length; i++) {
      var name = entries[i] && entries[i].name;
      if (typeof name !== 'string' || !name) throw zipError('A zip entry needs a name.', 'badName');
      if (seen[name]) throw zipError('Two zip entries are both called ' + name + '.', 'badName');
      seen[name] = true;
    }
  }

  /** The headers around already-prepared entries, as an array of parts. */
  function assemble(prepared, opts) {
    var stamp = dosTime(opts && opts.date);
    var parts = [];
    var central = [];
    var offset = 0;
    var cdSize = 0;

    prepared.forEach(function (p) {
      var name = utf8(p.name);
      var local = new Uint8Array(30 + name.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, SIG_LOCAL, true);
      lv.setUint16(4, 20, true);            // version needed: 2.0
      lv.setUint16(6, FLAG_UTF8, true);
      lv.setUint16(8, 0, true);             // STORED
      lv.setUint16(10, stamp.time, true);
      lv.setUint16(12, stamp.date, true);
      lv.setUint32(14, p.crc, true);
      lv.setUint32(18, p.size, true);
      lv.setUint32(22, p.size, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      local.set(name, 30);

      var cen = new Uint8Array(46 + name.length);
      var cv = new DataView(cen.buffer);
      cv.setUint32(0, SIG_CENTRAL, true);
      cv.setUint16(4, 20, true);            // made by: 2.0, MS-DOS attributes
      cv.setUint16(6, 20, true);
      cv.setUint16(8, FLAG_UTF8, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, stamp.time, true);
      cv.setUint16(14, stamp.date, true);
      cv.setUint32(16, p.crc, true);
      cv.setUint32(20, p.size, true);
      cv.setUint32(24, p.size, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cen.set(name, 46);

      parts.push(local, p.part);
      central.push(cen);
      offset += local.length + p.size;
      cdSize += cen.length;
      if (offset > MAX_U32) throw zipError('That is more than a zip without zip64 can hold (4 GB).', 'tooBig');
    });

    if (offset + cdSize > MAX_U32) throw zipError('That is more than a zip without zip64 can hold (4 GB).', 'tooBig');

    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, SIG_END, true);
    ev.setUint16(8, prepared.length, true);
    ev.setUint16(10, prepared.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    return parts.concat(central, [end]);
  }

  function concat(parts) {
    var len = 0;
    var i;
    for (i = 0; i < parts.length; i++) len += parts[i].length;
    var out = new Uint8Array(len);
    var at = 0;
    for (i = 0; i < parts.length; i++) {
      out.set(parts[i], at);
      at += parts[i].length;
    }
    return out;
  }

  /** Synchronous writer for byte/string entries only. */
  function writeSync(entries, opts) {
    checkNames(entries);
    for (var i = 0; i < entries.length; i++) {
      if (isBlob(entries[i].data)) throw zipError('writeSync cannot read Blobs; use Zip.write.', 'badData');
    }
    return concat(assemble(prepareSync(entries), opts));
  }

  /** The writer the app uses: Blob entries welcome, output is a Blob. */
  function write(entries, opts) {
    opts = opts || {};
    try {
      checkNames(entries);
    } catch (e) {
      return Promise.reject(e);
    }
    var prepared = [];
    var chain = Promise.resolve();
    entries.forEach(function (e) {
      chain = chain.then(function () {
        if (!isBlob(e.data)) {
          var u8 = toU8(e.data);
          prepared.push({ name: e.name, crc: crc32(u8), size: u8.length, part: u8 });
          return null;
        }
        return blobBytes(e.data).then(function (u8) {
          // The bytes are only needed for the CRC; the Blob itself goes into
          // the output, so this buffer can be collected straight away.
          prepared.push({ name: e.name, crc: crc32(u8), size: u8.length, part: e.data });
        });
      });
    });
    return chain.then(function () {
      return new Blob(assemble(prepared, opts), { type: opts.type || 'application/zip' });
    });
  }

  /* ---- reading ---------------------------------------------------------- */

  function bytesOf(input) {
    if (input instanceof Uint8Array) return input;
    if (typeof ArrayBuffer === 'function' && input instanceof ArrayBuffer) return new Uint8Array(input);
    if (input && input.buffer && typeof input.byteLength === 'number') {
      return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
    }
    return null;
  }

  function isZip(input) {
    var u8 = bytesOf(input);
    if (!u8 || u8.length < 4) return false;
    if (u8[0] !== 0x50 || u8[1] !== 0x4b) return false;
    return (u8[2] === 3 && u8[3] === 4) || (u8[2] === 5 && u8[3] === 6);
  }

  function findEnd(u8, dv) {
    var stop = Math.max(0, u8.length - 22 - 0xffff);
    for (var p = u8.length - 22; p >= stop; p--) {
      if (u8[p] === 0x50 && u8[p + 1] === 0x4b && dv.getUint32(p, true) === SIG_END) return p;
    }
    return -1;
  }

  /** The central directory, every entry located; data not yet inflated. */
  function parse(input) {
    var u8 = bytesOf(input);
    if (!u8) throw zipError('That is not a zip file.', 'notZip');
    if (!isZip(u8)) throw zipError('That is not a zip file.', 'notZip');
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var endAt = findEnd(u8, dv);
    if (endAt < 0) throw zipError('That zip file is cut short.', 'badZip');

    var count = dv.getUint16(endAt + 10, true);
    var cdSize = dv.getUint32(endAt + 12, true);
    var cdOffset = dv.getUint32(endAt + 16, true);
    if (count === 0xffff || cdSize === MAX_U32 || cdOffset === MAX_U32) {
      throw zipError('That zip uses zip64, which this app does not read.', 'zip64');
    }
    if (cdOffset + cdSize > endAt) throw zipError('That zip file is damaged.', 'badZip');

    var entries = [];
    var p = cdOffset;
    for (var i = 0; i < count; i++) {
      if (p + 46 > endAt || dv.getUint32(p, true) !== SIG_CENTRAL) {
        throw zipError('That zip file is damaged.', 'badZip');
      }
      var flags = dv.getUint16(p + 8, true);
      var method = dv.getUint16(p + 10, true);
      var crc = dv.getUint32(p + 16, true);
      var csize = dv.getUint32(p + 20, true);
      var usize = dv.getUint32(p + 24, true);
      var nlen = dv.getUint16(p + 28, true);
      var xlen = dv.getUint16(p + 30, true);
      var clen = dv.getUint16(p + 32, true);
      var lo = dv.getUint32(p + 42, true);
      if (p + 46 + nlen > endAt) throw zipError('That zip file is damaged.', 'badZip');
      var name = fromUtf8(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;

      if (csize === MAX_U32 || usize === MAX_U32 || lo === MAX_U32) {
        throw zipError('That zip uses zip64, which this app does not read.', 'zip64');
      }
      if (flags & 1) throw zipError('That zip is password protected.', 'encrypted');
      if (lo + 30 > u8.length || dv.getUint32(lo, true) !== SIG_LOCAL) {
        throw zipError('That zip file is damaged.', 'badZip');
      }
      var start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      if (start + csize > u8.length) throw zipError('That zip file is cut short.', 'badZip');

      var raw = u8.subarray(start, start + csize);
      var entry = {
        name: name,
        size: usize,
        method: method,
        crc: crc,
        dir: /\/$/.test(name),
        data: null,
        crcOk: null,
        error: null,
        _raw: raw
      };
      if (method === 0) {
        entry.data = raw;
        entry.crcOk = csize === usize && crc32(raw) === crc;
      }
      entries.push(entry);
    }
    return { entries: entries };
  }

  function inflateRaw(raw) {
    if (typeof DecompressionStream !== 'function' || typeof Response !== 'function') {
      return Promise.resolve(null);
    }
    try {
      var stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).arrayBuffer().then(function (buf) {
        return new Uint8Array(buf);
      }, function () {
        return undefined;  // damaged deflate data
      });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function read(input) {
    var zip;
    try {
      zip = parse(input);
    } catch (e) {
      return Promise.reject(e);
    }
    var chain = Promise.resolve();
    zip.entries.forEach(function (e) {
      if (e.method === 0 || e.dir) return;
      if (e.method !== 8) {
        e.error = 'unsupported';
        e.crcOk = false;
        return;
      }
      chain = chain.then(function () {
        return inflateRaw(e._raw).then(function (out) {
          if (out === null) {
            e.error = 'compressed';
            e.crcOk = false;
          } else if (out === undefined) {
            e.error = 'damaged';
            e.crcOk = false;
          } else {
            e.data = out;
            e.crcOk = out.length === e.size && crc32(out) === e.crc;
          }
        });
      });
    });
    return chain.then(function () {
      zip.entries.forEach(function (e) { delete e._raw; });
      return zip;
    });
  }

  window.Zip = {
    write: write,
    writeSync: writeSync,
    read: read,
    parse: parse,
    isZip: isZip,
    crc32: crc32,
    utf8: utf8,
    fromUtf8: fromUtf8
  };
})();
