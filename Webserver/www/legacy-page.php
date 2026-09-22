<?php
require_once __DIR__ . '/api/common.php';

$page = isset($_GET['page']) ? preg_replace('/[^a-z0-9-]/i', '', (string) $_GET['page']) : 'home';
$account = api_get_current_account();
$placeId = (int) api_get_latest_published_place_id();
$metadata = api_get_place_metadata($placeId);
$settingsRoot = api_settings_root();

$pages = array(
    'catalog' => array('Catalog', 'Browse the local asset catalog and installed place library.', '/LuckBlox.site.tk/games'),
    'develop' => array('Develop', 'Open the local creation and publishing tools.', '/LuckBlox.site.tk/quickstart'),
    'avatar' => array('Avatar', 'Open the account avatar and appearance area.', '/LuckBlox.site.tk/profile'),
    'inventory' => array('Inventory', 'Review account-owned local items and appearance data.', '/LuckBlox.site.tk/profile'),
    'friends' => array('Friends', 'Open the local user directory and account connections.', '/LuckBlox.site.tk/users'),
    'followers' => array('Followers', 'Open the local user directory and account connections.', '/LuckBlox.site.tk/users'),
    'following' => array('Following', 'Open the local user directory and account connections.', '/LuckBlox.site.tk/users'),
    'messages' => array('Messages', 'Open the account communication area.', '/LuckBlox.site.tk/account'),
    'groups' => array('Groups', 'Open group and community routes available in this local installation.', '/LuckBlox.site.tk/about'),
    'robux' => array('Robux', 'Open the account and local currency information page.', '/LuckBlox.site.tk/account'),
    'login' => array('Log In', 'Sign in to the local account system.', '/LuckBlox.site.tk/signin'),
    'logout' => array('Log Out', 'Return to the local account entry point.', '/LuckBlox.site.tk/signin'),
    'notifications' => array('Notifications', 'Open account status and service information.', '/LuckBlox.site.tk/account'),
    'search' => array('Search', 'Search the installed local games catalog.', '/LuckBlox.site.tk/games'),
    'badges' => array('Badges', 'Open the local profile and achievement area.', '/LuckBlox.site.tk/profile'),
    'transactions' => array('Transactions', 'Open account information and local activity details.', '/LuckBlox.site.tk/account'),
    'premium' => array('Premium', 'Open local membership information.', '/LuckBlox.site.tk/account'),
    'download' => array('Download', 'Open the local client and launcher information.', '/LuckBlox.site.tk/quickstart'),
    'install' => array('Install', 'Open launcher setup and connection information.', '/LuckBlox.site.tk/quickstart'),
    'discover' => array('Discover', 'Browse the local games discovery page.', '/LuckBlox.site.tk/games'),
    'create' => array('Create', 'Open the local creation and publishing tools.', '/LuckBlox.site.tk/quickstart'),
    'events' => array('Events', 'Open platform information for this local installation.', '/LuckBlox.site.tk/about'),
    'giftcards' => array('Gift Cards', 'Open platform information for this local installation.', '/LuckBlox.site.tk/about'),
    'careers' => array('Careers', 'Open platform information for this local installation.', '/LuckBlox.site.tk/about'),
    'jobs' => array('Jobs', 'Open platform information for this local installation.', '/LuckBlox.site.tk/about'),
    'blog' => array('Blog', 'Open platform information and available routes.', '/LuckBlox.site.tk/about'),
    'privacy' => array('Privacy', 'Review local account and server behavior.', '/LuckBlox.site.tk/about'),
    'terms' => array('Terms', 'Review local platform behavior and service boundaries.', '/LuckBlox.site.tk/about'),
    'parents' => array('Parents', 'Review local platform and account information.', '/LuckBlox.site.tk/help'),
    'accessibility' => array('Accessibility', 'Review local platform and account information.', '/LuckBlox.site.tk/help'),
    'contact' => array('Contact', 'Open local help and troubleshooting information.', '/LuckBlox.site.tk/help'),
    'support' => array('Support', 'Open local help and troubleshooting information.', '/LuckBlox.site.tk/help'),
);

$definition = isset($pages[$page]) ? $pages[$page] : array(ucfirst($page), 'This route is available in the local LuckyBlox portal.', '/LuckBlox.site.tk/');
$title = $definition[0];
$destination = $definition[2];
$description = $definition[1];
$baseLinks = array(
    array('Home', '/LuckBlox.site.tk/home'),
    array('Games', '/LuckBlox.site.tk/games'),
    array('Catalog', '/LuckBlox.site.tk/catalog'),
    array('Avatar', '/LuckBlox.site.tk/avatar'),
    array('Develop', '/LuckBlox.site.tk/develop'),
    array('Profile', '/LuckBlox.site.tk/users/1/profile'),
    array('Friends', '/LuckBlox.site.tk/friends'),
    array('Messages', '/LuckBlox.site.tk/messages'),
    array('Robux', '/LuckBlox.site.tk/robux'),
    array('Log In', '/LuckBlox.site.tk/signin'),
    array('Create account', '/LuckBlox.site.tk/signup'),
);
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title><?php echo htmlspecialchars($title); ?> | LuckyBlox</title>
    <link rel="stylesheet" href="/style.css" />
</head>
<body>
    <div class="page">
        <div class="topbar">
            <div class="brand"><div class="brand-mark">L</div><span>LuckyBlox</span></div>
            <nav class="nav" aria-label="Main navigation">
                <?php foreach ($baseLinks as $link): ?>
                    <a href="<?php echo htmlspecialchars($link[1]); ?>"><?php echo htmlspecialchars($link[0]); ?></a>
                <?php endforeach; ?>
            </nav>
        </div>

        <main class="hero">
            <div class="eyebrow">Local route</div>
            <h1><?php echo htmlspecialchars($title); ?></h1>
            <p class="subtitle"><?php echo htmlspecialchars($description); ?></p>
            <div class="button-row">
                <a class="button" href="<?php echo htmlspecialchars($destination); ?>">Open <?php echo htmlspecialchars($title); ?></a>
                <a class="button secondary" href="/LuckBlox.site.tk/home">Home</a>
                <a class="button secondary" href="/LuckBlox.site.tk/help">Help</a>
            </div>
        </main>

        <section class="content-grid">
            <div class="card">
                <div class="label">Signed-in account</div>
                <div class="value"><?php echo htmlspecialchars($account['username']); ?></div>
                <p class="muted">Account data is loaded from the local settings and account files.</p>
                <a class="button secondary" href="/LuckBlox.site.tk/account">Account details</a>
            </div>
            <div class="card">
                <div class="label">Published place</div>
                <div class="value"><?php echo htmlspecialchars($metadata['name']); ?></div>
                <p class="muted">Place ID: <?php echo $placeId; ?>. The local game route remains available.</p>
                <a class="button secondary" href="/LuckBlox.site.tk/game?placeid=<?php echo $placeId; ?>">Game details</a>
            </div>
            <div class="card">
                <div class="label">Local route map</div>
                <ul>
                    <li><a href="/LuckBlox.site.tk/games">Games</a></li>
                    <li><a href="/LuckBlox.site.tk/play?placeid=<?php echo $placeId; ?>">Play</a></li>
                    <li><a href="/LuckBlox.site.tk/settings">Settings</a></li>
                    <li><a href="/api/index.php">API</a></li>
                </ul>
            </div>
        </section>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
