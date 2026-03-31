import { StoragePaths } from "../storage/files";
import { probeProviderModels } from "../providers/health";

let healthTimer: NodeJS.Timeout | null = null;

export function startHealthChecker(paths: StoragePaths): void {
  const intervalMs = 30_000;
  const run = async () => {
    await probeProviderModels(paths);
  };

  healthTimer = setInterval(run, intervalMs);
  healthTimer.unref();
  void run();
}

export function stopHealthChecker(): void {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}
