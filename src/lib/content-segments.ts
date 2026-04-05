import type { CodeExecutionBlock, ToolCallInfo } from './types'

export type ContentSegment = { type: 'text'; content: string } | { type: 'tool_call'; toolCall: ToolCallInfo } | { type: 'code_execution'; codeExecution: CodeExecutionBlock }

interface OffsetItem {
  offset: number
  segment: ContentSegment
}

export const buildContentSegments = (text: string, toolCalls?: ToolCallInfo[], codeExecutions?: CodeExecutionBlock[]): ContentSegment[] => {
  const hasToolCalls = toolCalls?.length ?? 0
  const hasCodeExecs = codeExecutions?.length ?? 0
  if (!hasToolCalls && !hasCodeExecs) return text ? [{ type: 'text', content: text }] : []

  const items: OffsetItem[] = []

  if (toolCalls) {
    for (const tc of toolCalls) {
      items.push({ offset: tc.textOffset ?? 0, segment: { type: 'tool_call', toolCall: tc } })
    }
  }

  if (codeExecutions) {
    for (const ce of codeExecutions) {
      items.push({ offset: ce.textOffset ?? 0, segment: { type: 'code_execution', codeExecution: ce } })
    }
  }

  items.sort((a, b) => a.offset - b.offset)

  const segments: ContentSegment[] = []
  let lastOffset = 0

  for (const item of items) {
    if (item.offset > lastOffset) {
      segments.push({ type: 'text', content: text.slice(lastOffset, item.offset) })
      lastOffset = item.offset
    }
    segments.push(item.segment)
  }

  if (lastOffset < text.length) {
    segments.push({ type: 'text', content: text.slice(lastOffset) })
  }

  return segments
}
