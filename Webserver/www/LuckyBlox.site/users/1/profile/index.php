<?php
require_once __DIR__ . '/../../../../api/luckyblox-data.php';

session_start();

$userId = isset($_GET['id']) ? (int) preg_replace('/[^0-9]/', '', (string) $_GET['id']) : 1;
$userId = max(1, $userId);

$user = lb_find_user_by_id($userId);
if (!$user) {
    $user = lb_normalize_user(array(
        'userId' => (string) $userId,
        'username' => 'Unknown',
        'displayName' => 'Unknown',
        'membership' => 'None',
        'robux' => 0,
        'stats' => array('friends' => 0, 'created' => 0, 'plays' => 0, 'followers' => 0, 'badges' => 0, 'gameVisits' => 0),
        'friends' => array(),
        'badges' => array(),
        'avatar' => array('bodyColors' => array()),
    ), (string) $userId);
}

$featuredPlaceId = lb_get_latest_published_place_id();
$games = lb_get_all_games();
$gamesCount = count($games);
$mapsRoot = lb_maps_root();
$mapsCount = is_dir($mapsRoot) ? count(array_filter(glob($mapsRoot . '/*'), 'is_file')) : 0;

$avatar = $user['avatar'] ?? array();
$bodyColors = $avatar['bodyColors'] ?? array(
    'headColorId' => 1002, 'torsoColorId' => 1002,
    'rightArmColorId' => 1002, 'leftArmColorId' => 1002,
    'rightLegColorId' => 1002, 'leftLegColorId' => 1002,
);

function lb_color_for_id($id) {
    $map = array(
        1 => '#F8B295', 2 => '#F7B7A3', 24 => '#F8B295', 25 => '#F7B7A3',
        26 => '#F6B594', 27 => '#F5B287', 28 => '#F4AF7A',
        29 => '#F3AC6D', 30 => '#F2A960', 1001 => '#F8B295', 1002 => '#B4D1F0',
        1003 => '#E8C8A0', 1004 => '#A2C5F7', 1018 => '#E8D5B7', 1019 => '#F0E0D0',
        1020 => '#A2C5F7', 1021 => '#8CB3E0', 1022 => '#7AB3E0', 1023 => '#6AB3E0',
        1024 => '#5AA3D0', 1025 => '#4A93C0', 1026 => '#3A83B0', 1027 => '#2A73A0',
        1028 => '#1A6390', 1029 => '#0A5380', 1030 => '#004370',
    );
    return $map[$id] ?? '#B4D1F0';
}

function lb_membership_label($m) {
    $m = strtolower((string) $m);
    $map = array(
        'none' => 'None', 'classic' => 'Classic',
        'buildersclub' => 'Builders Club', 'builders club' => 'Builders Club',
        'turbobuildersclub' => 'Turbo Builders Club',
        'outrageousbuildersclub' => 'Outrageous Builders Club',
        'premium' => 'Premium', 'admin' => 'Admin',
    );
    return $map[$m] ?? ucfirst($m);
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>User <?php echo (int) $userId; ?> - <?php echo htmlspecialchars($user['username']); ?> | LuckyBlox</title>
    <link rel="icon" href="/site-icon/luckyblox.ico" sizes="any" />
    <link rel="icon" type="image/png" href="/site-icon/luckyblox.png" />
    <link rel="stylesheet" href="/style.css" />
    <style>
        body { margin:0; padding:0; font-family:Arial, Helvetica, sans-serif; background:#e5e7eb; color:#111827; }
        a { color:#1d4ed8; text-decoration:none; }
        a:hover { text-decoration:underline; }
        .container { max-width:1000px; margin:0 auto; padding:24px; }
        .topbar { display:flex; align-items:center; justify-content:space-between; gap:20px; background:#fff; border:1px solid #cbd5e1; border-radius:10px; padding:14px 20px; margin-bottom:18px; box-shadow:0 1px 2px rgba(0,0,0,0.06); }
        .brand { display:flex; align-items:center; gap:12px; font-weight:700; font-size:1.2rem; }
        .brand img { width:32px; height:32px; }
        .nav { display:flex; flex-wrap:wrap; gap:14px; font-size:0.9rem; }
        .nav a { padding:6px 12px; border-radius:6px; }
        .nav a:hover { background:#f3f4f6; }
        .card { background:#fff; border:1px solid #cbd5e1; border-radius:12px; padding:24px; box-shadow:0 1px 2px rgba(0,0,0,0.06); margin-bottom:20px; }
        h1, h2 { margin:0 0 12px; }
        .avatar-preview { width:100px; height:100px; border-radius:50%; background:#dbeafe; color:#1d4ed8; display:grid; place-items:center; font-size:2.5rem; font-weight:700; margin-bottom:12px; }
        table { width:100%; border-collapse:collapse; }
        th, td { text-align:left; padding:10px 12px; border-bottom:1px solid #e5e7eb; }
        th { color:#1d4ed8; width:40%; }
        code { background:#f3f4f6; border:1px solid #d1d5db; border-radius:4px; padding:2px 8px; color:#111827; font-size:0.9rem; }
        .membership-badge { display:inline-block; padding:3px 10px; border-radius:999px; font-size:0.8rem; font-weight:700; }
        .membership-none { background:#f3f4f6; color:#374151; }
        .membership-classic { background:#dbeafe; color:#1d4ed8; }
        .membership-bc { background:#a78bfa; color:#fff; }
        .membership-tbc { background:#f59e0b; color:#fff; }
        .membership-obc { background:#ec4899; color:#fff; }
        .membership-premium { background:#10b981; color:#fff; }
        .membership-admin { background:#ef4444; color:#fff; }
        .stat-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:12px; margin:12px 0; }
        .stat-item { text-align:center; padding:10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; }
        .stat-value { font-size:1.4rem; font-weight:700; color:#1d4ed8; }
        .stat-label { font-size:0.75rem; color:#64748b; text-transform:uppercase; }
        .avatar-colors { display:flex; gap:4px; flex-wrap:wrap; margin-top:12px; }
        .avatar-color { width:24px; height:24px; border:1px solid #cbd5e1; border-radius:4px; }
        .badge-pill { display:inline-block; padding:3px 8px; border-radius:999px; font-size:0.75rem; font-weight:700; }
        .badge-admin { background:#fee2e2; color:#991b1b; }
    </style>
</head>
<body>
    <div class="container">
        <div class="topbar">
            <div class="brand">
                <img src="/site-icon/luckyblox.png" alt="LuckyBlox" />
                <span>LuckyBlox</span>
            </div>
            <nav class="nav">
                <a href="/LuckBlox.site/home">Home</a>
                <a href="/LuckBlox.site/games">Games</a>
                <a href="/LuckBlox.site/users">Users</a>
                <a href="/LuckBlox.site/profile">Profile</a>
                <a href="/LuckBlox.site/settings">Settings</a>
                <a href="/LuckBlox.site/share">Share</a>
                <a href="/LuckBlox.site/signin/">Sign In</a>
            </nav>
        </div>

        <div class="card">
            <div style="display:flex;align-items:center;gap:24px;">
                <div class="avatar-preview"><?php echo htmlspecialchars(strtoupper(substr($user['username'], 0, 1))); ?></div>
                <div style="flex:1;">
                    <h1>
                        <?php echo htmlspecialchars($user['displayName']); ?>
                        <?php if ($user['isAdmin']): ?>
                            <span class="badge-pill badge-admin">Admin</span>
                        <?php elseif ($user['isVerified']): ?>
                            <span class="badge-pill badge-admin">Verified</span>
                        <?php endif; ?>
                    </h1>
                    <div style="color:#64748b; margin:4px 0;">
                        @<?php echo htmlspecialchars($user['username']); ?>
                        <span class="membership-badge membership-<?php echo strtolower($user['membership']); ?>"><?php echo htmlspecialchars(lb_membership_label($user['membership'])); ?></span>
                    </div>
                    <div style="color:#64748b; font-size:0.9rem;">
                        User ID: <code><?php echo (int) $user['userId']; ?></code>
                        &middot; Robux: <code>R$<?php echo (int) $user['robux']; ?></code>
                    </div>
                </div>
            </div>

            <?php if ($user['bio']): ?>
                <p style="margin:16px 0 0; color:#334155;"><?php echo htmlspecialchars($user['bio']); ?></p>
            <?php else: ?>
                <p style="margin:16px 0 0; color:#94a3b8; font-style:italic;">No bio yet.</p>
            <?php endif; ?>

            <div class="avatar-colors">
                <?php foreach ($bodyColors as $part => $colorId): ?>
                    <div class="avatar-color" style="background:<?php echo htmlspecialchars(lb_color_for_id((int)$colorId)); ?>;" title="<?php echo htmlspecialchars($part); ?> (Color ID <?php echo (int) $colorId; ?>)"></div>
                <?php endforeach; ?>
            </div>
        </div>

        <div class="card">
            <h2>Stats</h2>
            <div class="stat-grid">
                <div class="stat-item"><div class="stat-value"><?php echo (int) $user['stats']['friends']; ?></div><div class="stat-label">Friends</div></div>
                <div class="stat-item"><div class="stat-value"><?php echo (int) $user['stats']['created']; ?></div><div class="stat-label">Created</div></div>
                <div class="stat-item"><div class="stat-value"><?php echo (int) $user['stats']['plays']; ?></div><div class="stat-label">Plays</div></div>
                <div class="stat-item"><div class="stat-value"><?php echo (int) ($user['stats']['gameVisits'] ?? ($user['stats']['visits'] ?? 0)); ?></div><div class="stat-label">Game Visits</div></div>
                <div class="stat-item"><div class="stat-value"><?php echo (int) $user['stats']['followers']; ?></div><div class="stat-label">Followers</div></div>
                <div class="stat-item"><div class="stat-value"><?php echo (int) $user['stats']['badges']; ?></div><div class="stat-label">Badges</div></div>
            </div>
        </div>

        <div class="card">
            <h2>Friends (<?php echo count($user['friends']); ?>)</h2>
            <?php if (empty($user['friends'])): ?>
                <p style="color:#94a3b8; font-style:italic;">No friends yet.</p>
            <?php else: ?>
                <?php foreach ($user['friends'] as $friend): ?>
                    <?php $friendUser = lb_find_user_by_id($friend['userId'] ?? 1); ?>
                    <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #e5e7eb;">
                        <div style="width:36px;height:36px;border-radius:50%;background:#dbeafe;color:#1d4ed8;display:grid;place-items:center;font-weight:700;font-size:0.9rem;">
                            <?php echo htmlspecialchars(strtoupper(substr($friendUser ? $friendUser['username'] : $friend['username'], 0, 1))); ?>
                        </div>
                        <div style="flex:1;"><strong><?php echo htmlspecialchars($friend['username']); ?></strong>
                            <?php if ($friendUser): ?>
                                <span class="membership-badge membership-<?php echo strtolower($friendUser['membership']); ?>"><?php echo htmlspecialchars(lb_membership_label($friendUser['membership'])); ?></span>
                            <?php endif; ?>
                        </div>
                        <div style="color:#94a3b8; font-size:0.9rem;">
                            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:<?php echo $friend['status'] === 'online' ? '#10b981' : ($friend['status'] === 'away' ? '#f59e0b' : '#94a3b8'); ?>;margin-right:4px;"></span>
                            <?php echo htmlspecialchars(ucfirst($friend['status'] ?? 'offline')); ?>
                        </div>
                    </div>
                <?php endforeach; ?>
            <?php endif; ?>
        </div>

        <div class="card">
            <h2>Badges (<?php echo count($user['badges']); ?>)</h2>
            <?php if (empty($user['badges'])): ?>
                <p style="color:#94a3b8; font-style:italic;">No badges yet.</p>
            <?php else: ?>
                <?php foreach ($user['badges'] as $badge): ?>
                    <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #e5e7eb;">
                        <div style="width:40px;height:40px;border-radius:50%;background:#dbeafe;color:#1d4ed8;display:grid;place-items:center;font-weight:700;">
                            <?php echo htmlspecialchars($badge['icon'] ?? 'B'); ?>
                        </div>
                        <div style="flex:1;">
                            <div style="font-weight:700;"><?php echo htmlspecialchars($badge['name']); ?></div>
                            <div style="color:#94a3b8; font-size:0.85rem;"><?php echo htmlspecialchars($badge['description'] ?? ''); ?></div>
                        </div>
                        <div style="color:#94a3b8; font-size:0.85rem;">
                            <?php echo htmlspecialchars($badge['earnedDate'] ?? 'Unknown'); ?>
                        </div>
                    </div>
                <?php endforeach; ?>
            <?php endif; ?>
        </div>

        <div class="card">
            <h2>Quick links</h2>
            <ul style="list-style:none;padding:0;">
                <li style="margin:8px 0;"><a href="/LuckBlox.site/home">Home</a></li>
                <li style="margin:8px 0;"><a href="/LuckBlox.site/games">Games (<?php echo $gamesCount; ?>)</a></li>
                <li style="margin:8px 0;"><a href="/LuckBlox.site/game?placeid=<?php echo (int) $featuredPlaceId; ?>">Game details</a></li>
                <li style="margin:8px 0;"><a href="/LuckBlox.site/settings">Settings</a></li>
                <li style="margin:8px 0;"><a href="/LuckBlox.site/share">Share</a></li>
                <li style="margin:8px 0;"><a href="/LuckBlox.site/users">All users</a></li>
            </ul>
        </div>
    </div>
</body>
</html>
