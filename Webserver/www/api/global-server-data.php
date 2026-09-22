<?php
require_once __DIR__ . '/common.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$settingsRoot = api_settings_root();
$dataRoot = $settingsRoot . '/serverdata';
if (!is_dir($dataRoot)) {
    @mkdir($dataRoot, 0777, true);
}

function global_server_data_file($dataRoot, $userId) {
    $safeName = preg_replace('/[^A-Za-z0-9._-]+/', '_', (string) $userId);
    return $dataRoot . '/' . ($safeName !== '' ? $safeName : 'user') . '.json';
}

if ($method === 'GET') {
    $userId = isset($_GET['userId']) ? trim((string) $_GET['userId']) : 'local-user';
    $file = global_server_data_file($dataRoot, $userId);
    $data = api_read_json_file($file);

    if (!is_array($data)) {
        $data = array(
            'userId' => $userId,
            'account' => api_get_current_account(),
            'inventory' => array(),
            'currencies' => array(),
            'configs' => array(),
            'membership' => api_get_current_account()['membership'],
            'updatedAt' => date('c'),
        );
    }

    api_json_response(array(
        'ok' => true,
        'userId' => $userId,
        'data' => $data,
    ));
    exit;
}

if ($method === 'POST' || $method === 'PUT') {
    $payload = api_parse_request_payload();
    $userId = isset($payload['userId']) && trim((string) $payload['userId']) !== ''
        ? trim((string) $payload['userId'])
        : 'local-user';

    $file = global_server_data_file($dataRoot, $userId);
    $existing = api_read_json_file($file);
    if (!is_array($existing)) {
        $existing = array();
    }

    $merged = array_merge($existing, $payload);
    $merged['userId'] = $userId;
    $merged['account'] = api_get_current_account();
    $merged['membership'] = isset($payload['membership']) ? (string) $payload['membership'] : ($existing['membership'] ?? api_get_current_account()['membership']);
    $merged['updatedAt'] = date('c');

    api_write_json_file($file, $merged);

    api_json_response(array(
        'ok' => true,
        'userId' => $userId,
        'data' => $merged,
    ));
    exit;
}

api_json_response(array('error' => 'Unsupported method'), 405);
