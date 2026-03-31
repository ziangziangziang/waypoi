import test from 'node:test'
import assert from 'node:assert/strict'
import { toMermaidSankey } from './toMermaidSankey'

test('toMermaidSankey emits valid sankey-beta csv rows', () => {
  const code = toMermaidSankey({
    eligible: true,
    method: 'exact_totals_estimated_categories',
    totals: {
      inputTokens: 1000,
      outputTokens: 400,
      totalTokens: 1400,
    },
    input: [
      { key: 'system', label: 'System Prompt', tokens: 300 },
      { key: 'user', label: 'User Prompt', tokens: 700 },
    ],
    output: [
      { key: 'completion', label: 'Final Answer', tokens: 400 },
    ],
    notes: [],
  })

  const lines = code.split('\n')
  assert.equal(lines[0], 'sankey-beta')
  assert.ok(lines.includes('Context Window,Input Tokens,1000'))
  assert.ok(lines.includes('Context Window,Output Tokens,400'))
  assert.ok(lines.includes('Input Tokens,System Prompt [input:system],300'))
  assert.ok(lines.includes('Output Tokens,Final Answer [output:completion],400'))
  assert.ok(!code.includes('-->'))
  assert.ok(!code.includes('[') || code.includes('[input:') || code.includes('[output:'))
})

test('toMermaidSankey compacts known category labels while retaining keys', () => {
  const code = toMermaidSankey({
    eligible: true,
    method: 'exact_totals_estimated_categories',
    totals: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    },
    input: [
      { key: 'assistant_history', label: 'Assistant History', tokens: 60 },
      { key: 'input_media', label: 'Input Media', tokens: 40 },
    ],
    output: [
      { key: 'assistant_text', label: 'Assistant Text', tokens: 50 },
    ],
    notes: [],
  })

  assert.ok(code.includes('Input Tokens,Asst Hist [input:assistant_history],60'))
  assert.ok(code.includes('Input Tokens,Media In [input:input_media],40'))
  assert.ok(code.includes('Output Tokens,Asst Text [output:assistant_text],50'))
})

test('toMermaidSankey escapes csv cells for commas and quotes', () => {
  const code = toMermaidSankey({
    eligible: true,
    method: 'estimated_only',
    totals: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    },
    input: [
      { key: 'quoted', label: 'System "Rules", Prompt', tokens: 10 },
    ],
    output: [
      { key: 'final', label: 'Final, "Answer"', tokens: 5 },
    ],
    notes: [],
  })

  assert.match(code, /"System ""Rules"", Prompt \[input:quoted\]"/)
  assert.match(code, /"Final, ""Answer"" \[output:final\]"/)
})
