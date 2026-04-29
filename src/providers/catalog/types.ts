import { ProviderAuthConfig, ProviderLimits, ProviderProtocol, ProviderProtocolConfig, ProviderCatalogEntry, ProviderCatalogModelMatch, ProviderCatalogPreset } from "../types";

export interface CatalogModelEntry {
  id: string;
  upstream: string;
  free: boolean;
  type?: string;
  modalities: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: {
    streaming: boolean;
    tools: boolean;
    vision: boolean;
    json: boolean;
  };
  benchmark?: {
    livebench: number;
  };
  limits?: ProviderLimits;
  freeVia?: string[];
}

export interface ProviderCatalogSource {
  id: string;
  name: string;
  description: string;
  docs: string;
  auth: Omit<ProviderAuthConfig, "type"> & { type: string; keyLabel?: string; keyUrl?: string; keyPrefix?: string; keyParam?: string };
  endpoint: {
    baseUrl: string;
    protocol: ProviderProtocol;
    insecureTls?: boolean;
  } & { router?: string; responseTextPaths?: string[] };
  limits?: ProviderLimits;
  accountIdEnv?: string;
  env: string;
  models: CatalogModelEntry[];
  // Dynamic discovery configuration
  discovery?: DiscoveryConfig;
}

export interface DiscoveryConfig {
  modelEndpoint?: string;
  authRequired: boolean;
  rateLimitHeaders: Record<string, string>;
  probeEndpoint?: "/chat/completions" | "/completions";
  probeMessages?: { role: string; content: string; }[];
}

export type { ProviderCatalogEntry, ProviderCatalogModelMatch, ProviderCatalogPreset };
