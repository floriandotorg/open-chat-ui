import type { BrowserAction } from '#lib/browser-protocol.ts'
import { parseModifiers } from '#lib/server/browser/agent.ts'
import { HostBrowserToolset, pruneScreenshots } from '#lib/server/browser/agent-anthropic.ts'
import { createFakeHost, fakeState, okResult } from '#lib/server/browser/fake-host.ts'
import { createTaskSession } from '#lib/server/browser/task-session.ts'
import { describe, expect, it } from 'vitest'

const setup = (respond?: (action: BrowserAction) => ReturnType<typeof okResult>, files = [{ id: 'file_1', name: 'a.jpg', size: 10 }]) => {
  const fake = createFakeHost(respond)
  const session = createTaskSession({ host: fake.host, sessionId: 's1', initialState: fakeState(), files })
  return { ...fake, toolset: new HostBrowserToolset(session) }
}

const call = (toolset: HostBrowserToolset, name: string, input: Record<string, unknown>) => toolset.toolResult({ id: `tu_${name}`, type: 'tool_use', name, input, toolset_name: 'browser' })

describe('parseModifiers', () => {
  it('maps modifier names and drops unknown ones', () => {
    expect(parseModifiers('ctrl+Shift')).toEqual(['ctrl', 'shift'])
    expect(parseModifiers('cmd')).toEqual(['meta'])
    expect(parseModifiers('hyper')).toBeUndefined()
    expect(parseModifiers(null)).toBeUndefined()
  })
})

describe('HostBrowserToolset', () => {
  it('forwards clicks with targets and modifiers', async () => {
    const { toolset, calls } = setup()
    const result = await call(toolset, 'double_click', { target: { type: 'ref', ref: 'ref_4' }, modifiers: 'shift' })
    expect(result.is_error).toBeFalsy()
    expect(calls[0].actions).toEqual([{ type: 'click', target: { ref: 'ref_4' }, button: 'left', count: 2, modifiers: ['shift'] }])
  })

  it('maps navigate back to history and returns the page', async () => {
    const { toolset, calls } = setup(() => okResult(fakeState('https://example.com/previous')))
    const result = await call(toolset, 'navigate', { url: 'back' })
    expect(calls[0].actions).toEqual([{ type: 'history', direction: 'back' }])
    expect(JSON.stringify(result.content)).toContain('https://example.com/previous')
  })

  it('converts scroll notches to pixels', async () => {
    const { toolset, calls } = setup()
    await call(toolset, 'scroll', { scroll_direction: 'up', target: { type: 'coordinate', x: 10, y: 20 }, scroll_amount: 2 })
    expect(calls[0].actions).toEqual([{ type: 'scroll', x: 10, y: 20, deltaX: 0, deltaY: -200 }])
  })

  it('returns screenshots as images', async () => {
    const { toolset } = setup(() => okResult(fakeState(), { image: { base64: 'aGk=', mediaType: 'image/jpeg' } }))
    const result = await call(toolset, 'screenshot', {})
    expect(JSON.stringify(result.content)).toContain('aGk=')
  })

  it('reports host errors to the model as tool errors', async () => {
    const { toolset } = setup(() => ({ ok: false, error: 'Unknown or stale ref ref_3. Call read_page again.', state: fakeState() }))
    const result = await call(toolset, 'left_click', { target: { type: 'ref', ref: 'ref_3' } })
    expect(result.is_error).toBe(true)
    expect(JSON.stringify(result.content)).toContain('stale ref')
  })

  it('uploads staged files by document id and refuses unknown ids', async () => {
    const { toolset, calls } = setup()
    await call(toolset, 'file_upload', { target: { type: 'ref', ref: 'ref_7' }, document_ids: ['file_1'] })
    expect(calls[0].actions).toEqual([{ type: 'file_upload', target: { ref: 'ref_7' }, fileIds: ['file_1'] }])
    const refused = await call(toolset, 'file_upload', { target: { type: 'ref', ref: 'ref_7' }, document_ids: ['file_9'] })
    expect(refused.is_error).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('disables file upload when nothing is attached', () => {
    const { toolset } = setup(undefined, [])
    expect(toolset.toJSON().configs?.file_upload?.enabled).toBe(false)
  })
})

describe('pruneScreenshots', () => {
  const image = { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: 'x' } }
  const turn = (n: number) => ({ role: 'user' as const, content: [{ type: 'tool_result' as const, tool_use_id: `t${n}`, content: [image] }] })

  it('leaves short histories alone', () => {
    const messages = [turn(1), turn(2)]
    expect(pruneScreenshots(messages, { max: 3, keep: 1 })).toBe(messages)
  })

  it('replaces the oldest screenshots once over the limit', () => {
    const pruned = pruneScreenshots([turn(1), turn(2), turn(3), turn(4)], { max: 3, keep: 1 })
    const kinds = pruned.flatMap(message => (typeof message.content === 'string' ? [] : message.content.flatMap(block => (block.type === 'tool_result' && Array.isArray(block.content) ? block.content.map(part => part.type) : []))))
    expect(kinds).toEqual(['text', 'text', 'text', 'image'])
  })
})
