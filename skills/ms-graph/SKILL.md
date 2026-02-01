---
name: ms-graph
description: "Access Hotmail/Outlook.com email via Microsoft Graph API. Authenticate with device code flow, then list, read, search, send, and export emails."
metadata: {"clawdbot":{"emoji":"📬"}}
---

# Microsoft Graph Email

Access `jaylee9000@hotmail.com` (and other personal Microsoft accounts) via the Microsoft Graph API. Uses device code flow for authentication — no browser required in the container.

## Prerequisites

1. Azure App Registration with client ID set as `MS_GRAPH_CLIENT_ID` env var
2. App must have permissions: `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `User.Read`, `offline_access`
3. App must allow public client flows (device code)

## One-Time Authentication

Run the auth flow once. Tokens persist across container restarts via R2 backup.

```bash
cd /root/clawd/skills/ms-graph && node src/tools.js auth-start
```

This outputs a URL and code. The user visits the URL and enters the code to authorize. After approval, tokens are cached at `~/.ms-graph-tokens.json`.

Check auth status:
```bash
cd /root/clawd/skills/ms-graph && node src/tools.js auth-status
```

## Commands

All commands output JSON. Run from the skill directory:
```bash
cd /root/clawd/skills/ms-graph
```

### List Mail Folders

```bash
node src/tools.js mail-folders
```

### List Emails

```bash
node src/tools.js mail-list
node src/tools.js mail-list --folder inbox --top 10 --skip 0
node src/tools.js mail-list --folder sentitems --top 5
```

Well-known folder names: `inbox`, `sentitems`, `drafts`, `deleteditems`, `junkemail`, `archive`.

### Read a Single Email

```bash
node src/tools.js mail-get <message-id>
```

Returns full message with body text.

### Search Emails

Uses Microsoft's KQL (Keyword Query Language):
```bash
node src/tools.js mail-search from:john@example.com
node src/tools.js mail-search subject:invoice
node src/tools.js mail-search "meeting notes" --top 10
```

### Send Email

Pipe JSON to stdin:
```bash
echo '{"to":["recipient@example.com"],"subject":"Test","body":"Hello from Rook"}' | node src/tools.js mail-send
```

Full options:
```json
{
  "to": ["addr1@example.com"],
  "subject": "Subject line",
  "body": "Message body",
  "bodyType": "text",
  "cc": ["cc@example.com"],
  "bcc": ["bcc@example.com"]
}
```

**Always confirm with the user before sending.**

### Export as .eml

Single message to stdout:
```bash
node src/tools.js mail-export <message-id> > message.eml
```

Bulk export to directory:
```bash
node src/tools.js mail-export "id1,id2,id3" /tmp/exports
```

### List Attachments

```bash
node src/tools.js mail-attachments <message-id>
```

## Token Persistence

- Tokens cached at `~/.ms-graph-tokens.json`
- Backed up to R2 via existing sync mechanism
- Refresh tokens last 90 days with rolling renewal
- If tokens expire, re-run `auth-start`

## Troubleshooting

- **"MS_GRAPH_CLIENT_ID not set"**: Set the Azure client ID as a wrangler secret
- **"No cached Microsoft Graph tokens"**: Run `auth-start` to authenticate
- **"Silent token acquisition failed"**: Refresh token expired. Re-run `auth-start`
- **Graph API 403**: Check that the Azure app has the required permissions
- **Graph API 401**: Token expired and refresh failed. Re-run `auth-start`

## Clear Tokens

```bash
node src/tools.js auth-clear
```
