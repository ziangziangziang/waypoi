import {
  PreparedUpstreamRequest,
  ProtocolAdapter,
  ProtocolBuildRequestContext,
  ProtocolSupportContext,
} from "../types";

const ALL_OPERATIONS = [
  "chat_completions",
  "embeddings",
  "images_generation",
  "images_edits",
  "images_variations",
  "audio_transcriptions",
  "audio_translations",
  "audio_speech",
] as const;

export const openAiProtocolAdapter: ProtocolAdapter = {
  id: "openai",
  supportedOperations: [...ALL_OPERATIONS],
  streamSupportedOperations: [...ALL_OPERATIONS],
  supports(_context: ProtocolSupportContext) {
    return { supported: true };
  },
  async buildRequest(context: ProtocolBuildRequestContext): Promise<PreparedUpstreamRequest> {
    const base = context.endpoint.baseUrl.replace(/\/+$/, "");
    // The gateway route is "/v1/<operation>" (e.g. "/v1/chat/completions").
    // The provider baseUrl is the OpenAI-compatible base, which already carries
    // its own API prefix (typically "/v1"). Concatenate only the operation
    // sub-path so we never clobber any sub-path present in baseUrl
    // (e.g. "https://developer.amd.com.cn/radeon/api/v1").
    const opPath = context.path.replace(/^\/v1\//, "");
    // Preserve the gateway "/v1" only when baseUrl doesn't already expose one,
    // to stay backward compatible with bare baseUrls.
    const operationPath = /\/v1\/?$/i.test(base) ? opPath : `v1/${opPath}`;
    return {
      path: `${base}/${operationPath}`,
      payload: context.payload,
    };
  },
};
