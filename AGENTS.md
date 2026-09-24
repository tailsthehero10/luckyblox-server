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
  with no paid disk. Modes: `LUCKYBLOX_SYNC=github` (a separate private repo +
  a fine-grained token with Contents: Read+Write) or `LUCKYBLOX_SYNC=http`
  (any JSON blob endpoint).
- `server/storage.js` pulls on boot (`restoreFromRemote`) and pushes on every
  write (debounced, best-effort). Unset `LUCKYBLOX_SYNC` = local-only, unchanged.
- Test: `node tests/remoteStore.test.js`.

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
