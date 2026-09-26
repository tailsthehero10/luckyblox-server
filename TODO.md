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
- [x] `/dev/docs` 500 (missing `games`/`assets` locals). Fixed.
- [x] Unclosed elements in views (literal tags inside comments). Fixed, 0 remaining.
- [x] UTF-8 BOM in `client-download.ejs` (forced quirks mode). Fixed.
- [x] `git` not found by the local sync backend. Fixed.
- [x] `.env` file was never read. Fixed.

## P1 — the revamp (what the user keeps asking for)

- [~] **/games must NOT render the home template.** Route currently renders
      `home`. Must render `games.ejs` with real sections. ← IN PROGRESS
- [ ] **Games page CSS must be copied from `Games.css`** (192x144 tile,
      192x108 image, 202px column). My invented 164x240 square cards are WRONG.
- [ ] **Home page: games list horizontal**, not a grid of messed-up cards.
- [ ] **Friends layout** — currently looks bad; make it the 2013 friends row.
- [ ] **Play button = icon only.** No "Play" text next to it. Check every page.
- [ ] **Settings page** — improve it; it is still the old layout.
- [ ] **Audit EVERY page** against the real reference. Not just home/games.
      Pages to check: settings, account, profile, avatar, catalog, badges,
      friends, groups, inventory, robux, develop, create, studio, play.
- [ ] Match the real CSS for the header/nav (2013 `SiteStyle`).

## P2 — features not built yet

- [ ] **Installer / launcher app** — pick a client to install/update, also acts
      as a launcher.
- [ ] **Client data flow** — server sends data, client receives and requests more.
- [ ] Fetch useful files from https://archive.roblonium.com/
- [ ] Avatar 3D render — `server/avatarRenderer.js` written but NEVER SEEN.
      Must run it and look at the output.

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