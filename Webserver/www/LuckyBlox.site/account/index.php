<?php
require_once __DIR__ . '/../../../api/common.php';
require_once __DIR__ . '/../../api/luckyblox-data.php';

session_start();

$c = lb_get_current_user();
if (!$c) {
    $c = lb_find_user_by_id(1);
    if (!$c) {
        $c = array('userId' => '1', 'username' => 'LocalPlayer', 'displayName' => 'LocalPlayer', 'membership' => 'Premium', 'robux' => 0, 'bio' => '', 'joinDate' => '', 'isAdmin' => false);
    }
}

$username = $c['username'];
$displayName = $c['displayName'] ?? $username;
$membership = $c['membership'];
$robux = (int) $c['robux'];
$isAdmin = $c['isAdmin'] || lb_is_owner($c);
$badges = $c['badges'] ?? array();
$friends = $c['friends'] ?? array();
$featuredPlaceId = lb_get_latest_published_place_id();
$mapsRoot = lb_maps_root();
$mapsCount = is_dir($mapsRoot) ? count(array_filter(glob($mapsRoot . '/*'), 'is_file')) : 0;
$savesDir = lb_settings_root() . '/saves';
$savesCount = is_dir($savesDir) ? count(glob($savesDir . '/*.json')) : 0;
$placesDir = lb_settings_root() . '/places';
$placesCount = is_dir($placesDir) ? count(glob($placesDir . '/*.json')) : 0;
$ip = lb_get_server_ip();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Account Overview | LuckyBlox</title>
    <link rel="icon" href="/site-icon/luckyblox.ico" sizes="any" />
    <link rel="icon" type="image/png" href="/site-icon/luckyblox.png" />
    <link rel="stylesheet" href="/style.css" />
    <style>
        body { font-family: Arial, sans-serif; background: #020617; color: #e2e8f0; margin: 0; padding: 40px; }
        .container { max-width: 1000px; margin: 0 auto; }
        .card { background: rgba(15, 23, 42, 0.95); border: 1px solid #334155; border-radius: 14px; padding: 24px; box-shadow: 0 15px 30px rgba(0,0,0,0.25); margin-bottom: 20px; }
        h1, h2 { margin-top: 0; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #334155; }
        th { color: #93c5fd; }
        code { background: rgba(148, 163, 184, 0.12); padding: 2px 6px; border-radius: 4px; }
        a { color: #7dd3fc; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .member-pill { display:inline-block; padding:3px 10px; border-radius:999px; font-size:0.8rem; font-weight:700; }
        .member-admin { background:#ef4444; color:#fff; }
        .member-premium { background:#10b981; color:#fff; }
        .member-none { background:#f3f4f6; color:#374151; }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <h1>Account Overview</h1>

            <div style="margin-bottom:16px;">
                <span class="member-pill member-<?php echo $isAdmin ? 'admin' : 'premium'; ?>"><?php echo htmlspecialchars($membership); ?><?php if ($isAdmin): ?> (Admin)<?php endif; ?></span>
            </div>

            <table>
                <tbody>
                    <tr><th>User ID</th><td><code><?php echo (int) $c['userId']; ?></code></td></tr>
                    <tr><th>Username</th><td><code><?php echo htmlspecialchars($username); ?></code></td></tr>
                    <tr><th>Display name</th><td><code><?php echo htmlspecialchars($displayName); ?></code></td></tr>
                    <tr><th>Membership</th><td><code><?php echo htmlspecialchars($membership); ?></code></td></tr>
                    <tr><th>Robux</th><td><code>R$<?php echo $robux; ?></code></td></tr>
                    <tr><th>Badges</th><td><code><?php echo count($badges); ?></code></td></tr>
                    <tr><th>Friends</th><td><code><?php echo count($friends); ?></code></td></tr>
                    <tr><th>Server IP</th><td><code><?php echo htmlspecialchars($ip); ?></code></td></tr>
                    <tr><th>Saved place states</th><td><code><?php echo intval($savesCount); ?></code></td></tr>
                    <tr><th>Published place metadata</th><td><code><?php echo intval($placesCount); ?></code></td></tr>
                    <tr><th>Bio</th><td><code><?php echo htmlspecialchars($c['bio'] ?: 'Not set'); ?></code></td></tr>
                    <tr><th>Join date</th><td><code><?php echo htmlspecialchars($c['joinDate'] ?: 'Unknown'); ?></code></td></tr>
                </tbody>
            </table>
        </div>

        <div class="card">
            <h2>Recent badges</h2>
            <?php if (empty($badges)): ?>
                <p style="color:#94a3b8;">No badges yet.</p>
            <?php else: ?>
                <table>
                    <thead><tr><th>Badge</th><th>Description</th><th>Earned</th></tr></thead>
                    <tbody>
                        <?php foreach (array_slice($badges, 0, 10) as $badge): ?>
                            <tr>
                                <td><code><?php echo htmlspecialchars($badge['icon'] ?? 'B'); ?></code> <?php echo htmlspecialchars($badge['name']); ?></td>
                                <td><?php echo htmlspecialchars($badge['description'] ?? ''); ?></td>
                                <td><code><?php echo htmlspecialchars($badge['earnedDate'] ?? 'Unknown'); ?></code></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </div>

        <p><a href="/LuckBlox.site/home">Back to dashboard</a> &middot; <a href="/LuckBlox.site/settings">Settings</a> &middot; <a href="/LuckBlox.site/users/<?php echo (int) $c['userId']; ?>/profile">Profile</a></p>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
