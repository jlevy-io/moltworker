# Moltworker Architecture Quick Reference

## What This Is
Cloudflare Worker running OpenClaw (AI assistant) inside a Cloudflare Sandbox container.
The Worker proxies HTTP/WebSocket traffic, manages container lifecycle, handles auth, and serves an admin UI.

## Request Flow
```
Browser/Telegram/Discord → Cloudflare Worker (Hono) → Sandbox Container → clawdbot gateway (port 18789)
```

## Key Files (by area)

### Worker Core
- `src/index.ts` (417 lines) — Entry point: WebSocket proxy, cron handler, sandbox lifecycle
- `src/config.ts` (19 lines) — Constants: port 18789, timeouts, R2 paths
- `src/types.ts` (83 lines) — `MoltbotEnv` interface (all Worker bindings/secrets)
- `src/test-utils.ts` — Mock factories: `createMockEnv()`, `createMockSandbox()`, `createMockProcess()`

### Gateway (container management)
- `src/gateway/env.ts` (74 lines) — `buildEnvVars()`: maps Worker env → container env vars
- `src/gateway/process.ts` (124 lines) — Start/find/monitor gateway process
- `src/gateway/r2.ts` (74 lines) — Mount R2 bucket in container
- `src/gateway/sync.ts` (229 lines) — Backup config to R2 (cron-triggered)

### Auth
- `src/auth/middleware.ts` (125 lines) — CF Access JWT validation middleware
- `src/auth/jwt.ts` (37 lines) — JWT verify via jose + JWKS

### Routes
- `src/routes/api.ts` (284 lines) — Admin API: devices, storage, gateway restart
- `src/routes/cdp.ts` (1854 lines) — Chrome DevTools Protocol WebSocket shim
- `src/routes/public.ts` (66 lines) — Health checks, static assets (no auth)
- `src/routes/admin-ui.ts` (19 lines) — SPA serving for `/_admin/*`
- `src/routes/debug.ts` (394 lines) — Debug endpoints (requires DEBUG_ROUTES=true)

### Client (React admin UI)
- `src/client/` — React SPA built to `dist/client/`, served at `/_admin/`

### Container
- `Dockerfile` — Image definition (Node 22, clawdbot, himalaya, gog)
- `start-moltbot.sh` (430 lines) — Container startup: restore from R2, apply env vars to config, start gateway
- `moltbot.json.template` — Minimal default clawdbot config
- `skills/` — Custom skills copied into container at `/root/clawd/skills/`

### Config
- `wrangler.jsonc` — Worker config: sandbox, R2 bucket, cron, browser binding

## Env Var Chain (critical)
```
wrangler secret put → MoltbotEnv (types.ts) → buildEnvVars() (env.ts) → sandbox.startProcess({env}) → start-moltbot.sh → clawdbot.json → gateway
```
Env vars are passed to the container **only at process startup**. Changing a secret requires redeploy or gateway restart.

## Name Mappings (env.ts)
| Wrangler Secret | Container Env Var |
|---|---|
| `MOLTBOT_GATEWAY_TOKEN` | `CLAWDBOT_GATEWAY_TOKEN` |
| `DEV_MODE` | `CLAWDBOT_DEV_MODE` |
| `GOG_KEYRING_PASSWORD` | Also sets `GOG_KEYRING_BACKEND=file` |
| `AI_GATEWAY_API_KEY` | → `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (based on base URL) |

## Current Env Vars (MoltbotEnv in types.ts)
**Bindings:** `Sandbox`, `ASSETS`, `MOLTBOT_BUCKET`, `BROWSER`
**AI:** `AI_GATEWAY_API_KEY`, `AI_GATEWAY_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `OPENAI_API_KEY`
**Auth:** `MOLTBOT_GATEWAY_TOKEN`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`
**Channels:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DM_POLICY`, `TELEGRAM_ALLOW_FROM`, `DISCORD_BOT_TOKEN`, `DISCORD_DM_POLICY`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`
**R2:** `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CF_ACCOUNT_ID`
**Browser:** `CDP_SECRET`, `WORKER_URL`
**Email:** `HIMALAYA_IMAP_PASSWORD`, `HIMALAYA_EMAIL`, `GOG_ACCOUNT`, `GOG_KEYRING_PASSWORD`, `GOG_CLIENT_SECRET_JSON`
**Git:** `GITHUB_PAT`, `GITHUB_REPO`
**Dev:** `DEV_MODE`, `DEBUG_ROUTES`, `SANDBOX_SLEEP_AFTER`, `CLAWDBOT_BIND_MODE`

## Container Paths
| Path | Purpose |
|---|---|
| `/root/.clawdbot/clawdbot.json` | Main gateway config |
| `/root/.clawdbot/.boot-timestamp` | Written at boot for sync safety |
| `/root/.clawdbot/.restore-complete` | Marker that init is done |
| `/root/.clawdbot/.last-sync` | Local sync timestamp |
| `/root/clawd/` | Working directory |
| `/root/clawd/skills/` | Runtime skills |
| `/data/moltbot/` | R2 mount point |
| `/data/moltbot/clawdbot/` | R2 backup of config dir |
| `/data/moltbot/skills/` | R2 backup of skills |
| `/data/moltbot/gogcli/` | R2 backup of gog OAuth tokens |
| `/data/moltbot/.last-sync` | R2 sync timestamp |

## R2 Sync Lifecycle
1. Cron runs every 5 min → Worker calls `sync.ts`
2. `sync.ts` checks: container age > 600s, `.restore-complete` exists
3. Backs up `/root/.clawdbot/`, `/root/clawd/skills/`, `/root/.config/gogcli/` to R2
4. On boot: `start-moltbot.sh` compares R2 vs local timestamps, restores if R2 is newer

## Known Gotchas
- **Invalid config keys crash gateway** — clawdbot validates strictly; unrecognized keys → exit 1 → crash loop
- **R2 can restore corrupted config** — bad config syncs to R2, then restores every boot. Fix: delete config + reset `.last-sync`
- **Dockerfile cache busting** — update `ARG CACHE_BUST=` value after changing `start-moltbot.sh`; may need `docker system prune -a -f`
- **Container env vars are one-shot** — `buildEnvVars()` runs once at `startProcess()`. Redeploy or restart gateway for new secrets
- **Cold starts are slow** — 1-2 minutes. `SANDBOX_SLEEP_AFTER` defaults to `never`
- **PR target gotcha** — `gh pr create` defaults to upstream (cloudflare/moltworker). Always use `--repo jlevy-io/moltworker`

## Git Remotes
- `origin` → `jlevy-io/moltworker` (fork, push here)
- `upstream` → `cloudflare/moltworker` (original)

## Commands
```
npm test              # vitest
npm run typecheck     # tsc --noEmit
npm run build         # vite build
npm run deploy        # build + wrangler deploy (rebuilds container)
npm run dev           # vite dev server
npm start             # wrangler dev
```
