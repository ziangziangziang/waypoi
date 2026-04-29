import { routeRequest } from "../routing/router";
import { selectVirtualModelCandidates } from "../virtualModels/scheduler";
import { pickBestProviderModelByCapabilities } from "../providers/modelRegistry";
import { StoragePaths } from "../storage/files";
import { VideoGenerationRequest } from "../types";

export interface VideoGenerationRunResult {
  model: string;
  statusCode: number;
  headers: Record<string, string | string[]>;
  payload: unknown;
  route: {
    endpointId: string;
    endpointName: string;
    upstreamModel: string;
  };
}

export async function resolveVideoGenerationModel(
  paths: StoragePaths,
  requestedModel?: string
): Promise<string | null> {
  if (requestedModel) {
    return requestedModel;
  }
  return pickDefaultVideoModel(paths);
}

export async function runVideoGeneration(
  paths: StoragePaths,
  request: VideoGenerationRequest,
  headers: Record<string, string | string[] | undefined>,
  signal: AbortSignal
): Promise<VideoGenerationRunResult> {
  const model = await resolveVideoGenerationModel(paths, request.model);
  if (!model) {
    const error = new Error("No video generation model available. Add or enable a provider model.") as Error & {
      type: string;
      retryable: boolean;
    };
    error.type = "no_video_model";
    error.retryable = false;
    throw error;
  }

  const outcome = await routeRequest(
    paths,
    model,
    "/v1/videos/generations",
    { ...request, model } as Record<string, unknown>,
    headers,
    signal,
    {
      endpointType: "video",
      requiredInput: request.image_url || (Array.isArray(request.media) && request.media.length > 0)
        ? ["text", "image"]
        : ["text"],
      requiredOutput: ["video"],
    }
  );

  const body = await readBody(outcome.attempt.response);

  return {
    model,
    statusCode: outcome.attempt.response.statusCode,
    headers: outcome.attempt.response.headers,
    payload: body.payload,
    route: {
      endpointId: outcome.attempt.endpoint.id,
      endpointName: outcome.attempt.endpoint.name,
      upstreamModel: outcome.attempt.upstreamModel,
    },
  };
}

async function pickDefaultVideoModel(paths: StoragePaths): Promise<string | null> {
  const smart = await selectVirtualModelCandidates(
    paths,
    "smart",
    {
      requiredInput: ["text"],
      requiredOutput: ["video"],
    },
    {
      operation: "video_generations",
      stream: false,
    }
  );
  if (smart && smart.candidates.length > 0) {
    return "smart";
  }

  const byCapabilities = await pickBestProviderModelByCapabilities(
    paths,
    { requiredInput: ["text"], requiredOutput: ["video"] },
    "video"
  );
  if (byCapabilities) {
    return byCapabilities;
  }
  return null;
}

async function readBody(response: {
  body: NodeJS.ReadableStream;
  headers: Record<string, string | string[]>;
}): Promise<{ payload: unknown }> {
  const chunks: Buffer[] = [];
  for await (const chunk of response.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  const contentType = normalizeContentType(response.headers);
  if (contentType.includes("application/json")) {
    try {
      return { payload: JSON.parse(buffer.toString("utf8")) };
    } catch {
      return { payload: buffer };
    }
  }
  return { payload: buffer };
}

function normalizeContentType(headers: Record<string, string | string[]>): string {
  const ct = headers["content-type"] ?? headers["Content-Type"];
  if (Array.isArray(ct)) return ct.join(", ");
  return ct ?? "";
}
