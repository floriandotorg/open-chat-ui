import { buildContentSegments } from '#lib/content-segments.ts'
import type { SteerSummary, ToolCallSummary } from '#lib/types.ts'
import { describe, expect, it } from 'vitest'

const toolCall = (id: string, textOffset: number): ToolCallSummary => ({ id, name: 'search', textOffset, done: true })

const steer = (overrides: Partial<SteerSummary> = {}): SteerSummary => ({ id: 's1', content: 'steer', textOffset: 0, toolCallsBefore: 0, codeExecutionsBefore: 0, ...overrides })

const kinds = (text: string, toolCalls: ToolCallSummary[], steers: SteerSummary[]) => buildContentSegments(text, toolCalls, undefined, steers).map(s => (s.type === 'text' ? `text:${s.content}` : s.type === 'tool_call' ? `tool:${s.toolCall.id}` : s.type === 'steer' ? `steer:${s.steer.id}` : s.type))

describe('buildContentSegments', () => {
  it('places a steer between tool rounds that share a text offset', () => {
    expect(kinds('done', [toolCall('t1', 0), toolCall('t2', 0)], [steer({ toolCallsBefore: 1 })])).toEqual(['tool:t1', 'steer:s1', 'tool:t2', 'text:done'])
  })

  it('splits text at the steer offset', () => {
    expect(kinds('ab', [], [steer({ textOffset: 1 })])).toEqual(['text:a', 'steer:s1', 'text:b'])
  })

  it('keeps consecutive steers in order', () => {
    expect(kinds('a', [toolCall('t1', 1)], [steer({ id: 's1', textOffset: 1, toolCallsBefore: 1 }), steer({ id: 's2', textOffset: 1, toolCallsBefore: 1 })])).toEqual(['text:a', 'tool:t1', 'steer:s1', 'steer:s2'])
  })
})
