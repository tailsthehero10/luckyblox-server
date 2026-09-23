<?php
require_once __DIR__ . '/../../api/common.php';

function read_setting($path, $default = '') {
    if (!file_exists($path)) {
        return $default;
    }

    $value = trim((string) file_get_contents($path));
    return $value !== '' ? $value : $default;
}

$rootPath = realpath(__DIR__ . '/../../../../');
$settingsRoot = realpath($rootPath . '/Settings');
$mapsRoot = realpath($rootPath . '/Maps');

$username = read_setting($settingsRoot . '/username.txt', 'default');
$membership = read_setting($settingsRoot . '/membership.txt', 'None');
$ip = read_setting($settingsRoot . '/ip.txt', '127.0.0.1');
$hostPort = read_setting($settingsRoot . '/HostPort.txt', '53640');
$serverPort = read_setting($settingsRoot . '/serverport.txt', '2005');
$clientPort = read_setting($settingsRoot . '/clientport.txt', '53640');
$mapPath = read_setting($settingsRoot . '/MapPath.txt', '');

$featuredPlaceId = api_get_latest_published_place_id();
$featuredMetadata = api_get_place_metadata($featuredPlaceId);

$maps = array();
if (is_dir($mapsRoot)) {
    $maps = array_values(array_filter(glob($mapsRoot . '/*'), function($file) {
        return is_file($file);
    }));
}

usort($maps, function($a, $b) {
    return strcasecmp(basename($a), basename($b));
});
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LuckyBlox | Home</title>
    <style>
        :root {
            --bg: #0b0f17;
            --bg-2: #111b2b;
            --panel: rgba(18, 26, 37, 0.95);
            --panel-strong: #141c2a;
            --panel-soft: #1b2637;
            --line: rgba(255,255,255,0.08);
            --text: #edf4ff;
            --muted: #a8b5c9;
            --blue: #4ca3ff;
            --blue-2: #7dd3fc;
            --blue-3: #1d4ed8;
            --green: #37d39a;
            --orange: #ffb454;
            --shadow: 0 18px 42px rgba(0,0,0,0.42);
        }

        * { box-sizing: border-box; }

        body {
            margin: 0;
            font-family: "Segoe UI", Arial, sans-serif;
            background:
                radial-gradient(circle at top, rgba(76, 163, 255, 0.18), transparent 28%),
                linear-gradient(180deg, var(--bg) 0%, #0f1724 100%);
            color: var(--text);
        }

        a { color: var(--text); text-decoration: none; }
        a:hover { text-decoration: none; }

        .page {
            max-width: 1280px;
            margin: 0 auto;
            padding: 20px 18px 48px;
        }

        .topbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            background: rgba(17, 24, 39, 0.9);
            border: 1px solid var(--line);
            border-radius: 16px;
            padding: 16px 20px;
            box-shadow: var(--shadow);
            position: sticky;
            top: 12px;
            z-index: 5;
            backdrop-filter: blur(8px);
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 1.2rem;
            font-weight: 800;
            letter-spacing: 0.06em;
            text-transform: uppercase;
        }

        .brand-mark {
            width: 34px;
            height: 34px;
            border-radius: 10px;
            background: linear-gradient(135deg, var(--blue), var(--blue-3));
            display: grid;
            place-items: center;
            box-shadow: 0 10px 22px rgba(59,130,246,0.45);
        }

        .nav {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: center;
            gap: 14px;
            font-size: 0.9rem;
            color: var(--muted);
        }

        .nav a {
            color: var(--muted);
            padding: 8px 12px;
            border-radius: 10px;
            transition: 0.15s ease;
        }

        .nav a:hover {
            background: rgba(255,255,255,0.03);
            color: var(--text);
        }

        .nav .active {
            background: rgba(76, 163, 255, 0.12);
            color: var(--text);
            border: 1px solid rgba(76, 163, 255, 0.3);
        }

        .hero {
            display: grid;
            grid-template-columns: 1.1fr 0.9fr;
            gap: 26px;
            margin-top: 24px;
            padding: 28px;
            border: 1px solid var(--line);
            border-radius: 22px;
            background: linear-gradient(135deg, rgba(18,26,37,0.96), rgba(14,22,34,0.96));
            box-shadow: var(--shadow);
        }

        .hero-copy {
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 16px;
        }

        .badge {
            display: inline-flex;
            align-items: center;
            width: fit-content;
            padding: 7px 12px;
            border-radius: 999px;
            font-size: 0.74rem;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            font-weight: 700;
            background: rgba(76,163,255,0.12);
            border: 1px solid rgba(76,163,255,0.35);
            color: var(--blue-2);
        }

        h1 {
            margin: 0;
            font-size: clamp(2.2rem, 4vw, 4rem);
            line-height: 1.02;
            letter-spacing: -0.06em;
        }

        .subtitle {
            margin: 0;
            max-width: 700px;
            color: var(--muted);
            font-size: 1.05rem;
            line-height: 1.7;
        }

        .cta-row {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-top: 6px;
        }

        .button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 13px 20px;
            border-radius: 12px;
            font-weight: 800;
            border: 1px solid transparent;
            transition: 0.15s ease;
        }

        .button.primary {
            background: linear-gradient(135deg, var(--blue-2), var(--blue));
            color: #06161f;
            box-shadow: 0 12px 24px rgba(76,163,255,0.36);
        }

        .button.secondary {
            background: rgba(255,255,255,0.03);
            color: var(--text);
            border-color: var(--line);
        }

        .button:hover {
            transform: translateY(-1px);
            filter: brightness(1.04);
        }

        .hero-visual {
            display: flex;
            align-items: stretch;
            justify-content: center;
        }

        .featured-card {
            width: 100%;
            min-height: 340px;
            border-radius: 18px;
            border: 1px solid var(--line);
            background:
                linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)),
                url('https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=80') center/cover no-repeat;
            position: relative;
            overflow: hidden;
            box-shadow: var(--shadow);
        }

        .featured-overlay {
            position: absolute;
            inset: 0;
            background: linear-gradient(180deg, rgba(6,11,20,0.25), rgba(6,11,20,0.82));
            display: flex;
            flex-direction: column;
            justify-content: flex-end;
            padding: 24px;
        }

        .featured-title {
            font-size: clamp(1.5rem, 2vw, 2.4rem);
            font-weight: 800;
            margin: 0 0 6px;
            letter-spacing: -0.04em;
        }

        .featured-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            color: var(--muted);
            font-size: 0.9rem;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(180px, 1fr));
            gap: 18px;
            margin-top: 26px;
        }

        .stat-card, .panel, .spotlight {
            background: rgba(17, 24, 39, 0.9);
            border: 1px solid var(--line);
            border-radius: 18px;
            box-shadow: var(--shadow);
        }

        .stat-card {
            padding: 18px 18px 16px;
        }

        .stat-label {
            display: block;
            color: var(--blue-2);
            text-transform: uppercase;
            letter-spacing: 0.08em;
            font-size: 0.72rem;
            font-weight: 700;
            margin-bottom: 10px;
        }

        .stat-value {
            font-size: clamp(1.2rem, 2vw, 2rem);
            font-weight: 800;
            letter-spacing: -0.04em;
            margin-bottom: 6px;
        }

        .stat-muted {
            color: var(--muted);
            font-size: 0.9rem;
            line-height: 1.5;
        }

        .content-grid {
            display: grid;
            grid-template-columns: 1.2fr 0.8fr;
            gap: 22px;
            margin-top: 26px;
        }

        .panel {
            padding: 20px;
        }

        .panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 18px;
        }

        .panel-title {
            margin: 0;
            font-size: 1.1rem;
            letter-spacing: -0.02em;
        }

        .pill {
            display: inline-flex;
            align-items: center;
            padding: 6px 10px;
            border-radius: 999px;
            font-size: 0.72rem;
            font-weight: 700;
            background: rgba(55,211,154,0.12);
            color: var(--green);
            border: 1px solid rgba(55,211,154,0.28);
        }

        .game-list {
            display: grid;
            grid-template-columns: repeat(2, minmax(180px, 1fr));
            gap: 14px;
        }

        .game-item {
            background: rgba(255,255,255,0.02);
            border: 1px solid var(--line);
            border-radius: 14px;
            padding: 12px;
        }

        .game-thumb {
            height: 120px;
            border-radius: 12px;
            background: linear-gradient(135deg, rgba(76,163,255,0.26), rgba(29,78,216,0.18));
            border: 1px solid var(--line);
            margin-bottom: 12px;
        }

        .game-item h3 {
            margin: 0 0 6px;
            font-size: 1rem;
        }

        .game-item p {
            margin: 0 0 12px;
            color: var(--muted);
            font-size: 0.86rem;
            line-height: 1.5;
        }

        .game-links {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            color: var(--muted);
            font-size: 0.82rem;
        }

        .mini-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 8px 12px;
            border-radius: 10px;
            background: rgba(76,163,255,0.12);
            color: var(--text);
            border: 1px solid rgba(76,163,255,0.25);
            font-weight: 700;
        }

        .links-list {
            list-style: none;
            padding: 0;
            margin: 0;
            display: grid;
            gap: 12px;
        }

        .links-list li {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            border: 1px solid var(--line);
            background: rgba(255,255,255,0.02);
            border-radius: 12px;
            padding: 12px 14px;
            color: var(--muted);
        }

        .links-list strong {
            color: var(--text);
            font-weight: 700;
        }

        .spotlight-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(180px, 1fr));
            gap: 18px;
            margin-top: 26px;
        }

        .spotlight {
            padding: 16px;
        }

        .spotlight-icon {
            width: 46px;
            height: 46px;
            display: grid;
            place-items: center;
            border-radius: 12px;
            font-weight: 800;
            margin-bottom: 14px;
            background: rgba(76,163,255,0.14);
            border: 1px solid rgba(76,163,255,0.35);
            color: var(--blue-2);
        }

        .spotlight h3 {
            margin: 0 0 8px;
            font-size: 1rem;
        }

        .spotlight p {
            margin: 0 0 12px;
            color: var(--muted);
            line-height: 1.6;
            font-size: 0.88rem;
        }

        @media (max-width: 980px) {
            .hero, .content-grid {
                grid-template-columns: 1fr;
            }

            .stats-grid {
                grid-template-columns: repeat(2, minmax(180px, 1fr));
            }

            .spotlight-grid {
                grid-template-columns: repeat(2, minmax(180px, 1fr));
            }
        }

        @media (max-width: 620px) {
            .topbar {
                flex-direction: column;
                align-items: flex-start;
            }

            .nav {
                justify-content: flex-start;
            }

            .stats-grid, .game-list, .spotlight-grid {
                grid-template-columns: 1fr;
            }

            .page {
                padding-left: 14px;
                padding-right: 14px;
            }
        }
    </style>
    <link rel="stylesheet" href="/style.css" />
</head>
<body>
    <div class="page">
        <header class="topbar">
            <div class="brand">
                <div class="brand-mark">L</div>
                <span>LuckyBlox</span>
            </div>

            <nav class="nav" aria-label="Main navigation">
                <a class="active" href="/LuckBlox.site.tk/home">Home</a>
                <a href="/LuckBlox.site.tk/games">Games</a>
                <a href="/LuckBlox.site.tk/game?placeid=<?php echo (int) $featuredPlaceId; ?>">Game</a>
                <a href="/LuckBlox.site.tk/users/1/profile">Profile</a>
                <a href="/LuckBlox.site.tk/settings">Settings</a>
                <a href="/LuckBlox.site.tk/share">Share</a>
                <a href="/LuckBlox.site.tk/about">About</a>
                <a href="/LuckBlox.site.tk/signin">Log In</a>
                <a href="/LuckBlox.site.tk/signup">Sign Up</a>
            </nav>
        </header>

        <section class="hero">
            <div class="hero-copy">
                <span class="badge">Public home</span>
                <h1>Build, play, and launch your next favorite local game.</h1>
                <p class="subtitle">
                    LuckyBlox is running as a local Roblox-style platform at the canonical public route <strong>http://localhost/LuckBlox.site.tk</strong>.
                    Browse the live catalog, jump into the featured place, and launch directly from the local portal.
                </p>
                <div class="cta-row">
                    <a class="button primary" href="/LuckBlox.site.tk/play?placeid=<?php echo (int) $featuredPlaceId; ?>">Play featured game</a>
                    <a class="button secondary" href="/LuckBlox.site.tk/games">Browse all games</a>
                    <a class="button secondary" href="/LuckBlox.site.tk/share">Share &amp; play</a>
                </div>
            </div>

            <div class="hero-visual">
                <div class="featured-card">
                    <div class="featured-overlay">
                        <h2 class="featured-title"><?php echo htmlspecialchars($featuredMetadata['name']); ?></h2>
                        <div class="featured-meta">
                            <span>Place ID <?php echo (int) $featuredMetadata['placeId']; ?></span>
                            <span>•</span>
                            <span>Published</span>
                            <span>•</span>
                            <span>Local server ready</span>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <section class="stats-grid">
            <div class="stat-card">
                <span class="stat-label">Featured game</span>
                <div class="stat-value"><?php echo htmlspecialchars($featuredMetadata['name']); ?></div>
                <div class="stat-muted">Place ID <?php echo (int) $featuredMetadata['placeId']; ?> • Active local play route</div>
            </div>

            <div class="stat-card">
                <span class="stat-label">Account</span>
                <div class="stat-value"><?php echo htmlspecialchars($username); ?></div>
                <div class="stat-muted">Membership: <?php echo htmlspecialchars($membership); ?></div>
            </div>

            <div class="stat-card">
                <span class="stat-label">Maps</span>
                <div class="stat-value"><?php echo intval(count($maps)); ?></div>
                <div class="stat-muted">Installed local worlds ready for launch</div>
            </div>

            <div class="stat-card">
                <span class="stat-label">Public server</span>
                <div class="stat-value"><?php echo htmlspecialchars($ip); ?></div>
                <div class="stat-muted">Host <?php echo htmlspecialchars($hostPort); ?> • Client <?php echo htmlspecialchars($clientPort); ?></div>
            </div>
        </section>

        <section class="content-grid">
            <div class="panel">
                <div class="panel-header">
                    <h2 class="panel-title">Popular worlds</h2>
                    <span class="pill">Live</span>
                </div>

                <div class="game-list">
                    <?php
                    $gamePreview = array_slice($maps, 0, 4);
                    foreach ($gamePreview as $index => $mapFile) {
                        $base = basename($mapFile, '.rbxl');
                        $gameId = 1818 + $index;
                    ?>
                    <div class="game-item">
                        <div class="game-thumb"></div>
                        <h3><?php echo htmlspecialchars(str_replace('_', ' ', $base)); ?></h3>
                        <p>Community-made local world with a playable launch flow and public access route.</p>
                        <div class="game-links">
                            <span>World <?php echo (int) $gameId; ?></span>
                            <a class="mini-button" href="/LuckBlox.site.tk/play?placeid=<?php echo (int) $gameId; ?>">Play</a>
                        </div>
                    </div>
                    <?php } ?>
                </div>
            </div>

            <div class="panel">
                <div class="panel-header">
                    <h2 class="panel-title">Quick links</h2>
                </div>

                <ul class="links-list">
                    <li><strong>Featured place</strong><a href="/LuckBlox.site.tk/play?placeid=<?php echo (int) $featuredPlaceId; ?>">Open</a></li>
                    <li><strong>Games catalog</strong><a href="/LuckBlox.site.tk/games">View</a></li>
                    <li><strong>Profile</strong><a href="/LuckBlox.site.tk/users/1/profile">Open</a></li>
                    <li><strong>Settings</strong><a href="/LuckBlox.site.tk/settings">Inspect</a></li>
                    <li><strong>Share &amp; play</strong><a href="/LuckBlox.site.tk/share">Open</a></li>
                </ul>
            </div>
        </section>

        <section class="spotlight-grid">
            <div class="spotlight">
                <div class="spotlight-icon">1</div>
                <h3>Featured place</h3>
                <p>Jump directly into the most recent published user-facing game on the local server.</p>
                <a class="mini-button" href="/LuckBlox.site.tk/play?placeid=<?php echo (int) $featuredPlaceId; ?>">Launch</a>
            </div>

            <div class="spotlight">
                <div class="spotlight-icon">2</div>
                <h3>Browse worlds</h3>
                <p>Explore the public catalog, discover active local experiences, and open each title instantly.</p>
                <a class="mini-button" href="/LuckBlox.site.tk/games">Open catalog</a>
            </div>

            <div class="spotlight">
                <div class="spotlight-icon">3</div>
                <h3>Share</h3>
                <p>Use the built-in share flow for quick links and public game discovery from the main site.</p>
                <a class="mini-button" href="/LuckBlox.site.tk/share">Share</a>
            </div>

            <div class="spotlight">
                <div class="spotlight-icon">4</div>
                <h3>Profile</h3>
                <p>Review identity, membership, and public profile information from the main portal.</p>
                <a class="mini-button" href="/LuckBlox.site.tk/users/1/profile">Profile</a>
            </div>
        </section>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
