import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import os from "os";
import { promises as fs } from "fs";
import { shouldUseNativeImageRouteForModel } from "../src/services/imageGeneration";
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

test("DashScope image-edit capable models use the native image route", async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "waypoi-img-routing-"));
  const paths = makePaths(baseDir);
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
            apiKey: "sk-test",
            enabled: true,
            supportsRouting: true,
            importedAt: new Date().toISOString(),
            models: [
              {
                providerModelId: "alibaba-dashscope/qwen-image-2.0-pro",
                providerId: "alibaba-dashscope",
                modelId: "qwen-image-2.0-pro",
                upstreamModel: "qwen-image-2.0-pro",
                enabled: true,
                free: false,
                modalities: ["text-to-image", "image-to-image"],
                endpointType: "diffusion",
                capabilities: {
                  input: ["text", "image"],
                  output: ["image"],
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

  const result = await shouldUseNativeImageRouteForModel(
    paths,
    "alibaba-dashscope/qwen-image-2.0-pro"
  );

  assert.equal(result, true);
});
