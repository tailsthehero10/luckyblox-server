@echo off
REM ---------------------------------------------------------------------------
REM Build LuckybloxInstaller.exe
REM
REM Uses the .NET Framework compiler that ships with Windows, so no SDK, no
REM NuGet, and no Visual Studio are required. The result is a single .exe with
REM no external dependencies.
REM
REM Optionally bake the server URL into the build so a release ships an installer
REM that already points at the right deployment:
REM
REM     set LUCKYBLOX_INSTALLER_BASE=https://luckyblox-server.onrender.com
REM     build-installer.bat
REM ---------------------------------------------------------------------------
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo   LuckyBlox Installer - build
echo   ---------------------------
echo.

REM --- Find csc.exe ----------------------------------------------------------
REM The Framework compiler lives under the Microsoft.NET\Framework[64] tree.
REM We probe newest-first so a machine with several runtimes picks the latest.
set "CSC="

for %%R in (Framework64 Framework) do (
  for %%V in (v4.0.30319 v3.5) do (
    if not defined CSC (
      if exist "%SystemRoot%\Microsoft.NET\%%R\%%V\csc.exe" (
        set "CSC=%SystemRoot%\Microsoft.NET\%%R\%%V\csc.exe"
      )
    )
  )
)

REM Fall back to a Roslyn compiler from a VS/Build Tools install if the
REM Framework one is missing (rare, but a machine with only .NET Core has it).
if not defined CSC (
  for /f "delims=" %%P in ('where csc.exe 2^>nul') do (
    if not defined CSC set "CSC=%%P"
  )
)

if not defined CSC (
  echo   Could not find csc.exe.
  echo.
  echo   The .NET Framework compiler ships with Windows. If it is missing,
  echo   install the ".NET Framework 4.x Developer Pack" and run this again.
  echo.
  pause
  exit /b 1
)

echo   Compiler : %CSC%
if defined LUCKYBLOX_INSTALLER_BASE (
  echo   Server   : %LUCKYBLOX_INSTALLER_BASE%   (baked into the build)
) else (
  echo   Server   : (not baked in - read at runtime from installer.config.txt)
)
echo.

REM --- Compile --------------------------------------------------------------
REM Microsoft.CSharp is deliberately NOT referenced: the source avoids the
REM `dynamic` keyword (see CreateShortcut) precisely so this command is enough.
"%CSC%" /nologo /target:winexe /platform:anycpu ^
  /out:LuckybloxInstaller.exe ^
  /r:System.Windows.Forms.dll ^
  /r:System.Drawing.dll ^
  /r:System.dll ^
  /optimize+ ^
  LuckybloxInstaller.cs

if errorlevel 1 (
  echo.
  echo   Build FAILED. See the compiler output above.
  echo.
  pause
  exit /b 1
)

echo.
echo   Built: %CD%\LuckybloxInstaller.exe
echo.

REM --- Write the runtime server config next to the exe ----------------------
REM Only when it was not baked in, so a pre-pointed release keeps its default.
if defined LUCKYBLOX_INSTALLER_BASE (
  > installer.config.txt echo %LUCKYBLOX_INSTALLER_BASE%
  echo   Wrote installer.config.txt
  echo.
)

echo   Run it normally for the installer window, or:
echo     LuckybloxInstaller.exe /S                  install silently
echo     LuckybloxInstaller.exe /Update /S          update only
echo     LuckybloxInstaller.exe /Uninstall /S       remove
echo     LuckybloxInstaller.exe /root "C:\Games"    choose the install root
echo     LuckybloxInstaller.exe /base "https://..." point at a server
echo.
pause
exit /b 0