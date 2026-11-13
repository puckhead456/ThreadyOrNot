# Run ONE test page in its own headless Chrome/Edge, in real time, and print its #summary.
#
# Called by tools/headless-suite.sh (one call per page, several at once); you can also
# call it by hand:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cdp-page.ps1 `
#       -Url http://localhost:8766/test/blobstore.test.html -WorkDir C:\Temp\x -Timeout 180
#
# How it works, in order:
#   1. Start the browser headless with a throwaway profile in -WorkDir and
#      --remote-debugging-port=0, so the OS picks a free port. The browser writes the
#      port it got into <profile>\DevToolsActivePort; read it from there (no race with
#      other agents grabbing the same port).
#   2. Ask http://127.0.0.1:<port>/json/list for the page's DevTools websocket and
#      connect with .NET's ClientWebSocket (PowerShell 5.1 has it; no Node, no Python).
#   3. Once a second, send Runtime.evaluate for the text of #summary. Stop when it
#      holds a final "N passed, M failed" line (and not "running..."), or at -Timeout.
#   4. In every case (done, timeout, error, Ctrl-C when PowerShell gets to run its
#      finally block) kill the browser's whole process tree and delete the profile.
#      The bash side also sweeps by profile path in case this script itself is killed.
#
# Output: exactly one line on stdout, the summary text or a "(...)" note saying why
# there is none. Exit code: 0 = final line with 0 failed, 1 = final line with
# failures, 3 = timed out / no final line, 2 = could not start or talk to the browser.
#
# -Sweep <dir> instead kills every chrome/msedge process whose command line mentions
# <dir> (used by the bash script's exit trap) and exits.
param(
  [string]$Url,
  [string]$WorkDir,
  [int]$Timeout = 180,
  [string]$Chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe',
  [string]$Sweep,
  [string]$DumpFile    # optional: save document.body.innerText here when the page finishes
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Kill every browser process started with a profile under $dir. Matching on the
# command line means we only ever touch our own browsers, never the Browser pane's
# or another agent's.
function Stop-BrowsersUnder([string]$dir) {
  if (-not $dir) { return }
  $needle = $dir.TrimEnd('\')
  try {
    Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" |
      Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 } |
      ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
  } catch {}
}

# Sweep mode: first stop any page runner (this script, started with a -WorkDir under
# $Sweep) other than ourselves, so none restarts polling; then stop the browsers.
if ($Sweep) {
  $needle = $Sweep.TrimEnd('\')
  try {
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
      Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine -like '*cdp-page.ps1*' -and
                     $_.CommandLine.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 } |
      ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
  } catch {}
  Stop-BrowsersUnder $Sweep
  exit 0
}

# A summary is final when it has "N passed, M failed" and no longer says running.
function Get-Verdict([string]$text) {
  if (-not $text) { return $null }
  if ($text -match 'running') { return $null }
  if ($text -match '(\d+) passed, (\d+) failed') {
    if ([int]$Matches[2] -eq 0) { return 0 } else { return 1 }
  }
  return $null
}

$profileDir = Join-Path $WorkDir 'profile'
New-Item -ItemType Directory -Force $profileDir | Out-Null
$browser = $null
$ws = $null
$lastText = ''
$code = 2
$line = '(browser did not start)'

try {
  # --- 1. start the browser -------------------------------------------------------
  $flags = @(
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--mute-audio', '--disable-extensions', '--disable-sync',
    '--disable-background-networking', '--disable-component-update',
    '--disable-default-apps', '--disable-crash-reporter', '--disable-breakpad',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--window-size=1280,900', '--remote-debugging-port=0',
    ('--user-data-dir="' + $profileDir + '"'),
    $Url
  )
  $browser = Start-Process -FilePath $Chrome -ArgumentList $flags -PassThru `
    -RedirectStandardError (Join-Path $WorkDir 'browser.err') `
    -RedirectStandardOutput (Join-Path $WorkDir 'browser.out') -WindowStyle Hidden

  # --- 2. find the debugging port and the page's websocket ------------------------
  $portFile = Join-Path $profileDir 'DevToolsActivePort'
  $deadline = (Get-Date).AddSeconds(30)
  while (-not (Test-Path $portFile) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
  if (-not (Test-Path $portFile)) { throw 'no DevToolsActivePort after 30 s' }
  $port = $null
  while (-not $port -and (Get-Date) -lt $deadline) {
    try { $port = (Get-Content $portFile -ErrorAction Stop | Select-Object -First 1).Trim() } catch {}
    if (-not $port) { Start-Sleep -Milliseconds 200 }
  }
  $wsUrl = $null
  while (-not $wsUrl -and (Get-Date) -lt $deadline) {
    try {
      $targets = Invoke-RestMethod -UseBasicParsing -TimeoutSec 5 "http://127.0.0.1:$port/json/list"
      $wsUrl = ($targets | Where-Object { $_.type -eq 'page' } | Select-Object -First 1).webSocketDebuggerUrl
    } catch {}
    if (-not $wsUrl) { Start-Sleep -Milliseconds 300 }
  }
  if (-not $wsUrl) { throw "no page target on port $port" }

  # --- 3. poll #summary ------------------------------------------------------------
  $expr = "(function(){var e=document.getElementById('summary');return e?e.textContent:'(page has no #summary element)'})()"
  $script:msgId = 0
  $buf = New-Object byte[] 65536

  # Send one Runtime.evaluate on $ws and return its string value. Throws on timeout
  # or a broken socket (the caller then reconnects).
  function Invoke-Eval([string]$js, [int]$waitMs) {
    $script:msgId++
    $id = $script:msgId
    $req = @{ id = $id; method = 'Runtime.evaluate'; params = @{ expression = $js; returnByValue = $true } } |
      ConvertTo-Json -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($req)
    $ws.SendAsync((New-Object ArraySegment[byte] -ArgumentList @(, $bytes)), 'Text', $true, [Threading.CancellationToken]::None).Wait() | Out-Null
    $cts = New-Object Threading.CancellationTokenSource $waitMs
    while ($true) {
      # Collect the whole message as bytes first, so a UTF-8 character split
      # across two frames still decodes correctly.
      $mem = New-Object IO.MemoryStream
      do {
        $r = $ws.ReceiveAsync((New-Object ArraySegment[byte] -ArgumentList @(, $buf)), $cts.Token).GetAwaiter().GetResult()
        $mem.Write($buf, 0, $r.Count)
      } while (-not $r.EndOfMessage)
      $msg = [Text.Encoding]::UTF8.GetString($mem.ToArray()) | ConvertFrom-Json
      if ($msg.id -eq $id) {           # anything else is an event or a late reply
        if ($msg.result -and $msg.result.result) { return [string]$msg.result.result.value }
        return ''
      }
    }
  }
  $start = Get-Date
  $code = 3
  $line = $null
  while ($true) {
    $left = $Timeout - ((Get-Date) - $start).TotalSeconds
    if ($left -le 0) { break }
    try {
      if (-not $ws -or $ws.State -ne 'Open') {
        if ($ws) { $ws.Dispose() }
        $ws = New-Object System.Net.WebSockets.ClientWebSocket
        $ws.ConnectAsync([Uri]$wsUrl, [Threading.CancellationToken]::None).Wait(10000) | Out-Null
      }
      # A page busy in a long synchronous task answers late; wait up to 30 s (or what
      # is left), then drop the socket and reconnect on the next round.
      $lastText = Invoke-Eval $expr ([int]([Math]::Min(30, [Math]::Max(1, $left)) * 1000))
      $v = Get-Verdict $lastText
      if ($null -ne $v) {
        $code = $v; $line = ($lastText -replace '\s+', ' ').Trim()
        # DUMP: also save the page's visible text (which assertions failed / skipped).
        if ($DumpFile) {
          try {
            $text = Invoke-Eval 'document.body.innerText' 30000
            [IO.File]::WriteAllText($DumpFile, $text, (New-Object Text.UTF8Encoding $false))
          } catch {}
        }
        break
      }
    } catch {
      # Timeout or broken socket: reconnect next time round.
      if ($ws) { try { $ws.Abort() } catch {}; $ws.Dispose(); $ws = $null }
    }
    Start-Sleep -Milliseconds 1000
  }
  if ($null -eq $line) {
    $now = ($lastText -replace '\s+', ' ').Trim()
    if (-not $now) { $now = 'empty' }
    $line = "(timed out after $Timeout s; summary was: $now)"
    if ($DumpFile -and $ws -and $ws.State -eq 'Open') {
      try { [IO.File]::WriteAllText($DumpFile, (Invoke-Eval 'document.body.innerText' 5000), (New-Object Text.UTF8Encoding $false)) } catch {}
    }
  }
} catch {
  $code = 2
  $line = '(runner error: ' + $_.Exception.Message + ')'
} finally {
  # Print the result FIRST, so it is not lost if something kills us during cleanup.
  if ($null -eq $line) { $line = '(interrupted)' }
  [Console]::Out.WriteLine($line); [Console]::Out.Flush()

  # --- 4. clean up ------------------------------------------------------------------
  if ($ws) { try { $ws.Abort() } catch {}; try { $ws.Dispose() } catch {} }
  if ($browser) { & taskkill.exe /PID $browser.Id /T /F 2>&1 | Out-Null }
  Stop-BrowsersUnder $WorkDir
  # The profile is briefly locked while the browser exits; retry for a few seconds.
  for ($i = 0; $i -lt 40 -and (Test-Path $WorkDir); $i++) {
    try { Remove-Item -Recurse -Force $WorkDir -ErrorAction Stop } catch { Start-Sleep -Milliseconds 250 }
  }
}
exit $code
