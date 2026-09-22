<?php
require_once __DIR__ . '/../../api/common.php';

function read_setting($path, $default = '') {
    if (!file_exists($path)) {
        return $default;
    }

    $value = trim((string) file_get_contents($path));
    return $value !== '' ? $value : $default;
}

$rootPath = realpath(__DIR__ . '/../../../');
$settingsRoot = realpath($rootPath . '/Settings');

$userId = isset($_GET['id']) ? (int) preg_replace('/[^0-9]/', '', (string) $_GET['id']) : 1;
$userId = max(1, $userId);
$username = read_setting($settingsRoot . '/username.txt', 'default');
$membership = read_setting($settingsRoot . '/membership.txt', 'None');
$ip = read_setting($settingsRoot . '/ip.txt', '127.0.0.1');
$featuredPlaceId = api_get_latest_published_place_id();
$featuredMetadata = api_get_place_metadata($featuredPlaceId);
$mapsRoot = realpath($rootPath . '/Maps');
$mapsCount = is_dir($mapsRoot) ? count(array_filter(glob($mapsRoot . '/*'), 'is_file')) : 0;
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>LuckyBlox User Profile</title>
    <style>
        body { margin:0; padding:24px; font-family:Arial, Helvetica, sans-serif; background:#e5e7eb; color:#111827; }
        a { color:#1d4ed8; text-decoration:none; }
        a:hover { text-decoration:underline; }
        .container { max-width:1000px; margin:0 auto; }
        .card { background:#ffffff; border:1px solid #cbd5e1; border-radius:8px; padding:22px; box-shadow:0 1px 2px rgba(0,0,0,0.08); margin-bottom:20px; }
        h1, h2 { margin-top:0; }
        table { width:100%; border-collapse:collapse; }
        th, td { text-align:left; padding:12px; border-bottom:1px solid #e5e7eb; }
        th { color:#1d4ed8; }
        code { background:#f3f4f6; border:1px solid #d1d5db; border-radius:4px; padding:3px 6px; color:#111827; }
    </style>
    <link rel="stylesheet" href="/style.css" />
</head>
<body>
    <div class="container">
        <div class="card">
            <h1>User Profile</h1>
            <table>
                <tbody>
                    <tr><th>User ID</th><td><code><?php echo (int) $userId; ?></code></td></tr>
                    <tr><th>Username</th><td><code><?php echo htmlspecialchars($username); ?></code></td></tr>
                    <tr><th>Membership</th><td><code><?php echo htmlspecialchars($membership); ?></code></td></tr>
                    <tr><th>Server IP</th><td><code><?php echo htmlspecialchars($ip); ?></code></td></tr>
                    <tr><th>Installed maps</th><td><code><?php echo (int) $mapsCount; ?></code></td></tr>
                    <tr><th>Featured game</th><td><code><?php echo htmlspecialchars($featuredMetadata['name']); ?> (Place <?php echo (int) $featuredPlaceId; ?>)</code></td></tr>
                </tbody>
            </table>
        </div>

        <div class="card">
            <h2>Quick links</h2>
            <ul>
                <li><a href="/LuckBlox.site.tk/home">Home</a></li>
                <li><a href="/LuckBlox.site.tk/games">Games</a></li>
                <li><a href="/LuckBlox.site.tk/game?placeid=<?php echo (int) $featuredPlaceId; ?>">Game details</a></li>
                <li><a href="/LuckBlox.site.tk/settings">Settings</a></li>
                <li><a href="/LuckBlox.site.tk/share">Share</a></li>
            </ul>
        </div>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
