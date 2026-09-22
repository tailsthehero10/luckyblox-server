@echo off
setlocal

powershell -ExecutionPolicy Bypass -File "%~dp0RepairOpenVR.ps1"

set "STUDIO_EXE=E:\LuckyBloxLauncher\NEW LKL\Release\Clients\2022M\RobloxStudioBeta.exe"
set "PLACE_FILE=E:\LuckyBloxLauncher\NEW LKL\Release\Maps\2021 - Ragdoll Engine Uncopylocked.rbxl"

if not exist "%STUDIO_EXE%" (
  echo Roblox Studio binary not found at %STUDIO_EXE%
  exit /b 1
)

if not exist "%PLACE_FILE%" (
  echo Place file not found at %PLACE_FILE%
  exit /b 1
)

"%STUDIO_EXE%" -localPlaceFile "%PLACE_FILE%"
exit /b %ERRORLEVEL%
