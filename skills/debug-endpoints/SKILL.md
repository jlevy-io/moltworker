---
name: debug-endpoints
description: Use when inspecting live container state via the /debug/* HTTP endpoints — checking versions, processes, logs, config, environment, gateway API, or testing WebSocket connections. Requires DEBUG_ROUTES=true.
---

# Debug Endpoints

The `/debug/*` routes expose live container introspection. They are defined in `src/routes/debug.ts`, mounted in `src/index.ts`, and require two things:

1. **`DEBUG_ROUTES=true`** wrangler secret (returns 404 otherwise)
2. **Cloudflare Access auth** (same JWT validation as all protected routes)

All examples below assume `BASE=https://your-worker.workers.dev`.

## Endpoints

### GET /debug/version

Returns clawdbot CLI and Node.js versions running inside the container.

```bash
curl $BASE/debug/version
# {"moltbot_version":"2026.1.24-3","node_version":"v22.13.1"}
```

**Use when:** Verifying the container image has the expected clawdbot/Node versions after a deploy.

### GET /debug/processes

Lists all sandbox processes sorted by status (running first, then starting, completed, failed).

```bash
curl $BASE/debug/processes
curl "$BASE/debug/processes?logs=true"   # include stdout/stderr per process
```

**Use when:** Checking whether the gateway process is running, finding crashed processes, or grabbing startup logs. The `?logs=true` variant is especially useful for diagnosing crash loops — look at the most recent `failed` process for the error message.

### GET /debug/logs

Returns stdout/stderr for the current gateway process (or a specific process by ID).

```bash
curl $BASE/debug/logs                    # current gateway process
curl "$BASE/debug/logs?id=<process-id>"  # specific process
```

**Use when:** Reading gateway output without needing `wrangler tail`. If no gateway process is running, returns `{"status":"no_process"}`.

### GET /debug/gateway-api

Probes the gateway's internal HTTP API (port 18789) from inside the container.

```bash
curl "$BASE/debug/gateway-api?path=/"
curl "$BASE/debug/gateway-api?path=/api/health"
curl "$BASE/debug/gateway-api?path=/api/agents"
```

Returns the gateway's response status, content type, and body. JSON responses are parsed automatically.

**Use when:** Testing whether the gateway is responding, checking its health endpoint, or inspecting its internal API without direct container access.

### GET /debug/cli

Runs an arbitrary command inside the container and returns its output. Defaults to `clawdbot --help`. Polls up to 15 seconds for completion.

```bash
curl "$BASE/debug/cli?cmd=clawdbot%20--help"
curl "$BASE/debug/cli?cmd=cat%20/root/.clawdbot/auth-profiles.json"
curl "$BASE/debug/cli?cmd=ls%20-la%20/root/.clawdbot/"
curl "$BASE/debug/cli?cmd=env"
```

**Use when:** You need to inspect files, run diagnostics, or execute CLI commands inside the container. This is the most flexible endpoint — it can run any command the container's shell supports.

### GET /debug/container-config

Reads `/root/.clawdbot/clawdbot.json` from the container and returns it as parsed JSON.

```bash
curl $BASE/debug/container-config
# {"status":"completed","exitCode":0,"config":{...}}
```

If the config is not valid JSON, the raw text is returned in the `raw` field instead of `config`.

**Use when:** Verifying that `start-moltbot.sh` wrote the expected config — check model settings, channel config, gateway auth, thinking mode, etc. This is the fastest way to confirm env vars flowed through correctly after a deploy or restart.

### GET /debug/env

Returns sanitized Worker-side environment info (boolean flags for secrets, not actual values).

```bash
curl $BASE/debug/env
# {"has_anthropic_key":false,"has_openai_key":false,"has_gateway_token":true,...}
```

**Use when:** Confirming which wrangler secrets are set without exposing their values. Useful for diagnosing "No API key found" errors.

### GET /debug/ws-test

Serves an interactive HTML page for testing WebSocket connections to the gateway.

Open in a browser: `$BASE/debug/ws-test`

The page provides Connect/Disconnect buttons, a message input field, and a "Send Connect Frame" button that sends a properly formatted gateway connect handshake. All sent/received messages are displayed in a terminal-style log.

**Use when:** Debugging WebSocket connectivity issues, testing the gateway's WebSocket protocol, or verifying that the Worker's WebSocket proxy is forwarding correctly.

## Troubleshooting Recipes

### "Is the gateway running?"

```bash
curl $BASE/debug/processes | jq '.processes[] | select(.status == "running")'
```

If empty, the gateway hasn't started or has crashed.

### "Why did the gateway crash?"

```bash
curl "$BASE/debug/processes?logs=true" | jq '.processes[] | select(.status == "failed") | {command, exitCode, stderr}'
```

Exit code 1 with a config validation error usually means an invalid key in `clawdbot.json` (see deploy-debug skill).

### "Did my env var flow through to the config?"

```bash
curl $BASE/debug/container-config | jq '.config.agents.defaults'
```

Check that the expected fields are present (e.g., `thinkingDefault`, `model.primary`).

### "Which secrets are set?"

```bash
curl $BASE/debug/env | jq .
```

### "What's running inside the container?"

```bash
curl "$BASE/debug/cli?cmd=ps%20aux" | jq '.stdout'
```
