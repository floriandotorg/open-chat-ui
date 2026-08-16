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

  it('keeps a code-exec round and a plain round at the same offset distinct', () => {
    const blocks = [...rawBlocks, { type: 'tool_use', id: 'toolu_A', name: 'search' }]
    const entries = buildHistoryMessages('assistant', 'done', [codeExecEntry({ textOffset: 0 }), { id: 'toolu_A', name: 'search', arguments: {}, textOffset: 0, result: 'rA' }, { id: 'toolu_B', name: 'search', arguments: {}, textOffset: 0, result: 'rB' }], [{ textOffset: 0, blocks }])
    expect(entries).toEqual([
      { role: 'assistant', content: '', rawContentBlocks: blocks },
      { role: 'tool', content: 'rA', toolCallId: 'toolu_A' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'toolu_B', name: 'search', arguments: {} }] },
      { role: 'tool', content: 'rB', toolCallId: 'toolu_B' },
      { role: 'assistant', content: 'done' },
    ])
  })

  it('keeps consecutive empty-text code-exec rounds at the same offset distinct', () => {
    const blocks1 = [
      { type: 'server_tool_use', id: 'srvtoolu_1' },
      { type: 'tool_use', id: 'toolu_A', name: 'search' },
    ]
    const blocks2 = [
      { type: 'server_tool_use', id: 'srvtoolu_2' },
      { type: 'tool_use', id: 'toolu_B', name: 'search' },
    ]
    const entries = buildHistoryMessages(
      'assistant',
      'x',
      [codeExecEntry({ id: 'srvtoolu_1', textOffset: 0 }), { id: 'toolu_A', name: 'search', arguments: {}, textOffset: 0, result: 'rA' }, codeExecEntry({ id: 'srvtoolu_2', textOffset: 0 }), { id: 'toolu_B', name: 'search', arguments: {}, textOffset: 0, result: 'rB' }],
      [
        { textOffset: 0, blocks: blocks1 },
        { textOffset: 0, blocks: blocks2 },
      ],
    )
    expect(entries).toEqual([
      { role: 'assistant', content: '', rawContentBlocks: blocks1 },
      { role: 'tool', content: 'rA', toolCallId: 'toolu_A' },
      { role: 'assistant', content: '', rawContentBlocks: blocks2 },
      { role: 'tool', content: 'rB', toolCallId: 'toolu_B' },
      { role: 'assistant', content: 'x' },
    ])
  })

  it('replays a raw round whose server_tool_use never got a result', () => {
    const dangling = [{ type: 'server_tool_use', id: 'srvtoolu_1', name: 'bash_code_execution' }]
    const entries = buildHistoryMessages('assistant', 'hello', [], [{ textOffset: 5, blocks: dangling }])
    expect(entries).toEqual([{ role: 'assistant', content: 'hello', rawContentBlocks: dangling }])
  })

  it('replays a dangling server_tool_use round and a later orphan result round as separate turns', () => {
    const dangling = [{ type: 'server_tool_use', id: 'srvtoolu_1', name: 'bash_code_execution' }]
    const orphan = [
      { type: 'bash_code_execution_tool_result', tool_use_id: 'srvtoolu_1', content: {} },
      { type: 'text', text: 'done' },
    ]
    const entries = buildHistoryMessages(
      'assistant',
      'helloworld',
      [codeExecEntry({ id: 'srvtoolu_1', textOffset: 10 })],
      [
        { textOffset: 5, blocks: dangling },
        { textOffset: 10, blocks: orphan },
      ],
    )
    expect(entries).toEqual([
      { role: 'assistant', content: 'hello', rawContentBlocks: dangling },
      { role: 'assistant', content: 'world', rawContentBlocks: orphan },
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
