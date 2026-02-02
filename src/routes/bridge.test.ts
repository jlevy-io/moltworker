import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import type { MoltbotEnv } from '../types';
import { createMockEnv, createMockSandbox, createMockProcess, suppressConsole } from '../test-utils';
import { bridge } from './bridge';

// Build a test app that injects env bindings and sandbox variable
function buildApp(envOverrides: Partial<MoltbotEnv> = { BRIDGE_SECRET: 'test-secret' }) {
  const env = createMockEnv(envOverrides);
  const { sandbox, startProcessMock, listProcessesMock } = createMockSandbox();

  const app = new Hono<AppEnv>();
  // Inject sandbox as a Hono variable before bridge routes run
  app.use('*', async (c, next) => {
    c.set('sandbox', sandbox);
    await next();
  });
  app.route('/bridge', bridge);

  // Helper: make a request with the correct env bindings
  const request = (path: string, init?: RequestInit) =>
    app.request(path, init, env);

  return { app, request, sandbox, startProcessMock, listProcessesMock };
}

describe('bridge route', () => {
  beforeEach(() => {
    suppressConsole();
  });

  // ---------- auth ----------
  describe('auth', () => {
    it('rejects requests without a secret', async () => {
      const { request } = buildApp();
      const res = await request('/bridge/health');
      expect(res.status).toBe(401);
    });

    it('rejects requests with the wrong secret', async () => {
      const { request } = buildApp();
      const res = await request('/bridge/health?secret=wrong');
      expect(res.status).toBe(401);
    });

    it('returns 503 when BRIDGE_SECRET is not configured', async () => {
      const { request } = buildApp({});
      const res = await request('/bridge/health?secret=anything');
      expect(res.status).toBe(503);
      const body = await res.json() as any;
      expect(body.error).toMatch(/not configured/);
    });

    it('allows requests with the correct secret', async () => {
      const { request } = buildApp();
      const res = await request('/bridge/health?secret=test-secret');
      expect(res.status).toBe(200);
    });
  });

  // ---------- health ----------
  describe('GET /bridge/health', () => {
    it('reports gateway running when start-moltbot process found', async () => {
      const { request, listProcessesMock } = buildApp();
      listProcessesMock.mockResolvedValueOnce([
        { command: '/bin/sh start-moltbot.sh', status: 'running', pid: 42 },
      ]);

      const res = await request('/bridge/health?secret=test-secret');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.gateway.status).toBe('running');
      expect(body.gateway.pid).toBe(42);
    });

    it('reports not_running when no gateway process', async () => {
      const { request, listProcessesMock } = buildApp();
      listProcessesMock.mockResolvedValueOnce([]);

      const res = await request('/bridge/health?secret=test-secret');
      const body = await res.json() as any;
      expect(body.gateway.status).toBe('not_running');
    });
  });

  // ---------- file read ----------
  describe('GET /bridge/file', () => {
    it('returns 400 when path is missing', async () => {
      const { request } = buildApp();
      const res = await request('/bridge/file?secret=test-secret');
      expect(res.status).toBe(400);
    });

    it('returns file content on success', async () => {
      const { request, startProcessMock } = buildApp();
      startProcessMock.mockResolvedValueOnce(createMockProcess('hello world'));

      const res = await request('/bridge/file?secret=test-secret&path=/tmp/test.txt');
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('hello world');
    });

    it('returns 404 when file does not exist', async () => {
      const { request, startProcessMock } = buildApp();
      startProcessMock.mockResolvedValueOnce(
        createMockProcess('', { exitCode: 1, stderr: 'No such file' }),
      );

      const res = await request('/bridge/file?secret=test-secret&path=/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  // ---------- file write ----------
  describe('PUT /bridge/file', () => {
    it('returns 400 when path is missing', async () => {
      const { request } = buildApp();
      const res = await request('/bridge/file?secret=test-secret', {
        method: 'PUT',
        body: 'content',
      });
      expect(res.status).toBe(400);
    });

    it('writes file and returns ok', async () => {
      const { request, startProcessMock } = buildApp();
      startProcessMock.mockResolvedValueOnce(createMockProcess(''));

      const res = await request('/bridge/file?secret=test-secret&path=/tmp/out.txt', {
        method: 'PUT',
        body: 'new content',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);
      expect(body.path).toBe('/tmp/out.txt');
    });

    it('handles Unicode content (em dashes, emoji, etc.)', async () => {
      const { request, startProcessMock } = buildApp();
      startProcessMock.mockResolvedValueOnce(createMockProcess(''));

      const res = await request('/bridge/file?secret=test-secret&path=/tmp/unicode.md', {
        method: 'PUT',
        body: 'Hello \u2014 world \u2019s test',
      });
      expect(res.status).toBe(200);
      // Verify the shell command uses valid base64 (would have thrown with btoa)
      const cmd = startProcessMock.mock.calls[0][0] as string;
      expect(cmd).toContain('base64 -d');
    });

    it('returns 500 when write fails', async () => {
      const { request, startProcessMock } = buildApp();
      startProcessMock.mockResolvedValueOnce(
        createMockProcess('', { exitCode: 1, stderr: 'Permission denied' }),
      );

      const res = await request('/bridge/file?secret=test-secret&path=/root/fail.txt', {
        method: 'PUT',
        body: 'content',
      });
      expect(res.status).toBe(500);
    });
  });

  // ---------- WebSocket (non-upgrade) ----------
  describe('GET /bridge (non-WebSocket)', () => {
    it('returns 426 when Upgrade header is missing', async () => {
      const { request } = buildApp();
      const res = await request('/bridge?secret=test-secret');
      expect(res.status).toBe(426);
      const body = await res.json() as any;
      expect(body.error).toMatch(/WebSocket/);
    });
  });
});
