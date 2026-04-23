import { inferenceV2ProtocolAdapter } from "./adapters/inferenceV2";
import { openAiProtocolAdapter } from "./adapters/openai";
import { dashscopeProtocolAdapter } from "./adapters/dashscope";
import { cloudflareProtocolAdapter } from "./adapters/cloudflare";
import { ollamaProtocolAdapter } from "./adapters/ollama";
import { geminiProtocolAdapter } from "./adapters/gemini";
import { ProtocolAdapter, ProtocolOperation } from "./types";

const PROTOCOL_ALIASES: Record<string, string> = {
  openai: "openai",
  inference_v2: "inference_v2",
  "kserve-v2": "inference_v2",
  kserve_v2: "inference_v2",
  ray_infer_v2: "inference_v2",
  "ray-infer-v2": "inference_v2",
  v2_infer: "inference_v2",
  "v2-infer": "inference_v2",
  dashscope: "dashscope",
  cloudflare: "cloudflare",
  ollama: "ollama",
  gemini: "gemini",
};

const ADAPTERS = new Map<string, ProtocolAdapter>([
  [openAiProtocolAdapter.id, openAiProtocolAdapter],
  [inferenceV2ProtocolAdapter.id, inferenceV2ProtocolAdapter],
  [dashscopeProtocolAdapter.id, dashscopeProtocolAdapter],
  [cloudflareProtocolAdapter.id, cloudflareProtocolAdapter],
  [ollamaProtocolAdapter.id, ollamaProtocolAdapter],
  [geminiProtocolAdapter.id, geminiProtocolAdapter],
]);

const PROTOCOL_METADATA: Record<string, { label: string; description: string }> = {
  openai: {
    label: "OpenAI Compatible",
    description: "Standard OpenAI API format. Supports chat, embeddings, images, and audio.",
  },
  inference_v2: {
    label: "Inference V2 (KServe/Ray)",
    description: "KServe v2 / Ray Serve inference format. Chat only, no streaming.",
  },
  dashscope: {
    label: "DashScope (Alibaba ModelStudio)",
    description: "Alibaba Cloud ModelStudio native API. Supports image generation, video generation, and async task-based operations.",
  },
  cloudflare: {
    label: "Cloudflare Workers AI",
    description: "Cloudflare Workers AI native protocol. Supports chat completions and native model discovery.",
  },
  ollama: {
    label: "Ollama Cloud",
    description: "Ollama native cloud protocol. Supports chat completions, streaming, and native model discovery.",
  },
  gemini: {
    label: "Google AI Studio (Gemini)",
    description: "Gemini native protocol. Supports chat completions, vision input, streaming, and native model discovery.",
  },
};

export interface ProtocolInfo {
  id: string;
  label: string;
  description: string;
  operations: ProtocolOperation[];
  streamOperations: ProtocolOperation[];
  supportsRouting: boolean;
}

export function canonicalizeProtocol(raw: string | undefined): string {
  const normalized = (raw ?? "unknown").trim().toLowerCase();
  return (PROTOCOL_ALIASES[normalized] ?? normalized) || "unknown";
}

export function getProtocolAdapter(
  protocol: string | undefined
): ProtocolAdapter | null {
  const canonical = canonicalizeProtocol(protocol);
  return ADAPTERS.get(canonical) ?? null;
}

export function hasProtocolAdapter(protocol: string | undefined): boolean {
  return getProtocolAdapter(protocol) !== null;
}

export function listAdapterOperations(
  protocol: string | undefined
): {
  operations: ProtocolOperation[];
  streamOperations: ProtocolOperation[];
} | null {
  const adapter = getProtocolAdapter(protocol);
  if (!adapter) {
    return null;
  }
  return {
    operations: [...adapter.supportedOperations],
    streamOperations: [...adapter.streamSupportedOperations],
  };
}

export function listAllProtocolAdapters(): ProtocolInfo[] {
  return Array.from(ADAPTERS.entries()).map(([id, adapter]) => {
    const meta = PROTOCOL_METADATA[id] ?? { label: id, description: "" };
    return {
      id,
      label: meta.label,
      description: meta.description,
      operations: [...adapter.supportedOperations],
      streamOperations: [...adapter.streamSupportedOperations],
      supportsRouting: true,
    };
  });
}

export function routePathToOperation(path: string): ProtocolOperation | null {
  switch (path) {
    case "/v1/chat/completions":
      return "chat_completions";
    case "/v1/embeddings":
      return "embeddings";
    case "/v1/images/generations":
      return "images_generation";
    case "/v1/images/edits":
      return "images_edits";
    case "/v1/images/variations":
      return "images_variations";
    case "/v1/audio/transcriptions":
      return "audio_transcriptions";
    case "/v1/audio/translations":
      return "audio_translations";
    case "/v1/audio/speech":
      return "audio_speech";
    case "/v1/videos/generations":
      return "video_generations";
    default:
      return null;
  }
}
