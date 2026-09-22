<?php
header('Location: /LuckBlox.site.tk/home/');
exit;

require_once __DIR__ . '/../api/common.php';

function read_setting($path, $default = '') {
    if (!file_exists($path)) {
        return $default;
    }

    $value = trim((string) file_get_contents($path));
    return $value !== '' ? $value : $default;
}

$rootPath = realpath(__DIR__ . '/../../../');
$settingsRoot = realpath($rootPath . '/Settings');
$mapsRoot = realpath($rootPath . '/Maps');

$baseUrl = function_exists('api_public_base_url') ? api_public_base_url() : '/';
$username = read_setting($settingsRoot . '/username.txt', 'default');
$membership = read_setting($settingsRoot . '/membership.txt', 'None');
$ip = function_exists('api_public_server_ip') ? api_public_server_ip() : read_setting($settingsRoot . '/ip.txt', '0.0.0.0');
$hostPort = function_exists('api_public_game_port') ? api_public_game_port() : read_setting($settingsRoot . '/HostPort.txt', '53640');
$serverPort = read_setting($settingsRoot . '/serverport.txt', '2005');
$clientPort = read_setting($settingsRoot . '/clientport.txt', '53640');
$mapPath = read_setting($settingsRoot . '/MapPath.txt', '');

$maps = array();
if (is_dir($mapsRoot)) {
    $maps = glob($mapsRoot . '/*');
}

$mapCount = count($maps);
$featuredPlaceId = api_get_latest_published_place_id();
$featuredMetadata = api_get_place_metadata($featuredPlaceId);
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>LuckyBlox Launcher Dashboard</title>
    <style>
        body {
            margin: 0;
            padding: 24px;
            font-family: Arial, Helvetica, sans-serif;
            background: #e5e7eb;
            color: #111827;
        }

        a {
            color: #1d4ed8;
            text-decoration: none;
        }

        a:hover {
            text-decoration: underline;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        .topbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            padding: 14px 18px;
            margin-bottom: 18px;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 12px;
            font-weight: 700;
            font-size: 1.1rem;
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }

        .brand-mark {
            width: 32px;
            height: 32px;
            border-radius: 6px;
            background: #1d4ed8;
            color: #fff;
            display: grid;
            place-items: center;
            font-size: 0.95rem;
        }

        .nav {
            display: flex;
            flex-wrap: wrap;
            gap: 14px;
            font-size: 0.9rem;
            color: #374151;
        }

        .hero {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            padding: 24px;
            margin-bottom: 20px;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
        }

        .eyebrow {
            display: inline-block;
            background: #dbeafe;
            color: #1d4ed8;
            border: 1px solid #93c5fd;
            border-radius: 4px;
            padding: 5px 8px;
            font-size: 0.75rem;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin-bottom: 10px;
        }

        h1 {
            margin: 0;
            font-size: 2.1rem;
            line-height: 1.2;
        }

        .subtitle {
            margin: 14px 0 0;
            max-width: 760px;
            color: #374151;
            font-size: 1rem;
        }

        .hero-actions {
            margin-top: 18px;
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }

        .button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 10px 16px;
            border-radius: 6px;
            background: #2563eb;
            border: 1px solid #1d4ed8;
            color: #ffffff;
            font-weight: 700;
        }

        .button.secondary {
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            color: #111827;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 18px;
            margin-bottom: 20px;
        }

        .card {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            padding: 18px;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
        }

        .label {
            color: #1d4ed8;
            font-size: 0.75rem;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin-bottom: 8px;
        }

        .value {
            font-weight: 700;
            font-size: 1.05rem;
        }

        .muted {
            color: #4b5563;
            margin-top: 6px;
            font-size: 0.9rem;
        }

        .content-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
        }

        .section-title {
            margin: 0 0 12px;
            font-size: 1.05rem;
        }

        ul {
            list-style: none;
            margin: 0;
            padding: 0;
        }

        li {
            margin: 8px 0;
            color: #374151;
        }

        code {
            background: #f3f4f6;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            padding: 3px 6px;
            font-size: 0.85rem;
            color: #111827;
        }

        .quick-links {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 16px;
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
                <a href="/LuckBlox.site.tk/">Dashboard</a>
                <a href="/LuckBlox.site.tk/games">Games</a>
                <a href="/LuckBlox.site.tk/play?placeid=1818">Play</a>
                <a href="/LuckBlox.site.tk/share">Share</a>
                <a href="/api/index.php">API</a>
                <a href="/backend/">Backend</a>
            </div>
        </div>

        <div class="hero">
            <div class="eyebrow">Public server play</div>
            <h1>Play the latest published game right from the live server.</h1>
            <p class="subtitle">
                LuckyBlox is now treated as a public-facing game site. The featured place below is the latest published game on this server, and it stays available for anyone to open, play, and share without the messy dashboard clutter.
            </p>
            <div class="hero-actions">
                <a class="button" href="/LuckBlox.site.tk/play?placeid=<?php echo (int) $featuredPlaceId; ?>">Play featured game</a>
                <a class="button secondary" href="/LuckBlox.site.tk/share">Open Share & Play</a>
                <a class="button secondary" href="/LuckBlox.site.tk/games">Browse games</a>
                <a class="button secondary" href="/api/launch.php?client=2021m">Launch local client</a>
            </div>
        </div>

        <div class="stats-grid">
            <div class="card">
                <div class="label">Featured game</div>
                <div class="value"><?php echo htmlspecialchars($featuredMetadata['name']); ?></div>
                <div class="muted">Place ID: <?php echo (int) $featuredMetadata['placeId']; ?> • Published: <?php echo $featuredMetadata['published'] ? 'Yes' : 'No'; ?></div>
            </div>
            <div class="card">
                <div class="label">Current account</div>
                <div class="value"><?php echo htmlspecialchars($username); ?></div>
                <div class="muted">Membership: <?php echo htmlspecialchars($membership); ?></div>
            </div>
            <div class="card">
                <div class="label">Installed maps</div>
                <div class="value"><?php echo intval($mapCount); ?> places</div>
                <div class="muted">Local map library ready for play</div>
            </div>
            <div class="card">
                <div class="label">Public server</div>
                <div class="value"><?php echo htmlspecialchars($ip); ?></div>
                <div class="muted">Host <?php echo htmlspecialchars($hostPort); ?> • Server <?php echo htmlspecialchars($serverPort); ?> • Client <?php echo htmlspecialchars($clientPort); ?></div>
            </div>
        </div>

        <div class="content-grid">
            <div class="card">
                <h2 class="section-title">Quick actions</h2>
                <div class="quick-links">
                    <a class="button secondary" href="/LuckBlox.site.tk/play?placeid=1818">Open Play</a>
                    <a class="button secondary" href="/LuckBlox.site.tk/share">Share & Play</a>
                    <a class="button secondary" href="/LuckBlox.site.tk/settings">Settings</a>
                    <a class="button secondary" href="/LuckBlox.site.tk/account">Account</a>
                    <a class="button secondary" href="/LuckBlox.site.tk/places">Places</a>
                </div>
            </div>

            <div class="card">
                <h2 class="section-title">Local server status</h2>
                <ul>
                    <li><strong>IP:</strong> <code><?php echo htmlspecialchars($ip); ?></code></li>
                    <li><strong>Map path:</strong> <code><?php echo htmlspecialchars($mapPath !== '' ? $mapPath : 'Not configured'); ?></code></li>
                    <li><strong>Project root:</strong> <code><?php echo htmlspecialchars($rootPath); ?></code></li>
                </ul>
            </div>

            <div class="card">
                <h2 class="section-title">Project-ready endpoints</h2>
                <ul>
                    <li><a href="/api/load.php?placeid=1818">Load saved place data</a></li>
                    <li><a href="/api/places.php?placeid=1818">View place metadata</a></li>
                    <li><a href="/api/save.php?placeid=1818">Save local place state</a></li>
                    <li><a href="/api/publish.php?placeid=1818">Publish place metadata</a></li>
                    <li><a href="/game/load-place-info/index.php?placeid=1818">Studio-compatible load-place-info</a></li>
                </ul>
            </div>

            <div class="card">
                <h2 class="section-title">API & tools</h2>
                <ul>
                    <li><a href="/api/health.php">Health API</a></li>
                    <li><a href="/api/stats.php">Stats API</a></li>
                    <li><a href="/api/version.php">Version API</a></li>
                    <li><a href="/api/services.php?placeid=1818">Services API</a></li>
                    <li><a href="/backend/">Backend</a></li>
                </ul>
            </div>
        </div>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
