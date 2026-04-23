import { Readable } from "stream";
import {
  PreparedUpstreamRequest,
  ProtocolAdapter,
  ProtocolBuildRequestContext,
  ProtocolNormalizeResponseContext,
  ProtocolSupportContext,
} from "../types";
import { UpstreamError, UpstreamResult } from "../../types";

const SUPPORTED_OPERATIONS = ["chat_completions"] as const;

interface GeminiTextPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiContent {
  role?: string;
  parts?: GeminiTextPart[];
}

interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
}

type GeminiMessage = {
  role?: string;
  content?: unknown;
};

export const geminiProtocolAdapter: ProtocolAdapter = {
  id: "gemini",
  supportedOperations: [...SUPPORTED_OPERATIONS],
  streamSupportedOperations: [...SUPPORTED_OPERATIONS],
  supports(context: ProtocolSupportContext) {
    if (!SUPPORTED_OPERATIONS.includes(context.operation as typeof SUPPORTED_OPERATIONS[number])) {
      return { supported: false, reason: "unsupported_operation" };
    }
    return { supported: true };
  },
  async buildRequest(context: ProtocolBuildRequestContext): Promise<PreparedUpstreamRequest> {
    const payload = await buildGeminiPayload(context);
    const method = context.stream ? "streamGenerateContent?alt=sse" : "generateContent";

    return {
      path: `${context.endpoint.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(normalizeModelName(context.upstreamModel))}:${method}`,
      payload,
      headers: {
        "x-goog-api-key": context.endpoint.apiKey ?? "",
        accept: context.stream ? "text/event-stream" : "application/json",
      },
      skipDefaultAuth: true,
    };
  },
  async normalizeResponse(context: ProtocolNormalizeResponseContext): Promise<UpstreamResult> {
    if (context.operation !== "chat_completions") {
      throw protocolError("unsupported_operation", `Unsupported operation for gemini: ${context.operation}`, false);
    }
    return context.stream
      ? normalizeStreamingChatResponse(context)
      : normalizeChatResponse(context);
  },
};

async function buildGeminiPayload(
  context: ProtocolBuildRequestContext
): Promise<Record<string, unknown>> {
  const messages = Array.isArray(context.payload.messages)
    ? (context.payload.messages as GeminiMessage[])
    : [];

  const systemParts: GeminiTextPart[] = [];
  const contents: Array<{ role: "user" | "model"; parts: GeminiTextPart[] }> = [];

  for (const message of messages) {
    const role = typeof message.role === "string" ? message.role : "user";
    const parts = await normalizeMessageParts(message.content);
    if (parts.length === 0) {
      continue;
    }
    if (role === "system") {
      systemParts.push(...parts.filter((part) => typeof part.text === "string" && part.text.length > 0));
      continue;
    }
    if (role === "tool") {
      throw protocolError("invalid_request", "Gemini native adapter does not support tool role messages in v1.", false);
    }
    contents.push({
      role: role === "assistant" ? "model" : "user",
      parts,
    });
  }

  const generationConfig: Record<string, unknown> = {};
  if (typeof context.payload.max_tokens === "number") {
    generationConfig.maxOutputTokens = context.payload.max_tokens;
  }
  if (typeof context.payload.temperature === "number") {
    generationConfig.temperature = context.payload.temperature;
  }
  if (typeof context.payload.top_p === "number") {
    generationConfig.topP = context.payload.top_p;
  }
  if (typeof context.payload.top_k === "number") {
    generationConfig.topK = context.payload.top_k;
  }
  const responseFormat = context.payload.response_format as { type?: unknown } | undefined;
  if (responseFormat?.type === "json_object" || context.payload.format === "json") {
    generationConfig.responseMimeType = "application/json";
  }

  return compactObject({
    contents,
    systemInstruction:
      systemParts.length > 0
        ? {
            parts: systemParts,
          }
        : undefined,
    generationConfig: Object.keys(generationConfig).length > 0 ? generationConfig : undefined,
  });
}

async function normalizeMessageParts(content: unknown): Promise<GeminiTextPart[]> {
  if (typeof content === "string") {
    return content.length > 0 ? [{ text: content }] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const parts: GeminiTextPart[] = [];
  for (const rawPart of content) {
    if (!rawPart || typeof rawPart !== "object") {
      continue;
    }
    const part = rawPart as Record<string, unknown>;
    const type = typeof part.type === "string" ? part.type : "";

    if (type === "text" || type === "input_text" || type === "output_text") {
      const text = part.text;
      if (typeof text === "string" && text.length > 0) {
        parts.push({ text });
      }
      continue;
    }

    if (type === "image_url" || type === "image" || type === "input_image") {
      const value = extractImageValue(part, type);
      if (!value) {
        continue;
      }
      parts.push({ inlineData: parseImageDataUrl(value) });
    }
  }

  return parts;
}

function extractImageValue(part: Record<string, unknown>, type: string): string | null {
  if (type === "image_url") {
    const imageUrl = part.image_url as { url?: unknown } | undefined;
    return typeof imageUrl?.url === "string" ? imageUrl.url : null;
  }
  if (type === "image") {
    return typeof part.image === "string" ? part.image : null;
  }
  const imageUrl = part.image_url as { url?: unknown } | undefined;
  if (typeof imageUrl?.url === "string") {
    return imageUrl.url;
  }
  return typeof part.image === "string" ? part.image : null;
}

function parseImageDataUrl(value: string): { mimeType: string; data: string } {
  const match = value.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) {
    throw protocolError(
      "invalid_request",
      "Gemini image input requires a data URL. Use Waypoi-uploaded or inline images in v1.",
      false
    );
  }
  return {
    mimeType: match[1],
    data: match[2].replace(/\s+/g, ""),
  };
}

async function normalizeChatResponse(
  context: ProtocolNormalizeResponseContext
): Promise<UpstreamResult> {
  const raw = await readStreamToBuffer(context.upstreamResult.body);
  const parsed = JSON.parse(raw.toString("utf8")) as GeminiGenerateContentResponse;
  const body = buildOpenAiChatCompletion(parsed, context);

  return {
    statusCode: context.upstreamResult.statusCode,
    headers: {
      ...context.upstreamResult.headers,
      "content-type": "application/json",
    },
    body: Readable.from([Buffer.from(JSON.stringify(body), "utf8")]),
    rawBody: raw,
  };
}

async function normalizeStreamingChatResponse(
  context: ProtocolNormalizeResponseContext
): Promise<UpstreamResult> {
  return {
    statusCode: context.upstreamResult.statusCode,
    headers: {
      ...context.upstreamResult.headers,
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
    body: toOpenAiSseStream(context.upstreamResult.body, context),
  };
}

function toOpenAiSseStream(
  upstream: NodeJS.ReadableStream,
  context: ProtocolNormalizeResponseContext
): Readable {
  return Readable.from(
    (async function* () {
      const responseId = buildResponseId();
      let buffer = "";

      for await (const chunk of upstream) {
        buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);

        while (true) {
          const boundary = buffer.indexOf("\n\n");
          if (boundary === -1) {
            break;
          }
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = extractSseData(block);
          if (!data) {
            continue;
          }
          const parsed = JSON.parse(data) as GeminiGenerateContentResponse;
          const chunkPayload = buildOpenAiChatChunk(parsed, context, responseId);
          if (chunkPayload) {
            yield Buffer.from(`data: ${JSON.stringify(chunkPayload)}\n\n`, "utf8");
          }
          const finishReason = toFinishReason(parsed.candidates?.[0]?.finishReason);
          if (finishReason) {
            yield Buffer.from(
              `data: ${JSON.stringify(buildOpenAiFinishChunk(context, responseId, finishReason))}\n\n`,
              "utf8"
            );
            yield Buffer.from("data: [DONE]\n\n", "utf8");
          }
        }
      }
    })()
  );
}

function extractSseData(block: string): string | null {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  if (lines.length === 0) {
    return null;
  }
  return lines.join("\n");
}

function buildOpenAiChatCompletion(
  response: GeminiGenerateContentResponse,
  context: ProtocolNormalizeResponseContext
): Record<string, unknown> {
  const promptTokens = normalizeTokenCount(response.usageMetadata?.promptTokenCount);
  const completionTokens = normalizeTokenCount(response.usageMetadata?.candidatesTokenCount);
  const totalTokens =
    normalizeTokenCount(response.usageMetadata?.totalTokenCount) ??
    (promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null);

  return {
    id: buildResponseId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: response.modelVersion ?? normalizeModelName(context.upstreamModel),
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: extractCandidateText(response.candidates?.[0]),
        },
        finish_reason: toFinishReason(response.candidates?.[0]?.finishReason) ?? "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    },
  };
}

function buildOpenAiChatChunk(
  response: GeminiGenerateContentResponse,
  context: ProtocolNormalizeResponseContext,
  responseId: string
): Record<string, unknown> | null {
  const candidate = response.candidates?.[0];
  const content = extractCandidateText(candidate);
  if (!content) {
    return null;
  }
  return {
    id: responseId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: response.modelVersion ?? normalizeModelName(context.upstreamModel),
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          content,
        },
        finish_reason: null,
      },
    ],
  };
}

function buildOpenAiFinishChunk(
  context: ProtocolNormalizeResponseContext,
  responseId: string,
  finishReason: string
): Record<string, unknown> {
  return {
    id: responseId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: normalizeModelName(context.upstreamModel),
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: finishReason,
      },
    ],
  };
}

function extractCandidateText(candidate: GeminiCandidate | undefined): string {
  const parts = Array.isArray(candidate?.content?.parts) ? candidate?.content?.parts : [];
  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter((part) => part.length > 0)
    .join("");
}

function normalizeModelName(model: string): string {
  return model.startsWith("models/") ? model.slice("models/".length) : model;
}

function toFinishReason(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === "MAX_TOKENS") {
    return "length";
  }
  if (normalized === "STOP" || normalized === "FINISH_REASON_UNSPECIFIED") {
    return "stop";
  }
  if (normalized === "SAFETY" || normalized === "BLOCKLIST" || normalized === "PROHIBITED_CONTENT") {
    return "content_filter";
  }
  return "stop";
}

function normalizeTokenCount(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildResponseId(): string {
  return `chatcmpl-gemini-${Date.now().toString(36)}`;
}

async function readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

function protocolError(type: string, message: string, retryable: boolean): UpstreamError {
  const error = new Error(message) as UpstreamError;
  error.type = type;
  error.retryable = retryable;
  return error;
}
