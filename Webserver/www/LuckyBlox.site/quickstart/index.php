<?php
function read_setting($path, $default = '') {
    if (!file_exists($path)) {
        return $default;
    }

    $value = trim((string) file_get_contents($path));
    return $value !== '' ? $value : $default;
}

$rootPath = realpath(__DIR__ . '/../../../../');
$settingsRoot = realpath($rootPath . '/Settings');
$serverAddress = read_setting($settingsRoot . '/ip.txt', '127.0.0.1');
$hostPort = read_setting($settingsRoot . '/HostPort.txt', '53640');
$serverPort = read_setting($settingsRoot . '/serverport.txt', '2005');
$clientPort = read_setting($settingsRoot . '/clientport.txt', '53640');
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/site-icon/luckyblox.ico" sizes="any" />
    <link rel="icon" type="image/png" href="/site-icon/luckyblox.png" />
    <title>Quick Start</title>
    <style>
        body { font-family: Arial, sans-serif; background: #020617; color: #e2e8f0; margin: 0; padding: 40px; }
        .container { max-width: 1000px; margin: 0 auto; }
        .card { background: #111827; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
        h1, h2 { margin-bottom: 10px; }
        ul { margin: 0; padding-left: 18px; }
        li { margin: 8px 0; }
        code { background: rgba(148, 163, 184, 0.12); padding: 2px 6px; border-radius: 4px; }
        a { color: #7dd3fc; }
    </style>
    <link rel="stylesheet" href="/style.css" />
</head>
<body>
    <div class="container">
        <h1>Quick Start Guide</h1>

        <div class="card">
            <h2>1. Open the local launcher site</h2>
            <p>Use <code>http://localhost/LuckBlox.site/</code> as your main local dashboard, then move through the available project pages from the top navigation:</p>
            <ul>
                <li><a href="/LuckBlox.site/">Dashboard</a></li>
                <li><a href="/LuckBlox.site/settings">Settings</a></li>
                <li><a href="/LuckBlox.site/account">Account</a></li>
                <li><a href="/LuckBlox.site/places">Places</a></li>
                <li><a href="/LuckBlox.site/api">API Docs</a></li>
            </ul>
        </div>

        <div class="card">
            <h2>2. Use the configured local settings</h2>
            <ul>
                <li>Server IP: <code><?php echo htmlspecialchars($serverAddress); ?></code></li>
                <li>Host port: <code><?php echo htmlspecialchars($hostPort); ?></code></li>
                <li>Game server port: <code><?php echo htmlspecialchars($serverPort); ?></code></li>
                <li>Client port: <code><?php echo htmlspecialchars($clientPort); ?></code></li>
            </ul>
        </div>

        <div class="card">
            <h2>3. Save and load data</h2>
            <ul>
                <li><a href="/api/save.php?placeid=1818">Save data</a></li>
                <li><a href="/api/load.php?placeid=1818">Load data</a></li>
                <li><a href="/api/places.php?placeid=1818">View place metadata</a></li>
            </ul>
        </div>

        <div class="card">
            <h2>4. Publish a place</h2>
            <p>Use the publish endpoint to store place metadata locally:</p>
            <ul>
                <li><a href="/api/publish.php?placeid=1818">Publish place</a></li>
            </ul>
        </div>

        <div class="card">
            <h2>5. Studio compatibility</h2>
            <p>Use the Studio-compatible load-place-info endpoint:</p>
            <ul>
                <li><a href="/game/load-place-info/index.php?placeid=1818">Load place info</a></li>
            </ul>
        </div>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
