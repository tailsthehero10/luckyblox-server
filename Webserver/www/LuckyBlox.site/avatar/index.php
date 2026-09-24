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
$avatar = is_array($c['avatar'] ?? null) ? $c['avatar'] : array();
$bodyColors = $avatar['bodyColors'] ?? array(
    'headColorId' => 1002, 'torsoColorId' => 1002,
    'rightArmColorId' => 1002, 'leftArmColorId' => 1002,
    'rightLegColorId' => 1002, 'leftLegColorId' => 1002,
);
$gender = $c['gender'] ?? ($avatar['gender'] ?? 'NotSpecified');
$palette = lb_body_color_palette();
$avatarUrls = lb_get_avatar_urls($c);
$ownAssets = lb_get_user_assets($c);
$wearing = is_array($c['currentlyWearing'] ?? null) ? $c['currentlyWearing'] : array();
$csrfToken = lb_get_csrf_token();
$featuredPlaceId = lb_get_latest_published_place_id();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="csrf" content="<?php echo htmlspecialchars($csrfToken); ?>" />
    <title>Avatar | LuckyBlox</title>
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
        .layout { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-top:24px; }
        .panel { background:rgba(15,23,42,0.95); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:20px; box-shadow:0 10px 24px rgba(0,0,0,0.3); }
        .panel h2 { margin:0 0 14px; font-size:1.05rem; }
        .avatar-stage { min-height:280px; display:flex; align-items:center; justify-content:center; background:linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.25)); border-radius:12px; border:1px solid rgba(255,255,255,0.06); }
        .avatar-real img { width:150px; height:280px; object-fit:contain; }
        .r6-figure { position:relative; width:120px; height:240px; }
        .r6-part { position:absolute; border:1px solid rgba(0,0,0,0.3); }
        .r6-head { width:40px; height:40px; left:40px; top:0; }
        .r6-torso { width:56px; height:60px; left:32px; top:44px; }
        .r6-left-arm { width:20px; height:54px; left:12px; top:50px; }
        .r6-right-arm { width:20px; height:54px; left:88px; top:50px; }
        .r6-left-leg { width:20px; height:60px; left:42px; top:108px; }
        .r6-right-leg { width:20px; height:60px; left:62px; top:108px; }
        .r6-face { position:absolute; top:14px; left:50%; transform:translateX(-50%); font-size:18px; }
        .color-picker { display:grid; grid-template-columns:repeat(6,1fr); gap:6px; max-height:240px; overflow-y:auto; padding:6px 0; }
        .color-swatch { width:42px; height:42px; border-radius:8px; cursor:pointer; border:2px solid transparent; transition:0.15s; position:relative; }
        .color-swatch:hover { transform:scale(1.1); }
        .color-swatch.selected { border-color:#7dd3fc; box-shadow:0 0 0 2px rgba(125,211,252,0.4); }
        .color-swatch span { position:absolute; bottom:-14px; left:50%; transform:translateX(-50%); font-size:0.52rem; color:#94a3b8; white-space:nowrap; }
        .body-part-row { display:flex; align-items:center; gap:10px; margin-bottom:12px; cursor:pointer; }
        .body-part-label { width:120px; font-size:0.82rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.04em; }
        .body-part-current { width:30px; height:30px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); flex-shrink:0; }
        .body-part-name { font-size:0.82rem; font-weight:700; color:#e2e8f0; }
        .gender-select { background:rgba(15,23,42,0.95); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:10px; color:#e2e8f0; font-size:0.9rem; cursor:pointer; width:100%; }
        .button { display:inline-flex; align-items:center; justify-content:center; padding:12px 20px; border-radius:10px; font-weight:800; border:1px solid transparent; cursor:pointer; transition:0.15s; }
        .button.primary { background:linear-gradient(135deg,#7dd3fc,#4ca3ff); color:#06161f; box-shadow:0 10px 24px rgba(76,163,255,0.36); }
        .button.primary:hover { filter:brightness(1.1); }
        .button.secondary { background:rgba(255,255,255,0.03); color:#e2e8f0; border-color:rgba(255,255,255,0.08); }
        .button-row { display:flex; gap:12px; margin-top:16px; }
        .status { margin-top:12px; min-height:18px; font-size:0.85rem; }
        .status.ok { color:#37d39a; }
        .status.err { color:#fca5a5; }
        .wearing-item { display:inline-flex; align-items:center; gap:6px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:4px 10px; font-size:0.8rem; margin:2px; }
        @media (max-width: 900px) { .layout { grid-template-columns:1fr; } }
    </style>
</head>
<body>
    <div class="container">
        <header class="topbar">
            <div class="brand"><img src="/site-icon/luckyblox.png" alt="LuckyBlox" /><span>LuckyBlox</span></div>
            <nav class="nav">
                <a href="/LuckBlox.site/home">Home</a>
                <a href="/LuckBlox.site/games">Games</a>
                <a class="active" href="/LuckBlox.site/avatar">Avatar</a>
                <a href="/LuckBlox.site/avatar-shop">Avatar Shop</a>
                <a href="/LuckBlox.site/users/<?php echo $userId; ?>/profile">Profile</a>
                <a href="/LuckBlox.site/settings">Settings</a>
                <a href="/LuckBlox.site/share">Share</a>
                <a href="/LuckBlox.site/about">About</a>
            </nav>
        </header>

        <section class="hero">
            <h1>Customize Avatar</h1>
            <p style="color:#94a3b8;">Adjust your body colors, gender, and equipped items. Changes are saved to your profile.</p>
        </section>

        <div class="layout">
            <div class="panel">
                <h2>Avatar preview</h2>
                <div class="avatar-stage">
                    <?php if ($avatarUrls['fullBodyUrl']): ?>
                        <div class="avatar-real">
                            <img src="<?php echo htmlspecialchars($avatarUrls['fullBodyUrl']); ?>" alt="Roblox avatar" id="avatarPreview"
                                 onerror="this.style.display='none';document.getElementById('r6Figure').style.display='block';" />
                            <div class="r6-figure" id="r6Figure" style="display:none;">
                                <div class="r6-head r6-part" id="r6Head"></div>
                                <div class="r6-torso r6-part" id="r6Torso"></div>
                                <div class="r6-left-arm r6-part" id="r6LeftArm"></div>
                                <div class="r6-right-arm r6-part" id="r6RightArm"></div>
                                <div class="r6-left-leg r6-part" id="r6LeftLeg"></div>
                                <div class="r6-right-leg r6-part" id="r6RightLeg"></div>
                                <div class="r6-face" id="r6Face">:B</div>
                            </div>
                        </div>
                    <?php else: ?>
                        <div class="r6-figure" id="r6Figure">
                            <div class="r6-head r6-part" id="r6Head"></div>
                            <div class="r6-torso r6-part" id="r6Torso"></div>
                            <div class="r6-left-arm r6-part" id="r6LeftArm"></div>
                            <div class="r6-right-arm r6-part" id="r6RightArm"></div>
                            <div class="r6-left-leg r6-part" id="r6LeftLeg"></div>
                            <div class="r6-right-leg r6-part" id="r6RightLeg"></div>
                            <div class="r6-face" id="r6Face">:B</div>
                        </div>
                    <?php endif; ?>
                </div>

                <p style="color:#64748b;font-size:0.85rem;margin:12px 0 0;">
                    <?php echo $avatarUrls['fullBodyUrl'] ? 'Real avatar from Roblox (robloxUserId linked). Local preview below if image fails.' : 'Local R6 body preview driven by body color settings.'; ?>
                </p>

                <h2 style="margin-top:18px;">Currently wearing</h2>
                <?php if (empty($wearing)): ?>
                    <p style="color:#64748b;font-size:0.85rem;">Not wearing any items.</p>
                <?php else: ?>
                    <?php foreach ($wearing as $wAssetId): ?>
                        <?php
                        $asset = null;
                        foreach ($ownAssets as $a) { if ($a['id'] === (string)$wAssetId) { $asset = $a; break; } }
                        ?>
                        <span class="wearing-item">ID <?php echo htmlspecialchars($wAssetId); ?>
                            <?php if ($asset): ?><span style="color:#64748b;">·</span><span><?php echo htmlspecialchars($asset['name']); ?></span><?php endif; ?>
                        </span>
                    <?php endforeach; ?>
                <?php endif; ?>
                <p style="margin:10px 0 0;color:#64748b;font-size:0.82rem;">
                    <a href="/LuckBlox.site/avatar-shop" style="color:#7dd3fc;">Go to Avatar Shop</a> to equip more items.
                </p>
            </div>

            <div class="panel">
                <h2>Gender (optional)</h2>
                <select class="gender-select" id="genderSelect" onchange="setGender(this.value)">
                    <option value="NotSpecified" <?php if ($gender === 'NotSpecified') echo 'selected'; ?>>Not specified</option>
                    <option value="Male" <?php if ($gender === 'Male') echo 'selected'; ?>>Male</option>
                    <option value="Female" <?php if ($gender === 'Female') echo 'selected'; ?>>Female</option>
                </select>
                <p style="color:#64748b;font-size:0.8rem;margin:4px 0 0;">Choosing a gender applies matching default body colors.</p>

                <h2 style="margin-top:18px;">Body colors</h2>
                <?php
                $bodyParts = array('headColorId', 'torsoColorId', 'rightArmColorId', 'leftArmColorId', 'rightLegColorId', 'leftLegColorId');
                $partLabels = array('Head', 'Torso', 'Right Arm', 'Left Arm', 'Right Leg', 'Left Leg');
                ?>
                <?php for ($i = 0; $i < count($bodyParts); $i++): ?>
                    <div class="body-part-row" onclick="selectPart('<?php echo $bodyParts[$i]; ?>')">
                        <span class="body-part-label"><?php echo $partLabels[$i]; ?></span>
                        <div class="body-part-current" id="current-<?php echo $bodyParts[$i]; ?>"
                             style="background:rgb(<?php echo lb_body_color_rgb($bodyColors[$bodyParts[$i]] ?? 1002); ?>);"></div>
                        <span class="body-part-name" id="name-<?php echo $bodyParts[$i]; ?>"><?php echo lb_body_color_name($bodyColors[$bodyParts[$i]] ?? 1002); ?></span>
                        <span style="color:#64748b;font-size:0.8rem;">ID <?php echo (int)($bodyColors[$bodyParts[$i]] ?? 1002); ?></span>
                    </div>
                <?php endfor; ?>

                <div class="color-picker" id="colorPicker"></div>

                <div class="button-row">
                    <button class="button primary" onclick="saveAvatar()">Save avatar</button>
                    <button class="button secondary" onclick="resetColors()">Reset to default</button>
                </div>
                <div class="status" id="saveStatus"></div>
            </div>
        </div>
    </div>
    <script>
        var bodyColors = <?php echo json_encode(array(
            'headColorId' => (int)($bodyColors['headColorId'] ?? 1002),
            'torsoColorId' => (int)($bodyColors['torsoColorId'] ?? 1002),
            'rightArmColorId' => (int)($bodyColors['rightArmColorId'] ?? 1002),
            'leftArmColorId' => (int)($bodyColors['leftArmColorId'] ?? 1002),
            'rightLegColorId' => (int)($bodyColors['rightLegColorId'] ?? 1002),
            'leftLegColorId' => (int)($bodyColors['leftLegColorId'] ?? 1002),
        )); ?>;
        var palette = <?php echo json_encode($palette); ?>;
        var userId = <?php echo $userId; ?>;
        var currentlySelected = 'headColorId';
        var useRobloxImage = <?php echo $avatarUrls['fullBodyUrl'] ? 'true' : 'false'; ?>;
        var csrfToken = document.querySelector('meta[name="csrf"]').getAttribute('content');

        var partMap = {
            'r6Head': 'headColorId',
            'r6Torso': 'torsoColorId',
            'r6LeftArm': 'leftArmColorId',
            'r6RightArm': 'rightArmColorId',
            'r6LeftLeg': 'leftLegColorId',
            'r6RightLeg': 'rightLegColorId'
        };

        function rgbFromId(id) {
            for (var i = 0; i < palette.length; i++) {
                if (palette[i].id === Number(id)) return palette[i].rgb;
            }
            return '205,205,205';
        }
        function nameFromId(id) {
            for (var i = 0; i < palette.length; i++) {
                if (palette[i].id === Number(id)) return palette[i].name;
            }
            return 'Unknown';
        }

        function updatePreview() {
            if (useRobloxImage) {
                var preview = document.getElementById('avatarPreview');
                if (preview && preview.style.display !== 'none') {
                    preview.src = 'https://thumbnails.roblox.com/v1/users/avatar?userIds=' + userId + '&size=420x420&format=Png&cachebuster=' + Date.now();
                }
            }
            Object.keys(partMap).forEach(function(elId) {
                var part = document.getElementById(elId);
                if (part) {
                    var colorId = bodyColors[partMap[elId]];
                    part.style.background = 'rgb(' + rgbFromId(colorId) + ')';
                }
            });
        }

        function selectPart(partId) {
            currentlySelected = partId;
            var rows = document.querySelectorAll('.body-part-row');
            rows.forEach(function(row) {
                row.style.border = '2px solid transparent';
                var labelSpan = row.querySelector('.body-part-label');
                if (labelSpan) {
                    var pid = labelSpan.textContent.trim().toLowerCase().replace(/\s/g,'');
                    var idMap = {'head':'headColorId','torso':'torsoColorId','rightarm':'rightArmColorId','leftarm':'leftArmColorId','rightleg':'rightLegColorId','leftleg':'leftLegColorId'};
                    if (idMap[pid] === partId) {
                        row.style.border = '2px solid #7dd3fc';
                    }
                }
            });
        }

        function renderPicker() {
            var picker = document.getElementById('colorPicker');
            picker.innerHTML = '';
            palette.forEach(function(c) {
                var sw = document.createElement('div');
                sw.className = 'color-swatch';
                sw.style.background = 'rgb(' + c.rgb + ')';
                sw.title = c.name + ' (ID ' + c.id + ')';
                sw.onclick = function() {
                    bodyColors[currentlySelected] = c.id;
                    var cur = document.getElementById('current-' + currentlySelected);
                    if (cur) { cur.style.background = 'rgb(' + c.rgb + ')'; }
                    var nm = document.getElementById('name-' + currentlySelected);
                    if (nm) { nm.textContent = c.name; }
                    var idSpan = nm ? nm.nextElementSibling : null;
                    if (idSpan) { idSpan.textContent = 'ID ' + c.id; }
                    var active = picker.querySelectorAll('.color-swatch.selected');
                    active.forEach(function(s) { s.classList.remove('selected'); });
                    sw.classList.add('selected');
                    updatePreview();
                };
                var nameSpan = document.createElement('span');
                nameSpan.textContent = c.name;
                sw.appendChild(nameSpan);
                picker.appendChild(sw);
            });
            // Auto-select first swatch for the default body part
            var first = picker.querySelector('.color-swatch');
            if (first) { first.classList.add('selected'); }
        }

        function saveAvatar() {
            var status = document.getElementById('saveStatus');
            status.textContent = 'Saving avatar...';
            status.className = 'status';
            var colors = {
                headColorId: bodyColors.headColorId,
                torsoColorId: bodyColors.torsoColorId,
                rightArmColorId: bodyColors.rightArmColorId,
                leftArmColorId: bodyColors.leftArmColorId,
                rightLegColorId: bodyColors.rightLegColorId,
                leftLegColorId: bodyColors.leftLegColorId
            };
            var params = 'userId=' + encodeURIComponent(userId) +
                         '&csrf=' + encodeURIComponent(csrfToken) +
                         '&colors=' + encodeURIComponent(JSON.stringify(colors)) +
                         '&gender=' + encodeURIComponent(document.getElementById('genderSelect').value);
            fetch('/LuckBlox.site/api/avatar-save.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data && data.ok) {
                    status.textContent = 'Avatar saved.';
                    status.className = 'status ok';
                } else {
                    status.textContent = 'Save failed: ' + (data && data.error ? data.error : 'unknown');
                    status.className = 'status err';
                }
            }).catch(function() {
                status.textContent = 'Save failed (network error).';
                status.className = 'status err';
            });
        }

        function setGender(val) {
            var status = document.getElementById('saveStatus');
            status.textContent = 'Updating gender...';
            status.className = 'status';
            var colors = {
                headColorId: bodyColors.headColorId,
                torsoColorId: bodyColors.torsoColorId,
                rightArmColorId: bodyColors.rightArmColorId,
                leftArmColorId: bodyColors.leftArmColorId,
                rightLegColorId: bodyColors.rightLegColorId,
                leftLegColorId: bodyColors.leftLegColorId
            };
            var params = 'userId=' + encodeURIComponent(userId) +
                         '&csrf=' + encodeURIComponent(csrfToken) +
                         '&colors=' + encodeURIComponent(JSON.stringify(colors)) +
                         '&gender=' + encodeURIComponent(val);
            fetch('/LuckBlox.site/api/avatar-save.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params
            }).then(function(r) { return r.json(); }).then(function(data) {
                status.textContent = data && data.ok ? 'Gender updated.' : 'Update failed.';
                status.className = 'status ' + (data && data.ok ? 'ok' : 'err');
                if (data && data.ok) setTimeout(function() { status.textContent =''; }, 1500);
            }).catch(function() {
                status.textContent = 'Update failed.';
                status.className = 'status err';
            });
        }

        function resetColors() {
            fetch('/LuckBlox.site/api/avatar-save.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'userId=' + encodeURIComponent(userId) +
                      '&csrf=' + encodeURIComponent(csrfToken) +
                      '&gender=' + encodeURIComponent(document.getElementById('genderSelect').value) +
                      '&reset=1'
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data && data.ok && data.colors) {
                    var keys = Object.keys(data.colors);
                    keys.forEach(function(k) { bodyColors[k] = data.colors[k]; });
                    var cur = document.getElementById('current-headColorId');
                    if (cur) cur.style.background = 'rgb(' + rgbFromId(bodyColors.headColorId) + ')';
                    var picker = document.getElementById('colorPicker');
                    var active = picker.querySelectorAll('.color-swatch.selected');
                    active.forEach(function(s) { s.classList.remove('selected'); });
                    updatePreview();
                }
                var status = document.getElementById('saveStatus');
                status.textContent = data && data.ok ? 'Reset to default.' : 'Reset failed.';
                status.className = 'status ' + (data && data.ok ? 'ok' : 'err');
            });
        }

        renderPicker();
        updatePreview();
    </script>
</body>
</html>
