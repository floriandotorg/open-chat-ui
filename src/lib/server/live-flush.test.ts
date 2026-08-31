import { buildLiveToolCallsPayload, nextFlushDelay } from './live-flush'
import { describe, expect, it } from 'vitest'

describe('nextFlushDelay', () => {
  it('keeps the minimum interval for small payloads', () => {
    expect(nextFlushDelay(0)).toBe(250)
    expect(nextFlushDelay(50_000)).toBe(250)
  })

  it('scales the interval with payload size', () => {
    expect(nextFlushDelay(100_000)).toBe(500)
    expect(nextFlushDelay(200_000)).toBe(1000)
  })

  it('caps the interval for huge payloads', () => {
    expect(nextFlushDelay(1_000_000)).toBe(1500)
  })
})

describe('buildLiveToolCallsPayload', () => {
  it('returns null for an empty list', () => {
    expect(buildLiveToolCallsPayload([])).toBe(null)
  })

  it('strips rawResult from live tool calls', () => {
    const payload = buildLiveToolCallsPayload([{ id: 't1', name: 'web_search', arguments: { q: 'x' }, textOffset: 0, result: 'short', rawResult: 'x'.repeat(100_000) }])
    expect(payload).toEqual([{ id: 't1', name: 'web_search', arguments: { q: 'x' }, textOffset: 0, result: 'short' }])
  })

  it('truncates oversized tool results', () => {
    const payload = buildLiveToolCallsPayload([{ id: 't1', name: 'web_search', arguments: {}, textOffset: 0, result: 'a'.repeat(20_000) }])
    if (!payload) throw new Error('expected payload')
    const entry = payload[0] as { result: string }
    expect(entry.result.length).toBeLessThan(9_000)
    expect(entry.result.endsWith('…')).toBe(true)
  })

  it('keeps tool calls without a result untouched', () => {
    const payload = buildLiveToolCallsPayload([{ id: 't1', name: 'web_search', arguments: {}, textOffset: 0 }])
    expect(payload).toEqual([{ id: 't1', name: 'web_search', arguments: {}, textOffset: 0 }])
  })

  it('truncates code execution stdout and stderr', () => {
    const payload = buildLiveToolCallsPayload([{ type: 'code_execution', id: 'c1', name: 'bash_code_execution', input: {}, textOffset: 0, stdout: 'b'.repeat(20_000), stderr: 'e' }])
    if (!payload) throw new Error('expected payload')
    const entry = payload[0] as { stdout: string; stderr: string }
    expect(entry.stdout.length).toBeLessThan(9_000)
    expect(entry.stderr).toBe('e')
  })
})
