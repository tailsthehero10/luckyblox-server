<?php
require_once dirname(__DIR__, 2) . '/api/common.php';

header('Content-Type: application/json');

$settingsRoot = api_settings_root();
$assetsRoot = $settingsRoot . '/assets';
$uploadsRoot = $assetsRoot . '/uploads';
$indexPath = $assetsRoot . '/index.json';

if (!is_dir($assetsRoot)) {
    @mkdir($assetsRoot, 0777, true);
}
if (!is_dir($uploadsRoot)) {
    @mkdir($uploadsRoot, 0777, true);
}

$index = api_read_json_file($indexPath);
if (!is_array($index)) {
    $index = array();
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'POST' || $method === 'PUT') {
    $assetId = isset($_POST['assetId']) && trim((string) $_POST['assetId']) !== ''
        ? (string) $_POST['assetId']
        : 'asset-' . uniqid();

    $fileInput = $_FILES['file'] ?? $_FILES['asset'] ?? null;
    if ($fileInput && is_array($fileInput) && isset($fileInput['tmp_name']) && $fileInput['tmp_name'] !== '') {
        $safeName = preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($fileInput['name']));
        $storedName = $assetId . '_' . ($safeName !== '' ? $safeName : 'asset');
        $storedPath = $uploadsRoot . '/' . $storedName;
        move_uploaded_file($fileInput['tmp_name'], $storedPath);

        $index[$assetId] = array(
            'id' => $assetId,
            'name' => $fileInput['name'],
            'storedName' => $storedName,
            'storedPath' => $storedPath,
            'type' => $fileInput['type'],
            'size' => (int) $fileInput['size'],
            'uploadedAt' => date('c'),
            'url' => '/asset/' . $storedName,
        );

        api_write_json_file($indexPath, $index);

        api_json_response(array(
            'ok' => true,
            'asset' => $index[$assetId],
            'count' => count($index),
        ));
        exit;
    }

    api_json_response(array('ok' => false, 'error' => 'No file uploaded'), 400);
    exit;
}

api_json_response(array(
    'ok' => true,
    'assets' => array_values($index),
    'count' => count($index),
));
