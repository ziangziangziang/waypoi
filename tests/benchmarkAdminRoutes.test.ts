import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { promises as fs } from "fs";
import Fastify from "fastify";
import { registerAdminRoutes } from "../src/routes/admin";
import type { BenchmarkRunRecord } from "../src/benchmark/jobs";
import type { StoragePaths } from "../src/storage/files";
import type { BenchmarkCliOptions } from "../src/benchmark/types";

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

// Hermetic runner: records the request and returns a completed run without
// performing any real network/MCP I/O, so tests stay fast and don't leak
// background jobs that keep the test runner alive.
function makeStubRunner(): {
  runner: (paths: StoragePaths, request: BenchmarkCliOptions) => Promise<BenchmarkRunRecord>;
  lastRequest: () => BenchmarkCliOptions | undefined;
} {
  let last: BenchmarkCliOptions | undefined;
  const runner = async (
    _paths: StoragePaths,
    request: BenchmarkCliOptions
  ): Promise<BenchmarkRunRecord> => {
    last = request;
    return {
      id: "stub-run-id",
      status: "completed",
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      request,
      progress: { totalScenarios: 0, completedScenarios: 0 },
      events: [],
    };
  };
  return { runner, lastRequest: () => last };
}

test("/admin/benchmarks/runs forwards execution + tuning fields", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-benchmark-admin-test-");
  const paths = makePaths(baseDir);
  const stub = makeStubRunner();
  const app = Fastify();
  await registerAdminRoutes(app, paths, {
    adminToken: "test-token",
    version: "0.0.0",
    benchmarkRunner: stub.runner,
  });

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

  const captured = stub.lastRequest()!;
  assert.equal(captured.suite, "showcase");
  assert.equal(captured.exampleId, "showcase-tinyqa-001");
  assert.equal(captured.executionMode, "showcase");
  assert.equal(captured.profile, "local");
  assert.equal(captured.temperature, 0.25);
  assert.equal(captured.top_p, 0.8);
  assert.equal(captured.max_tokens, 128);
  assert.equal(captured.presence_penalty, 0.3);
  assert.equal(captured.frequency_penalty, -0.2);
  assert.equal(captured.seed, 7);
  assert.deepEqual(captured.stop, ["END", "STOP"]);

  await app.close();
});

test("/admin/benchmarks/runs accepts simple model suite parameters body", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-benchmark-admin-simple-test-");
  const paths = makePaths(baseDir);
  const stub = makeStubRunner();
  const app = Fastify();
  await registerAdminRoutes(app, paths, {
    adminToken: "test-token",
    version: "0.0.0",
    benchmarkRunner: stub.runner,
  });

  const res = await app.inject({
    method: "POST",
    url: "/admin/benchmarks/runs",
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    },
    payload: {
      model: "smart",
      suite: "showcase",
      parameters: {
        temperature: 0.2,
        top_p: 0.75,
        max_tokens: 96,
        presence_penalty: 0.1,
        frequency_penalty: -0.1,
        seed: 11,
        stop: "END",
      },
    },
  });

  assert.equal(res.statusCode, 202);
  const body = res.json() as {
    request: {
      suite?: string;
      modelOverride?: string;
      temperature?: number;
      top_p?: number;
      max_tokens?: number;
      presence_penalty?: number;
      frequency_penalty?: number;
      seed?: number;
      stop?: string;
    };
  };

  assert.equal(body.request.suite, "showcase");
  assert.equal(body.request.modelOverride, "smart");
  assert.equal(body.request.temperature, 0.2);
  assert.equal(body.request.top_p, 0.75);
  assert.equal(body.request.max_tokens, 96);
  assert.equal(body.request.presence_penalty, 0.1);
  assert.equal(body.request.frequency_penalty, -0.1);
  assert.equal(body.request.seed, 11);
  assert.equal(body.request.stop, "END");

  const captured = stub.lastRequest()!;
  assert.equal(captured.modelOverride, "smart");
  assert.equal(captured.suite, "showcase");
  assert.equal(captured.temperature, 0.2);
  assert.equal(captured.top_p, 0.75);
  assert.equal(captured.max_tokens, 96);
  assert.equal(captured.presence_penalty, 0.1);
  assert.equal(captured.frequency_penalty, -0.1);
  assert.equal(captured.seed, 11);
  assert.equal(captured.stop, "END");

  await app.close();
});
