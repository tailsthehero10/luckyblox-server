<?php
require_once __DIR__ . '/common.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'POST';
$placeId = api_place_id_from_request();
$payload = api_parse_request_payload();

if ($method !== 'POST' && $method !== 'PUT') {
    api_json_response(array('error' => 'Unsupported method'), 405);
    exit;
}

$settingsRoot = api_settings_root();
$publishDir = $settingsRoot . '/published';
if (!is_dir($publishDir)) {
    @mkdir($publishDir, 0777, true);
}

$meta = api_get_place_metadata($placeId);
$meta['name'] = isset($payload['name']) ? (string) $payload['name'] : $meta['name'];
$meta['description'] = isset($payload['description']) ? (string) $payload['description'] : $meta['description'];
$meta['privacyType'] = isset($payload['privacyType']) ? (string) $payload['privacyType'] : $meta['privacyType'];
$meta['gameId'] = isset($payload['gameId']) ? (string) $payload['gameId'] : $meta['gameId'];
$meta['universeId'] = isset($payload['universeId']) ? (int) $payload['universeId'] : $meta['universeId'];
$meta['creatorId'] = isset($payload['creatorId']) ? (int) $payload['creatorId'] : $meta['creatorId'];
$meta['creatorType'] = isset($payload['creatorType']) ? (string) $payload['creatorType'] : $meta['creatorType'];
$meta['placeVersion'] = isset($payload['placeVersion']) ? (int) $payload['placeVersion'] : (int) $meta['placeVersion'] + 1;
$meta['version'] = $meta['placeVersion'];
$meta['publishedAt'] = date('c');
$meta['updatedAt'] = date('c');
$meta['createdAt'] = isset($meta['createdAt']) ? $meta['createdAt'] : date('c');
$meta['published'] = true;

api_write_json_file($publishDir . '/' . $placeId . '.json', $meta);
api_track_place_stat($placeId, 'publish');
api_json_response(array(
    'ok' => true,
    'placeId' => (int) $placeId,
    'published' => true,
    'metadata' => $meta,
));
