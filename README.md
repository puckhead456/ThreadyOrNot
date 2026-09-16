# Thready or Not

> Proprietary. Copyright (c) 2026 puckhead456. All rights reserved. See LICENSE.

Thready or Not is a row & stitch counter for crochet projects — track rows/rounds,
stitches, repeats, pattern text, assembly checklists, and progress across
multiple parts of a project. It's an installable web app (PWA) that works
offline, with six built-in themes.

Live app: **https://puckhead456.github.io/ThreadyOrNot/**

## Install it on your phone

**iPhone (Safari):** open the live link above, tap the Share icon, then
"Add to Home Screen".

**Android (Chrome):** open the live link above, tap the ⋮ menu, then
"Add to Home screen" (or "Install app" if offered).

Once installed it opens full-screen like a native app and keeps working
without an internet connection.

## Your data

All project data lives on your device (in the browser's local storage) —
nothing is uploaded anywhere. Use the Export option in Settings to save a
backup file, and Import to restore it (or move it to another device).

## Development

No build step. Just open `index.html` through any static file server (a
plain `file://` open works for most things, but a local server is needed to
test the service worker/PWA install behavior), for example:

```
npx serve .
```

or any other static server of your choice.

When you change any file listed in the service worker's precache list
(`sw.js`), bump `CACHE_VERSION` in `sw.js` so installed clients pick up the
update instead of serving a stale cache.
