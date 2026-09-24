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
$featuredPlaceId = lb_get_latest_published_place_id();

$sort = isset($_GET['sort']) ? preg_replace('/[^a-z]/', '', (string) $_GET['sort']) : 'toprated';

$lb_like_ratio = function($likes, $dislikes) {
    $total = (int)$likes + (int)$dislikes;
    if ($total <= 0) return 100;
    return round((int)$likes / $total * 100);
};

usort($games, function($a, $b) use ($sort, $lb_like_ratio) {
    $ra = $lb_like_ratio($a['likes'], $a['dislikes'] ?? 0);
    $rb = $lb_like_ratio($b['likes'], $b['dislikes'] ?? 0);

    switch ($sort) {
        case 'players':
            $diff = (int) $b['playerCount'] - (int) $a['playerCount'];
            if ($diff !== 0) return $diff;
            return $a['placeId'] - $b['placeId'];
        case 'favorites':
            $diff = (int) $b['favorites'] - (int) $a['favorites'];
            if ($diff !== 0) return $diff;
            $diff2 = (int) $b['likes'] - (int) $a['likes'];
            if ($diff2 !== 0) return $diff2;
            return $a['placeId'] - $b['placeId'];
        case 'newest':
            $at = strtotime($a['updatedAt'] ?: '1970-01-01');
            $bt = strtotime($b['updatedAt'] ?: '1970-01-01');
            $diff = $bt - $at;
            if ($diff !== 0) return $diff;
            return $a['placeId'] - $b['placeId'];
        case 'name':
            return strcasecmp($a['title'], $b['title']);
        case 'toprated':
        default:
            if ($rb > $ra) return 1;
            if ($rb < $ra) return -1;
            $diff = (int) $b['likes'] - (int) $a['likes'];
            if ($diff !== 0) return $diff;
            return $a['placeId'] - $b['placeId'];
    }
});
$gamesCount = count($games);
$userId = (int)($c['userId'] ?? 1);
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
        body { margin:0; padding:0; font-family:"Segoe UI",Arial,sans-serif; background:#0b0f17; color:#e2e8f0; }
        .container { max-width:1200px; margin:0 auto; padding:20px 18px 48px; }
        .topbar { display:flex; align-items:center; justify-content:space-between; gap:20px; background:rgba(17,24,39,0.9); border:1px solid rgba(255,255,255,0.08); border-radius:16px; padding:16px 20px; box-shadow:0 18px 42px rgba(0,0,0,0.42); position:sticky; top:12px; z-index:5; backdrop-filter:blur(8px); }
        .brand { display:flex; align-items:center; gap:12px; font-weight:800; font-size:1.2rem; text-transform:uppercase; letter-spacing:0.06em; }
        .brand img { width:32px; height:32px; }
        .nav { display:flex; flex-wrap:wrap; gap:14px; font-size:0.9rem; color:#a8b5c9; }
        .nav a { padding:8px 12px; border-radius:10px; transition:0.15s; }
        .nav a:hover { background:rgba(255,255,255,0.03); color:#e2e8f0; }
        .nav .active { background:rgba(76,163,255,0.12); color:#e2e8f0; border:1px solid rgba(76,163,255,0.3); }
        .hero { margin:24px 0; }
        .hero h1 { font-size:clamp(1.8rem,3vw,2.6rem); margin:0 0 6px; letter-spacing:-0.04em; }
        .hero p { color:#94a3b8; margin:0 0 16px; max-width:700px; }
        .toolbar { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:18px; flex-wrap:wrap; }
        .sort-label { color:#94a3b8; font-size:0.82rem; text-transform:uppercase; letter-spacing:0.06em; }
        .sort-select { background:rgba(15,23,42,0.8); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:6px 12px; color:#e2e8f0; font-size:0.88rem; cursor:pointer; }
        .sort-select:focus { outline:none; border-color:rgba(76,163,255,0.4); }
        .count { color:#64748b; font-size:0.85rem; }
        .game-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:20px; }
        .game-card { background:rgba(17,24,39,0.9); border:1px solid rgba(255,255,255,0.08); border-radius:14px; overflow:hidden; box-shadow:0 10px 24px rgba(0,0,0,0.3); transition:0.15s; }
        .game-card:hover { transform:translateY(-2px); border-color:rgba(76,163,255,0.3); }
        .game-thumb { position:relative; width:100%; aspect-ratio:16/9; background:#1e293b; overflow:hidden; }
        .game-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
        .game-thumb .rating { position:absolute; bottom:6px; right:6px; background:rgba(0,0,0,0.55); border:1px solid rgba(255,255,255,0.12); border-radius:14px; padding:3px 8px; font-size:0.72rem; font-weight:700; color:#fff; display:inline-flex; align-items:center; gap:4px; }
        .game-thumb .rating .ratio { color:#37d39a; }
        .game-body { padding:14px 14px 12px; }
        .game-title { font-size:1rem; font-weight:700; margin:0 0 4px; line-height:1.3; }
        .game-title a { color:#e2e8f0; }
        .game-title a:hover { color:#7dd3fc; }
        .game-dev { font-size:0.8rem; color:#64748b; margin:0 0 10px; }
        .game-stats { display:flex; align-items:center; gap:14px; font-size:0.8rem; color:#94a3b8; }
        .stat { display:inline-flex; align-items:center; gap:4px; }
        .stat .value { font-weight:700; color:#e2e8f0; }
        .fav { color:#f59e0b; }
        .tags { display:flex; flex-wrap:wrap; gap:4px; margin-top:8px; }
        .tag { background:rgba(55,211,154,0.12); color:#37d39a; border:1px solid rgba(55,211,154,0.28); padding:2px 8px; border-radius:999px; font-size:0.66rem; font-weight:700; text-transform:uppercase; }
        .play-small { display:inline-flex; align-items:center; justify-content:center; padding:6px 12px; border-radius:8px; background:linear-gradient(135deg,#7dd3fc,#4ca3ff); color:#06161f; font-weight:800; border:none; font-size:0.82rem; cursor:pointer; }
        .empty { color:#64748b; text-align:center; padding:50px; }
    </style>
</head>
<body>
    <div class="container">
        <header class="topbar">
            <div class="brand"><img src="/site-icon/luckyblox.png" alt="LuckyBlox" /><span>LuckyBlox</span></div>
            <nav class="nav">
                <a href="/LuckBlox.site/home">Home</a>
                <a class="active" href="/LuckBlox.site/games">Games</a>
                <a href="/LuckBlox.site/game?placeid=<?php echo (int) $featuredPlaceId; ?>">Game</a>
                <a href="/LuckBlox.site/avatar">Avatar</a>
                <a href="/LuckBlox.site/users/<?php echo $userId; ?>/profile">Profile</a>
                <a href="/LuckBlox.site/settings">Settings</a>
                <a href="/LuckBlox.site/share">Share</a>
                <a href="/LuckBlox.site/about">About</a>
            </nav>
        </header>

        <section class="hero">
            <h1>Games</h1>
            <p>Discover and play local LuckyBlox experiences. Sorted by community rating, visits, and recency.</p>
        </section>

        <div class="toolbar">
            <span class="count"><?php echo $gamesCount; ?> games</span>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span class="sort-label">Sort</span>
                <form method="get" action="/LuckBlox.site/games/">
                    <select class="sort-select" name="sort" onchange="this.form.submit()">
                        <option value="toprated" <?php if ($sort === 'toprated') echo 'selected'; ?>>Top rated</option>
                        <option value="players" <?php if ($sort === 'players') echo 'selected'; ?>>Most players</option>
                        <option value="favorites" <?php if ($sort === 'favorites') echo 'selected'; ?>>Most favorited</option>
                        <option value="newest" <?php if ($sort === 'newest') echo 'selected'; ?>>Recently updated</option>
                        <option value="name" <?php if ($sort === 'name') echo 'selected'; ?>>A-Z</option>
                    </select>
                </form>
            </div>
        </div>

        <?php if (empty($games)): ?>
            <div class="empty">No games found.</div>
        <?php else: ?>
            <div class="game-grid">
                <?php foreach ($games as $game):
                    $icon = lb_resolve_game_icon($game);
                    $ratio = $lb_like_ratio($game['likes'], $game['dislikes'] ?? ($game['votes']['dislikes'] ?? 0));
                    $likes = (int)$game['likes'];
                    $dislikes = (int)($game['dislikes'] ?? ($game['votes']['dislikes'] ?? 0));
                    $dislikeCount = $dislikes > 0 ? $dislikes : 0;
                ?>
                    <div class="game-card">
                        <div class="game-thumb">
                            <img src="<?php echo htmlspecialchars($icon); ?>" alt="<?php echo htmlspecialchars($game['title']); ?>"
                                 onerror="this.src='/gameplaceholder/Card_512x512/card.png';" />
                            <span class="rating"><span class="ratio"><?php echo $ratio; ?>%</span> · <?php echo $likes; ?> like<?php echo $likes !== 1 ? 's' : ''; ?><?php if ($dislikeCount > 0): ?> / <?php echo $dislikeCount; ?> dislike<?php echo $dislikeCount !== 1 ? 'es' : ''; ?> <?php endif; ?></span>
                        </div>
                        <div class="game-body">
                            <h3 class="game-title"><a href="/LuckBlox.site/game?placeid=<?php echo (int) $game['placeId']; ?>"><?php echo htmlspecialchars($game['title']); ?></a></h3>
                            <div class="game-dev"><?php echo htmlspecialchars($game['developer']); ?> · <?php echo htmlspecialchars($game['genre']); ?></div>
                            <div class="game-stats">
                                <span class="stat"><span class="value"><?php echo (int) $game['playerCount']; ?></span> players</span>
                                <span class="stat fav">★ <span class="value"><?php echo (int) $game['favorites']; ?></span> fav</span>
                                <span class="stat">▲ <span class="value"><?php echo $likes; ?></span></span>
                            </div>
                            <div class="tags">
                                <?php foreach (array_slice($game['tags'], 0, 2) as $tag): ?>
                                    <span class="tag"><?php echo htmlspecialchars($tag); ?></span>
                                <?php endforeach; ?>
                            </div>
                            <button class="play-small" onclick="location.href='/LuckBlox.site/play?placeid=<?php echo (int) $game['placeId']; ?>'">Play</button>
                        </div>
                    </div>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>
    </div>
</body>
</html>