<img src="assets/icon.png" alt="Waypoi" width="96" height="96" align="right" />

# Waypoi

**Local AI Gateway** — an OpenAI-compatible proxy with intelligent routing, failover, and a built-in playground UI for agentic workflows.

Bridge any LLM backend behind one secure local interface. Handle SSL issues gracefully, unify multiple endpoints, and use MCP tools locally.

Other languages: [简体中文](README.zh-CN.md)

## Install & use (npm)

```bash
npm install -g waypoi
waypoi start
```

Then open the web playground at <http://localhost:9469/ui>.

Or run without installing:

```bash
npx waypoi start
```

The gateway exposes an OpenAI-compatible API at `http://localhost:9469/v1`. Use it as the base URL in any OpenAI client:

| Setting   | Value                              |
|-----------|------------------------------------|
| Base URL  | `http://localhost:9469/v1`         |
| API key   | `local-dev` (or your token)        |
| Model     | `smart` (free-model pool alias)    |

The built-in MCP endpoint (`POST /mcp`) is localhost-only by design.

## Features

- **Reverse proxy** — route chat, embeddings, images, audio, and the Responses API to multiple backends behind one OpenAI-compatible API.
- **Health-based failover** — retries, circuit breaker, latency-aware routing, per-endpoint TLS policy.
- **Smart pools** — virtual model aliases (`smart`) that load-balance across providers by capability.
- **Web playground** — chat with session history, image upload, streaming, voice-call mode, and agentic tool use.
- **Agent mode** — built-in MCP client; connect external servers or use the localhost-only `/mcp` endpoint.
- **Built-in MCP tools** — `generate_image` and `understand_image`.
- **Provider catalog** — first-class provider/model management, curated free-provider presets, ranked discovery.
- **Peek** — request-capture browser with timeline, media artifacts, and token-flow Sankey.
- **Statistics** — per-model/endpoint tracking with latency and token charts.
- **Hot reload** — config changes apply without restart.
- **Auth ready** — optional token auth (off by default); MCP stays localhost-only.

## Quickstart (from source)

```bash
npm install
cd ui && npm install && cd ..
npm run build:all
npm run start
```

Open <http://localhost:9469/ui>.

## Configuration

Waypoi reads `~/.config/waypoi/config.yaml`. Minimal example:

```yaml
endpoints:
  - name: openai
    baseUrl: https://api.openai.com
    apiKey: sk-...
    priority: 1
    type: llm
    models:
      - publicName: gpt-4
        upstreamModel: gpt-4-turbo
        capabilities:
          input: [text]
          output: [text]

authEnabled: false   # optional token auth
```

`capabilities` is optional; Waypoi infers it from model metadata when omitted.

Key environment variables:

| Variable       | Default             | Description                  |
|----------------|---------------------|------------------------------|
| `PORT`         | `9469`              | Server port                 |
| `ADMIN_TOKEN`  | —                   | Bearer token for admin endpoints |
| `WAYPOI_DIR`   | `~/.config/waypoi`  | Storage directory            |

## CLI

```bash
waypoi start                      # start the gateway
waypoi providers                  # list providers
waypoi providers import -f .env   # import curated free providers + credentials
waypoi models                     # list models
waypoi bench                      # benchmark showcase
waypoi logs -f                    # follow logs
```

Provider-first workflow: add a provider, discover/add models, then use `provider/model` IDs or the `smart` pool alias.

## Documentation

- MCP guidelines: [`docs/mcp-guidelines.md`](docs/mcp-guidelines.md)
- MCP service contract: [`docs/mcp-service.md`](docs/mcp-service.md)
- Providers: [`docs/providers.md`](docs/providers.md)
- Opencode setup: [`docs/opencode.md`](docs/opencode.md)

## Development

```bash
npm run dev      # dev mode (server + UI)
npm run build    # build
npm test         # tests
npm run lint     # lint
```

### Releasing

Versioning is **git-tag driven** — `package.json` stays at the `0.0.0` placeholder and is never edited by hand. The CI reads the tag and publishes the npm version automatically, so **do not run `npm publish` locally**.

```bash
git tag v0.8.0 && git push origin v0.8.0                      # stable -> dist-tag "latest"
git tag v0.8.0-alpha.0 && git push origin v0.8.0-alpha.0     # prerelease -> "alpha"
```

| Tag pattern        | npm dist-tag |
|--------------------|--------------|
| `v*.*.*`           | `latest`     |
| `v*.*.*-alpha.*`   | `alpha`      |
| `v*.*.*-beta.*`    | `beta`       |
| `v*.*.*-rc.*`      | `rc`         |

Before pushing a tag: add a `## [X.Y.Z]` section to `CHANGELOG.md` (it becomes the GitHub Release notes via `release.yml`), and never reuse a version number — npm rejects republishing an existing version. Pushing the tag triggers `publish.yml` (build + `npm publish --provenance`) and `release.yml` (GitHub Release). A manual publish with a chosen dist-tag is also available via `workflow_dispatch` on `publish.yml`.

## License

MIT
