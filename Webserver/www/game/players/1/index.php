<?php
require_once dirname(__DIR__, 3) . '/api/common.php';

header('Content-Type: application/json');

$placeId = api_place_id_from_request();
$playerState = api_get_local_player_state($placeId);
$spawnState = api_get_spawn_points($placeId);
$chatState = api_get_chat_filter_state($placeId);

api_json_response(array(
    'ok' => true,
    'placeId' => (int) $placeId,
    'player' => $playerState['player'],
    'account' => $playerState['account'],
    'spawns' => $spawnState,
    'chatFilter' => $chatState,
    'savedData' => $playerState['savedData'],
));
