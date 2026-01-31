---
name: add-env-var
description: Use when adding, changing, or removing an environment variable or wrangler secret in moltworker. Covers the full chain from types.ts through container startup.
---

# Add or Change an Environment Variable

## Overview

Env vars flow through a 5-step chain. Missing any step causes silent failures — the container won't see the value.

## The Chain

```
1. types.ts          → Declare in MoltbotEnv interface
2. env.ts            → Forward in buildEnvVars() (with any name mapping)
3. start-moltbot.sh  → Consume in startup script (if it becomes config/file)
4. wrangler secret   → Set the actual value
5. env.test.ts       → Add test coverage
```

## Step-by-Step

### 1. Declare in `src/types.ts`

Add the field to the `MoltbotEnv` interface with a JSDoc comment:

```typescript
// In MoltbotEnv interface:
MY_NEW_VAR?: string; // Description of what this is for
```

### 2. Forward in `src/gateway/env.ts`

Add to `buildEnvVars()`. Simple passthrough:

```typescript
if (env.MY_NEW_VAR) envVars.MY_NEW_VAR = env.MY_NEW_VAR;
```

If the container expects a different name (like `MOLTBOT_GATEWAY_TOKEN` → `CLAWDBOT_GATEWAY_TOKEN`):

```typescript
if (env.MY_NEW_VAR) envVars.CONTAINER_NAME = env.MY_NEW_VAR;
```

### 3. Consume in `start-moltbot.sh` (if needed)

Only needed if the var should:
- Become a key in `clawdbot.json` (add to the `node << EOFNODE` section)
- Generate a config file (like himalaya's `config.toml`)
- Be used during boot logic

If it's just passed through as an env var for the running process, skip this step.

### 4. Set the secret

```bash
npx wrangler secret put MY_NEW_VAR
```

### 5. Add test in `src/gateway/env.test.ts`

Follow the existing pattern — test that `buildEnvVars()` includes the new var when set, and omits it when unset.

## Post-Change Reminders

- **Running container won't see the change** until `npm run deploy` or gateway restart via `POST /api/admin/gateway/restart`
- If adding to `wrangler.jsonc` comments, update the secrets list at the bottom
- If the var is required, document it in CLAUDE.md under Environment Variables

## Name Mapping Reference

| Wrangler Secret | Container Env Var | Why |
|---|---|---|
| `MOLTBOT_GATEWAY_TOKEN` | `CLAWDBOT_GATEWAY_TOKEN` | Upstream naming |
| `DEV_MODE` | `CLAWDBOT_DEV_MODE` | Namespace prefix |
| `GOG_KEYRING_PASSWORD` | `GOG_KEYRING_PASSWORD` + `GOG_KEYRING_BACKEND=file` | Container has no OS keyring |
| `AI_GATEWAY_API_KEY` | `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | Based on base URL suffix |
