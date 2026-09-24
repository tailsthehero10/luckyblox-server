<?php
require_once __DIR__ . '/../../api/luckyblox-data.php';

session_start();

$c = lb_get_current_user();
if (!$c) {
    $c = lb_find_user_by_id(1);
    if (!$c) {
        $c = array('userId' => '1', 'username' => 'LocalPlayer', 'displayName' => 'LocalPlayer', 'avatar' => array());
    }
}

$userId = (int)($c['userId'] ?? 1);
$wearing = is_array($c['currentlyWearing'] ?? null) ? $c['currentlyWearing'] : array();
$wearingSet = array();
foreach ($wearing as $id) {
    $wearingSet[(string) $id] = true;
}

$ownAssets = lb_get_user_assets($c);
$catalogItems = lb_catalog_items();

$csrfToken = lb_get_csrf_token();
$featuredPlaceId = lb_get_latest_published_place_id();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="csrf" content="<?php echo htmlspecialchars($csrfToken); ?>" />
    <title>Avatar Shop | LuckyBlox</title>
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
        .hero h1 { margin:0 0 6px; font-size:clamp(1.6rem,2.5vw,2.2rem); letter-spacing:-0.04em; }
        .hero p { color:#94a3b8; margin:0; }
        .section-title { font-size:1.1rem; font-weight:700; margin:18px 0 12px; padding-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.08); }
        .asset-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:14px; }
        .asset-card { background:rgba(15,23,42,0.95); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:12px; text-align:center; box-shadow:0 6px 16px rgba(0,0,0,0.25); transition:0.15s; position:relative; }
        .asset-card:hover { border-color:rgba(76,163,255,0.35); transform:translateY(-2px); }
        .asset-card.owned { border-color:rgba(55,211,154,0.3); }
        .asset-card.wearing { border-color:rgba(125,211,252,0.5); box-shadow:0 0 0 3px rgba(125,211,252,0.2); }
        .asset-thumb { width:56px; height:56px; margin:0 auto 8px; border-radius:8px; background:rgba(76,163,255,0.12); display:grid; place-items:center; overflow:hidden; border:1px solid rgba(255,255,255,0.06); }
        .asset-thumb img { width:100%; height:100%; object-fit:contain; }
        .asset-thumb .fallback { font-size:1.1rem; font-weight:700; color:#7dd3fc; }
        .asset-name { font-size:0.8rem; font-weight:700; color:#e2e8f0; margin:6px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .asset-meta { font-size:0.68rem; color:#64748b; text-transform:uppercase; }
        .asset-price { position:absolute; top:6px; right:6px; background:rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:2px 6px; font-size:0.68rem; font-weight:700; color:#ffd700; }
        .wear-btn { width:100%; padding:6px; margin-top:8px; border:none; border-radius:6px; font-size:0.78rem; font-weight:700; cursor:pointer; }
        .wear-btn.owned { background:rgba(55,211,154,0.15); color:#37d39a; border:1px solid rgba(55,211,154,0.3); }
        .wear-btn.owned.wearing { background:linear-gradient(135deg,#7dd3fc,#4ca3ff); color:#06161f; }
        .wear-btn.catalog { background:linear-gradient(135deg,#7dd3fc,#4ca3ff); color:#06161f; }
        .wear-btn:hover { filter:brightness(1.1); }
        .button { display:inline-flex; align-items:center; justify-content:center; padding:12px 20px; border-radius:10px; font-weight:800; border:1px solid transparent; cursor:pointer; transition:0.15s; }
        .button.primary { background:linear-gradient(135deg,#7dd3fc,#4ca3ff); color:#06161f; box-shadow:0 10px 24px rgba(76,163,255,0.36); }
        .button.secondary { background:rgba(255,255,255,0.03); color:#e2e8f0; border-color:rgba(255,255,255,0.08); }
        .button-row { display:flex; gap:12px; margin-top:16px; }
        .status { margin-top:12px; min-height:18px; font-size:0.85rem; }
        .status.ok { color:#37d39a; }
        .status.err { color:#fca5a5; }
    </style>
</head>
<body>
    <div class="container">
        <header class="topbar">
            <div class="brand"><img src="/site-icon/luckyblox.png" alt="LuckyBlox" /><span>LuckyBlox</span></div>
            <nav class="nav">
                <a href="/LuckBlox.site/home">Home</a>
                <a href="/LuckBlox.site/games">Games</a>
                <a href="/LuckBlox.site/game?placeid=<?php echo (int) $featuredPlaceId; ?>">Game</a>
                <a class="active" href="/LuckBlox.site/avatar">Avatar</a>
                <a class="active" href="/LuckBlox.site/avatar-shop">Avatar Shop</a>
                <a href="/LuckBlox.site/users/<?php echo $userId; ?>/profile">Profile</a>
                <a href="/LuckBlox.site/settings">Settings</a>
                <a href="/LuckBlox.site/share">Share</a>
                <a href="/LuckBlox.site/about">About</a>
            </nav>
        </header>

        <section class="hero">
            <h1>Avatar Shop</h1>
            <p>Choose from saved local assets or browse the Roblox catalog. Click an item to equip it.</p>
        </section>

        <div class="section-title">My Inventory (<?php echo count($ownAssets); ?>)</div>
        <?php if (empty($ownAssets)): ?>
            <p style="color:#64748b;">You don\'t own any avatar items yet.</p>
        <?php else: ?>
            <div class="asset-grid">
                <?php foreach ($ownAssets as $asset): ?>
                    <div class="asset-card owned <?php echo $asset['isWearing'] ? 'wearing' : ''; ?>" data-asset-id="<?php echo $asset['id']; ?>">
                        <?php if ($asset['price'] > 0): ?>
                            <span class="asset-price">R$<?php echo $asset['price']; ?></span>
                        <?php endif; ?>
                        <div class="asset-thumb">
                            <?php if ($asset['thumbnailUrl']): ?>
                                <img src="<?php echo htmlspecialchars($asset['thumbnailUrl']); ?>" alt="<?php echo htmlspecialchars($asset['name']); ?>"
                                     onerror="this.style.display='none';this.parentNode.innerHTML='<span class=\"fallback\"><?php echo substr(htmlspecialchars($asset['name']), 0, 1); ?></span>';" />
                            <?php else: ?>
                                <span class="fallback"><?php echo substr(htmlspecialchars($asset['name']), 0, 1); ?></span>
                            <?php endif; ?>
                        </div>
                        <div class="asset-name"><?php echo htmlspecialchars($asset['name']); ?></div>
                        <div class="asset-meta"><?php echo htmlspecialchars($asset['assetType']); ?> · ID <?php echo $asset['id']; ?></div>
                        <button class="wear-btn owned <?php echo $asset['isWearing'] ? 'wearing' : ''; ?>"
                                data-select-asset="<?php echo $asset['id']; ?>"
                                type="button"><?php echo $asset['isWearing'] ? 'Equipped' : 'Wear'; ?></button>
                    </div>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>

        <div class="section-title">Roblox Catalog</div>
        <?php if (empty($catalogItems)): ?>
            <p style="color:#64748b;">No catalog items available.</p>
        <?php else: ?>
            <div class="asset-grid">
                <?php foreach ($catalogItems as $item): ?>
                    <div class="asset-card <?php echo $item['isOwned'] ? 'owned' : ''; ?> <?php echo isset($wearingSet[$item['id']]) ? 'wearing' : ''; ?>" data-asset-id="<?php echo $item['id']; ?>">
                        <?php if ($item['price'] > 0): ?>
                            <span class="asset-price">R$<?php echo $item['price']; ?></span>
                        <?php endif; ?>
                        <div class="asset-thumb">
                            <?php if ($item['thumbnailUrl']): ?>
                                <img src="<?php echo htmlspecialchars($item['thumbnailUrl']); ?>" alt="<?php echo htmlspecialchars($item['name']); ?>"
                                     onerror="this.style.display='none';this.parentNode.innerHTML='<span class=\"fallback\"><?php echo substr(htmlspecialchars($item['name']), 0, 1); ?>'; />" />
                            <?php else: ?>
                                <span class="fallback"><?php echo substr(htmlspecialchars($item['name']), 0, 1); ?></span>
                            <?php endif; ?>
                        </div>
                        <div class="asset-name"><?php echo htmlspecialchars($item['name']); ?></div>
                        <div class="asset-meta"><?php echo htmlspecialchars($item['assetType']); ?> · ID <?php echo $item['id']; ?></div>
                        <button class="wear-btn catalog" data-select-asset="<?php echo $item['id']; ?>" type="button">Wear</button>
                    </div>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>

        <div class="button-row">
            <button class="button primary" onclick="saveOutfit()">Save outfit</button>
            <a class="button secondary" href="/LuckBlox.site/avatar">Customize avatar</a>
        </div>
        <div class="status" id="shopStatus"></div>
    </div>
    <script>
        var userId = <?php echo $userId; ?>;
        var selected = new Set(<?php echo json_encode(array_values($wearing)); ?>);
        var csrf = document.querySelector('meta[name="csrf"]').getAttribute('content');

        function updateWearButtons() {
            document.querySelectorAll('[data-select-asset]').forEach(function(btn) {
                var card = btn.closest('.asset-card');
                var id = btn.getAttribute('data-select-asset');
                var isSelected = selected.has(id);

                if (card.classList.contains('owned')) {
                    if (isSelected) {
                        btn.textContent = 'Equipped';
                        btn.className = 'wear-btn owned wearing';
                        card.classList.add('wearing');
                    } else {
                        btn.textContent = 'Wear';
                        btn.className = 'wear-btn owned';
                        card.classList.remove('wearing');
                    }
                } else {
                    btn.textContent = isSelected ? 'Equipped' : 'Wear';
                    btn.className = 'wear-btn catalog';
                    card.classList.toggle('wearing', isSelected);
                }
            });
        }

        document.addEventListener('click', function(event) {
            var btn = event.target.closest('[data-select-asset]');
            if (!btn) return;
            var id = btn.getAttribute('data-select-asset');
            if (selected.has(id)) {
                selected.delete(id);
            } else {
                selected.add(id);
            }
            updateWearButtons();
        });

        function saveOutfit() {
            var status = document.getElementById('shopStatus');
            status.textContent = 'Saving outfit...';
            status.className = 'status';
            var wearingList = Array.from(selected);
            var formData = new FormData();
            formData.set('userId', userId);
            formData.set('csrf', csrf);
            formData.set('wearing', JSON.stringify(wearingList));

            fetch('/LuckBlox.site/api/avatar-save.php', {
                method: 'POST',
                body: formData
            }).then(function(r) { return r.text(); }).then(function(txt) {
                var ok = txt.indexOf('"ok":true') !== -1 || txt.indexOf('"ok"') !== -1 && txt.indexOf('true') !== -1;
                status.textContent = 'Outfit saved.';
                status.className = 'status ok';
            }).catch(function() {
                status.textContent = 'Save failed.';
                status.className = 'status err';
            });
        }
    </script>
</body>
</html>
