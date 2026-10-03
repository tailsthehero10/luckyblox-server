# Shared path helper for the LuckyBlox tools.
#
# WHY THIS EXISTS
# ---------------
# The tooling used to write its scratch files (asset-records.json,
# catalog-items.csv, ...) into $env:TEMP, which on Windows is
# C:\Users\<user>\AppData\Local\Temp. This project lives on E: and the machine's
# C: drive is nearly full, so every fetch run quietly consumed C: space.
#
# Everything scratch now lives under <release>\.tmp on the same drive as the
# release. Set LUCKYBLOX_TMP to override (e.g. a different drive).
#
# Two tools were also writing the SAME file at the same time, which produced:
#   "The requested operation cannot be performed on a file with a user-mapped
#    section open."
# Use Enter-LuckyBloxLock around a write so a second instance waits instead of
# colliding with the first.

Set-StrictMode -Version Latest

function Get-LuckyBloxReleaseRoot {
    param([string]$ScriptRoot = $PSScriptRoot)
    return (Split-Path -Parent $ScriptRoot)
}

function Get-LuckyBloxScratchDir {
    <#
      The scratch directory for tooling, on the release drive.
      Created on demand. Precedence: LUCKYBLOX_TMP, else <release>\.tmp
    #>
    param([string]$ReleaseRoot = (Get-LuckyBloxReleaseRoot))

    $explicit = $env:LUCKYBLOX_TMP
    $dir = if ($explicit -and $explicit.Trim()) { $explicit.Trim() } else { Join-Path $ReleaseRoot '.tmp' }

    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    return $dir
}

function Get-LuckyBloxScratchPath {
    <# A named scratch file inside the scratch dir. #>
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$ReleaseRoot = (Get-LuckyBloxReleaseRoot)
    )
    return (Join-Path (Get-LuckyBloxScratchDir -ReleaseRoot $ReleaseRoot) $Name)
}

function Write-LuckyBloxJsonNoBom {
    <#
      Write JSON with NO BOM, to a temp file, then rename over the target.

      Two defects this closes:
        * A BOM (PowerShell's Set-Content writes one) makes every later
          JSON.parse fail with "Unexpected token \uFEFF".
        * Writing the target directly while another process has it open throws
          "user-mapped section open". Writing a sibling temp and renaming is
          atomic, so a reader sees either the old file or the new one.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Json
    )
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

    $tmp = Join-Path $dir ('.' + [System.IO.Path]::GetFileName($Path) + '.tmp-' + $PID)
    [System.IO.File]::WriteAllText($tmp, $Json, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $Path -Force
}
