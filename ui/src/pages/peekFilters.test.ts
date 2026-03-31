import test from 'node:test'
import assert from 'node:assert/strict'
import { filterCaptureRecords, isGetModelsRoute } from './peekFilters'
import type { CaptureRecordSummary } from '@/api/client'

test('isGetModelsRoute matches GET /v1/models routes', () => {
  assert.equal(isGetModelsRoute({ method: 'GET', route: '/v1/models' }), true)
  assert.equal(isGetModelsRoute({ method: 'get', route: '/v1/models?limit=20' }), true)
  assert.equal(isGetModelsRoute({ method: 'POST', route: '/v1/models' }), false)
  assert.equal(isGetModelsRoute({ method: 'GET', route: '/v1/chat/completions' }), false)
})

test('filterCaptureRecords removes only GET /v1/models calls when enabled', () => {
  const records = [
    { id: '1', method: 'GET', route: '/v1/models', timestamp: '', statusCode: 200, latencyMs: 10 },
    { id: '2', method: 'GET', route: '/v1/models?limit=5', timestamp: '', statusCode: 200, latencyMs: 11 },
    { id: '3', method: 'POST', route: '/v1/models', timestamp: '', statusCode: 200, latencyMs: 12 },
    { id: '4', method: 'GET', route: '/v1/chat/completions', timestamp: '', statusCode: 200, latencyMs: 13 },
  ] satisfies CaptureRecordSummary[]

  const filtered = filterCaptureRecords(records, true)
  assert.deepEqual(
    filtered.map((record) => record.id),
    ['3', '4'],
  )

  const unfiltered = filterCaptureRecords(records, false)
  assert.equal(unfiltered.length, records.length)
})
