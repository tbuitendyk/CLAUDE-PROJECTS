@echo off
rem Install perfmon.exe as a scheduled task that starts at boot and runs as
rem SYSTEM (elevated, so every process is visible). Run this from an elevated
rem command prompt, with perfmon.exe (and remove-task-time-limit.ps1) in the
rem same directory. Safe to re-run over an existing install: it recreates the
rem task in place.
rem
rem Task Scheduler silently kills any task after 72 hours by default
rem (ExecutionTimeLimit=PT72H), and schtasks /Create cannot turn that off.
rem So: create the task, export its XML, patch the limit to PT0S (unlimited),
rem and re-register from the patched XML.

schtasks /Create /F /TN "perfmon" /TR "\"%~dp0perfmon.exe\"" /SC ONSTART /RU SYSTEM /RL HIGHEST
if errorlevel 1 goto :fail

schtasks /Query /TN "perfmon" /XML > "%TEMP%\perfmon-task.xml"
if errorlevel 1 goto :fail

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0remove-task-time-limit.ps1" "%TEMP%\perfmon-task.xml"
if errorlevel 1 goto :fail

schtasks /Delete /F /TN "perfmon"
schtasks /Create /F /TN "perfmon" /XML "%TEMP%\perfmon-task.xml"
if errorlevel 1 goto :fail
del "%TEMP%\perfmon-task.xml"

taskkill /IM perfmon.exe /F 2>nul
schtasks /Run /TN "perfmon"
echo.
echo perfmon installed (no 72h execution limit) and started. Log: %~dp0perfmon.log
goto :eof

:fail
echo.
echo INSTALL FAILED - check the error above (are you running elevated?)
exit /b 1
