<?php
header('Content-Type: application/json');

$userId = isset($_GET['userId']) ? preg_replace('/[^0-9]/', '', (string) $_GET['userId']) : '1';
if ($userId === '') {
    $userId = '1';
}

$placeId = isset($_GET['placeId']) ? preg_replace('/[^0-9]/', '', (string) $_GET['placeId']) : '1818';
if ($placeId === '') {
    $placeId = '1818';
}

$payload = array(
    'userId' => (int) $userId,
    'placeId' => (int) $placeId,
    'scales' => array(
        'height' => 1.0,
        'width' => 1.0,
        'head' => 1.0,
        'depth' => 1.0,
        'proportion' => 0.0,
        'bodyType' => 0.0,
    ),
    'playerAvatarType' => 'R6',
    'bodyColors' => array(
        'headColorId' => 1002,
        'torsoColorId' => 1002,
        'rightArmColorId' => 1002,
        'leftArmColorId' => 1002,
        'rightLegColorId' => 1002,
        'leftLegColorId' => 1002,
    ),
    'assets' => array(
        array(
            'id' => 63690008,
            'name' => 'Pal Hair',
            'assetType' => array('id' => 41, 'name' => 'HairAccessory'),
            'currentVersionId' => 8443736161,
            'meta' => array('order' => 11, 'version' => 1),
        ),
        array(
            'id' => 86498048,
            'name' => 'Man Head',
            'assetType' => array('id' => 17, 'name' => 'Head'),
            'currentVersionId' => 11008778043,
        ),
        array(
            'id' => 86500008,
            'name' => 'Man Torso',
            'assetType' => array('id' => 27, 'name' => 'Torso'),
            'currentVersionId' => 11837972128,
        ),
        array(
            'id' => 86500036,
            'name' => 'Man Right Arm',
            'assetType' => array('id' => 28, 'name' => 'RightArm'),
            'currentVersionId' => 11837973329,
        ),
        array(
            'id' => 86500054,
            'name' => 'Man Left Arm',
            'assetType' => array('id' => 29, 'name' => 'LeftArm'),
            'currentVersionId' => 11837974431,
        ),
        array(
            'id' => 86500064,
            'name' => 'Man Left Leg',
            'assetType' => array('id' => 30, 'name' => 'LeftLeg'),
            'currentVersionId' => 11837975410,
        ),
        array(
            'id' => 86500078,
            'name' => 'Man Right Leg',
            'assetType' => array('id' => 31, 'name' => 'RightLeg'),
            'currentVersionId' => 11837976476,
        ),
        array(
            'id' => 144076358,
            'name' => 'Blue and Black Motorcycle Shirt',
            'assetType' => array('id' => 11, 'name' => 'Shirt'),
            'currentVersionId' => 339950145,
        ),
        array(
            'id' => 144076760,
            'name' => 'Dark Green Jeans',
            'assetType' => array('id' => 12, 'name' => 'Pants'),
            'currentVersionId' => 339951177,
        ),
        array(
            'id' => 453479994,
            'name' => 'roblox compute cloud',
            'assetType' => array('id' => 2, 'name' => 'TShirt'),
            'currentVersionId' => 765412475,
        ),
        array(
            'id' => 2510235063,
            'name' => 'Rthro Idle',
            'assetType' => array('id' => 51, 'name' => 'IdleAnimation'),
            'currentVersionId' => 13806699932,
        ),
    ),
    'defaultShirtApplied' => false,
    'defaultPantsApplied' => false,
    'emotes' => array(
        array('assetId' => 3360689775, 'assetName' => 'Salute', 'position' => 1),
        array('assetId' => 3576968026, 'assetName' => 'Shrug', 'position' => 2),
    ),
);

echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

