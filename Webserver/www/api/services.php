<?php
require_once __DIR__ . '/common.php';

header('Content-Type: application/json');

$placeId = api_place_id_from_request();
$serviceName = isset($_GET['service']) ? trim((string) $_GET['service']) : '';

$services = array(
    'Players' => array(
        'description' => 'Local player and player roster data',
        'endpoints' => array(
            '/game/players/1/index.php?placeid=' . $placeId,
            '/api/player.php?placeid=' . $placeId,
        ),
        'available' => true,
    ),
    'GameService' => array(
        'description' => 'Game metadata, place info, and local state loading',
        'endpoints' => array(
            '/game/load-place-info/index.php?placeid=' . $placeId,
            '/api/load.php?placeid=' . $placeId,
            '/api/save.php?placeid=' . $placeId,
        ),
        'available' => true,
    ),
    'SpawnService' => array(
        'description' => 'Spawn point configuration for a local place',
        'endpoints' => array(
            '/api/spawn.php?placeid=' . $placeId,
        ),
        'available' => true,
    ),
    'ChatService' => array(
        'description' => 'Chat filtering and text message storage',
        'endpoints' => array(
            '/api/chatfilter.php?placeid=' . $placeId,
            '/api/text.php?placeid=' . $placeId,
        ),
        'available' => true,
    ),
    'MarketplaceService' => array(
        'description' => 'Place metadata, publishing, and catalog-like lookups',
        'endpoints' => array(
            '/api/places.php?placeid=' . $placeId,
            '/api/publish.php?placeid=' . $placeId,
        ),
        'available' => true,
    ),
    'AccountService' => array(
        'description' => 'Current account, membership, and local account state',
        'endpoints' => array(
            '/api/account.php',
        ),
        'available' => true,
    ),
    'AuthService' => array(
        'description' => 'Local auth/session data for the launcher and site',
        'endpoints' => array(
            '/api/auth.php',
        ),
        'available' => true,
    ),
    'GamesService' => array(
        'description' => 'Local games listing and game metadata operations',
        'endpoints' => array(
            '/api/games.php?placeid=' . $placeId,
        ),
        'available' => true,
    ),
    'InstanceService' => array(
        'description' => 'Local game instance queries and lifecycle state',
        'endpoints' => array(
            '/api/instance.php?placeid=' . $placeId,
        ),
        'available' => true,
    ),
    'UsersService' => array(
        'description' => 'Local user records for sign-in and profile operations',
        'endpoints' => array(
            '/api/users.php',
        ),
        'available' => true,
    ),
);

if ($serviceName !== '') {
    $normalized = strtolower($serviceName);
    $matchedService = null;

    foreach (array_keys($services) as $key) {
        if (strtolower($key) === $normalized) {
            $matchedService = $key;
            break;
        }
    }

    if ($matchedService !== null) {
        api_json_response(array(
            'ok' => true,
            'service' => $matchedService,
            'details' => $services[$matchedService],
        ));
        exit;
    }

    api_json_response(array(
        'ok' => false,
        'error' => 'Service not found',
        'availableServices' => array_keys($services),
    ), 404);
    exit;
}

api_json_response(array(
    'ok' => true,
    'placeId' => (int) $placeId,
    'services' => $services,
));
