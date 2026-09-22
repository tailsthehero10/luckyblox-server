<?php
require_once __DIR__ . '/common.php';

header('Content-Type: application/json');

$releaseRoot = realpath(__DIR__ . '/../../..');
if ($releaseRoot === false) {
    $releaseRoot = realpath(__DIR__ . '/../../');
}

$requestedClient = isset($_GET['client']) ? strtolower(trim((string) $_GET['client'])) : '2021m';
$requestedPlaceId = isset($_GET['placeid']) ? preg_replace('/[^0-9]/', '', (string) $_GET['placeid']) : '';

// Bridge connection details come from the environment. Inside the container the
// bridge is already running on an internal port, so we probe it instead of
// trying to spawn a Windows process. No hardcoded loopback address or port.
$bridgeHost = getenv('LUCKYBLOX_BRIDGE_HOST') ?: '127.0.0.1';
$bridgePort = (int) (getenv('LUCKYBLOX_BRIDGE_PORT') ?: getenv('PORT') ?: 3001);

if ($requestedPlaceId !== '') {
    $bridgeUrl = 'http://' . $bridgeHost . ':' . $bridgePort . '/api/launch-game';
    $bridgeRoot = realpath(__DIR__ . '/../../http-db-bridge');

    $bridgeReady = false;
    $socket = @fsockopen($bridgeHost, $bridgePort, $errorCode, $errorMessage, 0.4);
    if (is_resource($socket)) {
        fclose($socket);
        $bridgeReady = true;
    }

    // Only attempt an auto-spawn on a local desktop run. In the cloud the
    // process manager (Docker/Foreman) owns the bridge lifecycle.
    $isCloud = getenv('PORT') !== false || getenv('RENDER') !== false;
    if (!$bridgeReady && !$isCloud && $bridgeRoot !== false) {
        $nodePath = getenv('NODE_BIN') ?: 'node';
        $serverPath = $bridgeRoot . '/server.js';
        if (stripos(PHP_OS, 'WIN') === 0) {
            $command = 'cmd /c start "" /B "' . $nodePath . '" "' . str_replace('/', '\\', $serverPath) . '" >NUL 2>&1';
        } else {
            $command = escapeshellcmd($nodePath) . ' ' . escapeshellarg($serverPath) . ' > /dev/null 2>&1 &';
        }
        @pclose(@popen($command, 'r'));

        for ($attempt = 0; $attempt < 12; $attempt++) {
            usleep(150000);
            $socket = @fsockopen($bridgeHost, $bridgePort, $errorCode, $errorMessage, 0.4);
            if (is_resource($socket)) {
                fclose($socket);
                $bridgeReady = true;
                break;
            }
        }
    }

    if (!$bridgeReady) {
        api_json_response(array(
            'ok' => false,
            'error' => 'bridge-unavailable',
            'message' => 'The local game bridge could not be started.',
        ), 503);
        exit;
    }

    $payload = json_encode(array(
        'userId' => 1,
        'placeId' => (int) $requestedPlaceId,
    ));
    $context = stream_context_create(array(
        'http' => array(
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\nAccept: application/json\r\n",
            'content' => $payload,
            'timeout' => 15,
            'ignore_errors' => true,
        ),
    ));
    $bridgeResponse = @file_get_contents($bridgeUrl, false, $context);
    $launchPayload = $bridgeResponse !== false ? json_decode($bridgeResponse, true) : null;

    if (!is_array($launchPayload) || empty($launchPayload['ok'])) {
        api_json_response(array(
            'ok' => false,
            'error' => 'launch-failed',
            'message' => is_array($launchPayload) && isset($launchPayload['message']) ? $launchPayload['message'] : 'The dynamic game server did not accept the launch request.',
        ), 502);
        exit;
    }

    if (isset($launchPayload['playUrl']) && is_string($launchPayload['playUrl']) && strpos($launchPayload['playUrl'], 'http') !== 0) {
        $launchPayload['playUrl'] = 'http://' . $bridgeHost . ':' . $bridgePort . $launchPayload['playUrl'];
    }

    if (isset($launchPayload['launchURI']) && is_string($launchPayload['launchURI']) && strpos($launchPayload['launchURI'], 'http') !== 0) {
        $launchPayload['launchURI'] = 'http://' . $bridgeHost . ':' . $bridgePort . $launchPayload['launchURI'];
    }

    api_json_response($launchPayload);
    exit;
}

$clientMap = array(
    '2021m' => $releaseRoot . '/Clients/2021M/RobloxPlayerBeta.exe',
    '2020m' => $releaseRoot . '/Clients/2020M/RobloxPlayerBeta.exe',
    '2019m' => $releaseRoot . '/Clients/2019M/Player/RobloxPlayerBeta.exe',
    '2018m' => $releaseRoot . '/Clients/2018M/Player/RobloxPlayerBeta.exe',
    '2018l' => $releaseRoot . '/Clients/2018L/Player/RobloxPlayerBeta.exe',
    '2018e' => $releaseRoot . '/Clients/2018E/Player/RobloxPlayerBeta.exe',
    '2021e' => $releaseRoot . '/Clients/2021E/RCCService/RobloxPlayerBeta.exe',
);

if (!isset($clientMap[$requestedClient])) {
    api_json_response(array(
        'ok' => false,
        'error' => 'Unsupported client selection.',
        'availableClients' => array_keys($clientMap),
    ), 400);
    exit;
}

$clientPath = file_exists($clientMap[$requestedClient]) ? $clientMap[$requestedClient] : false;
if ($clientPath === false || !file_exists($clientPath)) {
    api_json_response(array(
        'ok' => false,
        'error' => 'Client executable was not found.',
        'requestedClient' => $requestedClient,
        'expectedPath' => $clientMap[$requestedClient],
    ), 404);
    exit;
}

$escapedPath = str_replace('"', '\"', $clientPath);
$command = 'cmd /c start "" "' . $escapedPath . '" --app';
$commandOutput = array();
$exitCode = 0;

@exec($command, $commandOutput, $exitCode);

api_json_response(array(
    'ok' => true,
    'client' => $requestedClient,
    'path' => $clientPath,
    'command' => $command,
    'exitCode' => $exitCode,
    'message' => 'Launch command issued. If the client does not open, make sure the executable exists and the local site is running.',
));
