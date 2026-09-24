<?php
/**
 * 2021 profile page renderer.
 *
 * Composes the real archived 2021 profile/avatar DOM (see
 * api/classic-profile-view.php, generated from
 * https://web.archive.org/web/20210321200603/https://www.roblox.com/users/1/profile)
 * against live LuckyBlox data, so the page is driven by what is actually stored
 * for the account rather than by canned markup.
 *
 * Structure of the real 2021 page:
 *   [ left column  ] Currently Wearing   + Recently Acquired items
 *   [ middle       ] the avatar render (the three.js viewport)
 *   [ right column ] Billing / Premium / Sales panels
 *
 * The tabs (Character / Avatar / Body Colors / ...) are part of the captured
 * chrome; the item lists and the viewport are filled in here.
 */

if (!defined('LB_CLASSIC_RENDER')) {
    define('LB_CLASSIC_RENDER', 1);
}

/**
 * Escape for HTML text/attribute.
 */
function lb_c_esc($value)
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

/**
 * Build one real 2021 item card.
 *
 * Markup copied from the archive capture so the card class names, structure and
 * data attributes match the reference page exactly.
 */
function lb_c_item_card($assetId, $name, $thumbnail, $isWearing = false)
{
    $slug = preg_replace('/[^A-Za-z0-9]+/', '-', trim($name));
    $slug = trim((string) $slug, '-');
    $href = '/catalog/' . (int) $assetId . '/' . $slug;

    $wearingBadge = $isWearing
        ? '<div class="item-card-wearing-label">Wearing</div>'
        : '';

    return '<li class="list-item item-card seven-column"><div></div>'
        . '<div class="item-card-container remove-panel" aria-disabled="false">'
        . '<div class="item-card-link">'
        . '<a href="' . lb_c_esc($href) . '" class="item-card-thumb-container"'
        . ' data-item-name="' . lb_c_esc($name) . '" data-availability-status="Available">'
        . '<div class="item-card-thumb" data-thumbnail-target-id="' . lb_c_esc($assetId) . '" data-thumbnail-type="Asset">'
        . '<span class="thumbnail-2d-container">'
        . '<img class="" src="' . lb_c_esc($thumbnail) . '" alt="">'
        . '</span></div></a>'
        . $wearingBadge
        . '</div>'
        . '<div class="item-card-caption">'
        . '<a href="' . lb_c_esc($href) . '" class="item-card-name-link">'
        . '<div title="' . lb_c_esc($name) . '" class="text-overflow item-card-name">' . lb_c_esc($name) . '</div>'
        . '</a></div></div></li>';
}

/** One card for a catalogue item the person does not own yet. */
function lb_c_catalog_card($assetId, $name, $thumbnail)
{
    return lb_c_item_card($assetId, $name, $thumbnail, false);
}

/**
 * The avatar render that occupies the middle column.
 *
 * The archived page hosted a three.js viewport here ({A} in the captured DOM).
 * The live page renders the same blocky R6 figure the rest of the site uses,
 * from the account's saved body colours, so the character on screen is the one
 * the player actually configured.
 */
function lb_c_avatar_viewport($user)
{
    return '<div class="lb-viewport" id="avatarViewport">'
        . lb_render_avatar_figure($user, 300)
        . '</div>';
}

/**
 * The "Currently Wearing" list: real assets the account has equipped.
 *
 * @param array $user          normalized user
 * @param array $wearingIds    asset ids the account has equipped
 */
function lb_c_wearing_cards($user, $wearingIds)
{
    $wearingIds = is_array($wearingIds) ? $wearingIds : array();
    if (empty($wearingIds)) {
        return '<p class="lb-empty-note">Nothing equipped yet. Pick items below to dress this character.</p>';
    }

    $cards = array();
    foreach ($wearingIds as $assetId) {
        $entry = lb_classic_avatar_item($assetId);
        if ($entry) {
            $cards[] = lb_c_item_card($entry['id'], $entry['name'], $entry['thumbnail'], true);
            continue;
        }
        // Fall back to the local asset store so owned items outside the captured
        // catalogue still render with their real name.
        $assets = lb_get_assets();
        $key = (string) $assetId;
        if (isset($assets[$key])) {
            $cards[] = lb_c_item_card($key, $assets[$key]['name'] ?? ('Asset ' . $key), '/gameplaceholder/Card_512x512/card.png', true);
        }
    }

    if (empty($cards)) {
        return '<p class="lb-empty-note">Nothing equipped yet. Pick items below to dress this character.</p>';
    }

    return '<ul class="hlist item-cards-stackable">' . implode('', $cards) . '</ul>';
}

/**
 * The "Recently Acquired" list.
 *
 * Real 2021 page behaviour: it shows items the account has actually acquired.
 * A brand-new account has nothing, so the block says so rather than showing
 * fabricated items.
 */
function lb_c_recent_cards($user)
{
    $inventory = is_array($user['inventory'] ?? null) ? $user['inventory'] : array();
    $cards = array();

    // Newest first: the tail of the inventory array is the most recent grant.
    foreach (array_reverse($inventory) as $assetId) {
        $entry = lb_classic_avatar_item($assetId);
        if ($entry) {
            $cards[] = lb_c_catalog_card($entry['id'], $entry['name'], $entry['thumbnail']);
        }
    }

    if (empty($cards)) {
        return '<p class="lb-empty-note">You have not acquired any items yet. '
            . 'Visit the <a href="/catalog">Catalog</a> to get your first item.</p>';
    }

    return '<ul class="hlist item-cards-stackable">' . implode('', $cards) . '</ul>';
}

/**
 * The real 2021 right-hand column: Billing, Premium and Sales panels.
 */
function lb_c_sidebar($user)
{
    $robux = (int) ($user['robux'] ?? 0);
    $membership = (string) ($user['membership'] ?? 'None');
    $username = (string) ($user['username'] ?? '');

    return '<div class="right-wrapper">'
        . '<div class="section-content remove-panel">'
        . '<h3>Billing</h3>'
        . '<div class="billing-row"><span>Balance</span><strong>R$ ' . lb_c_esc(number_format($robux)) . '</strong></div>'
        . '<div class="billing-row"><span>Membership</span><strong>' . lb_c_esc($membership) . '</strong></div>'
        . '<a class="btn-secondary-md" href="/upgrades/robux">Buy Robux</a>'
        . '</div>'
        . '<div class="section-content remove-panel">'
        . '<h3>Premium</h3>'
        . '<p class="lb-muted">Get more items, more Robux and trade without a membership fee.</p>'
        . '<a class="btn-secondary-md" href="/premium">Learn More</a>'
        . '</div>'
        . '<div class="section-content remove-panel">'
        . '<h3>Sales</h3>'
        . '<p class="lb-muted">Items created by ' . lb_c_esc($username) . ' and the local community.</p>'
        . '<a class="btn-secondary-md" href="/catalog">Browse the Catalog</a>'
        . '</div>'
        . '</div>';
}