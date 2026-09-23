# LuckyBlox Server — Docker / Linux / Render deployment

This folder runs the LuckyBlox public server. The same code runs on a Windows
desktop (local dev) and inside a Linux container (Render.com) with no edits —
every network setting is resolved from the environment.

## Architecture

Two Node processes and a PHP runtime:

| Process | File | Role |
| --- | --- | --- |
| Process manager | `start.js` | Boots + supervises both servers, forwards shutdown signals |
| Bridge (Express) | `Webserver/http-db-bridge/server.js` | The real site: pages, APIs, launch tickets |
| Proxy | `server.js` | Public entry point; rewrites legacy `/api/*.php` paths and forwards to the bridge |
| PHP CLI | `Webserver/www/**/*.php` | Raw endpoints (join scripts, placelauncher, health) |

The `Webserver/` folder is served publicly: `Webserver/http-db-bridge/views/*`
renders the HTML pages and `Webserver/http-db-bridge/public/` provides the CSS/JS.

## Live preview mode (site not finished yet)

While the build is in progress the full site is withheld and only a single
self-contained preview page is public at **`/preview`**. Every other page
redirects there, APIs return a clean `503`, and the preview page itself has **no
navigation links**, so visitors cannot reach the unfinished site or see progress.

| Variable | Default | Purpose |
| --- | --- | --- |
| `LUCKYBLOX_PREVIEW_MODE` | `off` | `on` shows only the placeholder page; `off` serves the full site |
| `LUCKYBLOX_PREVIEW_STAGE` | `In development` | Label shown on the preview page |

What stays reachable during preview (so the server and launcher clients keep
working): `/health`, `/preview`, `/api/preview-status`, `/css/*`, `/assets/*`,
`/ClientSettings`, `/AppSettings.xml`, `/v1/*`, `/Login/*`, `/game/*`,
`/api/launch-game`, `/legacy-nav.js`.

The real site is served by default; preview mode is opt-in. If you ever want the
placeholder page back, set `LUCKYBLOX_PREVIEW_MODE=on` in the Render dashboard.

## Network configuration (all environment-driven)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3002` | **Public port.** Render injects this — never hardcode it. |
| `HOST` | `0.0.0.0` | Bind interface so the container is internet-reachable. |
| `LUCKYBLOX_BRIDGE_HOST` | `127.0.0.1` | Internal bridge host (same container). |
| `LUCKYBLOX_BRIDGE_PORT` | `3001` | Internal bridge port. |
| `LUCKYBLOX_GAME_HOST` | `0.0.0.0` | Interface for spawned game servers. |
| `LUCKYBLOX_GAME_PORT` | `53640` | Base port for game servers. |
| `PUBLIC_URL` / `RENDER_EXTERNAL_URL` | auto | Full public base URL. |
| `PUBLIC_HOST` / `RENDER_EXTERNAL_HOSTNAME` | auto | Public hostname. |
| `PUBLIC_PROTOCOL` | `https` (cloud) | Scheme for generated URLs. |
| `LUCKBLOX_SECRET` | dev fallback | HMAC secret for auth tickets. |

On Render these public values are auto-detected from `RENDER_EXTERNAL_URL` /
`RENDER_EXTERNAL_HOSTNAME`, so links always point at
`https://luckyblox-server.onrender.com` without editing any file.

## Deploying to Render

1. Push this repo to GitHub.
2. Render dashboard → **New → Blueprint** → pick the repo (uses `render.yaml`), **or**
   New → **Web Service** → Runtime **Docker** → Dockerfile path `./Dockerfile`.
3. Render sets `PORT` automatically. Leave it unset.
4. Health check path: `/health`.

## Running locally (Docker)

```powershell
docker compose up --build
# open http://localhost:3002
```

## Running locally (desktop, no Docker)

```powershell
# needs Node on PATH and PHP available for the raw PHP endpoints
$env:PORT=3002
node start.js
```

## Verifying a deployment

```powershell
curl https://<your-host>/health          # {"ok":true,...}
curl https://<your-host>/                # home page with friends + currency
curl https://<your-host>/users/1/profile
curl https://<your-host>/api/friends?userId=1
```

## Data

- Users, friends, currency (Robux / Coins / Tickets) live in
  `Webserver/http-db-bridge/data/users.json`.
- A user's `friends` array is resolved to full records (status, membership,
  profile link) by `getFriendsForUser()` in the bridge server, and the wallet is
  normalised by `getCurrencyForUser()`.
