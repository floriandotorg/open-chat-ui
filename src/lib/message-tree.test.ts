import { createStableAnnotator, preserveLocalOrphans, resolveAndAnnotate, resolveEffectiveParentId } from './message-tree'
import { describe, expect, it } from 'vitest'

describe('resolveEffectiveParentId', () => {
  const msgs = [
    { id: 'u1', createdAt: '2024-01-01T00:00:00Z' },
    { id: 'a1', createdAt: '2024-01-01T00:00:10Z' },
    { id: 'u2', createdAt: '2024-01-01T00:00:20Z' },
  ]

  it('returns null for a root-level message', () => {
    expect(resolveEffectiveParentId(null, msgs)).toBe(null)
    expect(resolveEffectiveParentId(undefined, msgs)).toBe(null)
  })

  it('keeps a valid existing parent', () => {
    expect(resolveEffectiveParentId('a1', msgs)).toBe('a1')
  })

  it('reattaches a dangling parent to the most recent message (heals empty-completion phantom)', () => {
    expect(resolveEffectiveParentId('phantom-does-not-exist', msgs)).toBe('u2')
  })

  it('falls back to null when the conversation has no prior messages', () => {
    expect(resolveEffectiveParentId('phantom', [])).toBe(null)
  })
})

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

describe('createStableAnnotator', () => {
  interface Msg {
    id: string
    parentId?: string | null
    createdAt: string
    content?: string
  }
  const m1: Msg = { id: 'a', parentId: null, createdAt: '2024-01-01T00:00:00Z', content: 'hi' }
  const m2: Msg = { id: 'b', parentId: 'a', createdAt: '2024-01-01T00:01:00Z', content: 'yo' }

  it('returns referentially stable annotated messages for unchanged sources', () => {
    const annotate = createStableAnnotator<Msg>()
    const first = annotate([m1, m2], {})
    const second = annotate([m1, m2], {})
    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
  })

  it('replaces only the annotated message whose source object changed', () => {
    const annotate = createStableAnnotator<Msg>()
    const first = annotate([m1, m2], {})
    const m2b = { ...m2, content: 'updated' }
    const second = annotate([m1, m2b], {})
    expect(second[0]).toBe(first[0])
    expect(second[1]).not.toBe(first[1])
    expect(second[1].content).toBe('updated')
  })

  it('refreshes annotation when sibling structure changes', () => {
    const annotate = createStableAnnotator<Msg>()
    const first = annotate([m1, m2], {})
    const m3: Msg = { id: 'c', parentId: 'a', createdAt: '2024-01-01T00:02:00Z' }
    const second = annotate([m1, m2, m3], { a: 'b' })
    expect(second[0]).toBe(first[0])
    expect(second[1]).not.toBe(first[1])
    expect(second[1].siblingCount).toBe(2)
  })

  it('matches resolveAndAnnotate output', () => {
    const annotate = createStableAnnotator<Msg>()
    expect(annotate([m1, m2], {})).toEqual(resolveAndAnnotate([m1, m2], {}))
  })
})
