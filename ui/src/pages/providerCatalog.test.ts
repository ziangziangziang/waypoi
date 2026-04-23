import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filterAndRankDiscoveredModels,
  filterProviderCatalogEntries,
  getRecommendedDiscoveredModels,
  providerPresetToFormPatch,
} from './providerCatalog'
import type { DiscoveredProviderModel, ProviderCatalogEntry } from '@/api/client'

const catalogEntries: ProviderCatalogEntry[] = [
  {
    id: 'openrouter',
    source: 'free',
    name: 'OpenRouter',
    description: 'Gateway',
    docs: 'https://openrouter.ai/docs',
    free: true,
    readiness: 'ready',
    protocol: 'openai',
    protocolRaw: 'openai',
    modelSummary: { total: 26, free: 26, benchmarked: 10 },
    preset: {
      id: 'openrouter',
      name: 'OpenRouter',
      protocol: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      supportsRouting: true,
      auth: { type: 'bearer', keyPrefix: 'sk-or-v1-' },
    },
  },
  {
    id: 'gemini',
    source: 'free',
    name: 'Gemini',
    free: true,
    readiness: 'unsupported',
    protocol: 'unknown',
    protocolRaw: 'gemini',
    modelSummary: { total: 8, free: 8, benchmarked: 0 },
    preset: {
      id: 'gemini',
      name: 'Gemini',
      protocol: 'unknown',
      baseUrl: 'https://generativelanguage.googleapis.com',
      supportsRouting: false,
    },
  },
]

test('filters provider catalog by query and readiness', () => {
  assert.equal(filterProviderCatalogEntries(catalogEntries, 'open', 'all').length, 1)
  assert.equal(filterProviderCatalogEntries(catalogEntries, '', 'ready').length, 1)
  assert.equal(filterProviderCatalogEntries(catalogEntries, '', 'unsupported').length, 1)
})

test('maps provider preset into provider form values', () => {
  const patch = providerPresetToFormPatch(catalogEntries[0]!.preset)
  assert.equal(patch.id, 'openrouter')
  assert.equal(patch.baseUrl, 'https://openrouter.ai/api/v1')
  assert.equal(patch.authType, 'bearer')
  assert.equal(patch.keyPrefix, 'sk-or-v1-')
})

test('ranks discovered models by free tier, benchmark, capability richness, then alphabetically', () => {
  const models: DiscoveredProviderModel[] = [
    { id: 'zeta' },
    { id: 'alpha', free: true, benchmark: { livebench: 20 } },
    { id: 'beta', free: true, benchmark: { livebench: 40 }, capabilities: { input: ['text'], output: ['text'], source: 'inferred' } },
    { id: 'gamma', capabilities: { input: ['text', 'image'], output: ['text'], supportsTools: true, supportsStreaming: true, source: 'inferred' } },
  ]
  const ranked = filterAndRankDiscoveredModels(models, '', {
    endpointType: 'all',
    freeOnly: false,
    toolsOnly: false,
    visionOnly: false,
    streamingOnly: false,
  }, 'recommended')
  assert.deepEqual(ranked.map((model) => model.id), ['beta', 'alpha', 'gamma', 'zeta'])
})

test('returns a recommended shortlist and respects discovery filters', () => {
  const models: DiscoveredProviderModel[] = [
    { id: 'text-free', free: true, capabilities: { input: ['text'], output: ['text'], source: 'inferred' } },
    { id: 'vision', capabilities: { input: ['text', 'image'], output: ['text'], source: 'inferred' } },
    { id: 'audio', capabilities: { input: ['text'], output: ['audio'], source: 'inferred' } },
  ]
  const filtered = filterAndRankDiscoveredModels(models, '', {
    endpointType: 'llm',
    freeOnly: false,
    toolsOnly: false,
    visionOnly: true,
    streamingOnly: false,
  }, 'recommended')
  assert.deepEqual(filtered.map((model) => model.id), ['vision'])
  assert.deepEqual(getRecommendedDiscoveredModels(models, 2).map((model) => model.id), ['text-free'])
})
