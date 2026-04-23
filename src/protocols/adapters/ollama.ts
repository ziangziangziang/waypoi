import { Readable } from "stream";
import {
  PreparedUpstreamRequest,
  ProtocolAdapter,
  ProtocolBuildRequestContext,
  ProtocolNormalizeResponseContext,
  ProtocolSupportContext,
} from "../types";
import { UpstreamResult } from "../../types";

const SUPPORTED_OPERATIONS = ["chat_completions"] as const;

interface OllamaMessage {
  role?: string;
  content?: string;
}

interface OllamaChatResponse {
  model?: string;
  created_at?: string;
  message?: OllamaMessage;
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export const ollamaProtocolAdapter: ProtocolAdapter = {
  id: "ollama",
  supportedOperations: [...SUPPORTED_OPERATIONS],
  streamSupportedOperations: [...SUPPORTED_OPERATIONS],
  supports(context: ProtocolSupportContext) {
    if (!SUPPORTED_OPERATIONS.includes(context.operation as typeof SUPPORTED_OPERATIONS[number])) {
      return { supported: false, reason: "unsupported_operation" };
    }
    return { supported: true };
  },
  async buildRequest(context: ProtocolBuildRequestContext): Promise<PreparedUpstreamRequest> {
    return {
      path: `${context.endpoint.baseUrl.replace(/\/+$/, "")}/chat`,
      payload: context.payload,
    };
  },
  async normalizeResponse(context: ProtocolNormalizeResponseContext): Promise<UpstreamResult> {
    if (context.operation !== "chat_completions") {
      throw new Error(`Unsupported operation for ollama: ${context.operation}`);
    }
    return context.stream
      ? normalizeStreamingChatResponse(context)
      : normalizeChatResponse(context);
  },
};

async function normalizeChatResponse(
  context: ProtocolNormalizeResponseContext
): Promise<UpstreamResult> {
  const raw = await readStreamToBuffer(context.upstreamResult.body);
  const parsed = JSON.parse(raw.toString("utf8")) as OllamaChatResponse;
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
  const stream = toOpenAiSseStream(context.upstreamResult.body, context);
  return {
    statusCode: context.upstreamResult.statusCode,
    headers: {
      ...context.upstreamResult.headers,
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
    body: stream,
  };
}

function toOpenAiSseStream(
  upstream: NodeJS.ReadableStream,
  context: ProtocolNormalizeResponseContext
): Readable {
  return Readable.from(
    (async function* () {
      let buffer = "";

      for await (const chunk of upstream) {
        buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          const event = JSON.parse(trimmed) as OllamaChatResponse;
          yield Buffer.from(`data: ${JSON.stringify(buildOpenAiChatChunk(event, context))}\n\n`, "utf8");
          if (event.done) {
            yield Buffer.from("data: [DONE]\n\n", "utf8");
          }
        }
      }

      const tail = buffer.trim();
      if (!tail) {
        return;
      }
      const event = JSON.parse(tail) as OllamaChatResponse;
      yield Buffer.from(`data: ${JSON.stringify(buildOpenAiChatChunk(event, context))}\n\n`, "utf8");
      if (event.done) {
        yield Buffer.from("data: [DONE]\n\n", "utf8");
      }
    })()
  );
}

function buildOpenAiChatCompletion(
  response: OllamaChatResponse,
  context: ProtocolNormalizeResponseContext
): Record<string, unknown> {
  const message = response.message ?? {};
  const promptTokens = normalizeTokenCount(response.prompt_eval_count);
  const completionTokens = normalizeTokenCount(response.eval_count);
  const totalTokens =
    promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null;

  return {
    id: buildResponseId(response, context),
    object: "chat.completion",
    created: toUnixSeconds(response.created_at),
    model: response.model ?? context.upstreamModel,
    choices: [
      {
        index: 0,
        message: {
          role: message.role ?? "assistant",
          content: message.content ?? "",
        },
        finish_reason: toFinishReason(response.done_reason, response.done),
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
  response: OllamaChatResponse,
  context: ProtocolNormalizeResponseContext
): Record<string, unknown> {
  const message = response.message ?? {};
  return {
    id: buildResponseId(response, context),
    object: "chat.completion.chunk",
    created: toUnixSeconds(response.created_at),
    model: response.model ?? context.upstreamModel,
    choices: [
      {
        index: 0,
        delta: {
          role: message.role ?? "assistant",
          ...(typeof message.content === "string" ? { content: message.content } : {}),
        },
        finish_reason: response.done ? toFinishReason(response.done_reason, response.done) : null,
      },
    ],
  };
}

function buildResponseId(
  response: OllamaChatResponse,
  context: ProtocolNormalizeResponseContext
): string {
  const created = response.created_at ? Date.parse(response.created_at) : Date.now();
  return `chatcmpl-ollama-${Math.max(0, Math.floor(created / 1000))}`;
}

function toUnixSeconds(createdAt: string | undefined): number {
  if (!createdAt) {
    return Math.floor(Date.now() / 1000);
  }
  const parsed = Date.parse(createdAt);
  if (Number.isFinite(parsed)) {
    return Math.floor(parsed / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

function toFinishReason(doneReason: string | undefined, done: boolean | undefined): string | null {
  if (doneReason === "stop" || doneReason === "length" || doneReason === "tool_calls") {
    return doneReason;
  }
  if (done) {
    return "stop";
  }
  return null;
}

function normalizeTokenCount(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
