import type { Sandbox } from '@cloudflare/sandbox';
import type { MoltbotEnv } from '../types';
import { R2_MOUNT_PATH, MIN_BOOT_AGE_SECONDS, SYNC_TIMEOUT_MS } from '../config';
import { mountR2Storage } from './r2';
import { waitForProcess, waitForOutput } from './utils';

export interface SyncOptions {
  /** Bypass container-age and meaningful-state checks (used by admin manual sync).
   *  The restore-complete check is NEVER bypassed. */
  force?: boolean;
}

export interface SyncResult {
  success: boolean;
  lastSync?: string;
  error?: string;
  details?: string;
}

/**
 * Sync openclaw config from container to R2 for persistence.
 *
 * This function:
 * 1. Mounts R2 if not already mounted
 * 2. Runs a 3-check safety gate to prevent overwriting good backup data:
 *    a. Restore-complete marker must exist (always enforced)
 *    b. Container must be older than MIN_BOOT_AGE_SECONDS (skippable with force)
 *    c. Container must have meaningful state beyond template config (skippable with force)
 * 3. Creates tar archives locally and copies them to R2 (2 file writes instead of many)
 * 4. Uses SYNC_OK/SYNC_FAIL sentinels for reliable completion detection
 *
 * @param sandbox - The sandbox instance
 * @param env - Worker environment bindings
 * @param options - Sync options (force bypasses some safety checks)
 * @returns SyncResult with success status and optional error details
 */
export async function syncToR2(
  sandbox: Sandbox,
  env: MoltbotEnv,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const { force = false } = options;

  // Check if R2 is configured
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.CF_ACCOUNT_ID) {
    return { success: false, error: 'R2 storage is not configured' };
  }

  // Mount R2 if not already mounted
  const mounted = await mountR2Storage(sandbox, env);
  if (!mounted) {
    return { success: false, error: 'Failed to mount R2 storage' };
  }

  // ── Safety Gate ──────────────────────────────────────────────

  // Check 1: Restore-complete marker (NEVER bypassed, even with force)
  try {
    const restoreProc = await sandbox.startProcess(
      'test -f /root/.openclaw/.restore-complete && echo "ok"',
    );
    await waitForProcess(restoreProc, 5000);
    const restoreLogs = await restoreProc.getLogs();
    if (!restoreLogs.stdout?.includes('ok')) {
      return {
        success: false,
        error: 'Sync aborted: restore not complete',
        details:
          'The .restore-complete marker is missing. The container may still be booting or is using an old startup script.',
      };
    }
  } catch (err) {
    return {
      success: false,
      error: 'Failed to check restore-complete marker',
      details: err instanceof Error ? err.message : 'Unknown error',
    };
  }

  // Check 2: Container age (bypassed with force)
  if (!force) {
    try {
      const ageProc = await sandbox.startProcess(
        'cat /root/.openclaw/.boot-timestamp 2>/dev/null',
      );
      await waitForProcess(ageProc, 5000);
      const ageLogs = await ageProc.getLogs();
      const bootEpoch = parseInt(ageLogs.stdout?.trim() || '', 10);
      if (isNaN(bootEpoch)) {
        return {
          success: false,
          error: 'Sync aborted: no boot timestamp',
          details:
            'The .boot-timestamp marker is missing. The container may be using an old startup script.',
        };
      }
      const nowEpoch = Math.floor(Date.now() / 1000);
      const age = nowEpoch - bootEpoch;
      if (age < MIN_BOOT_AGE_SECONDS) {
        return {
          success: false,
          error: 'Sync aborted: container too young',
          details: `Container is ${age}s old, minimum is ${MIN_BOOT_AGE_SECONDS}s. This prevents a fresh container from overwriting backup data.`,
        };
      }
    } catch (err) {
      return {
        success: false,
        error: 'Failed to check container age',
        details: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  // Check 3: Meaningful state (bypassed with force)
  if (!force) {
    try {
      const stateProc = await sandbox.startProcess(
        'grep -c "lastTouchedAt" /root/.openclaw/openclaw.json 2>/dev/null; echo "---"; ls -1 /root/.openclaw/ 2>/dev/null | wc -l',
      );
      await waitForProcess(stateProc, 5000);
      const stateLogs = await stateProc.getLogs();
      const parts = (stateLogs.stdout || '').split('---');
      const hasTouched = parseInt(parts[0]?.trim() || '0', 10) > 0;
      const fileCount = parseInt(parts[1]?.trim() || '0', 10);
      if (!hasTouched && fileCount <= 3) {
        return {
          success: false,
          error: 'Sync aborted: no meaningful state',
          details: `Container has ${fileCount} file(s) and no lastTouchedAt metadata. This looks like a fresh template — refusing to overwrite R2 backup.`,
        };
      }
    } catch (err) {
      return {
        success: false,
        error: 'Failed to check container state',
        details: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  // ── Sync ─────────────────────────────────────────────────────

  // Delete .last-sync BEFORE sync to prevent stale-timestamp false positives
  try {
    const rmProc = await sandbox.startProcess(`rm -f ${R2_MOUNT_PATH}/.last-sync`);
    await waitForProcess(rmProc, 5000);
  } catch {
    // Non-fatal — continue with sync
  }

  const syncCmd = [
    `tar czf /tmp/openclaw-backup.tar.gz`,
    `--exclude='*.lock' --exclude='*.log' --exclude='*.tmp'`,
    `--exclude='.boot-timestamp' --exclude='.restore-complete'`,
    `-C /root .openclaw`,
    `&& tar czf /tmp/skills-backup.tar.gz -C /root/clawd skills`,
    `&& cp /tmp/openclaw-backup.tar.gz ${R2_MOUNT_PATH}/openclaw-backup.tar.gz`,
    `&& cp /tmp/skills-backup.tar.gz ${R2_MOUNT_PATH}/skills-backup.tar.gz`,
    `&& ([ -d /root/.config/gogcli ] && tar czf /tmp/gogcli-backup.tar.gz -C /root/.config gogcli && cp /tmp/gogcli-backup.tar.gz ${R2_MOUNT_PATH}/gogcli-backup.tar.gz || true)`,
    `&& ([ -f /root/.ms-graph-tokens.json ] && cp /root/.ms-graph-tokens.json ${R2_MOUNT_PATH}/ms-graph-tokens.json || true)`,
    `&& date -Iseconds > ${R2_MOUNT_PATH}/.last-sync`,
    `&& echo SYNC_OK`,
    `|| echo SYNC_FAIL`,
  ].join(' ');

  try {
    const proc = await sandbox.startProcess(syncCmd);
    const result = await waitForOutput(proc, ['SYNC_OK', 'SYNC_FAIL'], SYNC_TIMEOUT_MS);

    if (result.found && result.stdout.includes('SYNC_OK')) {
      // Read the timestamp written by the sync command
      const timestampProc = await sandbox.startProcess(`cat ${R2_MOUNT_PATH}/.last-sync`);
      await waitForProcess(timestampProc, 5000);
      const timestampLogs = await timestampProc.getLogs();
      const lastSync = timestampLogs.stdout?.trim();

      if (lastSync && lastSync.match(/^\d{4}-\d{2}-\d{2}/)) {
        return { success: true, lastSync };
      }
      return { success: true };
    }

    // SYNC_FAIL or timeout
    const errDetail = result.stdout.includes('SYNC_FAIL')
      ? 'Sync command failed'
      : 'Sync timed out';
    return {
      success: false,
      error: 'Sync failed',
      details: `${errDetail}: ${result.stderr || result.stdout}`.slice(0, 500),
    };
  } catch (err) {
    return {
      success: false,
      error: 'Sync error',
      details: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
