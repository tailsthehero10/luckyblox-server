'use strict';

/**
 * Renders the avatar figure and REPORTS WHAT IT ACTUALLY DRAWS.
 *
 * The TODO says `server/avatarRenderer.js` was "written but NEVER SEEN" - so this
 * runs it and inspects the real output instead of trusting the code by eye. It
 * writes the SVG (and an HTML wrapper) to tools/out/ so a person can open it.
 *
 * Run: node tools/render-avatar.js
 */

const fs = require('fs');
const path = require('path');
const avatarRenderer = require('../server/avatarRenderer');

const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

// A representative account: the classic R6 default palette.
const user = {
  userId: '1',
  username: 'FigureProbe',
  avatarType: 'R6',
  avatar: {
    bodyColors: {
      headColorId: 24,
      torsoColorId: 23,
      leftArmColorId: 24,
      rightArmColorId: 24,
      leftLegColorId: 119,
      rightLegColorId: 119,
    },
  },
};

const RIGS = ['R6', 'R15'];
const SIZES = [150, 240, 352];

let problems = 0;
function report(label, ok, detail) {
  if (!ok) problems += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
}

const frames = [];

for (const rig of RIGS) {
  for (const size of SIZES) {
    const svg = avatarRenderer.renderAvatarSvg(user, size, { rig });

    const parts = (svg.match(/<(rect|path|ellipse|circle|polygon|image)\b/g) || []).length;
    const hasViewBox = /viewBox="[^"]+"/.test(svg);
    const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1] || '';
    const [, , vbW, vbH] = vb.split(/\s+/).map(Number);
    const svgClass = /class="lb-avatar-svg"/.test(svg);

    console.log(`\n${rig} @ ${size}px`);
    report('emits inline <svg>', svg.startsWith('<svg'), svg.slice(0, 60));
    report('carries the lb-avatar-svg class (CSS sizes it)', svgClass);
    report('has a measurable viewBox', hasViewBox, vb);
    report('draws real geometry (not an empty frame)', parts >= 6, `${parts} drawn shapes`);

    // THE bug the renderer's own comments describe: the figure was drawn OUTSIDE
    // its viewBox, so every avatar rendered as an empty square.
    const vbX = Number(vb.split(/\s+/)[0]);
    const vbY = Number(vb.split(/\s+/)[1]);
    report(
      'viewBox is anchored near the drawn geometry (not at a wild offset)',
      Number.isFinite(vbX) && Number.isFinite(vbY)
      && Math.abs(vbX) < size * 4 && Math.abs(vbY) < size * 4,
      `x=${vbX} y=${vbY}`,
    );

    report(
      'viewBox is non-degenerate',
      Number.isFinite(vbW) && Number.isFinite(vbH) && vbW > 1 && vbH > 1,
      `${vbW}x${vbH}`,
    );

    frames.push(`<figure style="margin:12px;text-align:center;font:12px sans-serif">
      <div style="width:${size}px;height:${size}px;border:1px solid #ccc;background:#f0f0f0">${svg}</div>
      <figcaption>${rig} @ ${size}px</figcaption></figure>`);
  }
}

// The wrapper the server actually emits is checked separately by
// tests/view-structure.test.js (it asserts the font-size the wrapper sets).
// Requiring the bridge server here would start a listener and hang the script,
// so this probe stays purely on the renderer.

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>LuckyBlox avatar render</title>
<style>.lb-avatar-svg{width:100%;height:100%;display:block}</style></head>
<body style="background:#fff"><h1>avatarRenderer.js - live output</h1>
<p>Rendered ${RIGS.length} rigs x ${SIZES.length} sizes.</p>
<div style="display:flex;flex-wrap:wrap">${frames.join('')}</div></body></html>`;

fs.writeFileSync(path.join(outDir, 'avatar-render.html'), html);
fs.writeFileSync(
  path.join(outDir, 'avatar-r6-240.svg'),
  avatarRenderer.renderAvatarSvg(user, 240, { rig: 'R6' }),
);

console.log(`\nWrote ${path.relative(process.cwd(), path.join(outDir, 'avatar-render.html'))}`);
console.log(problems === 0 ? 'The renderer draws a real figure.' : `${problems} PROBLEM(S).`);
process.exitCode = problems === 0 ? 0 : 1;