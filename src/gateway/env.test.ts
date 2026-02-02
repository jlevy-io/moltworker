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

  it('maps AI_GATEWAY_API_KEY to ANTHROPIC_API_KEY for Anthropic gateway', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'sk-gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic',
    });
    const result = buildEnvVars(env);
    expect(result.ANTHROPIC_API_KEY).toBe('sk-gateway-key');
    expect(result.ANTHROPIC_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic');
    expect(result.OPENAI_API_KEY).toBeUndefined();
  });

  it('maps AI_GATEWAY_API_KEY to OPENAI_API_KEY for OpenAI gateway', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'sk-gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/123/my-gw/openai',
    });
    const result = buildEnvVars(env);
    expect(result.OPENAI_API_KEY).toBe('sk-gateway-key');
    expect(result.OPENAI_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/openai');
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('passes AI_GATEWAY_BASE_URL directly', () => {
    const env = createMockEnv({
      AI_GATEWAY_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic',
    });
    const result = buildEnvVars(env);
    expect(result.AI_GATEWAY_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic');
  });

  it('AI_GATEWAY_* takes precedence over direct provider keys for Anthropic', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.example.com/anthropic',
      ANTHROPIC_API_KEY: 'direct-key',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    });
    const result = buildEnvVars(env);
    expect(result.ANTHROPIC_API_KEY).toBe('gateway-key');
    expect(result.AI_GATEWAY_BASE_URL).toBe('https://gateway.example.com/anthropic');
  });

  it('AI_GATEWAY_* takes precedence over direct provider keys for OpenAI', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.example.com/openai',
      OPENAI_API_KEY: 'direct-key',
    });
    const result = buildEnvVars(env);
    expect(result.OPENAI_API_KEY).toBe('gateway-key');
    expect(result.AI_GATEWAY_BASE_URL).toBe('https://gateway.example.com/openai');
    expect(result.OPENAI_BASE_URL).toBe('https://gateway.example.com/openai');
  });

  it('falls back to ANTHROPIC_* when AI_GATEWAY_* not set', () => {
    const env = createMockEnv({
      ANTHROPIC_API_KEY: 'direct-key',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    });
    const result = buildEnvVars(env);
    expect(result.ANTHROPIC_API_KEY).toBe('direct-key');
    expect(result.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
  });

  it('includes OPENAI_API_KEY when set directly (no gateway)', () => {
    const env = createMockEnv({ OPENAI_API_KEY: 'sk-openai-key' });
    const result = buildEnvVars(env);
    expect(result.OPENAI_API_KEY).toBe('sk-openai-key');
  });

  it('maps MOLTBOT_GATEWAY_TOKEN to CLAWDBOT_GATEWAY_TOKEN for container', () => {
    const env = createMockEnv({ MOLTBOT_GATEWAY_TOKEN: 'my-token' });
    const result = buildEnvVars(env);
    expect(result.CLAWDBOT_GATEWAY_TOKEN).toBe('my-token');
  });

  it('includes all channel tokens when set', () => {
    const env = createMockEnv({
      TELEGRAM_BOT_TOKEN: 'tg-token',
      TELEGRAM_DM_POLICY: 'pairing',
      DISCORD_BOT_TOKEN: 'discord-token',
      DISCORD_DM_POLICY: 'open',
      SLACK_BOT_TOKEN: 'slack-bot',
      SLACK_APP_TOKEN: 'slack-app',
      SLACK_DM_POLICY: 'allowlist',
      SLACK_ALLOW_FROM: 'U123,U456',
    });
    const result = buildEnvVars(env);

    expect(result.TELEGRAM_BOT_TOKEN).toBe('tg-token');
    expect(result.TELEGRAM_DM_POLICY).toBe('pairing');
    expect(result.DISCORD_BOT_TOKEN).toBe('discord-token');
    expect(result.DISCORD_DM_POLICY).toBe('open');
    expect(result.SLACK_BOT_TOKEN).toBe('slack-bot');
    expect(result.SLACK_APP_TOKEN).toBe('slack-app');
    expect(result.SLACK_DM_POLICY).toBe('allowlist');
    expect(result.SLACK_ALLOW_FROM).toBe('U123,U456');
  });

  it('includes SLACK_REQUIRE_MENTION when set', () => {
    const env = createMockEnv({
      SLACK_BOT_TOKEN: 'slack-bot',
      SLACK_APP_TOKEN: 'slack-app',
      SLACK_REQUIRE_MENTION: 'false',
    });
    const result = buildEnvVars(env);
    expect(result.SLACK_REQUIRE_MENTION).toBe('false');
  });

  it('maps DEV_MODE to CLAWDBOT_DEV_MODE for container', () => {
    const env = createMockEnv({
      DEV_MODE: 'true',
      CLAWDBOT_BIND_MODE: 'lan',
    });
    const result = buildEnvVars(env);
    
    expect(result.CLAWDBOT_DEV_MODE).toBe('true');
    expect(result.CLAWDBOT_BIND_MODE).toBe('lan');
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
      CLAWDBOT_GATEWAY_TOKEN: 'token',
      TELEGRAM_BOT_TOKEN: 'tg',
    });
  });

  it('handles trailing slash in AI_GATEWAY_BASE_URL for OpenAI', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'sk-gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/123/my-gw/openai/',
    });
    const result = buildEnvVars(env);
    expect(result.OPENAI_API_KEY).toBe('sk-gateway-key');
    expect(result.OPENAI_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/openai');
    expect(result.AI_GATEWAY_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/openai');
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('handles trailing slash in AI_GATEWAY_BASE_URL for Anthropic', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'sk-gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic/',
    });
    const result = buildEnvVars(env);
    expect(result.ANTHROPIC_API_KEY).toBe('sk-gateway-key');
    expect(result.ANTHROPIC_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic');
    expect(result.AI_GATEWAY_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic');
    expect(result.OPENAI_API_KEY).toBeUndefined();
  });

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

  it('includes MS_GRAPH_CLIENT_ID when set', () => {
    const env = createMockEnv({
      MS_GRAPH_CLIENT_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
    const result = buildEnvVars(env);
    expect(result.MS_GRAPH_CLIENT_ID).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('omits MS_GRAPH_CLIENT_ID when not set', () => {
    const env = createMockEnv();
    const result = buildEnvVars(env);
    expect(result.MS_GRAPH_CLIENT_ID).toBeUndefined();
  });

  it('includes GITHUB_PAT and GITHUB_REPO when set', () => {
    const env = createMockEnv({
      GITHUB_PAT: 'ghp_test123',
      GITHUB_REPO: 'user/workspace',
    });
    const result = buildEnvVars(env);

    expect(result.GITHUB_PAT).toBe('ghp_test123');
    expect(result.GITHUB_REPO).toBe('user/workspace');
  });

  it('omits GITHUB_PAT and GITHUB_REPO when not set', () => {
    const env = createMockEnv();
    const result = buildEnvVars(env);

    expect(result.GITHUB_PAT).toBeUndefined();
    expect(result.GITHUB_REPO).toBeUndefined();
  });

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

  it('handles multiple trailing slashes in AI_GATEWAY_BASE_URL', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'sk-gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/123/my-gw/openai///',
    });
    const result = buildEnvVars(env);
    expect(result.OPENAI_API_KEY).toBe('sk-gateway-key');
    expect(result.OPENAI_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/openai');
    expect(result.AI_GATEWAY_BASE_URL).toBe('https://gateway.ai.cloudflare.com/v1/123/my-gw/openai');
  });
});
