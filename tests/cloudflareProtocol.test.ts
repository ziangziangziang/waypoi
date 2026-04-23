import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { promises as fs } from "fs";
import { createServer } from "node:http";
import { Readable } from "stream";
import { cloudflareProtocolAdapter } from "../src/protocols/adapters/cloudflare";
import { getProtocolAdapter, listAllProtocolAdapters } from "../src/protocols/registry";
import { routeRequest } from "../src/routing/router";
import { saveProviderStore } from "../src/providers/repository";
import type { StoragePaths } from "../src/storage/files";
import type { ProviderRecord } from "../src/providers/types";

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

test("Cloudflare protocol adapter is registered and scoped to chat completions", async () => {
  const adapter = getProtocolAdapter("cloudflare");
  assert.equal(adapter, cloudflareProtocolAdapter);

  const metadata = listAllProtocolAdapters().find((item) => item.id === "cloudflare");
  assert.ok(metadata);
  assert.deepEqual(metadata.operations, ["chat_completions"]);
  assert.deepEqual(metadata.streamOperations, ["chat_completions"]);

  assert.deepEqual(
    cloudflareProtocolAdapter.supports({ operation: "chat_completions", stream: false }),
    { supported: true }
  );
  assert.deepEqual(
    cloudflareProtocolAdapter.supports({ operation: "embeddings", stream: false }),
    { supported: false, reason: "unsupported_operation" }
  );
});

test("Cloudflare protocol adapter forwards chat requests through the native /ai/v1 path", async () => {
  const request = await cloudflareProtocolAdapter.buildRequest({
    paths: {} as never,
    operation: "chat_completions",
    stream: false,
    path: "/v1/chat/completions",
    payload: {
      model: "@cf/meta/llama-3.1-8b-instruct",
      messages: [{ role: "user", content: "hello" }],
    },
    publicModel: "cloudflare/@cf/meta/llama-3.1-8b-instruct",
    upstreamModel: "@cf/meta/llama-3.1-8b-instruct",
    endpoint: {
      id: "endpoint",
      name: "cloudflare",
      baseUrl: "https://api.cloudflare.com/client/v4/accounts/demo-account/ai/v1",
      insecureTls: false,
      priority: 0,
      type: "llm",
      models: [],
      health: { status: "up", consecutiveFailures: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  assert.equal(
    request.path,
    "https://api.cloudflare.com/client/v4/accounts/demo-account/ai/v1/chat/completions"
  );
  assert.deepEqual(request.payload, {
    model: "@cf/meta/llama-3.1-8b-instruct",
    messages: [{ role: "user", content: "hello" }],
  });
});

test("Cloudflare chat routing uses the native protocol and succeeds", async () => {
  const upstream = await startUpstreamServer(async (req, res) => {
    assert.equal(req.url, "/client/v4/accounts/demo-account/ai/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer cf-secret");

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    assert.equal(body.model, "@cf/meta/llama-3.1-8b-instruct");
    assert.equal(body.messages[0]?.content, "hello");

    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1,
      model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });

  const baseDir = await makeWorkspaceTempDir("waypoi-cloudflare-route-test-");
  const paths = makePaths(baseDir);
  const provider: ProviderRecord = {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    protocol: "cloudflare",
    protocolRaw: "cloudflare",
    baseUrl: `${upstream.baseUrl}/client/v4/accounts/demo-account/ai/v1`,
    enabled: true,
    supportsRouting: true,
    auth: { type: "bearer" },
    apiKey: "cf-secret",
    models: [
      {
        providerModelId: "cloudflare/@cf/meta/llama-3.1-8b-instruct",
        providerId: "cloudflare",
        modelId: "@cf/meta/llama-3.1-8b-instruct",
        upstreamModel: "@cf/meta/llama-3.1-8b-instruct",
        free: true,
        modalities: ["text-to-text"],
        capabilities: { input: ["text"], output: ["text"], supportsStreaming: true, source: "configured" },
        endpointType: "llm",
        enabled: true,
        aliases: [],
      },
    ],
    importedAt: new Date().toISOString(),
  };
  await saveProviderStore(paths, [provider]);

  const controller = new AbortController();
  const outcome = await routeRequest(
    paths,
    "cloudflare/@cf/meta/llama-3.1-8b-instruct",
    "/v1/chat/completions",
    {
      model: "cloudflare/@cf/meta/llama-3.1-8b-instruct",
      messages: [{ role: "user", content: "hello" }],
    },
    {},
    controller.signal,
    { requiredInput: ["text"], requiredOutput: ["text"] }
  );

  const chunks: Buffer[] = [];
  for await (const chunk of outcome.attempt.response.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    choices: Array<{ message: { content: string } }>;
  };
  assert.equal(body.choices[0]?.message.content, "ok");

  await upstream.close();
});

test("Cloudflare unsupported operations fail before any upstream request", async () => {
  let requests = 0;
  const upstream = await startUpstreamServer((_req, res) => {
    requests += 1;
    res.statusCode = 500;
    res.end("unexpected");
  });

  const baseDir = await makeWorkspaceTempDir("waypoi-cloudflare-unsupported-test-");
  const paths = makePaths(baseDir);
  const provider: ProviderRecord = {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    protocol: "cloudflare",
    protocolRaw: "cloudflare",
    baseUrl: `${upstream.baseUrl}/client/v4/accounts/demo-account/ai/v1`,
    enabled: true,
    supportsRouting: true,
    auth: { type: "bearer" },
    apiKey: "cf-secret",
    models: [
      {
        providerModelId: "cloudflare/cf-embed",
        providerId: "cloudflare",
        modelId: "cf-embed",
        upstreamModel: "@cf/baai/bge-large-en-v1.5",
        free: true,
        modalities: ["text-to-embedding"],
        capabilities: { input: ["text"], output: ["embedding"], source: "configured" },
        endpointType: "embedding",
        enabled: true,
        aliases: [],
      },
    ],
    importedAt: new Date().toISOString(),
  };
  await saveProviderStore(paths, [provider]);

  await assert.rejects(
    () =>
      routeRequest(
        paths,
        "cloudflare/cf-embed",
        "/v1/embeddings",
        { model: "cloudflare/cf-embed", input: "hello" },
        {},
        new AbortController().signal,
        { endpointType: "embedding", requiredInput: ["text"], requiredOutput: ["embedding"] }
      ),
    (error: unknown) => {
      assert.equal((error as { type?: string }).type, "unsupported_operation");
      return true;
    }
  );
  assert.equal(requests, 0);

  await upstream.close();
});
