import { EndpointDoc, ModelModality } from "../types";
import { StoragePaths, defaultHealth } from "../storage/files";
import { supportsRequirements } from "../utils/modelCapabilities";
import { getProtocolAdapter } from "../protocols/registry";
import { ProtocolOperation } from "../protocols/types";
import { getVirtualModelByAlias, loadVirtualModelState, saveVirtualModelState } from "./repository";
import { VirtualModelCandidate, VirtualModelCandidateState, VirtualModelSelection } from "./types";
import { getProviderModelHealthMap } from "../providers/health";

const DEFAULT_COOLDOWN_MS = 60_000;

export interface VirtualModelTokenUsageDelta {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export async function selectVirtualModelCandidates(
  paths: StoragePaths,
  alias: string,
  requirements?: { requiredInput?: ModelModality[]; requiredOutput?: ModelModality[] },
  routing?: { operation: ProtocolOperation; stream: boolean }
): Promise<VirtualModelSelection | null> {
  const virtualModel = await getVirtualModelByAlias(paths, alias);
  if (!virtualModel) {
    return null;
  }

  const healthMap = await getProviderModelHealthMap(paths);
  const state = await loadVirtualModelState(paths);
  const now = Date.now();
  const skipped: VirtualModelSelection["skipped"] = [];
  const candidates: VirtualModelCandidate[] = [];

  for (const candidate of virtualModel.candidates) {
    const candidateState = getCandidateState(state.candidates, candidate.id);
    refreshWindows(candidateState, now);

    const adapter = getProtocolAdapter(candidate.protocol);
    if (!candidate.supportsRouting || !adapter) {
      skipped.push({ candidateId: candidate.id, reason: "unsupported_protocol" });
      continue;
    }

    if (!candidate.baseUrl) {
      skipped.push({ candidateId: candidate.id, reason: "missing_base_url" });
      continue;
    }

    if (routing) {
      const support = adapter.supports({
        operation: routing.operation,
        stream: routing.stream,
        capabilities: candidate.capabilities,
        requiredInput: requirements?.requiredInput,
        requiredOutput: requirements?.requiredOutput,
      });
      if (!support.supported) {
        skipped.push({
          candidateId: candidate.id,
          reason: support.reason ?? "unsupported_operation",
        });
        continue;
      }
    }

    if (!candidate.providerEnabled) {
      skipped.push({ candidateId: candidate.id, reason: "provider_disabled" });
      continue;
    }
    if (!candidate.modelEnabled) {
      skipped.push({ candidateId: candidate.id, reason: "model_disabled" });
      continue;
    }
    if (candidate.providerModelId) {
      const health = healthMap[candidate.providerModelId];
      if (health?.status === "down" && shouldRespectHealthStatus(candidate.protocol)) {
        skipped.push({ candidateId: candidate.id, reason: "health_down" });
        continue;
      }
    }

    if (
      requirements &&
      !supportsRequirements(candidate.capabilities, {
        requiredInput: requirements.requiredInput,
        requiredOutput: requirements.requiredOutput,
      })
    ) {
      skipped.push({ candidateId: candidate.id, reason: "capability_mismatch" });
      continue;
    }

    if (candidateState.cooldownUntil && new Date(candidateState.cooldownUntil).getTime() > now) {
      skipped.push({ candidateId: candidate.id, reason: "cooldown" });
      continue;
    }

    if (isRequestBudgetExhausted(candidate, candidateState)) {
      skipped.push({ candidateId: candidate.id, reason: "request_budget_exhausted" });
      continue;
    }

    candidates.push(candidate);
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const aState = getCandidateState(state.candidates, a.id);
    const bState = getCandidateState(state.candidates, b.id);
    const aFailureRatio = failureRatio(aState);
    const bFailureRatio = failureRatio(bState);
    if (aFailureRatio !== bFailureRatio) {
      return aFailureRatio - bFailureRatio;
    }
    const aLatency = aState.latencyMsEwma ?? Number.POSITIVE_INFINITY;
    const bLatency = bState.latencyMsEwma ?? Number.POSITIVE_INFINITY;
    if (aLatency !== bLatency) {
      return aLatency - bLatency;
    }
    return `${a.providerId}/${a.modelId}`.localeCompare(`${b.providerId}/${b.modelId}`);
  });

  await saveVirtualModelState(paths, state);

  return {
    virtualModel,
    candidates,
    skipped,
  };
}

function shouldRespectHealthStatus(protocol: string): boolean {
  return protocol !== "dashscope";
}

export async function markVirtualModelAttempt(
  paths: StoragePaths,
  candidate: VirtualModelCandidate,
  estimatedTokens: number
): Promise<void> {
  const state = await loadVirtualModelState(paths);
  const entry = getCandidateState(state.candidates, candidate.id);
  const now = Date.now();
  refreshWindows(entry, now);

  entry.attempts += 1;
  entry.minuteRequests += 1;
  entry.hourRequests += 1;
  entry.dayRequests += 1;
  entry.weekRequests += 1;
  if (estimatedTokens > 0) {
    entry.minuteTokens += estimatedTokens;
    entry.hourTokens += estimatedTokens;
    entry.dayTokens += estimatedTokens;
    entry.weekTokens += estimatedTokens;
  }
  entry.lastUsedAt = new Date(now).toISOString();

  await saveVirtualModelState(paths, state);
}

export async function markVirtualModelSuccess(
  paths: StoragePaths,
  candidate: VirtualModelCandidate,
  latencyMs: number,
  consumedTokens: number | VirtualModelTokenUsageDelta = 0
): Promise<void> {
  const state = await loadVirtualModelState(paths);
  const entry = getCandidateState(state.candidates, candidate.id);
  const now = Date.now();
  refreshWindows(entry, now);

  entry.successes += 1;
  entry.lastError = undefined;
  entry.cooldownUntil = undefined;
  entry.latencyMsEwma = ewma(entry.latencyMsEwma, latencyMs);
  entry.lastUsedAt = new Date(now).toISOString();
  addTokenUsage(entry, consumedTokens);

  await saveVirtualModelState(paths, state);
}

export async function markVirtualModelFailure(
  paths: StoragePaths,
  candidate: VirtualModelCandidate,
  details: {
    error: string;
    rateLimited?: boolean;
    headers?: Record<string, string | string[]>;
  }
): Promise<void> {
  const state = await loadVirtualModelState(paths);
  const entry = getCandidateState(state.candidates, candidate.id);
  const now = Date.now();
  refreshWindows(entry, now);

  entry.failures += 1;
  entry.lastError = details.error;
  entry.lastUsedAt = new Date(now).toISOString();

  if (details.rateLimited) {
    entry.rateLimitHits += 1;
    const cooldownMs = deriveCooldownMsFromHeaders(details.headers ?? {}, DEFAULT_COOLDOWN_MS);
    entry.cooldownUntil = new Date(now + cooldownMs).toISOString();
  } else if (entry.failures >= 3) {
    entry.cooldownUntil = new Date(now + 30_000).toISOString();
  }

  await saveVirtualModelState(paths, state);
}

export function buildEndpointFromVirtualModelCandidate(candidate: VirtualModelCandidate): EndpointDoc {
  const now = new Date();
  return {
    id: `virtual-model:${candidate.id}`,
    name: `${candidate.providerName}/${candidate.modelId}`,
    baseUrl: candidate.baseUrl,
    apiKey: candidate.apiKey,
    disabled: false,
    insecureTls: candidate.insecureTls === true,
    priority: 0,
    type: candidate.endpointType,
    models: [
      {
        publicName: candidate.modelId,
        upstreamModel: candidate.upstreamModel,
        capabilities: candidate.capabilities,
      },
    ],
    health: defaultHealth(),
    createdAt: now,
    updatedAt: now,
  };
}

export function estimateTokensFromPayload(payload: Record<string, unknown>): number {
  const maxTokens = payload.max_tokens;
  if (typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0) {
    return Math.floor(maxTokens);
  }
  return 0;
}

export function deriveCooldownMsFromHeaders(
  headers: Record<string, string | string[]>,
  fallbackMs: number
): number {
  const retryAfter = headerValue(headers, "retry-after");
  if (retryAfter) {
    const asNumber = Number(retryAfter);
    if (Number.isFinite(asNumber) && asNumber >= 0) {
      return Math.max(1_000, asNumber * 1_000);
    }
    const asDate = Date.parse(retryAfter);
    if (Number.isFinite(asDate)) {
      return Math.max(1_000, asDate - Date.now());
    }
  }

  const resetKeys = ["x-ratelimit-reset", "x-ratelimit-reset-requests", "ratelimit-reset"];
  for (const key of resetKeys) {
    const value = headerValue(headers, key);
    if (!value) {
      continue;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    if (parsed > 1_000_000_000) {
      return Math.max(1_000, parsed * 1_000 - Date.now());
    }
    return Math.max(1_000, parsed * 1_000);
  }

  return fallbackMs;
}

function headerValue(headers: Record<string, string | string[]>, key: string): string | undefined {
  const exact = headers[key];
  if (typeof exact === "string") {
    return exact;
  }
  if (Array.isArray(exact) && exact.length > 0) {
    return exact[0];
  }
  const found = Object.entries(headers).find(([name]) => name.toLowerCase() === key.toLowerCase());
  if (!found) {
    return undefined;
  }
  const value = found[1];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0];
  }
  return undefined;
}

function getCandidateState(
  states: Record<string, VirtualModelCandidateState>,
  candidateId: string
): VirtualModelCandidateState {
  const existing = states[candidateId];
  if (existing) {
    return existing;
  }

  const created: VirtualModelCandidateState = {
    candidateId,
    attempts: 0,
    successes: 0,
    failures: 0,
    rateLimitHits: 0,
    minuteRequests: 0,
    minuteTokens: 0,
    minuteInputTokens: 0,
    minuteOutputTokens: 0,
    hourRequests: 0,
    hourTokens: 0,
    hourInputTokens: 0,
    hourOutputTokens: 0,
    dayRequests: 0,
    dayTokens: 0,
    dayInputTokens: 0,
    dayOutputTokens: 0,
    weekRequests: 0,
    weekTokens: 0,
    weekInputTokens: 0,
    weekOutputTokens: 0,
  };
  states[candidateId] = created;
  return created;
}

function refreshWindows(state: VirtualModelCandidateState, now: number): void {
  const minuteStart = state.minuteWindowStartedAt
    ? new Date(state.minuteWindowStartedAt).getTime()
    : Number.NaN;
  if (!Number.isFinite(minuteStart) || now - minuteStart >= 60_000) {
    state.minuteWindowStartedAt = new Date(now).toISOString();
    state.minuteRequests = 0;
    state.minuteTokens = 0;
    state.minuteInputTokens = 0;
    state.minuteOutputTokens = 0;
  }

  const hourStart = state.hourWindowStartedAt
    ? new Date(state.hourWindowStartedAt).getTime()
    : Number.NaN;
  if (!Number.isFinite(hourStart) || now - hourStart >= 3_600_000) {
    state.hourWindowStartedAt = new Date(now).toISOString();
    state.hourRequests = 0;
    state.hourTokens = 0;
    state.hourInputTokens = 0;
    state.hourOutputTokens = 0;
  }

  const dayStart = state.dayWindowStartedAt
    ? new Date(state.dayWindowStartedAt).getTime()
    : Number.NaN;
  if (!Number.isFinite(dayStart) || now - dayStart >= 86_400_000) {
    state.dayWindowStartedAt = new Date(now).toISOString();
    state.dayRequests = 0;
    state.dayTokens = 0;
    state.dayInputTokens = 0;
    state.dayOutputTokens = 0;
  }

  const weekStart = state.weekWindowStartedAt
    ? new Date(state.weekWindowStartedAt).getTime()
    : Number.NaN;
  if (!Number.isFinite(weekStart) || now - weekStart >= 604_800_000) {
    state.weekWindowStartedAt = new Date(now).toISOString();
    state.weekRequests = 0;
    state.weekTokens = 0;
    state.weekInputTokens = 0;
    state.weekOutputTokens = 0;
  }

  if (state.cooldownUntil && new Date(state.cooldownUntil).getTime() <= now) {
    state.cooldownUntil = undefined;
  }
}

function isRequestBudgetExhausted(candidate: VirtualModelCandidate, state: VirtualModelCandidateState): boolean {
  if (typeof candidate.limits?.requestsPerMinute === "number") {
    if (state.minuteRequests >= candidate.limits.requestsPerMinute) {
      return true;
    }
  }
  if (typeof candidate.limits?.requestsPerHour === "number") {
    if (state.hourRequests >= candidate.limits.requestsPerHour) {
      return true;
    }
  }
  if (typeof candidate.limits?.requestsPerDay === "number") {
    if (state.dayRequests >= candidate.limits.requestsPerDay) {
      return true;
    }
  }
  if (typeof candidate.limits?.requestsPerWeek === "number") {
    if (state.weekRequests >= candidate.limits.requestsPerWeek) {
      return true;
    }
  }
  if (typeof candidate.limits?.tokensPerMinute === "number") {
    if (state.minuteTokens >= candidate.limits.tokensPerMinute) {
      return true;
    }
  }
  if (typeof candidate.limits?.tokensPerHour === "number") {
    if (state.hourTokens >= candidate.limits.tokensPerHour) {
      return true;
    }
  }
  if (typeof candidate.limits?.tokensPerDay === "number") {
    if (state.dayTokens >= candidate.limits.tokensPerDay) {
      return true;
    }
  }
  if (typeof candidate.limits?.tokensPerWeek === "number") {
    if (state.weekTokens >= candidate.limits.tokensPerWeek) {
      return true;
    }
  }
  return false;
}

function failureRatio(state: VirtualModelCandidateState): number {
  if (state.attempts <= 0) {
    return 0;
  }
  return state.failures / state.attempts;
}

function addTokenUsage(state: VirtualModelCandidateState, consumed: number | VirtualModelTokenUsageDelta): void {
  const totalTokens =
    typeof consumed === "number" ? consumed : consumed.totalTokens ?? (consumed.inputTokens ?? 0) + (consumed.outputTokens ?? 0);
  const inputTokens = typeof consumed === "number" ? 0 : consumed.inputTokens ?? 0;
  const outputTokens = typeof consumed === "number" ? 0 : consumed.outputTokens ?? 0;
  if (totalTokens > 0) {
    state.minuteTokens += totalTokens;
    state.hourTokens += totalTokens;
    state.dayTokens += totalTokens;
    state.weekTokens += totalTokens;
  }
  if (inputTokens > 0) {
    state.minuteInputTokens = (state.minuteInputTokens ?? 0) + inputTokens;
    state.hourInputTokens = (state.hourInputTokens ?? 0) + inputTokens;
    state.dayInputTokens = (state.dayInputTokens ?? 0) + inputTokens;
    state.weekInputTokens = (state.weekInputTokens ?? 0) + inputTokens;
  }
  if (outputTokens > 0) {
    state.minuteOutputTokens = (state.minuteOutputTokens ?? 0) + outputTokens;
    state.hourOutputTokens = (state.hourOutputTokens ?? 0) + outputTokens;
    state.dayOutputTokens = (state.dayOutputTokens ?? 0) + outputTokens;
    state.weekOutputTokens = (state.weekOutputTokens ?? 0) + outputTokens;
  }
}

function ewma(previous: number | undefined, next: number, alpha = 0.2): number {
  if (previous === undefined) {
    return next;
  }
  return alpha * next + (1 - alpha) * previous;
}
