<?php
require_once __DIR__ . '/common.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$placeId = api_place_id_from_request();

if ($method !== 'GET') {
    api_json_response(array('error' => 'Unsupported method'), 405);
    exit;
}

$saveFile = api_find_saved_file($placeId, api_settings_root() . '/saves');
$meta = api_get_place_metadata($placeId);

if (file_exists($saveFile)) {
    $saved = api_read_json_file($saveFile);
    api_json_response(array(
        'ok' => true,
        'placeId' => (int) $placeId,
        'metadata' => $meta,
        'savedData' => $saved,
    ));
    exit;
}

api_json_response(array(
    'ok' => true,
    'placeId' => (int) $placeId,
    'metadata' => $meta,
    'savedData' => null,
));
