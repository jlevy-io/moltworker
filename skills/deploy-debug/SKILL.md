---
name: deploy-debug
description: Use when deploying moltworker, debugging container startup failures, diagnosing crash loops, or troubleshooting R2 sync and config corruption issues.
---

# Deploy & Debug Containers

## Deploy Flow

```bash
npm run build         # Vite build (admin UI + worker bundle)
npm run deploy        # Build + wrangler deploy (rebuilds container image)
```

`npm run deploy` rebuilds the Docker image and pushes the worker. If only worker code changed (not `start-moltbot.sh` or `Dockerfile`), the image layers cache and deploy is fast.

## Dockerfile Cache Busting

After changing `start-moltbot.sh`, the Docker `COPY` layer may still cache. Fix:

1. Update `ARG CACHE_BUST=` in `Dockerfile` to a new value (e.g. today's date + description)
2. If deploy still shows CACHED: `docker system prune -a -f` then redeploy

The `CACHE_BUST` arg sits just above `COPY start-moltbot.sh` to invalidate that layer and everything after it.

## Cold Starts

Container startup takes 1-2 minutes. During this time:
- Browser requests see a loading page
- API requests get 503
- `SANDBOX_SLEEP_AFTER` defaults to `never` to avoid repeated cold starts

## Crash Loop Diagnosis

**Symptom:** Container keeps restarting, gateway never becomes healthy.

**Most common cause:** Invalid key in `clawdbot.json`. The gateway validates config strictly — unrecognized keys cause exit code 1.

**Debug steps:**
1. Check container logs for the error message (often shows which key is invalid)
2. If config was synced to R2, the corrupted config restores on every boot (see R2 Recovery below)
3. Only write keys documented in the OpenClaw config schema

**Known bad keys:** `"dm": {}` in channel configs (issue #82)

## R2 Corruption Recovery

If a bad config gets synced to R2 (cron runs every 5 min), it restores on every restart, creating a crash loop.

**Fix:**
1. Delete the config file in the container: remove from R2 backup path
2. Reset sync timestamp: delete `.last-sync` from both R2 and container
3. The container will reinitialize from the template on next boot

The startup script has guards for the known `dm` key corruption, but new invalid keys need manual intervention.

## Checking Container Logs

```bash
# Tail live worker logs
npx wrangler tail moltbot-sandbox

# View via admin UI
# Navigate to /_admin/ → gateway status shows recent logs
```

## Gateway Restart (without redeploy)

```bash
# Via admin API (requires auth)
curl -X POST https://your-worker.workers.dev/api/admin/gateway/restart
```

Or use the admin UI at `/_admin/`.

## Container Env Vars Are One-Shot

`buildEnvVars()` in `src/gateway/env.ts` runs once when `sandbox.startProcess()` is called. A running container does **not** pick up new wrangler secrets.

**To apply new secrets:**
- Full redeploy: `npm run deploy`
- Gateway restart: `POST /api/admin/gateway/restart` (re-runs `startProcess()` with fresh env)

## R2 Sync Safety Gates

The sync system (`src/gateway/sync.ts`) has safety checks:
- Container must be running for > 600 seconds (`MIN_BOOT_AGE_SECONDS`)
- `.restore-complete` marker must exist in config dir
- These prevent a fresh/empty container from overwriting good backup data

## Quick Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Gateway won't start | Invalid config key | Check logs, remove bad key from config |
| Crash loop after deploy | Corrupted config in R2 | Delete R2 config + `.last-sync` |
| New secret not working | Container has old env | Redeploy or restart gateway |
| Deploy shows CACHED | Docker layer cache | Update `CACHE_BUST`, prune if needed |
| Cold start taking forever | Normal (~2 min) | `SANDBOX_SLEEP_AFTER=never` avoids repeats |
| R2 data not persisting | Missing R2 credentials | Need all 3: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CF_ACCOUNT_ID` |
