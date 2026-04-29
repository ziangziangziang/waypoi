import { promises as fs } from "fs";
import path from "path";
import YAML from "yaml";
import { canonicalizeProtocol, hasProtocolAdapter } from "../protocols/registry";
import {
  ProviderAuthConfig,
  ProviderCatalogEntry,
  ProviderCatalogModelMatch,
  ProviderCatalogModelSummary,
  ProviderCatalogPreset,
  ProviderLimits,
  ProviderProtocol,
  ProviderProtocolConfig,
} from "./types";
import { listAllProviders } from "./catalog/index";
import type { ProviderCatalogSource, CatalogModelEntry } from "./catalog/types";

interface RegistryFile {
  providers?: Array<{
    id?: string;
    name?: string;
    file?: string;
    free?: boolean;
    protocol?: string;
  }>;
}

interface ProviderConfigFile {
  $id?: string;
  name?: string;
  description?: string;
  docs?: string;
  env?: string;
  accountIdEnv?: string;
  autoInsecureTlsDomains?: string[];
  auth?: {
    type?: string;
    keyParam?: string;
    headerName?: string;
    keyPrefix?: string;
  };
  endpoint?: {
    baseUrl?: string;
    protocol?: string;
    insecureTls?: boolean;
    router?: string;
    responseTextPaths?: string[];
  };
  limits?: ProviderLimits;
  models?: Array<{
    id?: string;
    upstream?: string;
    free?: boolean;
    modalities?: string[];
    benchmark?: {
      livebench?: number;
    };
    capabilities?: {
      tools?: boolean;
      streaming?: boolean;
      vision?: boolean;
    };
  }>;
}

export type CatalogSourceType = "ts" | "yaml" | "free" | "file";

export interface CatalogLoadOptions {
  source?: string;
}

interface CatalogIndex {
  entries: ProviderCatalogEntry[];
  byId: Map<string, ProviderCatalogEntry>;
}

function getReferencesDir(): string {
  return path.resolve(process.cwd(), "references");
}

function getRegistryPath(): string {
  return path.join(getReferencesDir(), "registry.yaml");
}

export async function listProviderCatalog(options: CatalogLoadOptions = {}): Promise<ProviderCatalogEntry[]> {
  const { entries } = await loadProviderCatalogIndex(options);
  return entries;
}

export async function getProviderCatalogEntry(
  providerId: string,
  options: CatalogLoadOptions = {}
): Promise<ProviderCatalogEntry | null> {
  const { byId } = await loadProviderCatalogIndex(options);
  return byId.get(providerId) ?? null;
}

export function matchCatalogModel(
  entry: ProviderCatalogEntry | null,
  modelId: string
): ProviderCatalogModelMatch | null {
  if (!entry) {
    return null;
  }
  const normalized = modelId.trim();
  if (!normalized) {
    return null;
  }
  return (
    entry.models.find((model) => model.id === normalized || model.upstreamModel === normalized) ??
    null
  );
}

async function loadProviderCatalogIndex(options: CatalogLoadOptions): Promise<CatalogIndex> {
  const sourceType = options.source?.trim().toLowerCase() || "free";

  if (sourceType === "yaml" || sourceType === "file") {
    return await loadFromYaml(sourceType);
  }

  if (sourceType === "free" || sourceType === "ts") {
    return await loadFromTypeScript();
  }

  return { entries: [], byId: new Map() };
}

async function loadFromTypeScript(): Promise<CatalogIndex> {
  const tsSources = listAllProviders();
  const entries: ProviderCatalogEntry[] = [];

  for (const source of tsSources) {
    entries.push(toCatalogEntryFromSource(source));
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  return {
    entries,
    byId: new Map(entries.map((entry) => [entry.id, entry])),
  };
}

async function loadFromYaml(_sourceType: string): Promise<CatalogIndex> {
  const registryRaw = await fs.readFile(getRegistryPath(), "utf8");
  const registry = (YAML.parse(registryRaw) ?? {}) as RegistryFile;
  const referencesDir = getReferencesDir();

  const entries = (
    await Promise.all(
      (registry.providers ?? []).map(async (provider) => {
        if (!provider?.id || !provider.file) {
          return null;
        }
        const configPath = path.resolve(referencesDir, provider.file);
        const configRaw = await fs.readFile(configPath, "utf8");
        const config = (YAML.parse(configRaw) ?? {}) as ProviderConfigFile;
        return toCatalogEntryFromYaml(provider, config);
      })
    )
  )
    .filter((entry): entry is ProviderCatalogEntry => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    entries,
    byId: new Map(entries.map((entry) => [entry.id, entry])),
  };
}

function toCatalogEntryFromSource(source: ProviderCatalogSource): ProviderCatalogEntry {
  const sourceModels = source.models;
  const filteredModels = sourceModels
    .filter((model): model is CatalogModelEntry & { id: string } => Boolean(model.id) && isCatalogModelSupportedTS(source.id, model))
    .filter((model): model is CatalogModelEntry & { id: string } => Boolean(model.id))
    .map((model) => ({
      id: model.id,
      upstreamModel: model.upstream,
      free: model.free !== false,
      capabilities: capabilitiesFromModalities(model.modalities, model.capabilities),
      benchmark: typeof model.benchmark?.livebench === "number" ? { livebench: model.benchmark.livebench } : undefined,
      supportsTools: model.capabilities?.tools === true,
      supportsStreaming: model.capabilities?.streaming === true,
      supportsVision: model.capabilities?.vision === true,
    }));

  const modelSummary: ProviderCatalogModelSummary = {
    total: filteredModels.length,
    free: filteredModels.filter((model) => model.free).length,
    benchmarked: filteredModels.filter((model) => typeof model.benchmark?.livebench === "number").length,
  };

  const protocolConfig = parseProtocolConfigFromSource(source);
  const supportsRouting = hasProtocolAdapter(source.endpoint.protocol) && !(source.endpoint.protocol === "inference_v2" && !protocolConfig?.router);
  const readiness = supportsRouting ? "ready" : "unsupported";

  return {
    id: source.id,
    source: "free",
    name: source.name,
    description: source.description,
    docs: source.docs,
    free: true,
    readiness,
    protocol: source.endpoint.protocol,
    protocolRaw: source.endpoint.protocol,
    modelSummary,
    limits: summarizeLimits(source.limits),
    preset: {
      id: source.id,
      name: source.name,
      description: source.description,
      docs: source.docs,
      protocol: source.endpoint.protocol,
      protocolRaw: source.endpoint.protocol,
      protocolConfig,
      baseUrl: resolveBaseUrlFromSource(source),
      insecureTls: source.endpoint.insecureTls,
      supportsRouting,
      auth: {
        type: source.auth.type as ProviderAuthConfig["type"],
        keyParam: source.auth.keyParam,
        headerName: undefined,
        keyPrefix: source.auth.keyPrefix,
      },
      envVar: source.env,
      limits: source.limits,
    },
    models: filteredModels,
  };
}

function toCatalogEntryFromYaml(
  provider: NonNullable<RegistryFile["providers"]>[number],
  config: ProviderConfigFile
): ProviderCatalogEntry {
  const providerId = config.$id ?? provider.id ?? "unknown";
  const protocolRaw = (config.endpoint?.protocol ?? provider.protocol ?? "unknown").trim().toLowerCase();
  const canonical = canonicalizeProtocol(protocolRaw);
  const protocol: ProviderProtocol =
    canonical === "openai" ||
    canonical === "inference_v2" ||
    canonical === "dashscope" ||
    canonical === "cloudflare" ||
    canonical === "ollama" ||
    canonical === "gemini"
      ? canonical
      : "unknown";
  const protocolConfig = parseProtocolConfig(config, protocol);
  const supportsRouting = hasProtocolAdapter(protocol) && !(protocol === "inference_v2" && !protocolConfig?.router);
  const readiness = supportsRouting ? "ready" : "unsupported";
  const free = provider.free !== false;
  const models = (config.models ?? [])
    .filter((model) => isCatalogModelSupported(providerId, model))
    .filter((model): model is NonNullable<ProviderConfigFile["models"]>[number] & { id: string } => Boolean(model?.id))
    .map((model) => ({
      id: model.id,
      upstreamModel: model.upstream ?? model.id,
      free: model.free !== false,
      capabilities: capabilitiesFromModalities(model.modalities, model.capabilities),
      benchmark: typeof model.benchmark?.livebench === "number" ? { livebench: model.benchmark.livebench } : undefined,
      supportsTools: model.capabilities?.tools === true,
      supportsStreaming: model.capabilities?.streaming === true,
      supportsVision: model.capabilities?.vision === true,
    }));
  const summary: ProviderCatalogModelSummary = {
    total: models.length,
    free: models.filter((model) => model.free).length,
    benchmarked: models.filter((model) => typeof model.benchmark?.livebench === "number").length,
  };

  return {
    id: config.$id ?? provider.id ?? "unknown",
    source: "free",
    name: config.name ?? provider.name ?? provider.id ?? "unknown",
    description: config.description,
    docs: config.docs,
    free,
    readiness,
    protocol,
    protocolRaw,
    modelSummary: summary,
    limits: summarizeLimits(config.limits),
    preset: {
      id: providerId,
      name: config.name ?? provider.name ?? provider.id ?? "unknown",
      description: config.description,
      docs: config.docs,
      protocol,
      protocolRaw,
      protocolConfig,
      baseUrl: resolveBaseUrl(config),
      insecureTls: config.endpoint?.insecureTls === true,
      autoInsecureTlsDomains: normalizeStringArray(config.autoInsecureTlsDomains),
      supportsRouting,
      auth: parseAuthConfig(config.auth),
      envVar: typeof config.env === "string" ? config.env : undefined,
      limits: config.limits,
    },
    models,
  };
}

function resolveBaseUrlFromSource(source: ProviderCatalogSource): string {
  const raw = source.endpoint.baseUrl.trim();
  if (!raw.includes("{ACCOUNT_ID}") || !source.accountIdEnv) {
    return raw;
  }
  const accountId = process.env[source.accountIdEnv];
  return accountId ? raw.replaceAll("{ACCOUNT_ID}", accountId) : raw;
}

function parseProtocolConfigFromSource(source: ProviderCatalogSource): ProviderProtocolConfig | undefined {
  if (source.endpoint.protocol !== "inference_v2") {
    return undefined;
  }
  const router = (source.endpoint as typeof source.endpoint & { router?: string }).router;
  const responseTextPaths = (source.endpoint as typeof source.endpoint & { responseTextPaths?: string[] }).responseTextPaths;
  return {
    router: router && router.length > 0 ? router : undefined,
    responseTextPaths: (responseTextPaths || []).length > 0 ? responseTextPaths : undefined,
  };
}

function resolveBaseUrl(config: ProviderConfigFile): string {
  const raw = typeof config.endpoint?.baseUrl === "string" ? config.endpoint.baseUrl.trim() : "";
  if (!raw.includes("{ACCOUNT_ID}")) {
    return raw;
  }
  const envKey = typeof config.accountIdEnv === "string" ? config.accountIdEnv.trim() : "";
  const accountId = envKey ? process.env[envKey] : undefined;
  return accountId ? raw.replaceAll("{ACCOUNT_ID}", accountId) : raw;
}

function isCatalogModelSupportedTS(
  providerId: string,
  model: CatalogModelEntry
): boolean {
  const modalities = Array.isArray(model.modalities) ? model.modalities : [];
  if (providerId === "cloudflare") {
    return (
      modalities.includes("text-to-text") &&
      (model.capabilities?.streaming === true || typeof model.benchmark?.livebench === "number")
    );
  }
  if (providerId === "ollama-cloud") {
    return modalities.includes("text-to-text");
  }
  return true;
}

type ModelLike = { modalities?: string[]; capabilities?: { streaming?: boolean }; benchmark?: { livebench?: number } };

function isCatalogModelSupported(
  providerId: string,
  model: ModelLike
): boolean {
  const modalities = normalizeStringArray(model.modalities);
  if (providerId === "cloudflare") {
    return (
      modalities.includes("text-to-text") &&
      (model.capabilities?.streaming === true || typeof model.benchmark?.livebench === "number")
    );
  }
  if (providerId === "ollama-cloud") {
    return modalities.includes("text-to-text");
  }
  return true;
}

function capabilitiesFromModalities(
  modalities: string[] | undefined,
  caps: NonNullable<NonNullable<ProviderConfigFile["models"]>[number]["capabilities"]> | undefined
): ProviderCatalogModelMatch["capabilities"] {
  if (!Array.isArray(modalities) || modalities.length === 0) {
    return undefined;
  }

  const input = new Set<"text" | "image" | "audio" | "embedding">();
  const output = new Set<"text" | "image" | "audio" | "embedding">();

  for (const modality of modalities) {
    switch (modality) {
      case "text-to-text":
        input.add("text");
        output.add("text");
        break;
      case "text-to-embedding":
        input.add("text");
        output.add("embedding");
        break;
      case "image-to-text":
        input.add("image");
        input.add("text");
        output.add("text");
        break;
      case "text-to-image":
        input.add("text");
        output.add("image");
        break;
      case "audio-to-text":
        input.add("audio");
        output.add("text");
        break;
      case "text-to-audio":
        input.add("text");
        output.add("audio");
        break;
    }
  }

  if (input.size === 0 || output.size === 0) {
    return undefined;
  }

  return {
    input: Array.from(input),
    output: Array.from(output),
    supportsTools: caps?.tools === true,
    supportsStreaming: caps?.streaming === true,
    source: "configured",
  };
}

function summarizeLimits(limits: ProviderLimits | undefined): ProviderCatalogEntry["limits"] {
  if (!limits) {
    return undefined;
  }
  return {
    requestsPerMinute: limits.requests?.perMinute,
    requestsPerDay: limits.requests?.perDay,
    tokensPerMinute: limits.tokens?.perMinute,
    tokensPerDay: limits.tokens?.perDay,
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function parseAuthConfig(
  auth?: ProviderConfigFile["auth"]
): ProviderAuthConfig | undefined {
  if (!auth || typeof auth !== "object") {
    return undefined;
  }
  const type = typeof auth.type === "string" ? auth.type.trim().toLowerCase() : "";
  if (!type || !["bearer", "query", "header", "none"].includes(type)) {
    return undefined;
  }
  return {
    type: type as ProviderAuthConfig["type"],
    keyParam: typeof auth.keyParam === "string" ? auth.keyParam : undefined,
    headerName: typeof auth.headerName === "string" ? auth.headerName : undefined,
    keyPrefix: typeof auth.keyPrefix === "string" ? auth.keyPrefix : undefined,
  };
}

function parseProtocolConfig(
  config: ProviderConfigFile,
  protocol: ProviderProtocol
): ProviderProtocolConfig | undefined {
  if (protocol !== "inference_v2") {
    return undefined;
  }
  const router =
    typeof config.endpoint?.router === "string"
      ? config.endpoint.router.trim()
      : undefined;
  const responseTextPaths = normalizeStringArray(config.endpoint?.responseTextPaths);
  return {
    router: router && router.length > 0 ? router : undefined,
    responseTextPaths: responseTextPaths.length > 0 ? responseTextPaths : undefined,
  };
}
