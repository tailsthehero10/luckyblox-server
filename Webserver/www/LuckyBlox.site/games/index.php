<?php
require_once __DIR__ . '/../../api/luckyblox-data.php';

session_start();

$c = lb_get_current_user();
if (!$c) {
    $c = lb_find_user_by_id(1);
    if (!$c) {
        $c = array('userId' => '1', 'username' => 'LocalPlayer', 'displayName' => 'LocalPlayer');
    }
}

$games = lb_get_all_games();
$gamesCount = count($games);
$featuredPlaceId = lb_get_latest_published_place_id();

usort($games, function($a, $b) {
    $diff = (int) $b['playerCount'] - (int) $a['playerCount'];
    if ($diff !== 0) return $diff;
    return (int) $b['placeId'] - (int) $a['placeId'];
});

$mapsRoot = lb_maps_root();
$mapCount = is_dir($mapsRoot) ? count(array_filter(glob($mapsRoot . '/*'), 'is_file')) : 0;
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Games | LuckyBlox</title>
    <link rel="icon" href="/site-icon/luckyblox.ico" sizes="any" />
    <link rel="icon" type="image/png" href="/site-icon/luckyblox.png" />
    <link rel="stylesheet" href="/style.css" />
    <style>
        body { margin:0; padding:0; font-family:Arial, Helvetica, sans-serif; background:#0b0f17; color:#e2e8f0; }
        a { color:#7dd3fc; text-decoration:none; }
        a:hover { text-decoration:underline; }
        .container { max-width:1200px; margin:0 auto; padding:20px; }
        .topbar { display:flex; align-items:center; justify-content:space-between; gap:20px; background:rgba(17,24,39,0.9); border:1px solid rgba(255,255,255,0.08); border-radius:16px; padding:16px 20px; margin-bottom:20px; box-shadow:0 18px 42px rgba(0,0,0,0.42); position:sticky; top:12px; z-index:5; backdrop-filter:blur(8px); }
        .brand { display:flex; align-items:center; gap:12px; font-weight:700; font-size:1.2rem; text-transform:uppercase; }
        .brand img { width:32px; height:32px; }
        .nav { display:flex; flex-wrap:wrap; gap:14px; font-size:0.9rem; color:#a8b5c9; }
        .nav a { padding:8px 12px; border-radius:10px; transition:0.15s ease; }
        .nav a:hover { background:rgba(255,255,255,0.03); color:#e2e8f0; }
        .nav .active { background:rgba(76,163,255,0.12); color:#e2e8f0; border:1px solid rgba(76,163,255,0.3); }
        .hero { background:linear-gradient(135deg,rgba(18,26,37,0.96),rgba(14,22,34,0.96)); border:1px solid rgba(255,255,255,0.08); border-radius:22px; padding:28px; box-shadow:0 18px 42px rgba(0,0,0,0.42); margin-bottom:24px; }
        .hero h1 { margin:0 0 12px; font-size:2rem; }
        .hero p { color:#a8b5c9; margin:0; max-width:700px; }
        .game-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:20px; }
        .game-card { background:rgba(17,24,39,0.9); border:1px solid rgba(255,255,255,0.08); border-radius:18px; padding:18px; box-shadow:0 18px 42px rgba(0,0,0,0.42); overflow:hidden; }
        .game-thumb { height:140px; border-radius:12px; background:linear-gradient(135deg,rgba(76,163,255,0.26),rgba(29,78,216,0.18)); border:1px solid rgba(255,255,255,0.08); margin-bottom:14px; }
        .game-card h3 { margin:0 0 6px; font-size:1.1rem; }
        .game-meta { color:#64748b; font-size:0.85rem; margin-bottom:10px; }
        .game-desc { color:#94a3b8; font-size:0.85rem; line-height:1.5; margin-bottom:12px; }
        .game-tags { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
        .tag { background:rgba(55,211,154,0.12); color:#37d39a; border:1px solid rgba(55,211,154,0.28); padding:4px 8px; border-radius:999px; font-size:0.72rem; font-weight:700; }
        .game-stats { display:flex; justify-content:space-between; align-items:center; }
        .stat { text-align:center; }
        .stat .num { font-size:1.3rem; font-weight:700; color:#4ca3ff; }
        .stat .lbl { font-size:0.7rem; color:#64748b; }
        .play-btn { display:inline-flex; align-items:center; justify-content:center; padding:10px 16px; border-radius:10px; background:linear-gradient(135deg,#7dd3fc,#4ca3ff); color:#06161f; font-weight:800; border:none; cursor:pointer; }
        .play-btn:hover { filter:brightness(1.1); }
        .empty { color:#64748b; text-align:center; padding:40px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="topbar">
            <div class="brand">
                <img src="/site-icon/luckyblox.png" alt="LuckyBlox" />
                <span>LuckyBlox</span>
            </div>
            <nav class="nav">
                <a href="/LuckBlox.site/home">Home</a>
                <a class="active" href="/LuckBlox.site/games">Games</a>
                <a href="/LuckBlox.site/game?placeid=<?php echo (int) $featuredPlaceId; ?>">Game</a>
                <a href="/LuckBlox.site/users/<?php echo (int) $c['userId']; ?>/profile">Profile</a>
                <a href="/LuckBlox.site/settings">Settings</a>
                <a href="/LuckBlox.site/share">Share</a>
                <a href="/LuckBlox.site/about">About</a>
                <?php if ($c && !$c['isAdmin']): ?>
                    <a href="/LuckBlox.site/signin/">Log In</a>
                    <a href="/LuckBlox.site/signup/">Sign Up</a>
                <?php else: ?>
                    <a href="/LuckBlox.site.tk/logout">Log Out</a>
                <?php endif; ?>
            </nav>
        </div>

        <div class="hero">
            <h1>Games</h1>
            <p>Browse and play local LuckyBlox experiences. All games run from the bundled server. Join instantly or launch the client directly.</p>
        </div>

        <?php if (empty($games)): ?>
            <div class="empty">No games found. <a href="/LuckBlox.site/downloads">Download a client</a> to get started.</div>
        <?php else: ?>
            <div class="game-grid">
                <?php foreach ($games as $game): ?>
                    <div class="game-card">
                        <div class="game-thumb"></div>
                        <h3><?php echo htmlspecialchars($game['title']); ?></h3>
                        <div class="game-meta">Place ID: <?php echo (int) $game['placeId']; ?> • <?php echo htmlspecialchars($game['developer']); ?></div>
                        <div class="game-desc"><?php echo htmlspecialchars($game['description'] ?: 'A local map packaged as a playable LuckyBlox experience.'); ?></div>
                        <div class="game-tags">
                            <?php foreach ($game['tags'] as $tag): ?>
                                <span class="tag"><?php echo htmlspecialchars($tag); ?></span>
                            <?php endforeach; ?>
                        </div>
                        <div class="game-stats">
                            <div style="display:flex;gap:16px;">
                                <div class="stat"><div class="num"><?php echo (int) $game['playerCount']; ?></div><div class="lbl">Players</div></div>
                                <div class="stat"><div class="num"><?php echo (int) $game['likes']; ?></div><div class="lbl">Likes</div></div>
                                <div class="stat"><div class="num"><?php echo (int) $game['favorites']; ?></div><div class="lbl">Favorites</div></div>
                            </div>
                            <a class="play-btn" href="/LuckBlox.site/play?placeid=<?php echo (int) $game['placeId']; ?>">Play</a>
                        </div>
                    </div>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>

        <div style="margin-top:24px;text-align:center;color:#64748b;">
            <span><?php echo $gamesCount; ?> games available • <?php echo $mapCount; ?> maps installed</span>
        </div>
    </div>
</body>
</html>
