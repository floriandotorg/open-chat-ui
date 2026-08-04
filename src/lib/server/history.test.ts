import { buildHistoryMessages } from '$lib/server/history'
import { describe, expect, it } from 'vitest'

const codeExecEntry = (overrides = {}) => ({ type: 'code_execution' as const, id: 'srvtoolu_1', name: 'bash_code_execution', input: {}, textOffset: 5, stdout: '', ...overrides })

const rawBlocks = [
  { type: 'server_tool_use', id: 'srvtoolu_1', name: 'bash_code_execution' },
  { type: 'bash_code_execution_tool_result', tool_use_id: 'srvtoolu_1', content: {} },
]

describe('buildHistoryMessages', () => {
  it('passes through plain messages', () => {
    expect(buildHistoryMessages('user', 'hello', [], null)).toEqual([{ role: 'user', content: 'hello' }])
    expect(buildHistoryMessages('assistant', 'hi', [], null)).toEqual([{ role: 'assistant', content: 'hi' }])
  })

  it('replays a code-exec round ending at content end exactly once', () => {
    const entries = buildHistoryMessages('assistant', 'hello', [codeExecEntry()], [{ textOffset: 5, blocks: rawBlocks }])
    const assistantTurns = entries.filter(e => e.role === 'assistant')
    expect(assistantTurns).toHaveLength(1)
    expect(assistantTurns[0].rawContentBlocks).toEqual(rawBlocks)
  })

  it('emits trailing text after the last round', () => {
    const entries = buildHistoryMessages('assistant', 'helloworld', [codeExecEntry()], [{ textOffset: 5, blocks: rawBlocks }])
    expect(entries).toEqual([
      { role: 'assistant', content: 'hello', rawContentBlocks: rawBlocks },
      { role: 'assistant', content: 'world' },
    ])
  })

  it('splits regular tool rounds and interleaves results', () => {
    const entries = buildHistoryMessages('assistant', 'ab', [{ id: 'toolu_1', name: 'search', arguments: { q: 'x' }, textOffset: 1, result: 'r1' }], null)
    expect(entries).toEqual([
      { role: 'assistant', content: 'a', toolCalls: [{ id: 'toolu_1', name: 'search', arguments: { q: 'x' } }] },
      { role: 'tool', content: 'r1', toolCallId: 'toolu_1' },
      { role: 'assistant', content: 'b' },
    ])
  })

  it('keeps consecutive code-exec rounds distinct', () => {
    const entries = buildHistoryMessages(
      'assistant',
      'aabb',
      [codeExecEntry({ id: 'srvtoolu_1', textOffset: 2 }), codeExecEntry({ id: 'srvtoolu_2', textOffset: 4 })],
      [
        { textOffset: 2, blocks: [{ type: 'server_tool_use', id: 'srvtoolu_1' }] },
        { textOffset: 4, blocks: [{ type: 'server_tool_use', id: 'srvtoolu_2' }] },
      ],
    )
    expect(entries.map(e => e.rawContentBlocks)).toEqual([[{ type: 'server_tool_use', id: 'srvtoolu_1' }], [{ type: 'server_tool_use', id: 'srvtoolu_2' }]])
    expect(entries).toHaveLength(2)
  })
})
