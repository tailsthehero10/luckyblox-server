<?php
require_once __DIR__ . '/common.php';

$settingsRoot = api_settings_root();
$mapsRoot = api_maps_root();

function api_count_files($pattern) {
    if (!file_exists($pattern)) {
        return 0;
    }

    $matches = glob($pattern);
    return is_array($matches) ? count($matches) : 0;
}

$health = array(
    'ok' => true,
    'backend' => 'LuckyBlox Launcher Backend',
    'status' => 'online',
    'runtime' => array(
        'php' => PHP_VERSION,
        'server' => $_SERVER['SERVER_SOFTWARE'] ?? 'Unknown',
        'timestamp' => date('c'),
    ),
    'config' => array(
        'baseUrl' => api_public_base_url(),
        'ip' => api_public_server_ip(),
        'hostPort' => api_public_game_port(),
        'serverPort' => api_get_setting_value($settingsRoot . '/serverport.txt', '2005'),
        'clientPort' => api_get_setting_value($settingsRoot . '/clientport.txt', '53640'),
        'username' => api_get_current_account()['username'],
        'membership' => api_get_current_account()['membership'],
    ),
    'counts' => array(
        'places' => api_count_files($settingsRoot . '/places/*.json'),
        'published' => api_count_files($settingsRoot . '/published/*.json'),
        'saves' => api_count_files($settingsRoot . '/saves/*.*'),
        'maps' => api_count_files($mapsRoot . '/*'),
        'stats' => api_count_files($settingsRoot . '/stats/*.json'),
    ),
    'services' => array(
        'account',
        'places',
        'publish',
        'load',
        'save',
        'player',
        'spawn',
        'chatfilter',
        'text',
        'services',
        'health',
        'version',
        'stats',
    ),
);

api_json_response($health);
