@echo off
REM LuckyBlox DEV launcher - play against the LIVE site from this PC.
REM
REM Keep this file pure ASCII. cmd reads .bat files in the OEM/OEM-ish codepage,
REM so a UTF-8 em-dash on a REM line is mis-decoded and cmd tries to run the
REM mangled text ("'M' is not recognized as an internal or external command").
REM Use a plain hyphen or an ASCII arrow instead.
REM
REM It asks https://luckyblox-server.onrender.com for a real launch ticket,
REM runs the game server locally, and opens the client selected in SelectedClient.txt.
REM
REM Usage:
REM   Settings\DEV-PLAY.bat                  (place selected in Settings\MapPath.txt)
REM   Settings\DEV-PLAY.bat --place ID       (pick a local catalog place)
REM   Settings\DEV-PLAY.bat --testblox --Testblox10
REM   Settings\DEV-PLAY.bat --dry-run        (resolve only, launch nothing)
REM
REM Run this batch once before using the website's "Open this game in DEV-PLAY"
REM action. The launcher registers the luckyblox-devplay URL handler for this
REM release folder; the website then passes its selected place and launch ticket.
REM
REM NOTE ON NODE
REM ------------
REM This used to call "where node" and abort with "Node.js was not found on PATH"
REM when Node was not on the system PATH - which is the normal state on this
REM machine, so the launcher never started anything. Node IS installed at
REM E:\nodejs\node.exe; it just is not on PATH. We now look for a usable node
REM first, so a plain double-click works without touching the system PATH.
REM
REM Do NOT put backtick characters in this file: cmd treats them as command
REM substitution even inside a REM line, and tries to run the quoted command.

setlocal EnableDelayedExpansion
cd /d "%~dp0.."

set "LUCKYBLOX_NODE="

REM 1. An explicit override wins.
if defined LUCKYBLOX_NODE_BIN (
  if exist "%LUCKYBLOX_NODE_BIN%" set "LUCKYBLOX_NODE=%LUCKYBLOX_NODE_BIN%"
)

REM 2. The known local install on this machine, then a couple of variants.
if not defined LUCKYBLOX_NODE (
  for %%P in (
    "E:\nodejs\node.exe"
    "E:\node\node.exe"
    "E:\Program Files\nodejs\node.exe"
    "%ProgramFiles%\nodejs\node.exe"
    "%ProgramFiles(x86)%\nodejs\node.exe"
    "%LOCALAPPDATA%\Programs\nodejs\node.exe"
  ) do (
    if not defined LUCKYBLOX_NODE if exist %%P set "LUCKYBLOX_NODE=%%~P"
  )
)

REM 3. Last resort: whatever "where" finds on PATH.
if not defined LUCKYBLOX_NODE (
  for /f "delims=" %%N in ('where node 2^>NUL') do (
    if not defined LUCKYBLOX_NODE set "LUCKYBLOX_NODE=%%N"
  )
)

if not defined LUCKYBLOX_NODE (
  echo.
  echo   Node.js could not be found.
  echo.
  echo   Looked for a bundled/installed node at:
  echo     E:\nodejs\node.exe
  echo     %%ProgramFiles%%\nodejs\node.exe
  echo   and then on PATH.
  echo.
  echo   Install Node 18+ from https://nodejs.org, or set:
  echo     set LUCKYBLOX_NODE_BIN=E:\path\to\node.exe
  echo.
  pause
  exit /b 1
)

echo [dev-play] using node: %LUCKYBLOX_NODE%
"%LUCKYBLOX_NODE%" tools\dev-launch.js %*

if errorlevel 1 (
  echo.
  echo [dev-play] the launcher reported a failure ^(see the messages above^).
  pause
)
endlocal
