import { preserveLocalOrphans, resolveAndAnnotate } from './message-tree'
import { describe, expect, it } from 'vitest'

describe('preserveLocalOrphans', () => {
  it('returns server messages unchanged when no orphans', () => {
    const server = [{ id: 'a' }, { id: 'b' }]
    const local = [{ id: 'a' }, { id: 'b' }]
    expect(preserveLocalOrphans(server, local)).toBe(server)
  })

  it('appends local messages whose ids are absent from the server', () => {
    const server = [{ id: 'a', kind: 'server' as const }]
    const local = [
      { id: 'a', kind: 'local' as const },
      { id: 'b', kind: 'local' as const },
    ]
    const result = preserveLocalOrphans(server, local)
    expect(result.map(m => m.id)).toEqual(['a', 'b'])
    expect(result[0]).toEqual({ id: 'a', kind: 'server' })
    expect(result[1]).toEqual({ id: 'b', kind: 'local' })
  })

  it('preserves all local data on the orphan (e.g. sendError)', () => {
    interface Msg {
      id: string
      content: string
      sendError?: string
    }
    const server: Msg[] = []
    const local: Msg[] = [{ id: 'pending-1', content: 'hi', sendError: 'Load failed' }]
    const result = preserveLocalOrphans(server, local)
    expect(result).toEqual([{ id: 'pending-1', content: 'hi', sendError: 'Load failed' }])
  })

  it('keeps an orphan visible after resolveAndAnnotate when its parent has no other children', () => {
    const server = [{ id: 'a', parentId: null, createdAt: '2024-01-01T00:00:00Z' }]
    const local = [
      { id: 'a', parentId: null, createdAt: '2024-01-01T00:00:00Z' },
      { id: 'orphan', parentId: 'a', createdAt: '2024-01-01T00:00:01Z' },
    ]
    const merged = preserveLocalOrphans(server, local)
    const resolved = resolveAndAnnotate(merged, {})
    expect(resolved.map(m => m.id)).toEqual(['a', 'orphan'])
  })
})
