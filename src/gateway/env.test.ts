import { describe, it, expect } from 'vitest';
import { buildEnvVars } from './env';
import { createMockEnv } from '../test-utils';

describe('buildEnvVars', () => {
  it('returns empty object when no env vars set', () => {
    const env = createMockEnv();
    const result = buildEnvVars(env);
    expect(result).toEqual({});
  });

  it('includes ANTHROPIC_API_KEY when set directly', () => {
    const env = createMockEnv({ ANTHROPIC_API_KEY: 'sk-test-key' });
    const result = buildEnvVars(env);
    expect(result.ANTHROPIC_API_KEY).toBe('sk-test-key');
  });

  it('includes OPENAI_API_KEY when set directly', () => {
    const env = createMockEnv({ OPENAI_API_KEY: 'sk-openai-key' });
    const result = buildEnvVars(env);
    expect(result.OPENAI_API_KEY).toBe('sk-openai-key');
  });

  // Cloudflare AI Gateway (new native provider)
  it('passes Cloudflare AI Gateway env vars', () => {
    const env = createMockEnv({
      CLOUDFLARE_AI_GATEWAY_API_KEY: 'cf-gw-key',
      CF_AI_GATEWAY_ACCOUNT_ID: 'my-account-id',
      CF_AI_GATEWAY_GATEWAY_ID: 'my-gateway-id',
    });
    const result = buildEnvVars(env);
    expect(result.CLOUDFLARE_AI_GATEWAY_API_KEY).toBe('cf-gw-key');
    expect(result.CF_AI_GATEWAY_ACCOUNT_ID).toBe('my-account-id');
    expect(result.CF_AI_GATEWAY_GATEWAY_ID).toBe('my-gateway-id');
  });

  it('passes Cloudflare AI Gateway alongside direct Anthropic key', () => {
    const env = createMockEnv({
      CLOUDFLARE_AI_GATEWAY_API_KEY: 'cf-gw-key',
      CF_AI_GATEWAY_ACCOUNT_ID: 'my-account-id',
      CF_AI_GATEWAY_GATEWAY_ID: 'my-gateway-id',
      ANTHROPIC_API_KEY: 'sk-anthro',
    });
    const result = buildEnvVars(env);
    expect(result.CLOUDFLARE_AI_GATEWAY_API_KEY).toBe('cf-gw-key');
    expect(result.ANTHROPIC_API_KEY).toBe('sk-anthro');
  });

  // Legacy AI Gateway support
  it('maps legacy AI_GATEWAY_API_KEY to ANTHROPIC_API_KEY with base URL', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'sk-gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic',
    });
    const result = buildEnvVars(env);
    expect(result.ANTHROPIC_API_KEY).toBe('sk-gateway-key');
    expect(result.ANTHROPIC_BASE_URL).toBe(
      'https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic',
    );
    expect(result.AI_GATEWAY_BASE_URL).toBe(
      'https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic',
    );
  });

  it('legacy AI_GATEWAY_* overrides direct ANTHROPIC_API_KEY', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.example.com/anthropic',
      ANTHROPIC_API_KEY: 'direct-key',
    });
    const result = buildEnvVars(env);
    expect(result.ANTHROPIC_API_KEY).toBe('gateway-key');
    expect(result.AI_GATEWAY_BASE_URL).toBe('https://gateway.example.com/anthropic');
  });

  it('strips trailing slashes from legacy AI_GATEWAY_BASE_URL', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'sk-gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic///',
    });
    const result = buildEnvVars(env);
    expect(result.AI_GATEWAY_BASE_URL).toBe(
      'https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic',
    );
  });

  it('falls back to ANTHROPIC_BASE_URL when no AI_GATEWAY_BASE_URL', () => {
    const env = createMockEnv({
      ANTHROPIC_API_KEY: 'direct-key',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    });
    const result = buildEnvVars(env);
    expect(result.ANTHROPIC_API_KEY).toBe('direct-key');
    expect(result.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
  });

  // Gateway token mapping
  it('maps MOLTBOT_GATEWAY_TOKEN to OPENCLAW_GATEWAY_TOKEN for container', () => {
    const env = createMockEnv({ MOLTBOT_GATEWAY_TOKEN: 'my-token' });
    const result = buildEnvVars(env);
    expect(result.OPENCLAW_GATEWAY_TOKEN).toBe('my-token');
  });

  // Channel tokens
  it('includes all channel tokens when set', () => {
    const env = createMockEnv({
      TELEGRAM_BOT_TOKEN: 'tg-token',
      TELEGRAM_DM_POLICY: 'pairing',
      DISCORD_BOT_TOKEN: 'discord-token',
      DISCORD_DM_POLICY: 'open',
      SLACK_BOT_TOKEN: 'slack-bot',
      SLACK_APP_TOKEN: 'slack-app',
    });
    const result = buildEnvVars(env);

    expect(result.TELEGRAM_BOT_TOKEN).toBe('tg-token');
    expect(result.TELEGRAM_DM_POLICY).toBe('pairing');
    expect(result.DISCORD_BOT_TOKEN).toBe('discord-token');
    expect(result.DISCORD_DM_POLICY).toBe('open');
    expect(result.SLACK_BOT_TOKEN).toBe('slack-bot');
    expect(result.SLACK_APP_TOKEN).toBe('slack-app');
  });

  it('maps DEV_MODE to OPENCLAW_DEV_MODE for container', () => {
    const env = createMockEnv({
      DEV_MODE: 'true',
    });
    const result = buildEnvVars(env);
    expect(result.OPENCLAW_DEV_MODE).toBe('true');
  });

  // AI Gateway model override
  it('passes CF_AI_GATEWAY_MODEL to container', () => {
    const env = createMockEnv({
      CF_AI_GATEWAY_MODEL: 'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    });
    const result = buildEnvVars(env);
    expect(result.CF_AI_GATEWAY_MODEL).toBe('workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  });

  it('passes CF_ACCOUNT_ID to container', () => {
    const env = createMockEnv({ CF_ACCOUNT_ID: 'acct-123' });
    const result = buildEnvVars(env);
    expect(result.CF_ACCOUNT_ID).toBe('acct-123');
  });

  it('combines all env vars correctly', () => {
    const env = createMockEnv({
      ANTHROPIC_API_KEY: 'sk-key',
      MOLTBOT_GATEWAY_TOKEN: 'token',
      TELEGRAM_BOT_TOKEN: 'tg',
    });
    const result = buildEnvVars(env);

    expect(result).toEqual({
      ANTHROPIC_API_KEY: 'sk-key',
      OPENCLAW_GATEWAY_TOKEN: 'token',
      TELEGRAM_BOT_TOKEN: 'tg',
    });
  });

  // OpenAI Codex OAuth tokens
  it('includes OpenAI Codex tokens when set', () => {
    const env = createMockEnv({
      OPENAI_CODEX_ACCESS_TOKEN: 'eyJhbGciOiJSUzI1NiJ9.test-access-token',
      OPENAI_CODEX_REFRESH_TOKEN: 'v1.test-refresh-token',
      OPENAI_CODEX_ACCOUNT_ID: 'acct_abc123',
    });
    const result = buildEnvVars(env);
    expect(result.OPENAI_CODEX_ACCESS_TOKEN).toBe('eyJhbGciOiJSUzI1NiJ9.test-access-token');
    expect(result.OPENAI_CODEX_REFRESH_TOKEN).toBe('v1.test-refresh-token');
    expect(result.OPENAI_CODEX_ACCOUNT_ID).toBe('acct_abc123');
  });

  it('omits OpenAI Codex tokens when not set', () => {
    const env = createMockEnv();
    const result = buildEnvVars(env);
    expect(result.OPENAI_CODEX_ACCESS_TOKEN).toBeUndefined();
    expect(result.OPENAI_CODEX_REFRESH_TOKEN).toBeUndefined();
    expect(result.OPENAI_CODEX_ACCOUNT_ID).toBeUndefined();
  });

  // Agent defaults
  it('includes THINKING_DEFAULT when set', () => {
    const env = createMockEnv({ THINKING_DEFAULT: 'low' });
    const result = buildEnvVars(env);
    expect(result.THINKING_DEFAULT).toBe('low');
  });

  it('includes TYPING_MODE and TYPING_INTERVAL_SECONDS when set', () => {
    const env = createMockEnv({
      TYPING_MODE: 'instant',
      TYPING_INTERVAL_SECONDS: '6',
    });
    const result = buildEnvVars(env);
    expect(result.TYPING_MODE).toBe('instant');
    expect(result.TYPING_INTERVAL_SECONDS).toBe('6');
  });

  // Extended Slack config
  it('includes extended Slack env vars when set', () => {
    const env = createMockEnv({
      SLACK_BOT_TOKEN: 'slack-bot',
      SLACK_APP_TOKEN: 'slack-app',
      SLACK_DM_POLICY: 'allowlist',
      SLACK_ALLOW_FROM: 'U123,U456',
      SLACK_REQUIRE_MENTION: 'false',
    });
    const result = buildEnvVars(env);
    expect(result.SLACK_DM_POLICY).toBe('allowlist');
    expect(result.SLACK_ALLOW_FROM).toBe('U123,U456');
    expect(result.SLACK_REQUIRE_MENTION).toBe('false');
  });

  it('includes TELEGRAM_ALLOW_FROM when set', () => {
    const env = createMockEnv({ TELEGRAM_ALLOW_FROM: '12345,67890' });
    const result = buildEnvVars(env);
    expect(result.TELEGRAM_ALLOW_FROM).toBe('12345,67890');
  });

  // Email CLI configuration
  it('includes email CLI env vars when set', () => {
    const env = createMockEnv({
      HIMALAYA_IMAP_PASSWORD: 'app-password-123',
      HIMALAYA_EMAIL: 'user@hotmail.com',
      GOG_ACCOUNT: 'user@gmail.com',
      GOG_KEYRING_PASSWORD: 'keyring-secret',
      GOG_CLIENT_SECRET_JSON: 'eyJpbnN0YWxsZWQiOnt9fQ==',
    });
    const result = buildEnvVars(env);
    expect(result.HIMALAYA_IMAP_PASSWORD).toBe('app-password-123');
    expect(result.HIMALAYA_EMAIL).toBe('user@hotmail.com');
    expect(result.GOG_ACCOUNT).toBe('user@gmail.com');
    expect(result.GOG_KEYRING_PASSWORD).toBe('keyring-secret');
    expect(result.GOG_KEYRING_BACKEND).toBe('file');
    expect(result.GOG_CLIENT_SECRET_JSON).toBe('eyJpbnN0YWxsZWQiOnt9fQ==');
  });

  // Microsoft Graph
  it('includes MS_GRAPH_CLIENT_ID when set', () => {
    const env = createMockEnv({ MS_GRAPH_CLIENT_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
    const result = buildEnvVars(env);
    expect(result.MS_GRAPH_CLIENT_ID).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  // Git workspace backup
  it('includes GITHUB_PAT and GITHUB_REPO when set', () => {
    const env = createMockEnv({
      GITHUB_PAT: 'ghp_test123',
      GITHUB_REPO: 'user/workspace',
    });
    const result = buildEnvVars(env);
    expect(result.GITHUB_PAT).toBe('ghp_test123');
    expect(result.GITHUB_REPO).toBe('user/workspace');
  });

  // BRAVE_API_KEY
  it('includes BRAVE_API_KEY when set', () => {
    const env = createMockEnv({ BRAVE_API_KEY: 'BSA-test-key' });
    const result = buildEnvVars(env);
    expect(result.BRAVE_API_KEY).toBe('BSA-test-key');
  });
});
