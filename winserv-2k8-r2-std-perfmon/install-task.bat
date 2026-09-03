@echo off
rem Install perfmon.exe as a scheduled task that starts at boot and runs as
rem SYSTEM (elevated, so every process is visible). Run this from an elevated
rem command prompt, with perfmon.exe in the same directory. Self-contained -
rem no other files needed. Safe to re-run over an existing install: it
rem recreates the task in place.
rem
rem Task Scheduler silently kills any task after 72 hours by default
rem (ExecutionTimeLimit=PT72H), and schtasks /Create cannot turn that off.
rem So: create the task, export its XML, patch the limit to PT0S (unlimited)
rem with inline PowerShell, VERIFY the patch is really in the XML, and only
rem then re-register from it. PowerShell can exit with negative codes, which
rem "if errorlevel 1" does not catch - hence the "%errorlevel%"=="0" checks.

schtasks /Create /F /TN "perfmon" /TR "\"%~dp0perfmon.exe\"" /SC ONSTART /RU SYSTEM /RL HIGHEST
if not "%errorlevel%"=="0" goto :fail

schtasks /Query /TN "perfmon" /XML > "%TEMP%\perfmon-task.xml"
if not "%errorlevel%"=="0" goto :fail

powershell -NoProfile -Command "$p = Join-Path $env:TEMP 'perfmon-task.xml'; $x = [IO.File]::ReadAllText($p); $x = $x.Substring($x.IndexOf('<?xml')); if ($x -match '<ExecutionTimeLimit>') { $x = $x -replace '<ExecutionTimeLimit>[^<]*</ExecutionTimeLimit>', '<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>' } else { $x = $x -replace '</Settings>', '<ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings>' }; [IO.File]::WriteAllText($p, $x, [Text.Encoding]::Unicode); if (([IO.File]::ReadAllText($p)) -match '<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>') { exit 0 }; exit 1"
if not "%errorlevel%"=="0" goto :failpatch

schtasks /Delete /F /TN "perfmon"
schtasks /Create /F /TN "perfmon" /XML "%TEMP%\perfmon-task.xml"
if not "%errorlevel%"=="0" goto :fail
del "%TEMP%\perfmon-task.xml"

taskkill /IM perfmon.exe /F 2>nul
schtasks /Run /TN "perfmon"
echo.
echo perfmon installed with NO 72h execution limit (verified in task XML).
echo Log: %~dp0perfmon.log
goto :eof

:failpatch
echo.
echo INSTALL FAILED: could not patch ExecutionTimeLimit to PT0S in the task
echo XML. The task was NOT re-registered - it still exists but keeps the
echo default 72h kill. Nothing else was changed.
exit /b 1

:fail
echo.
echo INSTALL FAILED - check the error above (are you running elevated?)
exit /b 1
