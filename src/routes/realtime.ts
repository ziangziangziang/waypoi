import { FastifyInstance } from "fastify";
import net from "net";
import tls from "tls";
import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { selectVirtualModelCandidates } from "../virtualModels/scheduler";
import { resolveModel } from "../providers/modelRegistry";
import { StoragePaths } from "../storage/files";
import { VirtualModelCandidate } from "../virtualModels/types";
import { ModelModality } from "../types";

const REALTIME_PATH = "/api-ws/v1/realtime";

export async function registerRealtimeRoutes(
  app: FastifyInstance,
  paths: StoragePaths
): Promise<void> {
  app.server.on("upgrade", (request, socket, head) => {
    void handleRealtimeUpgrade(paths, request, socket, head);
  });
}

async function handleRealtimeUpgrade(
  paths: StoragePaths,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer
): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  if (requestUrl.pathname !== REALTIME_PATH) {
    socket.destroy();
    return;
  }

  try {
    const model = requestUrl.searchParams.get("model");
    if (!model) {
      writeUpgradeError(socket, 400, "Missing required query parameter: model");
      return;
    }

    const candidate = await resolveRealtimeCandidate(paths, model);
    if (!candidate) {
      writeUpgradeError(socket, 400, `No eligible DashScope realtime endpoint for model '${model}'`);
      return;
    }

    const authorizationHeader = getAuthorizationHeader(request, candidate.apiKey);
    if (!authorizationHeader) {
      writeUpgradeError(socket, 400, "No authorization available for DashScope realtime request");
      return;
    }

    await proxyRealtimeSocket(request, socket, head, candidate, authorizationHeader);
  } catch (error) {
    writeUpgradeError(socket, 502, (error as Error).message || "Realtime proxy failed");
  }
}

export async function resolveRealtimeCandidate(
  paths: StoragePaths,
  model: string
): Promise<VirtualModelCandidate | null> {
  const requirements: {
    requiredInput: ModelModality[];
    requiredOutput: ModelModality[];
  } = {
    requiredInput: ["audio"],
    requiredOutput: ["text"],
  };
  const resolved = await resolveModel(paths, model, requirements);

  if (resolved.kind === "virtual_model") {
    const selection = await selectVirtualModelCandidates(paths, resolved.alias, requirements);
    return (
      selection?.candidates.find(
        (candidate) =>
          candidate.protocol === "dashscope" &&
          candidate.endpointType === "audio" &&
          candidate.capabilities.input.includes("audio") &&
          candidate.capabilities.output.includes("text")
      ) ?? null
    );
  }

  if (resolved.kind !== "direct") {
    return null;
  }

  return (
    resolved.candidates.find(
      (candidate) =>
        candidate.protocol === "dashscope" &&
        candidate.endpointType === "audio" &&
        candidate.capabilities.input.includes("audio") &&
        candidate.capabilities.output.includes("text")
    ) ?? null
  );
}

async function proxyRealtimeSocket(
  request: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  candidate: VirtualModelCandidate,
  authorizationHeader: string
): Promise<void> {
  const upstreamUrl = buildRealtimeUpstreamUrl(candidate.baseUrl, request.url ?? REALTIME_PATH);
  const upstreamSocket = await connectToUpstream(upstreamUrl, candidate.insecureTls === true);
  const handshake = buildUpstreamHandshake(request, upstreamUrl, authorizationHeader);

  upstreamSocket.write(handshake);

  let buffered = Buffer.alloc(0);
  const onUpstreamData = (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    const delimiterIndex = buffered.indexOf("\r\n\r\n");
    if (delimiterIndex === -1) {
      return;
    }

    upstreamSocket.off("data", onUpstreamData);

    const responseHead = buffered.subarray(0, delimiterIndex + 4);
    const responseRest = buffered.subarray(delimiterIndex + 4);
    const statusLine = responseHead.toString("utf8").split("\r\n", 1)[0] ?? "";
    const statusCode = Number(statusLine.split(" ")[1] ?? "0");

    clientSocket.write(responseHead);
    if (responseRest.length > 0) {
      clientSocket.write(responseRest);
    }

    if (statusCode !== 101) {
      clientSocket.end();
      upstreamSocket.end();
      return;
    }

    if (head.length > 0) {
      upstreamSocket.write(head);
    }

    clientSocket.pipe(upstreamSocket);
    upstreamSocket.pipe(clientSocket);
  };

  upstreamSocket.on("data", onUpstreamData);
  upstreamSocket.on("error", () => {
    if (!clientSocket.destroyed) {
      clientSocket.destroy();
    }
  });
  clientSocket.on("error", () => {
    if (!upstreamSocket.destroyed) {
      upstreamSocket.destroy();
    }
  });
  clientSocket.on("close", () => {
    if (!upstreamSocket.destroyed) {
      upstreamSocket.destroy();
    }
  });
  upstreamSocket.on("close", () => {
    if (!clientSocket.destroyed) {
      clientSocket.destroy();
    }
  });
}

export function buildRealtimeUpstreamUrl(baseUrl: string, requestUrl: string): URL {
  const base = new URL(baseUrl);
  const local = new URL(requestUrl, "http://localhost");
  const protocol = base.protocol === "https:" ? "wss:" : "ws:";
  const upstream = new URL(`${protocol}//${base.host}${REALTIME_PATH}`);
  upstream.search = local.search;
  return upstream;
}

function connectToUpstream(url: URL, insecureTls: boolean): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const port = Number(url.port || (url.protocol === "wss:" ? "443" : "80"));
    const host = url.hostname;
    const onError = (error: Error) => reject(error);

    const socket =
      url.protocol === "wss:"
        ? tls.connect(
            {
              host,
              port,
              servername: host,
              rejectUnauthorized: !insecureTls,
            },
            () => resolve(socket)
          )
        : net.connect({ host, port }, () => resolve(socket));

    socket.once("error", onError);
    socket.once("connect", () => socket.off("error", onError));
    if (url.protocol === "wss:") {
      socket.once("secureConnect", () => socket.off("error", onError));
    }
  });
}

export function buildUpstreamHandshake(
  request: IncomingMessage,
  upstreamUrl: URL,
  authorizationHeader: string
): string {
  const forwardedHeaders: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(request.headers)) {
    if (!value) {
      continue;
    }
    const lower = key.toLowerCase();
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "upgrade" ||
      lower === "content-length" ||
      lower === "authorization"
    ) {
      continue;
    }
    forwardedHeaders.push([key, Array.isArray(value) ? value.join(", ") : value]);
  }

  forwardedHeaders.push(["Host", upstreamUrl.host]);
  forwardedHeaders.push(["Connection", "Upgrade"]);
  forwardedHeaders.push(["Upgrade", "websocket"]);
  forwardedHeaders.push(["Authorization", authorizationHeader]);

  const headerLines = forwardedHeaders.map(([key, value]) => `${key}: ${value}`);
  return `GET ${upstreamUrl.pathname}${upstreamUrl.search} HTTP/1.1\r\n${headerLines.join("\r\n")}\r\n\r\n`;
}

function getAuthorizationHeader(
  request: IncomingMessage,
  apiKey?: string
): string | null {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === "string" && authHeader.trim().length > 0) {
    return authHeader;
  }
  if (apiKey && apiKey.length > 0) {
    return `Bearer ${apiKey}`;
  }
  return null;
}

function writeUpgradeError(socket: Duplex, statusCode: number, message: string): void {
  if (socket.destroyed) {
    return;
  }
  const payload = JSON.stringify({ error: { message } });
  socket.end(
    `HTTP/1.1 ${statusCode} Error\r\n` +
      "Content-Type: application/json\r\n" +
      `Content-Length: ${Buffer.byteLength(payload)}\r\n` +
      "Connection: close\r\n\r\n" +
      payload
  );
}
