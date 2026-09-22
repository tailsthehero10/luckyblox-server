<?php
require_once __DIR__ . '/common.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$placeId = api_place_id_from_request();

if ($method === 'GET') {
    $meta = api_get_place_metadata($placeId);
    $games = array(
        array(
            'gameId' => (string) ($meta['gameId'] ?? 'Test'),
            'placeId' => (int) $placeId,
            'universeId' => (int) ($meta['universeId'] ?? 13058),
            'name' => $meta['name'],
            'description' => $meta['description'],
            'creatorId' => (int) ($meta['creatorId'] ?? 1),
            'creatorType' => $meta['creatorType'] ?? 'User',
            'placeVersion' => (int) ($meta['placeVersion'] ?? 1),
            'published' => (bool) ($meta['published'] ?? false),
            'createdAt' => $meta['createdAt'],
            'updatedAt' => $meta['updatedAt'],
            'publishedAt' => $meta['publishedAt'],
            'stats' => $meta['stats'],
        ),
    );

    api_json_response(array(
        'ok' => true,
        'placeId' => (int) $placeId,
        'games' => $games,
        'count' => count($games),
    ));
    exit;
}

if ($method === 'POST' || $method === 'PUT') {
    $payload = api_parse_request_payload();
    $meta = api_get_place_metadata($placeId);

    $meta['name'] = isset($payload['name']) ? (string) $payload['name'] : $meta['name'];
    $meta['description'] = isset($payload['description']) ? (string) $payload['description'] : $meta['description'];
    $meta['creatorId'] = isset($payload['creatorId']) ? (int) $payload['creatorId'] : $meta['creatorId'];
    $meta['creatorType'] = isset($payload['creatorType']) ? (string) $payload['creatorType'] : $meta['creatorType'];
    $meta['updatedAt'] = date('c');

    $settingsRoot = api_settings_root();
    $dir = $settingsRoot . '/places';
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }

    api_write_json_file($dir . '/' . $placeId . '.json', $meta);

    api_json_response(array(
        'ok' => true,
        'placeId' => (int) $placeId,
        'game' => $meta,
    ));
    exit;
}

api_json_response(array('error' => 'Unsupported method'), 405);
