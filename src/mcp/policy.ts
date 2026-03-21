import path from "path";

export type McpTypedError = Error & { type: string };

export interface BinaryOutputPolicyInput {
  include_data?: boolean;
}

export interface BinaryOutputPolicyResolved {
  outputDir: string;
  includeData: boolean;
  outputBaseRoot: string;
}

interface ResolveBinaryOutputPolicyOptions {
  env?: NodeJS.ProcessEnv;
  defaultBaseDir?: string;
}

export function typedError(type: string, message: string): McpTypedError {
  const error = new Error(message) as McpTypedError;
  error.type = type;
  return error;
}

export function resolveBinaryOutputPolicy(
  input: BinaryOutputPolicyInput,
  options: ResolveBinaryOutputPolicyOptions = {}
): BinaryOutputPolicyResolved {
  const env = options.env ?? process.env;
  const defaultBaseDir = options.defaultBaseDir ?? process.cwd();
  const strict = parseBooleanEnv(env.WAYPOI_MCP_STRICT_OUTPUT_ROOT);
  const configuredRoot = env.WAYPOI_MCP_OUTPUT_ROOT?.trim();

  if (strict && !configuredRoot) {
    throw typedError(
      "invalid_request",
      "WAYPOI_MCP_STRICT_OUTPUT_ROOT=true requires WAYPOI_MCP_OUTPUT_ROOT to be set."
    );
  }

  let baseRoot = defaultBaseDir;
  if (configuredRoot) {
    if (!path.isAbsolute(configuredRoot)) {
      if (strict) {
        throw typedError(
          "invalid_request",
          `WAYPOI_MCP_OUTPUT_ROOT must be an absolute path, got '${configuredRoot}'.`
        );
      }
    } else {
      baseRoot = path.resolve(configuredRoot);
    }
  }

  const configuredSubdir = env.WAYPOI_MCP_OUTPUT_SUBDIR?.trim();
  if (configuredSubdir && path.isAbsolute(configuredSubdir)) {
    throw typedError(
      "invalid_request",
      `WAYPOI_MCP_OUTPUT_SUBDIR must be relative, got '${configuredSubdir}'.`
    );
  }
  const outputDir = configuredSubdir
    ? path.resolve(baseRoot, configuredSubdir)
    : path.join(baseRoot, "generated-images");

  return {
    outputDir,
    includeData: input.include_data ?? false,
    outputBaseRoot: baseRoot,
  };
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return value === "1" || value.toLowerCase() === "true";
}

export function validateSingleImageInput(input: {
  image_path?: string;
  image_url?: string;
}): void {
  const hasPath = Boolean(input.image_path);
  const hasUrl = Boolean(input.image_url);
  if ((hasPath && hasUrl) || (!hasPath && !hasUrl)) {
    throw typedError(
      "invalid_request",
      "Exactly one image source is required: provide either image_path or image_url."
    );
  }
}

export function validateAtMostOneImageInput(input: {
  image_path?: string;
  image_url?: string;
}): void {
  if (input.image_path && input.image_url) {
    throw typedError(
      "invalid_request",
      "Provide either image_path or image_url, not both."
    );
  }
}
