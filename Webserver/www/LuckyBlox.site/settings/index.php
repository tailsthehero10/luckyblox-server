<?php
require_once __DIR__ . '/../../api/common.php';
require_once __DIR__ . '/../../api/luckyblox-data.php';

session_start();

$errors = array();
$success = '';

$user = lb_get_current_user();
if (!$user) {
    header('Location: /LuckBlox.site/signin/?redirect=/LuckBlox.site/settings/');
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action']) && $_POST['action'] === 'save_profile') {
    if (!lb_verify_csrf()) {
        $errors[] = 'Security token missing or invalid. Please reload and try again.';
    } else {
        $displayName = trim((string) ($_POST['displayName'] ?? ''));
        $bio = (string) ($_POST['bio'] ?? '');
        $theme = (string) ($_POST['theme'] ?? 'light');
        if (!in_array($theme, array('light', 'dark'), true)) {
            $theme = 'light';
        }

        $users = lb_get_users();
        $key = $user['key'];
        if (!isset($users[$key]) || !is_array($users[$key])) {
            $errors[] = 'Could not locate your account record.';
        } else {
            $users[$key]['displayName'] = $displayName !== '' ? substr($displayName, 0, 35) : $users[$key]['username'];
            $users[$key]['bio'] = substr($bio, 0, 500);
            $users[$key]['theme'] = $theme;
            $users[$key]['updatedAt'] = date('c');
            lb_write_json('users.json', $users);

            // Refresh the client-visible identity so clients pick up the change.
            lb_sync_local_identity(lb_normalize_user($users[$key], $key));
            $success = 'Profile updated successfully.';
            // Re-read so the page shows the new values immediately.
            $user = lb_find_user_by_id($userId);
        }
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action']) && $_POST['action'] === 'change_password') {
    if (!lb_verify_csrf()) {
        $errors[] = 'Security token missing or invalid. Please reload and try again.';
    } else {
        $currentPassword = $_POST['currentPassword'] ?? '';
        $newPassword = $_POST['newPassword'] ?? '';
        $confirmPassword = $_POST['confirmPassword'] ?? '';

        if (!$user['password'] || !$user['passwordSalt']) {
            $errors[] = 'This account uses an external login method. Password change is not available.';
        } else {
            if (!lb_verify_password($currentPassword, $user['password'], $user['passwordSalt'])) {
                $errors[] = 'Your current password is incorrect.';
            } elseif ($newPassword !== $confirmPassword) {
                $errors[] = 'Passwords do not match.';
            } else {
                $policy = lb_check_password_policy($newPassword);
                if (!$policy['ok']) {
                    $errors = array_merge($errors, $policy['errors']);
                } else {
                    $hashed = lb_hash_password($newPassword);
                    $users = lb_get_users();
                    $key = $user['key'];
                    $users[$key]['password'] = $hashed['hash'];
                    $users[$key]['passwordSalt'] = $hashed['salt'];
                    $users[$key]['passwordVersion'] = $hashed['version'];
                    $users[$key]['updatedAt'] = date('c');
                    lb_write_json('users.json', $users);
                    $success = 'Password updated successfully.';
                }
            }
        }
    }
}

$csrfToken = lb_get_csrf_token();
$settingsRoot = lb_settings_root();
$ip = lb_get_server_ip();
$hostPort = lb_get_host_port();
$serverPort = lb_get_client_port();
$clientPort = lb_get_client_port();

$gamesCount = count(lb_get_all_games());
$mapsRoot = lb_maps_root();
$mapsCount = is_dir($mapsRoot) ? count(array_filter(glob($mapsRoot . '/*'), 'is_file')) : 0;

$username = $user['username'];
$membership = $user['membership'];
$robux = (int) $user['robux'];
$userId = (int) $user['userId'];
$bio = $user['bio'];
$joinDate = $user['joinDate'] ?: 'Unknown';
$isAdmin = $user['isAdmin'] || lb_is_owner($user);

$serverName = api_get_setting_value($settingsRoot . '/servername.txt', 'LuckyBlox Server');
$publicHost = api_get_setting_value($settingsRoot . '/ip.txt', $ip);
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Settings | LuckyBlox</title>
    <link rel="icon" href="/site-icon/luckyblox.ico" sizes="any" />
    <link rel="icon" type="image/png" href="/site-icon/luckyblox.png" />
    <link rel="stylesheet" href="/style.css" />
    <link rel="stylesheet" href="/css/lb-select.css" />
    <style>
        body { font-family: Arial, sans-serif; background: #020617; color: #e2e8f0; margin: 0; padding: 40px; }
        .container { max-width: 900px; margin: 0 auto; }
        .card { background: rgba(15, 23, 42, 0.95); border: 1px solid #334155; border-radius: 14px; padding: 24px; box-shadow: 0 15px 30px rgba(0,0,0,0.25); margin-bottom: 20px; }
        h1, h2 { margin-top: 0; color: #e2e8f0; }
        .settings-heading { display:flex; justify-content:space-between; align-items:center; }
        .settings-eyebrow { display:inline-block; background:#dbeafe; color:#1d4ed8; border:1px solid #93c5fd; border-radius:4px; padding:5px 8px; font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-bottom:10px; }
        .settings-layout { display:grid; grid-template-columns: 220px 1fr; gap: 0; }
        .settings-menu { background:rgba(255,255,255,0.02); border:1px solid #334155; border-radius:10px; padding:8px; display:flex; flex-direction:column; gap:4px; }
        .settings-menu a { padding:10px 14px; border-radius:8px; color:#cbd5e1; text-decoration:none; font-size:0.88rem; transition:0.15s; }
        .settings-menu a:hover { background:rgba(255,255,255,0.05); color:#e2e8f0; }
        .settings-menu a.active { background:#2563eb; color:#fff; }
        .settings-content { }
        .settings-section { margin-bottom:0; }
        .settings-section-heading { display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid #334155; padding-bottom:8px; margin-bottom:16px; }
        .settings-section-heading h2 { margin:0; font-size:1.1rem; }
        .settings-status { background:#2563eb; color:#fff; padding:3px 10px; border-radius:999px; font-size:0.75rem; }
        .settings-row { display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid #1e293b; }
        .settings-row:last-child { border-bottom:none; }
        .settings-row span { color:#94a3b8; }
        .settings-row strong { color:#e2e8f0; }
        .settings-row code { background:rgba(148,163,184,0.12); padding:4px 10px; border-radius:4px; font-size:0.9rem; }
        form { display:grid; gap:14px; }
        label { display:block; color:#94a3b8; font-size:0.85rem; margin-bottom:6px; }
        input { font:inherit; padding:10px 12px; border-radius:8px; border:1px solid #475569; background:#0f172a; color:#e2e8f0; width:100%; }
        button { background:#2563eb; border:none; color:#fff; padding:10px 16px; border-radius:8px; cursor:pointer; font-weight:700; }
        button:hover { background:#1d4ed8; }
        .status { margin-top:12px; min-height:20px; font-size:0.9rem; }
        .status.error { color:#fca5a5; }
        .status.success { color:#86efac; }
        a { color:#7dd3fc; }
        a:hover { text-decoration:underline; }
        .member-pill { padding:3px 10px; border-radius:999px; font-size:0.8rem; font-weight:700; }
        .member-admin { background:#ef4444; color:#fff; }
    </style>
</head>
<body>
    <div class="container settings-page">
        <div class="settings-heading">
            <div>
                <div class="settings-eyebrow">Account settings</div>
                <h1>Settings</h1>
                <p style="color:#94a3b8;">Review your LuckyBlox account, server, and client configuration.</p>
            </div>
            <a style="padding:8px 16px;border-radius:8px;background:#0f766e;border:1px solid #0d5b54;color:#fff;font-weight:700;text-decoration:none;" href="/LuckBlox.site/home">Back to Home</a>
        </div>

        <?php if (!empty($errors)): ?>
            <div class="card" style="border-color:#fca5a5;">
                <div class="status error">
                    <?php foreach ($errors as $error): ?>
                        <div><?php echo htmlspecialchars($error); ?></div>
                    <?php endforeach; ?>
                </div>
            </div>
        <?php endif; ?>

        <?php if ($success): ?>
            <div class="card" style="border-color:#10b981;">
                <div class="status success"><?php echo htmlspecialchars($success); ?></div>
            </div>
        <?php endif; ?>

        <div class="settings-layout">
            <nav class="settings-menu" aria-label="Settings sections">
                <a class="active" href="#account">Account</a>
                <a href="#privacy">Privacy</a>
                <a href="#security">Security</a>
                <a href="#connections">Connections</a>
                <a href="/LuckBlox.site/help">Help</a>
            </nav>

            <main class="settings-content">
                <section class="settings-section" id="account">
                    <div class="settings-section-heading">
                        <h2>Account</h2>
                        <span class="settings-status">Signed in</span>
                    </div>

                    <form method="POST" action="/LuckBlox.site/settings/">
                        <input type="hidden" name="_csrf" value="<?php echo htmlspecialchars($csrfToken); ?>" />
                        <input type="hidden" name="action" value="save_profile" />

                        <label for="profileDisplayName">Display name</label>
                        <input type="text" id="profileDisplayName" name="displayName" maxlength="35"
                               value="<?php echo htmlspecialchars($user['displayName']); ?>" placeholder="Display name" />

                        <label for="profileBio">About</label>
                        <input type="text" id="profileBio" name="bio" maxlength="500"
                               value="<?php echo htmlspecialchars($user['bio']); ?>" placeholder="Tell people about yourself" />

                        <label for="profileTheme">Theme</label>
                        <select class="lb-select" id="profileTheme" name="theme">
                            <?php $themeVal = $user['theme'] ?? 'light'; ?>
                            <option value="light"<?php echo $themeVal === 'light' ? ' selected' : ''; ?>>Light</option>
                            <option value="dark"<?php echo $themeVal === 'dark' ? ' selected' : ''; ?>>Dark</option>
                        </select>

                        <button type="submit">Save profile</button>
                    </form>

                    <div class="settings-row">
                        <span>Username</span>
                        <strong><?php echo htmlspecialchars($username); ?></strong>
                    </div>
                    <div class="settings-row">
                        <span>Membership</span>
                        <span class="member-pill member-<?php echo $isAdmin ? 'admin' : strtolower($membership); ?>"><?php echo htmlspecialchars($membership); ?><?php if ($isAdmin): ?> (Admin)<?php endif; ?></span>
                    </div>
                    <div class="settings-row">
                        <span>Robux</span>
                        <strong>R$<?php echo $robux; ?></strong>
                    </div>
                    <div class="settings-row">
                        <span>User ID</span>
                        <code><?php echo $userId; ?></code>
                    </div>
                    <div class="settings-row">
                        <span>Join date</span>
                        <strong><?php echo htmlspecialchars($joinDate); ?></strong>
                    </div>
                </section>

                <section class="settings-section" id="privacy" style="margin-top:0;">
                    <div class="settings-section-heading"><h2>Privacy</h2></div>
                    <div class="settings-row"><span>Games</span><strong>Private</strong></div>
                    <div class="settings-row"><span>Profile</span><strong>Visible</strong></div>
                    <div class="settings-row"><span>Online status</span><strong>Online</strong></div>
                    <div class="settings-row"><span>Inventory</span><strong>Private</strong></div>
                </section>

                <section class="settings-section" id="security" style="margin-top:0;">
                    <div class="settings-section-heading"><h2>Security</h2></div>
                    <div class="settings-row">
                        <span>Password</span>
                        <strong><?php echo $user['password'] ? 'Set (PBKDF2-SHA512)' : 'Not set'; ?></strong>
                    </div>
                    <div class="settings-row"><span>Two-factor auth</span><strong>Not enabled</strong></div>
                    <div class="settings-row"><span>Active sessions</span><strong>1 session</strong></div>
                    <div class="settings-row"><span>Last password change</span><strong>Never</strong></div>

                    <div class="settings-section-heading" style="margin-top:16px;">
                        <h2>Change password</h2>
                    </div>
                    <form method="POST" action="/LuckBlox.site/settings/">
                        <input type="hidden" name="_csrf" value="<?php echo htmlspecialchars($csrfToken); ?>" />
                        <input type="hidden" name="action" value="change_password" />
                        <label for="currentPassword">Current password</label>
                        <input type="password" id="currentPassword" name="currentPassword" required />
                        <label for="newPassword">New password</label>
                        <input type="password" id="newPassword" name="newPassword" required />
                        <label for="confirmPassword">Confirm new password</label>
                        <input type="password" id="confirmPassword" name="confirmPassword" required />
                        <div style="font-size:0.8rem;color:#94a3b8;">At least 8 characters with lowercase, uppercase, and a number.</div>
                        <button type="submit">Update password</button>
                    </form>
                </section>

                <section class="settings-section" id="connections" style="margin-top:0;">
                    <div class="settings-section-heading"><h2>Connections</h2></div>
                    <div class="settings-row"><span>Server address</span><code><?php echo htmlspecialchars($ip); ?></code></div>
                    <div class="settings-row"><span>Game port</span><code><?php echo htmlspecialchars($hostPort); ?></code></div>
                    <div class="settings-row"><span>Client port</span><code><?php echo htmlspecialchars($clientPort); ?></code></div>
                    <div class="settings-row"><span>Server name</span><code><?php echo htmlspecialchars($serverName); ?></code></div>
                    <div class="settings-row"><span>Available games</span><code><?php echo $gamesCount; ?> games</code></div>
                    <div class="settings-row"><span>Installed maps</span><code><?php echo $mapsCount; ?> places</code></div>
                </section>
            </main>
        </div>
    </div>
    <script src="/lb-select.js"></script>
</body>
</html>
