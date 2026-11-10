import { closeSteering, closeSteeringIfIdle, finishGeneration, registerGeneration, steerGeneration, takeSteers } from '#lib/server/generations.ts'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(() => finishGeneration('c1'))

describe('steering', () => {
  it('hands accepted steers to the generation once', () => {
    const generation = registerGeneration('c1', 'u1')
    expect(steerGeneration('c1', 'u1', { id: 's1', content: 'a' })).toBe(true)
    expect(takeSteers(generation)).toEqual([{ id: 's1', content: 'a' }])
    expect(takeSteers(generation)).toEqual([])
  })

  it('rejects steers from other users and for missing generations', () => {
    registerGeneration('c1', 'u1')
    expect(steerGeneration('c1', 'u2', { id: 's1', content: 'a' })).toBe(false)
    expect(steerGeneration('c2', 'u1', { id: 's1', content: 'a' })).toBe(false)
  })

  it('keeps steering open while steers are pending and rejects them once closed', () => {
    const generation = registerGeneration('c1', 'u1')
    steerGeneration('c1', 'u1', { id: 's1', content: 'a' })
    expect(closeSteeringIfIdle(generation)).toBe(false)
    takeSteers(generation)
    expect(closeSteeringIfIdle(generation)).toBe(true)
    expect(steerGeneration('c1', 'u1', { id: 's2', content: 'b' })).toBe(false)
  })

  it('rejects steers after a stop', () => {
    const generation = registerGeneration('c1', 'u1')
    generation.abort.abort()
    expect(steerGeneration('c1', 'u1', { id: 's1', content: 'a' })).toBe(false)
    closeSteering(generation)
    expect(generation.steers).toEqual([])
  })
})
