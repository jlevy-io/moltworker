/**
 * Shared utilities for gateway operations
 */

/**
 * Wait for a sandbox process to complete
 *
 * @param proc - Process object with status property
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param pollIntervalMs - How often to check status (default 500ms)
 */
export async function waitForProcess(
  proc: { status: string },
  timeoutMs: number,
  pollIntervalMs: number = 500,
): Promise<void> {
  const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);
  let attempts = 0;
  while (proc.status === 'running' && attempts < maxAttempts) {
    // eslint-disable-next-line no-await-in-loop -- intentional sequential polling
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    attempts++;
  }
}

/**
 * Wait for any of several sentinel strings to appear in process stdout.
 *
 * The Sandbox API's proc.status field never reliably transitions away from
 * "running", so polling status is unreliable. This helper polls getLogs()
 * for known sentinel strings instead — the command itself is responsible
 * for printing a sentinel on completion.
 */
export async function waitForOutput(
  proc: { getLogs(): Promise<{ stdout?: string; stderr?: string }> },
  sentinel: string | string[],
  timeoutMs: number,
  pollIntervalMs = 1000,
): Promise<{ found: boolean; stdout: string; stderr: string }> {
  const sentinels = Array.isArray(sentinel) ? sentinel : [sentinel];
  const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);
  for (let i = 0; i < maxAttempts; i++) {
    // eslint-disable-next-line no-await-in-loop -- intentional sequential polling
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const logs = await proc.getLogs();
    const stdout = logs.stdout || '';
    if (sentinels.some((s) => stdout.includes(s))) {
      return { found: true, stdout, stderr: logs.stderr || '' };
    }
  }
  const logs = await proc.getLogs();
  return { found: false, stdout: logs.stdout || '', stderr: logs.stderr || '' };
}
