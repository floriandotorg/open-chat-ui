import { parseLiveInput } from '#lib/server/browser/live-input.ts'
import { describe, expect, it } from 'vitest'

describe('parseLiveInput', () => {
  it('accepts taps, pointer, wheel, keys and text', () => {
    expect(parseLiveInput({ type: 'tap', x: 10.4, y: 20 })).toEqual({ type: 'tap', x: 10.4, y: 20 })
    expect(parseLiveInput({ type: 'pointer', event: 'down', x: 1, y: 2, button: 'right' })).toEqual({ type: 'pointer', event: 'down', x: 1, y: 2, button: 'right' })
    expect(parseLiveInput({ type: 'wheel', x: 1, y: 2, deltaX: 0, deltaY: -120 })).toEqual({ type: 'wheel', x: 1, y: 2, deltaX: 0, deltaY: -120 })
    expect(parseLiveInput({ type: 'key', key: 'Enter' })).toEqual({ type: 'key', key: 'Enter' })
    expect(parseLiveInput({ type: 'text', text: 'hello' })).toEqual({ type: 'text', text: 'hello' })
  })

  it('drops unknown fields', () => {
    expect(parseLiveInput({ type: 'tap', x: 1, y: 2, evil: true })).toEqual({ type: 'tap', x: 1, y: 2 })
  })

  it('rejects malformed input', () => {
    expect(parseLiveInput(null)).toBeNull()
    expect(parseLiveInput({ type: 'tap', x: '1', y: 2 })).toBeNull()
    expect(parseLiveInput({ type: 'tap', x: Number.NaN, y: 2 })).toBeNull()
    expect(parseLiveInput({ type: 'pointer', event: 'click', x: 1, y: 2 })).toBeNull()
    expect(parseLiveInput({ type: 'key', key: '' })).toBeNull()
    expect(parseLiveInput({ type: 'key', key: 'x'.repeat(40) })).toBeNull()
    expect(parseLiveInput({ type: 'text', text: 'x'.repeat(5000) })).toBeNull()
    expect(parseLiveInput({ type: 'exec' })).toBeNull()
  })
})
