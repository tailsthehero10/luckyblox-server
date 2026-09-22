<?php
require_once __DIR__ . '/common.php';

api_json_response(array(
    'ok' => true,
    'backend' => 'LuckyBlox Launcher Backend',
    'name' => 'LuckyBlox Launcher API',
    'version' => '1.0.0',
    'phpVersion' => PHP_VERSION,
    'status' => 'online',
    'updatedAt' => date('c'),
    'endpoints' => array(
        'health',
        'version',
        'stats',
        'services',
        'places',
        'publish',
        'load',
        'save',
        'account',
        'player',
        'spawn',
        'chatfilter',
        'text',
    ),
));
