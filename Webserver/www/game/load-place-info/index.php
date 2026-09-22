<?php
header('Content-Type: application/json');
require_once dirname(__DIR__, 2) . '/api/common.php';

$placeId = api_place_id_from_request();
$metadata = api_get_place_metadata($placeId);

api_json_response(array(
    'CreatorId' => $metadata['creatorId'],
    'CreatorType' => $metadata['creatorType'],
    'PlaceVersion' => $metadata['placeVersion'],
    'Version' => $metadata['version'],
    'GameId' => $metadata['gameId'],
    'IsRobloxPlace' => $metadata['isRobloxPlace'],
    'UniverseId' => $metadata['universeId'],
    'PlaceId' => $metadata['placeId'],
    'Name' => $metadata['name'],
    'Description' => $metadata['description'],
    'MapFile' => $metadata['mapFile'],
    'MapExists' => $metadata['mapExists'],
    'CreatedAt' => $metadata['createdAt'],
    'UpdatedAt' => $metadata['updatedAt'],
    'PublishedAt' => $metadata['publishedAt'],
    'Published' => $metadata['published'],
    'Stats' => $metadata['stats'],
    'Account' => api_get_current_account(),
));
 