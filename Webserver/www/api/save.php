<?php
require_once __DIR__ . '/common.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'POST';
$placeId = api_place_id_from_request();
$payload = api_parse_request_payload();

if ($method !== 'GET' && $method !== 'POST' && $method !== 'PUT') {
    api_json_response(array('error' => 'Unsupported method'), 405);
    exit;
}

if ($method === 'GET' && empty($payload)) {
    $payload = array(
        'source' => 'browser',
        'message' => 'Saved from local launcher UI',
        'savedAt' => date('c'),
    );
}

$settingsRoot = api_settings_root();
$saveDir = $settingsRoot . '/saves';
if (!is_dir($saveDir)) {
    @mkdir($saveDir, 0777, true);
}

$saveData = array(
    'placeId' => (int) $placeId,
    'updatedAt' => date('c'),
    'account' => api_get_current_account(),
    'payload' => $payload,
);

$filePath = $saveDir . '/' . $placeId . '.json.gz';
$legacyFile = $saveDir . '/' . $placeId . '.json';
if (file_exists($legacyFile) && !file_exists($filePath)) {
    @unlink($legacyFile);
}

api_write_json_file($filePath, $saveData, true);
api_track_place_stat($placeId, 'save');

api_json_response(array(
    'ok' => true,
    'placeId' => (int) $placeId,
    'file' => $filePath,
    'compressed' => true,
    'savedData' => $saveData,
));
