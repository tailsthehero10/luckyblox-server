$ErrorActionPreference = 'Stop'

$phpRoot = Join-Path $PSScriptRoot '..\Webserver\www'
$ejsRoot = Join-Path $PSScriptRoot '..\Webserver\http-db-bridge\views'
$failures = @()

Get-ChildItem -Path $phpRoot -Filter '*.php' -Recurse -File | ForEach-Object {
  $content = Get-Content -Raw $_.FullName
  if ($null -ne $content -and $content.Contains('</body>') -and (-not $content.Contains('href="/style.css"') -or -not $content.Contains('src="/legacy-nav.js"'))) {
    $failures += $_.FullName
  }
}

Get-ChildItem -Path $ejsRoot -Filter '*.ejs' -File | ForEach-Object {
  $content = Get-Content -Raw $_.FullName
  if ($null -ne $content -and $content.Contains('</body>') -and (-not $content.Contains('roblox.css') -or -not $content.Contains('src="/legacy-nav.js"'))) {
    $failures += $_.FullName
  }
}

if ($failures.Count -gt 0) {
  Write-Host 'Navigation consistency failures:'
  $failures | ForEach-Object { Write-Host $_ }
  exit 1
}

Write-Host 'Navigation consistency passed for all HTML-rendering PHP and EJS templates.'
