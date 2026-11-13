#!/usr/bin/env bash
# Run test pages in headless Chrome and print each page's #summary line.
#
#   bash tools/headless-suite.sh sewing.test xstitch.test          # names under test/, no .html
#   bash tools/headless-suite.sh 'sew-visual.test?real=1'          # query strings are fine
#   bash tools/headless-suite.sh --all                             # every test page (or ALL=1)
#   JOBS=2 TIMEOUT=600 bash tools/headless-suite.sh xstitch.fixtures sewing.fixtures
#   VIRTUAL=1 BUDGET=120000 bash tools/headless-suite.sh knits.test  # old fast path
#
# Output: one line per page, "name: summary", in the order given. Exit status is
# non-zero if any page failed, timed out or printed no summary.
#
# Two modes:
#
#   Real time (default). Each page gets its own headless browser with its own
#   throwaway profile and a free DevTools port; tools/cdp-page.ps1 polls #summary
#   over the DevTools protocol until it holds a final "N passed, M failed" line or
#   TIMEOUT seconds pass. Pages run for real, so pdf.js, Web Workers and IndexedDB
#   behave exactly as in a tab. Up to JOBS pages run at once (default 3: many
#   agents share this machine). PowerShell 5.1 does the websocket work, so nothing
#   needs installing.
#
#   VIRTUAL=1. The old --virtual-time-budget --dump-dom path: fast, fine for
#   pure-logic pages, but pages that wait on PDFs, workers or IndexedDB often still
#   say "running..." when virtual time runs out. BUDGET is virtual milliseconds.
#
# Settings (environment):
#   PORT=8766      dev server port (the server must already be running)
#   TIMEOUT=180    real-time mode: seconds per page (fixture pages may need 600)
#   JOBS=3         real-time mode: pages at once
#   SHOW_TIME=1    real-time mode: append "[12 s]" to each line
#   DUMP=dir       real-time mode: save each page's visible text to dir/<name>.txt
#                  (to see which assertions failed or skipped); keep dir outside the repo
#   CHROME=path    browser to use (default Chrome, falling back to Edge)
#
# Every browser started here is killed when its page finishes or times out, and the
# exit trap (also on Ctrl-C) sweeps any browser whose profile lives in this run's
# temp directory, then deletes that directory. Nothing is written inside the repo.
set -u
PORT="${PORT:-8766}"
BUDGET="${BUDGET:-60000}"
TIMEOUT="${TIMEOUT:-180}"
JOBS="${JOBS:-3}"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
[ -x "$CHROME" ] || CHROME="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
if [ ! -x "$CHROME" ]; then echo "no Chrome or Edge found" >&2; exit 2; fi

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"

# --all / ALL=1: every test/*.html that reports "N passed, M failed" in #summary.
# That rule skips by itself: galleries and demos (no #summary, e.g. diagram.gallery,
# celebrate.test), dump / corpus dev tools (their #summary is not a pass/fail line,
# e.g. pdftext.dump, pdftext.corpus) and .js helpers (not .html). Files starting
# with "_" are someone's scratch probes and are skipped too.
all_pages() {
  local f n
  for f in "$repo"/test/*.html; do
    n="$(basename "$f" .html)"
    case "$n" in _*) continue ;; esac
    grep -q 'id="summary"' "$f" || continue
    grep -q "' passed, '" "$f" || continue
    echo "$n"
  done
}
args=()
[ "${ALL:-}" = 1 ] && args+=($(all_pages))
for a in "$@"; do
  if [ "$a" = "--all" ]; then args+=($(all_pages)); else args+=("$a"); fi
done
if [ ${#args[@]} -eq 0 ]; then
  echo "usage: bash tools/headless-suite.sh [--all] page[.html][?query] ..." >&2; exit 2
fi

# "sew-visual.test?real=1" -> url http://localhost:PORT/test/sew-visual.test.html?real=1
page_url() {
  local name="$1" base q
  base="${name%%\?*}"; q="${name#"$base"}"; base="${base%.html}"
  echo "http://localhost:$PORT/test/$base.html$q"
}
show_name() { local n="$1" base; base="${n%%\?*}"; echo "${base%.html}${n#"$base"}"; }

# One temp directory for the whole run; each page gets a sub-directory for its profile.
base="$(cygpath -u "${TEMP:-/tmp}" 2>/dev/null || echo "${TEMP:-/tmp}")"
run_unix="$(mktemp -d "$base/sk-headless-XXXXXX")"
run_win="$(cygpath -w "$run_unix" 2>/dev/null || echo "$run_unix")"
helper_win="$(cygpath -w "$here/cdp-page.ps1" 2>/dev/null || echo "$here/cdp-page.ps1")"
chrome_win="$(cygpath -w "$CHROME" 2>/dev/null || echo "$CHROME")"
run_helper() { powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$helper_win" "$@"; }

cleanup() {
  trap - EXIT INT TERM
  # Stop our own page runners, then sweep any browser still using a profile under
  # this run's directory (covers runners killed before their own cleanup ran).
  jobs -p | xargs -r kill 2>/dev/null
  run_helper -Sweep "$run_win" >/dev/null 2>&1
  # Windows can hold a file (e.g. the crash handler's .pma) for a moment after the
  # browser dies, so retry the delete for up to ~10 s, sweeping again in between.
  for _ in 1 2 3 4 5; do
    rm -rf "$run_unix" 2>/dev/null; [ -e "$run_unix" ] || break
    sleep 2; run_helper -Sweep "$run_win" >/dev/null 2>&1
  done
}
trap cleanup EXIT
trap 'echo "interrupted" >&2; cleanup; exit 130' INT TERM

status=0

# ---------------------------------------------------------------- VIRTUAL=1 (old path)
if [ "${VIRTUAL:-}" = 1 ]; then
  profile="$run_win\\virtual"
  for name in "${args[@]}"; do
    dom="$("$CHROME" --headless=new --disable-gpu --no-first-run --mute-audio \
        --user-data-dir="$profile" --virtual-time-budget="$BUDGET" \
        --dump-dom "$(page_url "$name")" 2>/dev/null)"
    summary="$(printf '%s' "$dom" | tr '\n' ' ' | sed -n 's/.*id="summary"[^>]*>\([^<]*\)<.*/\1/p' | head -1)"
    if [ -z "$summary" ]; then
      echo "$(show_name "$name"): (no summary: raise BUDGET or use real-time mode)"
      status=1
    else
      echo "$(show_name "$name"): $summary"
      case "$summary" in *running*) status=1 ;; *" 0 failed"*) ;; *) status=1 ;; esac
    fi
  done
  exit $status
fi

# ---------------------------------------------------------------- real time (default)
# run_one INDEX NAME: run one page and leave "rc<TAB>seconds<TAB>line" in INDEX.res.
run_one() {
  local i="$1" name="$2" t0 line rc
  t0=$(date +%s)
  local dump=()
  if [ -n "${DUMP:-}" ]; then
    mkdir -p "$DUMP"
    dump=(-DumpFile "$(cygpath -w "$DUMP" 2>/dev/null || echo "$DUMP")\\$(echo "$name" | tr '?&=/' '____').txt")
  fi
  run_helper -Url "$(page_url "$name")" -WorkDir "$run_win\\p$i" -Timeout "$TIMEOUT" \
      -Chrome "$chrome_win" "${dump[@]}" > "$run_unix/$i.out" 2>/dev/null
  rc=$?
  line="$(tr -d '\r' < "$run_unix/$i.out" | tail -1)"
  [ -n "$line" ] || { line="(no output from runner: its PowerShell was killed or crashed)"; rc=2; }
  printf '%s\t%s\t%s\n' "$rc" "$(( $(date +%s) - t0 ))" "$line" > "$run_unix/$i.tmp"
  mv "$run_unix/$i.tmp" "$run_unix/$i.res"
}

# Print finished results in the order the pages were given.
next=0
flush() {
  local rc secs line
  while [ $next -lt ${#args[@]} ] && [ -f "$run_unix/$next.res" ]; do
    IFS=$'\t' read -r rc secs line < "$run_unix/$next.res"
    if [ "${SHOW_TIME:-}" = 1 ]; then line="$line  [$secs s]"; fi
    echo "$(show_name "${args[$next]}"): $line"
    [ "$rc" = 0 ] || status=1
    next=$((next + 1))
  done
}

running=0
for i in "${!args[@]}"; do
  while [ $running -ge "$JOBS" ]; do wait -n; running=$((running - 1)); flush; done
  run_one "$i" "${args[$i]}" &
  running=$((running + 1))
done
wait
flush
exit $status
