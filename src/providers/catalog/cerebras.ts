import { ProviderCatalogSource } from "./types";

const cerebras: ProviderCatalogSource = {
  id: "cerebras",
  name: "Cerebras",
  description: "Ultra-fast inference with Wafer Scale Engine technology",
  docs: "https://cloud.cerebras.ai/platform/docs",
  auth: {
    type: "bearer",
    keyLabel: "Cerebras API Key",
    keyUrl: "https://cloud.cerebras.ai/platform/",
    keyPrefix: "csk-",
  },
  endpoint: {
    baseUrl: "https://api.cerebras.ai/v1",
    protocol: "openai",
  },
  limits: {
    requests: {
      perMinute: 30,
      perDay: 14400,
    },
    tokens: {
      perMinute: 60000,
      perDay: 1000000,
    },
  },
  env: "CEREBRAS_API_KEY",
  models: [
    {
      id: "zai-glm-4.7",
      upstream: "zai-glm-4.7",
      free: true,
      modalities: ["text-to-text"],
      contextWindow: 128000,
      maxOutputTokens: 8192,
      capabilities: { streaming: true, tools: true, vision: false, json: true },
      benchmark: { livebench: 58.09 },
    },
    {
      id: "qwen-3-235b-a22b-instruct-2507",
      upstream: "qwen-3-235b-a22b-instruct-2507",
      free: true,
      modalities: ["text-to-text"],
      contextWindow: 131072,
      maxOutputTokens: 16384,
      capabilities: { streaming: true, tools: true, vision: false, json: true },
      benchmark: { livebench: 48.84 },
    },
    {
      id: "gpt-oss-120b",
      upstream: "gpt-oss-120b",
      free: true,
      modalities: ["text-to-text"],
      contextWindow: 65536,
      maxOutputTokens: 8192,
      capabilities: { streaming: true, tools: true, vision: false, json: true },
      benchmark: { livebench: 46.09 },
    },
    {
      id: "llama3.1-8b",
      upstream: "llama3.1-8b",
      free: true,
      modalities: ["text-to-text"],
      contextWindow: 65536,
      maxOutputTokens: 8192,
      capabilities: { streaming: true, tools: true, vision: false, json: true },
      benchmark: { livebench: 28.0 },
    },
  ],
  discovery: {
    modelEndpoint: "/v1/models",
    authRequired: true,
    rateLimitHeaders: {
      "x-ratelimit-limit-requests-day": "Maximum requests per day ceiling",
      "x-ratelimit-limit-tokens-minute": "Maximum tokens per minute ceiling",
      "x-ratelimit-remaining-requests-day": "Requests remaining today",
      "x-ratelimit-remaining-tokens-minute": "Tokens remaining this minute",
      "x-ratelimit-reset-requests-day": "Seconds until daily request reset",
      "x-ratelimit-reset-tokens-minute": "Seconds until per-minute token reset",
    },
    probeEndpoint: "/chat/completions",
    probeMessages: [{ role: "user", content: "hi" }],
  },
};

export default cerebras;
