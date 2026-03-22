# Changelog

All notable changes to Waypoi are documented here.

## [0.6.0] - 2026-03-20

### Added

- Built-in MCP service (`POST /mcp`) with two tools:
  - `generate_image` - File-first image generation with workspace-relative output paths
  - `understand_image` - Vision-based image analysis with coordinate-preserving geometry metadata
- Agent Mode in Playground UI - Toggle to enable MCP tool-calling workflows
- Tool Picker component for selecting available MCP tools in agent mode
- Tool call visualization in chat UI with status indicators (pending/executing/success/error)
- Peek Token Flow Sankey diagrams for visualizing token attribution

### Changed

- MCP service uses file-first policy: outputs always write to workspace, rejects paths outside workspace root
- `generate_image` requires `workspace_root` parameter and returns workspace-relative `file_path`
- `understand_image` preserves original image geometry for coordinate-sensitive tasks
- Agent Playground supports up to 10 tool iterations per user message with stop control

## [0.7.1-alpha.1] - 2026-03-21

### Changed

- Fix test runner: replaced Playwright with `npx tsx --test`; removed `@playwright/test` dev dependency.

## [0.7.1-alpha.0] - 2026-03-20

### Breaking Changes

- `generate_image` MCP tool: `workspace_root`, `output_path`, and `output_dir` parameters removed. Outputs now default to `~/.config/waypoi/generated-images`; override with env vars `WAYPOI_MCP_OUTPUT_ROOT` and `WAYPOI_MCP_OUTPUT_SUBDIR`.
- `.env` auto-discovery removed from provider importer. Use the explicit `--env-file` flag instead.

### Added

- Playground auto-connects to the built-in `/mcp` server on startup; built-in tools (`generate_image`, `understand_image`) are pre-selected when agent mode is first enabled.
- Built-in MCP server appears as a permanent `waypoi (built-in)` entry in the ToolPicker — no delete or disconnect controls exposed.
- New CLI utilities: `cli/legacyRewrite.ts`, `cli/modelRef.ts`.
- New tests: `tests/cliLegacyRewrite.test.ts`, `tests/modelRef.test.ts`.

### Changed

- CLI canonical provider/model groups now use one-hop commands:
  - `waypoi providers`
  - `waypoi models <providerId>`
  - `waypoi models show <providerId>/<modelId>`
- Legacy CLI forms rewritten with deprecation warnings; set `WAYPOI_NO_WARN=1` to suppress.
- MCP output location is now globally configured (`~/.config/waypoi/generated-images`) rather than per-call workspace-relative paths.
- `GET /admin/mcp/servers` always includes the built-in server as the first entry.
- README updated with a full features table and corrected architecture docs.

### Removed

- Legacy `smart-*` model alias infrastructure (`LEGACY_SMART_ALIAS_PREFIX`, `isDeprecatedSmartAlias`).
- Backward-compat imageCache aliases (`resolveImagesDir`, `storeImage`, `getImagePath`).
- Stale scripts: `scripts/capture-screenshots.js`, `scripts/seed.ts`, `scripts/release/`.
- Empty placeholder files: `text`, `test.py`, `reference/`.
- `.gitmodules` (unused `openai/codex` submodule reference).

## [0.4.2] - 2026-02-23

### Added

- Model-level capability classification (`input`/`output` modalities) on model mappings.
- `/v1/models` now returns `capabilities` per model while keeping `endpoint_type` for compatibility.
- Capability inference engine with config-first precedence and heuristic fallback.
- Benchmark mode expansion to embeddings, image generation, and audio (speech/transcription), with per-mode assertions.
- Benchmark skip+warn behavior for unconfigured model families plus per-mode summary metrics.

### Changed

- Route eligibility now supports capability requirements (`requiredInput`/`requiredOutput`) in addition to endpoint type.
- Default model selection prefers capability-matching models before endpoint-type fallback.
- Playground model picker labels now show capability tags when available (e.g. `text+image->text`).

## [0.4.1] - 2026-02-23

### Added

- Config-first benchmark system with profile support (`--config`, `--profile`).
- Benchmark baseline comparison support (`--baseline`) for soft regression warnings.
- New benchmark artifact pair per run (`.json` + `.txt`) with gate outcomes and per-scenario measured samples.
- Example benchmark config and scenario files under `examples/`.

### Changed

- Benchmark runner now executes warmup + measured runs and reports pass rate per scenario.
- Scenario schema validation now enforces required fields and emits location-aware error messages.
- Agent benchmark loop now enforces per-tool timeout and max-iteration failure reason (`max_iterations_reached`).

### Fixed

- Benchmark gate semantics now separate hard failures (exit code 1) from soft warnings (exit code 0).

## [0.4.0] - 2026-02-23

### Changed

- Realigned product scope around **model proxy + playground + benchmark**.
- Removed embedded CLI coding-agent runtime surface (`agent`, `run`, `doctor`, and implicit prompt execution).
- Added `waypoi bench` / `waypoi benchmark` command for lightweight benchmarking.
- Added built-in smoke suite and file-driven scenario support (`.json`, `.jsonl`, `.yaml`).
- Added benchmark artifacts under `$WAYPOI_DIR/benchmarks` (or `~/.config/waypoi/benchmarks`).
- Updated docs to position Waypoi as a local gateway for external clients (including Opencode).

### Added

- `docs/opencode.md` for proxy-only Opencode integration.
- `docs/benchmark.md` for benchmark scenarios, assertions, and artifact output.

### Fixed

- Image cache now accepts both raw base64 and `data:image/...;base64,...` payloads.
- New sessions now default to cache-backed image references (`storageVersion: 2`) to avoid session JSON bloat.
- MCP startup/discovery errors are now concise by default, with optional verbose logs via `WAYPOI_DEBUG_ERRORS=1`.

## [0.3.0] - 2026-01-29

### Added

- Responses API compatibility and streaming support.
- MCP tool-call compatibility improvements.
- Waypoi branding and runtime integration updates.

### Fixed

- Model-list compatibility improvements (`slug` and compatibility fields).
- Localhost login bypass behavior for proxied local deployments.
