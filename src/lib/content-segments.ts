import type { ToolCallInfo } from './types'

export type ContentSegment = { type: 'text'; content: string } | { type: 'tool_call'; toolCall: ToolCallInfo }

export const buildContentSegments = (text: string, toolCalls?: ToolCallInfo[]): ContentSegment[] => {
  if (!toolCalls?.length) return text ? [{ type: 'text', content: text }] : []

  const sorted = [...toolCalls].sort((a, b) => (a.textOffset ?? 0) - (b.textOffset ?? 0))
  const segments: ContentSegment[] = []
  let lastOffset = 0

  for (const tc of sorted) {
    const offset = tc.textOffset ?? 0
    if (offset > lastOffset) {
      segments.push({ type: 'text', content: text.slice(lastOffset, offset) })
      lastOffset = offset
    }
    segments.push({ type: 'tool_call', toolCall: tc })
  }

  if (lastOffset < text.length) {
    segments.push({ type: 'text', content: text.slice(lastOffset) })
  }

  return segments
}
