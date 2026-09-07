import { applyStreamOps, mergeOps } from './stream-ops'
import type { Message, StreamOp } from './types'
import { describe, expect, it } from 'vitest'

const baseMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'm1',
  conversationId: 'c1',
  role: 'assistant',
  content: '',
  generating: true,
  eventSeq: 0,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
})

describe('mergeOps', () => {
  it('merges adjacent text ops', () => {
    const ops: StreamOp[] = [
      { t: 'text', v: 'a' },
      { t: 'text', v: 'b' },
      { t: 'text', v: 'c' },
    ]
    expect(mergeOps(ops)).toEqual([{ t: 'text', v: 'abc' }])
  })

  it('merges adjacent thinking ops', () => {
    const ops: StreamOp[] = [
      { t: 'thinking', v: 'x' },
      { t: 'thinking', v: 'y' },
    ]
    expect(mergeOps(ops)).toEqual([{ t: 'thinking', v: 'xy' }])
  })

  it('does not merge across other op types', () => {
    const ops: StreamOp[] = [
      { t: 'text', v: 'a' },
      { t: 'thinking', v: 't' },
      { t: 'text', v: 'b' },
    ]
    expect(mergeOps(ops)).toEqual(ops)
  })

  it('does not merge text with thinking', () => {
    const ops: StreamOp[] = [
      { t: 'text', v: 'a' },
      { t: 'thinking', v: 'b' },
    ]
    expect(mergeOps(ops)).toEqual(ops)
  })
})

describe('applyStreamOps', () => {
  it('returns the base message for empty ops', () => {
    const base = baseMessage({ content: 'hi' })
    expect(applyStreamOps(base, [])).toBe(base)
  })

  it('concatenates text ops onto content', () => {
    const base = baseMessage({ content: 'he' })
    const result = applyStreamOps(base, [
      { t: 'text', v: 'll' },
      { t: 'text', v: 'o' },
    ])
    expect(result.content).toBe('hello')
  })

  it('concatenates thinking ops', () => {
    const base = baseMessage()
    const result = applyStreamOps(base, [
      { t: 'thinking', v: 'let me ' },
      { t: 'thinking', v: 'think' },
    ])
    expect(result.thinking).toBe('let me think')
  })

  it('appends tool calls and marks them done on tool_result', () => {
    const base = baseMessage({ content: 'searching' })
    const result = applyStreamOps(base, [
      { t: 'tool_call', id: 't1', name: 'web_search', arguments: { q: 'x' }, textOffset: 9 },
      { t: 'tool_result', id: 't1', resultChars: 42, citations: [{ index: 1, url: 'https://a.com', title: 'A', hostname: 'a.com' }] },
    ])
    expect(result.toolCalls).toEqual([
      {
        id: 't1',
        name: 'web_search',
        arguments: { q: 'x' },
        textOffset: 9,
        done: true,
        resultChars: 42,
        citations: [{ index: 1, url: 'https://a.com', title: 'A', hostname: 'a.com' }],
      },
    ])
  })

  it('keeps tool call pending without a result op', () => {
    const result = applyStreamOps(baseMessage(), [{ t: 'tool_call', id: 't1', name: 'web_search', arguments: {}, textOffset: 0 }])
    expect(result.toolCalls?.[0].done).toBe(false)
    expect(result.toolCalls?.[0].resultChars).toBeUndefined()
  })

  it('runs the code execution lifecycle', () => {
    const result = applyStreamOps(baseMessage(), [
      { t: 'code_exec_start', id: 'c1', name: 'bash_code_execution', textOffset: 0 },
      { t: 'code_exec_input', id: 'c1', input: { code: 'ls' } },
      { t: 'code_exec_input', id: 'c1', input: { code: 'ls -la' } },
      { t: 'code_exec_result', id: 'c1', returnCode: 0, stdoutChars: 10, stderrChars: 0 },
      { t: 'code_exec_files', id: 'c1', files: [{ fileId: 'f1', filename: 'out.png', mimeType: 'image/png' }] },
    ])
    expect(result.codeExecutions).toEqual([
      {
        type: 'code_execution',
        id: 'c1',
        name: 'bash_code_execution',
        input: { code: 'ls -la' },
        textOffset: 0,
        done: true,
        returnCode: 0,
        error: undefined,
        stdoutChars: 10,
        stderrChars: 0,
        files: [{ fileId: 'f1', filename: 'out.png', mimeType: 'image/png' }],
      },
    ])
  })

  it('handles mixed op order', () => {
    const result = applyStreamOps(baseMessage(), [
      { t: 'thinking', v: 'hmm' },
      { t: 'text', v: 'one ' },
      { t: 'tool_call', id: 't1', name: 'fetch_url', arguments: {}, textOffset: 4 },
      { t: 'text', v: 'two' },
      { t: 'tool_result', id: 't1', resultChars: 5 },
    ])
    expect(result.thinking).toBe('hmm')
    expect(result.content).toBe('one two')
    expect(result.toolCalls?.[0]).toMatchObject({ id: 't1', textOffset: 4, done: true, resultChars: 5 })
  })

  it('does not mutate the base message or its arrays', () => {
    const base = baseMessage({
      content: 'a',
      toolCalls: [{ id: 't1', name: 'web_search', arguments: {}, textOffset: 1, done: false }],
    })
    const original = base.toolCalls?.[0]
    applyStreamOps(base, [
      { t: 'text', v: 'b' },
      { t: 'tool_result', id: 't1', resultChars: 3 },
    ])
    expect(base.content).toBe('a')
    expect(base.toolCalls?.[0]).toBe(original)
    expect(base.toolCalls?.[0].done).toBe(false)
  })

  it('ignores result ops for unknown ids', () => {
    const result = applyStreamOps(baseMessage(), [{ t: 'tool_result', id: 'nope', resultChars: 1 }])
    expect(result.toolCalls).toBeUndefined()
  })
})
