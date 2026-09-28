export default async function run(page, ui) {
  // Sign in, open /settings, and return measurements that show whether the window
  // actually lays out: the two columns side by side, one panel visible, the tabs
  // clickable. A screenshot alone would not tell us the nav works.
  await page.goto(new URL('/signin', page.url()).toString());
  await page.waitForLoadState('domcontentloaded');

  await page.locator('input[name="username"], #username, input[type="text"]').first().fill('tailsthehero10');
  await page.locator('input[name="password"], #password, input[type="password"]').first().fill('@pass@.lovely10');
  await page.locator('button[type="submit"], input[type="submit"], .login-button').first().click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);

  await page.goto(new URL('/settings', page.url()).toString());
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);

  const before = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    return {
      sidebar: box('.settings-sidebar'),
      main: box('.settings-main'),
      visiblePanel: (document.querySelector('.settings-panel:not([hidden])') || {}).id || null,
      activeTab: (document.querySelector('.settings-nav-link.is-active') || {}).textContent?.trim() || null,
      panelCount: document.querySelectorAll('.settings-panel').length,
    };
  });

  // Click the Privacy tab and confirm the window actually switches.
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.locator('.settings-nav-link[data-panel="privacy"]').click();
  await page.waitForTimeout(250);

  // Ask the page directly whether the handler is wired and what it sees.
  const diag = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('.settings-nav-link'));
    const panels = Array.from(document.querySelectorAll('.settings-panel'));
    const privacy = document.querySelector('.settings-nav-link[data-panel="privacy"]');
    return {
      linkCount: links.length,
      panelCount: panels.length,
      panelIds: panels.map((p) => p.id),
      privacyAttr: privacy ? privacy.getAttribute('data-panel') : null,
      // Does showPanel exist and what does it do with 'privacy'?
      showPanelType: typeof window.showPanel,
    };
  });

  const after = await page.evaluate(() => ({
    visiblePanel: (document.querySelector('.settings-panel:not([hidden])') || {}).id || null,
    activeTab: (document.querySelector('.settings-nav-link.is-active') || {}).textContent?.trim() || null,
    hash: location.hash,
    // The element's own state AND what the browser actually paints. Both matter:
    // a panel can have hidden=false and still be display:none from a CSS rule, or
    // hidden=true and still be visible if a rule overrides [hidden].
    panelsHidden: Array.from(document.querySelectorAll('.settings-panel')).map(
      (p) => `${p.id}=${p.hidden ? 'hidden' : 'shown'}/${getComputedStyle(p).display}`,
    ),
  }));

  return { before, after, diag, errors };
}