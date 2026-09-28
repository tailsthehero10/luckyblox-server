export default async function run(page, ui) {
  // Exercise /settings as a signed-in user, including the things that were broken:
  // direct URLs, refresh, and the Back button.
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(new URL('/signin', page.url()).toString());
  await page.waitForLoadState('domcontentloaded');
  await page.locator('input[name="username"], #username, input[type="text"]').first().fill('tailsthehero10');
  await page.locator('input[name="password"], #password, input[type="password"]').first().fill('@pass@.lovely10');
  await page.locator('button[type="submit"], input[type="submit"], .login-button').first().click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  const visible = () =>
    page.evaluate(() => {
      const shown = Array.from(document.querySelectorAll('.settings-panel'))
        .filter((p) => !p.hidden)
        .map((p) => p.id.replace('panel-', ''));
      return {
        path: location.pathname,
        shown,
        active: (document.querySelector('.settings-nav-link.is-active') || {}).textContent?.trim() || null,
        // The nav links must be real paths, not hashes.
        links: Array.from(document.querySelectorAll('.settings-nav-link')).map((a) => a.getAttribute('href')),
        hashLinks: Array.from(document.querySelectorAll('.settings-nav-link'))
          .filter((a) => (a.getAttribute('href') || '').startsWith('#')).length,
      };
    });

  // --- 1. A DIRECT url for each section -------------------------------------
  const direct = {};
  for (const slug of ['profile', 'appearance', 'privacy', 'account']) {
    const r = await page.goto(new URL(`/settings/${slug}`, page.url()).toString());
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(250);
    direct[slug] = {
      http: r ? r.status() : null,
      ...(await visible()),
    };
  }

  // --- 2. Clicking a tab writes a REAL path ---------------------------------
  await page.goto(new URL('/settings', page.url()).toString());
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(250);
  const beforeClick = await visible();

  await page.locator('.settings-nav-link[data-panel="privacy"]').click();
  await page.waitForTimeout(300);
  const afterClick = await visible();

  // --- 3. REFRESH keeps the section -----------------------------------------
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);
  const afterRefresh = await visible();

  // --- 4. BACK walks the sections -------------------------------------------
  await page.locator('.settings-nav-link[data-panel="account"]').click();
  await page.waitForTimeout(300);
  const afterAccount = await visible();
  await page.goBack();
  await page.waitForTimeout(350);
  const afterBack = await visible();

  // --- 5. An old #hash link still works -------------------------------------
  await page.goto(new URL('/settings#appearance', page.url()).toString());
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);
  const afterLegacyHash = await visible();

  return {
    direct,
    beforeClick,
    afterClick,
    afterRefresh,
    afterAccount,
    afterBack,
    afterLegacyHash,
    consoleErrors: errors.slice(0, 8),
  };
}