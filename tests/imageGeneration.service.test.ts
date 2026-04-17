import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import { promises as fs } from "fs";
import {
  materializeRemoteImageOutputs,
  normalizeChatImagePayload,
  normalizeImageGenerationPayload,
} from "../src/services/imageGeneration";
import { StoragePaths } from "../src/storage/files";

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

test("normalizeImageGenerationPayload preserves mixed url+b64 fields", async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "waypoi-img-norm-"));
  const result = await normalizeImageGenerationPayload(
    makePaths(baseDir),
    {
      created: 1730000000,
      data: [
        {
          url: "https://example.com/image.png",
          b64_json: "AAA",
          revised_prompt: "cat",
        },
      ],
    },
    "provider/model"
  );
  assert.equal(result.model, "provider/model");
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].url, "https://example.com/image.png");
  assert.equal(result.images[0].b64_json, "AAA");
  assert.equal(result.images[0].revised_prompt, "cat");
});

test("normalizeImageGenerationPayload adds data url when only b64_json exists", async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "waypoi-img-norm-"));
  const result = await normalizeImageGenerationPayload(
    makePaths(baseDir),
    {
      data: [{ b64_json: "BBB" }],
    },
    "smart"
  );
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].b64_json, "BBB");
  assert.equal(result.images[0].url, "data:image/png;base64,BBB");
});

test("normalizeImageGenerationPayload extracts b64 from data URL", async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "waypoi-img-norm-"));
  const result = await normalizeImageGenerationPayload(
    makePaths(baseDir),
    {
      data: [{ url: "data:image/png;base64,CCC" }],
    },
    "smart"
  );
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].b64_json, "CCC");
  assert.equal(result.images[0].url, "data:image/png;base64,CCC");
});

test("normalizeChatImagePayload converts chat multimodal image content", () => {
  const normalized = normalizeChatImagePayload({
    created: 1730000000,
    choices: [
      {
        message: {
          content: [
            { type: "text", text: "edited result" },
            { type: "image_url", image_url: { url: "data:image/png;base64,DDD" } },
          ],
        },
      },
    ],
  }) as {
    created: number;
    data: Array<{ url?: string; revised_prompt?: string }>;
  };
  assert.equal(normalized.created, 1730000000);
  assert.equal(normalized.data.length, 1);
  assert.equal(normalized.data[0].url, "data:image/png;base64,DDD");
  assert.equal(normalized.data[0].revised_prompt, "edited result");
});

test("normalizeChatImagePayload throws when chat payload has no image output", () => {
  assert.throws(
    () =>
      normalizeChatImagePayload({
        choices: [{ message: { content: [{ type: "text", text: "no image" }] } }],
      }),
    /did not return any image output/
  );
});

test("materializeRemoteImageOutputs rewrites local admin urls to /data urls", async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "waypoi-img-mat-"));
  const paths = makePaths(baseDir);
  const materialized = await materializeRemoteImageOutputs(
    paths,
    {
      data: [{ url: "/admin/images/abcdef0123456789" }],
    },
    "url"
  ) as {
    data: Array<{ url?: string }>;
  };

  assert.equal(materialized.data[0]?.url, "/data/images/abcdef0123456789");
});

test("materializeRemoteImageOutputs returns b64_json for cached local urls when requested", async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "waypoi-img-mat-"));
  const paths = makePaths(baseDir);
  const stored = await import("../src/storage/imageCache").then(({ storeMedia }) =>
    storeMedia(paths, "data:image/png;base64,AAA=")
  );

  const materialized = await materializeRemoteImageOutputs(
    paths,
    {
      data: [{ url: `/data/images/${stored.hash}` }],
    },
    "b64_json"
  ) as {
    data: Array<{ url?: string; b64_json?: string }>;
  };

  assert.equal(materialized.data[0]?.url, `/data/images/${stored.hash}`);
  assert.equal(materialized.data[0]?.b64_json, "AAA=");
});

test("materializeRemoteImageOutputs falls back to remote url when fetch returns non-image content", async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "waypoi-img-mat-"));
  const paths = makePaths(baseDir);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response("<!DOCTYPE html><html><body>blocked</body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    })) as typeof fetch;

  try {
    const materialized = await materializeRemoteImageOutputs(
      paths,
      {
        data: [{ url: "https://example.com/generated.png" }],
      },
      "b64_json"
    ) as {
      data: Array<{ url?: string; b64_json?: string }>;
    };

    assert.equal(materialized.data[0]?.url, "https://example.com/generated.png");
    assert.equal(materialized.data[0]?.b64_json, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
