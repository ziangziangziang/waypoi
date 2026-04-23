import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { promises as fs } from "fs";
import { createServer } from "node:http";
import { ollamaProtocolAdapter } from "../src/protocols/adapters/ollama";
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

test("Ollama protocol adapter is registered and scoped to chat completions", async () => {
  const adapter = getProtocolAdapter("ollama");
  assert.equal(adapter, ollamaProtocolAdapter);

  const metadata = listAllProtocolAdapters().find((item) => item.id === "ollama");
  assert.ok(metadata);
  assert.deepEqual(metadata.operations, ["chat_completions"]);
  assert.deepEqual(metadata.streamOperations, ["chat_completions"]);

  assert.deepEqual(
    ollamaProtocolAdapter.supports({ operation: "chat_completions", stream: false }),
    { supported: true }
  );
  assert.deepEqual(
    ollamaProtocolAdapter.supports({ operation: "embeddings", stream: false }),
    { supported: false, reason: "unsupported_operation" }
  );
});

test("Ollama protocol adapter forwards chat requests through /api/chat", async () => {
  const request = await ollamaProtocolAdapter.buildRequest({
    paths: {} as never,
    operation: "chat_completions",
    stream: false,
    path: "/v1/chat/completions",
    payload: {
      model: "gpt-oss:120b",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    },
    publicModel: "ollama-cloud/gpt-oss:120b",
    upstreamModel: "gpt-oss:120b",
    endpoint: {
      id: "endpoint",
      name: "ollama",
      baseUrl: "https://ollama.com/api",
      insecureTls: false,
      priority: 0,
      type: "llm",
      models: [],
      health: { status: "up", consecutiveFailures: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  assert.equal(request.path, "https://ollama.com/api/chat");
  assert.deepEqual(request.payload, {
    model: "gpt-oss:120b",
    messages: [{ role: "user", content: "hello" }],
    stream: false,
  });
});

test("Ollama chat routing normalizes non-stream responses to OpenAI format", async () => {
  const upstream = await startUpstreamServer(async (req, res) => {
    assert.equal(req.url, "/api/chat");
    assert.equal(req.headers.authorization, "Bearer ollama-secret");

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    assert.equal(body.model, "gpt-oss:120b");
    assert.equal(body.stream, false);
    assert.equal(body.messages[0]?.content, "hello");

    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      model: body.model,
      created_at: "2026-04-20T12:00:00Z",
      message: { role: "assistant", content: "ok" },
      done: true,
      prompt_eval_count: 3,
      eval_count: 2,
    }));
  });

  const baseDir = await makeWorkspaceTempDir("waypoi-ollama-route-test-");
  const paths = makePaths(baseDir);
  const provider: ProviderRecord = {
    id: "ollama-cloud",
    name: "Ollama Cloud",
    protocol: "ollama",
    protocolRaw: "ollama",
    baseUrl: `${upstream.baseUrl}/api`,
    enabled: true,
    supportsRouting: true,
    auth: { type: "bearer" },
    apiKey: "ollama-secret",
    models: [
      {
        providerModelId: "ollama-cloud/gpt-oss:120b",
        providerId: "ollama-cloud",
        modelId: "gpt-oss:120b",
        upstreamModel: "gpt-oss:120b",
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

  const outcome = await routeRequest(
    paths,
    "ollama-cloud/gpt-oss:120b",
    "/v1/chat/completions",
    {
      model: "ollama-cloud/gpt-oss:120b",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    },
    {},
    new AbortController().signal,
    { requiredInput: ["text"], requiredOutput: ["text"] }
  );

  const chunks: Buffer[] = [];
  for await (const chunk of outcome.attempt.response.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    object: string;
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };
  assert.equal(body.object, "chat.completion");
  assert.equal(body.choices[0]?.message.content, "ok");
  assert.deepEqual(body.usage, {
    prompt_tokens: 3,
    completion_tokens: 2,
    total_tokens: 5,
  });

  await upstream.close();
});

test("Ollama chat routing normalizes streaming responses to OpenAI SSE", async () => {
  const upstream = await startUpstreamServer(async (req, res) => {
    assert.equal(req.url, "/api/chat");
    res.setHeader("content-type", "application/x-ndjson");
    res.write(
      `${JSON.stringify({
        model: "gpt-oss:120b",
        created_at: "2026-04-20T12:00:00Z",
        message: { role: "assistant", content: "Hel" },
        done: false,
      })}\n`
    );
    res.write(
      `${JSON.stringify({
        model: "gpt-oss:120b",
        created_at: "2026-04-20T12:00:01Z",
        message: { role: "assistant", content: "lo" },
        done: true,
        done_reason: "stop",
      })}\n`
    );
    res.end();
  });

  const baseDir = await makeWorkspaceTempDir("waypoi-ollama-stream-test-");
  const paths = makePaths(baseDir);
  const provider: ProviderRecord = {
    id: "ollama-cloud",
    name: "Ollama Cloud",
    protocol: "ollama",
    protocolRaw: "ollama",
    baseUrl: `${upstream.baseUrl}/api`,
    enabled: true,
    supportsRouting: true,
    auth: { type: "bearer" },
    apiKey: "ollama-secret",
    models: [
      {
        providerModelId: "ollama-cloud/gpt-oss:120b",
        providerId: "ollama-cloud",
        modelId: "gpt-oss:120b",
        upstreamModel: "gpt-oss:120b",
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

  const outcome = await routeRequest(
    paths,
    "ollama-cloud/gpt-oss:120b",
    "/v1/chat/completions",
    {
      model: "ollama-cloud/gpt-oss:120b",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    },
    {},
    new AbortController().signal,
    { requiredInput: ["text"], requiredOutput: ["text"] }
  );

  const chunks: Buffer[] = [];
  for await (const chunk of outcome.attempt.response.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  assert.match(text, /data: .*chat\.completion\.chunk/);
  assert.match(text, /"content":"Hel"/);
  assert.match(text, /"content":"lo"/);
  assert.match(text, /data: \[DONE\]/);

  await upstream.close();
});

test("Ollama unsupported operations fail before any upstream request", async () => {
  let requests = 0;
  const upstream = await startUpstreamServer((_req, res) => {
    requests += 1;
    res.statusCode = 500;
    res.end("unexpected");
  });

  const baseDir = await makeWorkspaceTempDir("waypoi-ollama-unsupported-test-");
  const paths = makePaths(baseDir);
  const provider: ProviderRecord = {
    id: "ollama-cloud",
    name: "Ollama Cloud",
    protocol: "ollama",
    protocolRaw: "ollama",
    baseUrl: `${upstream.baseUrl}/api`,
    enabled: true,
    supportsRouting: true,
    auth: { type: "bearer" },
    apiKey: "ollama-secret",
    models: [
      {
        providerModelId: "ollama-cloud/embed",
        providerId: "ollama-cloud",
        modelId: "embed",
        upstreamModel: "nomic-embed-text",
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
        "ollama-cloud/embed",
        "/v1/embeddings",
        { model: "ollama-cloud/embed", input: "hello" },
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
