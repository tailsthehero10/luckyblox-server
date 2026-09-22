<?php
function read_setting($path, $default = '') {
    if (!file_exists($path)) {
        return $default;
    }

    $value = trim((string) file_get_contents($path));
    return $value !== '' ? $value : $default;
}

$rootPath = realpath(__DIR__ . '/../../');
$settingsRoot = realpath($rootPath . '/Settings');
$mapsRoot = realpath($rootPath . '/Maps');

$baseUrl = 'http://localhost/LuckBlox.site.tk/';
$username = read_setting($settingsRoot . '/username.txt', 'default');
$membership = read_setting($settingsRoot . '/membership.txt', 'None');
$ip = read_setting($settingsRoot . '/ip.txt', '127.0.0.1');
$hostPort = read_setting($settingsRoot . '/HostPort.txt', '53640');
$serverPort = read_setting($settingsRoot . '/serverport.txt', '2005');
$clientPort = read_setting($settingsRoot . '/clientport.txt', '53640');
$mapPath = read_setting($settingsRoot . '/MapPath.txt', '');

$maps = array();
if (is_dir($mapsRoot)) {
    $maps = glob($mapsRoot . '/*');
}

$mapCount = count($maps);
$apiLinks = array(
    '/api/index.php' => 'API index',
    '/api/account.php' => 'Account data',
    '/api/load.php?placeid=1818' => 'Load saved state',
    '/api/save.php?placeid=1818' => 'Save state',
    '/api/places.php?placeid=1818' => 'Place metadata',
    '/api/publish.php?placeid=1818' => 'Publish place',
    '/game/load-place-info/index.php?placeid=1818' => 'Studio load-place-info',
    '/LuckBlox.site.tk/' => 'Launcher site dashboard',
    '/LuckBlox.site.tk/quickstart' => 'Quick start guide',
    '/LuckBlox.site.tk/settings' => 'Settings overview',
);
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>LuckyBlox Launcher</title>
    <style>
        body { font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 32px; }
        .container { max-width: 1100px; margin: 0 auto; }
        h1, h2 { margin-bottom: 12px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; margin-top: 24px; }
        .card { background: #111827; border: 1px solid #334155; border-radius: 12px; padding: 20px; box-shadow: 0 10px 20px rgba(0,0,0,0.2); }
        .label { color: #93c5fd; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; }
        .value { font-size: 1.1rem; margin-top: 6px; font-weight: bold; }
        ul { margin: 0; padding-left: 18px; }
        li { margin: 8px 0; }
        a { color: #7dd3fc; text-decoration: none; }
        a:hover { text-decoration: underline; }
        code { background: rgba(148, 163, 184, 0.12); padding: 2px 6px; border-radius: 4px; }
    </style>
    <link rel="stylesheet" href="/style.css" />
</head>
<body>
    <div class="container">
        <h1>LuckyBlox Launcher</h1>
        <p>Local web project is running successfully.</p>

        <div class="grid">
            <div class="card">
                <div class="label">Base URL</div>
                <div class="value"><code><?php echo htmlspecialchars($baseUrl); ?></code></div>
            </div>
            <div class="card">
                <div class="label">Account</div>
                <div class="value"><?php echo htmlspecialchars($username); ?></div>
                <div class="value" style="font-size:0.9rem; margin-top:6px; color:#cbd5e1;">Membership: <?php echo htmlspecialchars($membership); ?></div>
            </div>
            <div class="card">
                <div class="label">Maps</div>
                <div class="value"><?php echo intval($mapCount); ?> available</div>
            </div>
            <div class="card">
                <div class="label">Server Ports</div>
                <div class="value">Host: <?php echo htmlspecialchars($hostPort); ?> | Server: <?php echo htmlspecialchars($serverPort); ?> | Client: <?php echo htmlspecialchars($clientPort); ?></div>
            </div>
        </div>

        <div class="grid">
            <div class="card">
                <h2>Live server info</h2>
                <ul>
                    <li><strong>IP:</strong> <?php echo htmlspecialchars($ip); ?></li>
                    <li><strong>Local map path:</strong> <?php echo htmlspecialchars($mapPath !== '' ? $mapPath : 'Not configured'); ?></li>
                    <li><strong>Web root:</strong> <?php echo htmlspecialchars($rootPath); ?></li>
                </ul>
            </div>

            <div class="card">
                <h2>API quick links</h2>
                <ul>
                    <?php foreach ($apiLinks as $url => $label): ?>
                        <li><a href="<?php echo htmlspecialchars($url); ?>"><?php echo htmlspecialchars($label); ?></a></li>
                    <?php endforeach; ?>
                </ul>
            </div>
        </div>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
