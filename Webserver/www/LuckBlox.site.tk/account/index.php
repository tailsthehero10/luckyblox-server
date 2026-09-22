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

$username = read_setting($settingsRoot . '/username.txt', 'default');
$membership = read_setting($settingsRoot . '/membership.txt', 'None');
$ip = read_setting($settingsRoot . '/ip.txt', '127.0.0.1');
$saveDir = $settingsRoot . '/saves';
$saveCount = is_dir($saveDir) ? count(glob($saveDir . '/*.json')) : 0;
$placesDir = $settingsRoot . '/places';
$placesCount = is_dir($placesDir) ? count(glob($placesDir . '/*.json')) : 0;
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>Account Overview</title>
    <style>
        body { font-family: Arial, sans-serif; background: #020617; color: #e2e8f0; margin: 0; padding: 40px; }
        .container { max-width: 1000px; margin: 0 auto; }
        .card { background: #111827; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
        h1, h2 { margin-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #334155; }
        th { color: #93c5fd; }
        code { background: rgba(148, 163, 184, 0.12); padding: 2px 6px; border-radius: 4px; }
        a { color: #7dd3fc; }
    </style>
    <link rel="stylesheet" href="/style.css" />
</head>
<body>
    <div class="container">
        <h1>Account Overview</h1>

        <div class="card">
            <h2>Current account data</h2>
            <table>
                <tbody>
                    <tr><th>Username</th><td><code><?php echo htmlspecialchars($username); ?></code></td></tr>
                    <tr><th>Membership</th><td><code><?php echo htmlspecialchars($membership); ?></code></td></tr>
                    <tr><th>Server IP</th><td><code><?php echo htmlspecialchars($ip); ?></code></td></tr>
                    <tr><th>Saved place states</th><td><code><?php echo intval($saveCount); ?></code></td></tr>
                    <tr><th>Saved place metadata</th><td><code><?php echo intval($placesCount); ?></code></td></tr>
                </tbody>
            </table>
        </div>

        <p><a href="/LuckBlox.site.tk/">Back to dashboard</a></p>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
