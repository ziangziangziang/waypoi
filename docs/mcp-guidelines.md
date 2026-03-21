# MCP Tool Governance Guidelines

This document is the canonical policy for Waypoi built-in MCP tools (`/mcp`).

Scope:

- Applies to built-in tools registered in `src/mcp/service.ts`.
- Does not enforce behavior for external third-party MCP servers managed under `/admin/mcp/*`.

## 1) Tool description standard

Every tool description should be concise and action-first:

1. Sentence 1: capability summary (what the tool does).
2. Sentence 2: required default behavior for the caller.
3. Sentence 3: the biggest pitfall to avoid.

Binary-producing tools should explicitly mention file-first output behavior.

## 2) Input schema conventions

- Use `snake_case` field names.
- Include explicit bounds/defaults where relevant.
- Represent incompatible options as mutually exclusive inputs and validate at runtime.
- Mark optional non-default behavior clearly (for example `include_data`).

## 3) Output conventions

Top-level response shape:

- Success: `{ ok: true, ... }`
- Error: `{ ok: false, error: { type, message } }`

For binary-producing tools:

- Default to lightweight metadata in responses.
- Require file output when the tool is binary-producing.
- Return `file_path` values relative to the output root rather than absolute host paths.
- Make `file_path` / `file_paths` the canonical small-model result fields.
- Include raw `url` / `b64_json` only with explicit opt-in (`include_data=true`).
- Keep `content.text` compact and free of inline base64.

## 4) Error taxonomy

Use stable typed errors:

- `invalid_request`: parameter validation and contract violations.
- `no_diffusion_model`: no suitable model available for image generation.
- `no_vision_model`: no suitable vision-capable text model available for image understanding.
- `upstream_error`: upstream/provider failures not attributable to caller input.
- `forbidden`: endpoint/policy access denied (for route-level guards).

Error messages should be deterministic and actionable.

## 5) Operational behavior

- Tool handlers should define explicit timeout behavior (for example 60s for image generation).
- Do not silently degrade into inline-only success for binary tools.
- For binary file-output modes, tools MAY override upstream response format to a byte-bearing format to guarantee file materialization.
- Retry behavior should be explicit per tool. If no retries are implemented, fail deterministically.
- In multi-project environments, pin MCP output root via server env:
  - `WAYPOI_MCP_OUTPUT_ROOT=<absolute path>` (default: `~/.config/waypoi`)
  - `WAYPOI_MCP_OUTPUT_SUBDIR=work` (or another controlled relative subdir; default: `generated-images`)
  - `WAYPOI_MCP_STRICT_OUTPUT_ROOT=true` for fail-fast misconfiguration handling.

## 6) Agent behavior guidelines

For tool-calling agents:

1. Prefer file output for binary-generating tools.
2. Keep responses minimal unless inline data is explicitly needed downstream.
3. Avoid repeated expensive calls with unchanged arguments.
4. Use `include_data=true` only for explicit transport requirements.
5. For image-generation editing, provide at most one source (`image_path` xor `image_url`).
6. For image-to-text tools, provide exactly one image source (`image_path` xor `image_url`).

Output goes to `~/.config/waypoi/generated-images` by default. Set `WAYPOI_MCP_OUTPUT_ROOT` to redirect.

### Safe-default example (`generate_image`)

```json
{
  "name": "generate_image",
  "arguments": {
    "prompt": "Minimal icon with clean geometric shape",
    "include_data": false
  }
}
```

### Image-edit example (`generate_image`)

```json
{
  "name": "generate_image",
  "arguments": {
    "prompt": "Replace the background with a clean studio backdrop",
    "image_path": "./tmp/input.png",
    "include_data": false
  }
}
```

### Image-to-text defaults (`understand_image`)

- Exactly one image source is required (`image_path` xor `image_url`).
- Keep `instruction` concise and task-specific unless broad analysis is needed.
- Treat top-level `text` as the canonical answer field.
- For local image files, coordinate-sensitive answers should be expressed in original image pixels even when the upload is resized upstream.

## 7) New MCP tool checklist

Before adding a new built-in MCP tool:

1. Description follows the governance template and includes normative guidance.
2. Input schema uses `snake_case`, bounds/defaults, and validates incompatible combinations.
3. Output shape follows `{ ok: true|false, ... }`, compact `content.text`, and file-first policy for binary payloads.
4. Typed errors are stable and mapped to taxonomy.
5. Tests cover:
   - policy validation rules,
   - default payload behavior,
   - error paths,
   - tool listing/description visibility.
