# Contributing

## Architecture

```
Browser
   │
   ▼
┌─────────────────────────────────────┐
│     Cloudflare Worker (index.ts)    │
│  - Starts Clawdbot in sandbox       │
│  - Proxies HTTP/WebSocket requests  │
│  - Passes secrets as env vars       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│     Cloudflare Sandbox Container    │
│  ┌───────────────────────────────┐  │
│  │     Clawdbot Gateway          │  │
│  │  - Control UI on port 18789   │  │
│  │  - WebSocket RPC protocol     │  │
│  │  - Agent runtime              │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Worker that manages sandbox lifecycle and proxies requests |
| `Dockerfile` | Container image based on `cloudflare/sandbox` with Node 22 + Clawdbot |
| `start-clawdbot.sh` | Startup script that configures clawdbot from env vars and launches gateway |
| `clawdbot.json.template` | Default Clawdbot configuration template |
| `wrangler.jsonc` | Cloudflare Worker + Container configuration |

## Local Development

```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your ANTHROPIC_API_KEY
npm run dev
```

### Local vs Production Mode

Set `CLAWDBOT_DEV_MODE=true` for local development. This enables insecure auth for the Control UI (skips HTTPS requirement).

The gateway always binds to `0.0.0.0` (LAN mode) since the Worker connects via the container network in both local and production environments.

This is already configured in `.dev.vars.example`. Just copy it to `.dev.vars` for local dev.

### WebSocket Limitations

Local development with `wrangler dev` has issues proxying WebSocket connections through the sandbox. HTTP requests work but WebSocket connections may fail. Deploy to Cloudflare for full functionality.

## Docker Image Caching

The Dockerfile includes a cache bust comment. When changing `clawdbot.json.template` or `start-clawdbot.sh`, bump the version:

```dockerfile
# Build cache bust: 2026-01-26-v10
```

## Gateway Configuration

Clawdbot configuration is built at container startup:

1. `clawdbot.json.template` is copied to `~/.clawdbot/clawdbot.json`
2. `start-clawdbot.sh` updates the config with values from environment variables
3. Gateway starts with `--allow-unconfigured` flag (skips onboarding wizard)

### Environment Variables

| Variable | Config Path | Notes |
|----------|-------------|-------|
| `ANTHROPIC_API_KEY` | (env var) | Clawdbot reads directly from env |
| `CLAWDBOT_GATEWAY_TOKEN` | `--token` flag | If not set, random token is generated |
| `CLAWDBOT_DEV_MODE` | `controlUi.allowInsecureAuth` | Set to `true` for local dev (allows HTTP auth) |
| `TELEGRAM_BOT_TOKEN` | `channels.telegram.botToken` | |
| `DISCORD_BOT_TOKEN` | `channels.discord.token` | |
| `SLACK_BOT_TOKEN` | `channels.slack.botToken` | |
| `SLACK_APP_TOKEN` | `channels.slack.appToken` | |

## Clawdbot Config Schema

Clawdbot has strict config validation. Common gotchas:

- `agents.defaults.model` must be `{ "primary": "model/name" }` not a string
- `gateway.mode` must be `"local"` for headless operation
- No `webchat` channel - the Control UI is served automatically
- `gateway.bind` is not a config option - use `--bind` CLI flag

See [Clawdbot docs](https://docs.clawd.bot/gateway/configuration) for full schema.
