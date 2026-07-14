<img src="assets/icon.png" alt="Waypoi" width="96" height="96" align="right" />

# Waypoi

**本地 AI 网关** —— 兼容 OpenAI 协议的代理，提供智能路由、故障转移，以及内置的智能体（agent）工作台 UI。

将任意 LLM 后端统一到同一个本地安全接口之后。优雅处理 SSL 问题，聚合多个端点，并在本地使用 MCP 工具。

其他语言：[English](README.md)

## 安装与使用（npm）

```bash
npm install -g waypoi
waypoi start
```

然后在浏览器打开工作台：<http://localhost:9469/ui>。

也可以免安装直接运行：

```bash
npx waypoi start
```

网关在 `http://localhost:9469/v1` 提供兼容 OpenAI 的 API，可作为任意 OpenAI 客户端的 base URL：

| 配置项    | 值                                       |
|-----------|------------------------------------------|
| Base URL  | `http://localhost:9469/v1`               |
| API key   | `local-dev`（或你配置的令牌）            |
| Model     | `smart`（免费模型池别名）                |

内置的 MCP 端点（`POST /mcp`）默认仅限本机（localhost）访问。

## 功能特性

- **反向代理** —— 将对话、embeddings、图像、音频，以及 Responses API 路由到多个后端，统一在兼容 OpenAI 的接口之下。
- **基于健康的故障转移** —— 自动重试、熔断、延迟感知路由，以及按端点的 TLS 策略。
- **智能模型池** —— 虚拟模型别名（`smart`），按能力在多个 provider 之间负载均衡。
- **Web 工作台** —— 带会话历史、图片上传、流式输出、语音通话模式，以及智能体工具调用。
- **智能体模式** —— 内置 MCP 客户端；可连接外部服务器，或使用仅本机的 `/mcp` 端点。
- **内置 MCP 工具** —— `generate_image` 与 `understand_image`。
- **Provider 目录** —— 一流的 provider/模型管理、精选的免费 provider 预设、排序后的模型发现。
- **Peek** —— 请求抓取浏览器，支持时间线、媒体产物与 token 流向桑基图。
- **统计** —— 按模型/端点的请求统计，含延迟与 token 图表。
- **热重载** —— 配置变更无需重启即可生效。
- **认证就绪** —— 可选的令牌认证（默认关闭）；MCP 始终仅限本机。

## 快速开始（从源码构建）

```bash
npm install
cd ui && npm install && cd ..
npm run build:all
npm run start
```

打开 <http://localhost:9469/ui>。

## 配置

Waypoi 读取 `~/.config/waypoi/config.yaml`，最小示例：

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

authEnabled: false   # 可选的令牌认证
```

`capabilities` 为可选项；省略时 Waypoi 会根据模型元信息推断。

主要环境变量：

| 变量          | 默认值              | 说明                       |
|---------------|---------------------|----------------------------|
| `PORT`        | `9469`              | 服务端口                   |
| `ADMIN_TOKEN` | —                   | 管理端点的 Bearer 令牌     |
| `WAYPOI_DIR`  | `~/.config/waypoi`  | 存储目录                   |

## 命令行（CLI）

```bash
waypoi start                      # 启动网关
waypoi providers                  # 列出 providers
waypoi providers import -f .env   # 导入精选的免费 providers 与凭证
waypoi models                     # 列出模型
waypoi bench                      # 基准测试示例
waypoi logs -f                    # 跟踪日志
```

Provider-first 工作流：先添加 provider，再发现/添加模型，然后使用 `provider/model` ID 或 `smart` 模型池别名。

## 文档

- MCP 指南：[`docs/mcp-guidelines.md`](docs/mcp-guidelines.md)
- MCP 服务契约：[`docs/mcp-service.md`](docs/mcp-service.md)
- Providers：[`docs/providers.md`](docs/providers.md)
- Opencode 配置：[`docs/opencode.md`](docs/opencode.md)

## 开发

```bash
npm run dev      # 开发模式（服务端 + UI）
npm run build    # 构建
npm test         # 测试
npm run lint     # 代码检查
```

### 发布

版本由 **git 标签驱动** —— `package.json` 始终保持 `0.0.0` 占位版本，切勿手动修改。CI 会读取标签并自动发布对应的 npm 版本，因此**不要在本地执行 `npm publish`**。

```bash
git tag v0.8.0 && git push origin v0.8.0                  # 正式版 -> dist-tag "latest"
git tag v0.8.0-alpha.0 && git push origin v0.8.0-alpha.0 # 预发布 -> "alpha"
```

| 标签格式          | npm dist-tag |
|-------------------|--------------|
| `v*.*.*`          | `latest`     |
| `v*.*.*-alpha.*`  | `alpha`      |
| `v*.*.*-beta.*`   | `beta`       |
| `v*.*.*-rc.*`     | `rc`         |

推送标签前：在 `CHANGELOG.md` 中添加 `## [X.Y.Z]` 小节（会成为 `release.yml` 生成的 GitHub Release 说明），且不要重复使用已发布的版本号——npm 会拒绝重新发布已有版本。推送标签会触发 `publish.yml`（构建 + `npm publish --provenance`）与 `release.yml`（GitHub Release）。也可通过 `publish.yml` 的 `workflow_dispatch` 手动发布指定 dist-tag 的版本。

## 许可

MIT
