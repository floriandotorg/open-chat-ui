import type { CodeExecutionSummary, SteerSummary, ToolCallSummary } from './types'

export type ContentSegment = { type: 'text'; content: string } | { type: 'tool_call'; toolCall: ToolCallSummary } | { type: 'code_execution'; codeExecution: CodeExecutionSummary } | { type: 'steer'; steer: SteerSummary }

interface OffsetItem {
  offset: number
  segment: ContentSegment
  toolCallIndex?: number
  codeExecutionIndex?: number
}

const followsSteer = (item: OffsetItem, steer: SteerSummary) => item.offset > steer.textOffset || (item.toolCallIndex ?? -1) >= steer.toolCallsBefore || (item.codeExecutionIndex ?? -1) >= steer.codeExecutionsBefore

export const buildContentSegments = (text: string, toolCalls?: ToolCallSummary[], codeExecutions?: CodeExecutionSummary[], steers?: SteerSummary[]): ContentSegment[] => {
  if (!toolCalls?.length && !codeExecutions?.length && !steers?.length) return text ? [{ type: 'text', content: text }] : []

  const items: OffsetItem[] = []

  for (const [index, tc] of (toolCalls ?? []).entries()) {
    items.push({ offset: tc.textOffset ?? 0, segment: { type: 'tool_call', toolCall: tc }, toolCallIndex: index })
  }

  for (const [index, ce] of (codeExecutions ?? []).entries()) {
    items.push({ offset: ce.textOffset ?? 0, segment: { type: 'code_execution', codeExecution: ce }, codeExecutionIndex: index })
  }

  items.sort((a, b) => a.offset - b.offset)

  for (const steer of steers ?? []) {
    const position = items.findIndex(item => item.segment.type !== 'steer' && followsSteer(item, steer))
    items.splice(position < 0 ? items.length : position, 0, { offset: steer.textOffset, segment: { type: 'steer', steer } })
  }

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
