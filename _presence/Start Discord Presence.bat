@echo off
REM LuckyBlox Discord Presence - easy launcher.
REM Double-click this file to start the presence. Close its window to stop.

setlocal
cd /d "%~dp0"

if not exist "LuckyBloxPresence.exe" (
  echo.
  echo   LuckyBloxPresence.exe was not found next to this script.
  echo   Make sure it sits in the same folder as LuckyBlox Launcher.exe.
  echo.
  pause
  exit /b 1
)

if not exist "DiscordRPC.dll" (
  echo.
  echo   DiscordRPC.dll is missing from this folder.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting LuckyBlox Discord Presence...
echo   Close this window when you want it to stop.
echo.

"LuckyBloxPresence.exe"
