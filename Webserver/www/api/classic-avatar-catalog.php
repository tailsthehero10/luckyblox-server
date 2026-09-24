<?php
/**
 * Real 2021 avatar catalogue items.
 *
 * GENERATED FILE - do not edit by hand.
 * Rebuild with: node tools/extract/gen-avatar-catalog.js
 *
 * Every entry was lifted from the archived 2021 avatar page
 *   https://web.archive.org/web/20210321200603/https://www.roblox.com/users/1/profile
 * along with the thumbnail the page actually displayed, which is served from
 * /avatar-thumbs/ so the profile renders the real item art instead of initials.
 *
 * Shape: assetId => array(itemName, thumbnailPath)
 * 46 items.
 */

if (!defined('LB_CLASSIC_AVATAR_CATALOG')) {
    define('LB_CLASSIC_AVATAR_CATALOG', 1);
}

function lb_classic_avatar_catalog()
{
    return array(
    '114464574618830' => array('Dark Forest', '/avatar-thumbs/noFilter(1)'),
    '136831142931410' => array('Roblox 2017 Rooler coaster', '/avatar-thumbs/noFilter(2)'),
    '136425880600357' => array('Vicennial Visor', '/avatar-thumbs/noFilter(3)'),
    '119134044492002' => array('Glitched Void/Pillars', '/avatar-thumbs/noFilter(4)'),
    '95623125344428' => array('Original Web Elements', '/avatar-thumbs/noFilter(5)'),
    '113487852385966' => array('Noob Assist: Birthday Bash', '/avatar-thumbs/noFilter(6)'),
    '133865417694957' => array('Grown From a Garden', '/avatar-thumbs/noFilter(7)'),
    '114681574706971' => array('The Runway Sunhat', '/avatar-thumbs/noFilter(8)'),
    '114624922485910' => array('The Last Deflection', '/avatar-thumbs/noFilter(9)'),
    '136340303814796' => array('The Berry Bindle', '/avatar-thumbs/noFilter(10)'),
    '132235803398724' => array('Willow’s Legacy Hood', '/avatar-thumbs/noFilter(11)'),
    '88605870263407' => array('Hounds of the Zero', '/avatar-thumbs/noFilter(12)'),
    '137700634882745' => array('The KittyKånka', '/avatar-thumbs/noFilter(13)'),
    '108433642306851' => array('Build A Boat for a Top Hat', '/avatar-thumbs/noFilter(14)'),
    '93504053791259' => array('A Bandit’s Bandana', '/avatar-thumbs/noFilter(15)'),
    '114696292651772' => array('Time Travel Schoolpack', '/avatar-thumbs/noFilter(16)'),
    '106845662936846' => array('Leather Adventure Backpack', '/avatar-thumbs/noFilter(17)'),
    '124458685703297' => array('Knife-Dodger\'s Bighead', '/avatar-thumbs/noFilter(18)'),
    '80438389804769' => array('Biting BLOXikin', '/avatar-thumbs/noFilter(19)'),
    '86551478279648' => array('Manliest Man Award', '/avatar-thumbs/noFilter(20)'),
    '135657072132378' => array('Roblox Plus Hard Hat', '/avatar-thumbs/noFilter(21)'),
    '103118097728633' => array('The Disaster Forecaster', '/avatar-thumbs/noFilter(22)'),
    '101209600748374' => array('Builder Brothers’ Balancing Act', '/avatar-thumbs/noFilter(23)'),
    '112788559708728' => array('Crest of the Canyon', '/avatar-thumbs/noFilter(24)'),
    '111382123633411' => array('Brick-Blast Jetpack', '/avatar-thumbs/noFilter(25)'),
    '97004570073626' => array('Duel of the Heights', '/avatar-thumbs/noFilter(26)'),
    '125765831436846' => array('Crossroads Tower', '/avatar-thumbs/noFilter(27)'),
    '138887482668555' => array('The Hunt: Roblox 20 Badge', '/avatar-thumbs/noFilter(28)'),
    '94937446304593' => array('BUNNYISH T-SHIRT', '/avatar-thumbs/noFilter(29)'),
    '14584030401' => array('Cool Gray Men’s Jacket Pants', '/avatar-thumbs/noFilter(30)'),
    '5279503351' => array('Gray Jacket', '/avatar-thumbs/noFilter(31)'),
    '125986442279046' => array('Cute Cat Cape', '/avatar-thumbs/noFilter(32)'),
    '13547427878' => array('Cat Tail', '/avatar-thumbs/noFilter(33)'),
    '273377471' => array('Neon Blue Animal Hoodie', '/avatar-thumbs/noFilter(34)'),
    '16092670534' => array('black and white pajamas', '/avatar-thumbs/noFilter(35)'),
    '2620477453' => array('New Years Kitty', '/avatar-thumbs/noFilter(36)'),
    '4416812356' => array('Davy Bazooka - Bazooka', '/avatar-thumbs/noFilter(40)'),
    '4416804243' => array('Davy Bazooka - Hair', '/avatar-thumbs/noFilter(41)'),
    '4416801474' => array('Davy Bazooka - Glasses', '/avatar-thumbs/noFilter(42)'),
    '114942541459994' => array('Aura of Re-Animation', '/avatar-thumbs/noFilter(43)'),
    '102495179611068' => array('VFX Staff of Wizardry', '/avatar-thumbs/noFilter(44)'),
    '108010652855471' => array('World Builder Hammer', '/avatar-thumbs/noFilter(45)'),
    '105750891967974' => array('Programmer\'s Scrolls', '/avatar-thumbs/noFilter(46)'),
    '102833621122272' => array('Musical Mindset Aura', '/avatar-thumbs/noFilter(47)'),
    '128664505443105' => array('RIA Voting Hub 2026 - Welcome Cap', '/avatar-thumbs/noFilter(48)'),
    '7657769532' => array('Angelic Winged Headphones - Lil Nas X (LNX)', '/avatar-thumbs/noFilter(49)'),
    );
}

/** Look up one catalogue entry by asset id (string-int keys differ, so cast). */
function lb_classic_avatar_item($assetId)
{
    $catalog = lb_classic_avatar_catalog();
    $key = (string) $assetId;
    if (isset($catalog[$key])) {
        return array('id' => $key, 'name' => $catalog[$key][0], 'thumbnail' => $catalog[$key][1]);
    }
    return null;
}
