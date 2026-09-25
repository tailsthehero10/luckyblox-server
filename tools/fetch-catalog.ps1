# Fetch real Roblox catalog assets into LuckyBlox.
#
# Roblox asset ids now exceed Int32 (e.g. 11709308219), so EVERY numeric id is
# [int64] and ids are kept as strings in JSON keys. Casting to [int] throws and
# silently drops items.
#
# For each wearable item it: verifies metadata, downloads the real 420x420
# thumbnail into Webserver/www/asset-cache/<id>.png, and records the verified
# metadata with the ORIGINAL Roblox price preserved.
#
# Run: powershell -File tools\fetch-catalog.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$releaseRoot = Split-Path -Parent $PSScriptRoot
$cacheDir    = Join-Path $releaseRoot 'Webserver\www\asset-cache'
$outJson     = Join-Path $env:TEMP 'asset-records.json'
$itemsCsv    = Join-Path $env:TEMP 'catalog-items.csv'

$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LuckyBlox/1.0'

# Roblox AssetTypeId -> the name the site shows.
$TypeNames = @{
  8='Hat'; 11='Shirt'; 12='Pants'; 17='Head'; 18='Face'
  41='HairAccessory'; 42='FaceAccessory'; 43='NeckAccessory'
  44='ShoulderAccessory'; 45='FrontAccessory'; 46='BackAccessory'
  47='WaistAccessory'; 64='TShirtAccessory'; 65='ShirtAccessory'
  66='PantsAccessory'; 67='JacketAccessory'; 68='SweaterAccessory'
  69='ShortsAccessory'; 70='LeftShoeAccessory'; 71='RightShoeAccessory'
}

New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

if (-not (Test-Path $itemsCsv)) { Write-Error "missing $itemsCsv - run the catalog enumeration first"; exit 1 }

$items = Import-Csv $itemsCsv
$wearable = $items | Where-Object { [int]$_.typeId -in @(8,11,12,41,42,43,44,45,46,64,65,66,67,68,69,70,71) }

Write-Output ("[fetch-catalog] wearable candidates: " + $wearable.Count)

# RESUME: re-use any records already fetched, and keep any image already on disk.
# A run that is interrupted (a shell timeout kills the job) continues instead of
# starting over, so the whole catalog can be pulled across several runs.
$records = @{}
if (Test-Path $outJson) {
  try {
    $prior = Get-Content $outJson -Raw | ConvertFrom-Json
    foreach ($p in $prior.PSObject.Properties) { $records[$p.Name] = $p.Value }
    Write-Output ("[fetch-catalog] resuming with $($records.Count) existing record(s)")
  } catch { Write-Output '[fetch-catalog] prior records unreadable, starting fresh' }
}

$saved = 0; $noImage = 0; $metaFail = 0; $skipped = 0
$n = 0

foreach ($it in $wearable) {
  $n++
  $id = [string]$it.id

  # Already have this record AND its image on disk? Nothing to do.
  if ($records.ContainsKey($id)) {
    $destCheck = Join-Path $cacheDir "$id.png"
    if (-not $records[$id].thumbnail -or (Test-Path $destCheck)) { $skipped++; continue }
  }

  $meta = $null
  try {
    $meta = (Invoke-WebRequest -Uri "https://economy.roblox.com/v2/assets/$id/details" `
        -UseBasicParsing -TimeoutSec 20 -Headers @{ 'User-Agent' = $UA }).Content | ConvertFrom-Json
  } catch { $metaFail++; continue }

  $fromThumb = $null
  $wroteFile = $false
  try {
    $t = (Invoke-WebRequest -Uri "https://thumbnails.roblox.com/v1/assets?assetIds=$id&size=420x420&format=Png" `
        -UseBasicParsing -TimeoutSec 20 -Headers @{ 'User-Agent' = $UA }).Content | ConvertFrom-Json
    if ($t.data.Count -gt 0 -and $t.data[0].state -eq 'Completed' -and $t.data[0].imageUrl) {
      $fromThumb = [string]$t.data[0].imageUrl
      $dest = Join-Path $cacheDir "$id.png"
      try {
        Invoke-WebRequest -Uri $fromThumb -OutFile $dest -UseBasicParsing -TimeoutSec 45 -Headers @{ 'User-Agent' = $UA }
        $wroteFile = (Test-Path $dest)
      } catch { }
    }
  } catch { }

  if ($wroteFile) { $saved++ } else { $noImage++ }

  $typeId = [int]$meta.AssetTypeId
  $records[$id] = [ordered]@{
    id              = $id
    assetId         = [int64]$id
    name            = [string]$meta.Name
    description     = [string]$meta.Description
    assetTypeId     = $typeId
    assetType       = $(if ($TypeNames.ContainsKey($typeId)) { $TypeNames[$typeId] } else { "Type$typeId" })
    # The REAL Roblox price, preserved. The site charges 0 (see server.js), so the
    # original is kept here as the item's reference price.
    price           = [int]$meta.PriceInRobux
    isForSale       = [bool]$meta.IsForSale
    creatorName     = [string]$meta.Creator.Name
    creatorId       = [int64]$meta.Creator.Id
    thumbnail       = $(if ($wroteFile) { "/asset-cache/$id.png" } else { $null })
    thumbnailSource = $fromThumb
    source          = 'roblox:fetched'
    fetchedAt       = (Get-Date).ToUniversalTime().ToString('o')
  }

  if ($n % 20 -eq 0) {
    # Checkpoint every 20 items so an interrupted run keeps its progress instead of
    # losing everything to a killed shell.
    $chk = $records | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($outJson, $chk, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output ("[fetch-catalog] $n/" + $wearable.Count + "  saved=$saved  skipped=$skipped")
  }
}

Write-Output ("[fetch-catalog] metadata ok=$($records.Count)  images saved=$saved  no image=$noImage  metadata failed=$metaFail  already had=$skipped")

# Write with NO BOM - a BOM breaks JSON.parse.
$json = $records | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($outJson, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("[fetch-catalog] wrote $outJson")