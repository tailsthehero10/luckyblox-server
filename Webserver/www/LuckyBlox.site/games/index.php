<?php
require_once __DIR__ . '/../../api/common.php';

$rootPath = realpath(__DIR__ . '/../../../');
$mapsRoot = realpath($rootPath . '/Maps');
$settingsRoot = realpath($rootPath . '/Settings');

$placeId = isset($_GET['placeid']) ? preg_replace('/[^0-9]/', '', (string) $_GET['placeid']) : '';

$placeFiles = array();
if (is_dir($mapsRoot)) {
    $placeFiles = array_values(array_filter(glob($mapsRoot . '/*'), function($file) {
        return is_file($file);
    }));
}

usort($placeFiles, function($a, $b) {
    return strcasecmp(basename($a), basename($b));
});

$metadata = $placeId !== '' ? api_get_place_metadata($placeId) : null;
$featuredPlaceId = api_get_latest_published_place_id();
$featuredMetadata = api_get_place_metadata($featuredPlaceId);
$totalPlaces = count($placeFiles);
$publishedCount = is_dir($settingsRoot . '/published') ? count(glob($settingsRoot . '/published/*.json')) : 0;
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>LuckyBlox Games</title>
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
        .container { max-width: 1200px; margin: 0 auto; }
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
            box-shadow: 0 1px 2px rgba(0,0,0,0.08);
        }
        .brand { display:flex; align-items:center; gap:12px; font-weight:700; font-size:1.05rem; text-transform:uppercase; }
        .brand-mark {
            width: 32px; height: 32px; border-radius: 6px; background: #1d4ed8; color: #fff;
            display: grid; place-items: center; font-size: 0.95rem;
        }
        .nav { display:flex; flex-wrap:wrap; gap:14px; font-size:0.9rem; }
        .hero, .card, .selected-card {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            padding: 22px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.08);
        }
        .hero { margin-bottom: 20px; }
        .eyebrow {
            display:inline-block; background:#dbeafe; color:#1d4ed8; border:1px solid #93c5fd;
            border-radius:4px; padding:5px 8px; font-size:0.75rem; font-weight:700;
            letter-spacing:0.08em; text-transform:uppercase; margin-bottom:10px;
        }
        h1, h2, h3 { margin-top: 0; }
        .subtitle { margin:14px 0 0; max-width:780px; color:#374151; }
        .button-row { display:flex; flex-wrap:wrap; gap:10px; margin-top:18px; }
        .button {
            display:inline-flex; align-items:center; justify-content:center;
            padding:10px 16px; border-radius:6px; background:#2563eb; border:1px solid #1d4ed8;
            color:#ffffff; font-weight:700;
        }
        .button.secondary { background:#f8fafc; border:1px solid #cbd5e1; color:#111827; }
        .button.warning { background:#a16207; border:1px solid #92400e; }
        .stats-grid {
            display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));
            gap:18px; margin-bottom:20px;
        }
        .label {
            color:#1d4ed8; font-size:0.75rem; font-weight:700; letter-spacing:0.08em;
            text-transform:uppercase; margin-bottom:8px;
        }
        .value { font-weight:700; font-size:1.05rem; }
        .muted { color:#4b5563; margin-top:6px; font-size:0.9rem; }
        .selected-card { margin-bottom: 22px; }
        .list-grid {
            display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));
            gap:22px;
            margin-top:20px;
        }
        .place-card { background:#fff; border:1px solid #cbd5e1; border-radius:8px; padding:18px; }
        .place-name { margin: 12px 0 8px; font-size: 1.1rem; }
        .meta { color:#1d4ed8; font-size:0.75rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; }
        .place-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
        ul { margin:0; padding-left:18px; }
        li { margin:8px 0; color:#374151; }
        code { background:#f3f4f6; border:1px solid #d1d5db; border-radius:4px; padding:3px 6px; color:#111827; }
        .pill {
            display:inline-block; padding:4px 8px; border-radius:999px; background:rgba(34,197,94,0.15);
            color:#166534; font-size:0.8rem; font-weight:700;
        }
        .footer {
            margin-top: 24px; padding-top: 16px; border-top: 1px solid #cbd5e1; color:#4b5563;
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
            <div class="eyebrow">Games portal</div>
            <h1>LuckyBlox games catalog</h1>
            <p class="subtitle">
                Browse the local library, inspect metadata for any place, jump to the featured public game, and open the latest published title directly from this classic-style catalog.
            </p>
            <div class="button-row">
                <a class="button" href="/LuckBlox.site.tk/play?placeid=<?php echo (int) $featuredPlaceId; ?>">Play featured game</a>
                <a class="button secondary" href="/LuckBlox.site.tk/games?placeid=<?php echo (int) $featuredPlaceId; ?>">Open featured details</a>
                <a class="button secondary" href="/LuckBlox.site.tk/share">Share &amp; Play</a>
            </div>
        </div>

        <div class="stats-grid">
            <div class="card">
                <div class="label">Featured place</div>
                <div class="value"><?php echo htmlspecialchars($featuredMetadata['name']); ?></div>
                <div class="muted">Place ID: <?php echo (int) $featuredMetadata['placeId']; ?></div>
            </div>
            <div class="card">
                <div class="label">Installed games</div>
                <div class="value"><?php echo (int) $totalPlaces; ?></div>
                <div class="muted">Maps available from the local library</div>
            </div>
            <div class="card">
                <div class="label">Published</div>
                <div class="value"><?php echo (int) $publishedCount; ?></div>
                <div class="muted">Published place metadata records</div>
            </div>
            <div class="card">
                <div class="label">Public play</div>
                <div class="value"><?php echo $featuredMetadata['published'] ? 'Live' : 'Offline'; ?></div>
                <div class="muted">Featured game status on the local server</div>
            </div>
        </div>

        <?php if ($metadata !== null): ?>
            <div class="selected-card">
                <div class="meta">Selected game</div>
                <h2><?php echo htmlspecialchars($metadata['name']); ?></h2>
                <p style="color:#374151; margin:10px 0 0;">
                    <?php echo htmlspecialchars($metadata['description'] !== '' ? $metadata['description'] : 'No description provided yet.'); ?>
                </p>
                <div class="button-row">
                    <a class="button" href="/LuckBlox.site.tk/play?placeid=<?php echo (int) $placeId; ?>">Play now</a>
                    <a class="button secondary" href="/api/load.php?placeid=<?php echo (int) $placeId; ?>">Load state</a>
                    <a class="button secondary" href="/api/save.php?placeid=<?php echo (int) $placeId; ?>">Save state</a>
                    <a class="button secondary" href="/api/player.php?placeid=<?php echo (int) $placeId; ?>">Player data</a>
                    <a class="button secondary" href="/api/services.php?placeid=<?php echo (int) $placeId; ?>">Services API</a>
                    <a class="button warning" href="/api/publish.php?placeid=<?php echo (int) $placeId; ?>">Publish</a>
                </div>
                <ul style="margin-top:16px;">
                    <li><strong>Place ID:</strong> <code><?php echo (int) $metadata['placeId']; ?></code></li>
                    <li><strong>Game ID:</strong> <code><?php echo htmlspecialchars($metadata['gameId']); ?></code></li>
                    <li><strong>Universe ID:</strong> <code><?php echo (int) $metadata['universeId']; ?></code></li>
                    <li><strong>Version:</strong> <code><?php echo (int) $metadata['version']; ?></code></li>
                    <li><strong>Published:</strong> <span class="pill"><?php echo $metadata['published'] ? 'Yes' : 'No'; ?></span></li>
                    <li><strong>Map exists:</strong> <code><?php echo $metadata['mapExists'] ? 'Yes' : 'No'; ?></code></li>
                    <li><strong>Stats:</strong> <code>Visits=<?php echo (int) $metadata['stats']['visits']; ?>, Loads=<?php echo (int) $metadata['stats']['loads']; ?>, Saves=<?php echo (int) $metadata['stats']['saves']; ?>, Publishes=<?php echo (int) $metadata['stats']['publishes']; ?></code></li>
                </ul>
            </div>
        <?php endif; ?>

        <div class="card">
            <h2>Available places</h2>
            <div class="list-grid">
                <?php foreach ($placeFiles as $file): ?>
                    <?php $placeName = basename($file); ?>
                    <?php $placeId = (int) basename($file, '.rbxl'); ?>
                    <?php if ($placeId <= 0) { $placeId = array_search($file, $placeFiles) + 1; } ?>
                    <div class="place-card">
                        <div class="meta">Place <?php echo (int) $placeId; ?></div>
                        <div class="place-name"><?php echo htmlspecialchars($placeName); ?></div>
                        <div class="place-actions">
                            <a class="button" href="/LuckBlox.site.tk/games?placeid=<?php echo (int) $placeId; ?>">Open</a>
                            <a class="button secondary" href="/LuckBlox.site.tk/play?placeid=<?php echo (int) $placeId; ?>">Play</a>
                            <a class="button secondary" href="/api/load.php?placeid=<?php echo (int) $placeId; ?>">Load</a>
                            <a class="button secondary" href="/api/save.php?placeid=<?php echo (int) $placeId; ?>">Save</a>
                        </div>
                    </div>
                <?php endforeach; ?>
            </div>
        </div>

        <div class="footer">
            LuckyBlox • Classic local game portal • <a href="/LuckBlox.site.tk/">Dashboard</a>
        </div>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
