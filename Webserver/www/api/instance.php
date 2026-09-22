<?php
require_once __DIR__ . '/common.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$placeId = api_place_id_from_request();
$payload = api_parse_request_payload();

if ($method === 'GET') {
    $meta = api_get_place_metadata($placeId);
    api_json_response(array(
        'ok' => true,
        'placeId' => (int) $placeId,
        'instance' => array(
            'id' => 'local-instance-' . $placeId,
            'name' => 'Local Instance',
            'status' => 'running',
            'playerCount' => 1,
            'maxPlayers' => 30,
            'placeId' => (int) $placeId,
            'baseUrl' => 'http://localhost',
            'createdAt' => date('c'),
            'metadata' => $meta,
        ),
    ));
    exit;
}

if ($method === 'POST' || $method === 'PUT') {
    $settingsRoot = api_settings_root();
    $dir = $settingsRoot . '/instances';
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }

    $instance = array(
        'id' => isset($payload['id']) ? (string) $payload['id'] : 'local-instance-' . $placeId,
        'name' => isset($payload['name']) ? (string) $payload['name'] : 'Local Instance',
        'status' => isset($payload['status']) ? (string) $payload['status'] : 'running',
        'playerCount' => isset($payload['playerCount']) ? (int) $payload['playerCount'] : 1,
        'maxPlayers' => isset($payload['maxPlayers']) ? (int) $payload['maxPlayers'] : 30,
        'placeId' => (int) $placeId,
        'baseUrl' => isset($payload['baseUrl']) ? (string) $payload['baseUrl'] : 'http://localhost',
        'createdAt' => date('c'),
        'updatedAt' => date('c'),
    );

    api_write_json_file($dir . '/' . $placeId . '.json', $instance);

    api_json_response(array(
        'ok' => true,
        'placeId' => (int) $placeId,
        'instance' => $instance,
    ));
    exit;
}

api_json_response(array('error' => 'Unsupported method'), 405);
