<?php
require_once __DIR__ . '/../api/common.php';

$backendLinks = array(
    '/api/health.php' => 'Health check',
    '/api/version.php' => 'Backend version',
    '/api/stats.php' => 'Usage statistics',
    '/api/services.php?placeid=1818' => 'Service catalog',
    '/api/places.php' => 'Places listing',
    '/api/account.php' => 'Account API',
    '/api/load.php?placeid=1818' => 'Load API',
    '/api/save.php?placeid=1818' => 'Save API',
    '/api/publish.php?placeid=1818' => 'Publish API',
    '/game/load-place-info/index.php?placeid=1818' => 'Studio load-place-info',
    '/LuckBlox.site.tk/' => 'Main dashboard',
);
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>LuckyBlox Launcher Backend</title>
    <style>
        body { font-family: Arial, sans-serif; background: #020617; color: #e2e8f0; margin: 0; padding: 32px; }
        .container { max-width: 1100px; margin: 0 auto; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; }
        .card { background: #111827; border: 1px solid #334155; border-radius: 12px; padding: 20px; }
        h1, h2 { margin-top: 0; }
        ul { margin: 0; padding-left: 18px; }
        li { margin: 8px 0; }
        a { color: #7dd3fc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
    <link rel="stylesheet" href="/style.css" />
</head>
<body>
    <div class="container">
        <h1>LuckyBlox Launcher Backend</h1>
        <p>Full local backend shell for place metadata, publish flow, service discovery, stats, and gameplay data APIs.</p>

        <div class="grid">
            <div class="card">
                <h2>Core backend routes</h2>
                <ul>
                    <?php foreach ($backendLinks as $url => $label): ?>
                        <li><a href="<?php echo htmlspecialchars($url); ?>"><?php echo htmlspecialchars($label); ?></a></li>
                    <?php endforeach; ?>
                </ul>
            </div>

            <div class="card">
                <h2>Service groups</h2>
                <ul>
                    <li>Account Service</li>
                    <li>Players Service</li>
                    <li>Game Service</li>
                    <li>Spawn Service</li>
                    <li>Chat Service</li>
                    <li>Marketplace Service</li>
                </ul>
            </div>
        </div>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
