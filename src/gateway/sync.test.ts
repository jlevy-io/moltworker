import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncToR2, gitSync } from './sync';
import {
  createMockEnv,
  createMockEnvWithR2,
  createMockProcess,
  createMockSandbox,
  suppressConsole,
} from '../test-utils';

// Helper: mock sequence for a healthy container that passes all safety checks.
// Call order: mount-check, restore-complete, boot-timestamp, state-check
function healthyCheckMocks() {
  return [
    createMockProcess('s3fs on /data/moltbot type fuse.s3fs\n'), // mount check
    createMockProcess('ok'), // restore-complete
    createMockProcess(String(Math.floor(Date.now() / 1000) - 700)), // boot-timestamp (700s ago)
    createMockProcess('1\n---\n8'), // state: 1 lastTouchedAt, 8 files
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
        .mockResolvedValueOnce(createMockProcess('')); // no "ok" — marker missing

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
        .mockResolvedValueOnce(createMockProcess('')); // marker missing

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
        .mockResolvedValueOnce(createMockProcess('ok')) // restore-complete
        .mockResolvedValueOnce(createMockProcess('')); // no boot-timestamp

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
        .mockResolvedValueOnce(createMockProcess('ok')) // restore-complete
        // No age check — force skips it
        .mockResolvedValueOnce(createMockProcess('')) // rm .last-sync
        .mockResolvedValueOnce(createMockProcess('SYNC_OK')) // tar+cp
        .mockResolvedValueOnce(createMockProcess(timestamp)); // cat .last-sync

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
        .mockResolvedValueOnce(createMockProcess('')) // rm .last-sync
        .mockResolvedValueOnce(createMockProcess('SYNC_OK')) // tar+cp
        .mockResolvedValueOnce(createMockProcess(timestamp)); // cat .last-sync

      const env = createMockEnvWithR2();
      const result = await syncToR2(sandbox, env);

      expect(result.success).toBe(true);
    });

    it('force bypasses meaningful state check', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      const timestamp = '2026-01-31T12:00:00+00:00';

      startProcessMock
        .mockResolvedValueOnce(createMockProcess('s3fs on /data/moltbot type fuse.s3fs\n'))
        .mockResolvedValueOnce(createMockProcess('ok')) // restore-complete
        // No age or state check — force skips both
        .mockResolvedValueOnce(createMockProcess('')) // rm .last-sync
        .mockResolvedValueOnce(createMockProcess('SYNC_OK')) // tar+cp
        .mockResolvedValueOnce(createMockProcess(timestamp)); // cat .last-sync

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

      const mocks = healthyCheckMocks();
      startProcessMock
        .mockResolvedValueOnce(mocks[0])
        .mockResolvedValueOnce(mocks[1])
        .mockResolvedValueOnce(mocks[2])
        .mockResolvedValueOnce(mocks[3])
        .mockResolvedValueOnce(createMockProcess('')) // rm .last-sync
        .mockResolvedValueOnce(createMockProcess('SYNC_OK')) // tar+cp
        .mockResolvedValueOnce(createMockProcess(timestamp)); // cat .last-sync

      const env = createMockEnvWithR2();
      const result = await syncToR2(sandbox, env);

      expect(result.success).toBe(true);
      expect(result.lastSync).toBe(timestamp);
    });

    it('returns error when sync command prints SYNC_FAIL', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();

      const mocks = healthyCheckMocks();
      startProcessMock
        .mockResolvedValueOnce(mocks[0])
        .mockResolvedValueOnce(mocks[1])
        .mockResolvedValueOnce(mocks[2])
        .mockResolvedValueOnce(mocks[3])
        .mockResolvedValueOnce(createMockProcess('')) // rm .last-sync
        .mockResolvedValueOnce(createMockProcess('SYNC_FAIL')); // tar+cp failed

      const env = createMockEnvWithR2();
      const result = await syncToR2(sandbox, env);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sync failed');
      expect(result.details).toContain('Sync command failed');
    });

    it('deletes .last-sync before sync to prevent stale reads', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      const timestamp = '2026-01-31T12:00:00+00:00';

      const mocks = healthyCheckMocks();
      startProcessMock
        .mockResolvedValueOnce(mocks[0])
        .mockResolvedValueOnce(mocks[1])
        .mockResolvedValueOnce(mocks[2])
        .mockResolvedValueOnce(mocks[3])
        .mockResolvedValueOnce(createMockProcess('')) // rm .last-sync
        .mockResolvedValueOnce(createMockProcess('SYNC_OK'))
        .mockResolvedValueOnce(createMockProcess(timestamp));

      const env = createMockEnvWithR2();
      await syncToR2(sandbox, env);

      // 5th call (index 4) should be rm -f .last-sync
      const rmCall = startProcessMock.mock.calls[4][0];
      expect(rmCall).toContain('rm -f');
      expect(rmCall).toContain('.last-sync');
    });

    it('uses tar to create archives instead of rsync', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      const timestamp = '2026-01-31T12:00:00+00:00';

      const mocks = healthyCheckMocks();
      startProcessMock
        .mockResolvedValueOnce(mocks[0])
        .mockResolvedValueOnce(mocks[1])
        .mockResolvedValueOnce(mocks[2])
        .mockResolvedValueOnce(mocks[3])
        .mockResolvedValueOnce(createMockProcess('')) // rm .last-sync
        .mockResolvedValueOnce(createMockProcess('SYNC_OK'))
        .mockResolvedValueOnce(createMockProcess(timestamp));

      const env = createMockEnvWithR2();
      await syncToR2(sandbox, env);

      // 6th call (index 5) should be the tar+cp sync command
      const syncCall = startProcessMock.mock.calls[5][0];
      expect(syncCall).toContain('tar czf');
      expect(syncCall).toContain('openclaw-backup.tar.gz');
      expect(syncCall).toContain('skills-backup.tar.gz');
      expect(syncCall).not.toContain('rsync');
      expect(syncCall).toContain('/data/moltbot/');
    });

    it('excludes marker files from tar archives', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      const timestamp = '2026-01-31T12:00:00+00:00';

      const mocks = healthyCheckMocks();
      startProcessMock
        .mockResolvedValueOnce(mocks[0])
        .mockResolvedValueOnce(mocks[1])
        .mockResolvedValueOnce(mocks[2])
        .mockResolvedValueOnce(mocks[3])
        .mockResolvedValueOnce(createMockProcess('')) // rm .last-sync
        .mockResolvedValueOnce(createMockProcess('SYNC_OK'))
        .mockResolvedValueOnce(createMockProcess(timestamp));

      const env = createMockEnvWithR2();
      await syncToR2(sandbox, env);

      const syncCall = startProcessMock.mock.calls[5][0];
      expect(syncCall).toContain('.boot-timestamp');
      expect(syncCall).toContain('.restore-complete');
    });

    it('includes SYNC_OK sentinel in sync command', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      const timestamp = '2026-01-31T12:00:00+00:00';

      const mocks = healthyCheckMocks();
      startProcessMock
        .mockResolvedValueOnce(mocks[0])
        .mockResolvedValueOnce(mocks[1])
        .mockResolvedValueOnce(mocks[2])
        .mockResolvedValueOnce(mocks[3])
        .mockResolvedValueOnce(createMockProcess('')) // rm .last-sync
        .mockResolvedValueOnce(createMockProcess('SYNC_OK'))
        .mockResolvedValueOnce(createMockProcess(timestamp));

      const env = createMockEnvWithR2();
      await syncToR2(sandbox, env);

      const syncCall = startProcessMock.mock.calls[5][0];
      expect(syncCall).toContain('echo SYNC_OK');
      expect(syncCall).toContain('echo SYNC_FAIL');
    });
  });
});

describe('gitSync', () => {
  beforeEach(() => {
    suppressConsole();
  });

  it('returns early when GITHUB_PAT is not configured', async () => {
    const { sandbox } = createMockSandbox();
    const env = createMockEnv({ GITHUB_REPO: 'user/repo' });

    const result = await gitSync(sandbox, env);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Git backup is not configured');
  });

  it('returns early when GITHUB_REPO is not configured', async () => {
    const { sandbox } = createMockSandbox();
    const env = createMockEnv({ GITHUB_PAT: 'ghp_test123' });

    const result = await gitSync(sandbox, env);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Git backup is not configured');
  });

  it('runs git commands and returns success', async () => {
    const { sandbox, startProcessMock } = createMockSandbox();
    startProcessMock.mockResolvedValueOnce(
      createMockProcess('Everything up-to-date\n'),
    );

    const env = createMockEnv({
      GITHUB_PAT: 'ghp_test123',
      GITHUB_REPO: 'user/workspace',
    });
    const result = await gitSync(sandbox, env);

    expect(result.success).toBe(true);
    // Verify the command includes cd, git diff, and git push
    const cmd = startProcessMock.mock.calls[0][0];
    expect(cmd).toContain('cd /root/clawd');
    expect(cmd).toContain('git diff --quiet HEAD');
    expect(cmd).toContain('git add -A');
    expect(cmd).toContain('git push origin HEAD');
  });

  it('returns failure when git push reports fatal error', async () => {
    const { sandbox, startProcessMock } = createMockSandbox();
    startProcessMock.mockResolvedValueOnce(
      createMockProcess('', { stderr: 'fatal: remote origin not found' }),
    );

    const env = createMockEnv({
      GITHUB_PAT: 'ghp_test123',
      GITHUB_REPO: 'user/workspace',
    });
    const result = await gitSync(sandbox, env);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Git sync failed');
    expect(result.details).toContain('fatal:');
  });

  it('handles startProcess exception gracefully', async () => {
    const { sandbox, startProcessMock } = createMockSandbox();
    startProcessMock.mockRejectedValueOnce(new Error('Container not running'));

    const env = createMockEnv({
      GITHUB_PAT: 'ghp_test123',
      GITHUB_REPO: 'user/workspace',
    });
    const result = await gitSync(sandbox, env);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Git sync error');
    expect(result.details).toBe('Container not running');
  });
});
