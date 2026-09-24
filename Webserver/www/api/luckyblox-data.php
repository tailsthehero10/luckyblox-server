<?php
/**
 * LuckyBlox data bridge for the PHP frontend.
 *
 * Resolves the same data directory the Node.js http-db-bridge uses (so PHP
 * pages read the same users.json / games.json the signed-in session is stored
 * against), provides PBKDF2-SHA512 password hashing compatible with
 * server/security.js, and offers a small session layer that mirrors the
 * Node.js `luckblox_session` cookie / sessions.json store.
 */

if (!defined('LB_PBKDF2_ITERATIONS')) {
    define('LB_PBKDF2_ITERATIONS', 210000);
    define('LB_PBKDF2_KEYLEN', 64);
    define('LB_PBKDF2_DIGEST', 'sha512');
    define('LB_HASH_VERSION', 3);
    define('LB_SESSION_COOKIE', 'luckblox_session');
    define('LB_SESSION_TTL', 1000 * 60 * 60 * 12); // 12 hours
}

function lb_release_root() {
    static $root = null;
    if ($root === null) {
        $root = realpath(__DIR__ . '/../../');
    }
    return $root;
}

function lb_data_dir() {
    $explicit = getenv('LUCKYBLOX_DATA_DIR');
    if ($explicit !== false && trim((string) $explicit) !== '') {
        $resolved = realpath(trim((string) $explicit));
        if ($resolved !== false) {
            return $resolved;
        }
        return trim((string) $explicit);
    }

    $renderDisk = getenv('RENDER_DISK_PATH');
    if ($renderDisk !== false && trim((string) $renderDisk) !== '') {
        $candidate = realpath(trim((string) $renderDisk) . '/luckblox-data');
        if ($candidate !== false) {
            return $candidate;
        }
        return trim((string) $renderDisk) . '/luckblox-data';
    }

    return lb_release_root() . '/Webserver/http-db-bridge/data';
}

function lb_settings_root() {
    return lb_release_root() . '/Settings';
}

function lb_maps_root() {
    return lb_release_root() . '/Maps';
}

function lb_read_json($relativePath, $fallback = array()) {
    $dir = lb_data_dir();
    $path = $dir . '/' . ltrim($relativePath, '/');
    if (!file_exists($path)) {
        return $fallback;
    }
    $content = file_get_contents($path);
    if ($content === false || trim($content) === '') {
        return $fallback;
    }
    $isGz = (substr($content, 0, 2) === "\x1f\x8b") || (substr($path, -3) === '.gz');
    if ($isGz) {
        $decoded = @gzdecode($content);
        if ($decoded === false) {
            return $fallback;
        }
        $content = $decoded;
    }
    $data = json_decode($content, true);
    return is_array($data) ? $data : $fallback;
}

function lb_write_json($relativePath, $data) {
    $dir = lb_data_dir();
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
    $path = $dir . '/' . ltrim($relativePath, '/');
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    return file_put_contents($path, $json);
}

function lb_users_path() {
    return lb_data_dir() . '/users.json';
}

function lb_games_path() {
    return lb_data_dir() . '/games.json';
}

function lb_places_path() {
    return lb_data_dir() . '/places.json';
}

function lb_assets_path() {
    return lb_data_dir() . '/assets.json';
}

function lb_sessions_path() {
    return lb_data_dir() . '/sessions.json';
}

function lb_get_users() {
    return lb_read_json('users.json', array());
}

function lb_get_games() {
    return lb_read_json('games.json', array());
}

function lb_get_places() {
    return lb_read_json('places.json', array());
}

function lb_get_assets() {
    return lb_read_json('assets.json', array());
}

function lb_find_user_by_id($userId) {
    $users = lb_get_users();
    $key = (string) $userId;
    if (isset($users[$key]) && is_array($users[$key])) {
        return lb_normalize_user($users[$key], $key);
    }
    return null;
}

function lb_find_user_by_username($username) {
    $target = strtolower(trim((string) $username));
    if ($target === '') {
        return null;
    }
    $users = lb_get_users();
    $matches = array();
    foreach ($users as $key => $user) {
        if (!is_array($user)) {
            continue;
        }
        $uname = strtolower(trim((string) ($user['username'] ?? $user['displayName'] ?? '')));
        if ($uname === $target) {
            $matches[] = array('key' => $key, 'user' => $user);
        }
    }
    if (empty($matches)) {
        return null;
    }
    usort($matches, function($a, $b) {
        $credA = (!empty($a['user']['password']) && !empty($a['user']['passwordSalt'])) ? 2 : 1;
        $credB = (!empty($b['user']['password']) && !empty($b['user']['passwordSalt'])) ? 2 : 1;
        $diff = $credB - $credA;
        if ($diff !== 0) {
            return $diff;
        }
        $verA = (int) ($a['user']['passwordVersion'] ?? 0);
        $verB = (int) ($b['user']['passwordVersion'] ?? 0);
        return $verB - $verA;
    });
    $best = $matches[0];
    return lb_normalize_user($best['user'], $best['key']);
}

function lb_normalize_user($user, $key = null) {
    if (!is_array($user)) {
        return null;
    }
    $id = (string) ($user['userId'] ?? $key ?? 1);
    return array(
        'key'           => $id,
        'userId'        => $id,
        'username'      => $user['username'] ?? 'LocalPlayer',
        'displayName'   => $user['displayName'] ?? ($user['username'] ?? 'LocalPlayer'),
        'bio'           => $user['bio'] ?? '',
        'joinDate'      => $user['joinDate'] ?? '',
        'membership'    => $user['membershipStatus'] ?? ($user['membership'] ?? 'Premium'),
        'membershipStatus' => $user['membershipStatus'] ?? ($user['membership'] ?? 'Premium'),
        'robux'         => (int) ($user['robux'] ?? 0),
        'currencies'    => $user['currencies'] ?? array(),
        'inventory'     => is_array($user['inventory'] ?? null) ? $user['inventory'] : array(),
        'currentlyWearing' => is_array($user['currentlyWearing'] ?? null) ? $user['currentlyWearing'] : array(),
        'stats'         => is_array($user['stats'] ?? null) ? $user['stats'] : array(
            'friends' => 0, 'created' => 0, 'plays' => 0, 'followers' => 0, 'badges' => 0, 'gameVisits' => 0
        ),
        'friends'       => is_array($user['friends'] ?? null) ? $user['friends'] : array(),
        'badges'        => is_array($user['badges'] ?? null) ? $user['badges'] : array(),
         'avatar'        => is_array($user['avatar'] ?? null) ? $user['avatar'] : array(
            'bodyColors' => array(
                'headColorId' => 1002, 'torsoColorId' => 1002,
                'rightArmColorId' => 1002, 'leftArmColorId' => 1002,
                'rightLegColorId' => 1002, 'leftLegColorId' => 1002,
            )
        ),
        'gender'        => $user['gender'] ?? ($user['avatar']['gender'] ?? 'NotSpecified'),
        'robloxUserId'  => $user['robloxUserId'] ?? null,
        'admin'         => (bool) ($user['admin'] ?? $user['isAdmin'] ?? false),
        'isAdmin'       => (bool) ($user['admin'] ?? $user['isAdmin'] ?? false),
        'isVerified'    => (bool) ($user['isVerified'] ?? false),
        'role'          => $user['role'] ?? 'player',
        'updatedAt'     => $user['updatedAt'] ?? '',
        'password'      => $user['password'] ?? '',
        'passwordSalt'  => $user['passwordSalt'] ?? '',
        'passwordVersion' => $user['passwordVersion'] ?? 0,
    );
}

function lb_hash_password($password, $salt = null) {
    $useSalt = $salt ?: bin2hex(random_bytes(16));
    $hash = hash_pbkdf2(LB_PBKDF2_DIGEST, (string) $password, $useSalt, LB_PBKDF2_ITERATIONS, LB_PBKDF2_KEYLEN, false);
    return array('hash' => $hash, 'salt' => $useSalt, 'version' => LB_HASH_VERSION);
}

function lb_verify_password($password, $hash, $salt) {
    if (empty($password) || empty($hash) || empty($salt)) {
        return false;
    }
    $computed = hash_pbkdf2(LB_PBKDF2_DIGEST, (string) $password, (string) $salt, LB_PBKDF2_ITERATIONS, LB_PBKDF2_KEYLEN, false);
    if (strlen($computed) !== strlen($hash)) {
        return false;
    }
    return hash_equals($computed, (string) $hash);
}

function lb_check_password_policy($password) {
    $errors = array();
    $value = (string) $password;
    $score = 0;

    if (strlen($value) < 8) {
        $errors[] = 'Password must be at least 8 characters long.';
    } else {
        $score += strlen($value) >= 12 ? 2 : 1;
    }

    if (!preg_match('/[a-z]/', $value)) {
        $errors[] = 'Password must include a lowercase letter.';
    } else {
        $score += 1;
    }

    if (!preg_match('/[A-Z]/', $value)) {
        $errors[] = 'Password must include an uppercase letter.';
    } else {
        $score += 1;
    }

    if (!preg_match('/[0-9]/', $value)) {
        $errors[] = 'Password must include a number.';
    } else {
        $score += 1;
    }

    $commonPasswords = array('password','password1','password123','123456','12345678','123456789','qwerty','qwerty123','letmein','welcome','admin','admin123','local','roblox','luckyblox','iloveyou','abc123','111111','000000');
    if (in_array(strtolower($value), $commonPasswords)) {
        $errors[] = 'That password is too common. Pick something unique.';
        $score = 0;
    }

    if (preg_match('/^(.)\1+$/', $value)) {
        $errors[] = 'Password cannot be a single repeated character.';
        $score = 0;
    }

    return array('ok' => empty($errors), 'errors' => $errors, 'score' => max(0, min(4, $score)));
}

function lb_check_username_policy($username) {
    $errors = array();
    $value = trim((string) $username);

    if (strlen($value) < 3 || strlen($value) > 20) {
        $errors[] = 'Username must be between 3 and 20 characters.';
    }
    if (!preg_match('/^[A-Za-z0-9_]+$/', $value)) {
        $errors[] = 'Username can only contain letters, numbers, and underscores.';
    }
    if (preg_match('/^_|_$/', $value)) {
        $errors[] = 'Username cannot start or end with an underscore.';
    }

    return array('ok' => empty($errors), 'errors' => $errors);
}

function lb_client_ip() {
    $keys = array('HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'REMOTE_ADDR');
    foreach ($keys as $key) {
        if (!empty($_SERVER[$key])) {
            $ip = trim(explode(',', $_SERVER[$key])[0]);
            if ($ip !== '') {
                return $ip;
            }
        }
    }
    return 'unknown';
}

function lb_generate_session_id() {
    return 'lb_' . bin2hex(random_bytes(24));
}

function lb_secret_key() {
    $secret = getenv('LUCKYBLOX_SECRET') ?: 'luckyblox-local-dev-secret';
    return (string) $secret;
}

function lb_create_csrf_token($sessionId) {
    $nonce = bin2hex(random_bytes(16));
    $payload = $sessionId . '.' . $nonce;
    $sig = hash_hmac('sha256', $payload, lb_secret_key());
    return $payload . '.' . $sig;
}

function lb_verify_csrf_token($token, $sessionId) {
    if (empty($token) || !is_string($token)) {
        return false;
    }
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        return false;
    }
    $tokenSession = $parts[0];
    $sig = $parts[2];
    if (!preg_match('/^[0-9a-f]{64}$/', $sig)) {
        return false;
    }
    if (!preg_match('/^[0-9a-f]{32}$/', $parts[1])) {
        return false;
    }
    if ($tokenSession !== $sessionId) {
        return false;
    }
    $expected = hash_hmac('sha256', $payload = $sessionId . '.' . $parts[1], lb_secret_key());
    return hash_equals($expected, $sig);
}

function lb_get_session_store() {
    return lb_read_json('sessions.json', array());
}

function lb_save_session_store($sessions) {
    return lb_write_json('sessions.json', $sessions);
}

function lb_load_session() {
    $sessionId = $_COOKIE[LB_SESSION_COOKIE] ?? null;
    if (!$sessionId) {
        return null;
    }
    $sessions = lb_get_session_store();
    if (!isset($sessions[$sessionId])) {
        return null;
    }
    $session = $sessions[$sessionId];
    if (!isset($session['expiresAt']) || time() * 1000 > (int) $session['expiresAt']) {
        unset($sessions[$sessionId]);
        lb_save_session_store($sessions);
        return null;
    }
    return array('id' => $sessionId, 'data' => $session);
}

function lb_set_session_cookie($sessionId, $expiresAt) {
    $maxAge = max(1, (int) (($expiresAt - (time() * 1000)) / 1000));
    $secure = isset($_SERVER['HTTPS']);
    setcookie(LB_SESSION_COOKIE, $sessionId, array(
        'expires' => time() + $maxAge,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ));
}

function lb_clear_session_cookie() {
    setcookie(LB_SESSION_COOKIE, '', array(
        'expires' => time() - 3600,
        'path' => '/',
        'secure' => isset($_SERVER['HTTPS']),
        'httponly' => true,
        'samesite' => 'Lax',
    ));
}

function lb_destroy_session() {
    $sessionId = $_COOKIE[LB_SESSION_COOKIE] ?? null;
    if ($sessionId) {
        $sessions = lb_get_session_store();
        if (isset($sessions[$sessionId])) {
            unset($sessions[$sessionId]);
            lb_save_session_store($sessions);
        }
    }
    lb_clear_session_cookie();
}

function lb_get_current_user() {
    $session = lb_load_session();
    if (!$session || empty($session['data']['userId'])) {
        return null;
    }
    $user = lb_find_user_by_id($session['data']['userId']);
    return $user;
}

function lb_get_csrf_token() {
    $session = lb_load_session();
    if ($session && isset($session['data']['csrfToken'])) {
        return $session['data']['csrfToken'];
    }
    $sessionId = $_COOKIE[LB_SESSION_COOKIE] ?? null;
    if (!$sessionId) {
        $sessionId = lb_generate_session_id();
        $expiresAt = time() * 1000 + LB_SESSION_TTL;
        $sessions = lb_get_session_store();
        $sessions[$sessionId] = array(
            'sessionId' => $sessionId,
            'userId' => '1',
            'username' => 'guest',
            'csrfToken' => lb_create_csrf_token($sessionId),
            'ip' => lb_client_ip(),
            'userAgent' => '',
            'expiresAt' => $expiresAt,
            'createdAt' => time() * 1000,
        );
        lb_save_session_store($sessions);
        lb_set_session_cookie($sessionId, $expiresAt);
    }
    $sessions = lb_get_session_store();
    if (isset($sessions[$sessionId]['csrfToken'])) {
        return $sessions[$sessionId]['csrfToken'];
    }
    $token = lb_create_csrf_token($sessionId);
    if (isset($sessions[$sessionId])) {
        $sessions[$sessionId]['csrfToken'] = $token;
        lb_save_session_store($sessions);
    }
    return $token;
}

function lb_verify_csrf() {
    $token = $_POST['_csrf'] ?? $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $sessionId = $_COOKIE[LB_SESSION_COOKIE] ?? null;
    if (!$sessionId) {
        return false;
    }
    return lb_verify_csrf_token((string) $token, $sessionId);
}

function lb_signup($username, $password, $confirmPassword, $displayName = null, $gender = 'NotSpecified') {
    $errors = array();

    $usernameCheck = lb_check_username_policy($username);
    if (!$usernameCheck['ok']) {
        $errors = array_merge($errors, $usernameCheck['errors']);
    }

    if ($password !== $confirmPassword) {
        $errors[] = 'Passwords do not match.';
    }

    $policy = lb_check_password_policy($password);
    if (!$policy['ok']) {
        $errors = array_merge($errors, $policy['errors']);
    }

    $allowedGenders = array('Male', 'Female', 'NotSpecified');
    if (!in_array($gender, $allowedGenders, true)) {
        $gender = 'NotSpecified';
    }

    if (!empty($errors)) {
        return array('ok' => false, 'errors' => $errors);
    }

    $users = lb_get_users();

    if (lb_find_user_by_username($username) !== null) {
        return array('ok' => false, 'errors' => array('That username is already taken.'));
    }

    $existingIds = array_map(function($u) {
        return is_array($u) ? (int) ($u['userId'] ?? $u['id'] ?? 1) : 0;
    }, array_values($users));
    $nextId = max(1, max($existingIds) ?: 0) + 1;

    $hashed = lb_hash_password($password);

    $defaultColors = lb_default_body_colors_for_gender($gender);

    $user = array(
        'userId' => (string) $nextId,
        'username' => $username,
        'displayName' => $displayName ?: $username,
        'gender' => $gender,
        'password' => $hashed['hash'],
        'passwordSalt' => $hashed['salt'],
        'passwordVersion' => $hashed['version'],
        'role' => 'player',
        'bio' => 'New LuckyBlox creator account.',
        'joinDate' => date('c'),
        'membershipStatus' => 'Premium',
        'robux' => 100,
        'currencies' => array('coins' => 250, 'ticket' => 10),
        'inventory' => array('1001', '1002', '1003', '1004'),
        'currentlyWearing' => array('1001', '1002', '1003'),
        'stats' => array('friends' => 0, 'created' => 1, 'plays' => 0, 'followers' => 0, 'badges' => 0, 'gameVisits' => 0),
        'friends' => array(),
        'badges' => array(),
        'avatar' => array(
            'gender' => $gender,
            'playerAvatarType' => 'R15',
            'scales' => array(
                'height' => 1.0, 'width' => 1.0, 'head' => 1.0,
                'depth' => 1.0, 'proportion' => 0.0, 'bodyType' => 0.0,
            ),
            'bodyColors' => $defaultColors,
        ),
        'updatedAt' => date('c'),
    );

    $users[(string) $nextId] = $user;
    lb_write_json('users.json', $users);

    lb_create_session_for_user((string) $nextId);

    return array(
        'ok' => true,
        'userId' => (string) $nextId,
        'username' => $username,
        'displayName' => $user['displayName'],
    );
}

function lb_signin($username, $password) {
    $user = lb_find_user_by_username($username);
    if (!$user) {
        return array('ok' => false, 'errors' => array('We could not find that account. Try creating one first.'));
    }

    $valid = false;
    if (!empty($user['password']) && !empty($user['passwordSalt'])) {
        $valid = lb_verify_password($password, $user['password'], $user['passwordSalt']);
    } elseif (!empty($user['password'])) {
        $valid = hash_equals((string) $user['password'], (string) $password);
    }

    if (!$valid) {
        return array('ok' => false, 'errors' => array('That password is incorrect.'));
    }

    if (($user['passwordVersion'] ?? 0) < LB_HASH_VERSION) {
        $hashed = lb_hash_password($password, $user['passwordSalt']);
        $users = lb_get_users();
        $users[$user['key']]['password'] = $hashed['hash'];
        $users[$user['key']]['passwordSalt'] = $hashed['salt'];
        $users[$user['key']]['passwordVersion'] = $hashed['version'];
        $users[$user['key']]['updatedAt'] = date('c');
        lb_write_json('users.json', $users);
    }

    lb_create_session_for_user($user['userId']);

    return array('ok' => true, 'userId' => $user['userId'], 'username' => $user['username']);
}

function lb_create_session_for_user($userId) {
    $sessionId = lb_generate_session_id();
    $expiresAt = time() * 1000 + LB_SESSION_TTL;

    $sessions = lb_get_session_store();
    $sessions[$sessionId] = array(
        'sessionId' => $sessionId,
        'userId' => (string) $userId,
        'username' => lb_find_user_by_id($userId)['username'] ?? 'LocalPlayer',
        'csrfToken' => lb_create_csrf_token($sessionId),
        'ip' => lb_client_ip(),
        'userAgent' => substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 200),
        'expiresAt' => $expiresAt,
        'createdAt' => time() * 1000,
    );
    lb_save_session_store($sessions);
    lb_set_session_cookie($sessionId, $expiresAt);
    return $sessionId;
}

function lb_normalize_game($game) {
    if (!is_array($game)) {
        return null;
    }
    return array(
        'placeId' => (int) ($game['placeId'] ?? 1818),
        'title' => $game['title'] ?? 'LuckyBlox Arena',
        'description' => $game['description'] ?? '',
        'developer' => $game['developer'] ?? 'LuckyBlox Studio',
        'icon' => $game['icon'] ?? '',
        'genre' => $game['genre'] ?? 'Adventure',
        'playerCount' => (int) ($game['playerCount'] ?? 0),
        'likes' => (int) ($game['likes'] ?? 0),
        'favorites' => (int) ($game['favorites'] ?? 0),
        'activeServers' => is_array($game['activeServers'] ?? null) ? $game['activeServers'] : array(),
        'serverList' => is_array($game['serverList'] ?? null) ? $game['serverList'] : array(),
        'votes' => $game['votes'] ?? array('likes' => 0, 'dislikes' => 0),
        'tags' => is_array($game['tags'] ?? null) ? $game['tags'] : array(),
        'updatedAt' => $game['updatedAt'] ?? '',
    );
}

function lb_get_all_games() {
    $games = lb_get_games();
    $result = array();
    foreach ($games as $key => $game) {
        $normalized = lb_normalize_game($game);
        if ($normalized) {
            $result[] = $normalized;
        }
    }
    usort($result, function($a, $b) {
        return $a['placeId'] - $b['placeId'];
    });
    return $result;
}

function lb_get_game_by_id($placeId) {
    $games = lb_get_games();
    $key = (string) $placeId;
    if (isset($games[$key])) {
        return lb_normalize_game($games[$key]);
    }
    foreach ($games as $game) {
        if (($game['placeId'] ?? null) === $placeId) {
            return lb_normalize_game($game);
        }
    }

    $mapName = lb_find_map_name($placeId);
    if ($mapName) {
        return array(
            'placeId' => (int) $placeId,
            'title' => str_replace('_', ' ', $mapName),
            'description' => 'A local map packaged as a playable LuckyBlox experience.',
            'developer' => 'LuckyBlox Studio',
            'icon' => '',
            'genre' => 'Adventure',
            'playerCount' => 0,
            'likes' => 0,
            'favorites' => 0,
            'activeServers' => array(),
            'serverList' => array(),
            'votes' => array('likes' => 0, 'dislikes' => 0),
            'tags' => array('Community', 'Local'),
            'updatedAt' => '',
        );
    }
    return null;
}

function lb_find_map_name($placeId) {
    $mapsRoot = lb_maps_root();
    if (!is_dir($mapsRoot)) {
        return null;
    }
    $direct = $mapsRoot . '/' . $placeId . '.rbxl';
    if (file_exists($direct)) {
        return $placeId . '.rbxl';
    }
    $files = glob($mapsRoot . '/*');
    if (!is_array($files)) {
        return null;
    }
    foreach ($files as $file) {
        if (!is_file($file)) {
            continue;
        }
        $base = basename($file, '.rbxl');
        if ((int) $base === (int) $placeId) {
            return basename($file);
        }
    }
    return null;
}

function lb_get_place_metadata($placeId) {
    $places = lb_get_places();
    $key = (string) $placeId;
    if (isset($places[$key])) {
        return $places[$key];
    }
    return null;
}

function lb_get_latest_published_place_id() {
    $settingsRoot = lb_settings_root();
    $publishedDir = $settingsRoot . '/published';
    if (!is_dir($publishedDir)) {
        return '1818';
    }
    $files = glob($publishedDir . '/*.json');
    if (!$files || count($files) === 0) {
        return '1818';
    }
    $latestPlaceId = '1818';
    $latestTimestamp = 0;
    foreach ($files as $file) {
        $baseName = basename($file, '.json');
        if (!ctype_digit((string) $baseName)) {
            continue;
        }
        $data = lb_read_json('Settings/published/' . $baseName . '.json', array());
        $timestamp = null;
        if (isset($data['publishedAt']) && trim((string) $data['publishedAt']) !== '') {
            $parsed = strtotime((string) $data['publishedAt']);
            if ($parsed !== false) {
                $timestamp = $parsed;
            }
        }
        if ($timestamp === null) {
            $timestamp = filemtime($file);
        }
        if ($timestamp > $latestTimestamp) {
            $latestTimestamp = $timestamp;
            $latestPlaceId = $baseName;
        }
    }
    return $latestPlaceId;
}

function lb_get_server_ip() {
    $envIp = getenv('PUBLIC_HOST') ?: getenv('RENDER_EXTERNAL_HOSTNAME');
    if ($envIp !== false && trim((string) $envIp) !== '') {
        return trim((string) $envIp);
    }
    $settingsRoot = lb_settings_root();
    $ip = @file_get_contents($settingsRoot . '/ip.txt');
    return ($ip !== false && trim($ip) !== '') ? trim($ip) : '0.0.0.0';
}

function lb_get_host_port() {
    $envPort = getenv('LUCKYBLOX_GAME_PORT') ?: getenv('GAME_PORT');
    if ($envPort !== false && trim((string) $envPort) !== '') {
        return trim((string) $envPort);
    }
    $settingsRoot = lb_settings_root();
    $port = @file_get_contents($settingsRoot . '/HostPort.txt');
    return ($port !== false && trim($port) !== '') ? trim($port) : '53640';
}

function lb_get_client_port() {
    $settingsRoot = lb_settings_root();
    $port = @file_get_contents($settingsRoot . '/clientport.txt');
    return ($port !== false && trim($port) !== '') ? trim($port) : '53640';
}

function lb_is_owner($user) {
    if (!$user) {
        return false;
    }
    $ownerId = getenv('LUCKYBLOX_OWNER_ID') ?: '1';
    $ownerName = strtolower(getenv('LUCKYBLOX_OWNER_USERNAME') ?: 'tailsthehero10');
    $idMatch = (string) ($user['userId'] ?? '') === (string) $ownerId;
    $nameMatch = strtolower((string) ($user['username'] ?? '')) === $ownerName;
    return $idMatch || $nameMatch;
}

function lb_is_admin($user) {
    if (!$user) {
        return false;
    }
    if (lb_is_owner($user)) {
        return true;
    }
    return (bool) ($user['admin'] ?? $user['isAdmin'] ?? false);
}

function lb_default_body_colors_for_gender($gender) {
    $nougat = 18;
    $buttermilk = 341;
    $lightStoneGrey = 208;

    if ($gender === 'Male') {
        $skin = $nougat;
        $shirtColor = 327;
        $pantsColor = 303;
    } elseif ($gender === 'Female') {
        $skin = $buttermilk;
        $shirtColor = 330;
        $pantsColor = 327;
    } else {
        $skin = $buttermilk;
        $shirtColor = 328;
        $pantsColor = 305;
    }

    return array(
        'headColorId' => $skin,
        'torsoColorId' => $skin,
        'rightArmColorId' => $skin,
        'leftArmColorId' => $skin,
        'rightLegColorId' => $pantsColor,
        'leftLegColorId' => $pantsColor,
    );
}

function lb_body_color_palette() {
    return array(
        array('id' => 1,    'name' => 'White',                   'rgb' => '242,243,243'),
        array('id' => 2,    'name' => 'Grey',                     'rgb' => '161,165,162'),
        array('id' => 18,   'name' => 'Nougat',                   'rgb' => '204,142,105'),
        array('id' => 21,   'name' => 'Bright Red',               'rgb' => '196,40,28'),
        array('id' => 23,   'name' => 'Bright Blue',              'rgb' => '13,105,172'),
        array('id' => 24,   'name' => 'Bright Yellow',            'rgb' => '245,205,48'),
        array('id' => 26,   'name' => 'Black',                    'rgb' => '27,42,53'),
        array('id' => 28,   'name' => 'Dark Green',               'rgb' => '40,127,71'),
        array('id' => 29,   'name' => 'Medium Green',             'rgb' => '161,196,140'),
        array('id' => 37,   'name' => 'Bright Green',             'rgb' => '75,151,75'),
        array('id' => 100,  'name' => 'Light Red',                'rgb' => '238,196,182'),
        array('id' => 101,  'name' => 'Medium Red',               'rgb' => '218,134,122'),
        array('id' => 102,  'name' => 'Medium Blue',              'rgb' => '110,153,202'),
        array('id' => 104,  'name' => 'Bright Violet',            'rgb' => '107,50,124'),
        array('id' => 105,  'name' => 'Br. Yellowish Orange',     'rgb' => '226,155,64'),
        array('id' => 106,  'name' => 'Bright Orange',            'rgb' => '218,133,65'),
        array('id' => 107,  'name' => 'Bright Bluish Green',      'rgb' => '0,143,156'),
        array('id' => 110,  'name' => 'Bright Bluish Violet',     'rgb' => '67,84,147'),
        array('id' => 125,  'name' => 'Light Orange',             'rgb' => '234,184,146'),
        array('id' => 127,  'name' => 'Gold',                    'rgb' => '220,188,129'),
        array('id' => 128,  'name' => 'Dark Nougat',              'rgb' => '174,122,89'),
        array('id' => 131,  'name' => 'Silver',                  'rgb' => '156,163,168'),
        array('id' => 135,  'name' => 'Sand Blue',               'rgb' => '116,134,157'),
        array('id' => 136,  'name' => 'Sand Violet',             'rgb' => '135,124,144'),
        array('id' => 137,  'name' => 'Medium Orange',           'rgb' => '224,152,100'),
        array('id' => 140,  'name' => 'Earth Blue',              'rgb' => '32,58,86'),
        array('id' => 141,  'name' => 'Earth Green',             'rgb' => '39,70,45'),
        array('id' => 151,  'name' => 'Sand Green',              'rgb' => '120,144,130'),
        array('id' => 153,  'name' => 'Sand Red',                'rgb' => '149,121,119'),
        array('id' => 154,  'name' => 'Dark Red',                'rgb' => '123,46,47'),
        array('id' => 168,  'name' => 'Gun Metallic',            'rgb' => '117,108,98'),
        array('id' => 176,  'name' => 'Red Flip/Flop',           'rgb' => '151,105,91'),
        array('id' => 180,  'name' => 'Curry',                   'rgb' => '215,169,75'),
        array('id' => 190,  'name' => 'Fire Yellow',             'rgb' => '249,214,46'),
        array('id' => 192,  'name' => 'Reddish Brown',           'rgb' => '105,64,40'),
        array('id' => 193,  'name' => 'Flame Reddish Orange',    'rgb' => '207,96,36'),
        array('id' => 194,  'name' => 'Medium Stone Grey',       'rgb' => '163,162,165'),
        array('id' => 195,  'name' => 'Royal Blue',              'rgb' => '70,103,164'),
        array('id' => 196,  'name' => 'Dark Royal Blue',         'rgb' => '35,71,139'),
        array('id' => 198,  'name' => 'Bright Reddish Lilac',    'rgb' => '142,66,133'),
        array('id' => 199,  'name' => 'Dark Stone Grey',         'rgb' => '99,95,98'),
        array('id' => 200,  'name' => 'Lemon',                   'rgb' => '130,138,93'),
        array('id' => 208,  'name' => 'Light Stone Grey',       'rgb' => '229,228,223'),
        array('id' => 209,  'name' => 'Dark Curry',              'rgb' => '176,142,68'),
        array('id' => 210,  'name' => 'Faded Green',             'rgb' => '112,149,120'),
        array('id' => 211,  'name' => 'Turquoise',               'rgb' => '121,181,181'),
        array('id' => 212,  'name' => 'Light Royal Blue',       'rgb' => '159,195,233'),
        array('id' => 213,  'name' => 'Medium Royal Blue',      'rgb' => '108,129,183'),
        array('id' => 216,  'name' => 'Rust',                    'rgb' => '144,76,42'),
        array('id' => 217,  'name' => 'Brown',                   'rgb' => '124,92,70'),
        array('id' => 218,  'name' => 'Reddish Lilac',           'rgb' => '150,112,159'),
        array('id' => 219,  'name' => 'Lilac',                   'rgb' => '107,98,155'),
        array('id' => 220,  'name' => 'Light Lilac',            'rgb' => '167,169,206'),
        array('id' => 221,  'name' => 'Bright Purple',          'rgb' => '205,98,152'),
        array('id' => 222,  'name' => 'Light Purple',           'rgb' => '228,173,200'),
        array('id' => 223,  'name' => 'Light Pink',             'rgb' => '220,144,149'),
        array('id' => 224,  'name' => 'Light Brick Yellow',     'rgb' => '240,213,160'),
        array('id' => 225,  'name' => 'Warm Yellowish Orange',   'rgb' => '235,184,127'),
        array('id' => 226,  'name' => 'Cool Yellow',            'rgb' => '253,234,141'),
        array('id' => 232,  'name' => 'Dove Blue',               'rgb' => '125,187,221'),
        array('id' => 268,  'name' => 'Medium Lilac',           'rgb' => '52,43,117'),
        array('id' => 301,  'name' => 'Slime Green',             'rgb' => '80,109,84'),
        array('id' => 302,  'name' => 'Smoky Grey',              'rgb' => '91,93,105'),
        array('id' => 303,  'name' => 'Dark Blue',               'rgb' => '0,16,176'),
        array('id' => 304,  'name' => 'Parsley Green',           'rgb' => '44,101,29'),
        array('id' => 305,  'name' => 'Steel Blue',              'rgb' => '82,124,174'),
        array('id' => 306,  'name' => 'Storm Blue',              'rgb' => '51,88,130'),
        array('id' => 307,  'name' => 'Lapis',                   'rgb' => '16,42,220'),
        array('id' => 308,  'name' => 'Dark Indigo',             'rgb' => '61,21,133'),
        array('id' => 309,  'name' => 'Sea Green',               'rgb' => '52,142,64'),
        array('id' => 310,  'name' => 'Shamrock',                'rgb' => '91,154,76'),
        array('id' => 311,  'name' => 'Fossil',                  'rgb' => '159,161,172'),
        array('id' => 312,  'name' => 'Mulberry',                'rgb' => '89,34,89'),
        array('id' => 313,  'name' => 'Forest Green',            'rgb' => '31,128,29'),
        array('id' => 314,  'name' => 'Cadet Blue',              'rgb' => '159,173,192'),
        array('id' => 315,  'name' => 'Electric Blue',           'rgb' => '9,137,207'),
        array('id' => 316,  'name' => 'Eggplant',                'rgb' => '123,0,123'),
        array('id' => 317,  'name' => 'Moss',                    'rgb' => '124,156,107'),
        array('id' => 318,  'name' => 'Artichoke',               'rgb' => '138,171,133'),
        array('id' => 319,  'name' => 'Sage Green',              'rgb' => '185,196,177'),
        array('id' => 320,  'name' => 'Ghost Grey',              'rgb' => '202,203,209'),
        array('id' => 321,  'name' => 'Lilac',                   'rgb' => '167,94,155'),
        array('id' => 322,  'name' => 'Plum',                    'rgb' => '123,47,123'),
        array('id' => 323,  'name' => 'Olivine',                 'rgb' => '148,190,129'),
        array('id' => 324,  'name' => 'Laurel Green',            'rgb' => '168,189,153'),
        array('id' => 325,  'name' => 'Quill Grey',              'rgb' => '223,223,222'),
        array('id' => 327,  'name' => 'Crimson',                 'rgb' => '151,0,0'),
        array('id' => 328,  'name' => 'Mint',                    'rgb' => '177,229,166'),
        array('id' => 329,  'name' => 'Baby Blue',               'rgb' => '152,194,219'),
        array('id' => 330,  'name' => 'Carnation Pink',          'rgb' => '255,152,220'),
        array('id' => 331,  'name' => 'Persimmon',               'rgb' => '255,89,89'),
        array('id' => 332,  'name' => 'Maroon',                  'rgb' => '117,0,0'),
        array('id' => 333,  'name' => 'Gold',                    'rgb' => '239,184,56'),
        array('id' => 334,  'name' => 'Daisy Orange',            'rgb' => '248,217,109'),
        array('id' => 335,  'name' => 'Pearl',                   'rgb' => '231,231,236'),
        array('id' => 336,  'name' => 'Fog',                     'rgb' => '199,212,228'),
        array('id' => 337,  'name' => 'Salmon',                  'rgb' => '255,148,148'),
        array('id' => 338,  'name' => 'Terra Cotta',             'rgb' => '190,104,98'),
        array('id' => 339,  'name' => 'Cocoa',                   'rgb' => '86,36,36'),
        array('id' => 340,  'name' => 'Wheat',                   'rgb' => '241,231,199'),
        array('id' => 341,  'name' => 'Buttermilk',              'rgb' => '254,243,187'),
        array('id' => 342,  'name' => 'Mauve',                   'rgb' => '224,178,208'),
        array('id' => 343,  'name' => 'Sunrise',                 'rgb' => '212,144,189'),
        array('id' => 344,  'name' => 'Tawny',                   'rgb' => '150,85,85'),
        array('id' => 345,  'name' => 'Rust',                    'rgb' => '143,76,42'),
        array('id' => 346,  'name' => 'Cashmere',                'rgb' => '211,190,150'),
        array('id' => 347,  'name' => 'Khaki',                   'rgb' => '226,220,188'),
        array('id' => 348,  'name' => 'Lily White',              'rgb' => '237,234,234'),
        array('id' => 349,  'name' => 'Seashell',                'rgb' => '233,218,218'),
        array('id' => 350,  'name' => 'Burgundy',                'rgb' => '136,62,62'),
        array('id' => 351,  'name' => 'Cork',                    'rgb' => '188,155,93'),
        array('id' => 352,  'name' => 'Burlap',                  'rgb' => '199,172,120'),
        array('id' => 353,  'name' => 'Beige',                   'rgb' => '202,191,163'),
        array('id' => 354,  'name' => 'Oyster',                  'rgb' => '187,179,178'),
        array('id' => 355,  'name' => 'Pine Cone',               'rgb' => '108,88,75'),
        array('id' => 356,  'name' => 'Fawn Brown',              'rgb' => '160,132,79'),
        array('id' => 357,  'name' => 'Hurricane Grey',         'rgb' => '149,137,136'),
        array('id' => 358,  'name' => 'Cloudy Grey',             'rgb' => '171,168,158'),
        array('id' => 359,  'name' => 'Linen',                   'rgb' => '175,148,131'),
        array('id' => 360,  'name' => 'Copper',                  'rgb' => '150,103,102'),
        array('id' => 361,  'name' => 'Medium Brown',            'rgb' => '86,66,54'),
        array('id' => 362,  'name' => 'Bronze',                  'rgb' => '126,104,63'),
        array('id' => 363,  'name' => 'Flint',                   'rgb' => '105,102,92'),
        array('id' => 364,  'name' => 'Dark Taupe',              'rgb' => '90,76,66'),
        array('id' => 365,  'name' => 'Burnt Sienna',            'rgb' => '106,57,9'),
        array('id' => 1001,'name' => 'Institutional White',     'rgb' => '248,248,248'),
        array('id' => 1002,'name' => 'Mid Gray',                 'rgb' => '205,205,205'),
        array('id' => 1003,'name' => 'Really Black',             'rgb' => '17,17,17'),
        array('id' => 1004,'name' => 'Really Red',               'rgb' => '255,0,0'),
        array('id' => 1005,'name' => 'Deep Orange',              'rgb' => '255,176,0'),
        array('id' => 1006,'name' => 'Alder',                    'rgb' => '180,128,255'),
        array('id' => 1007,'name' => 'Dusty Rose',               'rgb' => '163,75,75'),
        array('id' => 1008,'name' => 'Olive',                    'rgb' => '193,190,66'),
        array('id' => 1009,'name' => 'New Yeller',               'rgb' => '255,255,0'),
        array('id' => 1010,'name' => 'Really Blue',              'rgb' => '0,0,255'),
        array('id' => 1011,'name' => 'Navy Blue',                'rgb' => '0,32,96'),
        array('id' => 1012,'name' => 'Deep Blue',                'rgb' => '33,84,185'),
        array('id' => 1013,'name' => 'Cyan',                     'rgb' => '4,175,236'),
        array('id' => 1014,'name' => 'CGA Brown',                'rgb' => '170,85,0'),
        array('id' => 1015,'name' => 'Magenta',                  'rgb' => '170,0,170'),
        array('id' => 1016,'name' => 'Pink',                     'rgb' => '255,102,204'),
        array('id' => 1017,'name' => 'Deep Orange',              'rgb' => '255,175,0'),
        array('id' => 1018,'name' => 'Teal',                     'rgb' => '18,238,212'),
        array('id' => 1019,'name' => 'Toothpaste',               'rgb' => '0,255,255'),
        array('id' => 1020,'name' => 'Lime Green',               'rgb' => '0,255,0'),
        array('id' => 1021,'name' => 'Camo',                     'rgb' => '58,125,21'),
        array('id' => 1022,'name' => 'Grime',                    'rgb' => '127,142,100'),
        array('id' => 1023,'name' => 'Lavender',                 'rgb' => '140,91,159'),
        array('id' => 1024,'name' => 'Pastel Light Blue',        'rgb' => '175,221,255'),
        array('id' => 1025,'name' => 'Pastel Orange',            'rgb' => '255,201,201'),
        array('id' => 1026,'name' => 'Pastel Violet',            'rgb' => '177,167,255'),
        array('id' => 1027,'name' => 'Pastel Blue-Green',       'rgb' => '159,243,233'),
        array('id' => 1028,'name' => 'Pastel Green',             'rgb' => '204,255,204'),
        array('id' => 1029,'name' => 'Pastel Yellow',            'rgb' => '255,255,204'),
        array('id' => 1030,'name' => 'Pastel Brown',             'rgb' => '255,204,153'),
        array('id' => 1031,'name' => 'Royal Purple',             'rgb' => '98,37,209'),
        array('id' => 1032,'name' => 'Hot Pink',                 'rgb' => '255,0,191'),
    );
}

function lb_body_color_rgb($colorId) {
    $id = (int) $colorId;
    $palette = lb_body_color_palette();
    foreach ($palette as $entry) {
        if ($entry['id'] === $id) {
            return $entry['rgb'];
        }
    }
    return '205,205,205';
}

function lb_body_color_name($colorId) {
    $id = (int) $colorId;
    $palette = lb_body_color_palette();
    foreach ($palette as $entry) {
        if ($entry['id'] === $id) {
            return $entry['name'];
        }
    }
    return 'Unknown';
}

function lb_get_avatar_urls($user) {
    $robloxUserId = $user['robloxUserId'] ?? null;
    if (!$robloxUserId) {
        return array('headshotUrl' => null, 'fullBodyUrl' => null);
    }
    $userId = (int) $robloxUserId;
    if ($userId <= 0) {
        return array('headshotUrl' => null, 'fullBodyUrl' => null);
    }
    $headshot = 'https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=' . $userId . '&size=150x150&format=Png&isCircular=false';
    $fullBody = 'https://thumbnails.roblox.com/v1/users/avatar?userIds=' . $userId . '&size=420x420&format=Png';
    return array(
        'headshotUrl' => $headshot,
        'fullBodyUrl' => $fullBody,
    );
}

function lb_get_user_assets($user) {
    $assetsDb = lb_get_assets();
    $wearing = is_array($user['currentlyWearing'] ?? null) ? $user['currentlyWearing'] : array();
    $wearingSet = array();
    foreach ($wearing as $id) {
        $wearingSet[(string) $id] = true;
    }
    $result = array();
    foreach ($assetsDb as $entry) {
        $assetId = (string) ($entry['id'] ?? '');
        $thumb = 'https://thumbnails.roblox.com/v1/assets?assetIds=' . $assetId . '&size=150x150&format=Png';
        $result[] = array(
            'id' => $assetId,
            'name' => $entry['name'] ?? 'Asset',
            'assetType' => $entry['assetType'] ?? 'Accessory',
            'thumbnailUrl' => $thumb,
            'price' => (int) ($entry['price'] ?? 0),
            'isOwned' => true,
            'isWearing' => isset($wearingSet[$assetId]),
        );
    }
    return $result;
}

function lb_catalog_items() {
    $catalogFaces = array(
        array('id' => 256186, 'name' => 'Smile', 'assetType' => 'Face'),
        array('id' => 256187, 'name' => 'Oh No', 'assetType' => 'Face'),
        array('id' => 256188, 'name' => 'Sweating', 'assetType' => 'Face'),
        array('id' => 256189, 'name' => 'Laugh', 'assetType' => 'Face'),
        array('id' => 256190, 'name' => 'Eww', 'assetType' => 'Face'),
    );

    $catalogHats = array(
        array('id' => 1003, 'name' => 'Robloxian Cap', 'assetType' => 'Hat', 'price' => 0, 'isOwned' => true),
        array('id' => 10159744, 'name' => 'Classic Hair', 'assetType' => 'Hat', 'price' => 25, 'isOwned' => false),
        array('id' => 7447592, 'name' => 'Party Hat', 'assetType' => 'Hat', 'price' => 50, 'isOwned' => false),
        array('id' => 5431853, 'name' => 'Blue Climber', 'assetType' => 'Hat', 'price' => 75, 'isOwned' => false),
    );

    $catalog = array();
    foreach ($catalogFaces as $face) {
        $id = (string) $face['id'];
        $catalog[] = array(
            'id' => $id,
            'name' => $face['name'],
            'assetType' => $face['assetType'],
            'thumbnailUrl' => 'https://thumbnails.roblox.com/v1/assets?assetIds=' . $face['id'] . '&size=48x48&format=Png',
            'thumbnailLargeUrl' => 'https://thumbnails.roblox.com/v1/assets?assetIds=' . $face['id'] . '&size=150x150&format=Png',
            'price' => 0,
            'isOwned' => true,
        );
    }

    foreach ($catalogHats as $hat) {
        $id = (string) $hat['id'];
        $catalog[] = array(
            'id' => $id,
            'name' => $hat['name'],
            'assetType' => $hat['assetType'],
            'thumbnailUrl' => 'https://thumbnails.roblox.com/v1/assets?assetIds=' . $hat['id'] . '&size=48x48&format=Png',
            'thumbnailLargeUrl' => 'https://thumbnails.roblox.com/v1/assets?assetIds=' . $hat['id'] . '&size=150x150&format=Png',
            'price' => (int) $hat['price'],
            'isOwned' => (bool) $hat['isOwned'],
        );
    }

    return $catalog;
}

function lb_build_avatar_payload($user) {
    $assets = lb_get_assets();
    $wearingSet = array();
    foreach ((array) ($user['currentlyWearing'] ?? array()) as $id) {
        $wearingSet[(string) $id] = true;
    }

    $avatarAssets = array();
    foreach ($assets as $entry) {
        $assetId = (string) ($entry['id'] ?? '');
        if (!isset($wearingSet[$assetId])) {
            continue;
        }
        $avatarAssets[] = array(
            'id' => (int) $entry['id'],
            'name' => $entry['name'] ?? 'Asset',
            'assetType' => array(
                'id' => 1,
                'name' => $entry['assetType'] ?? 'Accessory',
            ),
            'currentVersionId' => (int) ($entry['currentVersionId'] ?? $entry['id'] ?? 0),
            'meta' => array('order' => 1, 'version' => 1),
        );
    }

    if (empty($avatarAssets)) {
        $avatarAssets[] = array(
            'id' => 1001,
            'name' => 'Classic Red Shirt',
            'assetType' => array('id' => 1, 'name' => 'Shirt'),
            'currentVersionId' => 1001,
            'meta' => array('order' => 1, 'version' => 1),
        );
    }

    $assetParams = '';
    foreach ($avatarAssets as $asset) {
        $assetParams .= 'assetId=' . $asset['id'] . '&assetType=' . urlencode($asset['assetType']['name'] ?? 'Accessory') . '&';
    }
    $assetParams = rtrim($assetParams, '&');

    $bodyColors = ($user['avatar']['bodyColors'] ?? null) ?: array(
        'headColorId' => 1002, 'torsoColorId' => 1002,
        'rightArmColorId' => 1002, 'leftArmColorId' => 1002,
        'rightLegColorId' => 1002, 'leftLegColorId' => 1002,
    );

    return array(
        'ok' => true,
        'userId' => (int) ($user['userId'] ?? 1),
        'placeId' => 1818,
        'scales' => $user['avatar']['scales'] ?? array(
            'height' => 1.0, 'width' => 1.0, 'head' => 1.0,
            'depth' => 1.0, 'proportion' => 0.0, 'bodyType' => 0.0,
        ),
        'playerAvatarType' => $user['avatar']['playerAvatarType'] ?? 'R15',
        'bodyColors' => $bodyColors,
        'assets' => $avatarAssets,
        'wearing' => (array) ($user['currentlyWearing'] ?? array()),
        'assetParams' => $assetParams,
        'defaultShirtApplied' => false,
        'defaultPantsApplied' => false,
        'emotes' => array(
            array('assetId' => 3360689775, 'assetName' => 'Salute', 'position' => 1),
            array('assetId' => 3576968026, 'assetName' => 'Shrug', 'position' => 2),
        ),
        'isVerified' => (bool) ($user['isVerified'] ?? false),
        'isAdmin' => lb_is_admin($user),
        'gender' => $user['gender'] ?? 'NotSpecified',
        'robloxUserId' => $user['robloxUserId'] ?? null,
    );
}

function lb_set_avatar_wearing($userId, $assetIds) {
    $users = lb_get_users();
    $key = (string) $userId;
    $found = false;
    foreach ($users as $k => $user) {
        if ((string) ($user['userId'] ?? $user['id'] ?? '') === $key || $k === $key) {
            $users[$k]['currentlyWearing'] = array_values($assetIds);
            $users[$k]['updatedAt'] = date('c');
            if (isset($users[$k]['avatar']) && is_array($users[$k]['avatar'])) {
                $users[$k]['avatar']['currentlyWearing'] = array_values($assetIds);
            }
            $found = true;
            break;
        }
    }
    if ($found) {
        lb_write_json('users.json', $users);
        return true;
    }
    return false;
}

function lb_update_user_avatar_colors($userId, $bodyColors) {
    $users = lb_get_users();
    $key = (string) $userId;
    $found = false;
    foreach ($users as $k => $user) {
        if ((string) ($user['userId'] ?? $user['id'] ?? '') === $key || $k === $key) {
            $users[$k]['avatar']['bodyColors'] = $bodyColors;
            $users[$k]['updatedAt'] = date('c');
            $found = true;
            break;
        }
    }
    if ($found) {
        lb_write_json('users.json', $users);
        return true;
    }
    return false;
}

function lb_update_user_gender($userId, $gender) {
    $allowed = array('Male', 'Female', 'NotSpecified');
    if (!in_array($gender, $allowed, true)) {
        $gender = 'NotSpecified';
    }
    $users = lb_get_users();
    $key = (string) $userId;
    $found = false;
    foreach ($users as $k => $user) {
        if ((string) ($user['userId'] ?? $user['id'] ?? '') === $key || $k === $key) {
            $users[$k]['gender'] = $gender;
            $users[$k]['avatar']['gender'] = $gender;
            $users[$k]['updatedAt'] = date('c');
            $found = true;
            break;
        }
    }
    if ($found) {
        lb_write_json('users.json', $users);
        return true;
    }
    return false;
}

function lb_resolve_game_icon($game) {
    $icon = $game['icon'] ?? '';
    if ($icon !== '' && $icon !== null) {
        return $icon;
    }
    return '/gameplaceholder/Card_512x512/card.png';
}

function lb_resolve_game_feat($game) {
    $icon = $game['icon'] ?? '';
    if ($icon !== '' && $icon !== null) {
        return $icon;
    }
    return '/gameplaceholder/Big_/featured.png';
}
