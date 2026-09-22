<?php
require_once __DIR__ . '/common.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$placeId = api_place_id_from_request();

if ($method === 'GET') {
    api_json_response(api_get_spawn_points($placeId));
    exit;
}

if ($method === 'POST' || $method === 'PUT') {
    $payload = api_parse_request_payload();
    $settingsRoot = api_settings_root();
    $spawnDir = $settingsRoot . '/spawns';

    if (!is_dir($spawnDir)) {
        @mkdir($spawnDir, 0777, true);
    }

    $result = array(
        'placeId' => (int) $placeId,
        'updatedAt' => date('c'),
    );

    if (isset($payload['spawns']) && is_array($payload['spawns'])) {
        $result['spawns'] = $payload['spawns'];
        $result['defaultSpawn'] = isset($payload['defaultSpawn']) ? $payload['defaultSpawn'] : $payload['spawns'][0];
    } else {
        $result['spawns'] = api_get_spawn_points($placeId)['spawns'];
        $result['defaultSpawn'] = api_get_spawn_points($placeId)['defaultSpawn'];
    }

    api_write_json_file($spawnDir . '/' . $placeId . '.json', $result);
    api_json_response(array('ok' => true, 'spawn' => $result));
    exit;
}

api_json_response(array('error' => 'Unsupported method'), 405);
