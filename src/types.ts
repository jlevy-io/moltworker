import type { Sandbox } from '@cloudflare/sandbox';

/**
 * Environment bindings for the Moltbot Worker
 */
export interface MoltbotEnv {
  Sandbox: DurableObjectNamespace<Sandbox>;
  ASSETS: Fetcher; // Assets binding for admin UI static files
  MOLTBOT_BUCKET: R2Bucket; // R2 bucket for persistent storage
  // AI Gateway configuration (preferred)
  AI_GATEWAY_API_KEY?: string; // API key for the provider configured in AI Gateway
  AI_GATEWAY_BASE_URL?: string; // AI Gateway URL (e.g., https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic)
  // Legacy direct provider configuration (fallback)
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  MOLTBOT_GATEWAY_TOKEN?: string; // Gateway token (mapped to CLAWDBOT_GATEWAY_TOKEN for container)

  CLAWDBOT_BIND_MODE?: string;
  DEV_MODE?: string; // Set to 'true' for local dev (skips CF Access auth + moltbot device pairing)
  DEBUG_ROUTES?: string; // Set to 'true' to enable /debug/* routes
  SANDBOX_SLEEP_AFTER?: string; // How long before sandbox sleeps: 'never' (default), or duration like '10m', '1h'
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_DM_POLICY?: string;
  TELEGRAM_ALLOW_FROM?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_DM_POLICY?: string;
  SLACK_BOT_TOKEN?: string;
  SLACK_APP_TOKEN?: string;
  SLACK_DM_POLICY?: string;
  SLACK_ALLOW_FROM?: string; // Comma-separated Slack member IDs allowed to DM
  SLACK_REQUIRE_MENTION?: string; // Set to 'false' to respond to all channel messages (default: mention-only)
  // Cloudflare Access configuration for admin routes
  CF_ACCESS_TEAM_DOMAIN?: string; // e.g., 'myteam.cloudflareaccess.com'
  CF_ACCESS_AUD?: string; // Application Audience (AUD) tag
  // R2 credentials for bucket mounting (set via wrangler secret)
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  CF_ACCOUNT_ID?: string; // Cloudflare account ID for R2 endpoint
  // Browser Rendering binding for CDP shim
  BROWSER?: Fetcher;
  CDP_SECRET?: string; // Shared secret for CDP endpoint authentication
  BRIDGE_SECRET?: string; // Shared secret for MCP bridge endpoint authentication
  WORKER_URL?: string; // Public URL of the worker (for CDP endpoint)
  // Email CLI configuration
  HIMALAYA_IMAP_PASSWORD?: string; // App password for Hotmail IMAP (outlook.office365.com)
  HIMALAYA_EMAIL?: string; // Email address for himalaya (e.g., user@hotmail.com)
  GOG_ACCOUNT?: string; // Google account email for gog CLI (e.g., user@gmail.com)
  GOG_KEYRING_PASSWORD?: string; // Password for gog's file-based keyring (container has no OS keyring)
  GOG_CLIENT_SECRET_JSON?: string; // Base64-encoded Google OAuth client_secret JSON for gog
  // Microsoft Graph API (ms-graph skill)
  MS_GRAPH_CLIENT_ID?: string; // Azure App Registration client ID for device code flow
  // Git workspace backup (auto-sync /root/clawd to GitHub)
  GITHUB_PAT?: string; // Personal access token for pushing workspace to GitHub
  GITHUB_REPO?: string; // GitHub repo (e.g., 'user/repo') for workspace backup
}

/**
 * Authenticated user from Cloudflare Access
 */
export interface AccessUser {
  email: string;
  name?: string;
}

/**
 * Hono app environment type
 */
export type AppEnv = {
  Bindings: MoltbotEnv;
  Variables: {
    sandbox: Sandbox;
    accessUser?: AccessUser;
  };
};

/**
 * JWT payload from Cloudflare Access
 */
export interface JWTPayload {
  aud: string[];
  email: string;
  exp: number;
  iat: number;
  iss: string;
  name?: string;
  sub: string;
  type: string;
}
