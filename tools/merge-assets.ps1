# Merge the fetched Roblox catalog into assets.json.
#
# PRICE MODEL (as specified):
#   - The shop price is 0 for every item: nothing costs Robux on LuckyBlox.
#   - The item's REAL Roblox price is preserved as `originalPrice`, so the true
#     value is still known and can be shown as a reference.
#
# Every id is [int64]/string - Roblox asset ids exceed Int32 and casting to [int]
# throws, silently dropping items.
#
# Run: powershell -File tools\merge-assets.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'luckyblox-paths.ps1')

$releaseRoot = Split-Path -Parent $PSScriptRoot
$assetsPath  = Join-Path $releaseRoot 'Webserver\http-db-bridge\data\assets.json'
# Read the SAME scratch file fetch-catalog.ps1 writes - on the release drive, not
# in %TEMP% (C:).
$recordsPath = Get-LuckyBloxScratchPath 'asset-records.json' -ReleaseRoot $releaseRoot

if (-not (Test-Path $recordsPath)) { Write-Error "no fetched records at $recordsPath"; exit 1 }

$fetched = Get-Content $recordsPath -Raw | ConvertFrom-Json
$out = [ordered]@{}

foreach ($p in $fetched.PSObject.Properties) {
  $v = $p.Value
  $out[$p.Name] = [ordered]@{
    id              = [string]$v.id
    assetId         = [int64]$v.assetId
    name            = [string]$v.name
    description     = [string]$v.description
    assetType       = [string]$v.assetType
    assetTypeId     = [int]$v.assetTypeId
    # Shop price is always 0; the real Roblox price lives on as originalPrice.
    price           = 0
    originalPrice   = [int]$v.price
    isForSale       = $true
    creatorName     = [string]$v.creatorName
    creatorId       = [int64]$v.creatorId
    thumbnail       = $v.thumbnail
    thumbnailSource = $v.thumbnailSource
    source          = 'roblox:fetched'
    fetchedAt       = [string]$v.fetchedAt
  }
}

Write-Output ("[merge] records: " + $out.Count)

# Backup, then write with NO BOM (a BOM breaks JSON.parse).
#
# The write is atomic (temp + rename): the running server reads assets.json on
# requests, and writing in place could collide with it - the same "user-mapped
# section open" failure the fetch script hit.
if (Test-Path $assetsPath) { Copy-Item $assetsPath "$assetsPath.bak" -Force }
$json = $out | ConvertTo-Json -Depth 6
Write-LuckyBloxJsonNoBom -Path $assetsPath -Json $json

# Verify it parses and report the spread.
$check = Get-Content $assetsPath -Raw | ConvertFrom-Json
$grouped = $check.PSObject.Properties | ForEach-Object { $_.Value.assetType } | Group-Object | Sort-Object Count -Descending
Write-Output "[merge] assets.json: $($check.PSObject.Properties.Count) item(s)"
$grouped | ForEach-Object { "  {0,-18} x{1}" -f $_.Name, $_.Count }
$withImg = ($check.PSObject.Properties | Where-Object { $_.Value.thumbnail }).Count
Write-Output "[merge] with a saved image: $withImg"

Remove-Item "$assetsPath.bak" -Force -ErrorAction SilentlyContinue