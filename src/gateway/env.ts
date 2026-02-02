import type { MoltbotEnv } from '../types';

/**
 * Build environment variables to pass to the Moltbot container process
 * 
 * @param env - Worker environment bindings
 * @returns Environment variables record
 */
export function buildEnvVars(env: MoltbotEnv): Record<string, string> {
  const envVars: Record<string, string> = {};

  // Normalize the base URL by removing trailing slashes
  const normalizedBaseUrl = env.AI_GATEWAY_BASE_URL?.replace(/\/+$/, '');
  const isOpenAIGateway = normalizedBaseUrl?.endsWith('/openai');

  // AI Gateway vars take precedence
  // Map to the appropriate provider env var based on the gateway endpoint
  if (env.AI_GATEWAY_API_KEY) {
    if (isOpenAIGateway) {
      envVars.OPENAI_API_KEY = env.AI_GATEWAY_API_KEY;
    } else {
      envVars.ANTHROPIC_API_KEY = env.AI_GATEWAY_API_KEY;
    }
  }

  // Fall back to direct provider keys
  if (!envVars.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY) {
    envVars.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  }
  if (!envVars.OPENAI_API_KEY && env.OPENAI_API_KEY) {
    envVars.OPENAI_API_KEY = env.OPENAI_API_KEY;
  }

  // Pass base URL (used by start-moltbot.sh to determine provider)
  if (normalizedBaseUrl) {
    envVars.AI_GATEWAY_BASE_URL = normalizedBaseUrl;
    // Also set the provider-specific base URL env var
    if (isOpenAIGateway) {
      envVars.OPENAI_BASE_URL = normalizedBaseUrl;
    } else {
      envVars.ANTHROPIC_BASE_URL = normalizedBaseUrl;
    }
  } else if (env.ANTHROPIC_BASE_URL) {
    envVars.ANTHROPIC_BASE_URL = env.ANTHROPIC_BASE_URL;
  }
  // Map MOLTBOT_GATEWAY_TOKEN to CLAWDBOT_GATEWAY_TOKEN (container expects this name)
  if (env.MOLTBOT_GATEWAY_TOKEN) envVars.CLAWDBOT_GATEWAY_TOKEN = env.MOLTBOT_GATEWAY_TOKEN;
  if (env.DEV_MODE) envVars.CLAWDBOT_DEV_MODE = env.DEV_MODE; // Pass DEV_MODE as CLAWDBOT_DEV_MODE to container
  if (env.CLAWDBOT_BIND_MODE) envVars.CLAWDBOT_BIND_MODE = env.CLAWDBOT_BIND_MODE;
  if (env.TELEGRAM_BOT_TOKEN) envVars.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
  if (env.TELEGRAM_DM_POLICY) envVars.TELEGRAM_DM_POLICY = env.TELEGRAM_DM_POLICY;
  if (env.TELEGRAM_ALLOW_FROM) envVars.TELEGRAM_ALLOW_FROM = env.TELEGRAM_ALLOW_FROM;
  if (env.DISCORD_BOT_TOKEN) envVars.DISCORD_BOT_TOKEN = env.DISCORD_BOT_TOKEN;
  if (env.DISCORD_DM_POLICY) envVars.DISCORD_DM_POLICY = env.DISCORD_DM_POLICY;
  if (env.SLACK_BOT_TOKEN) envVars.SLACK_BOT_TOKEN = env.SLACK_BOT_TOKEN;
  if (env.SLACK_APP_TOKEN) envVars.SLACK_APP_TOKEN = env.SLACK_APP_TOKEN;
  if (env.SLACK_DM_POLICY) envVars.SLACK_DM_POLICY = env.SLACK_DM_POLICY;
  if (env.SLACK_ALLOW_FROM) envVars.SLACK_ALLOW_FROM = env.SLACK_ALLOW_FROM;
  if (env.SLACK_REQUIRE_MENTION) envVars.SLACK_REQUIRE_MENTION = env.SLACK_REQUIRE_MENTION;
  if (env.CDP_SECRET) envVars.CDP_SECRET = env.CDP_SECRET;
  if (env.WORKER_URL) envVars.WORKER_URL = env.WORKER_URL;

  // Email CLI configuration
  if (env.HIMALAYA_IMAP_PASSWORD) envVars.HIMALAYA_IMAP_PASSWORD = env.HIMALAYA_IMAP_PASSWORD;
  if (env.HIMALAYA_EMAIL) envVars.HIMALAYA_EMAIL = env.HIMALAYA_EMAIL;
  if (env.GOG_ACCOUNT) envVars.GOG_ACCOUNT = env.GOG_ACCOUNT;
  if (env.GOG_KEYRING_PASSWORD) envVars.GOG_KEYRING_PASSWORD = env.GOG_KEYRING_PASSWORD;
  // gog needs file-based keyring in container (no OS keyring available)
  if (env.GOG_KEYRING_PASSWORD) envVars.GOG_KEYRING_BACKEND = 'file';
  if (env.GOG_CLIENT_SECRET_JSON) envVars.GOG_CLIENT_SECRET_JSON = env.GOG_CLIENT_SECRET_JSON;

  // Microsoft Graph API (ms-graph skill)
  if (env.MS_GRAPH_CLIENT_ID) envVars.MS_GRAPH_CLIENT_ID = env.MS_GRAPH_CLIENT_ID;

  // Git workspace backup
  if (env.GITHUB_PAT) envVars.GITHUB_PAT = env.GITHUB_PAT;
  if (env.GITHUB_REPO) envVars.GITHUB_REPO = env.GITHUB_REPO;

  return envVars;
}
