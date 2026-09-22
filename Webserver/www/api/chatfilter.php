<?php
require_once __DIR__ . '/common.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$placeId = api_place_id_from_request();

if ($method === 'GET') {
    api_json_response(api_get_chat_filter_state($placeId));
    exit;
}

if ($method === 'POST' || $method === 'PUT') {
    $payload = api_parse_request_payload();
    $settingsRoot = api_settings_root();
    $chatDir = $settingsRoot . '/chat';

    if (!is_dir($chatDir)) {
        @mkdir($chatDir, 0777, true);
    }

    $result = array(
        'placeId' => (int) $placeId,
        'enabled' => isset($payload['enabled']) ? (bool) $payload['enabled'] : true,
        'mode' => isset($payload['mode']) ? (string) $payload['mode'] : 'whitelist',
        'allowList' => isset($payload['allowList']) && is_array($payload['allowList']) ? $payload['allowList'] : array(),
        'denyList' => isset($payload['denyList']) && is_array($payload['denyList']) ? $payload['denyList'] : array(),
        'updatedAt' => date('c'),
    );

    api_write_json_file($chatDir . '/' . $placeId . '.json', $result);
    api_json_response(array('ok' => true, 'chatFilter' => $result));
    exit;
}

api_json_response(array('error' => 'Unsupported method'), 405);
