# Moltworker

Cloudflare Worker that runs OpenClaw (personal AI assistant) inside a Cloudflare Sandbox container. The Worker proxies HTTP/WebSocket traffic, manages the container lifecycle, handles auth, and provides an admin UI.

## Commands

```bash
npm test              # Run tests (vitest)
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
npm run typecheck     # tsc --noEmit
npm run build         # Vite build (admin UI + worker bundle)
npm run deploy        # Build + wrangler deploy (rebuilds container image)
npm run dev           # Vite dev server
npm start             # wrangler dev
```

## Architecture

```
Browser/Telegram/Discord → Cloudflare Worker (Hono) → Sandbox Container → clawdbot gateway (port 18789)
                                  ↓                         ↓
                           CF Access auth            R2 persistent storage
                           Admin UI (React)          start-moltbot.sh
```

**Worker** (`src/index.ts`): Hono app that validates CF Access JWTs, starts the sandbox container on first request, and proxies all HTTP/WebSocket traffic to the gateway on port 18789.

**Sandbox Container** (`Dockerfile` + `start-moltbot.sh`): Runs `clawdbot gateway` with Node 22. The startup script restores config from R2 backup, overlays environment variables onto `clawdbot.json`, then starts the gateway.

**Admin UI** (`src/client/`): React SPA at `/_admin/` for device management, R2 storage status, and gateway restart.

## Project Structure

```
src/
  index.ts              # Worker entry point, WebSocket proxy, cron handler
  config.ts             # Constants: port 18789, timeouts, R2 paths
  types.ts              # MoltbotEnv interface (all Worker bindings/secrets)
  test-utils.ts         # Mock factories for sandbox, process, env
  gateway/
    process.ts          # Start/find/monitor gateway process
    env.ts              # Map Worker env → container env vars
    r2.ts               # Mount R2 bucket in container
    sync.ts             # Backup config to R2 (cron)
  auth/
    middleware.ts        # CF Access JWT validation middleware
    jwt.ts              # JWT verify via jose + JWKS
  routes/
    public.ts           # Health checks, static assets (no auth)
    api.ts              # Admin API: devices, storage, gateway restart
    admin-ui.ts          # SPA serving for /_admin/*
    cdp.ts              # Chrome DevTools Protocol WebSocket shim
    debug.ts            # Debug endpoints (requires DEBUG_ROUTES=true)
  client/               # React admin UI (built to dist/client/)
skills/                 # Custom skills copied into container
start-moltbot.sh        # Container startup script
Dockerfile              # Container image definition
moltbot.json.template   # Minimal default config template
wrangler.jsonc          # Cloudflare Worker config
```

## Environment Variables

Set via `npx wrangler secret put <NAME>`. The Worker forwards these to the container through `buildEnvVars()` in `src/gateway/env.ts`.

**Required:**
- `OPENAI_CODEX_ACCESS_TOKEN` + `OPENAI_CODEX_REFRESH_TOKEN` — OAuth tokens from ChatGPT Pro (run `node scripts/openai-codex-oauth.mjs` to obtain)
- `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` — Cloudflare Access config
- `MOLTBOT_GATEWAY_TOKEN` — mapped to `CLAWDBOT_GATEWAY_TOKEN` in container

**OpenAI Codex (optional):**
- `OPENAI_CODEX_ACCOUNT_ID` — ChatGPT account ID for billing (optional)

**Channels (optional):**
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DM_POLICY`, `TELEGRAM_ALLOW_FROM`
- `DISCORD_BOT_TOKEN`, `DISCORD_DM_POLICY`
- `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`

**R2 persistence (all 3 required together):**
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CF_ACCOUNT_ID`

**Agent defaults (optional):**
- `THINKING_DEFAULT` — thinking mode for agents: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`

**Debug/dev:**
- `DEV_MODE=true` — skips CF Access auth + device pairing
- `DEBUG_ROUTES=true` — enables `/debug/*` endpoints

### Config flow (critical to understand)

```
wrangler secret → Worker env → buildEnvVars() → sandbox.startProcess({env}) → start-moltbot.sh → clawdbot.json → gateway
```

Environment variables are passed to the container **only at process startup**. Changing a secret requires a redeploy or gateway restart for the container to pick it up.

## Testing

Vitest with co-located test files (`*.test.ts` next to source). Tests use mock factories from `src/test-utils.ts`:

```typescript
createMockEnv(overrides?)        // Minimal MoltbotEnv
createMockSandbox(options?)      // Full sandbox with vi.fn() mocks
createMockProcess(stdout, opts?) // Mock Process with getLogs spy
suppressConsole()                // Silence console in tests
```

## Code Style

- TypeScript strict mode, ES2022 target
- `import type { ... }` for type-only imports
- Hono for all HTTP routing: `app.get()`, `app.route()`, `c.json()`, `c.html()`
- Tests: `describe`/`it`/`expect` (vitest globals)
- No client-side tests (excluded in vitest config)

## Working Approach

### Plan before building
Enter plan mode for any non-trivial task (3+ steps or architectural decisions). If something goes sideways mid-implementation, stop and re-plan — don't keep pushing a broken approach.

### Use subagents to keep context clean
Offload research, exploration, and parallel analysis to subagents. One focused task per subagent. Keep the main context window for decision-making and coordination.

### Verify before marking done
Never claim a task is complete without proving it works. Run `npm test` and `npm run typecheck`. Diff behavior between main and your changes when relevant. Ask: "Would this survive code review?"

### Fix bugs autonomously
When given a bug report or failing test, investigate and fix it. Follow logs, errors, and stack traces to root causes. Don't ask for hand-holding on things you can figure out from the codebase.

## Working with External APIs

**Always use context7 first.** Before implementing against any external API or library (Cloudflare Sandbox, MCP protocols, Hono, etc.), use the context7 MCP tools (`resolve-library-id` → `query-docs`) to pull current documentation. LLM training data goes stale fast — current docs prevent wasted debugging cycles from outdated assumptions.

## Gotchas

### Docker image caching
The `COPY start-moltbot.sh` layer caches aggressively. After changing `start-moltbot.sh`, update the `ARG CACHE_BUST=` value in the Dockerfile to force a rebuild. If deploys still show CACHED, run `docker system prune -a -f` before deploying.

### Invalid config keys crash the gateway
Clawdbot validates `clawdbot.json` strictly. Unrecognized keys (like `"dm": {}`) cause the gateway to exit with code 1, which triggers a crash loop as the Worker keeps trying to restart it. Only write keys documented in the OpenClaw config schema. See issues [#82](https://github.com/cloudflare/moltworker/issues/82) and [#57](https://github.com/cloudflare/moltworker/issues/57).

### R2 backup can restore corrupted config
The startup script restores from R2 on boot if the R2 backup is newer. If a bad config gets synced to R2 (cron runs every 5 min), it gets restored on every restart. The startup script has guards for the known `dm` key corruption, but new invalid keys could cause the same loop. Fix: delete the config and reset `.last-sync` timestamp.

### Container env vars are one-shot
`buildEnvVars()` runs once when `sandbox.startProcess()` is called. A running container won't see new secrets. Either redeploy (`npm run deploy`) or restart the gateway via the admin API (`POST /api/admin/gateway/restart`).

### Cold starts are slow
Container startup takes 1-2 minutes. `SANDBOX_SLEEP_AFTER` defaults to `never` to avoid cold starts. The Worker shows a loading page for browser requests while the container boots.

### MOLTBOT_GATEWAY_TOKEN naming
The wrangler secret is `MOLTBOT_GATEWAY_TOKEN` but the container expects `CLAWDBOT_GATEWAY_TOKEN`. The mapping happens in `buildEnvVars()`. Don't set both.

### OpenAI Codex OAuth tokens
Run `node scripts/openai-codex-oauth.mjs` to complete a PKCE OAuth flow against ChatGPT Pro and obtain access/refresh tokens. Set them as wrangler secrets. On first boot, `start-moltbot.sh` seeds `auth-profiles.json` from env vars. The gateway auto-rotates tokens; the R2 cron backs up the refreshed file. Subsequent boots restore from R2 (skipping env var seed).

### auth-profiles.json format
Clawdbot's auth store (`auth-profiles.json`) uses a specific schema — do NOT guess field names. The correct format for OAuth providers:
```json
{
  "profiles": {
    "openai-codex:default": {
      "type": "oauth",
      "provider": "openai-codex",
      "access": "<access_token>",
      "refresh": "<refresh_token>",
      "expires": 0,
      "accountId": "<optional>"
    }
  }
}
```
Common mistakes: using `accessToken`/`refreshToken`/`expiresAt` (wrong — use `access`/`refresh`/`expires`), omitting the `profiles` wrapper, or omitting `type`/`provider` fields. The gateway will report "No API key found" without useful detail about which field is wrong. The file must also be copied to the agent dir (`/root/.clawdbot/agents/main/agent/auth-profiles.json`) — the agent reads from its own agentDir, not the main config dir.

### openai-codex is a built-in provider
Do NOT define `openai-codex` in `models.providers` in `clawdbot.json`. It is a built-in provider — the gateway handles routing automatically. Custom provider entries require `baseUrl`, which will cause a validation crash for built-in providers. Just set `model.primary` and `model.fallbacks` referencing it (e.g. `openai-codex/gpt-5.2`).

## Workflow

**Never commit directly to main.** All code changes follow this process:

1. Check current branch. If on `main`, create a feature branch first (`git checkout -b <branch-name>`)
2. Make changes on the feature branch
3. When done, run `npm test` and `npm run typecheck` — both must pass
4. Commit with a descriptive message
5. Push the branch and open a PR to `main` via `gh pr create` with a detailed description
6. Deploy only happens from `main` after PR merge

## Git Remotes

- `origin` — `jlevy-io/moltworker` (fork, push here)
- `upstream` — `cloudflare/moltworker` (original, pull updates with `git fetch upstream && git merge upstream/main`)

**IMPORTANT:** `gh pr create` defaults to `upstream` (cloudflare/moltworker), not the fork. Always use `--repo jlevy-io/moltworker` when creating PRs to target the fork.
