---
name: moltbot-debug
description: Use when deploying moltworker, hitting debug/admin endpoints, diagnosing container startup failures, crash loops, or troubleshooting R2 sync and config corruption.
allowed-tools: Bash(curl *), Bash(source *), Bash(npx wrangler *), Bash(npm run *), Bash(docker *), Bash(git *), Read, Grep, Glob
---

# Moltbot Debug & Deploy

## Authentication

All requests to the worker (except `/sandbox-health` and `/api/status`) require Cloudflare Access service token headers.

Source the secrets file before every request — Claude Code's Bash tool runs non-interactive shells so `~/.bashrc` env vars are not available.

```bash
source ~/.config/moltbot/secrets.env && curl -s \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  "$MOLTBOT_WORKER_URL/debug/..."
```

The secrets file (`~/.config/moltbot/secrets.env`) provides:
- `CF_ACCESS_CLIENT_ID` — Service token ID
- `CF_ACCESS_CLIENT_SECRET` — Service token secret
- `MOLTBOT_WORKER_URL` — Worker base URL

## Debug Endpoints

All require `DEBUG_ROUTES=true` wrangler secret.

| Endpoint | Description |
|----------|-------------|
| `GET /debug/processes` | List container processes (add `?logs=true` for stdout/stderr) |
| `GET /debug/logs` | Gateway process logs (or `?id=<pid>` for specific process) |
| `GET /debug/container-config` | Read `clawdbot.json` from inside container |
| `GET /debug/env` | Sanitized env var presence check (booleans, no values) |
| `GET /debug/version` | Clawdbot CLI + Node.js versions |
| `GET /debug/cli?cmd=<command>` | Run a command inside the container |
| `GET /debug/gateway-api?path=<path>` | Proxy request to gateway's internal HTTP API |
| `GET /debug/ws-test` | Interactive WebSocket debug page (open in browser) |

## Admin API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/status` | Public status (no auth needed) |
| `GET /api/admin/devices` | List paired devices |
| `GET /api/admin/storage` | R2 storage status |
| `POST /api/admin/gateway/restart` | Restart the gateway process |

## Deploy Flow

```bash
npm run build         # Vite build (admin UI + worker bundle)
npm run deploy        # Build + wrangler deploy (rebuilds container image)
```

If only worker code changed (not `start-moltbot.sh` or `Dockerfile`), image layers cache and deploy is fast.

### Dockerfile Cache Busting

After changing `start-moltbot.sh`, the Docker `COPY` layer may still cache:

1. Update `ARG CACHE_BUST=` in `Dockerfile` to a new value
2. If deploy still shows CACHED: `docker system prune -a -f` then redeploy

### Container Env Vars Are One-Shot

`buildEnvVars()` runs once at `sandbox.startProcess()`. A running container does not pick up new wrangler secrets.

To apply new secrets:
- Full redeploy: `npm run deploy`
- Gateway restart: `POST /api/admin/gateway/restart`

## Troubleshooting

### Crash Loop Diagnosis

**Symptom:** Container keeps restarting, gateway never becomes healthy.

**Most common cause:** Invalid key in `clawdbot.json`. The gateway validates config strictly — unrecognized keys cause exit code 1.

**Debug steps:**
1. Check container logs: `GET /debug/processes?logs=true` — look at the most recent `failed` process
2. If config was synced to R2, corrupted config restores on every boot (see R2 Recovery)
3. Only write keys documented in the OpenClaw config schema

**Known bad keys:** `"dm": {}` in channel configs (issue #82)

### R2 Corruption Recovery

Bad config synced to R2 (cron runs every 5 min) restores on every restart, creating a crash loop.

**Fix:**
1. Delete the config from R2 backup path
2. Delete `.last-sync` from both R2 and container
3. Container will reinitialize from template on next boot

### Checking Container Logs

```bash
# Via debug endpoint
source ~/.config/moltbot/secrets.env && curl -s \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  "$MOLTBOT_WORKER_URL/debug/logs" | jq .

# Via wrangler (live tail)
npx wrangler tail moltbot-sandbox
```

### Cold Starts

Container startup takes 1-2 minutes. During this time browser requests see a loading page, API requests get 503. `SANDBOX_SLEEP_AFTER` defaults to `never` to avoid repeated cold starts.

### Quick Reference

| Symptom | Likely Cause | Fix |
|---|---|---|
| Gateway won't start | Invalid config key | Check logs, remove bad key |
| Crash loop after deploy | Corrupted config in R2 | Delete R2 config + `.last-sync` |
| New secret not working | Container has old env | Redeploy or restart gateway |
| Deploy shows CACHED | Docker layer cache | Update `CACHE_BUST`, prune if needed |
| Cold start taking forever | Normal (~2 min) | `SANDBOX_SLEEP_AFTER=never` avoids repeats |
| R2 data not persisting | Missing R2 credentials | Need all 3: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CF_ACCOUNT_ID` |
