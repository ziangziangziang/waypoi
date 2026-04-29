import {
  BenchmarkCliOptions,
  BenchmarkGenerationParameters,
  BenchmarkRunPlan,
  BenchmarkRunRequest,
} from "./types";

type BenchmarkRunRequestInput = Partial<BenchmarkRunRequest> & BenchmarkCliOptions;

export function normalizeBenchmarkRunRequest(
  input: BenchmarkRunRequestInput | undefined
): BenchmarkCliOptions {
  const body = input ?? {};
  const parameters = normalizeParameterObject(body.parameters);

  return {
    suite: body.suite,
    exampleId: body.exampleId,
    scenarioPath: body.scenarioPath,
    modelOverride: body.modelOverride ?? body.model,
    outPath: body.outPath,
    configPath: body.configPath,
    profile: body.profile,
    baselinePath: body.baselinePath,
    executionMode: body.executionMode,
    listExamples: body.listExamples,
    updateCapCache: body.updateCapCache,
    capTtlDays: body.capTtlDays,
    temperature: body.temperature ?? parameters?.temperature,
    top_p: body.top_p ?? parameters?.top_p,
    max_tokens: body.max_tokens ?? parameters?.max_tokens,
    presence_penalty: body.presence_penalty ?? parameters?.presence_penalty,
    frequency_penalty: body.frequency_penalty ?? parameters?.frequency_penalty,
    seed: body.seed ?? parameters?.seed,
    stop: body.stop ?? parameters?.stop,
  };
}

export function toNormalizedBenchmarkRunRequest(run: BenchmarkRunPlan): BenchmarkRunRequest {
  const parameters = compactParameters({
    temperature: run.temperature,
    top_p: run.top_p,
    max_tokens: run.max_tokens,
    presence_penalty: run.presence_penalty,
    frequency_penalty: run.frequency_penalty,
    seed: run.seed,
    stop: run.stop,
  });

  return {
    suite: run.suite ?? "showcase",
    model: run.modelOverride,
    parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
    exampleId: run.exampleId,
    scenarioPath: run.scenarioPath,
    modelOverride: run.modelOverride,
    outPath: run.outPath,
    profile: undefined,
    baselinePath: run.baselinePath,
    executionMode: run.executionMode,
    listExamples: run.listExamples,
    updateCapCache: run.updateCapCache,
    capTtlDays: run.capTtlDays,
  };
}

function normalizeParameterObject(
  value: BenchmarkRunRequestInput["parameters"]
): BenchmarkGenerationParameters | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("parameters must be an object");
  }
  return value;
}

function compactParameters(
  parameters: BenchmarkGenerationParameters
): BenchmarkGenerationParameters {
  return Object.fromEntries(
    Object.entries(parameters).filter(([, value]) => value !== undefined)
  ) as BenchmarkGenerationParameters;
}
