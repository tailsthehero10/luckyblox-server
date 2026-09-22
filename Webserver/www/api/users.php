<?php
require_once __DIR__ . '/common.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $settingsRoot = api_settings_root();
    $userDir = $settingsRoot . '/users';
    $users = array();

    if (is_dir($userDir)) {
        $files = glob($userDir . '/*.json');
        if (is_array($files)) {
            foreach ($files as $file) {
                $user = api_read_json_file($file);
                if (is_array($user) && !empty($user)) {
                    $users[] = $user;
                }
            }
        }
    }

    if (empty($users)) {
        $users[] = api_get_current_account();
    }

    api_json_response(array(
        'ok' => true,
        'users' => $users,
        'count' => count($users),
    ));
    exit;
}

if ($method === 'POST' || $method === 'PUT') {
    $payload = api_parse_request_payload();
    $account = api_get_current_account();

    $username = isset($payload['username']) ? trim((string) $payload['username']) : $account['username'];
    $membership = isset($payload['membership']) ? trim((string) $payload['membership']) : $account['membership'];

    $userDir = api_settings_root() . '/users';
    if (!is_dir($userDir)) {
        @mkdir($userDir, 0777, true);
    }

    $profile = array(
        'username' => $username,
        'membership' => $membership,
        'id' => $account['id'],
        'studioAccess' => true,
        'createdAt' => date('c'),
        'updatedAt' => date('c'),
    );

    $safeName = preg_replace('/[^a-zA-Z0-9_.-]+/', '_', $username);
    if ($safeName === '') {
        $safeName = 'user';
    }

    api_write_json_file($userDir . '/' . $safeName . '.json', $profile);

    api_json_response(array(
        'ok' => true,
        'user' => $profile,
    ));
    exit;
}

api_json_response(array('error' => 'Unsupported method'), 405);
