<?php
/**
 * /LuckBlox.site/users/<id>/profile - the 2021-style profile page.
 *
 * Rebuilt against the archived reference:
 *   https://web.archive.org/web/20210321200603/https://www.roblox.com/users/1/profile
 *
 * The page chrome (avatar editor shell, the 8 tabs, the shape sliders, the
 * right-hand Billing/Premium/Sales column) is the real 2021 DOM, generated from
 * the archive capture by tools/extract/build-profile-helper.js. Everything that
 * varies per account - equipped items, recently acquired, the avatar render, the
 * wallet, the counters - is filled in from the stored account record, so the
 * page shows this player's real state.
 *
 * Routing (Apache falls through to this file for the whole subtree):
 *   /LuckBlox.site/users/1/profile          -> profile of user 1
 *   /LuckBlox.site/users/1/profile#!/about  -> same document (2021 used #! tabs)
 *   /LuckBlox.site/users/<name>/profile     -> resolved by username
 */

require_once __DIR__ . '/../../../api/luckyblox-data.php';
require_once __DIR__ . '/../../../api/classic-render.php';

session_start();

// ---------------------------------------------------------------------------
// Which account is this page for?
// ---------------------------------------------------------------------------
$rawId = isset($_GET['id']) ? (string) $_GET['id'] : '1';
$rawId = trim(urldecode($rawId));

$user = null;
if ($rawId !== '' && !ctype_digit($rawId)) {
    $user = lb_find_user_by_username($rawId);
    $userId = $user ? (int) $user['userId'] : 1;
} else {
    $userId = max(1, (int) preg_replace('/[^0-9]/', '', $rawId));
}

if (!$user) {
    $user = lb_find_user_by_id($userId);
}
if (!$user) {
    $user = lb_normalize_user(array(
        'userId' => (string) $userId,
        'username' => 'Unknown',
        'displayName' => 'Unknown',
        'membership' => 'None',
        'robux' => 0,
    ), (string) $userId);
}

$viewer = lb_get_current_user();
$isProfileOwner = $viewer && (string) $viewer['userId'] === (string) $user['userId'];

// ---------------------------------------------------------------------------
// Live account state.
// ---------------------------------------------------------------------------
$avatar = is_array($user['avatar'] ?? null) ? $user['avatar'] : array();
$bodyColors = is_array($avatar['bodyColors'] ?? null) ? $avatar['bodyColors'] : array();
$wearingIds = is_array($user['currentlyWearing'] ?? null) ? $user['currentlyWearing'] : array();
$inventory = is_array($user['inventory'] ?? null) ? $user['inventory'] : array();
$stats = is_array($user['stats'] ?? null) ? $user['stats'] : array();

$friendsCount = (int) ($stats['friends'] ?? count($user['friends'] ?? array()));
$followersCount = (int) ($stats['followers'] ?? 0);
$followingCount = (int) ($stats['following'] ?? count($user['following'] ?? array()));

// This account's published places, read from the store rather than assumed.
// Merged with the games store so a published experience carries its real icon,
// votes and live player count into the Creations tab.
$gamesById = array();
foreach (lb_get_all_games() as $game) {
    $gamesById[(int) $game['placeId']] = $game;
}

$myCreations = array();
foreach (lb_get_places() as $key => $place) {
    if (!is_array($place)) {
        continue;
    }
    $owner = (string) ($place['authorId'] ?? ($place['creatorId'] ?? ''));
    if ($owner !== (string) $user['userId']) {
        continue;
    }
    $placeId = (int) ($place['placeId'] ?? $key);
    $name = $place['name'] ?? ('Place ' . $key);

    if (isset($gamesById[$placeId])) {
        // Enrich the stored place with the game record's live statistics.
        $myCreations[] = array_merge($gamesById[$placeId], array(
            'placeId' => $placeId,
            'title' => $gamesById[$placeId]['title'] ?: $name,
        ));
    } else {
        $myCreations[] = array(
            'placeId' => $placeId,
            'name' => $name,
            'title' => $name,
            'description' => $place['description'] ?? '',
            'likes' => 0,
            'dislikes' => 0,
            'playerCount' => 0,
        );
    }
}
$creationsCount = max((int) ($stats['created'] ?? 0), count($myCreations));

// The requested tab. The 2021 profile switched tabs client-side off #!/hash, so
// read it from the query string here and let the page script take over after load.
$requestedTab = strtolower(trim((string) ($_GET['tab'] ?? 'about')));
$activeTab = $requestedTab === 'creations' ? 'creations' : 'about';

// ---------------------------------------------------------------------------
// Compose the body: real 2021 chrome + live content.
// ---------------------------------------------------------------------------
$shell = lb_classic_avatar_shell();

// 1. The viewport. The archived page left an empty three.js canvas ({A}); the
//    live page draws this account's actual blocky character here.
$shell = str_replace('{A}', lb_c_avatar_viewport($user), $shell);

// 2. "Currently Wearing": the real items this account has equipped.
$shell = preg_replace(
    '#(<div class="section-content remove-panel"><h3>[^<]*</h3>)(.*?)(</div>)#s',
    '$1' . "\n" . lb_c_wearing_cards($user, $wearingIds) . "\n" . '$3',
    $shell,
    1
);

// 3. "Recently Acquired": the real inventory, newest first.
$shell = preg_replace(
    '#(<ul class="hlist item-cards-stackable">).*?(</ul>)#s',
    '$1' . "\n" . lb_c_recent_cards($user) . "\n" . '$2',
    $shell,
    1
);

// 4. The right-hand Billing / Premium / Sales column, with the live wallet.
$sidebarStart = strpos($shell, '<div class="right-wrapper">');
if ($sidebarStart !== false) {
    $shell = substr($shell, 0, $sidebarStart) . lb_c_sidebar($user);
}

// 5. Every archived href pointed at roblox.com. Route them at the local site.
//    Longer, more specific paths first so nothing is partly rewritten.
$shell = str_replace(
    array(
        '{U}/search/users?keyword=',
        '{U}/users/friends',
        '{U}/my/messages',
        '{U}/upgrades/robux',
        '{U}/transactions',
        '{U}/inventory',
        '{U}/premium',
        '{U}/catalog',
        '{U}/avatar',
        '{U}/develop',
        '{U}/games',
        '{U}/home',
        '{U}/logout',
        '{U}',
    ),
    array(
        '/search/users?keyword=',
        '/users/friends',
        '/my/messages',
        '/upgrades/robux',
        '/transactions',
        '/inventory',
        '/premium',
        '/catalog',
        '/avatar',
        '/develop',
        '/games',
        '/home',
        '/logout',
        '',
    ),
    $shell
);

// 6. Wrap the captured profile column in the real About tab pane and append the
//    Creations pane, so the two tabs the 2021 page shipped both exist here.
$aboutPane = lb_c_about_pane_open($activeTab !== 'about')
    . '<div class="profile-about">' . $shell . '</div>'
    . lb_c_about_pane_close();

$tabs = '<div class="profile-tabs">'
    . lb_c_profile_tab_strip($activeTab)
    . '<div class="tab-content rbx-tab-content">'
    . $aboutPane
    . lb_c_creations_pane($myCreations, $activeTab !== 'creations')
    . '</div></div>';

// The tab strip replaces the archived page's own tab row if it rendered one;
// otherwise it is appended to the profile body.
if (strpos($body, 'id="horizontal-tabs"') !== false) {
    $body = preg_replace(
        '#<div class="profile-tab-strip rbx-tabs-horizontal">.*?</div>#s',
        $tabs,
        $body,
        1
    );
} else {
    $body = lb_classic_profile_head() . $tabs . lb_classic_profile_foot();
}

$head = '<meta name="lb-user-id" content="' . (int) $userId . '" />'
    . '<meta name="lb-username" content="' . lb_c_esc($user['username']) . '" />'
    . '<meta name="lb-csrf" content="' . lb_c_esc(lb_get_csrf_token()) . '" />'
    . '<script type="application/json" id="lb-profile-data">'
    . json_encode(array(
        'userId' => (string) $user['userId'],
        'username' => $user['username'],
        'displayName' => $user['displayName'],
        'robux' => (int) $user['robux'],
        'wearing' => array_values(array_map('strval', $wearingIds)),
        'inventory' => array_values(array_map('strval', $inventory)),
        'bodyColors' => $bodyColors,
        'friends' => $friendsCount,
        'followers' => $followersCount,
        'following' => $followingCount,
        'creations' => $creationsCount,
        'isProfileOwner' => (bool) $isProfileOwner,
        'profileUrl' => '/users/' . (int) $userId . '/profile',
    ), JSON_UNESCAPED_SLASHES)
    . '</script>';

echo lb_classic_layout($user['displayName'] . ' - Roblox', $body, $head);