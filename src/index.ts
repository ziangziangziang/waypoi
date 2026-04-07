import Fastify from "fastify";
import { registerChatRoutes } from "./routes/chat";
import { registerEmbeddingsRoutes } from "./routes/embeddings";
import { registerModelsRoutes } from "./routes/models";
import { registerAdminRoutes } from "./routes/admin";
import { registerImageRoutes } from "./routes/images";
import { registerVideoRoutes } from "./routes/videos";
import { registerAudioRoutes } from "./routes/audio";
import { registerResponsesRoutes } from "./routes/responses";
import { registerStatsRoutes } from "./routes/stats";
import { registerSessionRoutes } from "./routes/sessions";
import { registerMcpRoutes } from "./routes/mcp";
import { closeMcpServiceRoutes, registerMcpServiceRoutes } from "./routes/mcpService";
import { registerUiRoutes } from "./routes/ui";
import { registerRequestStatsMiddleware } from "./middleware/requestStats";
import { registerRequestCaptureMiddleware } from "./middleware/requestCapture";
import { registerAuthHooks, loadAuthConfig, updateAuthConfig } from "./middleware/auth";
import { startHealthChecker, stopHealthChecker } from "./workers/healthChecker";
import { startStatsRotation, stopStatsRotation } from "./workers/statsRotation";
import { startConfigWatcher, stopConfigWatcher } from "./workers/configWatcher";
import { startCaptureRetentionWorker, stopCaptureRetentionWorker } from "./workers/captureRetention";
import { ensureStorageDir, resolveStoragePaths } from "./storage/files";
import { invalidateConfigCache } from "./storage/repositories";
import { discoverAllTools, disconnectAllServers, summarizeMcpError, discoverBuiltinTools } from "./mcp/discovery";
import { listProviders } from "./providers/repository";
import { listModelsForApi } from "./providers/modelRegistry";
import { listPools } from "./pools/repository";
import { rebuildDefaultPools } from "./pools/builder";
import { promises as fs } from "fs";
import path from "path";

const PORT = Number(process.env.PORT ?? "9469");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

async function start(): Promise<void> {
  const app = Fastify({ logger: true });
  const paths = resolveStoragePaths();
  await ensureStorageDir(paths);
  try {
    await rebuildDefaultPools(paths);
  } catch (error) {
    console.error(`[waypoi] Failed to rebuild smart pool: ${(error as Error).message}`);
    if (process.env.WAYPOI_DEBUG_ERRORS === "1") {
      console.error(error);
    }
  }

  // Register middleware
  await registerRequestStatsMiddleware(app, paths);
  await registerRequestCaptureMiddleware(app, paths);
  
  // Register auth hooks (no-op by default, enable via config.authEnabled)
  await registerAuthHooks(app, paths, ["/admin", "/ui"]);

  // OpenAI-compatible routes
  await registerChatRoutes(app, paths);
  await registerEmbeddingsRoutes(app, paths);
  await registerModelsRoutes(app, paths);
  await registerImageRoutes(app, paths);
  await registerVideoRoutes(app, paths);
  await registerAudioRoutes(app, paths);
  await registerResponsesRoutes(app, paths);
  
  // Admin routes
  const version = await resolveAppVersion();
  await registerAdminRoutes(app, paths, { adminToken: ADMIN_TOKEN, version });
  await registerStatsRoutes(app, paths);
  await registerSessionRoutes(app);
  await registerMcpRoutes(app, paths);
  await registerMcpServiceRoutes(app, paths);
  
  // UI routes (serve React frontend)
  await registerUiRoutes(app);

  // Start background workers
  startHealthChecker(paths);
  startStatsRotation(paths);
  startCaptureRetentionWorker(paths);
  
  // Auto-connect to enabled MCP servers and discover tools
  discoverAllTools(paths).then((tools) => {
    if (tools.length > 0) {
      console.log(`[waypoi] Connected to MCP servers, discovered ${tools.length} tools`);
    }
  }).catch((error) => {
    console.error(`[waypoi] Failed to auto-connect to MCP servers: ${summarizeMcpError(error)}`);
    if (process.env.WAYPOI_DEBUG_ERRORS === "1") {
      console.error(error);
    }
  });

  // Print model capability source summary for operators.
  try {
    const models = await listModelsForApi(paths);
    const configured = models.filter((model) => model.capabilities.source === "configured").length;
    const inferred = models.filter((model) => model.capabilities.source === "inferred").length;
    const enabledModels = models.filter((model) => model.enabled).length;
    console.log(
      `[waypoi] Models: total=${models.length}, enabled=${enabledModels}, configured=${configured}, inferred=${inferred}`
    );
  } catch (error) {
    console.error(`[waypoi] Failed to summarize model capabilities: ${(error as Error).message}`);
    if (process.env.WAYPOI_DEBUG_ERRORS === "1") {
      console.error(error);
    }
  }

  try {
    const providers = await listProviders(paths);
    const pools = await listPools(paths);
    const enabledProviders = providers.filter((provider) => provider.enabled).length;
    const byProtocol = providers.reduce<Record<string, number>>((acc, provider) => {
      const protocol = provider.protocolRaw ?? provider.protocol;
      acc[protocol] = (acc[protocol] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `[waypoi] Providers: total=${providers.length}, enabled=${enabledProviders}, pools=${pools.length}`
    );
    console.log(`[waypoi] Provider protocols: ${JSON.stringify(byProtocol)}`);
  } catch (error) {
    console.error(`[waypoi] Failed to summarize providers: ${(error as Error).message}`);
    if (process.env.WAYPOI_DEBUG_ERRORS === "1") {
      console.error(error);
    }
  }
  
  // Start config watcher for hot-reload
  const configWatcher = startConfigWatcher(paths);
  configWatcher.on("config:updated", async () => {
    invalidateConfigCache();
    // Reload auth config on config change
    const authConfig = await loadAuthConfig(paths);
    updateAuthConfig(authConfig);
    console.log("[waypoi] Config reloaded - no restart needed");
  });

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      console.log(`\n[${signal}] Forced exit.`);
      process.exit(1);
    }
    shuttingDown = true;
    console.log(`\n[${signal}] Shutting down gracefully...`);

    // Force exit after 5 seconds if graceful shutdown stalls
    const forceTimer = setTimeout(() => {
      console.error("[shutdown] Timed out, forcing exit.");
      process.exit(1);
    }, 5_000);
    forceTimer.unref();

    stopConfigWatcher();
    stopHealthChecker();
    stopStatsRotation();
    stopCaptureRetentionWorker();
    await closeMcpServiceRoutes();
    await disconnectAllServers();
    await app.close();
    clearTimeout(forceTimer);
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await app.listen({ port: PORT, host: "0.0.0.0" });
  
  // Auto-connect to the built-in /mcp endpoint so playground tools are available by default
  discoverBuiltinTools(paths, `http://localhost:${PORT}/mcp`).then((tools) => {
    console.log(`[waypoi] Built-in MCP connected: ${tools.map((t) => t.name).join(", ") || "no tools"}`);
  }).catch((error) => {
    console.error(`[waypoi] Failed to connect to built-in MCP: ${summarizeMcpError(error)}`);
    if (process.env.WAYPOI_DEBUG_ERRORS === "1") {
      console.error(error);
    }
  });

  console.log(`\n🚀 Waypoi running on http://localhost:${PORT}`);
  console.log(`   Endpoints: /v1/chat/completions, /v1/embeddings, /v1/images/*, /v1/videos/*, /v1/audio/*`);
  console.log(`   MCP Service: /mcp`);
  console.log(`   Admin: /admin/*, /admin/stats, /admin/sessions, /admin/mcp, /admin/benchmarks/runs`);
  console.log(`   UI: http://localhost:${PORT}/ui\n`);
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function resolveAppVersion(): Promise<string> {
  const candidates = [
    path.join(process.cwd(), "package.json"),
    path.join(__dirname, "..", "..", "package.json"),
    path.join(__dirname, "..", "package.json"),
  ];

  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as { version?: string };
      if (parsed.version && typeof parsed.version === "string") {
        return parsed.version;
      }
    } catch {
      // Try next candidate.
    }
  }
  return "0.0.0";
}
