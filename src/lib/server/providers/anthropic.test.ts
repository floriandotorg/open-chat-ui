import { containsServerToolBlocks, repairServerToolResults } from './anthropic'
import { describe, expect, it } from 'vitest'

type Block = Record<string, unknown>

const serverToolUse = (id: string): Block => ({ type: 'server_tool_use', id, name: 'bash_code_execution', input: { code: 'ls' } })
const bashResult = (id: string): Block => ({ type: 'bash_code_execution_tool_result', tool_use_id: id, content: { type: 'bash_code_execution_result', stdout: 'ok', stderr: '', return_code: 0 } })
const text = (t: string): Block => ({ type: 'text', text: t })

describe('containsServerToolBlocks', () => {
  it('detects server tool blocks', () => {
    expect(containsServerToolBlocks([text('hi')])).toBe(false)
    expect(containsServerToolBlocks([serverToolUse('srvtoolu_1')])).toBe(true)
    expect(containsServerToolBlocks([bashResult('srvtoolu_1')])).toBe(true)
  })
})

describe('repairServerToolResults', () => {
  it('leaves intact pairs untouched', () => {
    const messages = [
      { role: 'user' as const, content: 'go' },
      { role: 'assistant' as const, content: [text('a'), serverToolUse('srvtoolu_1'), bashResult('srvtoolu_1'), text('b')] },
    ]
    expect(repairServerToolResults(messages)).toEqual(messages)
  })

  it('moves an orphan result next to its server_tool_use in an earlier assistant message', () => {
    const messages = [
      { role: 'user' as const, content: 'go' },
      { role: 'assistant' as const, content: [text('a'), serverToolUse('srvtoolu_1')] },
      { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'r' }] },
      { role: 'assistant' as const, content: [bashResult('srvtoolu_1'), text('done')] },
    ]
    expect(repairServerToolResults(messages)).toEqual([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [text('a'), serverToolUse('srvtoolu_1'), bashResult('srvtoolu_1')] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'r' }] },
      { role: 'assistant', content: [text('done')] },
    ])
  })

  it('moves a result placed before its server_tool_use within the same message', () => {
    const messages = [{ role: 'assistant' as const, content: [bashResult('srvtoolu_1'), serverToolUse('srvtoolu_1')] }]
    expect(repairServerToolResults(messages)).toEqual([{ role: 'assistant', content: [serverToolUse('srvtoolu_1'), bashResult('srvtoolu_1')] }])
  })

  it('drops an orphan result when no server_tool_use exists anywhere', () => {
    const messages = [
      { role: 'user' as const, content: 'go' },
      { role: 'assistant' as const, content: [text('a'), bashResult('srvtoolu_gone'), text('b')] },
    ]
    expect(repairServerToolResults(messages)).toEqual([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [text('a'), text('b')] },
    ])
  })

  it('drops a message that becomes empty after removing an orphan result', () => {
    const messages = [
      { role: 'user' as const, content: 'go' },
      { role: 'assistant' as const, content: [bashResult('srvtoolu_gone')] },
      { role: 'user' as const, content: 'next' },
    ]
    expect(repairServerToolResults(messages)).toEqual([
      { role: 'user', content: 'go' },
      { role: 'user', content: 'next' },
    ])
  })

  it('does not mutate the input messages', () => {
    const assistant = { role: 'assistant' as const, content: [bashResult('srvtoolu_1'), text('done')] }
    const messages = [{ role: 'user' as const, content: 'go' }, assistant]
    repairServerToolResults(messages)
    expect(assistant.content).toHaveLength(2)
  })
})
