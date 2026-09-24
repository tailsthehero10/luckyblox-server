<?php
$apiDocs = array(
    'GET /api/account.php' => 'Current account info',
    'GET /api/auth.php' => 'Local auth/session state',
    'POST /api/auth.php' => 'Update auth/session state',
    'GET /api/health.php' => 'Backend health status',
    'GET /api/version.php' => 'Backend version and endpoint summary',
    'GET /api/stats.php' => 'Usage statistics summary',
    'GET /api/games.php?placeid=1818' => 'List local games and place metadata',
    'GET /api/instance.php?placeid=1818' => 'Get local instance information',
    'GET /api/users.php' => 'List local users/accounts',
    'GET /LuckBlox.site/signin' => 'Local sign-in page',
    'GET /LuckBlox.site/signup' => 'Local sign-up page',
    'GET /api/launch.php?client=2021m' => 'Launch the bundled local client',
    'GET /api/player.php?placeid=1818' => 'Load local player state',
    'GET /api/load.php?placeid=1818' => 'Load saved place state',
    'POST /api/save.php?placeid=1818' => 'Save place state',
    'GET /api/spawn.php?placeid=1818' => 'Load spawn configuration',
    'GET /api/chatfilter.php?placeid=1818' => 'Load chat filter state',
    'POST /api/chatfilter.php?placeid=1818' => 'Update chat filter state',
    'GET /api/text.php?placeid=1818' => 'Load text messages',
    'POST /api/text.php?placeid=1818' => 'Save text message payloads',
    'GET /api/services.php?placeid=1818' => 'List all available service-style APIs',
    'GET /api/services.php?placeid=1818&service=Players' => 'Players service details',
    'GET /api/services.php?placeid=1818&service=GameService' => 'GameService details',
    'GET /api/services.php?placeid=1818&service=SpawnService' => 'SpawnService details',
    'GET /api/services.php?placeid=1818&service=ChatService' => 'ChatService details',
    'GET /api/services.php?placeid=1818&service=MarketplaceService' => 'MarketplaceService details',
    'GET /api/services.php?placeid=1818&service=AccountService' => 'AccountService details',
    'GET /api/services.php?placeid=1818&service=AuthService' => 'AuthService details',
    'GET /api/services.php?placeid=1818&service=GamesService' => 'GamesService details',
    'GET /api/services.php?placeid=1818&service=InstanceService' => 'InstanceService details',
    'GET /api/services.php?placeid=1818&service=UsersService' => 'UsersService details',
    'GET /api/places.php?placeid=1818' => 'Place metadata',
    'POST /api/publish.php?placeid=1818' => 'Publish a place',
    'GET /game/load-place-info/index.php?placeid=1818' => 'Studio compatible load-place-info',
    'GET /game/players/1/index.php?placeid=1818' => 'Local player runtime payload',
);
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>API Docs</title>
    <style>
        body { font-family: Arial, sans-serif; background: #020617; color: #e2e8f0; margin: 0; padding: 40px; }
        .container { max-width: 1000px; margin: 0 auto; }
        .card { background: #111827; border: 1px solid #334155; border-radius: 12px; padding: 20px; }
        h1 { margin-bottom: 12px; }
        ul { margin: 0; padding-left: 18px; }
        li { margin: 10px 0; }
        a { color: #7dd3fc; }
        code { background: rgba(148, 163, 184, 0.12); padding: 2px 6px; border-radius: 4px; }
    </style>
    <link rel="stylesheet" href="/style.css" />
</head>
<body>
    <div class="container">
        <h1>API Documentation</h1>

        <div class="card">
            <ul>
                <?php foreach ($apiDocs as $route => $description): ?>
                    <li><code><?php echo htmlspecialchars($route); ?></code> — <?php echo htmlspecialchars($description); ?></li>
                <?php endforeach; ?>
            </ul>
        </div>

        <p><a href="/LuckBlox.site/">Back to dashboard</a></p>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
