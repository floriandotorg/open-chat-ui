import type { BrowserSessionResponse, BrowserStagedFile } from '#lib/browser-protocol.ts'
import { type AgentUsage, type BrowserAgent, emptyUsage } from '#lib/server/browser/agent.ts'
import type { BrowserAgentConfig } from '#lib/server/browser/config.ts'
import { type BrowserHost, BrowserHostError } from '#lib/server/browser/host-client.ts'
import { registerBrowserSession, unregisterBrowserSession } from '#lib/server/browser/sessions.ts'
import { createTaskSession, type TaskSession } from '#lib/server/browser/task-session.ts'
import type { ToolAttachment, ToolContext, ToolExecutionOutput } from '#lib/server/tools/types.ts'

const BUSY_RETRY_MS = 5_000
const BUSY_WAIT_MS = 2 * 60_000
const MAX_STAGED_FILES = 20
const MAX_FILE_BYTES = 50 * 1024 * 1024

export interface BrowserTaskInput {
  task: string
  startUrl?: string
}

export interface BrowserTaskDeps {
  loadConfig: (userId: string) => Promise<BrowserAgentConfig | { error: string }>
  agents: Record<BrowserAgentConfig['provider'], BrowserAgent>
  readAttachment: (attachment: ToolAttachment) => Promise<Uint8Array<ArrayBuffer> | null>
  priceUsage: (modelRef: string, usage: AgentUsage) => Promise<number>
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

const abortableSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })

const openSession = async (host: BrowserHost, sleep: NonNullable<BrowserTaskDeps['sleep']>, signal?: AbortSignal): Promise<BrowserSessionResponse> => {
  const deadline = Date.now() + BUSY_WAIT_MS
  for (;;) {
    try {
      return await host.openSession(signal)
    } catch (err) {
      if (!(err instanceof BrowserHostError) || err.status !== 409 || Date.now() >= deadline || signal?.aborted) {
        throw err
      }
      await sleep(BUSY_RETRY_MS, signal)
    }
  }
}

const stageAttachments = async (host: BrowserHost, sessionId: string, attachments: ToolAttachment[], readAttachment: BrowserTaskDeps['readAttachment'], signal?: AbortSignal): Promise<BrowserStagedFile[]> => {
  const staged: BrowserStagedFile[] = []
  for (const attachment of attachments.slice(-MAX_STAGED_FILES)) {
    const data = await readAttachment(attachment)
    if (!data || data.byteLength > MAX_FILE_BYTES) {
      continue
    }
    staged.push(await host.stageFile(sessionId, `file_${staged.length + 1}`, attachment.name, data, signal))
  }
  return staged
}

const formatLog = (log: string[]): string => (log.length ? log.map((entry, n) => `${n + 1}. ${entry}`).join('\n') : 'No steps.')

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export const runBrowserTask = async ({ task, startUrl }: BrowserTaskInput, context: ToolContext, deps: BrowserTaskDeps): Promise<ToolExecutionOutput> => {
  const { signal, emitProgress } = context
  const config = await deps.loadConfig(context.userId)
  if ('error' in config) {
    return { result: `Error: ${config.error}` }
  }
  const { host } = config
  let opened: BrowserSessionResponse
  try {
    emitProgress?.({ sessionId: '', step: 0, status: 'running', summary: 'Starting the browser' })
    opened = await openSession(host, deps.sleep ?? abortableSleep, signal)
  } catch (err) {
    return { result: signal?.aborted ? 'Stopped by the user.' : `Error: ${errorMessage(err)}` }
  }
  const { sessionId } = opened
  registerBrowserSession({ sessionId, userId: context.userId, conversationId: context.conversationId ?? '', host })
  const usage = emptyUsage()
  const price = () => deps.priceUsage(config.modelRef, usage).catch(() => 0)
  let session: TaskSession | null = null
  try {
    const files = await stageAttachments(host, sessionId, context.attachments ?? [], deps.readAttachment, signal)
    session = createTaskSession({ host, sessionId, initialState: opened.state, files, signal, emitProgress })
    if (files.length) {
      session.log.push(`Prepared ${files.length} ${files.length === 1 ? 'file' : 'files'} for upload`)
    }
    if (startUrl) {
      await session.act([{ type: 'navigate', url: startUrl }])
    }
    const answer = await deps.agents[config.provider]({ task, startUrl, model: config.model, apiKey: config.apiKey, getAccessToken: config.getAccessToken, session, usage, signal })
    return { result: `${answer}\n\nFinal page: ${session.state().url}`, rawResult: formatLog(session.log), cost: await price() }
  } catch (err) {
    const rawResult = session ? formatLog(session.log) : undefined
    const result = signal?.aborted ? 'Stopped by the user.' : `Error: the browser task failed: ${errorMessage(err)}`
    return { result, ...(rawResult ? { rawResult } : {}), cost: await price() }
  } finally {
    unregisterBrowserSession(sessionId)
    await host.closeSession(sessionId).catch(() => {})
  }
}
