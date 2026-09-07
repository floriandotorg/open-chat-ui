import type { Message, StreamOp } from './types'

export const mergeOps = (ops: StreamOp[]): StreamOp[] => {
  const merged: StreamOp[] = []
  for (const op of ops) {
    const last = merged[merged.length - 1]
    if (op.t === 'text' && last?.t === 'text') {
      merged[merged.length - 1] = { t: 'text', v: last.v + op.v }
    } else if (op.t === 'thinking' && last?.t === 'thinking') {
      merged[merged.length - 1] = { t: 'thinking', v: last.v + op.v }
    } else {
      merged.push(op)
    }
  }
  return merged
}

export const applyStreamOps = (base: Message, ops: StreamOp[]): Message => {
  if (ops.length === 0) return base
  let content = base.content
  let thinking = base.thinking ?? ''
  const toolCalls = base.toolCalls ? [...base.toolCalls] : []
  const codeExecutions = base.codeExecutions ? [...base.codeExecutions] : []
  for (const op of ops) {
    if (op.t === 'text') {
      content += op.v
    } else if (op.t === 'thinking') {
      thinking += op.v
    } else if (op.t === 'tool_call') {
      toolCalls.push({ id: op.id, name: op.name, arguments: op.arguments, textOffset: op.textOffset, done: false })
    } else if (op.t === 'tool_result') {
      const n = toolCalls.findIndex(tc => tc.id === op.id)
      if (n >= 0) {
        toolCalls[n] = { ...toolCalls[n], done: true, resultChars: op.resultChars, ...(op.citations?.length ? { citations: op.citations } : {}) }
      }
    } else if (op.t === 'code_exec_start') {
      codeExecutions.push({ type: 'code_execution', id: op.id, name: op.name, input: {}, textOffset: op.textOffset, done: false })
    } else if (op.t === 'code_exec_input') {
      const n = codeExecutions.findIndex(ce => ce.id === op.id)
      if (n >= 0) codeExecutions[n] = { ...codeExecutions[n], input: op.input }
    } else if (op.t === 'code_exec_result') {
      const n = codeExecutions.findIndex(ce => ce.id === op.id)
      if (n >= 0) {
        codeExecutions[n] = { ...codeExecutions[n], done: true, returnCode: op.returnCode, error: op.error, stdoutChars: op.stdoutChars, stderrChars: op.stderrChars }
      }
    } else if (op.t === 'code_exec_files') {
      const n = codeExecutions.findIndex(ce => ce.id === op.id)
      if (n >= 0) codeExecutions[n] = { ...codeExecutions[n], files: op.files }
    }
  }
  return {
    ...base,
    content,
    thinking: thinking || undefined,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    codeExecutions: codeExecutions.length ? codeExecutions : undefined,
  }
}
