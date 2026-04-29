import { StoragePaths } from "../storage/files";
import { listProviders } from "../providers/repository";
import { supportsRequirements } from "../utils/modelCapabilities";
import { ModelCapabilities, ModelModality } from "../types";
import { loadVirtualModels, migrateLegacyPools, saveVirtualModels } from "./repository";
import { VirtualModelCandidate, VirtualModelDefinition } from "./types";
import { getEffectiveModelInsecureTls } from "../providers/repository";

interface VirtualModelTemplate {
  id: string;
  aliases: string[];
  requiredInput: ModelModality[];
  requiredOutput: ModelModality[];
}

const DEFAULT_SCORE_FALLBACK = 20;

const DEFAULT_VIRTUAL_MODELS: VirtualModelTemplate[] = [
  {
    id: "smart",
    aliases: ["smart"],
    requiredInput: [],
    requiredOutput: [],
  },
];

export function scoreModelHeuristic(modelId: string, capabilities?: ModelCapabilities): number {
  const normalized = modelId.toLowerCase();
  let score = DEFAULT_SCORE_FALLBACK;

  const familyScores: Array<[RegExp, number]> = [
    [/gpt-5|o3|o4|claude-4|gemini-2\.5|deepseek-r1/, 65],
    [/gpt-4|claude-3\.7|claude-3\.5|gemini-2|qwen3|llama-4/, 55],
    [/qwen2\.5|llama-3|mistral-large|mixtral|deepseek-v3/, 45],
    [/gemma|phi|ministral|mistral-small|llama-2/, 30],
  ];
  for (const [pattern, value] of familyScores) {
    if (pattern.test(normalized)) {
      score = Math.max(score, value);
      break;
    }
  }

  const paramMatch = normalized.match(/(\d+(?:\.\d+)?)\s*b\b/);
  if (paramMatch) {
    const params = Number(paramMatch[1]);
    if (Number.isFinite(params)) {
      score += Math.min(25, Math.log2(Math.max(1, params)) * 4);
    }
  }

  const dateMatch = normalized.match(/\b(20\d{2})(?:[-.]?([01]\d))?\b/);
  if (dateMatch) {
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2] ?? "1");
    if (Number.isFinite(year)) {
      score += Math.max(0, Math.min(12, year - 2023)) * 2;
      if (year >= 2025 && Number.isFinite(month)) {
        score += Math.min(2, month / 6);
      }
    }
  }

  if (capabilities?.supportsTools) score += 3;
  if (capabilities?.supportsStreaming) score += 2;
  if (capabilities?.input.includes("image")) score += 2;
  if (capabilities && new Set([...capabilities.input, ...capabilities.output]).size > 2) score += 2;

  return Math.round(score * 10) / 10;
}

function buildCandidate(
  provider: Awaited<ReturnType<typeof listProviders>>[number],
  model: Awaited<ReturnType<typeof listProviders>>[number]["models"][number],
  scoreFallback: number,
  manualRank?: number
): VirtualModelCandidate {
  const effectiveBaseUrl = model.baseUrl ?? provider.baseUrl;
  const benchmarkScore = model.benchmark?.livebench;
  const heuristicScore = scoreModelHeuristic(`${provider.id}/${model.modelId}`, model.capabilities);
  const score =
    typeof manualRank === "number"
      ? 10_000 - manualRank
      : typeof benchmarkScore === "number"
        ? benchmarkScore
        : heuristicScore || scoreFallback;
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
    score,
    scoreSource:
      typeof manualRank === "number"
        ? "manual"
        : typeof benchmarkScore === "number"
          ? "benchmark.livebench"
          : "heuristic",
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

export async function rebuildDefaultVirtualModels(
  paths: StoragePaths,
  scoreFallback = DEFAULT_SCORE_FALLBACK
): Promise<VirtualModelDefinition[]> {
  await migrateLegacyPools(paths);
  const existing = await loadVirtualModels(paths);
  const providers = await listProviders(paths);

  const userVirtualModels = existing.virtualModels.filter((model) => model.userDefined);
  const autoVirtualModels = existing.virtualModels.filter((model) => !model.userDefined);

  const virtualModels: VirtualModelDefinition[] = DEFAULT_VIRTUAL_MODELS.map((template) => {
    const existingAuto = autoVirtualModels.find((model) => model.id === template.id);
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

  const allCandidates = new Map<string, VirtualModelCandidate>();
  for (const provider of providers) {
    for (const model of provider.models) {
      const candidate = buildCandidate(provider, model, scoreFallback);
      allCandidates.set(`${provider.id}/${model.modelId}`, candidate);
    }
  }

  for (const virtualModel of virtualModels) {
    for (const candidate of allCandidates.values()) {
      if (!candidate.modelEnabled || !candidate.providerEnabled) continue;
      if (!candidate.free && !virtualModel.userDefined) continue;
      if (
        supportsRequirements(candidate.capabilities, {
          requiredInput: virtualModel.requiredInput,
          requiredOutput: virtualModel.requiredOutput,
        })
      ) {
        virtualModel.candidates.push(candidate);
      }
    }

    if (virtualModel.candidateSelection.length > 0) {
      const selected = virtualModel.candidateSelection
        .map<VirtualModelCandidate | undefined>((sel, index) => {
          const candidate = allCandidates.get(sel);
          return candidate ? { ...candidate, score: 10_000 - index, scoreSource: "manual" as const } : undefined;
        })
        .filter((candidate): candidate is VirtualModelCandidate => candidate !== undefined);
      if (selected.length > 0) {
        virtualModel.candidates = selected;
      }
    }

    virtualModel.candidates = sortCandidates(virtualModel.candidates);
  }

  for (const userVirtualModel of userVirtualModels) {
    if (virtualModels.some((model) => model.id === userVirtualModel.id)) {
      continue;
    }
    userVirtualModel.candidates = (userVirtualModel.candidateSelection ?? [])
      .map<VirtualModelCandidate | undefined>((sel, index) => {
        const candidate = allCandidates.get(sel);
        return candidate ? { ...candidate, score: 10_000 - index, scoreSource: "manual" as const } : undefined;
      })
      .filter((candidate): candidate is VirtualModelCandidate => candidate !== undefined);
    userVirtualModel.candidates = sortCandidates(userVirtualModel.candidates);
    userVirtualModel.updatedAt = new Date().toISOString();
    virtualModels.push(userVirtualModel);
  }

  await saveVirtualModels(paths, virtualModels);
  return virtualModels;
}

function sortCandidates(candidates: VirtualModelCandidate[]): VirtualModelCandidate[] {
  return candidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return `${a.providerId}/${a.modelId}`.localeCompare(`${b.providerId}/${b.modelId}`);
  });
}
