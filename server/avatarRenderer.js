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

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * A box in isometric projection.
 *
 * (x, y, z) is the front-bottom-left corner in "world" units; w/h/d are the
 * extents. The projection maps world X to screen right-down, world Z to screen
 * right-up, and world Y to screen down - the standard 2:1 isometric look the
 * Roblox thumbnail uses for a three-quarter standing pose.
 */
function iso(x, y, z) {
  return { sx: (x - z) * 0.866, sy: (x + z) * 0.5 + y };
}

function box(x, y, z, w, h, d, baseColor) {
  const front = shade(baseColor, 1.0);
  const side = shade(baseColor, 0.78);
  const top = shade(baseColor, 1.18);

  // Eight corners of the box.
  const p = (dx, dy, dz) => iso(x + dx, y + dy, z + dz);

  const fbl = p(0, 0, d);        // front bottom left
  const fbr = p(w, 0, d);        // front bottom right
  const ftl = p(0, -h, d);       // front top left
  const ftr = p(w, -h, d);       // front top right

  const bbl = p(0, 0, 0);
  const bbr = p(w, 0, 0);
  const btl = p(0, -h, 0);
  const btr = p(w, -h, 0);

  const pts = (arr) => arr.map((q) => `${q.sx.toFixed(2)},${q.sy.toFixed(2)}`).join(' ');

  // Front face, then the right side, then the top. Painted in that order so the
  // nearer faces overlap correctly.
  return `<polygon points="${pts([fbl, fbr, ftr, ftl])}" fill="${hex(front)}" stroke="${hex(shade(baseColor, 0.6))}" stroke-width="0.6" stroke-linejoin="round"/>`
    + `<polygon points="${pts([fbr, bbr, btr, ftr])}" fill="${hex(side)}" stroke="${hex(shade(baseColor, 0.6))}" stroke-width="0.6" stroke-linejoin="round"/>`
    + `<polygon points="${pts([ftl, ftr, btr, btl])}" fill="${hex(top)}" stroke="${hex(shade(baseColor, 0.6))}" stroke-width="0.6" stroke-linejoin="round"/>`;
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
  const ox = 0;
  const oy = 0;
  const oz = 0;

  const head = rgbOf(colors.headColorId);
  const torso = rgbOf(colors.torsoColorId);
  const larm = rgbOf(colors.leftArmColorId);
  const rarm = rgbOf(colors.rightArmColorId);
  const lleg = rgbOf(colors.leftLegColorId);
  const rleg = rgbOf(colors.rightLegColorId);

  const legH = 2 * u;
  const torsoH = 2 * u;
  const armH = 2 * u;
  const headH = 1 * u;
  const headW = 2 * u;
  const bodyW = 2 * u;
  const depth = 1 * u;

  const legTop = oy + legH;
  const torsoTop = legTop + torsoH;
  const headTop = torsoTop + headH;

  let svg = '';

  // Legs (drawn first: they are behind the torso in this pose).
  svg += box(ox - bodyW / 2, legTop, oz, u, legH, depth, lleg);
  svg += box(ox + bodyW / 2 - u, legTop, oz, u, legH, depth, rleg);

  // Arms.
  svg += box(ox - bodyW / 2 - u, torsoTop, oz, u, armH, depth, larm);
  svg += box(ox + bodyW / 2, torsoTop, oz, u, armH, depth, rarm);

  // Torso.
  svg += box(ox - bodyW / 2, torsoTop, oz, bodyW, torsoH, depth, torso);

  // Head - centred on the torso, slightly wider than the body.
  svg += box(ox - headW / 2, headTop, oz, headW, headH, depth, head);

  // Face, drawn on the front plane of the head.
  if (opts && opts.face !== false) {
    const f = iso(ox - headW / 2, headTop, oz + depth);
    const fw = headW * 0.866;
    const fh = headH * 0.5;
    svg += faceSvg(f.sx + fw * 0.5, f.sy + fh * 0.5, u * 0.5);
  }

  return svg;
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

  const legH = 2.2 * u;
  const torsoH = 2.1 * u;
  const armH = 2.2 * u;
  const headH = 1.05 * u;
  const headW = 1.6 * u;
  const bodyW = 2 * u;
  const depth = 0.9 * u;
  const limbW = 0.85 * u;

  const legTop = legH;
  const torsoTop = legTop + torsoH;
  const headTop = torsoTop + headH;

  let svg = '';
  svg += box(-bodyW / 2 + 0.1 * u, legTop, 0, limbW, legH, depth, lleg);
  svg += box(bodyW / 2 - limbW - 0.1 * u, legTop, 0, limbW, legH, depth, rleg);

  svg += box(-bodyW / 2 - limbW, torsoTop - armH * 0.02, 0, limbW, armH, depth, larm);
  svg += box(bodyW / 2, torsoTop - armH * 0.02, 0, limbW, armH, depth, rarm);

  svg += box(-bodyW / 2, torsoTop, 0, bodyW, torsoH, depth, torso);

  svg += box(-headW / 2, headTop, 0.05 * u, headW, headH, depth * 0.95, head);

  if (opts && opts.face !== false) {
    const f = iso(-headW / 2, headTop, depth * 0.95 + 0.05 * u);
    const fw = headW * 0.866;
    const fh = headH * 0.5;
    svg += faceSvg(f.sx + fw * 0.5, f.sy + fh * 0.5, u * 0.45);
  }

  return svg;
}

/** The classic Roblox smile face, drawn at (cx, cy) with radius r. */
function faceSvg(cx, cy, r) {
  const eye = r * 0.22;
  const eyeY = cy - r * 0.25;
  const smile = r * 0.45;
  return `<g>`
    + `<ellipse cx="${(cx - r * 0.4).toFixed(2)}" cy="${eyeY.toFixed(2)}" rx="${eye.toFixed(2)}" ry="${(eye * 1.15).toFixed(2)}" fill="#1b2a34"/>`
    + `<ellipse cx="${(cx + r * 0.4).toFixed(2)}" cy="${eyeY.toFixed(2)}" rx="${eye.toFixed(2)}" ry="${(eye * 1.15).toFixed(2)}" fill="#1b2a34"/>`
    + `<path d="M ${(cx - smile).toFixed(2)} ${(cy + r * 0.15).toFixed(2)} Q ${cx.toFixed(2)} ${(cy + r * 0.85).toFixed(2)} ${(cx + smile).toFixed(2)} ${(cy + r * 0.15).toFixed(2)}" `
    + `fill="none" stroke="#1b2a34" stroke-width="${(r * 0.14).toFixed(2)}" stroke-linecap="round"/>`
    + `</g>`;
}

/**
 * Equipped-item overlays.
 *
 * Each equipped asset is drawn on top of the figure by category, so a hat appears
 * on the head and a shirt tints the torso - the same composition the real
 * thumbnail does. Unknown categories are skipped rather than drawn wrongly.
 */
function overlayFor(item, u, headTopY, torsoTopY) {
  const name = String(item && (item.name || item.assetType) || '').toLowerCase();
  const type = String((item && item.assetType) || '').toLowerCase();

  const isHat = /hat|hair|cap|helmet|fedora|beanie|hood/.test(name) || type === 'hat';
  const isShirt = /shirt|jacket|hoodie|sweater|coat/.test(name) || type === 'shirt';
  const isPants = /pants|jeans|shorts|trousers/.test(name) || type === 'pants';

  if (isHat) {
    // A simple brimmed hat sitting on the crown of the head.
    const w = u * 1.7;
    const h = u * 0.55;
    const brimW = u * 2.1;
    const cx = 0;
    const y = headTopY - u * 0.15;
    return `<g>`
      + `<ellipse cx="${cx}" cy="${y.toFixed(2)}" rx="${(brimW / 2).toFixed(2)}" ry="${(u * 0.28).toFixed(2)}" fill="#2b2f36" opacity="0.92"/>`
      + `<rect x="${(cx - w / 2).toFixed(2)}" y="${(y - h).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${(u * 0.1).toFixed(2)}" fill="#3a3f47"/>`
      + `</g>`;
  }

  if (isShirt) {
    // Tint the torso block rather than replacing it, so the body colour still
    // shows through the way a real shirt texture does.
    const w = u * 1.9;
    const h = u * 1.8;
    return `<rect x="${(-w / 2).toFixed(2)}" y="${torsoTopY.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" `
      + `rx="${(u * 0.08).toFixed(2)}" fill="#2f6fd0" opacity="0.55"/>`;
  }

  if (isPants) {
    const w = u * 1.9;
    const h = u * 1.6;
    const legTopY = torsoTopY + u * 2.05;
    return `<rect x="${(-w / 2).toFixed(2)}" y="${legTopY.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" `
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

  const headTopY = -(u * 5.05);
  const torsoTopY = headTopY + u * 1.05;

  let body = rig === 'R6' ? drawR6(colors, u, options) : drawR15(colors, u, options);

  // Overlays sit above the body but below nothing else.
  let overlays = '';
  wearing.forEach((item) => {
    overlays += overlayFor(item, u, headTopY, torsoTopY);
  });

  // The projection puts x in [-w, w]; pad the viewBox so no edge is clipped and
  // the figure is optically centred rather than mathematically centred.
  const halfW = targetPx * 0.55;
  const vbX = -halfW;
  const vbY = -(targetPx * 1.06);
  const vbW = halfW * 2;
  const vbH = targetPx * 1.18;

  return `<svg class="lb-avatar-svg" viewBox="${vbX.toFixed(1)} ${vbY.toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}" `
    + `width="${targetPx}" height="${targetPx}" role="img" `
    + `aria-label="${escapeAttr((user && user.username) || 'Avatar')}" `
    + `xmlns="http://www.w3.org/2000/svg">`
    + `<g transform="translate(0 ${(targetPx * 0.44).toFixed(2)})">`
    + body
    + overlays
    + `</g>`
    + `</svg>`;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = {
  renderAvatarSvg,
  BRICK_COLORS,
  rgbOf,
  hex,
  shade,
};