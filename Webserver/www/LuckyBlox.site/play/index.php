<?php
require_once __DIR__ . '/../../api/common.php';

$placeId = isset($_GET['placeid']) ? preg_replace('/[^0-9]/', '', (string) $_GET['placeid']) : api_get_latest_published_place_id();
$metadata = api_get_place_metadata($placeId);
$player = api_get_local_player_state($placeId);
$spawn = api_get_spawn_points($placeId);
$chat = api_get_chat_filter_state($placeId);
$text = api_get_text_state($placeId);
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/site-icon/luckyblox.ico" sizes="any" />
    <link rel="icon" type="image/png" href="/site-icon/luckyblox.png" />
    <title>LuckyBlox Launcher Play</title>
    <style>
        body {
            margin: 0;
            padding: 24px;
            font-family: Arial, Helvetica, sans-serif;
            background: #e5e7eb;
            color: #111827;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        .hero {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            padding: 24px;
            margin-bottom: 24px;
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
            font-size: 1.15rem;
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

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 22px;
        }

        .card {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            padding: 18px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.08);
        }

        h1, h2 { margin-top: 0; }
        ul { margin: 0; padding-left: 18px; }
        li { margin: 8px 0; color: #374151; }

        a {
            color: #1d4ed8;
            text-decoration: none;
        }

        a:hover {
            text-decoration: underline;
        }

        code {
            background: #f3f4f6;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            padding: 3px 6px;
            color: #111827;
        }
    </style>
    <link rel="stylesheet" href="/style.css" />
</head>
<body>
    <div class="container">
        <div class="hero">
            <div class="label">Active place</div>
            <div class="value"><?php echo htmlspecialchars($metadata['name']); ?></div>
            <p style="color: var(--muted); margin: 10px 0 0;">
                Place ID: <code><?php echo (int) $metadata['placeId']; ?></code> |
                Version: <code><?php echo (int) $metadata['version']; ?></code> |
                Published: <code><?php echo $metadata['published'] ? 'Yes' : 'No'; ?></code>
            </p>
            <div style="margin-top:18px;">
                <a class="button" href="/api/services.php?placeid=<?php echo (int) $placeId; ?>">Services API</a>
                <a class="button secondary" href="/api/player.php?placeid=<?php echo (int) $placeId; ?>">Player data</a>
                <a class="button secondary" href="/api/save.php?placeid=<?php echo (int) $placeId; ?>">Save state</a>
                <a class="button secondary" href="/api/load.php?placeid=<?php echo (int) $placeId; ?>">Load state</a>
            </div>
        </div>

        <div class="grid">
            <div class="card">
                <h2>Player</h2>
                <ul>
                    <li><strong>Name:</strong> <?php echo htmlspecialchars($player['player']['name']); ?></li>
                    <li><strong>Membership:</strong> <?php echo htmlspecialchars($player['player']['membership']); ?></li>
                    <li><strong>Server IP:</strong> <?php echo htmlspecialchars($player['player']['serverIp']); ?></li>
                    <li><strong>Server Port:</strong> <?php echo htmlspecialchars($player['player']['serverPort']); ?></li>
                    <li><strong>Client Port:</strong> <?php echo htmlspecialchars($player['player']['clientPort']); ?></li>
                </ul>
            </div>

            <div class="card">
                <h2>Spawn</h2>
                <ul>
                    <?php foreach ($spawn['spawns'] as $index => $spawnPoint): ?>
                        <li>Spawn <?php echo $index + 1; ?> — <?php echo htmlspecialchars($spawnPoint['name']); ?> @ <?php echo htmlspecialchars(json_encode($spawnPoint['position'])); ?></li>
                    <?php endforeach; ?>
                </ul>
            </div>

            <div class="card">
                <h2>Chat filter</h2>
                <ul>
                    <li><strong>Enabled:</strong> <?php echo $chat['enabled'] ? 'Yes' : 'No'; ?></li>
                    <li><strong>Mode:</strong> <?php echo htmlspecialchars($chat['mode']); ?></li>
                    <li><strong>Deny list:</strong> <?php echo htmlspecialchars(json_encode($chat['denyList'])); ?></li>
                </ul>
            </div>

            <div class="card">
                <h2>Text state</h2>
                <ul>
                    <?php foreach ($text['messages'] as $msg): ?>
                        <li><?php echo htmlspecialchars($msg['text'] ?? json_encode($msg)); ?></li>
                    <?php endforeach; ?>
                    <?php if (empty($text['messages'])): ?>
                        <li>No messages yet.</li>
                    <?php endif; ?>
                </ul>
            </div>
        </div>

        <p style="margin-top:24px;"><a href="/LuckBlox.site/">Back to dashboard</a></p>
    </div>
    <script src="/legacy-nav.js"></script>
</body>
</html>
