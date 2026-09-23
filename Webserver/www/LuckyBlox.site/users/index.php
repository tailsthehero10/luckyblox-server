<?php
$users = array(
    array('id' => 1, 'name' => 'default', 'membership' => 'None', 'status' => 'Primary local account', 'bio' => 'Main launcher profile used for local play and testing.'),
    array('id' => 2, 'name' => 'guest', 'membership' => 'None', 'status' => 'Guest profile', 'bio' => 'Quick-access public profile for browse-and-play sessions.'),
    array('id' => 3, 'name' => 'builder', 'membership' => 'Builders Club', 'status' => 'Creator profile', 'bio' => 'Profile used for building, publishing, and content management.'),
);
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>LuckyBlox Users</title>
    <style>
        body {
            margin: 0;
            padding: 24px;
            font-family: Arial, Helvetica, sans-serif;
            background: #e5e7eb;
            color: #111827;
        }
        a { color: #1d4ed8; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .container { max-width: 1100px; margin: 0 auto; }
        .topbar {
            display:flex; align-items:center; justify-content:space-between; gap:20px;
            background:#ffffff; border:1px solid #cbd5e1; border-radius:8px; padding:14px 18px;
            margin-bottom:18px; box-shadow:0 1px 2px rgba(0,0,0,0.08);
        }
        .brand { display:flex; align-items:center; gap:12px; font-weight:700; font-size:1.05rem; text-transform:uppercase; }
        .brand-mark {
            width:32px; height:32px; border-radius:6px; background:#1d4ed8; color:#fff;
            display:grid; place-items:center; font-size:0.95rem;
        }
        .nav { display:flex; flex-wrap:wrap; gap:14px; font-size:0.9rem; }
        .hero, .card {
            background:#ffffff; border:1px solid #cbd5e1; border-radius:8px; padding:22px;
            box-shadow:0 1px 2px rgba(0,0,0,0.08);
        }
        .hero { margin-bottom:20px; }
        .eyebrow {
            display:inline-block; background:#dbeafe; color:#1d4ed8; border:1px solid #93c5fd;
            border-radius:4px; padding:5px 8px; font-size:0.75rem; font-weight:700;
            letter-spacing:0.08em; text-transform:uppercase; margin-bottom:10px;
        }
        h1, h2 { margin-top:0; }
        .stats-grid {
            display:grid; grid-template-columns:repeat(auto-fit, minmax(220px,1fr)); gap:18px;
            margin-bottom:20px;
        }
        .label {
            color:#1d4ed8; font-size:0.75rem; font-weight:700; letter-spacing:0.08em;
            text-transform:uppercase; margin-bottom:8px;
        }
        .value { font-weight:700; font-size:1.05rem; }
        .muted { color:#4b5563; margin-top:6px; font-size:0.9rem; }
        .user-grid {
            display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));
            gap:22px;
            margin-top:20px;
        }
        .user-card { background:#fff; border:1px solid #cbd5e1; border-radius:8px; padding:18px; }
        .user-top { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .avatar {
            width:40px; height:40px; border-radius:50%; background:#dbeafe; color:#1d4ed8;
            display:grid; place-items:center; font-weight:700;
        }
        .status {
            display:inline-block; background:#f3f4f6; border:1px solid #d1d5db; border-radius:999px;
            padding:4px 8px; font-size:0.78rem; color:#374151;
        }
        .meta { color:#374151; margin-top:10px; }
        .button {
            display:inline-flex; align-items:center; justify-content:center; padding:10px 16px;
            border-radius:6px; background:#2563eb; border:1px solid #1d4ed8; color:#fff; font-weight:700;
            margin-top:14px;
        }
        .footer {
            margin-top:24px; padding-top:16px; border-top:1px solid #cbd5e1; color:#4b5563;
            text-align:center; font-size:0.9rem;
        }
    </style>
    <link rel="stylesheet" href="/style.css" />
</head>
<body>
    <div class="container">
        <div class="topbar">
            <div class="brand">
                <div class="brand-mark">L</div>
                <span>LuckyBlox</span>
            </div>
            <div class="nav">
                <a href="/LuckBlox.site.tk/home">Home</a>
                <a href="/LuckBlox.site.tk/games">Games</a>
                <a href="/LuckBlox.site.tk/profile">Profile</a>
                <a href="/LuckBlox.site.tk/settings">Settings</a>
                <a href="/LuckBlox.site.tk/share">Share</a>
                <a href="/LuckBlox.site.tk/about">About</a>
                <a href="/LuckBlox.site.tk/help">Help</a>
            </div>
        </div>

        <div class="hero">
            <div class="eyebrow">Users</div>
            <h1>LuckyBlox user directory</h1>
            <p style="margin:14px 0 0; color:#374151;">
                Browse the local player profiles and jump directly into each profile page for account, server, and play details.
            </p>
        </div>

        <div class="stats-grid">
            <div class="card">
                <div class="label">Total profiles</div>
                <div class="value"><?php echo count($users); ?></div>
                <div class="muted">Available local user profiles</div>
            </div>
            <div class="card">
                <div class="label">Current account</div>
                <div class="value">default</div>
                <div class="muted">Primary launcher identity</div>
            </div>
            <div class="card">
                <div class="label">Membership</div>
                <div class="value">Builders Club</div>
                <div class="muted">Unofficial local membership state</div>
            </div>
        </div>

        <div class="card">
            <h2>Local users</h2>
            <div class="user-grid">
                <?php foreach ($users as $user): ?>
                    <div class="user-card">
                        <div class="user-top">
                            <div style="display:flex; align-items:center; gap:12px;">
                                <div class="avatar"><?php echo htmlspecialchars(strtoupper(substr($user['name'], 0, 1))); ?></div>
                                <div>
                                    <div style="font-weight:700; font-size:1.05rem;"><?php echo htmlspecialchars($user['name']); ?></div>
                                    <div style="color:#4b5563; font-size:0.9rem;">User ID: <?php echo (int) $user['id']; ?></div>
                                </div>
                            </div>
                            <span class="status"><?php echo htmlspecialchars($user['status']); ?></span>
                        </div>
                        <div class="meta"><?php echo htmlspecialchars($user['bio']); ?></div>
                        <div class="meta" style="margin-top:8px;"><strong>Membership:</strong> <?php echo htmlspecialchars($user['membership']); ?></div>
                        <a class="button" href="/LuckBlox.site.tk/users/<?php echo (int) $user['id']; ?>/profile">View profile</a>
                    </div>
                <?php endforeach; ?>
            </div>
        </div>

        <div class="footer">
            LuckyBlox • Classic local user directory • <a href="/LuckBlox.site.tk/">Dashboard</a>
        </div>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
