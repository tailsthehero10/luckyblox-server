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

// Roblox-profile data: social counters, currently-wearing and creations.
$stats = $user['stats'] ?? array();
$friendsCount = (int) ($stats['friends'] ?? count($user['friends'] ?? array()));
$followersCount = (int) ($stats['followers'] ?? 0);
$followingCount = (int) ($stats['following'] ?? count($user['following'] ?? array()));
$robuxCount = (int) ($user['robux'] ?? 0);
$currency = $user['currencies'] ?? array();
$wearingIds = is_array($user['currentlyWearing'] ?? null) ? $user['currentlyWearing'] : array();
$wearingItems = lb_resolve_wearing_items($wearingIds);
$creations = lb_get_user_creations($userId);

function lb_color_for_id($id) {
    return 'rgb(' . lb_body_color_rgb($id) . ')';
}

/**
 * Resolve a user's "currently wearing" ids to named, priced asset records so
 * the profile shows real items instead of bare ids (Roblox parity).
 */
function lb_resolve_wearing_items($ids) {
    $assets = lb_get_assets();
    $result = array();
    foreach ((array) $ids as $rawId) {
        $key = (string) $rawId;
        if (!isset($assets[$key])) {
            continue;
        }
        $entry = $assets[$key];
        $result[] = array(
            'id' => $key,
            'name' => $entry['name'] ?? ('Asset ' . $key),
            'assetType' => $entry['assetType'] ?? ($entry['className'] ?? 'Asset'),
            'price' => (int) ($entry['price'] ?? 0),
        );
    }
    return $result;
}

/** Published games owned by a user, for the profile "Creations" panel. */
function lb_get_user_creations($userId) {
    $places = lb_get_places();
    $result = array();
    foreach ($places as $key => $place) {
        if (!is_array($place)) {
            continue;
        }
        $ownerId = (string) ($place['authorId'] ?? ($place['creatorId'] ?? ''));
        if ($ownerId === (string) $userId) {
            $result[] = array(
                'placeId' => (int) ($place['placeId'] ?? $key),
                'name' => $place['name'] ?? ('Place ' . $key),
                'description' => $place['description'] ?? 'A local LuckyBlox experience.',
            );
        }
    }
    return $result;
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

        /* 3D-style blocky avatar figure (CSS transform, driven by body colors) */
        .avatar-stage { perspective:900px; display:flex; align-items:center; justify-content:center; min-height:260px; background:linear-gradient(160deg,#eef2ff,#e0f2fe); border-radius:12px; border:1px solid #dbeafe; }
        .figure3d { position:relative; width:120px; height:240px; transform-style:preserve-3d; transform:rotateX(-8deg) rotateY(-22deg); animation:lb-spin 14s linear infinite; }
        @keyframes lb-spin { 0%{transform:rotateX(-8deg) rotateY(-22deg);} 50%{transform:rotateX(-8deg) rotateY(22deg);} 100%{transform:rotateX(-8deg) rotateY(-22deg);} }
        .part3d { position:absolute; border-radius:4px; box-shadow:inset 0 0 0 1px rgba(0,0,0,0.18), 6px 6px 10px rgba(0,0,0,0.12); }
        .p-head { width:44px; height:44px; left:38px; top:0; }
        .p-torso { width:60px; height:64px; left:30px; top:46px; }
        .p-larm { width:18px; height:58px; left:10px; top:52px; }
        .p-rarm { width:18px; height:58px; left:92px; top:52px; }
        .p-lleg { width:18px; height:64px; left:42px; top:112px; }
        .p-rleg { width:18px; height:64px; left:62px; top:112px; }
        .p-face { position:absolute; top:14px; left:50%; transform:translateX(-50%); font-size:20px; }
        .p-accessory { position:absolute; top:-6px; left:50%; transform:translateX(-50%); font-size:22px; }
        .avatar-3d-caption { text-align:center; margin-top:12px; color:#64748b; font-size:0.8rem; }
        .social-row { display:flex; gap:20px; flex-wrap:wrap; margin:14px 0 0; }
        .social-item { text-align:center; }
        .social-value { font-size:1.15rem; font-weight:700; color:#0f172a; }
        .social-label { font-size:0.72rem; color:#64748b; text-transform:uppercase; letter-spacing:0.04em; }
        .wearing-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:10px; margin-top:8px; }
        .wearing-item { display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid #e2e8f0; border-radius:8px; background:#f8fafc; }
        .wearing-thumb { width:34px; height:34px; border-radius:6px; background:#dbeafe; color:#1d4ed8; display:grid; place-items:center; font-weight:700; flex-shrink:0; }
        .wearing-name { font-size:0.85rem; font-weight:700; }
        .wearing-type { font-size:0.72rem; color:#64748b; }
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
            <div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;">
                <div class="avatar-stage">
                    <div class="figure3d" title="<?php echo htmlspecialchars($user['username']); ?> avatar">
                        <div class="part3d p-head" style="background:<?php echo htmlspecialchars(lb_color_for_id((int) ($bodyColors['headColorId'] ?? 1002))); ?>;">
                            <div class="p-face">&#128512;</div>
                            <?php if (!empty($wearingItems)): ?><div class="p-accessory">&#127913;</div><?php endif; ?>
                        </div>
                        <div class="part3d p-torso" style="background:<?php echo htmlspecialchars(lb_color_for_id((int) ($bodyColors['torsoColorId'] ?? 1002))); ?>;"></div>
                        <div class="part3d p-larm" style="background:<?php echo htmlspecialchars(lb_color_for_id((int) ($bodyColors['leftArmColorId'] ?? 1002))); ?>;"></div>
                        <div class="part3d p-rarm" style="background:<?php echo htmlspecialchars(lb_color_for_id((int) ($bodyColors['rightArmColorId'] ?? 1002))); ?>;"></div>
                        <div class="part3d p-lleg" style="background:<?php echo htmlspecialchars(lb_color_for_id((int) ($bodyColors['leftLegColorId'] ?? 1002))); ?>;"></div>
                        <div class="part3d p-rleg" style="background:<?php echo htmlspecialchars(lb_color_for_id((int) ($bodyColors['rightLegColorId'] ?? 1002))); ?>;"></div>
                    </div>
                </div>
                <div style="flex:1;min-width:240px;">
                    <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;font-weight:700;">Player profile</div>
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
                        &middot; Joined: <code><?php echo htmlspecialchars(substr((string) ($user['joinDate'] ?? ''), 0, 10)); ?></code>
                        &middot; Robux: <code>R$<?php echo $robuxCount; ?></code>
                    </div>
                    <div class="social-row">
                        <div class="social-item"><div class="social-value"><?php echo $friendsCount; ?></div><div class="social-label">Friends</div></div>
                        <div class="social-item"><div class="social-value"><?php echo $followersCount; ?></div><div class="social-label">Followers</div></div>
                        <div class="social-item"><div class="social-value"><?php echo $followingCount; ?></div><div class="social-label">Following</div></div>
                    </div>
                </div>
            </div>

            <div style="margin-top:16px;">
                <strong style="display:block;margin-bottom:6px;">About</strong>
                <?php if ($user['bio']): ?>
                    <p style="margin:0; color:#334155;"><?php echo htmlspecialchars($user['bio']); ?></p>
                <?php else: ?>
                    <p style="margin:0; color:#94a3b8; font-style:italic;">No bio yet.</p>
                <?php endif; ?>
            </div>

            <div class="avatar-colors">
                <?php foreach ($bodyColors as $part => $colorId): ?>
                    <div class="avatar-color" style="background:<?php echo htmlspecialchars(lb_color_for_id((int)$colorId)); ?>;" title="<?php echo htmlspecialchars($part); ?> — <?php echo htmlspecialchars(lb_body_color_name((int) $colorId)); ?> (<?php echo (int) $colorId; ?>)"></div>
                <?php endforeach; ?>
            </div>
        </div>

        <div class="card">
            <h2>Currently Wearing (<?php echo count($wearingItems); ?>)</h2>
            <?php if (empty($wearingItems)): ?>
                <p style="color:#94a3b8; font-style:italic;">Nothing equipped yet — visit the <a href="/LuckBlox.site/avatar">Avatar page</a> to dress this character.</p>
            <?php else: ?>
                <div class="wearing-list">
                    <?php foreach ($wearingItems as $item): ?>
                        <div class="wearing-item">
                            <div class="wearing-thumb"><?php echo htmlspecialchars(strtoupper(substr($item['name'], 0, 1))); ?></div>
                            <div>
                                <div class="wearing-name"><?php echo htmlspecialchars($item['name']); ?></div>
                                <div class="wearing-type"><?php echo htmlspecialchars($item['assetType']); ?><?php echo $item['price'] > 0 ? ' · R$' . (int) $item['price'] : ''; ?></div>
                            </div>
                        </div>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>

        <div class="card">
            <h2>Creations (<?php echo count($creations); ?>)</h2>
            <?php if (empty($creations)): ?>
                <p style="color:#94a3b8; font-style:italic;">No published games yet.</p>
            <?php else: ?>
                <?php foreach ($creations as $creation): ?>
                    <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #e5e7eb;">
                        <div style="width:40px;height:40px;border-radius:8px;background:#dbeafe;color:#1d4ed8;display:grid;place-items:center;font-weight:700;"><?php echo htmlspecialchars(strtoupper(substr($creation['name'], 0, 1))); ?></div>
                        <div style="flex:1;">
                            <div style="font-weight:700;"><?php echo htmlspecialchars($creation['name']); ?></div>
                            <div style="color:#94a3b8; font-size:0.85rem;"><?php echo htmlspecialchars($creation['description']); ?></div>
                        </div>
                        <a href="/LuckBlox.site/game?placeid=<?php echo (int) $creation['placeId']; ?>" style="font-size:0.85rem;">Play</a>
                    </div>
                <?php endforeach; ?>
            <?php endif; ?>
        </div>

        <div class="card">
            <h2>Stats</h2>
            <div class="stat-grid">
                <div class="stat-item"><div class="stat-value"><?php echo $friendsCount; ?></div><div class="stat-label">Friends</div></div>
                <div class="stat-item"><div class="stat-value"><?php echo (int) ($stats['created'] ?? 0); ?></div><div class="stat-label">Created</div></div>
                <div class="stat-item"><div class="stat-value"><?php echo (int) ($stats['plays'] ?? 0); ?></div><div class="stat-label">Plays</div></div>
                <div class="stat-item"><div class="stat-value"><?php echo (int) ($stats['gameVisits'] ?? ($stats['visits'] ?? 0)); ?></div><div class="stat-label">Game Visits</div></div>
                <div class="stat-item"><div class="stat-value"><?php echo $followersCount; ?></div><div class="stat-label">Followers</div></div>
                <div class="stat-item"><div class="stat-value"><?php echo (int) ($stats['badges'] ?? count($user['badges'])); ?></div><div class="stat-label">Badges</div></div>
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
