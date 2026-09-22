<?php
require_once __DIR__ . '/common.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$placeId = api_place_id_from_request();

if ($method === 'GET') {
    $state = api_get_local_player_state($placeId);
    api_json_response(array(
        'ok' => true,
        'placeId' => (int) $placeId,
        'player' => $state['player'],
        'account' => $state['account'],
        'metadata' => $state['metadata'],
    ));
    exit;
}

if ($method === 'POST' || $method === 'PUT') {
    $payload = api_parse_request_payload();
    $settingsRoot = api_settings_root();

    if (isset($payload['username'])) {
        file_put_contents($settingsRoot . '/username.txt', (string) $payload['username']);
    }

    if (isset($payload['membership'])) {
        file_put_contents($settingsRoot . '/membership.txt', (string) $payload['membership']);
    }

    $state = api_get_local_player_state($placeId);
    api_json_response(array(
        'ok' => true,
        'placeId' => (int) $placeId,
        'player' => $state['player'],
        'account' => $state['account'],
    ));
    exit;
}

api_json_response(array('error' => 'Unsupported method'), 405);
