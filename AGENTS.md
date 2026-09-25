# LuckyBlox Server

## Project Summary
LuckyBlox is a local Roblox-style game platform served from a release folder. Apache (mod_php) serves the PHP frontend under `/LuckBlox.site/`, while Node.js serves the EJS frontend under `/LuckBlox.site.tk/` (proxied via Apache rewrite).

## PHP Lint Command
```powershell
& "Webserver\bin\php\php-7.2.7\php.exe" -l <file>
```

## TypeScript / JavaScript
- Uses Node.js (EJS templates) for the `/LuckBlox.site.tk/` proxied frontend.
- Run lint: `cd Webserver/http-db-bridge && npm run lint`
- Run typecheck: `cd Webserver/http-db-bridge && npm run typecheck`

## Testing
- PHP syntax: see "PHP Lint Command" above.
- Node.js tests: `cd Webserver/http-db-bridge && npm test`

## Key Conventions
- PHP 7.2.7 compatible (no named arguments, no `??=`, careful with `??`).
- PHP paths use `/LuckBlox.site/` prefix (not `/LuckBlox.site.tk/`).
- Data files live in `Webserver/http-db-bridge/data/` (users.json, games.json, assets.json).
- Session cookie: `luckblox_session`, stored in `Webserver/http-db-bridge/data/sessions.json`.
- PBKDF2-SHA512 password hashing: 210000 iterations, 64-byte key length.
- Static assets under `Webserver/www/site-icon/` and `Webserver/www/gameplaceholder/`.

## Persistence (free, no disk needed)
- Data lives in `Webserver/http-db-bridge/data/`. On a host without a persistent
  disk (Render free tier) the container filesystem is wiped on redeploy.
- `server/remoteStore.js` mirrors the data files to a FREE store so they survive
  with no paid disk. Three modes, chosen by `LUCKYBLOX_SYNC`:
  - `github` — commits to the private repo (default
    `tailsthehero10/Luckyblox-Storage-1`). Needs `LUCKYBLOX_SYNC_TOKEN`: a
    fine-grained PAT scoped to that one repo with Contents: Read+Write.
    Batches every changed file into ONE commit via the Git Data API.
  - `http` — GET/PUT one JSON object at `LUCKYBLOX_SYNC_URL` (any blob store).
  - `local` — mirrors straight into a sibling clone of the storage repo
    (`<release>/../Luckyblox-Storage-1`, or `LUCKYBLOX_SYNC_DIR`) and commits
    there with git. No token, no network, no cost; use it when the server runs on
    the same machine as the clone.
- `server/storage.js` pulls on boot (`restoreFromRemote`) and pushes on every
  write (debounced, best-effort). Unset `LUCKYBLOX_SYNC` = local-only, unchanged.
- Per-user `<id>.json` files (inventory, currency, membership) sync too, not just
  the named files in `FILES`.
- Test: `node tests/remoteStore.test.js`.

## Image / artwork rules
- Game artwork is a SQUARE card (1:1), everywhere: the game page thumbnail, the
  home game cards and the home featured hero. It is never a wide banner.
- The shipped placeholder art is NOT 512x512 despite the folder name:
  `gameplaceholder/Card_512x512/*.png` is 236x236 and `gameplaceholder/Big_/*`
  is 596x335 (wide). Fit art with `object-fit: contain` inside a square frame;
  `cover` crops the square icon's edges off.
- Artwork is always a real `<img>` layered over a placeholder sibling, never a
  CSS `background-image`: the shared loading spinner can only cover an element,
  and a 404 must reveal the placeholder rather than an empty tinted box.

## Client install model
- The content client lives in a folder literally named `Luckyblox` (see `server/clientLauncher.js`).
  Resolution order: `LUCKYBLOX_CLIENT_PATH` -> `LUCKYBLOX_CLIENT_ROOT\Luckyblox` ->
  `%LOCALAPPDATA%\Luckyblox` -> `<release>/Luckyblox` -> `<release>/Clients/2021M`.
  Inside a root the binary is either present directly or under `Versions/<version>/`.
- The custom installer is served from `GET /download/client`; drop the build at
  `Luckyblox\LuckybloxInstaller.exe` (or set `LUCKYBLOX_INSTALLER_PATH`). When absent
  the route 404s and Play reports the client as unavailable instead of dead-linking.
- Play flow: `POST /api/launch-game` (and `/api/client/launch`) detect the client,
  auto-launch it, and return `client.downloadUrl` when it is not installed.
- The launch also calls `syncLocalJob()`, which publishes `Settings/jobid.txt`,
  `Settings/MapPath.txt`, `Settings/gameserverraw.json` and
  `Settings/apibaseurl.txt` so the desktop tools (Discord companion, launcher)
  know which job this machine is in even when the session was started from the
  website rather than the desktop launcher.

## Client build + update manifest
- `Webserver/http-db-bridge/clientBuildInfo.js` is the server half of a
  Roblox-style updater. Endpoints: `GET /api/client/build-info`,
  `GET /api/client/update-manifest`, `GET /v1/client/version/:channel`,
  `GET /download/client/binary`, and the Studio twin `GET /download/studio/binary`.
- The manifest reports the build actually present on disk (`available: false`
  when there is none), so an installer never downloads a build that does not
  exist. Pin a version with `LUCKYBLOX_CLIENT_VERSION`; pick the channel with
  `LUCKYBLOX_CLIENT_CHANNEL` (default `production`).
- `/api/client/status` reports the published build alongside the install state,
  so the site can distinguish installed-and-current from installed-and-stale.

## Installer
- `tools/installer/LuckybloxInstaller.cs` is a single-file Windows installer +
  updater for BOTH the Player and Studio. It installs to
  `<root>\Luckyblox\Versions\<version>\`, keeps old versions for rollback, and
  only ever repoints `version.txt` after a download is verified — it never
  overwrites a working build.
- Build with `tools/installer/build-installer.bat` (finds the in-box `csc`).
  It does NOT need `Microsoft.CSharp`: the source avoids the `dynamic` keyword.
- Switches: `/S` silent, `/Check` report state only, `/Update`, `/Force`,
  `/Uninstall`, `/root <dir>`, `/base <url>`. `%LUCKYBLOX_INSTALLER_BASE%` bakes
  a server URL in at build time; otherwise it reads `installer.config.txt`, then
  the launcher's `Settings/baseurl.txt`.
- The Apps-&-features uninstall entry points at a copy of the installer kept
  inside the install folder, so it still works after the original is deleted.

## Version ordering
- Version directory names are compared NUMERICALLY (`compareVersions` in
  `server/clientLauncher.js` and `Webserver/http-db-bridge/clientBuildInfo.js`).
  A plain string sort puts `2021.10` before `2021.9`, which would silently
  launch or serve the OLDER build. Guarded by `tests/client-version-order.test.js`.

## Loading UI (the spinner)
- The shipping artwork is `public/img/loading.gif`, served from this server (not
  hotlinked) and used as the site's single "waiting on the server" signal.
- `public/loading.js` defines `window.LBLoading`:
  `show/hide/hideAll` (full-page veil), `block/blockOff` (one element),
  `track(promise, el)`, `run(task, text)`, `button(btn, on)`, `json(url, opts)`.
  The full-page veil reference-counts concurrent calls, and waits `320ms` before
  clearing so a fast cache hit does not flash a spinner.
- Markup classes (roblox.css): `.lb-loader` with a size scale
  (`.lb-loader-xs|sm|md|lg|xl|xxl`), `.lb-loading-block`, `.lb-loading-overlay`,
  `.lb-loading-page`. Size is driven by the `--lb-loader-size` custom property, so
  one variable resizes the glyph, the block overlay and the page veil together.
- Every page includes `views/partials/scripts.ejs` (loading.js + legacy-nav.js +
  lb-select.js). Include it ABOVE any inline script that reads `window.LBLoading`.
- `legacy-nav.js` still decorates lazy/remote `<img>` with the block spinner; the
  game page additionally refreshes its live "Playing" figure from `/api/servers`.
- When editing views with PowerShell, never let `Set-Content -Encoding UTF8` add a
  BOM: a BOM before `<!DOCTYPE html>` pushes the browser into quirks mode. Strip
  it (or write without a BOM).

## Discord Rich Presence
- The companion lives in `_presence/` (`LuckyBloxPresence.cs` +
  `presence.config.json`). It reads the launcher's `Settings/` files and polls
  `/api/jobs/<jobId>` for the live player count.
- `/api/jobs/<jobId>` reports `placeName`, `playerCount`, `maxPlayers` and
  `slotsLeft`; the bridge stamps the real title onto the job via `setJobTitle`
  so the card can name the game without a local map file.
- `apiBaseUrlFile` (`apibaseurl.txt`) overrides the static `apiBaseUrl`, because
  the bridge's port is not fixed (3001/3002 locally, platform-injected in cloud).
