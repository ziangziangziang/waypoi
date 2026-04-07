import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { promises as fs } from "fs";
import Fastify from "fastify";
import { registerAdminRoutes } from "../src/routes/admin";
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

test("/admin/benchmarks/runs forwards execution + tuning fields", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-benchmark-admin-test-");
  const paths = makePaths(baseDir);
  const app = Fastify();
  await registerAdminRoutes(app, paths, { adminToken: "test-token", version: "0.0.0" });

  const res = await app.inject({
    method: "POST",
    url: "/admin/benchmarks/runs",
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    },
    payload: {
      suite: "showcase",
      exampleId: "showcase-tinyqa-001",
      executionMode: "showcase",
      profile: "local",
      temperature: 0.25,
      top_p: 0.8,
      max_tokens: 128,
      presence_penalty: 0.3,
      frequency_penalty: -0.2,
      seed: 7,
      stop: ["END", "STOP"],
    },
  });

  assert.equal(res.statusCode, 202);
  const body = res.json() as {
    request: {
      exampleId?: string;
      executionMode?: string;
      temperature?: number;
      top_p?: number;
      max_tokens?: number;
      presence_penalty?: number;
      frequency_penalty?: number;
      seed?: number;
      stop?: string[];
    };
  };

  assert.equal(body.request.exampleId, "showcase-tinyqa-001");
  assert.equal(body.request.executionMode, "showcase");
  assert.equal(body.request.temperature, 0.25);
  assert.equal(body.request.top_p, 0.8);
  assert.equal(body.request.max_tokens, 128);
  assert.equal(body.request.presence_penalty, 0.3);
  assert.equal(body.request.frequency_penalty, -0.2);
  assert.equal(body.request.seed, 7);
  assert.deepEqual(body.request.stop, ["END", "STOP"]);

  await app.close();
});
