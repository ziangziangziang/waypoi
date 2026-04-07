import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { resolveBenchmarkConfig } from '../src/benchmark/config'
import { validateScenarioCollection } from '../src/benchmark/schema'
import { listBuiltInSuites, listSuiteExamples } from '../src/benchmark/suites'
import type { StoragePaths } from '../src/storage/files'

function makePaths(baseDir: string): StoragePaths {
  return {
    baseDir,
    configPath: path.join(baseDir, 'config.yaml'),
    healthPath: path.join(baseDir, 'health.json'),
    providerHealthPath: path.join(baseDir, 'providers_health.json'),
    requestLogPath: path.join(baseDir, 'request_logs.jsonl'),
    providersPath: path.join(baseDir, 'providers.json'),
    poolsPath: path.join(baseDir, 'pools.json'),
    poolStatePath: path.join(baseDir, 'pool_state.json'),
  }
}

test('benchmark config defaults to showcase execution mode', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoi-bench-config-'))
  const resolved = await resolveBenchmarkConfig(makePaths(baseDir), {})
  assert.equal(resolved.run.suite, 'showcase')
  assert.equal(resolved.run.executionMode, 'showcase')
  assert.equal(resolved.defaults.maxIterations, 6)
  assert.equal(resolved.defaults.top_p, 1)
  assert.equal(resolved.defaults.presence_penalty, 0)
  assert.equal(resolved.defaults.frequency_penalty, 0)
})

test('showcase example catalog is tiny-qa-backed and capability suite has no concurrent probes', () => {
  const suites = listBuiltInSuites()
  assert.ok(suites.includes('showcase'))

  const showcase = listSuiteExamples('showcase')
  assert.ok(showcase.length >= 50)
  assert.ok(showcase.every((example) => example.exampleSource === 'huggingface'))
  assert.ok(showcase.some((example) => example.id === 'showcase-tinyqa-001'))
  assert.ok(showcase.every((example) => example.mode === 'chat'))

  const capabilityIds = listSuiteExamples('capabilities').map((example) => example.id)
  assert.ok(!capabilityIds.some((id) => id.includes('concurrent') || id.includes('under_load')))
})

test('benchmark config accepts run-level generation overrides', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoi-bench-config-'))
  const resolved = await resolveBenchmarkConfig(makePaths(baseDir), {
    temperature: 0.4,
    top_p: 0.8,
    max_tokens: 256,
    presence_penalty: 0.3,
    frequency_penalty: -0.4,
    seed: 9,
    stop: ['END', 'STOP'],
  })

  assert.equal(resolved.run.temperature, 0.4)
  assert.equal(resolved.run.top_p, 0.8)
  assert.equal(resolved.run.max_tokens, 256)
  assert.equal(resolved.run.presence_penalty, 0.3)
  assert.equal(resolved.run.frequency_penalty, -0.4)
  assert.equal(resolved.run.seed, 9)
  assert.deepEqual(resolved.run.stop, ['END', 'STOP'])
})

test('scenario validation accepts showcase metadata, responses mode, and tool-name assertions', () => {
  const outcome = validateScenarioCollection(
    [
      {
        id: 'responses-demo',
        mode: 'responses',
        title: 'Responses Demo',
        summary: 'Compatibility example',
        userVisibleGoal: 'Show Responses API behavior',
        exampleSource: 'huggingface',
        inputPreview: 'Say hello from responses.',
        successCriteria: 'Returns HTTP 200',
        expectedHighlights: ['wire request', 'output_text'],
        prompt: 'Say hello from responses.',
        temperature: 0.3,
        top_p: 0.9,
        max_tokens: 128,
        presence_penalty: 0.2,
        frequency_penalty: -0.1,
        seed: 42,
        stop: ['END'],
        assertions: {
          statusCode: 200,
        },
      },
      {
        id: 'agent-demo',
        mode: 'agent',
        prompt: 'Use the weather tool.',
        requiresAvailableTools: true,
        assertions: {
          statusCode: 200,
          minToolCalls: 1,
          requiredToolNames: ['weather'],
        },
      },
    ],
    'inline'
  )

  assert.equal(outcome.scenarios.length, 2)
  assert.equal(outcome.scenarios[0].mode, 'responses')
  assert.equal(outcome.scenarios[0].top_p, 0.9)
  assert.deepEqual(outcome.scenarios[0].stop, ['END'])
  assert.deepEqual(outcome.scenarios[1].assertions.requiredToolNames, ['weather'])
  assert.equal(outcome.scenarios[1].requiresAvailableTools, true)
})
