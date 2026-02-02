#!/bin/bash
# Startup script for Moltbot in Cloudflare Sandbox
# This script:
# 1. Restores config from R2 backup if available
# 2. Configures moltbot from environment variables
# 3. Starts a background sync to backup config to R2
# 4. Starts the gateway

set -e

# Check if clawdbot gateway is already running - bail early if so
# Note: CLI is still named "clawdbot" until upstream renames it
if pgrep -f "clawdbot gateway" > /dev/null 2>&1; then
    echo "Moltbot gateway is already running, exiting."
    exit 0
fi

# Paths (clawdbot paths are used internally - upstream hasn't renamed yet)
CONFIG_DIR="/root/.clawdbot"
CONFIG_FILE="$CONFIG_DIR/clawdbot.json"
TEMPLATE_DIR="/root/.clawdbot-templates"
TEMPLATE_FILE="$TEMPLATE_DIR/moltbot.json.template"
BACKUP_DIR="/data/moltbot"

echo "Config directory: $CONFIG_DIR"
echo "Backup directory: $BACKUP_DIR"

# Create config directory
mkdir -p "$CONFIG_DIR"

# Write boot timestamp marker immediately — the Worker uses this to enforce
# a minimum container age before allowing R2 sync (prevents fresh containers
# from overwriting good backup data).
date +%s > "$CONFIG_DIR/.boot-timestamp"
echo "Boot timestamp written: $(cat $CONFIG_DIR/.boot-timestamp)"

# Clean up corrupted config with invalid 'dm' key (see issue #82)
# If this config was synced to R2, also reset the sync timestamp
# so the corrupted backup doesn't get restored again.
if [ -f "$CONFIG_FILE" ] && grep -q '"dm":' "$CONFIG_FILE" 2>/dev/null; then
    echo "Detected corrupted config with invalid 'dm' key, removing..."
    rm -f "$CONFIG_FILE"
    rm -f "$CONFIG_DIR/.last-sync"
fi

# ============================================================
# RESTORE FROM R2 BACKUP
# ============================================================
# Check if R2 backup exists by looking for clawdbot.json
# The BACKUP_DIR may exist but be empty if R2 was just mounted
# Note: backup structure is $BACKUP_DIR/clawdbot/ and $BACKUP_DIR/skills/

# Helper function to check if R2 backup is newer than local
should_restore_from_r2() {
    local R2_SYNC_FILE="$BACKUP_DIR/.last-sync"
    local LOCAL_SYNC_FILE="$CONFIG_DIR/.last-sync"
    
    # If no R2 sync timestamp, don't restore
    if [ ! -f "$R2_SYNC_FILE" ]; then
        echo "No R2 sync timestamp found, skipping restore"
        return 1
    fi
    
    # If no local sync timestamp, restore from R2
    if [ ! -f "$LOCAL_SYNC_FILE" ]; then
        echo "No local sync timestamp, will restore from R2"
        return 0
    fi
    
    # Compare timestamps
    R2_TIME=$(cat "$R2_SYNC_FILE" 2>/dev/null)
    LOCAL_TIME=$(cat "$LOCAL_SYNC_FILE" 2>/dev/null)
    
    echo "R2 last sync: $R2_TIME"
    echo "Local last sync: $LOCAL_TIME"
    
    # Convert to epoch seconds for comparison
    R2_EPOCH=$(date -d "$R2_TIME" +%s 2>/dev/null || echo "0")
    LOCAL_EPOCH=$(date -d "$LOCAL_TIME" +%s 2>/dev/null || echo "0")
    
    if [ "$R2_EPOCH" -gt "$LOCAL_EPOCH" ]; then
        echo "R2 backup is newer, will restore"
        return 0
    else
        echo "Local data is newer or same, skipping restore"
        return 1
    fi
}

if [ -f "$BACKUP_DIR/clawdbot/clawdbot.json" ]; then
    if should_restore_from_r2; then
        echo "Restoring from R2 backup at $BACKUP_DIR/clawdbot..."
        cp -a "$BACKUP_DIR/clawdbot/." "$CONFIG_DIR/"
        # Copy the sync timestamp to local so we know what version we have
        cp -f "$BACKUP_DIR/.last-sync" "$CONFIG_DIR/.last-sync" 2>/dev/null || true
        echo "Restored config from R2 backup"
    fi
elif [ -f "$BACKUP_DIR/clawdbot.json" ]; then
    # Legacy backup format (flat structure)
    if should_restore_from_r2; then
        echo "Restoring from legacy R2 backup at $BACKUP_DIR..."
        cp -a "$BACKUP_DIR/." "$CONFIG_DIR/"
        cp -f "$BACKUP_DIR/.last-sync" "$CONFIG_DIR/.last-sync" 2>/dev/null || true
        echo "Restored config from legacy R2 backup"
    fi
elif [ -d "$BACKUP_DIR" ]; then
    echo "R2 mounted at $BACKUP_DIR but no backup data found yet"
else
    echo "R2 not mounted, starting fresh"
fi

# Restore skills from R2 backup if available (only if R2 is newer)
SKILLS_DIR="/root/clawd/skills"
if [ -d "$BACKUP_DIR/skills" ] && [ "$(ls -A $BACKUP_DIR/skills 2>/dev/null)" ]; then
    if should_restore_from_r2; then
        echo "Restoring skills from $BACKUP_DIR/skills..."
        mkdir -p "$SKILLS_DIR"
        cp -a "$BACKUP_DIR/skills/." "$SKILLS_DIR/"
        echo "Restored skills from R2 backup"
    fi
fi

# Restore gog config from R2 backup if available (OAuth tokens for Google Workspace)
GOG_CONFIG_DIR="/root/.config/gogcli"
if [ -d "$BACKUP_DIR/gogcli" ] && [ "$(ls -A $BACKUP_DIR/gogcli 2>/dev/null)" ]; then
    if should_restore_from_r2; then
        echo "Restoring gog config from $BACKUP_DIR/gogcli..."
        mkdir -p "$GOG_CONFIG_DIR"
        cp -a "$BACKUP_DIR/gogcli/." "$GOG_CONFIG_DIR/"
        echo "Restored gog config from R2 backup"
    fi
fi

# Restore ms-graph token cache from R2 backup if available
MS_GRAPH_TOKEN_FILE="/root/.ms-graph-tokens.json"
if [ -f "$BACKUP_DIR/ms-graph-tokens.json" ]; then
    if should_restore_from_r2; then
        echo "Restoring ms-graph tokens from R2 backup..."
        cp -f "$BACKUP_DIR/ms-graph-tokens.json" "$MS_GRAPH_TOKEN_FILE"
        chmod 600 "$MS_GRAPH_TOKEN_FILE"
        echo "Restored ms-graph token cache from R2 backup"
    fi
fi

# Post-restore: clean up corrupted config that may have come from R2 (see issue #82)
if [ -f "$CONFIG_FILE" ] && grep -q '"dm":' "$CONFIG_FILE" 2>/dev/null; then
    echo "Detected corrupted config (from R2 restore) with invalid 'dm' key, removing..."
    rm -f "$CONFIG_FILE"
    rm -f "$CONFIG_DIR/.last-sync"
fi

# If config file still doesn't exist, create from template
if [ ! -f "$CONFIG_FILE" ]; then
    echo "No existing config found, initializing from template..."
    if [ -f "$TEMPLATE_FILE" ]; then
        cp "$TEMPLATE_FILE" "$CONFIG_FILE"
    else
        # Create minimal config if template doesn't exist
        cat > "$CONFIG_FILE" << 'EOFCONFIG'
{
  "agents": {
    "defaults": {
      "workspace": "/root/clawd"
    }
  },
  "gateway": {
    "port": 18789,
    "mode": "local"
  }
}
EOFCONFIG
    fi
else
    echo "Using existing config"
fi

# Mark restore/init as complete — the Worker will refuse to sync until this
# marker exists, preventing sync during a partial restore or init.
touch "$CONFIG_DIR/.restore-complete"
echo "Restore/init complete marker written"

# ============================================================
# RESTORE GIT WORKSPACE (if credentials provided)
# ============================================================
# Git restore is best-effort — failures must NOT prevent the gateway from starting.
# The entire section runs in a subshell so set -e doesn't propagate git failures.
if [ -n "$GITHUB_PAT" ] && [ -n "$GITHUB_REPO" ]; then
    echo "Configuring git workspace for $GITHUB_REPO..."
    # The || operator prevents set -e from killing the parent when the subshell fails
    (
        set -e
        cd /root/clawd

        # Prevent git from ever prompting for credentials (hangs in container)
        export GIT_TERMINAL_PROMPT=0
        git config --global credential.helper ""

        # Initialize repo before setting local config (git config without
        # --global requires a .git directory)
        if [ ! -d .git ]; then
            echo "[git] Initializing new repo..."
            git init
            git checkout -b main
        fi

        git config user.email "rook@clawd.bot"
        git config user.name "Rook"

        # Set up remote with PAT auth
        git remote remove origin 2>/dev/null || true
        git remote add origin "https://${GITHUB_PAT}@github.com/${GITHUB_REPO}.git"

        # Pull latest — try main, fall back to master
        # Timeout each git network operation to prevent hanging the boot
        echo "[git] Checking remote branches..."
        if timeout 30 git ls-remote --exit-code origin main 2>&1; then
            echo "[git] Fetching main branch..."
            timeout 60 git fetch origin main 2>&1
            git reset --hard origin/main
            echo "[git] Workspace restored from $GITHUB_REPO (main)"
        elif timeout 30 git ls-remote --exit-code origin master 2>&1; then
            echo "[git] Fetching master branch..."
            timeout 60 git fetch origin master 2>&1
            git checkout -B main origin/master  # normalize to main locally
            echo "[git] Workspace restored from $GITHUB_REPO (master→main)"
        else
            echo "[git] Remote repo is empty or unreachable — will push on first sync"
        fi
    ) || {
        echo "[git] WARNING: Git workspace restore failed with exit code $?"
        echo "[git] Gateway will start without workspace restore. Check GITHUB_PAT and GITHUB_REPO."
    }
    cd /root/clawd
else
    echo "Git workspace not configured (GITHUB_PAT or GITHUB_REPO not set)"
fi

# ============================================================
# UPDATE CONFIG FROM ENVIRONMENT VARIABLES
# ============================================================
node << EOFNODE
const fs = require('fs');

const configPath = '/root/.clawdbot/clawdbot.json';
console.log('Updating config at:', configPath);
let config = {};

try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
    console.log('Starting with empty config');
}

// Ensure nested objects exist
config.agents = config.agents || {};
config.agents.defaults = config.agents.defaults || {};
config.agents.defaults.model = config.agents.defaults.model || {};
config.gateway = config.gateway || {};
config.channels = config.channels || {};


// Gateway configuration
config.gateway.port = 18789;
config.gateway.mode = 'local';
config.gateway.trustedProxies = ['10.1.0.0'];

// Set gateway token if provided
if (process.env.CLAWDBOT_GATEWAY_TOKEN) {
    config.gateway.auth = config.gateway.auth || {};
    config.gateway.auth.token = process.env.CLAWDBOT_GATEWAY_TOKEN;
}

// Allow insecure auth for dev mode
if (process.env.CLAWDBOT_DEV_MODE === 'true') {
    config.gateway.controlUi = config.gateway.controlUi || {};
    config.gateway.controlUi.allowInsecureAuth = true;
}

// Telegram configuration
if (process.env.TELEGRAM_BOT_TOKEN) {
    config.channels.telegram = config.channels.telegram || {};
    config.channels.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN;
    config.channels.telegram.enabled = true;
    if (process.env.TELEGRAM_DM_POLICY) {
        config.channels.telegram.dmPolicy = process.env.TELEGRAM_DM_POLICY;
    }
    if (process.env.TELEGRAM_ALLOW_FROM) {
        config.channels.telegram.allowFrom = process.env.TELEGRAM_ALLOW_FROM.split(',');
    }
    // Clean up invalid 'dm' object key from previous versions (see issue #82)
    delete config.channels.telegram.dm;
}

// Discord configuration
if (process.env.DISCORD_BOT_TOKEN) {
    config.channels.discord = config.channels.discord || {};
    config.channels.discord.token = process.env.DISCORD_BOT_TOKEN;
    config.channels.discord.enabled = true;
    // Clean up invalid 'dm' key from previous versions (see issue #82)
    delete config.channels.discord.dm;
}

// Slack configuration
if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) {
    config.channels.slack = config.channels.slack || {};
    config.channels.slack.botToken = process.env.SLACK_BOT_TOKEN;
    config.channels.slack.appToken = process.env.SLACK_APP_TOKEN;
    config.channels.slack.enabled = true;
    config.channels.slack.groupPolicy = 'open';
    if (process.env.SLACK_REQUIRE_MENTION === 'false') {
        config.channels.slack.channels = config.channels.slack.channels || {};
        config.channels.slack.channels['*'] = { requireMention: false };
    }
    if (process.env.SLACK_DM_POLICY) {
        config.channels.slack.dm = config.channels.slack.dm || {};
        config.channels.slack.dm.enabled = true;
        config.channels.slack.dm.policy = process.env.SLACK_DM_POLICY;
        if (process.env.SLACK_ALLOW_FROM) {
            config.channels.slack.dm.allowFrom = process.env.SLACK_ALLOW_FROM.split(',');
        }
    }
}

// OpenAI Codex provider (ChatGPT Pro via OAuth)
// openai-codex is a built-in provider in clawdbot — do NOT define it in models.providers
// (custom provider entries require baseUrl, but the built-in handles routing automatically).
// Just wipe old custom providers and set the model primary/fallbacks.
console.log('Configuring OpenAI Codex as primary model');
config.models = config.models || {};
delete config.models.mode;  // Remove 'merge' mode from previous OpenRouter config
config.models.providers = {};  // Wipe old custom providers (anthropic, openrouter)
config.agents.defaults.model.primary = 'openai-codex/gpt-5.2';
config.agents.defaults.model.fallbacks = ['openai-codex/gpt-5.1-codex-mini'];

// Auth config for Codex OAuth
config.auth = { profiles: {}, order: {} };
config.auth.profiles['openai-codex:default'] = { provider: 'openai-codex', mode: 'oauth' };
config.auth.order['openai-codex'] = ['openai-codex:default'];

// Write updated config
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('Configuration updated successfully');
console.log('Config:', JSON.stringify(config, null, 2));
EOFNODE

# ============================================================
# SEED OPENAI CODEX AUTH PROFILES (OAuth tokens)
# ============================================================
# Only seed if auth-profiles.json does NOT already exist (R2 restore runs first
# and may have brought back a file with auto-rotated tokens from a previous boot).
AUTH_PROFILES_FILE="$CONFIG_DIR/auth-profiles.json"
if [ -n "$OPENAI_CODEX_ACCESS_TOKEN" ] && [ -n "$OPENAI_CODEX_REFRESH_TOKEN" ] && [ ! -f "$AUTH_PROFILES_FILE" ]; then
    echo "Seeding auth-profiles.json from OPENAI_CODEX_* env vars..."
    node -e '
      const profile = {
        accessToken: process.env.OPENAI_CODEX_ACCESS_TOKEN,
        refreshToken: process.env.OPENAI_CODEX_REFRESH_TOKEN,
        expiresAt: 0,
        accountId: process.env.OPENAI_CODEX_ACCOUNT_ID || "",
      };
      const data = { "openai-codex:default": profile };
      require("fs").writeFileSync(process.argv[1], JSON.stringify(data, null, 2));
    ' "$AUTH_PROFILES_FILE"
    chmod 600 "$AUTH_PROFILES_FILE"
    echo "Seeded auth-profiles.json (gateway will auto-refresh tokens on first use)"
elif [ -f "$AUTH_PROFILES_FILE" ]; then
    echo "auth-profiles.json already exists (likely restored from R2), skipping seed"
else
    echo "No OPENAI_CODEX tokens set, skipping auth-profiles.json seed"
fi

# The gateway agent also needs auth-profiles.json in its own agentDir.
# Copy it there so the agent can find it at startup.
AGENT_AUTH_DIR="$CONFIG_DIR/agents/main/agent"
if [ -f "$AUTH_PROFILES_FILE" ] && [ ! -f "$AGENT_AUTH_DIR/auth-profiles.json" ]; then
    mkdir -p "$AGENT_AUTH_DIR"
    cp "$AUTH_PROFILES_FILE" "$AGENT_AUTH_DIR/auth-profiles.json"
    chmod 600 "$AGENT_AUTH_DIR/auth-profiles.json"
    echo "Copied auth-profiles.json to agent dir ($AGENT_AUTH_DIR)"
fi

# ============================================================
# WRITE GOG OAUTH CLIENT CREDENTIALS
# ============================================================
if [ -n "$GOG_CLIENT_SECRET_JSON" ]; then
    # Decode the base64 JSON to a temp file and let gog process it
    # (gog auth credentials transforms Google's format into its own config)
    GOG_TEMP="/tmp/gog_client_secret.json"
    echo "$GOG_CLIENT_SECRET_JSON" | base64 -d > "$GOG_TEMP"
    gog auth credentials "$GOG_TEMP" --no-input 2>&1 || echo "Warning: gog auth credentials failed"
    rm -f "$GOG_TEMP"
    echo "Wrote gog OAuth client credentials via gog auth credentials"
else
    echo "Gog client credentials not configured (GOG_CLIENT_SECRET_JSON not set)"
fi

# ============================================================
# GENERATE HIMALAYA CONFIG (Hotmail IMAP)
# ============================================================
if [ -n "$HIMALAYA_EMAIL" ] && [ -n "$HIMALAYA_IMAP_PASSWORD" ]; then
    HIMALAYA_CONFIG_DIR="/root/.config/himalaya"
    mkdir -p "$HIMALAYA_CONFIG_DIR"
    cat > "$HIMALAYA_CONFIG_DIR/config.toml" << EOFHIMALAYA
[accounts.hotmail]
email = "$HIMALAYA_EMAIL"
default = true

backend.type = "imap"
backend.host = "outlook.office365.com"
backend.port = 993
backend.encryption.type = "tls"
backend.login = "$HIMALAYA_EMAIL"
backend.auth.type = "password"
backend.auth.raw = "$HIMALAYA_IMAP_PASSWORD"

message.send.backend.type = "smtp"
message.send.backend.host = "smtp-mail.outlook.com"
message.send.backend.port = 587
message.send.backend.encryption.type = "start-tls"
message.send.backend.login = "$HIMALAYA_EMAIL"
message.send.backend.auth.type = "password"
message.send.backend.auth.raw = "$HIMALAYA_IMAP_PASSWORD"
EOFHIMALAYA
    chmod 600 "$HIMALAYA_CONFIG_DIR/config.toml"
    echo "Generated himalaya config for $HIMALAYA_EMAIL"
else
    echo "Himalaya not configured (HIMALAYA_EMAIL or HIMALAYA_IMAP_PASSWORD not set)"
fi

# ============================================================
# INSTALL SKILL DEPENDENCIES
# ============================================================
# Install npm dependencies for skills that ship their own Node.js code.
# This runs at startup (not in Dockerfile) so R2-restored skills get deps too.
MS_GRAPH_SKILL_DIR="$SKILLS_DIR/ms-graph"
if [ -f "$MS_GRAPH_SKILL_DIR/package.json" ]; then
    echo "Installing ms-graph skill dependencies..."
    (cd "$MS_GRAPH_SKILL_DIR" && npm install --production 2>&1) || {
        echo "WARNING: ms-graph skill npm install failed"
    }
else
    echo "ms-graph skill not found, skipping dependency install"
fi

# ============================================================
# START GATEWAY
# ============================================================
# Note: R2 backup sync is handled by the Worker's cron trigger
echo "Starting Moltbot Gateway..."
echo "Gateway will be available on port 18789"

# Clean up stale lock files
rm -f /tmp/clawdbot-gateway.lock 2>/dev/null || true
rm -f "$CONFIG_DIR/gateway.lock" 2>/dev/null || true

BIND_MODE="lan"
echo "Dev mode: ${CLAWDBOT_DEV_MODE:-false}, Bind mode: $BIND_MODE"

if [ -n "$CLAWDBOT_GATEWAY_TOKEN" ]; then
    echo "Starting gateway with token auth..."
    exec clawdbot gateway --port 18789 --verbose --allow-unconfigured --bind "$BIND_MODE" --token "$CLAWDBOT_GATEWAY_TOKEN"
else
    echo "Starting gateway with device pairing (no token)..."
    exec clawdbot gateway --port 18789 --verbose --allow-unconfigured --bind "$BIND_MODE"
fi
