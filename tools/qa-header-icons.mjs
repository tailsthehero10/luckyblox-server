export default async function run(page, ui) {
  // Read every icon in the header, in both themes, and report its PAINTED colour
  // and whether a filter is being applied. This is the check for the bug class the
  // owner hit: an icon whose colour does not follow the surface it sits on.
  const read = () =>
    page.evaluate(() => {
      const header = document.querySelector('.lb-header');
      if (!header) return { error: 'no header on the page' };

      const items = [];
      for (const el of header.querySelectorAll('.ch-ico, img[src^="/icons/"]')) {
        const cs = getComputedStyle(el);
        items.push({
          src: (el.getAttribute('src') || '').split('/').pop(),
          filter: cs.filter,
          opacity: cs.opacity,
        });
      }

      const robux = header.querySelector('.lb-robux');
      const robuxColor = robux ? getComputedStyle(robux).color : null;
      const glyph = robux ? getComputedStyle(robux, '::before').backgroundColor : null;
      const mask = robux
        ? (getComputedStyle(robux, '::before').webkitMaskImage
          || getComputedStyle(robux, '::before').maskImage || '')
        : '';

      return {
        headerBg: getComputedStyle(header).backgroundColor,
        headerText: getComputedStyle(header).color,
        robuxColor,
        robuxGlyphColor: glyph,
        robuxMask: mask.includes('robux.svg'),
        headerClass: header.className,
        icons: items,
        // Any icon still using a blanket invert is the bug.
        inverted: items.filter((i) => /invert\(/.test(i.filter)).map((i) => i.src),
      };
    });

  const light = await read();

  await page.evaluate(() => {
    document.documentElement.classList.add('theme-dark');
    document.body.classList.add('theme-dark');
  });
  await page.waitForTimeout(200);
  const dark = await read();

  return { light, dark };
}