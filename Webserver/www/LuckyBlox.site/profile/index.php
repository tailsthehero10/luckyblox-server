<?php
require_once __DIR__ . '/../../api/luckyblox-data.php';

session_start();

$user = lb_get_current_user();
if (!$user) {
    $user = lb_find_user_by_id(1);
    if (!$user) {
        $user = array(
            'userId' => '1',
            'username' => 'LocalPlayer',
            'displayName' => 'LocalPlayer',
            'bio' => '',
            'joinDate' => '',
            'membership' => 'Premium',
            'robux' => 0,
            'stats' => array('friends' => 0, 'created' => 0, 'plays' => 0, 'followers' => 0, 'badges' => 0, 'gameVisits' => 0),
            'friends' => array(),
            'badges' => array(),
            'avatar' => array('bodyColors' => array()),
            'isAdmin' => false,
            'isVerified' => false,
        );
    }
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

$colorMap = array(
    1 => '#F8B295', 2 => '#F7B7A3', 3 => '#F6B594', 4 => '#F5B287',
    5 => '#F4AF7A', 6 => '#F3AC6D', 7 => '#F2A960', 8 => '#F1A653',
    9 => '#F0A346', 10 => '#EFA039', 11 => '#EE9D2C', 12 => '#ED9A1F',
    1001 => '#F8B295', 1002 => '#B4D1F0', 1003 => '#E8C8A0', 1004 => '#A2C5F7',
    1018 => '#E8D5B7', 1019 => '#F0E0D0', 1020 => '#A2C5F7',
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
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title><?php echo htmlspecialchars($user['username']); ?> - Profile | LuckyBlox</title>
    <link rel="icon" href="/site-icon/luckyblox.ico" sizes="any" />
    <link rel="icon" type="image/png" href="/site-icon/luckyblox.png" />
    <link rel="stylesheet" href="/style.css" />
    <style>
        body { margin:0; padding:0; font-family:Arial, Helvetica, sans-serif; background:#e5e7eb; color:#111827; }
        a { color:#1d4ed8; text-decoration:none; }
        a:hover { text-decoration:underline; }
        .container { max-width:1100px; margin:0 auto; padding:24px; }
        .topbar { display:flex; align-items:center; justify-content:space-between; gap:20px; background:#fff; border:1px solid #cbd5e1; border-radius:10px; padding:14px 20px; margin-bottom:20px; box-shadow:0 1px 2px rgba(0,0,0,0.06); }
        .brand { display:flex; align-items:center; gap:12px; font-weight:700; font-size:1.2rem; }
        .brand img { width:32px; height:32px; }
        .nav { display:flex; flex-wrap:wrap; gap:14px; font-size:0.9rem; }
        .nav a { padding:6px 12px; border-radius:6px; }
        .nav a:hover { background:#f3f4f6; }
        .avatar-lg { width:120px; height:120px; border-radius:50%; background:#dbeafe; color:#1d4ed8; display:grid; place-items:center; font-size:2.5rem; font-weight:700; margin-bottom:12px; }
        .profile-card { background:#fff; border:1px solid #cbd5e1; border-radius:12px; padding:28px; box-shadow:0 1px 2px rgba(0,0,0,0.06); margin-bottom:20px; }
        .profile-header { display:flex; align-items:center; gap:24px; }
        .avatar-preview { width:80px; height:80px; border-radius:50%; background:#dbeafe; display:grid; place-items:center; font-size:2rem; font-weight:700; color:#1d4ed8; margin-right:20px; }
        .avatar-colors { display:flex; gap:4px; flex-wrap:wrap; margin-top:10px; }
        .avatar-color { width:24px; height:24px; border:1px solid #cbd5e1; border-radius:4px; }
        .badge-chip { display:inline-flex; align-items:center; gap:4px; padding:4px 8px; border-radius:999px; font-size:0.8rem; font-weight:700; }
        .badge-admin { background:#fef3c7; color:#92400e; border:1px solid #fde68a; }
        .badge-verified { background:#dbeafe; color:#1d4ed8; border:1px solid #93c5fd; }
        h1 { margin:0 0 4px; font-size:1.8rem; }
        .username { color:#4b5563; font-size:1rem; margin-bottom:4px; }
        .membership-badge { display:inline-block; padding:4px 10px; border-radius:999px; font-size:0.8rem; font-weight:700; margin-left:8px; }
        .membership-none { background:#f3f4f6; color:#374151; }
        .membership-classic { background:#dbeafe; color:#1d4ed8; }
        .membership-bc { background:#a78bfa; color:#fff; }
        .membership-tbc { background:#f59e0b; color:#fff; }
        .membership-obc { background:#ec4899; color:#fff; }
        .membership-premium { background:#10b981; color:#fff; }
        .membership-admin { background:#ef4444; color:#fff; }
        .stat-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:12px; margin:16px 0; }
        .stat-item { text-align:center; padding:10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; }
        .stat-value { font-size:1.5rem; font-weight:700; color:#1d4ed8; }
        .stat-label { font-size:0.75rem; color:#64748b; text-transform:uppercase; }
        .badge-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:12px; }
        .badge-item { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; text-align:center; }
        .badge-icon { width:40px; height:40px; border-radius:50%; background:#dbeafe; color:#1d4ed8; display:grid; place-items:center; font-weight:700; margin:0 auto 8px; }
        .badge-name { font-weight:700; font-size:0.9rem; margin-bottom:2px; }
        .badge-desc { font-size:0.8rem; color:#64748b; }
        .friend-item { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #e2e8f0; }
        .friend-avatar { width:32px; height:32px; border-radius:50%; background:#dbeafe; color:#1d4ed8; display:grid; place-items:center; font-size:0.8rem; font-weight:700; }
        .friend-status { width:8px; height:8px; border-radius:50%; display:inline-block; margin-left:6px; }
        .status-dot-online { background:#10b981; }
        .status-dot-away { background:#f59e0b; }
        .status-dot-offline { background:#94a3b8; }
        .section-title { margin:0 0 12px; font-size:1.1rem; }
        .empty { color:#94a3b8; font-style:italic; padding:12px 0; }
        .wallet { display:flex; gap:16px; flex-wrap:wrap; margin-top:8px; }
        .wallet-item { display:flex; align-items:center; gap:6px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:6px 12px; }
        .wallet-amount { font-weight:700; color:#16a34a; }
        .wallet-label { font-size:0.8rem; color:#16a340b; }
        .bio { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin-top:12px; min-height:48px; font-size:0.95rem; color:#334155; width:100%; resize:vertical; }
        .edit-btn { padding:8px 16px; border-radius:6px; background:#2563eb; color:#fff; border:none; font-weight:700; cursor:pointer; font-size:0.85rem; }
        .edit-btn:hover { background:#1d4ed8; }
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
                <a href="/LuckBlox.site.tk/home">Home</a>
                <a href="/LuckBlox.site.tk/games">Games</a>
                <a href="/LuckBlox.site.tk/users">Users</a>
                <a href="/LuckBlox.site.tk/profile">Profile</a>
                <a href="/LuckBlox.site.tk/settings">Settings</a>
                <a href="/LuckBlox.site.tk/share">Share</a>
                <a href="/LuckBlox.site/signin/">Sign In</a>
            </nav>
        </div>

        <div class="profile-card">
            <div class="profile-header">
                <div class="avatar-preview" id="avatarPreview"><?php echo htmlspecialchars(strtoupper(substr($user['username'], 0, 1))); ?></div>
                <div style="flex:1;">
                    <h1>
                        <?php echo htmlspecialchars($user['displayName']); ?>
                        <?php if ($user['isVerified']): ?>
                            <span class="badge-chip badge-verified">Verified</span>
                        <?php endif; ?>
                        <?php if ($user['isAdmin']): ?>
                            <span class="badge-chip badge-admin">Admin</span>
                        <?php endif; ?>
                    </h1>
                    <div class="username">@<?php echo htmlspecialchars($user['username']); ?>
                        <span class="membership-badge membership-<?php echo strtolower($user['membership']); ?>"><?php echo htmlspecialchars($user['membership']); ?></span>
                    </div>
                    <div class="wallet">
                        <div class="wallet-item">R$ <span class="wallet-amount"><?php echo (int) $user['robux']; ?></span></div>
                        <?php if (isset($user['currencies']['coins'])): ?>
                            <div class="wallet-item">&#128176; <span class="wallet-amount"><?php echo (int) $user['currencies']['coins']; ?></span></div>
                        <?php endif; ?>
                    </div>
                </div>
            </div>

            <div style="margin-top:16px;">
                <strong>About</strong>
                <?php if ($user['bio']): ?>
                    <p style="margin:4px 0 12px;"><?php echo htmlspecialchars($user['bio']); ?></p>
                <?php else: ?>
                    <p class="empty">No bio yet.</p>
                <?php endif; ?>
                <?php if ($user['joinDate']): ?>
                    <div class="stat-label">Joined: <?php echo htmlspecialchars($user['joinDate']); ?> &middot; User ID: <?php echo (int) $user['userId']; ?></div>
                <?php endif; ?>
            </div>

            <div class="avatar-colors">
                <?php foreach ($bodyColors as $key => $colorId): ?>
                    <div class="avatar-color" style="background:<?php echo htmlspecialchars(lb_color_for_id((int)$colorId)); ?>;" title="<?php echo htmlspecialchars($key); ?> (Color ID <?php echo (int) $colorId; ?>)"></div>
                <?php endforeach; ?>
            </div>
        </div>

        <div class="profile-card">
            <div class="section-title">Stats</div>
            <div class="stat-grid">
                <div class="stat-item"><div class="stat-value"><?php echo (int) $user['stats']['friends']; ?></div><div class="stat-label">Friends</div></div>
                <div class="stat-item"><div class="stat-value"><?php echo (int) $user['stats']['created']; ?></div><div class="stat-label">Created</div></div>
                <div class="stat-item"><div class="stat-value"><?php echo (int) $user['stats']['plays']; ?></div><div class="stat-label">Plays</div></div>
                <div class="stat-item"><div class="stat-value"><?php echo (int) $user['stats']['visits'] ?? ($user['stats']['gameVisits'] ?? 0); ?></div><div class="stat-label">Game Visits</div></div>
                <div class="stat-item"><div class="stat-value"><?php echo (int) $user['stats']['followers']; ?></div><div class="stat-label">Followers</div></div>
                <div class="stat-item"><div class="stat-value"><?php echo (int) $user['stats']['badges']; ?></div><div class="stat-label">Badges</div></div>
            </div>
        </div>

        <div class="profile-card">
            <div class="section-title">Badges (<?php echo count($user['badges']); ?>)</div>
            <?php if (empty($user['badges'])): ?>
                <div class="empty">No badges yet.</div>
            <?php else: ?>
                <div class="badge-grid">
                    <?php foreach ($user['badges'] as $badge): ?>
                        <div class="badge-item">
                            <div class="badge-icon"><?php echo htmlspecialchars($badge['icon'] ?? 'B'); ?></div>
                            <div class="badge-name"><?php echo htmlspecialchars($badge['name']); ?></div>
                            <div class="badge-desc"><?php echo htmlspecialchars($badge['description'] ?? ''); ?></div>
                            <div class="stat-label">Earned <?php echo htmlspecialchars($badge['earnedDate'] ?? ''); ?></div>
                        </div>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>

        <div class="profile-card">
            <div class="section-title">Friends (<?php echo count($user['friends']); ?>)</div>
            <?php if (empty($user['friends'])): ?>
                <div class="empty">No friends yet.</div>
            <?php else: ?>
                <?php foreach ($user['friends'] as $friend): ?>
                    <?php $friendUser = lb_find_user_by_id($friend['userId'] ?? 1); ?>
                    <div class="friend-item">
                        <div class="friend-avatar"><?php echo htmlspecialchars(strtoupper(substr($friendUser ? $friendUser['username'] : $friend['username'], 0, 1))); ?></div>
                        <div>
                            <strong><?php echo htmlspecialchars($friend['username']); ?></strong>
                            <?php if ($friendUser): ?>
                                <span class="membership-badge membership-<?php echo strtolower($friendUser['membership']); ?>"><?php echo htmlspecialchars($friendUser['membership']); ?></span>
                            <?php endif; ?>
                        </div>
                        <div class="stat-label">
                            <span class="friend-status status-dot-<?php echo htmlspecialchars($friend['status'] ?? 'offline'); ?>"></span>
                            <?php echo htmlspecialchars(ucfirst($friend['status'] ?? 'offline')); ?>
                        </div>
                    </div>
                <?php endforeach; ?>
            <?php endif; ?>
        </div>

        <div class="profile-card">
            <div class="section-title">Quick links</div>
            <ul style="list-style:none;padding:0;">
                <li style="margin:8px 0;"><a href="/LuckBlox.site.tk/home">Home</a></li>
                <li style="margin:8px 0;"><a href="/LuckBlox.site.tk/games">Games (<?php echo $gamesCount; ?>)</a></li>
                <li style="margin:8px 0;"><a href="/LuckBlox.site.tk/settings">Settings</a></li>
                <li style="margin:8px 0;"><a href="/LuckBlox.site.tk/share">Share & Play</a></li>
                <li style="margin:8px 0;"><a href="/LuckBlox.site.tk/account">Account overview</a></li>
            </ul>
        </div>
    </div>
</body>
</html>
