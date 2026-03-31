import test from 'node:test'
import assert from 'node:assert/strict'
import { getLatestThinkingLines, hasUnclosedThinkingTag } from './thinkingPreview'

test('latest lines append chars within current trailing line', () => {
  const before = getLatestThinkingLines('one\ntwo\npar')
  const after = getLatestThinkingLines('one\ntwo\npart')

  assert.deepEqual(before, ['one', 'two', 'par'])
  assert.deepEqual(after, ['one', 'two', 'part'])
})

test('latest lines create a new line once newline arrives', () => {
  const lines = getLatestThinkingLines('one\ntwo\npart\nnext')
  assert.deepEqual(lines, ['one', 'two', 'part', 'next'])
})

test('latest lines drop oldest full line when window exceeds five lines', () => {
  const lines = getLatestThinkingLines('1\n2\n3\n4\n5\n6')
  assert.deepEqual(lines, ['2', '3', '4', '5', '6'])
})

test('unclosed think tags are considered live, closed are not', () => {
  assert.equal(hasUnclosedThinkingTag('<think>still thinking'), true)
  assert.equal(hasUnclosedThinkingTag('<think>done</think>final'), false)
})

