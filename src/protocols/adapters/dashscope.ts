import {
  PreparedUpstreamRequest,
  ProtocolAdapter,
  ProtocolBuildRequestContext,
  ProtocolNormalizeResponseContext,
  ProtocolSupportContext,
} from "../types";
import { UpstreamResult } from "../../types";

const ALL_OPERATIONS = [
  "images_generation",
  "images_edits",
  "video_generations",
] as const;

const STREAM_OPERATIONS = [] as const;

const DASHSCOPE_IMAGE_GEN_PATH = "/api/v1/services/aigc/image-generation/generation";
const DASHSCOPE_VIDEO_GEN_PATH = "/api/v1/services/aigc/video-generation/video-synthesis";
const DASHSCOPE_TASK_QUERY_PATH = "/api/v1/tasks";
const DASHSCOPE_MULTIMODAL_GEN_PATH = "/api/v1/services/aigc/multimodal-generation/generation";

const TASK_POLL_INTERVAL_MS = 5000;
const TASK_POLL_TIMEOUT_MS = 300000;

export const dashscopeProtocolAdapter: ProtocolAdapter = {
  id: "dashscope",
  supportedOperations: [...ALL_OPERATIONS],
  streamSupportedOperations: [...STREAM_OPERATIONS],
  supports(context: ProtocolSupportContext) {
    if (!ALL_OPERATIONS.includes(context.operation as typeof ALL_OPERATIONS[number])) {
      return { supported: false, reason: "unsupported_operation" };
    }
    if (context.stream) {
      return { supported: false, reason: "stream_unsupported" };
    }
    return { supported: true };
  },
  async buildRequest(context: ProtocolBuildRequestContext): Promise<PreparedUpstreamRequest> {
    const { operation, payload, upstreamModel } = context;

    if (operation === "images_generation" || operation === "images_edits") {
      return buildImageRequest(payload, upstreamModel);
    }
    if (operation === "video_generations") {
      return buildVideoRequest(payload, upstreamModel);
    }

    throw new Error(`Unsupported operation for dashscope: ${operation}`);
  },
  async normalizeResponse(context: ProtocolNormalizeResponseContext): Promise<UpstreamResult> {
    const { operation, upstreamResult } = context;

    if (operation === "images_generation" || operation === "images_edits") {
      return normalizeImageResponse(upstreamResult);
    }
    if (operation === "video_generations") {
      return normalizeVideoResponse(upstreamResult);
    }

    throw new Error(`Unsupported operation for dashscope: ${operation}`);
  },
};

function buildImageRequest(
  payload: Record<string, unknown>,
  model: string
): PreparedUpstreamRequest {
  const prompt = (payload.prompt as string) ?? "";
  const negativePrompt = (payload.negative_prompt as string) ?? "";
  const imageUrl = payload.image_url as string | undefined;
  const n = (payload.n as number) ?? 1;
  const size = (payload.size as string) ?? "1K";
  const seed = payload.seed as number | undefined;
  const watermark = (payload.watermark as boolean) ?? false;
  const promptExtend = (payload.prompt_extend as boolean) ?? true;

  const content: Array<{ text?: string; image?: string }> = [];

  if (prompt) {
    content.push({ text: prompt });
  }

  if (imageUrl) {
    content.push({ image: imageUrl });
  }

  const body: Record<string, unknown> = {
    model,
    input: {
      messages: [
        {
          role: "user",
          content,
        },
      ],
    },
    parameters: {
      n,
      size,
      watermark,
      prompt_extend: promptExtend,
      ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
      ...(seed !== undefined ? { seed } : {}),
    },
  };

  return {
    path: DASHSCOPE_IMAGE_GEN_PATH,
    payload: body,
    headers: {
      "X-DashScope-Async": "enable",
    },
  };
}

function buildVideoRequest(
  payload: Record<string, unknown>,
  model: string
): PreparedUpstreamRequest {
  const prompt = (payload.prompt as string) ?? "";
  const negativePrompt = (payload.negative_prompt as string) ?? "";
  const imageUrl = payload.image_url as string | undefined;
  const audioUrl = payload.audio_url as string | undefined;
  const duration = (payload.duration as number) ?? 5;
  const resolution = (payload.resolution as string) ?? "720P";
  const seed = payload.seed as number | undefined;
  const watermark = (payload.watermark as boolean) ?? false;
  const promptExtend = (payload.prompt_extend as boolean) ?? true;

  const input: Record<string, unknown> = {
    prompt,
  };

  if (imageUrl) {
    input.img_url = imageUrl;
  }

  if (audioUrl) {
    input.audio_url = audioUrl;
  }

  if (negativePrompt) {
    input.negative_prompt = negativePrompt;
  }

  const body: Record<string, unknown> = {
    model,
    input,
    parameters: {
      resolution,
      duration,
      prompt_extend: promptExtend,
      watermark,
      ...(seed !== undefined ? { seed } : {}),
    },
  };

  return {
    path: DASHSCOPE_VIDEO_GEN_PATH,
    payload: body,
    headers: {
      "X-DashScope-Async": "enable",
    },
  };
}

async function normalizeImageResponse(upstreamResult: UpstreamResult): Promise<UpstreamResult> {
  const chunks: Buffer[] = [];
  for await (const chunk of upstreamResult.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  const body = JSON.parse(buffer.toString("utf8"));

  if (body.code || body.output?.task_status === "FAILED") {
    throw new Error(`DashScope task failed: ${body.message ?? body.output?.message ?? "Unknown error"}`);
  }

  const taskId = body.output?.task_id;
  if (!taskId) {
    throw new Error("No task_id in DashScope response");
  }

  const taskResult = await pollForTaskCompletion(taskId, upstreamResult.headers);

  const output = taskResult.output as { choices?: Array<{ message?: { content?: Array<{ type?: string; image?: string }> } }> } | undefined;
  const choices = output?.choices ?? [];
  const data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }> = [];

  for (const choice of choices) {
    const messageContent = choice.message?.content ?? [];
    for (const item of messageContent) {
      if (item.type === "image" && item.image) {
        data.push({ url: item.image });
      }
    }
  }

  const usage = (taskResult.usage ?? {}) as { image_count?: number; size?: string };
  const normalizedBody = {
    created: Math.floor(Date.now() / 1000),
    data,
    usage: {
      image_count: usage.image_count ?? data.length,
      size: usage.size ?? "",
    },
    dashscope_request_id: taskResult.request_id,
  };

  const normalizedBuffer = Buffer.from(JSON.stringify(normalizedBody));

  return {
    statusCode: 200,
    headers: upstreamResult.headers,
    body: createReadStream(normalizedBuffer),
  };
}

async function normalizeVideoResponse(upstreamResult: UpstreamResult): Promise<UpstreamResult> {
  const chunks: Buffer[] = [];
  for await (const chunk of upstreamResult.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  const body = JSON.parse(buffer.toString("utf8"));

  if (body.code || body.output?.task_status === "FAILED") {
    throw new Error(`DashScope task failed: ${body.message ?? body.output?.message ?? "Unknown error"}`);
  }

  const taskId = body.output?.task_id;
  if (!taskId) {
    throw new Error("No task_id in DashScope response");
  }

  const taskResult = await pollForTaskCompletion(taskId, upstreamResult.headers);

  const output = taskResult.output as { task_status?: string; video_url?: string; orig_prompt?: string } | undefined;
  if (output?.task_status !== "SUCCEEDED") {
    throw new Error(`DashScope task did not succeed: ${output?.task_status}`);
  }

  const videoUrl = output?.video_url;
  const data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }> = [];

  if (videoUrl) {
    data.push({ url: videoUrl, revised_prompt: output?.orig_prompt });
  }

  const usage = (taskResult.usage ?? {}) as { video_count?: number; duration?: number; SR?: string | number };
  const normalizedBody = {
    created: Math.floor(Date.now() / 1000),
    data,
    usage: {
      video_count: usage.video_count ?? 1,
      duration: usage.duration ?? 0,
      resolution: usage.SR ?? "",
    },
    dashscope_request_id: taskResult.request_id,
  };

  const normalizedBuffer = Buffer.from(JSON.stringify(normalizedBody));

  return {
    statusCode: 200,
    headers: upstreamResult.headers,
    body: createReadStream(normalizedBuffer),
  };
}

async function pollForTaskCompletion(
  taskId: string,
  headers: Record<string, string | string[]>
): Promise<Record<string, unknown>> {
  const apiKey = extractApiKey(headers);
  if (!apiKey) {
    throw new Error("No API key available for task polling");
  }

  const baseUrl = extractBaseUrl(headers);
  const startTime = Date.now();

  while (Date.now() - startTime < TASK_POLL_TIMEOUT_MS) {
    await sleep(TASK_POLL_INTERVAL_MS);

    const queryUrl = `${baseUrl}${DASHSCOPE_TASK_QUERY_PATH}/${taskId}`;

    const response = await fetch(queryUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Task query failed: ${response.status} ${errorText}`);
    }

    const result = (await response.json()) as Record<string, unknown>;
    const taskStatus = (result as { output?: { task_status?: string } })?.output?.task_status;

    if (taskStatus === "SUCCEEDED" || taskStatus === "FAILED") {
      return result;
    }
  }

  throw new Error(`Task polling timed out after ${TASK_POLL_TIMEOUT_MS}ms`);
}

function extractApiKey(headers: Record<string, string | string[]>): string | null {
  const auth = headers["authorization"] ?? headers["Authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}

function extractBaseUrl(headers: Record<string, string | string[]>): string {
  const xBaseUrl = headers["x-dashscope-base-url"] ?? headers["X-DashScope-Base-Url"];
  if (typeof xBaseUrl === "string") {
    return xBaseUrl;
  }
  return "https://dashscope-intl.aliyuncs.com";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createReadStream(buffer: Buffer): NodeJS.ReadableStream {
  const { Readable } = require("stream");
  return Readable.from(buffer);
}
