# LuckyBlox — TODO / known issues

Working list. Update it as things are done; it is the memory across sessions.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done and verified

---

## Reference sources (USE THESE, do not invent)

These are on disk and are the AUTHORITY for markup and CSS. Copy from them.

- `Web-2013 CCS+JS\2013CSS\CSS\Pages\Games\Games.css` — the real Games page
- `Web-2013 CCS+JS\2013CSS\CSS\Pages\` — every real page stylesheet
- `Web-2013 CCS+JS\JS\js\` — the real page controllers
- `D:\DownLoads\Discover - Roblox_files\` — saved 2021 pages + their CSS
- `D:\DownLoads\*- Roblox.html` — saved page markup

Rule: every CSS value must be quotable from one of those files. If it cannot be
quoted, say so in a comment instead of inventing it.

---

## P0 — correctness / security

- [x] Owner could be taken by a visitor (4 ways). Fixed + verified.
- [x] `nextUserId()` handed out id 1 (the owner). Fixed + verified.
- [x] Reserved usernames (`tailsthehero10`, `roblox`, `admin`, …). Fixed.
      `checkUsernamePolicy` rejects them; `tests/security.test.js` asserts both
      the rejection and `isReservedUsername`. (The old test asserted the
      OPPOSITE - that `tailsthehero10` was acceptable - and was failing.)
- [x] `/dev/docs` 500 (missing `games`/`assets` locals). Fixed.
- [x] Unclosed elements in views (literal tags inside comments). Fixed, 0 remaining.
- [x] UTF-8 BOM in `client-download.ejs` (forced quirks mode). Fixed.
- [x] `git` not found by the local sync backend. Fixed.
- [x] `.env` file was never read. Fixed.
- [x] **Every `/dev/*` page returned HTTP 500.** `views/dev/*.ejs` wrote
      `include('partials/scripts')`, but EJS resolves an include RELATIVE TO THE
      INCLUDING FILE - so a view in `views/dev/` looked for
      `views/dev/partials/scripts.ejs`, which does not exist, and threw at render
      time. A nested view needs `../partials/scripts`. Fixed in all 8 files;
      guarded by `tests/view-includes.test.js`, which resolves every include in
      every view and fails if the target does not exist.
- [x] **`/settings` had an unclosed `<div>`.** Four wrappers open (`.lb-page`,
      `.lb-shell`, `.lb-main`, `.settings-window`) but only three `</div>` were
      present, so the browser silently supplied the fourth at `</body>` and the DOM
      was one level shallower than the markup intended. Fixed; `tools/trace-nesting.js`
      now proves the page leaves nothing open, and `tools/audit-nesting.js` checks
      all 19 reachable pages (all balanced).
- [x] **The sweep tool reported phantom failures.** `tools/sweep-site.js`
      defaulted to port 3099 and needed a server it never started. On this machine
      VS Code's language server listens on 3099, so the sweep read the EDITOR's
      HTML error page and reported `/`, `/games`, `/catalog`, `/avatar` and
      `/studio` as HTTP 500. It now starts its own server on a free port
      (`LUCKYBLOX_SWEEP_PORT`, default 38211) and fails loudly if that server does
      not come up, instead of measuring a stranger's port.
- [x] **XSS/persistence: no page hotlinks third-party art.** `/play`,
      `server/studioApi.js` and the PHP home page still pointed at Unsplash stock
      photos. All now use the shipped local placeholder; a test asserts the
      friends page contains no `unsplash.com`.

## P1 — the revamp (what the user keeps asking for)

- [x] **/games must NOT render the home template.** `/games` renders `games.ejs`
      with real carousel sections; `/` and `/games` are distinct pages.
- [x] **Games page CSS copied from `Games.css`.** Every value is quoted from the
      reference (192x144 tile, 202px column, 108px thumbnail box, scroller
      geometry, filter/search block). One DELIBERATE deviation is documented in
      the file: the feature frame is SQUARE (108x108), not 192x108, because the
      art this deployment ships is a square 236x236 card and square art in a 16:9
      frame letterboxes to a strip in the middle. The header comment quotes the
      real numbers first, then says which one was changed and why.
- [x] **Home page: games list horizontal.** Both `/` and `/games` render the same
      `partials/games-carousel`, so the two can never drift apart.
- [x] **Carousel titles were being clipped.** `.games-list-header` was floated and
      widthless, so the `h2`'s `overflow: hidden` (copied from the real sheet,
      where the heading had a width) clipped the text - rows read "ed For You" and
      "lated". The title and See All now share a flex row in normal flow.
- [x] **Friends layout** - rebuilt to the real 2013 row (100x130 tile, 100x100
      avatar, 850px container, all quoted from `Friends.css`). It was a
      single-column text list with a letter tile. Guarded by
      `tests/friends-row.test.js`.
- [x] **Every friend avatar is the friend's OWN character.** `getFriendsForUser`
      now passes the account's `avatar` block through; the tile drew a flat default
      figure (or a letter) because it never received the colours.
- [x] **The avatar-figure partial was still the OLD flat version.**
      `views/partials/avatar-figure.ejs` hand-built six coloured rectangles with a
      literal `:B` text face - the "colour diagram, not a character" the renderer's
      own comments say was replaced. The server-side helper had been upgraded but
      the PARTIAL had not, so every avatar rendered through it (friends, several
      profile surfaces) was still the diagram. It now calls the one shared
      `lbAvatarFigure`, which emits the real 3D renderer's SVG inside a
      font-size-sized box.
- [x] **Play button = icon only.** `/play` still had a "Play now" text label;
      it is now the glyph with `aria-label="Play"` / `title="Play"`, matching the
      game card and the featured hero.
- [x] **Settings page.** Real tabbed window (one panel at a time, deep-linked by
      `#hash`), themed structure, four balanced wrappers, and it now includes
      `partials/scripts` like every other page (it was including `lb-select.js` by
      hand and nothing else).

### The invisible bug that mattered most: `/<%= %>` inside `<script>`

- [x] **Settings tabs did nothing.** `var savedTheme = <%= JSON.stringify(...) %>`
      rendered as `var savedTheme = &#34;light&#34;;` - EJS's `<%= %>` HTML-escapes,
      and an escaped quote is a JavaScript syntax error inside a `<script>` block.
      That killed the whole IIFE, so `showPanel` was never defined and NO click
      handler was attached. The tabs still LOOKED wired because an anchor still
      changes the URL hash on its own. Fixed with `<%- %>` (raw).
- [x] **Nine more of the same, across six views.** `studio.ejs` was worst - four
      broken string literals, so the entire Studio page script failed to parse and
      the UI was inert. Also `avatar.ejs`, `client-download.ejs`, `game-about.ejs`,
      `dev/settings.ejs`. All fixed. `tests/script-escaping.test.js` walks every
      `<script>` block in all 44 views and fails on any `<%= %>` inside one
      (ignoring JS comments, so it does not flag the comment explaining the rule).

### Theme

- [x] **Robux icon follows the theme.** It was light grey on a light grey header
      in BOTH themes because four things disagreed: `roblox.css` defined
      `--lb-header-text: #ffffff` for a dark bar; `refresh-2021.css` never
      overrode it for the light theme; `roblox.css` then hardcoded
      `color: #d8d8d8 !important` on the nav; and the header was stamped with
      `light-theme`/`dark-theme` at RENDER time while the toggle writes
      `theme-dark` onto `<html>`/`<body>` at RUN time, with nothing reconciling the
      two - so changing the theme did nothing at all to the bar. Now the tokens are
      defined for both themes, the hardcoded colours use the tokens, the light/dark
      header selectors also match the class on `<html>`/`<body>`, and a small script
      in the header keeps its marker in sync with the document. Verified: the glyph
      is `rgb(96,104,109)` on the light bar and `rgb(255,255,255)` on the dark one.

### Round 3 — the Studio, HTTPS, and creating games (the owner's report)

- [x] **Every Studio "Settings" link opened game 1818.** All 10 Studio views
      hardcoded `href="/dev/game/1818/settings"` in the nav and sidebar - 19
      occurrences. Clicking Settings while editing ANY other game opened 1818, so
      the settings you asked for appeared not to load and a save then wrote to the
      wrong place. The links now resolve the id from the game in view, and
      `tests/studio-links.test.js` fails on any hardcoded id.
- [x] **The Studio listed only the places that had a saved FILE.** `/dev` built its
      list from `places.json`, which is empty until a place is saved, so one game
      was shown while the site showed fifty. It now lists every game from the store,
      merging in file metadata where it exists. Verified: 1 game -> 5 distinct.
- [x] **Creating a game did not create a GAME.** `/dev/create` and
      `POST /api/v1/places` wrote the `.rbxlx` and a `places.json` row and stopped -
      so a game made in the Studio was invisible on the site: not in the games list,
      not in search, not on the home page, and `/game/<id>` served a fallback. Both
      now call `createGameRecord()`, which writes the record every public surface
      reads. Guarded by `tests/studio-create-game.test.js`.
- [x] **Creating a game could OVERWRITE a different game.** The id came from the
      clock (`Date.now() % 100000`, which repeats every 100 seconds) or
      `1818 + random(5000)`. Replaced with `nextFreePlaceId()`, which walks to the
      first unused id. The test asserts an existing game survives a create.
- [x] **A boot-time migration DELETED real games.** When `games.json` held only
      `{1818}`, startup replaced the entire file with the map catalog. That is two
      bugs at once: it discarded whatever the owner had saved on 1818, and it baked
      the catalog's DERIVED data (per-map ids and filenames) into the store, so the
      file stopped describing what a creator actually saved. It now imports only
      MISSING ids and never touches a stored record.
- [x] **Saving a game could persist a merged view over the store.** `getGames()`
      layers the catalog and seed over the file and DERIVES titles from map
      filenames - correct to read, destructive to write. `saveGameSettings` and
      `createGameRecord` now read the raw file via `getStoredGames()`. Found by the
      new test, which caught the create route wiping an existing record.
- [x] **HTTPS: verified, not assumed.** `tests/studio-http-https.test.js` drives the
      Studio over plain http AND as the https deployment serves it (TLS terminated
      in front, `X-Forwarded-Proto: https`) and asserts: the settings page renders,
      no insecure URL appears on an https page (mixed content is what would make
      "online features just not work"), the save persists, the public page shows it,
      and the client's `AppSettings.xml` carries the MATCHING scheme - `https://` on
      the public origin, `http://localhost:PORT` locally.
- [x] **The client IS installable from the server.** Verified by fetching it:
      `/download/client` -> 200, the installer (31,744 bytes); `/download/client/binary`
      -> 200, the client build (36,185,992 bytes); `/api/client/status` and
      `/api/client/build-info` -> 200. All four answer over the public HTTPS origin
      too, so a visitor can download and install from the live site.
- [x] **`/dev/create`'s page title said "Create - LuckyBlox"**, the same string as
      `/create`, so the two were indistinguishable in the tab and in history. The
      Studio pages now title themselves consistently.

### Round 2 — found by rendering pages rather than reading them

Every one of these was invisible to the tests and to the HTML sweep. They were
caught by loading pages in a real browser and screenshotting them:

- [x] **Mojibake in the source (30+ lines).** Em dashes and ellipses had been
      re-encoded as latin-1 at some point and rendered as garbage - including page
      TITLES, so the browser tab showed the garbage instead of an em dash before
      the page name. Repaired across 13 files by `tools/fix-mojibake.js`;
      `tests/no-mojibake.test.js` guards it.

      NOTE: this entry must not QUOTE a damaged sequence. Writing one as an example
      puts it back in the source, and the guard then (correctly) fails on the very
      note describing the fix. See `tools/find-mojibake.js` for the byte patterns.
- [x] **`robux.svg` was invalid XML.** Its explanatory comment contained `--`
      sequences, and a double hyphen is ILLEGAL inside an XML comment - the
      browser rejected the whole file at that line, so the glyph degraded to a
      smudge. A mask that fails to parse still paints SOMETHING, so nothing
      reported it. Rewritten with no comment; `tests/icon-svg.test.js` now checks
      comment legality and tag balance on all 35 icons (and it immediately caught
      a false positive in itself, which is why it strips comments before counting).
- [x] **The header and sidebar avatars rendered a LETTER.**
      `String(username).slice(0,1)` - a bare "T" for tailsthehero10 - whenever the
      account had no `avatar.headshotUrl`, which is EVERY locally registered
      account. Both now draw the real blocky figure via `lbAvatarFigure`, with the
      headshot layered on top when there is one.
- [x] **The Play button was a rectangle, not a circle.** It inherited
      `padding: 0 30px; border-radius: 2px` from the generic button rule, drawing a
      wide green box over the artwork. `refresh-2021.css` and `roblox-ui.css` load
      AFTER `roblox.css` and re-set the radius, winning on source order, so the
      first `50%` was simply ignored - fixed by raising specificity and pinning the
      shape. Now 56x56, round.
- [x] **`/develop` titled itself "Create - LuckyBlox"** - a copy-paste from the
      `/create` route, so the Creator Hub was indistinguishable from Create in the
      tab, in history and in search results. Now "Creator Hub - LuckyBlox".
- [x] **`tools/audit-pages-browser.js`** - loads all 30 pages in a real browser
      and reports console errors, failed requests and empty renders. Its first
      version reported all 30 pages as broken because it parsed the browser tool's
      output wrong; that is fixed, and it is now the check that finds this class of
      defect.

### Misc

- [x] **The home page never loaded `games.css`.** It renders the game carousel but
      only linked `roblox.css` / `refresh-2021.css` / `roblox-ui.css`. Every
      carousel rule was therefore absent and the rows fell back to unstyled block
      flow: 36 tiles stacked vertically down a **3,156px-tall** column instead of
      scrolling sideways, each tile full-width (1012px) instead of 128px. Nothing
      errored - the page just looked like a list. `tools/check-games-css-links.js`
      now asserts every view that renders the carousel links the sheet.
- [x] **`robux.svg` was an unusable mask.** It was a VTracer trace of a PNG with
      NO `viewBox` (only `width="236" height="260"`) and hardcoded
      `fill="#FFFFFF"`. A CSS mask needs a viewBox to scale, so a 236x260 drawing
      was crammed into a 16x16 box and every thin stroke collapsed - the glyph read
      as a stray "T" beside the balance. Authors rewritten as a 24x24 viewBox with
      `fill="currentColor"`, which works as a mask AND as an `<img>` that follows
      the theme. `tests/icon-svg.test.js` guards all 35 icons (viewBox present,
      fills declared, and every `/icons/*.svg` a view references exists).
- [x] **Justified a rule I nearly got wrong.** I briefly forced the game page
      thumbnail to square. It is the ONE place game art is legitimately WIDE: the
      asset is `gameplaceholder/game-thumb-1680x945.png`, a real 16:9 render, and
      the markup comment says so (the square 236x236 card is the ICON beside it).
      Squaring the box letterboxed the wide render into grey bands. Reverted, with
      the reasoning recorded in the file so the next session does not repeat it.
- [x] **Page titles said "Roblox".** Seven routes still titled themselves
      "… - Roblox" (catalog, groups, asset, game, create, download). A browser tab
      is the last place the product name should be wrong. All now say LuckyBlox.
- [x] **Missing `/icons/back.svg`.** The sign-out and Studio Back controls
      referenced it and every one 404'd. Created.
- [x] **`/play` drew a hotlinked Unsplash stock photo** as the game icon and only
      received the game's NAME, so every place showed the same unrelated picture.
      It now gets the whole game entry and uses its real icon over the local
      placeholder.
- [x] **Audit EVERY page** - `tools/audit-nesting.js` (19 pages, all balanced),
      `tools/sweep-site.js` (37 pages + 116 asset refs, no 404s, no console errors),
      `tools/diagnose-pages.js` (per-page server error capture),
      `tools/trace-nesting.js` (locates an unclosed element in rendered output).
- [ ] Match the real CSS for the header/nav (2013 `SiteStyle`). The 2021 bar is
      in place and themed correctly; the 2013 header treatment is not started.
- [ ] `play.svg` and three other icons hardcode white rather than `currentColor`,
      which is why primary buttons need an invert-filter exception list.
      `tests/icon-svg.test.js` reports them; converting them is cosmetic.

## P1b — tooling that no longer lies

The tools were reporting failures that were NOT in the site. Worth listing,
because "the tests are red" was sending every session after the wrong thing:

- [x] `tools/run-tests.js` - runs all suites, prints only failures.
- [x] `tools/serve.js` / `--stop` - one place to start/stop a local server.
- [x] `tools/render-avatar.js` - renders the avatar and INSPECTS the output.
- [x] `tools/sweep-site.js` - starts its own server, correct port, fails loudly.
- [x] `tools/diagnose-pages.js` - captures the stack trace behind a 500.
- [x] `tools/find-unclosed.js`, `find-unclosed-auth.js`, `trace-nesting.js`,
      `audit-nesting.js` - locate an unclosed element in RENDERED output.
- [x] `tools/make-owner.js` - creates the owner (id 1) from an env password.
- [x] Four stale test expectations corrected (they asserted behaviour the site
      had deliberately moved away from: the seeded owner account, `tailsthehero10`
      being a registrable name, and an unauthenticated `/api/launch-game`
      returning 200).

## P2 — features not built yet

- [x] **Studio game settings now reach the live site, and cover the full Roblox
      field set.** This was the owner's question ("I can change their game icons
      and game type, and the studio could have the same settings but I don't know
      if it works"). It did NOT work, for two separate reasons:

      1. **The Studio wrote `places.json`; every public surface reads `games.json`.**
         Nothing bridged them. A creator could rename a game, change its genre and
         set an icon, get "Settings saved successfully!", and see NO change
         anywhere - no error, no warning. `saveGameSettings()` now writes BOTH
         stores, with a field map (`name`/`title`, `iconUrl`/`icon`, …) so the two
         views cannot drift apart again.
      2. **`getGameEntry()` resolved the WRONG GAME.** It looked the key up in the
         map catalog first, and `resolveRequestedPlace()` always returns something -
         it falls back to `catalog[0]` for an unknown id. So a game that existed
         only in games.json resolved to a different place's catalog entry and the
         page rendered that other game. It now trusts games.json for its own id.
      3. **`getGames()` overwrote the saved title with the map filename on every
         load** (`title: entry.title || ...`, unconditional). The map name is only a
         fallback now.

      The settings form went from 5 fields to the full Roblox set: **25 genres as a
      dropdown** (was a free-text box, which is how a game got tagged "asdf" and
      became unfindable), visibility, max players, **playable devices**, **age
      rating**, and the Security/Access toggles (HTTP requests, third-party sales,
      private servers, friends-only), plus icon and cover URLs. It reports what was
      saved instead of raising an `alert()` nobody can re-read, and unchecking a box
      now saves `false` rather than being silently omitted (an unchecked checkbox
      sends nothing, and `'false'` is a truthy string).

      Guarded by `tests/studio-settings-reach.test.js`, which saves through the
      Studio and asserts the change is on the public page, that the game is owned
      by id 1, that counters survive an edit, and that booleans stay boolean.

- [x] **The built-in games are owned by id 1, recorded rather than assumed.** They
      carried no `authorId` at all, so "id 1 owns the pre-added games" was a
      premise nothing enforced - and any later ownership check would have refused
      the owner access to their own games. `createDefaultGames()` and the catalog
      merge now both name the owner, and the Studio shows a real "You own this" row.

- [~] **Installer / launcher app** — `tools/installer/LuckybloxInstaller.cs` builds
      and installs/updates both Player and Studio; the site serves it from
      `GET /download/client`. Still to do: a UI to pick WHICH client to install.
- [ ] **Client data flow** — server sends data, client receives and requests more.
      (`/api/client/build-info`, `/api/client/update-manifest`,
      `/v1/client/version/:channel` and the Settings/jobid.txt publish through
      `syncLocalJob()` are in place and covered by tests; the in-game half is not.)
- [ ] Fetch useful files from https://archive.roblonium.com/
- [x] **Avatar 3D render** — `server/avatarRenderer.js` RUN and LOOKED AT.
      `tools/render-avatar.js` renders both rigs at three sizes and asserts the
      output: inline `<svg>`, the `lb-avatar-svg` class, a non-degenerate viewBox
      anchored near the drawn geometry, and >= 6 drawn shapes. It produces a real
      shaded isometric R6/R15 figure in the account's BrickColor palette
      (yellow head #f5cd30, green torso #a4bd47, three shaded faces per block plus
      outlines), not the flat colour diagram the old partial drew.
- [x] **Client 2021M works over HTTP and HTTPS, locally and publicly.**
      `AppSettings.xml` is rewritten per request from the CALLER's own origin:
      scheme from `X-Forwarded-Proto` first (Render terminates TLS in front of the
      app, so `req.protocol` is plain http even on the public HTTPS site), then the
      configured protocol, then the socket; host from `X-Forwarded-Host`/`Host`.
      A multi-hop header uses the FIRST (client-facing) value. The per-client path
      suffix is pinned by `CLIENT_BASE_SUFFIX` (2021M -> `/home/`, 2022M -> `/`) and
      never parsed out of the file. Verified by
      `tests/client-baseurl-rewrite.test.js`: localhost, 127.0.0.1, the public
      Render host over https, and a chained proxy header. The committed file keeps
      the `http://localhost/LuckBlox.site.tk/` placeholder so a desktop launch that
      never touches the rewrite still works.

## P3 — persistence

- [ ] Set `LUCKYBLOX_SYNC=github` + `LUCKYBLOX_SYNC_TOKEN` on Render and delete
      `LUCKYBLOX_DATA_DIR`. Code is done; it just needs the credential.

---

## How to verify (Node is at `E:\nodejs\node.exe`)

```powershell
E:\nodejs\node.exe --check <file>            # syntax
E:\nodejs\node.exe tests\<name>.test.js      # unit tests
cd Webserver\http-db-bridge; E:\nodejs\node.exe server.js   # run the site
```

Then actually LOAD the pages and look at them. Do not claim a page is fixed
without rendering it.