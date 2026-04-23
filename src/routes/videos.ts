import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "crypto";
import { logRequest } from "../storage/repositories";
import { RequestLog, VideoGenerationRequest } from "../types";
import { StoragePaths } from "../storage/files";
import { resolveVideoGenerationModel, runVideoGeneration } from "../services/videoGeneration";
import { setCaptureError, setCaptureRouting } from "../middleware/requestCapture";

export async function registerVideoRoutes(app: FastifyInstance, paths: StoragePaths): Promise<void> {
  app.post("/v1/videos/generations", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as VideoGenerationRequest | undefined;

    if (!body?.prompt) {
      reply.code(400).send({ error: { message: "prompt is required" } });
      return;
    }

    const model = await resolveVideoGenerationModel(paths, body.model);
    if (!model) {
      reply.code(400).send({ error: { message: "No video generation model available. Add or enable a provider model." } });
      return;
    }

    const requestId = randomUUID();
    const start = Date.now();
    const controller = new AbortController();

    req.raw.on("close", () => controller.abort());

    try {
      const generated = await runVideoGeneration(
        paths,
        { ...body, model },
        req.headers as Record<string, string | string[] | undefined>,
        controller.signal
      );
      setHeaders(reply, generated.headers);
      reply.code(generated.statusCode).send(generated.payload);
      setCaptureRouting(reply, {
        publicModel: model,
        endpointId: generated.route.endpointId,
        endpointName: generated.route.endpointName,
        upstreamModel: generated.route.upstreamModel,
      });

      await logRequest(paths, buildLog(
        requestId,
        model,
        {
          attempt: {
            endpoint: {
              id: generated.route.endpointId,
              name: generated.route.endpointName,
            },
            upstreamModel: generated.route.upstreamModel,
            response: {
              statusCode: generated.statusCode,
            },
          },
        },
        Date.now() - start,
        false
      ));
    } catch (error) {
      const errorType = (error as { type?: string }).type ?? (error as Error).name;
      setCaptureError(reply, { type: errorType, message: (error as Error).message });
      await logRequest(paths, {
        requestId,
        ts: new Date(),
        route: { publicModel: model },
        request: { stream: false },
        result: {
          errorType,
          errorMessage: (error as Error).message
        }
      });
      if (errorType === "invalid_request") {
        reply.code(400).send({ error: { message: (error as Error).message } });
        return;
      }
      if (errorType === "tls_verify_failed") {
        reply.code(502).send({ error: { message: (error as Error).message, type: errorType } });
        return;
      }
      const status =
        errorType === "no_endpoints" ||
        errorType === "unsupported_operation" ||
        errorType === "protocol_stream_unsupported" ||
        errorType === "unsupported_protocol" ||
        errorType === "invalid_protocol_config"
          ? 400
          : errorType === "rate_limited"
            ? 429
            : 502;
      reply.code(status).send({ error: { message: "Video generation unavailable", type: errorType } });
    }
  });
}

function setHeaders(reply: FastifyReply, headers: Record<string, string | string[]>): void {
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      reply.header(key.toLowerCase(), value.join(", "));
    } else {
      reply.header(key.toLowerCase(), value);
    }
  }
}

function buildLog(
  requestId: string,
  model: string,
  outcome: { attempt: { endpoint: { id: string; name: string }; upstreamModel: string; response: { statusCode: number } } },
  latencyMs: number,
  stream: boolean
): RequestLog {
  return {
    requestId,
    ts: new Date(),
    route: {
      publicModel: model,
      endpointId: outcome.attempt.endpoint.id,
      endpointName: outcome.attempt.endpoint.name,
      upstreamModel: outcome.attempt.upstreamModel
    },
    request: { stream },
    result: {
      statusCode: outcome.attempt.response.statusCode,
      latencyMs,
      totalTokens: null
    }
  };
}
