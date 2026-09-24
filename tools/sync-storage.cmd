@echo off
REM ---------------------------------------------------------------------------
REM Pull the latest LuckyBlox data from the storage repo into the local clone.
REM
REM The cloud app commits accounts/games/currency to the private repo
REM tailsthehero10/Luckyblox-Storage-1 as they change. This brings those commits
REM down into the sibling clone at ..\Luckyblox-Storage-1 so you can inspect
REM them locally (and see the app's add/remove/update history in git log).
REM
REM Local-only convenience: this is NOT needed by the server itself.
REM ---------------------------------------------------------------------------
setlocal
set "STORAGE_DIR=%~dp0..\Luckyblox-Storage-1"

if not exist "%STORAGE_DIR%\.git" (
  echo [luckyblox] no storage clone at "%STORAGE_DIR%"
  echo [luckyblox] clone it first:
  echo     git clone https://github.com/tailsthehero10/Luckyblox-Storage-1.git "%STORAGE_DIR%"
  exit /b 1
)

pushd "%STORAGE_DIR%"
echo [luckyblox] pulling latest data...
git pull --ff-only
echo.
echo [luckyblox] recent data commits:
git --no-pager log --oneline -10
popd
endlocal