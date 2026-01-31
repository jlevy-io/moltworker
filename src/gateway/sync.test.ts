import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncToR2 } from './sync';
import {
  createMockEnv,
  createMockEnvWithR2,
  createMockProcess,
  createMockSandbox,
  suppressConsole
} from '../test-utils';

// Helper: mock sequence for a healthy container that passes all safety checks.
// Call order: mount-check, restore-complete, boot-timestamp, state-check
function healthyCheckMocks() {
  return [
    createMockProcess('s3fs on /data/moltbot type fuse.s3fs\n'), // mount check
    createMockProcess('ok'),                                      // restore-complete
    createMockProcess(String(Math.floor(Date.now() / 1000) - 700)), // boot-timestamp (700s ago)
    createMockProcess('1\n---\n8'),                               // state: 1 lastTouchedAt, 8 files
  ];
}

describe('syncToR2', () => {
  beforeEach(() => {
    suppressConsole();
    vi.spyOn(Date, 'now').mockReturnValue(1738300000000); // fixed "now"
  });

  describe('configuration checks', () => {
    it('returns error when R2 is not configured', async () => {
      const { sandbox } = createMockSandbox();
      const env = createMockEnv();

      const result = await syncToR2(sandbox, env);

      expect(result.success).toBe(false);
      expect(result.error).toBe('R2 storage is not configured');
    });

    it('returns error when mount fails', async () => {
      const { sandbox, startProcessMock, mountBucketMock } = createMockSandbox();
      startProcessMock.mockResolvedValue(createMockProcess(''));
      mountBucketMock.mockRejectedValue(new Error('Mount failed'));

      const env = createMockEnvWithR2();

      const result = await syncToR2(sandbox, env);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to mount R2 storage');
    });
  });

  describe('safety gate: restore-complete check', () => {
    it('aborts when restore-complete marker is missing', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      startProcessMock
        .mockResolvedValueOnce(createMockProcess('s3fs on /data/moltbot type fuse.s3fs\n'))
        .mockResolvedValueOnce(createMockProcess(''));  // no "ok" — marker missing

      const env = createMockEnvWithR2();
      const result = await syncToR2(sandbox, env);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sync aborted: restore not complete');
      expect(result.details).toContain('.restore-complete marker is missing');
    });

    it('force does NOT bypass restore-complete check', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      startProcessMock
        .mockResolvedValueOnce(createMockProcess('s3fs on /data/moltbot type fuse.s3fs\n'))
        .mockResolvedValueOnce(createMockProcess(''));  // marker missing

      const env = createMockEnvWithR2();
      const result = await syncToR2(sandbox, env, { force: true });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sync aborted: restore not complete');
    });
  });

  describe('safety gate: container age check', () => {
    it('aborts when boot timestamp marker is missing', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      startProcessMock
        .mockResolvedValueOnce(createMockProcess('s3fs on /data/moltbot type fuse.s3fs\n'))
        .mockResolvedValueOnce(createMockProcess('ok'))  // restore-complete
        .mockResolvedValueOnce(createMockProcess(''));    // no boot-timestamp

      const env = createMockEnvWithR2();
      const result = await syncToR2(sandbox, env);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sync aborted: no boot timestamp');
    });

    it('aborts when container is too young (< 600s)', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      const recentBoot = String(Math.floor(1738300000000 / 1000) - 60); // 60s ago
      startProcessMock
        .mockResolvedValueOnce(createMockProcess('s3fs on /data/moltbot type fuse.s3fs\n'))
        .mockResolvedValueOnce(createMockProcess('ok'))
        .mockResolvedValueOnce(createMockProcess(recentBoot));

      const env = createMockEnvWithR2();
      const result = await syncToR2(sandbox, env);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sync aborted: container too young');
      expect(result.details).toContain('60s old');
      expect(result.details).toContain('minimum is 600s');
    });

    it('force bypasses container age check', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      const timestamp = '2026-01-31T12:00:00+00:00';

      startProcessMock
        .mockResolvedValueOnce(createMockProcess('s3fs on /data/moltbot type fuse.s3fs\n'))
        .mockResolvedValueOnce(createMockProcess('ok'))  // restore-complete
        // No age check — force skips it
        .mockResolvedValueOnce(createMockProcess(''))     // rsync
        .mockResolvedValueOnce(createMockProcess(timestamp));

      const env = createMockEnvWithR2();
      const result = await syncToR2(sandbox, env, { force: true });

      expect(result.success).toBe(true);
      expect(result.lastSync).toBe(timestamp);
    });
  });

  describe('safety gate: meaningful state check', () => {
    it('aborts when container has no meaningful state (template only)', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      const oldBoot = String(Math.floor(1738300000000 / 1000) - 700); // 700s ago
      startProcessMock
        .mockResolvedValueOnce(createMockProcess('s3fs on /data/moltbot type fuse.s3fs\n'))
        .mockResolvedValueOnce(createMockProcess('ok'))
        .mockResolvedValueOnce(createMockProcess(oldBoot))
        .mockResolvedValueOnce(createMockProcess('0\n---\n2')); // 0 lastTouchedAt, 2 files

      const env = createMockEnvWithR2();
      const result = await syncToR2(sandbox, env);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sync aborted: no meaningful state');
      expect(result.details).toContain('2 file(s)');
      expect(result.details).toContain('no lastTouchedAt');
    });

    it('passes when container has many files even without lastTouchedAt', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      const oldBoot = String(Math.floor(1738300000000 / 1000) - 700);
      const timestamp = '2026-01-31T12:00:00+00:00';

      startProcessMock
        .mockResolvedValueOnce(createMockProcess('s3fs on /data/moltbot type fuse.s3fs\n'))
        .mockResolvedValueOnce(createMockProcess('ok'))
        .mockResolvedValueOnce(createMockProcess(oldBoot))
        .mockResolvedValueOnce(createMockProcess('0\n---\n10')) // 0 lastTouchedAt but 10 files
        .mockResolvedValueOnce(createMockProcess(''))            // rsync
        .mockResolvedValueOnce(createMockProcess(timestamp));

      const env = createMockEnvWithR2();
      const result = await syncToR2(sandbox, env);

      expect(result.success).toBe(true);
    });

    it('force bypasses meaningful state check', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      const timestamp = '2026-01-31T12:00:00+00:00';

      startProcessMock
        .mockResolvedValueOnce(createMockProcess('s3fs on /data/moltbot type fuse.s3fs\n'))
        .mockResolvedValueOnce(createMockProcess('ok'))  // restore-complete
        // No age or state check — force skips both
        .mockResolvedValueOnce(createMockProcess(''))     // rsync
        .mockResolvedValueOnce(createMockProcess(timestamp));

      const env = createMockEnvWithR2();
      const result = await syncToR2(sandbox, env, { force: true });

      expect(result.success).toBe(true);
      expect(result.lastSync).toBe(timestamp);
    });
  });

  describe('sync execution', () => {
    it('returns success when sync completes with healthy container', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      const timestamp = '2026-01-31T12:00:00+00:00';

      // Calls: mount check, restore-complete, boot-timestamp, state-check, rsync, cat timestamp
      const mocks = healthyCheckMocks();
      startProcessMock
        .mockResolvedValueOnce(mocks[0])
        .mockResolvedValueOnce(mocks[1])
        .mockResolvedValueOnce(mocks[2])
        .mockResolvedValueOnce(mocks[3])
        .mockResolvedValueOnce(createMockProcess(''))     // rsync
        .mockResolvedValueOnce(createMockProcess(timestamp));

      const env = createMockEnvWithR2();
      const result = await syncToR2(sandbox, env);

      expect(result.success).toBe(true);
      expect(result.lastSync).toBe(timestamp);
    });

    it('returns error when rsync fails (no timestamp created)', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();

      const mocks = healthyCheckMocks();
      startProcessMock
        .mockResolvedValueOnce(mocks[0])
        .mockResolvedValueOnce(mocks[1])
        .mockResolvedValueOnce(mocks[2])
        .mockResolvedValueOnce(mocks[3])
        .mockResolvedValueOnce(createMockProcess('', { exitCode: 1 })) // rsync fails
        .mockResolvedValueOnce(createMockProcess(''));                   // empty timestamp

      const env = createMockEnvWithR2();
      const result = await syncToR2(sandbox, env);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sync failed');
    });

    it('verifies rsync command does NOT contain --delete', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      const timestamp = '2026-01-31T12:00:00+00:00';

      const mocks = healthyCheckMocks();
      startProcessMock
        .mockResolvedValueOnce(mocks[0])
        .mockResolvedValueOnce(mocks[1])
        .mockResolvedValueOnce(mocks[2])
        .mockResolvedValueOnce(mocks[3])
        .mockResolvedValueOnce(createMockProcess(''))
        .mockResolvedValueOnce(createMockProcess(timestamp));

      const env = createMockEnvWithR2();
      await syncToR2(sandbox, env);

      // 5th call (index 4) should be rsync
      const rsyncCall = startProcessMock.mock.calls[4][0];
      expect(rsyncCall).toContain('rsync');
      expect(rsyncCall).toContain('--no-times');
      expect(rsyncCall).not.toContain('--delete');
      expect(rsyncCall).toContain('/root/.clawdbot/');
      expect(rsyncCall).toContain('/data/moltbot/');
    });

    it('excludes marker files from rsync', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      const timestamp = '2026-01-31T12:00:00+00:00';

      const mocks = healthyCheckMocks();
      startProcessMock
        .mockResolvedValueOnce(mocks[0])
        .mockResolvedValueOnce(mocks[1])
        .mockResolvedValueOnce(mocks[2])
        .mockResolvedValueOnce(mocks[3])
        .mockResolvedValueOnce(createMockProcess(''))
        .mockResolvedValueOnce(createMockProcess(timestamp));

      const env = createMockEnvWithR2();
      await syncToR2(sandbox, env);

      const rsyncCall = startProcessMock.mock.calls[4][0];
      expect(rsyncCall).toContain(".boot-timestamp");
      expect(rsyncCall).toContain(".restore-complete");
    });
  });
});
