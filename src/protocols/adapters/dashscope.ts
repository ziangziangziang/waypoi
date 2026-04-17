import {
  PreparedUpstreamRequest,
  ProtocolAdapter,
  ProtocolBuildRequestContext,
  ProtocolNormalizeResponseContext,
  ProtocolSupportContext,
} from "../types";
import { EndpointDoc, UpstreamResult } from "../../types";
import { brotliDecompressSync, gunzipSync, inflateSync } from "zlib";

const ALL_OPERATIONS = [
  "images_generation",
  "images_edits",
  "video_generations",
] as const;

const STREAM_OPERATIONS = [] as const;

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

    if (operation === "images_generation") {
      return buildImageGenerationRequest(payload, upstreamModel);
    }
    if (operation === "images_edits") {
      return buildImageEditRequest(payload, upstreamModel);
    }
    if (operation === "video_generations") {
      return buildVideoRequest(payload, upstreamModel);
    }

    throw new Error(`Unsupported operation for dashscope: ${operation}`);
  },
  async normalizeResponse(context: ProtocolNormalizeResponseContext): Promise<UpstreamResult> {
    const { operation, upstreamResult, endpoint } = context;

    if (operation === "images_generation" || operation === "images_edits") {
      return normalizeImageResponse(upstreamResult, endpoint);
    }
    if (operation === "video_generations") {
      return normalizeVideoResponse(upstreamResult, endpoint);
    }

    throw new Error(`Unsupported operation for dashscope: ${operation}`);
  },
};

function buildImageGenerationRequest(
  payload: Record<string, unknown>,
  model: string
): PreparedUpstreamRequest {
  const prompt = (payload.prompt as string) ?? "";
  const negativePrompt = (payload.negative_prompt as string) ?? "";
  const n = (payload.n as number) ?? 1;
  const size = (payload.size as string) ?? "2048*2048";
  const seed = payload.seed as number | undefined;
  const watermark = (payload.watermark as boolean) ?? false;
  const promptExtend = (payload.prompt_extend as boolean) ?? true;

  const content: Array<{ text?: string; image?: string }> = [];

  if (prompt) {
    content.push({ text: prompt });
  }

  const imageInputs = extractImageInputs(payload);
  for (const imageUrl of imageInputs) {
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
    path: DASHSCOPE_MULTIMODAL_GEN_PATH,
    payload: body,
  };
}

function buildImageEditRequest(
  payload: Record<string, unknown>,
  model: string
): PreparedUpstreamRequest {
  const prompt = (payload.prompt as string) ?? "";
  const negativePrompt = (payload.negative_prompt as string) ?? "";
  const n = (payload.n as number) ?? 1;
  const size = (payload.size as string) ?? "1024*1024";
  const seed = payload.seed as number | undefined;
  const watermark = (payload.watermark as boolean) ?? false;
  const promptExtend = (payload.prompt_extend as boolean) ?? true;

  const imageInputs = extractImageInputs(payload);
  const content: Array<{ text?: string; image?: string }> = imageInputs
    .slice(0, 3)
    .map((image) => ({ image }));
  if (prompt) {
    content.push({ text: prompt });
  }

  return {
    path: DASHSCOPE_MULTIMODAL_GEN_PATH,
    payload: {
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
  const media = normalizeVideoMedia(payload.media, imageUrl, audioUrl);
  const duration = (payload.duration as number) ?? 5;
  const resolution = (payload.resolution as string) ?? "720P";
  const seed = payload.seed as number | undefined;
  const watermark = (payload.watermark as boolean) ?? false;
  const promptExtend = (payload.prompt_extend as boolean) ?? true;

  const input: Record<string, unknown> = {
    prompt,
    media,
  };

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

async function normalizeImageResponse(
  upstreamResult: UpstreamResult,
  endpoint: EndpointDoc
): Promise<UpstreamResult> {
  const body = await readJsonBody(upstreamResult);

  if (body.code || body.output?.task_status === "FAILED") {
    throw new Error(`DashScope task failed: ${body.message ?? body.output?.message ?? "Unknown error"}`);
  }

  const taskId = body.output?.task_id;
  if (taskId) {
    const taskResult = await pollForTaskCompletion(taskId, endpoint);
    return buildNormalizedImageResult(taskResult, upstreamResult.headers);
  }

  return buildNormalizedImageResult(body, upstreamResult.headers);
}

async function normalizeVideoResponse(
  upstreamResult: UpstreamResult,
  endpoint: EndpointDoc
): Promise<UpstreamResult> {
  const body = await readJsonBody(upstreamResult);

  if (body.code || body.output?.task_status === "FAILED") {
    throw new Error(`DashScope task failed: ${body.message ?? body.output?.message ?? "Unknown error"}`);
  }

  const taskId = body.output?.task_id;
  if (!taskId) {
    throw new Error("No task_id in DashScope response");
  }

  const taskResult = await pollForTaskCompletion(taskId, endpoint);
  const output = taskResult.output as
    | {
        task_status?: string;
        video_url?: string;
        video_urls?: string[];
        orig_prompt?: string;
      }
    | undefined;
  if (output?.task_status !== "SUCCEEDED") {
    throw new Error(`DashScope task did not succeed: ${output?.task_status}`);
  }

  const data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }> = [];
  const videoUrls = Array.isArray(output?.video_urls) ? output.video_urls : [];
  for (const videoUrl of videoUrls) {
    if (typeof videoUrl === "string" && videoUrl.length > 0) {
      data.push({ url: videoUrl, revised_prompt: output?.orig_prompt });
    }
  }
  if (data.length === 0 && output?.video_url) {
    data.push({ url: output.video_url, revised_prompt: output?.orig_prompt });
  }

  const usage = (taskResult.usage ?? {}) as { video_count?: number; duration?: number; SR?: string | number };
  const normalizedBody = {
    created: Math.floor(Date.now() / 1000),
    data,
    usage: {
      video_count: usage.video_count ?? (data.length || 1),
      duration: usage.duration ?? 0,
      resolution: usage.SR ?? "",
    },
    dashscope_request_id: taskResult.request_id,
  };

  const normalizedBuffer = Buffer.from(JSON.stringify(normalizedBody));

  return {
    statusCode: 200,
    headers: stripEntityEncodingHeaders(upstreamResult.headers),
    body: createReadStream(normalizedBuffer),
  };
}

function buildNormalizedImageResult(
  taskResult: Record<string, unknown>,
  headers: Record<string, string | string[]>
): UpstreamResult {
  const output = taskResult.output as {
    choices?: Array<{ message?: { content?: Array<{ type?: string; image?: string }> } }>;
  } | undefined;
  const choices = output?.choices ?? [];
  const data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }> = [];

  for (const choice of choices) {
    const messageContent = choice.message?.content ?? [];
    for (const item of messageContent) {
      if (typeof item.image === "string" && item.image.length > 0) {
        data.push({ url: item.image });
      }
    }
  }

  const usage = (taskResult.usage ?? {}) as {
    image_count?: number;
    size?: string;
    width?: number;
    height?: number;
  };
  const normalizedBody = {
    created: Math.floor(Date.now() / 1000),
    data,
    usage: {
      image_count: usage.image_count ?? data.length,
      size:
        usage.size ??
        (usage.width && usage.height ? `${usage.width}*${usage.height}` : ""),
    },
    dashscope_request_id: taskResult.request_id,
  };

  const normalizedBuffer = Buffer.from(JSON.stringify(normalizedBody));

  return {
    statusCode: 200,
    headers: stripEntityEncodingHeaders(headers),
    body: createReadStream(normalizedBuffer),
  };
}

async function pollForTaskCompletion(
  taskId: string,
  endpoint: EndpointDoc
): Promise<Record<string, unknown>> {
  const apiKey = endpoint.apiKey;
  if (!apiKey) {
    throw new Error("No API key available for task polling");
  }

  const baseUrl = normalizeDashScopeBaseUrl(endpoint.baseUrl);
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

function extractImageInputs(payload: Record<string, unknown>): string[] {
  const imageInputs: string[] = [];
  const images = payload.images;
  if (Array.isArray(images)) {
    for (const item of images) {
      if (typeof item === "string" && item.length > 0) {
        imageInputs.push(item);
      }
    }
  }
  const imageUrl = payload.image_url;
  if (typeof imageUrl === "string" && imageUrl.length > 0) {
    imageInputs.push(imageUrl);
  }
  return Array.from(new Set(imageInputs));
}

function normalizeVideoMedia(
  mediaInput: unknown,
  imageUrl?: string,
  audioUrl?: string
): Array<{ type: string; url: string }> {
  const normalized: Array<{ type: string; url: string }> = [];
  if (Array.isArray(mediaInput)) {
    for (const item of mediaInput) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const typed = item as { type?: unknown; url?: unknown };
      if (typeof typed.type === "string" && typeof typed.url === "string" && typed.url.length > 0) {
        normalized.push({ type: typed.type, url: typed.url });
      }
    }
  }

  if (normalized.length === 0 && imageUrl) {
    normalized.push({ type: "first_frame", url: imageUrl });
  }
  if (audioUrl) {
    normalized.push({ type: "driving_audio", url: audioUrl });
  }
  return normalized;
}

function normalizeDashScopeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function readJsonBody(upstreamResult: UpstreamResult): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of upstreamResult.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const buffer = decodeResponseBuffer(Buffer.concat(chunks), upstreamResult.headers);
  return JSON.parse(buffer.toString("utf8"));
}

function decodeResponseBuffer(
  buffer: Buffer,
  headers: Record<string, string | string[]>
): Buffer {
  const encoding = headerValue(headers, "content-encoding")?.toLowerCase().trim();
  if (!encoding || buffer.length === 0) {
    return buffer;
  }
  if (encoding.includes("gzip")) {
    return gunzipSync(buffer);
  }
  if (encoding.includes("br")) {
    return brotliDecompressSync(buffer);
  }
  if (encoding.includes("deflate")) {
    return inflateSync(buffer);
  }
  return buffer;
}

function stripEntityEncodingHeaders(
  headers: Record<string, string | string[]>
): Record<string, string | string[]> {
  const next: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "content-encoding" || lower === "content-length") {
      continue;
    }
    next[key] = value;
  }
  return next;
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
  return Array.isArray(value) ? value[0] : value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createReadStream(buffer: Buffer): NodeJS.ReadableStream {
  const { Readable } = require("stream");
  return Readable.from(buffer);
}
