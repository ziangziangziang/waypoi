import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { StoragePaths } from "../storage/files";
import {
  persistCaptureRecord,
} from "../storage/captureRepository";
import {
  createMcpService,
  McpService,
  McpServiceDependencyOverrides,
} from "../mcp/service";

let activeMcpService: McpService | null = null;

export async function registerMcpServiceRoutes(
  app: FastifyInstance,
  paths: StoragePaths,
  deps?: McpServiceDependencyOverrides
): Promise<void> {
  const mcpService = createMcpService(paths, deps);
  activeMcpService = mcpService;

  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (!isLocalRequest(req)) {
        reply.code(403).send({
          error: {
            message: "Forbidden: /mcp is restricted to localhost",
            type: "forbidden",
          },
        });
        return;
      }

      if (req.method === "GET") {
        reply.code(405).header("Allow", "POST, DELETE").send("Method Not Allowed");
        return;
      }

      const capture = await maybeStartMcpToolCapture(req, reply, paths);
      try {
        await mcpService.handleRequest(req.raw, reply.raw, req.body);
      } finally {
        await capture?.finish();
      }
      reply.hijack();
    },
  });
}

export async function closeMcpServiceRoutes(): Promise<void> {
  if (!activeMcpService) {
    return;
  }
  await activeMcpService.close();
  activeMcpService = null;
}

function isLocalRequest(req: FastifyRequest): boolean {
  const address = normalizeAddress(req.ip ?? req.socket.remoteAddress);
  if (address && !isLocalHost(address)) {
    return false;
  }

  const hostCandidates = [
    firstHeaderValue(req.headers.host),
    firstHeaderValue(req.headers["x-forwarded-host"]),
    extractHostFromOrigin(firstHeaderValue(req.headers.origin)),
  ]
    .map((value) => normalizeHost(value))
    .filter((value): value is string => Boolean(value));

  return hostCandidates.every((host) => isLocalHost(host));
}

function firstHeaderValue(header: string | string[] | undefined): string | undefined {
  if (typeof header === "string") {
    return header;
  }
  if (Array.isArray(header) && header.length > 0) {
    return header[0];
  }
  return undefined;
}

function extractHostFromOrigin(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  try {
    const parsed = new URL(origin);
    return parsed.host;
  } catch {
    return undefined;
  }
}

function normalizeHost(value: string | undefined): string | null {
  if (!value) return null;
  const host = value.split(",")[0].trim().toLowerCase();
  if (!host) return null;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end > -1) {
      return host.slice(1, end);
    }
  }
  return host.split(":")[0];
}

function normalizeAddress(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.startsWith("::ffff:")) {
    return trimmed.replace("::ffff:", "");
  }
  return trimmed;
}

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

async function maybeStartMcpToolCapture(
  req: FastifyRequest,
  reply: FastifyReply,
  paths: StoragePaths
): Promise<{ finish: () => Promise<void> } | null> {
  if (req.method !== "POST") return null;
  const body = asRecord(req.body);
  if (body?.method !== "tools/call") return null;

  const startedAt = Date.now();
  const chunks: Buffer[] = [];
  const raw = reply.raw;
  const originalWrite = raw.write.bind(raw);
  const originalEnd = raw.end.bind(raw);
  let finalized = false;

  const finalize = async (): Promise<void> => {
    if (finalized) return;
    finalized = true;
    raw.write = originalWrite as typeof raw.write;
    raw.end = originalEnd as typeof raw.end;

    const responseBody = payloadToBody(Buffer.concat(chunks));
    const error = extractJsonRpcError(responseBody);
    await persistCaptureRecord(paths, {
      route: req.url,
      method: req.method,
      statusCode: raw.statusCode,
      latencyMs: Date.now() - startedAt,
      requestHeaders: req.headers as Record<string, string | string[] | undefined>,
      responseHeaders: raw.getHeaders() as Record<string, string | string[] | undefined>,
      requestBody: req.body,
      responseBody,
      error,
    });
  };

  raw.write = ((chunk: unknown, ...args: unknown[]) => {
    collectResponseChunk(chunks, chunk);
    return originalWrite(chunk as never, ...(args as never[]));
  }) as typeof raw.write;

  raw.end = ((chunk?: unknown, ...args: unknown[]) => {
    collectResponseChunk(chunks, chunk);
    void finalize().finally(() => {
      originalEnd(chunk as never, ...(args as never[]));
    });
    return raw;
  }) as typeof raw.end;

  return {
    finish: async () => {
      await finalize();
    },
  };
}

function collectResponseChunk(chunks: Buffer[], chunk: unknown): void {
  if (chunk === null || chunk === undefined) return;
  if (Buffer.isBuffer(chunk)) {
    chunks.push(chunk);
    return;
  }
  if (typeof chunk === "string") {
    chunks.push(Buffer.from(chunk));
    return;
  }
  if (chunk instanceof Uint8Array) {
    chunks.push(Buffer.from(chunk));
  }
}

function payloadToBody(payload: Buffer): unknown {
  if (payload.byteLength === 0) return undefined;
  const text = payload.toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractJsonRpcError(value: unknown): { type?: string; message?: string } | undefined {
  const body = asRecord(value);
  const error = asRecord(body?.error);
  if (!error) return undefined;
  const message = typeof error.message === "string" ? error.message : undefined;
  const data = asRecord(error.data);
  const type =
    typeof data?.type === "string"
      ? data.type
      : typeof error.code === "number"
        ? `jsonrpc_${error.code}`
        : "mcp_error";
  return { type, message };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
