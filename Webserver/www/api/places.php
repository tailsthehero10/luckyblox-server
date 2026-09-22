<?php
require_once __DIR__ . '/common.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$placeId = api_place_id_from_request();

if ($method === 'GET') {
    $meta = api_get_place_metadata($placeId);
    api_json_response($meta);
    exit;
}

if ($method === 'POST' || $method === 'PUT') {
    $payload = api_parse_request_payload();
    $settingsRoot = api_settings_root();
    $dir = $settingsRoot . '/places';
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }

    $meta = api_get_place_metadata($placeId);
    $meta['name'] = isset($payload['name']) ? (string) $payload['name'] : $meta['name'];
    $meta['description'] = isset($payload['description']) ? (string) $payload['description'] : $meta['description'];
    $meta['privacyType'] = isset($payload['privacyType']) ? (string) $payload['privacyType'] : $meta['privacyType'];
    $meta['gameId'] = isset($payload['gameId']) ? (string) $payload['gameId'] : $meta['gameId'];
    $meta['universeId'] = isset($payload['universeId']) ? (int) $payload['universeId'] : $meta['universeId'];
    $meta['creatorId'] = isset($payload['creatorId']) ? (int) $payload['creatorId'] : $meta['creatorId'];
    $meta['creatorType'] = isset($payload['creatorType']) ? (string) $payload['creatorType'] : $meta['creatorType'];
    $meta['placeVersion'] = isset($payload['placeVersion']) ? (int) $payload['placeVersion'] : $meta['placeVersion'];
    $meta['version'] = isset($payload['version']) ? (int) $payload['version'] : $meta['version'];
    $meta['updatedAt'] = date('c');
    $meta['createdAt'] = isset($meta['createdAt']) ? $meta['createdAt'] : date('c');

    if (isset($payload['file']) && is_string($payload['file'])) {
        $meta['mapFile'] = $payload['file'];
        $meta['mapExists'] = file_exists($payload['file']);
    }

    api_write_json_file($dir . '/' . $placeId . '.json', $meta);
    api_json_response(array('ok' => true, 'place' => $meta));
    exit;
}

api_json_response(array('error' => 'Unsupported method'), 405);
