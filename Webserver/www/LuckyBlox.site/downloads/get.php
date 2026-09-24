<?php
require_once __DIR__ . '/../../api/luckyblox-data.php';

session_start();

$c = lb_get_current_user();
if (!$c) {
    http_response_code(403);
    header('Content-Type: text/plain');
    echo 'Authentication required. Please sign in at /LuckBlox.site/signin/';
    exit;
}

$releaseRoot = realpath(__DIR__ . '/../../../');
$which = $_GET['file'] ?? '';

switch ($which) {
    case 'player':
        $exePath = $releaseRoot . '/Clients/2021M/RobloxPlayerBeta.exe';
        $xmlPath = $releaseRoot . '/Clients/2021M/AppSettings.xml';
        $zipName = 'luckyblox-player.zip';
        $innerDir = 'LuckyBloxPlayer';
        break;
    case 'studio':
        $exePath = $releaseRoot . '/Clients/2022M/RobloxStudioBeta.exe';
        $xmlPath = $releaseRoot . '/Clients/2022M/AppSettings.xml';
        $zipName = 'luckyblox-studio.zip';
        $innerDir = 'LuckyBloxStudio';
        break;
    default:
        http_response_code(404);
        header('Content-Type: text/plain');
        echo 'Unknown download.';
        exit;
}

if (!file_exists($exePath) || !file_exists($xmlPath)) {
    http_response_code(404);
    header('Content-Type: text/plain');
    echo 'Requested client is unavailable on this server.';
    exit;
}

$cacheDir = $releaseRoot . '/Webserver/www/downloads/cache';
if (!is_dir($cacheDir)) {
    @mkdir($cacheDir, 0755, true);
}

$cacheKey = $innerDir . '-' . md5($exePath . $xmlPath . filemtime($exePath) . filemtime($xmlPath));
$cachedPath = $cacheDir . '/' . $cacheKey . '.zip';

if (!file_exists($cachedPath)) {
    $zip = new ZipArchive();
    $tmpPath = $cachedPath . '.tmp';
    if ($zip->open($tmpPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        http_response_code(500);
        header('Content-Type: text/plain');
        echo 'Failed to create ZIP archive.';
        exit;
    }
    $zip->addFile($exePath, $innerDir . '/RobloxPlayerBeta.exe');
    $zip->addFile($xmlPath, $innerDir . '/AppSettings.xml');
    $zip->close();
    rename($tmpPath, $cachedPath);
}

header('Content-Type: application/zip');
header('Content-Disposition: attachment; filename="' . $zipName . '"');
header('Content-Length: ' . filesize($cachedPath));
header('Cache-Control: private, max-age=600');
readfile($cachedPath);
exit;
