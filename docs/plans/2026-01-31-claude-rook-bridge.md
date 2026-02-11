# Claude Code ↔ Rook Bridge

## Problem

Claude Code (local CLI) and Rook (Clawdbot agent in Cloudflare Sandbox) can't communicate directly. Coordination requires Jason to copy-paste messages between them. This is especially painful for multi-step flows like OAuth handshakes.

## Goal

Let Claude Code send messages to Rook programmatically and receive responses, enabling automated coordination between the two agents.

## Context

### What exists today

- **Worker** (`src/index.ts`): Hono app that proxies HTTP/WebSocket to the clawdbot gateway on port 18789
- **Gateway API**: Clawdbot gateway exposes HTTP and WebSocket APIs on port 18789 inside the container
- **Debug endpoints** (`src/routes/debug.ts`): Already has `/debug/gateway-api?path=` which can proxy arbitrary HTTP requests to the gateway
- **Auth**: All routes go through CF Access JWT validation
- **WebSocket proxy**: The worker already proxies WebSocket connections to the gateway (this is how Telegram/Discord/web clients talk to Rook)

### Key questions to research

1. **What API does the clawdbot gateway expose?** Specifically:
   - Is there an HTTP endpoint to send a message and get a response?
   - What does the WebSocket protocol look like? (The `/debug/ws-test` page has a connect frame example)
   - Can we send a message via HTTP and poll for the response, or does it require a persistent WebSocket?

2. **Authentication to the gateway**: The gateway uses `CLAWDBOT_GATEWAY_TOKEN` for auth. Claude Code has access to wrangler secrets but not the raw values at runtime — would need to either:
   - Go through the worker (which already handles auth)
   - Add a dedicated API route that authenticates via CF Access

3. **Message format**: What does a message to Rook look like? Need to understand the clawdbot messaging protocol.

## Proposed architecture

```
Claude Code (local CLI)
    ↓ curl/fetch
Worker (Hono) — new route: POST /api/agent/message
    ↓ containerFetch or WebSocket
Clawdbot Gateway (port 18789)
    ↓
Rook processes message, responds
    ↓
Response flows back up the chain
```

### New worker route

```
POST /api/agent/message
Authorization: CF Access JWT (already handled by middleware)
Body: { "message": "string", "timeout"?: number }
Response: { "response": "string", "status": "ok" | "error" }
```

This would be a synchronous request-response endpoint. The worker sends the message to the gateway, waits for a response (with timeout), and returns it.

### Claude Code side

A simple bash function or script that Claude Code calls:

```bash
# Send a message to Rook and get the response
curl -s -X POST https://moltbot-sandbox.jason-cc9.workers.dev/api/agent/message \
  -H "Content-Type: application/json" \
  -d '{"message": "run himalaya envelope list and tell me what you see"}'
```

Could also be wrapped as a Claude Code skill or MCP tool for cleaner integration.

## Research steps (for next session)

1. **Explore the gateway API**: Use `/debug/gateway-api` to probe what endpoints exist on port 18789. Start with common paths like `/`, `/api`, `/health`, `/messages`.

2. **Study the WebSocket protocol**: Read the existing WebSocket proxy code in `src/index.ts` to understand the message format. The `/debug/ws-test` page has a connect frame — study that protocol.

3. **Check clawdbot docs**: Look at OpenClaw/clawdbot documentation for the gateway API specification. Context7 may have info under the openclaw library.

4. **Prototype**: Try sending a message through `/debug/gateway-api` and see what happens. Even if it's not a clean API, understanding what's available will shape the design.

## Stretch goals

- **MCP tool**: Wrap the bridge as an MCP server tool so Claude Code can call `send_to_rook("message")` natively
- **Bidirectional**: Let Rook send messages back to Claude Code (harder — would need a polling mechanism or webhook)
- **Streaming**: WebSocket-based streaming for long-running operations
- **Shared context**: Both agents can read/write to a shared scratchpad in R2

## Session context (for reference)

This plan was created at the end of a session where we:
- Added email skills (gog + himalaya) to moltworker
- Installed CLI binaries in the Dockerfile
- Wired env vars through buildEnvVars()
- Set up R2 backup for gog OAuth tokens
- Generated himalaya config at startup
- Fixed gog credentials format (must use `gog auth credentials`, not raw copy)
- Added Claude Code hook to prevent direct commits to main
- Added `--repo jlevy-io/moltworker` note to CLAUDE.md for gh pr create

### Pending items from this session
- **Himalaya**: Should be working after redeploy — verify with `himalaya envelope list`
- **gog OAuth**: Still needs the one-time interactive `gog auth add --manual` flow via Rook's PTY
- **App password rotation**: The Hotmail app password was pasted in plaintext during the session — should be rotated
