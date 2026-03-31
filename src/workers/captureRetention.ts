import { StoragePaths } from "../storage/files";
import { runCaptureRetention } from "../storage/captureRepository";

let retentionTimer: NodeJS.Timeout | null = null;

export function startCaptureRetentionWorker(paths: StoragePaths): void {
  const run = async () => {
    try {
      await runCaptureRetention(paths);
    } catch {
      // ignore background errors
    }
  };

  retentionTimer = setInterval(run, 10 * 60 * 1000);
  retentionTimer.unref();
  void run();
}

export function stopCaptureRetentionWorker(): void {
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
}
