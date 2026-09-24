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
