import { StoragePaths } from "../storage/files";
import { listProviders } from "../providers/repository";
import { supportsRequirements } from "../utils/modelCapabilities";
import { ModelModality } from "../types";
import { loadPools, savePools } from "./repository";
import { PoolCandidate, PoolDefinition } from "./types";
import { getEffectiveModelInsecureTls } from "../providers/repository";

interface PoolTemplate {
  id: string;
  aliases: string[];
  requiredInput: ModelModality[];
  requiredOutput: ModelModality[];
}

const DEFAULT_SCORE_FALLBACK = 20;

const DEFAULT_POOLS: PoolTemplate[] = [
  {
    id: "smart",
    aliases: ["smart"],
    requiredInput: [],
    requiredOutput: [],
  },
];

function buildCandidate(
  provider: Awaited<ReturnType<typeof listProviders>>[number],
  model: Awaited<ReturnType<typeof listProviders>>[number]["models"][number],
  scoreFallback: number
): PoolCandidate {
  const effectiveBaseUrl = model.baseUrl ?? provider.baseUrl;
  const score = model.benchmark?.livebench;
  return {
    id: model.providerModelId,
    providerModelId: model.providerModelId,
    providerId: provider.id,
    providerName: provider.name,
    providerEnabled: provider.enabled,
    modelEnabled: model.enabled !== false,
    modelId: model.modelId,
    aliases: model.aliases ?? [],
    upstreamModel: model.upstreamModel,
    baseUrl: effectiveBaseUrl ?? "",
    apiKey: model.apiKey ?? provider.apiKey,
    insecureTls: getEffectiveModelInsecureTls(provider, model),
    autoInsecureTlsDomains: provider.autoInsecureTlsDomains ?? [],
    protocol: provider.protocol,
    protocolConfig: provider.protocolConfig,
    auth: provider.auth,
    supportsRouting: provider.supportsRouting,
    free: model.free,
    endpointType: model.endpointType,
    capabilities: model.capabilities,
    score: typeof score === "number" ? score : scoreFallback,
    scoreSource: typeof score === "number" ? "benchmark.livebench" : "fallback",
    limits: {
      requestsPerMinute: model.limits?.requests?.perMinute ?? provider.limits?.requests?.perMinute,
      requestsPerHour: model.limits?.requests?.perHour ?? provider.limits?.requests?.perHour,
      requestsPerDay: model.limits?.requests?.perDay ?? provider.limits?.requests?.perDay,
      requestsPerWeek: model.limits?.requests?.perWeek ?? provider.limits?.requests?.perWeek,
      tokensPerMinute: model.limits?.tokens?.perMinute ?? provider.limits?.tokens?.perMinute,
      tokensPerHour: model.limits?.tokens?.perHour ?? provider.limits?.tokens?.perHour,
      tokensPerDay: model.limits?.tokens?.perDay ?? provider.limits?.tokens?.perDay,
      tokensPerWeek: model.limits?.tokens?.perWeek ?? provider.limits?.tokens?.perWeek,
    },
  };
}

export async function rebuildDefaultPools(
  paths: StoragePaths,
  scoreFallback = DEFAULT_SCORE_FALLBACK
): Promise<PoolDefinition[]> {
  const existing = await loadPools(paths);
  const providers = await listProviders(paths);

  const userPools = existing.pools.filter((p) => p.userDefined);
  const autoPools = existing.pools.filter((p) => !p.userDefined);

  const autoPoolIds = new Set(autoPools.map((p) => p.id));

  const pools: PoolDefinition[] = DEFAULT_POOLS.map((template) => {
    const existingAuto = autoPools.find((p) => p.id === template.id);
    return {
      id: template.id,
      name: existingAuto?.name ?? template.id,
      aliases: template.aliases,
      enabled: existingAuto?.enabled ?? true,
      strategy: existingAuto?.strategy ?? "highest_rank_available",
      requiredInput: template.requiredInput,
      requiredOutput: template.requiredOutput,
      scoreFallback,
      candidates: [],
      candidateSelection: existingAuto?.candidateSelection ?? [],
      userDefined: false,
      updatedAt: new Date().toISOString(),
    };
  });

  const allCandidates = new Map<string, PoolCandidate>();
  for (const provider of providers) {
    for (const model of provider.models) {
      const candidate = buildCandidate(provider, model, scoreFallback);
      allCandidates.set(`${provider.id}/${model.modelId}`, candidate);
    }
  }

  for (const pool of pools) {
    for (const [key, candidate] of allCandidates) {
      if (!candidate.modelEnabled || !candidate.providerEnabled) continue;
      if (!candidate.free && !pool.userDefined) continue;
      if (
        supportsRequirements(candidate.capabilities, {
          requiredInput: pool.requiredInput,
          requiredOutput: pool.requiredOutput,
        })
      ) {
        pool.candidates.push(candidate);
      }
    }

    if (pool.candidateSelection.length > 0) {
      const selected = pool.candidateSelection
        .map((sel) => allCandidates.get(sel))
        .filter((c): c is PoolCandidate => c !== undefined);
      if (selected.length > 0) {
        pool.candidates = selected;
      }
    }

    pool.candidates = pool.candidates.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return `${a.providerId}/${a.modelId}`.localeCompare(`${b.providerId}/${b.modelId}`);
    });
  }

  for (const userPool of userPools) {
    if (!allPoolsHasId(pools, userPool.id)) {
      userPool.candidates = (userPool.candidateSelection ?? [])
        .map((sel) => allCandidates.get(sel))
        .filter((c): c is PoolCandidate => c !== undefined);
      userPool.candidates = userPool.candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return `${a.providerId}/${a.modelId}`.localeCompare(`${b.providerId}/${b.modelId}`);
      });
      userPool.updatedAt = new Date().toISOString();
      pools.push(userPool);
    }
  }

  await savePools(paths, pools);
  return pools;
}

function allPoolsHasId(pools: PoolDefinition[], id: string): boolean {
  return pools.some((p) => p.id === id);
}
