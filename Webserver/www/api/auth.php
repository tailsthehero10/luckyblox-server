<?php
require_once __DIR__ . '/common.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$payload = api_parse_request_payload();
$settingsRoot = api_settings_root();
$account = api_get_current_account();

if ($method === 'GET') {
    api_json_response(array(
        'ok' => true,
        'authenticated' => true,
        'token' => 'local-token',
        'user' => $account,
        'message' => 'Local authentication is enabled for this launcher session.',
    ));
    exit;
}

if ($method === 'POST' || $method === 'PUT') {
    $username = isset($payload['username']) ? trim((string) $payload['username']) : $account['username'];
    $membership = isset($payload['membership']) ? trim((string) $payload['membership']) : $account['membership'];
    $password = isset($payload['password']) ? (string) $payload['password'] : '';

    if ($username !== '') {
        file_put_contents($settingsRoot . '/username.txt', $username);
    }

    if ($membership !== '') {
        file_put_contents($settingsRoot . '/membership.txt', $membership);
    }

    $userDir = $settingsRoot . '/users';
    if (!is_dir($userDir)) {
        @mkdir($userDir, 0777, true);
    }

    $profile = array(
        'username' => $username,
        'membership' => $membership,
        'id' => $account['id'],
        'studioAccess' => true,
        'authenticated' => true,
        'passwordSet' => $password !== '',
        'updatedAt' => date('c'),
    );

    $safeName = preg_replace('/[^a-zA-Z0-9_.-]+/', '_', $username);
    if ($safeName === '') {
        $safeName = 'user';
    }

    api_write_json_file($userDir . '/' . $safeName . '.json', $profile);

    api_json_response(array(
        'ok' => true,
        'authenticated' => true,
        'user' => $profile,
        'message' => 'Local login state updated.',
    ));
    exit;
}

api_json_response(array('error' => 'Unsupported method'), 405);
