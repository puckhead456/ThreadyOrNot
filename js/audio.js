/* Stitchkeeper — js/audio.js
 * window.Feedback : haptics (navigator.vibrate) + synthesized WebAudio tones.
 * No audio files. AudioContext is created lazily on the first user gesture
 * and resumed when suspended (iOS).
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */

  var getSettings = function () {
    return { haptics: true, sounds: true };
  };

  var ctx = null;
  var master = null;
  var unlocked = false;

  function settings() {
    var s;
    try {
      s = getSettings();
    } catch (e) {
      s = null;
    }
    if (!s || typeof s !== 'object') s = {};
    return {
      haptics: s.haptics !== false,
      sounds: s.sounds !== false
    };
  }

  /* ------------------------------------------------------------------ *
   * Audio plumbing
   * ------------------------------------------------------------------ */

  function AudioCtor() {
    return window.AudioContext || window.webkitAudioContext || null;
  }

  function ensureContext() {
    var Ctor = AudioCtor();
    if (!Ctor) return null;
    if (!ctx) {
      try {
        ctx = new Ctor();
      } catch (e) {
        ctx = null;
        return null;
      }
      try {
        master = ctx.createGain();
        master.gain.value = 0.28;
        master.connect(ctx.destination);
      } catch (e2) {
        master = null;
      }
    }
    if (ctx.state === 'suspended') {
      try {
        ctx.resume();
      } catch (e3) {
        /* ignore */
      }
    }
    return ctx;
  }

  /** Called from a real user gesture so iOS/Safari allows audio later. */
  function unlock() {
    if (unlocked) {
      ensureContext();
      return;
    }
    unlocked = true;
    var c = ensureContext();
    if (!c || !master) return;
    try {
      // A silent 1-sample blip satisfies the gesture requirement.
      var osc = c.createOscillator();
      var g = c.createGain();
      g.gain.value = 0.0001;
      osc.connect(g);
      g.connect(master);
      osc.start();
      osc.stop(c.currentTime + 0.01);
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * Play one short tone.
   * @param {number} freq    Hz
   * @param {number} delay   seconds from now
   * @param {number} dur     seconds
   * @param {number} gain    peak gain 0..1
   * @param {string} type    oscillator type
   */
  function tone(freq, delay, dur, gain, type) {
    var c = ensureContext();
    if (!c || !master) return;
    try {
      var t0 = c.currentTime + (delay || 0);
      var osc = c.createOscillator();
      var g = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain || 0.2), t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) {
      /* ignore */
    }
  }

  function vibrate(pattern) {
    if (!settings().haptics) return;
    if (!navigator || typeof navigator.vibrate !== 'function') return;
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      /* ignore */
    }
  }

  /* The dev server is where automated testing happens, and its taps would
     play through the owner's speakers. So localhost is silent unless a
     developer opts in: localStorage['thready.devSound'] = '1'. The live
     site and installed apps are unaffected. */
  function devMuted() {
    try {
      var h = window.location.hostname;
      if (h !== 'localhost' && h !== '127.0.0.1' && h !== '[::1]') return false;
      return window.localStorage.getItem('thready.devSound') !== '1';
    } catch (e) {
      return false;
    }
  }

  function sound(fn) {
    if (!settings().sounds) return;
    if (devMuted()) return;
    fn();
  }

  /* ------------------------------------------------------------------ *
   * Public effects
   * ------------------------------------------------------------------ */

  function tap() {
    vibrate(10);
    sound(function () {
      tone(660, 0, 0.045, 0.16, 'triangle');
    });
  }

  function group() {
    vibrate([15, 40, 15]);
    sound(function () {
      tone(880, 0, 0.06, 0.2, 'triangle');
      tone(1174, 0.055, 0.07, 0.15, 'triangle');
    });
  }

  function row() {
    vibrate([30, 50, 30]);
    sound(function () {
      tone(587, 0, 0.09, 0.22, 'sine');
      tone(880, 0.085, 0.14, 0.22, 'sine');
    });
  }

  function alert() {
    vibrate([60, 60, 60, 60, 60]);
    sound(function () {
      tone(988, 0, 0.09, 0.22, 'square');
      tone(740, 0.1, 0.09, 0.22, 'square');
      tone(988, 0.2, 0.12, 0.22, 'square');
    });
  }

  function done() {
    vibrate([40, 60, 40, 60, 120]);
    sound(function () {
      var notes = [523, 659, 784, 1047];
      for (var i = 0; i < notes.length; i++) {
        tone(notes[i], i * 0.1, 0.22, 0.22, 'triangle');
      }
      tone(1319, 0.42, 0.5, 0.18, 'sine');
    });
  }

  function undo() {
    vibrate(20);
    sound(function () {
      tone(330, 0, 0.1, 0.18, 'sine');
      tone(247, 0.07, 0.12, 0.14, 'sine');
    });
  }

  /* ------------------------------------------------------------------ *
   * Init
   * ------------------------------------------------------------------ */

  function init(settingsGetter) {
    if (typeof settingsGetter === 'function') getSettings = settingsGetter;
    var opts = { passive: true };
    var once = function () {
      unlock();
    };
    document.addEventListener('pointerdown', once, opts);
    document.addEventListener('touchstart', once, opts);
    document.addEventListener('keydown', once, opts);
    document.addEventListener(
      'visibilitychange',
      function () {
        if (document.visibilityState === 'visible' && ctx && ctx.state === 'suspended') {
          try {
            ctx.resume();
          } catch (e) {
            /* ignore */
          }
        }
      },
      opts
    );
  }

  window.Feedback = {
    init: init,
    unlock: unlock,
    tap: tap,
    group: group,
    row: row,
    alert: alert,
    done: done,
    undo: undo
  };
})();
