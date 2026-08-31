import type { PersistedCodeExecution, PersistedToolCall } from '$lib/server/history'

export type LiveToolCall = (Omit<PersistedToolCall, 'result'> & { result?: string }) | PersistedCodeExecution

const LIVE_RESULT_MAX = 8_000
const TRUNCATION_SUFFIX = '…'
const FLUSH_MIN_MS = 250
const FLUSH_MAX_MS = 1_500
const FLUSH_BYTES_PER_MS = 200

const truncate = (text: string | undefined): string | undefined => (text !== undefined && text.length > LIVE_RESULT_MAX ? text.slice(0, LIVE_RESULT_MAX) + TRUNCATION_SUFFIX : text)

// Every PocketBase write broadcasts the FULL record to every subscriber, so
// live flushes must stay small: rawResult (raw provider payloads) is withheld
// until the final write and long tool results are truncated. The finalize
// update persists the complete data.
export const buildLiveToolCallsPayload = (liveToolCalls: LiveToolCall[]): unknown[] | null => {
  if (!liveToolCalls.length) return null
  return liveToolCalls.map(tc => {
    if ('type' in tc) {
      return { ...tc, ...(tc.stdout !== undefined ? { stdout: truncate(tc.stdout) } : {}), ...(tc.stderr !== undefined ? { stderr: truncate(tc.stderr) } : {}) }
    }
    const { rawResult: _rawResult, result, ...rest } = tc
    return { ...rest, ...(result !== undefined ? { result: truncate(result) } : {}) }
  })
}

// Flush pacing adapts to record size so the per-client SSE rate stays roughly
// constant instead of growing with the record: PocketBase drops consumers that
// cannot keep up, which used to kill streams right after large tool results.
export const nextFlushDelay = (payloadBytes: number): number => Math.min(FLUSH_MAX_MS, Math.max(FLUSH_MIN_MS, Math.round(payloadBytes / FLUSH_BYTES_PER_MS)))
