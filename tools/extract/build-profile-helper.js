'use strict';

/**
 * Converts the captured 2021 profile DOM (tools/extract/body.tpl) into a PHP
 * view helper (Webserver/www/api/classic-profile-view.php).
 *
 * The body.tpl is a verbatim slice of the real archived avatar page
 * (web.archive.org / Roblox, 2021) with three placeholder tokens:
 *
 *   {U}  the old https://www.roblox.com origin
 *   {T}  a real item thumbnail (Avatar - Roblox_files/noFilterXXXX)
 *   {A}  the empty three.js <canvas> the archived page never rendered
 *
 * Everything else - the class names, the 8 tab headings, the 6 scale sliders,
 * the billing banner, the premium sidebar - is untouched, so the page matches
 * the reference markup rather than an approximation of it.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const templatePath = path.join(__dirname, 'body.tpl');
const outPath = path.join(root, 'Webserver', 'www', 'api', 'classic-profile-view.php');

let body = fs.readFileSync(templatePath, 'utf8');

// Split the DOM into the reusable pieces: the avatar container (which the live
// controller re-renders) and the surrounding chrome.
const AVATAR_OPEN = '<div id="avatar-web-app" class="row page-content">';
const avatarOpen = body.indexOf(AVATAR_OPEN);
if (avatarOpen === -1) {
  throw new Error('avatar web app container not found in body.tpl');
}
// The avatar shell is a self-contained React mount (#avatar-web-app). Walk its
// child <div> tags to find the matching close so the runtime owns everything
// below (the recently-acquired list) and the layout helper owns the wrapper.
const scanFrom = avatarOpen + AVATAR_OPEN.length;
let depth = 0;
let avatarClose = -1;
const tagRe = /<div\b[^>]*>|<\/div>/g;
tagRe.lastIndex = scanFrom;
let tag;
while ((tag = tagRe.exec(body)) !== null) {
  if (tag[0] === '</div>') {
    if (depth === 0) {
      avatarClose = tagRe.lastIndex;
      break;
    }
    depth -= 1;
  } else if (!/\/>$/.test(tag[0])) {
    depth += 1;
  }
}
if (avatarClose === -1) {
  throw new Error('could not find the end of the avatar shell');
}

const beforeAvatar = body.slice(0, avatarOpen);
const avatarBlock = body.slice(avatarOpen, avatarClose);
const afterAvatar = body.slice(avatarClose);

function toHeredoc(source, name) {
    // Pick a terminator that cannot appear in the payload.
    let term = 'LB_' + name;
    while (source.includes(term)) term += '_';
    const escaped = source.replace(/\\/g, '\\\\').replace(/\$/g, '\\$');
    return `<<<'${term}'\n${escaped}\n${term}`;
}

const php = `<?php
/**
 * Classic (2021) profile view.
 *
 * GENERATED FILE - do not edit by hand.
 * Rebuild with: node tools/extract/build-profile-helper.js
 *
 * The markup in the heredocs below is the real 2021 Roblox profile/avatar page
 * as archived on web.archive.org:
 *   https://web.archive.org/web/20210321200603/https://www.roblox.com/users/1/profile
 *
 * Only three substitutions were made against the archive capture:
 *   - the https://www.roblox.com origin became the {U} token (routed locally)
 *   - each item thumbnail path became /avatar-thumbs/<assetId>.<ext>
 *   - the empty three.js <canvas> became {A} (the 3D viewport is wired up in JS)
 *
 * The runtime fills the placeholders; the chrome itself is untouched so the DOM
 * matches the reference element-for-element.
 */

if (!defined('LB_CLASSIC_PROFILE_VIEW')) {
    define('LB_CLASSIC_PROFILE_VIEW', 1);
}

/** Wrap the classic body in the real 2021 document shell (head + nav + footer). */
function lb_classic_layout($title, $bodyHtml, $extraHead = '', $extraBodyEnd = '')
{
    $css = '/css/2021';
    $head = '<!DOCTYPE html>'
        . "\n" . '<html lang="en" ng-app="robloxApp">'
        . "\n" . '<head>'
        . "\n" . '<meta charset="utf-8" />'
        . "\n" . '<meta name="viewport" content="width=device-width, initial-scale=1" />'
        . "\n" . '<title>' . htmlspecialchars($title) . '</title>'
        . "\n" . '<link rel="icon" href="/site-icon/luckyblox.ico" sizes="any" />'
        . "\n" . '<link rel="stylesheet" href="' . $css . '/Navigation.css" />'
        . "\n" . '<link rel="stylesheet" href="' . $css . '/Builder.css" />'
        . "\n" . '<link rel="stylesheet" href="' . $css . '/Avatar.css" />'
        . "\n" . '<link rel="stylesheet" href="' . $css . '/Thumbnails.css" />'
        . "\n" . '<link rel="stylesheet" href="' . $css . '/Footer.css" />'
        . "\n" . '<link rel="stylesheet" href="' . $css . '/NotificationStream.css" />'
        . "\n" . '<link rel="stylesheet" href="/css/2021/luckyblox.css" />'
        . "\n" . $extraHead
        . "\n" . '</head>'
        . "\n" . '<body class="lb-classic-body">';

    $end = '<script src="/classic/2021.js"></script>'
        . "\n" . $extraBodyEnd
        . "\n" . '</body>'
        . "\n" . '</html>';

    return $head . "\n" . $bodyHtml . "\n" . $end;
}

/** The top half of the classic body, up to (but not including) the avatar shell. */
function lb_classic_profile_head()
{
    return ${toHeredoc(beforeAvatar, 'HEAD')};
}

/** The real avatar editor shell: 8 tabs, 6 scale sliders, billing banner. */
function lb_classic_avatar_shell()
{
    return ${toHeredoc(avatarBlock, 'AVATAR')};
}

/** The bottom half of the classic body (footer + notification tray). */
function lb_classic_profile_foot()
{
    return ${toHeredoc(afterAvatar, 'FOOT')};
}
`;

fs.writeFileSync(outPath, php);
console.log('wrote', outPath, php.length, 'bytes');
console.log('beforeAvatar', beforeAvatar.length, 'avatarBlock', avatarBlock.length, 'afterAvatar', afterAvatar.length);