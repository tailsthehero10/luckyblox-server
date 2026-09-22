$ErrorActionPreference = 'Stop'

$localOpenVrDir = Join-Path $env:LOCALAPPDATA 'openvr'
$openVrPathsFile = Join-Path $localOpenVrDir 'openvrpaths.vrpath'
$openVrConfigDir = Join-Path $localOpenVrDir 'config'

New-Item -ItemType Directory -Path $localOpenVrDir -Force | Out-Null
New-Item -ItemType Directory -Path $openVrConfigDir -Force | Out-Null

$runtimePath = 'C:\Program Files\OpenVR\bin\win64'
if (-not (Test-Path $runtimePath)) {
    $runtimePath = $localOpenVrDir
}

@{
    config = @($openVrConfigDir)
    external_config = @()
    runtime = @($runtimePath)
} | ConvertTo-Json -Depth 4 | Set-Content -Path $openVrPathsFile -Encoding UTF8

$regPath = 'HKCU:\Software\OpenVR'
New-Item -Path $regPath -Force | Out-Null
New-ItemProperty -Path $regPath -Name 'RuntimeDirectory' -Value $runtimePath -PropertyType String -Force | Out-Null
New-ItemProperty -Path $regPath -Name 'ConfigDirectory' -Value $openVrConfigDir -PropertyType String -Force | Out-Null
New-ItemProperty -Path $regPath -Name 'Version' -Value '1.0.0' -PropertyType String -Force | Out-Null

Write-Host "OpenVR repaired at: $localOpenVrDir"
Write-Host "RuntimeDirectory=$runtimePath"
Write-Host "ConfigDirectory=$openVrConfigDir"
