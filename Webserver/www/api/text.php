<?php
require_once __DIR__ . '/common.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$placeId = api_place_id_from_request();

if ($method === 'GET') {
    api_json_response(api_get_text_state($placeId));
    exit;
}

if ($method === 'POST' || $method === 'PUT') {
    $payload = api_parse_request_payload();
    $settingsRoot = api_settings_root();
    $textDir = $settingsRoot . '/text';

    if (!is_dir($textDir)) {
        @mkdir($textDir, 0777, true);
    }

    $state = api_get_text_state($placeId);
    $incoming = array();

    if (isset($payload['messages']) && is_array($payload['messages'])) {
        $incoming = $payload['messages'];
    }

    if (isset($payload['text'])) {
        $incoming[] = array(
            'text' => (string) $payload['text'],
            'username' => api_get_current_account()['username'],
            'createdAt' => date('c'),
        );
    }

    $state['messages'] = $incoming;
    $state['updatedAt'] = date('c');

    api_write_json_file($textDir . '/' . $placeId . '.json', $state);
    api_json_response(array('ok' => true, 'text' => $state));
    exit;
}

api_json_response(array('error' => 'Unsupported method'), 405);
