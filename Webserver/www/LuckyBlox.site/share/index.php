<?php
function read_setting($path, $default = '') {
    if (!file_exists($path)) {
        return $default;
    }

    $value = trim((string) file_get_contents($path));
    return $value !== '' ? $value : $default;
}

$rootPath = realpath(__DIR__ . '/../../../');
$mapsRoot = realpath($rootPath . '/Maps');
$settingsRoot = realpath($rootPath . '/Settings');

$placeFiles = array();
if (is_dir($mapsRoot)) {
    $placeFiles = array_values(array_filter(glob($mapsRoot . '/*'), function($file) {
        return is_file($file);
    }));
}

usort($placeFiles, function($a, $b) {
    return strcasecmp(basename($a), basename($b));
});

$username = read_setting($settingsRoot . '/username.txt', 'default');
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>LuckyBlox Launcher Share</title>
    <style>
        body {
            margin: 0;
            padding: 24px;
            font-family: Arial, Helvetica, sans-serif;
            background: #e5e7eb;
            color: #111827;
        }

        .container {
            max-width: 1100px;
            margin: 0 auto;
        }

        .hero {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.08);
        }

        h1, h2 { margin-top: 0; }
        p { color: #374151; }

        a {
            color: #1d4ed8;
            text-decoration: none;
        }

        a:hover {
            text-decoration: underline;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 22px;
            margin-top: 24px;
        }

        .card {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            padding: 18px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.08);
        }

        .label {
            color: #1d4ed8;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            font-size: 0.75rem;
            font-weight: 700;
            margin-bottom: 8px;
        }

        .value {
            font-weight: 700;
            font-size: 1.02rem;
        }

        .button {
            display: inline-flex;
            padding: 10px 16px;
            border-radius: 6px;
            background: #2563eb;
            border: 1px solid #1d4ed8;
            color: #ffffff;
            font-weight: 700;
            margin-right: 10px;
            margin-bottom: 10px;
        }

        .button.secondary {
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            color: #111827;
        }

        ul { margin: 0; padding-left: 18px; }
        li { margin: 8px 0; color: #374151; }
        strong { color: #111827; }
    </style>
    <link rel="stylesheet" href="/style.css" />
</head>
<body>
    <div class="container">
        <div class="hero">
            <h1>LuckyBlox Launcher — Share & Play</h1>
            <p>This local launcher is built for playing, sharing, and enjoying bundled maps quickly. Use the links below to launch the client, open the play page, or load and save state for any installed local place.</p>
            <div style="display:flex;flex-wrap:wrap;gap:12px;">
                <a class="button" href="/api/launch.php?client=2021m">Launch local client</a>
                <a class="button secondary" href="/LuckBlox.site/">Open dashboard</a>
                <a class="button secondary" href="/LuckBlox.site/games">Browse games</a>
            </div>
        </div>

        <div class="grid">
            <div class="card">
                <div class="label">Current user</div>
                <div class="value"><?php echo htmlspecialchars($username); ?></div>
            </div>
            <div class="card">
                <div class="label">Main dashboard</div>
                <div class="value"><a href="/LuckBlox.site/">Open dashboard</a></div>
            </div>
            <div class="card">
                <div class="label">API</div>
                <div class="value"><a href="/api/index.php">Open API docs</a></div>
            </div>
        </div>

        <div class="card" style="margin-top:24px;">
            <h2>Available local games</h2>
            <ul>
                <?php foreach ($placeFiles as $file): ?>
                    <?php $placeId = (int) basename($file, '.rbxl'); ?>
                    <?php $placeName = basename($file); ?>
                    <li>
                        <strong><?php echo htmlspecialchars($placeName); ?></strong><br />
                        <a href="/LuckBlox.site/play?placeid=<?php echo (int) $placeId; ?>">Play now</a> |
                        <a href="/api/load.php?placeid=<?php echo (int) $placeId; ?>">Load state</a> |
                        <a href="/api/save.php?placeid=<?php echo (int) $placeId; ?>">Save state</a>
                    </li>
                <?php endforeach; ?>
            </ul>
        </div>

        <p style="margin-top:20px;"><a href="/LuckBlox.site/">Back to dashboard</a></p>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
