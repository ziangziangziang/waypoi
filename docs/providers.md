# Providers and Protocol Adapters

Waypoi uses a provider catalog with protocol adapters.  
External clients still use OpenAI-compatible `/v1/*` endpoints; adapters translate to provider-native protocols.

## Onboarding a non-OpenAI protocol provider

1. Create a provider YAML with:
   - `endpoint.protocol`
   - `endpoint.baseUrl`
   - protocol-specific config (for `inference_v2`: `endpoint.router`)
2. Import with:
   - `waypoi providers import --registry <registry.yaml> --env-file .env`
3. Rebuild virtual models:
   - `waypoi providers import ...` (default auto rebuild) or `POST /admin/virtual-models/rebuild`
4. Verify:
   - `waypoi providers`
   - `waypoi providers show <id>`
   - `waypoi models <id>`
5. Optional TLS policy:
   - `waypoi providers update <id> --insecure-tls|--strict-tls`
   - `waypoi providers update <id> --auto-insecure-domain <suffix...>`

## Provider model CRUD

Use provider-first model management:

- `waypoi models add <providerId> --model-id <id> --upstream <name> --base-url <url>`
- `waypoi models update <providerId> <modelRef> ...`
- `waypoi models update <providerId> <modelRef> --clear-insecure-tls`
- `waypoi models rm <providerId> <modelRef>`
- `waypoi models enable <providerId>/<modelRef>`
- `waypoi models disable <providerId>/<modelRef>`
- `waypoi models set-key <providerId>/<modelRef> --api-key <key>`

Legacy command forms (`waypoi provider ...`, `waypoi provider model ...`) are still supported through rewrite shims with deprecation warnings.

Legacy endpoint write commands are blocked in v0.5.0; use migration + `waypoi models ...` commands.

## Inference V2 (ray/kserve-style) example

See: `/Users/zziang/Documents/projects/vibeCoding/Agents/waypoi/examples/providers/inference-v2-ray.yaml`

Key fields:

- `endpoint.protocol: inference_v2`
- `endpoint.router: <router_name>`
- `endpoint.responseTextPaths` (optional response extraction path list)

## Notes

- `inference_v2` v1 supports chat/vision sync (`stream=false`) only.
- Streaming requests are rejected for this protocol unless another virtual model backend supports streaming.
- `dashscope` uses Alibaba native APIs for:
  - `POST /v1/images/generations` and `POST /v1/images/edits` via DashScope multimodal image generation/editing
  - `POST /v1/videos/generations` via DashScope async video generation
  - `GET/WS /api-ws/v1/realtime?model=...` as a local passthrough for DashScope realtime ASR
- DashScope image-capable models should declare both `text-to-image` and `image-to-image` when they support editing/reference-image generation. This is what makes them eligible for `/v1/images/edits`.
- DashScope file transcription remains on the existing OpenAI-compatible HTTP route: `POST /v1/audio/transcriptions`.
- Unknown protocols are imported but marked non-routable.
- Virtual model alias surface is now a single `smart` alias; legacy `smart-*` aliases are rejected.
- TLS inheritance:
  - Effective TLS mode is `model.insecureTls ?? provider.insecureTls ?? false`.
  - Models added without `--insecure-tls` inherit provider TLS mode.
- Allowlisted auto-insecure fallback:
  - On TLS verify failures, Waypoi retries insecure TLS only when hostname matches provider `autoInsecureTlsDomains`.
  - If retry succeeds, Waypoi persists `model.insecureTls=true` for that model.

## DashScope example

See: [examples/providers/alibaba-dashscope.yaml](/Users/zziang/Documents/Projects/waypoi/examples/providers/alibaba-dashscope.yaml)

This example includes:

- `qwen-image-2.0-pro` and `qwen-image-2.0` for native image generation and editing
- `wan2.7-i2v` / `wan2.7-t2v` for native video generation
- `qwen3-asr-flash` for file transcription
- `qwen3-asr-flash-realtime` for websocket realtime ASR proxied through Waypoi

## PCAI endpoint migration runbook (`*.ai-application.stjude.org`)

This migration copies endpoint-managed models into provider `pcai`, then disables the source endpoints.

1. Pre-check:
   - `waypoi ls`
2. Run migration:
   - `waypoi providers migrate-endpoints --provider pcai --match-domain ai-application.stjude.org --protocol openai`
3. Verify:
   - `waypoi providers show pcai`
   - `waypoi models pcai`
   - `waypoi providers virtual-models`
   - `waypoi ls` (legacy endpoints should show `disabled=yes`)
4. Rollback (single model path):
   - Re-enable the endpoint in `config.yaml` (`disabled: false`) or via admin endpoint patch.
   - Set the corresponding `pcai` provider model `enabled: false` in `$WAYPOI_DIR/providers.json`.
   - Rebuild virtual models: `waypoi providers virtual-models` (or `POST /admin/virtual-models/rebuild`).
