'use strict';

/**
 * LuckyBlox avatar renderer.
 *
 * Problem this solves: the avatar "render" was six flat CSS rectangles with a
 * literal `:B` text face. It was not a character - it was a colour-block diagram,
 * which is why every avatar on the site looked wrong no matter what body colours
 * an account had saved.
 *
 * What this produces instead: a real isometric 3D render, drawn as inline SVG with
 * per-face shading, the account's actual BrickColor body colours, the correct R6 or
 * R15 proportions, and the equipped items composited on top (a hat, a shirt/pants
 * tint, a face). It needs no network, no WebGL and no canvas - it is deterministic
 * markup the server can render into any page, and it matches how the Roblox
 * full-body thumbnail is posed (three-quarter view, standing).
 *
 * The shading is what makes it read as 3D rather than as a diagram: every box is
 * drawn as three faces (front, side, top) with a fixed light direction, so the
 * same colour reads as a solid object under one consistent light source.
 */

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/** Roblox BrickColor id -> [r,g,b]. Mirrors bodyColorRgb in server.js. */
const BRICK_COLORS = {
  1: [242, 243, 243],     // White
  1002: [27, 42, 52],     // Really black
  194: [163, 162, 165],   // Medium stone grey
  21: [196, 40, 28],      // Bright red
  23: [13, 105, 172],     // Bright blue
  24: [245, 205, 48],     // Bright yellow
  226: [75, 151, 75],     // Bright green
  28: [40, 127, 71],      // Dark green
  5: [215, 197, 154],     // Brick yellow
  119: [164, 189, 71],    // Br. yellowish green
  106: [218, 133, 65],    // Bright orange
  9: [140, 91, 66],       // Light reddish brown
  101: [0, 143, 156],     // Bright bluish green
  104: [107, 50, 124],    // Bright violet
  125: [234, 184, 146],   // Light orange
  135: [116, 134, 157],   // Sand blue
  138: [149, 138, 115],   // Sand yellow
  18: [204, 142, 105],    // Nougat (the classic Roblox skin tone)
  217: [124, 92, 70],     // Brown
  11: [128, 187, 219],    // Pastel Blue
  26: [4, 175, 236],      // Really blue
  37: [75, 151, 75],      // Bright green (alt)
  38: [160, 95, 53],      // Light brown
};

const DEFAULT_COLOR = [163, 162, 165];

function rgbOf(id) {
  const c = BRICK_COLORS[Number(id)] || DEFAULT_COLOR;
  return c;
}

function hex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/**
 * Shade a colour by a factor.
 *
 * The three visible faces of a box need three different brightnesses to read as a
 * solid lit object. factor > 1 lightens (the lit top), < 1 darkens (the shaded
 * side), so one base colour yields a consistent 3D form under a single light.
 */
function shade([r, g, b], factor) {
  return [r * factor, g * factor, b * factor];
}

/**
 * Pick an edge colour that stays visible against the fill it outlines.
 *
 * Perceived brightness (the ITU-R BT.601 luma weights) rather than a plain
 * average, because the eye weights green far more heavily than blue and a plain
 * mean misjudges saturated colours.
 *
 * Dark fills get a LIGHTER stroke and light fills a darker one, so the figure
 * always reads as separate lit blocks. Without this, a Really-black
 * (BrickColor 1002) account was drawn as one undifferentiated silhouette.
 */
function outlineFor([r, g, b]) {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma < 110 ? [255, 255, 255] : [0, 0, 0];
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * A box in isometric projection.
 *
 * (x, y, z) is the front-bottom-left corner in "world" units; w/h/d are the
 * extents. The projection maps world X to screen right-down, world Z to screen
 * right-up, and world Y to screen down - the standard 2:1 isometric look the
 * (x, y, z) is the front-bottom-left corner in "world" units; w/h/d are the
 * extents. The projection maps world X to screen right-down and world Z to
 * screen right-up, which gives the standard 2:1 isometric look the Roblox
 * thumbnail uses for a three-quarter standing pose.
 *
 * World Y GROWS UPWARD, so screen-Y is SUBTRACTED (`sy = ... - y`).
 *
 * That sign is the whole reason the figure used to be drawn upside down: the
 * callers stack the body upward from the feet (`legTop`, `torsoTop`, `headTop`
 * are all increasingly positive), so with `+ y` the HEAD - being the most
 * positive offset - was projected to the BOTTOM of the frame and the feet to
 * the top. Subtracting puts the head on top, which is what the layout maths
 * always intended.
 */
function iso(x, y, z) {
  return { sx: (x - z) * 0.866, sy: (x + z) * 0.5 - y };
}

/**
 * A box in isometric projection, centred on the world origin in X and Z.
 *
 * `cx` is the box's centre on the world X axis and `cz` its centre on Z, so a
 * caller never has to think about which corner it is anchoring. The previous
 * signature passed the FRONT-BOTTOM-LEFT corner while the callers passed what
 * they believed to be a centre - which is why a 2-wide torso came out shifted
 * to the left of a 1-wide leg instead of straddling it.
 */
function box(cx, y, cz, w, h, d, baseColor) {
  const front = shade(baseColor, 1.0);
  const side = shade(baseColor, 0.78);
  const top = shade(baseColor, 1.18);

  // The outline has to separate two ADJACENT parts, not just be darker than the
  // fill. `shade(baseColor, 0.6)` is fine on a mid-tone but on a near-black body
  // colour it is black-on-black, so a dark account rendered as a solid unlit
  // silhouette with no visible head, arms or legs. Choosing the stroke by how
  // dark the fill actually is keeps every rig legible: dark bodies get a lighter
  // edge, light bodies get a darker one.
  const stroke = hex(outlineFor(front));

  // Translate the centred inputs into the corner the projection works from.
  const x = cx - w / 2;
  const z = cz - d / 2;

  // Eight corners of the box. World Y grows upward, so +h is the TOP face.
  const p = (dx, dy, dz) => iso(x + dx, y + dy, z + dz);

  const fbl = p(0, 0, d);        // front bottom left
  const fbr = p(w, 0, d);        // front bottom right
  const ftl = p(0, h, d);        // front top left
  const ftr = p(w, h, d);        // front top right

  const bbl = p(0, 0, 0);
  const bbr = p(w, 0, 0);
  const btl = p(0, h, 0);
  const btr = p(w, h, 0);

  const pts = (arr) => arr.map((q) => `${q.sx.toFixed(2)},${q.sy.toFixed(2)}`).join(' ');

  // Front face, then the right side, then the top. Painted in that order so the
  // nearer faces overlap correctly.
  return `<polygon points="${pts([fbl, fbr, ftr, ftl])}" fill="${hex(front)}" stroke="${stroke}" stroke-width="0.8" stroke-linejoin="round"/>`
    + `<polygon points="${pts([fbr, bbr, btr, ftr])}" fill="${hex(side)}" stroke="${stroke}" stroke-width="0.8" stroke-linejoin="round"/>`
    + `<polygon points="${pts([ftl, ftr, btr, btl])}" fill="${hex(top)}" stroke="${stroke}" stroke-width="0.8" stroke-linejoin="round"/>`;
}

// ---------------------------------------------------------------------------
// The character
// ---------------------------------------------------------------------------

/**
 * R6 - the classic six-part blocky figure.
 *
 * Proportions are the real Roblox R6 studs: head 2x1x1, torso 2x2x1, each arm
 * 1x2x1, each leg 1x2x1. Everything is scaled by `u` (units -> pixels).
 */
function drawR6(colors, u, opts) {
  const head = rgbOf(colors.headColorId);
  const torso = rgbOf(colors.torsoColorId);
  const larm = rgbOf(colors.leftArmColorId);
  const rarm = rgbOf(colors.rightArmColorId);
  const lleg = rgbOf(colors.leftLegColorId);
  const rleg = rgbOf(colors.rightLegColorId);

  // Real R6 studs. Y now grows UPWARD from the feet (y = 0 at the ground).
  const legH = 2 * u;
  const torsoH = 2 * u;
  const armH = 2 * u;
  const headH = 1 * u;
  const headW = 2 * u;
  const bodyW = 2 * u;
  const depth = 1 * u;
  const limbW = 1 * u;

  const legBottom = 0;
  const torsoBottom = legH;
  const armBottom = torsoBottom;
  const headBottom = torsoBottom + torsoH;

  // Every box is given its CENTRE, so a 2-wide torso straddles x=0 and the two
  // 1-wide legs sit either side of it. Each part is also given its own z centre
  // so the rig reads as one solid body rather than two offset slabs.
  const zc = 0;
  const legOffset = bodyW / 2 - limbW / 2;   // 0.5u outward from the midline
  const armOffset = bodyW / 2 + limbW / 2;   // just outside the torso

  let svg = '';

  // Painting order is load-bearing. Faces are painted back-to-front, and the
  // TORSO was previously painted AFTER the arms - so it covered them completely
  // and the figure read as one solid block with no shoulders. The arms only sit
  // outside the torso by half a stud, so any overlap at all hides them.
  //
  // Order: legs (furthest back), arms, torso, head, face (front-most).
  svg += box(-legOffset, legBottom, zc, limbW, legH, depth, lleg);
  svg += box(legOffset, legBottom, zc, limbW, legH, depth, rleg);

  // Arms hang level with the torso, from the shoulder down.
  svg += box(-armOffset, armBottom, zc, limbW, armH, depth, larm);
  svg += box(armOffset, armBottom, zc, limbW, armH, depth, rarm);

  // Torso.
  svg += box(0, torsoBottom, zc, bodyW, torsoH, depth, torso);

  // Head, centred on the torso and one stud tall.
  svg += box(0, headBottom, zc, headW, headH, depth, head);

  // Face, drawn on the front plane of the head.
  if (opts && opts.face !== false) {
    const f = iso(0, headBottom + headH / 2, zc + depth / 2);
    svg += faceSvg(f.sx, f.sy, u * 0.5, head);
  }

  // The layout is returned alongside the markup so callers that composite
  // overlay items know where the head and torso actually are.
  return {
    svg,
    headTop: headBottom + headH,
    headW,
    torsoTop: torsoBottom + torsoH,
    bodyW,
  };
}

/**
 * R15 - the modern rig. Visually the same blocky silhouette but with the torso
 * split into upper/lower and slightly slimmer limbs, which is what distinguishes
 * it from R6 at thumbnail size.
 */
function drawR15(colors, u, opts) {
  const head = rgbOf(colors.headColorId);
  const torso = rgbOf(colors.torsoColorId);
  const larm = rgbOf(colors.leftArmColorId);
  const rarm = rgbOf(colors.rightArmColorId);
  const lleg = rgbOf(colors.leftLegColorId);
  const rleg = rgbOf(colors.rightLegColorId);

  // R15 is the same silhouette with a slightly taller stack and slimmer limbs,
  // which is what distinguishes it from R6 at thumbnail size. Y grows upward.
  const legH = 2.2 * u;
  const torsoH = 2.1 * u;
  const armH = 2.2 * u;
  const headH = 1.05 * u;
  const headW = 1.6 * u;
  const bodyW = 2 * u;
  const depth = 0.9 * u;
  const limbW = 0.85 * u;

  const legBottom = 0;
  const torsoBottom = legH;
  const armBottom = torsoBottom;
  const headBottom = torsoBottom + torsoH;

  const zc = 0;
  const legOffset = bodyW / 2 - limbW / 2;
  const armOffset = bodyW / 2 + limbW / 2;

  let svg = '';

  // Same back-to-front order as R6: legs, arms, torso, head, then the face.
  svg += box(-legOffset, legBottom, zc, limbW, legH, depth, lleg);
  svg += box(legOffset, legBottom, zc, limbW, legH, depth, rleg);

  svg += box(-armOffset, armBottom, zc, limbW, armH, depth, larm);
  svg += box(armOffset, armBottom, zc, limbW, armH, depth, rarm);

  svg += box(0, torsoBottom, zc, bodyW, torsoH, depth, torso);

  svg += box(0, headBottom, zc, headW, headH, depth * 0.95, head);

  if (opts && opts.face !== false) {
    const f = iso(0, headBottom + headH / 2, zc + depth * 0.95 / 2);
    svg += faceSvg(f.sx, f.sy, u * 0.45, head);
  }

  return {
    svg,
    headTop: headBottom + headH,
    headW,
    torsoTop: torsoBottom + torsoH,
    bodyW,
  };
}

/** The classic Roblox smile face, drawn at (cx, cy) with radius r. */
function faceSvg(cx, cy, r, headColor) {
  // The face is hard-coded dark, which disappears on a dark head - so the ink is
  // chosen from the head colour's own luminance, exactly like the box outline.
  const ink = hex(outlineFor(headColor || [163, 162, 165]));
  const eye = r * 0.22;
  const eyeY = cy - r * 0.25;
  const smile = r * 0.45;
  return `<g>`
    + `<ellipse cx="${(cx - r * 0.4).toFixed(2)}" cy="${eyeY.toFixed(2)}" rx="${eye.toFixed(2)}" ry="${(eye * 1.15).toFixed(2)}" fill="${ink}"/>`
    + `<ellipse cx="${(cx + r * 0.4).toFixed(2)}" cy="${eyeY.toFixed(2)}" rx="${eye.toFixed(2)}" ry="${(eye * 1.15).toFixed(2)}" fill="${ink}"/>`
    + `<path d="M ${(cx - smile).toFixed(2)} ${(cy + r * 0.15).toFixed(2)} Q ${cx.toFixed(2)} ${(cy + r * 0.85).toFixed(2)} ${(cx + smile).toFixed(2)} ${(cy + r * 0.15).toFixed(2)}" `
    + `fill="none" stroke="${ink}" stroke-width="${(r * 0.14).toFixed(2)}" stroke-linecap="round"/>`
    + `</g>`;
}

/**
 * Equipped-item overlays.
 *
 * Each equipped asset is drawn on top of the figure by category, so a hat appears
 * on the head and a shirt tints the torso - the same composition the real
 * thumbnail does. Unknown categories are skipped rather than drawn wrongly.
 *
 * @param {object} item     the resolved asset record
 * @param {number} u        unit size in px
 * @param {number} headScreenY  screen-Y of the TOP of the head
 * @param {number} torsoScreenY screen-Y of the TOP of the torso
 * @param {number} headW    the head's width in px (so a hat can be sized to it)
 * @param {number} bodyW    the torso's width in px (so a shirt can be sized to it)
 */
function overlayFor(item, u, headScreenY, torsoScreenY, headW, bodyW) {
  const name = String(item && (item.name || item.assetType) || '').toLowerCase();
  const type = String((item && item.assetType) || '').toLowerCase();

  const isHat = /hat|hair|cap|helmet|fedora|beanie|hood/.test(name) || type === 'hat';
  const isShirt = /shirt|jacket|hoodie|sweater|coat/.test(name) || type === 'shirt';
  const isPants = /pants|jeans|shorts|trousers/.test(name) || type === 'pants';

  if (isHat) {
    // A brimmed hat resting on the crown. Screen-Y grows DOWNWARD, so the crown
    // is at a SMALLER y than the top of the head - hence the subtraction.
    const w = headW * 0.9;
    const h = u * 0.55;
    const brimW = headW * 1.15;
    const y = headScreenY - u * 0.02;
    return `<g>`
      + `<ellipse cx="0" cy="${y.toFixed(2)}" rx="${(brimW / 2).toFixed(2)}" ry="${(u * 0.28).toFixed(2)}" fill="#2b2f36" opacity="0.92"/>`
      + `<rect x="${(-w / 2).toFixed(2)}" y="${(y - h).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${(u * 0.1).toFixed(2)}" fill="#3a3f47"/>`
      + `</g>`;
  }

  if (isShirt) {
    // Tint the torso block rather than replacing it, so the body colour still
    // shows through the way a real shirt texture does. The torso occupies the
    // 2u of screen height BELOW its top edge.
    const w = bodyW * 0.96;
    const h = u * 1.8;
    return `<rect x="${(-w / 2).toFixed(2)}" y="${(torsoScreenY + u * 0.1).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" `
      + `rx="${(u * 0.08).toFixed(2)}" fill="#2f6fd0" opacity="0.55"/>`;
  }

  if (isPants) {
    // Below the torso: the legs run from the torso's bottom edge to the feet.
    const w = bodyW * 0.96;
    const h = u * 2.0;
    const legsTopY = torsoScreenY + u * 2.1;
    return `<rect x="${(-w / 2).toFixed(2)}" y="${legsTopY.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" `
      + `rx="${(u * 0.08).toFixed(2)}" fill="#2a3b56" opacity="0.55"/>`;
  }

  return '';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render an avatar as an inline SVG string.
 *
 * @param {object} user   the account record (uses user.avatar / user.avatarType)
 * @param {number} size   target height in px
 * @param {object} [opts] { rig, wearing, face }
 * @returns {string} inline SVG markup
 */
function renderAvatarSvg(user, size, opts) {
  const options = opts || {};
  const avatar = (user && user.avatar) || {};
  const colors = avatar.bodyColors || {};

  const targetPx = Number(size) > 0 ? Number(size) : 352;
  const rig = String(options.rig || user && (user.avatarType || avatar.playerAvatarType) || 'R15').toUpperCase();

  // The figure is ~5.2 units tall in R6 terms; solve for the unit size that makes
  // it exactly `targetPx` tall, then reserve that box so nothing spills.
  const UNITS_TALL = 5.1;
  const u = targetPx / UNITS_TALL;

  const wearing = Array.isArray(options.wearing)
    ? options.wearing
    : (Array.isArray(user && user.currentlyWearing) ? [] : []);

  // Each rig reports its own layout, so the overlays are positioned from the
  // geometry that was ACTUALLY drawn instead of from a second guess at where the
  // head and torso ended up. That guess is what put the hat and the shirt in the
  // wrong place once the rig proportions changed.
  const laid = rig === 'R6' ? drawR6(colors, u, options) : drawR15(colors, u, options);
  const body = laid.svg;

  // Screen-Y grows DOWNWARD, so the TOP of a part is its screen-Y minus its
  // height; `laid` already supplies those top edges in screen space.
  const headScreenTop = iso(0, laid.headTop, 0).sy;
  const torsoScreenTop = iso(0, laid.torsoTop, 0).sy;

  let overlays = '';
  wearing.forEach((item) => {
    overlays += overlayFor(item, u, headScreenTop, torsoScreenTop, laid.headW, laid.bodyW);
  });

  // The viewBox is measured from the geometry that was actually emitted, NOT
  // assumed.
  //
  // The previous version hardcoded a box around y = -(targetPx * 1.06) and then
  // translated the body DOWN by targetPx * 0.44. But the isometric projection
  // maps world-Y onto screen-Y by ADDING (see iso(): sy = (x + z) * 0.5 + y),
  // and every part of the figure is placed at a POSITIVE y - legs start at 0 and
  // the stack grows upward from there. So the body always landed at roughly
  // y = 0..targetPx * 0.94, while the box it was measured against sat entirely
  // in negative y. The figure was drawn completely OUTSIDE its own frame and the
  // avatar rendered as an empty square on every page.
  //
  // Measuring the real bounds means the frame is correct for any rig, any unit
  // size, and any overlay a worn item adds - the failure mode cannot come back
  // just because the proportions change.
  const bounds = measureSvgBounds(body + overlays);

  // A little breathing room so a stroke on the outermost edge is not clipped.
  const pad = Math.max(2, u * 0.12);
  const vbX = bounds.minX - pad;
  const vbY = bounds.minY - pad;
  const vbW = Math.max(1, bounds.maxX - bounds.minX + pad * 2);
  const vbH = Math.max(1, bounds.maxY - bounds.minY + pad * 2);

  // `width`/`height` keep the requested pixel size for layout; the viewBox
  // carries the geometry, so preserveAspectRatio keeps the figure uncropped
  // even when the measured box is not square.
  return `<svg class="lb-avatar-svg" viewBox="${vbX.toFixed(1)} ${vbY.toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}" `
    + `width="${targetPx}" height="${targetPx}" preserveAspectRatio="xMidYMid meet" role="img" `
    + `aria-label="${escapeAttr((user && user.username) || 'Avatar')}" `
    + `xmlns="http://www.w3.org/2000/svg">`
    + body
    + overlays
    + `</svg>`;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The painted extent of a chunk of SVG, in the SVG's own user units.
 *
 * Every shape this renderer emits is a <polygon> (boxes) or a <rect>/<ellipse>
 * (the face and the item overlays), so those are the geometry that has to be
 * read. Reading it back rather than recomputing it from the layout maths keeps
 * this honest: whatever drawR6/drawR15/overlayFor actually produced is what the
 * viewBox will frame, including anything a future rig adds.
 *
 * @param {string} markup the body + overlays markup
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}}
 */
function measureSvgBounds(markup) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const note = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  // <polygon points="x,y x,y ...">
  const polygonRe = /<polygon[^>]*\spoints="([^"]*)"/g;
  let match;
  while ((match = polygonRe.exec(markup))) {
    for (const pair of match[1].trim().split(/\s+/)) {
      const [x, y] = pair.split(',').map(Number);
      note(x, y);
    }
  }

  // <rect x y width height>
  const rectRe = /<rect[^>]*\sx="([^"]*)"[^>]*\sy="([^"]*)"[^>]*\swidth="([^"]*)"[^>]*\sheight="([^"]*)"/g;
  while ((match = rectRe.exec(markup))) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    const w = Number(match[3]);
    const h = Number(match[4]);
    note(x, y);
    note(x + w, y + h);
  }

  // <ellipse cx cy rx ry>
  const ellipseRe = /<ellipse[^>]*\scx="([^"]*)"[^>]*\scy="([^"]*)"[^>]*\srx="([^"]*)"[^>]*\sry="([^"]*)"/g;
  while ((match = ellipseRe.exec(markup))) {
    const cx = Number(match[1]);
    const cy = Number(match[2]);
    const rx = Number(match[3]);
    const ry = Number(match[4]);
    note(cx - rx, cy - ry);
    note(cx + rx, cy + ry);
  }

  // A <path> (the smile) cannot be measured without a path parser; it is always
  // drawn inside the head box, which the polygon pass above has already covered.
  if (!Number.isFinite(minX)) {
    // Nothing measurable: fall back to a unit box so the caller still gets a
    // valid (if empty) viewBox instead of "Infinity".
    return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  }

  return { minX, minY, maxX, maxY };
}

module.exports = {
  renderAvatarSvg,
  BRICK_COLORS,
  rgbOf,
  hex,
  shade,
  outlineFor,
  measureSvgBounds,
};