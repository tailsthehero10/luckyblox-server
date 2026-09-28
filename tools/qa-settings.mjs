export default async function run(page, ui) {
  // Sign in through the real form, like a person would.
  await page.goto(new URL('/signin', page.url()).toString());
  await page.waitForLoadState('domcontentloaded');

  const username = page.locator('input[name="username"], #username, input[type="text"]').first();
  const password = page.locator('input[name="password"], #password, input[type="password"]').first();
  await username.fill('tailsthehero10');
  await password.fill('@pass@.lovely10');

  await page.locator('button[type="submit"], input[type="submit"], .login-button').first().click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);

  const afterLogin = page.url();

  await page.goto(new URL('/settings', page.url()).toString());
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  const settings = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll('.settings-panel'));
    const nav = Array.from(document.querySelectorAll('.settings-nav-link'));
    const sidebar = document.querySelector('.settings-sidebar');
    const main = document.querySelector('.settings-main');
    const rect = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height) };
    };
    return {
      url: location.pathname,
      panels: panels.map((p) => `${p.id}:${p.hidden ? 'hidden' : 'shown'}`),
      nav: nav.map((a) => a.textContent.trim() + (a.classList.contains('is-active') ? '*' : '')),
      navLinkDisplay: nav[0] ? getComputedStyle(nav[0]).display : null,
      sidebar: rect(sidebar),
      main: rect(main),
      saveButton: !!document.getElementById('settingsSave'),
    };
  });

  return { signedIn: !/signin|\/login/.test(afterLogin), afterLogin, settings };
}