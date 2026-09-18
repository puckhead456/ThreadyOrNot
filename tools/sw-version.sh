#!/usr/bin/env bash
# tools/sw-version.sh — generate sw.js's CACHE_VERSION from a content hash.
#
# The version is a hash of every file listed in sw.js's own PRECACHE_URLS array
# (the list is read out of sw.js, so it can never drift from what ships) plus
# sw.js itself minus its CACHE_VERSION line. Excluding that one line is what
# makes the script idempotent: running it twice in a row is a no-op.
#
# Line endings are normalised (a trailing CR is stripped from text files) before
# hashing, so a CRLF working tree on Windows and the LF checkout on the
# ubuntu-latest CI runner produce the same hash.
#
# Usage:
#   tools/sw-version.sh            rewrite the CACHE_VERSION line in sw.js
#   tools/sw-version.sh --check    exit 1 if sw.js disagrees with the hash
#   tools/sw-version.sh --list     print the precached paths, one per line
#   tools/sw-version.sh --print    print the computed version only
#
# No node, no python: bash + sha1sum (or `git hash-object` as a fallback).

set -u

MODE="write"
case "${1:-}" in
  "") ;;
  --check) MODE="check" ;;
  --list) MODE="list" ;;
  --print) MODE="print" ;;
  -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
  *) echo "sw-version: unknown argument '$1'" >&2; exit 2 ;;
esac

# --- repo root -------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT" || exit 1
SW="sw.js"
[ -f "$SW" ] || { echo "sw-version: $ROOT/$SW not found" >&2; exit 2; }

# --- hashing ---------------------------------------------------------------
if command -v sha1sum >/dev/null 2>&1; then
  sha1() { sha1sum | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha1() { shasum -a 1 | cut -d' ' -f1; }
else
  sha1() { git hash-object --stdin; }
fi

# Text files are hashed with trailing CRs stripped; everything else byte-for-byte.
hash_file() {
  case "$1" in
    *.js|*.css|*.html|*.htm|*.json|*.webmanifest|*.svg|*.txt|*.md|*.yml|*.yaml)
      sed 's/\r$//' "$1" | sha1 ;;
    *)
      sha1 < "$1" ;;
  esac
}

# --- the precache list, read out of sw.js ----------------------------------
# Everything between `const PRECACHE_URLS = [` and the closing `];`, comments
# stripped, single-quoted strings kept, './' mapped onto './index.html'.
read_precache_urls() {
  sed 's/\r$//' "$SW" \
    | awk '/^const PRECACHE_URLS = \[/ { inlist = 1; next }
           inlist && /^\];/           { inlist = 0 }
           inlist                     { print }' \
    | sed 's#//.*##' \
    | grep -o "'[^']*'" \
    | tr -d "'"
}

# Resolve a PRECACHE_URLS entry to a repo-relative path.
resolve_url() {
  local u="$1"
  u="${u#./}"
  [ -z "$u" ] && u="index.html"          # './' is index.html
  case "$u" in */) u="${u}index.html" ;; esac
  printf '%s\n' "$u"
}

PATHS=""
SEEN=" "
while IFS= read -r raw; do
  [ -z "$raw" ] && continue
  p="$(resolve_url "$raw")"
  case "$SEEN" in *" $p "*) continue ;; esac
  SEEN="$SEEN$p "
  PATHS="$PATHS$p
"
done <<EOF
$(read_precache_urls)
EOF

if [ "$MODE" = "list" ]; then
  printf '%s' "$PATHS"
  exit 0
fi

[ -n "$PATHS" ] || { echo "sw-version: could not read PRECACHE_URLS from $SW" >&2; exit 2; }

# --- the aggregate hash ----------------------------------------------------
MISSING=0
manifest() {
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if [ -f "$p" ]; then
      printf '%s %s\n' "$p" "$(hash_file "$p")"
    else
      printf '%s %s\n' "$p" "missing"
      MISSING=$((MISSING + 1))
      echo "sw-version: warning: precached file not found: $p" >&2
    fi
  done <<EOF2
$PATHS
EOF2
  # sw.js itself, minus the line this script rewrites (keeps it idempotent).
  printf '%s %s\n' "$SW" \
    "$(sed 's/\r$//' "$SW" | grep -v '^const CACHE_VERSION' | sha1)"
}

DIGEST="$(manifest | sha1)"
NEW="h${DIGEST:0:10}"

OLD="$(sed 's/\r$//' "$SW" \
  | grep -m1 "^const CACHE_VERSION = '" \
  | sed "s/^const CACHE_VERSION = '\([^']*\)'.*/\1/")"

if [ -z "$OLD" ]; then
  echo "sw-version: no \"const CACHE_VERSION = '...';\" line in $SW" >&2
  exit 2
fi

case "$MODE" in
  print)
    printf '%s\n' "$NEW"
    ;;
  check)
    if [ "$OLD" = "$NEW" ]; then
      echo "sw-version: OK — sw.js CACHE_VERSION '$OLD' matches the content hash."
    else
      echo "sw-version: FAIL — sw.js says CACHE_VERSION '$OLD' but the precached" >&2
      echo "  files hash to '$NEW'. A precached file changed without the service" >&2
      echo "  worker's cache version changing, so installed users would keep being" >&2
      echo "  served the old files." >&2
      echo "  Fix: run  tools/sw-version.sh  and commit sw.js." >&2
      echo "  (Install the hook once so this never happens again:" >&2
      echo "   git config core.hooksPath .githooks)" >&2
      exit 1
    fi
    ;;
  write)
    if [ "$OLD" = "$NEW" ]; then
      echo "sw-version: $OLD -> $NEW (unchanged)"
    else
      # No end-of-line anchor: any trailing CR in a CRLF working tree survives.
      sed -i "s/^\(const CACHE_VERSION = '\)[^']*\(';\)/\1$NEW\2/" "$SW" \
        || { echo "sw-version: could not rewrite $SW" >&2; exit 2; }
      echo "sw-version: $OLD -> $NEW (sw.js updated)"
    fi
    ;;
esac

exit 0
