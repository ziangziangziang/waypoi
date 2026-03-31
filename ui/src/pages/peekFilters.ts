import type { CaptureRecordSummary } from '@/api/client'

export function isGetModelsRoute(record: Pick<CaptureRecordSummary, 'method' | 'route'>): boolean {
  return record.method.toUpperCase() === 'GET' && record.route.startsWith('/v1/models')
}

export function filterCaptureRecords(
  records: CaptureRecordSummary[],
  ignoreModels: boolean,
): CaptureRecordSummary[] {
  if (!ignoreModels) return records
  return records.filter((record) => !isGetModelsRoute(record))
}
