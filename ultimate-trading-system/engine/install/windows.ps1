# INSTALL THE TRADING PLATFORM ON THIS WINDOWS COMPUTER.
# Shown on the Compute tab, step 2 of the platform's checklist, to paste into
# PowerShell opened as administrator:
#   Set-ExecutionPolicy Bypass -Scope Process -Force; [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; & ([scriptblock]::Create((irm '<this system>/engine-link/install/windows.ps1'))) '<this system>' '<short name>' '<install code>'
# The first two parts let a plain Windows PowerShell run it: scripts allowed for
# this window only, and the secure connection older Windows 10 does not use for
# a download by itself.
#
# What it does, and nothing else:
#   * its own copy of Node.js -- the version written below, fetched from
#     nodejs.org and checked against its fingerprint before it is used -- in
#     "Program Files\uts-engine-<short name>-node". Nothing has to be installed
#     first, and any other Node.js on this computer is left alone and not used;
#   * the platform's program in "Program Files\uts-engine-<short name>", its data
#     (record, lock, keys) in "ProgramData\uts-engine-<short name>", which only
#     SYSTEM and administrators can read;
#   * a scheduled task, uts-engine-<short name>, that starts it when Windows
#     starts and again if it stops, with real orders off.
# The platform then calls this system with the install code and is given a
# password of its own. Nothing is opened on this computer for anyone to come in:
# the platform calls out. Run again with a new code, it stops the program that
# runs now, replaces it, and keeps the record, the lock and the keys.
param([string]$Base, [string]$Short, [string]$Code)
$ErrorActionPreference = 'Stop'
# Windows PowerShell draws a progress bar that makes a download many times slower
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# NODE.JS, PINNED: the version, and the fingerprint of each download as the
# signed list published with the release gives it (nodejs.org/dist/v24.21.0/SHASUMS256.txt)
$NodeVersion = 'v24.21.0'
$NodeSha256 = @{
  'win-x64'   = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
  'win-arm64' = '8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921'
}

if ($Base -notmatch '^(https://.+/|http://127\.0\.0\.1:\d+/)$') { throw "the first word must be this system's address, ending in /" }
if ($Short -notmatch '^[a-z0-9][a-z0-9-]{1,29}$') { throw 'the short name must be 2 to 30 of a-z, 0-9 and -' }
if ($Code -notmatch '^UTS(-[A-Z0-9]{4}){6}$') { throw 'that does not look like an install code: make a new install command on the Compute tab' }
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'open PowerShell as administrator and run it again' }

# a 32-bit PowerShell on a 64-bit Windows says x86 here and the truth in PROCESSOR_ARCHITEW6432
$arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$plat = switch ($arch) { 'AMD64' { 'win-x64' } 'ARM64' { 'win-arm64' } default { $null } }
if (-not $plat) { throw "this computer's processor ($arch) is not one Node.js is made for: a 64-bit Windows is needed" }

$name = "uts-engine-$Short"
$app = Join-Path $env:ProgramFiles $name
$nodeHome = Join-Path $env:ProgramFiles "$name-node"
$nodeDir = Join-Path $nodeHome "node-$NodeVersion-$plat"
$node = Join-Path $nodeDir 'node.exe'
$data = Join-Path $env:ProgramData $name
$tmp = Join-Path $env:TEMP "$name-install"
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Path $tmp | Out-Null

try {
  # 1. Node.js, unless this very version is here already
  $haveNode = (Test-Path $node) -and ((& $node -v) -eq $NodeVersion)
  if ($haveNode) { Write-Host "Node.js $NodeVersion is here already" }
  else {
    Write-Host "fetching Node.js $NodeVersion ($plat) from nodejs.org"
    $zip = Join-Path $tmp 'node.zip'
    Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-$plat.zip" -OutFile $zip
    $gotNode = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($gotNode -ne $NodeSha256[$plat]) { throw 'the Node.js download did not match its fingerprint; nothing was installed' }
    New-Item -ItemType Directory -Path (Join-Path $tmp 'node') | Out-Null
    tar -xf $zip -C (Join-Path $tmp 'node')
    if (-not (Test-Path (Join-Path $tmp "node\node-$NodeVersion-$plat\node.exe"))) { throw 'the Node.js download has no node.exe in it; nothing was installed' }
  }

  # 2. the platform's program, checked against the fingerprint this system gives it
  $rel = Invoke-RestMethod -UseBasicParsing "$($Base)engine-link/release"
  Invoke-WebRequest -UseBasicParsing "$($Base)engine-link/package" -OutFile (Join-Path $tmp 'engine.tgz')
  $got = (Get-FileHash (Join-Path $tmp 'engine.tgz') -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $rel.sha256) { throw 'the package did not match its fingerprint; nothing was installed' }
  New-Item -ItemType Directory -Path (Join-Path $tmp 'engine') | Out-Null
  tar -xzf (Join-Path $tmp 'engine.tgz') -C (Join-Path $tmp 'engine')
  if (-not (Test-Path (Join-Path $tmp 'engine\main.js'))) { throw 'the package has no program in it; nothing was installed' }
  $release = (Get-Content (Join-Path $tmp 'engine\VERSION.json') -Raw | ConvertFrom-Json).release

  # 3. what runs now stops: the task, and the program it started, which a stopped task leaves running
  Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue | Stop-ScheduledTask -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains("$app\main.js") } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1

  # 4. Node.js and the program into place
  if (-not $haveNode) {
    if (-not (Test-Path $nodeHome)) { New-Item -ItemType Directory -Path $nodeHome | Out-Null }
    if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
    Move-Item (Join-Path $tmp "node\node-$NodeVersion-$plat") $nodeDir
  }
  if (Test-Path "$app.old") { Remove-Item -Recurse -Force "$app.old" }
  if (Test-Path $app) { Move-Item $app "$app.old" }
  Move-Item (Join-Path $tmp 'engine') $app

  if (-not (Test-Path $data)) { New-Item -ItemType Directory -Path $data | Out-Null }
  # only SYSTEM and administrators may read the engine's data: its lock and its keys live here
  icacls $data /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
  $cfg = @{ link = @{ url = $Base; code = $Code } } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText((Join-Path $data 'config.json'), $cfg)
  Remove-Item (Join-Path $data 'link.json'), (Join-Path $data 'link-status.json') -ErrorAction SilentlyContinue

  # the task runs a small starter that tells the engine where its data is
  $run = Join-Path $app 'run.cmd'
  [IO.File]::WriteAllText($run, "@echo off`r`nset ENGINE_DATA=$data`r`n`"$node`" `"$app\main.js`" >> `"$data\engine.log`" 2>&1`r`n")
  $action = New-ScheduledTaskAction -Execute $run
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $name
  # a Node.js this platform no longer runs on
  Get-ChildItem $nodeHome -Directory | Where-Object { $_.FullName -ne $nodeDir } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

  Write-Host "release $release installed as the task $name, on Node.js $NodeVersion; waiting for it to call in"
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $f = Join-Path $data 'link-status.json'
    if (Test-Path $f) {
      $s = Get-Content $f -Raw | ConvertFrom-Json
      if ($s.linked) {
        Write-Host 'done: the platform called in and is linked to this system.'
        Write-Host "the fingerprint of its lock is $($s.lock) -- the Account tab shows the same beside the keys for this platform."
        # return, never exit: pasted at the prompt, exit would close the window before this could be read
        return
      }
    }
  }
  Write-Host 'installed, but it has not called in yet. What it last said:'
  if (Test-Path (Join-Path $data 'link-status.json')) { Get-Content (Join-Path $data 'link-status.json') } else { Write-Host "  nothing yet -- see $data\engine.log" }
} finally {
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
}
