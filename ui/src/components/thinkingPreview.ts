export const LIVE_PREVIEW_MAX_LINES = 5

export function hasUnclosedThinkingTag(content: string): boolean {
  const openTagMatches = content.match(/<\s*think\s*>/gi)?.length ?? 0
  const closeTagMatches = content.match(/<\s*\/\s*think\s*>/gi)?.length ?? 0
  return openTagMatches > closeTagMatches
}

export function getLatestThinkingLines(content: string, maxLines = LIVE_PREVIEW_MAX_LINES): string[] {
  if (!content) return []
  const normalized = content.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  return lines.slice(-maxLines)
}

