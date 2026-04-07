import { EndpointType, ModelCapabilities, ModelModality } from "../types";
import { ProviderAuthConfig, ProviderProtocol, ProviderProtocolConfig } from "../providers/types";

export interface PoolCandidate {
  id: string;
  providerModelId?: string;
  providerId: string;
  providerName: string;
  providerEnabled: boolean;
  modelEnabled: boolean;
  modelId: string;
  aliases?: string[];
  upstreamModel: string;
  baseUrl: string;
  apiKey?: string;
  insecureTls?: boolean;
  autoInsecureTlsDomains?: string[];
  protocol: ProviderProtocol;
  protocolConfig?: ProviderProtocolConfig;
  auth?: ProviderAuthConfig;
  supportsRouting: boolean;
  free: boolean;
  endpointType: EndpointType;
  capabilities: ModelCapabilities;
  score: number;
  scoreSource: "benchmark.livebench" | "fallback";
  limits?: {
    requestsPerMinute?: number;
    requestsPerHour?: number;
    requestsPerDay?: number;
    requestsPerWeek?: number;
    tokensPerMinute?: number;
    tokensPerHour?: number;
    tokensPerDay?: number;
    tokensPerWeek?: number;
    timeoutMs?: number;
  };
}

export interface PoolDefinition {
  id: string;
  name: string;
  aliases: string[];
  enabled: boolean;
  strategy: "highest_rank_available" | "remaining_limit";
  requiredInput: ModelModality[];
  requiredOutput: ModelModality[];
  scoreFallback: number;
  candidates: PoolCandidate[];
  candidateSelection: string[];
  userDefined: boolean;
  updatedAt: string;
}

export interface PoolStoreFile {
  version: number;
  updatedAt: string;
  pools: PoolDefinition[];
}

export interface PoolCandidateState {
  candidateId: string;
  attempts: number;
  successes: number;
  failures: number;
  rateLimitHits: number;
  latencyMsEwma?: number;
  cooldownUntil?: string;
  minuteWindowStartedAt?: string;
  hourWindowStartedAt?: string;
  dayWindowStartedAt?: string;
  weekWindowStartedAt?: string;
  minuteRequests: number;
  minuteTokens: number;
  hourRequests: number;
  hourTokens: number;
  dayRequests: number;
  dayTokens: number;
  weekRequests: number;
  weekTokens: number;
  lastError?: string;
  lastUsedAt?: string;
}

export interface PoolStateFile {
  version: number;
  updatedAt: string;
  candidates: Record<string, PoolCandidateState>;
}

export interface PoolSelection {
  pool: PoolDefinition;
  candidates: PoolCandidate[];
  skipped: Array<{
    candidateId: string;
    reason:
      | "unsupported_protocol"
      | "unsupported_operation"
      | "stream_unsupported"
      | "missing_api_key"
      | "missing_base_url"
      | "provider_disabled"
      | "model_disabled"
      | "capability_mismatch"
      | "cooldown"
      | "request_budget_exhausted"
      | "health_down";
  }>;
}

export interface PoolAttemptMetrics {
  candidateAttempts: number;
  failovers: number;
  rateLimitSwitches: number;
  distinctProviders: number;
  distinctModels: number;
}
