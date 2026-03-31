import { BenchmarkScenario, BenchmarkScenarioSummary } from "./types";
import { TINY_QA_BENCHMARK, TinyQaRow } from "./tinyQaDataset";

const SHOWCASE_SUITE: BenchmarkScenario[] = TINY_QA_BENCHMARK.map((row) =>
  toTinyQaShowcaseScenario(row)
);

const SUITES: Record<string, BenchmarkScenario[]> = {
  showcase: SHOWCASE_SUITE,
  smoke: [
    {
      id: "smoke-chat-exact",
      mode: "chat",
      prompt: "Reply exactly with: WAYPOI_SMOKE_OK",
      assertions: {
        contains: ["WAYPOI_SMOKE_OK"],
        statusCode: 200,
      },
    },
    {
      id: "smoke-agent-loop",
      mode: "agent",
      prompt:
        "If tools are available, call exactly one and summarize. If no tools are available, output NO_TOOLS_AVAILABLE. Prefix final answer with WAYPOI_AGENT_DONE:",
      maxIterations: 4,
      assertions: {
        contains: ["WAYPOI_AGENT_DONE"],
        statusCode: 200,
      },
    },
    {
      id: "smoke-embeddings-basic",
      mode: "embeddings",
      input: "waypoi benchmark smoke",
      assertions: {
        minItems: 1,
        minVectorLength: 1,
        statusCode: 200,
      },
    },
    {
      id: "smoke-image-generation",
      mode: "image_generation",
      prompt: "A tiny blue square on white background",
      assertions: {
        minImages: 1,
        statusCode: 200,
      },
    },
    {
      id: "smoke-audio-speech",
      mode: "audio_speech",
      inputText: "Waypoi benchmark smoke",
      voice: "alloy",
      assertions: {
        minBytes: 1,
        statusCode: 200,
      },
    },
  ],
  proxy: [
    {
      id: "proxy-chat-short",
      mode: "chat",
      prompt: "Answer with one word: waypoi",
      assertions: {
        contains: ["waypoi"],
        statusCode: 200,
      },
    },
    {
      id: "proxy-embeddings",
      mode: "embeddings",
      input: ["waypoi", "proxy", "benchmark"],
      assertions: {
        minItems: 3,
        minVectorLength: 1,
        statusCode: 200,
      },
    },
    {
      id: "proxy-image",
      mode: "image_generation",
      prompt: "A minimal icon of a gateway",
      assertions: {
        minImages: 1,
        statusCode: 200,
      },
    },
  ],
  agent: [
    {
      id: "agent-tool-loop-basic",
      mode: "agent",
      prompt:
        "Use available tools if useful, then provide a concise final answer prefixed with WAYPOI_AGENT_DONE:",
      maxIterations: 6,
      assertions: {
        contains: ["WAYPOI_AGENT_DONE"],
        statusCode: 200,
      },
    },
    {
      id: "agent-tool-required",
      mode: "agent",
      prompt: "Use at least one tool before answering.",
      maxIterations: 6,
      requiresAvailableTools: true,
      assertions: {
        minToolCalls: 1,
        statusCode: 200,
      },
    },
  ],
  pool_smoke: [
    {
      id: "pool-smart-chat",
      mode: "chat",
      model: "smart",
      prompt: "Reply exactly with: WAYPOI_POOL_SMOKE_OK",
      assertions: {
        contains: ["WAYPOI_POOL_SMOKE_OK"],
        statusCode: 200,
      },
    },
    {
      id: "pool-smart-agent",
      mode: "agent",
      model: "smart",
      prompt: "Answer with prefix WAYPOI_POOL_AGENT_DONE:",
      assertions: {
        contains: ["WAYPOI_POOL_AGENT_DONE:"],
        statusCode: 200,
      },
    },
  ],
  omni_call_smoke: [
    {
      id: "omni-call-basic",
      mode: "omni_call",
      prompt: "Please transcribe this audio and summarize it in one sentence.",
      audioFile: "examples/scenarios/assets/omni-call-sample.wav",
      assertions: {
        statusCode: 200,
      },
    },
  ],
  capabilities: [
    {
      id: "cap.chat_basic",
      mode: "chat",
      capability: "chat_basic",
      prompt: "Reply exactly with: WAYPOI_CAP_CHAT_BASIC_OK",
      assertions: {
        contains: ["WAYPOI_CAP_CHAT_BASIC_OK"],
        statusCode: 200,
      },
    },
    {
      id: "cap.chat_streaming",
      mode: "chat",
      capability: "chat_streaming",
      prompt: "Reply exactly with: WAYPOI_CAP_STREAMING_OK",
      assertions: {
        contains: ["WAYPOI_CAP_STREAMING_OK"],
        statusCode: 200,
      },
    },
    {
      id: "cap.chat_tool_calls",
      mode: "agent",
      capability: "chat_tool_calls",
      prompt: "Use at least one tool if available, then output WAYPOI_CAP_TOOL_CALLS_OK.",
      maxIterations: 4,
      requiresAvailableTools: true,
      assertions: {
        contains: ["WAYPOI_CAP_TOOL_CALLS_OK"],
        minToolCalls: 1,
        statusCode: 200,
      },
    },
    {
      id: "cap.chat_vision_input",
      mode: "chat",
      capability: "chat_vision_input",
      prompt: "Vision probe placeholder: reply with WAYPOI_CAP_VISION_UNKNOWN when image input is unavailable.",
      assertions: {
        statusCode: 200,
      },
    },
    {
      id: "cap.images_generation",
      mode: "image_generation",
      capability: "images_generation",
      prompt: "A monochrome square icon.",
      assertions: {
        minImages: 1,
        statusCode: 200,
      },
    },
    {
      id: "cap.images_edit",
      mode: "image_generation",
      capability: "images_edit",
      prompt: "Image edit probe placeholder",
      assertions: {
        statusCode: 200,
      },
    },
    {
      id: "cap.embeddings",
      mode: "embeddings",
      capability: "embeddings",
      input: "waypoi capability embeddings probe",
      assertions: {
        minItems: 1,
        minVectorLength: 1,
        statusCode: 200,
      },
    },
    {
      id: "cap.audio_transcription",
      mode: "audio_transcription",
      capability: "audio_transcription",
      audioFile: "examples/scenarios/assets/omni-call-sample.wav",
      assertions: {
        statusCode: 200,
      },
    },
    {
      id: "cap.audio_speech",
      mode: "audio_speech",
      capability: "audio_speech",
      inputText: "Waypoi capability speech probe",
      voice: "alloy",
      assertions: {
        minBytes: 1,
        statusCode: 200,
      },
    },
    {
      id: "cap.responses_compat",
      mode: "responses",
      capability: "responses_compat",
      prompt: "Summarize why the Responses API compatibility route matters in one sentence.",
      assertions: {
        statusCode: 200,
      },
    },
  ],
};

function toTinyQaShowcaseScenario(row: TinyQaRow): BenchmarkScenario {
  const padded = String(row.id).padStart(3, "0");
  return {
    id: `showcase-tinyqa-${padded}`,
    mode: "chat",
    title: `Tiny QA #${padded}`,
    summary: "Single-question QA probe from vincentkoc/tiny_qa_benchmark.",
    userVisibleGoal: "Answer a tiny QA question with a concise factual response.",
    exampleSource: "huggingface",
    inputPreview: row.question,
    successCriteria: `HTTP 200 and answer includes: ${row.answer}`,
    expectedHighlights: [`category:${row.category}`, `difficulty:${row.difficulty}`, "gold-answer check"],
    prompt: [
      "Answer with only the final short answer.",
      `Question: ${row.question}`,
      `Reference: ${row.context}`,
    ].join("\n"),
    assertions: {
      statusCode: 200,
      contains: [row.answer],
    },
  };
}

export function builtInSuite(name: string): BenchmarkScenario[] {
  const suite = SUITES[name];
  if (!suite) {
    const available = Object.keys(SUITES).sort().join(", ");
    throw new Error(`Unknown benchmark suite '${name}'. Available: ${available}`);
  }
  return suite.map(cloneScenario);
}

export function listBuiltInSuites(): string[] {
  return Object.keys(SUITES).sort();
}

export function listSuiteExamples(name: string): BenchmarkScenarioSummary[] {
  return builtInSuite(name).map((scenario) => toScenarioSummary(name, scenario));
}

function cloneScenario(scenario: BenchmarkScenario): BenchmarkScenario {
  return {
    ...scenario,
    assertions: { ...scenario.assertions },
    expectedHighlights: scenario.expectedHighlights ? [...scenario.expectedHighlights] : undefined,
    tools: scenario.tools ? [...scenario.tools] : undefined,
    input: Array.isArray(scenario.input) ? [...scenario.input] : scenario.input,
  };
}

function toScenarioSummary(suite: string, scenario: BenchmarkScenario): BenchmarkScenarioSummary {
  return {
    id: scenario.id,
    suite,
    mode: scenario.mode,
    title: scenario.title ?? scenario.id,
    summary: scenario.summary ?? "Built-in benchmark scenario.",
    userVisibleGoal: scenario.userVisibleGoal ?? "Exercise the configured model path and inspect the result.",
    exampleSource: scenario.exampleSource ?? "builtin",
    inputPreview:
      scenario.inputPreview ??
      scenario.prompt ??
      scenario.inputText ??
      (typeof scenario.input === "string" ? scenario.input : Array.isArray(scenario.input) ? scenario.input.join(" | ") : ""),
    successCriteria: scenario.successCriteria ?? "All configured assertions pass.",
    expectedHighlights: scenario.expectedHighlights ?? [],
    requiresAvailableTools: scenario.requiresAvailableTools === true,
    model: scenario.model,
  };
}
