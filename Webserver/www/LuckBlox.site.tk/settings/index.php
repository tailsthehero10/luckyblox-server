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

$settings = array(
    'username' => read_setting($settingsRoot . '/username.txt', 'default'),
    'membership' => read_setting($settingsRoot . '/membership.txt', 'None'),
    'ip' => read_setting($settingsRoot . '/ip.txt', '127.0.0.1'),
    'hostPort' => read_setting($settingsRoot . '/HostPort.txt', '53640'),
    'serverPort' => read_setting($settingsRoot . '/serverport.txt', '2005'),
    'clientPort' => read_setting($settingsRoot . '/clientport.txt', '53640'),
    'mapPath' => read_setting($settingsRoot . '/MapPath.txt', 'Not configured'),
);
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>Settings | LuckyBlox</title>
    <link rel="stylesheet" href="/style.css" />
</head>
<body>
    <div class="container settings-page">
        <div class="settings-heading">
            <div>
                <div class="settings-eyebrow">Account settings</div>
                <h1>Settings</h1>
                <p>Review the local account, server, and client configuration used by LuckyBlox.</p>
            </div>
            <a class="button secondary" href="/LuckBlox.site.tk/home">Back to Home</a>
        </div>

        <div class="settings-layout">
            <nav class="settings-menu" aria-label="Settings sections">
                <a class="active" href="#account">Account</a>
                <a href="#privacy">Privacy</a>
                <a href="#security">Security</a>
                <a href="#connections">Connections</a>
                <a href="/LuckBlox.site.tk/help">Help</a>
            </nav>

            <main class="settings-content">
                <section class="settings-section" id="account">
                    <div class="settings-section-heading">
                        <h2>Account</h2>
                        <span class="settings-status">Local account</span>
                    </div>
                    <div class="settings-row">
                        <span>Username</span>
                        <strong><?php echo htmlspecialchars($settings['username']); ?></strong>
                    </div>
                    <div class="settings-row">
                        <span>Membership</span>
                        <strong><?php echo htmlspecialchars($settings['membership']); ?></strong>
                    </div>
                </section>

                <section class="settings-section" id="privacy">
                    <div class="settings-section-heading"><h2>Privacy</h2></div>
                    <p>Local play, profile, and game data stay in this bundled LuckyBlox installation.</p>
                </section>

                <section class="settings-section" id="security">
                    <div class="settings-section-heading"><h2>Security</h2></div>
                    <div class="settings-row"><span>Authentication</span><strong>Local session</strong></div>
                    <div class="settings-row"><span>Transport</span><strong>HTTP localhost</strong></div>
                </section>

                <section class="settings-section" id="connections">
                    <div class="settings-section-heading"><h2>Connections</h2></div>
                    <?php foreach (array('ip' => 'Server address', 'hostPort' => 'Host port', 'serverPort' => 'Server port', 'clientPort' => 'Client port', 'mapPath' => 'Map path') as $key => $label): ?>
                        <div class="settings-row">
                            <span><?php echo htmlspecialchars($label); ?></span>
                            <code><?php echo htmlspecialchars($settings[$key]); ?></code>
                        </div>
                    <?php endforeach; ?>
                </section>
            </main>
        </div>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
