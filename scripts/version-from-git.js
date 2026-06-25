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

const content = `// Auto-generated from git tags. Do not edit manually.
export const VERSION = ${JSON.stringify(version)};
`;

writeFileSync(join(root, "src", "version.ts"), content, "utf8");
