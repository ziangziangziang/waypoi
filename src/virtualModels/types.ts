import { EndpointType, ModelCapabilities, ModelModality } from "../types";
import { ProviderAuthConfig, ProviderProtocol, ProviderProtocolConfig } from "../providers/types";

export interface VirtualModelCandidate {
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
  scoreSource: "benchmark.livebench" | "heuristic" | "manual";
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

export interface VirtualModelDefinition {
  id: string;
  name: string;
  aliases: string[];
  enabled: boolean;
  strategy: "highest_rank_available" | "remaining_limit";
  requiredInput: ModelModality[];
  requiredOutput: ModelModality[];
  scoreFallback: number;
  candidates: VirtualModelCandidate[];
  candidateSelection: string[];
  userDefined: boolean;
  updatedAt: string;
}

export interface VirtualModelStoreFile {
  version: number;
  updatedAt: string;
  virtualModels: VirtualModelDefinition[];
}

export interface VirtualModelCandidateState {
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
  minuteInputTokens?: number;
  minuteOutputTokens?: number;
  hourRequests: number;
  hourTokens: number;
  hourInputTokens?: number;
  hourOutputTokens?: number;
  dayRequests: number;
  dayTokens: number;
  dayInputTokens?: number;
  dayOutputTokens?: number;
  weekRequests: number;
  weekTokens: number;
  weekInputTokens?: number;
  weekOutputTokens?: number;
  lastError?: string;
  lastUsedAt?: string;
}

export interface VirtualModelStateFile {
  version: number;
  updatedAt: string;
  candidates: Record<string, VirtualModelCandidateState>;
}

export interface VirtualModelSelection {
  virtualModel: VirtualModelDefinition;
  candidates: VirtualModelCandidate[];
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

export interface VirtualModelAttemptMetrics {
  candidateAttempts: number;
  failovers: number;
  rateLimitSwitches: number;
  distinctProviders: number;
  distinctModels: number;
}

export interface VirtualModelSwitchEvent {
  id: string;
  virtualModelId: string;
  fromCandidateId?: string;
  toCandidateId?: string;
  reason: "request_budget_exhausted" | "cooldown" | "rate_limited" | "retryable_error" | "fallback" | "recharged";
  requestId?: string;
  createdAt: string;
}
