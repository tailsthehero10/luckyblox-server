export default async function run(page, ui) {
  // Everything the owner asked about, exercised through the real Studio UI:
  //   1. sign in as the owner
  //   2. open the Studio home and click a game's own Settings link
  //      (they used to ALL point at 1818)
  //   3. change name + genre + icon, save
  //   4. confirm the PUBLIC game page shows it
  //   5. confirm the download/install routes answer
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const failed = [];
  page.on('requestfailed', (r) => failed.push(r.url() + ' :: ' + (r.failure() ? r.failure().errorText : '')));

  await page.goto(new URL('/signin', page.url()).toString());
  await page.waitForLoadState('domcontentloaded');
  await page.locator('input[name="username"], #username, input[type="text"]').first().fill('tailsthehero10');
  await page.locator('input[name="password"], #password, input[type="password"]').first().fill('@pass@.lovely10');
  await page.locator('button[type="submit"], input[type="submit"], .login-button').first().click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  // --- The Studio home: do the links point at each game, or all at 1818? ----
  await page.goto(new URL('/dev', page.url()).toString());
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);

  const home = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/dev/game/"]'))
      .map((a) => a.getAttribute('href'));
    const ids = [...new Set(links.map((h) => (h.match(/\/dev\/game\/(\d+)\//) || [])[1]).filter(Boolean))];
    return {
      onDevHome: /\/dev$/.test(location.pathname),
      linkCount: links.length,
      distinctIds: ids.length,
      sample: links.slice(0, 6),
    };
  });

  // --- Pick a game that is NOT 1818, and open ITS settings ------------------
  const target = home.sample.find((h) => h && !/\/dev\/game\/1818\//.test(h)) || home.sample[0];

  let settingsPage = null;
  if (target) {
    await page.goto(new URL(target, page.url()).toString());
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(400);
    settingsPage = await page.evaluate(() => {
      const f = document.getElementById('settingsForm');
      if (!f) return { present: false, path: location.pathname, bodyText: document.body.innerText.slice(0, 200) };
      return {
        present: true,
        path: location.pathname,
        formAction: f.getAttribute('action'),
        nameValue: (f.elements.name || {}).value,
        genreSelected: (f.elements.genre || {}).value,
        fieldCount: Array.from(f.elements).filter((e) => e.name).length,
        genreOptions: f.elements.genre ? f.elements.genre.options.length : 0,
      };
    });
  }

  // --- Save a change on THAT game ------------------------------------------
  let saved = null;
  let publicShows = null;
  const stamp = 'LinkFix ' + Date.now().toString().slice(-6);

  if (settingsPage && settingsPage.present) {
    const placeId = (settingsPage.formAction.match(/\/dev\/game\/(\d+)\//) || [])[1];
    await page.locator('#settingsForm input[name="name"]').fill(stamp);
    await page.locator('#settingsForm select[name="genre"]').selectOption('Simulation');
    await page.locator('#settingsForm button[type="submit"]').click();
    await page.waitForTimeout(1200);

    saved = await page.evaluate(() => {
      const s = document.getElementById('saveStatus');
      return { hidden: s ? s.hidden : null, text: s ? s.textContent.trim() : null };
    });

    // The public page for the game we actually edited.
    await page.goto(new URL('/game/' + placeId, page.url()).toString());
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(400);
    publicShows = await page.evaluate((st) => ({
      path: location.pathname,
      h1: (document.querySelector('h1') || {}).textContent || null,
      showsTitle: document.body.innerText.includes(st),
      showsGenre: /Simulation/.test(document.body.innerText),
    }), stamp);
  }

  // --- The install routes ---------------------------------------------------
  const install = await page.evaluate(async () => {
    const out = {};
    for (const url of ['/download/client', '/api/client/status', '/api/client/build-info']) {
      try {
        const r = await fetch(url, { method: 'GET' });
        const len = (await r.arrayBuffer()).byteLength;
        out[url] = { status: r.status, bytes: len };
      } catch (e) { out[url] = { error: String(e) }; }
    }
    return out;
  });

  return {
    devHome: home,
    target,
    settingsPage,
    saveStatus: saved,
    publicPage: publicShows,
    install,
    consoleErrors: errors.slice(0, 10),
    failedRequests: failed.slice(0, 10),
  };
}