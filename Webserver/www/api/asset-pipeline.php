<?php
require_once __DIR__ . '/common.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$settingsRoot = api_settings_root();
$assetsRoot = $settingsRoot . '/assets';
$assetsIndexPath = $assetsRoot . '/index.json';

if (!is_dir($assetsRoot)) {
    @mkdir($assetsRoot, 0777, true);
}

if ($method === 'GET') {
    $assets = api_read_json_file($assetsIndexPath);
    if (!is_array($assets)) {
        $assets = array();
    }

    if (isset($_GET['assetId']) && trim((string) $_GET['assetId']) !== '') {
        $assetId = trim((string) $_GET['assetId']);
        $record = $assets[$assetId] ?? null;
        if ($record === null) {
            api_json_response(array('ok' => false, 'error' => 'Asset not found'), 404);
            exit;
        }

        api_json_response(array('ok' => true, 'asset' => $record));
        exit;
    }

    api_json_response(array(
        'ok' => true,
        'assets' => array_values($assets),
        'count' => count($assets),
    ));
    exit;
}

if ($method === 'POST' || $method === 'PUT') {
    $payload = api_parse_request_payload();
    $assetId = isset($payload['assetId']) ? (string) $payload['assetId'] : 'asset-' . uniqid();
    $assets = api_read_json_file($assetsIndexPath);
    if (!is_array($assets)) {
        $assets = array();
    }

    $record = array(
        'id' => $assetId,
        'name' => isset($payload['name']) ? (string) $payload['name'] : $assetId,
        'type' => isset($payload['type']) ? (string) $payload['type'] : 'application/octet-stream',
        'size' => isset($payload['size']) ? (int) $payload['size'] : 0,
        'uploadedAt' => date('c'),
        'url' => isset($payload['url']) ? (string) $payload['url'] : '/asset/' . $assetId,
        'storedFile' => isset($payload['storedFile']) ? (string) $payload['storedFile'] : '',
    );

    if (isset($payload['content']) && is_string($payload['content'])) {
        $storedFile = $assetsRoot . '/uploads/' . $assetId . '.bin';
        file_put_contents($storedFile, $payload['content']);
        $record['storedFile'] = $storedFile;
    }

    $assets[$assetId] = $record;
    api_write_json_file($assetsIndexPath, $assets);

    api_json_response(array(
        'ok' => true,
        'asset' => $record,
        'count' => count($assets),
    ));
    exit;
}

api_json_response(array('error' => 'Unsupported method'), 405);
