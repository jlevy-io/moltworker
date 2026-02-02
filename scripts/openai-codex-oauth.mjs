#!/usr/bin/env node
/**
 * OpenAI Codex OAuth PKCE Flow
 *
 * Standalone script to obtain OAuth tokens for ChatGPT Pro (Codex provider).
 * No clawdbot install required — just Node.js 18+.
 *
 * Usage:
 *   node scripts/openai-codex-oauth.mjs
 *
 * After completing the browser flow, set the printed values as wrangler secrets:
 *   npx wrangler secret put OPENAI_CODEX_ACCESS_TOKEN
 *   npx wrangler secret put OPENAI_CODEX_REFRESH_TOKEN
 *   npx wrangler secret put OPENAI_CODEX_ACCOUNT_ID   # optional
 */

import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { URL } from 'node:url';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const REDIRECT_PORT = 1455;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/auth/callback`;
const AUTH_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';

// PKCE helpers
function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateCodeVerifier() {
  return base64url(randomBytes(32));
}

function generateCodeChallenge(verifier) {
  return base64url(createHash('sha256').update(verifier).digest());
}

// Main flow
const codeVerifier = generateCodeVerifier();
const codeChallenge = generateCodeChallenge(codeVerifier);
const state = base64url(randomBytes(16));

const authParams = new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: 'offline_access',
  state,
  code_challenge: codeChallenge,
  code_challenge_method: 'S256',
  // Required by OpenAI's auth server to identify Codex CLI flow
  codex_cli_simplified_flow: 'true',
  originator: 'codex_cli_rs',
});

const authorizationUrl = `${AUTH_URL}?${authParams}`;

console.log('\n--- OpenAI Codex OAuth (PKCE) ---\n');
console.log('Opening browser for authorization...\n');
console.log(`If it doesn't open, visit:\n${authorizationUrl}\n`);

// Open browser (best-effort, uses execFile to avoid shell injection)
const openCmd = process.platform === 'darwin' ? 'open'
  : process.platform === 'win32' ? 'start'
  : 'xdg-open';
execFile(openCmd, [authorizationUrl], () => {});

// Start temp HTTP server to capture callback
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);

  if (url.pathname !== '/auth/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    const desc = url.searchParams.get('error_description') || error;
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end(`Error: ${desc}`);
    console.error(`\nAuthorization error: ${desc}`);
    process.exit(1);
  }

  if (returnedState !== state) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Error: State mismatch');
    console.error('\nState mismatch — possible CSRF. Try again.');
    process.exit(1);
  }

  // Exchange code for tokens
  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      throw new Error(`Token exchange failed (${tokenRes.status}): ${body}`);
    }

    const tokens = await tokenRes.json();

    // Extract ChatGPT account ID from the access token JWT
    let accountId;
    try {
      const payload = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64').toString());
      accountId = payload?.['https://api.openai.com/auth']?.chatgpt_account_id;
    } catch (e) {
      // Not a JWT or missing claim — non-fatal
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Success!</h1><p>You can close this tab. Check your terminal for the tokens.</p>');

    console.log('\n--- Tokens obtained successfully ---\n');
    console.log('Set these as wrangler secrets:\n');
    console.log(`  OPENAI_CODEX_ACCESS_TOKEN:  ${tokens.access_token?.slice(0, 20)}...`);
    console.log(`  OPENAI_CODEX_REFRESH_TOKEN: ${tokens.refresh_token?.slice(0, 20)}...`);
    if (accountId) {
      console.log(`  OPENAI_CODEX_ACCOUNT_ID:    ${accountId}`);
    }
    console.log('\nFull values (paste when prompted by wrangler secret put):\n');
    console.log(`OPENAI_CODEX_ACCESS_TOKEN=${tokens.access_token}`);
    console.log(`OPENAI_CODEX_REFRESH_TOKEN=${tokens.refresh_token}`);
    if (accountId) {
      console.log(`OPENAI_CODEX_ACCOUNT_ID=${accountId}`);
    }
    console.log('');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Error: ${err.message}`);
    console.error(`\nToken exchange error: ${err.message}`);
  } finally {
    server.close();
  }
});

server.listen(REDIRECT_PORT, '127.0.0.1', () => {
  console.log(`Listening on http://localhost:${REDIRECT_PORT}/auth/callback for OAuth callback...\n`);
});
