import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { promises as fs } from "fs";
import Fastify from "fastify";
import { registerSessionRoutes } from "../src/routes/sessions";
import { storeMedia } from "../src/storage/imageCache";
import type { StoragePaths } from "../src/storage/files";

function makePaths(baseDir: string): StoragePaths {
  return {
    baseDir,
    configPath: path.join(baseDir, "config.yaml"),
    healthPath: path.join(baseDir, "health.json"),
    providerHealthPath: path.join(baseDir, "providers_health.json"),
    requestLogPath: path.join(baseDir, "request_logs.jsonl"),
    providersPath: path.join(baseDir, "providers.json"),
    poolsPath: path.join(baseDir, "pools.json"),
    poolStatePath: path.join(baseDir, "pool_state.json"),
  };
}

async function makeWorkspaceTempDir(prefix: string): Promise<string> {
  const base = path.join(process.cwd(), "tmp");
  await fs.mkdir(base, { recursive: true });
  return fs.mkdtemp(path.join(base, prefix));
}

test("/data/images/:hash serves cached media bytes", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-data-routes-");
  const previous = process.env.WAYPOI_DIR;
  process.env.WAYPOI_DIR = baseDir;
  const paths = makePaths(baseDir);
  const stored = await storeMedia(paths, "data:image/png;base64,AAA=");

  const app = Fastify();
  await registerSessionRoutes(app);

  const res = await app.inject({
    method: "GET",
    url: `/data/images/${stored.hash}`,
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "image/png");
  assert.equal(res.headers["cache-control"], "public, max-age=31536000, immutable");
  assert.ok(res.body.length > 0);

  await app.close();
  process.env.WAYPOI_DIR = previous;
});
