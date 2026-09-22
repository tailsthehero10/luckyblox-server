<?php
function request_status($status) {
    $protocol = isset($_SERVER['SERVER_PROTOCOL']) ? $_SERVER['SERVER_PROTOCOL'] : 'HTTP/1.1';
    header($protocol . ' ' . $status);
}

function request_parameter($name) {
    return isset($_GET[$name]) ? trim((string) $_GET[$name]) : '';
}

function request_port() {
    $port = filter_var(request_parameter('port'), FILTER_VALIDATE_INT);
    if ($port === false || $port < 1 || $port > 65535) {
        request_status('400 Bad Request');
        die('Invalid port');
    }
    return (string) $port;
}

function request_text($name, $pattern, $message) {
    $value = request_parameter($name);
    if ($value === '' || strlen($value) > 128 || !preg_match($pattern, $value)) {
        request_status('400 Bad Request');
        die($message);
    }
    return $value;
}

function sign($script) {
    $signature;
$key = file_get_contents(dirname(__FILE__) . "/PrivateKey.pem");
openssl_sign($script,$signature,$key,OPENSSL_ALGO_SHA1);
return "--rbxsig".sprintf("%%%s%%%s",base64_encode($signature),$script);
}
?>
