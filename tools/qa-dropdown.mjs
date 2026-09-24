export default async function run(page, ui) {
  // Open the first birthday dropdown and report what the menu looks like.
  const before = await ui.snapshot();
  const monthRef = before.match(/@(e\d+) button "Month"/)?.[1];
  if (!monthRef) return { error: 'no Month trigger', snapshot: before };

  await ui.click(monthRef);
  await page.waitForTimeout(400);

  const menu = await page.evaluate(() => {
    const m = document.querySelector('.lb-select-menu:not([hidden])');
    if (!m) {
      const any = document.querySelector('.lb-select-menu');
      return { open: false, exists: Boolean(any), hiddenAttr: any ? any.hidden : null };
    }
    const r = m.getBoundingClientRect();
    const cs = getComputedStyle(m);
    return {
      open: true,
      rect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      zIndex: cs.zIndex,
      position: cs.position,
      options: [...m.querySelectorAll('.lb-select-option')].slice(0, 4).map(o => o.textContent.trim()),
      // Is anything painting over the menu at its centre?
      topElementAtCentre: (() => {
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return el ? (el.className || el.tagName) : null;
      })(),
    };
  });

  await page.screenshot({ path: 'e:\\LuckyBloxLauncher\\NEW LKL\\Release\\luckyblox-server\\dropdown-open.png' });
  return menu;
}