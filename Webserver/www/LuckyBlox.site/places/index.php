<?php
$rootPath = realpath(__DIR__ . '/../../../../');
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
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/site-icon/luckyblox.ico" sizes="any" />
    <link rel="icon" type="image/png" href="/site-icon/luckyblox.png" />
    <title>Places</title>
    <style>
        body { font-family: Arial, sans-serif; background: #020617; color: #e2e8f0; margin: 0; padding: 40px; }
        .container { max-width: 1100px; margin: 0 auto; }
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
        <h1>Places</h1>

        <div class="card">
            <ul>
                <?php foreach ($placeFiles as $file): ?>
                    <li><a href="/api/load.php?placeid=<?php echo rawurlencode(basename($file, '.rbxl')); ?>"><?php echo htmlspecialchars(basename($file)); ?></a></li>
                <?php endforeach; ?>
            </ul>
        </div>

        <p><a href="/LuckBlox.site/">Back to dashboard</a></p>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
