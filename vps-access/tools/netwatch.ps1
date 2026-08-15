# netwatch.ps1 -- Windows link flight recorder. Logs RTT (ms) or LOSS per target.
# FIX 2026-08-15: PowerShell 7's Test-Connection exposes .Latency; Windows
# PowerShell 5.1 exposes .ResponseTime. The original script read only
# ResponseTime, so on PS7 every value logged blank. This handles both.
param([string]$Log = "C:\homs\netwatch.csv",
      [string[]]$Targets = @("8.8.8.8","74.208.1.75","74.208.226.14"),
      [int]$IntervalSec = 5)
"time,target,ms" | Out-File -Encoding utf8 $Log
Write-Host "logging to $Log  (Ctrl-C to stop)"
while ($true) {
  foreach ($h in $Targets) {
    $ms = "LOSS"
    try {
      $r = Test-Connection -ComputerName $h -Count 1 -ErrorAction Stop
      if ($null -ne $r.Latency)           { $ms = $r.Latency }        # PS 7+
      elseif ($null -ne $r.ResponseTime)  { $ms = $r.ResponseTime }   # PS 5.1
      elseif ($null -ne $r.ResponseTimeMs){ $ms = $r.ResponseTimeMs }
      else { $ms = 0 }
    } catch { $ms = "LOSS" }
    "$(Get-Date -f 'HH:mm:ss'),$h,$ms" | Add-Content $Log
  }
  Start-Sleep -Seconds $IntervalSec
}
