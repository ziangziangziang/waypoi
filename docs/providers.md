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
3. Rebuild pools:
   - `waypoi providers import ...` (default auto rebuild) or `POST /admin/pools/rebuild`
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
- Streaming requests are rejected for this protocol unless another pool candidate supports streaming.
- Unknown protocols are imported but marked non-routable.
- Pool alias surface is now a single `smart` alias; legacy `smart-*` aliases are rejected.
- TLS inheritance:
  - Effective TLS mode is `model.insecureTls ?? provider.insecureTls ?? false`.
  - Models added without `--insecure-tls` inherit provider TLS mode.
- Allowlisted auto-insecure fallback:
  - On TLS verify failures, Waypoi retries insecure TLS only when hostname matches provider `autoInsecureTlsDomains`.
  - If retry succeeds, Waypoi persists `model.insecureTls=true` for that model.

## PCAI endpoint migration runbook (`*.ai-application.stjude.org`)

This migration copies endpoint-managed models into provider `pcai`, then disables the source endpoints.

1. Pre-check:
   - `waypoi ls`
2. Run migration:
   - `waypoi providers migrate-endpoints --provider pcai --match-domain ai-application.stjude.org --protocol openai`
3. Verify:
   - `waypoi providers show pcai`
   - `waypoi models pcai`
   - `waypoi providers pools`
   - `waypoi ls` (legacy endpoints should show `disabled=yes`)
4. Rollback (single model path):
   - Re-enable the endpoint in `config.yaml` (`disabled: false`) or via admin endpoint patch.
   - Set the corresponding `pcai` provider model `enabled: false` in `$WAYPOI_DIR/providers.json`.
   - Rebuild pools: `waypoi providers pools` (or `POST /admin/pools/rebuild`).
