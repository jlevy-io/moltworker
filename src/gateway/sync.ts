import type { Sandbox } from '@cloudflare/sandbox';
import type { MoltbotEnv } from '../types';
import { R2_MOUNT_PATH, MIN_BOOT_AGE_SECONDS } from '../config';
import { mountR2Storage } from './r2';
import { waitForProcess } from './utils';

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
 * Sync moltbot config from container to R2 for persistence.
 *
 * This function:
 * 1. Mounts R2 if not already mounted
 * 2. Runs a 3-check safety gate to prevent overwriting good backup data:
 *    a. Restore-complete marker must exist (always enforced)
 *    b. Container must be older than MIN_BOOT_AGE_SECONDS (skippable with force)
 *    c. Container must have meaningful state beyond template config (skippable with force)
 * 3. Runs rsync to copy config to R2 (without --delete to prevent data loss)
 * 4. Writes a timestamp file for tracking
 *
 * @param sandbox - The sandbox instance
 * @param env - Worker environment bindings
 * @param options - Sync options (force bypasses some safety checks)
 * @returns SyncResult with success status and optional error details
 */
export async function syncToR2(sandbox: Sandbox, env: MoltbotEnv, options: SyncOptions = {}): Promise<SyncResult> {
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
  // Three independent checks prevent a fresh/empty container from
  // overwriting a good R2 backup with empty or template-only data.

  // Check 1: Restore-complete marker (NEVER bypassed, even with force)
  // The startup script writes this after the full restore-or-init section.
  // If it's missing, the container is still booting or used an old startup script.
  try {
    const restoreProc = await sandbox.startProcess('test -f /root/.clawdbot/.restore-complete && echo "ok"');
    await waitForProcess(restoreProc, 5000);
    const restoreLogs = await restoreProc.getLogs();
    if (!restoreLogs.stdout?.includes('ok')) {
      return {
        success: false,
        error: 'Sync aborted: restore not complete',
        details: 'The .restore-complete marker is missing. The container may still be booting or is using an old startup script.',
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
  // The startup script writes .boot-timestamp with epoch seconds at boot.
  // We require the container to be at least MIN_BOOT_AGE_SECONDS old before syncing.
  if (!force) {
    try {
      const ageProc = await sandbox.startProcess('cat /root/.clawdbot/.boot-timestamp 2>/dev/null');
      await waitForProcess(ageProc, 5000);
      const ageLogs = await ageProc.getLogs();
      const bootEpoch = parseInt(ageLogs.stdout?.trim() || '', 10);
      if (isNaN(bootEpoch)) {
        return {
          success: false,
          error: 'Sync aborted: no boot timestamp',
          details: 'The .boot-timestamp marker is missing. The container may be using an old startup script.',
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
  // A template-only container has clawdbot.json but no lastTouchedAt metadata and
  // very few files. We block sync unless there's evidence the gateway has been used.
  if (!force) {
    try {
      const stateProc = await sandbox.startProcess(
        'grep -c "lastTouchedAt" /root/.clawdbot/clawdbot.json 2>/dev/null; echo "---"; ls -1 /root/.clawdbot/ 2>/dev/null | wc -l'
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
  // Run rsync WITHOUT --delete. This means orphan files may accumulate in R2,
  // but a fresh/empty container can never wipe the backup.
  // Exclude marker files and temp files from sync.
  const syncCmd = [
    `rsync -r --no-times`,
    `--exclude='*.lock' --exclude='*.log' --exclude='*.tmp'`,
    `--exclude='.boot-timestamp' --exclude='.restore-complete'`,
    `/root/.clawdbot/ ${R2_MOUNT_PATH}/clawdbot/`,
    `&& rsync -r --no-times /root/clawd/skills/ ${R2_MOUNT_PATH}/skills/`,
    `&& ([ -d /root/.config/gogcli ] && rsync -r --no-times /root/.config/gogcli/ ${R2_MOUNT_PATH}/gogcli/ || true)`,
    `&& date -Iseconds > ${R2_MOUNT_PATH}/.last-sync`,
  ].join(' ');

  try {
    const proc = await sandbox.startProcess(syncCmd);
    await waitForProcess(proc, 30000); // 30 second timeout for sync

    // Check for success by reading the timestamp file
    // (process status may not update reliably in sandbox API)
    // Note: backup structure is ${R2_MOUNT_PATH}/clawdbot/ and ${R2_MOUNT_PATH}/skills/
    const timestampProc = await sandbox.startProcess(`cat ${R2_MOUNT_PATH}/.last-sync`);
    await waitForProcess(timestampProc, 5000);
    const timestampLogs = await timestampProc.getLogs();
    const lastSync = timestampLogs.stdout?.trim();

    if (lastSync && lastSync.match(/^\d{4}-\d{2}-\d{2}/)) {
      return { success: true, lastSync };
    } else {
      const logs = await proc.getLogs();
      return {
        success: false,
        error: 'Sync failed',
        details: logs.stderr || logs.stdout || 'No timestamp file created',
      };
    }
  } catch (err) {
    return {
      success: false,
      error: 'Sync error',
      details: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
