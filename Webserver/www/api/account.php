<?php
require_once __DIR__ . '/common.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$account = api_get_current_account();

if ($method === 'GET') {
    api_json_response($account);
    exit;
}

if ($method === 'POST' || $method === 'PUT') {
    $payload = api_parse_request_payload();
    $settingsRoot = api_settings_root();

    if (isset($payload['username'])) {
        $account['username'] = (string) $payload['username'];
        file_put_contents($settingsRoot . '/username.txt', $account['username']);
    }

    if (isset($payload['membership'])) {
        $account['membership'] = (string) $payload['membership'];
        file_put_contents($settingsRoot . '/membership.txt', $account['membership']);
    }

    $account['updatedAt'] = date('c');
    api_json_response(array('ok' => true, 'account' => $account));
    exit;
}

api_json_response(array('error' => 'Unsupported method'), 405);
