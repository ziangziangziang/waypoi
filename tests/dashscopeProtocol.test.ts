import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "stream";
import { gzipSync } from "zlib";
import { dashscopeProtocolAdapter } from "../src/protocols/adapters/dashscope";

test("DashScope image generation uses multimodal-generation payload", async () => {
  const request = await dashscopeProtocolAdapter.buildRequest({
    paths: {} as never,
    operation: "images_generation",
    stream: false,
    path: "/v1/images/generations",
    payload: {
      prompt: "draw a cat",
      size: "2048*2048",
      negative_prompt: "blurry",
    },
    publicModel: "alibaba-dashscope/qwen-image-2.0-pro",
    upstreamModel: "qwen-image-2.0-pro",
    endpoint: {} as never,
  });

  assert.equal(request.path, "/api/v1/services/aigc/multimodal-generation/generation");
  assert.deepEqual(request.payload, {
    model: "qwen-image-2.0-pro",
    input: {
      messages: [
        {
          role: "user",
          content: [{ text: "draw a cat" }],
        },
      ],
    },
    parameters: {
      n: 1,
      size: "2048*2048",
      watermark: false,
      prompt_extend: true,
      negative_prompt: "blurry",
    },
  });
});

test("DashScope image editing sends image inputs before text instruction", async () => {
  const request = await dashscopeProtocolAdapter.buildRequest({
    paths: {} as never,
    operation: "images_edits",
    stream: false,
    path: "/v1/images/edits",
    payload: {
      prompt: "edit this",
      images: ["https://example.com/a.png", "https://example.com/b.png"],
      size: "1024*1536",
      n: 2,
    },
    publicModel: "alibaba-dashscope/qwen-image-2.0-pro",
    upstreamModel: "qwen-image-2.0-pro",
    endpoint: {} as never,
  });

  assert.equal(request.path, "/api/v1/services/aigc/multimodal-generation/generation");
  assert.deepEqual(
    ((request.payload.input as { messages: Array<{ content: unknown[] }> }).messages[0] ?? {}).content,
    [
      { image: "https://example.com/a.png" },
      { image: "https://example.com/b.png" },
      { text: "edit this" },
    ]
  );
});

test("DashScope video generation emits Wan 2.7 media payload", async () => {
  const request = await dashscopeProtocolAdapter.buildRequest({
    paths: {} as never,
    operation: "video_generations",
    stream: false,
    path: "/v1/videos/generations",
    payload: {
      prompt: "animate it",
      image_url: "https://example.com/frame.png",
      audio_url: "https://example.com/drive.mp3",
      resolution: "720P",
      duration: 10,
    },
    publicModel: "alibaba-dashscope/wan2.7-i2v",
    upstreamModel: "wan2.7-i2v",
    endpoint: {} as never,
  });

  assert.equal(request.path, "/api/v1/services/aigc/video-generation/video-synthesis");
  assert.deepEqual(request.headers, { "X-DashScope-Async": "enable" });
  assert.deepEqual((request.payload.input as { media: unknown[] }).media, [
    { type: "first_frame", url: "https://example.com/frame.png" },
    { type: "driving_audio", url: "https://example.com/drive.mp3" },
  ]);
});

test("DashScope normalizes synchronous image responses", async () => {
  const normalized = await dashscopeProtocolAdapter.normalizeResponse?.({
    operation: "images_generation",
    stream: false,
    path: "/v1/images/generations",
    publicModel: "alibaba-dashscope/qwen-image-2.0-pro",
    upstreamModel: "qwen-image-2.0-pro",
    endpoint: {
      id: "endpoint",
      name: "dashscope",
      baseUrl: "https://dashscope-intl.aliyuncs.com",
      apiKey: "sk-test",
      insecureTls: false,
      priority: 0,
      type: "diffusion",
      models: [],
      health: { status: "up", consecutiveFailures: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    requestPayload: { prompt: "draw a cat" },
    upstreamResult: {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: Readable.from(
        JSON.stringify({
          output: {
            choices: [
              {
                message: {
                  content: [{ image: "https://example.com/result.png", type: "image" }],
                },
              },
            ],
          },
          usage: {
            width: 2048,
            height: 2048,
            image_count: 1,
          },
          request_id: "req-123",
        })
      ),
    },
  });

  assert.ok(normalized);
  const chunks: Buffer[] = [];
  for await (const chunk of normalized!.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const json = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    data: Array<{ url: string }>;
    usage: { image_count: number; size: string };
    dashscope_request_id: string;
  };

  assert.deepEqual(json.data, [{ url: "https://example.com/result.png" }]);
  assert.equal(json.usage.image_count, 1);
  assert.equal(json.usage.size, "2048*2048");
  assert.equal(json.dashscope_request_id, "req-123");
});

test("DashScope normalizes synchronous image responses without content type markers", async () => {
  const normalized = await dashscopeProtocolAdapter.normalizeResponse?.({
    operation: "images_generation",
    stream: false,
    path: "/v1/images/generations",
    publicModel: "alibaba-dashscope/qwen-image-2.0-pro",
    upstreamModel: "qwen-image-2.0-pro",
    endpoint: {
      id: "endpoint",
      name: "dashscope",
      baseUrl: "https://dashscope-intl.aliyuncs.com",
      apiKey: "sk-test",
      insecureTls: false,
      priority: 0,
      type: "diffusion",
      models: [],
      health: { status: "up", consecutiveFailures: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    requestPayload: { prompt: "draw a cat" },
    upstreamResult: {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: Readable.from(
        JSON.stringify({
          output: {
            choices: [
              {
                message: {
                  content: [{ image: "https://example.com/result-no-type.png" }],
                },
              },
            ],
          },
          usage: {
            width: 1024,
            height: 1024,
            image_count: 1,
          },
          request_id: "req-no-type",
        })
      ),
    },
  });

  assert.ok(normalized);
  const chunks: Buffer[] = [];
  for await (const chunk of normalized!.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const json = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    data: Array<{ url: string }>;
    usage: { image_count: number; size: string };
    dashscope_request_id: string;
  };

  assert.deepEqual(json.data, [{ url: "https://example.com/result-no-type.png" }]);
  assert.equal(json.usage.image_count, 1);
  assert.equal(json.usage.size, "1024*1024");
  assert.equal(json.dashscope_request_id, "req-no-type");
});

test("DashScope normalizes gzipped synchronous image responses", async () => {
  const normalized = await dashscopeProtocolAdapter.normalizeResponse?.({
    operation: "images_generation",
    stream: false,
    path: "/v1/images/generations",
    publicModel: "alibaba-dashscope/qwen-image-2.0-pro",
    upstreamModel: "qwen-image-2.0-pro",
    endpoint: {
      id: "endpoint",
      name: "dashscope",
      baseUrl: "https://dashscope-intl.aliyuncs.com",
      apiKey: "sk-test",
      insecureTls: false,
      priority: 0,
      type: "diffusion",
      models: [],
      health: { status: "up", consecutiveFailures: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    requestPayload: { prompt: "draw a cat" },
    upstreamResult: {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "content-length": "999",
      },
      body: Readable.from(
        gzipSync(
          JSON.stringify({
            output: {
              choices: [
                {
                  message: {
                    content: [{ image: "https://example.com/result.png", type: "image" }],
                  },
                },
              ],
            },
            usage: {
              width: 2048,
              height: 2048,
              image_count: 1,
            },
            request_id: "req-gzip",
          })
        )
      ),
    },
  });

  assert.ok(normalized);
  assert.equal(normalized?.headers["content-encoding"], undefined);
  assert.equal(normalized?.headers["content-length"], undefined);
  const chunks: Buffer[] = [];
  for await (const chunk of normalized!.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const json = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    data: Array<{ url: string }>;
    dashscope_request_id: string;
  };
  assert.deepEqual(json.data, [{ url: "https://example.com/result.png" }]);
  assert.equal(json.dashscope_request_id, "req-gzip");
});
