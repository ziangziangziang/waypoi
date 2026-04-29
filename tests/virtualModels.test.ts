import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { promises as fs } from "fs";
import Fastify from "fastify";
import { rebuildDefaultVirtualModels, scoreModelHeuristic } from "../src/virtualModels/builder";
import {
  appendVirtualModelSwitchEvent,
  listVirtualModelSwitchEvents,
} from "../src/virtualModels/repository";
import { markVirtualModelAttempt, selectVirtualModelCandidates } from "../src/virtualModels/scheduler";
import { saveProviderStore } from "../src/providers/repository";
import { registerAdminRoutes } from "../src/routes/admin";
import { registerModelsRoutes } from "../src/routes/models";
import type { ProviderRecord } from "../src/providers/types";
import type { StoragePaths } from "../src/storage/files";

function makePaths(baseDir: string): StoragePaths {
  return {
    baseDir,
    configPath: path.join(baseDir, "config.yaml"),
    healthPath: path.join(baseDir, "health.json"),
    providerHealthPath: path.join(baseDir, "providers_health.json"),
    requestLogPath: path.join(baseDir, "request_logs.jsonl"),
    providersPath: path.join(baseDir, "providers.json"),
    virtualModelsPath: path.join(baseDir, "virtual_models.json"),
    virtualModelStatePath: path.join(baseDir, "virtual_model_state.json"),
    virtualModelEventsPath: path.join(baseDir, "virtual_model_events.jsonl"),
    poolsPath: path.join(baseDir, "pools.json"),
    poolStatePath: path.join(baseDir, "pool_state.json"),
  };
}

async function makeWorkspaceTempDir(prefix: string): Promise<string> {
  const base = path.join(process.cwd(), "tmp");
  await fs.mkdir(base, { recursive: true });
  return fs.mkdtemp(path.join(base, prefix));
}

function providerFixture(): ProviderRecord[] {
  return [
    {
      id: "free-a",
      name: "Free A",
      protocol: "openai",
      baseUrl: "http://example-a.test",
      enabled: true,
      supportsRouting: true,
      models: [
        {
          providerModelId: "free-a/llama-3-8b",
          providerId: "free-a",
          modelId: "llama-3-8b",
          upstreamModel: "llama-3-8b",
          free: true,
          modalities: ["text"],
          capabilities: { input: ["text"], output: ["text"], supportsStreaming: true },
          endpointType: "llm",
          enabled: true,
          aliases: [],
          limits: { requests: { perMinute: 1 } },
        },
        {
          providerModelId: "free-a/qwen3-32b",
          providerId: "free-a",
          modelId: "qwen3-32b",
          upstreamModel: "qwen3-32b",
          free: true,
          modalities: ["text"],
          capabilities: { input: ["text"], output: ["text"], supportsTools: true, supportsStreaming: true },
          endpointType: "llm",
          enabled: true,
          aliases: [],
        },
      ],
      importedAt: new Date().toISOString(),
    },
  ];
}

test("virtual model rebuild migrates legacy pools and ranks by manual selection", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-vm-test-");
  const paths = makePaths(baseDir);
  await saveProviderStore(paths, providerFixture());
  await fs.writeFile(paths.poolsPath, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    pools: [
      {
        id: "custom",
        name: "Custom",
        aliases: ["custom"],
        enabled: true,
        strategy: "highest_rank_available",
        requiredInput: [],
        requiredOutput: [],
        scoreFallback: 20,
        candidates: [],
        candidateSelection: ["free-a/llama-3-8b", "free-a/qwen3-32b"],
        userDefined: true,
        updatedAt: new Date().toISOString(),
      },
    ],
  }), "utf8");

  const virtualModels = await rebuildDefaultVirtualModels(paths);
  const custom = virtualModels.find((model) => model.id === "custom");
  assert.ok(custom);
  assert.deepEqual(custom.candidates.map((candidate) => `${candidate.providerId}/${candidate.modelId}`), [
    "free-a/llama-3-8b",
    "free-a/qwen3-32b",
  ]);
  assert.ok(await fs.stat(paths.virtualModelsPath!));
});

test("heuristic scoring prefers larger newer capable model names", () => {
  const small = scoreModelHeuristic("llama-3-8b", { input: ["text"], output: ["text"] });
  const large = scoreModelHeuristic("qwen3-32b-2025", {
    input: ["text", "image"],
    output: ["text"],
    supportsTools: true,
    supportsStreaming: true,
  });
  assert.ok(large > small);
});

test("rolling request windows enforce and recharge backend eligibility", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-vm-test-");
  const paths = makePaths(baseDir);
  await saveProviderStore(paths, providerFixture());
  await rebuildDefaultVirtualModels(paths);

  const first = await selectVirtualModelCandidates(paths, "smart", { requiredInput: ["text"], requiredOutput: ["text"] });
  assert.ok(first);
  const limited = first.candidates.find((candidate) => candidate.modelId === "llama-3-8b");
  assert.ok(limited);
  await markVirtualModelAttempt(paths, limited, 0);

  const second = await selectVirtualModelCandidates(paths, "smart", { requiredInput: ["text"], requiredOutput: ["text"] });
  assert.ok(second);
  assert.ok(!second.candidates.some((candidate) => candidate.id === limited.id));

  const statePath = paths.virtualModelStatePath!;
  const state = JSON.parse(await fs.readFile(statePath, "utf8")) as { candidates: Record<string, { minuteWindowStartedAt?: string }> };
  state.candidates[limited.id].minuteWindowStartedAt = new Date(Date.now() - 61_000).toISOString();
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");

  const recharged = await selectVirtualModelCandidates(paths, "smart", { requiredInput: ["text"], requiredOutput: ["text"] });
  assert.ok(recharged?.candidates.some((candidate) => candidate.id === limited.id));
});

test("virtual model switch events retain only the requested seven day window", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-vm-test-");
  const paths = makePaths(baseDir);
  await appendVirtualModelSwitchEvent(paths, {
    virtualModelId: "smart",
    fromCandidateId: "a",
    toCandidateId: "b",
    reason: "rate_limited",
  });
  await fs.appendFile(paths.virtualModelEventsPath!, `${JSON.stringify({
    id: "old",
    virtualModelId: "smart",
    fromCandidateId: "b",
    toCandidateId: "a",
    reason: "recharged",
    createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  })}\n`);

  const events = await listVirtualModelSwitchEvents(paths, "smart", 7 * 24 * 60 * 60 * 1000);
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, "rate_limited");
});

test("admin virtual model routes create update toggle delete and list events", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-vm-test-");
  const paths = makePaths(baseDir);
  await saveProviderStore(paths, providerFixture());
  await rebuildDefaultVirtualModels(paths);

  const app = Fastify();
  await registerAdminRoutes(app, paths, {});

  const created = await app.inject({
    method: "POST",
    url: "/admin/virtual-models",
    payload: { id: "vm-test", candidateSelection: ["free-a/qwen3-32b"] },
  });
  assert.equal(created.statusCode, 201);

  const updated = await app.inject({
    method: "PUT",
    url: "/admin/virtual-models/vm-test",
    payload: { name: "VM Test 2", candidateSelection: ["free-a/llama-3-8b"] },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().name, "VM Test 2");

  const toggled = await app.inject({ method: "POST", url: "/admin/virtual-models/vm-test/toggle" });
  assert.equal(toggled.statusCode, 200);
  assert.equal(toggled.json().enabled, false);

  const events = await app.inject({ method: "GET", url: "/admin/virtual-models/vm-test/events?window=7d" });
  assert.equal(events.statusCode, 200);
  assert.deepEqual(events.json().data, []);

  const deleted = await app.inject({ method: "DELETE", url: "/admin/virtual-models/vm-test" });
  assert.equal(deleted.statusCode, 200);
  await app.close();
});

test("/v1/models exposes virtual models with waypoi_virtual_model metadata", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-vm-test-");
  const paths = makePaths(baseDir);
  await saveProviderStore(paths, providerFixture());
  await rebuildDefaultVirtualModels(paths);

  const app = Fastify();
  await registerModelsRoutes(app, paths);
  const res = await app.inject({ method: "GET", url: "/v1/models" });
  assert.equal(res.statusCode, 200);
  const json = res.json() as { data: Array<{ id: string; waypoi_virtual_model?: { candidateCount: number } }> };
  const smart = json.data.find((entry) => entry.id === "smart");
  assert.ok(smart?.waypoi_virtual_model);
  assert.equal(smart.waypoi_virtual_model.candidateCount, 2);
  await app.close();
});
