<?php
require_once __DIR__ . '/../api/common.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
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

function add_asset_record($index, $uploadsRoot, $assetId, $originalName, $tmpName, $error, $size, $mime) {
    if ($error !== UPLOAD_ERR_OK || !is_uploaded_file($tmpName)) {
        return array('ok' => false, 'error' => 'Upload failed');
    }

    $safeName = preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($originalName));
    if ($safeName === '') {
        $safeName = 'asset';
    }

    $storedName = $assetId . '_' . $safeName;
    $storedPath = $uploadsRoot . '/' . $storedName;

    if (!move_uploaded_file($tmpName, $storedPath)) {
        return array('ok' => false, 'error' => 'Could not store uploaded file');
    }

    $record = array(
        'id' => $assetId,
        'name' => $originalName,
        'storedName' => $storedName,
        'storedPath' => $storedPath,
        'type' => $mime,
        'size' => (int) $size,
        'uploadedAt' => date('c'),
        'url' => '/asset/' . basename($storedName),
    );

    $index[$assetId] = $record;
    return array('ok' => true, 'asset' => $record, 'index' => $index);
}

if ($method === 'GET') {
    api_json_response(array(
        'ok' => true,
        'assets' => array_values($index),
        'count' => count($index),
    ));
    exit;
}

if ($method === 'POST' || $method === 'PUT') {
    $assetId = isset($_POST['assetId']) && trim((string) $_POST['assetId']) !== ''
        ? (string) $_POST['assetId']
        : 'asset-' . uniqid();

    $payload = api_parse_request_payload();
    $fileInput = isset($_FILES['file']) ? $_FILES['file'] : (isset($_FILES['asset']) ? $_FILES['asset'] : null);

    if ($fileInput && is_array($fileInput) && isset($fileInput['tmp_name']) && $fileInput['tmp_name'] !== '') {
        $result = add_asset_record($index, $uploadsRoot, $assetId, $fileInput['name'], $fileInput['tmp_name'], $fileInput['error'], $fileInput['size'], $fileInput['type']);
        if (!$result['ok']) {
            api_json_response($result, 400);
            exit;
        }

        $index = $result['index'];
        api_write_json_file($indexPath, $index);

        api_json_response(array(
            'ok' => true,
            'asset' => $result['asset'],
            'count' => count($index),
        ));
        exit;
    }

    if (isset($payload['source']) && is_string($payload['source']) && $payload['source'] !== '') {
        $record = array(
            'id' => $assetId,
            'name' => isset($payload['name']) ? (string) $payload['name'] : $assetId,
            'storedName' => $assetId . '.bin',
            'storedPath' => $uploadsRoot . '/' . $assetId . '.bin',
            'type' => isset($payload['type']) ? (string) $payload['type'] : 'application/octet-stream',
            'size' => isset($payload['size']) ? (int) $payload['size'] : 0,
            'uploadedAt' => date('c'),
            'url' => '/asset/' . $assetId,
        );

        file_put_contents($record['storedPath'], isset($payload['content']) ? (string) $payload['content'] : '');
        $index[$assetId] = $record;
        api_write_json_file($indexPath, $index);

        api_json_response(array(
            'ok' => true,
            'asset' => $record,
            'count' => count($index),
        ));
        exit;
    }

    api_json_response(array('ok' => false, 'error' => 'No file data received'), 400);
    exit;
}

api_json_response(array('error' => 'Unsupported method'), 405);
