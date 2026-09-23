<?php
require_once __DIR__ . '/../../api/luckyblox-data.php';

session_start();

$users = lb_get_users();
$normalizedUsers = array();
foreach ($users as $key => $user) {
    $normalized = lb_normalize_user($user, $key);
    if ($normalized) {
        $normalizedUsers[] = $normalized;
    }
}

usort($normalizedUsers, function($a, $b) {
    return $a['userId'] - $b['userId'];
});

$currentUser = lb_get_current_user();
$featuredPlaceId = lb_get_latest_published_place_id();

function lb_initials($name) {
    $name = trim((string) $name);
    if ($name === '') return '?';
    $parts = explode(' ', $name);
    if (count($parts) >= 2) {
        return strtoupper(substr($parts[0], 0, 1) . substr($parts[1], 0, 1));
    }
    return strtoupper(substr($name, 0, 1));
}

function lb_role_label($user) {
    if ($user['isAdmin']) {
        return 'Admin';
    }
    $role = $user['role'] ?? 'player';
    return ucfirst($role);
}

function lb_membership_class($membership) {
    $m = strtolower((string) $membership);
    if ($m === 'admin' || $m === 'outrageousbuildersclub') return 'obc';
    if ($m === 'turbobuildersclub') return 'tbc';
    if ($m === 'buildersclub' || $m === 'builders club') return 'bc';
    if ($m === 'premium') return 'premium';
    if ($m === 'classic') return 'classic';
    return 'none';
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LuckyBlox Users</title>
    <link rel="icon" href="/site-icon/luckyblox.ico" sizes="any" />
    <link rel="icon" type="image/png" href="/site-icon/luckyblox.png" />
    <link rel="stylesheet" href="/style.css" />
    <style>
        body { margin:0; padding:24px; font-family:Arial, Helvetica, sans-serif; background:#e5e7eb; color:#111827; }
        a { color:#1d4ed8; text-decoration:none; }
        a:hover { text-decoration:underline; }
        .container { max-width:1100px; margin:0 auto; }
        .topbar { display:flex; align-items:center; justify-content:space-between; gap:20px; background:#fff; border:1px solid #cbd5e1; border-radius:10px; padding:14px 20px; margin-bottom:18px; box-shadow:0 1px 2px rgba(0,0,0,0.06); }
        .brand { display:flex; align-items:center; gap:12px; font-weight:700; font-size:1.2rem; }
        .brand img { width:32px; height:32px; }
        .nav { display:flex; flex-wrap:wrap; gap:14px; font-size:0.9rem; }
        .nav a { padding:6px 12px; border-radius:6px; }
        .nav a:hover { background:#f3f4f6; }
        .hero { background:#fff; border:1px solid #cbd5e1; border-radius:10px; padding:24px; box-shadow:0 1px 2px rgba(0,0,0,0.06); margin-bottom:20px; }
        .eyebrow { display:inline-block; background:#dbeafe; color:#1d4ed8; border:1px solid #93c5fd; border-radius:4px; padding:5px 8px; font-size:0.75rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:10px; }
        h1 { margin:0 0 10px; font-size:1.8rem; }
        .subtitle { color:#64748b; margin:0 0 16px; }
        .stats-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:18px; margin-bottom:20px; }
        .stat-card { background:#fff; border:1px solid #cbd5e1; border-radius:10px; padding:18px; box-shadow:0 1px 2px rgba(0,0,0,0.06); }
        .stat-label { color:#1d4ed8; font-size:0.75rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:6px; }
        .stat-value { font-size:1.6rem; font-weight:700; }
        .stat-muted { color:#94a3b8; font-size:0.85rem; margin-top:4px; }
        .user-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:20px; }
        .user-card { background:#fff; border:1px solid #cbd5e1; border-radius:10px; padding:18px; box-shadow:0 1px 2px rgba(0,0,0,0.06); }
        .user-top { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .avatar { width:44px; height:44px; border-radius:50%; background:#dbeafe; color:#1d4ed8; display:grid; place-items:center; font-weight:700; font-size:1.1rem; }
        .status { display:inline-block; background:#f3f4f6; border:1px solid #d1d5db; border-radius:999px; padding:4px 8px; font-size:0.78rem; color:#374151; font-weight:600; }
        .role-admin { background:#fee2e2; color:#991b1b; border-color:#fca5a5; }
        .meta { color:#64748b; margin-top:10px; font-size:0.9rem; }
        .membership-badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:0.72rem; font-weight:700; margin-left:6px; }
        .membership-none { background:#f3f4f6; color:#374151; }
        .membership-classic { background:#dbeafe; color:#1d4ed8; }
        .membership-bc { background:#a78bfa; color:#fff; }
        .membership-tbc { background:#f59e0b; color:#fff; }
        .membership-obc { background:#ec4899; color:#fff; }
        .membership-premium { background:#10b981; color:#fff; }
        .membership-admin { background:#ef4444; color:#fff; }
        .footer { margin-top:24px; padding-top:16px; border-top:1px solid #cbd5e1; color:#94a3b8; text-align:center; font-size:0.9rem; }
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
                <a href="/LuckBlox.site.tk/profile">Profile</a>
                <a href="/LuckBlox.site.tk/settings">Settings</a>
                <a href="/LuckBlox.site.tk/share">Share</a>
                <a href="/LuckBlox.site/signin/">Sign In</a>
            </nav>
        </div>

        <div class="hero">
            <div class="eyebrow">Users</div>
            <h1>LuckyBlox user directory</h1>
            <p class="subtitle">Browse local player profiles and jump into each profile for account, server, and play details.</p>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Total profiles</div>
                <div class="stat-value"><?php echo count($normalizedUsers); ?></div>
                <div class="stat-muted">Available local user profiles</div>
            </div>
            <?php if ($currentUser): ?>
                <div class="stat-card">
                    <div class="stat-label">Current account</div>
                    <div class="stat-value"><?php echo htmlspecialchars($currentUser['username']); ?></div>
                    <div class="stat-muted">Signed in</div>
                </div>
            <?php endif; ?>
            <div class="stat-card">
                <div class="stat-label">Featured game</div>
                <div class="stat-value">#<?php echo (int) $featuredPlaceId; ?></div>
                <div class="stat-muted">Latest published place</div>
            </div>
        </div>

        <div class="user-grid">
            <?php foreach ($normalizedUsers as $user): ?>
                <div class="user-card">
                    <div class="user-top">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div class="avatar"><?php echo htmlspecialchars(strtoupper(substr($user['username'], 0, 1))); ?></div>
                            <div>
                                <div style="font-weight:700;font-size:1.05rem;"><?php echo htmlspecialchars($user['displayName']); ?>
                                    <span class="membership-badge membership-<?php echo lb_membership_class($user['membership']); ?>"><?php echo htmlspecialchars($user['membership']); ?></span>
                                </div>
                                <div style="color:#94a3b8;font-size:0.85rem;">User ID: <?php echo (int) $user['userId']; ?></div>
                            </div>
                        </div>
                        <?php if ($user['isAdmin']): ?>
                            <span class="status role-admin">Admin</span>
                        <?php else: ?>
                            <span class="status"><?php echo htmlspecialchars(lb_role_label($user)); ?></span>
                        <?php endif; ?>
                    </div>
                    <?php if ($user['bio']): ?>
                        <div class="meta" style="margin-top:8px;"><?php echo htmlspecialchars($user['bio']); ?></div>
                    <?php endif; ?>
                    <div class="meta" style="margin-top:8px;">
                        <strong>Robux:</strong> R$<?php echo (int) $user['robux']; ?>
                        &middot; <strong>Friends:</strong> <?php echo (int) $user['stats']['friends']; ?>
                        &middot; <strong>Badges:</strong> <?php echo (int) $user['stats']['badges']; ?>
                    </div>
                    <a class="button" style="margin-top:12px;display:inline-block;padding:8px 14px;border-radius:6px;background:#2563eb;color:#fff;font-weight:700;" href="/LuckBlox.site.tk/users/<?php echo (int) $user['userId']; ?>/profile">View profile</a>
                </div>
            <?php endforeach; ?>
        </div>

        <?php if (empty($normalizedUsers)): ?>
            <div class="hero">
                <div class="empty">No users found. <a href="/LuckBlox.site/signup/">Create an account</a></div>
            </div>
        <?php endif; ?>

        <div class="footer">
            LuckyBlox &middot; Local user directory &middot; <a href="/LuckBlox.site.tk/home">Dashboard</a>
        </div>
    </div>
</body>
</html>
