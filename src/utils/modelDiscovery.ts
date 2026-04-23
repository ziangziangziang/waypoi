import { Agent, request } from "undici";
import { ModelCapabilities, ModelMapping, ModelModality } from "../types";
import { ProviderAuthConfig, ProviderProtocol } from "../providers/types";

export interface EndpointInfo {
  baseUrl: string;
  apiKey?: string;
  insecureTls: boolean;
  protocol?: ProviderProtocol;
  auth?: ProviderAuthConfig;
}

export async function resolveModelMappings(
  endpoint: EndpointInfo,
  mappings: ModelMapping[]
): Promise<ModelMapping[]> {
  let models: UpstreamModelInfo[] | null = null;
  try {
    models = await discoverUpstreamModels(endpoint);
  } catch {
    models = null;
  }
  if (!models || models.length === 0) {
    return mappings;
  }
  
  // If exactly one model, use it as the upstream for all mappings
  // that don't already have an explicit upstream different from the public name
  if (models.length === 1) {
    const sole = models[0];
    console.log(`[model-discovery] Single model found: ${sole.id}`);
    return mappings.map((mapping) => {
      // If user specified explicit upstream (public=upstream format), keep it
      // Otherwise, use the discovered model as upstream
      if (mapping.publicName !== mapping.upstreamModel) {
        // User specified explicit mapping, keep it
        return mapping;
      }
      // Public and upstream are the same (user just gave public name)
      // Replace upstream with discovered model
      console.log(`[model-discovery] Mapping ${mapping.publicName} -> ${sole.id}`);
      return {
        ...mapping,
        upstreamModel: sole.id,
        capabilities: mapping.capabilities ?? sole.capabilities,
      };
    });
  }
  
  // Multiple models - check if any mapping's upstream matches available models
  console.log(
    `[model-discovery] ${models.length} models found: ${models
      .slice(0, 5)
      .map((model) => model.id)
      .join(", ")}${models.length > 5 ? "..." : ""}`
  );
  const byId = new Map(models.map((model) => [model.id, model]));
  return mappings.map((mapping) => {
    if (mapping.capabilities) {
      return mapping;
    }
    const matched = byId.get(mapping.upstreamModel) ?? byId.get(mapping.publicName);
    if (!matched?.capabilities) {
      return mapping;
    }
    return {
      ...mapping,
      capabilities: matched.capabilities,
    };
  });
}

interface UpstreamModelInfo {
  id: string;
  capabilities?: ModelCapabilities;
}

export async function discoverUpstreamModels(endpoint: EndpointInfo): Promise<UpstreamModelInfo[]> {
  if (endpoint.protocol === "cloudflare") {
    return discoverCloudflareModels(endpoint);
  }
  if (endpoint.protocol === "ollama") {
    return discoverOllamaModels(endpoint);
  }
  if (endpoint.protocol === "gemini") {
    return discoverGeminiModels(endpoint);
  }
  const dispatcher = endpoint.insecureTls
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;
  const requests = buildGenericDiscoveryRequests(endpoint);
  let lastStatus: number | null = null;

  for (const candidate of requests) {
    const response = await request(candidate.url, {
      method: "GET",
      headersTimeout: 3000,
      bodyTimeout: 3000,
      dispatcher,
      headers: candidate.headers,
    });
    const body = (await readJson(response.body)) as DiscoveryBody | null;
    response.body.resume();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      lastStatus = response.statusCode;
      continue;
    }
    const models = extractDiscoveredModels(body);
    if (models.length > 0) {
      return models;
    }
    lastStatus = response.statusCode;
  }

  if (lastStatus !== null) {
    throw new Error(`model discovery failed with status ${lastStatus}`);
  }
  throw new Error("model discovery failed");
}

interface DiscoveryBody {
  data?: DiscoveryItem[];
  models?: Array<DiscoveryItem | OllamaTagItem | GeminiModelItem>;
  success?: boolean;
  result?: CloudflareSearchItem[];
  nextPageToken?: string;
}

interface DiscoveryItem {
  id?: string;
  name?: string;
  task?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  capabilities?: {
    input?: string[];
    output?: string[];
    supportsTools?: boolean;
    supportsStreaming?: boolean;
  };
}

interface CloudflareSearchItem {
  id?: string;
  name?: string;
  task?: {
    name?: string;
  };
  properties?: Array<{
    property_id?: string;
    value?: unknown;
  }>;
}

interface OllamaTagItem {
  name?: string;
  model?: string;
}

interface GeminiModelItem {
  name?: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}

async function discoverCloudflareModels(endpoint: EndpointInfo): Promise<UpstreamModelInfo[]> {
  const dispatcher = endpoint.insecureTls
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;
  const requestSpec = buildCloudflareDiscoveryRequest(endpoint);
  const response = await request(requestSpec.url, {
    method: "GET",
    headersTimeout: 3000,
    bodyTimeout: 3000,
    dispatcher,
    headers: requestSpec.headers,
  });
  const body = (await readJson(response.body)) as DiscoveryBody | null;
  response.body.resume();
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`model discovery failed with status ${response.statusCode}`);
  }
  const models = extractCloudflareSearchModels(body);
  if (models.length === 0) {
    throw new Error("model discovery failed");
  }
  return models;
}

async function discoverOllamaModels(endpoint: EndpointInfo): Promise<UpstreamModelInfo[]> {
  const dispatcher = endpoint.insecureTls
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;
  const requestSpec = buildOllamaDiscoveryRequest(endpoint);
  const response = await request(requestSpec.url, {
    method: "GET",
    headersTimeout: 3000,
    bodyTimeout: 3000,
    dispatcher,
    headers: requestSpec.headers,
  });
  const body = (await readJson(response.body)) as DiscoveryBody | null;
  response.body.resume();
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`model discovery failed with status ${response.statusCode}`);
  }
  const models = extractOllamaModels(body);
  if (models.length === 0) {
    throw new Error("model discovery failed");
  }
  return models;
}

async function discoverGeminiModels(endpoint: EndpointInfo): Promise<UpstreamModelInfo[]> {
  const dispatcher = endpoint.insecureTls
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;
  const models: UpstreamModelInfo[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 5; page += 1) {
    const requestSpec = buildGeminiDiscoveryRequest(endpoint, pageToken);
    const response = await request(requestSpec.url, {
      method: "GET",
      headersTimeout: 3000,
      bodyTimeout: 3000,
      dispatcher,
      headers: requestSpec.headers,
    });
    const body = (await readJson(response.body)) as DiscoveryBody | null;
    response.body.resume();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`model discovery failed with status ${response.statusCode}`);
    }
    models.push(...extractGeminiModels(body));
    pageToken = typeof body?.nextPageToken === "string" && body.nextPageToken.trim()
      ? body.nextPageToken.trim()
      : undefined;
    if (!pageToken) {
      break;
    }
  }

  if (models.length === 0) {
    throw new Error("model discovery failed");
  }
  return dedupeDiscoveredModels(models);
}

function buildGenericDiscoveryRequests(
  endpoint: EndpointInfo
): Array<{ url: string; headers: Record<string, string> }> {
  const authType = endpoint.auth?.type ?? "bearer";
  const headers: Record<string, string> = {};
  const apiKey = endpoint.apiKey?.trim();

  if (apiKey && authType === "query") {
    headers["x-waypoi-query-auth"] = apiKey;
  } else if (apiKey && authType === "header") {
    const headerName = endpoint.auth?.headerName?.trim() || endpoint.auth?.keyParam?.trim() || "x-api-key";
    const prefix = endpoint.auth?.keyPrefix?.trim();
    headers[headerName] = prefix ? `${prefix} ${apiKey}` : apiKey;
  } else if (apiKey && authType !== "none") {
    headers.authorization = `Bearer ${apiKey}`;
  }

  return buildGenericModelListUrls(endpoint.baseUrl).map((url) => {
    const next = new URL(url);
    const nextHeaders = { ...headers };
    if (headers["x-waypoi-query-auth"]) {
      const keyParam = endpoint.auth?.keyParam?.trim() || "api_key";
      next.searchParams.set(keyParam, headers["x-waypoi-query-auth"]);
      delete nextHeaders["x-waypoi-query-auth"];
    }
    return { url: next.toString(), headers: nextHeaders };
  });
}

function buildCloudflareDiscoveryRequest(
  endpoint: EndpointInfo
): { url: string; headers: Record<string, string> } {
  const parsed = new URL(endpoint.baseUrl);
  const pathname = parsed.pathname.replace(/\/+$/, "");
  const headers: Record<string, string> = {};

  const apiKey = endpoint.apiKey?.trim();
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const searchUrl = new URL(parsed.toString());
  searchUrl.pathname = pathname.endsWith("/ai/v1")
    ? `${pathname.slice(0, -3)}/models/search`
    : `${pathname}/models/search`;

  return {
    url: searchUrl.toString(),
    headers,
  };
}

function buildOllamaDiscoveryRequest(
  endpoint: EndpointInfo
): { url: string; headers: Record<string, string> } {
  const parsed = new URL(endpoint.baseUrl);
  const pathname = parsed.pathname.replace(/\/+$/, "");
  const headers: Record<string, string> = {};

  const apiKey = endpoint.apiKey?.trim();
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const tagsUrl = new URL(parsed.toString());
  tagsUrl.pathname = `${pathname}/tags`.replace(/\/{2,}/g, "/");

  return {
    url: tagsUrl.toString(),
    headers,
  };
}

function buildGeminiDiscoveryRequest(
  endpoint: EndpointInfo,
  pageToken?: string
): { url: string; headers: Record<string, string> } {
  const parsed = new URL(endpoint.baseUrl);
  const pathname = parsed.pathname.replace(/\/+$/, "");
  const headers: Record<string, string> = {};

  const apiKey = endpoint.apiKey?.trim();
  if (apiKey) {
    headers["x-goog-api-key"] = apiKey;
  }

  const modelsUrl = new URL(parsed.toString());
  modelsUrl.pathname = `${pathname}/models`.replace(/\/{2,}/g, "/");
  modelsUrl.searchParams.set("pageSize", "1000");
  if (pageToken) {
    modelsUrl.searchParams.set("pageToken", pageToken);
  }

  return {
    url: modelsUrl.toString(),
    headers,
  };
}

function buildGenericModelListUrls(baseUrl: string): string[] {
  const parsed = new URL(baseUrl);
  const pathname = parsed.pathname.replace(/\/+$/, "");
  const candidates: string[] = [];
  const seen = new Set<string>();

  const withPath = (nextPath: string): void => {
    const candidate = new URL(parsed.toString());
    candidate.pathname = nextPath;
    const url = candidate.toString();
    if (seen.has(url)) {
      return;
    }
    seen.add(url);
    candidates.push(url);
  };

  if (!pathname) {
    withPath("/v1/models");
    withPath("/models");
  } else if (pathname.endsWith("/v1")) {
    withPath(`${pathname}/models`);
    withPath(`${pathname.slice(0, -3) || ""}/models`.replace(/\/{2,}/g, "/"));
  } else {
    withPath(`${pathname}/v1/models`);
    withPath(`${pathname}/models`);
  }

  return candidates;
}

function extractDiscoveredModels(
  body: DiscoveryBody | DiscoveryItem[] | null
): UpstreamModelInfo[] {
  const list: DiscoveryItem[] = Array.isArray(body)
    ? body
    : Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body?.models)
        ? body.models.filter((item): item is DiscoveryItem => "task" in item || "id" in item || "capabilities" in item)
        : [];
  const models: UpstreamModelInfo[] = [];
  for (const item of list) {
    const id = selectDiscoveryModelId(item);
    if (!id) {
      continue;
    }
    const modelInfo: UpstreamModelInfo = { id };
    const capabilities = extractCapabilities(item);
    if (capabilities) {
      modelInfo.capabilities = capabilities;
    } else if (item.task === "embeddings") {
      modelInfo.capabilities = { input: ["text"], output: ["embedding"], source: "inferred" };
    } else if (item.task === "chat-completion") {
      modelInfo.capabilities = { input: ["text"], output: ["text"], source: "inferred" };
    }
    models.push(modelInfo);
  }
  return models;
}

function extractCloudflareSearchModels(body: DiscoveryBody | DiscoveryItem[] | null): UpstreamModelInfo[] {
  if (!body || Array.isArray(body) || !Array.isArray(body.result)) {
    return [];
  }

  const models: UpstreamModelInfo[] = [];
  for (const item of body.result) {
    const id = typeof item.name === "string" && item.name.trim() ? item.name.trim() : undefined;
    if (!id) {
      continue;
    }
    const taskName = item.task?.name?.trim().toLowerCase() ?? "";
    const propertyEntries: Array<[string, unknown]> = [];
    for (const property of Array.isArray(item.properties) ? item.properties : []) {
      const propertyId = typeof property.property_id === "string" ? property.property_id.trim() : "";
      if (!propertyId) {
        continue;
      }
      propertyEntries.push([propertyId, property.value]);
    }
    const properties = new Map<string, unknown>(propertyEntries);

    const model: UpstreamModelInfo = { id };
    const capabilities = inferCloudflareCapabilities(taskName, properties);
    if (!capabilities || !capabilities.output.includes("text")) {
      continue;
    }
    model.capabilities = capabilities;
    models.push(model);
  }

  return models;
}

function extractOllamaModels(body: DiscoveryBody | null): UpstreamModelInfo[] {
  if (!body || !Array.isArray(body.models)) {
    return [];
  }

  const models: UpstreamModelInfo[] = [];
  for (const item of body.models) {
    const id = extractOllamaModelId(item);
    if (!id) {
      continue;
    }
    models.push({
      id,
      capabilities: {
        input: ["text"],
        output: ["text"],
        supportsStreaming: true,
        source: "inferred",
      },
    });
  }
  return models;
}

function extractGeminiModels(body: DiscoveryBody | null): UpstreamModelInfo[] {
  if (!body || !Array.isArray(body.models)) {
    return [];
  }

  const models: UpstreamModelInfo[] = [];
  for (const item of body.models) {
    if (!("supportedGenerationMethods" in item) || !Array.isArray(item.supportedGenerationMethods)) {
      continue;
    }
    const id = extractGeminiModelId(item);
    if (!id) {
      continue;
    }
    const methods = item.supportedGenerationMethods
      .filter((method): method is string => typeof method === "string")
      .map((method) => method.trim());
    if (!methods.some((method) => method === "generateContent" || method === "streamGenerateContent")) {
      continue;
    }
    models.push({
      id,
      capabilities: {
        input: ["text"],
        output: ["text"],
        supportsStreaming: methods.includes("streamGenerateContent"),
        source: "inferred",
      },
    });
  }
  return models;
}

function inferCloudflareCapabilities(
  taskName: string,
  properties: Map<string, unknown>
): ModelCapabilities | undefined {
  if (taskName.includes("embedding")) {
    return { input: ["text"], output: ["embedding"], source: "inferred" };
  }
  if (
    taskName.includes("generation") ||
    taskName.includes("summarization") ||
    taskName.includes("translation") ||
    taskName.includes("classification")
  ) {
    return {
      input: ["text"],
      output: ["text"],
      supportsTools: hasCloudflareFunctionCalling(properties),
      supportsStreaming: hasCloudflareStreaming(properties),
      source: "inferred",
    };
  }
  if (taskName.includes("image-to-text")) {
    return { input: ["text", "image"], output: ["text"], source: "inferred" };
  }
  return undefined;
}

function hasCloudflareFunctionCalling(properties: Map<string, unknown>): boolean | undefined {
  if (!properties.has("function_calling")) {
    return undefined;
  }
  return truthyCloudflareProperty(properties.get("function_calling"));
}

function hasCloudflareStreaming(properties: Map<string, unknown>): boolean | undefined {
  if (properties.has("streaming")) {
    return truthyCloudflareProperty(properties.get("streaming"));
  }
  return undefined;
}

function truthyCloudflareProperty(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return false;
}

function selectDiscoveryModelId(item: DiscoveryItem): string | undefined {
  if (item.id && !item.id.startsWith("azureml://")) {
    return item.id;
  }
  if (typeof item.name === "string" && item.name.trim()) {
    return item.name.trim();
  }
  return item.id;
}

function extractOllamaModelId(item: DiscoveryItem | OllamaTagItem): string | undefined {
  if (typeof item.name === "string" && item.name.trim()) {
    return item.name.trim();
  }
  if ("model" in item && typeof item.model === "string" && item.model.trim()) {
    return item.model.trim();
  }
  return undefined;
}

function extractGeminiModelId(item: DiscoveryItem | OllamaTagItem | GeminiModelItem): string | undefined {
  const name = "name" in item && typeof item.name === "string" ? item.name.trim() : "";
  if (name.startsWith("models/")) {
    return name.slice("models/".length);
  }
  if (name.length > 0) {
    return name;
  }
  return undefined;
}

function extractCapabilities(item: DiscoveryItem): ModelCapabilities | undefined {
  const fromCapabilities = item.capabilities;
  if (fromCapabilities?.input && fromCapabilities?.output) {
    const input = normalizeModalities(fromCapabilities.input);
    const output = normalizeModalities(fromCapabilities.output);
    if (input.length > 0 && output.length > 0) {
      return {
        input,
        output,
        supportsTools: fromCapabilities.supportsTools,
        supportsStreaming: fromCapabilities.supportsStreaming,
        source: "inferred",
      };
    }
  }

  const input = normalizeModalities(item.input_modalities ?? []);
  const output = normalizeModalities(item.output_modalities ?? []);
  if (input.length > 0 && output.length > 0) {
    return { input, output, source: "inferred" };
  }

  return undefined;
}

function normalizeModalities(values: string[]): ModelModality[] {
  const normalized = new Set<ModelModality>();
  for (const value of values) {
    const lower = value.toLowerCase();
    if (lower === "text" || lower === "image" || lower === "audio" || lower === "embedding") {
      normalized.add(lower);
    }
  }
  return Array.from(normalized);
}

async function readJson(stream: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return null;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function dedupeDiscoveredModels(models: UpstreamModelInfo[]): UpstreamModelInfo[] {
  const byId = new Map<string, UpstreamModelInfo>();
  for (const model of models) {
    if (!byId.has(model.id)) {
      byId.set(model.id, model);
    }
  }
  return Array.from(byId.values());
}
