<?php
require_once __DIR__ . '/../../api/common.php';

$placeId = isset($_GET['placeid']) ? preg_replace('/[^0-9]/', '', (string) $_GET['placeid']) : api_get_latest_published_place_id();
$metadata = api_get_place_metadata($placeId);
$playUrl = '/LuckBlox.site.tk/play?placeid=' . (int) $placeId;
$mapName = basename($metadata['mapFile']);
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>LuckyBlox Game Details</title>
    <style>
        body { margin:0; padding:24px; font-family:Arial, Helvetica, sans-serif; background:#e5e7eb; color:#111827; }
        a { color:#1d4ed8; text-decoration:none; }
        a:hover { text-decoration:underline; }
        .container { max-width:1100px; margin:0 auto; }
        .hero, .card { background:#ffffff; border:1px solid #cbd5e1; border-radius:8px; padding:22px; box-shadow:0 1px 2px rgba(0,0,0,0.08); }
        .hero { margin-bottom:22px; }
        .eyebrow { display:inline-block; background:#dbeafe; color:#1d4ed8; border:1px solid #93c5fd; border-radius:4px; padding:5px 8px; font-size:0.75rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:10px; }
        h1, h2 { margin-top:0; }
        .button-row { display:flex; flex-wrap:wrap; gap:10px; margin-top:18px; }
        .button {
            display:inline-flex; align-items:center; justify-content:center; padding:10px 16px; border-radius:6px;
            background:#2563eb; border:1px solid #1d4ed8; color:#fff; font-weight:700;
        }
        .button.secondary { background:#f8fafc; border:1px solid #cbd5e1; color:#111827; }
        .grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(260px,1fr)); gap:20px; }
        ul { margin:0; padding-left:18px; }
        li { margin:8px 0; color:#374151; }
        code { background:#f3f4f6; border:1px solid #d1d5db; border-radius:4px; padding:3px 6px; color:#111827; }
    </style>
    <link rel="stylesheet" href="/style.css" />
</head>
<body>
    <div class="container">
        <div class="hero">
            <div class="eyebrow">Game details</div>
            <h1><?php echo htmlspecialchars($metadata['name']); ?></h1>
            <p style="margin:10px 0 0; color:#374151;">
                <?php echo htmlspecialchars($metadata['description'] !== '' ? $metadata['description'] : 'No description provided yet.'); ?>
            </p>
            <div class="button-row">
                <a class="button" href="<?php echo htmlspecialchars($playUrl); ?>">Play now</a>
                <a class="button secondary" href="/LuckBlox.site.tk/games?placeid=<?php echo (int) $placeId; ?>">Browse all games</a>
                <a class="button secondary" href="/LuckBlox.site.tk/share">Share &amp; Play</a>
            </div>
        </div>

        <div class="grid">
            <div class="card">
                <h2>Basic info</h2>
                <ul>
                    <li><strong>Place ID:</strong> <code><?php echo (int) $metadata['placeId']; ?></code></li>
                    <li><strong>Game ID:</strong> <code><?php echo htmlspecialchars($metadata['gameId']); ?></code></li>
                    <li><strong>Universe ID:</strong> <code><?php echo (int) $metadata['universeId']; ?></code></li>
                    <li><strong>Version:</strong> <code><?php echo (int) $metadata['version']; ?></code></li>
                    <li><strong>Published:</strong> <code><?php echo $metadata['published'] ? 'Yes' : 'No'; ?></code></li>
                    <li><strong>Published at:</strong> <code><?php echo htmlspecialchars($metadata['publishedAt'] ?: 'Not published yet'); ?></code></li>
                </ul>
            </div>

            <div class="card">
                <h2>Map details</h2>
                <ul>
                    <li><strong>Map file:</strong> <code><?php echo htmlspecialchars($mapName); ?></code></li>
                    <li><strong>Map exists:</strong> <code><?php echo $metadata['mapExists'] ? 'Yes' : 'No'; ?></code></li>
                    <li><strong>File size:</strong> <code><?php echo (int) $metadata['fileSize']; ?> bytes</code></li>
                    <li><strong>Created:</strong> <code><?php echo htmlspecialchars($metadata['createdAt']); ?></code></li>
                    <li><strong>Updated:</strong> <code><?php echo htmlspecialchars($metadata['updatedAt']); ?></code></li>
                </ul>
            </div>

            <div class="card">
                <h2>Stats</h2>
                <ul>
                    <li><strong>Visits:</strong> <code><?php echo (int) $metadata['stats']['visits']; ?></code></li>
                    <li><strong>Loads:</strong> <code><?php echo (int) $metadata['stats']['loads']; ?></code></li>
                    <li><strong>Saves:</strong> <code><?php echo (int) $metadata['stats']['saves']; ?></code></li>
                    <li><strong>Publishes:</strong> <code><?php echo (int) $metadata['stats']['publishes']; ?></code></li>
                    <li><strong>Last visited:</strong> <code><?php echo htmlspecialchars($metadata['stats']['lastVisitedAt'] ?: 'Never'); ?></code></li>
                    <li><strong>Last published:</strong> <code><?php echo htmlspecialchars($metadata['stats']['lastPublishedAt'] ?: 'Never'); ?></code></li>
                </ul>
            </div>
        </div>

        <p style="margin-top:24px;"><a href="/LuckBlox.site.tk/">Back to dashboard</a></p>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
