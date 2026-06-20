import path from "path";

function resolveBinaryName(): string {
  if (process.argv.length >= 2) {
    const bin = path.basename(process.argv[1]);
    if (bin === "waypoi" || bin === "waypoi-dev") return bin;
  }
  if (process.env.WAYPOI_DEV === "1") return "waypoi-dev";
  return "waypoi";
}

function isDev(): boolean {
  return resolveBinaryName() === "waypoi-dev";
}

function resolvePort(): number {
  if (process.env.PORT) return Number(process.env.PORT);
  return isDev() ? 9470 : 9469;
}

function resolveStorageDir(): string {
  if (process.env.WAYPOI_DIR) return process.env.WAYPOI_DIR;
  if (isDev()) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
    return path.join(home, ".config", "waypoi-dev");
  }
  return "";
}

function resolvePidFileName(): string {
  return isDev() ? "waypoi-dev.pid" : "waypoi.pid";
}

function resolveAppName(): string {
  return isDev() ? "waypoi-dev" : "waypoi";
}

export const appConfig = {
  isDev: isDev(),
  port: resolvePort(),
  appName: resolveAppName(),
  storageDirOverride: resolveStorageDir(),
  pidFileName: resolvePidFileName(),
};
