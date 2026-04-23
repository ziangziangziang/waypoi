import type {
  DiscoveredProviderModel,
  EndpointType,
  ModelModality,
  ProviderCatalogEntry,
  ProviderCatalogPreset,
} from '@/api/client'

export type ProviderCatalogFilter = 'all' | 'ready' | 'unsupported'

export type DiscoverySortMode = 'recommended' | 'alphabetical'

export type DiscoveryFilterState = {
  endpointType: 'all' | EndpointType
  freeOnly: boolean
  toolsOnly: boolean
  visionOnly: boolean
  streamingOnly: boolean
}

export function filterProviderCatalogEntries(
  entries: ProviderCatalogEntry[],
  search: string,
  filter: ProviderCatalogFilter
): ProviderCatalogEntry[] {
  const query = search.trim().toLowerCase()
  return entries.filter((entry) => {
    if (filter !== 'all' && entry.readiness !== filter) return false
    if (!query) return true
    return [
      entry.id,
      entry.name,
      entry.description ?? '',
      entry.protocolRaw ?? entry.protocol,
    ].some((value) => value.toLowerCase().includes(query))
  })
}

export function providerPresetToFormPatch(preset: ProviderCatalogPreset) {
  return {
    id: preset.id,
    name: preset.name,
    baseUrl: preset.baseUrl,
    protocol: preset.protocol,
    enabled: true,
    supportsRouting: preset.supportsRouting,
    apiKey: '',
    description: preset.description ?? '',
    docs: preset.docs ?? '',
    insecureTls: preset.insecureTls === true,
    autoInsecureTlsDomains: (preset.autoInsecureTlsDomains ?? []).join(', '),
    envVar: preset.envVar ?? '',
    authType: preset.auth?.type ?? 'none',
    keyParam: preset.auth?.keyParam ?? '',
    headerName: preset.auth?.headerName ?? '',
    keyPrefix: preset.auth?.keyPrefix ?? '',
    protocolConfigText: preset.protocolConfig ? JSON.stringify(preset.protocolConfig, null, 2) : '',
    limitsText: preset.limits ? JSON.stringify(preset.limits, null, 2) : '',
  }
}

export function filterAndRankDiscoveredModels(
  models: DiscoveredProviderModel[],
  search: string,
  filters: DiscoveryFilterState,
  sortMode: DiscoverySortMode
): DiscoveredProviderModel[] {
  const query = search.trim().toLowerCase()
  const filtered = models.filter((model) => {
    const capabilities = model.capabilities
    const endpointType = inferEndpointType(capabilities?.output ?? [])
    if (filters.endpointType !== 'all' && endpointType !== filters.endpointType) return false
    if (filters.freeOnly && model.free !== true) return false
    if (filters.toolsOnly && capabilities?.supportsTools !== true) return false
    if (filters.visionOnly && !capabilities?.input?.includes('image')) return false
    if (filters.streamingOnly && capabilities?.supportsStreaming !== true) return false
    if (!query) return true
    return model.id.toLowerCase().includes(query)
  })

  if (sortMode === 'alphabetical') {
    return [...filtered].sort((a, b) => a.id.localeCompare(b.id))
  }

  return [...filtered].sort(compareDiscoveredModels)
}

export function getRecommendedDiscoveredModels(
  models: DiscoveredProviderModel[],
  limit = 5
): DiscoveredProviderModel[] {
  return models
    .filter((model) => model.free === true || typeof model.benchmark?.livebench === 'number')
    .sort(compareDiscoveredModels)
    .slice(0, limit)
}

function compareDiscoveredModels(a: DiscoveredProviderModel, b: DiscoveredProviderModel): number {
  if ((a.free === true) !== (b.free === true)) {
    return a.free === true ? -1 : 1
  }
  const scoreA = typeof a.benchmark?.livebench === 'number' ? a.benchmark.livebench : -1
  const scoreB = typeof b.benchmark?.livebench === 'number' ? b.benchmark.livebench : -1
  if (scoreA !== scoreB) {
    return scoreB - scoreA
  }
  const richnessA = capabilityRichnessScore(a)
  const richnessB = capabilityRichnessScore(b)
  if (richnessA !== richnessB) {
    return richnessB - richnessA
  }
  return a.id.localeCompare(b.id)
}

function capabilityRichnessScore(model: DiscoveredProviderModel): number {
  let score = 0
  const caps = model.capabilities
  if (!caps) return score
  score += caps.supportsTools === true ? 3 : 0
  score += caps.supportsStreaming === true ? 2 : 0
  score += caps.input.includes('image') ? 2 : 0
  score += new Set([...caps.input, ...caps.output]).size
  return score
}

function inferEndpointType(output: ModelModality[]): EndpointType {
  if (output.includes('embedding')) return 'embedding'
  if (output.includes('image')) return 'diffusion'
  if (output.includes('audio')) return 'audio'
  return 'llm'
}
