#!/usr/bin/env node
const { execSync } = require("child_process");
const { writeFileSync } = require("fs");
const { join } = require("path");

const root = join(__dirname, "..");

let version;
try {
  version = execSync("git describe --tags --abbrev=0", {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (version.startsWith("v")) version = version.slice(1);
} catch {
  version = "0.0.0";
}

let branch = "";
try {
  branch = execSync("git rev-parse --abbrev-ref HEAD", {
    cwd: root,
    encoding: "utf8",
  }).trim();
} catch {}

const isDev = branch === "dev";

const content = `// Auto-generated from git tags. Do not edit manually.
export const VERSION = ${JSON.stringify(version)};
export const IS_DEV = ${JSON.stringify(isDev)};
`;

writeFileSync(join(root, "src", "version.ts"), content, "utf8");
