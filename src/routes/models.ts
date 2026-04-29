import { FastifyInstance } from "fastify";
import { StoragePaths } from "../storage/files";
import { EndpointType, ModelModality } from "../types";
import { getAvailableVirtualModels, listModelsForApi } from "../providers/modelRegistry";

export async function registerModelsRoutes(app: FastifyInstance, paths: StoragePaths): Promise<void> {
  app.get("/v1/models", async (req, reply) => {
    const query = (req.query ?? {}) as { available_only?: string | boolean };
    const availableOnly = query.available_only === true || query.available_only === "true";
    const concrete = await listModelsForApi(paths, { availableOnly });
    const virtualModels = await getAvailableVirtualModels(paths);
    const virtualModelEntries = virtualModels.map((model) => ({
      id: model.alias,
      object: "model" as const,
      owned_by: "waypoi",
      endpoint_type: inferEndpointType(model.capabilities.output),
      capabilities: model.capabilities,
      slug: model.alias,
      waypoi_virtual_model: {
        id: model.id,
        strategy: model.strategy,
        candidateCount: model.candidateCount,
        scoreSource: "benchmark.livebench_or_heuristic",
      },
    }));
    const data = [...concrete, ...virtualModelEntries];
    // Include both `data` and `models` for broader client compatibility.
    reply.send({ object: "list", data, models: data });
  });
}

function inferEndpointType(output: ModelModality[]): EndpointType {
  if (output.includes("text")) {
    return "llm";
  }
  if (output.includes("embedding")) {
    return "embedding";
  }
  if (output.includes("image")) {
    return "diffusion";
  }
  if (output.includes("audio")) {
    return "audio";
  }
  return "llm";
}
