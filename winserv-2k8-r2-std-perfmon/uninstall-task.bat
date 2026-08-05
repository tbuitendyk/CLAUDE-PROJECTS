@echo off
rem Stop and remove the perfmon scheduled task. Run elevated.
schtasks /End /TN "perfmon" 2>nul
taskkill /IM perfmon.exe /F 2>nul
schtasks /Delete /F /TN "perfmon"
echo perfmon task removed. The log file is left in place.
