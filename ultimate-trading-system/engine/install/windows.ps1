# INSTALL THE TRADING ENGINE ON THIS WINDOWS COMPUTER.
# Shown on the Compute tab, step 2 of the engine's checklist, to paste into
# PowerShell opened as administrator:
#   & ([scriptblock]::Create((irm '<this system>/engine-link/install/windows.ps1'))) '<this system>' '<short name>' '<install code>'
#
# What it does, and nothing else:
#   * the engine's program in "Program Files\uts-engine-<short name>", its data
#     (record, lock, keys) in "ProgramData\uts-engine-<short name>", which only
#     SYSTEM and administrators can read;
#   * a scheduled task, uts-engine-<short name>, that starts it when Windows
#     starts and again if it stops, with real orders off.
# Node.js 18 or newer must already be installed (nodejs.org). The engine then
# calls this system with the install code and is given a password of its own.
# Nothing is opened on this computer for anyone to come in: the engine calls out.
# Run again with a new code, it replaces the program and keeps the record, the
# lock and the keys.
param([string]$Base, [string]$Short, [string]$Code)
$ErrorActionPreference = 'Stop'

if ($Base -notmatch '^(https://.+/|http://127\.0\.0\.1:\d+/)$') { throw "the first word must be this system's address, ending in /" }
if ($Short -notmatch '^[a-z0-9][a-z0-9-]{1,29}$') { throw 'the short name must be 2 to 30 of a-z, 0-9 and -' }
if ($Code -notmatch '^UTS(-[A-Z0-9]{4}){6}$') { throw 'that does not look like an install code: make a new install command on the Compute tab' }
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'open PowerShell as administrator and run it again' }

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw 'Node.js is not installed: install Node.js 18 or newer from nodejs.org, then run this again' }
$node = $nodeCmd.Source
$major = [int](& $node -p "process.versions.node.split('.')[0]")
if ($major -lt 18) { throw 'Node.js is too old: 18 or newer is needed' }

$name = "uts-engine-$Short"
$app = Join-Path $env:ProgramFiles $name
$data = Join-Path $env:ProgramData $name
$tmp = Join-Path $env:TEMP "$name-install"
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Path $tmp | Out-Null

try {
  $rel = Invoke-RestMethod -UseBasicParsing "$($Base)engine-link/release"
  Invoke-WebRequest -UseBasicParsing "$($Base)engine-link/package" -OutFile (Join-Path $tmp 'engine.tgz')
  $got = (Get-FileHash (Join-Path $tmp 'engine.tgz') -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $rel.sha256) { throw 'the package did not match its fingerprint; nothing was installed' }
  New-Item -ItemType Directory -Path (Join-Path $tmp 'engine') | Out-Null
  tar -xzf (Join-Path $tmp 'engine.tgz') -C (Join-Path $tmp 'engine')
  if (-not (Test-Path (Join-Path $tmp 'engine\main.js'))) { throw 'the package has no engine in it; nothing was installed' }
  $release = (Get-Content (Join-Path $tmp 'engine\VERSION.json') -Raw | ConvertFrom-Json).release

  Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue | Stop-ScheduledTask -ErrorAction SilentlyContinue
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

  Write-Host "release $release installed as the task $name; waiting for it to call in"
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $f = Join-Path $data 'link-status.json'
    if (Test-Path $f) {
      $s = Get-Content $f -Raw | ConvertFrom-Json
      if ($s.linked) {
        Write-Host 'done: the engine called in and is linked to this system.'
        Write-Host "the fingerprint of its lock is $($s.lock) -- the Account tab shows the same beside the keys for this engine."
        exit 0
      }
    }
  }
  Write-Host 'installed, but it has not called in yet. What it last said:'
  if (Test-Path (Join-Path $data 'link-status.json')) { Get-Content (Join-Path $data 'link-status.json') } else { Write-Host "  nothing yet -- see $data\engine.log" }
  exit 6
} finally {
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
}
