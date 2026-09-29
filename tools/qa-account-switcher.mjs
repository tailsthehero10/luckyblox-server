export default async function run(page, ui) {
  // Sign in, then look at the account switcher in the avatar menu: is it there,
  // does it list the right account, and does the dropdown actually open?
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(new URL('/signin', page.url()).toString());
  await page.waitForLoadState('domcontentloaded');
  await page.locator('input[name="username"], #username, input[type="text"]').first().fill('tailsthehero10');
  await page.locator('input[name="password"], #password, input[type="password"]').first().fill('@pass@.lovely10');
  await page.locator('button[type="submit"], input[type="submit"], .login-button').first().click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);

  // Did the login actually STICK? This is the bug that made sign-in meaningless.
  const afterLogin = await page.evaluate(async () => {
    const r = await fetch('/api/v1/me', { headers: { Accept: 'application/json' } });
    const j = await r.json();
    return { signedIn: j.signedIn, username: j.user ? j.user.username : null, path: location.pathname };
  });

  const inHeader = await page.evaluate(() => {
    const sw = document.querySelector('.lb-account-switcher');
    return {
      present: !!sw,
      title: sw ? (sw.querySelector('.lb-account-switcher-title') || {}).textContent?.trim() : null,
      rows: sw ? Array.from(sw.querySelectorAll('.lb-account-switcher-row')).map((r) => ({
        name: (r.querySelector('.lb-account-switcher-name strong') || {}).textContent?.trim(),
        handle: (r.querySelector('.lb-account-switcher-name span') || {}).textContent?.trim(),
        isCurrent: r.classList.contains('is-current'),
        badge: (r.querySelector('.lb-account-switcher-badge') || {}).textContent?.trim() || null,
        hasAvatarSvg: !!r.querySelector('svg'),
        hasForget: !!r.querySelector('[data-forget-user-id]'),
      })) : [],
      hasAdd: !!document.querySelector('.lb-account-switcher-add'),
    };
  });

  // Open the avatar menu and confirm the switcher is visible inside it.
  //
  // Guarded: if the sign-in did not take, there is no account menu at all, and an
  // unguarded click throws - which aborts the script and discards every result
  // gathered above it. The whole point of this probe is to report what happened.
  let openMenu = null;
  const menuBtn = await page.$('#accountMenuBtn');
  if (menuBtn) {
    await menuBtn.click();
    await page.waitForTimeout(350);

    openMenu = await page.evaluate(() => {
      const wrap = document.querySelector('.lb-account-menu');
      const panel = document.getElementById('accountMenuPanel');
      const sw = document.querySelector('.lb-account-switcher');
      const vis = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { w: Math.round(r.width), h: Math.round(r.height), display: cs.display, visible: cs.visibility };
      };
      return {
        isOpen: wrap ? wrap.classList.contains('is-open') : null,
        ariaExpanded: document.getElementById('accountMenuBtn')?.getAttribute('aria-expanded'),
        panel: vis(panel),
        switcher: vis(sw),
      };
    });
  } else {
    openMenu = { error: 'no #accountMenuBtn on the page', path: page.url() };
  }

  return { afterLogin, inHeader, openMenu, consoleErrors: errors.slice(0, 6) };
}