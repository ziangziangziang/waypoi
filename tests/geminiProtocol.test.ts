import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { promises as fs } from "fs";
import { createServer } from "node:http";
import { geminiProtocolAdapter } from "../src/protocols/adapters/gemini";
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

test("Gemini protocol adapter is registered and scoped to chat completions", async () => {
  const adapter = getProtocolAdapter("gemini");
  assert.equal(adapter, geminiProtocolAdapter);

  const metadata = listAllProtocolAdapters().find((item) => item.id === "gemini");
  assert.ok(metadata);
  assert.deepEqual(metadata.operations, ["chat_completions"]);
  assert.deepEqual(metadata.streamOperations, ["chat_completions"]);

  assert.deepEqual(
    geminiProtocolAdapter.supports({ operation: "chat_completions", stream: false }),
    { supported: true }
  );
  assert.deepEqual(
    geminiProtocolAdapter.supports({ operation: "embeddings", stream: false }),
    { supported: false, reason: "unsupported_operation" }
  );
});

test("Gemini protocol adapter builds native generateContent requests with system and vision parts", async () => {
  const request = await geminiProtocolAdapter.buildRequest({
    paths: {} as never,
    operation: "chat_completions",
    stream: false,
    path: "/v1/chat/completions",
    payload: {
      model: "gemini-3-flash-preview",
      messages: [
        { role: "system", content: "Be brief." },
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image" },
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,ZmFrZQ==",
              },
            },
          ],
        },
      ],
      max_tokens: 128,
    },
    publicModel: "gemini/gemini-3-flash-preview",
    upstreamModel: "gemini-3-flash-preview",
    endpoint: {
      id: "endpoint",
      name: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "gemini-secret",
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
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent"
  );
  assert.equal(request.headers?.["x-goog-api-key"], "gemini-secret");
  assert.equal(request.skipDefaultAuth, true);
  assert.deepEqual(request.payload, {
    contents: [
      {
        role: "user",
        parts: [
          { text: "Describe this image" },
          {
            inlineData: {
              mimeType: "image/png",
              data: "ZmFrZQ==",
            },
          },
        ],
      },
    ],
    systemInstruction: {
      parts: [{ text: "Be brief." }],
    },
    generationConfig: {
      maxOutputTokens: 128,
    },
  });
});

test("Gemini chat routing normalizes non-stream responses to OpenAI format", async () => {
  const upstream = await startUpstreamServer(async (req, res) => {
    assert.equal(req.url, "/v1beta/models/gemini-3-flash-preview:generateContent");
    assert.equal(req.headers["x-goog-api-key"], "gemini-secret");

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      contents: Array<{ role: string; parts: Array<{ text?: string; inlineData?: { mimeType: string } }> }>;
      systemInstruction?: { parts: Array<{ text: string }> };
    };
    assert.equal(body.systemInstruction?.parts[0]?.text, "Be brief.");
    assert.equal(body.contents[0]?.parts[0]?.text, "hello");
    assert.equal(body.contents[0]?.parts[1]?.inlineData?.mimeType, "image/png");

    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      modelVersion: "gemini-3-flash-preview",
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "ok" }],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 4,
        candidatesTokenCount: 2,
        totalTokenCount: 6,
      },
    }));
  });

  const baseDir = await makeWorkspaceTempDir("waypoi-gemini-route-test-");
  const paths = makePaths(baseDir);
  const provider: ProviderRecord = {
    id: "gemini",
    name: "Google AI Studio (Gemini)",
    protocol: "gemini",
    protocolRaw: "gemini",
    baseUrl: `${upstream.baseUrl}/v1beta`,
    enabled: true,
    supportsRouting: true,
    auth: { type: "query", keyParam: "key" },
    apiKey: "gemini-secret",
    models: [
      {
        providerModelId: "gemini/gemini-3-flash-preview",
        providerId: "gemini",
        modelId: "gemini-3-flash-preview",
        upstreamModel: "gemini-3-flash-preview",
        free: true,
        modalities: ["text-to-text", "image-to-text"],
        capabilities: { input: ["text", "image"], output: ["text"], supportsStreaming: true, source: "configured" },
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
    "gemini/gemini-3-flash-preview",
    "/v1/chat/completions",
    {
      model: "gemini/gemini-3-flash-preview",
      messages: [
        { role: "system", content: "Be brief." },
        {
          role: "user",
          content: [
            { type: "text", text: "hello" },
            { type: "image_url", image_url: { url: "data:image/png;base64,ZmFrZQ==" } },
          ],
        },
      ],
      stream: false,
    },
    {},
    new AbortController().signal,
    { requiredInput: ["text", "image"], requiredOutput: ["text"] }
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
    prompt_tokens: 4,
    completion_tokens: 2,
    total_tokens: 6,
  });

  await upstream.close();
});

test("Gemini chat routing normalizes streaming responses to OpenAI SSE", async () => {
  const upstream = await startUpstreamServer(async (req, res) => {
    assert.equal(req.url, "/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse");
    assert.equal(req.headers["x-goog-api-key"], "gemini-secret");
    res.setHeader("content-type", "text/event-stream");
    res.write(
      `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Hel" }] } }],
        modelVersion: "gemini-3-flash-preview",
      })}\n\n`
    );
    res.write(
      `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: "lo" }] }, finishReason: "STOP" }],
        modelVersion: "gemini-3-flash-preview",
      })}\n\n`
    );
    res.end();
  });

  const baseDir = await makeWorkspaceTempDir("waypoi-gemini-stream-test-");
  const paths = makePaths(baseDir);
  const provider: ProviderRecord = {
    id: "gemini",
    name: "Google AI Studio (Gemini)",
    protocol: "gemini",
    protocolRaw: "gemini",
    baseUrl: `${upstream.baseUrl}/v1beta`,
    enabled: true,
    supportsRouting: true,
    auth: { type: "query", keyParam: "key" },
    apiKey: "gemini-secret",
    models: [
      {
        providerModelId: "gemini/gemini-3-flash-preview",
        providerId: "gemini",
        modelId: "gemini-3-flash-preview",
        upstreamModel: "gemini-3-flash-preview",
        free: true,
        modalities: ["text-to-text", "image-to-text"],
        capabilities: { input: ["text", "image"], output: ["text"], supportsStreaming: true, source: "configured" },
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
    "gemini/gemini-3-flash-preview",
    "/v1/chat/completions",
    {
      model: "gemini/gemini-3-flash-preview",
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

test("Gemini unsupported operations fail before any upstream request", async () => {
  let requests = 0;
  const upstream = await startUpstreamServer((_req, res) => {
    requests += 1;
    res.statusCode = 500;
    res.end("unexpected");
  });

  const baseDir = await makeWorkspaceTempDir("waypoi-gemini-unsupported-test-");
  const paths = makePaths(baseDir);
  const provider: ProviderRecord = {
    id: "gemini",
    name: "Google AI Studio (Gemini)",
    protocol: "gemini",
    protocolRaw: "gemini",
    baseUrl: `${upstream.baseUrl}/v1beta`,
    enabled: true,
    supportsRouting: true,
    auth: { type: "query", keyParam: "key" },
    apiKey: "gemini-secret",
    models: [
      {
        providerModelId: "gemini/embed",
        providerId: "gemini",
        modelId: "embed",
        upstreamModel: "text-embedding-004",
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
        "gemini/embed",
        "/v1/embeddings",
        { model: "gemini/embed", input: "hello" },
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
