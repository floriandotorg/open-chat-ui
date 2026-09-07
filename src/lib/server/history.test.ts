import { buildHistoryMessages, hydrateEntries, slimEntry } from '$lib/server/history'
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

describe('hydrateEntries', () => {
  it('restores results from the payload onto slim entries', () => {
    const slim = [
      { id: 'toolu_1', name: 'web_search', textOffset: 5, done: true, resultChars: 100 },
      { type: 'code_execution', id: 'srvtoolu_1', name: 'bash_code_execution', textOffset: 10, done: true, stdoutChars: 3 },
    ]
    const payload = {
      messageId: 'm1',
      toolResults: {
        toolu_1: { result: 'result text', rawResult: 'raw text', arguments: { q: 'x' } },
        srvtoolu_1: { stdout: 'out', stderr: 'err', input: { code: 'ls' } },
      },
      rawContentBlocks: null,
      thinking: null,
    }
    expect(hydrateEntries(slim, payload)).toEqual([
      { id: 'toolu_1', name: 'web_search', arguments: { q: 'x' }, textOffset: 5, result: 'result text', rawResult: 'raw text' },
      { type: 'code_execution', id: 'srvtoolu_1', name: 'bash_code_execution', input: { code: 'ls' }, textOffset: 10, stdout: 'out', stderr: 'err' },
    ])
  })

  it('passes legacy entries with inline results through when no payload exists', () => {
    const legacy = [{ id: 'toolu_1', name: 'web_search', arguments: { q: 'x' }, textOffset: 5, result: 'inline', rawResult: 'raw' }]
    expect(hydrateEntries(legacy, undefined)).toEqual(legacy)
  })

  it('hydrated slim history rebuilds the same provider turns as the legacy shape', () => {
    const legacy = [
      { id: 'toolu_1', name: 'web_search', arguments: { q: 1 }, textOffset: 1, result: 'r1' },
      { id: 'toolu_2', name: 'web_search', arguments: { q: 2 }, textOffset: 2, result: 'r2' },
    ]
    const slim = [
      { id: 'toolu_1', name: 'web_search', textOffset: 1, done: true, resultChars: 2 },
      { id: 'toolu_2', name: 'web_search', textOffset: 2, done: true, resultChars: 2 },
    ]
    const payload = {
      messageId: 'm1',
      toolResults: {
        toolu_1: { result: 'r1', arguments: { q: 1 } },
        toolu_2: { result: 'r2', arguments: { q: 2 } },
      },
      rawContentBlocks: null,
      thinking: null,
    }
    const fromLegacy = buildHistoryMessages('assistant', 'ab', legacy, null)
    const fromSlim = buildHistoryMessages('assistant', 'ab', hydrateEntries(slim, payload), null)
    expect(fromSlim).toEqual(fromLegacy)
    expect(fromSlim).toEqual([
      { role: 'assistant', content: 'a', toolCalls: [{ id: 'toolu_1', name: 'web_search', arguments: { q: 1 } }] },
      { role: 'tool', content: 'r1', toolCallId: 'toolu_1' },
      { role: 'assistant', content: 'b', toolCalls: [{ id: 'toolu_2', name: 'web_search', arguments: { q: 2 } }] },
      { role: 'tool', content: 'r2', toolCallId: 'toolu_2' },
    ])
  })
})

describe('slimEntry', () => {
  it('strips results and precomputes citations for citation tools', () => {
    const entry = {
      id: 'toolu_1',
      name: 'web_search',
      arguments: { q: 'x' },
      textOffset: 5,
      result: '1. [Title](https://example.com/page)\nsummary',
      rawResult: 'raw',
    }
    expect(slimEntry(entry, true)).toEqual({
      id: 'toolu_1',
      name: 'web_search',
      textOffset: 5,
      done: true,
      resultChars: entry.result.length,
      citations: [{ index: 1, url: 'https://example.com/page', title: 'Title', hostname: 'example.com' }],
    })
  })

  it('omits citations for non-citation tools', () => {
    const entry = { id: 'toolu_1', name: 'fetch_url', arguments: {}, textOffset: 0, result: '1. [T](https://x.com)' }
    expect(slimEntry(entry, true)).toEqual({
      id: 'toolu_1',
      name: 'fetch_url',
      textOffset: 0,
      done: true,
      resultChars: entry.result.length,
    })
  })

  it('marks live entries without results as pending', () => {
    expect(slimEntry({ id: 'toolu_1', name: 'web_search', arguments: {}, textOffset: 0 }, false)).toEqual({
      id: 'toolu_1',
      name: 'web_search',
      textOffset: 0,
      done: false,
    })
  })

  it('slims code executions to char counts and files', () => {
    const entry = {
      type: 'code_execution' as const,
      id: 'srvtoolu_1',
      name: 'bash_code_execution',
      input: { code: 'ls' },
      textOffset: 3,
      stdout: 'out',
      stderr: 'e',
      returnCode: 1,
      files: [{ fileId: 'f1', filename: 'a.png', mimeType: 'image/png' }],
    }
    expect(slimEntry(entry, true)).toEqual({
      type: 'code_execution',
      id: 'srvtoolu_1',
      name: 'bash_code_execution',
      textOffset: 3,
      done: true,
      returnCode: 1,
      stdoutChars: 3,
      stderrChars: 1,
      files: [{ fileId: 'f1', filename: 'a.png', mimeType: 'image/png' }],
    })
  })
})
