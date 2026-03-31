import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { promises as fs } from "fs";
import Fastify from "fastify";
import {
  appendCaptureStreamChunk,
  registerRequestCaptureMiddleware,
  setCaptureRouting,
  startCaptureStreamResponse,
} from "../src/middleware/requestCapture";
import {
  ensureCaptureStore,
  getCaptureCalendarMonth,
  getCaptureConfig,
  listCaptureRecords,
  persistCaptureRecord,
  updateCaptureConfig,
  getCaptureRecordById,
} from "../src/storage/captureRepository";
import type { StoragePaths } from "../src/storage/files";

function makePaths(baseDir: string): StoragePaths {
  return {
    baseDir,
    configPath: path.join(baseDir, "config.yaml"),
    healthPath: path.join(baseDir, "health.json"),
    providerHealthPath: path.join(baseDir, "providers_health.json"),
    requestLogPath: path.join(baseDir, "request_logs.jsonl"),
    providersPath: path.join(baseDir, "providers.json"),
    poolsPath: path.join(baseDir, "pools.json"),
    poolStatePath: path.join(baseDir, "pool_state.json"),
  };
}

async function makeWorkspaceTempDir(prefix: string): Promise<string> {
  const base = path.join(process.cwd(), "tmp");
  await fs.mkdir(base, { recursive: true });
  return fs.mkdtemp(path.join(base, prefix));
}

test("capture repository toggles config and persists record with media artifact previews", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-test-");
  const paths = makePaths(baseDir);

  await ensureCaptureStore(paths);
  const initial = await getCaptureConfig(paths);
  assert.equal(initial.enabled, false);

  await updateCaptureConfig(paths, { enabled: true });
  const enabled = await getCaptureConfig(paths);
  assert.equal(enabled.enabled, true);

  const pngData =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2w2pQAAAAASUVORK5CYII=";

  const persisted = await persistCaptureRecord(paths, {
    route: "/v1/chat/completions",
    method: "POST",
    statusCode: 200,
    latencyMs: 42,
    requestBody: {
      model: "prov/model",
      messages: [{ role: "system", content: "Read AGENTS.md" }],
      tools: [{ type: "function", function: { name: "my_tool", description: "MCP helper" } }],
      image: pngData,
    },
    responseBody: { ok: true },
    routing: { publicModel: "prov/model", endpointId: "ep-1", upstreamModel: "u-1" },
  });

  assert.ok(persisted);
  assert.equal(persisted?.artifacts.length, 1);
  assert.equal(persisted?.analysis.systemMessages.length, 1);
  assert.equal(persisted?.analysis.systemMessages[0]?.content, "Read AGENTS.md");
  assert.equal(persisted?.analysis.mcpToolDescriptions.length, 1);

  const list = await listCaptureRecords(paths, 5);
  assert.equal(list.data.length, 1);
  const loaded = await getCaptureRecordById(paths, list.data[0].id);
  assert.ok(loaded);
  assert.equal(loaded?.route, "/v1/chat/completions");
  assert.equal(loaded?.analysis.requestTimeline[0]?.kind, "message");
});

test("capture analysis preserves full text and assistant reasoning/tool structure", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-analysis-");
  const paths = makePaths(baseDir);

  await ensureCaptureStore(paths);
  await updateCaptureConfig(paths, { enabled: true });

  const longSystem = "You are opencode. " + "A".repeat(1800);
  const persisted = await persistCaptureRecord(paths, {
    route: "/v1/chat/completions",
    method: "POST",
    statusCode: 200,
    latencyMs: 73,
    requestBody: {
      messages: [
        { role: "system", content: longSystem },
        { role: "user", content: "Could you analyze the repo and clarify the minimal cleanup?" },
        {
          role: "assistant",
          content: "I can do that. Could you confirm whether archive files should be kept?",
          reasoning_content: "I should inspect the repo and then ask one clarifying question.",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "exec_command",
                arguments: "{\"cmd\":\"rg --files\"}",
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: "README.md\nAGENTS.md",
        },
      ],
      tools: [{ type: "function", function: { name: "exec_command", description: "Run shell commands with policy" } }],
    },
    responseBody: { ok: true },
  });

  assert.ok(persisted);
  assert.equal(persisted?.analysis.systemMessages[0]?.content, longSystem);
  assert.equal(
    persisted?.analysis.assistantMessages[0]?.reasoningContent,
    "I should inspect the repo and then ask one clarifying question.",
  );
  assert.equal(persisted?.analysis.assistantMessages[0]?.toolCalls?.[0]?.function?.name, "exec_command");
  assert.equal(persisted?.analysis.assistantMessages[0]?.asksForClarification, true);
  assert.equal(persisted?.analysis.toolMessages[0]?.toolCallId, "call_1");
  assert.match(persisted?.analysis.agentsMdHints[0] ?? "", /AGENTS\.md/);
  assert.deepEqual(
    persisted?.analysis.requestTimeline.map((entry) => entry.kind),
    ["message", "message", "message", "reasoning", "tool_call", "tool_result", "tool_definition"],
  );
});

test("capture list prunes stale index entries whose record files are missing", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-stale-index-");
  const paths = makePaths(baseDir);

  await ensureCaptureStore(paths);
  await updateCaptureConfig(paths, { enabled: true });

  const first = await persistCaptureRecord(paths, {
    route: "/v1/models",
    method: "GET",
    statusCode: 200,
    latencyMs: 5,
    responseBody: { data: [{ id: "demo" }] },
  });
  const second = await persistCaptureRecord(paths, {
    route: "/v1/chat/completions",
    method: "POST",
    statusCode: 200,
    latencyMs: 7,
    responseBody: { id: "chatcmpl-1" },
  });

  assert.ok(first);
  assert.ok(second);

  const indexPath = path.join(baseDir, "capture", "index.jsonl");
  const rawIndex = await fs.readFile(indexPath, "utf8");
  const firstEntry = rawIndex
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { id: string; file: string })
    .find((entry) => entry.id === first?.id);

  assert.ok(firstEntry);
  await fs.unlink(path.join(baseDir, "capture", firstEntry.file));

  const listed = await listCaptureRecords(paths, 10);
  assert.equal(listed.total, 1);
  assert.deepEqual(listed.data.map((entry) => entry.id), [second?.id]);

  const rewrittenIndex = await fs.readFile(indexPath, "utf8");
  assert.doesNotMatch(rewrittenIndex, new RegExp(first!.id));
});

test("capture day bucketing follows requested timezone with UTC fallback", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-timezone-buckets-");
  const paths = makePaths(baseDir);

  await ensureCaptureStore(paths);
  await updateCaptureConfig(paths, { enabled: true });

  const record = await persistCaptureRecord(paths, {
    route: "/v1/chat/completions",
    method: "POST",
    statusCode: 200,
    latencyMs: 8,
    requestBody: { model: "prov/model", messages: [{ role: "user", content: "hello" }] },
    responseBody: { id: "resp-1" },
  });
  assert.ok(record);

  const indexPath = path.join(baseDir, "capture", "index.jsonl");
  const lines = (await fs.readFile(indexPath, "utf8")).split("\n").filter(Boolean);
  const patched = lines.map((line) => {
    const entry = JSON.parse(line) as { id: string; timestamp: string };
    if (entry.id === record!.id) {
      entry.timestamp = "2026-01-01T01:30:00.000Z";
    }
    return JSON.stringify(entry);
  });
  await fs.writeFile(indexPath, `${patched.join("\n")}\n`, "utf8");

  const utcList = await listCaptureRecords(paths, { date: "2026-01-01", timeZone: "UTC", limit: 5 });
  assert.equal(utcList.total, 1);
  const chicagoList = await listCaptureRecords(paths, { date: "2025-12-31", timeZone: "America/Chicago", limit: 5 });
  assert.equal(chicagoList.total, 1);
  const chicagoWrongDay = await listCaptureRecords(paths, { date: "2026-01-01", timeZone: "America/Chicago", limit: 5 });
  assert.equal(chicagoWrongDay.total, 0);

  const fallbackList = await listCaptureRecords(paths, { date: "2026-01-01", timeZone: "Not/A_Zone", limit: 5 });
  assert.equal(fallbackList.total, 1);

  const utcCalendar = await getCaptureCalendarMonth(paths, "2026-01", "UTC");
  assert.deepEqual(utcCalendar, [{ date: "2026-01-01", count: 1 }]);
  const chicagoCalendar = await getCaptureCalendarMonth(paths, "2025-12", "America/Chicago");
  assert.deepEqual(chicagoCalendar, [{ date: "2025-12-31", count: 1 }]);
  const fallbackCalendar = await getCaptureCalendarMonth(paths, "2026-01", "Not/A_Zone");
  assert.deepEqual(fallbackCalendar, [{ date: "2026-01-01", count: 1 }]);
});

test("streamed capture persists routing, headers, and response timeline before onResponse", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-stream-");
  const paths = makePaths(baseDir);

  await ensureCaptureStore(paths);
  await updateCaptureConfig(paths, { enabled: true });

  const app = Fastify();
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
    "data: [DONE]\n\n",
  ];
  await registerRequestCaptureMiddleware(app, paths);
  app.post("/v1/chat/completions", async (_req, reply) => {
    const headers = { "content-type": "text/event-stream" };

    reply.hijack();
    setCaptureRouting(reply, {
      publicModel: "demo/model",
      endpointId: "ep-1",
      endpointName: "Demo Endpoint",
      upstreamModel: "upstream/demo",
    });
    startCaptureStreamResponse(reply, headers, "text/event-stream");
    reply.raw.writeHead(200, headers);
    for (const chunk of chunks) {
      const buffer = Buffer.from(chunk, "utf8");
      appendCaptureStreamChunk(reply, buffer, { contentType: "text/event-stream", headers });
      reply.raw.write(buffer);
    }
    reply.raw.end();
    return reply;
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    payload: { model: "demo/model", stream: true, messages: [{ role: "user", content: "hello" }] },
  });
  assert.equal(response.statusCode, 200);

  let listed = await listCaptureRecords(paths, 5);
  for (let attempt = 0; attempt < 10 && listed.data.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    listed = await listCaptureRecords(paths, 5);
  }
  assert.equal(listed.data.length, 1);
  let loaded = await getCaptureRecordById(paths, listed.data[0].id);
  for (let attempt = 0; attempt < 10 && !loaded; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    loaded = await getCaptureRecordById(paths, listed.data[0].id);
  }

  assert.ok(loaded);
  assert.equal(loaded?.routing.endpointId, "ep-1");
  assert.equal(loaded?.response.headers["content-type"], "text/event-stream");
  assert.equal((loaded?.response.body as { $type?: string })?.$type, "stream");
  assert.equal((loaded?.response.body as { bytes?: number })?.bytes, Buffer.byteLength(chunks.join("")));
  assert.match(String((loaded?.response.body as { text?: string })?.text), /Hello/);
  assert.equal(loaded?.analysis.responseTimeline.length, 1);
  assert.equal(loaded?.analysis.responseTimeline[0]?.kind, "stream_preview");
  assert.match(loaded?.analysis.responseTimeline[0]?.content ?? "", /Hello/);

  await app.close();
});

test("capture token flow uses exact usage totals with estimated category slices", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-token-flow-exact-");
  const paths = makePaths(baseDir);

  await ensureCaptureStore(paths);
  await updateCaptureConfig(paths, { enabled: true });

  const persisted = await persistCaptureRecord(paths, {
    route: "/v1/chat/completions",
    method: "POST",
    statusCode: 200,
    latencyMs: 44,
    requestBody: {
      instructions: "Stay concise.",
      messages: [
        { role: "system", content: "System policy." },
        { role: "user", content: "Explain the request." },
      ],
      tools: [{ type: "function", function: { name: "lookup", description: "Find things" } }],
    },
    responseBody: {
      usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
      choices: [{ message: { role: "assistant", content: "Here is the answer." } }],
    },
  });

  assert.ok(persisted);
  assert.equal(persisted?.analysis.tokenFlow.eligible, true);
  assert.equal(persisted?.analysis.tokenFlow.method, "exact_totals_estimated_categories");
  assert.equal(persisted?.analysis.tokenFlow.totals.inputTokens, 120);
  assert.equal(persisted?.analysis.tokenFlow.totals.outputTokens, 80);
  assert.equal(persisted?.analysis.tokenFlow.totals.totalTokens, 200);
  assert.equal(
    persisted?.analysis.tokenFlow.input.reduce((sum, item) => sum + item.tokens, 0),
    120
  );
  assert.equal(
    persisted?.analysis.tokenFlow.output.reduce((sum, item) => sum + item.tokens, 0),
    80
  );
});

test("capture token flow falls back to estimated mode without usage", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-token-flow-estimated-");
  const paths = makePaths(baseDir);

  await ensureCaptureStore(paths);
  await updateCaptureConfig(paths, { enabled: true });

  const persisted = await persistCaptureRecord(paths, {
    route: "/v1/chat/completions",
    method: "POST",
    statusCode: 200,
    latencyMs: 31,
    requestBody: {
      messages: [{ role: "user", content: "stream this response please" }],
    },
    responseBody: {
      $type: "stream",
      contentType: "text/event-stream",
      bytes: 42,
      text: "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}",
    },
  });

  assert.ok(persisted);
  assert.equal(persisted?.analysis.tokenFlow.eligible, true);
  assert.equal(persisted?.analysis.tokenFlow.method, "estimated_only");
  assert.ok((persisted?.analysis.tokenFlow.totals.totalTokens ?? 0) > 0);
  assert.ok((persisted?.analysis.tokenFlow.input.find((item) => item.key === "unattributed_input")?.tokens ?? 0) >= 0);
  assert.ok((persisted?.analysis.tokenFlow.output.find((item) => item.key === "assistant_text")?.tokens ?? 0) >= 0);
});

test("capture token flow stream output uses extracted SSE text instead of raw payload size", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-token-flow-stream-extracted-");
  const paths = makePaths(baseDir);

  await ensureCaptureStore(paths);
  await updateCaptureConfig(paths, { enabled: true });

  const huge = "A".repeat(20000);
  const sse = [
    "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}",
    "",
    `data: {\"attachments\":[{\"b64_json\":\"${huge}\"}]}`,
    "",
  ].join("\n");

  const persisted = await persistCaptureRecord(paths, {
    route: "/v1/chat/completions",
    method: "POST",
    statusCode: 200,
    latencyMs: 77,
    requestBody: {
      messages: [{ role: "user", content: "brief reply please" }],
    },
    responseBody: {
      $type: "stream",
      contentType: "text/event-stream",
      bytes: Buffer.byteLength(sse),
      text: sse,
    },
  });

  assert.ok(persisted);
  const assistantText = persisted?.analysis.tokenFlow.output.find((item) => item.key === "assistant_text")?.tokens ?? 0;
  const unattributedOutput = persisted?.analysis.tokenFlow.output.find((item) => item.key === "unattributed_output")?.tokens ?? 0;
  assert.equal(assistantText, 1);
  assert.equal(unattributedOutput, 0);
  assert.ok(
    (persisted?.analysis.tokenFlow.notes ?? []).some((note) =>
      note.includes("timeline-equivalent SSE text")
    )
  );
});

test("capture token flow stream output ignores non-text SSE metadata when useful text exists", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-token-flow-stream-mixed-");
  const paths = makePaths(baseDir);

  await ensureCaptureStore(paths);
  await updateCaptureConfig(paths, { enabled: true });

  const huge = "Z".repeat(12000);
  const useful = "hello reason";
  const sse = [
    "data: {\"choices\":[{\"delta\":{\"content\":\"hello \"}}]}",
    "",
    "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"reason\"}}]}",
    "",
    `data: {\"image\":{\"b64_json\":\"${huge}\"}}`,
    "",
  ].join("\n");

  const persisted = await persistCaptureRecord(paths, {
    route: "/v1/chat/completions",
    method: "POST",
    statusCode: 200,
    latencyMs: 66,
    requestBody: {
      messages: [{ role: "user", content: "mixed stream test" }],
    },
    responseBody: {
      $type: "stream",
      contentType: "text/event-stream",
      bytes: Buffer.byteLength(sse),
      text: sse,
    },
  });

  assert.ok(persisted);
  const expected = Math.ceil(Buffer.byteLength(useful, "utf8") / 4);
  const assistantText = persisted?.analysis.tokenFlow.output.find((item) => item.key === "assistant_text")?.tokens ?? 0;
  const unattributedOutput = persisted?.analysis.tokenFlow.output.find((item) => item.key === "unattributed_output")?.tokens ?? 0;
  assert.equal(assistantText, expected);
  assert.equal(unattributedOutput, 0);
});

test("capture token flow stream output attributes both assistant_text and tool_calls", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-token-flow-stream-text-and-tools-");
  const paths = makePaths(baseDir);

  await ensureCaptureStore(paths);
  await updateCaptureConfig(paths, { enabled: true });

  const sse = [
    "data: {\"choices\":[{\"delta\":{\"content\":\"done\"}}]}",
    "",
    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"task\",\"arguments\":\"{\\\"prompt\\\":\\\"hello\\\"}\"}}]}}]}",
    "",
  ].join("\n");

  const persisted = await persistCaptureRecord(paths, {
    route: "/v1/chat/completions",
    method: "POST",
    statusCode: 200,
    latencyMs: 63,
    requestBody: {
      messages: [{ role: "user", content: "run task then answer" }],
    },
    responseBody: {
      $type: "stream",
      contentType: "text/event-stream",
      bytes: Buffer.byteLength(sse),
      text: sse,
    },
  });

  assert.ok(persisted);
  const assistantText = persisted?.analysis.tokenFlow.output.find((item) => item.key === "assistant_text")?.tokens ?? 0;
  const toolCalls = persisted?.analysis.tokenFlow.output.find((item) => item.key === "tool_calls")?.tokens ?? 0;
  assert.ok(assistantText > 0);
  assert.ok(toolCalls > 0);
  assert.ok(
    (persisted?.analysis.tokenFlow.notes ?? []).some((note) =>
      note.includes("timeline-equivalent SSE text and reconstructed streamed tool-call deltas")
    )
  );
});

test("capture token flow stream output attributes tool_calls without fallback when stream has no assistant text", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-token-flow-stream-tools-only-");
  const paths = makePaths(baseDir);

  await ensureCaptureStore(paths);
  await updateCaptureConfig(paths, { enabled: true });

  const sse = [
    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"task\",\"arguments\":\"{\"}}]}}]}",
    "",
    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"prompt\\\":\\\"hello\\\"}\"}}]}}]}",
    "",
  ].join("\n");

  const persisted = await persistCaptureRecord(paths, {
    route: "/v1/chat/completions",
    method: "POST",
    statusCode: 200,
    latencyMs: 52,
    requestBody: {
      messages: [{ role: "user", content: "call tool only" }],
    },
    responseBody: {
      $type: "stream",
      contentType: "text/event-stream",
      bytes: Buffer.byteLength(sse),
      text: sse,
    },
  });

  assert.ok(persisted);
  const assistantText = persisted?.analysis.tokenFlow.output.find((item) => item.key === "assistant_text")?.tokens ?? 0;
  const toolCalls = persisted?.analysis.tokenFlow.output.find((item) => item.key === "tool_calls")?.tokens ?? 0;
  const unattributedOutput = persisted?.analysis.tokenFlow.output.find((item) => item.key === "unattributed_output")?.tokens ?? 0;
  assert.equal(assistantText, 0);
  assert.ok(toolCalls > 0);
  assert.equal(unattributedOutput, 0);
  assert.ok(
    (persisted?.analysis.tokenFlow.notes ?? []).some((note) =>
      note.includes("reconstructed streamed tool-call deltas")
    )
  );
  assert.ok(
    (persisted?.analysis.tokenFlow.notes ?? []).every((note) =>
      !note.includes("fallback uses merged SSE event payload text")
    )
  );
});

test("capture token flow stream output falls back to merged event payload when no text or tool calls are extractable", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-token-flow-stream-fallback-only-");
  const paths = makePaths(baseDir);

  await ensureCaptureStore(paths);
  await updateCaptureConfig(paths, { enabled: true });

  const sse = [
    "data: {\"event\":\"metadata\",\"blob\":{\"id\":\"abc\",\"size\":2048}}",
    "",
    "data: {\"event\":\"stats\",\"dur_ms\":15}",
    "",
  ].join("\n");

  const persisted = await persistCaptureRecord(paths, {
    route: "/v1/chat/completions",
    method: "POST",
    statusCode: 200,
    latencyMs: 41,
    requestBody: {
      messages: [{ role: "user", content: "metadata only stream" }],
    },
    responseBody: {
      $type: "stream",
      contentType: "text/event-stream",
      bytes: Buffer.byteLength(sse),
      text: sse,
    },
  });

  assert.ok(persisted);
  const assistantText = persisted?.analysis.tokenFlow.output.find((item) => item.key === "assistant_text")?.tokens ?? 0;
  const toolCalls = persisted?.analysis.tokenFlow.output.find((item) => item.key === "tool_calls")?.tokens ?? 0;
  const unattributedOutput = persisted?.analysis.tokenFlow.output.find((item) => item.key === "unattributed_output")?.tokens ?? 0;
  assert.equal(assistantText, 0);
  assert.equal(toolCalls, 0);
  assert.ok(unattributedOutput > 0);
  assert.ok(
    (persisted?.analysis.tokenFlow.notes ?? []).some((note) =>
      note.includes("fallback uses merged SSE event payload text")
    )
  );
});

test("streamed response timeline includes reconstructed tool_call entries from delta.tool_calls", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-stream-tool-calls-");
  const paths = makePaths(baseDir);

  await ensureCaptureStore(paths);
  await updateCaptureConfig(paths, { enabled: true });

  const sse = [
    "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"thinking\"}}]}",
    "",
    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_123\",\"type\":\"function\",\"function\":{\"name\":\"task\",\"arguments\":\"{\"}}]}}]}",
    "",
    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"description\\\":\\\"Print\\\"\"}}]}}]}",
    "",
    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\",\\\"prompt\\\":\\\"Print hello\\\"}\"}}]}}]}",
    "",
    "data: {\"choices\":[{\"delta\":{\"content\":\"done\"}}]}",
    "",
  ].join("\n");

  const persisted = await persistCaptureRecord(paths, {
    route: "/v1/chat/completions",
    method: "POST",
    statusCode: 200,
    latencyMs: 12,
    requestBody: {
      messages: [{ role: "user", content: "use task tool" }],
    },
    responseBody: {
      $type: "stream",
      contentType: "text/event-stream",
      bytes: Buffer.byteLength(sse),
      text: sse,
    },
  });

  assert.ok(persisted);
  const responseTimeline = persisted?.analysis.responseTimeline ?? [];
  assert.ok(responseTimeline.some((entry) => entry.kind === "stream_preview"));
  const toolCalls = responseTimeline.filter((entry) => entry.kind === "tool_call");
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0]?.name, "task");
  assert.equal(toolCalls[0]?.toolCallId, "call_123");
  assert.match(toolCalls[0]?.arguments ?? "", /"description":"Print"/);
  assert.match(toolCalls[0]?.arguments ?? "", /"prompt":"Print hello"/);
});

test("streamed response timeline reconstructs multiple tool calls split across chunks", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-stream-multi-tool-calls-");
  const paths = makePaths(baseDir);

  await ensureCaptureStore(paths);
  await updateCaptureConfig(paths, { enabled: true });

  const sse = [
    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_a\",\"type\":\"function\",\"function\":{\"name\":\"task\",\"arguments\":\"{\"}},{\"index\":1,\"id\":\"call_b\",\"type\":\"function\",\"function\":{\"name\":\"task\",\"arguments\":\"{\"}}]}}]}",
    "",
    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"description\\\":\\\"A\\\"}\"}},{\"index\":1,\"function\":{\"arguments\":\"\\\"description\\\":\\\"B\\\"}\"}}]}}]}",
    "",
  ].join("\n");

  const persisted = await persistCaptureRecord(paths, {
    route: "/v1/chat/completions",
    method: "POST",
    statusCode: 200,
    latencyMs: 10,
    requestBody: {
      messages: [{ role: "user", content: "two tools" }],
    },
    responseBody: {
      $type: "stream",
      contentType: "text/event-stream",
      bytes: Buffer.byteLength(sse),
      text: sse,
    },
  });

  assert.ok(persisted);
  const toolCalls = (persisted?.analysis.responseTimeline ?? []).filter((entry) => entry.kind === "tool_call");
  assert.equal(toolCalls.length, 2);
  assert.equal(toolCalls[0]?.toolCallId, "call_a");
  assert.equal(toolCalls[1]?.toolCallId, "call_b");
  assert.match(toolCalls[0]?.arguments ?? "", /"description":"A"/);
  assert.match(toolCalls[1]?.arguments ?? "", /"description":"B"/);
});

test("streamed response timeline remains stream_preview-only when no tool calls are present", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-stream-no-tool-calls-");
  const paths = makePaths(baseDir);

  await ensureCaptureStore(paths);
  await updateCaptureConfig(paths, { enabled: true });

  const sse = [
    "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"think\"}}]}",
    "",
    "data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}",
    "",
  ].join("\n");

  const persisted = await persistCaptureRecord(paths, {
    route: "/v1/chat/completions",
    method: "POST",
    statusCode: 200,
    latencyMs: 14,
    requestBody: {
      messages: [{ role: "user", content: "no tool call" }],
    },
    responseBody: {
      $type: "stream",
      contentType: "text/event-stream",
      bytes: Buffer.byteLength(sse),
      text: sse,
    },
  });

  assert.ok(persisted);
  const responseTimeline = persisted?.analysis.responseTimeline ?? [];
  assert.equal(responseTimeline.filter((entry) => entry.kind === "stream_preview").length, 1);
  assert.equal(responseTimeline.filter((entry) => entry.kind === "tool_call").length, 0);
});

test("capture token flow assigns multimodal input to input_media bucket", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-token-flow-media-");
  const paths = makePaths(baseDir);

  await ensureCaptureStore(paths);
  await updateCaptureConfig(paths, { enabled: true });

  const persisted = await persistCaptureRecord(paths, {
    route: "/v1/chat/completions",
    method: "POST",
    statusCode: 200,
    latencyMs: 28,
    requestBody: {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image." },
            { type: "image_url", image_url: { url: "https://example.com/a.png", detail: "high" } },
          ],
        },
      ],
    },
    responseBody: {
      usage: { prompt_tokens: 500, completion_tokens: 40, total_tokens: 540 },
      choices: [{ message: { role: "assistant", content: "Done." } }],
    },
  });

  assert.ok(persisted);
  assert.equal(persisted?.analysis.tokenFlow.method, "exact_totals_estimated_categories");
  assert.equal(persisted?.analysis.tokenFlow.totals.inputTokens, 500);
  assert.equal(
    persisted?.analysis.tokenFlow.input.reduce((sum, item) => sum + item.tokens, 0),
    500
  );
  assert.ok((persisted?.analysis.tokenFlow.input.find((item) => item.key === "input_media")?.tokens ?? 0) > 0);
});

test("capture record hydration backfills token flow for legacy record shape", async () => {
  const baseDir = await makeWorkspaceTempDir("waypoi-capture-token-flow-hydrate-");
  const paths = makePaths(baseDir);

  await ensureCaptureStore(paths);
  await updateCaptureConfig(paths, { enabled: true });

  const persisted = await persistCaptureRecord(paths, {
    route: "/v1/chat/completions",
    method: "POST",
    statusCode: 200,
    latencyMs: 15,
    requestBody: {
      messages: [{ role: "user", content: "legacy record test" }],
    },
    responseBody: {
      usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
      choices: [{ message: { role: "assistant", content: "ok" } }],
    },
  });
  assert.ok(persisted);

  const indexPath = path.join(baseDir, "capture", "index.jsonl");
  const rawIndex = await fs.readFile(indexPath, "utf8");
  const entry = rawIndex
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { id: string; file: string })
    .find((line) => line.id === persisted?.id);
  assert.ok(entry);

  const recordPath = path.join(baseDir, "capture", entry!.file);
  const rawRecord = await fs.readFile(recordPath, "utf8");
  const parsed = JSON.parse(rawRecord) as { analysis?: Record<string, unknown> };
  if (parsed.analysis) {
    delete parsed.analysis.tokenFlow;
  }
  await fs.writeFile(recordPath, JSON.stringify(parsed, null, 2), "utf8");

  const hydrated = await getCaptureRecordById(paths, persisted!.id);
  assert.ok(hydrated?.analysis.tokenFlow);
  assert.equal(hydrated?.analysis.tokenFlow.method, "exact_totals_estimated_categories");
});
