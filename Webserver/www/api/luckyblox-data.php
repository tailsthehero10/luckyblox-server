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

function lb_signup($username, $password, $confirmPassword, $displayName = null) {
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
    $user = array(
        'userId' => (string) $nextId,
        'username' => $username,
        'displayName' => $displayName ?: $username,
        'password' => $hashed['hash'],
        'passwordSalt' => $hashed['salt'],
        'passwordVersion' => $hashed['version'],
        'role' => 'player',
        'bio' => 'New LuckyBlox creator account.',
        'joinDate' => date('c'),
        'membershipStatus' => 'None',
        'robux' => 100,
        'currencies' => array('coins' => 250, 'ticket' => 10),
        'inventory' => array('1001', '1002', '1003', '1004'),
        'currentlyWearing' => array('1001', '1002', '1003'),
        'stats' => array('friends' => 0, 'created' => 1, 'plays' => 0, 'followers' => 0, 'badges' => 0, 'gameVisits' => 0),
        'friends' => array(),
        'badges' => array(),
        'avatar' => array(
            'bodyColors' => array(
                'headColorId' => 1002, 'torsoColorId' => 1002,
                'rightArmColorId' => 1002, 'leftArmColorId' => 1002,
                'rightLegColorId' => 1002, 'leftLegColorId' => 1002,
            )
        ),
        'admin' => false,
        'isAdmin' => false,
        'isVerified' => false,
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
