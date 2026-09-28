# Starts the LuckyBlox bridge on a free port for visual inspection.
# Usage: powershell -File tools\serve.ps1 [-Port 39001]
param([int]$Port = 39001)

$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root 'Webserver\http-db-bridge')
$env:PORT = "$Port"
$env:LUCKYBLOX_PREVIEW_MODE = 'off'
Write-Host "LuckyBlox bridge starting on http://localhost:$Port"
& E:\nodejs\node.exe server.js