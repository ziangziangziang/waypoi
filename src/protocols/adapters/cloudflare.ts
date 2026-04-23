import {
  PreparedUpstreamRequest,
  ProtocolAdapter,
  ProtocolBuildRequestContext,
  ProtocolSupportContext,
} from "../types";

const SUPPORTED_OPERATIONS = ["chat_completions"] as const;

export const cloudflareProtocolAdapter: ProtocolAdapter = {
  id: "cloudflare",
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
      path: `${context.endpoint.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      payload: context.payload,
    };
  },
};
