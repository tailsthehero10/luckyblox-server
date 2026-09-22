<?php
require_once dirname(__DIR__, 2) . '/api/common.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$placeId = api_place_id_from_request();
$settingsRoot = api_settings_root();
$publishedDir = $settingsRoot . '/published';
$placesDir = $settingsRoot . '/places';

if (!is_dir($publishedDir)) {
    @mkdir($publishedDir, 0777, true);
}
if (!is_dir($placesDir)) {
    @mkdir($placesDir, 0777, true);
}

if ($method === 'GET') {
    $metadata = api_get_place_metadata($placeId);
    api_json_response(array(
        'ok' => true,
        'placeId' => (int) $placeId,
        'published' => $metadata['published'],
        'metadata' => $metadata,
        'publishedFile' => $publishedDir . '/' . $placeId . '.json',
        'placeFile' => $placesDir . '/' . $placeId . '.json',
    ));
    exit;
}

if ($method === 'POST' || $method === 'PUT') {
    $payload = api_parse_request_payload();
    $metadata = api_get_place_metadata($placeId);

    if (isset($payload['name']) && trim((string) $payload['name']) !== '') {
        $metadata['name'] = trim((string) $payload['name']);
    }
    if (isset($payload['description'])) {
        $metadata['description'] = (string) $payload['description'];
    }
    if (isset($payload['privacyType'])) {
        $metadata['privacyType'] = (string) $payload['privacyType'];
    }
    if (isset($payload['gameId'])) {
        $metadata['gameId'] = (string) $payload['gameId'];
    }
    if (isset($payload['universeId'])) {
        $metadata['universeId'] = (int) $payload['universeId'];
    }
    if (isset($payload['creatorId'])) {
        $metadata['creatorId'] = (int) $payload['creatorId'];
    }
    if (isset($payload['creatorType'])) {
        $metadata['creatorType'] = (string) $payload['creatorType'];
    }
    if (isset($payload['placeVersion'])) {
        $metadata['placeVersion'] = (int) $payload['placeVersion'];
    }
    if (isset($payload['file']) && trim((string) $payload['file']) !== '') {
        $metadata['mapFile'] = (string) $payload['file'];
        $metadata['mapExists'] = file_exists((string) $payload['file']);
    }

    $metadata['updatedAt'] = date('c');
    $metadata['createdAt'] = isset($metadata['createdAt']) && trim((string) $metadata['createdAt']) !== ''
        ? (string) $metadata['createdAt']
        : date('c');

    api_write_json_file($placesDir . '/' . $placeId . '.json', $metadata);

    $published = $metadata;
    $published['published'] = true;
    $published['publishedAt'] = date('c');
    $published['version'] = isset($published['placeVersion']) ? (int) $published['placeVersion'] : 1;
    $published['placeVersion'] = isset($published['placeVersion']) ? (int) $published['placeVersion'] : 1;

    api_write_json_file($publishedDir . '/' . $placeId . '.json', $published);
    api_track_place_stat($placeId, 'publish');

    api_json_response(array(
        'ok' => true,
        'placeId' => (int) $placeId,
        'published' => true,
        'metadata' => $published,
    ));
    exit;
}

api_json_response(array('error' => 'Unsupported method'), 405);
