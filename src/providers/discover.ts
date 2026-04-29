import { request } from "undici";
import { ProviderLimits, ProviderProtocol } from "./types";
import { listAllProviders, loadByProviderId } from "./catalog/index";
import type { ProviderCatalogSource, DiscoveryConfig } from "./catalog/types";

export interface DiscoveredModel {
  id: string;
  name: string;
}

export interface DiscoveryResult {
  providerId: string;
  providerName: string;
  models: DiscoveredModel[];
  rateLimits?: Record<string, ProviderLimits>;
  error?: string;
  timestamp: string;
}

export async function discoverProviderModels(
  providerId: string,
  options: { apiKey?: string } = {}
): Promise<DiscoveryResult> {
  const source = loadByProviderId(providerId);
  if (!source) {
    return {
      providerId,
      providerName: "Unknown",
      models: [],
      error: `Provider "${providerId}" not found in catalog`,
      timestamp: new Date().toISOString(),
    };
  }

  const discovery = source.discovery;
  if (!discovery || !discovery.modelEndpoint) {
    return {
      providerId,
      providerName: source.name,
      models: [],
      error: `Provider "${providerId}" does not support dynamic model discovery`,
      timestamp: new Date().toISOString(),
    };
  }

  const apiKey = options.apiKey || process.env[source.env];
  if (discovery.authRequired && !apiKey) {
    return {
      providerId,
      providerName: source.name,
      models: [],
      error: `API key required for "${providerId}". Set ${source.env} or pass --api-key`,
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const endpointUrl = new URL(discovery.modelEndpoint, source.endpoint.baseUrl).toString();
    const headers: Record<string, string> = {};

    if (apiKey) {
      if (source.auth.type === "query" && source.auth.keyParam) {
        const url = new URL(endpointUrl);
        url.searchParams.set(source.auth.keyParam, apiKey);
      } else {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
    }

    const response = await request(endpointUrl, {
      method: "GET",
      headers,
      headersTimeout: 10000,
      bodyTimeout: 30000,
    });

    response.body.resume();
    if (response.statusCode >= 400) {
      throw new Error(`HTTP ${response.statusCode} from ${endpointUrl}`);
    }

    const rawData = await response.body.text();
    const data = JSON.parse(rawData);

    const models = parseModelList(data, source);
    return {
      providerId: source.id,
      providerName: source.name,
      models,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      providerId: source.id,
      providerName: source.name,
      models: [],
      error: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    };
  }
}

export async function discoverProviderRateLimits(
  providerId: string,
  options: { apiKey?: string; modelId?: string } = {}
): Promise<DiscoveryResult> {
  const source = loadByProviderId(providerId);
  if (!source) {
    return {
      providerId,
      providerName: "Unknown",
      models: [],
      error: `Provider "${providerId}" not found in catalog`,
      timestamp: new Date().toISOString(),
    };
  }

  const discovery = source.discovery;
  if (!discovery || Object.keys(discovery.rateLimitHeaders).length === 0) {
    return {
      providerId,
      providerName: source.name,
      models: [],
      error: `Provider "${providerId}" does not expose rate limit headers`,
      timestamp: new Date().toISOString(),
    };
  }

  const apiKey = options.apiKey || process.env[source.env];
  if (discovery.authRequired && !apiKey) {
    return {
      providerId,
      providerName: source.name,
      models: [],
      error: `API key required for "${providerId}". Set ${source.env} or pass --api-key`,
      timestamp: new Date().toISOString(),
    };
  }

  const modelId = options.modelId || source.models[0]?.id;
  if (!modelId) {
    return {
      providerId,
      providerName: source.name,
      models: [],
      error: `No model available for probing on "${providerId}"`,
      timestamp: new Date().toISOString(),
    };
  }

  return probeRateLimits(source, modelId, apiKey, discovery);
}

async function probeRateLimits(
  source: ProviderCatalogSource,
  modelId: string,
  apiKey: string | undefined,
  discovery: DiscoveryConfig
): Promise<DiscoveryResult> {
  if (!discovery.probeEndpoint) {
    return {
      providerId: source.id,
      providerName: source.name,
      models: [],
      error: `No probe endpoint configured for "${source.id}"`,
      timestamp: new Date().toISOString(),
    };
  }

  const endpointUrl = new URL(discovery.probeEndpoint, source.endpoint.baseUrl).toString();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    if (source.auth.type === "query" && source.auth.keyParam) {
      const url = new URL(endpointUrl);
      url.searchParams.set(source.auth.keyParam, apiKey);
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
  }

  const body = JSON.stringify({
    model: modelId,
    messages: discovery.probeMessages || [{ role: "user", content: "hi" }],
    max_tokens: 1,
    stream: false,
  });

  try {
    const response = await request(endpointUrl, {
      method: "POST",
      headers,
      body,
      headersTimeout: 10000,
      bodyTimeout: 30000,
    });

    response.body.resume();

    const rateLimits = parseRateLimitHeaders(response.headers as unknown as Record<string, string | string[]>);

    return {
      providerId: source.id,
      providerName: source.name,
      models: [{ id: modelId, name: modelId }],
      rateLimits: rateLimits ? { [modelId]: rateLimits } : undefined,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      providerId: source.id,
      providerName: source.name,
      models: [],
      error: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    };
  }
}

function parseRateLimitHeaders(headers: Record<string, string | string[]>): ProviderLimits | null {
  const limits: ProviderLimits = {};

  for (const [header, value] of Object.entries(headers)) {
    const lower = header.toLowerCase();
    const num = Array.isArray(value) ? parseInt(value[0], 10) : parseInt(value as string, 10);
    if (isNaN(num)) continue;

    if (lower.includes("request") && lower.includes("day")) {
      if (!limits.requests) limits.requests = {};
      limits.requests.perDay = num;
    } else if (lower.includes("request") && lower.includes("minute")) {
      if (!limits.requests) limits.requests = {};
      limits.requests.perMinute = num;
    } else if (lower.includes("token") && lower.includes("minute")) {
      if (!limits.tokens) limits.tokens = {};
      limits.tokens.perMinute = num;
    } else if (lower.includes("token") && lower.includes("day")) {
      if (!limits.tokens) limits.tokens = {};
      limits.tokens.perDay = num;
    }
  }

  return Object.keys(limits).length > 0 ? limits : null;
}

function parseModelList(data: unknown, source: ProviderCatalogSource): DiscoveredModel[] {
  const protocol = source.endpoint.protocol;
  if (protocol === "openai" || protocol === "cloudflare") {
    const body = data as { data?: Array<{ id: string; name?: string }> };
    if (Array.isArray(body.data)) {
      return body.data.map((m) => ({ id: m.id, name: m.name || m.id }));
    }
    if (Array.isArray(data)) {
      return data.map((m: any) => ({ id: m.id || m.name, name: m.name || m.id }));
    }
  }

  if (protocol === "gemini") {
    const body = data as { models?: Array<{ name: string }> };
    if (Array.isArray(body.models)) {
      return body.models.map((m) => {
        const id = m.name.replace(/^models\//, "");
        return { id, name: id };
      });
    }
  }

  if (protocol === "ollama") {
    const body = data as { models?: Array<{ name: string }> };
    if (Array.isArray(body.models)) {
      return body.models.map((m) => ({ id: m.name, name: m.name }));
    }
  }

  const dataArr = data as Array<{ id?: string; name?: string; slug?: string }>;
  if (Array.isArray(dataArr)) {
    return dataArr.map((m) => ({ id: m.id || m.name || m.slug || "unknown", name: m.name || m.id || "unknown" }));
  }

  return [];
}

export function listDiscoverableProviders(): Array<{ id: string; name: string; canDiscoverModels: boolean; canProbeLimits: boolean }> {
  return listAllProviders()
    .filter((p) => p.discovery)
    .map((p) => ({
      id: p.id,
      name: p.name,
      canDiscoverModels: Boolean(p.discovery?.modelEndpoint),
      canProbeLimits: Object.keys(p.discovery?.rateLimitHeaders || {}).length > 0,
    }));
}

export { ProviderLimits };
