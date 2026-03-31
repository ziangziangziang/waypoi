// Utility to generate mermaid Sankey code from TokenFlowData
// Usage: toMermaidSankey(tokenFlow: TokenFlowData): string

import type { CaptureRecordDetail } from '@/api/client'

type TokenFlowData = NonNullable<CaptureRecordDetail['analysis']['tokenFlow']>

export function toMermaidSankey(tokenFlow: TokenFlowData): string {
  // Mermaid Sankey syntax is CSV-like rows after the sankey-beta header:
  // source,target,value
  const lines = ['sankey-beta']

  // Main totals
  const inputTotal = Math.max(0, tokenFlow.totals.inputTokens ?? 0)
  const outputTotal = Math.max(0, tokenFlow.totals.outputTokens ?? 0)
  lines.push(sankeyRow('Context Window', 'Input Tokens', inputTotal))
  lines.push(sankeyRow('Context Window', 'Output Tokens', outputTotal))

  // Input categories
  for (const category of tokenFlow.input) {
    if (category.tokens <= 0) continue
    const target = `${compactLabel(category.label, category.key)} [input:${category.key}]`
    lines.push(sankeyRow('Input Tokens', target, category.tokens))
  }
  // Output categories
  for (const category of tokenFlow.output) {
    if (category.tokens <= 0) continue
    const target = `${compactLabel(category.label, category.key)} [output:${category.key}]`
    lines.push(sankeyRow('Output Tokens', target, category.tokens))
  }

  return lines.join('\n')
}

function sankeyRow(source: string, target: string, value: number): string {
  return `${csvCell(source)},${csvCell(target)},${Math.max(0, Math.round(value))}`
}

function csvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

function compactLabel(label: string, key: string): string {
  const byKey: Record<string, string> = {
    instructions: 'Instr',
    assistant_history: 'Asst Hist',
    input_media: 'Media In',
    tool_definitions: 'Tool Defs',
    unattributed_input: 'Other In',
    assistant_text: 'Asst Text',
    tool_calls: 'Tool Calls',
    unattributed_output: 'Other Out',
  }
  return byKey[key] ?? label
}
