<?php
define('DATASTORE_MAX_KEY_LENGTH', 180);
define('DATASTORE_MAX_VALUE_BYTES', 4194304);

function datastore_status($status) {
    $protocol = isset($_SERVER['SERVER_PROTOCOL']) ? $_SERVER['SERVER_PROTOCOL'] : 'HTTP/1.1';
    header($protocol . ' ' . $status);
}

function datastore_error($status, $message) {
    datastore_status($status);
    header('Content-Type: text/plain; charset=utf-8');
    die($message);
}

function datastore_parameter($name) {
    $input = array();
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $raw = file_get_contents('php://input');
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            $input = $decoded;
        }
    }

    if (array_key_exists($name, $input)) {
        return (string) $input[$name];
    }
    return isset($_GET[$name]) ? (string) $_GET[$name] : '';
}

function datastore_key($name) {
    $value = datastore_parameter($name);
    if ($value === '' || strlen($value) > DATASTORE_MAX_KEY_LENGTH ||
        strpos($value, '..') !== false || strpos($value, '/') !== false ||
        strpos($value, '\\') !== false || preg_match('/[\x00-\x1F\x7F]/', $value)) {
        datastore_error(400, 'Invalid datastore key');
    }
    return $value;
}

function datastore_value() {
    $value = datastore_parameter('data');
    if (strlen($value) > DATASTORE_MAX_VALUE_BYTES) {
        datastore_error(413, 'Datastore value is too large');
    }
    return $value;
}

function datastore_path($directory, $key) {
    $base_path = dirname(__FILE__) . '/' . $directory;
    $base = realpath($base_path);
    if ($base === false) {
        if (!mkdir($base_path, 0775, true)) {
            datastore_error(500, 'Datastore directory is unavailable');
        }
        $base = realpath($base_path);
    }
    return $base . DIRECTORY_SEPARATOR . $key;
}

function datastore_json_values($directory) {
    if (!is_dir($directory)) {
        return array();
    }

    $values = array();
    foreach (new DirectoryIterator($directory) as $fileinfo) {
        if (!$fileinfo->isDot() && $fileinfo->isFile()) {
            $value = datastore_read($fileinfo->getPathname());
            $decoded = json_decode($value);
            if ($decoded !== null || trim($value) === 'null') {
                $values[$fileinfo->getFilename()] = $value;
            }
        }
    }
    ksort($values, SORT_STRING);
    return array_values($values);
}

function datastore_write($path, $value) {
    $temporary = tempnam(dirname($path), '.datastore-');
    if ($temporary === false || file_put_contents($temporary, $value, LOCK_EX) === false ||
        !rename($temporary, $path)) {
        if ($temporary !== false && file_exists($temporary)) {
            unlink($temporary);
        }
        datastore_error(503, 'Datastore write failed');
    }
}

function datastore_read($path) {
    if (!is_file($path)) {
        return '';
    }
    $handle = fopen($path, 'rb');
    if ($handle === false) {
        datastore_error(503, 'Datastore read failed');
    }
    flock($handle, LOCK_SH);
    $value = stream_get_contents($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
    return $value === false ? '' : $value;
}

function datastore_response($value) {
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    die($value);
}
?>