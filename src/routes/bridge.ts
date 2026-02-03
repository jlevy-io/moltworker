import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { MOLTBOT_PORT } from '../config';
import { ensureMoltbotGateway } from '../gateway';

/**
 * MCP Bridge route — WebSocket proxy + file endpoints
 *
 * Provides a shared-secret-authenticated bridge so an external MCP server
 * can reach the gateway running in the sandbox container. Follows the
 * same auth pattern as the CDP route (query-param secret, mounted before
 * CF Access).
 *
 * Endpoints:
 * - GET  /bridge           WebSocket upgrade → bidirectional relay to gateway
 * - GET  /bridge/health    Gateway process status
 * - GET  /bridge/file      Read a file from the container
 * - PUT  /bridge/file      Write a file in the container
 */
const bridge = new Hono<AppEnv>();

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Wait for a sandbox process to finish (polls status, same pattern as debug routes).
 */
async function waitForProcess(proc: { status: string }, maxAttempts = 20): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    if (proc.status !== 'running') return;
    await new Promise(r => setTimeout(r, 250));
  }
}

/**
 * Auth middleware — validates `?secret=` against BRIDGE_SECRET.
 */
bridge.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  const providedSecret = url.searchParams.get('secret');
  const expectedSecret = c.env.BRIDGE_SECRET;

  if (!expectedSecret) {
    return c.json({
      error: 'Bridge endpoint not configured',
      hint: 'Set BRIDGE_SECRET via: wrangler secret put BRIDGE_SECRET',
    }, 503);
  }

  if (!providedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return next();
});

// ---------------------------------------------------------------------------
// GET /bridge — WebSocket upgrade → gateway relay
// ---------------------------------------------------------------------------
bridge.get('/', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    return c.json({
      error: 'WebSocket upgrade required',
      hint: 'Connect via WebSocket: ws://host/bridge?secret=<BRIDGE_SECRET>',
    }, 426);
  }

  const sandbox = c.get('sandbox');

  // Build a clean request for the gateway inside the container.
  // The original request URL is /bridge?secret=..., but the gateway expects
  // connections at / with ?token=GATEWAY_TOKEN for authentication. We rewrite
  // the URL so the gateway sees the same auth pattern as the webchat, while
  // ensuring WebSocket upgrade headers (including Connection) are present.
  const gatewayUrl = new URL(c.req.url);
  gatewayUrl.pathname = '/';
  gatewayUrl.searchParams.delete('secret');
  const gatewayToken = c.env.MOLTBOT_GATEWAY_TOKEN;
  if (gatewayToken) {
    gatewayUrl.searchParams.set('token', gatewayToken);
  }

  const headers = new Headers(c.req.raw.headers);
  if (!headers.get('Connection')?.toLowerCase().includes('upgrade')) {
    headers.set('Connection', 'Upgrade');
  }
  const request = new Request(gatewayUrl.toString(), { headers });

  console.log('[BRIDGE] WebSocket upgrade request, rewritten to', gatewayUrl.pathname + gatewayUrl.search.replace(/token=[^&]+/, 'token=***'));

  // Ensure gateway is running before connecting (waits for container boot)
  try {
    await ensureMoltbotGateway(sandbox, c.env);
  } catch (error) {
    console.error('[BRIDGE] Failed to start gateway:', error);
    return c.json({ error: 'Gateway not ready', details: String(error) }, 502);
  }

  // Connect to gateway inside the container
  let containerResponse: Response;
  try {
    containerResponse = await sandbox.wsConnect(request, MOLTBOT_PORT);
  } catch (err) {
    console.error('[BRIDGE] wsConnect threw:', err);
    return c.json({ error: 'wsConnect failed', details: String(err) }, 502);
  }
  console.log('[BRIDGE] wsConnect returned, status:', containerResponse.status, 'hasWebSocket:', !!containerResponse.webSocket);

  const containerWs = containerResponse.webSocket;
  if (!containerWs) {
    const body = await containerResponse.text().catch(() => '(unreadable)');
    console.error('[BRIDGE] No WebSocket in container response, status:', containerResponse.status, 'body:', body);
    return c.json({ error: 'Gateway WebSocket unavailable', status: containerResponse.status, body }, 502);
  }

  // Create WebSocket pair for the client
  const [clientWs, serverWs] = Object.values(new WebSocketPair());
  serverWs.accept();
  containerWs.accept();
  console.log('[BRIDGE] Relay established');

  // Bidirectional relay (no message transformation)
  serverWs.addEventListener('message', (event) => {
    if (containerWs.readyState === WebSocket.OPEN) {
      containerWs.send(event.data);
    }
  });
  containerWs.addEventListener('message', (event) => {
    if (serverWs.readyState === WebSocket.OPEN) {
      serverWs.send(event.data);
    }
  });

  serverWs.addEventListener('close', (event) => {
    console.log('[BRIDGE] Client closed:', event.code);
    containerWs.close(event.code, event.reason);
  });
  containerWs.addEventListener('close', (event) => {
    console.log('[BRIDGE] Container closed:', event.code);
    let reason = event.reason || '';
    if (reason.length > 123) reason = reason.slice(0, 120) + '...';
    serverWs.close(event.code, reason);
  });

  serverWs.addEventListener('error', () => containerWs.close(1011, 'Client error'));
  containerWs.addEventListener('error', () => serverWs.close(1011, 'Container error'));

  return new Response(null, { status: 101, webSocket: clientWs });
});

// ---------------------------------------------------------------------------
// GET /bridge/health — gateway process status
// ---------------------------------------------------------------------------
bridge.get('/health', async (c) => {
  const sandbox = c.get('sandbox');
  const processes = await sandbox.listProcesses();

  // Find gateway process (same heuristic as findExistingMoltbotProcess)
  const gateway = processes.find(
    (p: { command: string; status: string }) =>
      p.command.includes('start-moltbot') && p.status === 'running',
  );

  return c.json({
    gateway: gateway
      ? { status: 'running', pid: (gateway as { pid?: number }).pid }
      : { status: 'not_running' },
    processes: processes.length,
  });
});

// ---------------------------------------------------------------------------
// GET /bridge/file?path=... — read a file from the container
// ---------------------------------------------------------------------------
bridge.get('/file', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) {
    return c.json({ error: 'Missing ?path= query parameter' }, 400);
  }

  const sandbox = c.get('sandbox');
  try {
    const proc = await sandbox.startProcess(`cat '${filePath}'`);
    await waitForProcess(proc);
    const logs = await proc.getLogs();

    // exitCode is null while running; treat null and 0 as success
    if (proc.exitCode != null && proc.exitCode !== 0) {
      return c.json({
        error: 'File read failed',
        stderr: logs.stderr,
        exitCode: proc.exitCode,
      }, 404);
    }

    return c.text(logs.stdout);
  } catch (err) {
    return c.json({ error: 'Failed to read file', details: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// PUT /bridge/file?path=... — write a file in the container
// ---------------------------------------------------------------------------
bridge.put('/file', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) {
    return c.json({ error: 'Missing ?path= query parameter' }, 400);
  }

  const sandbox = c.get('sandbox');
  try {
    // Read body as text, base64-encode to safely pipe through shell.
    // Use Buffer instead of btoa() to handle Unicode characters (em dashes, etc.).
    const content = await c.req.text();
    const encoded = Buffer.from(content, 'utf-8').toString('base64');

    // Ensure parent directory exists, then decode and write
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    const cmd = `mkdir -p '${dir}' && echo '${encoded}' | base64 -d > '${filePath}'`;
    const proc = await sandbox.startProcess(cmd);
    await waitForProcess(proc);
    const logs = await proc.getLogs();

    if (proc.exitCode != null && proc.exitCode !== 0) {
      return c.json({
        error: 'File write failed',
        stderr: logs.stderr,
        exitCode: proc.exitCode,
      }, 500);
    }

    return c.json({ ok: true, path: filePath });
  } catch (err) {
    return c.json({ error: 'Failed to write file', details: String(err) }, 500);
  }
});

export { bridge };
