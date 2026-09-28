export default async function run(page, ui) {
  // Sign in as the probe account, then inspect the settings window.
  const signInLink = page.getByRole('link', { name: /sign in/i }).first();
  await signInLink.click();
  await page.waitForLoadState('domcontentloaded');

  const user = 'DebugUser33307';
  const pass = process.env.LUCKYBLOX_PROBE_PASSWORD;
  if (!pass) {
    return { note: 'LUCKYBLOX_PROBE_PASSWORD not set; cannot sign in to inspect /settings' };
  }

  await page.fill('input[name="username"], #username', user);
  await page.fill('input[type="password"], #password', pass);
  await page.click('button[type="submit"], .login-button');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);

  await page.goto(new URL('/settings', page.url()).toString());
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);

  return await page.evaluate(() => ({
    url: location.pathname,
    panels: Array.from(document.querySelectorAll('.settings-panel')).map(
      (p) => p.id + ':' + (p.hidden ? 'hidden' : 'shown'),
    ),
    nav: Array.from(document.querySelectorAll('.settings-nav-link')).map(
      (a) => a.textContent.trim() + (a.classList.contains('is-active') ? '*' : ''),
    ),
    hasForm: !!document.getElementById('settingsForm'),
    fields: Array.from(document.querySelectorAll('#settingsForm input, #settingsForm select, #settingsForm textarea'))
      .map((f) => f.id || f.name),
    sidebar: getComputedStyle(document.querySelector('.settings-sidebar') || document.body).display,
  }));
}