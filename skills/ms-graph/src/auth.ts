/**
 * Microsoft Graph authentication via MSAL device code flow.
 *
 * Handles token acquisition, caching, and silent refresh for personal
 * Microsoft accounts (Hotmail/Outlook.com).
 */

import * as msal from "@azure/msal-node";
import * as fs from "fs";
import * as path from "path";

const TOKEN_CACHE_PATH = path.join(
  process.env.HOME || "/root",
  ".ms-graph-tokens.json"
);

// Personal Microsoft accounts use the "consumers" endpoint
const AUTHORITY = "https://login.microsoftonline.com/consumers";

// Scopes needed for mail operations + offline_access for refresh tokens
const SCOPES = [
  "Mail.Read",
  "Mail.ReadWrite",
  "Mail.Send",
  "User.Read",
  "offline_access",
];

let pcaInstance: msal.PublicClientApplication | null = null;

/**
 * Get or create the MSAL PublicClientApplication instance.
 * Loads cached tokens from disk if available.
 */
function getApp(): msal.PublicClientApplication {
  if (pcaInstance) return pcaInstance;

  const clientId = process.env.MS_GRAPH_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "MS_GRAPH_CLIENT_ID not set. Register an Azure app and set the wrangler secret."
    );
  }

  const pca = new msal.PublicClientApplication({
    auth: {
      clientId,
      authority: AUTHORITY,
    },
  });

  // Restore cached tokens from disk
  if (fs.existsSync(TOKEN_CACHE_PATH)) {
    try {
      const cacheData = fs.readFileSync(TOKEN_CACHE_PATH, "utf8");
      pca.getTokenCache().deserialize(cacheData);
    } catch (err) {
      console.error("[ms-graph] Failed to load token cache:", err);
    }
  }

  pcaInstance = pca;
  return pca;
}

/** Persist the token cache to disk after any token operation. */
function saveCache(pca: msal.PublicClientApplication): void {
  try {
    const data = pca.getTokenCache().serialize();
    fs.writeFileSync(TOKEN_CACHE_PATH, data, { mode: 0o600 });
  } catch (err) {
    console.error("[ms-graph] Failed to save token cache:", err);
  }
}

export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  message: string;
}

/**
 * Start the device code flow. Returns the user code and verification URL
 * that the user must visit to authenticate.
 *
 * The returned promise resolves once the user completes authentication
 * (or rejects on timeout/cancellation).
 */
export async function startDeviceCodeAuth(): Promise<{
  deviceCodeInfo: DeviceCodeInfo;
  authPromise: Promise<msal.AuthenticationResult | null>;
}> {
  const pca = getApp();

  let resolveDeviceCode: (info: DeviceCodeInfo) => void;
  const deviceCodePromise = new Promise<DeviceCodeInfo>((resolve) => {
    resolveDeviceCode = resolve;
  });

  const authPromise = pca.acquireTokenByDeviceCode({
    scopes: SCOPES,
    deviceCodeCallback: (response) => {
      resolveDeviceCode({
        userCode: response.userCode,
        verificationUri: response.verificationUri,
        message: response.message,
      });
    },
  });

  // Wait for the device code to be generated (happens almost immediately)
  const deviceCodeInfo = await deviceCodePromise;

  // Wrap authPromise to save cache on success
  const wrappedAuthPromise = authPromise.then((result) => {
    saveCache(pca);
    return result;
  });

  return { deviceCodeInfo, authPromise: wrappedAuthPromise };
}

/**
 * Try to get an access token silently using cached refresh tokens.
 * Returns null if no cached account exists or refresh fails.
 */
export async function getAccessTokenSilent(): Promise<string | null> {
  const pca = getApp();
  const accounts = await pca.getTokenCache().getAllAccounts();

  if (accounts.length === 0) {
    return null;
  }

  try {
    const result = await pca.acquireTokenSilent({
      account: accounts[0],
      scopes: SCOPES,
    });
    saveCache(pca);
    return result?.accessToken ?? null;
  } catch (err) {
    // Silent acquisition failed — refresh token may be expired
    console.error("[ms-graph] Silent token acquisition failed:", err);
    return null;
  }
}

/**
 * Get a valid access token, using cached credentials when possible.
 * Throws if no cached tokens exist (user must run device code flow first).
 */
export async function getAccessToken(): Promise<string> {
  const token = await getAccessTokenSilent();
  if (token) return token;

  throw new Error(
    "No cached Microsoft Graph tokens. Run ms-auth-start first to authenticate."
  );
}

/** Check whether we have a cached account (tokens may still be expired). */
export async function hasAccount(): Promise<boolean> {
  const pca = getApp();
  const accounts = await pca.getTokenCache().getAllAccounts();
  return accounts.length > 0;
}

/** Get info about the cached account, if any. */
export async function getAccountInfo(): Promise<msal.AccountInfo | null> {
  const pca = getApp();
  const accounts = await pca.getTokenCache().getAllAccounts();
  return accounts[0] ?? null;
}

/** Clear all cached tokens and force re-authentication. */
export async function clearTokens(): Promise<void> {
  const pca = getApp();
  const accounts = await pca.getTokenCache().getAllAccounts();
  for (const account of accounts) {
    await pca.getTokenCache().removeAccount(account);
  }
  saveCache(pca);
  if (fs.existsSync(TOKEN_CACHE_PATH)) {
    fs.unlinkSync(TOKEN_CACHE_PATH);
  }
}
