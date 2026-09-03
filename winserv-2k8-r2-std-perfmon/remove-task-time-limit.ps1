# Rewrites an exported Task Scheduler XML so the task has NO execution time
# limit. Task Scheduler's default is PT72H (3 days) — schtasks /Create cannot
# override it, so without this edit the perfmon task is silently killed 72
# hours after every boot. PT0S disables the limit. PowerShell 2.0 compatible.
param([string]$Path)

$x = [IO.File]::ReadAllText($Path)
$i = $x.IndexOf('<?xml')
if ($i -lt 0) { Write-Error "no XML found in $Path"; exit 1 }
$x = $x.Substring($i)   # drop any junk schtasks printed before the XML

if ($x -match '<ExecutionTimeLimit>') {
    $x = $x -replace '<ExecutionTimeLimit>[^<]*</ExecutionTimeLimit>', '<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>'
} else {
    $x = $x -replace '</Settings>', '<ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings>'
}

[IO.File]::WriteAllText($Path, $x, [Text.Encoding]::Unicode)
