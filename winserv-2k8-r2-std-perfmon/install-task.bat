@echo off
rem Install perfmon.exe as a scheduled task that starts at boot and runs as
rem SYSTEM (elevated, so every process is visible). Run this from an elevated
rem command prompt, with perfmon.exe in the same directory.
schtasks /Create /F /TN "perfmon" /TR "\"%~dp0perfmon.exe\"" /SC ONSTART /RU SYSTEM /RL HIGHEST
schtasks /Run /TN "perfmon"
echo.
echo perfmon installed and started. Log: %~dp0perfmon.log
