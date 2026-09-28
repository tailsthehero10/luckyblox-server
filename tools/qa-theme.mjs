export default async function run(page, ui) {
  // Read the header tokens in BOTH themes, so a fix for one cannot silently
  // break the other. This is the Robux glyph specifically: it is painted with
  // background-color: currentColor through a mask, so its colour IS the text
  // colour - if the text colour is wrong the icon vanishes with it.
  const read = () =>
    page.evaluate(() => {
      const robux = document.querySelector('.lb-robux, .roblox-robux');
      const header = document.querySelector('.lb-header, .roblox-topbar');
      const navLink = document.querySelector('.roblox-nav a, .lb-header nav a');
      const cs = (el, pseudo) => (el ? getComputedStyle(el, pseudo || null) : null);
      return {
        robuxText: robux ? robux.textContent.trim() : null,
        robuxColor: robux ? cs(robux).color : null,
        glyphPainted: robux ? cs(robux, '::before').backgroundColor : null,
        headerBg: header ? cs(header).backgroundColor : null,
        navColor: navLink ? cs(navLink).color : null,
        tokens: {
          text: getComputedStyle(document.documentElement).getPropertyValue('--lb-header-text').trim(),
          muted: getComputedStyle(document.documentElement).getPropertyValue('--lb-header-muted').trim(),
          header: getComputedStyle(document.documentElement).getPropertyValue('--lb-header').trim(),
        },
      };
    });

  const light = await read();

  // Flip to dark the same way the site's own toggle does.
  await page.evaluate(() => {
    document.documentElement.classList.add('theme-dark');
    document.body.classList.add('theme-dark');
  });
  await page.waitForTimeout(150);
  const dark = await read();

  return { light, dark };
}