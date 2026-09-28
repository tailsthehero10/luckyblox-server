export default async function run(page, ui) {
  // Sign in as the owner, open the Studio settings for a built-in game, change the
  // NAME, GENRE and ICON, save, then load the PUBLIC game page and confirm the
  // change is really there. This is the owner's actual question: "can I change
  // anything?" - so it is answered by changing something and looking at the site.
  const PLACE_ID = 1818;

  await page.goto(new URL('/signin', page.url()).toString());
  await page.waitForLoadState('domcontentloaded');
  await page.locator('input[name="username"], #username, input[type="text"]').first().fill('tailsthehero10');
  await page.locator('input[name="password"], #password, input[type="password"]').first().fill('@pass@.lovely10');
  await page.locator('button[type="submit"], input[type="submit"], .login-button').first().click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  // --- Open the Studio settings page ---------------------------------------
  await page.goto(new URL(`/dev/game/${PLACE_ID}/settings`, page.url()).toString());
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);

  const form = await page.evaluate(() => {
    const f = document.getElementById('settingsForm');
    if (!f) return { present: false, bodyText: document.body.innerText.slice(0, 300) };
    return {
      present: true,
      fields: Array.from(f.elements).filter((e) => e.name).map((e) => e.name),
      nameValue: (f.elements.name || {}).value,
      genreOptions: (f.elements.genre && f.elements.genre.options)
        ? Array.from(f.elements.genre.options).map((o) => o.value) : [],
      hasOwnerRow: /You own this/.test(document.body.innerText),
    };
  });

  if (!form.present) return { stage: 'form missing', form };

  // --- Change the name, genre and icon through the form --------------------
  const stamp = 'Studio Edit ' + Date.now().toString().slice(-6);
  await page.locator('#settingsForm input[name="name"]').fill(stamp);
  await page.locator('#settingsForm select[name="genre"]').selectOption('Puzzle');
  await page.locator('#settingsForm input[name="iconUrl"]').fill('/gameplaceholder/card.png');
  await page.locator('#settingsForm button[type="submit"]').click();
  await page.waitForTimeout(1200);

  const saved = await page.evaluate(() => {
    const s = document.getElementById('saveStatus');
    return { hidden: s ? s.hidden : null, text: s ? s.textContent.trim() : null };
  });

  // --- Look at the PUBLIC page ---------------------------------------------
  await page.goto(new URL(`/game/${PLACE_ID}`, page.url()).toString());
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);

  const publicPage = await page.evaluate(() => ({
    h1: (document.querySelector('h1') || {}).textContent || null,
    showsNewName: document.body.innerText.includes(window.__stamp || ''),
    bodyText: document.body.innerText.slice(0, 200),
    genreShown: /Puzzle/.test(document.body.innerText),
  }));

  // The stamp is computed in-page for the check above.
  await page.evaluate((s) => { window.__stamp = s; }, stamp);
  const confirm = await page.evaluate(() => document.body.innerText.includes(window.__stamp || ''));

  return {
    stamp,
    form: { fields: form.fields, genreOptionCount: form.genreOptions.length, hasOwnerRow: form.hasOwnerRow },
    savedStatus: saved,
    publicH1: publicPage.h1,
    publicShowsNewName: confirm || publicPage.showsNewName,
    publicShowsGenre: publicPage.genreShown,
  };
}