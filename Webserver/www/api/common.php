<?php

function api_release_root() {
    return realpath(dirname(__FILE__) . '/../../');
}

function api_settings_root() {
    $root = api_release_root();
    return $root . '/Settings';
}

function api_maps_root() {
    $root = api_release_root();
    return $root . '/Maps';
}

function api_json_response($data, $statusCode = 200) {
    if (!headers_sent()) {
        header('Content-Type: application/json');
    }

    http_response_code($statusCode);
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
}

function api_find_saved_file($placeId, $directory) {
    $directory = rtrim((string) $directory, '/');
    $basePath = $directory . '/' . $placeId;

    foreach (array($basePath . '.json.gz', $basePath . '.json', $basePath . '.gz') as $candidate) {
        if (file_exists($candidate)) {
            return $candidate;
        }
    }

    return $basePath . '.json.gz';
}

function api_read_json_file($path) {
    if (!file_exists($path)) {
        return array();
    }

    $content = file_get_contents($path);
    if ($content === false || trim($content) === '') {
        return array();
    }

    $isCompressed = (substr($content, 0, 2) === "\x1f\x8b") || preg_match('/\.gz$/', $path);
    if ($isCompressed) {
        $decodedContent = @gzdecode($content);
        if ($decodedContent === false) {
            return array();
        }
        $content = $decodedContent;
    }

    $decoded = json_decode($content, true);
    return is_array($decoded) ? $decoded : array();
}

function api_write_json_file($path, $data, $forceCompressed = false) {
    $dir = dirname($path);
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }

    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    $shouldCompress = $forceCompressed || preg_match('/\.gz$/', $path) || preg_match('/\.json\.gz$/', $path);

    if ($shouldCompress) {
        $compressed = @gzencode($json, 9);
        if ($compressed !== false) {
            return file_put_contents($path, $compressed);
        }
    }

    return file_put_contents($path, $json);
}

function api_get_request_body() {
    $body = file_get_contents('php://input');
    if ($body === false) {
        return '';
    }

    return $body;
}

function api_parse_request_payload() {
    $body = api_get_request_body();
    if (trim($body) === '') {
        return array();
    }

    $decoded = json_decode($body, true);
    if (is_array($decoded)) {
        return $decoded;
    }

    return array('raw' => $body);
}

function api_place_id_from_request() {
    foreach (array('placeid', 'placeId', 'id') as $key) {
        if (isset($_GET[$key]) && $_GET[$key] !== '') {
            return preg_replace('/[^0-9]/', '', $_GET[$key]);
        }
    }

    if (isset($_REQUEST['placeid']) && $_REQUEST['placeid'] !== '') {
        return preg_replace('/[^0-9]/', '', $_REQUEST['placeid']);
    }

    return '1818';
}

function api_username_from_request() {
    foreach (array('username', 'user', 'name') as $key) {
        if (isset($_GET[$key]) && $_GET[$key] !== '') {
            return trim($_GET[$key]);
        }
    }

    return 'default';
}

function api_get_setting_value($path, $default = '') {
    if (!file_exists($path)) {
        return $default;
    }

    $value = trim((string) file_get_contents($path));
    return $value !== '' ? $value : $default;
}

function api_get_local_player_state($placeId) {
    $settingsRoot = api_settings_root();
    $account = api_get_current_account();
    $metadata = api_get_place_metadata($placeId);
    $saveFile = api_find_saved_file($placeId, $settingsRoot . '/saves');

    $player = array(
        'name' => $account['username'],
        'displayName' => $account['username'],
        'id' => 1,
        'userId' => 1,
        'membership' => $account['membership'],
        'serverIp' => api_get_setting_value($settingsRoot . '/ip.txt', '127.0.0.1'),
        'hostPort' => api_get_setting_value($settingsRoot . '/HostPort.txt', '53640'),
        'serverPort' => api_get_setting_value($settingsRoot . '/serverport.txt', '2005'),
        'clientPort' => api_get_setting_value($settingsRoot . '/clientport.txt', '53640'),
        'placeId' => (int) $placeId,
        'characterAppearance' => 'local',
        'chatFilterMode' => 'whitelist',
        'canLoad' => true,
        'canSpawn' => true,
        'loadedAt' => date('c'),
    );

    return array(
        'player' => $player,
        'account' => $account,
        'metadata' => $metadata,
        'savedData' => api_read_json_file($saveFile),
    );
}

function api_get_spawn_points($placeId) {
    $settingsRoot = api_settings_root();
    $spawnFile = $settingsRoot . '/spawns/' . $placeId . '.json';

    if (file_exists($spawnFile)) {
        $data = api_read_json_file($spawnFile);
        if (is_array($data) && !empty($data)) {
            return $data;
        }
    }

    return array(
        'placeId' => (int) $placeId,
        'defaultSpawn' => array(
            'name' => 'Spawn',
            'position' => array(0, 5, 0),
            'rotation' => array(0, 0, 0),
        ),
        'spawns' => array(
            array(
                'name' => 'Spawn',
                'position' => array(0, 5, 0),
                'rotation' => array(0, 0, 0),
            ),
        ),
        'updatedAt' => date('c'),
    );
}

function api_get_chat_filter_state($placeId) {
    $settingsRoot = api_settings_root();
    $chatFile = $settingsRoot . '/chat/' . $placeId . '.json';

    if (file_exists($chatFile)) {
        $data = api_read_json_file($chatFile);
        if (is_array($data) && !empty($data)) {
            return $data;
        }
    }

    return array(
        'placeId' => (int) $placeId,
        'enabled' => true,
        'mode' => 'whitelist',
        'allowList' => array(),
        'denyList' => array(),
        'updatedAt' => date('c'),
    );
}

function api_filter_chat_text($text, $chatState) {
    $safeText = (string) $text;
    $blockedWords = array();

    if (isset($chatState['denyList']) && is_array($chatState['denyList'])) {
        foreach ($chatState['denyList'] as $word) {
            if (trim((string) $word) === '') {
                continue;
            }

            $pattern = strtolower((string) $word);
            if (stripos($safeText, $pattern) !== false) {
                $blockedWords[] = $pattern;
                $safeText = preg_replace('/\b' . preg_quote($pattern, '/') . '\b/i', '[filtered]', $safeText);
            }
        }
    }

    return array(
        'originalText' => (string) $text,
        'safeText' => $safeText,
        'blockedWords' => $blockedWords,
        'filtered' => !empty($blockedWords),
    );
}

function api_get_text_state($placeId) {
    $settingsRoot = api_settings_root();
    $textFile = $settingsRoot . '/text/' . $placeId . '.json';

    if (file_exists($textFile)) {
        $data = api_read_json_file($textFile);
        if (is_array($data) && !empty($data)) {
            return $data;
        }
    }

    return array(
        'placeId' => (int) $placeId,
        'messages' => array(),
        'updatedAt' => date('c'),
    );
}

function api_get_current_account() {
    $settingsRoot = api_settings_root();
    $username = 'default';
    $membership = 'None';

    if (file_exists($settingsRoot . '/username.txt')) {
        $username = trim(file_get_contents($settingsRoot . '/username.txt'));
    }

    if (file_exists($settingsRoot . '/membership.txt')) {
        $membership = trim(file_get_contents($settingsRoot . '/membership.txt'));
    }

    return array(
        'username' => $username,
        'membership' => $membership,
        'id' => 1,
        'studioAccess' => true,
        'createdAt' => date('c'),
        'updatedAt' => date('c'),
    );
}

function api_get_derived_place_path($placeId) {
    $mapsRoot = api_maps_root();
    $settingsRoot = api_settings_root();
    $placeFile = $mapsRoot . '/' . $placeId . '.rbxl';

    if (file_exists($placeFile)) {
        return $placeFile;
    }

    if (file_exists($settingsRoot . '/MapPath.txt')) {
        $defaultMap = trim(file_get_contents($settingsRoot . '/MapPath.txt'));
        if ($defaultMap !== '') {
            return $defaultMap;
        }
    }

    return $mapsRoot . '/' . $placeId . '.rbxl';
}

function api_get_place_stats_path($placeId) {
    $settingsRoot = api_settings_root();
    return $settingsRoot . '/stats/' . $placeId . '.json';
}

function api_get_place_stats($placeId) {
    $statsPath = api_get_place_stats_path($placeId);
    $stats = api_read_json_file($statsPath);

    if (!is_array($stats)) {
        $stats = array();
    }

    $defaults = array(
        'visits' => 0,
        'loads' => 0,
        'saves' => 0,
        'publishes' => 0,
        'lastVisitedAt' => null,
        'lastLoadedAt' => null,
        'lastSavedAt' => null,
        'lastPublishedAt' => null,
    );

    return array_merge($defaults, $stats);
}

function api_track_place_stat($placeId, $statKey, $timestamp = null) {
    $statsPath = api_get_place_stats_path($placeId);
    $stats = api_get_place_stats($placeId);

    if ($statKey === 'visit') {
        $stats['visits'] = (int) $stats['visits'] + 1;
        $stats['lastVisitedAt'] = $timestamp !== null ? $timestamp : date('c');
    }

    if ($statKey === 'load') {
        $stats['loads'] = (int) $stats['loads'] + 1;
        $stats['lastLoadedAt'] = $timestamp !== null ? $timestamp : date('c');
    }

    if ($statKey === 'save') {
        $stats['saves'] = (int) $stats['saves'] + 1;
        $stats['lastSavedAt'] = $timestamp !== null ? $timestamp : date('c');
    }

    if ($statKey === 'publish') {
        $stats['publishes'] = (int) $stats['publishes'] + 1;
        $stats['lastPublishedAt'] = $timestamp !== null ? $timestamp : date('c');
    }

    $dir = dirname($statsPath);
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }

    api_write_json_file($statsPath, $stats);
}

function api_get_latest_published_place_id() {
    $settingsRoot = api_settings_root();
    $publishedDir = $settingsRoot . '/published';

    if (!is_dir($publishedDir)) {
        return '1818';
    }

    $files = glob($publishedDir . '/*.json');
    if ($files === false || count($files) === 0) {
        return '1818';
    }

    $latestPlaceId = '1818';
    $latestTimestamp = 0;

    foreach ($files as $file) {
        $baseName = basename($file, '.json');
        if (!ctype_digit((string) $baseName)) {
            continue;
        }

        $data = api_read_json_file($file);
        $timestamp = null;

        if (isset($data['publishedAt']) && trim((string) $data['publishedAt']) !== '') {
            $parsedTimestamp = strtotime((string) $data['publishedAt']);
            if ($parsedTimestamp !== false) {
                $timestamp = $parsedTimestamp;
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

function api_get_place_metadata($placeId) {
    $settingsRoot = api_settings_root();
    $metaFile = $settingsRoot . '/places/' . $placeId . '.json';
    $publishedFile = $settingsRoot . '/published/' . $placeId . '.json';
    $metadata = api_read_json_file($metaFile);
    $published = api_read_json_file($publishedFile);
    $stats = api_get_place_stats($placeId);

    $createdAt = isset($metadata['createdAt']) && trim((string) $metadata['createdAt']) !== ''
        ? (string) $metadata['createdAt']
        : date('c');
    $updatedAt = isset($metadata['updatedAt']) && trim((string) $metadata['updatedAt']) !== ''
        ? (string) $metadata['updatedAt']
        : $createdAt;

    $publishedAt = isset($published['publishedAt']) && trim((string) $published['publishedAt']) !== ''
        ? (string) $published['publishedAt']
        : (isset($metadata['publishedAt']) ? (string) $metadata['publishedAt'] : null);

    $placeVersion = isset($metadata['placeVersion']) ? (int) $metadata['placeVersion'] : 1;
    if ($published && isset($published['placeVersion'])) {
        $placeVersion = (int) $published['placeVersion'];
    }

    $mapFile = api_get_derived_place_path($placeId);
    $mapExists = file_exists($mapFile);

    $placeInfo = array(
        'placeId' => (int) $placeId,
        'universeId' => isset($metadata['universeId']) ? (int) $metadata['universeId'] : (isset($published['universeId']) ? (int) $published['universeId'] : 13058),
        'gameId' => isset($metadata['gameId']) ? $metadata['gameId'] : (isset($published['gameId']) ? $published['gameId'] : 'Test'),
        'creatorId' => isset($metadata['creatorId']) ? (int) $metadata['creatorId'] : 1,
        'creatorType' => isset($metadata['creatorType']) ? $metadata['creatorType'] : 'User',
        'name' => isset($metadata['name']) ? $metadata['name'] : 'Local Place ' . $placeId,
        'description' => isset($metadata['description']) ? $metadata['description'] : '',
        'placeVersion' => $placeVersion,
        'version' => $placeVersion,
        'published' => !empty($published),
        'publishedAt' => $publishedAt,
        'isRobloxPlace' => true,
        'isStudioAccessToApisAllowed' => true,
        'privacyType' => isset($metadata['privacyType']) ? $metadata['privacyType'] : 'Public',
        'playableDevices' => array('Computer', 'Phone', 'Tablet'),
        'mapFile' => $mapFile,
        'mapExists' => $mapExists,
        'fileSize' => $mapExists ? filesize($mapFile) : 0,
        'createdAt' => $createdAt,
        'updatedAt' => $updatedAt,
        'lastVisitedAt' => $stats['lastVisitedAt'],
        'visits' => (int) $stats['visits'],
        'stats' => array(
            'visits' => (int) $stats['visits'],
            'loads' => (int) $stats['loads'],
            'saves' => (int) $stats['saves'],
            'publishes' => (int) $stats['publishes'],
            'lastVisitedAt' => $stats['lastVisitedAt'],
            'lastLoadedAt' => $stats['lastLoadedAt'],
            'lastSavedAt' => $stats['lastSavedAt'],
            'lastPublishedAt' => $stats['lastPublishedAt'],
        ),
        'publishedInfo' => $published,
    );

    if (isset($metadata['owner']) && is_string($metadata['owner'])) {
        $placeInfo['owner'] = $metadata['owner'];
    }

    if (isset($metadata['tags']) && is_array($metadata['tags'])) {
        $placeInfo['tags'] = $metadata['tags'];
    }

    $placeInfo['createdAt'] = $createdAt;
    $placeInfo['updatedAt'] = $updatedAt;
    $placeInfo['publishedAt'] = $publishedAt;

    api_track_place_stat($placeId, 'visit');

    return $placeInfo;
}
