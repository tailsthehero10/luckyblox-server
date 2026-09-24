<?php
require_once __DIR__ . '/../../api/luckyblox-data.php';

session_start();

$c = lb_get_current_user();
if (!$c) {
    header('Location: /LuckBlox.site/signin/?redirect=/LuckBlox.site/downloads/');
    exit;
}

$releaseRoot = realpath(__DIR__ . '/../../../');
$clientPlayer = $releaseRoot . '/Clients/2021M/RobloxPlayerBeta.exe';
$clientStudio = $releaseRoot . '/Clients/2022M/RobloxStudioBeta.exe';
$appSettingsPlayer = $releaseRoot . '/Clients/2021M/AppSettings.xml';
$appSettingsStudio = $releaseRoot . '/Clients/2022M/AppSettings.xml';
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/site-icon/luckyblox.ico" sizes="any" />
    <link rel="icon" type="image/png" href="/site-icon/luckyblox.png" />
    <title>Download LuckyBlox | LuckyBlox</title>
    <link rel="stylesheet" href="/style.css" />
    <style>
        body { font-family: Arial, sans-serif; background: #020617; color: #e2e8f0; margin: 0; padding: 40px; }
        .container { max-width: 1000px; margin: 0 auto; }
        .card { background: #111827; border: 1px solid #334155; border-radius: 14px; padding: 28px; margin-bottom: 24px; box-shadow: 0 15px 30px rgba(0,0,0,0.25); }
        h1 { margin-top: 0; }
        h2 { color: #7dd3fc; margin-top: 0; }
        .download-grid { display:grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
        .dl-card { background: rgba(15, 23, 42, 0.95); border: 1px solid #334155; border-radius: 14px; padding: 24px; text-align: center; transition: 0.15s; }
        .dl-card:hover { border-color: #5d8fe2; transform: translateY(-2px); }
        .dl-icon { width: 64px; height: 64px; margin: 0 auto 16px; background: linear-gradient(135deg, #4ca3ff, #1d4ed8); border-radius: 14px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:1.5rem; }
        .dl-title { font-size: 1.2rem; font-weight: 700; margin-bottom: 8px; }
        .dl-desc { color: #94a3b8; font-size: 0.9rem; margin-bottom: 16px; line-height: 1.5; }
        .dl-btn { display: inline-block; background:#2563eb; border: none; color:#fff; padding: 12px 24px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.9rem; text-decoration: none; transition: 0.15s; }
        .dl-btn:hover { background: #1d4ed8; }
        .dl-btn:disabled, .dl-btn.disabled { background:#475569; cursor: not-allowed; }
        .dl-meta { color: #6474a5; font-size: 0.8rem; margin-top: 12px; }
        .version { color: #5d8fe2; font-weight: 700; }
        a { color: #7dd3fc; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .note { background: rgba(214, 231, 255, 0.08); border: 1px solid rgba(214, 231, 255, 0.25); border-radius: 8px; padding: 12px 16px; color: #cbd5e1; font-size: 0.85rem; line-height: 1.6; }
        .patch-badge { display:inline-block; background:#10b981; color:#fff; border-radius:999px; padding:3px 10px; font-size:0.75rem; font-weight:700; margin-left:8px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <h1>Download LuckyBlox <span class="patch-badge">PATCHED</span></h1>
            <p style="color: #94a3b8; margin-top: -6px;">Signed in as <strong><?php echo htmlspecialchars($c['username']); ?></strong>. Download the patched client pre-configured to connect only to this LuckyBlox server.</p>
        </div>

        <div class="note" style="margin-bottom: 24px;">
            <strong>What's patched:</strong> Each download is a ZIP bundle containing the Roblox client executable plus a custom AppSettings.xml that points <code>BaseUrl</code> to this server. The client will only connect to the local LuckyBlox server and will not reach official Roblox services.
        </div>

        <div class="download-grid">
            <div class="dl-card">
                <div class="dl-icon">&#128193;</div>
                <div class="dl-title">LuckyBlox Player <span class="patch-badge">2021M</span></div>
                <div class="dl-desc">Launch and play games hosted on this LuckyBlox server.</div>
                <div class="dl-meta">File: <code>luckyblox-player.zip</code> (exe + AppSettings.xml)</div>
                <?php if (file_exists($clientPlayer) && file_exists($appSettingsPlayer)): ?>
                    <a class="dl-btn" href="/LuckBlox.site/downloads/get.php?file=player">Download Player</a>
                <?php else: ?>
                    <a class="dl-btn disabled" href="#" onclick="return false;">Unavailable</a>
                <?php endif; ?>
            </div>

            <div class="dl-card">
                <div class="dl-icon">&#127796;</div>
                <div class="dl-title">LuckyBlox Studio <span class="patch-badge">2022M</span></div>
                <div class="dl-desc">Build, script, and publish your own games for this server.</div>
                <div class="dl-meta">File: <code>luckyblox-studio.zip</code> (exe + AppSettings.xml)</div>
                <?php if (file_exists($clientStudio) && file_exists($appSettingsStudio)): ?>
                    <a class="dl-btn" href="/LuckBlox.site/downloads/get.php?file=studio">Download Studio</a>
                <?php else: ?>
                    <a class="dl-btn disabled" href="#" onclick="return false;">Unavailable</a>
                <?php endif; ?>
            </div>
        </div>

        <p><a href="/LuckBlox.site/home">Back to home</a></p>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
