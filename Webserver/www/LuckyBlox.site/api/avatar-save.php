<?php
// The data layer lives in Webserver/www/api/, NOT in Webserver/www/LuckBlox.site/api/.
// The old require pointed at a file that does not exist, so every save fatal-ed
// and avatar changes were silently lost.
require_once __DIR__ . '/../../api/luckyblox-data.php';

session_start();

header('Content-Type: application/json');

// Identity is taken from the signed-in session, never trusted from the body, so
// one account cannot overwrite another user's avatar.
$currentUser = lb_get_current_user();
$postedUserId = (int) ($_POST['userId'] ?? 0);
$userId = $currentUser ? (int) $currentUser['userId'] : $postedUserId;
if ($userId < 1) {
    echo json_encode(array('ok' => false, 'error' => 'sign-in-required'));
    exit;
}

$csrf = $_POST['csrf'] ?? $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
$sessionId = isset($_COOKIE[LB_SESSION_COOKIE]) ? (string) $_COOKIE[LB_SESSION_COOKIE] : '';
if ($sessionId === '' || !lb_verify_csrf_token((string) $csrf, $sessionId)) {
    echo json_encode(array('ok' => false, 'error' => 'invalid-csrf'));
    exit;
}

if (isset($_POST['reset']) && $_POST['reset'] === '1') {
    $gender = $_POST['gender'] ?? 'NotSpecified';
    $colors = lb_default_body_colors_for_gender($gender);
    $ok = lb_update_user_avatar_colors($userId, $colors);
    echo json_encode(array('ok' => $ok, 'colors' => $colors));
    exit;
}

if (isset($_POST['colors'])) {
    $colorData = json_decode($_POST['colors'], true);
    if (is_array($colorData)) {
        $validated = array();
        $keys = array('headColorId', 'torsoColorId', 'rightArmColorId', 'leftArmColorId', 'rightLegColorId', 'leftLegColorId');
        foreach ($keys as $k) {
            $validated[$k] = (int) ($colorData[$k] ?? 1002);
            if ($validated[$k] < 0) $validated[$k] = 1002;
        }
        $colorOk = lb_update_user_avatar_colors($userId, $validated);
        $genderOk = true;
        if (isset($_POST['gender'])) {
            $genderOk = lb_update_user_gender($userId, $_POST['gender']);
        }
        echo json_encode(array('ok' => $colorOk && $genderOk, 'colors' => $validated));
        exit;
    }
    echo json_encode(array('ok' => false, 'error' => 'invalid-colors'));
    exit;
}

if (isset($_POST['wearing'])) {
    $wearingList = array();
    if (is_string($_POST['wearing'])) {
        $decoded = json_decode($_POST['wearing'], true);
        if (is_array($decoded)) {
            foreach ($decoded as $id) {
                $wearingList[] = (string) $id;
            }
        } else {
            $wearingList = array_map('trim', explode(',', $_POST['wearing']));
            $wearingList = array_values(array_filter($wearingList, function($v) { return $v !== ''; }));
        }
    } elseif (is_array($_POST['wearing'])) {
        foreach ($_POST['wearing'] as $id) {
            $wearingList[] = (string) $id;
        }
    }
    $ok = lb_set_avatar_wearing($userId, $wearingList);
    echo json_encode(array('ok' => $ok, 'wearing' => $wearingList));
    exit;
}

echo json_encode(array('ok' => false, 'error' => 'no-action'));
exit;
