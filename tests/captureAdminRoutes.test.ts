import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { promises as fs } from "fs";
import { createServer } from "node:http";
import Fastify from "fastify";
import { registerAdminRoutes } from "../src/routes/admin";
import { persistCaptureRecord, updateCaptureConfig } from "../src/storage/captureRepository";
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

async function startUpstreamServer(
  handler: Parameters<typeof createServer>[0]
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind upstream test server");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

test("admin capture endpoints expose config, list, and detail", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-admin-test-");
  const paths = makePaths(baseDir);
  const app = Fastify();
  await registerAdminRoutes(app, paths, { adminToken: "test-token", version: "0.0.0" });

  const auth = { authorization: "Bearer test-token" };

  const cfgRes = await app.inject({ method: "GET", url: "/admin/capture/config", headers: auth });
  assert.equal(cfgRes.statusCode, 200);

  const enableRes = await app.inject({
    method: "PUT",
    url: "/admin/capture/config",
    headers: { ...auth, "content-type": "application/json" },
    payload: { enabled: true, retentionDays: 30, maxBytes: 20 * 1024 * 1024 * 1024 },
  });
  assert.equal(enableRes.statusCode, 200);
  await updateCaptureConfig(paths, { enabled: true });

  const record = await persistCaptureRecord(paths, {
    route: "/v1/embeddings",
    method: "POST",
    statusCode: 200,
    latencyMs: 10,
    requestBody: { model: "prov/model", input: "hello" },
    responseBody: { data: [] },
    routing: { publicModel: "prov/model" },
  });
  assert.ok(record);

  const listRes = await app.inject({ method: "GET", url: "/admin/capture/records?limit=5", headers: auth });
  assert.equal(listRes.statusCode, 200);
  const listJson = listRes.json() as { data: Array<{ id: string }>; total: number };
  assert.equal(listJson.data.length, 1);
  assert.equal(listJson.total, 1);

  const detailRes = await app.inject({
    method: "GET",
    url: `/admin/capture/records/${encodeURIComponent(listJson.data[0].id)}`,
    headers: auth,
  });
  assert.equal(detailRes.statusCode, 200);
  const detailJson = detailRes.json() as {
    route: string;
    analysis?: {
      tokenFlow?: {
        method: string;
      };
    };
  };
  assert.equal(detailJson.route, "/v1/embeddings");
  assert.equal(detailJson.analysis?.tokenFlow?.method, "unavailable");

  const datedListRes = await app.inject({
    method: "GET",
    url: `/admin/capture/records?date=${record?.timestamp.slice(0, 10)}&limit=5&offset=0`,
    headers: auth,
  });
  assert.equal(datedListRes.statusCode, 200);
  const datedListJson = datedListRes.json() as { data: Array<{ id: string }>; total: number };
  assert.equal(datedListJson.total, 1);

  const calendarRes = await app.inject({
    method: "GET",
    url: `/admin/capture/calendar?month=${record?.timestamp.slice(0, 7)}`,
    headers: auth,
  });
  assert.equal(calendarRes.statusCode, 200);
  const calendarJson = calendarRes.json() as { month: string; days: Array<{ date: string; count: number }> };
  assert.equal(calendarJson.days.length, 1);
  assert.equal(calendarJson.days[0]?.count, 1);

  await app.close();
});

test("admin capture endpoints bucket calendar and date by requested timezone with UTC fallback", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-admin-timezone-test-");
  const paths = makePaths(baseDir);
  const app = Fastify();
  await registerAdminRoutes(app, paths, { adminToken: "test-token", version: "0.0.0" });

  const auth = { authorization: "Bearer test-token" };
  await updateCaptureConfig(paths, { enabled: true });

  const record = await persistCaptureRecord(paths, {
    route: "/v1/chat/completions",
    method: "POST",
    statusCode: 200,
    latencyMs: 15,
    requestBody: { model: "prov/model", messages: [{ role: "user", content: "hello" }] },
    responseBody: { id: "resp-1" },
  });
  assert.ok(record);

  const indexPath = path.join(baseDir, "capture", "index.jsonl");
  const lines = (await fs.readFile(indexPath, "utf8")).split("\n").filter(Boolean);
  const patched = lines.map((line) => {
    const entry = JSON.parse(line) as { id: string; timestamp: string };
    if (entry.id === record!.id) {
      entry.timestamp = "2026-01-01T01:30:00.000Z";
    }
    return JSON.stringify(entry);
  });
  await fs.writeFile(indexPath, `${patched.join("\n")}\n`, "utf8");

  const utcRecords = await app.inject({
    method: "GET",
    url: "/admin/capture/records?date=2026-01-01&timeZone=UTC&limit=5&offset=0",
    headers: auth,
  });
  assert.equal(utcRecords.statusCode, 200);
  assert.equal((utcRecords.json() as { total: number }).total, 1);

  const chicagoRecords = await app.inject({
    method: "GET",
    url: "/admin/capture/records?date=2025-12-31&timeZone=America/Chicago&limit=5&offset=0",
    headers: auth,
  });
  assert.equal(chicagoRecords.statusCode, 200);
  assert.equal((chicagoRecords.json() as { total: number }).total, 1);

  const invalidTzRecords = await app.inject({
    method: "GET",
    url: "/admin/capture/records?date=2026-01-01&timeZone=Not/A_Zone&limit=5&offset=0",
    headers: auth,
  });
  assert.equal(invalidTzRecords.statusCode, 200);
  assert.equal((invalidTzRecords.json() as { total: number }).total, 1);

  const utcCalendar = await app.inject({
    method: "GET",
    url: "/admin/capture/calendar?month=2026-01&timeZone=UTC",
    headers: auth,
  });
  assert.equal(utcCalendar.statusCode, 200);
  assert.deepEqual((utcCalendar.json() as { days: Array<{ date: string; count: number }> }).days, [
    { date: "2026-01-01", count: 1 },
  ]);

  const chicagoCalendar = await app.inject({
    method: "GET",
    url: "/admin/capture/calendar?month=2025-12&timeZone=America/Chicago",
    headers: auth,
  });
  assert.equal(chicagoCalendar.statusCode, 200);
  assert.deepEqual((chicagoCalendar.json() as { days: Array<{ date: string; count: number }> }).days, [
    { date: "2025-12-31", count: 1 },
  ]);

  const invalidTzCalendar = await app.inject({
    method: "GET",
    url: "/admin/capture/calendar?month=2026-01&timeZone=Not/A_Zone",
    headers: auth,
  });
  assert.equal(invalidTzCalendar.statusCode, 200);
  assert.deepEqual((invalidTzCalendar.json() as { days: Array<{ date: string; count: number }> }).days, [
    { date: "2026-01-01", count: 1 },
  ]);

  await app.close();
});

test("admin provider endpoints support provider-level CRUD", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-provider-admin-test-");
  const paths = makePaths(baseDir);
  const app = Fastify();
  await registerAdminRoutes(app, paths, { adminToken: "test-token", version: "0.0.0" });

  const auth = { authorization: "Bearer test-token" };

  const createRes = await app.inject({
    method: "POST",
    url: "/admin/providers",
    headers: { ...auth, "content-type": "application/json" },
    payload: {
      id: "demo",
      name: "Demo Provider",
      protocol: "openai",
      baseUrl: "https://example.com/v1",
      enabled: true,
      supportsRouting: true,
    },
  });
  assert.equal(createRes.statusCode, 201);

  const updateRes = await app.inject({
    method: "PATCH",
    url: "/admin/providers/demo",
    headers: { ...auth, "content-type": "application/json" },
    payload: {
      name: "Demo Provider Updated",
      envVar: "DEMO_API_KEY",
    },
  });
  assert.equal(updateRes.statusCode, 200);
  assert.equal((updateRes.json() as { name: string }).name, "Demo Provider Updated");

  const disableRes = await app.inject({
    method: "POST",
    url: "/admin/providers/demo/disable",
    headers: auth,
  });
  assert.equal(disableRes.statusCode, 200);
  assert.equal((disableRes.json() as { enabled: boolean }).enabled, false);

  const enableRes = await app.inject({
    method: "POST",
    url: "/admin/providers/demo/enable",
    headers: auth,
  });
  assert.equal(enableRes.statusCode, 200);
  assert.equal((enableRes.json() as { enabled: boolean }).enabled, true);

  const deleteRes = await app.inject({
    method: "DELETE",
    url: "/admin/providers/demo",
    headers: auth,
  });
  assert.equal(deleteRes.statusCode, 200);
  assert.equal((deleteRes.json() as { deleted: string }).deleted, "demo");

  await app.close();
});

test("admin provider model discovery honors header auth and normalizes capabilities", async () => {
  const upstream = await startUpstreamServer((req, res) => {
    assert.equal(req.url, "/v1/models");
    assert.equal(req.headers["x-api-key"], "secret-token");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      data: [
        {
          id: "gpt-4.1-mini",
          capabilities: {
            input: ["text"],
            output: ["text", "image"],
            supportsTools: true,
            supportsStreaming: true,
          },
        },
      ],
    }));
  });

  const baseDir = await makeWorkspaceTempDir("waypoi-provider-discovery-test-");
  const paths = makePaths(baseDir);
  const app = Fastify();
  await registerAdminRoutes(app, paths, { adminToken: "test-token", version: "0.0.0" });
  const auth = { authorization: "Bearer test-token" };

  const createRes = await app.inject({
    method: "POST",
    url: "/admin/providers",
    headers: { ...auth, "content-type": "application/json" },
    payload: {
      id: "demo",
      name: "Demo Provider",
      protocol: "openai",
      baseUrl: upstream.baseUrl,
      apiKey: "secret-token",
      auth: {
        type: "header",
        headerName: "x-api-key",
      },
      enabled: true,
      supportsRouting: true,
    },
  });
  assert.equal(createRes.statusCode, 201);

  const discoveryRes = await app.inject({
    method: "POST",
    url: "/admin/providers/demo/models/discover",
    headers: { ...auth, "content-type": "application/json" },
    payload: {},
  });
  assert.equal(discoveryRes.statusCode, 200);
  const discoveryJson = discoveryRes.json() as {
    baseUrl: string;
    models: Array<{
      id: string;
      capabilities?: {
        input: string[];
        output: string[];
        supportsTools?: boolean;
        supportsStreaming?: boolean;
        source?: string;
      };
    }>;
  };
  assert.equal(discoveryJson.baseUrl, upstream.baseUrl);
  assert.deepEqual(discoveryJson.models, [
    {
      id: "gpt-4.1-mini",
      capabilities: {
        input: ["text"],
        output: ["text", "image"],
        supportsTools: true,
        supportsStreaming: true,
        source: "inferred",
      },
    },
  ]);

  await app.close();
  await upstream.close();
});

test("admin provider model discovery supports providers whose base URL already ends with /v1", async () => {
  const upstream = await startUpstreamServer((req, res) => {
    assert.equal(req.url, "/v1/models?token=query-secret");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      data: [
        {
          id: "text-embedding-3-large",
          input_modalities: ["text"],
          output_modalities: ["embedding"],
        },
      ],
    }));
  });

  const baseDir = await makeWorkspaceTempDir("waypoi-provider-discovery-v1-test-");
  const paths = makePaths(baseDir);
  const app = Fastify();
  await registerAdminRoutes(app, paths, { adminToken: "test-token", version: "0.0.0" });
  const auth = { authorization: "Bearer test-token" };

  const createRes = await app.inject({
    method: "POST",
    url: "/admin/providers",
    headers: { ...auth, "content-type": "application/json" },
    payload: {
      id: "embed",
      name: "Embed Provider",
      protocol: "openai",
      baseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "query-secret",
      auth: {
        type: "query",
        keyParam: "token",
      },
      enabled: true,
      supportsRouting: true,
    },
  });
  assert.equal(createRes.statusCode, 201);

  const discoveryRes = await app.inject({
    method: "POST",
    url: "/admin/providers/embed/models/discover",
    headers: { ...auth, "content-type": "application/json" },
    payload: {},
  });
  assert.equal(discoveryRes.statusCode, 200);
  const discoveryJson = discoveryRes.json() as {
    models: Array<{ id: string; capabilities?: { input: string[]; output: string[]; source?: string } }>;
  };
  assert.deepEqual(discoveryJson.models, [
    {
      id: "text-embedding-3-large",
      capabilities: {
        input: ["text"],
        output: ["embedding"],
        source: "inferred",
      },
    },
  ]);

  await app.close();
  await upstream.close();
});

test("admin provider model discovery falls back to /models and normalizes array-style listings", async () => {
  const upstream = await startUpstreamServer((req, res) => {
    if (req.url === "/v1/models") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    assert.equal(req.url, "/models");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify([
      {
        id: "azureml://registries/azure-openai/models/gpt-4o/versions/2",
        name: "gpt-4o",
        task: "chat-completion",
      },
      {
        id: "azureml://registries/azure-openai/models/text-embedding-3-small/versions/1",
        name: "text-embedding-3-small",
        task: "embeddings",
      },
    ]));
  });

  const baseDir = await makeWorkspaceTempDir("waypoi-provider-discovery-array-test-");
  const paths = makePaths(baseDir);
  const app = Fastify();
  await registerAdminRoutes(app, paths, { adminToken: "test-token", version: "0.0.0" });
  const auth = { authorization: "Bearer test-token" };

  const createRes = await app.inject({
    method: "POST",
    url: "/admin/providers",
    headers: { ...auth, "content-type": "application/json" },
    payload: {
      id: "demo-array",
      name: "Demo Array Provider",
      protocol: "openai",
      baseUrl: upstream.baseUrl,
      enabled: true,
      supportsRouting: true,
    },
  });
  assert.equal(createRes.statusCode, 201);

  const discoveryRes = await app.inject({
    method: "POST",
    url: "/admin/providers/demo-array/models/discover",
    headers: { ...auth, "content-type": "application/json" },
    payload: {},
  });
  assert.equal(discoveryRes.statusCode, 200);
  const discoveryJson = discoveryRes.json() as {
    models: Array<{
      id: string;
      capabilities?: {
        input: string[];
        output: string[];
      };
    }>;
  };
  assert.deepEqual(discoveryJson.models, [
    {
      id: "gpt-4o",
      capabilities: {
        input: ["text"],
        output: ["text"],
        source: "inferred",
      },
    },
    {
      id: "text-embedding-3-small",
      capabilities: {
        input: ["text"],
        output: ["embedding"],
        source: "inferred",
      },
    },
  ]);

  await app.close();
  await upstream.close();
});

test("admin provider model discovery supports Cloudflare ai/models/search fallback", async () => {
  const upstream = await startUpstreamServer((req, res) => {
    if (req.url === "/client/v4/accounts/demo-account/ai/models/search") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        success: true,
        result: [
          {
            id: "uuid-1",
            name: "@cf/meta/llama-3.1-8b-instruct",
            task: { name: "Text Generation" },
            properties: [{ property_id: "function_calling", value: "true" }],
          },
          {
            id: "uuid-2",
            name: "@cf/baai/bge-large-en-v1.5",
            task: { name: "Text Embeddings" },
          },
        ],
      }));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });

  const baseDir = await makeWorkspaceTempDir("waypoi-provider-discovery-cloudflare-search-test-");
  const paths = makePaths(baseDir);
  const app = Fastify();
  await registerAdminRoutes(app, paths, { adminToken: "test-token", version: "0.0.0" });
  const auth = { authorization: "Bearer test-token" };

  const createRes = await app.inject({
    method: "POST",
    url: "/admin/providers",
    headers: { ...auth, "content-type": "application/json" },
    payload: {
      id: "cloudflare",
      name: "Cloudflare Workers AI",
      protocol: "cloudflare",
      baseUrl: `${upstream.baseUrl}/client/v4/accounts/demo-account/ai/v1`,
      enabled: true,
      supportsRouting: true,
    },
  });
  assert.equal(createRes.statusCode, 201);

  const discoveryRes = await app.inject({
    method: "POST",
    url: "/admin/providers/cloudflare/models/discover",
    headers: { ...auth, "content-type": "application/json" },
    payload: {},
  });
  assert.equal(discoveryRes.statusCode, 200);
  const discoveryJson = discoveryRes.json() as {
    models: Array<{
      id: string;
      free?: boolean;
      capabilities?: {
        input: string[];
        output: string[];
        supportsTools?: boolean;
        source?: string;
      };
    }>;
  };
  assert.ok(
    discoveryJson.models.some(
      (model) =>
        model.id === "@cf/meta/llama-3.1-8b-instruct" &&
        model.free === true &&
        model.capabilities?.output.includes("text") &&
        model.capabilities?.supportsTools === true
    )
  );
  assert.equal(
    discoveryJson.models.some((model) => model.id === "@cf/baai/bge-large-en-v1.5"),
    false
  );

  await app.close();
  await upstream.close();
});

test("admin provider catalog exposes free presets with compatibility status", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-provider-catalog-test-");
  const paths = makePaths(baseDir);
  const app = Fastify();
  await registerAdminRoutes(app, paths, { adminToken: "test-token", version: "0.0.0" });
  const auth = { authorization: "Bearer test-token" };

  const res = await app.inject({
    method: "GET",
    url: "/admin/provider-catalog?source=free",
    headers: auth,
  });
  assert.equal(res.statusCode, 200);
  const json = res.json() as {
    data: Array<{
      id: string;
      source: string;
      free: boolean;
      readiness: "ready" | "unsupported";
      modelSummary: { total: number };
      preset: { id: string; baseUrl: string; protocol: string };
    }>;
  };

  const openrouter = json.data.find((entry) => entry.id === "openrouter");
  assert.ok(openrouter);
  assert.equal(openrouter.source, "free");
  assert.equal(openrouter.free, true);
  assert.equal(openrouter.readiness, "ready");
  assert.equal(openrouter.preset.id, "openrouter");
  assert.match(openrouter.preset.baseUrl, /^https:\/\//);
  assert.equal(openrouter.preset.protocol, "openai");
  assert.ok(openrouter.modelSummary.total > 0);

  const gemini = json.data.find((entry) => entry.id === "gemini");
  assert.ok(gemini);
  assert.equal(gemini.readiness, "ready");
  assert.equal(gemini.preset.protocol, "gemini");

  const cloudflare = json.data.find((entry) => entry.id === "cloudflare");
  assert.ok(cloudflare);
  assert.equal(cloudflare.readiness, "ready");
  assert.equal(cloudflare.preset.protocol, "cloudflare");

  await app.close();
});

test("admin provider model discovery uses Gemini /models and enriches multimodal capabilities", async () => {
  const upstream = await startUpstreamServer((req, res) => {
    assert.match(req.url ?? "", /^\/v1beta\/models\?/);
    assert.equal(req.headers["x-goog-api-key"], "gemini-secret");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      models: [
        {
          name: "models/gemini-3-flash-preview",
          supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
        },
        {
          name: "models/text-embedding-004",
          supportedGenerationMethods: ["embedContent"],
        },
      ],
    }));
  });

  const baseDir = await makeWorkspaceTempDir("waypoi-provider-discovery-gemini-models-test-");
  const paths = makePaths(baseDir);
  const app = Fastify();
  await registerAdminRoutes(app, paths, { adminToken: "test-token", version: "0.0.0" });
  const auth = { authorization: "Bearer test-token" };

  const createRes = await app.inject({
    method: "POST",
    url: "/admin/providers",
    headers: { ...auth, "content-type": "application/json" },
    payload: {
      id: "gemini",
      name: "Google AI Studio (Gemini)",
      protocol: "gemini",
      baseUrl: `${upstream.baseUrl}/v1beta`,
      apiKey: "gemini-secret",
      enabled: true,
      supportsRouting: true,
    },
  });
  assert.equal(createRes.statusCode, 201);

  const discoveryRes = await app.inject({
    method: "POST",
    url: "/admin/providers/gemini/models/discover",
    headers: { ...auth, "content-type": "application/json" },
    payload: {},
  });
  assert.equal(discoveryRes.statusCode, 200);
  const discoveryJson = discoveryRes.json() as {
    models: Array<{
      id: string;
      free?: boolean;
      benchmark?: {
        livebench?: number;
      };
      capabilities?: {
        input: string[];
        output: string[];
        supportsStreaming?: boolean;
        source?: string;
      };
    }>;
  };
  assert.ok(
    discoveryJson.models.some(
      (model) =>
        model.id === "gemini-3-flash-preview" &&
        model.free === true &&
        typeof model.benchmark?.livebench === "number" &&
        model.capabilities?.input.includes("image") &&
        model.capabilities?.supportsStreaming === true
    )
  );
  assert.equal(
    discoveryJson.models.some((model) => model.id === "text-embedding-004"),
    false
  );

  await app.close();
  await upstream.close();
});

test("admin provider model discovery surfaces Gemini model-list failures without curated fallback", async () => {
  const upstream = await startUpstreamServer((req, res) => {
    assert.match(req.url ?? "", /^\/v1beta\/models\?/);
    res.statusCode = 500;
    res.end("models failed");
  });

  const baseDir = await makeWorkspaceTempDir("waypoi-provider-discovery-gemini-failure-test-");
  const paths = makePaths(baseDir);
  const app = Fastify();
  await registerAdminRoutes(app, paths, { adminToken: "test-token", version: "0.0.0" });
  const auth = { authorization: "Bearer test-token" };

  const createRes = await app.inject({
    method: "POST",
    url: "/admin/providers",
    headers: { ...auth, "content-type": "application/json" },
    payload: {
      id: "gemini",
      name: "Google AI Studio (Gemini)",
      protocol: "gemini",
      baseUrl: `${upstream.baseUrl}/v1beta`,
      enabled: true,
      supportsRouting: true,
    },
  });
  assert.equal(createRes.statusCode, 201);

  const discoveryRes = await app.inject({
    method: "POST",
    url: "/admin/providers/gemini/models/discover",
    headers: { ...auth, "content-type": "application/json" },
    payload: {},
  });
  assert.equal(discoveryRes.statusCode, 502);
  assert.match(JSON.stringify(discoveryRes.json()), /model discovery failed with status 500/);

  await app.close();
  await upstream.close();
});

test("admin provider model discovery surfaces Cloudflare search failures without curated fallback", async () => {
  const upstream = await startUpstreamServer((req, res) => {
    assert.equal(req.url, "/client/v4/accounts/demo-account/ai/models/search");
    res.statusCode = 500;
    res.end("search failed");
  });

  const baseDir = await makeWorkspaceTempDir("waypoi-provider-discovery-cloudflare-failure-test-");
  const paths = makePaths(baseDir);
  const app = Fastify();
  await registerAdminRoutes(app, paths, { adminToken: "test-token", version: "0.0.0" });
  const auth = { authorization: "Bearer test-token" };

  const createRes = await app.inject({
    method: "POST",
    url: "/admin/providers",
    headers: { ...auth, "content-type": "application/json" },
    payload: {
      id: "cloudflare",
      name: "Cloudflare Workers AI",
      protocol: "cloudflare",
      baseUrl: `${upstream.baseUrl}/client/v4/accounts/demo-account/ai/v1`,
      enabled: true,
      supportsRouting: true,
    },
  });
  assert.equal(createRes.statusCode, 201);

  const discoveryRes = await app.inject({
    method: "POST",
    url: "/admin/providers/cloudflare/models/discover",
    headers: { ...auth, "content-type": "application/json" },
    payload: {},
  });
  assert.equal(discoveryRes.statusCode, 502);
  assert.match(
    JSON.stringify(discoveryRes.json()),
    /model discovery failed with status 500/
  );

  await app.close();
  await upstream.close();
});

test("admin provider model discovery uses Ollama /api/tags and normalizes chat models", async () => {
  const upstream = await startUpstreamServer((req, res) => {
    assert.equal(req.url, "/api/tags");
    assert.equal(req.headers.authorization, "Bearer ollama-secret");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      models: [
        {
          name: "gpt-oss:120b",
          model: "gpt-oss:120b",
        },
        {
          name: "deepseek-v3.2",
          model: "deepseek-v3.2",
        },
      ],
    }));
  });

  const baseDir = await makeWorkspaceTempDir("waypoi-provider-discovery-ollama-tags-test-");
  const paths = makePaths(baseDir);
  const app = Fastify();
  await registerAdminRoutes(app, paths, { adminToken: "test-token", version: "0.0.0" });
  const auth = { authorization: "Bearer test-token" };

  const createRes = await app.inject({
    method: "POST",
    url: "/admin/providers",
    headers: { ...auth, "content-type": "application/json" },
    payload: {
      id: "ollama-cloud",
      name: "Ollama Cloud",
      protocol: "ollama",
      baseUrl: `${upstream.baseUrl}/api`,
      apiKey: "ollama-secret",
      enabled: true,
      supportsRouting: true,
    },
  });
  assert.equal(createRes.statusCode, 201);

  const discoveryRes = await app.inject({
    method: "POST",
    url: "/admin/providers/ollama-cloud/models/discover",
    headers: { ...auth, "content-type": "application/json" },
    payload: {},
  });
  assert.equal(discoveryRes.statusCode, 200);
  const discoveryJson = discoveryRes.json() as {
    models: Array<{
      id: string;
      free?: boolean;
      benchmark?: {
        livebench?: number;
      };
      capabilities?: {
        input: string[];
        output: string[];
        supportsStreaming?: boolean;
        source?: string;
      };
    }>;
  };
  assert.ok(
    discoveryJson.models.some(
      (model) =>
        model.id === "gpt-oss:120b" &&
        model.free === true &&
        model.capabilities?.supportsStreaming === true &&
        model.capabilities?.output.includes("text")
    )
  );
  assert.ok(
    discoveryJson.models.some(
      (model) =>
        model.id === "deepseek-v3.2" &&
        model.free === true &&
        typeof model.benchmark?.livebench === "number" &&
        model.capabilities?.supportsStreaming === true
    )
  );

  await app.close();
  await upstream.close();
});

test("admin provider model discovery surfaces Ollama tag failures without curated fallback", async () => {
  const upstream = await startUpstreamServer((req, res) => {
    assert.equal(req.url, "/api/tags");
    res.statusCode = 500;
    res.end("tags failed");
  });

  const baseDir = await makeWorkspaceTempDir("waypoi-provider-discovery-ollama-failure-test-");
  const paths = makePaths(baseDir);
  const app = Fastify();
  await registerAdminRoutes(app, paths, { adminToken: "test-token", version: "0.0.0" });
  const auth = { authorization: "Bearer test-token" };

  const createRes = await app.inject({
    method: "POST",
    url: "/admin/providers",
    headers: { ...auth, "content-type": "application/json" },
    payload: {
      id: "ollama-cloud",
      name: "Ollama Cloud",
      protocol: "ollama",
      baseUrl: `${upstream.baseUrl}/api`,
      enabled: true,
      supportsRouting: true,
    },
  });
  assert.equal(createRes.statusCode, 201);

  const discoveryRes = await app.inject({
    method: "POST",
    url: "/admin/providers/ollama-cloud/models/discover",
    headers: { ...auth, "content-type": "application/json" },
    payload: {},
  });
  assert.equal(discoveryRes.statusCode, 502);
  assert.match(
    JSON.stringify(discoveryRes.json()),
    /model discovery failed with status 500/
  );

  await app.close();
  await upstream.close();
});
