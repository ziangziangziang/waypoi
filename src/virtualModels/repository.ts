import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { StoragePaths, readJsonFile, writeJsonFile } from "../storage/files";
import {
  VirtualModelDefinition,
  VirtualModelStateFile,
  VirtualModelStoreFile,
  VirtualModelSwitchEvent,
} from "./types";

const VIRTUAL_MODELS_VERSION = 1;
const VIRTUAL_MODEL_STATE_VERSION = 1;
const SWITCH_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function virtualModelsPath(paths: StoragePaths): string {
  return paths.virtualModelsPath ?? path.join(paths.baseDir, "virtual_models.json");
}

function virtualModelStatePath(paths: StoragePaths): string {
  return paths.virtualModelStatePath ?? path.join(paths.baseDir, "virtual_model_state.json");
}

function virtualModelEventsPath(paths: StoragePaths): string {
  return paths.virtualModelEventsPath ?? path.join(paths.baseDir, "virtual_model_events.jsonl");
}

function defaultVirtualModelStore(): VirtualModelStoreFile {
  return {
    version: VIRTUAL_MODELS_VERSION,
    updatedAt: new Date().toISOString(),
    virtualModels: [],
  };
}

function defaultVirtualModelState(): VirtualModelStateFile {
  return {
    version: VIRTUAL_MODEL_STATE_VERSION,
    updatedAt: new Date().toISOString(),
    candidates: {},
  };
}

export async function migrateLegacyPools(paths: StoragePaths): Promise<void> {
  try {
    await fs.access(virtualModelsPath(paths));
  } catch {
    const legacy = await readJsonFile<{ pools?: VirtualModelDefinition[] }>(paths.poolsPath, { pools: [] });
    if (Array.isArray(legacy.pools) && legacy.pools.length > 0) {
      await saveVirtualModels(paths, legacy.pools);
    }
  }

  try {
    await fs.access(virtualModelStatePath(paths));
  } catch {
    const legacy = await readJsonFile<VirtualModelStateFile>(paths.poolStatePath, defaultVirtualModelState());
    if (legacy.candidates && typeof legacy.candidates === "object") {
      await saveVirtualModelState(paths, legacy);
    }
  }
}

export async function loadVirtualModels(paths: StoragePaths): Promise<VirtualModelStoreFile> {
  const store = await readJsonFile<VirtualModelStoreFile>(virtualModelsPath(paths), defaultVirtualModelStore());
  if (!Array.isArray(store.virtualModels)) {
    const legacy = store as unknown as { pools?: VirtualModelDefinition[] };
    if (Array.isArray(legacy.pools)) {
      return {
        version: Number.isFinite(store.version) ? store.version : VIRTUAL_MODELS_VERSION,
        updatedAt: typeof store.updatedAt === "string" ? store.updatedAt : new Date().toISOString(),
        virtualModels: legacy.pools,
      };
    }
    return defaultVirtualModelStore();
  }
  return {
    version: Number.isFinite(store.version) ? store.version : VIRTUAL_MODELS_VERSION,
    updatedAt: typeof store.updatedAt === "string" ? store.updatedAt : new Date().toISOString(),
    virtualModels: store.virtualModels,
  };
}

export async function saveVirtualModels(
  paths: StoragePaths,
  virtualModels: VirtualModelDefinition[]
): Promise<void> {
  await writeJsonFile(virtualModelsPath(paths), {
    version: VIRTUAL_MODELS_VERSION,
    updatedAt: new Date().toISOString(),
    virtualModels,
  } satisfies VirtualModelStoreFile);
}

export async function listVirtualModels(paths: StoragePaths): Promise<VirtualModelDefinition[]> {
  const store = await loadVirtualModels(paths);
  return [...store.virtualModels].sort((a, b) => a.id.localeCompare(b.id));
}

export async function getVirtualModelByAlias(
  paths: StoragePaths,
  alias: string
): Promise<VirtualModelDefinition | null> {
  const virtualModels = await listVirtualModels(paths);
  return virtualModels.find((model) => model.enabled !== false && model.aliases.includes(alias)) ?? null;
}

export async function loadVirtualModelState(paths: StoragePaths): Promise<VirtualModelStateFile> {
  const state = await readJsonFile<VirtualModelStateFile>(virtualModelStatePath(paths), defaultVirtualModelState());
  if (!state.candidates || typeof state.candidates !== "object") {
    return defaultVirtualModelState();
  }
  return {
    version: Number.isFinite(state.version) ? state.version : VIRTUAL_MODEL_STATE_VERSION,
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : new Date().toISOString(),
    candidates: state.candidates,
  };
}

export async function saveVirtualModelState(paths: StoragePaths, state: VirtualModelStateFile): Promise<void> {
  await writeJsonFile(virtualModelStatePath(paths), {
    ...state,
    version: VIRTUAL_MODEL_STATE_VERSION,
    updatedAt: new Date().toISOString(),
  } satisfies VirtualModelStateFile);
}

export async function appendVirtualModelSwitchEvent(
  paths: StoragePaths,
  event: Omit<VirtualModelSwitchEvent, "id" | "createdAt">
): Promise<VirtualModelSwitchEvent> {
  const created: VirtualModelSwitchEvent = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...event,
  };
  const filePath = virtualModelEventsPath(paths);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(created)}\n`, "utf8");
  await pruneVirtualModelSwitchEvents(paths);
  return created;
}

export async function listVirtualModelSwitchEvents(
  paths: StoragePaths,
  virtualModelId: string,
  windowMs = SWITCH_EVENT_RETENTION_MS
): Promise<VirtualModelSwitchEvent[]> {
  const cutoff = Date.now() - windowMs;
  const events = await readAllSwitchEvents(paths);
  return events
    .filter((event) => event.virtualModelId === virtualModelId)
    .filter((event) => Date.parse(event.createdAt) >= cutoff)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function pruneVirtualModelSwitchEvents(paths: StoragePaths): Promise<void> {
  const cutoff = Date.now() - SWITCH_EVENT_RETENTION_MS;
  const events = (await readAllSwitchEvents(paths)).filter((event) => Date.parse(event.createdAt) >= cutoff);
  const filePath = virtualModelEventsPath(paths);
  if (events.length === 0) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return;
  }
  await writeJsonLines(filePath, events);
}

async function readAllSwitchEvents(paths: StoragePaths): Promise<VirtualModelSwitchEvent[]> {
  try {
    const raw = await fs.readFile(virtualModelEventsPath(paths), "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as VirtualModelSwitchEvent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeJsonLines(filePath: string, events: VirtualModelSwitchEvent[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomUUID()}`);
  await fs.writeFile(tmp, events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
  await fs.rename(tmp, filePath);
}
