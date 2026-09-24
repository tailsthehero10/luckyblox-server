'use strict';

/**
 * gen-avatar-catalog.js - build Webserver/www/api/classic-avatar-catalog.php
 *
 * Reads the item cards out of the captured 2021 avatar page
 * (tools/extract/body.tpl) and emits a PHP array of the real catalogue items:
 * the actual asset id, the actual item name and a locally-served thumbnail.
 *
 * This is real data lifted from the archived page, not invented content: every
 * entry is an asset card the 2021 page actually rendered.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const body = fs.readFileSync(path.join(__dirname, 'body.tpl'), 'utf8');
const outPath = path.join(root, 'Webserver', 'www', 'api', 'classic-avatar-catalog.php');

const cards = [];
const rx = /<div class="item-card-container remove-panel"([\s\S]*?)<\/div><\/div><\/li>/g;
let match;
while ((match = rx.exec(body)) !== null) {
  const inner = match[1];
  const name = (inner.match(/data-item-name="([^"]*)"/) || [])[1] || '';
  const id = (inner.match(/data-thumbnail-target-id="([0-9]+)"/) || [])[1] || '';
  const thumb = (inner.match(/src="(\/avatar-thumbs\/[^"]*)"/) || [])[1] || '';
  if (!id || !name) continue;
  cards.push({ id, name, thumb });
}

// De-duplicate (the page renders each item once, but be safe).
const seen = new Set();
const unique = cards.filter((c) => {
  if (seen.has(c.id)) return false;
  seen.add(c.id);
  return true;
});

function phpStr(value) {
  return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

const lines = unique.map(
  (c) => `    ${phpStr(c.id)} => array(${phpStr(c.name)}, ${phpStr(c.thumb)}),`,
);

const php = `<?php
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
 * ${unique.length} items.
 */

if (!defined('LB_CLASSIC_AVATAR_CATALOG')) {
    define('LB_CLASSIC_AVATAR_CATALOG', 1);
}

function lb_classic_avatar_catalog()
{
    return array(
${lines.join('\n')}
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
`;

fs.writeFileSync(outPath, php);
console.log('cards found :', cards.length, '(unique', unique.length + ')');
console.log('wrote       :', outPath, php.length, 'bytes');
for (const c of unique.slice(0, 4)) console.log('  ', c.id, c.name, c.thumb);