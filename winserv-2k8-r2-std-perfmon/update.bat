@echo off
rem Update an existing perfmon deployment in place.
rem
rem 1. Put the new files from the branch into a "new" subfolder next to this
rem    script:
rem       <thisdir>\new\perfmon.exe        (from dist/)
rem       <thisdir>\new\livecheck.exe      (from dist/)
rem       <thisdir>\new\install-task.bat
rem 2. Run this ELEVATED, passing the perfmon options to bake into the task:
rem       update.bat -probe C:\Wipsystem
rem
rem Windows will not overwrite a running .exe, so this stops the task and
rem kills any running instance first, and fails loudly rather than
rem half-updating if something is still holding a file.

setlocal
set DIR=%~dp0
set NEW=%DIR%new

if not exist "%NEW%\perfmon.exe" (
    echo ERROR: "%NEW%\perfmon.exe" not found.
    echo Download dist\perfmon.exe, dist\livecheck.exe and install-task.bat from
    echo the winserv-2k8-r2-std-perfmon branch into "%NEW%" first.
    exit /b 1
)

echo Stopping the perfmon task and any running instances...
schtasks /End /TN "perfmon" >nul 2>&1
taskkill /IM perfmon.exe /F >nul 2>&1
taskkill /IM livecheck.exe /F >nul 2>&1
rem Give the handles time to close (ping, not timeout: works with redirected stdin)
ping -n 4 127.0.0.1 >nul 2>&1

echo Copying new files...
copy /Y "%NEW%\perfmon.exe" "%DIR%perfmon.exe" >nul
if not "%errorlevel%"=="0" goto :locked
if exist "%NEW%\livecheck.exe"     copy /Y "%NEW%\livecheck.exe"     "%DIR%livecheck.exe"     >nul
if exist "%NEW%\install-task.bat"  copy /Y "%NEW%\install-task.bat"  "%DIR%install-task.bat"  >nul

echo Reinstalling the scheduled task...
call "%DIR%install-task.bat" %*
if not "%errorlevel%"=="0" exit /b 1

echo.
echo ============================ VERIFICATION ============================
echo -- execution time limit (want PT0S, NOT PT72H):
schtasks /Query /TN "perfmon" /XML | findstr /i ExecutionTimeLimit
echo.
echo -- process (want perfmon.exe listed):
tasklist /FI "IMAGENAME eq perfmon.exe"
echo.
echo -- newest log lines (want a fresh START showing cpu^>=60%% and your probe):
powershell -NoProfile -Command "Get-Content '%DIR%perfmon.log' | Select-Object -Last 4"
exit /b 0

:locked
echo.
echo ERROR: could not overwrite perfmon.exe - something is still running it.
echo Close any console window running perfmon.exe or livecheck.exe, then
echo re-run this script. Nothing was changed.
exit /b 1
