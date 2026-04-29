# Waypoi Benchmark

Waypoi benchmark now has two roles:

- `showcase`: a live, user-visible replay of curated examples
- `diagnostic`: the older internal smoke/capability/regression path

Default behavior is showcase-first.

## Quick start

The default benchmark policy is intentionally small: choose a `suite`, optionally
pin a `model`, and pass generation `parameters` only when you want to tune the
run. Advanced controls still exist for scenarios, profiles, baselines, and
capability cache updates.

```bash
# Default run: showcase suite, one visible replay per example
waypoi bench

# List showcase examples
waypoi bench --list-examples

# Run one example
waypoi bench --example showcase-tinyqa-001

# Pin a model for a showcase example
waypoi bench --suite showcase --example showcase-tinyqa-001 --model smart

# Run a diagnostic suite
waypoi bench --mode diagnostic --suite virtual_model_smoke

# Add file-driven scenarios
waypoi bench --scenario ./examples/scenarios/custom.yaml

# Compare with a previous diagnostic run
waypoi bench --mode diagnostic --baseline ~/.config/waypoi/benchmarks/bench-2026-02-23T12-00-00-000Z.json
```

Admin/API runs should prefer the simple request body:

```json
{
  "model": "smart",
  "suite": "showcase",
  "parameters": {
    "temperature": 0,
    "top_p": 1,
    "max_tokens": 512
  }
}
```

The server normalizes this to the existing runner options. Legacy top-level
fields such as `modelOverride`, `temperature`, `profile`, and `scenarioPath`
remain supported for advanced callers.

## CLI options

- `--suite <name>` built-in suite. Public default is `showcase`.
- `--model <name>` force one model for all scenarios.
- `--temperature <n>` run-level generation override for supported modes.
- `--top-p <n>` run-level generation override (`0..1`) for supported modes.
- `--max-tokens <n>` run-level generation override (`>=1`) for supported modes.
- `--presence-penalty <n>` run-level generation override (`-2..2`) for supported modes.
- `--frequency-penalty <n>` run-level generation override (`-2..2`) for supported modes.
- `--seed <n>` optional run-level deterministic seed (`>=0`) for supported modes.
- `--stop <value>` optional stop sequence (string) or comma-separated list in UI.

Advanced options:

- `--example <id>` run one built-in example from the selected suite.
- `--list-examples` list built-in examples and exit.
- `--mode <name>` `showcase` or `diagnostic`.
- `--scenario <path>` scenario file (`.json`, `.jsonl`, `.yaml`, `.yml`).
- `--out <path>` output file (`.json`/`.txt`) or output directory.
- `--config <path>` benchmark config file (YAML or JSON).
- `--profile <name>` config profile (default: `local`).
- `--baseline <path>` previous benchmark report for p95/throughput deltas.
- `--update-cap-cache` persist capability findings to `$WAYPOI_DIR/capabilities`.
- `--cap-ttl-days <n>` capability TTL override for freshness (default `7`).

## Showcase examples

The `showcase` suite is the release-facing path. It is built from Hugging Face
dataset `vincentkoc/tiny_qa_benchmark` (train split):

- 52 single-question QA prompts
- chat-mode single-turn runs
- per-question answer checks via `contains`
- category/difficulty metadata exposed as expected highlights

Showcase behavior:

- sequential only
- one visible replay per scenario
- request/response trace is the main artifact
- verdict explains what passed or failed
- raw payloads stay in the live event stream; persisted artifacts keep sanitized traces

## Diagnostic suites

The older suites remain for engineering use:

- `smoke`
- `proxy`
- `agent`
- `virtual_model_smoke`
- `omni_call_smoke`
- `capabilities`

Diagnostic behavior:

- profile-driven warmup and measured runs
- pass-rate and latency summaries
- optional baseline regression warnings
- optional capability cache updates

Concurrency is no longer part of the benchmark story.

## Scenario schema

Required fields:

- `id: string`
- `mode: "chat" | "agent" | "responses" | "embeddings" | "image_generation" | "audio_transcription" | "audio_speech" | "omni_call"`

Mode-specific required fields:

- `chat | agent | responses | image_generation`: `prompt`
- `embeddings`: `input`
- `audio_transcription`: `audioFile`
- `audio_speech`: `inputText`, `voice`
- `omni_call`: `audioFile`

Useful showcase metadata:

- `title`
- `summary`
- `userVisibleGoal`
- `exampleSource`
- `inputPreview`
- `successCriteria`
- `expectedHighlights`
- `requiresAvailableTools`

Assertions:

- generic: `statusCode`, `maxLatencyMs`
- chat/agent/responses: `contains`, `notContains`
- agent: `minToolCalls`, `maxToolCalls`, `requiredToolNames`
- embeddings: `minItems`, `minVectorLength`
- image generation: `minImages`
- audio transcription: `containsText`, `notContainsText`
- audio speech: `minBytes`, `contentType`

Validation behavior:

- schema errors fail fast with `file + index + field`
- unknown fields become warnings

Generation parameter precedence for supported modes (`chat`, `agent`, `responses`, `omni_call`):

1. scenario-level value
2. run-level override
3. config defaults
4. built-in defaults

### Example: showcase responses scenario

```json
{
  "id": "responses-demo",
  "mode": "responses",
  "title": "Responses Demo",
  "userVisibleGoal": "Show Responses API compatibility.",
  "prompt": "List two reasons to use a local AI gateway.",
  "assertions": {
    "statusCode": 200
  }
}
```

### Example: showcase tool-calling scenario

```json
{
  "id": "agent-tool-demo",
  "mode": "agent",
  "title": "Tool Calling",
  "prompt": "Use one available tool, then summarize what you learned.",
  "requiresAvailableTools": true,
  "assertions": {
    "statusCode": 200,
    "minToolCalls": 1
  }
}
```

## Artifacts and UI behavior

Each run writes:

- `bench-<timestamp>.json`
- `bench-<timestamp>.txt`

Reports now include:

- run metadata and effective config
- per-scenario results
- sanitized scenario details for history
- live-show traces for each scenario
- verdict strings and tool usage summaries
- optional capability matrix

The Benchmark UI is optimized for:

- guided suite selection (showcase or diagnostic suite)
- selecting one showcase example when applicable
- tuning generation parameters (temperature, top_p, max_tokens, penalties, seed, stop)
- using an Advanced section for model override, scenario files, profile, and capability cache controls
- watching the live trace
- reading the exact scenario input
- inspecting tool calls and tool results
- seeing the final verdict clearly

## Verification checklist

- `waypoi bench` defaults to showcase behavior.
- `waypoi bench --list-examples` lists human-readable examples.
- Benchmark UI loads showcase examples by default.
- A showcase run shows scenario input, wire request, response, and verdict.
- Tool-driven examples are skipped clearly when no MCP tools are available.
- Diagnostic suites still produce capability and regression information.
