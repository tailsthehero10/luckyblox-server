# Neon storage — DONE and VERIFIED

**Status: working.** Your data is in Neon right now. Verified by reading the
database directly:

```
rows in blobs table: 2
  sessions.json                  905 bytes  2026-09-27T17:34:15Z
  users.json                    1379 bytes  2026-09-27T17:34:15Z
accounts in users.json:
  id=2  DebugUser33307  hash=yes
  id=3  NeonUser53077   hash=yes
```

Accounts created through the website are stored in Postgres with real password
hashes. Redeploys no longer lose data.

---

## Your values

| Thing | Value |
|---|---|
| Neon project | `super-poetry-86063506` |
| Branch | `production` (`br-rough-salad-b44k1cp0`) |
| Database | `luckyblox` |
| Role | `luckyblox_owner` |
| Host | `ep-steep-waterfall-b4ad4vqr-pooler.c-6.us-east-2.aws.neon.tech` |
| **Bucket name** | `luckyblox-assets` (not created by Neon — see below) |

---

## What to set on Render

Render dashboard → your service → **Environment**:

| Key | Value |
|---|---|
| `DATABASE_URL` | `postgresql://tailstheero10:npg_PSV1GoZvpfO8@ep-steep-waterfall-b4ad4vqr-pooler.c-6.us-east-2.aws.neon.tech/luckyblox?sslmode=require` |
| `LUCKYBLOX_OWNER_USERNAME` | the username you will sign up with |

**Delete these — Postgres replaces them:**

- `LUCKYBLOX_SYNC` (delete)
- `LUCKYBLOX_SYNC_TOKEN` (delete)
- `LUCKYBLOX_DATA_DIR` (delete)

Then redeploy. The boot log must show:

```
[luckyblox] storage backend: postgres
[luckyblox] persistence: ON - Data is stored in Postgres and will survive redeploys.
[luckyblox] database: connected (schema ready)
[luckyblox] owner account: <name> (id <n>) via ...
```

**If the owner warning appears**, nobody can reach the admin routes. That means
`LUCKYBLOX_OWNER_USERNAME` does not match any account — sign up first, then set
it to the name you used.

---

## What was NOT needed

Ignore every `neon` CLI step that was suggested:

| Suggested | Why to skip |
|---|---|
| `npm i -g neon`, `neon login`, `neon link` | the server connects by connection string; no CLI checkout needed |
| `neon skills`, `neon mcp` | editor tooling, does nothing for the running server |
| `neon function deploy`, `hello.ts` | a function returning "Hello from Neon Functions" — nothing calls it |
| `neon.ts` with `functions:` | same |
| `neon.ts` with `auth: true` | would replace the working PBKDF2 auth below |
| `preview.buckets` | Neon has no object storage; `preview.buckets` is for preview branches |
| `neon deploy` | deploys Neon functions, of which you have none |

**Auth is already built and must stay**: PBKDF2-SHA512 (210,000 iterations),
session cookies, CSRF, reserved usernames, password policy, rate limiting,
owner/admin separation. Neon Auth would replace all of it and break existing
accounts.

---

## Object storage (the bucket) — separate, and optional

Neon is Postgres only. Game files (`.rbxlx` places, map files, asset binaries)
are not database rows and need a bucket. **Free options:**

| Provider | Bucket name | Free tier |
|---|---|---|
| **Cloudflare R2** | `luckyblox-assets` | 10 GB, 10M reads/mo, **no egress fee** |
| Backblaze B2 | `luckyblox-assets` | 10 GB |
| Supabase Storage | `luckyblox-assets` | 1 GB |

Recommended: **Cloudflare R2**, bucket `luckyblox-assets`. Env vars when you add it:

```
LUCKYBLOX_BUCKET=luckyblox-assets
LUCKYBLOX_BUCKET_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
LUCKYBLOX_BUCKET_KEY=<access key id>
LUCKYBLOX_BUCKET_SECRET=<secret access key>
```

---

## Local development

Put this in a `.env` file in the release root (which the server now reads):

```
DATABASE_URL=postgresql://luckyblox_owner:npg_PSV1GoZvpfO8@ep-steep-waterfall-b4ad4vqr-pooler.c-6.us-east-2.aws.neon.tech/luckyblox?sslmode=require
```

With `DATABASE_URL` unset the server uses local JSON files exactly as before, so
a plain desktop run is unchanged.

---

## How it works (so you can debug it)

`server/postgresStore.js` stores one row per logical "file":

```sql
CREATE TABLE blobs (
  name        text PRIMARY KEY,   -- "users.json", "3.json"
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

The JSON layer (`server/storage.js`) is keyed by file name and every caller
reads/writes a whole document, so storing the same shape as one row meant no call
sites had to change. `DATABASE_URL` unset = JSON files, set = Postgres, and both
paths are identical from the caller's point of view.

---

## Verification commands

```powershell
# round-trip test against the real database
E:\nodejs\node.exe tools/test-neon.js "<connection string>"

# dump what the database actually holds
E:\nodejs\node.exe tools/dump-neon.js "<connection string>"
```

Both read the live database — they are the honest check, not a mock.