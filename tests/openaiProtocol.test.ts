import test from "node:test";
import assert from "node:assert/strict";
import { openAiProtocolAdapter } from "../src/protocols/adapters/openai";

function makeEndpoint(baseUrl: string) {
  return {
    id: "endpoint",
    name: "openai",
    baseUrl,
    insecureTls: false,
    priority: 0,
    type: "llm" as const,
    models: [],
    health: { status: "up" as const, consecutiveFailures: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function build(path: string, baseUrl: string) {
  return openAiProtocolAdapter.buildRequest({
    paths: {} as never,
    operation: "chat_completions",
    stream: false,
    path,
    payload: { model: "x", messages: [{ role: "user", content: "hi" }] },
    publicModel: "x",
    upstreamModel: "x",
    endpoint: makeEndpoint(baseUrl),
  });
}

test("OpenAI adapter preserves sub-paths in baseUrl (e.g. /radeon/api/v1)", async () => {
  const request = await build(
    "/v1/chat/completions",
    "https://developer.amd.com.cn/radeon/api/v1"
  );
  assert.equal(
    request.path,
    "https://developer.amd.com.cn/radeon/api/v1/chat/completions"
  );
});

test("OpenAI adapter keeps trailing-slash baseUrl sub-paths intact", async () => {
  const request = await build(
    "/v1/chat/completions",
    "https://developer.amd.com.cn/radeon/api/v1/"
  );
  assert.equal(
    request.path,
    "https://developer.amd.com.cn/radeon/api/v1/chat/completions"
  );
});

test("OpenAI adapter works with a standard OpenAI base URL", async () => {
  const request = await build("/v1/chat/completions", "https://api.openai.com/v1");
  assert.equal(request.path, "https://api.openai.com/v1/chat/completions");
});

test("OpenAI adapter appends /v1 for bare baseUrls lacking a prefix", async () => {
  const request = await build("/v1/chat/completions", "https://example.test");
  assert.equal(request.path, "https://example.test/v1/chat/completions");
});

test("OpenAI adapter maps other operations to their sub-paths", async () => {
  const embeddings = await build("/v1/embeddings", "https://developer.amd.com.cn/radeon/api/v1");
  assert.equal(embeddings.path, "https://developer.amd.com.cn/radeon/api/v1/embeddings");

  const images = await build(
    "/v1/images/generations",
    "https://developer.amd.com.cn/radeon/api/v1"
  );
  assert.equal(images.path, "https://developer.amd.com.cn/radeon/api/v1/images/generations");
});
