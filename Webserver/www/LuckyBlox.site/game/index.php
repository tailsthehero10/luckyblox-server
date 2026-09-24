<?php
require_once __DIR__ . '/../../api/common.php';
require_once __DIR__ . '/../../api/luckyblox-data.php';

session_start();

$placeId = isset($_GET['placeid']) ? preg_replace('/[^0-9]/', '', (string) $_GET['placeid']) : api_get_latest_published_place_id();
$placeId = $placeId ?: api_get_latest_published_place_id();
$placeId = (int) $placeId;

$metadata = api_get_place_metadata((string) $placeId);
$game = lb_get_game_by_id($placeId);
if (!$game) {
    $game = array(
        'placeId' => $placeId,
        'title' => $metadata['name'] ?? 'LuckyBlox Arena',
        'description' => $metadata['description'] !== '' ? $metadata['description'] : 'A local map packaged as a playable LuckyBlox experience.',
        'developer' => 'LuckyBlox Studio',
        'icon' => '',
        'genre' => 'Adventure',
        'playerCount' => 0,
        'likes' => 0,
        'dislikes' => 0,
        'favorites' => 0,
        'tags' => array('Community', 'Local'),
        'activeServers' => array(),
        'serverList' => array(),
        'votes' => array('likes' => 0, 'dislikes' => 0),
    );
}

$gameIcon = $game['icon'] ?: '/gameplaceholder/Card_512x512/card.png';
$gameFeat = $game['icon'] ?: '/gameplaceholder/Big_/featured.png';

$likes = (int) $game['likes'];
$dislikes = (int) ($game['dislikes'] ?? 0);
$total = $likes + $dislikes;
$ratio = $total > 0 ? round($likes / $total * 100) : 100;

$ownerUser = lb_find_user_by_id($metadata['creatorId'] ?? 1) ?: lb_find_user_by_id(1);
$ownerName = $ownerUser['displayName'] ?? 'LuckyBlox Studio';

$catalogAssets = lb_get_user_assets($ownerUser);
$gameBadgeCount = count($ownerUser['badges'] ?? array());

$c = lb_get_current_user() ?: lb_find_user_by_id(1);
$userId = (int)($c['userId'] ?? 1);
$featuredPlaceId = lb_get_latest_published_place_id();
$playUrl = '/LuckBlox.site/play?placeid=' . $placeId;

$activeTab = isset($_GET['tab']) ? preg_replace('/[^a-z]/', '', (string) $_GET['tab']) : 'about';
$tabs = array('about' => 'About', 'servers' => 'Servers', 'store' => 'Store', 'badges' => 'Badges');
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title><?php echo htmlspecialchars($game['title']); ?> | LuckyBlox</title>
    <link rel="icon" href="/site-icon/luckyblox.ico" sizes="any" />
    <link rel="icon" type="image/png" href="/site-icon/luckyblox.png" />
    <link rel="stylesheet" href="/style.css" />
    <style>
        body { margin:0; padding:0; font-family:"Segoe UI",Arial,sans-serif; background:#0b0f17; color:#e2e8f0; }
        .container { max-width:1200px; margin:0 auto; padding:20px 18px 48px; }
        .topbar { display:flex; align-items:center; justify-content:space-between; gap:20px; background:rgba(17,24,39,0.9); border:1px solid rgba(255,255,255,0.08); border-radius:16px; padding:14px 20px; box-shadow:0 18px 42px rgba(0,0,0,0.42); position:sticky; top:12px; z-index:5; backdrop-filter:blur(8px); }
        .brand { display:flex; align-items:center; gap:12px; font-weight:800; font-size:1.2rem; text-transform:uppercase; letter-spacing:0.06em; }
        .brand img { width:32px; height:32px; }
        .nav { display:flex; flex-wrap:wrap; gap:14px; font-size:0.9rem; color:#a8b5c9; }
        .nav a { padding:8px 12px; border-radius:10px; transition:0.15s; }
        .nav a:hover { background:rgba(255,255,255,0.03); color:#e2e8f0; }
        .nav .active { background:rgba(76,163,255,0.12); color:#e2e8f0; border:1px solid rgba(76,163,255,0.3); }
        .hero { margin:24px 0; }
        .hero-flex { display:grid; grid-template-columns:1fr 1fr; gap:22px; align-items:start; }
        .hero-img { width:100%; aspect-ratio:16/9; border-radius:14px; overflow:hidden; border:1px solid rgba(255,255,255,0.08); background:#1e293b; }
        .hero-img img { width:100%; height:100%; object-fit:cover; display:block; }
        .hero-text h1 { font-size:clamp(1.8rem,3vw,2.6rem); margin:0 0 8px; letter-spacing:-0.04em; }
        .hero-text .dev { color:#7dd3fc; font-size:0.95rem; margin:0 0 12px; }
        .hero-text .desc { color:#94a3b8; margin:0 0 16px; line-height:1.6; }
        .badge-row { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 14px; }
        .tag { background:rgba(55,211,154,0.12); color:#37d39a; border:1px solid rgba(55,211,154,0.28); padding:4px 10px; border-radius:999px; font-size:0.68rem; font-weight:700; text-transform:uppercase; }
        .stat-row { display:flex; align-items:center; gap:18px; margin:14px 0; flex-wrap:wrap; font-size:0.9rem; color:#94a3b8; }
        .stat { display:inline-flex; align-items:center; gap:6px; font-weight:600; }
        .ratio-box { display:inline-flex; align-items:center; gap:6px; background:rgba(17,23,42,0.8); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:6px 14px; font-size:0.95rem; font-weight:700; color:#37d39a; }
        .button { display:inline-flex; align-items:center; justify-content:center; padding:12px 20px; border-radius:10px; font-weight:800; border:1px solid transparent; cursor:pointer; transition:0.15s; }
        .button.primary { background:linear-gradient(135deg,#7dd3fc,#4ca3ff); color:#06161f; box-shadow:0 10px 24px rgba(76,163,255,0.36); }
        .button.primary:hover { filter:brightness(1.1); }
        .button.secondary { background:rgba(255,255,255,0.03); color:#e2e8f0; border-color:var(--line,rgba(255,255,255,0.08)); }
        .button.secondary:hover { background:rgba(255,255,255,0.06); }
        .tabs { display:flex; gap:4px; background:rgba(11,15,23,0.95); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:4px; margin-top:24px; overflow-x:auto; }
        .tab { padding:10px 18px; border-radius:10px; font-size:0.85rem; font-weight:700; cursor:pointer; white-space:nowrap; transition:0.15s; color:#a8b5c9; }
        .tab.active { background:linear-gradient(135deg,rgba(76,163,255,0.18),rgba(76,163,255,0.10)); color:#7dd3fc; border:1px solid rgba(76,163,255,0.35); }
        .tab:hover:not(.active) { background:rgba(255,255,255,0.03); color:#e2e8f0; }
        .tab-panel { display:none; }
        .tab-panel.active { display:block; }
        .panel { background:rgba(15,23,42,0.95); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:20px; box-shadow:0 10px 24px rgba(0,0,0,0.3); }
        .panel + .panel { margin-top:18px; }
        .info-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; }
        .info-item { }
        .info-label { font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em; color:#64748b; margin-bottom:4px; }
        .info-value { font-size:0.95rem; font-weight:700; color:#e2e8f0; }
        .server-list { display:grid; gap:10px; }
        .server-item { display:flex; align-items:center; justify-content:space-between; background:rgba(0,0,0,0.15); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:10px 14px; font-size:0.85rem; }
        .server-item .players { font-weight:700; color:#37d39a; }
        .asset-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:12px; }
        .asset-card { background:rgba(0,0,0,0.15); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:10px; text-align:center; transition:0.15s; }
        .asset-card:hover { border-color:rgba(76,163,255,0.3); }
        .asset-thumb { width:52px; height:52px; border-radius:8px; margin:0 auto 6px; background:rgba(76,163,255,0.14); display:grid; place-items:center; font-weight:700; font-size:0.7rem; color:#7dd3fc; overflow:hidden; }
        .asset-thumb img { width:100%; height:100%; object-fit:contain; }
        .asset-name { font-size:0.8rem; font-weight:700; color:#e2e8f0; margin:4px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .asset-type { font-size:0.68rem; color:#64748b; text-transform:uppercase; }
        .badge-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:12px; }
        .badge-card { display:flex; align-items:center; gap:10px; background:rgba(0,0,0,0.15); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:10px 12px; }
        .badge-icon { width:34px; height:34px; border-radius:8px; background:rgba(76,163,255,0.14); display:grid; place-items:center; font-weight:700; flex-shrink:0; }
        .badge-info h4 { margin:0 0 2px; font-size:0.88rem; }
        .badge-info p { margin:0; font-size:0.76rem; color:#64748b; }
        .empty-state { text-align:center; padding:30px; color:#64748b; }
        .back-link { margin-top:22px; color:#7dd3fc; font-size:0.88rem; }
    </style>
</head>
<body>
    <div class="container">
        <header class="topbar">
            <div class="brand"><img src="/site-icon/luckyblox.png" alt="LuckyBlox" /><span>LuckyBlox</span></div>
            <nav class="nav">
                <a href="/LuckBlox.site/home">Home</a>
                <a class="active" href="/LuckBlox.site/games">Games</a>
                <a href="/LuckBlox.site/avatar">Avatar</a>
                <a href="/LuckBlox.site/users/<?php echo $userId; ?>/profile">Profile</a>
                <a href="/LuckBlox.site/settings">Settings</a>
                <a href="/LuckBlox.site/share">Share</a>
                <a href="/LuckBlox.site/about">About</a>
            </nav>
        </header>

        <section class="hero">
            <div class="hero-flex">
                <div class="hero-img">
                    <img src="<?php echo htmlspecialchars($gameFeat); ?>" alt="<?php echo htmlspecialchars($game['title']); ?>"
                         onerror="this.src='/gameplaceholder/Big_/featured.png';" />
                </div>
                <div class="hero-text">
                    <h1><?php echo htmlspecialchars($game['title']); ?></h1>
                    <div class="dev"><?php echo htmlspecialchars($game['developer']); ?> · <?php echo htmlspecialchars($game['genre']); ?></div>
                    <p class="desc"><?php echo htmlspecialchars($game['description']); ?></p>
                    <div class="badge-row">
                        <?php foreach (array_slice($game['tags'], 0, 3) as $tag): ?>
                            <span class="tag"><?php echo htmlspecialchars($tag); ?></span>
                        <?php endforeach; ?>
                    </div>
                    <div class="stat-row">
                        <span class="stat">★ <strong><?php echo (int) $game['favorites']; ?></strong> favorites</span>
                        <span class="stat">▲ <strong><?php echo $likes; ?></strong> likes</span>
                        <span class="stat">▼ <strong><?php echo $dislikes; ?></strong> dislikes</span>
                        <span class="stat">👥 <strong><?php echo (int) $game['playerCount']; ?></strong> players</span>
                        <span class="ratio-box"><?php echo $ratio; ?>% positive</span>
                    </div>
                    <div style="margin:16px 0;">
                        <a class="button primary" href="<?php echo htmlspecialchars($playUrl); ?>">Play</a>
                        <a class="button secondary" style="margin-left:10px;" href="/LuckBlox.site/games">Back to games</a>
                    </div>
                </div>
            </div>
        </section>

        <div class="tabs" role="tablist">
            <?php foreach ($tabs as $tabId => $tabName): ?>
                <button type="button" class="tab <?php echo $activeTab === $tabId ? 'active' : ''; ?>"
                        onclick="switchTab('<?php echo $tabId; ?>');"><?php echo htmlspecialchars($tabName); ?></button>
            <?php endforeach; ?>
        </div>

        <div class="tab-content">
            <section id="tab-about" class="tab-panel <?php echo $activeTab === 'about' ? 'active' : ''; ?>">
                <div class="panel">
                    <h2 style="margin-top:0;font-size:1.1rem;">About</h2>
                    <p style="color:#94a3b8;line-height:1.6;"><?php echo htmlspecialchars($game['description'] ?: 'No description available.'); ?></p>
                    <div style="margin-top:14px;">
                        <span style="color:#64748b;font-size:0.82rem;">Creator: <strong style="color:#e2e8f0;"><?php echo htmlspecialchars($ownerName); ?></strong></span>
                    </div>
                    <div style="margin-top:8px;">
                        <span style="color:#64748b;font-size:0.82rem;">Genre: <strong style="color:#e2e8f0;"><?php echo htmlspecialchars($game['genre']); ?></strong></span>
                    </div>
                    <div style="margin-top:8px;">
                        <span style="color:#64748b;font-size:0.82rem;">Created: <strong style="color:#e2e8f0;"><?php echo htmlspecialchars($metadata['createdAt'] ?? 'Unknown'); ?></strong></span>
                    </div>
                    <div style="margin-top:8px;">
                        <span style="color:#64748b;font-size:0.82rem;">Updated: <strong style="color:#e2e8f0;"><?php echo htmlspecialchars($metadata['updatedAt'] ?? 'Unknown'); ?></strong></span>
                    </div>
                </div>

                <div class="panel">
                    <h2 style="margin-top:0;font-size:1.1rem;">Statistics</h2>
                    <div class="info-grid">
                        <div class="info-item">
                            <div class="info-label">Visits</div>
                            <div class="info-value"><?php echo (int) $metadata['stats']['visits']; ?></div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Loads</div>
                            <div class="info-value"><?php echo (int) $metadata['stats']['loads']; ?></div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Saves</div>
                            <div class="info-value"><?php echo (int) $metadata['stats']['saves']; ?></div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Players</div>
                            <div class="info-value"><?php echo (int) $game['playerCount']; ?></div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Likes</div>
                            <div class="info-value"><?php echo $likes; ?></div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Dislikes</div>
                            <div class="info-value"><?php echo $dislikes; ?></div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Like ratio</div>
                            <div class="info-value"><?php echo $ratio; ?>%</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Favorites</div>
                            <div class="info-value"><?php echo (int) $game['favorites']; ?></div>
                        </div>
                    </div>
                </div>
            </section>

            <section id="tab-servers" class="tab-panel <?php echo $activeTab === 'servers' ? 'active' : ''; ?>">
                <div class="panel">
                    <h2 style="margin-top:0;font-size:1.1rem;">Active servers</h2>
                    <?php
                    $serverList = $game['serverList'] ?: $game['activeServers'];
                    if (empty($serverList)):
                    ?>
                        <div class="empty-state">No servers are currently running. Start the game server to populate this list.</div>
                    <?php else: ?>
                        <div class="server-list">
                            <?php foreach ($serverList as $server): ?>
                                <div class="server-item">
                                    <span><?php echo htmlspecialchars($server); ?></span>
                                    <span class="players">● 0/24</span>
                                </div>
                            <?php endforeach; ?>
                        </div>
                    <?php endif; ?>
                </div>
            </section>

            <section id="tab-store" class="tab-panel <?php echo $activeTab === 'store' ? 'active' : ''; ?>">
                <div class="panel">
                    <h2 style="margin-top:0;font-size:1.1rem;">Catalog items</h2>
                    <?php if (empty($catalogAssets)): ?>
                        <div class="empty-state">No catalog items found for this creator.</div>
                    <?php else: ?>
                        <div class="asset-grid">
                            <?php foreach ($catalogAssets as $asset): ?>
                                <div class="asset-card">
                                    <div class="asset-thumb">
                                        <?php if ($asset['thumbnailUrl']): ?>
                                            <img src="<?php echo htmlspecialchars($asset['thumbnailUrl']); ?>" alt="<?php echo htmlspecialchars($asset['name']); ?>"
                                                 onerror="this.parentNode.innerHTML='<?php echo substr(htmlspecialchars($asset['name']), 0, 1); ?>';" />
                                        <?php else: ?>
                                            <?php echo substr(htmlspecialchars($asset['name']), 0, 1); ?>
                                        <?php endif; ?>
                                    </div>
                                    <div class="asset-name"><?php echo htmlspecialchars($asset['name']); ?></div>
                                    <div class="asset-type"><?php echo htmlspecialchars($asset['assetType']); ?> · ID <?php echo $asset['id']; ?></div>
                                    <?php if ($asset['isOwned'] && $asset['isWearing']): ?>
                                        <div style="margin-top:6px;font-size:0.72rem;color:#37d39a;font-weight:700;">EQUIPPED</div>
                                    <?php elseif ($asset['isOwned']): ?>
                        <div style="margin-top:6px;font-size:0.72rem;color:#7dd3fc;font-weight:700;">OWNED</div>
                    <?php endif; ?>
                                </div>
                            <?php endforeach; ?>
                        </div>
                    <?php endif; ?>
                </div>
            </section>

            <section id="tab-badges" class="tab-panel <?php echo $activeTab === 'badges' ? 'active' : ''; ?>">
                <div class="panel">
                    <h2 style="margin-top:0;font-size:1.1rem;">Badges (<?php echo $gameBadgeCount; ?>)</h2>
                    <?php if (empty($ownerUser['badges'])): ?>
                        <div class="empty-state">No badges published for this game yet.</div>
                    <?php else: ?>
                        <div class="badge-list">
                            <?php foreach (array_slice($ownerUser['badges'], 0, 12) as $badge): ?>
                                <div class="badge-card">
                                    <div class="badge-icon"><?php echo htmlspecialchars($badge['icon'] ?? 'B'); ?></div>
                                    <div class="badge-info">
                                        <h4><?php echo htmlspecialchars($badge['name']); ?></h4>
                                        <p><?php echo htmlspecialchars($badge['description'] ?? 'No description.'); ?> · Earned <?php echo htmlspecialchars($badge['earnedDate'] ?? 'Unknown'); ?></p>
                                    </div>
                                </div>
                            <?php endforeach; ?>
                        </div>
                    <?php endif; ?>
                </div>
            </section>
        </div>

        <p><a class="back-link" href="/LuckBlox.site/games/">← Back to Games</a></p>
    </div>
    <script>
        const query = new URLSearchParams(window.location.search);
        function switchTab(id) {
            const panels = document.querySelectorAll('.tab-panel');
            const btns = document.querySelectorAll('.tab');
            panels.forEach(p => p.classList.remove('active'));
            btns.forEach(b => b.classList.remove('active'));
            document.getElementById('tab-' + id).classList.add('active');
            const activeBtn = Array.from(btns).find(b => b.textContent.toLowerCase().startsWith(id.charAt(0)) && b.textContent.toLowerCase().indexOf(id) !== -1);
            btns.forEach(b => { if (b.textContent.trim().toLowerCase() === id) b.classList.add('active'); });
            if (!activeBtn) {
                btns.forEach(b => { if (b.onclick && b.innerHTML.toLowerCase().includes(id)) b.classList.add('active'); });
            }
            query.set('tab', id);
            window.history.replaceState({}, '', window.location.pathname + '?' + query.toString());
        }
    </script>
</body>
</html>