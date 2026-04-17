import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import os from "os";
import { IncomingMessage } from "http";
import { promises as fs } from "fs";
import {
  buildRealtimeUpstreamUrl,
  buildUpstreamHandshake,
  resolveRealtimeCandidate,
} from "../src/routes/realtime";
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

async function writeRealtimeProviderFixture(paths: StoragePaths): Promise<void> {
  await fs.writeFile(
    paths.providersPath,
    JSON.stringify(
      {
        version: 3,
        updatedAt: new Date().toISOString(),
        providers: [
          {
            id: "alibaba-dashscope",
            name: "Alibaba Cloud Model Studio",
            protocol: "dashscope",
            baseUrl: "https://dashscope-intl.aliyuncs.com",
            apiKey: "sk-provider",
            enabled: true,
            supportsRouting: true,
            importedAt: new Date().toISOString(),
            models: [
              {
                providerModelId: "alibaba-dashscope/qwen3-asr-flash-realtime",
                providerId: "alibaba-dashscope",
                modelId: "qwen3-asr-flash-realtime",
                upstreamModel: "qwen3-asr-flash-realtime",
                enabled: true,
                free: false,
                modalities: ["audio-to-text"],
                endpointType: "audio",
                capabilities: {
                  input: ["audio"],
                  output: ["text"],
                  source: "configured",
                },
                aliases: [],
              },
            ],
          },
        ],
      },
      null,
      2
    ),
    "utf8"
  );
}

test("resolveRealtimeCandidate selects a DashScope realtime ASR model", async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "waypoi-realtime-route-"));
  const paths = makePaths(baseDir);
  await writeRealtimeProviderFixture(paths);

  const candidate = await resolveRealtimeCandidate(
    paths,
    "alibaba-dashscope/qwen3-asr-flash-realtime"
  );

  assert.ok(candidate);
  assert.equal(candidate?.protocol, "dashscope");
  assert.equal(candidate?.endpointType, "audio");
  assert.equal(candidate?.upstreamModel, "qwen3-asr-flash-realtime");
});

test("buildRealtimeUpstreamUrl converts provider base URL to ws endpoint and preserves query", () => {
  const upstream = buildRealtimeUpstreamUrl(
    "https://dashscope-intl.aliyuncs.com",
    "/api-ws/v1/realtime?model=qwen3-asr-flash-realtime"
  );

  assert.equal(upstream.toString(), "wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime");
});

test("buildUpstreamHandshake forwards websocket and auth headers", () => {
  const request = {
    headers: {
      host: "localhost:9469",
      upgrade: "websocket",
      connection: "Upgrade",
      "sec-websocket-key": "abc123",
      "sec-websocket-version": "13",
      "openai-beta": "realtime=v1",
    },
  } as IncomingMessage;

  const handshake = buildUpstreamHandshake(
    request,
    new URL("wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime"),
    "Bearer sk-provider"
  );

  assert.match(handshake, /^GET \/api-ws\/v1\/realtime\?model=qwen3-asr-flash-realtime HTTP\/1\.1/m);
  assert.match(handshake, /Host: dashscope-intl.aliyuncs.com/m);
  assert.match(handshake, /Authorization: Bearer sk-provider/m);
  assert.match(handshake, /openai-beta: realtime=v1/i);
  assert.match(handshake, /sec-websocket-key: abc123/i);
});
