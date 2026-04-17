import { routeRequest } from "../routing/router";
import { selectPoolCandidates } from "../pools/scheduler";
import { pickBestProviderModelByCapabilities, resolveModel } from "../providers/modelRegistry";
import { getMediaEntry, getMediaPath, storeMedia } from "../storage/imageCache";
import { StoragePaths } from "../storage/files";
import { ImageGenerationRequest } from "../types";
import { promises as fs } from "fs";
import path from "path";

export interface ImageGenerationRunResult {
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

export interface NormalizedGeneratedImage {
  index: number;
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

export interface NormalizedImageGenerationResult {
  model: string;
  created: number;
  images: NormalizedGeneratedImage[];
}

export async function resolveGenerationModel(
  paths: StoragePaths,
  requestedModel?: string
): Promise<string | null> {
  if (requestedModel) {
    return requestedModel;
  }
  // Keep compatibility with existing /v1/images/generations fallback behavior.
  return pickDefaultDiffusionModel(paths);
}

export async function runImageGeneration(
  paths: StoragePaths,
  request: ImageGenerationRequest,
  headers: Record<string, string | string[] | undefined>,
  signal: AbortSignal
): Promise<ImageGenerationRunResult> {
  const model = request.model
    ? request.model
    : request.image_url
      ? await pickDefaultImageEditModel(paths)
      : await resolveGenerationModel(paths, request.model);
  if (!model) {
    const error = new Error("No diffusion model available. Add or enable a provider model.") as Error & {
      type: string;
      retryable: boolean;
    };
    error.type = "no_diffusion_model";
    error.retryable = false;
    throw error;
  }
  const normalizedRequest = normalizeImageGenerationRequestForModel(request, model);

  let body: { payload: unknown };
  let outcome: Awaited<ReturnType<typeof routeRequest>>;
  const useNativeImageRoute = normalizedRequest.image_url
    ? await shouldUseNativeImageRouteForModel(paths, model)
    : true;

  if (normalizedRequest.image_url && !useNativeImageRoute) {
    const chatPayload = {
      model,
      stream: false,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: normalizedRequest.prompt },
            { type: "image_url", image_url: { url: normalizedRequest.image_url } },
          ],
        },
      ],
    } as Record<string, unknown>;
    try {
      outcome = await routeRequest(
        paths,
        model,
        "/v1/chat/completions",
        chatPayload,
        headers,
        signal,
        {
          requiredInput: ["text", "image"],
          requiredOutput: ["image"],
        }
      );
    } catch (error) {
      const typed = error as Error & { type?: string };
      if (typed.type !== "no_endpoints") {
        throw error;
      }
      outcome = await routeRequest(
        paths,
        model,
        "/v1/chat/completions",
        chatPayload,
        headers,
        signal,
        {
          requiredInput: ["text"],
          requiredOutput: ["image"],
        }
      );
    }
    body = await readBody(outcome.attempt.response);
    body.payload = normalizeChatImagePayload(body.payload);
  } else {
    outcome = await routeRequest(
      paths,
      model,
      "/v1/images/generations",
      { ...normalizedRequest, model } as Record<string, unknown>,
      headers,
      signal,
      {
        endpointType: "diffusion",
        requiredInput: normalizedRequest.image_url ? ["text", "image"] : ["text"],
        requiredOutput: ["image"],
      }
    );
    body = await readBody(outcome.attempt.response);
  }
  body.payload = await materializeRemoteImageOutputs(
    paths,
    body.payload,
    normalizedRequest.response_format ?? "url"
  );

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

export async function shouldUseNativeImageRouteForModel(
  paths: StoragePaths,
  model: string
): Promise<boolean> {
  const resolved = await resolveModel(
    paths,
    model,
    {
      requiredInput: ["text", "image"],
      requiredOutput: ["image"],
    },
    {
      operation: "images_generation",
      stream: false,
    }
  );

  if (resolved.kind === "pool") {
    const selection = await selectPoolCandidates(
      paths,
      resolved.alias,
      {
        requiredInput: ["text", "image"],
        requiredOutput: ["image"],
      },
      {
        operation: "images_generation",
        stream: false,
      }
    );
    return Boolean(selection?.candidates.some((candidate) => candidate.protocol === "dashscope"));
  }

  if (resolved.kind !== "direct") {
    return false;
  }

  return resolved.candidates.some((candidate) => candidate.protocol === "dashscope");
}

export function normalizeImageGenerationRequestForModel(
  request: ImageGenerationRequest,
  model: string
): ImageGenerationRequest {
  if (!request.size || !usesDashScopeImageSizeFormat(model)) {
    return request;
  }
  return {
    ...request,
    size: request.size.replace(/^(\d+)x(\d+)$/i, "$1*$2"),
  };
}

function usesDashScopeImageSizeFormat(model: string): boolean {
  const normalized = model.toLowerCase();
  return (
    normalized.startsWith("ali/") ||
    normalized.startsWith("alibaba-dashscope/") ||
    normalized.includes("/qwen-image") ||
    normalized.includes("/wan")
  );
}

export async function normalizeImageGenerationPayload(
  paths: StoragePaths,
  payload: unknown,
  model: string
): Promise<NormalizedImageGenerationResult> {
  const asObject = (payload ?? {}) as { created?: unknown; data?: unknown };
  const created = typeof asObject.created === "number" ? asObject.created : Math.floor(Date.now() / 1000);
  const data = Array.isArray(asObject.data) ? asObject.data : [];
  const images: NormalizedGeneratedImage[] = [];

  for (let index = 0; index < data.length; index += 1) {
    const item = (data[index] ?? {}) as {
      url?: unknown;
      b64_json?: unknown;
      revised_prompt?: unknown;
    };
    const entry: NormalizedGeneratedImage = { index };
    if (typeof item.revised_prompt === "string" && item.revised_prompt.length > 0) {
      entry.revised_prompt = item.revised_prompt;
    }

    if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
      entry.b64_json = item.b64_json;
    }
    if (typeof item.url === "string" && item.url.length > 0) {
      entry.url = item.url;
    }

    if (!entry.b64_json && entry.url) {
      const extracted = await tryExtractBase64FromUrl(paths, entry.url);
      if (extracted) {
        entry.b64_json = extracted.b64;
        if (!entry.url.startsWith("data:")) {
          entry.url = `data:${extracted.mimeType};base64,${extracted.b64}`;
        }
      }
    }

    if (!entry.url && entry.b64_json) {
      entry.url = `data:image/png;base64,${entry.b64_json}`;
    }

    images.push(entry);
  }

  return { model, created, images };
}

export async function materializeRemoteImageOutputs(
  paths: StoragePaths,
  payload: unknown,
  responseFormat: "url" | "b64_json"
): Promise<unknown> {
  const root = payload as { data?: unknown } | null;
  const data = Array.isArray(root?.data) ? root.data : [];
  if (data.length === 0) {
    return payload;
  }

  const nextData: Array<Record<string, unknown>> = [];
  for (const item of data) {
    const typed = (item ?? {}) as {
      url?: unknown;
      b64_json?: unknown;
      revised_prompt?: unknown;
    };
    const nextItem: Record<string, unknown> = {};
    if (typeof typed.revised_prompt === "string" && typed.revised_prompt.length > 0) {
      nextItem.revised_prompt = typed.revised_prompt;
    }

    const b64 = typeof typed.b64_json === "string" && typed.b64_json.length > 0 ? typed.b64_json : undefined;
    const url = typeof typed.url === "string" && typed.url.length > 0 ? typed.url : undefined;

    if (b64) {
      nextItem.b64_json = b64;
      nextItem.url = normalizeLocalImageUrl(url) ?? `data:image/png;base64,${b64}`;
      nextData.push(nextItem);
      continue;
    }

    if (!url) {
      nextData.push(nextItem);
      continue;
    }

    const normalizedLocalUrl = normalizeLocalImageUrl(url);
    if (normalizedLocalUrl) {
      nextItem.url = normalizedLocalUrl;
      if (responseFormat === "b64_json") {
        const extracted = await tryExtractBase64FromUrl(paths, normalizedLocalUrl);
        if (extracted) {
          nextItem.b64_json = extracted.b64;
        }
      }
      nextData.push(nextItem);
      continue;
    }

    const materialized = await downloadAndCacheRemoteImage(paths, url);
    if (!materialized) {
      nextItem.url = url;
      nextData.push(nextItem);
      continue;
    }

    nextItem.url = materialized.localUrl;
    if (responseFormat === "b64_json") {
      nextItem.b64_json = materialized.b64;
    }
    nextData.push(nextItem);
  }

  return {
    ...(typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {}),
    data: nextData,
  };
}

export function normalizeChatImagePayload(payload: unknown): unknown {
  const root = payload as {
    created?: unknown;
    choices?: unknown;
  };
  const created =
    typeof root?.created === "number" ? root.created : Math.floor(Date.now() / 1000);
  const choices = Array.isArray(root?.choices) ? root.choices : [];
  const firstChoice = (choices[0] ?? null) as
    | {
        message?: { content?: unknown };
      }
    | null;
  const content = firstChoice?.message?.content;

  const data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }> = [];
  let revisedPrompt: string | undefined;

  if (Array.isArray(content)) {
    for (const item of content) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const typed = item as Record<string, unknown>;
      const type = typeof typed.type === "string" ? typed.type : "";
      if (!revisedPrompt && type === "text" && typeof typed.text === "string") {
        revisedPrompt = typed.text.trim() || undefined;
      }
      if (type === "image_url") {
        const imageUrlObject = typed.image_url as { url?: unknown } | undefined;
        if (typeof imageUrlObject?.url === "string" && imageUrlObject.url.length > 0) {
          data.push({ url: imageUrlObject.url });
        }
      } else if (type === "image" && typeof typed.image === "string" && typed.image.length > 0) {
        data.push({ url: typed.image });
      }
    }
  }

  if (typeof content === "string" && content.startsWith("data:image/")) {
    data.push({ url: content });
  }

  if (data.length === 0) {
    const error = new Error("Upstream chat completion did not return any image output.") as Error & {
      type: string;
      retryable: boolean;
    };
    error.type = "invalid_upstream_response";
    error.retryable = true;
    throw error;
  }
  if (revisedPrompt) {
    data[0].revised_prompt = revisedPrompt;
  }

  return { created, data };
}

async function pickDefaultDiffusionModel(paths: StoragePaths): Promise<string | null> {
  const smart = await selectPoolCandidates(
    paths,
    "smart",
    {
      requiredInput: ["text"],
      requiredOutput: ["image"],
    },
    {
      operation: "images_generation",
      stream: false,
    }
  );
  if (smart && smart.candidates.length > 0) {
    return "smart";
  }

  const byCapabilities = await pickBestProviderModelByCapabilities(
    paths,
    { requiredInput: ["text"], requiredOutput: ["image"] },
    "diffusion"
  );
  if (byCapabilities) {
    return byCapabilities;
  }
  return null;
}

async function pickDefaultImageEditModel(paths: StoragePaths): Promise<string | null> {
  const smart = await selectPoolCandidates(
    paths,
    "smart",
    {
      requiredInput: ["image", "text"],
      requiredOutput: ["image"],
    },
    {
      operation: "images_edits",
      stream: false,
    }
  );
  if (smart && smart.candidates.length > 0) {
    return "smart";
  }

  const byCapabilities = await pickBestProviderModelByCapabilities(
    paths,
    { requiredInput: ["image"], requiredOutput: ["image"] },
    "diffusion"
  );
  if (byCapabilities) {
    return byCapabilities;
  }
  return pickDefaultDiffusionModel(paths);
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

async function tryExtractBase64FromUrl(
  paths: StoragePaths,
  url: string
): Promise<{ b64: string; mimeType: string } | null> {
  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/i);
    if (!match) return null;
    return { mimeType: match[1], b64: match[2].replace(/\s+/g, "") };
  }

  const hash = extractLocalHash(url);
  if (!hash) return null;

  const mediaPath = await getMediaPath(paths, hash);
  const mediaEntry = await getMediaEntry(paths, hash);
  if (!mediaPath) return null;
  const buffer = await fs.readFile(mediaPath);
  const mimeType = mediaEntry?.mimeType ?? mimeFromExt(mediaPath);
  return { mimeType, b64: buffer.toString("base64") };
}

async function downloadAndCacheRemoteImage(
  paths: StoragePaths,
  url: string
): Promise<{ localUrl: string; b64: string; mimeType: string } | null> {
  if (!/^https?:\/\//i.test(url)) {
    return null;
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(`Failed to fetch generated image: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const hintedMimeType = normalizeMimeTypeHeader(response.headers.get("content-type"));
  const detectedMimeType = detectImageMimeFromBuffer(buffer);
  const mimeType = hintedMimeType?.startsWith("image/")
    ? hintedMimeType
    : detectedMimeType;
  if (!mimeType) {
    return null;
  }

  const stored = await storeMedia(paths, buffer, { mimeType });
  return {
    localUrl: `/data/images/${stored.hash}`,
    b64: buffer.toString("base64"),
    mimeType: stored.mimeType,
  };
}

function extractLocalHash(url: string): string | null {
  const normalized = normalizeLocalUrl(url);
  if (!normalized) {
    return null;
  }
  const mediaMatch = normalized.match(/^\/(?:admin|data)\/(media|images)\/([a-f0-9]{16})$/i);
  if (!mediaMatch) {
    return null;
  }
  return mediaMatch[2];
}

function normalizeLocalUrl(url: string): string | null {
  if (url.startsWith("/")) {
    return url;
  }
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
      return null;
    }
    return parsed.pathname;
  } catch {
    return null;
  }
}

function normalizeLocalImageUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  if (url.startsWith("data:")) {
    return url;
  }
  const hash = extractLocalHash(url);
  if (!hash) {
    return null;
  }
  return `/data/images/${hash}`;
}

function mimeFromExt(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  return map[ext] ?? "application/octet-stream";
}

function normalizeMimeTypeHeader(contentType: string | null): string | undefined {
  if (!contentType) {
    return undefined;
  }
  return contentType.split(";")[0]?.trim().toLowerCase() || undefined;
}

function detectImageMimeFromBuffer(buffer: Buffer): string | undefined {
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 3 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}
