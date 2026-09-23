@echo off
REM LuckyBlox DEV launcher — play against the LIVE site from this PC.
REM
REM It asks https://luckyblox-server.onrender.com for a real launch ticket,
REM runs the game server locally, and opens the 2021M client against it.
REM
REM Usage:
REM   Settings\DEV-PLAY.bat                  (place 1818)
REM   Settings\DEV-PLAY.bat --place 1818     (pick a place)
REM   Settings\DEV-PLAY.bat --dry-run        (resolve only, launch nothing)

setlocal
cd /d "%~dp0.."

where node >NUL 2>NUL
if errorlevel 1 (
  echo Node.js was not found on PATH. Install Node 18+ or add it to PATH.
  pause
  exit /b 1
)

node tools\dev-launch.js %*
if errorlevel 1 pause
